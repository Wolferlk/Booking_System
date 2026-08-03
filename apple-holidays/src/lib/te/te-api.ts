/**
 * Server-side client for the Traveller-Experience (AI voice call) API.
 *
 * The dashboard talks to the same service through `/api/te/proxy`, but a report
 * that has to be built by a cron tick has no browser session to proxy through —
 * so the report path calls the upstream directly with the shared secret.
 */

export const TE_BASE = (
  process.env.TE_BASE_URL ??
  'https://travel-parser-live.aahaas.com/v1/traveller-experience'
).replace(/\/$/, '')

const TE_SECRET = process.env.TE_WEBHOOK_SECRET ?? ''

/** Upstream is occasionally slow on wide list queries; fail rather than hang a cron tick. */
const TIMEOUT_MS = Number(process.env.TE_FETCH_TIMEOUT_MS ?? '25000')

export async function teGet<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${TE_BASE}/${path.replace(/^\//, '')}`)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), {
      headers: { 'Content-Type': 'application/json', ...(TE_SECRET ? { 'x-te-secret': TE_SECRET } : {}) },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`TE ${path} → ${res.status} ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function tePost<T>(path: string, body: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${TE_BASE}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(TE_SECRET ? { 'x-te-secret': TE_SECRET } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    if (!res.ok) throw new Error(`TE ${path} → ${res.status} ${text.slice(0, 200)}`)
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The list endpoints answer either as a bare array or wrapped — normalise once
 * here so every caller can assume an array.
 */
export function teList<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const key of [...keys, 'data', 'items', 'results', 'rows']) {
      if (Array.isArray(obj[key])) return obj[key] as T[]
    }
  }
  return []
}

/** Digits-only form used as the identity of a phone number across systems. */
export function normalizePhone(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '')
}
