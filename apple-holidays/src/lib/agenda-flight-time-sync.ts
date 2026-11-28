/**
 * Late flight details → movement-chart meeting times. The server half.
 *
 * The chart is usually built (by the background generator, ~1 minute after the
 * booking lands) before the guest's flights are known, so its airport rows come
 * out with an EMPTY meeting time on purpose. This module fills those blanks
 * once the flights arrive, from the same Settings → Airport Pickup Timings
 * rules the generator uses. Which rows, and why the others still wait, is
 * decided by the pure planner in agenda-flight-time-plan.ts.
 *
 * ── How it is triggered ──────────────────────────────────────────────────────
 *  1. Any flight write, from any path (booking edit, Apple System sync, B2C
 *     placement, file handler, OPS-AI, amendments): a Prisma middleware
 *     (agenda-flight-time-hook.ts) queues the booking, debounced 4 s, so a
 *     delete-all + recreate burst runs once.
 *  2. A chart save, so a page that was open (and saved its stale blank over a
 *     fill) is put right straight away.
 *  3. A 5-minute safety sweep over upcoming blank airport rows whose booking
 *     has flights: catches writes made by another process or by raw SQL.
 *  4. "Fill now" on the agenda page (works even when the switch is off).
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *  • Writes only `agenda_items.meetingTime` (plus an empty SIC join window) on
 *    the rows the planner picked, by primary key, compare-and-set against the
 *    value it read. A row someone edited or a chart save recreated in between
 *    is skipped (count 0), never overwritten.
 *  • Never a cancelled / cancelling booking, never a past date.
 *  • Never messages anyone. A driver already on a filled row is named in the
 *    booking log so the desk can resend the brief.
 *  • Switch: Settings → Airport Pickup Timings (`autoFillBlank`, ON), or
 *    AGENDA_FLIGHT_TIME_SYNC=off for the whole process.
 *  • Every fill is written to Booking Logs (section "Movement chart").
 */
import { prisma } from '@/lib/prisma'
import { logBookingEvent, type LogChange } from '@/lib/booking-logs'
import { loadFlightPickupRules } from '@/lib/flight-pickup-rules-server'
import { to12h } from '@/lib/clock-time'
import type { LinkableFlight } from '@/lib/agenda-flight-link'
import {
  dayKey, fillReason, planFlightTimeFills, WAITING_LABEL,
  type LedgerFill, type PlannedFill, type WaitingRow,
} from '@/lib/agenda-flight-time-plan'

export type FlightTimeTrigger = 'flight-write' | 'agenda-save' | 'sweep' | 'manual' | 'cron-http'

export const LEDGER_KEY = (ref: string) => `agenda_flight_time:${ref}`
const LEDGER_MAX = 60
const CLOSED = ['CANCELLED', 'PENDING_CANCELLATION'] as const

export interface FlightTimeLedger {
  fills: LedgerFill[]
  lastRun?: {
    at: string
    trigger: FlightTimeTrigger
    filled: number
    waiting: number
  }
  /** The most recent batch, for the agenda page's "filled from flights" note. */
  recent?: {
    at: string
    trigger: FlightTimeTrigger
    actor?: string | null
    rows: Array<Pick<PlannedFill, 'rowKey' | 'date' | 'fromPoint' | 'toPoint' | 'kind' | 'before' | 'after'
      | 'role' | 'flightNo' | 'flightTime' | 'bufferLabel' | 'driverName'>>
  }
}

export interface FlightTimeSyncResult {
  ok: boolean
  ref: string | null
  /** Why nothing was looked at: disabled, no booking, cancelled, no chart, no flights. */
  reason?: 'disabled' | 'no-booking' | 'closed' | 'no-agenda' | 'no-flights'
  dryRun: boolean
  /** Dry run: what would be written. Otherwise: what was written. */
  fills: PlannedFill[]
  /** Planned but skipped because the row changed meanwhile. */
  skipped: PlannedFill[]
  waiting: WaitingRow[]
  autoFillEnabled: boolean
  retimeEnabled: boolean
}

export function isSyncDisabledByEnv(): boolean {
  return process.env.AGENDA_FLIGHT_TIME_SYNC === 'off'
}

function parseLedger(raw: string | null | undefined): FlightTimeLedger {
  try {
    const v = raw ? JSON.parse(raw) : null
    if (v && typeof v === 'object' && Array.isArray(v.fills)) return v as FlightTimeLedger
  } catch { /* a broken row starts again */ }
  return { fills: [] }
}

