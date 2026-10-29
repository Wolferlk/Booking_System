/**
 * Server-side reader for Aahaas Flow (n8n-project, `/v1/aahaas-flow`) — the
 * order desk behind ai.aahaas.com/aahaasFlow. The B2C booking page shows a
 * store order's products, journey, documents and P&L exactly as Flow has them,
 * instead of OPS re-deriving each one.
 *
 * Authenticates with a shared key (`AAHAAS_FLOW_SERVICE_KEY` here, the same
 * value as `OPS_FLOW_SERVICE_KEY` on the Flow server). Flow accepts that key
 * for GET only, so nothing here can send, accept or cancel anything.
 */

const FLOW_BASE = (
  process.env.AAHAAS_FLOW_API_URL ?? 'https://ai.aahaas.com/v1/aahaas-flow'
).replace(/\/$/, '')

const FLOW_KEY = process.env.AAHAAS_FLOW_SERVICE_KEY ?? ''

/** Flow reads several sources per order; never past this, so a page never hangs. */
const TIMEOUT_MS = Number(process.env.AAHAAS_FLOW_TIMEOUT_MS ?? '25000')

export function isFlowConfigured(): boolean {
  return FLOW_KEY.length >= 24
}

export class FlowError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** The raw response, for documents (HTML / PDF). Throws FlowError on a non-2xx. */
export async function flowFetch(path: string, actor?: string | null): Promise<Response> {
  if (!isFlowConfigured()) {
    throw new FlowError('Aahaas Flow is not connected — set AAHAAS_FLOW_SERVICE_KEY on the OPS server.', 503)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${FLOW_BASE}/${path.replace(/^\//, '')}`, {
      headers: {
        'x-flow-service-key': FLOW_KEY,
        ...(actor ? { 'x-flow-actor': actor.slice(0, 80) } : {}),
      },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!res.ok) {
      // Flow answers errors as { message } — pass its own sentence on.
      const text = await res.text().catch(() => '')
      let message = `Aahaas Flow answered ${res.status}`
      try { message = (JSON.parse(text) as { message?: string }).message || message } catch { /* not JSON */ }
      if (res.status === 401) message = 'Aahaas Flow refused the OPS key — check AAHAAS_FLOW_SERVICE_KEY matches OPS_FLOW_SERVICE_KEY on the Flow server.'
      throw new FlowError(message, res.status)
    }
    return res
  } catch (err) {
    if (err instanceof FlowError) throw err
    const aborted = (err as Error).name === 'AbortError'
    throw new FlowError(aborted ? 'Aahaas Flow did not answer in time.' : `Aahaas Flow is unreachable: ${(err as Error).message}`, 504)
  } finally {
    clearTimeout(timer)
  }
}

/** A JSON read — Flow wraps every answer as `{ success, data }`. */
export async function flowGet<T>(path: string, actor?: string | null): Promise<T> {
  const res = await flowFetch(path, actor)
  const json = (await res.json()) as { success?: boolean; data?: T; message?: string }
  if (json.success === false) throw new FlowError(json.message ?? 'Aahaas Flow could not read this order.', 502)
  return (json.data ?? json) as T
}
