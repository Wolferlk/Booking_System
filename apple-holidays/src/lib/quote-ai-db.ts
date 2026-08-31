/**
 * Apple Quote AI DB client — STRICTLY READ-ONLY.
 *
 * The quotation tool writes one row per quote thread into
 * `apple_quote_ai.tbl_corporate_parties`, and that row carries the thing OPS is
 * missing: the *real* file handler who owns the file. Bookings that arrive here
 * from the 30 Sundays feed land with the placeholder handler "30sundays Aahaas"
 * instead of a person's name; this schema is where the person's name lives,
 * keyed by `is_number` — the same IS number our bookings are keyed on.
 *
 * A carbon copy of the safety design in `b2b-db.ts`: every statement goes
 * through {@link assertReadOnly} before it reaches the wire, `multipleStatements`
 * stays false so a second statement cannot be smuggled in through a parameter,
 * and each query gets a fresh connection (no shared pool, which survives Next.js
 * hot-reload and Lambda freezes). Nothing in this module can write to the quote
 * database — the only writes this feature performs are to our own `bookings`
 * table, through Prisma.
 *
 * Connection: QUOTE_AI_DB_* if set, otherwise the ops DB_* host and credentials
 * (the schema sits on the same RDS instance). Schema defaults to
 * `apple_quote_ai`.
 */
import mysql from 'mysql2/promise'

/** Hard ceiling so a stalled SSL negotiation can never hang a request forever. */
const CONN_TIMEOUT_MS = 15_000

/** Statements this client is willing to send. Anything else is a bug, not a query. */
const READ_ONLY_RE = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i

export class QuoteAiWriteAttemptError extends Error {
  constructor(sql: string) {
    super(`Refused a non-read-only statement against the Quote AI database: ${sql.slice(0, 120)}`)
    this.name = 'QuoteAiWriteAttemptError'
  }
}

/**
 * Throws unless `sql` is a single read-only statement. Rejecting `;` is what
 * makes the check meaningful — without it, "SELECT 1; DROP TABLE x" would pass.
 */
export function assertReadOnly(sql: string): void {
  if (!READ_ONLY_RE.test(sql)) throw new QuoteAiWriteAttemptError(sql)
  // Allow a single trailing semicolon, but nothing after it.
  if (/;\s*\S/.test(sql)) throw new QuoteAiWriteAttemptError(sql)
}

function getDbConfig() {
  return {
    host:     (process.env.QUOTE_AI_DB_HOST     ?? process.env.DB_HOST     ?? '').trim(),
    port:     Number((process.env.QUOTE_AI_DB_PORT ?? process.env.DB_PORT ?? '3306').trim()),
    database: (process.env.QUOTE_AI_DB_DATABASE ?? 'apple_quote_ai').trim(),
    user:     (process.env.QUOTE_AI_DB_USERNAME ?? process.env.DB_USERNAME ?? '').trim(),
    password: (process.env.QUOTE_AI_DB_PASSWORD ?? process.env.DB_PASSWORD ?? '').trim(),
    connectTimeout:    CONN_TIMEOUT_MS,
    enableKeepAlive:   false,
    supportBigNumbers: true,
    bigNumberStrings:  false,
    dateStrings:       true,
    timezone:          'Z',
    multipleStatements: false,
    ssl: { rejectUnauthorized: false },
  }
}

export function isQuoteAiConfigured(): boolean {
  const { host, user, database } = getDbConfig()
  return Boolean(host && user && database)
}

/** The schema name in use, for display on the settings card. */
export function quoteAiDatabaseName(): string | null {
  return getDbConfig().database || null
}

async function getConn(): Promise<mysql.Connection> {
  if (!isQuoteAiConfigured()) {
    throw new Error('Quote AI database is not configured — set DB_HOST / DB_USERNAME (or QUOTE_AI_DB_*)')
  }
  // connectTimeout alone is unreliable against RDS when SSL negotiation stalls.
  return await Promise.race([
    mysql.createConnection(getDbConfig()),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Quote AI DB connection timed out after ${CONN_TIMEOUT_MS / 1000}s`)),
        CONN_TIMEOUT_MS,
      ),
    ),
  ])
}

/** Run one read-only statement on its own connection. */
export async function quoteAiQuery<T extends mysql.RowDataPacket>(
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
