/**
 * Aahaas B2B store DB client — STRICTLY READ-ONLY.
 *
 * The B2B agent portal (flights, hotels, insurance, lifestyle) writes its
 * bookings into the `b2b_*` tables of the live Aahaas schema. This module reads
 * them and nothing else: `b2bQuery()` runs every statement through
 * {@link assertReadOnly} first, so a stray INSERT/UPDATE/DELETE/DDL fails inside
 * our own process before it ever reaches the wire, and `multipleStatements` is
 * left at its default (false) so a second statement cannot be smuggled in
 * through a parameter.
 *
 * Deliberately a carbon copy of the safety design in `b2c-db.ts` — fresh
 * connection per query (no shared pool, which survives Next.js hot-reload and
 * Lambda freezes), `query()` rather than `execute()` because this server rejects
 * prepared `LIMIT ?`.
 *
 * Schema: `DB_DATABASE_B2B`, falling back to `DB_DATABASE_B2C` — the b2b_* tables
 * live alongside the storefront tables on the same host and credentials.
 */
import mysql from 'mysql2/promise'

/** Hard ceiling so a stalled SSL negotiation can never hang a request forever. */
const CONN_TIMEOUT_MS = 15_000

/** Statements this client is willing to send. Anything else is a bug, not a query. */
const READ_ONLY_RE = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i

export class B2bWriteAttemptError extends Error {
  constructor(sql: string) {
    super(`Refused a non-read-only statement against the B2B database: ${sql.slice(0, 120)}`)
    this.name = 'B2bWriteAttemptError'
  }
}

/**
 * Throws unless `sql` is a single read-only statement. Rejecting `;` is what
 * makes the check meaningful — without it, "SELECT 1; DROP TABLE x" would pass.
 */
export function assertReadOnly(sql: string): void {
  if (!READ_ONLY_RE.test(sql)) throw new B2bWriteAttemptError(sql)
  // Allow a single trailing semicolon, but nothing after it.
  if (/;\s*\S/.test(sql)) throw new B2bWriteAttemptError(sql)
}

function getDbConfig() {
  return {
    host:     (process.env.DB_HOST ?? '').trim(),
    port:     Number((process.env.DB_PORT ?? '3306').trim()),
    // The one value that differs from the ops connection.
    database: (process.env.DB_DATABASE_B2B ?? process.env.DB_DATABASE_B2C ?? '').trim(),
    user:     (process.env.DB_USERNAME ?? '').trim(),
    password: (process.env.DB_PASSWORD ?? '').trim(),
    connectTimeout:    CONN_TIMEOUT_MS,
    enableKeepAlive:   false,
    supportBigNumbers: true,
    bigNumberStrings:  false,
    // DATE columns come back as 'YYYY-MM-DD' strings — no implicit timezone shift,
    // which matters because departure_date/check_in_date are calendar dates.
    dateStrings:       true,
    timezone:          'Z',
    multipleStatements: false,
    ssl: { rejectUnauthorized: false },
  }
}

export function isB2bConfigured(): boolean {
  const { host, user, database } = getDbConfig()
  return Boolean(host && user && database)
}

/** The schema name in use, for display on the page header. */
export function b2bDatabaseName(): string | null {
  return getDbConfig().database || null
}

async function getConn(): Promise<mysql.Connection> {
  if (!isB2bConfigured()) {
    throw new Error('B2B database is not configured — set DB_HOST / DB_USERNAME / DB_DATABASE_B2B')
  }
  // connectTimeout alone is unreliable against RDS when SSL negotiation stalls.
  return await Promise.race([
    mysql.createConnection(getDbConfig()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`B2B DB connection timed out after ${CONN_TIMEOUT_MS / 1000}s`)),
        CONN_TIMEOUT_MS,
      ),
    ),
  ])
}

/** Run one read-only statement on its own connection. */
export async function b2bQuery<T extends mysql.RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  assertReadOnly(sql)
  const conn = await getConn()
  try {
    const [rows] = await conn.query<T[]>(sql, params)
    return rows
  } finally {
    await conn.end().catch(() => { /* never mask the real error with a close failure */ })
  }
}

/**
 * Run several read-only statements over ONE connection.
 *
 * A booking detail view needs five reads (header + four component tables); five
 * TLS handshakes to RDS is most of the page's latency. Each statement still goes
 * through {@link assertReadOnly} individually.
 */
export async function b2bBatch<T>(
  fn: (q: <R extends mysql.RowDataPacket>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const conn = await getConn()
  try {
    return await fn(async <R extends mysql.RowDataPacket>(sql: string, params: unknown[] = []) => {
      assertReadOnly(sql)
      const [rows] = await conn.query<R[]>(sql, params)
      return rows
    })
  } finally {
    await conn.end().catch(() => { /* see above */ })
  }
}
