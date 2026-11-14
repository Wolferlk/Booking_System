/**
 * WhatsApp approval codes for the Ticket Issue Desk.
 *
 *   · the code is random, and only its HMAC is stored;
 *   · it lasts OTP_TTL_MINUTES, allows MAX_ATTEMPTS guesses and works once;
 *   · it is bound to one booking, purpose, reference and amount — change any of
 *     those and it stops working, so a code approved for SGD 100 cannot pay 500;
 *   · a new code voids the one before it.
 */
import { createHmac, randomInt, timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendViaMetaTemplate } from '@/lib/whatsapp'
import { OTP_TTL_MINUTES, maskPhone, type PortalConfig } from './config'

export const MAX_ATTEMPTS = 5
export const RESEND_SECONDS = 30
const MAX_PER_HOUR = 6

export type OtpPurpose = 'CONFIRM' | 'CANCEL'

export class OtpError extends Error {
  constructor(message: string, public status = 422) { super(message) }
}

function hmac(value: string) {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) throw new OtpError('The server has no secret to protect approval codes with.', 500)
  return createHmac('sha256', secret).update(value).digest('hex')
}

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')
const bindFor = (bookingId: string, purpose: OtpPurpose, reference: string, amount: string) =>
  hmac(`bind|${bookingId}|${purpose}|${reference}|${amount}`)

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200)

export interface SentTo { name: string; phone: string; ok: boolean; error?: string }

/** One code, sent as the approved code template. Throws if Meta refuses it. */
async function sendCode(config: PortalConfig, phone: string, code: string) {
  const res = await sendViaMetaTemplate({
    to: phone, templateName: config.otpTemplate, lang: config.language, bodyParams: [code], otpButtonCode: code, audience: 'internal',
  })
  if (!res) throw new Error('WhatsApp is not configured on this server.')
}

const param = (v: string) => v.replace(/\s+/g, ' ').trim().slice(0, 120) || '-'

