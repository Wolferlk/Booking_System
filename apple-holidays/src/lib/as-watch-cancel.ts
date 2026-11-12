/**
 * AppleSystem **cancellation watch** — the other half of the Live Watch tick.
 *
 * The watch has always asked one question: *what has AppleSystem confirmed that
 * we do not hold?* It never asked the mirror question — *what have we confirmed
 * that AppleSystem has since cancelled?* — so a quotation withdrawn at 10:00
 * stayed a live booking here: drivers allocated, tickets bought, hotels held,
 * until somebody happened to notice. This module asks the second question on the
 * same tick, off the same list call.
 *
 * ## What it will and will not do
 *
 * It **never cancels a booking.** It moves the booking to
 * `PENDING_CANCELLATION` — "Pending Approval — Accounts Team (Cancelling)" — and
 * emails the accounts desk, which is exactly the path a person takes when they
 * cancel by hand. Money has usually moved by the time upstream changes its mind:
 * supplier deposits, non-refundable tickets, an agent invoice already raised.
 * Accounts decides what happens to it; the automation's job is to make sure they
 * are asked, within minutes rather than whenever it is noticed.
 *
 * That is the whole reason this lives here and not in the reconciler. The Parity
 * Check (`as-reconcile.ts`) *does* cancel outright, and can afford to: it acts on
 * any drift off status 2, so it needs two sightings twenty minutes apart before
 * it believes itself. This one acts on the single unambiguous signal —
 * AppleSystem *says* cancelled, {@link AS_CANCELLED_STATUSES} — and hands the
 * decision to a human, so it can afford to act on first sight.
 *
 * ## Why it defaults to watching, not acting
 *
 * Switched on for the first time, an untethered sweep would find every
 * cancellation already sitting in the lookback window and fire that whole
 * backlog at the accounts desk in one burst. So detection always runs and is
 * always listed; the status change is gated on {@link CANCEL_ACTION_ENABLED},
 * which ships off. Until it is switched on, every detection sits in the panel as
 * `awaiting` with a per-row button, so the backlog is adopted deliberately, one
 * booking at a time. This mirrors `as_reconcile_autocancel_enabled` — same
 * argument, same shape.
 *
 * ## The loop this ledger exists to prevent
 *
 * Accounts can **reject** a cancellation, and rejecting restores the booking's
 * previous status and wipes `cancelRequestedAt` — deliberately, so a rejected
 * request leaves no trail. Upstream, meanwhile, still says cancelled, and will
 * on every sweep for as long as the quotation sits in the window. A watcher with
 * no memory would re-request on the very next tick, forever, and the accounts
 * desk would be arguing with a cron job.
 *
 * So every detection is remembered by ref. A ref that has been requested once is
 * never requested again automatically: the ledger follows what became of it —
 * `approved` when accounts cancelled it, `declined` when they refused — and a
 * declined booking is shown as an open disagreement between two systems for a
 * person to settle, not re-raised.
 *
 * Storage is `system_settings` (KV), like every sibling module. **No schema
 * change, no migration** — the live database carries drift and must never be
 * `prisma db push`-ed.
 */

