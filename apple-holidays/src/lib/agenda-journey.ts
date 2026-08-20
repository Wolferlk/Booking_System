/**
 * Agenda Journey — the movement chart (MC) as a geographic route.
 *
 * The itinerary map in `src/lib/journey-map.ts` answers "roughly where does
 * each marketing day happen". This one answers the operational question: for
 * every row the AI wrote onto the movement chart, *where does the vehicle pick
 * the guests up, where does it drop them, what is carrying them, and which
 * hotel do they sleep in that night*. The agenda already holds all four —
 * `fromPoint`, `toPoint`, `serviceType`, and a date we can match against the
 * accommodation stays — so unlike the itinerary map nothing has to be guessed
 * from marketing prose. The model is used for one job only: turning place
 * names into coordinates.
 *
 * Rules carried over from the itinerary map, deliberately:
 *   • Nothing here writes to the database. The route is derived on read and
 *     cached in process memory, keyed by the agenda's `updatedAt`.
 *   • Coordinates come from the model first and are refined by Nominatim,
 *     never blocked on it — a cold geocoder must not stall the panel.
 *   • It never throws. A model outage produces fewer pins, not a broken page.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { geoCache, nominatim, haversineKm, type StopKind, type JourneyHotel } from '@/lib/journey-map'
import { roadLegs } from '@/lib/road-route'
import { serviceTypeLabel, serviceTypeShortLabel } from '@/lib/service-types'

const MODEL = () => process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini'

// ─── Transport vocabulary ────────────────────────────────────────────────

/**
 * How the guests actually move on a leg, collapsed from the thirteen
 * `ServiceType` values into the handful of things worth drawing differently.
 * The emoji is what rides the route line on the map, so a seat-in-coach leg
 * visibly runs a coach and a private transfer visibly runs a car.
 */
export type TransportMode = 'private' | 'sic' | 'flight' | 'own' | 'ticket' | 'hotel' | 'meal'

export interface Transport {
  mode: TransportMode
  /** "SIC Transfer", "PVT Transfer + Ticket" — the operator's own wording. */
  label: string
  /** Dense form for chips: "SIC", "PVT + Ticket". */
  short: string
  /** Vehicle glyph drawn on the route line. */
  emoji: string
  /** Tailwind-free hex so the same value works in Leaflet HTML and in React. */
  hex: string
}

const MODE_STYLE: Record<TransportMode, { emoji: string; hex: string }> = {
  private: { emoji: '🚗', hex: '#4f46e5' },  // car
  sic:     { emoji: '🚌', hex: '#0891b2' },  // coach
  flight:  { emoji: '✈️', hex: '#7c3aed' },  // plane
  own:     { emoji: '🚶', hex: '#64748b' },  // on foot / own arrangement
  ticket:  { emoji: '🎫', hex: '#d97706' },  // ticket only
  hotel:   { emoji: '🏨', hex: '#ea580c' },  // hotel only
  meal:    { emoji: '🍽️', hex: '#16a34a' },
}

/** Service type → how it moves. Order matters: the combos are checked first. */
export function transportFor(serviceType: string | null | undefined): Transport {
  const v = String(serviceType ?? '').toUpperCase()
  const mode: TransportMode =
    v === 'FLIGHT' ? 'flight'
    : v === 'ACCOMMODATION' ? 'hotel'
    : v === 'MEAL_COUPON' ? 'meal'
    : v === 'INTERNAL_TOUR' ? 'ticket'
    : v === 'OWN_ARRANGEMENT' ? 'own'
    // PVT_TRANSFER_SIC_TOUR carries a private vehicle to a shared tour; the
    // vehicle is what rides the map, so it reads as private.
    : v.startsWith('PVT_') ? 'private'
    : v.startsWith('SIC_') ? 'sic'
    : 'own'

  return {
    mode,
    label: serviceTypeLabel(v) || 'Movement',
    short: serviceTypeShortLabel(v) || 'Move',
    ...MODE_STYLE[mode],
  }
}

// ─── Types ───────────────────────────────────────────────────────────────

export interface AgendaStopHotel {
  name: string
  city: string | null
  lat: number | null
  lng: number | null
  /** Set when this row is the night the guests check in to that hotel. */
  checkIn: boolean
  /** What was booked in the room — the traveller's card names it. */
  roomType: string | null
  mealType: string | null
  nights: number | null
  checkInDate: string | null
  checkOutDate: string | null
}

/**
 * Where a booked sector sits in the shape of the trip.
 *
 * `inbound` brings the guests into the operating country and `outbound` takes
 * them home — both already have a pin, because the movement chart opens with an
 * airport pickup and closes with an airport drop-off. `internal` is the one the
 * chart cannot express: a sector *between* two destinations we operate, whose
 * airport-to-airport hop exists only in the flight list. Drawing it is the
 * difference between a route that teleports from Ho Chi Minh to Da Nang and one
 * that visibly flies.
 */
