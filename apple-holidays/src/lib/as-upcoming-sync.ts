/**
 * **Upcoming Arrivals update check** — every day, find every upcoming booking
 * whose AppleSystem quotation was amended, and bring it up to date.
 *
 * The other jobs leave a gap: the importers never touch a booking that already
 * exists, the parity reconciler only re-reads quotations *created* in the last
 * couple of days, and the pre-arrival sync looks at one arrival date. An agent
 * who amends a file three weeks after confirming it was invisible to all of
 * them. This job closes that gap for the whole forward book.
 *
 * ── How it stays cheap (≈1 list call per fortnight of arrivals) ──────────────
 *   1. List AppleSystem's confirmed quotations by **arrival date**, for the whole
 *      window (tomorrow → +N days), in two-week slices. One paged list call per
 *      slice — no per-booking calls.
 *   2. Give every row a **fingerprint** (status · raw `updated_at` · the three
 *      amendment counters — the same signal the parity reconciler trusts) and
 *      compare it with the one stored on the previous run.
 *   3. Only rows whose fingerprint moved get the expensive per-quotation fetch.
 *      A quiet day costs a handful of list calls and some indexed local reads.
 *
 * ── How it keeps live data safe ───────────────────────────────────────────────
 *   • It writes only through {@link syncBookingFromAs}, the same path as the
 *     manual "Fetch Data from API" button. That path never writes status,
 *     tickets, drivers, agenda, P&L, payments, the checklist or the timeline;
 *     never blanks a field AppleSystem sent empty; refuses an empty itinerary
 *     or hotel list; refuses B2C store orders and a quote for another booking.
 *   • **Preview first, then apply exactly that preview.** Each booking is
 *     dry-run, checked, then applied with a selection pinned to the preview's
 *     fingerprint — if AppleSystem moves in between, nothing is written.
 *   • **Hand-edited text is never overwritten.** Those fields are parked for
 *     Replace / Skip on the booking page; the job never answers for a person.
 *   • **Large changes are held, not applied** — an arrival moved a long way or
 *     into the past, a different agency, pax halved, most of the itinerary or
 *     hotels gone, a total that moved by half. They wait in "Needs review".
 *   • **Circuit breaker.** If an unusually large share of the book changes
 *     upstream in one day, that smells like an upstream fault rather than real
 *     amendments: nothing is applied that run, everything is held for review.
 *   • **Never cancels, never creates.** A booking AppleSystem no longer shows as
 *     confirmed is reported, nothing more — cancellation stays with the
 *     Cancellations desk. Missing bookings stay with the importers.
 *   • Only future arrivals (tomorrow onwards), never cancelled/completed files,
 *     never B2C. A per-run cap bounds the upstream load; the rest carry over.
 *   • Every applied change is logged by day with its **before** value
 *     (`as-update-log.ts`) and in the booking's activity log.
 *   • A master switch turns it off; a second switch keeps detection running but
 *     stops it applying (everything lands in "Needs review").
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Settings, lock, run log and one fingerprint row per booking live in
 * `system_settings` (KV). **No schema change, no migration.**
 */

