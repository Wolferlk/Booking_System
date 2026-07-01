/**
 * External Accounts DB client — apple-holidays / invoice_processor MySQL
 *
 * Design: fresh connection per request (no shared pool).
 * This avoids stale-connection problems in Next.js dev hot-reload AND
 * prevents cached broken state from silently returning 0 rows.
 *
 * All queries use query() not execute() — prepared statements fail for
 * LIMIT ? params on this MySQL server.
 */
import mysql from 'mysql2/promise'

// AWS RDS connection timeout — hard ceiling so the page never hangs forever
const CONN_TIMEOUT_MS = 15_000

function getDbConfig() {
  const rawPassword =
    process.env.ACCOUNTS_DB_PASSWORD ??
    '&l+>XV7=Q@iF&B9s'

  return {
    host:     (process.env.ACCOUNTS_DB_HOST ?? 'aahaas-prod-database-4.crgimm6mohf1.ap-southeast-1.rds.amazonaws.com').trim(),
    port:     Number((process.env.ACCOUNTS_DB_PORT ?? '3306').trim()),
    database: (process.env.ACCOUNTS_DB_DATABASE ?? 'invoice_processor').trim(),
    user:     (process.env.ACCOUNTS_DB_USERNAME ?? 'root').trim(),
    password: rawPassword.trim(),
    connectTimeout:    CONN_TIMEOUT_MS,
    enableKeepAlive:   false,
    supportBigNumbers: true,
    bigNumberStrings:  false,
    dateStrings:       false,
    timezone:          'Z',
    // Allow SSL for AWS RDS without enforcing cert validation
    ssl: { rejectUnauthorized: false },
  }
}

// ─── Connection factory ───────────────────────────────────────────────────────

async function getConn(): Promise<mysql.Connection> {
  // Race the connection against a hard timeout — connectTimeout alone is not
  // always reliable against AWS RDS when SSL negotiation stalls
  const conn = await Promise.race([
    mysql.createConnection(getDbConfig()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Accounts DB connection timed out after ${CONN_TIMEOUT_MS / 1000}s`)),
        CONN_TIMEOUT_MS,
      )
    ),
  ])
  return conn
}

// ─── Helper: run one query on a fresh connection ─────────────────────────────

async function q<T extends mysql.RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const conn = await getConn()
  try {
    const [rows] = await conn.query<T[]>(sql, params)
    return rows
  } finally {
    // always release — never leaves dangling connections
    await conn.end().catch(() => { /* ignore close errors */ })
  }
}

// ─── Exported types ───────────────────────────────────────────────────────────

export interface PnlRecord {
  id: number
  sno: string | null
  vendor_name: string | null
  invoice_number: string | null
  is_number: string | null
  pnl_date: string | null
  invoice_date: string | null
  amount: number | null
  profit_loss: number | null
  total_pax: number | null
  total_nights: number | null
  actual_amount: number | null
  budget_amount: number | null
  process: string | null
  paid_amount: number | null
  exchange_rate: number | null
  gst: number | null
  currency: string | null
  category: string | null
  country_code: string | null
  status: string | null
  tour_ref: string | null
  agent_name: string | null
  start_date: string | null
  end_date: string | null
  control_number: string | null
  remarks: string | null
  pnl_month: string | null
  pnl_year: string | null
  update_status: string | null
  update_count: number | null
  created_at: string | null
  updated_at: string | null
}

export interface PnlItem {
  id: number
  pnl_record_id: number
  control_number: string | null
  invoice_number: string | null
  start_date: string | null
  end_date: string | null
  type: string | null
  credit_type: string | null
  agent_name: string | null
  client_name: string | null
  check_in_date: string | null
  check_out_date: string | null
  hotel_name: string | null
  transport_name: string | null
  service_name: string | null
  country_code: string | null
  currency: string | null
  amount_original: number | null
  exchange_rate: number | null
  amount_converted: number | null
  item_details: string | null
  status: string | null
}

export interface PnlFullRecord {
  record: PnlRecord
  items: PnlItem[]
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Try to auto-match a booking against the external PNL database. */
export async function findPnlByIdentifiers(opts: {
  isNumber?: string | null
  tourRef?: string | null
  invoiceNumber?: string | null
}): Promise<{ record: PnlRecord; matchedBy: string; matchedValue: string } | null> {
  const checks: Array<{ field: string; value: string | null | undefined }> = [
    { field: 'is_number',      value: opts.isNumber },
    { field: 'tour_ref',       value: opts.tourRef },
    { field: 'invoice_number', value: opts.invoiceNumber },
  ]

  for (const { field, value } of checks) {
    if (!value?.trim()) continue
    const rows = await q<mysql.RowDataPacket>(
      `SELECT * FROM pnl_records WHERE \`${field}\` = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
      [value.trim()],
    )
    if (rows.length > 0) {
      return { record: rows[0] as unknown as PnlRecord, matchedBy: field, matchedValue: value.trim() }
    }
  }
  return null
}

/** Fetch one PNL record + its items by external ID. */
export async function fetchPnlById(externalId: number): Promise<PnlFullRecord | null> {
  const conn = await getConn()
  try {
    const [recRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT * FROM pnl_records WHERE id = ? LIMIT 1',
      [externalId],
    )
    if (recRows.length === 0) return null

    const [itemRows] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT * FROM pnl_items WHERE pnl_record_id = ? ORDER BY id ASC',
      [externalId],
    )
    return {
      record: recRows[0] as unknown as PnlRecord,
      items:  itemRows as unknown as PnlItem[],
    }
  } finally {
    await conn.end().catch(() => { /* ignore */ })
  }
}

/** Fetch all PNL records ordered by newest first. Limit is inlined (validated int). */
export async function fetchAllPnlRecords(limit: number): Promise<PnlRecord[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000)
  const rows = await q<mysql.RowDataPacket>(
    `SELECT * FROM pnl_records WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ${safeLimit}`,
  )
  return rows as unknown as PnlRecord[]
}

/** Fetch PNL records filtered by a search term. */
export async function fetchPnlRecordsFiltered(search: string, limit: number): Promise<PnlRecord[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000)
  const like = `%${search.trim()}%`
  const rows = await q<mysql.RowDataPacket>(
    `SELECT * FROM pnl_records
     WHERE deleted_at IS NULL
       AND (is_number LIKE ? OR tour_ref LIKE ? OR invoice_number LIKE ?
            OR control_number LIKE ? OR vendor_name LIKE ? OR agent_name LIKE ?)
     ORDER BY id DESC
     LIMIT ${safeLimit}`,
    [like, like, like, like, like, like],
  )
  return rows as unknown as PnlRecord[]
}

/** Search external PNL records by a free-text query (used by the manual-link search box). */
export async function searchPnlRecords(query: string, limit = 20): Promise<PnlRecord[]> {
  return fetchPnlRecordsFiltered(query, limit)
}

/** Ping the external DB — returns true if reachable, false otherwise. */
export async function pingAccountsDb(): Promise<boolean> {
  try {
    const conn = await getConn()
    await conn.ping()
    await conn.end().catch(() => { /* ignore */ })
    return true
  } catch {
    return false
  }
}