export type FlightSector = 'inbound' | 'internal' | 'outbound'

/** A booked flight, resolved to two real airports. */
export interface FlightInfo {
  id: string
  flightNo: string
  airline: string | null
  /** Calendar day, `yyyy-mm-dd` — never an instant, see `dayKey`. */
  date: string
  fromApt: string
  toApt: string
  /** Resolved airport names, null when neither the model nor OSM knew them. */
  fromName: string | null
  toName: string | null
  fromCity: string | null
  toCity: string | null
  fromCountry: string | null
  toCountry: string | null
  fromLat: number | null
  fromLng: number | null
  toLat: number | null
  toLng: number | null
  depTime: string | null
  arrTime: string | null
  sector: FlightSector
  /** Great-circle km between the two airports. */
  km: number | null
  /** Gate-to-gate minutes when both times parse, same-day only. */
  durationMin: number | null
}

/** Why a flight is attached to a stop. */
export type FlightRole =
  /** The stop *is* the sector — the airport-to-airport hop itself. */
  | 'sector'
  /** The stop drops the guests at the departure airport for it. */
  | 'to-airport'
  /** The stop collects them from the arrival airport after it. */
  | 'from-airport'

/**
 * One movement chart row placed on the map.
 *
 * Structurally a superset of `JourneyStop`, so the same map component renders
 * both sources. The pin sits on the movement's *destination* — where the guests
 * end up — and `from*` describes where they were collected.
 */
export interface AgendaStop {
  id: string
  dayNo: number
  date: string | null
  /** "Colombo Airport → Sigiriya" — the movement, read as one line. */
  title: string
  description: string | null
  place: string
  city: string | null
  country: string | null
  kind: StopKind
  lat: number
  lng: number
  source: 'osm' | 'model'
  legKm: number | null

  // ── Agenda-only ──
  fromPlace: string | null
  toPlace: string | null
  fromLat: number | null
  fromLng: number | null
  /** Straight-line km of this row's own from → to movement. */
  moveKm: number | null
  transport: Transport
  timeFrom: string | null
  timeTo: string | null
  meetingTime: string | null
  mealPlan: string | null
  /** Nth movement within its day, 1-based — two rows can share a date. */
  legOfDay: number
  legsThatDay: number
  hotel: AgendaStopHotel | null

  // ── The road into this stop ──
  /**
   * The driving line from the previous stop to this one, as an OSRM-encoded
   * polyline (precision 5). Null when the leg is flown, or when no road
   * connects the two — the map falls back to its arc.
   */
  roadPath: string | null
  /** Driving distance and free-flow time along `roadPath`. */
  roadKm: number | null
  roadMin: number | null

  // ── Flights ──
  /** The booked sector this row is part of, if any. */
  flight: FlightInfo | null
  flightRole: FlightRole | null
  /**
   * True for a row that exists on the map only — woven in from the flight list
   * because the movement chart never had a row for that sector. Nothing here
   * is ever written back to the agenda.
   */
  synthetic: boolean
}

export interface AgendaJourney {
  stops: AgendaStop[]
  hotels: JourneyHotel[]
  countries: string[]
  totalKm: number
  degraded: boolean
  /** Which source built this route — the panel says so out loud. */
  basis: 'agenda'
  /** Distinct dates covered, so the header can say "8 days". */
  dayCount: number
  /** Every booked sector, resolved — the panel counts the internal ones. */
  flights: FlightInfo[]
  /** Road distance and free-flow driving time across every routed leg. */
  totalRoadKm: number
  totalDriveMin: number
}

export interface AgendaJourneyInput {
  bookingRef: string
  operationCountry?: string | null
  tourDestination?: string | null
  items: {
    id: string
    date: Date | string
    location: string
    fromPoint: string | null
    toPoint: string | null
    details: string | null
    serviceType: string
    timeFrom: string | null
    timeTo: string | null
    meetingTime: string | null
    mealPlan: string | null
    isLeisure: boolean | null
    sortOrder: number
  }[]
  accommodations: {
    id: string; hotel: string; city: string
    checkIn: Date | string; checkOut: Date | string; nights: number
    roomType?: string | null; mealType?: string | null
  }[]
  /** The booking's flight list. Read only — the source of the sector legs. */
  flights?: {
    id: string
    flightNo: string
    date: Date | string
    fromApt: string
    depTime: string | null
    toApt: string
    arrTime: string | null
    airline: string | null
  }[]
}

// ─── Place resolution ────────────────────────────────────────────────────

