/**
 * Aahaas B2C store DB client — production_live1 MySQL/MariaDB, STRICTLY READ-ONLY.
 *
 * This is the live customer-facing Aahaas database. Nothing in this file may ever
 * write to it: `b2cQuery()` runs every statement through {@link assertReadOnly} first, so
 * a stray INSERT/UPDATE/DELETE/DDL fails in our own process before it reaches the
 * wire. `multipleStatements` is left at its default (false) so a second statement
 * cannot be smuggled in through a parameter.
 *
 * Design mirrors `accounts-db.ts`: a fresh connection per query (no shared pool),
 * which avoids stale-connection problems under Next.js hot-reload and on Lambda,
 * and `query()` rather than `execute()` because prepared statements reject
 * `LIMIT ?` on this server.
 *
 * It happens to live on the SAME RDS host as our own ops DB, so the ops
 * credentials are reused with the schema name overridden.
 */
import mysql from 'mysql2/promise'
import { flightDateSpan, parseFlightBooking } from './b2c-flight'

/** Hard ceiling so a stalled SSL negotiation can never hang a request forever. */
const CONN_TIMEOUT_MS = 15_000

/** Travel-only main categories: 3 Lifestyle, 4 Hotels, 5 Education, 6 Flights.
 *  1 Essential / 2 Non Essential are physical retail goods and are never bookings. */
export const TRAVEL_CATEGORY_IDS = [3, 4, 5, 6] as const

/** Flights. Sold worldwide, and — unlike every other category — routinely stored
 *  with no `service_date` at all. Such orders take their travel dates from the
 *  flight booking instead (see {@link fetchUndatedFlightHeaders}). */
export const FLIGHT_CATEGORY_ID = 6

/** How far back the full sweep looks, by booked date, for flight orders with no
 *  `service_date`. Airlines sell about 11 months ahead, so a year covers every
 *  ticket that can still be in the future. */
const UNDATED_FLIGHT_LOOKBACK_DAYS = 370

/** Statements this client is willing to send. Anything else is a bug, not a query. */
const READ_ONLY_RE = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i

export class B2cWriteAttemptError extends Error {
  constructor(sql: string) {
    super(`Refused a non-read-only statement against the B2C database: ${sql.slice(0, 120)}`)
    this.name = 'B2cWriteAttemptError'
  }
}

/**
 * Throws unless `sql` is a single read-only statement. Rejecting `;` is what
 * makes the check meaningful — without it, "SELECT 1; DROP TABLE x" would pass.
 */
export function assertReadOnly(sql: string): void {
  if (!READ_ONLY_RE.test(sql)) throw new B2cWriteAttemptError(sql)
  // Allow a single trailing semicolon, but nothing after it.
  if (/;\s*\S/.test(sql)) throw new B2cWriteAttemptError(sql)
}

function getDbConfig() {
  return {
    host:     (process.env.DB_HOST ?? '').trim(),
    port:     Number((process.env.DB_PORT ?? '3306').trim()),
    // The one value that differs from the ops connection.
    database: (process.env.DB_DATABASE_B2C ?? 'production_live1').trim(),
    user:     (process.env.DB_USERNAME ?? '').trim(),
    password: (process.env.DB_PASSWORD ?? '').trim(),
    connectTimeout:    CONN_TIMEOUT_MS,
    enableKeepAlive:   false,
    supportBigNumbers: true,
    bigNumberStrings:  false,
    // DATE columns come back as 'YYYY-MM-DD' strings — no implicit timezone shift,
    // which matters because service_date is a calendar date, not an instant.
    dateStrings:       true,
    timezone:          'Z',
    multipleStatements: false,
    ssl: { rejectUnauthorized: false },
  }
}

export function isB2cConfigured(): boolean {
  const { host, user, database } = getDbConfig()
  return Boolean(host && user && database)
}

async function getConn(): Promise<mysql.Connection> {
  if (!isB2cConfigured()) {
    throw new Error('B2C database is not configured — set DB_HOST / DB_USERNAME / DB_DATABASE_B2C')
  }
  // connectTimeout alone is unreliable against RDS when SSL negotiation stalls.
  return await Promise.race([
    mysql.createConnection(getDbConfig()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`B2C DB connection timed out after ${CONN_TIMEOUT_MS / 1000}s`)),
        CONN_TIMEOUT_MS,
      ),
    ),
  ])
}

