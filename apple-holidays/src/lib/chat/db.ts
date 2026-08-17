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
  const [rows] = await pool().query<T[]>(sql, params)
  return rows
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
const WRITABLE = /^\s*(insert\s+into|update|delete\s+from)\s+`?(chat_conversations|chat_participants|chat_messages|chat_attachments|chat_reactions|chat_presence|chat_settings)`?\b/i

export async function chatWrite(
  sql: string,
  params: unknown[] = [],
): Promise<{ affectedRows: number; insertId: number }> {
  if (!WRITABLE.test(sql)) {
    throw new Error('Refused: chat may only write to chat_* tables in the Accounts database.')
  }
  // One statement per call. multipleStatements is off by default, but a
  // semicolon that got this far is worth refusing outright.
  if (sql.replace(/;\s*$/, '').includes(';')) {
    throw new Error('Refused: only one statement per write.')
  }

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
  const conn = await pool().getConnection()
  try {
    await conn.beginTransaction()
    const out = await fn({
      query: async <R extends mysql.RowDataPacket>(sql: string, params: unknown[] = []) => {
        const [rows] = await conn.query<R[]>(sql, params)
        return rows
      },
      write: async (sql: string, params: unknown[] = []) => {
        if (!WRITABLE.test(sql)) throw new Error('Refused: chat may only write to chat_* tables.')
        if (sql.replace(/;\s*$/, '').includes(';')) throw new Error('Refused: only one statement per write.')
        const [res] = await conn.query<mysql.ResultSetHeader>(sql, params)
        return { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 }
      },
    })
    await conn.commit()
    return out
  } catch (err) {
    await conn.rollback().catch(() => {})
    throw err
  } finally {
    conn.release()
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