const RESOLVE_PROMPT = `You are a travel operations geographer for a tour operator.

You are given a list of place names taken from a tour movement chart — pickup and
drop-off points, activity locations and hotel names. Resolve EVERY one of them to
real-world coordinates.

Rules:
- Echo back the exact input string as "q" so the caller can match your answer.
- "place" is the cleaned, searchable name of that place (drop words like "Hotel in",
  "your hotel", room numbers, and free text). If the input names a hotel, keep the
  hotel name — hotels are mappable.
- "lat"/"lng" are your best real-world decimal coordinates. Never return 0,0.
  Never invent a place you do not know; return null lat/lng instead.
- "city" is the nearest well-known city; "country" is the country's common English name.
- An input shaped like "DAD airport" or "SGN airport" is an IATA airport code:
  resolve it to that airport's real name, city and coordinates — "DAD airport" is
  Da Nang International Airport, "SGN airport" is Tan Son Nhat International
  Airport in Ho Chi Minh City. Never treat the three letters as a town name.
- "kind" is one of: arrival, departure, transfer, flight, tour, attraction, beach,
  nature, cultural, city, cruise, hotel, leisure — what that place IS
  (an airport is "flight", a beach is "beach", a temple is "cultural", a hotel is "hotel").
- Return one object per input string, same count, no extras.

Reply with JSON only: {"places":[{"q":"...","place":"...","city":"...","country":"...","kind":"...","lat":0.0,"lng":0.0}]}`

interface ResolvedPlace {
  place: string
  city: string | null
  country: string | null
  kind: StopKind
  lat: number | null
  lng: number | null
  source: 'osm' | 'model'
}

const KINDS = new Set<StopKind>([
  'arrival', 'departure', 'transfer', 'flight', 'tour', 'attraction',
  'beach', 'nature', 'cultural', 'city', 'cruise', 'hotel', 'leisure',
])

function coerceKind(raw: unknown): StopKind {
  const k = String(raw ?? '').toLowerCase().trim() as StopKind
  return KINDS.has(k) ? k : 'transfer'
}

/**
 * Agenda rows carry operator shorthand that is not a place: "Own arrangement",
 * "At leisure", "Hotel". Mapping those would drop a pin in the middle of the
 * country, which reads as a real stop, so they are filtered out before the
 * model is asked and the row falls back to its neighbouring point.
 */
const NOT_A_PLACE = /^(n\/?a|none|-+|own arrangement|at leisure|leisure|free day|hotel|your hotel|the hotel|same|as above|tbа|tba|tbc)$/i

function cleanPlace(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s || s.length < 2 || NOT_A_PLACE.test(s)) return null
  return s
}

/**
 * Resolves every distinct place string in one model call, then refines the
 * misses with Nominatim.
 *
 * One call for the whole chart rather than one per row: a 20-row agenda has
 * maybe a dozen distinct places, and they repeat heavily (the same hotel is the
 * drop-off on Monday and the pickup on Tuesday).
 */
async function resolvePlaces(
  queries: string[],
  countryHint: string | null,
  bookingRef: string,
): Promise<{ map: Map<string, ResolvedPlace>; degraded: boolean }> {
  const map = new Map<string, ResolvedPlace>()
  const unique = Array.from(new Set(queries.map(q => q.trim()).filter(Boolean)))
  if (unique.length === 0) return { map, degraded: false }

  let raw: Record<string, unknown>[] = []
  let degraded = false
  try {
    const res = await openai.chat.completions.create({
      model: MODEL(),
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RESOLVE_PROMPT },
        { role: 'user', content: JSON.stringify({ country: countryHint, places: unique }) },
      ],
    })
    await logAiUsage({
      callType: 'agenda_journey_places',
      model: MODEL(),
      usage: res.usage,
      bookingRef,
      source: 'booking',
    })
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
    raw = Array.isArray(parsed?.places) ? parsed.places : []
  } catch (e) {
    console.warn('[agenda-journey] place resolution failed:', (e as Error).message)
    degraded = true
  }

  // Match on the echoed `q` first, then fall back to position — the model
  // occasionally rewrites the string it was told to echo.
  const byQ = new Map<string, Record<string, unknown>>()
  raw.forEach((r, i) => {
    const q = String(r?.q ?? '').trim().toLowerCase()
    const target = q && unique.some(u => u.toLowerCase() === q) ? q : unique[i]?.toLowerCase()
    if (target && !byQ.has(target)) byQ.set(target, r)
  })

  for (const q of unique) {
    const m = byQ.get(q.toLowerCase()) ?? {}
    const place = String(m.place ?? '').trim() || q
    const city = String(m.city ?? '').trim() || null
    const country = String(m.country ?? '').trim() || countryHint

    let lat = Number(m.lat)
    let lng = Number(m.lng)
    let source: 'osm' | 'model' = 'model'
    const modelOk = Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

    // Same bargain as the itinerary map: a cached geocode is free and more
    // precise than the model, a cold one is only paid for when the model failed.
    const cacheKey = `${place}${city ? `, ${city}` : ''}|${country ?? ''}`.toLowerCase()
    const cached = geoCache.get(cacheKey)
    if (cached || !modelOk) {
      const geo = cached ?? await nominatim(`${place}${city ? `, ${city}` : ''}`, country)
      if (geo) { lat = geo.lat; lng = geo.lng; source = 'osm' }
    }

    map.set(q.toLowerCase(), {
      place,
      city,
      country: country ?? null,
      kind: coerceKind(m.kind),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      source,
    })
  }

  return { map, degraded }
}