/**
 * Run one read-only statement. Exported so other read-only B2C modules
 * (e.g. `b2c-hotels.ts`) share this guard rather than opening their own,
 * unguarded connection to the live store.
 */
export async function b2cQuery<T extends mysql.RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  assertReadOnly(sql)
  const conn = await getConn()
  try {
    const [rows] = await conn.query<T[]>(sql, params)
    return rows
  } finally {
    await conn.end().catch(() => { /* never mask the real error with a close failure */ })
  }
}

// ─── Row types ────────────────────────────────────────────────────────────────

export interface B2cOrderHeader extends mysql.RowDataPacket {
  order_id: number
  arrival: string          // 'YYYY-MM-DD' — MIN(service_date)
  departure: string        // 'YYYY-MM-DD' — MAX(service_date)
  productLines: number
  bookedDate: string | null
}

/** One storefront order, reduced to what the reconciliation report needs. */
export interface B2cBookedOrder extends mysql.RowDataPacket {
  order_id: number
  bookedDate: string | null
  serviceDate: string | null
  productLines: number
  /** Lines that carry a service date. Zero = the importer can never see this order. */
  datedLines: number
  /** Lines sold out of the Flights category (6). */
  flightLines: number
}

export interface B2cOrderProduct extends mysql.RowDataPacket {
  id: number
  order_id: number
  checkout_id: number
  category_id: number | null
  maincat_type: string | null
  product_id: number | null
  product_name: string | null
  vendor_name: string | null
  service_date: string | null
  time_slot: string | null
  service_location: string | null
  provider: string | null
  sku: string | null
  adult_quantity: number | null
  child_quantity: number | null
  quantity: number | null
  net_cost_amount: string | null
  adult_cost_amount: string | null
  child_cost_amount: string | null
  net_seling_amount: string | null
  net_total_amount: string | null
  discount_amount: string | null
  tax_amount: string | null
  base_currency: string | null
  paid_currency: string | null
  // Resolved product country (ISO alpha-2) — only Lifestyle-backed products have one.
  product_country: string | null
  product_city: string | null
}

export interface B2cOrderCustomer extends mysql.RowDataPacket {
  order_id: number
  user_id: number | null
  total_amount: string | null
  paid_amount: string | null
  balance_amount: string | null
  discount_amount: string | null
  delivery_amount: string | null
  payment_status: string | null
  checkout_status: string | null
  checkout_date: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_nationality: string | null
}

/**
 * A row of `aahaas_flight_bookingsv2` — the live flight table. Route, pax and
 * passenger names all live inside the two JSON blobs; see `b2c-flight.ts`.
 *
 * (The older `aahaas_flight_bookings` is dead: it stops at order ~8424 and stores
 * `adults` as a JSON passenger array rather than a count. Do not use it.)
 */
export interface B2cFlightBooking extends mysql.RowDataPacket {
  order_id: number
  pnr: string | null
  flight_provider: string | null
  requested_data: string | null
  response_data: string | null
}

/**
 * The traveller ids booked on one order line. `tbl_checkouts.related_order_id`
 * points into a different pre-booking table per main category (the same switch
 * the Aahaas admin's supplier voucher uses); each carries `travel_buddy_*_id`,
 * a comma list or JSON array of `aahaas_passenger_details.id`.
 */
export interface B2cOrderLineTravellers extends mysql.RowDataPacket {
  order_id: number
  line_id: number
  service_date: string | null
  adult_ids: string | null
  child_ids: string | null
}

/**
 * Names held on the booking rows themselves, per order line — what the Aahaas
 * admin prints under Traveler Details. Only the column for the line's own
 * category is filled; see {@link fetchOrderLineBookingNames}.
 */
export interface B2cOrderLineBookingNames extends mysql.RowDataPacket {
  order_id: number
  line_id: number
  service_date: string | null
  category_id: number | null
  /** Lifestyle: comma-separated full names. */
  ls_adults: string | null
  ls_children: string | null
  /** Education: the student. */
  student_name: string | null
  /** Hotels: `bookingdataset.paxDetails`, as JSON text. */
  hotel_pax: string | null
}

