/**
 * Parsing Aahaas flight orders out of `aahaas_flight_bookingsv2`.
 *
 * Flight lines in `checkouts_more_data` are near-empty — `product_id = 0`, blank
 * `product_name`, zero quantities — so everything meaningful about a flight order
 * lives in this table's two JSON blobs:
 *
 *   `requested_data`  what the customer searched and who is travelling
 *                     · searchData.routes[].fromCode / .toCode
 *                     · summary.passengerCounts.{adults,children,infants}
 *                     · passengers.adults[].firstName / .lastName
 *   `response_data`   what Sabre confirmed
 *                     · data.fetchPnr.journeys[].firstAirportCode / .lastAirportCode
 *                     · data.fetchPnr.flights[].{fromAirportCode,toAirportCode,departureDate}
 *
 * Note the older `aahaas_flight_bookings` table is dead — it stops at order ~8424
 * and stores `adults` as a JSON passenger array rather than a count. Only v2 is
 * written for current orders.
 *
 * Every accessor here is defensive: these are third-party GDS payloads whose shape
 * varies by provider and booking stage, so a missing branch yields null rather
 * than throwing and failing the whole import run.
 */

export interface ParsedFlightBooking {
  orderId: number
  pnr: string | null
  provider: string | null
  /** Ordered route legs as IATA pairs, e.g. [{ from: 'CMB', to: 'NRT' }]. */
  route: { from: string; to: string }[]
  /** Outbound destination IATA — the trip's actual destination, not the return leg. */
  destinationCode: string | null
  originCode: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  leadPassengerName: string | null
  /** Earliest departure / latest arrival date across confirmed flights ('YYYY-MM-DD'). */
  firstDepartureDate: string | null
  lastArrivalDate: string | null
}

/** Safe nested read: `pick(obj, 'a', 'b', 0, 'c')`. Returns undefined on any miss. */
function pick(root: unknown, ...path: (string | number)[]): unknown {
  let cur = root
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined
    if (typeof key === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[key]
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined
      cur = (cur as Record<string, unknown>)[key]
    }
  }
  return cur
}

function asInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
}

function asIata(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const code = v.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : null
}

function asDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim())
  return m ? m[1] : null
}

function parseJson(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Build a {@link ParsedFlightBooking} from a v2 row.
 *
 * Route resolution prefers the *requested* search (`searchData.routes`) over the
 * confirmed PNR, because the search states the customer's intent directly: for a
 * return trip `routes[0].toCode` is the destination, whereas the PNR's flight list
 * ends back at the origin and would resolve the destination to home.
 */
export function parseFlightBooking(row: {
  order_id: number
  pnr: string | null
  flight_provider: string | null
  requested_data: string | null
  response_data: string | null
}): ParsedFlightBooking {
  const req = parseJson(row.requested_data)
  const res = parseJson(row.response_data)

  // ── Route ───────────────────────────────────────────────────────────────────
  const route: { from: string; to: string }[] = []
  const routes = pick(req, 'searchData', 'routes')
  if (Array.isArray(routes)) {
    for (const r of routes) {
      const from = asIata(pick(r, 'fromCode'))
      const to = asIata(pick(r, 'toCode'))
      if (from && to) route.push({ from, to })
    }
  }
  // Fall back to the confirmed journeys when the search block is absent.
  if (route.length === 0) {
    const journeys = pick(res, 'data', 'fetchPnr', 'journeys')
    if (Array.isArray(journeys)) {
      for (const j of journeys) {
        const from = asIata(pick(j, 'firstAirportCode'))
        const to = asIata(pick(j, 'lastAirportCode'))
        if (from && to) route.push({ from, to })
      }
    }
  }

  const originCode = route[0]?.from ?? null
  // First leg's arrival is the destination; a return leg back to origin is ignored.
  const destinationCode =
    route.find((leg) => leg.to !== originCode)?.to ?? route[0]?.to ?? null

  // ── Pax ─────────────────────────────────────────────────────────────────────
  // Two equivalent blocks exist; `summary` is post-validation so it wins.
  let paxAdults = asInt(pick(req, 'summary', 'passengerCounts', 'adults'))
  let paxChildren = asInt(pick(req, 'summary', 'passengerCounts', 'children'))
  let paxInfants = asInt(pick(req, 'summary', 'passengerCounts', 'infants'))

  if (paxAdults + paxChildren === 0) {
    paxAdults = asInt(pick(req, 'searchData', 'passengersClass', 'passengers', 'adults'))
    paxChildren = asInt(pick(req, 'searchData', 'passengersClass', 'passengers', 'children'))
    paxInfants = asInt(pick(req, 'searchData', 'passengersClass', 'passengers', 'infants'))
  }
  if (paxAdults + paxChildren === 0) {
    const adults = pick(req, 'passengers', 'adults')
    const children = pick(req, 'passengers', 'children')
    if (Array.isArray(adults)) paxAdults = adults.length
    if (Array.isArray(children)) paxChildren = children.length
  }

  // ── Lead passenger ──────────────────────────────────────────────────────────
  let leadPassengerName: string | null = null
  const firstAdult = pick(req, 'passengers', 'adults', 0)
  const first = typeof pick(firstAdult, 'firstName') === 'string' ? String(pick(firstAdult, 'firstName')) : ''
  const last = typeof pick(firstAdult, 'lastName') === 'string' ? String(pick(firstAdult, 'lastName')) : ''
  const joined = `${first} ${last}`.replace(/\s+/g, ' ').trim()
  if (joined) leadPassengerName = joined

  // ── Dates from the confirmed flights ────────────────────────────────────────
  const depDates: string[] = []
  const arrDates: string[] = []
  const flights = pick(res, 'data', 'fetchPnr', 'flights')
  if (Array.isArray(flights)) {
    for (const f of flights) {
      const d = asDate(pick(f, 'departureDate'))
      const a = asDate(pick(f, 'arrivalDate'))
      if (d) depDates.push(d)
      if (a) arrDates.push(a)
    }
  }
  depDates.sort()
  arrDates.sort()

  return {
    orderId: Number(row.order_id),
    pnr: row.pnr?.trim() || null,
    provider: row.flight_provider?.trim() || null,
    route,
    destinationCode,
    originCode,
    paxAdults,
    paxChildren,
    paxInfants,
    leadPassengerName,
    firstDepartureDate: depDates[0] ?? null,
    lastArrivalDate: arrDates[arrDates.length - 1] ?? null,
  }
}

/** Human-readable route, e.g. "CMB → NRT → CMB". Null when no route was parsed. */
export function describeRoute(parsed: ParsedFlightBooking): string | null {
  if (parsed.route.length === 0) return null
  const stops = [parsed.route[0].from, ...parsed.route.map((r) => r.to)]
  return stops.join(' → ')
}
