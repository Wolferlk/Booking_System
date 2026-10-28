/**
 * Ticket data from the Aahaas store's own flight booking — for when nobody has
 * the e-ticket PDF to hand. Read-only (`fetchFlightBookings` → b2cQuery guard).
 *
 * Provider responses (Sabre, TravelNext, Verteil) have no one shape, so this
 * follows AahaasFlow (n8n-project `aahaas-flow/flow.flights.js`): a segment is
 * any object carrying a departure and an arrival airport; an e-ticket number is
 * 13 digits under a key that says "ticket". What is found is used; what is not
 * stays null and becomes a warning.
 *
 * ⚠️ An e-ticket number is put beside a passenger only when the response pairs
 * them (a name next to the number), or when there is exactly one of each. A
 * guessed pairing would print someone else's ticket number on a ticket.
 */
import { fetchFlightBookings } from '@/lib/b2c-db'
import { cityForAirport } from './airports'
import type { FlightTicketData, TicketPassenger, TicketPoint, TicketSegment } from './types'

const AIRLINES: Record<string, string> = {
  UL: 'SriLankan Airlines', AI: 'Air India', IX: 'Air India Express', '6E': 'IndiGo', SG: 'SpiceJet', UK: 'Vistara',
  EK: 'Emirates', QR: 'Qatar Airways', EY: 'Etihad Airways', FZ: 'flydubai', G9: 'Air Arabia', WY: 'Oman Air',
  GF: 'Gulf Air', SV: 'Saudia', TK: 'Turkish Airlines', SQ: 'Singapore Airlines', TR: 'Scoot', MH: 'Malaysia Airlines',
  AK: 'AirAsia', D7: 'AirAsia X', OD: 'Batik Air Malaysia', TG: 'Thai Airways', FD: 'Thai AirAsia', CX: 'Cathay Pacific',
  VN: 'Vietnam Airlines', VJ: 'VietJet Air', QH: 'Bamboo Airways', MU: 'China Eastern', CA: 'Air China', CZ: 'China Southern',
  KE: 'Korean Air', OZ: 'Asiana Airlines', JL: 'Japan Airlines', NH: 'ANA', BA: 'British Airways', LH: 'Lufthansa',
  AF: 'Air France', KL: 'KLM', QF: 'Qantas', '8D': 'FitsAir', '8M': 'Myanmar Airways', BG: 'Biman Bangladesh',
  PK: 'PIA', KU: 'Kuwait Airways', MS: 'EgyptAir', ET: 'Ethiopian Airlines', MK: 'Air Mauritius', HM: 'Air Seychelles',
}

const parse = (v: unknown): unknown => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'object') return v
  try {
    const once = JSON.parse(String(v))
    return typeof once === 'string' ? JSON.parse(once) : once
  } catch {
    return null
  }
}
const str = (v: unknown): string | null => {
  const t = String(v ?? '').trim()
  return t && t !== 'null' && t !== 'undefined' ? t : null
}
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const pickKey = (o: Record<string, unknown>, re: RegExp) => Object.keys(o).find((k) => re.test(k))

function airportOf(v: unknown): string | null {
  if (typeof v === 'string') return /^[A-Z]{3}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null
  const o = obj(v)
  if (!o) return null
  for (const k of ['airport', 'airportCode', 'iataCode', 'code', 'locationCode', 'iata', 'IATALocationCode']) {
    const a = airportOf(o[k])
    if (a) return a
  }
  return null
}

/** "2026-11-10T08:15:00" / "2026-11-10 08:15" → { date, time }. */
function splitWhen(v: string | null): { date: string | null; time: string | null } {
  if (!v) return { date: null, time: null }
  const date = /(\d{4}-\d{2}-\d{2})/.exec(v)?.[1] ?? null
  const time = /(?:T|\s)([01]\d|2[0-3]):([0-5]\d)/.exec(v)
  return { date, time: time ? `${time[1]}:${time[2]}` : null }
}

function whenOf(o: Record<string, unknown>, side: 'departure' | 'arrival' | 'depart' | 'arrive'): string | null {
  const nestedKey = pickKey(o, new RegExp(`^${side}(ure)?$`, 'i'))
  const nested = nestedKey ? obj(o[nestedKey]) : null
  const date = nested ? str(nested.departureDate ?? nested.arrivalDate ?? nested.date) : null
  const time = nested ? str(nested.time) : null
  if (date && time && !/T|\d:\d/.test(date)) return `${date} ${time}`
  const dt = pickKey(o, new RegExp(`^${side}.*datetime$`, 'i'))
  const d = pickKey(o, new RegExp(`^${side}.*date$`, 'i'))
  const t = pickKey(o, new RegExp(`^${side}.*time$`, 'i'))
  const whole = [dt ? o[dt] : null, nested?.dateTime].map(str).find((v) => v && /\d{4}-\d{2}-\d{2}.\d{2}:\d{2}/.test(v))
  if (whole) return whole
  // Date and time in separate fields ("departureDate" + "departureTime").
  const dPart = str(d ? o[d] : null) ?? str(nested?.date)
  const tPart = str(t && t !== dt ? o[t] : null)
  if (dPart && tPart && /^\d{1,2}:\d{2}/.test(tPart)) return `${dPart.slice(0, 10)} ${tPart.slice(0, 5)}`
  return [dt ? o[dt] : null, dPart, nested?.dateTime].map(str).find(Boolean) ?? null
}

