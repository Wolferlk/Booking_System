/**
 * Driver assignment WhatsApp automation.
 *
 * When a driver is allocated to a movement (the "Assign Driver" dialog on the
 * movement chart, or a whole-chart Save), the driver is messaged automatically
 * with the booking details.
 *
 * Delivery goes through an APPROVED Meta TEMPLATE rather than free-form text:
 * a driver who has not messaged us in the last 24 hours is outside WhatsApp's
 * customer-service window, and only a template delivers there. Free-form text
 * to such a number is accepted by our code path but silently dropped by Meta —
 * which is exactly the case for most drivers, who never reply to the ops number.
 *
 * A template body is fixed at approval time, so the per-movement detail is
 * flattened into the seven parameters below. When the driver *is* inside the
 * 24h window and the assignment spans several movements (more than a template
 * line can carry), the detailed free-form briefing is sent as a follow-up.
 *
 * Templates must exist and be APPROVED on the WABA — register them in one call
 * via POST /api/whatsapp/templates/bootstrap-driver.
 *
 * Callers:
 *   - PUT  /api/bookings/[ref]/agenda  — single movement assigned/removed
 *   - POST /api/bookings/[ref]/agenda  — whole chart saved
 */
import { prisma } from '@/lib/prisma'
import {
  normalisePhone,
  sendViaMetaTemplate,
  sendWhatsAppText,
  isWithin24hWindow,
  formatDriverBriefingMessage,
} from '@/lib/whatsapp'

// ── Config ───────────────────────────────────────────────────────────────────

export const TEMPLATE_DRIVER_ASSIGN =
  process.env.WHATSAPP_DRIVER_ASSIGN_TEMPLATE?.trim() || 'apple_holidays_driver_assignment'
export const TEMPLATE_DRIVER_CANCEL =
  process.env.WHATSAPP_DRIVER_CANCEL_TEMPLATE?.trim() || 'apple_holidays_driver_assignment_cancelled'
export const DRIVER_TEMPLATE_LANG =
  process.env.WHATSAPP_DRIVER_TEMPLATE_LANG?.trim() || 'en'

/** Set to 'false' to stop all automatic driver assignment messages. Default ON. */
export const SETTING_DRIVER_ASSIGN = 'auto_whatsapp_driver_assignment_enabled'

/**
 * Log tags. Both start with `[DRIVER` so the existing whole-chart reconciliation
 * (which reads the message log to decide who is currently briefed) keeps working
 * unchanged, and a driver briefed from the dialog is not briefed twice on Save.
 */
export const DRIVER_TAG = '[DRIVER]'
export const CANCEL_TAG = '[DRIVER-CANCEL]'

/**
 * The exact approved body of TEMPLATE_DRIVER_ASSIGN. Kept here so the same text
 * can be rendered locally for the message log and the inbox preview — what the
 * driver sees is what staff see. Must stay in sync with bootstrap-driver.
 */
export const DRIVER_ASSIGN_BODY =
  '🚗 *AppleHolidays — Driver Assignment*\n\n' +
  'Hi {{1}}, you have been assigned to booking {{2}}.\n\n' +
  '📅 Date: {{3}}\n' +
  '🛣 Route: {{4}}\n' +
  '👥 Guest: {{5}}\n' +
  '🚌 Vehicle: {{6}}\n' +
  '💰 Rate: {{7}}\n\n' +
  'Please reply CONFIRM to accept this assignment. Our operations team will share any further details here.'

/** The exact approved body of TEMPLATE_DRIVER_CANCEL. */
export const DRIVER_CANCEL_BODY =
  '⚠️ *AppleHolidays — Assignment Cancelled*\n\n' +
  'Hi {{1}}, your assignment for booking {{2}} has been cancelled and is no longer required.\n\n' +
  'Please disregard the earlier movement briefing for this booking. We are sorry for any inconvenience and will be in touch for future trips.'

// ── Types ────────────────────────────────────────────────────────────────────

export interface DriverMovement {
  date:        Date | string
  location:    string
  fromPoint:   string | null
  toPoint:     string | null
  details:     string | null
  meetingTime: string | null
}

export interface DriverAssignmentInput {
  bookingRef:    string
  driverName:    string
  driverPhone:   string
  paxAdults:     number
  paxChildren:   number
  leadPassenger: string | null
  vehicleType:   string | null
  vehiclePlate:  string | null
  driverRate?:   number | null
  rateCurrency?: string | null
  movements:     DriverMovement[]
}

export interface DriverSendResult {
  ok: boolean
  /** Why nothing was sent — 'no-phone', 'disabled', 'duplicate', or an error message. */
  reason?: string
  phone?: string
  /** The message text as the driver receives it (template body with params filled). */
  preview?: string
  /** True when the detailed multi-movement briefing was also sent free-form. */
  detailSent?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function automationEnabled(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_DRIVER_ASSIGN } })
  // Default ON when the setting row doesn't exist yet
  return row?.value !== 'false'
}