/** A row of `aahaas_passenger_details` — the names typed in at checkout. */
export interface B2cPassengerDetail extends mysql.RowDataPacket {
  id: number
  passenger_title: string | null
  passenger_first_name: string | null
  passenger_last_name: string | null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const CATEGORY_LIST = TRAVEL_CATEGORY_IDS.join(',')

/**
 * Candidate orders: one row per Aahaas order that contains at least one TRAVEL
 * product with a future service date.
 *
 * `HAVING MIN(service_date) >= ?` is the "upcoming travels only" gate — an order
 * whose travel has already started is not something ops can still prepare for.
 *
 * Flight orders usually have no `service_date` at all, so the dated query alone
 * never sees them. They come from {@link fetchUndatedFlightHeaders}, which dates
 * them from the flight booking, and pass through the same upcoming gate.
 *
 * Pass `bookedFrom` to restrict to recently-placed orders (the nightly run); omit
 * it to sweep every upcoming order (backfill). It is a floor rather than an exact
 * day deliberately: the nightly job fires just after midnight and passes
 * *yesterday*, so the window spans the day that just ended plus the new one. That
 * makes a missed night self-healing, and re-importing is harmless because
 * persistence is idempotent on `bookingRef`.
 */
export async function fetchOrderHeaders(opts: {
  upcomingFrom: string          // 'YYYY-MM-DD'
  bookedFrom?: string | null    // 'YYYY-MM-DD' — inclusive floor on booked_date
  limit?: number
}): Promise<B2cOrderHeader[]> {
  const { upcomingFrom, bookedFrom = null, limit = 500 } = opts
  // LIMIT is inlined (not bound) because this server rejects `LIMIT ?`.
  const lim = Math.max(1, Math.min(Number(limit) || 500, 5000))
  const [dated, undated] = await Promise.all([
    b2cQuery<B2cOrderHeader>(
      `SELECT m.order_id                AS order_id,
              MIN(m.service_date)       AS arrival,
              MAX(m.service_date)       AS departure,
              COUNT(*)                  AS productLines,
              MIN(m.booked_date)        AS bookedDate
         FROM checkouts_more_data m
        WHERE m.order_id IS NOT NULL
          AND m.service_date IS NOT NULL
          AND m.category_id IN (${CATEGORY_LIST})
          ${bookedFrom ? 'AND m.booked_date >= ?' : ''}
        GROUP BY m.order_id
       HAVING MIN(m.service_date) >= ?
        ORDER BY arrival ASC
        LIMIT ${lim}`,
      bookedFrom ? [bookedFrom, upcomingFrom] : [upcomingFrom],
    ),
    fetchUndatedFlightHeaders({ bookedFrom: bookedFrom ?? shiftDate(upcomingFrom, -UNDATED_FLIGHT_LOOKBACK_DAYS) }),
  ])

  // An undated-flight header covers every line of its order, so it replaces the
  // dated-only row for the same order.
  const byOrder = new Map(dated.map((h) => [Number(h.order_id), h]))
  for (const h of undated) {
    if (h.arrival >= upcomingFrom) byOrder.set(Number(h.order_id), h)
  }
  return Array.from(byOrder.values())
    .sort((a, b) => (a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 : Number(a.order_id) - Number(b.order_id)))
    .slice(0, lim)
}

/**
 * Headers for orders that hold a flight line with no `service_date`, dated from
 * the flight itself.
 *
 * Aahaas keeps a flight's travel date in `aahaas_flight_bookingsv2` (confirmed
 * PNR flights, else the search's `routes[].date`), and the storefront often
 * repeats it in the line's name, e.g. "CMB -> IXM (2026-11-10)". Either source
 * is used, together with any dated lines on the same order. An order that has
 * no date anywhere is left out, as before.
 *
 * Pass `orderId` for one order (any travel date), or `bookedFrom` to sweep by
 * booked date. No date floor here: callers apply their own.
 */
async function fetchUndatedFlightHeaders(opts: { bookedFrom?: string; orderId?: number }): Promise<B2cOrderHeader[]> {
  const scope = opts.orderId != null ? `AND order_id = ${sanitizeIds([opts.orderId])}` : 'AND booked_date >= ?'
  const rows = await b2cQuery<B2cOrderHeader & { undatedNames: string | null }>(
    `SELECT m.order_id                AS order_id,
            MIN(m.service_date)       AS arrival,
            MAX(m.service_date)       AS departure,
            COUNT(*)                  AS productLines,
            MIN(m.booked_date)        AS bookedDate,
            GROUP_CONCAT(CASE WHEN m.service_date IS NULL THEN m.product_name END SEPARATOR ' | ') AS undatedNames
       FROM checkouts_more_data m
       JOIN (SELECT DISTINCT order_id
               FROM checkouts_more_data
              WHERE order_id IS NOT NULL
                AND category_id = ${FLIGHT_CATEGORY_ID}
                AND service_date IS NULL
                ${scope}) u ON u.order_id = m.order_id
      WHERE m.category_id IN (${CATEGORY_LIST})
      GROUP BY m.order_id`,
    opts.orderId != null ? [] : [opts.bookedFrom],
  )
  if (rows.length === 0) return []

  // Latest booking row per order: a re-priced or reissued flight leaves the
  // earlier attempts behind with their old dates.
  const flightRows = await fetchFlightBookings(rows.map((r) => Number(r.order_id)))
  const spanByOrder = new Map<number, { first: string; last: string }>()
  for (const fr of flightRows) {
    const span = flightDateSpan(parseFlightBooking(fr))
    if (span) spanByOrder.set(Number(fr.order_id), span)
  }

  const headers: B2cOrderHeader[] = []
  for (const r of rows) {
    const { undatedNames, ...row } = r
    const dates = [row.arrival, row.departure].filter((d): d is string => Boolean(d))
    const span = spanByOrder.get(Number(row.order_id))
    if (span) dates.push(span.first, span.last)
    else dates.push(...datesInText(undatedNames))
    if (dates.length === 0) continue
    dates.sort()
    headers.push({ ...row, arrival: dates[0], departure: dates[dates.length - 1] } as B2cOrderHeader)
  }
  return headers
}

/** 'YYYY-MM-DD' dates written into free text, e.g. a flight line named "CMB -> IXM (2026-11-10)". */
function datesInText(text: string | null): string[] {
  if (!text) return []
  const out: string[] = []
  const re = /\b(20\d{2})-(\d{2})-(\d{2})\b/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const d = new Date(`${m[0]}T00:00:00Z`)
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0]) out.push(m[0])
  }
  return out
}

