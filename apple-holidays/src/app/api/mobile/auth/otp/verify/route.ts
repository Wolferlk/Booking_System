/**
 * POST /api/mobile/auth/otp/verify  { otpId, code }
 *
 *   purpose LOGIN    → signed in (account created on first use)
 *   purpose ACTIVATE / RESET → a 15-minute `resetToken` for set-password, plus
 *                      a session token so the app can carry straight on
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { signDriverToken, signResetToken } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { verifyOtp } from '@/lib/mobile/otp'
import { driverProfile } from '@/lib/mobile/profile'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('otp-verify', async (req: NextRequest) => {
  const body = await readJson<{ otpId?: string; code?: string }>(req)
  if (!body.otpId || !body.code) throw new MobileError('Enter the 6-digit code.')
  const { driverId, purpose, channel } = await verifyOtp(body.otpId, body.code)

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { isActive: true } })
  if (!driver?.isActive) throw new MobileError('Your driver profile is not active. Please contact operations.', 403, 'inactive')

  const verified = channel === 'WHATSAPP' ? { phoneVerifiedAt: new Date() } : { emailVerifiedAt: new Date() }
  const account = await prisma.mobileDriverAccount.upsert({
    where: { driverId },
    create: { driverId, ...verified, lastLoginAt: new Date() },
    update: { ...verified, lastLoginAt: new Date() },
  })

  return buildApiSuccess({
    token: await signDriverToken(driverId, account.id, account.tokenVersion),
    resetToken: purpose === 'LOGIN' && account.passwordHash ? null : await signResetToken(driverId, body.otpId),
    needsPassword: !account.passwordHash || purpose !== 'LOGIN',
    actor: await driverProfile(driverId),
  })
})