interface RawSegment { from: string; to: string; depart: string | null; arrive: string | null; carrier: string | null; number: string | null; cabin: string | null }

function segmentFrom(o: Record<string, unknown>): RawSegment | null {
  const depKey = pickKey(o, /^(departure|depart|origin|from)(airport|code|location)?$/i)
  const arrKey = pickKey(o, /^(arrival|arrive|destination|to)(airport|code|location)?$/i)
  if (!depKey || !arrKey) return null
  const from = airportOf(o[depKey])
  const to = airportOf(o[arrKey])
  if (!from || !to || from === to) return null
  const carrierKey = pickKey(o, /^(carrier|marketing|operating|airline)/i)
  const carrierRaw = carrierKey ? o[carrierKey] : null
  const carrierObj = obj(carrierRaw)
  const carrier = str(carrierObj ? carrierObj.marketing ?? carrierObj.code ?? carrierObj.airlineCode ?? carrierObj.carrierCode : carrierRaw)
  const numKey = pickKey(o, /^(flight)?(number|no)$|^marketingFlightNumber$|^flightNumber$/i)
  const number = str((numKey ? o[numKey] : null) ?? carrierObj?.marketingFlightNumber ?? carrierObj?.flightNumber)
  const cabinKey = pickKey(o, /^(cabin|cabinCode|cabinClass|cabinType|cabinTypeName|cabinName|bookingClass|class)$/i)
  return {
    from, to,
    depart: whenOf(o, 'departure') ?? whenOf(o, 'depart'),
    arrive: whenOf(o, 'arrival') ?? whenOf(o, 'arrive'),
    carrier: carrier && carrier.length <= 3 ? carrier.toUpperCase() : carrier,
    number,
    cabin: cabinKey ? str(o[cabinKey]) : null,
  }
}

function walk(root: unknown, visit: (o: Record<string, unknown>) => void): void {
  let seen = 0
  const go = (node: unknown, depth: number) => {
    if (!node || depth > 9 || seen > 20_000) return
    seen += 1
    if (Array.isArray(node)) { for (const x of node) go(x, depth + 1); return }
    const o = obj(node)
    if (!o) return
    visit(o)
    for (const v of Object.values(o)) if (v && typeof v === 'object') go(v, depth + 1)
  }
  go(root, 0)
}

function segmentsOf(root: unknown): RawSegment[] {
  const out: RawSegment[] = []
  const keys = new Set<string>()
  walk(root, (o) => {
    const s = segmentFrom(o)
    if (!s) return
    const key = `${s.from}${s.to}${s.depart ?? ''}${s.number ?? ''}`
    if (!keys.has(key) && out.length < 12) { keys.add(key); out.push(s) }
  })
  return out
}

const norm = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '')

/** Ticket numbers, and — where the response puts a name beside one — whose it is. */
function ticketsOf(root: unknown): { all: string[]; byName: Map<string, string> } {
  const all = new Set<string>()
  const byName = new Map<string, string>()
  walk(root, (o) => {
    let ticket: string | null = null
    for (const [k, v] of Object.entries(o)) {
      if ((typeof v === 'string' || typeof v === 'number') && /ticket/i.test(k)) {
        const t = String(v).replace(/[\s-]/g, '')
        if (/^\d{13}$/.test(t)) { ticket = t; all.add(t) }
      }
    }
    if (!ticket) return
    const first = str(o.firstName ?? o.givenName ?? o.first_name)
    const last = str(o.lastName ?? o.surname ?? o.last_name)
    const whole = str(o.passengerName ?? o.travelerName ?? o.name)
    const name = [first, last].filter(Boolean).join(' ') || whole
    if (name) byName.set(norm(name), ticket)
  })
  return { all: Array.from(all), byName }
}

function point(code: string, when: string | null): TicketPoint {
  const { date, time } = splitWhen(when)
  return { code, airport: null, city: cityForAirport(code), time, date }
}

/** Null when the store has no flight booking for the order. */
export async function ticketDataFromStore(orderId: number): Promise<FlightTicketData | null> {
  const rows = await fetchFlightBookings([orderId])
  // The latest row is the live booking after a re-price or reissue.
  const row = rows[rows.length - 1]
  return row ? ticketDataFromRow(orderId, row) : null
}

