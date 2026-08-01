/**
 * Response envelope + handler wrapper shared by every public File Handler API
 * route (`/api/public/fh/v1`).
 *
 * Same contract as the AS quotation API: every response — success or failure —
 * carries `success`, a `request_id` the caller can quote in a support ticket,
 * and an ISO timestamp. Errors always carry a stable machine-readable `code`
 * so the integrating app can branch on it without string-matching the message.
 */

import { randomUUID } from 'crypto'

/** An error with a status + code that `runRoute` turns into a clean response. */
export class FhApiError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = 'BAD_REQUEST') {
    super(message)
    this.name = 'FhApiError'
    this.status = status
    this.code = code
  }
}

export function apiOk(data: Record<string, unknown>, status = 200, requestId: string = randomUUID()) {
  const { message, ...rest } = data
  return Response.json(
    {
      success: true,
      ...(message ? { message } : {}),
      data: rest,
      request_id: requestId,
      timestamp: new Date().toISOString(),
    },
    { status, headers: { 'x-request-id': requestId } },
  )
}

export function apiFail(error: string, status = 400, code = 'BAD_REQUEST', requestId: string = randomUUID()) {
  return Response.json(
    { success: false, error, code, request_id: requestId, timestamp: new Date().toISOString() },
    { status, headers: { 'x-request-id': requestId } },
  )
}

/** Parse a JSON body, returning `{}` for an empty one and throwing on garbage. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = (await req.text()).trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new FhApiError('The request body must be a JSON object', 400, 'INVALID_BODY')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof FhApiError) throw err
    throw new FhApiError('The request body is not valid JSON', 400, 'INVALID_JSON')
  }
}

/**
 * Run a route body, turning `FhApiError` into its declared status/code and
 * anything unexpected into a logged 500 that never leaks internals.
 */
export async function runRoute(
  label: string,
  fn: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const requestId: string = randomUUID()
  try {
    return await fn(requestId)
  } catch (err) {
    if (err instanceof FhApiError) return apiFail(err.message, err.status, err.code, requestId)
    console.error(`[fh-public-api] ${label} failed (${requestId}):`, err)
    return apiFail('An unexpected error occurred while processing the request', 500, 'INTERNAL_ERROR', requestId)
  }
}

/** Read a value under any of the given key spellings (snake_case / camelCase). */
export function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== null && body[k] !== '') return body[k]
  }
  return undefined
}

/** Trimmed string, or `undefined` when absent/blank. */
export function str(body: Record<string, unknown>, ...keys: string[]): string | undefined {
  const v = pick(body, ...keys)
  if (v === undefined) return undefined
  const s = String(v).trim()
  return s || undefined
}
