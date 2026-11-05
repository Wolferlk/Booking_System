/**
 * Travel Quote GPT database client — the n8n-project's `production_live1`,
 * STRICTLY READ-ONLY.
 *
 * The Daily Sales Report reads the same quotation, call, signup and prompt
 * tables the n8n-project's "Aahaas BLR Daily Performance" digest is built from
 * (`src/modules/quote-crm/catalogue/datasets.js` over there). Nothing here may
 * ever write to them: every statement goes through `assertReadOnly()` — the
 * same guard the B2C store client uses — before it reaches the wire, and
 * `multipleStatements` stays off so a second statement cannot ride in on a
 * parameter.
 *
 * ## Which connection
 *
 * `SALES_CRM_DB_*` when it is set, otherwise the `WA_SHARED_DB_*` connection
 * the WhatsApp inbox sync already uses — that one points at n8n's own database
 * (it reads `tbl_whatsapp_status_receipts` there), which is exactly where these
 * tables live. With neither configured every read reports itself unavailable
 * and the report says so, section by section, rather than printing zeros.
 *
 * ## Schema drift
 *
 * Several columns the digest reads are patched in lazily by the n8n modules
 * that own them (`work_team`, `crm_source`, `confirmed_at`, …). `probeSchema()`
 * asks INFORMATION_SCHEMA once per process which tables and columns exist, so
 * the collector can leave an absent column out instead of taking a whole
 * section down with `Unknown column`.
 */
import mysql from 'mysql2/promise'
import { assertReadOnly } from '@/lib/b2c-db'

/** Hard ceiling per statement — a stalled scan must never hold the send. */
const QUERY_TIMEOUT_MS = Number(process.env.SALES_CRM_QUERY_TIMEOUT_MS || 30_000)
const CONNECT_TIMEOUT_MS = 15_000
const SCHEMA_TTL_MS = 10 * 60_000

let pool: mysql.Pool | null | undefined

function config(): mysql.PoolOptions | null {
  const pick = (name: string) => (process.env[`SALES_CRM_DB_${name}`] ?? process.env[`WA_SHARED_DB_${name}`] ?? '').trim()
  const host = pick('HOST')
  const user = pick('USER') || pick('USERNAME')
  if (!host || !user) return null
  return {
    host,
    port: Number(pick('PORT') || 3306),
    user,
    password: process.env.SALES_CRM_DB_PASSWORD ?? process.env.WA_SHARED_DB_PASSWORD ?? '',
    database: pick('DATABASE') || 'production_live1',
    connectionLimit: 3,
    connectTimeout: CONNECT_TIMEOUT_MS,
    // n8n writes every DATETIME as a UTC wall-clock string (its mysql-pool.js
    // sets the same). Read back as UTC, or every timestamp shifts by +5:30.
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    ...(process.env.SALES_CRM_DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
  }
}

function getPool(): mysql.Pool | null {
  if (pool !== undefined) return pool
  const cfg = config()
  pool = cfg ? mysql.createPool(cfg) : null
  if (!pool) console.warn('[SalesReport] SALES_CRM_DB_* / WA_SHARED_DB_* not configured — Travel Quote GPT sections unavailable')
  return pool
}

export function isSalesCrmConfigured(): boolean {
  return config() !== null
}

/** Run one read-only statement. Throws on a write, a timeout or a missing connection. */
export async function crmQuery<T extends mysql.RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  assertReadOnly(sql)
  const db = getPool()
  if (!db) throw new Error('The Travel Quote GPT database is not configured (SALES_CRM_DB_* or WA_SHARED_DB_*).')
  const [rows] = await db.query<T[]>({ sql, timeout: QUERY_TIMEOUT_MS }, params)
  return rows
}

// ─── Schema probe ─────────────────────────────────────────────────────────────

export interface CrmSchema {
  /** Lower-cased table name → its lower-cased column names. Absent = no table. */
  tables: Map<string, Set<string>>
  has(table: string, column?: string): boolean
}

let schemaCache: { at: number; schema: Promise<CrmSchema> } | null = null

export const CRM_TABLES = [
  'tbl_future_travel_quotation',
  'tbl_future_travel_quote_state',
  'tbl_future_travel_portfolio',
  'tbl_future_travel_quote_handler',
  'tbl_future_travel_message',
  'tbl_future_travel_crm_activity',
  'tbl_sales_call',
  'tbl_sales_lead',
  'tbl_sales_campaign',
  'ai_users',
] as const

interface ColumnRow extends mysql.RowDataPacket { t: string; c: string }

async function loadSchema(): Promise<CrmSchema> {
  const rows = await crmQuery<ColumnRow>(
    `SELECT LOWER(TABLE_NAME) AS t, LOWER(COLUMN_NAME) AS c
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${CRM_TABLES.map(() => '?').join(', ')})`,
    [...CRM_TABLES],
  )
  const tables = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = tables.get(r.t) ?? new Set<string>()
    set.add(r.c)
    tables.set(r.t, set)
  }
  return {
    tables,
    has(table: string, column?: string) {
      const cols = tables.get(table.toLowerCase())
      if (!cols) return false
      return column ? cols.has(column.toLowerCase()) : true
    },
  }
}

/** Which tables and columns exist, cached for ten minutes per process. */
export function probeSchema(): Promise<CrmSchema> {
  const now = Date.now()
  if (schemaCache && now - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.schema
  const schema = loadSchema()
  schemaCache = { at: now, schema }
  schema.catch(() => { schemaCache = null })
  return schema
}

/** `col` when the column exists, otherwise a typed NULL under the same alias. */
export function optionalCol(schema: CrmSchema, table: string, expr: string, column: string, as: string): string {
  return schema.has(table, column) ? `${expr} AS ${as}` : `NULL AS ${as}`
}
