/**
 * Customer WhatsApp automation:
 *  1. Daily 6pm "tomorrow's plan" briefing to guests mid-trip
 *  2. Departure-day feedback-form invite (link to the public /feedback/[ref] page)
 *
 * Both are triggered from cron routes (/api/cron/customer-daily-briefing,
 * /api/cron/customer-feedback-request) for GCP/Vercel schedulers, plus the
 * in-process scheduler fallback in cron-scheduler.ts.
 */
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import {
  sendWhatsAppText,
  sendWhatsAppMedia,
  normalisePhone,
  formatCustomerDailyBriefingMessage,
  formatFeedbackRequestMessage,
} from '@/lib/whatsapp'

// Same fixed-offset convention as /api/cron/driver-notify (UTC+7 Vietnam default)
const TZ_OFFSET_HOURS = Number(process.env.CUSTOMER_MSG_TZ_OFFSET_HOURS ?? '7')
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000

export const SETTING_DAILY_BRIEFING = 'auto_whatsapp_daily_briefing_enabled'
export const SETTING_FEEDBACK_REQUEST = 'auto_whatsapp_feedback_request_enabled'

export const TAG_DAILY_BRIEFING = '[DAILY-BRIEFING]'
export const TAG_FEEDBACK_REQUEST = '[FEEDBACK-REQUEST]'

export interface AutomationRunResult {
  sent: number
  skipped: number
  errors: string[]
}

function localDateStr(daysAhead = 0): string {
  const localMs = Date.now() + TZ_OFFSET_MS + daysAhead * 24 * 60 * 60 * 1000
  return new Date(localMs).toISOString().slice(0, 10)
}

function dayBounds(dateStr: string): { start: Date; end: Date } {
  return {
    start: new Date(`${dateStr}T00:00:00.000Z`),
    end:   new Date(`${dateStr}T23:59:59.999Z`),
  }
}

async function settingEnabled(key: string): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  // Default ON when the setting row doesn't exist yet
  return row?.value !== 'false'
}

/** True if a tagged outbound message was already sent to this booking today (dedupe). */
async function alreadySentToday(bookingRef: string, tag: string): Promise<boolean> {
  const { start, end } = dayBounds(localDateStr(0))
  const existing = await prisma.whatsAppMessage.findFirst({
    where: {
      bookingRef,
      direction: 'outbound',
      senderName: { startsWith: tag },
      createdAt: { gte: start, lte: end },
    },
    select: { id: true },
  })
  return Boolean(existing)
}

/** Signed token for the public feedback link — HMAC of the booking ref. */
export function feedbackLinkToken(bookingRef: string): string {
  const secret = process.env.FEEDBACK_LINK_SECRET || process.env.NEXTAUTH_SECRET || 'apple-holidays-feedback'
  return crypto.createHmac('sha256', secret).update(bookingRef).digest('hex').slice(0, 32)
}

