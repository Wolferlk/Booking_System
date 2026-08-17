/**
 * Chat's connection to the shared database.
 *
 * The chat tables live in `invoice_processor` — the Accounts schema — because
 * that is the app that owns their migrations. This module is how OPS reads and
 * writes the SAME rows: a message sent here and a message sent in Accounts are
 * one row in one table, and nothing is mirrored between the two systems.
 *
 * WHY NOT src/lib/accounts-db.ts
 * ------------------------------
 * That module deliberately opens a fresh connection per query, which is right
 * for the occasional P&L lookup and wrong for a chat that polls every 1.5s. This
 * one keeps a small pool. It is otherwise the same server, the same credentials
 * and the same database.
 *
 * WRITE SAFETY
 * ------------
 * The credentials reach the whole Accounts schema — invoices, payments, P&L. So
 * writes go through `chatWrite`, which refuses any statement that does not
 * target a `chat_*` table. That guard is the thing standing between a chat bug
 * and live financial data; do not route around it, and do not widen it for
 * anything that is not part of chat.
 */
import mysql from 'mysql2/promise'

const CONN_TIMEOUT_MS = 15_000

function config(): mysql.PoolOptions {
  return {
    host: (process.env.ACCOUNTS_DB_HOST ?? '').trim(),
    port: Number((process.env.ACCOUNTS_DB_PORT ?? '3306').trim()),
    database: (process.env.ACCOUNTS_DB_DATABASE ?? 'invoice_processor').trim(),
    user: (process.env.ACCOUNTS_DB_USERNAME ?? '').trim(),
    password: (process.env.ACCOUNTS_DB_PASSWORD ?? '').trim(),
    connectTimeout: CONN_TIMEOUT_MS,
    // Small on purpose: this pool exists to stop the poll re-handshaking, not to
    // run heavy work. Chat queries are single indexed reads.
    connectionLimit: 6,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    supportBigNumbers: true,
    bigNumberStrings: false,
    dateStrings: false,
    timezone: 'Z',
    ssl: { rejectUnauthorized: false },
    // This app runs on Vercel: an instance is frozen between invocations and
    // may be thawed minutes later still holding pooled sockets the database has
    // long since closed. Retiring idle connections means the next request opens
    // a live one instead of writing into a socket that is already gone — which
    // is how a sent message ended up allocating a row id and then rolling back.
    maxIdle: 2,
    idleTimeout: 30_000,
  }
}

/**
 * Errors that say "this connection is gone", not "this statement is wrong".
 *
 * Only these are retried: a broken pipe costs a retry, a bad query must fail
 * loudly the first time.
 */
const TRANSIENT = new Set([
  'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED',
  'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT', 'ER_CON_COUNT_ERROR', 'POOL_CLOSED', 'POOL_CONNLIMIT',
])

function isTransient(err: unknown): boolean {
  const e = err as { code?: string; fatal?: boolean } | null
  return Boolean(e && (TRANSIENT.has(e.code ?? '') || (e.fatal && !e.code?.startsWith('ER_'))))
}

/**
 * Run something against the pool, once more if the connection — not the
 * statement — was what failed.
 *
 * Every caller passed here must be safe to run twice. Reads always are. Writes
 * are the caller's responsibility: sendMessage() is idempotent through
 * `client_uuid`, which is exactly what that column is for.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (!isTransient(err)) throw err

    console.warn(`[chat] ${what} lost its connection (${(err as { code?: string })?.code}); retrying once.`)
    // A moment for the pool to hand out a fresh socket rather than the dead one.
    await new Promise(r => setTimeout(r, 120))
    return fn()
  }
}

// Cached on globalThis so Next.js dev hot-reload does not leak a pool per edit.
declare global {
  // eslint-disable-next-line no-var
  var __chatPool: mysql.Pool | undefined
}

function pool(): mysql.Pool {
  if (!global.__chatPool) global.__chatPool = mysql.createPool(config())
  return global.__chatPool
}

/**
 * Read.
 *
 * `query()` not `execute()` — same reason as accounts-db.ts: prepared statements
 * fail for LIMIT placeholders on this MySQL server.
 */
export async function chatQuery<T extends mysql.RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withRetry('read', async () => {
    const [rows] = await pool().query<T[]>(sql, params)
    return rows
  })
}

export async function chatQueryOne<T extends mysql.RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await chatQuery<T>(sql, params)
  return rows[0] ?? null
}

/**
 * Every table this app may write in the Accounts database through chat.
 *
 * Nothing outside this list, ever. The chat feature has no business touching
 * invoices, payables, P&L or users, and the connection is privileged enough that
 * the restriction cannot be left to whoever writes the next query.
 */
const CHAT_TABLES = 'chat_conversations|chat_participants|chat_messages|chat_attachments|chat_reactions|chat_presence|chat_settings'

