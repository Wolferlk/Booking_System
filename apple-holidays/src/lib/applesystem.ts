/**
 * AppleSystem (Apple Holidays v2) API client.
 *
 * A thin, server-only wrapper around the live Apple Holidays quotation API
 * (https://applev2.appletechlabs.com). It logs in with the credentials in
 * `AS_Username` / `AS_password`, caches the bearer token in-process until it
 * is about to expire, and exposes typed helpers for listing bookings and
 * fetching a single booking's P&L / cost breakdown.
 *
 * This is intentionally READ-ONLY and completely decoupled from the local
 * Prisma booking data — it exists so staff can browse the source-of-truth
 * quotations coming from AppleSystem without touching our own records.
 */

import { AsyncLocalStorage } from 'async_hooks'
import { prisma } from './prisma'

const AS_BASE = (process.env.AS_API_URL || 'https://applev2.appletechlabs.com').replace(/\/+$/, '')

/** Upstream can be slow; cap every call so a hung socket can't stall the whole request. */
const AS_TIMEOUT_MS = Number(process.env.AS_TIMEOUT_MS || 25_000)
const AS_LOGIN_TIMEOUT_MS = Number(process.env.AS_LOGIN_TIMEOUT_MS || 12_000)

/**
 * Escalating timeout ladder.
 *
 * AppleSystem intermittently stalls under load — a wide `/api/quotation/list`
 * query can take well over a minute on a bad morning. With a single fixed 25s
 * cap those stalls became hard failures ("AppleSystem timed out after 25s"),
 * which is what kept killing the 6 AM daily import even though the upstream was
 * alive and would have answered a few seconds later.
 *
 * So every call now gets up to 5 attempts, each with a *longer* budget than the
 * last, plus a short backoff between them. A slow-but-alive upstream is waited
 * out; a genuinely dead one still fails, just with a much clearer error.
 *
 * Tunable with `AS_TIMEOUT_LADDER_MS` (comma-separated ms, e.g. "25000,40000,60000").
 */
const LADDER_FACTORS = [1, 1.6, 2.2, 2.8, 3.6]

function parseLadder(raw: string | undefined): number[] | null {
  if (!raw) return null
  const nums = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  return nums.length > 0 ? nums : null
}

const AS_TIMEOUT_LADDER_MS: number[] =
  parseLadder(process.env.AS_TIMEOUT_LADDER_MS) ??
  LADDER_FACTORS.map((f) => Math.round(AS_TIMEOUT_MS * f))

const AS_LOGIN_LADDER_MS: number[] =
  parseLadder(process.env.AS_LOGIN_TIMEOUT_LADDER_MS) ??
  [1, 1.7, 2.5].map((f) => Math.round(AS_LOGIN_TIMEOUT_MS * f))

/**
 * Hard ceiling on the wall-clock one call may spend across *all* its attempts,
 * so a dead upstream can't hold a request open for the sum of every rung.
 *
 * The default is deliberately short: most callers are interactive (the Search &
 * Import tab), where a browser waiting minutes is worse than a clean error, so
 * they get ~2 rungs. The background importer opts into the full ladder with
 * {@link withAsRetryBudget} — it has no user waiting on it, and finishing the
 * daily run matters far more than finishing it quickly.
 */
const AS_RETRY_BUDGET_MS = Number(process.env.AS_RETRY_BUDGET_MS || 90_000)

/** Budget the background importer uses — long enough for all five rungs. */
export const AS_IMPORT_RETRY_BUDGET_MS = Number(process.env.AS_IMPORT_RETRY_BUDGET_MS || 300_000)

interface AsCallLimits {
  /** Wall-clock ceiling across every attempt of one call. */
  budgetMs: number
  /** Per-attempt ladder; absent means the default {@link AS_TIMEOUT_LADDER_MS}. */
  ladder?: number[]
}

const budgetStore = new AsyncLocalStorage<AsCallLimits>()

/**
 * Run `fn` with a non-default total retry budget. Applies to every AppleSystem
 * call made inside it, however deeply nested.
 */
export function withAsRetryBudget<T>(budgetMs: number, fn: () => Promise<T>): Promise<T> {
  return budgetStore.run({ budgetMs }, fn)
}