export async function readFlightTimeLedger(ref: string): Promise<FlightTimeLedger> {
  const row = await prisma.systemSetting.findUnique({ where: { key: LEDGER_KEY(ref) } }).catch(() => null)
  return parseLedger(row?.value)
}

/**
 * Today as "YYYY-MM-DD" for the desk: Asia/Colombo, the earliest of the
 * operating zones' working days that matters here (Vietnam is ahead, so a
 * Vietnam row for "today" is never dropped early).
 */
function todayKey(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return dayKey(new Date())
  }
}

export async function syncAgendaFlightTimes(
  target: { bookingId?: string; ref?: string; flightId?: string },
  opts: { trigger: FlightTimeTrigger; dryRun?: boolean; actor?: { id?: string | null; name?: string | null } | null },
): Promise<FlightTimeSyncResult> {
  const dryRun = opts.dryRun === true
  const rules = await loadFlightPickupRules()
  const manual = opts.trigger === 'manual'
  const base: FlightTimeSyncResult = {
    ok: true, ref: target.ref ?? null, dryRun, fills: [], skipped: [], waiting: [],
    autoFillEnabled: rules.autoFillBlank && !isSyncDisabledByEnv(),
    retimeEnabled: rules.retimeAutoFilled,
  }

  // A dry run (the page's preview) always plans, so the desk can see what a
  // fill would do even with the automatic switch off. A real automatic run
  // needs the switch; "Fill now" is an explicit request and does not.
  if (!dryRun && !manual && !base.autoFillEnabled) return { ...base, reason: 'disabled' }

  let bookingId = target.bookingId
  if (!bookingId && target.flightId) {
    const f = await prisma.flight.findUnique({ where: { id: target.flightId }, select: { bookingId: true } })
    bookingId = f?.bookingId
  }
  if (!bookingId && !target.ref) return { ...base, reason: 'no-booking' }

  const booking = await prisma.booking.findFirst({
    where: bookingId ? { id: bookingId } : { bookingRef: target.ref },
    select: {
      id: true, bookingRef: true, status: true,
      flights: { select: { id: true, flightNo: true, airline: true, date: true, fromApt: true, depTime: true, toApt: true, arrTime: true } },
      tourAgenda: {
        select: {
          id: true,
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
              serviceType: true, meetingTime: true, timeFrom: true, timeTo: true,
              isLeisure: true, isHotelOnly: true,
              assignment: { select: { driverName: true } },
            },
          },
        },
      },
    },
  })
  if (!booking) return { ...base, reason: 'no-booking' }
  const ref = booking.bookingRef
  if ((CLOSED as readonly string[]).includes(booking.status)) return { ...base, ref, reason: 'closed' }
  if (!booking.tourAgenda || booking.tourAgenda.items.length === 0) return { ...base, ref, reason: 'no-agenda' }
  // No flights: nothing can be filled, but a dry run still lists the rows
  // waiting for them, so the page can say which flights to chase.
  if (booking.flights.length === 0 && !dryRun) return { ...base, ref, reason: 'no-flights' }

  // Chart and flight dates are stored at 00:00 UTC (new Date('YYYY-MM-DD')),
  // so the ISO date is the row's day — the same day the editor sees.
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const ledger = await readFlightTimeLedger(ref)
  const plan = planFlightTimeFills({
    items: booking.tourAgenda.items.map(i => ({ ...i, date: iso(i.date), driverName: i.assignment?.driverName ?? null })),
    flights: booking.flights.map(f => ({ ...f, date: iso(f.date) })) as LinkableFlight[],
    rules,
    today: todayKey(),
    ledger: ledger.fills,
    fillBlank: true,
    retime: rules.retimeAutoFilled,
  })

  if (dryRun || plan.fills.length === 0) {
    return { ...base, ref, fills: plan.fills, waiting: plan.waiting }
  }

  // ── Apply: one short transaction of primary-key compare-and-set updates ──
  const agendaId = booking.tourAgenda.id
  const applied: PlannedFill[] = []
  const skipped: PlannedFill[] = []
  await prisma.$transaction(async tx => {
    for (const f of plan.fills) {
      const res = await tx.agendaItem.updateMany({
        where: { id: f.itemId, agendaId, meetingTime: f.before },
        data: {
          meetingTime: f.after,
          ...(f.timeTo !== undefined && { timeFrom: f.timeFrom ?? null, timeTo: f.timeTo ?? null }),
        },
      })
      if (res.count === 1) applied.push(f)
      else skipped.push(f)
    }
    // Readers that cache on the chart's updatedAt (the journey view) refresh.
    if (applied.length) await tx.tourAgenda.update({ where: { id: agendaId }, data: { updatedAt: new Date() } })
  }, { timeout: 15_000 })

  if (applied.length) {
    await writeLedger(ref, ledger, applied, plan.waiting.length, opts)
    await logFills(ref, applied, opts)
    console.log(`[agenda-flight-time] ${ref}: ${applied.length} meeting time(s) filled from flight details (${opts.trigger})${skipped.length ? `, ${skipped.length} skipped — row changed` : ''}`)
  }

  return { ...base, ref, fills: applied, skipped, waiting: plan.waiting }
}

