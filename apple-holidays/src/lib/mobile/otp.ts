/**
 * One-time codes for the Driver App — first sign-in (linking a registered
 * driver to the app), password reset, and "sign in with a code".
 *
 * A driver is found by the phone or e-mail they gave on /register/driver, so a
 * driver who filled that form never registers twice. The code goes out on
 * WhatsApp through an AUTHENTICATION template (copy-code button) — the only
 * way to reach a number that has not messaged us in 24h — or by e-mail from
 * the ops mailbox. Only the SHA-256 of a code is stored.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { normalizePhone, normalizeEmail, phoneMatches } from '@/lib/credential-match'
import { normaliseSriLankanPhone } from '@/lib/sl-phone'
import { sendMailViaGraph } from '@/lib/send-mail'
import { isWithin24hWindow, sendWhatsAppText } from '@/lib/whatsapp'
import { MobileError } from './http'

export const TEMPLATE_DRIVER_APP_CODE =
  process.env.WHATSAPP_TEMPLATE_DRIVER_APP_CODE?.trim() || 'aahaas_driver_app_code'
export const DRIVER_APP_CODE_LANG = process.env.WHATSAPP_TEMPLATE_DRIVER_APP_CODE_LANG?.trim() || 'en'

const CODE_TTL_MIN = 10
const MAX_ATTEMPTS = 5
/** Codes a single driver may be sent in an hour, across both channels. */
const MAX_SENDS_PER_HOUR = 5

export type OtpPurpose = 'ACTIVATE' | 'LOGIN' | 'RESET'
export type OtpChannel = 'WHATSAPP' | 'EMAIL'

export interface FoundDriver {
  id: string
  name: string
  phone: string
  email: string | null
  country: string | null
  isActive: boolean
}

/** Find the registered driver behind a phone number or e-mail address. */
export async function findDriverByIdentifier(identifier: string): Promise<FoundDriver | null> {
  const raw = identifier.trim()
  if (!raw) return null
  if (raw.includes('@')) {
    const email = normalizeEmail(raw)
    const rows = await prisma.driver.findMany({
      where: { email: { not: null } },
      select: { id: true, name: true, phone: true, email: true, country: true, isActive: true },
    })
    const hits = rows.filter(r => normalizeEmail(r.email) === email)
    return pickOne(hits)
  }
  if (normalizePhone(raw).length < 7) return null
  // The drivers table is a few hundred rows; numbers are stored in every shape
  // ("077…", "+94 77…", "9477…"), so match on digits in memory.
  const rows = await prisma.driver.findMany({
    select: { id: true, name: true, phone: true, email: true, country: true, isActive: true },
  })
  return pickOne(rows.filter(r => phoneMatches(r.phone, raw)))
}

function pickOne(hits: FoundDriver[]): FoundDriver | null {
  if (!hits.length) return null
  // Duplicate registrations happen; prefer the active one.
  return hits.find(h => h.isActive) ?? hits[0]
}

const COUNTRY_CODE: Record<string, string> = { SRILANKA: '94', VIETNAM: '84', SINGAPORE_MALAYSIA: '65' }

/** The number WhatsApp wants (digits, with country code), or null. */
export function whatsappNumberFor(phone: string, country: string | null): string | null {
  if (!country || country === 'SRILANKA') {
    const n = normaliseSriLankanPhone(phone)
    if (n.ok) return n.msisdn
  }
  let d = phone.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) {
    const cc = COUNTRY_CODE[country ?? ''] ?? '94'
    d = cc + d.slice(1)
  }
  return d.length >= 10 && d.length <= 15 ? d : null
}

/** "+94 •• ••• 4186" / "s•••@yahoo.com" — what the app shows as "code sent to". */
export function maskTarget(channel: OtpChannel, target: string): string {
  if (channel === 'EMAIL') {
    const [u, d] = target.split('@')
    return `${u.slice(0, 1)}•••@${d ?? ''}`
  }
  return `+${target.slice(0, 2)} •• ••• ${target.slice(-4)}`
}

function hashCode(otpId: string, code: string): string {
  return crypto.createHash('sha256').update(`${otpId}:${code}`).digest('hex')
}

async function sendWhatsAppCode(to: string, code: string, name: string): Promise<void> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const version = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
  let templateError = 'WhatsApp is not configured'
  if (accessToken && phoneNumberId) {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: TEMPLATE_DRIVER_APP_CODE,
          language: { code: DRIVER_APP_CODE_LANG },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
          ],
        },
      }),
    })
    if (res.ok) return
    templateError = (await res.text()).slice(0, 300)
    console.error('[mobile otp] WhatsApp template send failed:', templateError)
  }
  // Inside the 24h window a plain message is delivered too — the template may
  // still be waiting for Meta's approval.
  if (await isWithin24hWindow(to).catch(() => false)) {
    const ok = await sendWhatsAppText(to, `Your Aahaas Driver App code is *${code}*.\nIt expires in ${CODE_TTL_MIN} minutes. Never share this code.`, name)
    if (ok) return
  }
  throw new MobileError('We could not send the code on WhatsApp. Please try e-mail instead.', 502, 'whatsapp_failed')
}

