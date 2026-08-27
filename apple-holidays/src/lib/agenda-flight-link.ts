/**
 * Links a movement-chart row to the booking's flights.
 *
 * The connection is *derived on every read*, never stored: an amendment
 * rewrites a booking's flight rows wholesale, and an agenda that had cached a
 * flight id would keep quoting a sector that no longer exists. Nothing here
 * writes, and no column was added — the same reason the reservation Request
 * Inbox materialises on read rather than being backfilled.
 *
 * Why it exists: the desk was typing "Hotel pickup at 11:35 (3 hrs before
 * 14:35 departure)" by hand into every airport row, and the two numbers drifted
 * apart the moment an airline moved a flight. The flight table already holds
 * the truth, so the movement chart, the PDF and the Word file now read it from
 * there instead.
 */

import { to12h } from './clock-time'
import { airport } from './ops-geo'

export interface LinkableFlight {
  id?: string
  flightNo: string
  airline?: string | null
  date: string | Date
  fromApt: string
  depTime?: string | null
  toApt: string
  arrTime?: string | null
}

export interface LinkableAgendaItem {
  date: string | Date
  fromPoint?: string | null
  toPoint?: string | null
  location?: string | null
  details?: string | null
  serviceType?: string | null
}

/** How the movement relates to the flight it was matched with. */
export type FlightRole =
  /** The row drops the guests at the departure airport for this flight. */
  | 'departure'
  /** The row collects them from the arrival airport after this flight. */
  | 'arrival'
  /** The row *is* the sector — a FLIGHT service type or an airport-to-airport hop. */
  | 'sector'

export interface FlightLink {
  flight: LinkableFlight
  role: FlightRole
  /**
   * Recommended pickup for a departure transfer — the departure time less the
   * check-in buffer, as a stored "HH:MM". Null when the flight has no departure
   * time, or when the subtraction would cross back past midnight (a 01:30
   * departure), where a same-day pickup time would be a lie.
   */
  suggestedPickup: string | null
  /** Hours of check-in buffer used for `suggestedPickup`. */
  bufferHours: number
  /** The sector crosses a border — drives the check-in and immigration wording. */
  international: boolean
}

/**
 * Check-in buffer. A sector that crosses a border needs the full three hours;
 * a domestic hop between two airports in the same country needs two.
 *
 * Whether it crosses a border is decided from the gazetteer in ops-geo, not
 * from a list of "international" airports — DAD and PQC are both international
 * fields, but Da Nang to Phu Quoc is a domestic flight, and sending a guest to
 * the terminal an hour early for it wastes an hour of their holiday.
 */
const INTERNATIONAL_BUFFER_H = 3
const DOMESTIC_BUFFER_H = 2

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}/

/** Reduce a Date or an ISO string to "YYYY-MM-DD" without shifting the zone. */
function dayKey(value: string | Date | null | undefined): string {
  if (!value) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    // Local parts, not toISOString(): a 07:00 +07 date must stay that date.
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  }
  const text = String(value)
  if (DATE_ONLY.test(text)) return text.slice(0, 10)
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : dayKey(parsed)
}

/** Every 3-letter uppercase token in a string — "PQC Airport" → ["PQC"]. */
function codesIn(text: string | null | undefined): string[] {
  return String(text ?? '').toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []
}

/**
 * Does `text` name the airport `apt`? `apt` is normally an IATA code, but the
 * extractor sometimes lands a full name in the column, so both are tried.
 */
function mentionsAirport(text: string | null | undefined, apt: string | null | undefined): boolean {
  const haystack = String(text ?? '').trim()
  const needle = String(apt ?? '').trim()
  if (!haystack || !needle) return false

  const needleCodes = codesIn(needle)
  const haystackCodes = codesIn(haystack)
  if (needleCodes.length > 0 && needleCodes.some(c => haystackCodes.includes(c))) return true

  // Full-name match: "Tan Son Nhat" inside "Tan Son Nhat International Airport".
  const words = needle.replace(/\b(international|airport|apt|terminal)\b/gi, '').trim()
  if (words.length >= 4 && haystack.toLowerCase().includes(words.toLowerCase())) return true
  return false
}