/** Calendar-day arithmetic on 'YYYY-MM-DD'. */
function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The header for ONE order, whatever its travel date.
 *
 * {@link fetchOrderHeaders} floors on upcoming travel, which is right for the
 * importer but wrong for "Update booking": an order whose first service has
 * already started must still be refreshable. Same shape, same travel-category
 * filter, no date gate. Returns null when the order has no dated travel line.
 * A flight with no `service_date` is dated from the flight booking.
 */
export async function fetchOrderHeaderById(orderId: number): Promise<B2cOrderHeader | null> {
  const id = sanitizeIds([orderId])
  const [flightDated] = await fetchUndatedFlightHeaders({ orderId })
  if (flightDated) return flightDated
  const rows = await b2cQuery<B2cOrderHeader>(
    `SELECT m.order_id                AS order_id,
            MIN(m.service_date)       AS arrival,
            MAX(m.service_date)       AS departure,
            COUNT(*)                  AS productLines,
            MIN(m.booked_date)        AS bookedDate
       FROM checkouts_more_data m
      WHERE m.order_id = ${id}
        AND m.service_date IS NOT NULL
        AND m.category_id IN (${CATEGORY_LIST})
      GROUP BY m.order_id`,
  )
  return rows[0] ?? null
}

/**
 * Orders **placed** inside a date range, one row per order.
 *
 * `fetchOrderHeaders()` answers a different question — it is the importer's
 * "what is still coming?" query and floors on `service_date`, which would drop
 * an order booked yesterday for a trip that has already happened. The daily
 * reconciliation has to see every order the storefront took on the day,
 * whenever it travels, so this filters on `booked_date` alone.
 *
 * `booked_date` is a DATE column, so the range is inclusive at both ends and
 * needs no timezone arithmetic — a calendar day is a calendar day.
 */
