/**
 * Customer trip-portal WhatsApp automation.
 *
 * Every booking has a signed, login-free portal link (`/trip/<ref>?t=…`, see
 * portal-link.ts). This module pushes that link to the guest on WhatsApp twice:
 *
 *   1. WELCOME  — the day after the booking is created:
 *                 "your booking is confirmed, follow live updates on this link"
 *   2. REMINDER — 3 days before arrival:
 *                 "are you ready to travel? here are the latest updated details"
 *
 * Both go out as APPROVED Meta TEMPLATES, not free-form text: a guest who has
 * never messaged us is outside WhatsApp's 24h customer-service window, and only
 * a template delivers there (same reason the booking opener uses one).
 *
 * When the booking has no guest/tourist contact number at all, the link is sent
 * instead to the fallback operations numbers with a "please pass this to the
 * guest" template, so the message never silently disappears.
 *
 * Triggered by portal-link-whatsapp-scheduler.ts (node-cron, daily, boot
 * catch-up), by /api/cron/portal-link-whatsapp for an external/manual sweep,
 * and per-booking from the Customer WhatsApp panel on the booking page.
 */
import { prisma } from '@/lib/prisma'
import { normalisePhone, sendViaMetaTemplate } from '@/lib/whatsapp'
import { portalLinkPath } from '@/lib/portal-link'

// ── Config ───────────────────────────────────────────────────────────────────

/** Templates must exist and be APPROVED on the WABA — see /api/whatsapp/templates/bootstrap-portal. */
export const TEMPLATE_WELCOME  = process.env.WHATSAPP_PORTAL_WELCOME_TEMPLATE?.trim()  || 'apple_holidays_trip_portal_welcome'
export const TEMPLATE_REMINDER = process.env.WHATSAPP_PORTAL_REMINDER_TEMPLATE?.trim() || 'apple_holidays_trip_portal_reminder'
export const TEMPLATE_FORWARD  = process.env.WHATSAPP_PORTAL_FORWARD_TEMPLATE?.trim()  || 'apple_holidays_trip_portal_forward'
const TEMPLATE_LANG = process.env.WHATSAPP_PORTAL_TEMPLATE_LANG?.trim() || 'en'

/** Ops numbers that receive the link when the booking carries no guest contact. */
export const FALLBACK_NUMBERS: string[] = (
  process.env.WHATSAPP_PORTAL_FALLBACK_NUMBERS?.trim() ||
  '94701972263,94755303411,919585222335'
)
  .split(',')
  .map(n => normalisePhone(n))
  .filter(Boolean)

/** Days after booking creation the welcome goes out (1 = the next day). */
const WELCOME_DAYS_AFTER   = Number(process.env.WHATSAPP_PORTAL_WELCOME_DAYS_AFTER   ?? '1')
/** Days before arrival the "ready to travel" reminder goes out. */
const REMINDER_DAYS_BEFORE = Number(process.env.WHATSAPP_PORTAL_REMINDER_DAYS_BEFORE ?? '3')

/** Same fixed-offset convention the other customer automations use. */
const TZ_OFFSET_MS = Number(process.env.CUSTOMER_MSG_TZ_OFFSET_HOURS ?? '7') * 60 * 60 * 1000

export const SETTING_PORTAL_WELCOME  = 'auto_whatsapp_portal_welcome_enabled'
export const SETTING_PORTAL_REMINDER = 'auto_whatsapp_portal_reminder_enabled'

export const TAG_PORTAL_WELCOME  = '[PORTAL-WELCOME]'
export const TAG_PORTAL_REMINDER = '[PORTAL-REMINDER]'

export type PortalStage = 'welcome' | 'reminder'

const STAGE = {
  welcome:  { tag: TAG_PORTAL_WELCOME,  template: TEMPLATE_WELCOME,  setting: SETTING_PORTAL_WELCOME,  label: 'Welcome' },
  reminder: { tag: TAG_PORTAL_REMINDER, template: TEMPLATE_REMINDER, setting: SETTING_PORTAL_REMINDER, label: 'Ready-to-travel' },
} as const

const SKIP_STATUSES = ['CANCELLED', 'PENDING_CANCELLATION', 'DRAFT'] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