export function verifyFeedbackLinkToken(bookingRef: string, token: string): boolean {
  if (!token) return false
  const expected = feedbackLinkToken(bookingRef)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Daily briefing — tomorrow's itinerary to every guest mid-trip
// ─────────────────────────────────────────────────────────────────────────────

export interface SingleSendResult {
  ok: boolean
  reason?: string   // why it was skipped or failed (null when ok)
  message?: string  // the message body that was sent (for previews/logs)
}

/**
 * Send the "your plan for <date>" briefing to one booking's guest.
 * Shared by the daily cron (targetDate = tomorrow) and the manual per-booking
 * "send day N" button (targetDate = the chosen trip day).
 *
 * opts.force     — bypass the once-per-day dedupe (manual resend)
 * opts.allowEmpty — still send even if that day has nothing scheduled
 */
export async function sendDailyBriefingForBooking(
  bookingRef: string,
  targetDateStr: string,
  opts: { force?: boolean; allowEmpty?: boolean } = {},
): Promise<SingleSendResult> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers: { where: { isLead: true }, take: 1 },
      flights: { orderBy: { depTime: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      tickets: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ meetingTime: 'asc' }, { sortOrder: 'asc' }],
            include: { assignment: { include: { driver: true } } },
          },
        },
      },
    },
  })
  if (!b) return { ok: false, reason: 'Booking not found' }

  const phone = b.contactWhatsapp || b.contactPhone
  if (!phone || !normalisePhone(phone)) {
    return { ok: false, reason: 'No WhatsApp/phone contact on this booking' }
  }

  if (!opts.force && await alreadySentToday(bookingRef, TAG_DAILY_BRIEFING)) {
    return { ok: false, reason: 'Already sent today' }
  }

  const onDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10) === targetDateStr

  const agendaItems = (b.tourAgenda?.items ?? []).filter(i => onDay(i.date))
  const flights     = b.flights.filter(f => onDay(f.date))
  const checkIns    = b.accommodations.filter(a => onDay(a.checkIn))
  const checkOuts   = b.accommodations.filter(a => onDay(a.checkOut))
  const stayingAt   = b.accommodations.find(a =>
    new Date(a.checkIn).toISOString().slice(0, 10) <= targetDateStr &&
    new Date(a.checkOut).toISOString().slice(0, 10) > targetDateStr)
  const isDeparting = onDay(b.departureDate)

  const isArrival = onDay(b.arrivalDate)

  const hasContent = agendaItems.length > 0 || flights.length > 0 ||
    checkIns.length > 0 || checkOuts.length > 0 || isDeparting
  if (!hasContent && !opts.allowEmpty) {
    return { ok: false, reason: 'Nothing scheduled for this day' }
  }

  // Group this day's tickets by the agenda item they belong to. Booking-level
  // tickets (no agenda link) fall through and are ignored for per-movement display.
  const dayItemIds = new Set(agendaItems.map(i => i.id))
  const dayTickets = (b.tickets ?? []).filter(t =>
    t.activated && t.agendaItemId && dayItemIds.has(t.agendaItemId))

  const ticketLabel = (t: (typeof dayTickets)[number]) =>
    t.category?.trim() || t.type || 'Ticket'

  const movements = agendaItems.map(item => ({
    location:     item.location,
    fromPoint:    item.fromPoint,
    toPoint:      item.toPoint,
    meetingTime:  item.meetingTime,
    timeFrom:     item.timeFrom,
    timeTo:       item.timeTo,
    details:      item.details,
    mealPlan:     item.mealPlan,
    serviceType:  item.serviceType,
    driverName:   item.assignment?.driverName ?? item.assignment?.driver?.name ?? null,
    driverPhone:  item.assignment?.driverPhone ?? item.assignment?.driver?.phone ?? null,
    vehicleType:  item.assignment?.vehicleType ?? null,
    vehiclePlate: item.assignment?.vehiclePlate ?? null,
    tickets: dayTickets
      .filter(t => t.agendaItemId === item.id)
      .map(t => ({
        label:     ticketLabel(t),
        reference: t.reference ?? null,
        supplier:  t.supplier ?? null,
        confirmed: t.status === 'PURCHASED' || t.status === 'PAID',
        hasImage:  Boolean(t.fileUrl),
      })),
  }))

  // Ticket/voucher files to send as media right after the text. fileUrl is a
  // relative /api/uploads/... path served publicly, so Meta can fetch it by link.
  const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
  const attachments = appUrl
    ? dayTickets
        .filter(t => t.fileUrl)
        .map(t => ({
          url:     t.fileUrl!.startsWith('http') ? t.fileUrl! : `${appUrl}${t.fileUrl}`,
          kind:    (t.fileType === 'image' ? 'image' : 'document') as 'image' | 'document',
          caption: `🎫 ${ticketLabel(t)}${t.reference ? ` · Ref ${t.reference}` : ''} — ${b.bookingRef}`,
          filename: t.fileName ?? `${ticketLabel(t)}.${t.fileType === 'image' ? 'jpg' : 'pdf'}`,
        }))
        .filter(a => /^https:\/\//i.test(a.url))
    : []

  const msg = formatCustomerDailyBriefingMessage({
    bookingRef:  b.bookingRef,
    leadName:    b.passengers[0]?.name ?? null,
    leadPhone:   b.contactWhatsapp || b.contactPhone || null,
    date:        new Date(`${targetDateStr}T00:00:00.000Z`),
    isArrival,
    isDeparting,
    paxAdults:   b.paxAdults,
    paxChildren: b.paxChildren,
    paxInfants:  b.paxInfants,
    managerContact: b.chauffeurContact?.trim() || null,
    stayingAtHotel: stayingAt ? `${stayingAt.hotel} (${stayingAt.city})` : null,
    checkIns:  checkIns.map(a => ({ hotel: a.hotel, city: a.city })),
    checkOuts: checkOuts.map(a => ({ hotel: a.hotel, city: a.city })),
    flights: flights.map(f => ({
      flightNo: f.flightNo, fromApt: f.fromApt, toApt: f.toApt,
      depTime: f.depTime, arrTime: f.arrTime, airline: f.airline,
    })),
    movements,
    attachmentCount: attachments.length,
  })

  const ok = await sendWhatsAppText(phone, msg, b.passengers[0]?.name ?? undefined)
  if (!ok) return { ok: false, reason: 'WhatsApp send failed', message: msg }

  await prisma.whatsAppMessage.create({
    data: {
      bookingRef: b.bookingRef,
      phone:      normalisePhone(phone),
      direction:  'outbound',
      body:       msg,
      status:     'sent',
      senderName: `${TAG_DAILY_BRIEFING} ${b.passengers[0]?.name ?? 'Guest'}`,
    },
  })

  // Best-effort: send each ticket/voucher file as a photo/document. A media
  // failure never fails the briefing — the text (with ticket refs) is already out.
  for (const att of attachments) {
    try {
      await sendWhatsAppMedia(phone, att.url, att.kind, {
        caption:  att.caption,
        filename: att.filename,
      })
    } catch (err) {
      console.error(`[CustomerBriefing] media send failed for ${b.bookingRef}:`, err)
    }
  }

  return { ok: true, message: msg }
}

