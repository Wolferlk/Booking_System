/**
 * Aahaas B2C store DB client — production_live1 MySQL/MariaDB, STRICTLY READ-ONLY.
 *
 * This is the live customer-facing Aahaas database. Nothing in this file may ever
 * write to it: `q()` runs every statement through {@link assertReadOnly} first, so
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

/** Hard ceiling so a stalled SSL negotiation can never hang a request forever. */
const CONN_TIMEOUT_MS = 15_000

/** Travel-only main categories: 3 Lifestyle, 4 Hotels, 5 Education, 6 Flights.
 *  1 Essential / 2 Non Essential are physical retail goods and are never bookings. */
export const TRAVEL_CATEGORY_IDS = [3, 4, 5, 6] as const

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

async function q<T extends mysql.RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
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

// ─── Queries ──────────────────────────────────────────────────────────────────

const CATEGORY_LIST = TRAVEL_CATEGORY_IDS.join(',')

/**
 * Candidate orders: one row per Aahaas order that contains at least one TRAVEL
 * product with a future service date.
 *
 * `HAVING MIN(service_date) >= ?` is the "upcoming travels only" gate — an order
 * whose travel has already started is not something ops can still prepare for.
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
  return q<B2cOrderHeader>(
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
  return q<B2cOrderProduct>(
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
  return q<B2cOrderCustomer>(
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
  return q<B2cFlightBooking>(
    `SELECT f.order_id, f.pnr, f.flight_provider, f.requested_data, f.response_data
       FROM aahaas_flight_bookingsv2 f
      WHERE f.order_id IN (${ids})
      ORDER BY f.order_id, f.id`,
  )
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
