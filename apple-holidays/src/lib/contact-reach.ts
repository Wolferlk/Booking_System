/**
 * "Where does the guest's number reach?" — the one place that answers it for
 * the booking page, and that keeps the AI-call service on the guest's number.
 *
 * The guest WhatsApp on a booking is read by three automations:
 *   · the daily trip plan        (customer-whatsapp-automation.ts)
 *   · the departure feedback ask (customer-whatsapp-automation.ts)
 *   · AI voice calls             (Traveller-Experience service, tbl_te_service)
 * The first two read the booking live, so fixing the number fixes them. The
 * call service holds its own copy (`call_phone`), so when staff correct the
 * guest number we re-point it — but only when it was following the guest
 * contact. A service deliberately registered on a different traveller's phone
 * is left alone and reported, never silently overwritten.
 */
import { prisma } from '@/lib/prisma'
import { tePatch, normalizePhone } from '@/lib/te/te-api'
import {
  SETTING_DAILY_BRIEFING,
  SETTING_FEEDBACK_REQUEST,
  getDefaultBriefingTime,
  getBookingBriefingTime,
  briefingTimezone,
} from '@/lib/customer-whatsapp-automation'

/** Service states in which the call service still dials (and so should follow the guest). */
const LIVE_CALL_STATES = new Set(['active', 'paused'])

export interface ContactReach {
  briefing: { enabled: boolean; time: string; override: string | null; timezone: string }
  feedback: { enabled: boolean }
  aiCalls: {
    registered: boolean
    status: string | null
    callPhone: string | null
  }
}

async function flag(key: string): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value !== 'false' // default ON, same as the automations
}

export async function getContactReach(b: { bookingRef: string; operationCountry: string | null }): Promise<ContactReach> {
  const [briefingOn, feedbackOn, defaultTime, override, svc] = await Promise.all([
    flag(SETTING_DAILY_BRIEFING),
    flag(SETTING_FEEDBACK_REQUEST),
    getDefaultBriefingTime(),
    getBookingBriefingTime(b.bookingRef),
    prisma.tbl_te_service.findUnique({
      where: { booking_ref: b.bookingRef },
      select: { status: true, call_phone: true, customer_phone: true },
    }).catch(() => null),
  ])
  return {
    briefing: {
      enabled: briefingOn && override !== 'OFF',
      time: override && override !== 'OFF' ? override : defaultTime,
      override,
      timezone: briefingTimezone(b.operationCountry, b.bookingRef),
    },
    feedback: { enabled: feedbackOn },
    aiCalls: {
      registered: Boolean(svc),
      status: svc?.status ?? null,
      callPhone: svc ? normalizePhone(svc.call_phone || svc.customer_phone) || null : null,
    },
  }
}

export type AiCallSync =
  | { result: 'not-registered' }
  | { result: 'unchanged' }
  | { result: 'inactive'; status: string }
  | { result: 'kept-different'; callPhone: string }
  | { result: 'updated'; from: string | null; to: string }
  | { result: 'failed'; error: string }

/**
 * After the guest WhatsApp changed to `nextDigits` (validated, international):
 * point the booking's AI-call service at it, if that service was following the
 * old guest contact. Never throws — the booking save has already succeeded.
 */
export async function syncAiCallsPhone(p: {
  bookingRef: string
  nextDigits: string
  previous: (string | null | undefined)[]
}): Promise<AiCallSync> {
  try {
    const svc = await prisma.tbl_te_service.findUnique({
      where: { booking_ref: p.bookingRef },
      select: { status: true, call_phone: true, customer_phone: true },
    })
    if (!svc) return { result: 'not-registered' }
    const current = normalizePhone(svc.call_phone || svc.customer_phone)
    if (current === p.nextDigits) return { result: 'unchanged' }
    if (!LIVE_CALL_STATES.has(svc.status)) return { result: 'inactive', status: svc.status }

    // Only follow the guest: the service must have been on (a form of) the old contact.
    const old = p.previous.map(v => normalizePhone(v)).filter(o => o.length >= 7)
    const following = !current || old.some(o => o === current || o.endsWith(current) || current.endsWith(o))
    if (!following) return { result: 'kept-different', callPhone: current }

    const res = await tePatch<{ ok?: boolean; message?: string; service?: unknown; error?: string }>(
      `services/${encodeURIComponent(p.bookingRef)}`, { phone: p.nextDigits },
    )
    if (res?.error || (res?.ok === false && !res.service)) {
      return { result: 'failed', error: res.error ?? res.message ?? 'Call service refused the update' }
    }
    return { result: 'updated', from: current || null, to: p.nextDigits }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[contact-reach] AI-call phone sync failed for ${p.bookingRef}:`, msg)
    return { result: 'failed', error: msg.slice(0, 200) }
  }
}
