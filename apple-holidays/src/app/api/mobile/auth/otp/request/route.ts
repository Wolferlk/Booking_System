/**
 * POST /api/mobile/auth/otp/request  { identifier, channel: 'WHATSAPP'|'EMAIL', purpose: 'ACTIVATE'|'LOGIN'|'RESET' }
 *
 * Sends a 6-digit code to the phone / e-mail ON FILE for the driver — never to
 * an address typed into the request — so knowing a driver's number is not
 * enough to take over their account.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { MobileError, clientIp, mobileRoute, readJson } from '@/lib/mobile/http'
import { findDriverByIdentifier, issueOtp, type OtpChannel, type OtpPurpose } from '@/lib/mobile/otp'

export const dynamic = 'force-dynamic'

const PURPOSES: OtpPurpose[] = ['ACTIVATE', 'LOGIN', 'RESET']
const CHANNELS: OtpChannel[] = ['WHATSAPP', 'EMAIL']

export const POST = mobileRoute('otp-request', async (req: NextRequest) => {
  const body = await readJson<{ identifier?: string; channel?: string; purpose?: string }>(req)
  const purpose = (PURPOSES.includes(body.purpose as OtpPurpose) ? body.purpose : 'LOGIN') as OtpPurpose
  const channel = (CHANNELS.includes(body.channel as OtpChannel) ? body.channel : 'WHATSAPP') as OtpChannel
  const driver = await findDriverByIdentifier(String(body.identifier ?? ''))
  if (!driver) {
    throw new MobileError(
      'We could not find a registered driver with that phone or e-mail. Use the number you gave on the driver registration form, or ask operations.',
      404, 'not_found',
    )
  }
  const issued = await issueOtp({ driver, purpose, channel, ip: clientIp(req) })
  return buildApiSuccess({ ...issued, driverName: driver.name.split(/\s+/)[0] })
})
