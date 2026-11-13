/**
 * Guest Autopilot — what actually went out to the guest, day by day.
 *
 *   • Daily trip plans — the [DAILY-BRIEFING] WhatsApp per trip day, with its
 *     delivery tick (sent → delivered → read, or failed).
 *   • AI calls — the on-tour call schedule per day, with the call result and
 *     the mood / summary captured on a connected call.
 *
 * Read-only. Every source is optional: a database without the AI-call tables
 * reports calls as unavailable.
 */
import { prisma } from '@/lib/prisma'
import { briefingDayLabel } from '@/lib/whatsapp'
import { TAG_DAILY_BRIEFING, briefingTimezone } from '@/lib/customer-whatsapp-automation'

export type PlanState = 'read' | 'delivered' | 'sent' | 'failed' | 'missed' | 'today' | 'upcoming'
export type CallState = 'answered' | 'missed' | 'calling' | 'scheduled' | 'none' | 'upcoming'

export interface ActivityDay {
  date: string        // yyyy-mm-dd
  dayNo: number
  plan: { state: PlanState; at: string | null }
  call: {
    state: CallState
    at: string | null
    attempts: number
    sentiment: string | null
    summary: string | null
    issues: string | null
  }
}

export interface ExtraCall {
  phase: string
  date: string
  state: CallState
  at: string | null
  sentiment: string | null
  summary: string | null
}

export interface GuestActivity {
  today: string
  days: ActivityDay[]
  extras: ExtraCall[]
  callsAvailable: boolean
  stats: {
    plansSent: number
    plansRead: number
    plansFailed: number
    callsAnswered: number
    callsDue: number
    mood: 'positive' | 'neutral' | 'negative' | null
  }
  lastCall: { date: string; dayNo: number | null; sentiment: string | null; summary: string; issues: string | null } | null
}

const CONNECTED = new Set(['answered', 'done', 'completed'])
const MISSED = new Set(['missed', 'failed', 'no_answer', 'busy', 'rejected'])
const CALLING = new Set(['calling', 'in_progress', 'ringing'])
const NOT_ON_TOUR = new Set(['reconfirm', 'pre_tour', 'reconfirmation', 'post_tour', 'posttour'])
const MAX_DAYS = 31

const ymd = (d: Date) => d.toISOString().slice(0, 10)
function addDays(day: string, n: number): string {
  return ymd(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000))
}
function todayIn(tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()) } catch { return ymd(new Date()) }
}
function moodOf(s: string | null | undefined): 'positive' | 'neutral' | 'negative' | null {
  const v = (s ?? '').toLowerCase()
  if (!v) return null
  if (/pos|happy|good|great/.test(v)) return 'positive'
  if (/neg|bad|unhappy|angry|poor/.test(v)) return 'negative'
  return 'neutral'
}
const PLAN_RANK: Record<string, number> = { failed: 0, sent: 1, 'sent-queued': 1, delivered: 2, read: 3 }