import { prisma } from '@/lib/prisma'
import { bookingSourceWhere } from '@/lib/booking-source'
import { listBookings, withAsRetryBudget, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { findQuoteRow } from '@/lib/as-quote-lookup'
import { getAutomationUserId } from '@/lib/as-booking-import'
import {
  syncBookingFromAs,
  getSyncStates,
  AsSyncError,
  AsSyncStaleError,
  type AsSyncResult,
  type SyncSection,
} from '@/lib/as-booking-sync'
import {
  setPendingUpdate,
  clearPendingUpdate,
  getPendingUpdates,
  pruneUpdateLog,
  dateInTz,
  shiftDay,
  TZ,
  type PendingUpdate,
  type UpdateFieldRecord,
} from '@/lib/as-update-log'

export { TZ }

// ── Settings / state keys ────────────────────────────────────────────────────
export const UPSYNC_ENABLED    = 'as_upsync_enabled'
export const UPSYNC_AUTO_APPLY = 'as_upsync_auto_apply'
export const UPSYNC_HOUR       = 'as_upsync_hour'
export const UPSYNC_MINUTE     = 'as_upsync_minute'
export const UPSYNC_HORIZON    = 'as_upsync_horizon_days'
export const UPSYNC_MAX        = 'as_upsync_max_per_run'
export const UPSYNC_LAST_RUN   = 'as_upsync_last_run_date'
const        UPSYNC_LOCK       = 'as_upsync_lock'
const        UPSYNC_LOG        = 'as_upsync_log'
/** One row per booking: the AppleSystem row fingerprint last seen. */
export const PRINT_PREFIX      = 'as_upd_print:'

export const MIN_HORIZON = 7
export const MAX_HORIZON = 365
export const MIN_PER_RUN = 10
export const MAX_PER_RUN = 400

const DEFAULT_HOUR    = 4
const DEFAULT_MINUTE  = 30
const DEFAULT_HORIZON = 180
const DEFAULT_PER_RUN = 150

/** Arrival window is listed upstream in slices this wide, to keep each call small. */
const SLICE_DAYS = 14
/** Local bookings missing from the arrival list are looked up one by one, at most this many. */
const MAX_UNSEEN_LOOKUPS = 60
/** Pause between per-booking upstream calls so a run cannot burst the API. */
const THROTTLE_MS = 400
/** A run still marked active after this long is treated as dead. */
const STALE_LOCK_MS = 90 * 60 * 1000
/** Escalating-retry budget for upstream calls inside one run. */
const RETRY_BUDGET_MS = 6 * 60 * 1000
/** Safety ceiling on how many local bookings one run considers. */
const MAX_LOCAL = 6_000

/** Circuit breaker: hold everything when this share of known bookings changes at once… */
const BREAKER_SHARE = 0.4
/** …and at least this many did (small books change a lot in relative terms). */
const BREAKER_MIN = 60

/** Large-change thresholds (any one holds the booking for review). */
const HOLD_ARRIVAL_SHIFT_DAYS = 21
const HOLD_PAX_SHARE = 0.5
const HOLD_ROWS_SHARE = 0.5
const HOLD_TOTAL_SHARE = 0.5

/** Run log size and its serialized byte budget (`value` is MySQL TEXT). */
const MAX_LOG_ENTRIES = 30
const MAX_LOG_BYTES = 40_000
const MAX_DETAIL_ROWS = 60

const ACTOR_NAME = 'Automatic (upcoming check)'

// ── Settings ─────────────────────────────────────────────────────────────────

export interface UpSyncSettings {
  /** Master switch. Ships ON. */
  enabled: boolean
  /** Apply found updates automatically. Off = detect and list them for review. Ships ON. */
  autoApply: boolean
  hour: number
  minute: number
  /** How far ahead (days from tomorrow) arrivals are checked. */
  horizonDays: number
  /** Per-booking AppleSystem fetches allowed in one run; the rest carry over. */
  maxPerRun: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

function intOr(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

async function putSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function getUpSyncSettings(): Promise<UpSyncSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [UPSYNC_ENABLED, UPSYNC_AUTO_APPLY, UPSYNC_HOUR, UPSYNC_MINUTE, UPSYNC_HORIZON, UPSYNC_MAX] } },
  })
  const map: Record<string, string> = {}
  rows.forEach((r) => { map[r.key] = r.value })
  return {
    enabled:     map[UPSYNC_ENABLED] !== 'false',
    autoApply:   map[UPSYNC_AUTO_APPLY] !== 'false',
    hour:        intOr(map[UPSYNC_HOUR], DEFAULT_HOUR, 0, 23),
    minute:      intOr(map[UPSYNC_MINUTE], DEFAULT_MINUTE, 0, 59),
    horizonDays: intOr(map[UPSYNC_HORIZON], DEFAULT_HORIZON, MIN_HORIZON, MAX_HORIZON),
    maxPerRun:   intOr(map[UPSYNC_MAX], DEFAULT_PER_RUN, MIN_PER_RUN, MAX_PER_RUN),
  }
}

