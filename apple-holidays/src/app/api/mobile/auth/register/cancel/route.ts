/**
 * POST /api/mobile/auth/register/cancel  { token }
 *
 * The "waiting for approval" screen's "Delete my registration". `token` is the
 * pendingToken from /api/mobile/auth/register, so only the phone that sent the
 * registration can delete it. See lib/mobile/account-delete.ts.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { verifyPendingToken } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { cancelPendingSignup } from '@/lib/mobile/account-delete'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('register-cancel', async (req: NextRequest) => {
  const body = await readJson<{ token?: string }>(req)
  const pending = body.token ? await verifyPendingToken(String(body.token)) : null
  if (!pending) throw new MobileError('This registration link has expired. Please call operations to delete your details.', 401, 'expired')
  return buildApiSuccess(await cancelPendingSignup(pending.kind, pending.id))
})