import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { searchBookings, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { wasImportedFromAppleSystem } from '@/lib/as-reconcile'
import { sendCancellationApprovalEmail } from '@/lib/send-cancellation-email'
import { raiseAsImportAlert } from '@/lib/as-import-alerts'
import { logActivity, ACTION } from '@/lib/activity'

// ── Keys ──────────────────────────────────────────────────────────────────────

/** Gate on the *action*. Detection runs regardless; this decides whether it acts. */
export const CANCEL_ACTION_ENABLED = 'as_watch_cancel_action_enabled'
const CANCEL_LEDGER = 'as_watch_cancel_ledger'

/**
 * The upstream statuses that mean "cancelled".
 *
 * Deliberately a whitelist of one rather than "anything that is not 2". A
 * quotation dropping back to status 1 is an edit in progress, not a withdrawal,
 * and reading it as one would cancel live tours mid-amendment; that ambiguous
 * case belongs to the Parity Check, which fences it with two sightings.
 */
export const AS_CANCELLED_STATUSES = ['3'] as const

/**
 * Stamped on `cancelledByName`, so the booking, the accounts queue and the
 * cancellation email all attribute the request to AppleSystem rather than to
 * whichever human account the automation happens to run as.
 */
export const AS_CANCEL_ACTOR = 'AppleSystem'

/** Ledger retention — read whole on every tick, so keep it small. */
const MAX_ENTRIES = 60
/** `system_settings.value` is MySQL TEXT; stay far below the 65,535-byte ceiling. */
const MAX_BYTES = 40_000

// ── Shapes ────────────────────────────────────────────────────────────────────

/**
 * Where a detected cancellation has got to.
 *
 *   `awaiting`  — detected; nothing changed here yet, because the action switch
 *                 is off or a guard held it back. A person decides.
 *   `requested` — the booking is at PENDING_CANCELLATION, accounts have been
 *                 emailed, and nobody has decided yet.
 *   `approved`  — accounts approved; the booking is cancelled.
 *   `declined`  — accounts rejected it, and upstream still says cancelled. Two
 *                 systems disagree; this is never auto-re-raised.
 *   `skipped`   — nothing to do: already closed here, or the booking was never
 *                 imported from AppleSystem in the first place.
 *   `failed`    — the update itself threw. It is retried on the next tick.
 */
export type CancelState =
  | 'awaiting' | 'requested' | 'approved' | 'declined' | 'skipped' | 'failed'

export interface CancelEntry {
  ref: string
  bookingId: string | null
  quotationNo: string
  country: string | null
  guestName: string | null
  /** `yyyy-mm-dd`, for the "is this tour already running?" judgement on screen. */
  arrivalDate: string | null
  /** Raw upstream status and its own label for it, so the panel quotes AppleSystem. */
  upstreamStatus: string
  upstreamClass: string | null
  state: CancelState
  /** Why it is `awaiting`, `skipped` or `failed` — null once it has been acted on. */
  note: string | null
  /** What the booking was before the request, so the panel can say what is at stake. */
  prevStatus: string | null
  detectedAt: string
  requestedAt: string | null
  /** Who moved it: the sweep itself, or a named person using the row's button. */
  actedBy: string | null
  /** Set once accounts decided, either way. */
  decidedAt: string | null
}

// ── KV plumbing ───────────────────────────────────────────────────────────────

async function readLedger(): Promise<CancelEntry[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: CANCEL_LEDGER } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as CancelEntry[]) : []
  } catch {
    return []
  }
}

async function writeLedger(list: CancelEntry[]): Promise<void> {
  const out = list.slice(0, MAX_ENTRIES)
  while (out.length > 1 && Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_BYTES) out.pop()
  const value = JSON.stringify(out)
  await prisma.systemSetting.upsert({
    where: { key: CANCEL_LEDGER }, update: { value }, create: { key: CANCEL_LEDGER, value },
  })
}

/** Newest activity first, matching every other panel on the Live Watch page. */
function upsertEntry(list: CancelEntry[], entry: CancelEntry): CancelEntry[] {
  const rest = list.filter((e) => e.ref !== entry.ref)
  rest.unshift(entry)
  return rest
}

export async function listCancelEntries(limit = MAX_ENTRIES): Promise<CancelEntry[]> {
  return (await readLedger()).slice(0, limit)
}

// ── The action switch ─────────────────────────────────────────────────────────

export async function getCancelActionEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CANCEL_ACTION_ENABLED } })
  return row?.value === 'true'
}

export async function setCancelActionEnabled(on: boolean): Promise<boolean> {
  await prisma.systemSetting.upsert({
    where:  { key: CANCEL_ACTION_ENABLED },
    update: { value: on ? 'true' : 'false' },
    create: { key: CANCEL_ACTION_ENABLED, value: on ? 'true' : 'false' },
  })
  return on
}

// ── Guards ────────────────────────────────────────────────────────────────────

/** Already closed, or already someone else's problem. */
const CLOSED_HERE: BookingStatus[] = ['CANCELLED', 'PENDING_CANCELLATION', 'COMPLETED', 'AMENDED']

/** The booking fields every decision and every email on this path needs. */
const BOOKING_SELECT = {
  id: true, bookingRef: true, status: true, isNumber: true, agent: true,
  agentBookingId: true, fileHandler: true, arrivalDate: true, departureDate: true,
  paxAdults: true, paxChildren: true, paxInfants: true, quotedTotal: true,
  currency: true, operationCountry: true, cancelRequestedAt: true,
  passengers: { where: { isLead: true }, take: 1, select: { name: true } },
} as const