/**
 * Meta rejects template parameters containing newlines, tabs or runs of 4+
 * spaces, and caps the rendered body at 1024 characters — so every value is
 * flattened to a single tidy line and kept short.
 */
function param(value: string | null | undefined, fallback = '—'): string {
  const clean = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!clean) return fallback
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean
}

/**
 * Movement dates are date-only values stored at UTC midnight, so they are
 * formatted in UTC — formatting in the server's local zone would shift a
 * booking a day backwards on any host west of Greenwich.
 */
function shortDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function dayMonth(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
}

function sortMovements(movements: DriverMovement[]): DriverMovement[] {
  return [...movements].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

/** "Tue, 30 Jun 2026 at 09:00" for one movement; "30 Jun – 05 Jul 2026 (4 movements)" for many. */
function dateParam(movements: DriverMovement[]): string {
  const sorted = sortMovements(movements)
  if (!sorted.length) return '—'
  if (sorted.length === 1) {
    const m = sorted[0]
    const long = new Date(m.date).toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
    })
    return m.meetingTime ? `${long} at ${m.meetingTime}` : long
  }
  const first = sorted[0], last = sorted[sorted.length - 1]
  return `${dayMonth(first.date)} – ${shortDate(last.date)} (${sorted.length} movements)`
}

/** "Trincomalee: Airport → Uppuveli Beach" for one; a " | "-joined digest for many. */
function routeParam(movements: DriverMovement[]): string {
  const sorted = sortMovements(movements)
  if (!sorted.length) return '—'

  const leg = (m: DriverMovement) => {
    const from = m.fromPoint ?? m.location
    const to   = m.toPoint
    return to ? `${from} → ${to}` : from
  }

  if (sorted.length === 1) {
    const m = sorted[0]
    const route = leg(m)
    return m.location && !route.startsWith(m.location) ? `${m.location}: ${route}` : route
  }
  return sorted.map(m => `${dayMonth(m.date)} ${leg(m)}`).join(' | ')
}

function guestParam(input: DriverAssignmentInput): string {
  const pax = input.paxChildren > 0
    ? `${input.paxAdults} Adult(s), ${input.paxChildren} Child(ren)`
    : `${input.paxAdults} Adult(s)`
  return input.leadPassenger ? `${input.leadPassenger} · ${pax}` : pax
}

function vehicleParam(input: DriverAssignmentInput): string {
  return [input.vehicleType, input.vehiclePlate].filter(Boolean).join(' · ') || 'TBC'
}

function rateParam(input: DriverAssignmentInput): string {
  return input.driverRate
    ? `${input.rateCurrency ?? 'USD'} ${Number(input.driverRate).toFixed(2)}`
    : 'As agreed'
}

/** The seven body parameters of TEMPLATE_DRIVER_ASSIGN, in order. */
export function driverAssignParams(input: DriverAssignmentInput): string[] {
  return [
    param(input.driverName, 'Driver'),
    param(input.bookingRef),
    param(dateParam(input.movements)),
    param(routeParam(input.movements)),
    param(guestParam(input)),
    param(vehicleParam(input)),
    param(rateParam(input)),
  ]
}

/** Fill {{1}}…{{n}} in a template body — used for the message log / inbox preview. */
export function renderTemplate(body: string, params: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n: string) => params[Number(n) - 1] ?? '')
}

/**
 * The most recent driver-assignment message already sent to this number for this
 * booking. Used to suppress an identical resend (a double-clicked Save, or a
 * chart save that didn't change the allocation) while still letting a genuinely
 * changed assignment — new movement, new vehicle, new rate — go out again.
 */
async function lastAssignmentBody(bookingRef: string, phone: string): Promise<string | null> {
  const last = await prisma.whatsAppMessage.findFirst({
    where: { bookingRef, phone, direction: 'outbound', senderName: { startsWith: DRIVER_TAG } },
    orderBy: { createdAt: 'desc' },
    select: { body: true },
  })
  return last?.body ?? null
}

async function logSend(params: {
  bookingRef: string
  phone: string
  tag: string
  body: string
  driverName: string
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
      senderName:  `${params.tag} ${params.driverName}`,
    },
  })
}

// ── Sends ────────────────────────────────────────────────────────────────────

/**
 * Notify a driver that they have been assigned to a booking.
 *
 * opts.force — bypass the "identical message already sent" suppression and the
 *              global automation switch (a staff member pressed Send explicitly)
 */