/**
 * Run `fn` with a shorter *first* attempt as well as a shorter total budget.
 *
 * {@link withAsRetryBudget} alone cannot make a call fail fast: the budget is
 * only consulted before a *retry*, so the first rung always runs to its full
 * 25s. That is the right trade for background work, and the wrong one behind a
 * request the platform will cut off — a serverless response budget spent
 * waiting on a stalled upstream returns a gateway HTML page instead of the
 * JSON the caller is parsing. Callers with a hard deadline pass the whole
 * deadline as `budgetMs` and the slice of it one attempt may take as
 * `timeoutMs`; the upstream is then reported unreachable in time for the
 * handler to answer properly.
 */
export function withAsDeadline<T>(
  limits: { budgetMs: number; timeoutMs: number },
  fn: () => Promise<T>,
): Promise<T> {
  const ladder = LADDER_FACTORS
    .map(f => Math.round(limits.timeoutMs * f))
    .filter(ms => ms <= limits.budgetMs)
  return budgetStore.run(
    { budgetMs: limits.budgetMs, ladder: ladder.length > 0 ? ladder : [limits.timeoutMs] },
    fn,
  )
}

function currentLimits(): Required<Pick<AsCallLimits, 'budgetMs'>> & { ladder: number[] } {
  const store = budgetStore.getStore()
  return {
    budgetMs: store?.budgetMs ?? AS_RETRY_BUDGET_MS,
    ladder: store?.ladder ?? AS_TIMEOUT_LADDER_MS,
  }
}