type CancelCandidate = Awaited<ReturnType<typeof loadBooking>>

async function loadBooking(ref: string) {
  return prisma.booking.findUnique({ where: { bookingRef: ref }, select: BOOKING_SELECT })
}

/** The booking ref an upstream row would have here, or null when it carries none. */
function refOf(row: ASBookingListItem): string | null {
  const raw = normalizeIsNumber(String(row.is_number ?? ''))
  return !raw || raw === 'NA' ? null : raw
}

/** `yyyy-mm-dd` the quotation was created upstream — the field is a string or `{ date }`. */
function upstreamCreatedOn(row: ASBookingListItem): string | null {
  const raw = row.created_at
  const s = typeof raw === 'string' ? raw : raw?.date ?? null
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** `yyyy-mm-dd` arrival, assembled from the list row's `main` block. */
function upstreamArrival(row: ASBookingListItem): string | null {
  const y = row.main?.arrival_year
  const m = row.main?.arrival_month
  const d = row.main?.arrival_day
  if (!y || !m || !d) return null
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null
}

// ── Second look ───────────────────────────────────────────────────────────────

/**
 * What AppleSystem says about this IS number *right now*, across every quotation.
 *
 *   `cancelled`   — no quotation carrying this IS number is confirmed any more.
 *   `superseded`  — the cancelled quotation was replaced: another quotation with
 *                   the same IS number (or the same quotation, re-confirmed) is
 *                   at status 2. The tour is still on; nothing to cancel.
 *   `unknown`     — the lookup failed. Never act on a guess.
 */
export type UpstreamVerdict =
  | { kind: 'cancelled' }
  | { kind: 'superseded'; quotationNo: string }
  | { kind: 'unknown'; error: string }

/**
 * Re-ask AppleSystem before touching a booking.
 *
 * The sweep reads a *list*, and a list row is one quotation. An amendment in
 * AppleSystem is often done by cancelling the old quotation and confirming a new
 * one under the same IS number — on the list that looks exactly like a
 * cancellation, and acting on it would put a live tour in front of accounts for
 * cancelling. So before a request goes out, every quotation for the IS number is
 * fetched, and the request only proceeds when none of them is confirmed.
 *
 * Costs one scoped search per booking about to be acted on — a handful a day.
 */
export async function verifyUpstreamCancelled(
  isNumberRaw: string,
  ref: string,
): Promise<UpstreamVerdict> {
  try {
    const { items } = await searchBookings({ isNumber: isNumberRaw || ref })
    const same = items.filter((it) => refOf(it) === ref)
    const live = same.find((it) => String(it.status ?? '') === '2')
    if (live) return { kind: 'superseded', quotationNo: String(live.quotation_no ?? '').trim() || '—' }
    return { kind: 'cancelled' }
  } catch (err) {
    return { kind: 'unknown', error: err instanceof Error ? err.message : String(err) }
  }
}

// ── The request itself ────────────────────────────────────────────────────────

export interface RequestOutcome {
  ok: boolean
  /** Populated on success — what the booking was before the request. */
  prevStatus?: BookingStatus
  /** Populated on refusal, in words fit to show on the page. */
  reason?: string
  emailFailed?: boolean
}

/**
 * Move one booking to PENDING_CANCELLATION on AppleSystem's word, and tell
 * accounts.
 *
 * Written to be the *same* transition the manual cancel route performs — same
 * fields, same StatusEvent, same approval email — so the accounts queue cannot
 * tell an automated request from a human one except by who asked, which is
 * exactly the distinction that should survive. Nothing here decides the
 * cancellation; it only puts the booking in front of the people who do.
 *
 * The eligibility check is re-run inside the transaction because the sweep's
 * snapshot is minutes old by the time it gets here and a person may have moved
 * the booking in between.
 */
async function applyCancellationRequest(
  booking: NonNullable<CancelCandidate>,
  row: { quotationNo: string; upstreamStatus: string },
  actor: { id: string; name: string; email: string },
  /** Which automation found it — "the daily cancellation check", a range check… */
  via = 'the live cancellation watch',
): Promise<RequestOutcome> {
  const now = new Date()
  const reason =
    `AppleSystem cancelled quotation ${row.quotationNo || '—'} (status ${row.upstreamStatus}). ` +
    `Detected by ${via} on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. ` +
    `No money has been decided either way — accounts approval is required to close the file.`

  let prevStatus: BookingStatus

  try {
    prevStatus = await prisma.$transaction(async (tx) => {
      const fresh = await tx.booking.findUnique({
        where: { id: booking.id },
        select: { status: true, cancelRequestedAt: true },
      })
      if (!fresh) throw new Error('booking disappeared')
      if (CLOSED_HERE.includes(fresh.status) || fresh.cancelRequestedAt) {
        throw new Error(`no longer eligible (status ${fresh.status})`)
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: 'PENDING_CANCELLATION',
          cancelPrevStatus: fresh.status,
          cancelRequestedAt: now,
          // The decision fields stay empty: accounts fill them, not this.
          cancelledAt: null,
          cancelDecidedAt: null,
          cancelDecidedByName: null,
          cancelDecidedByEmail: null,
          cancelDecisionNote: null,
          cancelMailSentAt: null,
          cancelledById: actor.id,
          cancelledByName: AS_CANCEL_ACTOR,
          cancelledByEmail: '',
          cancellationReason: reason,
        },
      })

      await tx.statusEvent.create({
        data: {
          bookingId: booking.id,
          fromState: fresh.status,
          toState: 'PENDING_CANCELLATION',
          actorId: actor.id,
          note:
            `${reason} Requested by ${actor.name === AS_CANCEL_ACTOR ? via : actor.name}.`,
        },
      })

      return fresh.status
    })
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

  // A mail failure must not undo the request — the booking is already in the
  // accounts queue, which is where the page shows it either way.
  let emailFailed = false
  try {
    const approvers = await prisma.user.findMany({
      where: { role: 'AC_USER', isActive: true },
      select: { email: true },
    })
    const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
    await sendCancellationApprovalEmail(
      {
        bookingRef:       booking.bookingRef,
        isNumber:         booking.isNumber,
        agent:            booking.agent,
        agentBookingId:   booking.agentBookingId,
        fileHandler:      booking.fileHandler,
        leadPassenger:    booking.passengers[0]?.name ?? null,
        arrivalDate:      booking.arrivalDate,
        departureDate:    booking.departureDate,
        paxAdults:        booking.paxAdults,
        paxChildren:      booking.paxChildren,
        paxInfants:       booking.paxInfants,
        quotedTotal:      booking.quotedTotal ? booking.quotedTotal.toString() : null,
        currency:         booking.currency,
        operationCountry: booking.operationCountry,
        previousStatus:   prevStatus,
        cancelledByName:  AS_CANCEL_ACTOR,
        cancelledByEmail: '',
        reason,
        cancelledAt:      now,
      },
      approvers.map((a) => a.email),
      `${appUrl}/dashboard/accounts/cancellations`,
    )
  } catch (err) {
    emailFailed = true
    console.error(`[AsCancelWatch] approval email failed for ${booking.bookingRef}:`, err)
  }

  await logActivity({
    userId: actor.id,
    action: ACTION.STATUS_CHANGED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'as_watch_cancel_request',
      bookingRef: booking.bookingRef,
      quotationNo: row.quotationNo,
      upstreamStatus: row.upstreamStatus,
      previousStatus: prevStatus,
      requestedBy: actor.name,
    },
  }).catch(() => { /* the StatusEvent is the record of note; the log is a bonus */ })

  return { ok: true, prevStatus, emailFailed }
}

