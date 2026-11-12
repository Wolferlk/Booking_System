/**
 * What the guest has been *told* — the three guest-communication columns on the
 * Operations Board, computed for the whole board in a handful of queries.
 *
 *   • Driver details — the daily plan (driver, vehicle, contacts) for the next
 *     trip day: sent, scheduled (with the exact send instant, so the page can
 *     count down "in 15 min"), going out now, missed, or switched off.
 *   • Client-service calls D1 · D2 · D3 — the first three tour days, each
 *     answered / missed / scheduled / not called, from the AI on-tour call
 *     schedule plus any phone call the desk logged by hand.
 *   • (Tickets Sent lives in `ticket-sends.ts`, which owns that ledger.)
 *
 * Read-only. Every source is optional: a database without the AI-call tables
 * reports the calls as unavailable instead of "not called".
 */
import type { OperationCountry } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { briefingDayLabel } from '@/lib/whatsapp'
import {
  TAG_DAILY_BRIEFING,
  SETTING_BRIEFING_TIME_PREFIX,
  getDefaultBriefingTime,
  normaliseBriefingTime,
  briefingTargetsSameDay,
  briefingTimezone,
  addDays,
} from '@/lib/customer-whatsapp-automation'

// ── Shapes ────────────────────────────────────────────────────────────────────

export type BriefState = 'sent' | 'scheduled' | 'sending' | 'missed' | 'off' | 'na'

export interface DriverBrief {
  state: BriefState
  /** The trip day the plan is about (yyyy-mm-dd). */
  target: string | null
  /** When it went out (sent) or goes out (scheduled / sending / missed), ISO. */
  at: string | null
  /** Local send time and zone, for the tooltip: "12:00 Asia/Ho_Chi_Minh". */
  time: string | null
  tz: string | null
  /** Movements on the target day that need a driver, and how many have one. */
  movements: number
  withDriver: number
  /** Why it may not go out — shown on a missed / scheduled row. */
  hint: string | null
}

export type CallDayState = 'done' | 'missed' | 'scheduled' | 'none' | 'upcoming' | 'na'

export interface CallDay {
  day: 1 | 2 | 3
  date: string
  state: CallDayState
  /** AI schedule status as stored ("answered", "no_answer"…), when there is one. */
  aiStatus: string | null
  attempts: number
  /** Feedback captured on the call, when it connected. */
  sentiment: string | null
  /** Phone calls the desk logged by hand on this day. */
  manual: number
}

export interface GuestCalls {
  available: boolean
  days: CallDay[]
  /** Days with a connected call, over days that have happened. */
  done: number
  due: number
}

export interface GuestComms {
  brief: DriverBrief
  calls: GuestCalls
}

export interface CommsBooking {
  id: string
  bookingRef: string
  operationCountry: OperationCountry | string | null
  arrivalDate: string     // yyyy-mm-dd
  departureDate: string
  hasContact: boolean
  cancelled: boolean
  hotelOnly: boolean
  /** Per agenda item: day, whether it needs a driver, whether one is on it. */
  items: { date: string; needsDriver: boolean; hasDriver: boolean }[]
}

// ── Time helpers ──────────────────────────────────────────────────────────────

/** "HH:MM" on `ymd` in `tz` → the UTC instant. Fine for the no-DST zones used here. */
export function zonedToUtc(ymd: string, hhmm: string, tz: string): Date {
  const guess = Date.parse(`${ymd}T${hhmm}:00Z`)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(guess))
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0')
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'))
  return new Date(guess - (asLocal - guess))
}

/** The sweep runs every 5 minutes; anything this late is "going out now". */
const SENDING_GRACE_MS = 20 * 60_000

// ── Driver details (the daily plan) ───────────────────────────────────────────