/** Backoff before retry `i` (1-based): 1s, 2s, 3s… capped at 5s. */
function backoffMs(i: number): number {
  return Math.min(1_000 * i, 5_000)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function secs(ms: number): string {
  return `${Math.round(ms / 1000)}s`
}

// ── Token cache ──────────────────────────────────────────────────────────────
// Two tiers:
//   L1 — module-level, survives across requests on a warm server / Lambda.
//   L2 — a row in `system_settings`, shared across ALL server instances and
//        surviving cold starts. This is what keeps the integration "alive" on
//        serverless (AWS Amplify/Lambda): a cold container reuses a still-valid
//        token from the DB instead of doing a slow fresh login on every request
//        (which was overrunning the platform timeout and returning a raw 502).
let cachedToken: { token: string; expiresAt: number } | null = null
// In-flight login, so N concurrent calls trigger ONE login instead of N.
let loginInFlight: Promise<string> | null = null

const TOKEN_STORE_KEY = 'as_api_token'

/** Read the shared token from the DB. Never throws — a DB hiccup just misses the cache. */
async function readTokenStore(): Promise<{ token: string; expiresAt: number } | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: TOKEN_STORE_KEY } })
    if (!row?.value) return null
    const parsed = JSON.parse(row.value) as { token?: string; expiresAt?: number }
    if (!parsed.token || !parsed.expiresAt) return null
    return { token: parsed.token, expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

/** Persist the shared token to the DB. Never throws. */
async function writeTokenStore(token: string, expiresAt: number): Promise<void> {
  try {
    const value = JSON.stringify({ token, expiresAt })
    await prisma.systemSetting.upsert({
      where: { key: TOKEN_STORE_KEY },
      update: { value },
      create: { key: TOKEN_STORE_KEY, value },
    })
  } catch {
    /* best-effort — in-process cache still works */
  }
}

/** Drop the shared token from the DB so the next call re-authenticates. Never throws. */
async function clearTokenStore(): Promise<void> {
  try {
    await prisma.systemSetting.deleteMany({ where: { key: TOKEN_STORE_KEY } })
  } catch {
    /* ignore */
  }
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  return { signal: ac.signal, done: () => clearTimeout(t) }
}

/** Network-level failure (DNS, reset socket, timeout) rather than an HTTP error response. */
function isTransport(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TypeError' || 'cause' in err)
}

async function doLogin(): Promise<string> {
  const email = process.env.AS_Username
  const password = process.env.AS_password
  if (!email || !password) {
    throw new Error('AppleSystem credentials missing — set AS_Username and AS_password in .env')
  }

  const body = new URLSearchParams({ email, password })

  // Several attempts on an escalating timeout: a login is the one call we cannot
  // afford to lose to a blip, and a slow upstream deserves a longer wait, not a
  // repeat of the same too-short one.
  // The ambient budget covers the sign-in too: a caller that must answer in 20s
  // cannot spend a minute failing to log in first.
  const { budgetMs } = currentLimits()
  const startedAt = Date.now()

  let lastErr: unknown = null
  for (let attempt = 0; attempt < AS_LOGIN_LADDER_MS.length; attempt++) {
    if (attempt > 0) await sleep(750 * attempt)
    const timeoutMs = Math.min(AS_LOGIN_LADDER_MS[attempt], budgetMs - (Date.now() - startedAt))
    if (timeoutMs <= 0) break
    const { signal, done } = withTimeout(timeoutMs)
    try {
      const res = await fetch(`${AS_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        cache: 'no-store',
        signal,
      })

      if (!res.ok) {
        // Bad credentials are permanent — retrying just burns time.
        if (res.status === 401 || res.status === 403 || res.status === 422) {
          throw new Error(`AppleSystem login rejected the credentials (${res.status}) — check AS_Username / AS_password`)
        }
        lastErr = new Error(`AppleSystem login failed (${res.status})`)
        continue
      }

      const json = (await res.json()) as { access_token?: string; expires_in?: number }
      if (!json.access_token) throw new Error('AppleSystem login returned no access token')

      const ttlMs = (json.expires_in ?? 3600) * 1000
      // Refresh 60s before actual expiry to avoid edge-of-expiry failures.
      cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 }
      // Share the fresh token with every other server instance (survives cold starts).
      await writeTokenStore(cachedToken.token, cachedToken.expiresAt)
      return json.access_token
    } catch (err) {
      if (!isTransport(err)) throw err
      lastErr = err
    } finally {
      done()
    }
  }

  throw new Error(
    lastErr instanceof Error && lastErr.message.startsWith('AppleSystem')
      ? lastErr.message
      : 'Could not reach AppleSystem to sign in — the service may be down',
  )
}

/** Log in, collapsing concurrent callers onto a single request. */
function login(): Promise<string> {
  if (!loginInFlight) {
    loginInFlight = doLogin().finally(() => { loginInFlight = null })
  }
  return loginInFlight
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }
  // L2: reuse a still-valid token another instance persisted, before paying for
  // a fresh (slow) login. This is what keeps cold-start requests fast on Lambda.
  if (!forceRefresh) {
    const stored = await readTokenStore()
    if (stored && stored.expiresAt > Date.now()) {
      cachedToken = stored
      return stored.token
    }
  }
  return login()
}

/** Drop the cached token (both tiers) so the next call re-authenticates. */
async function invalidateToken() {
  cachedToken = null
  await clearTokenStore()
}

/**
 * True when the response means "your session/token is no longer valid".
 *
 * AppleSystem is not consistent here: an expired JWT can come back as a 401, as
 * a 403, or — most awkwardly — as a **200** carrying `{"message":"Unauthenticated."}`
 * or `{"error":"token_expired"}`. All three must trigger a re-login, so the body
 * is sniffed on a clone (leaving the original readable by the caller).
 */
async function isExpiredSession(res: Response): Promise<boolean> {
  if (res.status === 401 || res.status === 403) return true
  if (!res.ok) return false
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('json')) return false
  try {
    const text = await res.clone().text()
    if (text.length > 4000) return false // real payloads are large; auth errors are tiny
    return /unauthenticated|token[_ -]?(expired|invalid|not[_ ]provided)|invalid token|token has expired|jwt/i.test(text)
  } catch {
    return false
  }
}

/**
 * Error thrown when every rung of the timeout ladder was exhausted.
 *
 * Carries the attempt telemetry so callers (the importer, its alerting) can say
 * exactly how hard we tried before giving up, instead of just "timed out".
 */
export class ASUnreachableError extends Error {
  readonly path: string
  readonly attempts: number
  readonly timedOut: boolean
  readonly elapsedMs: number

  constructor(opts: { message: string; path: string; attempts: number; timedOut: boolean; elapsedMs: number }) {
    super(opts.message)
    this.name = 'ASUnreachableError'
    this.path = opts.path
    this.attempts = opts.attempts
    this.timedOut = opts.timedOut
    this.elapsedMs = opts.elapsedMs
  }
}

/**
 * One shot at a request: authenticate, fetch under `timeoutMs`, and transparently
 * re-login + replay once if the token turned out to be expired. Transport errors
 * propagate to the ladder in {@link asFetch}.
 */
async function attemptFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  allowRelogin: boolean,
): Promise<Response> {
  const token = await getToken()
  const { signal, done } = withTimeout(timeoutMs)

  let res: Response
  try {
    res = await fetch(`${AS_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
      cache: 'no-store',
      signal,
    })
  } finally {
    done()
  }

  if (allowRelogin && (await isExpiredSession(res))) {
    await invalidateToken()
    await getToken(true)
    return attemptFetch(path, init, timeoutMs, false)
  }

  return res
}

/**
 * Authenticated fetch against AppleSystem, retried on an escalating timeout.
 *
 * Each attempt gets a longer budget than the last (see {@link AS_TIMEOUT_LADDER_MS}),
 * with a short backoff between them, so an upstream that is merely slow is waited
 * out instead of being abandoned at a fixed 25s. Token expiry is still handled
 * transparently inside each attempt. Only when every rung is spent — or the total
 * retry budget runs out — does an {@link ASUnreachableError} surface.
 */
async function asFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const startedAt = Date.now()
  const { budgetMs, ladder } = currentLimits()
  let attempts = 0
  let sawTimeout = false

  for (let i = 0; i < ladder.length; i++) {
    // Never let a single rung outlive the budget: a caller with a deadline
    // needs the failure back before its own time is up.
    const timeoutMs = Math.min(ladder[i], budgetMs - (Date.now() - startedAt))
    if (timeoutMs <= 0) break

    if (i > 0) {
      const wait = backoffMs(i)
      // Don't start a rung we can't afford to finish.
      if (Date.now() - startedAt + wait + timeoutMs > budgetMs) break
      console.warn(
        `[AppleSystem] attempt ${i + 1}/${ladder.length} for ${path} — retrying with a ${secs(timeoutMs)} timeout`,
      )
      await sleep(wait)
    }

    attempts++
    try {
      return await attemptFetch(path, init, timeoutMs, true)
    } catch (err) {
      // A non-transport failure (bad credentials, malformed response) is permanent
      // — climbing the ladder would only waste minutes repeating it.
      if (!isTransport(err)) throw err
      if (err instanceof Error && err.name === 'AbortError') sawTimeout = true
    }
  }

  const elapsedMs = Date.now() - startedAt
  const span = `${secs(ladder[0])} → ${secs(ladder[Math.min(attempts, ladder.length) - 1])}`
  throw new ASUnreachableError({
    message: sawTimeout
      ? `AppleSystem timed out after ${attempts} attempts (${span}, ${secs(elapsedMs)} total) (${path})`
      : `Could not reach AppleSystem after ${attempts} attempts (${secs(elapsedMs)} total) (${path})`,
    path,
    attempts,
    timedOut: sawTimeout,
    elapsedMs,
  })
}

// ── Types (subset of the fields the API returns that we actually use) ────────
export interface ASBookingListItem {
  type: string
  id: number
  quotation_no: string
  status: string          // "1" = pending/unconfirmed, "2" = confirmed
  status_class: string    // "pending" | "confirm" | ...
  country: string | null
  currency: string | null
  tour_type: string | null
  created_at?: { date: string } | string | null
  updated_at?: { date: string } | string | null
  reference_id: string
  reference_id_full?: string[]
  /** IS/VN/SG/MY reference as stored upstream ("MY 40060"), or "NA" when unassigned. */
  is_number?: string | null
  main?: { user?: string; arrival_year?: string; arrival_month?: string; arrival_day?: string }
  pax?: { adult?: string; cwb?: string; cnb?: string; total_children?: number }
  map_image_url?: string
  quotation_update_count_R?: number
  quotation_update_count_C?: number
  quotation_update_count_X?: number
}

export interface ASListResult {
  items: ASBookingListItem[]
  total: number
}

/**
 * Raw list envelope. `/api/quotation/list` is **paginated** (16 rows per page by
 * default) — `data` is only the current page while `pagination.total` is the real
 * match count. Ignoring this silently truncated every list to its first page.
 */
interface ASListEnvelope {
  success?: boolean
  data?: ASBookingListItem[]
  total?: number
  pagination?: { current_page?: number; per_page?: number; total?: number; last_page?: number }
}

/**
 * Page size we ask upstream for (it honours `per_page`; 16 is its default).
 *
 * Deliberately small. Upstream spends roughly a third of a second per row it
 * serialises, so one wide page is its own bottleneck: a 62-row day answers in
 * ~25s as a single `per_page=100` request but in ~15s as three smaller pages
 * fetched together. Splitting the same rows across pages we can ask for
 * concurrently is what keeps a report inside a request's deadline.
 */
const AS_PAGE_SIZE = Number(process.env.AS_PAGE_SIZE || 25)
/**
 * How many pages are requested at once.
 *
 * Pages are asked for *speculatively* — waiting for page 1 to learn `last_page`
 * before starting page 2 would serialise the very calls we are trying to
 * overlap, and cost more than the wasted empty pages do. Four is where the
 * upstream stops rewarding extra concurrency.
 */
const AS_PAGE_CONCURRENCY = Math.max(1, Number(process.env.AS_PAGE_CONCURRENCY || 4))
/** Hard stop so a runaway `last_page` can never loop forever. */
const AS_MAX_PAGES = 50

/** One page of a `/api/quotation/list` query, with what it says about the rest. */
async function fetchListPage(
  qs: URLSearchParams,
  label: string,
  page: number,
): Promise<{ rows: ASBookingListItem[]; total: number | null; lastPage: number | null }> {
  const q = new URLSearchParams(qs)
  q.set('per_page', String(AS_PAGE_SIZE))
  q.set('page', String(page))

  const res = await asFetch(`/api/quotation/list?${q.toString()}`)
  if (!res.ok) throw new Error(`AppleSystem ${label} failed (${res.status})`)
  const json = (await res.json()) as ASListEnvelope

  return {
    rows: Array.isArray(json.data) ? json.data : [],
    total: json.pagination?.total ?? json.total ?? null,
    lastPage: json.pagination?.last_page ?? null,
  }
}

/**
 * Fetch **every** page of a `/api/quotation/list` query and return the combined
 * rows. Callers get the complete result set, not just the first page.
 *
 * Pages go out in concurrent batches (see {@link AS_PAGE_CONCURRENCY}) because
 * upstream latency tracks the number of rows in a response, not the number of
 * requests: the same day costs about half the wall-clock time when its rows are
 * split across pages fetched together. Rows are keyed by id on the way in, so a
 * quotation created *while* we page — which shifts every row one place down the
 * id-descending list — can shuffle across a page boundary without being counted
 * twice. (It can still slip out of the tail unseen, exactly as it could when
 * the pages were fetched one after another.)
 */
async function listAllPages(qs: URLSearchParams, label: string): Promise<ASListResult> {
  const byId = new Map<string, ASBookingListItem>()
  let upstreamTotal = 0
  let lastPage = AS_MAX_PAGES

  for (let next = 1; next <= Math.min(lastPage, AS_MAX_PAGES); ) {
    const batch: number[] = []
    for (
      let page = next;
      page < next + AS_PAGE_CONCURRENCY && page <= Math.min(lastPage, AS_MAX_PAGES);
      page++
    ) {
      batch.push(page)
    }

    const results = await Promise.all(batch.map((page) => fetchListPage(qs, label, page)))

    let sawEmptyPage = false
    for (const result of results) {
      for (const row of result.rows) {
        byId.set(String(row.id ?? row.quotation_no), row)
      }
      if (result.rows.length === 0) sawEmptyPage = true
      if (result.total != null) upstreamTotal = Math.max(upstreamTotal, result.total)
      if (result.lastPage != null) lastPage = result.lastPage
    }

    // An empty page means we have run past the end — whatever `last_page` said.
    if (sawEmptyPage) break
    next += batch.length
  }

  const items = Array.from(byId.values())
  return { items, total: Math.max(upstreamTotal, items.length) }
}

export interface ASListParams {
  fromArrivalDate: string   // YYYY-MM-DD
  toArrivalDate: string     // YYYY-MM-DD
  statuses?: string[]       // e.g. ['1','2']; empty/omitted => all
}

/** List quotations/bookings filtered by arrival date window and status. */
export async function listBookings(params: ASListParams): Promise<ASListResult> {
  const qs = new URLSearchParams()
  qs.set('from_arrival_date', params.fromArrivalDate)
  qs.set('to_arrival_date', params.toArrivalDate)
  for (const s of params.statuses ?? []) qs.append('status[]', s)

  return listAllPages(qs, 'list')
}

export interface ASCreateDateParams {
  fromCreateDate: string   // YYYY-MM-DD (inclusive)
  toCreateDate: string     // YYYY-MM-DD (inclusive)
  statuses?: string[]      // e.g. ['2']; empty/omitted => all
}

/**
 * List quotations/bookings filtered by their **creation date** window and status.
 *
 * This drives the confirmations auto-import: unlike {@link listBookings} (which
 * filters on arrival date), this uses AppleSystem's `from_create_date` /
 * `to_create_date` params so we pull exactly the confirmations *created* in a
 * given window — e.g. "everything confirmed yesterday".
 *
 * All pages are fetched: a busy day easily exceeds the upstream 16-row page and
 * the importer must see every confirmation, not the first screen of them.
 */
export async function listByCreateDate(params: ASCreateDateParams): Promise<ASListResult> {
  const qs = new URLSearchParams()
  qs.set('from_create_date', params.fromCreateDate)
  qs.set('to_create_date', params.toCreateDate)
  for (const s of params.statuses ?? []) qs.append('status[]', s)

  return listAllPages(qs, 'create-date list')
}

export interface ASSearchParams {
  isNumber?: string
  quotationNo?: string
  statuses?: string[]   // e.g. ['2']; empty/omitted => all
}

/**
 * Search quotations by IS number and/or quotation number — the fast, scoped path.
 *
 * Unlike {@link listBookings}, this passes AppleSystem's own `is_number` /
 * `quotation_no` filters straight through, so the upstream returns only the few
 * matching rows instead of a multi-year window. This is what the "New Booking
 * from AppleSystem" flow uses, and it avoids the timeouts the wide list can hit.
 */
export async function searchBookings(params: ASSearchParams): Promise<ASListResult> {
  const qs = new URLSearchParams()
  const isNum = params.isNumber?.trim()
  const quo = params.quotationNo?.trim()
  if (isNum) qs.set('is_number', isNum)
  if (quo) qs.set('quotation_no', quo)
  for (const s of params.statuses ?? []) qs.append('status[]', s)

  return listAllPages(qs, 'search')
}

/** Fetch the full P&L / cost breakdown for one booking. Returns the raw `data` object. */
export async function getBookingPnl(
  referenceId: string,
  quotationNo: string,
  currency = 'USD',
): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({
    reference_id: referenceId,
    quotation_no: quotationNo,
    currency,
  })
  const res = await asFetch(`/api/quotation/view/pnl?${qs.toString()}`)
  if (!res.ok) throw new Error(`AppleSystem P&L fetch failed (${res.status})`)
  const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown> }
  return json.data ?? {}
}