export async function fetchOrdersBookedBetween(opts: {
  from: string            // 'YYYY-MM-DD' inclusive
  to: string              // 'YYYY-MM-DD' inclusive
  limit?: number
}): Promise<B2cBookedOrder[]> {
  const lim = Math.max(1, Math.min(Number(opts.limit) || 2000, 10000))
  return b2cQuery<B2cBookedOrder>(
    `SELECT m.order_id          AS order_id,
            MIN(m.booked_date)  AS bookedDate,
            MIN(m.service_date) AS serviceDate,
            COUNT(*)            AS productLines,
            SUM(m.service_date IS NOT NULL) AS datedLines,
            SUM(m.category_id = ${FLIGHT_CATEGORY_ID}) AS flightLines
       FROM checkouts_more_data m
      WHERE m.order_id IS NOT NULL
        AND m.booked_date IS NOT NULL
        AND m.category_id IN (${CATEGORY_LIST})
        AND m.booked_date >= ? AND m.booked_date <= ?
      GROUP BY m.order_id
      ORDER BY m.order_id ASC
      LIMIT ${lim}`,
    [opts.from, opts.to],
  )
}

/**
 * Travel product lines for the given orders, with the product's country/city
 * resolved from `tbl_lifestyle` and the category name from `tbl_maincategory`.
 *
 * Both joins are LEFT: Flights carry `product_id = 0` and Ratehawk hotels carry
 * no product row at all, so an inner join would silently drop them.
 */
export async function fetchOrderProducts(orderIds: number[]): Promise<B2cOrderProduct[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  return b2cQuery<B2cOrderProduct>(
    `SELECT m.id, m.order_id, m.checkout_id, m.category_id, mc.maincat_type,
            m.product_id, m.product_name, m.vendor_name,
            m.service_date, m.time_slot, m.service_location, m.provider, m.sku,
            m.adult_quantity, m.child_quantity, m.quantity,
            m.net_cost_amount, m.adult_cost_amount, m.child_cost_amount,
            m.net_seling_amount, m.net_total_amount,
            m.discount_amount, m.tax_amount,
            m.base_currency, m.paid_currency,
            l.country       AS product_country,
            l.lifestyle_city AS product_city
       FROM checkouts_more_data m
       LEFT JOIN tbl_lifestyle    l  ON l.lifestyle_id = m.product_id
       LEFT JOIN tbl_maincategory mc ON mc.id          = m.category_id
      WHERE m.order_id IN (${ids})
        AND m.category_id IN (${CATEGORY_LIST})
      ORDER BY m.order_id, m.service_date, m.id`,
  )
}

/**
 * Order header + customer. The customer chain is
 * `tbl_checkout_ids.user_id` → `users.id` → `tbl_customer.customer_id`; every
 * hop is a LEFT JOIN so a deleted or missing user never drops the order.
 * Soft-deleted orders (`deleted_at`) are excluded.
 */
export async function fetchOrderCustomers(orderIds: number[]): Promise<B2cOrderCustomer[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  return b2cQuery<B2cOrderCustomer>(
    `SELECT ci.id              AS order_id,
            ci.user_id,
            ci.total_amount, ci.paid_amount, ci.balance_amount,
            ci.discount_amount, ci.delivery_amount,
            ci.payment_status, ci.checkout_status, ci.checkout_date,
            cu.customer_fname       AS customer_name,
            cu.customer_email       AS customer_email,
            cu.contact_number       AS customer_phone,
            cu.customer_nationality AS customer_nationality
       FROM tbl_checkout_ids ci
       LEFT JOIN users        u  ON u.id           = ci.user_id
       LEFT JOIN tbl_customer cu ON cu.customer_id = u.id
      WHERE ci.id IN (${ids})
        AND ci.deleted_at IS NULL`,
  )
}

