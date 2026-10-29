/**
 * Customer WhatsApp automation:
 *  1. Daily trip briefing to guests mid-trip, at a configurable time (default
 *     18:00 in the guest's country) with an optional per-booking override.
 *     A time before noon sends that day's plan; noon or later sends tomorrow's.
 *  2. Departure-day feedback-form invite (link to the public /feedback/[ref] page)
 *
 * Both are triggered from cron routes (/api/cron/customer-daily-briefing,
 * /api/cron/customer-feedback-request) for GCP/Vercel schedulers, plus the
 * in-process scheduler fallback in cron-scheduler.ts.
 */
import { prisma } from '@/lib/prisma'
import {
  sendWhatsAppText,
  sendWhatsAppMedia,
  normalisePhone,
  formatCustomerDailyBriefingMessage,
  formatFeedbackRequestMessage,
  briefingDayLabel,
  isWithin24hWindow,
} from '@/lib/whatsapp'
import { sendGuestMessageTemplate, GuestTemplateUnavailableError } from '@/lib/guest-message-template'
import type { OperationCountry, Prisma } from '@prisma/client'
import { SETTING_SUPER_PARTNERS, parseSuperPartners, isSuperPartner } from '@/lib/super-partners'
import { engagedB2cRefs } from '@/lib/b2c-guest-engage'
import { B2C_AGENT_NAME } from '@/lib/booking-source'

// Same fixed-offset convention as /api/cron/driver-notify (UTC+7 Vietnam default)
const TZ_OFFSET_HOURS = Number(process.env.CUSTOMER_MSG_TZ_OFFSET_HOURS ?? '7')
const TZ_OFFSET_MS = TZ_OFFSET_HOURS * 60 * 60 * 1000

export const SETTING_DAILY_BRIEFING = 'auto_whatsapp_daily_briefing_enabled'
export const SETTING_FEEDBACK_REQUEST = 'auto_whatsapp_feedback_request_enabled'

/** Global default send time for the daily briefing, "HH:MM" in the guest's country. */
export const SETTING_DAILY_BRIEFING_TIME = 'auto_whatsapp_daily_briefing_time'
/** Per-booking override: key = prefix + bookingRef, value = "HH:MM" or "OFF". */
export const SETTING_BRIEFING_TIME_PREFIX = 'daily_briefing_time:'

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

/**
 * Bookings whose guests the automations may message. Aahaas B2C orders are
 * imported as DRAFT; the ones put on AI calls by `b2c-guest-engage.ts` (guest's
 * own WhatsApp, not cancelled in the store) count as live too.
 */
async function liveBookingWhere(): Promise<Prisma.BookingWhereInput> {
  const live: Prisma.BookingWhereInput = { status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION', 'DRAFT'] } }
  const engaged = await engagedB2cRefs().catch((err) => {
    console.error('[CustomerWhatsApp] B2C guest list unavailable (non-fatal):', err)
    return [] as string[]
  })
  if (engaged.length === 0) return live
  return { OR: [live, { status: 'DRAFT', agent: B2C_AGENT_NAME, bookingRef: { in: engaged } }] }
}

async function settingEnabled(key: string): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  // Default ON when the setting row doesn't exist yet
  return row?.value !== 'false'
}

// ─────────────────────────────────────────────────────────────────────────────
// Send-time settings
// ─────────────────────────────────────────────────────────────────────────────

const ENV_DEFAULT_TIME =
  `${String(Number(process.env.CUSTOMER_MSG_SEND_HOUR ?? '18')).padStart(2, '0')}:` +
  `${String(Number(process.env.CUSTOMER_MSG_SEND_MINUTE ?? '0')).padStart(2, '0')}`

/** "HH:MM" (24h) → normalised "HH:MM", or null if it isn't a valid time. */
export function normaliseBriefingTime(v: string | null | undefined): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** A send time before noon briefs that same day; noon or later briefs tomorrow. */
export function briefingTargetsSameDay(time: string): boolean {
  return timeToMinutes(time) < 12 * 60
}

export async function getDefaultBriefingTime(): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_DAILY_BRIEFING_TIME } })
  return normaliseBriefingTime(row?.value) ?? ENV_DEFAULT_TIME
}