// ─── Dates ───────────────────────────────────────────────────────────────

/**
 * The agenda's dates are `DateTime` columns holding a calendar day. Comparing
 * them as instants puts a midnight-UTC row on the previous day for anyone east
 * of Greenwich, which is every country we operate in — so every date decision
 * here (day numbering, hotel matching) runs on the UTC calendar day only.
 */
function dayKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString().slice(0, 10)
}

// ─── Kind ────────────────────────────────────────────────────────────────

const AIRPORT = /\b(airport|international|intl|terminal|bia|cmb|apt)\b/i

/**
 * What the pin should look like. The service type is the strongest signal (it
 * is a chosen field, not prose), the resolved place's own nature is the
 * fallback, and the first/last airport rows become arrival/departure so the
 * route reads with a start and an end.
 */
function stopKind(opts: {
  serviceType: string
  resolved: ResolvedPlace | null
  toText: string
  isLeisure: boolean | null
  isFirst: boolean
  isLast: boolean
}): StopKind {
  const v = opts.serviceType.toUpperCase()
  const airportish = AIRPORT.test(opts.toText) || opts.resolved?.kind === 'flight'

  if (opts.isLast && airportish) return 'departure'
  if (opts.isFirst && airportish) return 'arrival'
  if (v === 'FLIGHT') return 'flight'
  if (v === 'ACCOMMODATION') return 'hotel'
  if (opts.isLeisure) return 'leisure'
  if (v.includes('TOUR')) return 'tour'

  const k = opts.resolved?.kind
  if (k && k !== 'transfer') return k
  return 'transfer'
}

// ─── Flights ─────────────────────────────────────────────────────────────

/**
 * The query we ask the resolver for an airport.
 *
 * `fromApt`/`toApt` are captured as IATA codes on every form we own, and a bare
 * "DAD" geocodes to a village in Iran. Appending the word "airport" is what
 * turns three letters into a resolvable place — see RESOLVE_PROMPT, which is
 * told to read exactly this shape as a code.
 */
