import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute } from '@/lib/public-api/fh-http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/auth/verify
 *
 * Cheap "is my token still good?" probe. Call it before a batch run instead of
 * discovering an expired token halfway through a flight upload.
 */
export async function GET(req: NextRequest) {
  return runRoute('auth/verify', async (requestId) => {
    const caller = await requireCaller(req, 'booking:read')
    return apiOk(
      {
        valid: true,
        subject: caller.subject,
        subject_type: caller.kind,
        client_name: caller.name,
        scopes: caller.scopes,
        authenticated_via: caller.via,
        acting_as: {
          id: caller.handler.id,
          name: caller.handler.name,
          email: caller.handler.email,
          country: caller.handler.country,
        },
        message: 'Token is valid',
      },
      200,
      requestId,
    )
  })
}
