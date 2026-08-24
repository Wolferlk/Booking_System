/**
 * Hotel contracts, rates and availability read out of the live Aahaas store
 * (`production_live1`) — STRICTLY READ-ONLY.
 *
 * This is where the Reservation Team's real contracted inventory lives: the
 * hotel master (`hotels`), the supplier behind it (`vendors`), the rate cards
 * (`hotel_room_rates`) and the allotment held against them
 * (`hotel_room_inventories`, `hotel_room_daily_inventories`).
 *
 * Every statement goes through {@link b2cQuery}, which refuses anything that is
 * not a SELECT/SHOW/DESCRIBE/EXPLAIN before it reaches the wire. Nothing in this
 * module may ever write to that database.
 *
 * Two things about the source data shape the code below and are not negotiable:
 *
 *  1. `hotel_room_rates.room_category_id` / `room_type_id` hold **names**, not
 *     ids ("Deluxe Room", "Twin"). `hotel_room_daily_inventories.room_category_id`
 *     holds the same name, which is how a rate is joined to its daily allotment.
 *  2. `blackout_dates`, `blackout_days` and `stop_sale_date` are free text typed
 *     by whoever loaded the contract. They hold ISO dates, US dates, weekday
 *     names, timestamps, `###`, and dates run together without a separator.
 *     {@link parseBlackout} is deliberately forgiving and reports what it could
 *     not read rather than silently treating garbage as "available".
 */
import type { RowDataPacket } from 'mysql2/promise'
import { b2cQuery } from './b2c-db'

/** Calendar days, in ms. Availability is date arithmetic, never instants. */
const DAY_MS = 86_400_000

// ─── Row types ────────────────────────────────────────────────────────────────

export interface B2cHotelRow extends RowDataPacket {
  id: number
  hotel_name: string | null
  hotel_description: string | null
  sub_description: string | null
  star_classification: string | null
  hotel_classification: string | null
  auto_confirmation: number | null
  hotel_address: string | null
  hotel_image: string | null
  trip_advisor_link: string | null
  country: string | null
  city: string | null
  micro_location: string | null
  hotel_status: string | null
  start_date: string | null
  end_date: string | null
  latitude: string | null
  longitude: string | null
  markup: string | null
  /** `additional_data_1` is the property's contracting currency. */
  additional_data_1: string | null
  vendor_id: number | null
  input_type: string | null
  created_at: string | null
  updated_at: string | null
  vendor_company: string | null
  vendor_email: string | null
  vendor_phone: string | null
  vendor_status: string | null
}

export interface B2cHotelListRow extends B2cHotelRow {
  liveRates: number
  totalRates: number
  currencies: string | null
  minAdultRate: string | null
  maxAdultRate: string | null
  contractUntil: string | null
}

export interface B2cRateRow extends RowDataPacket {
  id: number
  hotel_id: number
  card_id: number | null
  market_nationality: string | null
  currency: string | null
  adult_rate: string | null
  child_with_bed_rate: string | null
  child_without_bed_rate: string | null
  actual_adult_rate: string | null
  actual_child_with_bed_rate: string | null
  actual_child_without_bed_rate: string | null
  child_foc_age: string | null
  child_with_no_bed_age: string | null
  child_with_bed_age: string | null
  adult_age: string | null
  book_by_days: number | null
  meal_plan: string | null
  room_category_id: string | null
  room_type_id: string | null
  booking_start_date: string | null
  booking_end_date: string | null
  payment_type: string | null
  blackout_dates: string | null
  blackout_days: string | null
  min_adult_occupancy: number | null
  max_adult_occupancy: number | null
  min_child_occupancy: number | null
  max_child_occupancy: number | null
  total_occupancy: number | null
  created_at: string | null
  updated_at: string | null
  /** Aggregated from `hotel_room_inventories` for this rate. */
  allotment: number | null
  stop_sale_dates: string | null
}

export interface B2cVendorRow extends RowDataPacket {
  id: number
  company_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  additional_number_1: string | null
  additional_number_2: string | null
  additional_number_3: string | null
  address: string | null
  business_type: string | null
  nature_of_business: string | null
  status: string | null
  cancellation_policy: string | null
  payment_policy: string | null
  terms_conditions: string | null
  created_at: string | null
}

export interface B2cDailyInventoryRow extends RowDataPacket {
  room_category_id: string | null
  date: string
  daily_allotment: number | null
  used: number | null
  balance: number | null
}

// ─── Date + free-text parsing ─────────────────────────────────────────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** 'YYYY-MM-DD' for a UTC-anchored day. Never a local-timezone rendering. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Parses 'YYYY-MM-DD' as a UTC midnight, so day arithmetic cannot drift. */
export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