/**
 * The verb may carry modifiers. `INSERT IGNORE INTO` is a different string from
 * `INSERT INTO`, and the first version of this pattern only knew the second —
 * so the guard refused `INSERT IGNORE INTO chat_settings`, the statement that
 * creates a person's settings row on their very first visit. The whole of chat
 * then failed to load for anyone who had never had one, with
 * "Refused: chat may only write to chat_* tables".
 *
 * The modifiers below change how a statement behaves on conflict or on lock
 * contention. None of them change WHICH TABLE is written, which is the only
 * thing this guard exists to police.
 */
const WRITABLE = new RegExp(
  '^\\s*(?:'
    + 'insert(?:\\s+(?:ignore|low_priority|high_priority|delayed))*\\s+into'
    + '|replace(?:\\s+(?:low_priority|delayed))*\\s+into'
    + '|update(?:\\s+(?:low_priority|ignore))*'
    + '|delete(?:\\s+(?:low_priority|quick|ignore))*\\s+from'
  + ')\\s+`?(?:' + CHAT_TABLES + ')`?\\b',
  'i',
)

/**
 * Is this statement a chat write?
 *
 * Exported so it can be tested directly — `npm run chat:guard` checks it against
 * every write the app actually issues and against a list of statements it must
 * keep refusing. It is the only thing standing between a chat bug and live
 * financial data, and it has been wrong once.
 */
export function chatWriteAllowed(sql: string): boolean {
  if (!WRITABLE.test(sql)) return false
  // One statement per call. multipleStatements is off by default, but a
  // semicolon that got this far is worth refusing outright.
  if (sql.replace(/;\s*$/, '').includes(';')) return false
  return true
}

export async function chatWrite(
  sql: string,
  params: unknown[] = [],
): Promise<{ affectedRows: number; insertId: number }> {
  if (!chatWriteAllowed(sql)) {
    throw new Error('Refused: chat may only write to chat_* tables in the Accounts database.')
  }

  // Not retried: a single statement that may or may not have applied must not be
  // replayed blindly. Callers that need durability under a dropped connection go
  // through chatTransaction, which is retried as a whole and idempotent.
  const [res] = await pool().query<mysql.ResultSetHeader>(sql, params)
  return { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 }
}

/**
 * Run several writes atomically — used by "create a group and add its members"
 * and "post a message and bump the conversation", where a half-applied result
 * would leave a thread nobody is in or a list that points at nothing.
 *
 * The same table guard applies to every statement inside.
 */
export async function chatTransaction<T>(
  fn: (tx: {
    query: <R extends mysql.RowDataPacket>(sql: string, params?: unknown[]) => Promise<R[]>
    write: (sql: string, params?: unknown[]) => Promise<{ affectedRows: number; insertId: number }>
  }) => Promise<T>,
): Promise<T> {
  // Retried as a unit when the CONNECTION failed. A rolled-back transaction
  // applied nothing, so replaying it is safe — and the callback must be written
  // to be replayable (see sendMessage's client_uuid lookup).
  return withRetry('transaction', () => runTransaction(fn))
}

async function runTransaction<T>(
  fn: (tx: {
    query: <R extends mysql.RowDataPacket>(sql: string, params?: unknown[]) => Promise<R[]>
    write: (sql: string, params?: unknown[]) => Promise<{ affectedRows: number; insertId: number }>
  }) => Promise<T>,
): Promise<T> {
  const conn = await pool().getConnection()
  try {
    // A pooled socket can be dead without anyone knowing — the instance was
    // frozen, or the server timed it out. Finding that out here costs one
    // round trip; finding it out after the INSERT costs the message.
    await conn.ping()
    await conn.beginTransaction()
    const out = await fn({
      query: async <R extends mysql.RowDataPacket>(sql: string, params: unknown[] = []) => {
        const [rows] = await conn.query<R[]>(sql, params)
        return rows
      },
      write: async (sql: string, params: unknown[] = []) => {
        if (!chatWriteAllowed(sql)) throw new Error('Refused: chat may only write to chat_* tables.')
        const [res] = await conn.query<mysql.ResultSetHeader>(sql, params)
        return { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 }
      },
    })
    await conn.commit()
    conn.release()
    return out
  } catch (err) {
    if (isTransient(err)) {
      // Never hand a broken socket back to the pool for the next request to
      // trip over; the retry above will open a fresh one.
      try { conn.destroy() } catch { /* already gone */ }
    } else {
      await conn.rollback().catch(() => {})
      conn.release()
    }
    throw err
  }
}

/**
 * The OPS schema name, only needed for the cross-schema directory UNION when
 * the `chat_directory` view is absent.
 *
 * Deliberately its own variable rather than DB_DATABASE: that key appears more
 * than once in this project's .env and which occurrence wins is a dotenv
 * implementation detail, which is not a thing to hang a cross-schema query on.
 */
export function opsSchema(): string {
  const name = (process.env.CHAT_OPS_SCHEMA || 'apple_booking_system').trim()
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe ops schema name [${name}]`)
  return name
}