export async function runCustomerDailyBriefing(): Promise<AutomationRunResult> {
  const result: AutomationRunResult = { sent: 0, skipped: 0, errors: [] }

  if (!(await settingEnabled(SETTING_DAILY_BRIEFING))) {
    console.log('[CustomerBriefing] Disabled via settings')
    return result
  }

  const tomorrowStr = localDateStr(1)
  const { start: dayStart, end: dayEnd } = dayBounds(tomorrowStr)

  console.log(`[CustomerBriefing] Running for tomorrow = ${tomorrowStr}`)

  // Bookings whose trip covers tomorrow, with a reachable WhatsApp/phone contact
  const candidates = await prisma.booking.findMany({
    where: {
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      arrivalDate:   { lte: dayEnd },
      departureDate: { gte: dayStart },
      OR: [
        { contactWhatsapp: { not: null } },
        { contactPhone:    { not: null } },
      ],
    },
    select: { bookingRef: true },
  })

  console.log(`[CustomerBriefing] ${candidates.length} active bookings with contact info`)

  for (const { bookingRef } of candidates) {
    try {
      const r = await sendDailyBriefingForBooking(bookingRef, tomorrowStr)
      if (r.ok) { result.sent++; console.log(`[CustomerBriefing] ✅ ${bookingRef}`) }
      else result.skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${bookingRef}: ${msg}`)
      console.error(`[CustomerBriefing] ❌ ${bookingRef}:`, msg)
    }
  }

  console.log(`[CustomerBriefing] Done — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors.length}`)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Feedback request — departure-day 6pm invite to the public feedback form
// ─────────────────────────────────────────────────────────────────────────────

/** Send the post-departure feedback-form invite to one booking's guest. */
export async function sendFeedbackRequestForBooking(
  bookingRef: string,
  opts: { force?: boolean } = {},
): Promise<SingleSendResult> {
  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers:   { where: { isLead: true }, take: 1 },
      guestFeedback: { select: { id: true } },
    },
  })
  if (!b) return { ok: false, reason: 'Booking not found' }
  if (b.guestFeedback) return { ok: false, reason: 'Feedback already received' }

  const phone = b.contactWhatsapp || b.contactPhone
  if (!phone || !normalisePhone(phone)) {
    return { ok: false, reason: 'No WhatsApp/phone contact on this booking' }
  }

  if (!opts.force && await alreadySentToday(bookingRef, TAG_FEEDBACK_REQUEST)) {
    return { ok: false, reason: 'Already sent today' }
  }

  const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
  const formUrl = `${appUrl}/feedback/${encodeURIComponent(b.bookingRef)}?t=${feedbackLinkToken(b.bookingRef)}`
  const msg = formatFeedbackRequestMessage({
    bookingRef: b.bookingRef,
    leadName:   b.passengers[0]?.name ?? null,
    formUrl,
  })

  const ok = await sendWhatsAppText(phone, msg, b.passengers[0]?.name ?? undefined)
  if (!ok) return { ok: false, reason: 'WhatsApp send failed', message: msg }

  await prisma.whatsAppMessage.create({
    data: {
      bookingRef: b.bookingRef,
      phone:      normalisePhone(phone),
      direction:  'outbound',
      body:       msg,
      status:     'sent',
      senderName: `${TAG_FEEDBACK_REQUEST} ${b.passengers[0]?.name ?? 'Guest'}`,
    },
  })
  return { ok: true, message: msg }
}

export async function runCustomerFeedbackRequest(): Promise<AutomationRunResult> {
  const result: AutomationRunResult = { sent: 0, skipped: 0, errors: [] }

  if (!(await settingEnabled(SETTING_FEEDBACK_REQUEST))) {
    console.log('[FeedbackRequest] Disabled via settings')
    return result
  }

  const todayStr = localDateStr(0)
  const { start: dayStart, end: dayEnd } = dayBounds(todayStr)

  console.log(`[FeedbackRequest] Running for departure day = ${todayStr}`)

  const candidates = await prisma.booking.findMany({
    where: {
      status: { notIn: ['CANCELLED', 'DRAFT'] },
      departureDate: { gte: dayStart, lte: dayEnd },
      guestFeedback: null,
      OR: [
        { contactWhatsapp: { not: null } },
        { contactPhone:    { not: null } },
      ],
    },
    select: { bookingRef: true },
  })

  console.log(`[FeedbackRequest] ${candidates.length} departing bookings without feedback`)

  for (const { bookingRef } of candidates) {
    try {
      const r = await sendFeedbackRequestForBooking(bookingRef)
      if (r.ok) { result.sent++; console.log(`[FeedbackRequest] ✅ ${bookingRef}`) }
      else result.skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${bookingRef}: ${msg}`)
      console.error(`[FeedbackRequest] ❌ ${bookingRef}:`, msg)
    }
  }

  console.log(`[FeedbackRequest] Done — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors.length}`)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// In-process scheduler entry — checked every minute, fires once daily at the
