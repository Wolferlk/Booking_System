/**
 * Response envelope + handler wrapper shared by every public AS API route.
 *
 * Every response — success or failure — carries `success`, a `request_id` the
 * AS side can quote in a support ticket, and an ISO timestamp. Errors always
 * carry a stable machine-readable `code` so AppleSystem can branch on it
 * without string-matching the message.
 */

import { randomUUID } from 'crypto'
import { AsApiError } from './as-quotation-actions'

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
      throw new AsApiError('The request body must be a JSON object', 400, 'INVALID_BODY')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof AsApiError) throw err
    throw new AsApiError('The request body is not valid JSON', 400, 'INVALID_JSON')
  }
}

/**
 * Run a route body, turning `AsApiError` into its declared status/code and
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
    if (err instanceof AsApiError) return apiFail(err.message, err.status, err.code, requestId)
    console.error(`[as-public-api] ${label} failed (${requestId}):`, err)
    return apiFail('An unexpected error occurred while processing the request', 500, 'INTERNAL_ERROR', requestId)
  }
}
