/**
 * Server-side HTTP client for the Apple Accounts system's public API (v1).
 *
 * Distinct from `accounts-db.ts`, and deliberately so. That module reads rows
 * the accounts system *stores* — P&L records, invoice numbers — and a direct
 * SELECT is the right tool for those. This one asks the accounts system
 * questions whose answers it *derives*: a driver advance is recomputed on every
 * read from payable lines, the configured advance percentage, the held-back
 * sum, the live CBSL rate and any human override. Recomputing that here would
 * give us two implementations of one money rule, agreeing today and drifting
 * apart the first time either side changed.
 *
 * Credentials come from the environment and never leave the server:
 *
 *   ACCOUNTS_API_URL       https://invoice-processor.aahaas.com
 *   ACCOUNTS_API_USERNAME  the API client's username
 *   ACCOUNTS_API_PASSWORD  its password
 *
 * Create the client on the accounts host with:
 *
 *   php artisan api:client "OPS Booking System" --abilities=read
 *
 * `read` is the only ability it needs, and the only one it should be given —
 * the same token would otherwise be able to cancel bookings.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

const DEFAULT_BASE = 'https://invoice-processor.aahaas.com'

/** Hard ceiling per call, so an OPS page never hangs on a slow accounts host. */
const REQUEST_TIMEOUT_MS = 25_000

/** Shorter — a token request is one cheap DB round trip. */
const TOKEN_TIMEOUT_MS = 10_000

/**
 * Retire a token this many seconds before the accounts system would.
 * A token that expires mid-flight comes back as a 401 the caller cannot
 * distinguish from bad credentials.
 */
const TOKEN_SKEW_SECONDS = 60

export function accountsApiBase(): string {
  return (process.env.ACCOUNTS_API_URL ?? DEFAULT_BASE).trim().replace(/\/+$/, '')
}

export function accountsApiConfigured(): boolean {
  return Boolean(process.env.ACCOUNTS_API_USERNAME?.trim() && process.env.ACCOUNTS_API_PASSWORD?.trim())
}

/** Thrown for every failure, so callers have one thing to catch. */
export class AccountsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'accounts_api_error',
  ) {
    super(message)
    this.name = 'AccountsApiError'
  }
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number }

/**
 * One token per server process, reused until it is nearly expired.
 *
 * The accounts system rate-limits token requests hard (20/min) and issues a
 * fresh row per call, so asking for one per HTTP request would both throttle us
 * and fill its token table. `inFlight` collapses the stampede that a cold cache
 * plus a batched column would otherwise cause.
 */
let cached: CachedToken | null = null
let inFlight: Promise<string> | null = null

async function fetchToken(): Promise<string> {
  const username = process.env.ACCOUNTS_API_USERNAME?.trim()
  const password = process.env.ACCOUNTS_API_PASSWORD?.trim()

  if (!username || !password) {
    throw new AccountsApiError(
      'The accounts API is not configured on this server (ACCOUNTS_API_USERNAME / ACCOUNTS_API_PASSWORD).',
      503,
      'not_configured',
    )
  }

  const res = await withTimeout(
    fetch(`${accountsApiBase()}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    }),
    TOKEN_TIMEOUT_MS,
    'accounts API sign-in',
  )

  const body = await readJson(res)

  if (!res.ok || !body?.access_token) {
    throw new AccountsApiError(
      String(body?.message ?? 'The accounts system rejected the OPS credentials.'),
      res.status || 502,
      String(body?.error ?? 'auth_failed'),
    )
  }

  const ttl = Number(body.expires_in ?? 0)
  cached = {
    token: String(body.access_token),
    // A server that reports no lifetime gets a conservative five minutes rather
    // than a token we would hold forever.
    expiresAt: Date.now() + Math.max(60, (ttl > 0 ? ttl : 300) - TOKEN_SKEW_SECONDS) * 1000,
  }

  return cached.token
}

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token
  if (inFlight) return inFlight

  inFlight = fetchToken().finally(() => { inFlight = null })
  return inFlight
}

// ── Request helper ────────────────────────────────────────────────────────────

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AccountsApiError(`${what} timed out after ${ms / 1000}s.`, 504, 'timeout')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * One authenticated call, with a single retry on 401.
 *
 * The retry exists for exactly one situation: a cached token that the accounts
 * system revoked or expired earlier than we predicted. It drops the cache and
 * signs in once more — never more than once, so bad credentials fail fast
 * instead of looping against the sign-in throttle.
 */
export async function accountsApi<T = Record<string, unknown>>(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const url = new URL(`${accountsApiBase()}/api/v1/${path.replace(/^\/+/, '')}`)
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, v)
  }

  const send = async (token: string) => withTimeout(
    fetch(url.toString(), {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    }),
    REQUEST_TIMEOUT_MS,
    `accounts API ${path}`,
  )

  let res = await send(await getToken())

  if (res.status === 401) {
    cached = null
    res = await send(await getToken())
  }

  const body = await readJson(res)

  if (!res.ok) {
    throw new AccountsApiError(
      String(body?.message ?? `The accounts system answered ${res.status}.`),
      res.status,
      String(body?.error ?? 'request_failed'),
    )
  }

  return (body ?? {}) as T
}
