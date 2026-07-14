/**
 * AppleSystem (Apple Holidays v2) API client.
 *
 * A thin, server-only wrapper around the live Apple Holidays quotation API
 * (https://applev2.appletechlabs.com). It logs in with the credentials in
 * `AS_Username` / `AS_password`, caches the bearer token in-process until it
 * is about to expire, and exposes typed helpers for listing bookings and
 * fetching a single booking's P&L / cost breakdown.
 *
 * This is intentionally READ-ONLY and completely decoupled from the local
 * Prisma booking data — it exists so staff can browse the source-of-truth
 * quotations coming from AppleSystem without touching our own records.
 */

const AS_BASE = (process.env.AS_API_URL || 'https://applev2.appletechlabs.com').replace(/\/+$/, '')

// ── Token cache (module-level, survives across requests on a warm server) ────
let cachedToken: { token: string; expiresAt: number } | null = null

async function login(): Promise<string> {
  const email = process.env.AS_Username
  const password = process.env.AS_password
  if (!email || !password) {
    throw new Error('AppleSystem credentials missing — set AS_Username and AS_password in .env')
  }

  const body = new URLSearchParams({ email, password })
  const res = await fetch(`${AS_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`AppleSystem login failed (${res.status})`)
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error('AppleSystem login returned no access token')
  }

  const ttlMs = (json.expires_in ?? 3600) * 1000
  // Refresh 60s before actual expiry to avoid edge-of-expiry failures.
  cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 }
  return json.access_token
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }
  return login()
}

/** Authenticated fetch that retries once with a fresh token on a 401. */
async function asFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken()
  const res = await fetch(`${AS_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  if (res.status === 401 && retry) {
    cachedToken = null
    await getToken(true)
    return asFetch(path, init, false)
  }
  return res
}

// ── Types (subset of the fields the API returns that we actually use) ────────
export interface ASBookingListItem {
  type: string
  id: number
  quotation_no: string
  status: string          // "1" = pending/unconfirmed, "2" = confirmed
  status_class: string    // "pending" | "confirm" | ...
  country: string | null
  currency: string | null
  tour_type: string | null
  created_at?: { date: string } | string | null
  updated_at?: { date: string } | string | null
  reference_id: string
  reference_id_full?: string[]
  main?: { user?: string; arrival_year?: string; arrival_month?: string; arrival_day?: string }
  pax?: { adult?: string; cwb?: string; cnb?: string; total_children?: number }
  map_image_url?: string
  quotation_update_count_R?: number
  quotation_update_count_C?: number
  quotation_update_count_X?: number
}

export interface ASListResult {
  items: ASBookingListItem[]
  total: number
}

export interface ASListParams {
  fromArrivalDate: string   // YYYY-MM-DD
  toArrivalDate: string     // YYYY-MM-DD
  statuses?: string[]       // e.g. ['1','2']; empty/omitted => all
}

/** List quotations/bookings filtered by arrival date window and status. */
export async function listBookings(params: ASListParams): Promise<ASListResult> {
  const qs = new URLSearchParams()
  qs.set('from_arrival_date', params.fromArrivalDate)
  qs.set('to_arrival_date', params.toArrivalDate)
  for (const s of params.statuses ?? []) qs.append('status[]', s)

  const res = await asFetch(`/api/quotation/list?${qs.toString()}`)
  if (!res.ok) throw new Error(`AppleSystem list failed (${res.status})`)
  const json = (await res.json()) as { success?: boolean; data?: ASBookingListItem[]; total?: number }
  const items = Array.isArray(json.data) ? json.data : []
  return { items, total: json.total ?? items.length }
}

/** Fetch the full P&L / cost breakdown for one booking. Returns the raw `data` object. */
export async function getBookingPnl(
  referenceId: string,
  quotationNo: string,
  currency = 'USD',
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({
    reference_id: referenceId,
    quotation_no: quotationNo,
    currency,
  })
  const res = await asFetch(`/api/quotation/view/pnl?${qs.toString()}`)
  if (!res.ok) throw new Error(`AppleSystem P&L fetch failed (${res.status})`)
  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> }
  return json.data ?? {}
}

// ── Content lookups (id → human name) ────────────────────────────────────────
// Content data changes rarely, so resolved maps are cached in-process for 12h.

const CONTENT_TTL = 12 * 60 * 60 * 1000
const contentCache = new Map<string, { at: number; map: Map<string, string> }>()

/** GET a `/api/content/*` list. Body is either a bare array or a paginated
 *  `{ data: [...] }` object; this returns the row array either way. */
async function contentRows(path: string): Promise<Record<string, unknown>[]> {
  const res = await asFetch(path)
  if (!res.ok) return []
  const json = (await res.json()) as { body?: unknown }
  const body = json.body
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: Record<string, unknown>[] }).data
  }
  return []
}

async function cachedMap(
  key: string,
  path: string,
  idField: string,
  nameField: string,
): Promise<Map<string, string>> {
  const hit = contentCache.get(key)
  if (hit && Date.now() - hit.at < CONTENT_TTL) return hit.map
  const rows = await contentRows(path)
  const map = new Map<string, string>()
  for (const r of rows) {
    const id = r[idField]
    const name = r[nameField]
    if (id != null && name != null) map.set(String(id), String(name))
  }
  contentCache.set(key, { at: Date.now(), map })
  return map
}

/** Resolve place ids → place names (full list, ~9.5k rows, cached). */
async function placeMap(): Promise<Map<string, string>> {
  return cachedMap('place', '/api/content/place/', 'id', 'name')
}