export async function saveUpSyncSettings(next: UpSyncSettings): Promise<UpSyncSettings> {
  const clean: UpSyncSettings = {
    enabled:     !!next.enabled,
    autoApply:   !!next.autoApply,
    hour:        clamp(Number(next.hour), 0, 23),
    minute:      clamp(Number(next.minute), 0, 59),
    horizonDays: clamp(Number(next.horizonDays), MIN_HORIZON, MAX_HORIZON),
    maxPerRun:   clamp(Number(next.maxPerRun), MIN_PER_RUN, MAX_PER_RUN),
  }
  await Promise.all([
    putSetting(UPSYNC_ENABLED,    String(clean.enabled)),
    putSetting(UPSYNC_AUTO_APPLY, String(clean.autoApply)),
    putSetting(UPSYNC_HOUR,       String(clean.hour)),
    putSetting(UPSYNC_MINUTE,     String(clean.minute)),
    putSetting(UPSYNC_HORIZON,    String(clean.horizonDays)),
    putSetting(UPSYNC_MAX,        String(clean.maxPerRun)),
  ])
  return clean
}

// ── Time helpers ─────────────────────────────────────────────────────────────

export function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  return {
    hour:   Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
  }
}

/** The arrival window a run covers: tomorrow → tomorrow + horizon − 1 (inclusive). */
export function arrivalWindow(horizonDays: number): { from: string; to: string } {
  const from = shiftDay(dateInTz(), 1)
  return { from, to: shiftDay(from, horizonDays - 1) }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

// ── Upstream row helpers ─────────────────────────────────────────────────────

function refOf(row: ASBookingListItem): string | null {
  const raw = normalizeIsNumber(String(row.is_number ?? ''))
  return !raw || raw === 'NA' ? null : raw
}

function rawUpdatedAt(row: ASBookingListItem): string {
  return typeof row.updated_at === 'string' ? row.updated_at : row.updated_at?.date ?? ''
}

/**
 * Change-detecting signature of one upstream row — the same ingredients the
 * parity reconciler uses. Raw strings, never parsed instants, so the answer
 * cannot depend on a server's timezone.
 */
export function fingerprintOf(row: ASBookingListItem): string {
  return [
    String(row.status ?? ''),
    rawUpdatedAt(row),
    row.quotation_update_count_R ?? 0,
    row.quotation_update_count_C ?? 0,
    row.quotation_update_count_X ?? 0,
  ].join('|')
}

function isConfirmed(row: ASBookingListItem): boolean {
  return String(row.status ?? '').trim() === '2'
}

// ── Fingerprint rows ─────────────────────────────────────────────────────────

async function readPrints(refs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < refs.length; i += 500) {
    const chunk = refs.slice(i, i + 500)
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: chunk.map((r) => `${PRINT_PREFIX}${r}`) } },
      select: { key: true, value: true },
    })
    for (const r of rows) out.set(r.key.slice(PRINT_PREFIX.length), r.value)
  }
  return out
}

async function writePrint(ref: string, print: string): Promise<void> {
  await putSetting(`${PRINT_PREFIX}${ref}`, print)
}

// ── Run log ──────────────────────────────────────────────────────────────────

export type UpSyncDetailStatus =
  | 'updated'        // applied
  | 'available'      // found, auto-apply off → Needs review
  | 'held'           // found, large change or breaker → Needs review
  | 'review'         // applied, but a hand-edited field waits for Replace / Skip
  | 'not-confirmed'  // AppleSystem no longer shows it as confirmed — reported only
  | 'not-found'      // no AppleSystem quotation could be found for it
  | 'failed'

export interface UpSyncDetail {
  bookingRef: string
  arrivalDate: string
  status: UpSyncDetailStatus
  changed?: string[]
  notes?: string[]
  error?: string
}