function airportQuery(code: string | null | undefined): string | null {
  const s = String(code ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  return /airport/i.test(s) ? s : `${s.toUpperCase()} airport`
}

/** "09:40", "9.40", "0940" → minutes since midnight. Null when unreadable. */
function minutesOf(t: string | null | undefined): number | null {
  const m = String(t ?? '').trim().match(/^(\d{1,2})[:.h ]?(\d{2})/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h <= 23 && min <= 59 ? h * 60 + min : null
}

/**
 * How close a pin has to be to an airport before we call it the same place.
 *
 * Generous on purpose: "Da Nang Airport" on the chart and "Da Nang
 * International Airport" from the resolver can land a couple of km apart, and
 * some charts write the drop-off as the city the airport serves.
 */
const AIRPORT_MATCH_KM = 30

/**
 * Airport words that are strong enough to carry a match on their own.
 *
 * Deliberately narrower than `AIRPORT`, which is generous because it only has
 * to nudge a pin's icon. Here a false positive re-parents a whole flight onto
 * the wrong row, and `AIRPORT` matches the bare word "international" — which
 * every third hotel in Asia has in its name.
 */
const AIRPORT_STRICT = /\b(airport|airfield|aerodrome|terminal\s*\d|intl\.?\s*airport)\b/i

/** True when `code` appears in `text` as a standalone IATA token. */
function mentionsCode(text: string | null | undefined, code: string): boolean {
  const c = String(code ?? '').trim().toUpperCase()
  if (c.length !== 3) return false
  return new RegExp(`(^|[^A-Za-z])${c}([^A-Za-z]|$)`).test(String(text ?? '').toUpperCase())
}

// ─── Build ───────────────────────────────────────────────────────────────

/**
 * Turns one booking's movement chart into a mappable route.
 *
 * Never throws.
 */
export async function buildAgendaJourney(input: AgendaJourneyInput): Promise<AgendaJourney> {
  const countryHint = input.tourDestination || input.operationCountry || null

  // Chart order is date first, then the operator's own row order within the
  // day — `sortOrder` is what the agenda screen drags around.
  const items = [...input.items].sort((a, b) => {
    const d = dayKey(a.date).localeCompare(dayKey(b.date))
    return d !== 0 ? d : a.sortOrder - b.sortOrder
  })
  if (items.length === 0) {
    return { stops: [], hotels: [], countries: [], totalKm: 0, degraded: false, basis: 'agenda', dayCount: 0, flights: [], totalRoadKm: 0, totalDriveMin: 0 }
  }

  // Day numbering, leg ordering and leg distances are all computed *after* the
  // flights are woven in — an internal sector adds a row the chart never had,
  // and numbering the rows before that would leave the plane leg unnumbered
  // and the day's leg count one short.

  // Every string we might need a coordinate for, asked once.
  const queries: string[] = []
  for (const it of items) {
    for (const p of [it.fromPoint, it.toPoint, it.location]) {
      const c = cleanPlace(p)
      if (c) queries.push(c)
    }
  }
  for (const a of input.accommodations) {
    const c = cleanPlace(`${a.hotel}${a.city ? `, ${a.city}` : ''}`)
    if (c) queries.push(c)
  }
  // Both ends of every booked sector. They ride in the same call as everything
  // else — `resolvePlaces` de-duplicates, so a code that is also a chart
  // drop-off ("Da Nang Airport") costs nothing extra.
  const flightRows = input.flights ?? []
  for (const f of flightRows) {
    for (const q of [airportQuery(f.fromApt), airportQuery(f.toApt)]) {
      if (q) queries.push(q)
    }
  }

  const { map: places, degraded } = await resolvePlaces(queries, countryHint, input.bookingRef)
  const lookup = (raw: string | null | undefined): ResolvedPlace | null => {
    const c = cleanPlace(raw)
    if (!c) return null
    const hit = places.get(c.toLowerCase())
    return hit && hit.lat != null && hit.lng != null ? hit : null
  }

  // Hotels first: a row's drop-off is very often "the hotel", and the stay is
  // the only thing that knows which hotel that is on that date.
  const hotels: JourneyHotel[] = input.accommodations.map(a => {
    const r = lookup(`${a.hotel}${a.city ? `, ${a.city}` : ''}`)
    return {
      id: a.id,
      hotel: a.hotel,
      city: a.city,
      checkIn: new Date(a.checkIn).toISOString(),
      checkOut: new Date(a.checkOut).toISOString(),
      nights: a.nights,
      roomType: a.roomType ?? null,
      mealType: a.mealType ?? null,
      lat: r?.lat ?? null,
      lng: r?.lng ?? null,
    }
  })

  /** The stay covering a night: check-in day inclusive, check-out day exclusive. */
  const stayOn = (date: Date | string) => {
    const k = dayKey(date)
    return hotels.find(h => k >= dayKey(h.checkIn) && k < dayKey(h.checkOut)) ?? null
  }

  const stops: AgendaStop[] = []
  /**
   * The chart's own wording for each row's two ends, kept alongside the stop.
   * The resolver rewrites "DAD" into "Da Nang International Airport", which is
   * what the map should say — but matching a row against a booked sector needs
   * the code the operator actually typed.
   */
  const rowText = new Map<string, { from: string | null; to: string | null }>()

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const key = dayKey(it.date)
    const isFirst = i === 0
    const isLast = i === items.length - 1

    const fromR = lookup(it.fromPoint)
    // The pin goes where the guests end up. When the row has no drop-off (a
    // full-day tour written as one location), the activity location stands in,
    // and only then the pickup — a row is never dropped for want of a place.
    const toR = lookup(it.toPoint) ?? lookup(it.location) ?? fromR
    if (!toR || toR.lat == null || toR.lng == null) continue

    const stay = stayOn(it.date)
    const transport = transportFor(it.serviceType)
    const fromText = cleanPlace(it.fromPoint)
    const toText = cleanPlace(it.toPoint) ?? cleanPlace(it.location)

    const here = { lat: toR.lat, lng: toR.lng }
    rowText.set(it.id, { from: it.fromPoint ?? null, to: it.toPoint ?? it.location ?? null })

    stops.push({
      id: it.id,
      // Filled in by the numbering pass below, once the flights are woven in.
      dayNo: 0,
      // A plain calendar date, not an instant. An ISO timestamp at UTC
      // midnight renders as the *previous* day for any reader west of
      // Greenwich — a guest opening the portal from the US would see their
      // whole trip shifted back a day.
      date: key || null,
      title: fromText && toText && fromText !== toText
        ? `${fromR?.place ?? fromText} → ${toR.place}`
        : (toR.place || it.location),
      description: it.details,
      place: toR.place,
      city: toR.city,
      country: toR.country ?? countryHint,
      kind: stopKind({
        serviceType: it.serviceType,
        resolved: toR,
        toText: toText ?? '',
        isLeisure: it.isLeisure,
        isFirst,
        isLast,
      }),
      lat: toR.lat,
      lng: toR.lng,
      source: toR.source,
      legKm: null,

      fromPlace: fromR?.place ?? fromText,
      toPlace: toR.place,
      fromLat: fromR?.lat ?? null,
      fromLng: fromR?.lng ?? null,
      moveKm: fromR?.lat != null && fromR?.lng != null
        ? haversineKm({ lat: fromR.lat, lng: fromR.lng }, here)
        : null,
      transport,
      timeFrom: it.timeFrom,
      timeTo: it.timeTo,
      meetingTime: it.meetingTime,
      mealPlan: it.mealPlan,
      legOfDay: 0,
      legsThatDay: 0,
      hotel: stay
        ? {
            name: stay.hotel,
            city: stay.city || null,
            lat: stay.lat,
            lng: stay.lng,
            checkIn: dayKey(stay.checkIn) === key,
            roomType: stay.roomType,
            mealType: stay.mealType,
            nights: stay.nights,
            checkInDate: stay.checkIn,
            checkOutDate: stay.checkOut,
          }
        : null,
      roadPath: null,
      roadKm: null,
      roadMin: null,
      flight: null,
      flightRole: null,
      synthetic: false,
    })
  }

  // ── Flights ────────────────────────────────────────────────────────────
  //
  // The movement chart is a *ground* document: it books the car to the airport
  // and the car from the next airport, and the sector between the two is
  // somebody else's ticket. On a single-destination file that is invisible. On
  // a file with an internal sector — Ho Chi Minh to Da Nang — it leaves the map
  // drawing a 600 km road leg that nobody drives, or worse, no leg at all.
  // The flight list is the only place that hop is written down, so the map
  // reads it directly. None of this touches the agenda: the woven rows are
  // marked `synthetic` and exist for the length of this response.

  const point = (r: ResolvedPlace | null) =>
    r && r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null

  const flightRowsSorted = [...flightRows].sort((a, b) => {
    const d = dayKey(a.date).localeCompare(dayKey(b.date))
    return d !== 0 ? d : (minutesOf(a.depTime) ?? 0) - (minutesOf(b.depTime) ?? 0)
  })

  // Which country the tour is actually operated in, counted off the pins rather
  // than read off the booking — `tourDestination` is free text ("Vietnam &
  // Cambodia"), and the pins are what the map is drawn from anyway.
  const countryTally = new Map<string, number>()
  for (const s of stops) if (s.country) countryTally.set(s.country, (countryTally.get(s.country) ?? 0) + 1)
  const tripCountry = Array.from(countryTally.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? countryHint

  const sameCountry = (a: string | null | undefined, b: string | null | undefined) =>
    !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

  const flights: FlightInfo[] = flightRowsSorted.map((f, i) => {
    const from = lookup(airportQuery(f.fromApt))
    const to = lookup(airportQuery(f.toApt))
    const a = point(from)
    const b = point(to)
    const depIn = sameCountry(from?.country, tripCountry)
    const arrIn = sameCountry(to?.country, tripCountry)

    // Country is the real signal: a sector with both ends inside the operating
    // country is one the guests fly *during* the tour. Position is the fallback
    // for a file whose airports would not resolve — the first sector brings
    // them in, the last takes them home, anything between is internal.
    const sector: FlightSector =
      depIn && arrIn ? 'internal'
      : arrIn && !depIn ? 'inbound'
      : depIn && !arrIn ? 'outbound'
      : i === 0 ? 'inbound'
      : i === flightRowsSorted.length - 1 ? 'outbound'
      : 'internal'

    const dep = minutesOf(f.depTime)
    const arr = minutesOf(f.arrTime)

    return {
      id: f.id,
      flightNo: String(f.flightNo ?? '').trim(),
      airline: f.airline?.trim() || null,
      date: dayKey(f.date),
      fromApt: String(f.fromApt ?? '').trim().toUpperCase(),
      toApt: String(f.toApt ?? '').trim().toUpperCase(),
      fromName: from?.place ?? null,
      toName: to?.place ?? null,
      fromCity: from?.city ?? null,
      toCity: to?.city ?? null,
      fromCountry: from?.country ?? null,
      toCountry: to?.country ?? null,
      fromLat: a?.lat ?? null,
      fromLng: a?.lng ?? null,
      toLat: b?.lat ?? null,
      toLng: b?.lng ?? null,
      depTime: f.depTime?.trim() || null,
      arrTime: f.arrTime?.trim() || null,
      sector,
      km: a && b ? haversineKm(a, b) : null,
      // Same-day only. A red-eye's arrival is the next morning, and a negative
      // duration is worse than no duration.
      durationMin: dep != null && arr != null && arr > dep ? arr - dep : null,
    }
  })

  /** An airport as something a stop can be compared against. */
  type AptRef = { code: string; lat: number | null; lng: number | null }

  /** True when this end of a row is that airport. */
  const isAt = (
    at: { lat: number; lng: number } | null,
    text: string,
    apt: AptRef,
  ): boolean => {
    if (mentionsCode(text, apt.code)) return true
    if (!at || apt.lat == null || apt.lng == null) return false
    if (haversineKm(at, { lat: apt.lat, lng: apt.lng }) > AIRPORT_MATCH_KM) return false
    // Thirty km of an airport is most of a city, so proximity alone would match
    // the hotel too. The row has to read like an airport as well.
    return AIRPORT_STRICT.test(text)
  }

  const startOf = (s: AgendaStop) => ({
    at: s.fromLat != null && s.fromLng != null ? { lat: s.fromLat, lng: s.fromLng } : null,
    text: [rowText.get(s.id)?.from, s.fromPlace].filter(Boolean).join(' '),
  })
  const endOf = (s: AgendaStop) => ({
    at: { lat: s.lat, lng: s.lng },
    text: [rowText.get(s.id)?.to, s.toPlace, s.place].filter(Boolean).join(' '),
  })

  for (const f of flights) {
    const dep: AptRef = { code: f.fromApt, lat: f.fromLat, lng: f.fromLng }
    const arr: AptRef = { code: f.toApt, lat: f.toLat, lng: f.toLng }

    // Did the operator already write the sector onto the chart as its own row?
    // Only a row that runs airport → airport counts — the transfer either side
    // touches one airport, not both.
    const onChart = stops.find(s => {
      if (s.date !== f.date || s.flight) return false
      const a = startOf(s), b = endOf(s)
      return isAt(a.at, a.text, dep) && isAt(b.at, b.text, arr)
    })
    if (onChart) {
      onChart.flight = f
      onChart.flightRole = 'sector'
      onChart.kind = 'flight'
      onChart.transport = transportFor('FLIGHT')
      continue
    }

    // Every sector is drawn, inbound and outbound included: the flight in is
    // how the trip starts and the flight out is how it ends, and a route that
    // begins at a hotel with no explanation of how anyone got there is a route
    // with its first page missing. The map's bounds stretch to reach the far
    // airport, which is the honest frame — the guests really do come from there.
    //
    // What cannot be drawn is a sector we could not place. An unresolved
    // airport would put the leg at 0,0 in the Atlantic.
    if (f.fromLat == null || f.fromLng == null || f.toLat == null || f.toLng == null) continue

    const stay = stayOn(f.date)
    const woven: AgendaStop = {
      id: `flight-${f.id}`,
      dayNo: 0,
      date: f.date || null,
      title: `${f.flightNo} · ${f.fromApt} → ${f.toApt}`,
      description: [
        f.airline,
        `${f.flightNo} departs ${f.fromApt}${f.depTime ? ` at ${f.depTime}` : ''}`,
        `arrives ${f.toApt}${f.arrTime ? ` at ${f.arrTime}` : ''}`,
      ].filter(Boolean).join(' · '),
      place: f.toName ?? f.toApt,
      city: f.toCity,
      country: f.toCountry ?? countryHint,
      kind: 'flight',
      lat: f.toLat,
      lng: f.toLng,
      source: 'model',
      legKm: null,
      fromPlace: f.fromName ?? f.fromApt,
      toPlace: f.toName ?? f.toApt,
      fromLat: f.fromLat,
      fromLng: f.fromLng,
      moveKm: f.km,
      transport: transportFor('FLIGHT'),
      timeFrom: f.depTime,
      timeTo: f.arrTime,
      meetingTime: null,
      mealPlan: null,
      legOfDay: 0,
      legsThatDay: 0,
      hotel: stay
        ? {
            name: stay.hotel,
            city: stay.city || null,
            lat: stay.lat,
            lng: stay.lng,
            checkIn: dayKey(stay.checkIn) === f.date,
            roomType: stay.roomType,
            mealType: stay.mealType,
            nights: stay.nights,
            checkInDate: stay.checkIn,
            checkOutDate: stay.checkOut,
          }
        : null,
      roadPath: null,
      roadKm: null,
      roadMin: null,
      flight: f,
      flightRole: 'sector',
      synthetic: true,
    }

    // Where the sector belongs in the day's order: straight after the transfer
    // that delivers them to the departure airport, or straight before the one
    // that collects them at the far end. With neither anchor, a morning flight
    // opens the day and an afternoon one closes it.
    const sameDay = stops.map((s, i) => ({ s, i })).filter(x => x.s.date === f.date)
    const afterDrop = [...sameDay].reverse().find(x => {
      const e = endOf(x.s); return isAt(e.at, e.text, dep)
    })
    const beforePickup = sameDay.find(x => {
      const a = startOf(x.s); return isAt(a.at, a.text, arr)
    })

    let at: number
    if (afterDrop) at = afterDrop.i + 1
    else if (beforePickup) at = beforePickup.i
    else if (sameDay.length > 0) {
      const depMin = minutesOf(f.depTime)
      at = depMin != null && depMin >= 12 * 60
        ? sameDay[sameDay.length - 1].i + 1
        : sameDay[0].i
    } else {
      // The chart has no rows at all that day — slot it in by date.
      const next = stops.findIndex(s => (s.date ?? '') > f.date)
      at = next === -1 ? stops.length : next
    }
    stops.splice(at, 0, woven)
  }

  // The transfers either side of a sector are what the chart *does* book, and
  // an operator reading "Hotel → Da Nang Airport" wants to see which flight it
  // is feeding. Tagged after the weave so a sector row is never overwritten.
  for (const f of flights) {
    const dep: AptRef = { code: f.fromApt, lat: f.fromLat, lng: f.fromLng }
    const arr: AptRef = { code: f.toApt, lat: f.toLat, lng: f.toLng }
    for (const s of stops) {
      if (s.date !== f.date || s.flight) continue
      const a = startOf(s), b = endOf(s)
      if (isAt(b.at, b.text, dep)) { s.flight = f; s.flightRole = 'to-airport' }
      else if (isAt(a.at, a.text, arr)) { s.flight = f; s.flightRole = 'from-airport' }
    }
  }

  // ── Numbering ──────────────────────────────────────────────────────────
  //
  // Day numbers come from the distinct calendar days on the finished route, not
  // from a row index — two movements on the same date are both "Day 3", and a
  // woven sector is one of that day's legs like any other.
  const days = Array.from(new Set(stops.map(s => s.date).filter(Boolean) as string[])).sort()
  const dayNoFor = new Map(days.map((d, i) => [d, i + 1]))
  const legsPerDay = new Map<string, number>()
  for (const s of stops) {
    const k = s.date ?? ''
    legsPerDay.set(k, (legsPerDay.get(k) ?? 0) + 1)
  }
  const seenDay = new Map<string, number>()
  stops.forEach((s, i) => {
    const k = s.date ?? ''
    const n = (seenDay.get(k) ?? 0) + 1
    seenDay.set(k, n)
    s.dayNo = dayNoFor.get(k) ?? i + 1
    s.legOfDay = n
    s.legsThatDay = legsPerDay.get(k) ?? 1
    const prev = stops[i - 1]
    s.legKm = prev ? haversineKm(prev, s) : null
  })

  // ── Roads ──────────────────────────────────────────────────────────────
  //
  // Everything that is not flown is driven, and an arc is a poor drawing of a
  // drive: it crosses reservoirs, cuts through the middle of a national park,
  // and makes a four-hour mountain transfer look like a short hop. Each ground
  // leg is routed on the real network instead, which also produces the two
  // numbers the arc could never give — road distance, and how long it takes.
  //
  // Best effort throughout. A leg that will not route (an island, an engine
  // outage, a slow response past the batch deadline) keeps its arc, which is
  // exactly what every leg looked like before this existed.
  const roadPairs = stops.map((s, i) => {
    const prev = stops[i - 1]
    // A flown sector has no road by definition, and routing one would draw the
    // coach road between two airports the guests never take.
    if (!prev || s.flightRole === 'sector') return null
    const from = { lat: prev.lat, lng: prev.lng }
    const to = { lat: s.lat, lng: s.lng }
    const apart = haversineKm(from, to)
    // Under a kilometre there is nothing to draw; over two thousand it is not a
    // transfer anybody booked, and asking a public engine to route it is rude.
    if (apart < 1 || apart > 2000) return null
    return { from, to }
  })

  const roads = await roadLegs(roadPairs)
  stops.forEach((s, i) => {
    const r = roads[i]
    s.roadPath = r?.geometry ?? null
    s.roadKm = r?.km ?? null
    s.roadMin = r?.minutes ?? null
  })

  const countries = Array.from(new Set(stops.map(s => s.country).filter(Boolean) as string[]))
  const totalKm = stops.reduce((sum, s) => sum + (s.legKm ?? 0), 0)
  const totalRoadKm = stops.reduce((sum, s) => sum + (s.roadKm ?? 0), 0)
  const totalDriveMin = stops.reduce((sum, s) => sum + (s.roadMin ?? 0), 0)

  return {
    stops,
    hotels,
    countries,
    totalKm,
    degraded: degraded || stops.length === 0,
    basis: 'agenda',
    dayCount: days.length,
    flights,
    totalRoadKm,
    totalDriveMin,
  }
}

// ─── Result cache ────────────────────────────────────────────────────────

const cache = new Map<string, { key: string; at: number; journey: AgendaJourney }>()
const TTL_MS = 30 * 60_000

export function getCachedAgendaJourney(ref: string, key: string): AgendaJourney | null {
  const hit = cache.get(ref)
  if (!hit || hit.key !== key || Date.now() - hit.at > TTL_MS) return null
  return hit.journey
}

export function setCachedAgendaJourney(ref: string, key: string, journey: AgendaJourney) {
  cache.set(ref, { key, at: Date.now(), journey })
}