function localDateStr(daysAhead = 0): string {
  return new Date(Date.now() + TZ_OFFSET_MS + daysAhead * 86400000).toISOString().slice(0, 10)
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

/** Absolute, shareable portal URL for a booking. */
export function portalLinkUrl(bookingRef: string): string {
  const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? 'https://ops.aahaas.com').replace(/\/$/, '')
  return `${appUrl}${portalLinkPath(bookingRef)}`
}

/**
 * Has this stage already gone out for this booking? Unlike the daily briefing,
 * these are once-per-booking messages, so the dedupe is "ever sent", not "today".
 */
async function alreadySent(bookingRef: string, tag: string): Promise<Date | null> {
  const existing = await prisma.whatsAppMessage.findFirst({
    where: {
      bookingRef,
      direction:  'outbound',
      senderName: { startsWith: tag },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  return existing?.createdAt ?? null
}

/** When was each portal stage last sent for this booking? (for the UI panel) */
export async function portalSendStatus(bookingRef: string): Promise<{
  welcomeSentAt: string | null
  reminderSentAt: string | null
}> {
  const [w, r] = await Promise.all([
    alreadySent(bookingRef, TAG_PORTAL_WELCOME),
    alreadySent(bookingRef, TAG_PORTAL_REMINDER),
  ])
  return {
    welcomeSentAt:  w?.toISOString() ?? null,
    reminderSentAt: r?.toISOString() ?? null,
  }
}

async function logSend(params: {
  bookingRef: string
  phone: string
  tag: string
  body: string
  senderLabel: string
  result: unknown
}) {
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef:  params.bookingRef,
      phone:       params.phone,
      direction:   'outbound',
      body:        params.body,
      waMessageId: (params.result as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
      status:      'sent',
      senderName:  `${params.tag} ${params.senderLabel}`,
    },
  })
}

// ── Single-booking send ──────────────────────────────────────────────────────

export interface PortalSendResult {
  ok: boolean
  reason?: string
  /** Numbers the template actually reached. */
  sentTo?: string[]
  /** True when the guest had no number and the ops fallback numbers were used. */
  usedFallback?: boolean
  link?: string
}

/**
 * Send the trip-portal link for one booking at the given stage.
 *
 * opts.force — bypass the "already sent" dedupe (manual resend from the panel)
 * opts.to    — override the destination number (manual send to a number the
 *              staff member types in, e.g. a second traveller)
 */
export async function sendPortalLinkForBooking(
  bookingRef: string,
  stage: PortalStage,
  opts: { force?: boolean; to?: string } = {},
): Promise<PortalSendResult> {
  const cfg = STAGE[stage]

  const b = await prisma.booking.findUnique({
    where: { bookingRef },
    include: { passengers: { where: { isLead: true }, take: 1 } },
  })
  if (!b) return { ok: false, reason: 'Booking not found' }
  if ((SKIP_STATUSES as readonly string[]).includes(b.status)) {
    return { ok: false, reason: `Booking is ${b.status}` }
  }

  if (!opts.force && await alreadySent(bookingRef, cfg.tag)) {
    return { ok: false, reason: `${cfg.label} link already sent for this booking` }
  }

  const link      = portalLinkUrl(b.bookingRef)
  const leadName  = b.passengers[0]?.name ?? null
  const firstName = (leadName ?? '').trim().split(/\s+/)[0] || 'there'

  const override   = opts.to ? normalisePhone(opts.to) : ''
  const guestPhone = override || normalisePhone(b.contactWhatsapp || b.contactPhone || '')

  // ── Guest reachable: send the stage template straight to them ──────────────
  if (guestPhone) {
    try {
      const result = await sendViaMetaTemplate({
        to:           guestPhone,
        templateName: cfg.template,
        lang:         TEMPLATE_LANG,
        bodyParams:   [firstName, b.bookingRef, link],
      })
      if (!result) {
        return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured on this server' }
      }
      await logSend({
        bookingRef:  b.bookingRef,
        phone:       guestPhone,
        tag:         cfg.tag,
        body:        `[${cfg.label} portal link] Sent ${link} to ${firstName} (${guestPhone}) via template ${cfg.template}.`,
        senderLabel: leadName ?? 'Guest',
        result:      result.template,
      })
      return { ok: true, sentTo: [guestPhone], usedFallback: false, link }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  // ── No guest/tourist number: ask the ops numbers to pass the link on ───────
  if (!FALLBACK_NUMBERS.length) {
    return { ok: false, reason: 'No guest contact number on this booking, and no fallback numbers configured' }
  }

  const sentTo: string[] = []
  const errors: string[] = []
  for (const number of FALLBACK_NUMBERS) {
    try {
      const result = await sendViaMetaTemplate({
        to:           number,
        templateName: TEMPLATE_FORWARD,
        lang:         TEMPLATE_LANG,
        bodyParams:   [b.bookingRef, link],
      })
      if (!result) {
        return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured on this server' }
      }
      sentTo.push(number)
      await logSend({
        bookingRef:  b.bookingRef,
        phone:       number,
        tag:         cfg.tag,
        body:        `[${cfg.label} portal link — NO GUEST NUMBER] Asked ${number} to forward ${link} to the guest.`,
        senderLabel: 'Ops fallback',
        result:      result.template,
      })
    } catch (err) {
      errors.push(`${number}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!sentTo.length) {
    return { ok: false, reason: `Guest number missing and every fallback send failed — ${errors.join('; ')}` }
  }
  return { ok: true, sentTo, usedFallback: true, link }
}

// ── Daily sweeps ─────────────────────────────────────────────────────────────

export interface PortalRunResult {
  stage: PortalStage
  targetDate: string
  sent: number
  skipped: number
  fallback: number
  errors: string[]
}

async function runStage(
  stage: PortalStage,
  candidates: { bookingRef: string }[],
  targetDate: string,
): Promise<PortalRunResult> {
  const result: PortalRunResult = { stage, targetDate, sent: 0, skipped: 0, fallback: 0, errors: [] }
  const cfg = STAGE[stage]

  for (const { bookingRef } of candidates) {
    try {
      const r = await sendPortalLinkForBooking(bookingRef, stage)
      if (r.ok) {
        result.sent++
        if (r.usedFallback) result.fallback++
        console.log(`[PortalLink:${stage}] ✅ ${bookingRef} → ${r.sentTo?.join(', ')}${r.usedFallback ? ' (fallback)' : ''}`)
      } else {
        result.skipped++
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${bookingRef}: ${msg}`)
      console.error(`[PortalLink:${stage}] ❌ ${bookingRef}:`, msg)
    }
  }

  console.log(`[PortalLink:${stage}] ${cfg.label} done — sent: ${result.sent} (fallback ${result.fallback}), skipped: ${result.skipped}, errors: ${result.errors.length}`)
  return result
}

/** Welcome sweep — bookings created WELCOME_DAYS_AFTER days ago whose trip is still ahead. */
export async function runPortalWelcome(): Promise<PortalRunResult> {
  const targetDate = localDateStr(-WELCOME_DAYS_AFTER)

  if (!(await settingEnabled(SETTING_PORTAL_WELCOME))) {
    console.log('[PortalLink:welcome] Disabled via settings')
    return { stage: 'welcome', targetDate, sent: 0, skipped: 0, fallback: 0, errors: [] }
  }

  const { start, end } = dayBounds(targetDate)
  console.log(`[PortalLink:welcome] Running for bookings created on ${targetDate}`)

  const candidates = await prisma.booking.findMany({
    where: {
      status:        { notIn: [...SKIP_STATUSES] },
      createdAt:     { gte: start, lte: end },
      departureDate: { gte: new Date() },   // trip hasn't already finished
    },
    select: { bookingRef: true },
  })
  console.log(`[PortalLink:welcome] ${candidates.length} candidate booking(s)`)

  return runStage('welcome', candidates, targetDate)
}

/** Reminder sweep — bookings arriving in exactly REMINDER_DAYS_BEFORE days. */
export async function runPortalReminder(): Promise<PortalRunResult> {
  const targetDate = localDateStr(REMINDER_DAYS_BEFORE)

  if (!(await settingEnabled(SETTING_PORTAL_REMINDER))) {
    console.log('[PortalLink:reminder] Disabled via settings')
    return { stage: 'reminder', targetDate, sent: 0, skipped: 0, fallback: 0, errors: [] }
  }

  const { start, end } = dayBounds(targetDate)
  console.log(`[PortalLink:reminder] Running for arrivals on ${targetDate}`)

  const candidates = await prisma.booking.findMany({
    where: {
      status:      { notIn: [...SKIP_STATUSES] },
      arrivalDate: { gte: start, lte: end },
    },
    select: { bookingRef: true },
  })
  console.log(`[PortalLink:reminder] ${candidates.length} candidate booking(s)`)

  return runStage('reminder', candidates, targetDate)
}