// configured local hour (same pattern as auto-booking-create.ts)
// ─────────────────────────────────────────────────────────────────────────────

const SEND_HOUR = Number(process.env.CUSTOMER_MSG_SEND_HOUR ?? '18')
const SETTING_LAST_RUN_DATE = 'customer_whatsapp_last_run_date'

let _lastFiredDate = ''

export async function maybeRunCustomerMessaging(): Promise<void> {
  try {
    const localMs = Date.now() + TZ_OFFSET_MS
    const local = new Date(localMs)
    const nowH = local.getUTCHours()
    const nowM = local.getUTCMinutes()
    const today = localDateStr(0)

    if (nowH !== SEND_HOUR || nowM > 4) return
    if (_lastFiredDate === today) return

    const lastRunRow = await prisma.systemSetting.findUnique({ where: { key: SETTING_LAST_RUN_DATE } })
    if (lastRunRow?.value === today) {
      _lastFiredDate = today
      return
    }

    _lastFiredDate = today
    await prisma.systemSetting.upsert({
      where:  { key: SETTING_LAST_RUN_DATE },
      update: { value: today },
      create: { key: SETTING_LAST_RUN_DATE, value: today },
    })

    console.log(`[CustomerMessaging] Daily trigger at local ${SEND_HOUR}:00 (${today})`)
    void runCustomerDailyBriefing().catch(err => console.error('[CustomerMessaging] briefing error:', err))
    void runCustomerFeedbackRequest().catch(err => console.error('[CustomerMessaging] feedback error:', err))
  } catch (err) {
    console.error('[CustomerMessaging] maybeRunCustomerMessaging error:', err)
  }
}
