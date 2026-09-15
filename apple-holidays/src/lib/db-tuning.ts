/**
 * Database connection tuning — one place that decides how this process talks to
 * MySQL/MariaDB, so the pool caps and the replica routing can never drift apart
 * between `prisma.ts`, `prisma-read.ts` and the DB Health screen.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The primary (aahaas-prod-database-4) was hitting ~99.8% CPU on the hourly
 * scheduler ticks while the three read replicas idled at ~2%. Three things were
 * wrong at once and all three are settled here:
 *
 *   1. Prisma opened an unbounded pool per Lambda/Next instance, so a burst of
 *      instances could push 200+ parallel connections at the primary (the
 *      P1001 / P2024 timeouts). {@link poolSettings} caps it.
 *   2. Every read — including the background sweeps and the report pages —
 *      landed on the primary. {@link replicaUrl} gives the read-only clients
 *      somewhere else to go.
 *   3. None of it was visible. {@link describeDbTuning} feeds the
 *      Settings → Database Health screen so an operator can see what the
 *      running process actually resolved, not what the .env is supposed to say.
 *
 * Nothing here mutates the database. The worst a misconfiguration can do is
 * fall back to the primary, which is exactly today's behaviour.
 */

/** Prisma's pool knobs, as they appear in the connection-string query. */
export interface PoolSettings {
  /** `connection_limit` — max sockets this process opens to one server. */
  connectionLimit: number
  /** `pool_timeout` — seconds a query waits for a free socket before P2024. */
  poolTimeout: number
  /** `connect_timeout` — seconds to wait for the TCP/handshake before P1001. */
  connectTimeout: number
}

/**
 * Defaults sized for Amplify Lambda: many short-lived instances, each of which
 * only ever runs a handful of queries concurrently. 15 × a realistic instance
 * count stays well under MariaDB's max_connections, where the old uncapped
 * pool did not.
 */
const DEFAULT_POOL: PoolSettings = {
  connectionLimit: 15,
  poolTimeout: 30,
  connectTimeout: 10,
}

/** Read pools are smaller — the sweeps are sequential, not fan-out. */
const DEFAULT_READ_CONNECTION_LIMIT = 10

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

/** Pool settings for the primary (read/write) client. */
export function poolSettings(): PoolSettings {
  return {
    connectionLimit: intFromEnv('DB_POOL_LIMIT', DEFAULT_POOL.connectionLimit, 1, 200),
    poolTimeout: intFromEnv('DB_POOL_TIMEOUT', DEFAULT_POOL.poolTimeout, 1, 300),
    connectTimeout: intFromEnv('DB_CONNECT_TIMEOUT', DEFAULT_POOL.connectTimeout, 1, 300),
  }
}

/** Pool settings for the replica (read-only) client. */
export function readPoolSettings(): PoolSettings {
  const base = poolSettings()
  return {
    ...base,
    connectionLimit: intFromEnv('DB_READ_POOL_LIMIT', DEFAULT_READ_CONNECTION_LIMIT, 1, 200),
  }
}

/**
 * Stamp the pool knobs onto a MySQL connection string.
 *
 * Any value the URL already carries wins — so a hand-tuned DATABASE_URL in the
 * Amplify console is never silently overridden by these defaults. That matters
 * because production env and local .env have drifted before on this codebase.
 */
export function applyPoolSettings(url: string, pool: PoolSettings): string {
  if (!url.startsWith('mysql://') && !url.startsWith('mariadb://')) return url

  // Appended textually rather than via `new URL(...).toString()` on purpose.
  // Re-serialising would also re-encode the credential portion, and a password
  // written into DATABASE_URL by hand with an unescaped character would come
  // back subtly different — a connection failure whose cause is invisible in
  // the logs, because the string looks right. Splitting on the first '?' cannot
  // touch anything before it.
  const queryAt = url.indexOf('?')
  const base = queryAt === -1 ? url : url.slice(0, queryAt)
  const query = queryAt === -1 ? '' : url.slice(queryAt + 1)

  const present = new Set(
    query
      .split('&')
      .filter(Boolean)
      .map(pair => pair.split('=')[0]),
  )

  const additions: string[] = []
  const addIfAbsent = (key: string, value: string | number) => {
    if (!present.has(key)) additions.push(`${key}=${value}`)
  }
  addIfAbsent('connection_limit', pool.connectionLimit)
  addIfAbsent('pool_timeout', pool.poolTimeout)
  addIfAbsent('connect_timeout', pool.connectTimeout)

  if (!additions.length) return url

  const merged = [query, ...additions].filter(Boolean).join('&')
  return `${base}?${merged}`
}

/** Strip credentials so a URL can be shown in the UI or written to a log. */
export function redactUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return url.replace(/\/\/[^@]*@/, '//***@')
  }
}

/**
 * The read-replica connection string, or null when no replica is configured.
 *
 * Two ways to set it, in priority order:
 *   REPLICA_DATABASE_URL — a full mysql:// URL, and
 *   DB_READ_HOST         — just the hostname, reusing the primary's port,
 *                          database, user and password.
 *
 * The second form is the one to prefer in Amplify: it cannot drift away from
 * the primary's database name, which is the mistake that would quietly point
 * reads at the wrong schema.
 */
export function replicaUrl(): string | null {
  if (process.env.DB_REPLICA_ENABLED?.trim() === 'false') return null

  const direct = process.env.REPLICA_DATABASE_URL?.trim() || process.env.READ_DATABASE_URL?.trim()
  if (direct) return applyPoolSettings(direct, readPoolSettings())

  const host = process.env.DB_READ_HOST?.trim()
  if (!host) return null

  const port = process.env.DB_READ_PORT?.trim() || process.env.DB_PORT?.trim() || '3306'
  const database = process.env.DB_DATABASE?.trim()
  const username = process.env.DB_USERNAME?.trim()
  const password = process.env.DB_PASSWORD

  if (!database || !username || password == null) return null

  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
  return applyPoolSettings(`mysql://${auth}@${host}:${port}/${database}`, readPoolSettings())
}

/** Host of the primary, for display. */
export function primaryHost(): string | null {
  const fromParts = process.env.DB_HOST?.trim()
  if (fromParts) return fromParts
  const url = process.env.DATABASE_URL?.trim()
  if (!url) return null
  try { return new URL(url).hostname } catch { return null }
}

/** Host of the replica, for display. */
export function replicaHost(): string | null {
  const url = replicaUrl()
  if (!url) return null
  try { return new URL(url).hostname } catch { return null }
}

/** Everything the DB Health screen needs to describe this process. */
export function describeDbTuning() {
  const pool = poolSettings()
  const readPool = readPoolSettings()
  const replica = replicaUrl()

  return {
    primary: {
      host: primaryHost(),
      database: process.env.DB_DATABASE?.trim() ?? null,
      pool,
    },
    replica: {
      configured: replica !== null,
      host: replicaHost(),
      url: redactUrl(replica),
      pool: readPool,
      /** false when DB_REPLICA_ENABLED=false pins it off regardless of host. */
      envEnabled: process.env.DB_REPLICA_ENABLED?.trim() !== 'false',
    },
  }
}