export interface UpSyncRun {
  at: string
  mode: 'auto' | 'manual'
  window: { from: string; to: string }
  autoApply: boolean
  /** Live upcoming bookings in the window. */
  bookings: number
  /** Confirmed quotations AppleSystem listed for the window. */
  upstreamRows: number
  /** Bookings whose AppleSystem row moved since the last run. */
  changedUpstream: number
  /** Booking fetches made this run (the expensive calls). */
  checked: number
  updated: number
  current: number
  available: number
  held: number
  review: number
  notConfirmed: number
  notFound: number
  failed: number
  /** First-time bookings recorded as a baseline without a fetch. */
  baselined: number
  /** Checks left for the next run because of the per-run cap. */
  carriedOver: number
  breaker: boolean
  aborted?: string
  durationMs: number
  details: UpSyncDetail[]
}

export async function getUpSyncLog(): Promise<UpSyncRun[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: UPSYNC_LOG } })
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as UpSyncRun[]) : []
  } catch {
    return []
  }
}

async function appendLog(run: UpSyncRun): Promise<void> {
  const existing = await getUpSyncLog()
  let next = [run, ...existing].slice(0, MAX_LOG_ENTRIES)
  while (next.length > 1 && JSON.stringify(next).length > MAX_LOG_BYTES) next = next.slice(0, -1)
  if (JSON.stringify(next).length > MAX_LOG_BYTES) next = [{ ...run, details: run.details.slice(0, 10) }]
  await putSetting(UPSYNC_LOG, JSON.stringify(next))
}

// ── Lock ─────────────────────────────────────────────────────────────────────

async function acquireLock(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: UPSYNC_LOCK } })
  if (row?.value) {
    const startedAt = Date.parse(row.value)
    if (Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS) return false
  }
  await putSetting(UPSYNC_LOCK, new Date().toISOString())
  return true
}

async function releaseLock(): Promise<void> {
  await putSetting(UPSYNC_LOCK, '')
}

async function isRunning(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: UPSYNC_LOCK } })
  const t = row?.value ? Date.parse(row.value) : NaN
  return Number.isFinite(t) && Date.now() - t < STALE_LOCK_MS
}

// ── Change review ────────────────────────────────────────────────────────────