async function loadBriefs(rows: CommsBooking[], boardDate: string): Promise<Map<string, DriverBrief>> {
  const out = new Map<string, DriverBrief>()
  const refs = rows.map((r) => r.bookingRef)
  if (!refs.length) return out

  const [defaultTime, overrideRows, sentRows] = await Promise.all([
    getDefaultBriefingTime(),
    prisma.systemSetting.findMany({ where: { key: { in: refs.map((r) => SETTING_BRIEFING_TIME_PREFIX + r) } } }),
    prisma.whatsAppMessage.findMany({
      where: {
        bookingRef: { in: refs },
        direction: 'outbound',
        senderName: { startsWith: TAG_DAILY_BRIEFING },
        createdAt: { gte: new Date(Date.parse(`${boardDate}T00:00:00Z`) - 3 * 86_400_000) },
      },
      select: { bookingRef: true, body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  const overrides = new Map(overrideRows.map((r) => [r.key.slice(SETTING_BRIEFING_TIME_PREFIX.length), r.value]))
  const now = Date.now()

  for (const b of rows) {
    const base: DriverBrief = { state: 'na', target: null, at: null, time: null, tz: null, movements: 0, withDriver: 0, hint: null }
    if (b.cancelled) { out.set(b.bookingRef, { ...base, hint: 'Cancelled' }); continue }

    const override = overrides.get(b.bookingRef)
    const tz = briefingTimezone(b.operationCountry, b.bookingRef)
    if (override === 'OFF') {
      out.set(b.bookingRef, { ...base, state: 'off', tz, hint: 'Auto-send is switched off for this booking' })
      continue
    }
    const time = normaliseBriefingTime(override) ?? defaultTime
    const target = briefingTargetsSameDay(time) ? boardDate : addDays(boardDate, 1)
    const dayItems = b.items.filter((i) => i.date === target && i.needsDriver)
    const brief: DriverBrief = {
      ...base, target, time, tz,
      movements: dayItems.length,
      withDriver: dayItems.filter((i) => i.hasDriver).length,
    }

    if (target < b.arrivalDate || target > b.departureDate) {
      out.set(b.bookingRef, { ...brief, hint: target > b.departureDate ? 'Trip is over — no plan to send' : 'Trip has not started' })
      continue
    }

    const label = briefingDayLabel(`${target}T00:00:00.000Z`)
    const hit = sentRows.find((m) => m.bookingRef === b.bookingRef && m.body?.includes(label))
    if (hit) {
      out.set(b.bookingRef, { ...brief, state: 'sent', at: hit.createdAt.toISOString() })
      continue
    }

    const sendAt = zonedToUtc(boardDate, time, tz)
    const hint = !b.hasContact ? 'No WhatsApp number on the booking — it cannot go out'
      : brief.movements > 0 && brief.withDriver < brief.movements ? `Only ${brief.withDriver}/${brief.movements} movements have a driver yet`
        : null
    const state: BriefState = now < sendAt.getTime() ? 'scheduled'
      : now - sendAt.getTime() <= SENDING_GRACE_MS && b.hasContact ? 'sending'
        : 'missed'
    out.set(b.bookingRef, { ...brief, state, at: sendAt.toISOString(), hint })
  }
  return out
}

// ── Client-service calls, tour days 1–3 ───────────────────────────────────────

const CONNECTED = new Set(['answered', 'done', 'completed'])
const MISSED = new Set(['missed', 'failed', 'no_answer'])
const PENDING = new Set(['pending', 'calling', 'scheduled', 'retry'])
const NOT_ON_TOUR = new Set(['reconfirm', 'pre_tour', 'reconfirmation', 'post_tour', 'posttour'])
const MANUAL_CALL_TYPES = ['PHONE', 'CALL', 'VOICE', 'WHATSAPP_CALL']

async function loadCalls(rows: CommsBooking[], today: string): Promise<Map<string, GuestCalls>> {
  const out = new Map<string, GuestCalls>()
  const refs = rows.map((r) => r.bookingRef)
  if (!refs.length) return out

  let available = true
  type Sched = { id: bigint; booking_ref: string; call_date: Date; status: string; attempts: number; phase: string | null }
  let sched: Sched[] = []
  const sentiment = new Map<string, string>()
  try {
    sched = await prisma.tbl_te_call_schedule.findMany({
      where: { booking_ref: { in: refs } },
      select: { id: true, booking_ref: true, call_date: true, status: true, attempts: true, phase: true },
    })
    const ids = sched.map((s) => s.id)
    if (ids.length) {
      const fb = await prisma.tbl_te_feedback.findMany({
        where: { schedule_id: { in: ids } },
        select: { schedule_id: true, sentiment: true },
      })
      for (const f of fb) if (f.schedule_id != null && f.sentiment) sentiment.set(String(f.schedule_id), f.sentiment)
    }
  } catch {
    available = false   // AI-call tables not on this database
  }

  const logs = await prisma.contactLog.findMany({
    where: { bookingId: { in: rows.map((r) => r.id) }, type: { in: MANUAL_CALL_TYPES } },
    select: { bookingId: true, contactedAt: true },
  }).catch(() => [] as { bookingId: string; contactedAt: Date }[])

  for (const b of rows) {
    const tz = briefingTimezone(b.operationCountry, b.bookingRef)
    const localDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d)
    const mine = sched.filter((s) => s.booking_ref === b.bookingRef && !NOT_ON_TOUR.has((s.phase ?? '').toLowerCase()))
    const days: CallDay[] = ([1, 2, 3] as const).map((day) => {
      const date = addDays(b.arrivalDate, day - 1)
      if (date > b.departureDate || b.cancelled || b.hotelOnly) {
        return { day, date, state: 'na', aiStatus: null, attempts: 0, sentiment: null, manual: 0 }
      }
      const s = mine.find((x) => x.call_date.toISOString().slice(0, 10) === date)
      const manual = logs.filter((l) => l.bookingId === b.id && localDay(l.contactedAt) === date).length
      const st = (s?.status ?? '').toLowerCase()
      const state: CallDayState =
        CONNECTED.has(st) || manual > 0 ? 'done'
          : MISSED.has(st) ? 'missed'
            : PENDING.has(st) ? (date < today ? 'missed' : 'scheduled')
              : date > today ? 'upcoming' : 'none'
      return {
        day, date, state,
        aiStatus: s?.status ?? null,
        attempts: s?.attempts ?? 0,
        sentiment: s ? sentiment.get(String(s.id)) ?? null : null,
        manual,
      }
    })
    const happened = days.filter((d) => d.state !== 'na' && d.date <= today)
    out.set(b.bookingRef, {
      available,
      days,
      done: happened.filter((d) => d.state === 'done').length,
      due: happened.length,
    })
  }
  return out
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function loadGuestComms(
  rows: CommsBooking[],
  boardDate: string,
  today: string,
): Promise<Map<string, GuestComms>> {
  const out = new Map<string, GuestComms>()
  const [briefs, calls] = await Promise.all([
    loadBriefs(rows, boardDate).catch((err) => {
      console.error('[OpsBoard] driver-details status failed (non-fatal):', err instanceof Error ? err.message : err)
      return new Map<string, DriverBrief>()
    }),
    loadCalls(rows, today).catch((err) => {
      console.error('[OpsBoard] call status failed (non-fatal):', err instanceof Error ? err.message : err)
      return new Map<string, GuestCalls>()
    }),
  ])
  const naBrief: DriverBrief = { state: 'na', target: null, at: null, time: null, tz: null, movements: 0, withDriver: 0, hint: null }
  for (const r of rows) {
    out.set(r.bookingRef, {
      brief: briefs.get(r.bookingRef) ?? naBrief,
      calls: calls.get(r.bookingRef) ?? { available: false, days: [], done: 0, due: 0 },
    })
  }
  return out
}
