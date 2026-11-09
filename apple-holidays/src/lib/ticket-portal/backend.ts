/**
 * Main Backend client. GlobalTix and Cebu only whitelist Main Backend's
 * credentials, so OPS never talks to them directly — every portal call goes
 * through Main Backend's existing routes, the same ones n8n-project uses.
 *
 * A failed read says so; it never becomes an empty list. A thrown BackendError
 * means no usable answer came back, so a money step that throws must be treated
 * as "don't know", never as "it didn't happen".
 */

const TIMEOUT_MS = 25_000

export const backendBase = () =>
  (process.env.AAHAAS_MAIN_BACKEND_URL?.trim() || 'https://gateway.aahaas.com').replace(/\/+$/, '')

export class BackendError extends Error {}

async function send(method: 'GET' | 'POST', path: string, body?: unknown) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const route = path.split('?')[0]
  let res: Response
  try {
    res = await fetch(`${backendBase()}${path}`, {
      method,
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    throw new BackendError((err as Error).name === 'AbortError'
      ? `Main Backend did not answer in time for ${route}.`
      : `Main Backend could not be reached (${(err as Error).message}).`)
  } finally {
    clearTimeout(timer)
  }
  const text = await res.text()
  let answer: unknown = null
  try { answer = text ? JSON.parse(text) : null } catch { answer = null }
  if (!res.ok || answer === null) {
    const why = (answer as { message?: string } | null)?.message
    throw new BackendError(`Main Backend answered ${res.status} for ${route}${why ? ` — ${why}` : ''}.`)
  }
  return answer as any
}

export const backendGet = (path: string) => send('GET', path)
export const backendPost = (path: string, body: unknown = {}) => send('POST', path, body)