/**
 * Flight bookings for the given orders. This is the only place a flight order's
 * destination, real pax counts and passenger names can come from —
 * `checkouts_more_data` stores flights with `product_id = 0`, a blank product name
 * and zero quantities.
 *
 * Ordered by `id` so that when an order was re-priced or re-booked (multiple rows
 * per order), the caller can take the latest attempt.
 */
export async function fetchFlightBookings(orderIds: number[]): Promise<B2cFlightBooking[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  return b2cQuery<B2cFlightBooking>(
    `SELECT f.order_id, f.pnr, f.flight_provider, f.requested_data, f.response_data
       FROM aahaas_flight_bookingsv2 f
      WHERE f.order_id IN (${ids})
      ORDER BY f.order_id, f.id`,
  )
}

/**
 * Where each main category keeps its pre-booking row (`tbl_checkouts.related_order_id`
 * points at `key`). The same switch the Aahaas admin's supplier voucher uses.
 */
const PREBOOKING_TABLES = [
  { alias: 'ls', table: 'tbl_lifestyle_bookings',  key: 'lifestyle_booking_id',   categories: [3] },
  { alias: 'hp', table: 'hotel_prebooking',        key: 'prebooking_id',          categories: [4] },
  { alias: 'ep', table: 'tbl_essentials_preorder', key: 'essential_pre_order_id', categories: [1, 2] },
  { alias: 'ed', table: 'edu_tbl_booking',         key: 'booking_id',             categories: [5] },
] as const

/**
 * Which pre-booking tables actually carry traveller columns on the live store.
 * The admin code reads `travel_buddy_*_id` null-safely, so it says nothing about
 * whether a column exists — and on production `tbl_essentials_preorder` has none.
 * Asking the schema keeps one table's drift from breaking the whole lookup.
 */
async function travellerColumns(): Promise<Map<string, { adult: boolean; child: boolean }>> {
  const rows = await b2cQuery<mysql.RowDataPacket & { table_name: string; column_name: string }>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${PREBOOKING_TABLES.map((t) => `'${t.table}'`).join(', ')})
        AND COLUMN_NAME IN ('travel_buddy_adult_id', 'travel_buddy_child_id')`,
  )
  const out = new Map<string, { adult: boolean; child: boolean }>()
  for (const r of rows) {
    const cols = out.get(r.table_name) ?? { adult: false, child: false }
    if (r.column_name === 'travel_buddy_adult_id') cols.adult = true
    if (r.column_name === 'travel_buddy_child_id') cols.child = true
    out.set(r.table_name, cols)
  }
  return out
}

/**
 * Traveller ids per order line, across every pre-booking table that has them.
 * Only one of the LEFT JOINs can match a given line because each is gated on its
 * category. Flights (6) are not here — their manifest lives in
 * `aahaas_flight_bookingsv2`.
 */
export async function fetchOrderLineTravellers(orderIds: number[]): Promise<B2cOrderLineTravellers[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  const columns = await travellerColumns()
  const usable = PREBOOKING_TABLES.filter((t) => columns.get(t.table)?.adult)
  if (usable.length === 0) return []

  const pick = (col: 'adult' | 'child') => {
    const parts = usable
      .filter((t) => columns.get(t.table)?.[col])
      .map((t) => `${t.alias}.travel_buddy_${col}_id`)
    if (parts.length === 0) return 'NULL'
    return parts.length === 1 ? parts[0] : `COALESCE(${parts.join(', ')})`
  }
  const joins = usable
    .map((t) => `LEFT JOIN ${t.table} ${t.alias} ON c.main_category_id IN (${t.categories.join(', ')})
                                AND ${t.alias}.${t.key} = c.related_order_id`)
    .join('\n       ')

  return b2cQuery<B2cOrderLineTravellers>(
    `SELECT m.order_id, m.id AS line_id, m.service_date,
            ${pick('adult')} AS adult_ids,
            ${pick('child')} AS child_ids
       FROM checkouts_more_data m
       JOIN tbl_checkouts c ON c.id = m.checkout_id
       ${joins}
      WHERE m.order_id IN (${ids})
      ORDER BY m.order_id, m.service_date, m.id`,
  )
}

/** Booking-row name columns that exist on the live store, "table.column". */
async function bookingNameColumns(): Promise<Set<string>> {
  const rows = await b2cQuery<mysql.RowDataPacket & { t: string; c: string }>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'tbl_lifestyle_bookings' AND COLUMN_NAME IN ('lifestyle_adult_details', 'lifestyle_children_details'))
          OR (TABLE_NAME = 'edu_tbl_booking'        AND COLUMN_NAME = 'student_name')
          OR (TABLE_NAME = 'hotel_prebooking'       AND COLUMN_NAME = 'bookingdataset'))`,
  )
  return new Set(rows.map((r) => `${r.t}.${r.c}`))
}

