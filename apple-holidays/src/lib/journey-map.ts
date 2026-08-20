/**
 * Journey Map — turns a booking's itinerary into a geographic route.
 *
 * The itinerary rows we hold are free text written for humans ("Sun World Ba Na
 * Hills Full Day Tour from Da Nang (Golden Bridge + …) | Shared Transfer"), so
 * there is nothing on the row to put on a map. This module asks the model to
 * read each day the way an operator would — what place is this day actually
 * *at* — and then pins that place with OpenStreetMap's free geocoder.
 *
 * Two rules shape the design:
 *   • Nothing here writes to the database. The result is derived on read and
 *     cached in process memory, keyed by the booking's `updatedAt`, so an
 *     amendment invalidates it without a schema change or a stored column.
 *   • Coordinates come from the model first and are *refined* by Nominatim,
 *     never blocked on it. Nominatim asks for ≤1 request/second, so a 20-day
 *     file would otherwise stall the panel for half a minute.
 */
import openai, { logAiUsage } from '@/lib/openai'
import { airportByName } from '@/lib/ops-geo'

const UA = 'AppleHolidays-Ops/1.0 (+https://aahaas.com)'
const MODEL = process.env.OPENAI_JOURNEY_MODEL || 'gpt-4o-mini'

/** What a day is, for icon + colour on the map. */
export type StopKind =
  | 'arrival' | 'departure' | 'transfer' | 'flight'
  | 'tour' | 'attraction' | 'beach' | 'nature'
  | 'cultural' | 'city' | 'cruise' | 'hotel' | 'leisure'

export interface JourneyStop {
  id: string
  dayNo: number
  date: string | null
  /** The itinerary row's own title, shown verbatim in the timeline. */
  title: string
  description: string | null
  /** The searchable place the day happens at — "Ba Na Hills, Da Nang". */
  place: string
  city: string | null
  country: string | null
  kind: StopKind
  lat: number
  lng: number
  /** How the coordinates were obtained — surfaced as a confidence dot. */
  source: 'osm' | 'model'
  /** Straight-line km from the previous stop; null on the first. */
  legKm: number | null
}

export interface JourneyHotel {
  id: string
  hotel: string
  city: string
  checkIn: string
  checkOut: string
  nights: number
  /** What was actually booked in the hotel — shown on the traveller's card. */
  roomType: string | null
  mealType: string | null
  lat: number | null
  lng: number | null
}

export interface Journey {
  stops: JourneyStop[]
  hotels: JourneyHotel[]
  countries: string[]
  totalKm: number
  /** Set when the model was unavailable and we fell back to raw city parsing. */
  degraded: boolean
}

// ─── Geocoding ───────────────────────────────────────────────────────────

/**
 * Process-wide geocode cache. Places repeat heavily across bookings ("Da Nang"
 * appears on every Vietnam file), so this stays warm and most lookups after the
 * first few bookings never hit the network at all.
 */
export const geoCache = new Map<string, { lat: number; lng: number } | null>()