export async function sendDriverAssignment(
  input: DriverAssignmentInput,
  opts: { force?: boolean } = {},
): Promise<DriverSendResult> {
  const phone = normalisePhone(input.driverPhone ?? '')
  if (!phone) return { ok: false, reason: 'no-phone' }
  if (!input.movements.length) return { ok: false, reason: 'no-movements' }
  if (!opts.force && !(await automationEnabled())) return { ok: false, reason: 'disabled' }

  const params  = driverAssignParams(input)
  const preview = renderTemplate(DRIVER_ASSIGN_BODY, params)

  if (!opts.force && (await lastAssignmentBody(input.bookingRef, phone)) === preview) {
    return { ok: false, reason: 'duplicate', phone, preview }
  }

  const driverName = input.driverName || 'Driver'

  try {
    const result = await sendViaMetaTemplate({
      to:           phone,
      templateName: TEMPLATE_DRIVER_ASSIGN,
      lang:         DRIVER_TEMPLATE_LANG,
      bodyParams:   params,
    })
    if (!result) {
      return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured on this server' }
    }

    await logSend({
      bookingRef: input.bookingRef,
      phone,
      tag:        DRIVER_TAG,
      body:       preview,
      driverName,
      result:     result.template,
    })

    // A template line can only summarise several movements. When the driver has
    // messaged us recently the 24h window is open, so the full per-movement
    // breakdown can follow as free-form text.
    let detailSent = false
    if (input.movements.length > 1 && (await isWithin24hWindow(phone))) {
      const detail = formatDriverBriefingMessage({
        driverName,
        bookingRef:    input.bookingRef,
        paxAdults:     input.paxAdults,
        paxChildren:   input.paxChildren,
        leadPassenger: input.leadPassenger,
        vehicleType:   input.vehicleType,
        vehiclePlate:  input.vehiclePlate,
        driverRate:    input.driverRate,
        rateCurrency:  input.rateCurrency,
        movements:     input.movements,
      })
      detailSent = await sendWhatsAppText(phone, detail, driverName)
      if (detailSent) {
        await prisma.whatsAppMessage.create({
          data: {
            bookingRef: input.bookingRef,
            phone,
            direction:  'outbound',
            body:       detail,
            status:     'sent',
            senderName: `${DRIVER_TAG} ${driverName}`,
          },
        })
      }
    }

    console.log(`[DriverAssign] Template sent to ${driverName} (${phone}) for ${input.bookingRef} — ${input.movements.length} movement(s)`)
    return { ok: true, phone, preview, detailSent }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[DriverAssign] Send failed for ${phone} / ${input.bookingRef}:`, msg)
    return { ok: false, reason: msg, phone, preview }
  }
}

/** Notify a driver that their assignment on a booking has been withdrawn. */
export async function sendDriverCancellation(
  params: { bookingRef: string; driverName: string; driverPhone: string },
  opts: { force?: boolean } = {},
): Promise<DriverSendResult> {
  const phone = normalisePhone(params.driverPhone ?? '')
  if (!phone) return { ok: false, reason: 'no-phone' }
  if (!opts.force && !(await automationEnabled())) return { ok: false, reason: 'disabled' }

  const driverName = params.driverName || 'Driver'
  const bodyParams = [param(driverName, 'Driver'), param(params.bookingRef)]
  const preview    = renderTemplate(DRIVER_CANCEL_BODY, bodyParams)

  try {
    const result = await sendViaMetaTemplate({
      to:           phone,
      templateName: TEMPLATE_DRIVER_CANCEL,
      lang:         DRIVER_TEMPLATE_LANG,
      bodyParams,
    })
    if (!result) {
      return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured on this server' }
    }
    await logSend({ bookingRef: params.bookingRef, phone, tag: CANCEL_TAG, body: preview, driverName, result: result.template })
    console.log(`[DriverAssign] Cancellation sent to ${driverName} (${phone}) for ${params.bookingRef}`)
    return { ok: true, phone, preview }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[DriverAssign] Cancellation failed for ${phone} / ${params.bookingRef}:`, msg)
    return { ok: false, reason: msg, phone, preview }
  }
}

/**
 * Was this number last left in a "briefed" state for this booking? Reads the
 * durable message log rather than any in-memory state, so it survives restarts
 * and is shared by the dialog (PUT) and whole-chart (POST) paths.
 */
export async function driverBriefState(
  bookingRef: string,
): Promise<Map<string, { state: 'briefed' | 'cancelled'; name: string }>> {
  const logs = await prisma.whatsAppMessage.findMany({
    where: { bookingRef, direction: 'outbound', senderName: { startsWith: '[DRIVER' } },
    orderBy: { createdAt: 'asc' },
    select: { phone: true, senderName: true },
  })
  const out = new Map<string, { state: 'briefed' | 'cancelled'; name: string }>()
  for (const m of logs) {
    const p = normalisePhone(m.phone)
    const isCancel = m.senderName?.startsWith(CANCEL_TAG)
    const name = m.senderName?.replace(CANCEL_TAG, '').replace(DRIVER_TAG, '').trim()
    out.set(p, { state: isCancel ? 'cancelled' : 'briefed', name: name || out.get(p)?.name || 'Driver' })
  }
  return out
}
