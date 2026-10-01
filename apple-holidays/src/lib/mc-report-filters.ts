/**
 * MC Report — advanced filtering.
 *
 * The chart is loaded once per date range and every filter here runs over the
 * rows already on the page, so flipping between "arrivals" and "departures"
 * is instant and the CSV / Excel exports (which read the displayed rows) carry
 * exactly what the desk is looking at.
 *
 * The hard part is not the filtering, it is deciding what a row *is*. Only Sri
 * Lanka files carry structured flights; Vietnam and Singapore / Malaysia rows
 * say "Noi Bai Airport → Hanoi Old Quarter" in plain text. So a movement is
 * classed as an arrival or departure from the strongest signal it has:
 *
 *   1. a flight on the row's own date (ARR / DEP from `flightDirection`)
 *   2. an airport in the route — from an airport is a pickup, to one a drop
 *   3. an airport named in the details on the file's arrival / departure day
 *
 * and the row keeps which signal decided it, so the chart can say "by flight"
 * versus "by route" instead of asking anybody to trust a guess.
 */

import type { McFlight } from '@/lib/mc-report-fields'

// ─── Row shape this module reads ─────────────────────────────────────────────

/** The slice of an MC row the filters need — the page's row type satisfies it. */
export interface McFilterRow {
  id:          string
  date:        string
  vnCode:      string
  location:    string
  paxAdults:   number
  paxChildren: number
  fromPoint:   string | null
  toPoint:     string | null
  details:     string | null
  meetingTime: string | null
  isLeisure:   boolean
  isHotelOnly: boolean
  isHotelOnlyBooking: boolean
  driverId:    string | null
  driverName:  string | null
  vendor:      string | null
  vendorId:    string | null
  vendorName:  string | null
  tourVendorId:   string | null
  tourVendorName: string | null
  agent:       string | null
  bookingStatus: string
  flights?:      McFlight[]
  arrivalDate?:  string | null
  departureDate?: string | null
  mealPrefs?:    unknown[]
  bookingRequests?: unknown[]
  mcDetails?:    { specialRequest?: unknown } | null
}

// ─── Airports ────────────────────────────────────────────────────────────────

/**
 * Airports the four desks fly through, keyed by IATA code. A name, a city
 * nickname or the code itself all resolve to the same chip, so "BIA",
 * "Katunayake" and "Colombo (CMB)" are counted as one airport.
 */