/** One `aahaas_flight_bookingsv2` row → ticket data. Pure. */
export function ticketDataFromRow(
  orderId: number,
  row: { pnr: string | null; requested_data: string | null; response_data: string | null },
): FlightTicketData {
  const requested = obj(parse(row.requested_data)) ?? {}
  const response = parse(row.response_data)
  const warnings: string[] = []

  const people = Array.isArray(parse(requested.allPassengers)) ? (parse(requested.allPassengers) as unknown[])
    : Object.values(obj(requested.passengers) ?? {}).flatMap((g) => (Array.isArray(g) ? g : []))
  const { all: tickets, byName } = ticketsOf(response)

  const passengers: TicketPassenger[] = people
    .map((p) => obj(p))
    .filter((p): p is Record<string, unknown> => Boolean(p))
    .map((p) => {
      const first = str(p.firstName ?? p.givenName)
      const last = str(p.lastName ?? p.surname)
      const name = [first, last].filter(Boolean).join(' ')
      const rawType = (str(p.type ?? p.passengerType ?? p.ptc) ?? '').toUpperCase()
      const type = /^(ADT|ADULT)/.test(rawType) ? 'Adult' : /^(CHD|CNN|CHILD)/.test(rawType) ? 'Child' : /^(INF|INFANT)/.test(rawType) ? 'Infant' : str(p.type)
      return { name, type, eticket: byName.get(norm(name)) ?? null }
    })
    .filter((p) => p.name)

  if (passengers.length === 1 && !passengers[0].eticket && tickets.length === 1) passengers[0].eticket = tickets[0]
  if (tickets.length > 0 && passengers.some((p) => !p.eticket)) {
    warnings.push(`E-ticket numbers on file (${tickets.join(', ')}) could not be matched to passengers — upload the e-ticket PDF or type them in.`)
  }

  // Confirmed segments from the response; else the itinerary the request carried; else the searched routes.
  let raw = segmentsOf(response)
  if (raw.length === 0) raw = segmentsOf(parse(requested.revalidationData) ?? requested)
  const segments: TicketSegment[] = raw.map((s) => ({
    airline: s.carrier ? AIRLINES[s.carrier] ?? s.carrier : null,
    flightNo: s.number ? `${s.carrier && !s.number.startsWith(s.carrier) ? `${s.carrier} ` : ''}${s.number}` : null,
    cabin: s.cabin && s.cabin.length > 2 ? s.cabin : s.cabin === 'Y' ? 'Economy' : s.cabin === 'C' || s.cabin === 'J' ? 'Business' : s.cabin === 'F' ? 'First' : null,
    status: null,
    from: point(s.from, s.depart),
    to: point(s.to, s.arrive),
    duration: null,
    checkedBaggage: null,
    cabinBaggage: null,
    meal: null,
  }))
  if (segments.length === 0) {
    const routes = (obj(requested.searchData)?.routes ?? []) as unknown[]
    for (const r of Array.isArray(routes) ? routes : []) {
      const o = obj(r)
      const from = airportOf(o?.fromCode ?? o?.from)
      const to = airportOf(o?.toCode ?? o?.to)
      if (!from || !to) continue
      segments.push({
        airline: null, flightNo: null, cabin: null, status: null,
        from: point(from, str(o?.date)), to: point(to, null),
        duration: null, checkedBaggage: null, cabinBaggage: null, meal: null,
      })
    }
    if (segments.length) warnings.push('Only the searched route is on file — flight number and times are missing. Upload the e-ticket PDF.')
  }
  if (segments.length === 0) warnings.push('No flight could be read from the store booking — upload the e-ticket PDF.')
  if (segments.length && segments.every((s) => !s.checkedBaggage)) warnings.push('Baggage is not on the store booking — it prints as "—" unless you add it or upload the e-ticket PDF.')

  const contact = obj(requested.contactInformation)
  const airlineLocator = (() => {
    let found: string | null = null
    walk(response, (o) => {
      if (found) return
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && /(airline|vendor|carrier)(record)?locator|airlinePnr|airlineConfirmation/i.test(k) && /^[A-Z0-9]{5,8}$/i.test(v.trim())) {
          found = v.trim().toUpperCase()
          return
        }
      }
    })
    return found
  })()

  return {
    orderId: String(orderId),
    bookingRef: row.pnr?.trim().toUpperCase() || null,
    airlinePnr: airlineLocator,
    status: tickets.length ? 'TICKETED' : null,
    issuedOn: null,
    passengers,
    segments,
    contact: {
      phone: str(contact?.formattedPhoneNumber) ?? str(contact?.phoneNumber),
      email: str(contact?.email)?.toLowerCase() ?? null,
    },
    refundable: null,
    dateChange: null,
    source: 'store',
    warnings,
  }
}