/**
 * Traveller names stored on the booking rows, per order line. Most checkouts
 * leave `aahaas_passenger_details` empty, but the lifestyle / education / hotel
 * booking keeps the names the customer typed — the same fields the Aahaas admin
 * and the accounts system's B2cTravellerService read. Flights are not here;
 * their manifest comes from `aahaas_flight_bookingsv2` (see b2c-flight.ts).
 *
 * Each booking table is joined only for its own category: `related_order_id`
 * is a different table's key per category, so an unfiltered join would hand a
 * hotel line somebody else's lifestyle travellers. Hotel payloads are large, so
 * only the `paxDetails` subtree comes back, and only from valid JSON.
 */
export async function fetchOrderLineBookingNames(orderIds: number[]): Promise<B2cOrderLineBookingNames[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  const cols = await bookingNameColumns()
  const has = (c: string) => cols.has(c)

  const lsAdults   = has('tbl_lifestyle_bookings.lifestyle_adult_details')    ? 'ls.lifestyle_adult_details'    : 'NULL'
  const lsChildren = has('tbl_lifestyle_bookings.lifestyle_children_details') ? 'ls.lifestyle_children_details' : 'NULL'
  const student    = has('edu_tbl_booking.student_name')                      ? 'ed.student_name'               : 'NULL'
  const hotelPax   = has('hotel_prebooking.bookingdataset')
    ? `CASE WHEN JSON_VALID(hp.bookingdataset) THEN JSON_EXTRACT(hp.bookingdataset, '$.paxDetails') END`
    : 'NULL'

  return b2cQuery<B2cOrderLineBookingNames>(
    `SELECT m.order_id, m.id AS line_id, m.service_date, c.main_category_id AS category_id,
            ${lsAdults} AS ls_adults, ${lsChildren} AS ls_children,
            ${student} AS student_name, ${hotelPax} AS hotel_pax
       FROM checkouts_more_data m
       JOIN tbl_checkouts c ON c.id = m.checkout_id
       LEFT JOIN tbl_lifestyle_bookings ls ON c.main_category_id = 3 AND ls.lifestyle_booking_id = c.related_order_id
       LEFT JOIN hotel_prebooking       hp ON c.main_category_id = 4 AND hp.prebooking_id        = c.related_order_id
       LEFT JOIN edu_tbl_booking        ed ON c.main_category_id = 5 AND ed.booking_id           = c.related_order_id
      WHERE m.order_id IN (${ids})
      ORDER BY m.order_id, m.service_date, m.id`,
  )
}

export async function fetchPassengerDetails(passengerIds: number[]): Promise<B2cPassengerDetail[]> {
  if (passengerIds.length === 0) return []
  const ids = sanitizeIds(passengerIds)
  return b2cQuery<B2cPassengerDetail>(
    `SELECT id, passenger_title, passenger_first_name, passenger_last_name
       FROM aahaas_passenger_details
      WHERE id IN (${ids})`,
  )
}

/**
 * One place the store recorded who an order is *for*, as opposed to the
 * account that placed it. `lead_passenger` is the raw JSON object when the
 * source keeps one; `name` / `email` / `phone` are plain cells.
 */
export interface B2cLeadSourceRow extends mysql.RowDataPacket {
  order_id: number
  source: 'confirmation' | 'payment-link' | 'flow-booking'
  lead_passenger: string | null
  name: string | null
  email: string | null
  phone: string | null
}

