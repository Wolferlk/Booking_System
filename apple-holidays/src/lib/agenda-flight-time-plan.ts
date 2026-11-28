/**
 * Late flight details → movement-chart meeting times. The pure half.
 *
 * A chart is often built before the guest's flights are known. Airport rows
 * then get an EMPTY meeting time on purpose (see `isUntimedAirportTransfer` in
 * agenda-flight-link.ts): a blank beats a guessed 00:30. When the flights are
 * added or corrected later, this planner works out which of those blanks can
 * now be timed, using the same derivation the generator and the editor's
 * "Use as meeting time" button use (`linkFlight` + Settings → Airport Pickup
 * Timings). It also says, for every blank it cannot time yet, what is missing,
 * so the desk knows which flight to chase.
 *
 * Rules:
 *  • Only rows whose meeting time is empty are filled. A time someone typed is
 *    never changed.
 *  • The one exception is opt-in (`retimeAutoFilled`): a time this auto-fill
 *    wrote itself may follow the flight when it changes again, as long as the
 *    row still holds exactly the value that was written. An edit by anyone
 *    breaks that match, and the row is left alone from then on.
 *  • Only upcoming rows (today onwards). A past movement is history.
 *  • Flight sectors, leisure days and hotel-only rows are skipped: they carry
 *    no airport pickup.
 *
 * Pure: no prisma, so it can be dry-run against exported rows and used by the
 * client if it is ever needed there.
 */

import {
  flightClock, linkFlight, type FlightLink, type LinkableFlight,
} from './agenda-flight-link'
import { shiftClock, type FlightPickupRules } from './flight-pickup-rules'

export interface PlanItem {
  id: string
  date: string | Date
  location?: string | null
  fromPoint?: string | null
  toPoint?: string | null
  details?: string | null
  serviceType?: string | null
  meetingTime?: string | null
  timeFrom?: string | null
  timeTo?: string | null
  isLeisure?: boolean | null
  isHotelOnly?: boolean | null
  driverName?: string | null
}

/** One time this auto-fill wrote, remembered so an opt-in re-time can recognise it. */
export interface LedgerFill {
  rowKey: string
  time: string
  flightSig: string
  at: string
}

export type FillKind = 'blank' | 'retime'

export interface PlannedFill {
  itemId: string
  rowKey: string
  date: string
  fromPoint: string | null
  toPoint: string | null
  serviceType: string | null
  kind: FillKind
  /** The stored value before, exactly as read (null, '' or the old time). */
  before: string | null
  after: string
  /** Only for a SIC row whose join window was empty as well. */
  timeFrom?: string | null
  timeTo?: string | null
  role: 'departure' | 'arrival'
  flightNo: string
  /** The flight's own time the meeting time was derived from, as "HH:MM". */
  flightTime: string
  bufferMinutes: number
  bufferLabel: string
  international: boolean
  flightSig: string
  /** A driver already on the row was briefed without this time. */
  driverName: string | null
}

export type WaitingReason =
  /** No flight on the booking for this row's date. */
  | 'no-flight'
  /** Flights that day, but none can be tied to this row with confidence. */
  | 'ambiguous'
  /** The matched flight has no departure / arrival time yet. */
  | 'flight-no-time'
  /** The buffer would push the time into another day (a 01:30 departure). */
  | 'crosses-midnight'
  /**
   * A drop-off at the airport that does not start from a hotel: off a cruise,
   * at the end of a tour, from a SIC meeting point, or a combo transfer with a
   * ticket / spa / meal on the way. "Hours before the flight" does not apply:
   * the time follows the tour, so a person sets it.
   */
  | 'not-hotel-pickup'

export interface WaitingRow {
  itemId: string
  date: string
  fromPoint: string | null
  toPoint: string | null
  reason: WaitingReason
  flightNo?: string | null
}

export interface FlightTimePlan {
  fills: PlannedFill[]
  waiting: WaitingRow[]
}

export const WAITING_LABEL: Record<WaitingReason, string> = {
  'no-flight': 'no flight on this date yet',
  ambiguous: 'several flights this day — pick one on the row',
  'flight-no-time': 'flight has no time yet',
  'crosses-midnight': 'the time falls on another day (late-night flight) — set it by hand',
  'not-hotel-pickup': 'pickup is off a cruise / tour, not a hotel — set it by hand',
}

/** An airport by name — the same test that blanked the row at generation. */
const AIRPORT_POINT = /\b(airport|airfield|aerodrome)\b/i

/**
 * Movements we drive the guests on. Any other type carries no airport pickup
 * of ours: Own Arrangement is blank because the guest has their own transport
 * (not because a flight is missing), a ticket-only or tour row is timed by the
 * activity, a hotel-only or meal row has no vehicle. Custom types typed by the
 * desk are unknown, so they are left alone too.
 */
const TRANSFER_TYPES = new Set([
  'PVT_TRANSFER', 'SIC_TRANSFER', 'PVT_TRANSFER_TICKET', 'PVT_TRANSFER_SPA',
  'PVT_TRANSFER_MEAL', 'PVT_TRANSFER_SIC_TOUR',
])
/** For a drop-off at the airport, only a plain private hotel pickup takes the buffer. */
const DEPARTURE_TYPES = new Set(['PVT_TRANSFER'])
/** Where a drop-off starts when it is not a hotel: the end of a cruise, a tour, a SIC meeting point. */
const NOT_A_HOTEL = /\b(cruise|cruises|junk|boat|ship|ferry|jetty|pier|marina|sic|tour|tours|meeting point|pick ?-?up point|cable car|ticket)\b/i

const blank = (v: string | null | undefined) => !String(v ?? '').trim()

