import { NextRequest } from 'next/server'
import {
  authenticateClient,
  issueToken,
  loginLockRemainingMs,
  getConfiguredClients,
} from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, readJsonBody, runRoute } from '@/lib/public-api/as-http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/public/as/v1/auth/login
 * Body: { username, password }
 *
 * Exchanges the integration credentials for a bearer token used on every other
 * endpoint in this API. Tokens are valid for 12 hours by default
 * (`AS_PUBLIC_API_TOKEN_TTL_MIN`).
 */
export async function POST(req: NextRequest) {
  return runRoute('auth/login', async (requestId) => {
    const body = await readJsonBody(req)
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')

    if (!username || !password) {
      return apiFail('username and password are required', 422, 'CREDENTIALS_REQUIRED', requestId)
    }

    const lockedFor = loginLockRemainingMs(username)
    if (lockedFor > 0) {
      return apiFail(
        `Too many failed logins — try again in ${Math.ceil(lockedFor / 1000)}s`,
        429,
        'TOO_MANY_ATTEMPTS',
        requestId,
      )
    }

    if (getConfiguredClients().length === 0) {
      return apiFail(
        'No API client is configured on this server — set AS_PUBLIC_API_USERNAME / AS_PUBLIC_API_PASSWORD',
        503,
        'NOT_CONFIGURED',
        requestId,
      )
    }

    const client = authenticateClient(username, password)
    if (!client) {
      return apiFail('Invalid username or password', 401, 'INVALID_CREDENTIALS', requestId)
    }

    const token = await issueToken(client)
    return apiOk({ ...token, message: `Authenticated as ${client.name}` }, 200, requestId)
  })
}
