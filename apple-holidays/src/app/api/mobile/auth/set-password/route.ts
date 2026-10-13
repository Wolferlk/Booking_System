/**
 * POST /api/mobile/auth/set-password  { resetToken, password }
 *
 * The reset token proves a code was verified in the last 15 minutes. Setting a
 * password bumps the account's token version — every other signed-in phone is
 * signed out — and returns a fresh session for this one.
 */
import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { signDriverToken, verifyResetToken } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { driverProfile } from '@/lib/mobile/profile'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('set-password', async (req: NextRequest) => {
  const body = await readJson<{ resetToken?: string; password?: string }>(req)
  const proof = body.resetToken ? await verifyResetToken(body.resetToken) : null
  if (!proof) throw new MobileError('This step has expired. Please request a new code.', 401, 'expired')
  const password = String(body.password ?? '')
  if (password.length < 6) throw new MobileError('Use at least 6 characters.', 400, 'weak')
  if (/^(\d)\1+$/.test(password) || password === '123456') throw new MobileError('That password is too easy to guess.', 400, 'weak')

  const otp = await prisma.mobileOtp.findUnique({ where: { id: proof.otpId }, select: { driverId: true, consumedAt: true } })
  if (!otp || otp.driverId !== proof.driverId || !otp.consumedAt) throw new MobileError('Please verify again.', 401, 'expired')

  const account = await prisma.mobileDriverAccount.update({
    where: { driverId: proof.driverId },
    data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 } },
  })
  return buildApiSuccess({
    token: await signDriverToken(proof.driverId, account.id, account.tokenVersion),
    actor: await driverProfile(proof.driverId),
  })
})
