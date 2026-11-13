/**
 * Guest automation — what happens once a guest WhatsApp number is assigned.
 *
 *   1. Ask permission    WhatsApp call-permission request to the guest (unless
 *                        they already allow calls from us).
 *   2. Register          Put the booking on AI calls (Traveller-Experience
 *                        `intake`, the booking page Register button's defaults).
 *   3. Remind            Not allowed yet? Up to two reminders, 24 h apart — a
 *                        fresh permission request, or, when Meta's request limit
 *                        is hit, a WhatsApp template text pointing the guest at
 *                        the earlier request.
 *   4. Settle            Allowed → done. Two reminders and another 24 h with no
 *                        answer → "no response" (shown on the booking; staff can
 *                        restart it).
 *
 * Every step contacts a real customer, so each is guarded:
 *   · per-booking switches (guest-auto-switches.ts) — calls OFF stops all of it
 *   · global switch `auto_guest_engage_on_assign_enabled = false` stops starts
 *   · booking not cancelled, trip not over, number valid with a country code
 *   · an AI-call service someone cancelled or completed is never revived,
 *     except one cancelled *with its number removed* (the panel's "cancel to
 *     re-register with a new number" path)
 *   · one journey per booking+number; saving the same number twice does nothing
 *   · reminders capped per sweep
 */
import { prisma } from '@/lib/prisma'
import { normalizePhone, teGet, tePatch, tePost } from '@/lib/te/te-api'
import { markApproved, recordApprovalRequest } from '@/lib/te/call-approvals'
import { deliverToGuest } from '@/lib/customer-whatsapp-automation'
import { normalisePhone } from '@/lib/whatsapp'
import { checkPhone } from '@/lib/phone-intl'
import {
  SETTING_ENGAGE_ON_ASSIGN, getGuestAutoSwitches, writeGuestAutoSwitches, getEngageJourney,
  writeEngageJourney, openEngageJourneys,
  type GuestAutoKind, type GuestAutoSwitches, type GuestEngageJourney, type ApprovalStage,
} from '@/lib/guest-auto-switches'

const DAY_MS = 24 * 60 * 60 * 1000
export const MAX_REMINDERS = 2
const MAX_REMINDERS_PER_SWEEP = 15
/** How often an open journey re-asks Meta whether the guest has allowed calls. */
const LIVE_CHECK_EVERY_MS = 30 * 60 * 1000

/** Same plan the booking page's Register button sends by default. */
const DEFAULT_SCHEDULE = {
  mode: 'agenda',
  call_time: '18:00',
  retry_gap_min: 15,
  reconfirm: { enabled: true, days_before: 5 },
  post_tour: { enabled: true, days_after: 3 },
}

const LIVE_CALL_STATES = new Set(['active', 'paused'])
const TAG_APPROVAL_REMINDER = '[CALL-APPROVAL-REMINDER]'

export interface EngageOutcome {
  status: 'started' | 'skipped' | 'already-running'
  reason?: string
  approval?: ApprovalStage
  registration?: GuestEngageJourney['registration']['state']
}

async function engageOnAssignEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_ENGAGE_ON_ASSIGN } })
  return row?.value !== 'false'
}

const today = () => new Date().toISOString().slice(0, 10)

/** Ask the guest to allow calls, unless Meta says they already do. Never throws. */
async function askPermission(phone: string, name: string | null, bookingRef: string, actor: string): Promise<{ stage: ApprovalStage; detail?: string }> {
  try {
    const state = await teGet<{ allowed?: boolean | null }>('approval', { to: phone }).catch(() => null)
    if (state?.allowed === true) {
      await markApproved(phone, undefined, bookingRef).catch(() => {})
      return { stage: 'allowed' }
    }
    const res = await tePost<{ already_allowed?: boolean; rate_limited?: boolean; message?: string }>('approval', {
      to: phone, name: name || 'Valued Customer',
    })
    await recordApprovalRequest({ phone, bookingRef, actor, alreadyApproved: !!res.already_allowed }).catch(() => {})
    if (res.already_allowed) return { stage: 'allowed' }
    return res.rate_limited ? { stage: 'rate-limited', detail: res.message } : { stage: 'requested' }
  } catch (err) {
    return { stage: 'failed', detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }
  }
}