/** The booking's own override: "HH:MM", "OFF" (no auto-send), or null (use the default). */
export async function getBookingBriefingTime(bookingRef: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_BRIEFING_TIME_PREFIX + bookingRef } })
  if (!row) return null
  return row.value === 'OFF' ? 'OFF' : normaliseBriefingTime(row.value)
}

/** Set ("HH:MM" / "OFF") or clear (null) a booking's send-time override. */
export async function setBookingBriefingTime(bookingRef: string, value: string | null): Promise<void> {
  const key = SETTING_BRIEFING_TIME_PREFIX + bookingRef
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } })
    return
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

/** Agents whose guests get the AppleHolidays-branded daily plan (defaults to MMT / MakeMyTrip). */
export async function getSuperPartners(): Promise<string[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_SUPER_PARTNERS } })
  return parseSuperPartners(row?.value)
}

/** The guest's timezone — the send time means local time where the trip is. */
export function briefingTimezone(country: OperationCountry | string | null | undefined, bookingRef: string): string {
  const c = country ?? ''
  const ref = bookingRef.toUpperCase()
  if (c === 'SRILANKA' || ref.startsWith('IS')) return 'Asia/Colombo'
  if (c === 'SINGAPORE' || c === 'MALAYSIA' || c === 'SINGAPORE_MALAYSIA' ||
      ref.startsWith('SG') || ref.startsWith('MY')) return 'Asia/Singapore'
  return process.env.CUSTOMER_MSG_TZ || 'Asia/Ho_Chi_Minh'
}

/** Current local date (YYYY-MM-DD) and minutes-past-midnight in a timezone. */
function nowInTz(tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  }
}

function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10)
}

/**
 * True if a briefing for this trip day already went out. Keyed on the day the
 * briefing is *about* (its body carries the long date), not the day it was sent,
 * so moving a booking between an evening and a morning time never double-sends.
 */
