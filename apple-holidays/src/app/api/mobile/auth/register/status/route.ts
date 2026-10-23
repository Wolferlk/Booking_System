/**
 * POST /api/mobile/auth/register/status  { token, pushToken?, platform? }
 *
 * The app's "waiting for approval" screen. `token` is the pendingToken from
 * /api/mobile/auth/register. Answers PENDING | APPROVED | REJECTED | GONE and,
 * when given a push token, files it under the new driver / vendor so the
 * approval reaches the phone as a push.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { verifyPendingToken } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { driverSignupStatus, savePendingPushToken } from '@/lib/mobile/signup'
import { vendorSignupStatus } from '@/lib/vendor-register'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('register-status', async (req: NextRequest) => {
  const body = await readJson<{ token?: string; pushToken?: string; platform?: string }>(req)
  const pending = body.token ? await verifyPendingToken(String(body.token)) : null
  if (!pending) throw new MobileError('This registration link has expired. Please sign in or register again.', 401, 'expired')

  const state = pending.kind === 'DRIVER'
    ? await driverSignupStatus(pending.id)
    : { ...(await vendorSignupStatus(pending.id)), note: null }

  if (body.pushToken && (state.status === 'PENDING' || state.status === 'APPROVED')) {
    await savePendingPushToken(pending.kind, pending.id, String(body.pushToken), body.platform ?? null)
  }
  return buildApiSuccess({ kind: pending.kind, status: state.status, name: state.name, note: state.note })
})