/**
 * Start the journey for a booking's guest WhatsApp. Called after the number is
 * saved (booking PUT) and from the "Start now" button. `force` restarts a
 * finished or running journey for the same number.
 */
export async function autoEngageGuest(p: {
  bookingRef: string
  actor: string
  trigger: 'number-assigned' | 'manual' | 'calls-turned-on'
  force?: boolean
}): Promise<EngageOutcome> {
  const skip = (reason: string): EngageOutcome => ({ status: 'skipped', reason })

  if (p.trigger === 'number-assigned' && !(await engageOnAssignEnabled())) return skip('auto-engage on assign is switched off globally')
  const switches = await getGuestAutoSwitches(p.bookingRef)
  if (!switches.calls) return skip('AI calls are turned off for this booking')

  const b = await prisma.booking.findUnique({
    where: { bookingRef: p.bookingRef },
    select: {
      bookingRef: true, status: true, departureDate: true, contactWhatsapp: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
    },
  })
  if (!b) return skip('booking not found')
  if (b.status === 'CANCELLED' || b.status === 'PENDING_CANCELLATION') return skip('booking is cancelled')
  if (b.departureDate.toISOString().slice(0, 10) < today()) return skip('trip is over')

  const v = checkPhone(b.contactWhatsapp)
  if (v.state !== 'valid') return skip('no guest WhatsApp with a country code')
  const phone = v.digits

  const existing = await getEngageJourney(b.bookingRef)
  if (existing && existing.phone === phone && !p.force) {
    if (!existing.finished) return { status: 'already-running', approval: existing.approval.stage }
    if (existing.finished.outcome === 'allowed') return { status: 'already-running', approval: 'allowed' }
  }

  const name = b.passengers[0]?.name ?? null
  const now = new Date().toISOString()

  // 1. Permission first — the guest sees the Allow request before any call.
  const approval = await askPermission(phone, name, b.bookingRef, p.actor)

  // 2. Registration on the AI-call service.
  let registration: GuestEngageJourney['registration'] = { state: 'skipped', at: now }
  try {
    const svc = await prisma.tbl_te_service.findUnique({
      where: { booking_ref: b.bookingRef },
      select: { status: true, call_phone: true },
    })
    const revivable = svc?.status === 'cancelled' && !normalizePhone(svc.call_phone)
    if (svc && !revivable) {
      registration = LIVE_CALL_STATES.has(svc.status)
        ? { state: 'existing', at: now, detail: `already on AI calls (${svc.status})` }
        : { state: 'skipped', at: now, detail: `service is ${svc.status} — left as staff set it` }
    } else {
      const res = await tePost<{ ok?: boolean; message?: string; service?: unknown }>('intake', {
        bookingRef: b.bookingRef, phone, schedule: DEFAULT_SCHEDULE,
      })
      if (res?.ok === false && !res.service) throw new Error(res.message ?? 'AI call registration failed')
      if (revivable) await tePatch(`services/${encodeURIComponent(b.bookingRef)}/status`, { status: 'active' }).catch(() => {})
      registration = { state: 'registered', at: now }
    }
  } catch (err) {
    registration = { state: 'failed', at: now, detail: (err instanceof Error ? err.message : String(err)).slice(0, 200) }
  }

  await writeEngageJourney(b.bookingRef, {
    phone, startedAt: now, startedBy: p.actor, trigger: p.trigger,
    approval: {
      stage: approval.stage,
      requestedAt: approval.stage === 'requested' || approval.stage === 'rate-limited' ? now : null,
      allowedAt: approval.stage === 'allowed' ? now : null,
      lastCheckedAt: now,
      reminders: [],
      detail: approval.detail,
    },
    registration,
    ...(approval.stage === 'allowed' ? { finished: { outcome: 'allowed' as const, at: now } } : {}),
  })

  return { status: 'started', approval: approval.stage, registration: registration.state }
}

// ─── Reminders ───────────────────────────────────────────────────────────────