// ── Content lookups (id → human name) ────────────────────────────────────────
// Content data changes rarely, so resolved maps are cached in-process for 12h.

const CONTENT_TTL = 12 * 60 * 60 * 1000
const contentCache = new Map<string, { at: number; map: Map<string, string> }>()

/** GET a `/api/content/*` list. Body is either a bare array or a paginated
 *  `{ data: [...] }` object; this returns the row array either way. */
async function contentRows(path: string): Promise<Record<string, unknown>[]> {
  const res = await asFetch(path)
  if (!res.ok) return []
  const json = (await res.json()) as { body?: unknown }
  const body = json.body
  if (Array.isArray(body)) return body as Record<string, unknown>[]
  if (body && typeof body === 'object' && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: Record<string, unknown>[] }).data
  }
  return []
}

async function cachedMap(
  key: string,
  path: string,
  idField: string,
  nameField: string,
): Promise<Map<string, string>> {
  const hit = contentCache.get(key)
  if (hit && Date.now() - hit.at < CONTENT_TTL) return hit.map
  const rows = await contentRows(path)
  const map = new Map<string, string>()
  for (const r of rows) {
    const id = r[idField]
    const name = r[nameField]
    if (id != null && name != null) map.set(String(id), String(name))
  }
  contentCache.set(key, { at: Date.now(), map })
  return map
}

