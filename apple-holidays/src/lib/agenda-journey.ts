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
}

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
    return { stops: [], hotels: [], countries: [], totalKm: 0, degraded: false, basis: 'agenda', dayCount: 0 }
  }

  // Day numbers come from the distinct calendar days present, not from the row
  // index — two movements on the same date are both "Day 3".
  const days = Array.from(new Set(items.map(i => dayKey(i.date)).filter(Boolean))).sort()
  const dayNoFor = new Map(days.map((d, i) => [d, i + 1]))
  const legsPerDay = new Map<string, number>()
  items.forEach(i => {
    const k = dayKey(i.date)
    legsPerDay.set(k, (legsPerDay.get(k) ?? 0) + 1)
  })

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
  const seenDay = new Map<string, number>()

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

    const legOfDay = (seenDay.get(key) ?? 0) + 1
    seenDay.set(key, legOfDay)

    const prev = stops[stops.length - 1]
    const here = { lat: toR.lat, lng: toR.lng }

    stops.push({
      id: it.id,
      dayNo: dayNoFor.get(key) ?? stops.length + 1,
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
      legKm: prev ? haversineKm(prev, here) : null,

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
      legOfDay,
      legsThatDay: legsPerDay.get(key) ?? 1,
      hotel: stay
        ? {
            name: stay.hotel,
            city: stay.city || null,
            lat: stay.lat,
            lng: stay.lng,
            checkIn: dayKey(stay.checkIn) === key,
          }
        : null,
    })
  }

  const countries = Array.from(new Set(stops.map(s => s.country).filter(Boolean) as string[]))
  const totalKm = stops.reduce((sum, s) => sum + (s.legKm ?? 0), 0)

  return {
    stops,
    hotels,
    countries,
    totalKm,
    degraded: degraded || stops.length === 0,
    basis: 'agenda',
    dayCount: days.length,
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