async function alreadySentForDay(bookingRef: string, targetDateStr: string): Promise<boolean> {
  const existing = await prisma.whatsAppMessage.findFirst({
    where: {
      bookingRef,
      direction: 'outbound',
      senderName: { startsWith: TAG_DAILY_BRIEFING },
      createdAt: { gte: new Date(Date.now() - 4 * 86400000) },
      body: { contains: briefingDayLabel(`${targetDateStr}T00:00:00.000Z`) },
    },
    select: { id: true },
  })
  return Boolean(existing)
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

// The link tokens live in `feedback-link.ts` so the printed QR card can derive
// the same URL without importing this module. Re-exported here because callers
// have always found them at this address.
export { feedbackLinkToken, verifyFeedbackLinkToken } from './feedback-link'
import { feedbackLinkToken } from './feedback-link'

/**
 * Free-form text only reaches a guest inside their 24h window; outside it Meta
 * answers 200 and drops it. There the guest-message template carries the text
 * instead (lines joined with " · ", long plans split into parts). Until that
 * template is approved this is exactly the old free-form send.
 *
 * A later template part failing leaves the rest queued as `pending`, which the
 * guest's next reply flushes (flushPendingConfirmations).
 */
async function deliverToGuest(p: {
  phone: string
  text: string
  guestName: string | null
  bookingRef: string
  tag: string
}): Promise<{ ok: boolean; waMessageId: string | null; reason?: string }> {
  if (!(await isWithin24hWindow(p.phone))) {
    try {
      const sent = await sendGuestMessageTemplate({
        to: p.phone, guestName: p.guestName ?? 'Guest', bookingRef: p.bookingRef, text: p.text,
      })
      if (sent.unsent) {
        await prisma.whatsAppMessage.create({
          data: {
            bookingRef: p.bookingRef, phone: sent.phone, direction: 'outbound',
            body: sent.unsent, status: 'pending', senderName: p.tag,
          },
        })
      }
      return { ok: true, waMessageId: sent.sent[0]?.waMessageId ?? null }
    } catch (err) {
      if (!(err instanceof GuestTemplateUnavailableError)) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[CustomerWhatsApp] template send failed for ${p.bookingRef}:`, msg)
        return { ok: false, waMessageId: null, reason: `WhatsApp template send failed: ${msg.slice(0, 200)}` }
      }
      // Not approved yet — fall through to the free-form send, as before.
    }
  }
  const ok = await sendWhatsAppText(p.phone, p.text, p.guestName ?? undefined)
  return ok ? { ok, waMessageId: null } : { ok, waMessageId: null, reason: 'WhatsApp send failed' }
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
            include: { assignment: { include: { driver: true, guide: true, tourVendor: true } } },
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

  if (!opts.force && await alreadySentForDay(bookingRef, targetDateStr)) {
    return { ok: false, reason: 'Already sent for this day' }
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
    mealPlan:     item.mealPlan,
    serviceType:  item.serviceType,
    driverName:   item.assignment?.driverName ?? item.assignment?.driver?.name ?? null,
    driverPhone:  item.assignment?.driverPhone ?? item.assignment?.driver?.phone ?? null,
    vehicleType:  item.assignment?.vehicleType ?? null,
    vehiclePlate: item.assignment?.vehiclePlate ?? null,
    guideName:    item.assignment?.guideName ?? item.assignment?.guide?.name ?? null,
    guidePhone:   contactPhone(item.assignment?.guidePhone,
                    item.assignment?.guide?.whatsappPhone, item.assignment?.guide?.phone),
    tourVendorName:  item.assignment?.tourVendorName ?? item.assignment?.tourVendor?.name ?? null,
    tourVendorPhone: contactPhone(item.assignment?.tourVendorPhone,
                    item.assignment?.tourVendor?.whatsappPhone, item.assignment?.tourVendor?.phone),
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

  const branded = isSuperPartner(b.agent, await getSuperPartners())

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
    stayingAtHotel: stayingAt ? `${stayingAt.hotel} (${stayingAt.city})` : null,
    checkIns:  checkIns.map(a => ({ hotel: a.hotel, city: a.city })),
    checkOuts: checkOuts.map(a => ({ hotel: a.hotel, city: a.city })),
    flights: flights.map(f => ({
      flightNo: f.flightNo, fromApt: f.fromApt, toApt: f.toApt,
      depTime: f.depTime, arrTime: f.arrTime, airline: f.airline,
    })),
    movements,
    attachmentCount: attachments.length,
    branded,
  })

  const tag = `${TAG_DAILY_BRIEFING} ${b.passengers[0]?.name ?? 'Guest'}`
  const sent = await deliverToGuest({
    phone, text: msg, guestName: b.passengers[0]?.name ?? null, bookingRef: b.bookingRef, tag,
  })
  if (!sent.ok) return { ok: false, reason: sent.reason, message: msg }

  // Logged as the plan itself (not the template wording) — alreadySentForDay
  // and the booking's customer panel both read this body.
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef:  b.bookingRef,
      phone:       normalisePhone(phone),
      direction:   'outbound',
      body:        msg,
      waMessageId: sent.waMessageId,
      status:      'sent',
      senderName:  tag,
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

/** First real phone number among the candidates ("—" and blanks are placeholders). */
function contactPhone(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    const v = c?.trim()
    if (v && /\d/.test(v)) return v
  }
  return null
}

/** "Run now" — sends tomorrow's plan to every guest mid-trip, ignoring send times. */
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
      AND: [await liveBookingWhere()],
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

// Bookings already looked at for a trip day and found to have nothing to send
// (empty day, no number, send failure). Lets the 5-minute sweep skip them for
// the rest of this process instead of reloading the whole booking every tick.
const settledThisProcess = new Set<string>()

/**
 * The scheduled sweep — call every few minutes. Each booking is briefed once its
 * own send time (override, else the global default) has passed in the guest's
 * timezone, for today's plan (morning time) or tomorrow's (afternoon/evening).
 */
export async function runDueCustomerDailyBriefings(): Promise<AutomationRunResult> {
  const result: AutomationRunResult = { sent: 0, skipped: 0, errors: [] }
  if (!(await settingEnabled(SETTING_DAILY_BRIEFING))) return result

  const defaultTime = await getDefaultBriefingTime()
  const overrideRows = await prisma.systemSetting.findMany({
    where: { key: { startsWith: SETTING_BRIEFING_TIME_PREFIX } },
  })
  const overrides = new Map(overrideRows.map(r => [r.key.slice(SETTING_BRIEFING_TIME_PREFIX.length), r.value]))

  // Wide enough to cover "today" and "tomorrow" in every guest timezone.
  const utcToday = new Date().toISOString().slice(0, 10)
  const candidates = await prisma.booking.findMany({
    where: {
      AND: [await liveBookingWhere()],
      arrivalDate:   { lte: new Date(`${addDays(utcToday, 2)}T23:59:59.999Z`) },
      departureDate: { gte: new Date(`${addDays(utcToday, -1)}T00:00:00.000Z`) },
      OR: [
        { contactWhatsapp: { not: null } },
        { contactPhone:    { not: null } },
      ],
    },
    select: { bookingRef: true, operationCountry: true, arrivalDate: true, departureDate: true },
  })

  const due: { bookingRef: string; target: string }[] = []
  for (const b of candidates) {
    const override = overrides.get(b.bookingRef)
    if (override === 'OFF') continue
    const time = normaliseBriefingTime(override) ?? defaultTime
    const now = nowInTz(briefingTimezone(b.operationCountry, b.bookingRef))
    if (now.minutes < timeToMinutes(time)) continue

    const target = briefingTargetsSameDay(time) ? now.date : addDays(now.date, 1)
    const arr = b.arrivalDate.toISOString().slice(0, 10)
    const dep = b.departureDate.toISOString().slice(0, 10)
    if (target < arr || target > dep) continue
    if (settledThisProcess.has(`${b.bookingRef}|${target}`)) continue
    due.push({ bookingRef: b.bookingRef, target })
  }
  if (due.length === 0) return result

  // One query for everything already sent, instead of one per booking.
  const recent = await prisma.whatsAppMessage.findMany({
    where: {
      bookingRef: { in: due.map(d => d.bookingRef) },
      direction: 'outbound',
      senderName: { startsWith: TAG_DAILY_BRIEFING },
      createdAt: { gte: new Date(Date.now() - 4 * 86400000) },
    },
    select: { bookingRef: true, body: true },
  })

  for (const { bookingRef, target } of due) {
    const memoKey = `${bookingRef}|${target}`
    const label = briefingDayLabel(`${target}T00:00:00.000Z`)
    if (recent.some(m => m.bookingRef === bookingRef && m.body?.includes(label))) {
      settledThisProcess.add(memoKey)
      continue
    }
    try {
      const r = await sendDailyBriefingForBooking(bookingRef, target)
      settledThisProcess.add(memoKey)
      if (r.ok) { result.sent++; console.log(`[CustomerBriefing] ✅ ${bookingRef} → ${target}`) }
      else result.skipped++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${bookingRef}: ${msg}`)
      console.error(`[CustomerBriefing] ❌ ${bookingRef}:`, msg)
    }
  }

  if (result.sent || result.errors.length) {
    console.log(`[CustomerBriefing] Due sweep — sent: ${result.sent}, skipped: ${result.skipped}, errors: ${result.errors.length}`)
  }
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

  const tag = `${TAG_FEEDBACK_REQUEST} ${b.passengers[0]?.name ?? 'Guest'}`
  const sent = await deliverToGuest({
    phone, text: msg, guestName: b.passengers[0]?.name ?? null, bookingRef: b.bookingRef, tag,
  })
  if (!sent.ok) return { ok: false, reason: sent.reason, message: msg }

  await prisma.whatsAppMessage.create({
    data: {
      bookingRef:  b.bookingRef,
      phone:       normalisePhone(phone),
      direction:   'outbound',
      body:        msg,
      waMessageId: sent.waMessageId,
      status:      'sent',
      senderName:  tag,
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
      AND: [await liveBookingWhere()],
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
// The trigger lives in customer-whatsapp-scheduler.ts: a 5-minute node-cron tick
// that calls runDueCustomerDailyBriefings() and, once a day at the default time,
// runCustomerFeedbackRequest(). The HTTP cron routes remain as an external
// fallback; /api/cron/customer-daily-briefing must then be called every 5–15 min.
// ─────────────────────────────────────────────────────────────────────────────