async function sendEmailCode(to: string, code: string, name: string, purpose: OtpPurpose): Promise<void> {
  const title = purpose === 'RESET' ? 'Reset your password' : 'Your sign-in code'
  await sendMailViaGraph({
    to,
    subject: `${code} is your Aahaas Driver App code`,
    bodyHtml: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
        <h2 style="margin:0 0 8px;color:#111">${title}</h2>
        <p style="color:#444">Hi ${escapeHtml(name)}, use this code in the Aahaas Driver App:</p>
        <p style="font-size:34px;letter-spacing:8px;font-weight:bold;color:#e11d48;margin:16px 0">${code}</p>
        <p style="color:#666;font-size:13px">It expires in ${CODE_TTL_MIN} minutes. If you did not ask for it, ignore this e-mail — nobody can sign in without the code.</p>
        <p style="color:#999;font-size:12px">AppleHolidays Operations</p>
      </div>`,
  })
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

export interface IssuedOtp {
  otpId: string
  channel: OtpChannel
  sentTo: string
  expiresInSec: number
}

export async function issueOtp(params: {
  driver: FoundDriver
  purpose: OtpPurpose
  channel: OtpChannel
  ip: string | null
}): Promise<IssuedOtp> {
  const { driver, purpose, channel } = params
  if (!driver.isActive) throw new MobileError('Your driver profile is not active. Please contact operations.', 403, 'inactive')

  const recent = await prisma.mobileOtp.count({
    where: { driverId: driver.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
  })
  if (recent >= MAX_SENDS_PER_HOUR) {
    throw new MobileError('Too many codes requested. Please wait a while and try again.', 429, 'rate_limited')
  }

  let target: string | null
  if (channel === 'EMAIL') {
    target = driver.email ? normalizeEmail(driver.email) : null
    if (!target) throw new MobileError('There is no e-mail on your driver profile. Use WhatsApp instead.', 400, 'no_email')
  } else {
    target = whatsappNumberFor(driver.phone, driver.country)
    if (!target) throw new MobileError('Your phone number on file looks wrong. Please contact operations.', 400, 'bad_phone')
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const otp = await prisma.mobileOtp.create({
    data: {
      purpose, channel, target, driverId: driver.id, codeHash: 'pending',
      expiresAt: new Date(Date.now() + CODE_TTL_MIN * 60_000), ip: params.ip,
    },
  })
  await prisma.mobileOtp.update({ where: { id: otp.id }, data: { codeHash: hashCode(otp.id, code) } })

  try {
    if (channel === 'EMAIL') await sendEmailCode(target, code, driver.name, purpose)
    else await sendWhatsAppCode(target, code, driver.name)
  } catch (err) {
    // A code that never left must not count as usable.
    await prisma.mobileOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }).catch(() => {})
    if (err instanceof MobileError) throw err
    console.error('[mobile otp] send failed:', err)
    throw new MobileError('We could not send the code. Please try the other option.', 502, 'send_failed')
  }

  return { otpId: otp.id, channel, sentTo: maskTarget(channel, target), expiresInSec: CODE_TTL_MIN * 60 }
}

/** Checks a code; consumes it on success. Returns the driver id. */
export async function verifyOtp(otpId: string, code: string): Promise<{ driverId: string; purpose: OtpPurpose; channel: OtpChannel }> {
  const otp = await prisma.mobileOtp.findUnique({ where: { id: otpId } })
  if (!otp || otp.consumedAt) throw new MobileError('This code is no longer valid. Please request a new one.', 400, 'invalid')
  if (otp.expiresAt.getTime() < Date.now()) throw new MobileError('This code has expired. Please request a new one.', 400, 'expired')
  if (otp.attempts >= MAX_ATTEMPTS) throw new MobileError('Too many wrong tries. Please request a new code.', 429, 'locked')

  const ok = crypto.timingSafeEqual(
    Buffer.from(hashCode(otp.id, String(code).replace(/\D/g, ''))),
    Buffer.from(otp.codeHash.length === 64 ? otp.codeHash : '0'.repeat(64)),
  )
  if (!ok) {
    await prisma.mobileOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
    const left = MAX_ATTEMPTS - otp.attempts - 1
    throw new MobileError(left > 0 ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong code. Please request a new one.', 400, 'wrong_code')
  }
  await prisma.mobileOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } })
  return { driverId: otp.driverId, purpose: otp.purpose as OtpPurpose, channel: otp.channel as OtpChannel }
}