export async function guestActivity(booking: {
  bookingRef: string
  operationCountry: string | null
  arrivalDate: Date | null
  departureDate: Date | null
}): Promise<GuestActivity | null> {
  if (!booking.arrivalDate || !booking.departureDate) return null
  const arrival = ymd(booking.arrivalDate)
  const departure = ymd(booking.departureDate)
  const today = todayIn(briefingTimezone(booking.operationCountry as never, booking.bookingRef))

  const dates: string[] = []
  for (let d = arrival; d <= departure && dates.length < MAX_DAYS; d = addDays(d, 1)) dates.push(d)

  // ── Daily plans ──
  const msgs = await prisma.whatsAppMessage.findMany({
    where: { bookingRef: booking.bookingRef, direction: 'outbound', senderName: { startsWith: TAG_DAILY_BRIEFING } },
    select: { body: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  }).catch(() => [])

  // ── AI calls ──
  type Sched = { id: bigint; call_date: Date; day_no: number; status: string; attempts: number; phase: string | null; scheduled_at: Date | null; last_attempt_at: Date | null }
  let sched: Sched[] = []
  let callsAvailable = true
  const fb = new Map<string, { sentiment: string | null; summary: string | null; issues: string | null; at: Date }>()
  try {
    sched = await prisma.tbl_te_call_schedule.findMany({
      where: { booking_ref: booking.bookingRef },
      select: { id: true, call_date: true, day_no: true, status: true, attempts: true, phase: true, scheduled_at: true, last_attempt_at: true },
      orderBy: { call_date: 'asc' },
      take: 100,
    })
    const rows = await prisma.tbl_te_feedback.findMany({
      where: { booking_ref: booking.bookingRef },
      select: { schedule_id: true, sentiment: true, summary: true, issues: true, created_at: true },
      orderBy: { created_at: 'asc' },
      take: 100,
    })
    for (const r of rows) if (r.schedule_id != null) fb.set(String(r.schedule_id), { sentiment: r.sentiment, summary: r.summary, issues: r.issues, at: r.created_at })
  } catch {
    callsAvailable = false
  }

  const callStateOf = (s: Sched | undefined, date: string): CallState => {
    if (!s) return date > today ? 'upcoming' : 'none'
    const st = s.status.toLowerCase()
    if (CONNECTED.has(st) || fb.has(String(s.id))) return 'answered'
    if (MISSED.has(st)) return 'missed'
    if (CALLING.has(st)) return 'calling'
    return date < today ? 'missed' : 'scheduled'
  }

  const onTour = sched.filter(s => !NOT_ON_TOUR.has((s.phase ?? '').toLowerCase()))
  const days: ActivityDay[] = dates.map((date, i) => {
    const label = briefingDayLabel(`${date}T00:00:00.000Z`)
    const hits = msgs.filter(m => m.body?.includes(label))
    const best = hits.sort((a, b) => (PLAN_RANK[b.status] ?? 1) - (PLAN_RANK[a.status] ?? 1))[0]
    const planState: PlanState = best
      ? (best.status === 'read' ? 'read' : best.status === 'delivered' ? 'delivered' : best.status === 'failed' ? 'failed' : 'sent')
      : date < today ? 'missed' : date === today ? 'today' : 'upcoming'

    const s = onTour.find(x => ymd(x.call_date) === date)
    const f = s ? fb.get(String(s.id)) : undefined
    return {
      date, dayNo: i + 1,
      plan: { state: planState, at: best?.createdAt.toISOString() ?? null },
      call: {
        state: callStateOf(s, date),
        at: (s?.last_attempt_at ?? s?.scheduled_at)?.toISOString() ?? null,
        attempts: s?.attempts ?? 0,
        sentiment: f?.sentiment ?? null,
        summary: f?.summary?.trim() || null,
        issues: f?.issues?.trim() || null,
      },
    }
  })

  const extras: ExtraCall[] = sched
    .filter(s => NOT_ON_TOUR.has((s.phase ?? '').toLowerCase()))
    .map(s => {
      const f = fb.get(String(s.id))
      const date = ymd(s.call_date)
      return {
        phase: /post/i.test(s.phase ?? '') ? 'After tour' : 'Reconfirm',
        date, state: callStateOf(s, date),
        at: (s.last_attempt_at ?? s.scheduled_at)?.toISOString() ?? null,
        sentiment: f?.sentiment ?? null, summary: f?.summary?.trim() || null,
      }
    })

  const answered = days.filter(d => d.call.state === 'answered')
  const moods = answered.map(d => moodOf(d.call.sentiment)).filter(Boolean)
  const lastAnswered = [...answered].reverse().find(d => d.call.summary)
  return {
    today, days, extras, callsAvailable,
    stats: {
      plansSent: days.filter(d => ['sent', 'delivered', 'read'].includes(d.plan.state)).length,
      plansRead: days.filter(d => d.plan.state === 'read').length,
      plansFailed: days.filter(d => d.plan.state === 'failed').length,
      callsAnswered: answered.length,
      callsDue: days.filter(d => d.date <= today && d.call.state !== 'none').length,
      mood: moods.length ? moods[moods.length - 1]! : null,
    },
    lastCall: lastAnswered
      ? { date: lastAnswered.date, dayNo: lastAnswered.dayNo, sentiment: lastAnswered.call.sentiment, summary: lastAnswered.call.summary!, issues: lastAnswered.call.issues }
      : null,
  }
}