/** Resolve place ids → place names (full list, ~9.5k rows, cached). */
async function placeMap(): Promise<Map<string, string>> {
  return cachedMap('place', '/api/content/place/', 'id', 'name')
}

/** Resolve vehicle ids → vehicle names for one country. */
async function vehicleMap(countryId: string): Promise<Map<string, string>> {
  return cachedMap(`vehicle:${countryId}`, `/api/content/vehicle?country=${encodeURIComponent(countryId)}`, 'id', 'vehicle_name')
}

/** Resolve meal-plan ids → readable names (BB / HB / …). */
async function mealPlanMap(): Promise<Map<string, string>> {
  const hit = contentCache.get('meal_plan')
  if (hit && Date.now() - hit.at < CONTENT_TTL) return hit.map
  const rows = await contentRows('/api/content/meal_plan')
  const map = new Map<string, string>()
  for (const r of rows) {
    const id = r.id
    if (id == null) continue
    const label = [r.plan, r.long_name].filter(Boolean).join(' · ')
    map.set(String(id), label || String(r.plan ?? ''))
  }
  contentCache.set('meal_plan', { at: Date.now(), map })
  return map
}

// ── Enriched booking detail (P&L + resolved names) ───────────────────────────

export interface EnrichedAccommodation {
  hotelId: string | null
  placeId: string | null
  placeName: string | null
  checkIn: string | null
  checkOut: string | null
  nights: number
  mealPlan: string | null
  roomCategoryId: string | null
  driverAccommodation: boolean
  provider: string | null
}

