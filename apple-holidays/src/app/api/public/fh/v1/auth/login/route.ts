import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  authenticateHandler,
  authenticateServiceClient,
  findHandlerByRef,
  getConfiguredClients,
  issueHandlerToken,
  issueServiceToken,
  loginLockRemainingMs,
} from '@/lib/public-api/fh-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute, str, FhApiError } from '@/lib/public-api/fh-http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/fh/v1/auth/login
 *
 * Two ways in, both returning the same bearer token envelope:
 *
 *  • **File handler** — `{ "credential": "handler@example.com", "password": "…" }`
 *    The very same email/phone + password as the portal login. Everything the
 *    token does is attributed to that handler.
 *
 *  • **Service client** — `{ "username": "fh_integration", "password": "…",
 *    "act_as": "handler@example.com" }` for a machine account configured in the
 *    environment. `act_as` is optional here; it can also be sent per request as
 *    the `X-File-Handler` header.
 *
 * The type is auto-detected (a configured service username wins) and can be
 * forced with `"type": "handler" | "service"`.
 */
export async function POST(req: NextRequest) {
  return runRoute('auth/login', async (requestId) => {
    const body = await readJsonBody(req)

    const credential = str(body, 'credential', 'username', 'email', 'phone', 'user')
    const password = body.password === undefined ? '' : String(body.password)
    const forcedType = str(body, 'type', 'client_type')?.toLowerCase()

    if (!credential || !password) {
      return apiFail('credential (email/phone/username) and password are required', 422, 'CREDENTIALS_REQUIRED', requestId)
    }
    if (forcedType && !['handler', 'service'].includes(forcedType)) {
      return apiFail('type must be "handler" or "service"', 422, 'INVALID_TYPE', requestId)
    }

    const lockedFor = loginLockRemainingMs(credential)
    if (lockedFor > 0) {
      return apiFail(
        `Too many failed logins — try again in ${Math.ceil(lockedFor / 1000)}s`,
        429,
        'TOO_MANY_ATTEMPTS',
        requestId,
      )
    }

    const isConfiguredClient = getConfiguredClients().some((c) => c.username === credential)
    const asService = forcedType === 'service' || (forcedType !== 'handler' && isConfiguredClient)

    // ── Machine client ───────────────────────────────────────────────────────
    if (asService) {
      const client = authenticateServiceClient(credential, password)
      if (!client) return apiFail('Invalid username or password', 401, 'INVALID_CREDENTIALS', requestId)

      const actAsRef = str(body, 'act_as', 'actAs', 'file_handler', 'on_behalf_of') || client.actAs
      const actAs = actAsRef ? await findHandlerByRef(actAsRef) : undefined

      const token = await issueServiceToken(client, actAs)
      return apiOk(
        {
          ...token,
          message: actAs
            ? `Authenticated as ${client.name}, acting for ${actAs.name}`
            : `Authenticated as ${client.name} — send X-File-Handler on each request to name the file handler`,
        },
        200,
        requestId,
      )
    }

    // ── File handler ─────────────────────────────────────────────────────────
    const handler = await authenticateHandler(credential, password).catch((err) => {
      if (err instanceof FhApiError) throw err
      throw new FhApiError('Login failed', 500, 'INTERNAL_ERROR')
    })

    const token = await issueHandlerToken(handler)

    // Same bookkeeping the portal login does, so "last seen" stays truthful.
    await Promise.all([
      prisma.fileHandler.update({ where: { id: handler.id }, data: { lastLoginAt: new Date() } }),
      prisma.fileHandlerLog.create({
        data: {
          fileHandlerId: handler.id,
          fileHandlerName: handler.name,
          action: 'LOGIN',
          details: 'Signed in via the File Handler public API',
        },
      }),
    ])

    return apiOk({ ...token, message: `Authenticated as ${handler.name}` }, 200, requestId)
  })
}
