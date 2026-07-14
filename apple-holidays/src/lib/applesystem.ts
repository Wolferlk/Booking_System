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

const AS_BASE = (process.env.AS_API_URL || 'https://applev2.appletechlabs.com').replace(/\/+$/, '')

// ── Token cache (module-level, survives across requests on a warm server) ────
let cachedToken: { token: string; expiresAt: number } | null = null

async function login(): Promise<string> {
  const email = process.env.AS_Username
  const password = process.env.AS_password
  if (!email || !password) {
    throw new Error('AppleSystem credentials missing — set AS_Username and AS_password in .env')
  }

  const body = new URLSearchParams({ email, password })
  const res = await fetch(`${AS_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`AppleSystem login failed (${res.status})`)
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!json.access_token) {
    throw new Error('AppleSystem login returned no access token')
  }

  const ttlMs = (json.expires_in ?? 3600) * 1000
  // Refresh 60s before actual expiry to avoid edge-of-expiry failures.
  cachedToken = { token: json.access_token, expiresAt: Date.now() + ttlMs - 60_000 }
  return json.access_token
}

async function getToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token
  }
  return login()
}

/** Authenticated fetch that retries once with a fresh token on a 401. */
async function asFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken()
  const res = await fetch(`${AS_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  if (res.status === 401 && retry) {
    cachedToken = null
    await getToken(true)
    return asFetch(path, init, false)
  }
  return res
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

  const res = await asFetch(`/api/quotation/list?${qs.toString()}`)
  if (!res.ok) throw new Error(`AppleSystem list failed (${res.status})`)
  const json = (await res.json()) as { success?: boolean; data?: ASBookingListItem[]; total?: number }
  const items = Array.isArray(json.data) ? json.data : []
  return { items, total: json.total ?? items.length }
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