/** Every day from `from` (inclusive) up to `to` (exclusive) — i.e. the nights. */
export function nightsIn(from: string, to: string): string[] {
  const start = parseDay(from).getTime()
  const end = parseDay(to).getTime()
  const out: string[] = []
  // A 400-night ceiling: a stay longer than that is bad input, not a query.
  for (let t = start; t < end && out.length < 400; t += DAY_MS) out.push(isoDay(new Date(t)))
  return out
}

/**
 * Pulls every date out of one free-text blackout field.
 *
 * Handles, in order of how often they actually appear: ISO `2026-02-14`,
 * ISO with a time `2025-04-03 00:00:00`, US `12/31/2025`, and the run-together
 * case `4/26/20254/27/2025` (a missing comma) — the regex is unanchored and
 * scans, so the second date is still found. `###`, blank segments and prose are
 * ignored, and anything left over is returned as `unreadable` so the UI can say
 * "this contract has a blackout note we could not parse" rather than pretend the
 * dates are clear.
 */
export function parseBlackout(raw: string | null | undefined): {
  dates: string[]
  weekdays: number[]
  unreadable: string[]
} {
  const dates = new Set<string>()
  const weekdays = new Set<number>()
  const unreadable: string[] = []
  if (!raw) return { dates: [], weekdays: [], unreadable: [] }

  let rest = raw

  // ISO first — it is unambiguous, so consume those before touching slashes.
  rest = rest.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (m, y, mo, d) => {
    const iso = normalizeYmd(Number(y), Number(mo), Number(d))
    if (iso) dates.add(iso)
    return ' '
  })

  // US M/D/YYYY. Written by the same people, in the same field, on other rows.
  rest = rest.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (m, mo, d, y) => {
    const iso = normalizeYmd(Number(y), Number(mo), Number(d))
    if (iso) dates.add(iso)
    return ' '
  })

  for (const chunk of rest.split(/[,;|\n\r\t]+/)) {
    const token = chunk.trim().toLowerCase()
    if (!token) continue
    // Leftover clock times from a timestamp that already gave up its date.
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(token)) continue
    if (/^[#\-\/.\s]+$/.test(token)) continue

    const day = WEEKDAYS.findIndex(w => w === token || `${w}s` === token || w.slice(0, 3) === token)
    if (day >= 0) { weekdays.add(day); continue }

    unreadable.push(chunk.trim())
  }

  return {
    dates: Array.from(dates).sort(),
    weekdays: Array.from(weekdays).sort((a, b) => a - b),
    unreadable,
  }
}

/** Rejects impossible dates rather than letting `Date` roll them over. */
function normalizeYmd(y: number, mo: number, d: number): string | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return isoDay(dt)
}

