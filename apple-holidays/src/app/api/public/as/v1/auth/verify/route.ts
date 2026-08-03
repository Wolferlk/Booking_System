import { NextRequest } from 'next/server'
import { authorizeRequest } from '@/lib/public-api/as-api-auth'
import { apiOk, apiFail, runRoute } from '@/lib/public-api/as-http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/as/v1/auth/verify
 *
 * Cheap "is my token still good?" probe. AppleSystem can call it before a batch
 * run instead of discovering an expired token mid-cancellation.
 */
export async function GET(req: NextRequest) {
  return runRoute('auth/verify', async (requestId) => {
    const auth = await authorizeRequest(req, 'quotation:read')
    if (!auth.ok) return apiFail(auth.error, auth.status, 'UNAUTHORIZED', requestId)
    return apiOk(
      {
        valid: true,
        client: auth.caller.username,
        client_name: auth.caller.name,
        scopes: auth.caller.scopes,
        authenticated_via: auth.caller.via,
        message: 'Token is valid',
      },
      200,
      requestId,
    )
  })
}