const AIRPORTS: { code: string; name: string; codes: RegExp; names?: RegExp }[] = [
  { code: 'CMB', name: 'Colombo',       codes: /\b(CMB|BIA)\b/,  names: /bandaranaike|katunayake/i },
  { code: 'HRI', name: 'Mattala',       codes: /\bHRI\b/,        names: /mattala/i },
  { code: 'SGN', name: 'Ho Chi Minh',   codes: /\bSGN\b/,        names: /tan\s*son\s*nhat/i },
  { code: 'HAN', name: 'Hanoi',         codes: /\bHAN\b/,        names: /noi\s*bai/i },
  { code: 'DAD', name: 'Da Nang',       codes: /\bDAD\b/,        names: /da\s*nang\s+(int'?l\s+|international\s+)?airport/i },
  { code: 'CXR', name: 'Cam Ranh',      codes: /\bCXR\b/,        names: /cam\s*ranh/i },
  { code: 'PQC', name: 'Phu Quoc',      codes: /\bPQC\b/,        names: /phu\s*quoc\s+(int'?l\s+|international\s+)?airport/i },
  { code: 'HUI', name: 'Hue',           codes: /\bHUI\b/,        names: /phu\s*bai/i },
  { code: 'SIN', name: 'Singapore',     codes: /\bSIN\b/,        names: /changi/i },
  { code: 'KUL', name: 'Kuala Lumpur',  codes: /\b(KUL|KLIA2?)\b/i },
  { code: 'PEN', name: 'Penang',        codes: /\bPEN\b/,        names: /penang\s+(int'?l\s+|international\s+)?airport/i },
  { code: 'BKI', name: 'Kota Kinabalu', codes: /\bBKI\b/,        names: /kota\s*kinabalu\s+(int'?l\s+|international\s+)?airport/i },
  { code: 'LGK', name: 'Langkawi',      codes: /\bLGK\b/,        names: /langkawi\s+(int'?l\s+|international\s+)?airport/i },
]

/**
 * Codes are matched in capitals only — "HAN" is Hanoi's airport, but "Han
 * Market" is a Da Nang sightseeing stop. Names are matched in any case.
 */
function matchAirport(text: string) {
  return AIRPORTS.find(a => a.codes.test(text) || !!a.names?.test(text))
}

/** Anything that reads as an airport, named or not. */
const AIRPORT_WORD = /\b(airport|air\s*port|terminal\s*\d|int'?l\s+arrivals?)\b/i

function mentionsAirport(text: string | null | undefined): boolean {
  if (!text) return false
  return AIRPORT_WORD.test(text) || !!matchAirport(text)
}

/** "CMB" for anything that names Colombo's airport; `null` when none is known. */
export function airportCode(text: string | null | undefined): string | null {
  if (!text) return null
  return matchAirport(text)?.code ?? null
}

export function airportName(code: string): string {
  return AIRPORTS.find(a => a.code === code)?.name ?? code
}

// ─── Classification ──────────────────────────────────────────────────────────

export type FlowSource = 'flight' | 'route' | 'day'

export interface MovementFlow {
  arrival:   boolean
  departure: boolean
  /** Which signal decided it — shown on the row so nobody has to trust a guess. */
  source:    FlowSource | null
  /** The flight on this row's date that decided it, when there is one. */
  flight:    McFlight | null
  /** IATA code of the airport involved, when it could be resolved. */
  airport:   string | null
  /** "HH:MM" the movement works to: flight time first, then the meeting time. */
  time:      string | null
}

const flowCache = new WeakMap<object, MovementFlow>()

/** What kind of movement this row is. Cached per row object. */
export function movementFlow(row: McFilterRow): MovementFlow {
  const hit = flowCache.get(row)
  if (hit) return hit
  const flow = classify(row)
  flowCache.set(row, flow)
  return flow
}

function classify(row: McFilterRow): MovementFlow {
  const none: MovementFlow = {
    arrival: false, departure: false, source: null, flight: null, airport: null,
    time: clock(row.meetingTime),
  }
  // A Hotel Only stay is a night in a room, not a movement — never a pickup.
  if (row.isHotelOnlyBooking) return none

  const todays = (row.flights ?? []).filter(f => f.date === row.date)
  const arrFlight = todays.find(f => f.direction === 'ARR') ?? null
  const depFlight = todays.find(f => f.direction === 'DEP') ?? null

  if (arrFlight || depFlight) {
    const f = arrFlight ?? depFlight!
    return {
      arrival:   !!arrFlight,
      departure: !!depFlight,
      source:    'flight',
      flight:    f,
      airport:   arrFlight ? airportCode(arrFlight.toApt) ?? arrFlight.toApt.toUpperCase()
                           : airportCode(depFlight!.fromApt) ?? depFlight!.fromApt.toUpperCase(),
      time:      clock(arrFlight ? arrFlight.arrTime : depFlight!.depTime) ?? clock(row.meetingTime),
    }
  }

  const fromApt = mentionsAirport(row.fromPoint)
  const toApt   = mentionsAirport(row.toPoint)
  if (fromApt || toApt) {
    return {
      arrival:   fromApt,
      departure: toApt,
      source:    'route',
      flight:    null,
      airport:   airportCode(fromApt ? row.fromPoint : row.toPoint),
      time:      clock(row.meetingTime),
    }
  }

  // Last resort: the details mention the airport on the file's first / last day.
  // A first-day sightseeing row that says nothing about the airport stays put.
  if (mentionsAirport(row.details)) {
    const arrival   = !!row.arrivalDate   && row.date === row.arrivalDate
    const departure = !!row.departureDate && row.date === row.departureDate
    if (arrival || departure) {
      return {
        arrival, departure, source: 'day', flight: null,
        airport: airportCode(row.details),
        time:    clock(row.meetingTime),
      }
    }
  }

  return none
}

/** "05:40" from anything that starts with a clock time, else null. */
function clock(raw: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(raw ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// ─── Facets ──────────────────────────────────────────────────────────────────

export type FlowFilter = 'all' | 'arrivals' | 'departures' | 'airport' | 'touring'

export const FLOW_OPTIONS: { key: FlowFilter; label: string; hint: string }[] = [
  { key: 'all',        label: 'All movements', hint: 'Everything in the date range' },
  { key: 'arrivals',   label: 'Arrivals',      hint: 'Airport pickups — guests landing' },
  { key: 'departures', label: 'Departures',    hint: 'Airport drops — guests flying out' },
  { key: 'airport',    label: 'Any airport',   hint: 'Arrivals and departures together' },
  { key: 'touring',    label: 'In-tour',       hint: 'Everything that is not an airport run' },
]

export type TimeBucket = 'early' | 'morning' | 'afternoon' | 'night' | 'none'

export const TIME_BUCKETS: { key: TimeBucket; label: string; range: string }[] = [
  { key: 'early',     label: 'Early hours', range: '00:00–05:59' },
  { key: 'morning',   label: 'Morning',     range: '06:00–11:59' },
  { key: 'afternoon', label: 'Afternoon',   range: '12:00–17:59' },
  { key: 'night',     label: 'Evening',     range: '18:00–23:59' },
  { key: 'none',      label: 'No time',     range: 'Nothing set yet' },
]

export function timeBucket(row: McFilterRow): TimeBucket {
  const t = movementFlow(row).time
  if (!t) return 'none'
  const h = Number(t.slice(0, 2))
  return h < 6 ? 'early' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night'
}

export type DriverState = 'needs' | 'assigned' | 'na'

export const DRIVER_STATES: { key: DriverState; label: string }[] = [
  { key: 'needs',    label: 'Needs allocation' },
  { key: 'assigned', label: 'Allocated' },
  { key: 'na',       label: 'No driver needed' },
]

/** A tour vendor counts as an allocation, the same as on the Ops Board. */
export function driverState(row: McFilterRow): DriverState {
  if (row.isHotelOnlyBooking || row.isHotelOnly || row.isLeisure) return 'na'
  const allocated = row.driverId || row.driverName || row.vendorId || row.vendorName
    || row.tourVendorId || row.tourVendorName
  return allocated ? 'assigned' : 'needs'
}

export type TripStage = 'first' | 'mid' | 'last'

export const TRIP_STAGES: { key: TripStage; label: string }[] = [
  { key: 'first', label: 'First day' },
  { key: 'mid',   label: 'Mid-tour' },
  { key: 'last',  label: 'Last day' },
]

/** A one-day file is both its first and its last day. */
export function tripStages(row: McFilterRow): TripStage[] {
  const out: TripStage[] = []
  if (row.arrivalDate && row.date === row.arrivalDate) out.push('first')
  if (row.departureDate && row.date === row.departureDate) out.push('last')
  return out.length ? out : ['mid']
}

export type FlagKey = 'children' | 'mealPref' | 'specialReq' | 'hotelOnly' | 'leisure' | 'bigGroup'

export const FLAGS: { key: FlagKey; label: string }[] = [
  { key: 'children',   label: 'Children on board' },
  { key: 'bigGroup',   label: 'Group 6+ pax' },
  { key: 'mealPref',   label: 'Meal preference' },
  { key: 'specialReq', label: 'Special request' },
  { key: 'leisure',    label: 'Leisure day' },
  { key: 'hotelOnly',  label: 'Hotel only' },
]

function hasFlag(row: McFilterRow, flag: FlagKey): boolean {
  switch (flag) {
    case 'children':   return row.paxChildren > 0
    case 'bigGroup':   return row.paxAdults + row.paxChildren >= 6
    case 'mealPref':   return !!row.mealPrefs?.length
    case 'specialReq': return !!row.bookingRequests?.length || !!row.mcDetails?.specialRequest
    case 'leisure':    return row.isLeisure
    case 'hotelOnly':  return row.isHotelOnly || row.isHotelOnlyBooking
  }
}

export type CancelMode = 'show' | 'hide' | 'only'

function isCancelled(row: McFilterRow): boolean {
  return row.bookingStatus === 'CANCELLED' || row.bookingStatus === 'PENDING_CANCELLATION'
}

/** Name in the Driver / Vendor column — the one people search the chart by. */
export function allocatedName(row: McFilterRow): string | null {
  return row.driverName || row.vendor || row.tourVendorName || null
}

// ─── Filter state ────────────────────────────────────────────────────────────

export interface AdvancedFilters {
  flow:      FlowFilter
  times:     TimeBucket[]
  driver:    DriverState[]
  stages:    TripStage[]
  airports:  string[]
  agents:    string[]
  locations: string[]
  drivers:   string[]
  flags:     FlagKey[]
  cancelled: CancelMode
}

export const EMPTY_FILTERS: AdvancedFilters = {
  flow: 'all', times: [], driver: [], stages: [], airports: [],
  agents: [], locations: [], drivers: [], flags: [], cancelled: 'show',
}

export type FilterField = keyof AdvancedFilters

/** How many separate filters are switched on — the badge on the panel toggle. */
export function activeFilterCount(f: AdvancedFilters): number {
  return (f.flow !== 'all' ? 1 : 0) + (f.cancelled !== 'show' ? 1 : 0)
    + [f.times, f.driver, f.stages, f.airports, f.agents, f.locations, f.drivers, f.flags]
      .filter(a => a.length > 0).length
}

/** Unset values pass; within a facet any selected value matches; facets AND together. */
function passes(row: McFilterRow, f: AdvancedFilters, skip?: FilterField): boolean {
  if (skip !== 'flow' && f.flow !== 'all') {
    const m = movementFlow(row)
    const ok = f.flow === 'arrivals'   ? m.arrival
             : f.flow === 'departures' ? m.departure
             : f.flow === 'airport'    ? m.arrival || m.departure
             : !m.arrival && !m.departure
    if (!ok) return false
  }
  if (skip !== 'times'    && f.times.length    && !f.times.includes(timeBucket(row))) return false
  if (skip !== 'driver'   && f.driver.length   && !f.driver.includes(driverState(row))) return false
  if (skip !== 'stages'   && f.stages.length   && !tripStages(row).some(s => f.stages.includes(s))) return false
  if (skip !== 'airports' && f.airports.length) {
    const a = movementFlow(row).airport
    if (!a || !f.airports.includes(a)) return false
  }
  if (skip !== 'agents'    && f.agents.length    && !f.agents.includes(row.agent ?? '')) return false
  if (skip !== 'locations' && f.locations.length && !f.locations.includes(row.location)) return false
  if (skip !== 'drivers'   && f.drivers.length) {
    const n = allocatedName(row)
    if (!f.drivers.includes(n ?? '')) return false
  }
  // Flags narrow: "children" + "meal preference" means rows with both.
  if (skip !== 'flags' && f.flags.length && !f.flags.every(fl => hasFlag(row, fl))) return false
  if (skip !== 'cancelled' && f.cancelled !== 'show') {
    if (f.cancelled === 'hide' &&  isCancelled(row)) return false
    if (f.cancelled === 'only' && !isCancelled(row)) return false
  }
  return true
}

export function applyAdvancedFilters<R extends McFilterRow>(rows: R[], f: AdvancedFilters, skip?: FilterField): R[] {
  if (!skip && activeFilterCount(f) === 0) return rows
  return rows.filter(r => passes(r, f, skip))
}

// ─── Facet counts ────────────────────────────────────────────────────────────

/**
 * How many rows each option would leave, given every *other* filter. That is
 * what makes a chip worth clicking: "Evening 3" means three rows, now, with
 * the arrivals filter already on — not three in the whole range.
 */
export interface FacetCounts {
  flow:      Record<FlowFilter, number>
  times:     Record<TimeBucket, number>
  driver:    Record<DriverState, number>
  stages:    Record<TripStage, number>
  airports:  [string, number][]
  agents:    [string, number][]
  locations: [string, number][]
  drivers:   [string, number][]
  flags:     Record<FlagKey, number>
  cancelled: number
  /** Pax on the arrivals / departures currently passing every other filter. */
  arrivalPax:   number
  departurePax: number
}

function tally<K extends string>(keys: readonly K[], rows: McFilterRow[], get: (r: McFilterRow) => K | K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map(k => [k, 0])) as Record<K, number>
  for (const r of rows) {
    const v = get(r)
    for (const k of Array.isArray(v) ? v : [v]) out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function ranked(rows: McFilterRow[], get: (r: McFilterRow) => string | null): [string, number][] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const v = get(r)
    if (v) m.set(v, (m.get(v) ?? 0) + 1)
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function facetCounts(rows: McFilterRow[], f: AdvancedFilters): FacetCounts {
  const without = (field: FilterField) => applyAdvancedFilters(rows, f, field)

  const flowRows = without('flow')
  const flow: Record<FlowFilter, number> = { all: flowRows.length, arrivals: 0, departures: 0, airport: 0, touring: 0 }
  let arrivalPax = 0, departurePax = 0
  for (const r of flowRows) {
    const m = movementFlow(r)
    const pax = isCancelled(r) ? 0 : r.paxAdults + r.paxChildren
    if (m.arrival)   { flow.arrivals   += 1; arrivalPax   += pax }
    if (m.departure) { flow.departures += 1; departurePax += pax }
    if (m.arrival || m.departure) flow.airport += 1; else flow.touring += 1
  }

  const flagRows = without('flags')
  return {
    flow,
    times:     tally(TIME_BUCKETS.map(t => t.key), without('times'), timeBucket),
    driver:    tally(DRIVER_STATES.map(d => d.key), without('driver'), driverState),
    stages:    tally(TRIP_STAGES.map(s => s.key), without('stages'), tripStages),
    airports:  ranked(without('airports'),  r => movementFlow(r).airport),
    agents:    ranked(without('agents'),    r => r.agent),
    locations: ranked(without('locations'), r => r.location),
    drivers:   ranked(without('drivers'),   allocatedName),
    flags:     Object.fromEntries(FLAGS.map(fl => [fl.key, flagRows.filter(r => hasFlag(r, fl.key)).length])) as Record<FlagKey, number>,
    cancelled: without('cancelled').filter(isCancelled).length,
    arrivalPax, departurePax,
  }
}

// ─── Quick views ─────────────────────────────────────────────────────────────

/** One-click combinations for the questions the desk asks every morning. */
export const QUICK_VIEWS: { key: string; label: string; hint: string; filters: Partial<AdvancedFilters> }[] = [
  { key: 'arr-unalloc', label: 'Arrivals without a driver', hint: 'Guests landing with nobody allocated to meet them',
    filters: { flow: 'arrivals', driver: ['needs'], cancelled: 'hide' } },
  { key: 'dep-unalloc', label: 'Departures without a driver', hint: 'Airport drops nobody is booked for yet',
    filters: { flow: 'departures', driver: ['needs'], cancelled: 'hide' } },
  { key: 'redeye', label: 'Late & early flights', hint: 'Airport runs between 18:00 and 06:00',
    filters: { flow: 'airport', times: ['night', 'early'], cancelled: 'hide' } },
  { key: 'unalloc', label: 'Everything unallocated', hint: 'Every movement that still needs a driver or vendor',
    filters: { driver: ['needs'], cancelled: 'hide' } },
  { key: 'no-time', label: 'Missing a time', hint: 'No flight time and no meeting time — the driver has nothing to work to',
    filters: { times: ['none'], driver: ['needs', 'assigned'], cancelled: 'hide' } },
  { key: 'kids', label: 'Kids on board', hint: 'Child seats and family pacing',
    filters: { flags: ['children'], cancelled: 'hide' } },
]

export function quickViewFilters(key: string): AdvancedFilters | null {
  const v = QUICK_VIEWS.find(q => q.key === key)
  return v ? { ...EMPTY_FILTERS, ...v.filters } : null
}

/** Whether the current filters are exactly a quick view — lights its chip. */
export function matchingQuickView(f: AdvancedFilters): string | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  return QUICK_VIEWS.find(q => same({ ...EMPTY_FILTERS, ...q.filters }, f))?.key ?? null
}

// ─── URL ─────────────────────────────────────────────────────────────────────

/**
 * Advanced filters live in the address bar, so "arrivals without a driver,
 * this week" is a link the desk can paste into chat — and a reload keeps it.
 */
const LIST_FIELDS = ['times', 'driver', 'stages', 'airports', 'agents', 'locations', 'drivers', 'flags'] as const

export function filtersToParams(f: AdvancedFilters, into: URLSearchParams) {
  into.delete('flow'); into.delete('cancelled')
  for (const k of LIST_FIELDS) into.delete(k)
  if (f.flow !== 'all') into.set('flow', f.flow)
  if (f.cancelled !== 'show') into.set('cancelled', f.cancelled)
  for (const k of LIST_FIELDS) if (f[k].length) into.set(k, (f[k] as string[]).join('|'))
}

export function filtersFromParams(p: URLSearchParams): AdvancedFilters {
  const list = <T extends string>(k: string, allowed?: readonly T[]) =>
    (p.get(k)?.split('|').filter(Boolean) ?? []).filter(v => !allowed || allowed.includes(v as T)) as T[]
  const flow = p.get('flow') as FlowFilter | null
  const cancelled = p.get('cancelled') as CancelMode | null
  return {
    flow:      flow && FLOW_OPTIONS.some(o => o.key === flow) ? flow : 'all',
    cancelled: cancelled === 'hide' || cancelled === 'only' ? cancelled : 'show',
    times:     list('times',  TIME_BUCKETS.map(t => t.key)),
    driver:    list('driver', DRIVER_STATES.map(d => d.key)),
    stages:    list('stages', TRIP_STAGES.map(s => s.key)),
    flags:     list('flags',  FLAGS.map(fl => fl.key)),
    airports:  list('airports'),
    agents:    list('agents'),
    locations: list('locations'),
    drivers:   list('drivers'),
  }
}