// ── Following what accounts decided ───────────────────────────────────────────

/**
 * Bring `requested` entries up to date with what accounts did about them.
 *
 * This is what closes the loop described at the top of the file: a rejected
 * request restores the booking and erases its cancellation trail, so the booking
 * row itself no longer remembers that anything was ever asked. The ledger does,
 * and reading the two together is the only way to tell "accounts said no" apart
 * from "nobody has asked yet" — which is the difference between leaving a
 * booking alone and pestering the accounts desk with it every fifteen minutes.
 */
async function refreshDecisions(list: CancelEntry[]): Promise<{ list: CancelEntry[]; changed: boolean }> {
  const open = list.filter((e) => e.state === 'requested' && e.bookingId)
  if (open.length === 0) return { list, changed: false }

  const rows = await prisma.booking.findMany({
    where: { id: { in: open.map((e) => e.bookingId as string) } },
    select: { id: true, status: true, cancelDecidedAt: true, cancelDecisionNote: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))

  let changed = false
  const next = list.map((e) => {
    if (e.state !== 'requested' || !e.bookingId) return e
    const row = byId.get(e.bookingId)
    if (!row || row.status === 'PENDING_CANCELLATION') return e

    changed = true
    const decidedAt = row.cancelDecidedAt?.toISOString() ?? new Date().toISOString()
    if (row.status === 'CANCELLED') {
      return { ...e, state: 'approved' as const, decidedAt, note: null }
    }
    return {
      ...e,
      state: 'declined' as const,
      decidedAt,
      note:
        `Accounts rejected the cancellation${row.cancelDecisionNote ? ` — ${row.cancelDecisionNote}` : ''}, ` +
        `and the booking is back at ${row.status.replace(/_/g, ' ')}. AppleSystem still shows it cancelled: ` +
        `settle it with AppleSystem, because this will not ask again.`,
    }
  })

  return { list: next, changed }
}

// ── The sweep ─────────────────────────────────────────────────────────────────

export interface CancelSweepSummary {
  /** Upstream rows in the window carrying a cancelled status. */
  upstream: number
  /** …of those, the ones this system actually holds a booking for. */
  matched: number
  /** Bookings moved to PENDING_CANCELLATION on this tick. */
  requested: number
  /** Detected, but left for a person — the switch is off, or a guard held it. */
  awaiting: number
  /** Nothing to do: already closed here, or never imported from AppleSystem. */
  skipped: number
  failed: number
  /** Refs requested on this tick, for the check log. */
  refs: string[]
  /** Cancelled upstream but replaced by a confirmed quotation — left alone. */
  superseded?: number
  /** Per-booking outcome, only when the caller asked for it (range checks). */
  details?: CancelSweepDetail[]
}

/** One line of a range check's report — what happened to one cancelled quotation. */
export interface CancelSweepDetail {
  ref: string | null
  quotationNo: string
  /** The upstream create / arrival date, as AppleSystem gave it. */
  createdOn: string | null
  arrivalDate: string | null
  outcome:
    | 'requested' | 'already-requested' | 'awaiting' | 'on-ground' | 'superseded'
    | 'closed-here' | 'not-imported' | 'not-in-system' | 'no-is-number'
    | 'decided' | 'unverified' | 'failed'
  note: string | null
}

/**
 * How a sweep may act.
 *
 *   `auto`    — obey the Live Watch switch (the original behaviour).
 *   `request` — send every eligible booking for accounts approval now
 *               (the daily check, and "Find & request" on a range).
 *   `detect`  — list only, change nothing (a range preview).
 */
export type CancelSweepAction = 'auto' | 'request' | 'detect'

export interface CancelSweepOptions {
  action?: CancelSweepAction
  /** Credited as "Sent by" on rows this sweep requests. */
  via?: string
  /** Build `summary.details` — only range checks want the per-row report. */
  collectDetails?: boolean
}

export function emptyCancelSummary(): CancelSweepSummary {
  return { upstream: 0, matched: 0, requested: 0, awaiting: 0, skipped: 0, failed: 0, refs: [] }
}

/**
 * Process the cancelled rows from one Live Watch sweep.
 *
 * Never throws: a failure here must not cost the tick its imports, which are the
 * watch's primary job. Anything unexpected is caught, recorded and retried on
 * the next sweep.
 */
export async function sweepCancellations(
  cancelledRows: ASBookingListItem[],
  actorId: string,
  opts: CancelSweepOptions = {},
): Promise<CancelSweepSummary> {
  const summary = emptyCancelSummary()
  summary.upstream = cancelledRows.length
  summary.superseded = 0
  if (opts.collectDetails) summary.details = []

  let ledger = await readLedger()
  const refreshed = await refreshDecisions(ledger)
  ledger = refreshed.list
  let dirty = refreshed.changed

  const mode: CancelSweepAction = opts.action ?? 'auto'
  const actionOn = mode === 'request' ? true : mode === 'detect' ? false : await getCancelActionEnabled()
  const via = opts.via ?? 'the automatic watch'
  const now = new Date()
  const nowIso = now.toISOString()

  /** One report line — a no-op unless the caller asked for details. */
  const report = (
    row: ASBookingListItem, ref: string | null,
    outcome: CancelSweepDetail['outcome'], note: string | null = null,
  ) => {
    summary.details?.push({
      ref,
      quotationNo: String(row.quotation_no ?? '').trim(),
      createdOn: upstreamCreatedOn(row),
      arrivalDate: upstreamArrival(row),
      outcome,
      note,
    })
  }

  // The same IS number can appear on several cancelled rows (old revisions of
  // one file). One decision per booking per sweep.
  const seen = new Set<string>()

  for (const row of cancelledRows) {
    const ref = refOf(row)
    // No IS number upstream means nothing was ever imported under one, so there
    // is no booking here to withdraw. This is the ordinary shape of a quotation
    // cancelled before it was ever confirmed.
    if (!ref) { report(row, null, 'no-is-number', 'Cancelled before it was ever given an IS number.'); continue }
    if (seen.has(ref)) continue
    seen.add(ref)

    const quotationNo = String(row.quotation_no ?? '').trim()
    const upstreamStatus = String(row.status ?? '?')
    const upstreamClass = row.status_class ? String(row.status_class) : null

    try {
      const booking = await loadBooking(ref)
      if (!booking) { report(row, ref, 'not-in-system', 'No booking with this IS number here.'); continue }
      summary.matched++

      const existing = ledger.find((e) => e.ref === ref)
      // Decided, one way or the other — nothing further is owed. A `declined`
      // entry in particular must never be re-raised: that is the whole point.
      if (existing && (existing.state === 'approved' || existing.state === 'declined')) {
        report(row, ref, 'decided', existing.state === 'approved'
          ? 'Accounts already approved this cancellation.'
          : 'Accounts declined this cancellation earlier — not raised again.')
        continue
      }

      const base: CancelEntry = {
        ref,
        bookingId: booking.id,
        quotationNo,
        country: booking.operationCountry ?? null,
        guestName: booking.passengers[0]?.name ?? null,
        arrivalDate: booking.arrivalDate ? booking.arrivalDate.toISOString().slice(0, 10) : null,
        upstreamStatus,
        upstreamClass,
        state: 'awaiting',
        note: null,
        prevStatus: existing?.prevStatus ?? booking.status,
        detectedAt: existing?.detectedAt ?? nowIso,
        requestedAt: existing?.requestedAt ?? null,
        actedBy: existing?.actedBy ?? null,
        decidedAt: null,
      }

      // Already sitting in the accounts queue — from this watch, from the
      // reconciler or from a person. Record where it got to and move on.
      if (booking.status === 'PENDING_CANCELLATION' || booking.cancelRequestedAt) {
        report(row, ref, 'already-requested', 'Already waiting for accounts approval.')
        if (existing?.state === 'requested') continue
        ledger = upsertEntry(ledger, {
          ...base,
          state: 'requested',
          requestedAt: base.requestedAt ?? nowIso,
          actedBy: base.actedBy ?? 'a cancellation already in progress here',
          note: null,
        })
        dirty = true
        continue
      }

      if (CLOSED_HERE.includes(booking.status) || !CANCELLABLE_STATES.includes(booking.status)) {
        summary.skipped++
        const note = `Already ${booking.status.replace(/_/g, ' ').toLowerCase()} here — nothing to ask for.`
        report(row, ref, 'closed-here', note)
        if (existing?.state === 'skipped') continue
        ledger = upsertEntry(ledger, { ...base, state: 'skipped', note })
        dirty = true
        continue
      }

      // Only a booking this system imported from AppleSystem can be withdrawn on
      // AppleSystem's say-so. A TC-email or OneDrive booking can share an IS
      // number with a quotation that was never the same commitment.
      if (!(await wasImportedFromAppleSystem(booking.id))) {
        summary.skipped++
        const note =
          'This booking was not imported from AppleSystem, so an upstream cancellation ' +
          'may not be about the same file. Left alone — check it by hand.'
        report(row, ref, 'not-imported', note)
        if (existing?.state === 'skipped') continue
        ledger = upsertEntry(ledger, { ...base, state: 'skipped', note })
        dirty = true
        continue
      }

      // A listed-only row that is already on the panel needs no second look
      // until somebody switches the action on — the lookup is not free.
      if (!actionOn && existing?.state === 'awaiting' && existing.note) {
        summary.awaiting++
        report(row, ref, 'awaiting', existing.note)
        continue
      }

      // Second look: is the file *really* off, or was the quotation replaced?
      const verdict = await verifyUpstreamCancelled(String(row.is_number ?? ''), ref)
      if (verdict.kind === 'superseded') {
        summary.superseded = (summary.superseded ?? 0) + 1
        summary.skipped++
        const note =
          `Quotation ${quotationNo || '—'} was cancelled, but AppleSystem still has ${ref} confirmed ` +
          `under quotation ${verdict.quotationNo} — an amendment, not a cancellation. Left alone.`
        report(row, ref, 'superseded', note)
        if (existing?.state !== 'skipped' || existing.note !== note) {
          ledger = upsertEntry(ledger, { ...base, state: 'skipped', note })
          dirty = true
        }
        continue
      }
      if (verdict.kind === 'unknown') {
        summary.awaiting++
        const note =
          `Could not double-check with AppleSystem (${verdict.error}). Nothing was changed — ` +
          'it is checked again on the next run, or send it by hand.'
        report(row, ref, 'unverified', note)
        ledger = upsertEntry(ledger, { ...base, state: 'awaiting', note })
        dirty = true
        continue
      }

      // A tour that has already started is not an automation's to suspend.
      // PENDING_CANCELLATION locks the file and stops the guest messaging, which
      // is the last thing a running tour needs. It is raised loudly instead.
      const onGround = booking.arrivalDate ? booking.arrivalDate.getTime() <= now.getTime() : false
      if (onGround) {
        summary.awaiting++
        const note =
          'The tour has already started. Suspending a booking on the ground stops the guest ' +
          'messaging, so this one waits for a person — use the button, or handle it in AppleSystem.'
        report(row, ref, 'on-ground', note)
        if (existing?.state !== 'awaiting' || existing.note === null) {
          ledger = upsertEntry(ledger, { ...base, state: 'awaiting', note })
          dirty = true
          await raiseAsImportAlert({
            severity: 'warning',
            title: `${ref} was cancelled in AppleSystem but is already on the ground`,
            message:
              `AppleSystem shows quotation ${quotationNo || '—'} at status ${upstreamStatus}, but ${ref} ` +
              `arrived ${base.arrivalDate ?? '—'} and is ${booking.status}. Nothing has been changed here — ` +
              `decide and action it by hand from the Live Watch page.`,
            signature: `watch-cancel-onground::${ref}`,
            jobMode: 'auto',
          })
        }
        continue
      }

      if (!actionOn) {
        summary.awaiting++
        const note = mode === 'detect'
          ? 'Found by a range check (preview only) — confirmed cancelled in AppleSystem. ' +
            'Use the button on this row to send it for approval.'
          : 'Detected only — sending cancellations for accounts approval is switched off. ' +
            'Use the button on this row to send this one.'
        report(row, ref, 'awaiting', note)
        if (existing?.state === 'awaiting' && existing.note) continue
        ledger = upsertEntry(ledger, { ...base, state: 'awaiting', note })
        dirty = true
        continue
      }

      const outcome = await applyCancellationRequest(
        booking,
        { quotationNo, upstreamStatus },
        { id: actorId, name: AS_CANCEL_ACTOR, email: '' },
        via,
      )

      if (outcome.ok) {
        summary.requested++
        summary.refs.push(ref)
        const note = outcome.emailFailed
          ? 'Sent for accounts approval, but the notification email could not be delivered.'
          : null
        report(row, ref, 'requested', note ?? `Requested to cancel — was ${String(outcome.prevStatus ?? '').replace(/_/g, ' ').toLowerCase()}.`)
        ledger = upsertEntry(ledger, {
          ...base,
          state: 'requested',
          prevStatus: outcome.prevStatus ?? base.prevStatus,
          requestedAt: nowIso,
          actedBy: via,
          note,
        })
      } else {
        summary.failed++
        const note = `Could not send for approval: ${outcome.reason ?? 'unknown error'}. It retries next sweep.`
        report(row, ref, 'failed', note)
        ledger = upsertEntry(ledger, { ...base, state: 'failed', note })
      }
      dirty = true
    } catch (err) {
      summary.failed++
      const msg = err instanceof Error ? err.message : String(err)
      report(row, ref, 'failed', msg)
      console.error(`[AsCancelWatch] ${ref} failed:`, msg)
    }
  }

  if (dirty) await writeLedger(ledger).catch((err) => {
    console.error('[AsCancelWatch] could not write ledger:', err instanceof Error ? err.message : err)
  })

  if (summary.requested > 0) {
    await raiseAsImportAlert({
      severity: 'warning',
      title: `${summary.requested} booking${summary.requested === 1 ? '' : 's'} cancelled in AppleSystem — accounts approval needed`,
      message:
        `${summary.refs.join(', ')} ${summary.refs.length === 1 ? 'was' : 'were'} cancelled upstream and ` +
        `${summary.refs.length === 1 ? 'is' : 'are'} now waiting for accounts approval to close. ` +
        `Nothing has been cancelled yet — approve or reject each one in Accounts → Cancellations.`,
      signature: `watch-cancel-requested::${[...summary.refs].sort().join(',')}`,
      jobMode: 'auto',
    }).catch(() => { /* the ledger and the accounts queue are the record of note */ })
  }

  return summary
}

// ── The per-row button ────────────────────────────────────────────────────────

/**
 * Send one detected cancellation for approval, on a person's say-so.
 *
 * This is how the backlog is adopted while the automatic action stays off, and
 * how an on-ground booking is actioned once somebody has looked at it — so it
 * deliberately does *not* re-apply the on-ground guard. It still refuses on the
 * guards that are about correctness rather than caution: the booking must exist,
 * must be open, and must be one this system imported from AppleSystem.
 */
export async function requestCancellationByHand(
  ref: string,
  actor: { id: string; name: string; email: string },
): Promise<{ ok: boolean; error?: string }> {
  const ledger = await readLedger()
  const entry = ledger.find((e) => e.ref === ref)
  if (!entry) return { ok: false, error: 'That booking is not in the cancellation list' }
  if (entry.state === 'requested') return { ok: false, error: 'Already waiting for accounts approval' }
  if (entry.state === 'approved')  return { ok: false, error: 'Accounts already cancelled this booking' }

  const booking = await loadBooking(ref)
  if (!booking) return { ok: false, error: 'Booking not found' }
  if (CLOSED_HERE.includes(booking.status) || booking.cancelRequestedAt) {
    return { ok: false, error: `Booking is ${booking.status.replace(/_/g, ' ').toLowerCase()} — nothing to ask for` }
  }
  if (!CANCELLABLE_STATES.includes(booking.status)) {
    return { ok: false, error: `Cannot cancel a booking in ${booking.status}` }
  }
  if (!(await wasImportedFromAppleSystem(booking.id))) {
    return { ok: false, error: 'This booking did not come from AppleSystem — cancel it by hand from the booking page' }
  }

  // Same second look as the sweep. A person pressing the button is trusted on
  // timing, not on facts the system can check — and an amendment that replaced
  // the quotation is exactly the fact a person cannot see from this row.
  // A failed lookup does not block them: they asked, and accounts still decide.
  const verdict = await verifyUpstreamCancelled(booking.isNumber ?? ref, ref)
  if (verdict.kind === 'superseded') {
    return {
      ok: false,
      error: `AppleSystem still has ${ref} confirmed under quotation ${verdict.quotationNo} — ` +
        'this looks like an amendment, not a cancellation. Nothing was changed.',
    }
  }

  const outcome = await applyCancellationRequest(
    booking,
    { quotationNo: entry.quotationNo, upstreamStatus: entry.upstreamStatus },
    actor,
    'a manual check on the Live Watch page',
  )
  if (!outcome.ok) return { ok: false, error: outcome.reason ?? 'Could not send for approval' }

  await writeLedger(upsertEntry(ledger, {
    ...entry,
    state: 'requested',
    prevStatus: outcome.prevStatus ?? entry.prevStatus,
    requestedAt: new Date().toISOString(),
    actedBy: actor.name,
    decidedAt: null,
    note: outcome.emailFailed
      ? 'Sent for accounts approval, but the notification email could not be delivered.'
      : null,
  })).catch(() => { /* the booking is already in the queue; the ledger catches up next sweep */ })

  return { ok: true }
}

/** Drop a decided or skipped row from the panel. Never touches the booking. */
export async function dismissCancelEntry(ref: string): Promise<boolean> {
  const ledger = await readLedger()
  const next = ledger.filter((e) => e.ref !== ref)
  if (next.length === ledger.length) return false
  await writeLedger(next)
  return true
}