/** Column sets the lead sources need; probed once, since the tables belong to other apps. */
const LEAD_SOURCE_TABLES = {
  travel_ai_checkout_sessions: ['order_id', 'meta'],
  booking_payment_links: ['order_id', 'meta', 'customer_name', 'recipient'],
  ai_flow_booking: ['order_id', 'customer_name', 'customer_email', 'customer_phone'],
} as const

let leadSourceTables: { at: number; usable: Set<string> } | null = null

async function usableLeadSourceTables(): Promise<Set<string>> {
  if (leadSourceTables && Date.now() - leadSourceTables.at < 30 * 60_000) return leadSourceTables.usable
  const names = Object.keys(LEAD_SOURCE_TABLES)
  const rows = await b2cQuery<mysql.RowDataPacket & { t: string; c: string }>(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [names],
  )
  const usable = new Set<string>()
  for (const [table, needed] of Object.entries(LEAD_SOURCE_TABLES)) {
    const have = new Set(rows.filter((r) => r.t === table).map((r) => String(r.c).toLowerCase()))
    if (needed.every((c) => have.has(c))) usable.add(table)
  }
  leadSourceTables = { at: Date.now(), usable }
  return usable
}

/**
 * Who each order was booked under, from the same three places AahaasFlow reads
 * (n8n-project `flow.lead.js`), newest row first within each source:
 *
 *   1. `travel_ai_checkout_sessions.meta.lead_passenger` — the console's Confirm panel
 *   2. `booking_payment_links` — `meta.lead_passenger`, else its `customer_name`
 *      (WhatsApp / social orders placed on the shared `admin6611` login)
 *   3. `ai_flow_booking` — AahaasFlow's own intake row
 *
 * Only the `lead_passenger` JSON path is lifted out — the blobs are never read
 * whole. A table that is missing (or lacks a column) is skipped, and one source
 * failing never hides the others. Which row wins is decided in
 * `b2c-confirmed-lead.ts`, not here.
 */
export async function fetchOrderLeadSources(orderIds: number[]): Promise<B2cLeadSourceRow[]> {
  if (orderIds.length === 0) return []
  const ids = sanitizeIds(orderIds)
  const usable = await usableLeadSourceTables()
  const lp = (col: string) => `CASE WHEN JSON_VALID(${col}) THEN JSON_EXTRACT(${col}, '$.lead_passenger') END`

  const queries: Array<Promise<B2cLeadSourceRow[]>> = []
  if (usable.has('travel_ai_checkout_sessions')) {
    queries.push(b2cQuery<B2cLeadSourceRow>(
      `SELECT order_id, 'confirmation' AS source, ${lp('meta')} AS lead_passenger,
              NULL AS name, NULL AS email, NULL AS phone
         FROM travel_ai_checkout_sessions WHERE order_id IN (${ids}) ORDER BY id DESC`,
    ))
  }
  if (usable.has('booking_payment_links')) {
    queries.push(b2cQuery<B2cLeadSourceRow>(
      `SELECT order_id, 'payment-link' AS source, ${lp('meta')} AS lead_passenger,
              customer_name AS name, NULL AS email, recipient AS phone
         FROM booking_payment_links WHERE order_id IN (${ids}) ORDER BY id DESC`,
    ))
  }
  if (usable.has('ai_flow_booking')) {
    queries.push(b2cQuery<B2cLeadSourceRow>(
      `SELECT order_id, 'flow-booking' AS source, NULL AS lead_passenger,
              customer_name AS name, customer_email AS email, customer_phone AS phone
         FROM ai_flow_booking WHERE order_id IN (${ids})`,
    ))
  }

  const settled = await Promise.allSettled(queries)
  const rows: B2cLeadSourceRow[] = []
  for (const s of settled) {
    if (s.status === 'fulfilled') rows.push(...s.value)
    else console.error('[b2c-db] a lead-passenger source could not be read (non-fatal):', s.reason)
  }
  return rows
}

/**
 * Order ids are inlined rather than bound, so they must be provably numeric.
 * Anything non-integer is a programming error and throws rather than being
 * coerced — this is the one place SQL could otherwise be injected.
 */
function sanitizeIds(ids: number[]): string {
  const clean = ids.map((id) => {
    if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid B2C order id: ${String(id)}`)
    return String(id)
  })
  return clean.join(',')
}