/** Nominatim forward geocode. Returns null on any failure — never throws. */
export async function nominatim(query: string, countryHint?: string | null): Promise<{ lat: number; lng: number } | null> {
  const key = `${query}|${countryHint ?? ''}`.toLowerCase()
  if (geoCache.has(key)) return geoCache.get(key)!

  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1' +
      `&q=${encodeURIComponent(countryHint ? `${query}, ${countryHint}` : query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) { geoCache.set(key, null); return null }
    const j = await res.json()
    const hit = Array.isArray(j) ? j[0] : null
    const out = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null
    const ok = out && Number.isFinite(out.lat) && Number.isFinite(out.lng) ? out : null
    geoCache.set(key, ok)
    return ok
  } catch {
    geoCache.set(key, null)
    return null
  }
}

/** Great-circle distance in km, rounded to the nearest km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

// ─── Model extraction ────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are a travel operations geographer for a tour operator.

You are given a day-by-day tour itinerary written as free marketing text, plus the
hotels the guests sleep in. For EVERY itinerary day, identify the single real
geographic place that day is centred on, and give its coordinates.

Rules:
- "place" must be a real, searchable place name suitable for OpenStreetMap —
  a landmark, attraction, bay, city or airport. Prefer the most SPECIFIC named
  thing in the title (e.g. "Ba Na Hills" over "Da Nang", "Ha Long Bay" over "Hanoi").
- For a transfer day ("Airport to Hotel"), use the airport or the city it serves.
- "lat"/"lng" must be your best real-world decimal coordinates for that place.
  Never return 0,0. Never invent a place you do not actually know.
- "city" is the nearest well-known city; "country" the country's common English name.
- "kind" is one of: arrival, departure, transfer, flight, tour, attraction, beach,
  nature, cultural, city, cruise, leisure.
  Use "arrival" for the first airport pickup and "departure" for the final airport drop-off.
- Return one object per itinerary day, in the same order, same count. Do not merge or skip days.

Reply with JSON only: {"stops":[{"dayNo":1,"place":"...","city":"...","country":"...","kind":"...","lat":0.0,"lng":0.0}]}`

interface ModelStop {
  dayNo?: number; place?: string; city?: string; country?: string
  kind?: string; lat?: number; lng?: number
}

const KINDS = new Set<StopKind>([
  'arrival', 'departure', 'transfer', 'flight', 'tour', 'attraction',
  'beach', 'nature', 'cultural', 'city', 'cruise', 'hotel', 'leisure',
])

function coerceKind(raw: unknown): StopKind {
  const k = String(raw ?? '').toLowerCase().trim() as StopKind
  return KINDS.has(k) ? k : 'tour'
}

/** Last-resort place guess: the text after "from", or the first hotel city. */
function fallbackPlace(title: string, fallbackCity: string | null): string {
  const from = title.match(/\bfrom\s+([A-Z][\w' ]{2,30})/)
  if (from) return from[1].trim()
  const lead = title.split(/[|(–—-]/)[0].trim()
  return lead || fallbackCity || 'Unknown'
}

export interface JourneyInput {
  bookingRef: string
  operationCountry?: string | null
  tourDestination?: string | null
  itinerary: { id: string; dayNo: number; date: Date | string | null; title: string; description: string | null }[]
  accommodations: { id: string; hotel: string; city: string; checkIn: Date | string; checkOut: Date | string; nights: number; roomType?: string | null; mealType?: string | null }[]
}

/**
 * Builds the mappable route for one booking.
 *
 * Never throws: a model outage or a geocoder outage degrades the panel (fewer
 * pins, `degraded: true`) rather than breaking the booking page around it.
 */
export async function buildJourney(input: JourneyInput): Promise<Journey> {
  const days = [...input.itinerary].sort((a, b) => a.dayNo - b.dayNo)
  const countryHint = input.tourDestination || input.operationCountry || null
  const hotelCity = input.accommodations[0]?.city ?? null

  let modelStops: ModelStop[] = []
  let degraded = false

  if (days.length > 0) {
    try {
      const payload = {
        destination: countryHint,
        hotels: input.accommodations.map(a => ({ hotel: a.hotel, city: a.city })),
        days: days.map(d => ({
          dayNo: d.dayNo,
          title: d.title,
          // The description carries the pickup city and the stop list, which is
          // often the only place the real location is named. Trimmed to keep
          // a 20-day file inside a sensible prompt.
          description: (d.description ?? '').slice(0, 600),
        })),
      }
      const res = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: EXTRACT_PROMPT },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      })
      await logAiUsage({
        callType: 'journey_map_extract',
        model: MODEL,
        usage: res.usage,
        bookingRef: input.bookingRef,
        source: 'booking',
      })
      const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}')
      modelStops = Array.isArray(parsed?.stops) ? parsed.stops : []
    } catch (e) {
      console.warn('[journey-map] extraction failed:', (e as Error).message)
      degraded = true
    }
  }

  // Match model output back to days by dayNo, falling back to positional order
  // — the model occasionally renumbers when two rows share a day number.
  const byDay = new Map<number, ModelStop>()
  modelStops.forEach((s, i) => {
    const n = Number(s?.dayNo)
    const target = Number.isFinite(n) && days.some(d => d.dayNo === n) ? n : days[i]?.dayNo
    if (target != null && !byDay.has(target)) byDay.set(target, s)
  })

  const stops: JourneyStop[] = []
  for (let i = 0; i < days.length; i++) {
    const d = days[i]
    const m = byDay.get(d.dayNo) ?? modelStops[i] ?? {}
    const place = (m.place ?? '').trim() || fallbackPlace(d.title, hotelCity)
    const country = (m.country ?? '').trim() || countryHint

    let lat = Number(m.lat)
    let lng = Number(m.lng)
    let source: JourneyStop['source'] = 'model'
    const modelOk = Number.isFinite(lat) && Number.isFinite(lng) &&
      Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)

    // An airport is a fixed point and never a search — see `airportByName`.
    // Arrival and departure days name one almost every time, and geocoding it
    // as prose is what puts a guest's landing 40 km from the runway.
    const apt = airportByName(place)

    // Refine with OSM. Cached places are free; a cold miss costs one 4s-capped
    // request, and we only pay it when the model gave us nothing usable.
    const cacheKey = `${place}, ${m.city ?? ''}|${country ?? ''}`.toLowerCase()
    const cached = geoCache.get(cacheKey)
    if (apt) {
      lat = apt.lat; lng = apt.lng; source = 'osm'
    } else if (cached || !modelOk) {
      const geo = cached ?? await nominatim(`${place}${m.city ? `, ${m.city}` : ''}`, country)
      if (geo) { lat = geo.lat; lng = geo.lng; source = 'osm' }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue

    const prev = stops[stops.length - 1]
    stops.push({
      id: d.id,
      dayNo: d.dayNo,
      date: d.date ? new Date(d.date).toISOString() : null,
      title: d.title,
      description: d.description,
      place,
      city: apt?.city ?? ((m.city ?? '').trim() || null),
      country: apt?.country ?? (country ?? null),
      kind: apt ? 'flight' : coerceKind(m.kind),
      lat, lng, source,
      legKm: prev ? haversineKm(prev, { lat, lng }) : null,
    })
  }

  // Hotels get pinned from the geocode cache only — the stops above have almost
  // always already warmed the city, so this is free and never adds latency.
  const hotels: JourneyHotel[] = input.accommodations.map(a => {
    const near = stops.find(s => s.city && a.city && s.city.toLowerCase().includes(a.city.toLowerCase().split(',')[0].trim()))
      ?? stops.find(s => a.city && s.place.toLowerCase().includes(a.city.toLowerCase().split(',')[0].trim()))
    return {
      id: a.id,
      hotel: a.hotel,
      city: a.city,
      checkIn: new Date(a.checkIn).toISOString(),
      checkOut: new Date(a.checkOut).toISOString(),
      nights: a.nights,
      roomType: a.roomType ?? null,
      mealType: a.mealType ?? null,
      lat: near?.lat ?? null,
      lng: near?.lng ?? null,
    }
  })

  const countries = Array.from(new Set(stops.map(s => s.country).filter(Boolean) as string[]))
  const totalKm = stops.reduce((sum, s) => sum + (s.legKm ?? 0), 0)

  return { stops, hotels, countries, totalKm, degraded: degraded || stops.length === 0 }
}

// ─── Result cache ────────────────────────────────────────────────────────

const journeyCache = new Map<string, { key: string; at: number; journey: Journey }>()
const TTL_MS = 30 * 60_000

export function getCachedJourney(ref: string, key: string): Journey | null {
  const hit = journeyCache.get(ref)
  if (!hit || hit.key !== key || Date.now() - hit.at > TTL_MS) return null
  return hit.journey
}

export function setCachedJourney(ref: string, key: string, journey: Journey) {
  journeyCache.set(ref, { key, at: Date.now(), journey })
}