function reminderText(name: string | null, bookingRef: string, n: number): string {
  const hi = name ? `Hi ${name.split(' ')[0]}` : 'Hello'
  return n === 1
    ? `${hi} 👋 We sent you a request to allow WhatsApp calls for your trip (${bookingRef}). ` +
      `Please tap *Allow* on that message so our travel assistant can call you with your daily plan and quick checks during the trip. 🙏`
    : `${hi}, a gentle last reminder 🙂 Please tap *Allow* on our WhatsApp call request for trip ${bookingRef} — ` +
      `it lets us reach you quickly if anything changes on the day. Thank you!`
}

export interface ReminderSweepResult { checked: number; allowed: number; reminded: number; closed: number; errors: string[] }

/**
 * Scheduler sweep (every 5 min tick). Cheap when nothing is due: open journeys
 * only, a Meta permission lookup at most every 30 min per journey, and at most
 * MAX_REMINDERS_PER_SWEEP sends per run.
 */
export async function runGuestApprovalReminders(): Promise<ReminderSweepResult> {
  const out: ReminderSweepResult = { checked: 0, allowed: 0, reminded: 0, closed: 0, errors: [] }
  const open = await openEngageJourneys()
  if (open.length === 0) return out

  let sends = 0
  for (const { bookingRef, journey: j } of open) {
    const nowMs = Date.now()
    const nowIso = new Date(nowMs).toISOString()
    const close = async (outcome: 'allowed' | 'no-response' | 'stopped', detail?: string) => {
      j.finished = { outcome, at: nowIso, detail }
      await writeEngageJourney(bookingRef, j)
      if (outcome === 'allowed') out.allowed++; else out.closed++
    }
    try {
      out.checked++
      const b = await prisma.booking.findUnique({
        where: { bookingRef },
        select: {
          status: true, departureDate: true, contactWhatsapp: true,
          passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
        },
      })
      if (!b || b.status === 'CANCELLED' || b.status === 'PENDING_CANCELLATION') { await close('stopped', 'booking cancelled'); continue }
      if (b.departureDate.toISOString().slice(0, 10) < today()) { await close('stopped', 'trip is over'); continue }
      if (normalizePhone(b.contactWhatsapp) !== j.phone) { await close('stopped', 'guest number changed'); continue }
      if ((await getGuestAutoSwitches(bookingRef)).calls === false) { await close('stopped', 'AI calls turned off'); continue }
      if (j.approval.stage === 'failed' && !j.approval.requestedAt) { await close('stopped', 'approval request could not be sent'); continue }

      // Has the guest tapped Allow since?
      const lastCheck = j.approval.lastCheckedAt ? Date.parse(j.approval.lastCheckedAt) : 0
      const lastReminder = j.approval.reminders[j.approval.reminders.length - 1]
      const lastSend = Date.parse(lastReminder?.at ?? j.approval.requestedAt ?? j.startedAt)
      const due = nowMs - lastSend >= DAY_MS
      if (due || nowMs - lastCheck >= LIVE_CHECK_EVERY_MS) {
        const live = await teGet<{ allowed?: boolean | null }>('approval', { to: j.phone }).catch(() => null)
        j.approval.lastCheckedAt = nowIso
        if (live?.allowed === true) {
          j.approval.stage = 'allowed'
          j.approval.allowedAt = nowIso
          await markApproved(j.phone, nowIso, bookingRef).catch(() => {})
          await close('allowed')
          continue
        }
        if (!due) { await writeEngageJourney(bookingRef, j); continue }
      } else continue

      // Due: remind, or give up after the last reminder had its 24 h.
      if (j.approval.reminders.length >= MAX_REMINDERS) { await close('no-response', `no Allow after ${MAX_REMINDERS} reminders`); continue }
      if (sends >= MAX_REMINDERS_PER_SWEEP) { await writeEngageJourney(bookingRef, j); continue }
      sends++

      const n = j.approval.reminders.length + 1
      const name = b.passengers[0]?.name ?? null
      // A fresh permission request carries its own Allow button — best. Meta
      // limits how often one can go out; then a template text points at the old one.
      let reminder: GuestEngageJourney['approval']['reminders'][number]
      const ask = await askPermission(j.phone, name, bookingRef, 'auto-reminder')
      if (ask.stage === 'allowed') {
        j.approval.stage = 'allowed'; j.approval.allowedAt = nowIso
        await close('allowed'); continue
      }
      if (ask.stage === 'requested') {
        reminder = { at: nowIso, via: 'approval-request', ok: true }
      } else {
        const text = reminderText(name, bookingRef, n)
        const sent = await deliverToGuest({ phone: j.phone, text, guestName: name, bookingRef, tag: TAG_APPROVAL_REMINDER })
        if (sent.ok) {
          await prisma.whatsAppMessage.create({
            data: {
              bookingRef, phone: normalisePhone(j.phone), direction: 'outbound', body: text,
              waMessageId: sent.waMessageId, status: 'sent', senderName: `${TAG_APPROVAL_REMINDER} ${name ?? 'Guest'}`,
            },
          }).catch(() => {})
        }
        reminder = { at: nowIso, via: 'template-text', ok: sent.ok, detail: sent.ok ? undefined : sent.reason }
      }
      j.approval.reminders.push(reminder)
      await writeEngageJourney(bookingRef, j)
      if (reminder.ok) out.reminded++
      else out.errors.push(`${bookingRef}: reminder ${n} failed${reminder.detail ? ` — ${reminder.detail}` : ''}`)
    } catch (err) {
      out.errors.push(`${bookingRef}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (out.reminded || out.allowed || out.closed || out.errors.length) {
    console.log(`[GuestApproval] checked ${out.checked} · allowed ${out.allowed} · reminded ${out.reminded} · closed ${out.closed} · errors ${out.errors.length}`)
  }
  return out
}

// ─── Switches with side effects ──────────────────────────────────────────────

/**
 * Flip a guest automation. OFF must already be OTP-verified by the caller.
 *   calls OFF → AI-call service paused, any running approval journey stopped
 *   calls ON  → a service we paused is resumed; with none, the journey starts
 *   messages  → state only; the sweeps read it (liveBookingWhere etc.)
 */
export async function setGuestAutomation(p: {
  bookingRef: string; kind: GuestAutoKind; on: boolean; actor: string; reason?: string | null
}): Promise<{ switches: GuestAutoSwitches; note?: string }> {
  const prev = await getGuestAutoSwitches(p.bookingRef)
  const next: GuestAutoSwitches = {
    ...prev, [p.kind]: p.on,
    changedBy: p.actor, changedAt: new Date().toISOString(), reason: p.reason?.trim() || null,
  }
  await writeGuestAutoSwitches(p.bookingRef, next)
  if (p.kind === 'messages' || prev[p.kind] === p.on) return { switches: next }

  let note: string | undefined
  const svc = await prisma.tbl_te_service.findUnique({ where: { booking_ref: p.bookingRef }, select: { status: true } }).catch(() => null)
  if (!p.on) {
    if (svc?.status === 'active') {
      await tePatch(`services/${encodeURIComponent(p.bookingRef)}/status`, { status: 'paused' })
        .then(() => { note = 'AI-call service paused' })
        .catch(err => { note = `could not pause the AI-call service: ${err instanceof Error ? err.message : err}` })
    }
    const j = await getEngageJourney(p.bookingRef)
    if (j && !j.finished) {
      j.finished = { outcome: 'stopped', at: new Date().toISOString(), detail: 'AI calls turned off' }
      await writeEngageJourney(p.bookingRef, j)
    }
  } else if (svc?.status === 'paused') {
    await tePatch(`services/${encodeURIComponent(p.bookingRef)}/status`, { status: 'active' })
      .then(() => { note = 'AI-call service resumed' })
      .catch(err => { note = `could not resume the AI-call service: ${err instanceof Error ? err.message : err}` })
  } else if (!svc) {
    const r = await autoEngageGuest({ bookingRef: p.bookingRef, actor: p.actor, trigger: 'calls-turned-on' })
    note = r.status === 'started' ? 'approval request sent and AI calls registered' : r.reason
  }
  return { switches: next, note }
}