export interface EnrichedTransport {
  vehicleId: string | null
  vehicleName: string | null
  distanceKm: number | null
}

export interface EnrichedBooking {
  accommodations: EnrichedAccommodation[]
  transport: EnrichedTransport | null
  attractionCount: number
  cityTourCount: number
  placesVisited: string[]
}

function ymd(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const o = node as { year?: string; month?: string; day?: string }
  if (!o.year || !o.month || !o.day) return null
  return `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`
}

/**
 * Cross-references the raw P&L payload against the AppleSystem content catalog
 * to resolve place / vehicle / meal-plan ids into human-readable names, and
 * flattens the accommodation + transport structures for the UI.
 */
export async function enrichBookingDetail(
  detail: Record<string, unknown>,
  countryId?: string | null,
): Promise<EnrichedBooking> {
  const [places, meals, vehicles] = await Promise.all([
    placeMap().catch(() => new Map<string, string>()),
    mealPlanMap().catch(() => new Map<string, string>()),
    countryId ? vehicleMap(countryId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ])

  // Accommodations from budget.hotel[]
  const accommodations: EnrichedAccommodation[] = []
  const budget = detail.budget as { hotel?: unknown[] } | undefined
  const hotels = Array.isArray(budget?.hotel) ? budget!.hotel : []
  for (const h of hotels) {
    const settings = (h as { hotel_settings?: Record<string, unknown> })?.hotel_settings
    if (!settings) continue
    const placeId = settings.place != null ? String(settings.place) : null
    const mealId = settings.meal_type != null ? String(settings.meal_type) : null
    accommodations.push({
      hotelId: settings.hotel != null && String(settings.hotel) !== '0' ? String(settings.hotel) : null,
      placeId,
      placeName: placeId ? places.get(placeId) ?? null : null,
      checkIn: ymd(settings.check_in),
      checkOut: ymd(settings.check_out),
      nights: Number(settings.night ?? 0),
      mealPlan: mealId ? meals.get(mealId) ?? null : null,
      roomCategoryId: settings.room_category != null ? String(settings.room_category) : null,
      driverAccommodation: String(settings.driver_accommodation ?? '0') === '1',
      provider: settings.provider != null ? String(settings.provider) : null,
    })
  }

  // Transport
  let transport: EnrichedTransport | null = null
  const td = (detail.cost as { transport?: { transport_data?: Record<string, unknown> } } | undefined)?.transport?.transport_data
  if (td) {
    const vehicle = td.vehicle as { vehicle_type?: unknown } | undefined
    const mileage = td.mileage as { actual_distance?: unknown } | undefined
    const vId = vehicle?.vehicle_type != null ? String(vehicle.vehicle_type) : null
    transport = {
      vehicleId: vId,
      vehicleName: vId ? vehicles.get(vId) ?? null : null,
      distanceKm: mileage?.actual_distance != null ? Number(mileage.actual_distance) : null,
    }
  }

  // Attraction / city-tour counts
  const ab = detail.attraction_breakdown as { attraction?: object; city_tour?: object } | undefined
  const attractionCount = ab?.attraction ? Object.keys(ab.attraction).length : 0
  const cityTourCount = ab?.city_tour ? Object.keys(ab.city_tour).length : 0

  // Distinct places visited (from day_city)
  const dayCity = detail.day_city as Record<string, { name?: string }> | undefined
  const placesVisited = dayCity
    ? Array.from(new Set(Object.values(dayCity).map((c) => c.name).filter(Boolean) as string[]))
    : []

  return { accommodations, transport, attractionCount, cityTourCount, placesVisited }
}

// ── Reference helpers ────────────────────────────────────────────────────────

/** Country id → display name. Falls back to parsing the map image, then the raw id. */
export const AS_COUNTRY_NAMES: Record<string, string> = {
  '62': 'Sri Lanka',
  '63': 'Malaysia',
  '64': 'Singapore',
  '256': 'Vietnam',
}

export function resolveCountryName(item: ASBookingListItem): string | null {
  if (item.country && AS_COUNTRY_NAMES[item.country]) return AS_COUNTRY_NAMES[item.country]
  const m = item.map_image_url?.match(/center=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim()
    } catch {
      /* ignore */
    }
  }
  return item.country ? `#${item.country}` : null
}