/** Resolve vehicle ids → vehicle names for one country. */
async function vehicleMap(countryId: string): Promise<Map<string, string>> {
  return cachedMap(`vehicle:${countryId}`, `/api/content/vehicle?country=${encodeURIComponent(countryId)}`, 'id', 'vehicle_name')
}

/** Resolve meal-plan ids → readable names (BB / HB / …). */
async function mealPlanMap(): Promise<Map<string, string>> {
  const hit = contentCache.get('meal_plan')
  if (hit && Date.now() - hit.at < CONTENT_TTL) return hit.map
  const rows = await contentRows('/api/content/meal_plan')
  const map = new Map<string, string>()
  for (const r of rows) {
    const id = r.id
    if (id == null) continue
    const label = [r.plan, r.long_name].filter(Boolean).join(' · ')
    map.set(String(id), label || String(r.plan ?? ''))
  }
  contentCache.set('meal_plan', { at: Date.now(), map })
  return map
}

// ── Enriched booking detail (P&L + resolved names) ───────────────────────────

export interface EnrichedAccommodation {
  hotelId: string | null
  placeId: string | null
  placeName: string | null
  checkIn: string | null
  checkOut: string | null
  nights: number
  mealPlan: string | null
  roomCategoryId: string | null
  driverAccommodation: boolean
  provider: string | null
}

export interface EnrichedTransport {
  vehicleId: string | null
  vehicleName: string | null
  distanceKm: number | null
}

export interface EnrichedBooking {
  accommodations: EnrichedAccommodation[]
  transport: EnrichedTransport | null
  attractionCount: number
  cityTourCount: number
  placesVisited: string[]
}

function ymd(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const o = node as { year?: string; month?: string; day?: string }
  if (!o.year || !o.month || !o.day) return null
  return `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`
}

/**
 * Cross-references the raw P&L payload against the AppleSystem content catalog
 * to resolve place / vehicle / meal-plan ids into human-readable names, and
 * flattens the accommodation + transport structures for the UI.
 */
export async function enrichBookingDetail(
  detail: Record<string, unknown>,
  countryId?: string | null,
): Promise<EnrichedBooking> {
  const [places, meals, vehicles] = await Promise.all([
    placeMap().catch(() => new Map<string, string>()),
    mealPlanMap().catch(() => new Map<string, string>()),
    countryId ? vehicleMap(countryId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ])

  // Accommodations from budget.hotel[]
  const accommodations: EnrichedAccommodation[] = []
  const budget = detail.budget as { hotel?: unknown[] } | undefined
  const hotels = Array.isArray(budget?.hotel) ? budget!.hotel : []
  for (const h of hotels) {
    const settings = (h as { hotel_settings?: Record<string, unknown> })?.hotel_settings
    if (!settings) continue
    const placeId = settings.place != null ? String(settings.place) : null
    const mealId = settings.meal_type != null ? String(settings.meal_type) : null
    accommodations.push({
      hotelId: settings.hotel != null && String(settings.hotel) !== '0' ? String(settings.hotel) : null,
      placeId,
      placeName: placeId ? places.get(placeId) ?? null : null,
      checkIn: ymd(settings.check_in),
      checkOut: ymd(settings.check_out),
      nights: Number(settings.night ?? 0),
      mealPlan: mealId ? meals.get(mealId) ?? null : null,
      roomCategoryId: settings.room_category != null ? String(settings.room_category) : null,
      driverAccommodation: String(settings.driver_accommodation ?? '0') === '1',
      provider: settings.provider != null ? String(settings.provider) : null,
    })
  }

  // Transport
  let transport: EnrichedTransport | null = null
  const td = (detail.cost as { transport?: { transport_data?: Record<string, unknown> } } | undefined)?.transport?.transport_data
  if (td) {
    const vehicle = td.vehicle as { vehicle_type?: unknown } | undefined
    const mileage = td.mileage as { actual_distance?: unknown } | undefined
    const vId = vehicle?.vehicle_type != null ? String(vehicle.vehicle_type) : null
    transport = {
      vehicleId: vId,
      vehicleName: vId ? vehicles.get(vId) ?? null : null,
      distanceKm: mileage?.actual_distance != null ? Number(mileage.actual_distance) : null,
    }
  }

  // Attraction / city-tour counts
  const ab = detail.attraction_breakdown as { attraction?: object; city_tour?: object } | undefined
  const attractionCount = ab?.attraction ? Object.keys(ab.attraction).length : 0
  const cityTourCount = ab?.city_tour ? Object.keys(ab.city_tour).length : 0

  // Distinct places visited (from day_city)
  const dayCity = detail.day_city as Record<string, { name?: string }> | undefined
  const placesVisited = dayCity
    ? Array.from(new Set(Object.values(dayCity).map((c) => c.name).filter(Boolean) as string[]))
    : []

  return { accommodations, transport, attractionCount, cityTourCount, placesVisited }
}

// ── Reference helpers ────────────────────────────────────────────────────────

/** Country id → display name. Falls back to parsing the map image, then the raw id. */
export const AS_COUNTRY_NAMES: Record<string, string> = {
  '62': 'Sri Lanka',
  '63': 'Malaysia',
  '64': 'Singapore',
  '256': 'Vietnam',
}

export function resolveCountryName(item: ASBookingListItem): string | null {
  if (item.country && AS_COUNTRY_NAMES[item.country]) return AS_COUNTRY_NAMES[item.country]
  const m = item.map_image_url?.match(/center=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
    } catch {
      /* ignore */
    }
  }
  return item.country ? `#${item.country}` : null
}