/** "YYYY-MM-DD" without shifting the zone (same rule as agenda-flight-link). */
export function dayKey(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  const text = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : dayKey(parsed)
}

const norm = (v: string | null | undefined) =>
  String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120)

/**
 * A row's identity across chart saves. Saving the chart recreates every row
 * with a new id, so the ledger keys on what the row *is* — its day and its
 * two ends — not on the id.
 */
export function rowKey(item: Pick<PlanItem, 'date' | 'fromPoint' | 'toPoint'>): string {
  return `${dayKey(item.date)}|${norm(item.fromPoint)}|${norm(item.toPoint)}`
}

/** A flight's identity for the ledger: number, day and both times. */
export function flightSig(f: LinkableFlight): string {
  return [
    f.flightNo.replace(/\s+/g, '').toUpperCase(), dayKey(f.date),
    flightClock(f.depTime) ?? '', flightClock(f.arrTime) ?? '',
  ].join('|')
}

/** The sentence for a log line or a tooltip: "UL225 lands 1:35 PM + 45 min". */
export function fillReason(f: Pick<PlannedFill, 'role' | 'flightNo' | 'flightTime' | 'bufferLabel'>): string {
  return f.role === 'departure'
    ? `${f.flightNo} departs ${f.flightTime} − ${f.bufferLabel}`
    : `${f.flightNo} lands ${f.flightTime} + ${f.bufferLabel}`
}

export function planFlightTimeFills(input: {
  items: PlanItem[]
  flights: LinkableFlight[]
  rules: FlightPickupRules
  /** "YYYY-MM-DD" — rows before this day are left alone. */
  today: string
  ledger?: LedgerFill[]
  fillBlank?: boolean
  retime?: boolean
}): FlightTimePlan {
  const { items, flights, rules, today } = input
  const fillBlank = input.fillBlank ?? true
  const retime = input.retime ?? false
  const ledger = new Map((input.ledger ?? []).map(l => [l.rowKey, l]))
  const fills: PlannedFill[] = []
  const waiting: WaitingRow[] = []

  for (const item of items) {
    const day = dayKey(item.date)
    if (!day || day < today) continue
    if (!TRANSFER_TYPES.has(String(item.serviceType ?? ''))) continue
    if (item.isLeisure === true || item.isHotelOnly === true) continue
    if (!AIRPORT_POINT.test(`${item.fromPoint ?? ''} ${item.toPoint ?? ''}`)) continue

    const current = blank(item.meetingTime) ? null : String(item.meetingTime).trim()
    const key = rowKey(item)
    const mine = current ? ledger.get(key) : undefined
    const mayRetime = retime && !!mine && mine.time === current
    if (current ? !mayRetime : !fillBlank) continue

    const link = linkFlight(item, flights, rules)
    // An airport-to-airport hop is the sector itself: it has no pickup.
    if (link?.role === 'sector') continue
    const timed = link?.suggestedPickup ? link : null

    if (!timed) {
      // Only an empty row is "waiting"; a re-timable row keeps its old value.
      if (!current) {
        waiting.push({
          itemId: item.id, date: day,
          fromPoint: item.fromPoint ?? null, toPoint: item.toPoint ?? null,
          reason: waitingReason(link, flights, day),
          flightNo: link?.flight.flightNo ?? null,
        })
      }
      continue
    }

    // A drop-off that starts off a cruise / tour / SIC point, or a combo
    // transfer: the buffer rule would give a time the guests cannot make.
    if (timed.role === 'departure'
      && (!DEPARTURE_TYPES.has(String(item.serviceType)) || NOT_A_HOTEL.test(item.fromPoint ?? ''))) {
      if (!current) {
        waiting.push({
          itemId: item.id, date: day,
          fromPoint: item.fromPoint ?? null, toPoint: item.toPoint ?? null,
          reason: 'not-hotel-pickup', flightNo: timed.flight.flightNo,
        })
      }
      continue
    }

    const after = timed.suggestedPickup as string
    if (after === current) continue

    const fill: PlannedFill = {
      itemId: item.id,
      rowKey: key,
      date: day,
      fromPoint: item.fromPoint ?? null,
      toPoint: item.toPoint ?? null,
      serviceType: item.serviceType ?? null,
      kind: current ? 'retime' : 'blank',
      before: item.meetingTime ?? null,
      after,
      role: timed.role as 'departure' | 'arrival',
      flightNo: timed.flight.flightNo.trim(),
      flightTime: (timed.role === 'departure' ? flightClock(timed.flight.depTime) : flightClock(timed.flight.arrTime)) ?? '',
      bufferMinutes: timed.bufferMinutes,
      bufferLabel: timed.bufferLabel,
      international: timed.international,
      flightSig: flightSig(timed.flight),
      driverName: item.driverName?.trim() || null,
    }

    // SIC rows carry a join window derived from the meeting time (the same
    // 30-minute rule the generator applies). Filled only when it was empty too.
    if (item.serviceType === 'SIC_TRANSFER' && blank(item.timeFrom) && blank(item.timeTo)) {
      fill.timeFrom = shiftClock(after, -30) ?? null
      fill.timeTo = after
    }
    fills.push(fill)
  }

  return { fills, waiting }
}

function waitingReason(link: FlightLink | null, flights: LinkableFlight[], day: string): WaitingReason {
  if (!link) {
    return flights.some(f => dayKey(f.date) === day) ? 'ambiguous' : 'no-flight'
  }
  // A time the parser could not read ("TBA") counts as no time.
  const own = flightClock(link.role === 'departure' ? link.flight.depTime : link.flight.arrTime)
  return own && /^\d{2}:\d{2}$/.test(own) ? 'crosses-midnight' : 'flight-no-time'
}