/** Names of what a preview would change (scalars + replaced/seeded sections). */
function changedNames(p: AsSyncResult): string[] {
  return [
    ...p.fields.map((f) => f.field),
    ...p.sections.filter((s) => !s.skipped).map((s) => s.section),
  ]
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

/**
 * Is this change too big to apply with nobody watching? Returns plain-language
 * reasons; an empty list means it is an ordinary amendment.
 */
export function largeChangeNotes(p: AsSyncResult, today: string): string[] {
  const notes: string[] = []
  const field = (name: string) => p.fields.find((f) => f.field === name)

  const arr = field('arrivalDate')
  if (arr?.from && arr.to) {
    const shift = Math.abs(daysBetween(arr.from, arr.to))
    if (shift > HOLD_ARRIVAL_SHIFT_DAYS) notes.push(`Arrival moves ${shift} days (${arr.from} → ${arr.to})`)
    if (arr.to <= today) notes.push(`Arrival would move to ${arr.to}, which is today or in the past`)
  }

  const agent = field('agent')
  if (agent?.from && agent.to) notes.push(`Agent changes from “${agent.from}” to “${agent.to}”`)

  const adults = field('paxAdults')
  if (adults?.from && adults.to) {
    const a = Number(adults.from), b = Number(adults.to)
    if (a > 0 && Math.abs(a - b) / a >= HOLD_PAX_SHARE) notes.push(`Adults change ${a} → ${b}`)
  }

  const total = field('quotedTotal')
  if (total?.from && total.to) {
    const a = Number(total.from), b = Number(total.to)
    if (a > 0 && Math.abs(a - b) / a >= HOLD_TOTAL_SHARE) notes.push(`Quoted total moves ${pct(Math.abs(a - b) / a)} (${a} → ${b})`)
  }

  for (const s of p.sections) {
    if (s.skipped) continue
    if (s.section === 'itinerary' && s.previousCount >= 4 && s.newCount < s.previousCount * HOLD_ROWS_SHARE) {
      notes.push(`Itinerary shrinks from ${s.previousCount} to ${s.newCount} rows`)
    }
    if (s.section === 'accommodations' && s.previousCount >= 2 && s.newCount < s.previousCount * HOLD_ROWS_SHARE) {
      notes.push(`Hotels shrink from ${s.previousCount} to ${s.newCount} rows`)
    }
  }
  return notes
}

// ── The run ──────────────────────────────────────────────────────────────────

interface LocalBooking {
  bookingRef: string
  isNumber: string | null
  arrival: string
  createdDate: string
}

interface Candidate {
  local: LocalBooking
  row: ASBookingListItem
  why: 'changed' | 'pending' | 'new'
}

export interface RunUpSyncOptions {
  mode: 'auto' | 'manual'
  /** Manual runs only: check at most this many bookings this time. */
  maxPerRun?: number
}

/**
 * Check every upcoming booking against AppleSystem and apply what changed.
 * Sequential and throttled; one booking failing never stops the rest.
 * Returns null when another run already holds the lock.
 */
export async function runUpcomingSync(opts: RunUpSyncOptions): Promise<UpSyncRun | null> {
  if (!(await acquireLock())) {
    console.log('[UpcomingSync] skipped — another run is in progress')
    return null
  }

  const startedAt = Date.now()
  const settings = await getUpSyncSettings()
  const cap = opts.maxPerRun != null ? clamp(opts.maxPerRun, MIN_PER_RUN, MAX_PER_RUN) : settings.maxPerRun
  const window = arrivalWindow(settings.horizonDays)
  const today = dateInTz()

  const run: UpSyncRun = {
    at: new Date().toISOString(),
    mode: opts.mode,
    window,
    autoApply: settings.autoApply,
    bookings: 0, upstreamRows: 0, changedUpstream: 0, checked: 0,
    updated: 0, current: 0, available: 0, held: 0, review: 0,
    notConfirmed: 0, notFound: 0, failed: 0, baselined: 0, carriedOver: 0,
    breaker: false,
    durationMs: 0,
    details: [],
  }
  const detail = (d: UpSyncDetail) => { if (run.details.length < MAX_DETAIL_ROWS * 3) run.details.push(d) }

  try {
    await withAsRetryBudget(RETRY_BUDGET_MS, async () => {
      // 1. Local upcoming bookings (B2B, live, arriving tomorrow onwards).
      const fromD = new Date(`${window.from}T00:00:00.000Z`)
      const toD = new Date(`${shiftDay(window.to, 1)}T00:00:00.000Z`)
      const rows = await prisma.booking.findMany({
        where: {
          AND: [
            { arrivalDate: { gte: fromD, lt: toD } },
            { status: { notIn: ['CANCELLED', 'COMPLETED'] } },
            bookingSourceWhere('B2B') ?? {},
          ],
        },
        select: { bookingRef: true, isNumber: true, arrivalDate: true, createdAt: true },
        orderBy: { arrivalDate: 'asc' },
        take: MAX_LOCAL,
      })
      const locals: LocalBooking[] = rows.map((b) => ({
        bookingRef: b.bookingRef,
        isNumber: b.isNumber,
        arrival: b.arrivalDate.toISOString().slice(0, 10),
        createdDate: dateInTz(b.createdAt),
      }))
      run.bookings = locals.length
      if (locals.length === 0) return

      // 2. AppleSystem's confirmed quotations for the same window, in slices.
      //    A failed slice aborts the whole run before anything is written: a
      //    partial upstream view must never be mistaken for the real one.
      const upstream = new Map<string, ASBookingListItem>()
      for (let start = window.from; start <= window.to; start = shiftDay(start, SLICE_DAYS)) {
        const end = shiftDay(start, SLICE_DAYS - 1) < window.to ? shiftDay(start, SLICE_DAYS - 1) : window.to
        const { items } = await listBookings({ fromArrivalDate: start, toArrivalDate: end, statuses: ['2'] })
        run.upstreamRows += items.length
        for (const it of items) {
          const ref = refOf(it)
          if (!ref) continue
          const prev = upstream.get(ref)
          if (!prev || Number(it.id) > Number(prev.id)) upstream.set(ref, it)   // latest revision wins
        }
      }

      // 3. Bookings the arrival list did not return (date moved out of the
      //    window, or no longer confirmed upstream): look a bounded number up.
      const lookups = new Map<string, ASBookingListItem>()
      const unseen = locals.filter((l) =>
        !upstream.has(l.bookingRef) && !(l.isNumber && upstream.has(normalizeIsNumber(l.isNumber))))
      for (const l of unseen.slice(0, MAX_UNSEEN_LOOKUPS)) {
        try {
          const row = await findQuoteRow(l.isNumber || l.bookingRef)
          if (!row) {
            run.notFound++
            detail({ bookingRef: l.bookingRef, arrivalDate: l.arrival, status: 'not-found' })
          } else if (!isConfirmed(row)) {
            run.notConfirmed++
            detail({
              bookingRef: l.bookingRef, arrivalDate: l.arrival, status: 'not-confirmed',
              notes: [`AppleSystem status is now “${row.status_class || row.status}” — not changed here; see Cancellations`],
            })
          } else {
            lookups.set(l.bookingRef, row)
          }
        } catch (err) {
          run.failed++
          detail({ bookingRef: l.bookingRef, arrivalDate: l.arrival, status: 'failed', error: (err instanceof Error ? err.message : 'Lookup failed').slice(0, 200) })
        }
        if (THROTTLE_MS > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
      }

      const rowFor = (l: LocalBooking): ASBookingListItem | undefined =>
        upstream.get(l.bookingRef) ??
        (l.isNumber ? upstream.get(normalizeIsNumber(l.isNumber)) : undefined) ??
        lookups.get(l.bookingRef)

      // 4. Classify against the stored fingerprints.
      const refs = locals.map((l) => l.bookingRef)
      const [prints, syncStates, pending] = await Promise.all([
        readPrints(refs),
        getSyncStates(refs),
        getPendingUpdates(refs),
      ])

      const changed: Candidate[] = []
      const pend: Candidate[] = []
      const fresh: Candidate[] = []
      const baselines: { ref: string; print: string }[] = []
      let known = 0

      for (const l of locals) {
        const row = rowFor(l)
        if (!row) continue
        const fp = fingerprintOf(row)
        const stored = prints.get(l.bookingRef)
        if (stored) known++

        if (pending.has(l.bookingRef)) { pend.push({ local: l, row, why: 'pending' }); continue }
        if (stored === fp) { run.current++; continue }
        if (stored) { changed.push({ local: l, row, why: 'changed' }); continue }

        // First sighting. If AppleSystem's last edit is clearly older than our
        // own copy (imported or last synced later), it cannot hold an amendment
        // we are missing — record a baseline and move on. A one-day margin
        // absorbs any timezone difference in the bare upstream timestamp.
        const upd = rawUpdatedAt(row).slice(0, 10)
        const lastSync = syncStates[l.bookingRef]?.at ? dateInTz(new Date(syncStates[l.bookingRef].at)) : ''
        const ours = lastSync > l.createdDate ? lastSync : l.createdDate
        if (/^\d{4}-\d{2}-\d{2}$/.test(upd) && upd < shiftDay(ours, -1)) {
          baselines.push({ ref: l.bookingRef, print: fp })
        } else {
          fresh.push({ local: l, row, why: 'new' })
        }
      }
      run.changedUpstream = changed.length

      for (const b of baselines) await writePrint(b.ref, b.print)
      run.baselined = baselines.length

      // 5. Circuit breaker — a mass change upstream is held, never applied.
      run.breaker = known >= BREAKER_MIN && changed.length >= BREAKER_MIN && changed.length > known * BREAKER_SHARE
      if (run.breaker) {
        console.warn(`[UpcomingSync] circuit breaker — ${changed.length} of ${known} known bookings changed upstream at once; holding all for review`)
      }

      // 6. Nearest arrivals first inside each group; changed → pending → new.
      const byArrival = (a: Candidate, b: Candidate) => a.local.arrival.localeCompare(b.local.arrival)
      const queue = [...changed.sort(byArrival), ...pend.sort(byArrival), ...fresh.sort(byArrival)]
      const work = queue.slice(0, cap)
      run.carriedOver = queue.length - work.length

      let actorId: string | null = null
      try { actorId = await getAutomationUserId() } catch { /* logging only */ }

      for (const c of work) {
        await checkOne(c, { run, detail, settings, today, actorId })
        if (THROTTLE_MS > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
      }
    })
  } catch (err) {
    run.aborted = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    console.error('[UpcomingSync] run aborted:', run.aborted)
  } finally {
    run.durationMs = Date.now() - startedAt
    // Problems first, so the log keeps what someone needs to look at.
    const rank: Record<UpSyncDetailStatus, number> = {
      failed: 0, held: 1, 'not-confirmed': 2, review: 3, available: 4, 'not-found': 5, updated: 6,
    }
    run.details = run.details.sort((a, b) => rank[a.status] - rank[b.status]).slice(0, MAX_DETAIL_ROWS)
    await appendLog(run).catch((e) => console.error('[UpcomingSync] log write failed:', e))
    await pruneUpdateLog().catch(() => 0)
    await releaseLock().catch(() => {})
    console.log(
      `[UpcomingSync] ${opts.mode} run ${window.from}→${window.to}: ${run.updated} updated, ` +
      `${run.available + run.held} held for review, ${run.current} current, ${run.failed} failed, ` +
      `${run.carriedOver} carried over${run.breaker ? ' [BREAKER]' : ''}${run.aborted ? ` [ABORTED: ${run.aborted}]` : ''}`,
    )
  }
  return run
}

async function checkOne(
  c: Candidate,
  ctx: {
    run: UpSyncRun
    detail: (d: UpSyncDetail) => void
    settings: UpSyncSettings
    today: string
    actorId: string | null
  },
): Promise<void> {
  const { run, detail, settings, today, actorId } = ctx
  const ref = c.local.bookingRef
  const fp = fingerprintOf(c.row)
  run.checked++

  try {
    // Dry run — nothing is written.
    const preview = await syncBookingFromAs(ref, { actorId, actorName: ACTOR_NAME, mode: 'upcoming', preview: true })

    if (preview.unchanged) {
      await writePrint(ref, fp)
      await clearPendingUpdate(ref)
      run.current++
      return
    }

    const names = changedNames(preview)
    const fields: UpdateFieldRecord[] = preview.fields.map((f) => ({ field: f.field, from: f.from, to: f.to }))
    const notes = largeChangeNotes(preview, today)

    // Hold instead of apply: switched off, breaker tripped, or too big.
    const hold: PendingUpdate['reason'] | null =
      run.breaker ? 'breaker'
        : notes.length > 0 ? 'large-change'
        : !settings.autoApply ? 'auto-apply-off'
        : null

    if (hold && names.length > 0) {
      // The fingerprint is NOT advanced, so it is looked at again next run and
      // the marker stays truthful until a person applies or the upstream settles.
      await setPendingUpdate({ bookingRef: ref, at: new Date().toISOString(), reason: hold, notes, changed: names, fields })
      if (hold === 'auto-apply-off') run.available++
      else run.held++
      detail({ bookingRef: ref, arrivalDate: c.local.arrival, status: hold === 'auto-apply-off' ? 'available' : 'held', changed: names, notes })
      return
    }

    // Apply exactly what was previewed — every changed field and section, and
    // never a hand-edited one (those are parked for Replace / Skip).
    const sections: SyncSection[] = preview.sections.filter((s) => !s.skipped).map((s) => s.section)
    const result = await syncBookingFromAs(ref, {
      actorId,
      actorName: ACTOR_NAME,
      mode: 'upcoming',
      selection: {
        fields: preview.fields.map((f) => f.field),
        sections,
        conflicts: [],
        keptConflicts: [],
        fingerprint: preview.fingerprint,
      },
    })
    await writePrint(ref, fp)

    if (result.conflicts.length > 0) {
      run.review++
      detail({
        bookingRef: ref, arrivalDate: c.local.arrival, status: 'review',
        changed: changedNames(result),
        notes: [`Hand-edited ${result.conflicts.map((x) => x.field).join(', ')} kept — Replace / Skip on the booking page`],
      })
    }
    if (names.length > 0) {
      run.updated++
      if (result.conflicts.length === 0) {
        detail({ bookingRef: ref, arrivalDate: c.local.arrival, status: 'updated', changed: changedNames(result) })
      }
    }
  } catch (err) {
    if (err instanceof AsSyncStaleError) {
      // AppleSystem moved between preview and apply — nothing was written.
      run.failed++
      detail({ bookingRef: ref, arrivalDate: c.local.arrival, status: 'failed', error: 'Changed in AppleSystem during the check — retried next run' })
      return
    }
    if (err instanceof AsSyncError && err.status === 409) {
      // A refusal (B2C order, cancelled, quote for another booking). Record the
      // fingerprint so the same refusal is not re-fetched every day.
      await writePrint(ref, fp).catch(() => {})
      run.notFound++
      detail({ bookingRef: ref, arrivalDate: c.local.arrival, status: 'not-found', error: err.message.slice(0, 200) })
      return
    }
    run.failed++
    const msg = err instanceof Error ? err.message : 'Check failed'
    detail({ bookingRef: ref, arrivalDate: c.local.arrival, status: 'failed', error: msg.slice(0, 200) })
    console.error(`[UpcomingSync] ${ref}: ${msg}`)
  }
}

// ── Status for the settings UI ───────────────────────────────────────────────

export interface UpSyncStatus {
  settings: UpSyncSettings
  timezone: string
  window: { from: string; to: string }
  /** Live upcoming bookings the next run will cover. */
  coveredBookings: number
  /** Bookings already holding a baseline fingerprint. */
  tracked: number
  pendingCount: number
  lastRunDate: string | null
  running: boolean
  runs: UpSyncRun[]
}

export async function getUpSyncStatus(): Promise<UpSyncStatus> {
  const settings = await getUpSyncSettings()
  const window = arrivalWindow(settings.horizonDays)
  const fromD = new Date(`${window.from}T00:00:00.000Z`)
  const toD = new Date(`${shiftDay(window.to, 1)}T00:00:00.000Z`)

  const [coveredBookings, tracked, pendingCount, lastRunRow, running, runs] = await Promise.all([
    prisma.booking.count({
      where: {
        AND: [
          { arrivalDate: { gte: fromD, lt: toD } },
          { status: { notIn: ['CANCELLED', 'COMPLETED'] } },
          bookingSourceWhere('B2B') ?? {},
        ],
      },
    }),
    prisma.systemSetting.count({ where: { key: { startsWith: PRINT_PREFIX } } }),
    prisma.systemSetting.count({ where: { key: { startsWith: 'as_upd_pending:' } } }),
    prisma.systemSetting.findUnique({ where: { key: UPSYNC_LAST_RUN } }),
    isRunning(),
    getUpSyncLog(),
  ])

  return {
    settings,
    timezone: TZ,
    window,
    coveredBookings,
    tracked,
    pendingCount,
    lastRunDate: lastRunRow?.value || null,
    running,
    runs,
  }
}

// ── Once-a-day guard, shared by the in-process scheduler and the cron route ───

/**
 * Run today's check unless it already happened. Marks the day as done *before*
 * starting, so a restart mid-run cannot double-fire. Returns true when started.
 */
export async function fireUpSyncOnce(reason: string): Promise<boolean> {
  const settings = await getUpSyncSettings()
  if (!settings.enabled) {
    console.log(`[UpcomingSync] ${reason} — skipped (switched off)`)
    return false
  }
  const today = dateInTz()
  const last = await prisma.systemSetting.findUnique({ where: { key: UPSYNC_LAST_RUN } })
  if (last?.value === today) {
    console.log(`[UpcomingSync] ${reason} — skipped (already ran ${today})`)
    return false
  }
  await putSetting(UPSYNC_LAST_RUN, today)
  void runUpcomingSync({ mode: 'auto' }).catch((err) => {
    console.error('[UpcomingSync] background run error:', err instanceof Error ? err.message : err)
  })
  return true
}