export async function issueOtp(input: {
  config: PortalConfig
  booking: { id: string; reference: string; amount: string }
  purpose: OtpPurpose
  details: { action: string; bookingRef: string; ticket: string; portal: string; amountText: string; requestedBy: string }
  requestedById: string
}): Promise<{ expiresAt: Date; sentTo: SentTo[]; resendAfter: number }> {
  const { config, booking, purpose, details } = input
  if (!config.recipients.length) throw new OtpError('No approver WhatsApp numbers are set. Add them under Settings → Ticket Issue Desk.', 409)

  const recent = await prisma.ticketPortalOtp.findMany({
    where: { portalBookingId: booking.id, purpose, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (recent.length) {
    const wait = RESEND_SECONDS - Math.floor((Date.now() - recent[0].createdAt.getTime()) / 1000)
    if (wait > 0) throw new OtpError(`Wait ${wait} seconds before sending another code.`, 429)
  }
  if (recent.length >= MAX_PER_HOUR) throw new OtpError('Too many codes for this booking in the last hour. Try again later.', 429)

  await prisma.ticketPortalOtp.updateMany({
    where: { portalBookingId: booking.id, purpose, consumedAt: null, voidedAt: null },
    data: { voidedAt: new Date() },
  })

  const code = newCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000)
  const row = await prisma.ticketPortalOtp.create({
    data: {
      portalBookingId: booking.id,
      purpose,
      codeHash: 'pending',
      bindHash: bindFor(booking.id, purpose, booking.reference, booking.amount),
      requestedById: input.requestedById,
      requestedByName: details.requestedBy.slice(0, 191),
      expiresAt,
    },
  })
  await prisma.ticketPortalOtp.update({ where: { id: row.id }, data: { codeHash: hmac(`code|${row.id}|${code}`) } })

  const bodyParams = [details.action, details.bookingRef, details.ticket, details.portal, details.amountText, details.requestedBy].map(param)
  const sentTo = await Promise.all(config.recipients.map(async (r): Promise<SentTo> => {
    // The details are a courtesy; the code is what matters. Details first, so
    // the approver reads what they are approving before the code lands.
    await sendViaMetaTemplate({ to: r.phone, templateName: config.detailsTemplate, lang: config.language, bodyParams, audience: 'internal' })
      .catch(err => console.warn('[ticket-portal] details message failed:', reason(err)))
    try {
      await sendCode(config, r.phone, code)
      return { name: r.name, phone: maskPhone(r.phone), ok: true }
    } catch (err) {
      return { name: r.name, phone: maskPhone(r.phone), ok: false, error: reason(err) }
    }
  }))

  await prisma.ticketPortalOtp.update({ where: { id: row.id }, data: { recipients: JSON.stringify(sentTo) } })

  if (!sentTo.some(s => s.ok)) {
    await prisma.ticketPortalOtp.update({ where: { id: row.id }, data: { voidedAt: new Date() } })
    throw new OtpError(`WhatsApp refused the code for every approver — ${sentTo[0]?.error ?? 'no reason given'}`, 502)
  }
  return { expiresAt, sentTo, resendAfter: RESEND_SECONDS }
}

/** Check and use up a code. Throws OtpError if it cannot be used. */
export async function consumeOtp(input: {
  booking: { id: string; reference: string; amount: string }
  purpose: OtpPurpose
  code: string
}): Promise<{ requestedByName: string | null }> {
  const { booking, purpose } = input
  const code = String(input.code ?? '').replace(/\D/g, '')
  if (code.length !== 6) throw new OtpError('Enter the 6-digit code from WhatsApp.')

  const row = await prisma.ticketPortalOtp.findFirst({
    where: { portalBookingId: booking.id, purpose, consumedAt: null, voidedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) throw new OtpError('No code is waiting for this step. Send a new code.')
  if (row.expiresAt.getTime() < Date.now()) throw new OtpError('That code has expired. Send a new code.')
  if (row.bindHash !== bindFor(booking.id, purpose, booking.reference, booking.amount)) {
    await prisma.ticketPortalOtp.update({ where: { id: row.id }, data: { voidedAt: new Date() } })
    throw new OtpError('The booking changed after this code was sent. Send a new code.', 409)
  }

  // The increment is conditional, so parallel guesses cannot exceed the limit.
  const counted = await prisma.ticketPortalOtp.updateMany({
    where: { id: row.id, attempts: { lt: MAX_ATTEMPTS }, consumedAt: null, voidedAt: null },
    data: { attempts: { increment: 1 } },
  })
  if (!counted.count) throw new OtpError('Too many wrong tries. Send a new code.', 429)

  const given = Buffer.from(hmac(`code|${row.id}|${code}`))
  const stored = Buffer.from(row.codeHash)
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    const left = MAX_ATTEMPTS - row.attempts - 1
    throw new OtpError(left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Send a new code.', left > 0 ? 422 : 429)
  }

  const used = await prisma.ticketPortalOtp.updateMany({ where: { id: row.id, consumedAt: null, voidedAt: null }, data: { consumedAt: new Date() } })
  if (!used.count) throw new OtpError('That code was already used.', 409)
  return { requestedByName: row.requestedByName }
}

/**
 * A cart approval: the code for a whole cart (bulk.ts) was used, and is still
 * fresh. It is bound like any code — to the cart's exact holds and amounts — so
 * a cart that changed after approval needs a new code. Each hold can still be
 * paid only once (payHeld moves its status atomically), so reusing the approval
 * cannot pay twice. Null when there is no such approval.
 */
export async function findApproval(input: {
  booking: { id: string; reference: string; amount: string }
  purpose: OtpPurpose
  withinMs: number
}): Promise<{ approvedAt: Date; requestedByName: string | null } | null> {
  const { booking, purpose } = input
  const row = await prisma.ticketPortalOtp.findFirst({
    where: { portalBookingId: booking.id, purpose, voidedAt: null, consumedAt: { gte: new Date(Date.now() - input.withinMs) } },
    orderBy: { consumedAt: 'desc' },
  })
  if (!row?.consumedAt || row.bindHash !== bindFor(booking.id, purpose, booking.reference, booking.amount)) return null
  return { approvedAt: row.consumedAt, requestedByName: row.requestedByName }
}

/** Settings → "Send test code": proves the template and numbers work. Stores nothing. */
export async function sendTestCode(config: PortalConfig): Promise<SentTo[]> {
  const code = newCode()
  return Promise.all(config.recipients.map(async (r): Promise<SentTo> => {
    try {
      await sendCode(config, r.phone, code)
      return { name: r.name, phone: maskPhone(r.phone), ok: true }
    } catch (err) {
      return { name: r.name, phone: maskPhone(r.phone), ok: false, error: reason(err) }
    }
  }))
}