// ── Quote / Confirmation template (AS Bookings V2) ───────────────────────────
// Additive: powers the new "AS Bookings V2" confirmation view. Uses the
// /api/quotation/template/quote endpoint, which returns a fully-composed booking
// confirmation (reference numbers, parties, accommodation, package inclusions /
// exclusions, terms, a day-by-day itinerary with activities, and the P&L).

export interface ASQuoteActivity {
  type?: string
  name?: string
  description?: string
}

export interface ASQuoteItineraryDay {
  day: number
  date?: string
  date_formatted?: string
  route?: string
  description?: string
  activities?: ASQuoteActivity[]
}

export interface ASQuoteAccommodation {
  city?: string
  check_in?: string
  check_out?: string
  nights?: number
  type?: string
}

export interface ASQuoteTemplate {
  quotation_no: string
  reference_id: number | string
  revision?: number
  reference_numbers?: {
    quotation_no?: string
    formatted?: string
    control?: string
    temp_po?: string
  }
  relevant_parties?: { agent?: string; sales_person?: string }
  accommodation?: ASQuoteAccommodation[]
  value_added_services?: unknown[]
  package_includes?: string[]
  package_excludes?: string[]
  terms_and_conditions?: string[]
  itinerary?: ASQuoteItineraryDay[]
  /** Raw P&L / cost breakdown (same structure as getBookingPnl). */
  pnl?: Record<string, unknown>
  [k: string]: unknown
}