/** Every blackout signal on a rate, merged: explicit dates, weekdays, stop-sale. */
export function rateBlackout(rate: B2cRateRow): {
  dates: Set<string>
  weekdays: Set<number>
  stopSale: Set<string>
  unreadable: string[]
} {
  const a = parseBlackout(rate.blackout_dates)
  // `blackout_days` is nominally weekday names but is used for dates just as often.
  const b = parseBlackout(rate.blackout_days)
  const s = parseBlackout(rate.stop_sale_dates)
  return {
    dates: new Set([...a.dates, ...b.dates]),
    weekdays: new Set([...a.weekdays, ...b.weekdays]),
    stopSale: new Set(s.dates),
    unreadable: [...a.unreadable, ...b.unreadable],
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const HOTEL_COLUMNS = `
  h.id, h.hotel_name, h.hotel_description, h.sub_description,
  h.star_classification, h.hotel_classification, h.auto_confirmation,
  h.hotel_address, h.hotel_image, h.trip_advisor_link,
  h.country, h.city, h.micro_location, h.hotel_status,
  h.start_date, h.end_date, h.latitude, h.longitude, h.markup,
  h.additional_data_1, h.vendor_id, h.input_type, h.created_at, h.updated_at,
  v.company_name AS vendor_company, v.email AS vendor_email,
  v.phone AS vendor_phone, v.status AS vendor_status`

export interface HotelDirectoryFilters {
  search?: string | null
  country?: string | null
  city?: string | null
  /** 'active' | 'inactive' | 'all' — `hotels.hotel_status` is '1' / '0'. */
  status?: string | null
  /** Only properties with at least one rate valid today or later. */
  withLiveRates?: boolean
  /** Only properties whose contract window has already closed. */
  expiringBefore?: string | null
  limit?: number
  offset?: number
}

/**
 * One page of the hotel master with its supplier and a rate summary.
 *
 * The rate aggregate is a correlated subquery per row rather than a join to a
 * `GROUP BY hotel_id` over all 289k rate rows: with a page of 50 hotels it reads
 * 50 index ranges off `idx_rates_hotel_dates` instead of scanning the table.
 */
export async function fetchHotelDirectory(
  filters: HotelDirectoryFilters = {},
): Promise<{ rows: B2cHotelListRow[]; total: number }> {
  const { where, params } = buildDirectoryWhere(filters)
  const limit = clampInt(filters.limit ?? 50, 1, 200)
  const offset = clampInt(filters.offset ?? 0, 0, 100_000)

  const [rows, counted] = await Promise.all([
    b2cQuery<B2cHotelListRow>(
      `SELECT ${HOTEL_COLUMNS},
              (SELECT COUNT(*) FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                  AND r.booking_end_date >= CURDATE())                    AS liveRates,
              (SELECT COUNT(*) FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL)         AS totalRates,
              (SELECT GROUP_CONCAT(DISTINCT r.currency ORDER BY r.currency)
                 FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                  AND r.booking_end_date >= CURDATE())                    AS currencies,
              (SELECT MIN(r.adult_rate) FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                  AND r.booking_end_date >= CURDATE() AND r.adult_rate > 0) AS minAdultRate,
              (SELECT MAX(r.adult_rate) FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                  AND r.booking_end_date >= CURDATE())                    AS maxAdultRate,
              (SELECT MAX(r.booking_end_date) FROM hotel_room_rates r
                WHERE r.hotel_id = h.id AND r.deleted_at IS NULL)         AS contractUntil
         FROM hotels h
         LEFT JOIN vendors v ON v.id = h.vendor_id
        WHERE ${where}
        ORDER BY h.hotel_name ASC
        LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
    b2cQuery<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total
         FROM hotels h
         LEFT JOIN vendors v ON v.id = h.vendor_id
        WHERE ${where}`,
      params,
    ),
  ])

  return { rows, total: Number(counted[0]?.total ?? 0) }
}

/** Distinct countries and cities, for the filter bar. Cheap: both are indexed. */
export async function fetchHotelFacets(): Promise<{
  countries: { code: string; count: number }[]
  cities: { city: string; country: string | null; count: number }[]
}> {
  const [countries, cities] = await Promise.all([
    b2cQuery<RowDataPacket & { code: string; count: number }>(
      `SELECT COALESCE(country, '') AS code, COUNT(*) AS count
         FROM hotels WHERE deleted_at IS NULL
        GROUP BY country ORDER BY count DESC`,
    ),
    b2cQuery<RowDataPacket & { city: string; country: string | null; count: number }>(
      `SELECT COALESCE(city, '') AS city, country, COUNT(*) AS count
         FROM hotels WHERE deleted_at IS NULL AND city IS NOT NULL AND city <> ''
        GROUP BY city, country ORDER BY count DESC LIMIT 400`,
    ),
  ])
  return { countries, cities }
}

export async function fetchHotel(id: number): Promise<B2cHotelRow | null> {
  const rows = await b2cQuery<B2cHotelRow>(
    `SELECT ${HOTEL_COLUMNS}
       FROM hotels h
       LEFT JOIN vendors v ON v.id = h.vendor_id
      WHERE h.id = ? AND h.deleted_at IS NULL
      LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function fetchVendor(id: number): Promise<B2cVendorRow | null> {
  const rows = await b2cQuery<B2cVendorRow>(
    `SELECT id, company_name, first_name, last_name, email, phone,
            additional_number_1, additional_number_2, additional_number_3,
            address, business_type, nature_of_business, status,
            cancellation_policy, payment_policy, terms_conditions, created_at
       FROM vendors WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

/**
 * Rate cards for one hotel, each carrying the allotment and stop-sale text held
 * against it in `hotel_room_inventories`.
 *
 * The allotment is fetched as a second query keyed on the rate ids rather than
 * as a correlated subquery: the only index on `hotel_room_inventories` starts
 * with `id`, so a per-rate lookup on `rate_id` scans the whole table and a
 * property with 20 rate lines took over four seconds. One grouped `IN` query
 * scans it once — the same page now costs ~200ms.
 *
 * `includeExpired` is off by default: most of the 289k rate rows are contracts
 * that closed in past seasons and would bury today's inventory.
 */
export async function fetchHotelRates(
  hotelId: number,
  opts: { includeExpired?: boolean; limit?: number } = {},
): Promise<B2cRateRow[]> {
  const limit = clampInt(opts.limit ?? 1500, 1, 5000)
  const rates = await b2cQuery<B2cRateRow>(
    `SELECT r.id, r.hotel_id, r.card_id, r.market_nationality, r.currency,
            r.adult_rate, r.child_with_bed_rate, r.child_without_bed_rate,
            r.actual_adult_rate, r.actual_child_with_bed_rate, r.actual_child_without_bed_rate,
            r.child_foc_age, r.child_with_no_bed_age, r.child_with_bed_age, r.adult_age,
            r.book_by_days, r.meal_plan, r.room_category_id, r.room_type_id,
            r.booking_start_date, r.booking_end_date, r.payment_type,
            r.blackout_dates, r.blackout_days,
            r.min_adult_occupancy, r.max_adult_occupancy,
            r.min_child_occupancy, r.max_child_occupancy, r.total_occupancy,
            r.created_at, r.updated_at
       FROM hotel_room_rates r
      WHERE r.hotel_id = ? AND r.deleted_at IS NULL
        ${opts.includeExpired ? '' : 'AND r.booking_end_date >= CURDATE()'}
      ORDER BY r.booking_start_date ASC, r.room_category_id ASC, r.room_type_id ASC
      LIMIT ${limit}`,
    [hotelId],
  )
  if (rates.length === 0) return rates

  // Rate ids are inlined, so they must be provably integers first.
  const ids = rates.map(r => {
    if (!Number.isInteger(Number(r.id))) throw new Error(`Invalid rate id: ${String(r.id)}`)
    return String(Number(r.id))
  })
  const inventory = await b2cQuery<RowDataPacket & {
    rate_id: number; allotment: number | null; stop_sale_dates: string | null
  }>(
    `SELECT rate_id,
            MAX(allotment)                              AS allotment,
            GROUP_CONCAT(stop_sale_date SEPARATOR ',')  AS stop_sale_dates
       FROM hotel_room_inventories
      WHERE deleted_at IS NULL AND rate_id IN (${ids.join(',')})
      GROUP BY rate_id`,
  )
  const byRate = new Map(inventory.map(i => [Number(i.rate_id), i]))
  for (const r of rates) {
    const inv = byRate.get(Number(r.id))
    r.allotment = inv?.allotment ?? null
    r.stop_sale_dates = inv?.stop_sale_dates ?? null
  }
  return rates
}

/** Room categories and types on file for a property, for the detail header. */
export async function fetchHotelRoomSetup(hotelId: number): Promise<{
  categories: string[]
  types: string[]
}> {
  const [cats, types] = await Promise.all([
    b2cQuery<RowDataPacket & { name: string }>(
      `SELECT DISTINCT room_category_name AS name FROM hotel_room_categories
        WHERE hotel_id = ? AND deleted_at IS NULL AND room_category_name <> ''
        ORDER BY name`,
      [hotelId],
    ),
    b2cQuery<RowDataPacket & { name: string }>(
      `SELECT DISTINCT room_category_type AS name FROM hotel_room_types
        WHERE hotel_id = ? AND deleted_at IS NULL AND room_category_type <> ''
        ORDER BY name`,
      [hotelId],
    ),
  ])
  return { categories: cats.map(c => c.name), types: types.map(t => t.name) }
}

/**
 * Per-night allotment for a property over a window. Keyed by room category
 * *name*, which is how the daily table stores it and how a rate row refers to it.
 */
export async function fetchDailyInventory(
  hotelId: number,
  from: string,
  to: string,
): Promise<B2cDailyInventoryRow[]> {
  return b2cQuery<B2cDailyInventoryRow>(
    `SELECT room_category_id, date, daily_allotment, used, balance
       FROM hotel_room_daily_inventories
      WHERE hotel_id = ? AND deleted_at IS NULL AND date >= ? AND date <= ?
      ORDER BY date`,
    [hotelId, from, to],
  )
}

// ─── Availability ─────────────────────────────────────────────────────────────

export type NightBlockReason = 'blackout-date' | 'blackout-weekday' | 'stop-sale' | 'no-allotment' | 'outside-window'

export interface NightResult {
  date: string
  ok: boolean
  reason: NightBlockReason | null
  balance: number | null
}

export interface RateAvailability {
  rateId: number
  cardId: number | null
  roomCategory: string | null
  roomType: string | null
  mealPlan: string | null
  market: string | null
  currency: string | null
  paymentType: string | null
  bookingWindow: { from: string | null; to: string | null }
  allotment: number | null
  occupancy: {
    maxAdults: number | null
    maxChildren: number | null
    total: number | null
    fits: boolean
  }
  /** Rate is unusable because the stay starts inside its book-by lead time. */
  leadTimeDays: number | null
  leadTimeOk: boolean
  nights: NightResult[]
  /** True only when every night is clear and occupancy and lead time pass. */
  available: boolean
  blockedNights: number
  /** Sell prices for the whole stay, from `adult_rate` / child rates. */
  pricing: {
    perNightAdult: number | null
    perNightChildWithBed: number | null
    perNightChildNoBed: number | null
    total: number | null
    /** Contracted nett (`actual_*`) equivalent — the buy side. */
    nettTotal: number | null
  }
  /** Free-text blackout content we could not read; surfaced, never ignored. */
  unreadableBlackout: string[]
}

export interface AvailabilityQuery {
  checkIn: string
  checkOut: string
  adults?: number
  childrenWithBed?: number
  childrenNoBed?: number
  rooms?: number
  nationality?: string | null
  /** Today, for lead-time arithmetic. Injectable so the logic is testable. */
  asOf?: string
}

export interface AvailableHotelResult {
  hotel: B2cHotelListRow
  sellableRates: RateAvailability[]
  lowestPrice: number | null
  currency: string | null
}

/**
 * Search the contracted portfolio in one availability check. The hotel
 * directory, rate lines and daily inventory are loaded in batches so this is
 * suitable for the reservation desk's "show me every available hotel" flow.
 */
export async function searchAvailableHotels(
  query: AvailabilityQuery & { country?: string | null; city?: string | null },
): Promise<AvailableHotelResult[]> {
  const directory = await fetchHotelDirectory({
    status: 'active',
    withLiveRates: true,
    country: query.country,
    city: query.city,
    limit: 200,
    offset: 0,
  })
  if (directory.rows.length === 0) return []

  const ids = directory.rows.map(h => Number(h.id)).filter(Number.isInteger)
  const idList = ids.join(',')
  const nights = nightsIn(query.checkIn, query.checkOut)
  const [rates, daily] = await Promise.all([
    b2cQuery<B2cRateRow>(
      `SELECT r.id, r.hotel_id, r.card_id, r.market_nationality, r.currency,
              r.adult_rate, r.child_with_bed_rate, r.child_without_bed_rate,
              r.actual_adult_rate, r.actual_child_with_bed_rate, r.actual_child_without_bed_rate,
              r.child_foc_age, r.child_with_no_bed_age, r.child_with_bed_age, r.adult_age,
              r.book_by_days, r.meal_plan, r.room_category_id, r.room_type_id,
              r.booking_start_date, r.booking_end_date, r.payment_type,
              r.blackout_dates, r.blackout_days, r.min_adult_occupancy,
              r.max_adult_occupancy, r.min_child_occupancy, r.max_child_occupancy,
              r.total_occupancy, r.created_at, r.updated_at,
              inv.allotment, inv.stop_sale_dates
         FROM hotel_room_rates r
         LEFT JOIN (
           SELECT rate_id, MAX(allotment) AS allotment,
                  GROUP_CONCAT(stop_sale_date SEPARATOR ',') AS stop_sale_dates
             FROM hotel_room_inventories
            WHERE deleted_at IS NULL
            GROUP BY rate_id
         ) inv ON inv.rate_id = r.id
        WHERE r.hotel_id IN (${idList}) AND r.deleted_at IS NULL
          AND r.booking_end_date >= CURDATE()
        ORDER BY r.hotel_id, r.booking_start_date, r.room_category_id
        LIMIT 20000`,
    ),
    b2cQuery<B2cDailyInventoryRow & { hotel_id: number }>(
      `SELECT hotel_id, room_category_id, date, daily_allotment, used, balance
         FROM hotel_room_daily_inventories
        WHERE hotel_id IN (${idList}) AND deleted_at IS NULL
          AND date >= ? AND date <= ?
        ORDER BY hotel_id, date`,
      [query.checkIn, nights[nights.length - 1]],
    ),
  ])

  const ratesByHotel = new Map<number, B2cRateRow[]>()
  for (const rate of rates) {
    const list = ratesByHotel.get(Number(rate.hotel_id)) ?? []
    list.push(rate)
    ratesByHotel.set(Number(rate.hotel_id), list)
  }
  const dailyByHotel = new Map<number, B2cDailyInventoryRow[]>()
  for (const row of daily) {
    const list = dailyByHotel.get(Number(row.hotel_id)) ?? []
    list.push(row)
    dailyByHotel.set(Number(row.hotel_id), list)
  }

  return directory.rows.flatMap(hotel => {
    const evaluated = evaluateAvailability(ratesByHotel.get(Number(hotel.id)) ?? [], dailyByHotel.get(Number(hotel.id)) ?? [], query)
    const sellableRates = evaluated.filter(rate => rate.available)
    if (sellableRates.length === 0) return []
    const priced = sellableRates.filter(rate => rate.pricing.total !== null)
    const best = priced.sort((a, b) => (a.pricing.total ?? Infinity) - (b.pricing.total ?? Infinity))[0]
    return [{
      hotel,
      sellableRates,
      lowestPrice: best?.pricing.total ?? null,
      currency: best?.currency ?? sellableRates[0]?.currency ?? null,
    }]
  }).sort((a, b) => (a.lowestPrice ?? Infinity) - (b.lowestPrice ?? Infinity))
}

/**
 * Decide, night by night, whether each rate can actually be sold for a stay.
 *
 * A rate is only "available" when every single night clears: inside the booking
 * window, not a blackout date, not a blackout weekday, not stop-sold, and with
 * allotment left where a daily inventory row exists. A property that holds no
 * daily inventory rows at all is treated as on-request rather than sold out —
 * most contracts in this database carry a flat allotment and no daily rows, and
 * calling those unavailable would hide almost the whole portfolio.
 */
export function evaluateAvailability(
  rates: B2cRateRow[],
  daily: B2cDailyInventoryRow[],
  query: AvailabilityQuery,
): RateAvailability[] {
  const nights = nightsIn(query.checkIn, query.checkOut)
  const adults = Math.max(1, query.adults ?? 2)
  const childBed = Math.max(0, query.childrenWithBed ?? 0)
  const childNoBed = Math.max(0, query.childrenNoBed ?? 0)
  const rooms = Math.max(1, query.rooms ?? 1)
  const asOf = query.asOf ?? isoDay(new Date())
  const leadDays = Math.round((parseDay(query.checkIn).getTime() - parseDay(asOf).getTime()) / DAY_MS)

  // balance by `${category}|${date}`; categories are names in both tables.
  const balances = new Map<string, number>()
  for (const d of daily) {
    const key = `${(d.room_category_id ?? '').trim().toLowerCase()}|${String(d.date).slice(0, 10)}`
    const bal = d.balance ?? ((d.daily_allotment ?? 0) - (d.used ?? 0))
    // Several rows can exist for one category/date; the tightest one governs.
    const prev = balances.get(key)
    balances.set(key, prev === undefined ? bal : Math.min(prev, bal))
  }

  const wanted = query.nationality?.trim().toLowerCase() ?? ''

  return rates
    .filter(r => marketMatches(r.market_nationality, wanted))
    .map(rate => {
      const bo = rateBlackout(rate)
      const cat = (rate.room_category_id ?? '').trim().toLowerCase()
      const from = rate.booking_start_date ? String(rate.booking_start_date).slice(0, 10) : null
      const to = rate.booking_end_date ? String(rate.booking_end_date).slice(0, 10) : null

      const nightResults: NightResult[] = nights.map(date => {
        if ((from && date < from) || (to && date > to)) {
          return { date, ok: false, reason: 'outside-window', balance: null }
        }
        if (bo.dates.has(date)) return { date, ok: false, reason: 'blackout-date', balance: null }
        if (bo.stopSale.has(date)) return { date, ok: false, reason: 'stop-sale', balance: null }
        if (bo.weekdays.has(parseDay(date).getUTCDay())) {
          return { date, ok: false, reason: 'blackout-weekday', balance: null }
        }
        const bal = balances.get(`${cat}|${date}`)
        // No daily row = no daily inventory kept for this property: on request.
        if (bal !== undefined && bal < rooms) {
          return { date, ok: false, reason: 'no-allotment', balance: bal }
        }
        return { date, ok: true, reason: null, balance: bal ?? null }
      })

      const maxAdults = rate.max_adult_occupancy
      const maxChildren = rate.max_child_occupancy
      const totalOcc = rate.total_occupancy
      const fits =
        (maxAdults === null || adults <= maxAdults) &&
        (maxChildren === null || childBed + childNoBed <= maxChildren) &&
        (totalOcc === null || adults + childBed + childNoBed <= totalOcc)

      const leadTimeOk = rate.book_by_days === null || leadDays >= rate.book_by_days

      const adultRate = num(rate.adult_rate)
      const cwb = num(rate.child_with_bed_rate)
      const cnb = num(rate.child_without_bed_rate)
      const perNight =
        adultRate === null ? null
          : adultRate * adults + (cwb ?? 0) * childBed + (cnb ?? 0) * childNoBed
      const nettAdult = num(rate.actual_adult_rate)
      const nettPerNight =
        nettAdult === null ? null
          : nettAdult * adults
            + (num(rate.actual_child_with_bed_rate) ?? 0) * childBed
            + (num(rate.actual_child_without_bed_rate) ?? 0) * childNoBed

      const blocked = nightResults.filter(n => !n.ok).length

      return {
        rateId: rate.id,
        cardId: rate.card_id === null ? null : Number(rate.card_id),
        roomCategory: rate.room_category_id,
        roomType: rate.room_type_id,
        mealPlan: normalizeMealPlan(rate.meal_plan),
        market: rate.market_nationality,
        currency: rate.currency,
        paymentType: rate.payment_type,
        bookingWindow: { from, to },
        allotment: rate.allotment === null ? null : Number(rate.allotment),
        occupancy: { maxAdults, maxChildren, total: totalOcc, fits },
        leadTimeDays: rate.book_by_days,
        leadTimeOk,
        nights: nightResults,
        available: blocked === 0 && fits && leadTimeOk && nights.length > 0,
        blockedNights: blocked,
        pricing: {
          perNightAdult: adultRate,
          perNightChildWithBed: cwb,
          perNightChildNoBed: cnb,
          total: perNight === null ? null : round2(perNight * nights.length * rooms),
          nettTotal: nettPerNight === null ? null : round2(nettPerNight * nights.length * rooms),
        },
        unreadableBlackout: bo.unreadable,
      }
    })
    // Sellable first, then cheapest, then fewest blocked nights.
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1
      if (a.blockedNights !== b.blockedNights) return a.blockedNights - b.blockedNights
      return (a.pricing.total ?? Infinity) - (b.pricing.total ?? Infinity)
    })
}

/**
 * `market_nationality` is a free-text market label: 'All', 'All Markets', '',
 * 'LOCAL', 'Indians', an ISO code. With no nationality asked for, every rate
 * matches; with one, an open-market rate always matches and a targeted rate only
 * matches when the label mentions it.
 */
function marketMatches(market: string | null, wanted: string): boolean {
  if (!wanted) return true
  const m = (market ?? '').trim().toLowerCase()
  if (!m || m === 'all' || m.startsWith('all ')) return true
  return m.includes(wanted) || wanted.includes(m)
}

/** 'B/B' and 'BB' are the same plan typed by two people. */
export function normalizeMealPlan(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.replace(/[^A-Za-z]/g, '').toUpperCase()
  return m || null
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.trunc(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(n, max))
}

/** Builds the shared WHERE for the directory list and its COUNT. */
function buildDirectoryWhere(f: HotelDirectoryFilters): { where: string; params: unknown[] } {
  const clauses = ['h.deleted_at IS NULL']
  const params: unknown[] = []

  const search = f.search?.trim()
  if (search) {
    clauses.push('(h.hotel_name LIKE ? OR h.city LIKE ? OR h.hotel_address LIKE ? OR v.company_name LIKE ?)')
    const like = `%${search}%`
    params.push(like, like, like, like)
  }
  if (f.country) { clauses.push('h.country = ?'); params.push(f.country) }
  if (f.city) { clauses.push('h.city = ?'); params.push(f.city) }
  if (f.status === 'active') clauses.push("h.hotel_status = '1'")
  if (f.status === 'inactive') clauses.push("(h.hotel_status IS NULL OR h.hotel_status <> '1')")
  if (f.withLiveRates) {
    clauses.push(`EXISTS (SELECT 1 FROM hotel_room_rates r
                           WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                             AND r.booking_end_date >= CURDATE())`)
  }
  if (f.expiringBefore) {
    clauses.push(`NOT EXISTS (SELECT 1 FROM hotel_room_rates r
                               WHERE r.hotel_id = h.id AND r.deleted_at IS NULL
                                 AND r.booking_end_date >= ?)`)
    params.push(f.expiringBefore)
  }
  return { where: clauses.join(' AND '), params }
}

// ─── Rate card grouping ───────────────────────────────────────────────────────

export interface RateCardLine {
  id: number
  roomCategory: string | null
  roomType: string | null
  mealPlan: string | null
  adultRate: number | null
  childWithBedRate: number | null
  childNoBedRate: number | null
  nettAdultRate: number | null
  maxAdults: number | null
  maxChildren: number | null
  totalOccupancy: number | null
  allotment: number | null
  blackoutDates: string[]
  blackoutWeekdays: number[]
  stopSaleDates: string[]
  unreadableBlackout: string[]
}

export interface RateCard {
  key: string
  cardId: number | null
  market: string | null
  currency: string | null
  mealPlans: string[]
  paymentType: string | null
  validFrom: string | null
  validTo: string | null
  /** True when the window covers today. */
  live: boolean
  expired: boolean
  bookByDays: number | null
  childAges: {
    foc: string | null
    withoutBed: string | null
    withBed: string | null
    adult: string | null
  }
  lines: RateCardLine[]
  /** Union of every blackout date across the card's lines, sorted. */
  blackoutDates: string[]
  blackoutWeekdays: number[]
  lowestAdultRate: number | null
  updatedAt: string | null
}

/**
 * Fold rate rows into the cards a contract was actually loaded as.
 *
 * `card_id` is the loader's own grouping and is the right key when present; the
 * fallback composite (market + currency + season + payment terms) keeps older
 * rows — loaded before `card_id` existed — from collapsing into one meaningless
 * pile or exploding into one card per room type.
 */
export function groupRateCards(rates: B2cRateRow[], asOf = isoDay(new Date())): RateCard[] {
  const cards = new Map<string, RateCard>()

  for (const r of rates) {
    const from = r.booking_start_date ? String(r.booking_start_date).slice(0, 10) : null
    const to = r.booking_end_date ? String(r.booking_end_date).slice(0, 10) : null
    const key = r.card_id
      ? `card:${r.card_id}:${from}:${to}`
      : `mix:${r.market_nationality ?? ''}:${r.currency ?? ''}:${from}:${to}:${r.payment_type ?? ''}`

    const bo = rateBlackout(r)
    const line: RateCardLine = {
      id: r.id,
      roomCategory: r.room_category_id,
      roomType: r.room_type_id,
      mealPlan: normalizeMealPlan(r.meal_plan),
      adultRate: num(r.adult_rate),
      childWithBedRate: num(r.child_with_bed_rate),
      childNoBedRate: num(r.child_without_bed_rate),
      nettAdultRate: num(r.actual_adult_rate),
      maxAdults: r.max_adult_occupancy,
      maxChildren: r.max_child_occupancy,
      totalOccupancy: r.total_occupancy,
      allotment: r.allotment === null ? null : Number(r.allotment),
      blackoutDates: Array.from(bo.dates).sort(),
      blackoutWeekdays: Array.from(bo.weekdays).sort((a, b) => a - b),
      stopSaleDates: Array.from(bo.stopSale).sort(),
      unreadableBlackout: bo.unreadable,
    }

    const existing = cards.get(key)
    if (existing) {
      existing.lines.push(line)
      if (line.mealPlan && !existing.mealPlans.includes(line.mealPlan)) existing.mealPlans.push(line.mealPlan)
      if (line.adultRate !== null && (existing.lowestAdultRate === null || line.adultRate < existing.lowestAdultRate)) {
        existing.lowestAdultRate = line.adultRate
      }
      continue
    }

    cards.set(key, {
      key,
      cardId: r.card_id === null ? null : Number(r.card_id),
      market: r.market_nationality,
      currency: r.currency,
      mealPlans: line.mealPlan ? [line.mealPlan] : [],
      paymentType: r.payment_type,
      validFrom: from,
      validTo: to,
      live: Boolean(from && to && from <= asOf && to >= asOf),
      expired: Boolean(to && to < asOf),
      bookByDays: r.book_by_days,
      childAges: {
        foc: r.child_foc_age,
        withoutBed: r.child_with_no_bed_age,
        withBed: r.child_with_bed_age,
        adult: r.adult_age,
      },
      lines: [line],
      blackoutDates: [],
      blackoutWeekdays: [],
      lowestAdultRate: line.adultRate,
      updatedAt: r.updated_at,
    })
  }

  const out = Array.from(cards.values())
  for (const card of out) {
    const dates = new Set<string>()
    const days = new Set<number>()
    for (const l of card.lines) {
      for (const d of l.blackoutDates) dates.add(d)
      for (const d of l.stopSaleDates) dates.add(d)
      for (const w of l.blackoutWeekdays) days.add(w)
    }
    card.blackoutDates = Array.from(dates).sort()
    card.blackoutWeekdays = Array.from(days).sort((a: number, b: number) => a - b)
    card.lines.sort((a, b) =>
      (a.roomCategory ?? '').localeCompare(b.roomCategory ?? '') ||
      (a.roomType ?? '').localeCompare(b.roomType ?? ''))
  }

  // Live seasons first, then by start date — the desk sells forward, not back.
  return out.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1
    return (a.validFrom ?? '').localeCompare(b.validFrom ?? '')
  })
}