async function writeLedger(
  ref: string, ledger: FlightTimeLedger, applied: PlannedFill[], waiting: number,
  opts: { trigger: FlightTimeTrigger; actor?: { name?: string | null } | null },
): Promise<void> {
  const at = new Date().toISOString()
  const keys = new Set(applied.map(f => f.rowKey))
  const next: FlightTimeLedger = {
    fills: [
      ...ledger.fills.filter(l => !keys.has(l.rowKey)),
      ...applied.map(f => ({ rowKey: f.rowKey, time: f.after, flightSig: f.flightSig, at })),
    ].slice(-LEDGER_MAX),
    lastRun: { at, trigger: opts.trigger, filled: applied.length, waiting },
    recent: {
      at, trigger: opts.trigger, actor: opts.actor?.name ?? null,
      rows: applied.map(f => ({
        rowKey: f.rowKey, date: f.date, fromPoint: f.fromPoint, toPoint: f.toPoint, kind: f.kind,
        before: f.before, after: f.after, role: f.role, flightNo: f.flightNo, flightTime: f.flightTime,
        bufferLabel: f.bufferLabel, driverName: f.driverName,
      })),
    },
  }
  const value = JSON.stringify(next)
  await prisma.systemSetting.upsert({
    where: { key: LEDGER_KEY(ref) }, create: { key: LEDGER_KEY(ref), value }, update: { value },
  }).catch(err => console.warn('[agenda-flight-time] ledger write failed (non-fatal):', err instanceof Error ? err.message : err))
}