const AIRPORTISH = /\b(airport|airfield|aerodrome|terminal|apt)\b/i

/** Does this row touch an airport at all? Cheap gate before any matching. */
export function isAirportMovement(item: LinkableAgendaItem): boolean {
  if (item.serviceType === 'FLIGHT') return true
  return AIRPORTISH.test(`${item.fromPoint ?? ''} ${item.toPoint ?? ''}`)
}

/** "HH:MM" minus N hours, or null if it would fall on the previous day. */
function minusHours(time: string | null | undefined, hours: number): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? '').trim())
  if (!m) return null
  const total = Number(m[1]) * 60 + Number(m[2]) - hours * 60
  if (total < 0) return null
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isInternational(flight: LinkableFlight): boolean {
  const from = codesIn(flight.fromApt).map(airport).find(Boolean)
  const to = codesIn(flight.toApt).map(airport).find(Boolean)
  // An airport the gazetteer does not know is treated as international: being
  // early for a domestic hop costs an hour, being late for an international
  // one costs the flight.
  if (!from || !to) return true
  return from.country !== to.country
}

/**
 * Find the flight a movement row belongs to.
 *
 * Only flights on the row's own date are considered, and a role is assigned
 * only when the row's own text names the right end of the sector — a drop-off
 * has to mention the departure airport, a pickup the arrival airport. When
 * exactly one flight is left on an airport day and nothing matched by name,
 * that flight is used: an airport row on a single-flight day is not ambiguous.
 * Anything still ambiguous returns null rather than guessing, because a wrong
 * pickup time in a guest's PDF is worse than no pickup time.
 */
export function linkFlight(item: LinkableAgendaItem, flights: LinkableFlight[]): FlightLink | null {
  if (!flights || flights.length === 0) return null
  if (!isAirportMovement(item)) return null

  const day = dayKey(item.date)
  if (!day) return null
  const sameDay = flights.filter(f => dayKey(f.date) === day)
  if (sameDay.length === 0) return null

  const from = item.fromPoint ?? ''
  const to = item.toPoint ?? ''
  const text = `${from} ${to} ${item.details ?? ''}`

  const build = (flight: LinkableFlight, role: FlightRole): FlightLink => {
    const international = isInternational(flight)
    const bufferHours = international ? INTERNATIONAL_BUFFER_H : DOMESTIC_BUFFER_H
    return {
      flight,
      role,
      suggestedPickup: role === 'departure' ? minusHours(flight.depTime, bufferHours) : null,
      bufferHours,
      international,
    }
  }

  // 1. The row names the flight number outright — nothing beats that.
  const byNumber = sameDay.find(f => {
    const compact = f.flightNo.replace(/\s+/g, '').toUpperCase()
    return compact.length >= 3 && text.replace(/\s+/g, '').toUpperCase().includes(compact)
  })
  if (byNumber) {
    const isSector = item.serviceType === 'FLIGHT'
      || (mentionsAirport(from, byNumber.fromApt) && mentionsAirport(to, byNumber.toApt))
    if (isSector) return build(byNumber, 'sector')
    if (mentionsAirport(to, byNumber.fromApt)) return build(byNumber, 'departure')
    if (mentionsAirport(from, byNumber.toApt)) return build(byNumber, 'arrival')
    return build(byNumber, item.serviceType === 'FLIGHT' ? 'sector' : 'departure')
  }

  // 2. The sector itself: both ends named, or an explicit FLIGHT row.
  const sector = sameDay.find(f => mentionsAirport(from, f.fromApt) && mentionsAirport(to, f.toApt))
  if (sector) return build(sector, 'sector')

  // 3. Drop-off at the departure airport.
  const departure = sameDay.find(f => mentionsAirport(to, f.fromApt))
  if (departure) return build(departure, 'departure')

  // 4. Pickup from the arrival airport.
  const arrival = sameDay.find(f => mentionsAirport(from, f.toApt))
  if (arrival) return build(arrival, 'arrival')

  // 5. One flight, one airport row, no ambiguity left to resolve.
  if (sameDay.length === 1) {
    const only = sameDay[0]
    if (item.serviceType === 'FLIGHT') return build(only, 'sector')
    if (AIRPORTISH.test(to)) return build(only, 'departure')
    if (AIRPORTISH.test(from)) return build(only, 'arrival')
  }

  return null
}