/**
 * Fetch the composed booking-confirmation template for one quotation.
 *
 * Per the AppleSystem contract the POST body maps:
 *   quotation_no  → the list row's `quotation_no`
 *   reference_id  → the list row's **`id`** (NOT its `reference_id` field, which
 *                   mirrors the quotation number). Passing the wrong one still
 *                   returns 200 with a stub payload whose `is_number` is "NA",
 *                   which is why every mismatched row used to fail the import.
 */
export async function getQuoteTemplate(
  quotationNo: string,
  referenceId: string,
): Promise<ASQuoteTemplate> {
  const res = await asFetch('/api/quotation/template/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotation_no: quotationNo, reference_id: referenceId }),
  })
  if (!res.ok) throw new Error(`AppleSystem quote template fetch failed (${res.status})`)
  const json = (await res.json()) as { success?: boolean; data?: ASQuoteTemplate }
  if (!json.data) throw new Error('AppleSystem quote template returned no data')
  return json.data
}

/** Parse an AppleSystem timestamp node ({date:"YYYY-MM-DD HH:mm:ss…"} | string) → Date | null. */
export function parseAsDate(node: unknown): Date | null {
  const raw = typeof node === 'string' ? node : (node as { date?: string } | null)?.date
  if (!raw) return null
  // "2026-07-20 13:17:04.000000" → ISO-ish; take the "YYYY-MM-DD HH:mm:ss" slice.
  const d = new Date(raw.replace(' ', 'T').slice(0, 19))
  return isNaN(d.getTime()) ? null : d
}