const shortDate = (d: string) => {
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

async function logFills(
  ref: string, applied: PlannedFill[],
  opts: { trigger: FlightTimeTrigger; actor?: { id?: string | null; name?: string | null } | null },
): Promise<void> {
  const changes: LogChange[] = applied.map(f => ({
    field: `Meeting time · ${shortDate(f.date)} · ${[f.fromPoint, f.toPoint].filter(Boolean).join(' → ').slice(0, 70)}`,
    from: f.before?.trim() ? to12h(f.before) : null,
    to: `${to12h(f.after)} (${fillReason({ ...f, flightTime: to12h(f.flightTime) })})`,
  }))
  const drivers = Array.from(new Set(applied.map(f => f.driverName).filter(Boolean))) as string[]
  const retimed = applied.filter(f => f.kind === 'retime').length
  const how = opts.trigger === 'manual' ? 'by "Fill now"' : 'automatically'
  await logBookingEvent({
    bookingRef: ref,
    section: 'agenda',
    action: 'flight_time_fill',
    summary: `${applied.length} airport meeting time${applied.length === 1 ? '' : 's'} ${retimed ? 'set / re-timed' : 'filled'} ${how} from flight details (Settings → Airport Pickup Timings). No WhatsApp sent.`,
    changes,
    status: 'ok',
    reason: drivers.length
      ? `Driver already assigned and briefed without this time: ${drivers.join(', ')}. Resend the brief from the chart if needed.`
      : null,
    actor: opts.trigger === 'manual' ? opts.actor ?? null : { id: null, name: 'Flight time auto-fill' },
    source: opts.trigger === 'manual' ? 'user' : 'system',
  })
}

/** Plain-language line for one waiting row (page + API). */
export function waitingText(w: WaitingRow): string {
  return `${shortDate(w.date)} · ${[w.fromPoint, w.toPoint].filter(Boolean).join(' → ')} — ${WAITING_LABEL[w.reason]}`
}

// ── In-process debounced queue ────────────────────────────────────────────────
// Fed by the Prisma hook and by chart saves. One run per booking at a time;
// a request that lands while a run is going is folded into one follow-up run.

type QueueState = { timers: Map<string, NodeJS.Timeout>; running: Map<string, Promise<unknown>>; again: Set<string> }
const g = globalThis as unknown as { __agendaFlightTimeQueue?: QueueState }
const queue: QueueState = g.__agendaFlightTimeQueue ??= { timers: new Map(), running: new Map(), again: new Set() }

/** Key "b:<bookingId>" or "f:<flightId>" (a flight update whose result carried no bookingId). */
export function queueAgendaFlightTimeSync(key: string, trigger: FlightTimeTrigger, delayMs = 4_000): void {
  if (isSyncDisabledByEnv() || !key) return
  const old = queue.timers.get(key)
  if (old) clearTimeout(old)
  const t = setTimeout(() => { queue.timers.delete(key); void runQueued(key, trigger) }, delayMs)
  t.unref?.()
  queue.timers.set(key, t)
}

async function runQueued(key: string, trigger: FlightTimeTrigger): Promise<void> {
  if (queue.running.has(key)) { queue.again.add(key); return }
  const target = key.startsWith('f:') ? { flightId: key.slice(2) } : { bookingId: key.replace(/^b:/, '') }
  const p = syncAgendaFlightTimes(target, { trigger })
    .catch(err => console.warn(`[agenda-flight-time] ${key} failed (non-fatal):`, err instanceof Error ? err.message : err))
    .finally(() => {
      queue.running.delete(key)
      if (queue.again.delete(key)) queueAgendaFlightTimeSync(key, trigger, 1_000)
    })
  queue.running.set(key, p)
  await p
}

// ── Safety sweep ──────────────────────────────────────────────────────────────

const SWEEP_HORIZON_DAYS = 180
const SWEEP_MAX_BOOKINGS = 20
/** A booking the sweep looked at is not looked at again for this long, unless a write queues it. */
const RECHECK_MS = 30 * 60_000
const checked: Map<string, number> = ((globalThis as unknown as { __agendaFlightTimeChecked?: Map<string, number> })
  .__agendaFlightTimeChecked ??= new Map())

export async function runAgendaFlightTimeSweep(trigger: FlightTimeTrigger = 'sweep'): Promise<{ checked: number; filled: number; refs: string[] }> {
  const out = { checked: 0, filled: 0, refs: [] as string[] }
  if (isSyncDisabledByEnv()) return out
  const rules = await loadFlightPickupRules()
  if (!rules.autoFillBlank) return out

  const start = new Date(`${todayKey()}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 1)       // zone slack; the planner drops yesterday itself
  const end = new Date(start.getTime() + SWEEP_HORIZON_DAYS * 86_400_000)

  // Upcoming airport rows with no time, on live bookings that have flights.
  // Uses the agenda_items date index; one row per chart.
  const rows = await prisma.agendaItem.findMany({
    where: {
      date: { gte: start, lt: end },
      OR: [{ meetingTime: null }, { meetingTime: '' }],
      serviceType: { not: 'FLIGHT' },
      AND: [{ OR: [{ fromPoint: { contains: 'airport' } }, { toPoint: { contains: 'airport' } }] }],
      agenda: { booking: { status: { notIn: [...CLOSED] }, flights: { some: {} } } },
    },
    distinct: ['agendaId'],
    select: { agenda: { select: { bookingId: true } } },
    take: 400,
  })

  const now = Date.now()
  checked.forEach((at, id) => { if (now - at > RECHECK_MS) checked.delete(id) })
  const due = rows.map(r => r.agenda.bookingId).filter(id => !checked.has(id)).slice(0, SWEEP_MAX_BOOKINGS)

  for (const bookingId of due) {
    checked.set(bookingId, now)
    if (queue.running.has(`b:${bookingId}`)) continue
    try {
      const r = await syncAgendaFlightTimes({ bookingId }, { trigger })
      out.checked++
      if (r.fills.length && r.ref) { out.filled += r.fills.length; out.refs.push(r.ref) }
    } catch (err) {
      console.warn(`[agenda-flight-time] sweep ${bookingId} failed (non-fatal):`, err instanceof Error ? err.message : err)
    }
  }
  return out
}