/**
 * The flight itself as one line: "✈ VN977 Vietnam Airlines · SGN → DEL ·
 * Dep 3:45 PM · Arr 6:20 PM". Times are 12-hour so a guest reading the PDF
 * cannot misread an evening departure as a morning one.
 */
export function flightLine(flight: LinkableFlight): string {
  const airline = flight.airline?.trim() ? ` ${flight.airline.trim()}` : ''
  const parts = [
    `✈ ${flight.flightNo.trim()}${airline}`,
    `${flight.fromApt} → ${flight.toApt}`,
  ]
  if (flight.depTime) parts.push(`Dep ${to12h(flight.depTime)}`)
  if (flight.arrTime) parts.push(`Arr ${to12h(flight.arrTime)}`)
  return parts.join(' · ')
}

/** Same line without the aeroplane glyph, for PDF fonts that lack it. */
export function flightLinePlain(flight: LinkableFlight): string {
  return flightLine(flight).replace(/^✈\s*/, 'Flight ')
}

/**
 * The airport-transfer sentence that goes into a row's Details.
 *
 * Written as operational instruction rather than a data dump: what the driver
 * does, when, and what the guest needs in hand. Returns `''` for a sector row —
 * the flight line alone says everything there.
 */
export function transferDescription(link: FlightLink): string {
  const { flight, role, suggestedPickup, bufferHours, international } = link

  if (role === 'departure') {
    const bits: string[] = []
    if (suggestedPickup) {
      bits.push(
        `Hotel pickup at ${to12h(suggestedPickup)} — ${bufferHours} hours before the `
        + `${to12h(flight.depTime ?? '')} departure of ${flight.flightNo}.`,
      )
    } else {
      bits.push(`Hotel pickup timed ${bufferHours} hours before ${flight.flightNo} departs.`)
    }
    bits.push(
      `Air-conditioned private vehicle to ${flight.fromApt} Airport, departure terminal, `
      + `with luggage assistance at the kerb.`,
    )
    bits.push(international
      ? 'Passports and e-tickets should be ready for check-in.'
      : 'Photo ID and e-tickets should be ready for check-in.')
    return bits.join(' ')
  }

  if (role === 'arrival') {
    const bits: string[] = [
      `Meet on arrival of ${flight.flightNo}`
      + (flight.arrTime ? ` at ${to12h(flight.arrTime)}` : '')
      + ` into ${flight.toApt} Airport.`,
      'Our representative waits in the arrivals hall with an Apple Holidays name board.',
      international
        ? 'Please allow time for immigration and baggage claim before meeting the driver.'
        : 'Please allow time for baggage claim before meeting the driver.',
    ]
    return bits.join(' ')
  }

  return ''
}

/**
 * The full block a movement row shows for its flight: the flight line, and the
 * transfer instruction under it when the row is a transfer rather than the
 * sector. Empty string when there is nothing to say.
 */
export function flightNote(link: FlightLink | null): string {
  if (!link) return ''
  const transfer = transferDescription(link)
  return [flightLine(link.flight), transfer].filter(Boolean).join('\n')
}

/**
 * Attach a link to every row in one pass — the shape the PDF, the Word file and
 * the print view all want.
 */
export function linkFlights<T extends LinkableAgendaItem>(
  items: T[], flights: LinkableFlight[],
): Map<T, FlightLink> {
  const out = new Map<T, FlightLink>()
  for (const item of items) {
    const link = linkFlight(item, flights)
    if (link) out.set(item, link)
  }
  return out
}
