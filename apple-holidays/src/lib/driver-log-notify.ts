/**
 * Driver Log (Sri Lanka) — WhatsApp delivery + auto-send job.
 *
 * `sendDriverLog()` builds the advance sheet, renders it to a PDF, uploads the
 * bytes straight to Meta's media store, and delivers it to the driver:
 *
 *   - Outside WhatsApp's 24h customer-service window (the normal case — drivers
 *     never message the ops number) the sheet goes out as an APPROVED TEMPLATE
 *     with the PDF in its DOCUMENT header. Free-form text/media to such a number
 *     is accepted by our code but silently dropped by Meta, which is what made
 *     "sent" sends never arrive.
 *   - Inside the window, the richer free-form summary + document is used.
 *
 * The PDF is also archived through the shared storage layer (S3, disk fallback);
 * that copy is a convenience, never a delivery dependency — the old code wrote it
 * to `public/uploads` and failed the whole send with EROFS on the serverless host.
 *
 * It logs to WhatsAppMessage and stamps `waSentAt` on the saved snapshot so
 * re-sends are traceable and de-duplicated.
 *
 * `runDriverLogAutoSend()` is the scheduler entry point — invoked from the
 * always-on Node process (see driver-log-scheduler.ts), NOT Vercel/OS cron. When
 * the global auto-send switch is on it sends the sheet to the driver of every
 * Sri Lanka booking whose tour starts tomorrow, the evening before (default 6pm
 * Asia/Colombo). A booking is skipped if its saved snapshot opts out
 * (`autoSend === false`) or was already sent for this tour.
 */
import { prisma } from '@/lib/prisma'
import {
  sendViaMetaApi, sendViaMetaTemplate, uploadMetaMedia,
  isWithin24hWindow, normalisePhone,
} from '@/lib/whatsapp'
import { putUpload } from '@/lib/storage'
import { generateDriverLogPdf, formatSheetMoney } from '@/lib/generate-driver-log-pdf'
import { buildDriverLogView, readSnapshot, saveSnapshot, type DriverLogView } from '@/lib/driver-log-server'
import { SETTING_AUTO_SEND, type DriverLogSnapshot } from '@/lib/driver-log'

/** Shared with the PDF/HTML renderers — tolerates non-ISO currency labels ("Rs."). */
const money = formatSheetMoney

// ── Template config ──────────────────────────────────────────────────────────

/**
 * Approved template carrying the advance sheet. Register it once via
 * POST /api/whatsapp/templates/bootstrap-driver (or WhatsApp Manager).
 */
export const TEMPLATE_DRIVER_ADVANCE =
  process.env.WHATSAPP_DRIVER_ADVANCE_TEMPLATE?.trim() || 'apple_holidays_driver_advance_sheet'
export const DRIVER_ADVANCE_TEMPLATE_LANG =
  process.env.WHATSAPP_DRIVER_TEMPLATE_LANG?.trim() || 'en'

/** The exact approved body — kept here so the message log shows what the driver sees. */
export const DRIVER_ADVANCE_BODY =
  '*AppleHolidays - Driver Advance Sheet*\n\n' +
  'Hi {{1}}, here is your advance sheet for booking {{2}}.\n\n' +
  'Tour start: {{3}}\n' +
  'Guest: {{4}}\n' +
  'Tour advance: {{5}}\n' +
  'Fuel advance: {{6}}\n' +
  'Total advance: {{7}}\n\n' +
  'The full breakdown is in the attached PDF. Please reply CONFIRM once you have received it.'

/** Render {{1}}, {{2}}… locally for the message log / previews. */
export function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_m, i) => params[Number(i) - 1] ?? '')
}

/**
 * The seven body parameters, in order. Meta rejects a parameter containing a
 * newline, tab or 4+ consecutive spaces, so each one is flattened.
 */
export function driverAdvanceParams(view: DriverLogView): string[] {
  const c = view.computation
  const cur = c.currency
  const clean = (s: string, fallback = '-') => {
    const out = s.replace(/[\n\r\t]+/g, ' ').replace(/ {4,}/g, ' ').trim()
    return out || fallback
  }
  const start = view.arrivalDate
    ? new Date(view.arrivalDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '-'
  return [
    clean(view.driverName ?? '', 'Driver'),
    clean(view.bookingRef),
    clean(start),
    clean(`${view.leadPassenger ?? '-'} (${view.paxAdults ?? 0}A/${view.paxChildren ?? 0}C)`),
    clean(`${money(c.tourAdvance, cur)} (${c.tourPct}%)`),
    clean(`${money(c.fuelAdvance, cur)} (${c.fuelPct}%)`),
    clean(money(c.grandAdvance, cur)),
  ]
}

/** Human-readable text summary that accompanies the PDF. */
export function formatDriverLogMessage(view: DriverLogView): string {
  const c = view.computation
  const cur = c.currency
  const start = view.arrivalDate
    ? new Date(view.arrivalDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
  const lines = [
    `*Driver Advance Sheet — ${view.bookingRef}*`,
    view.driverName ? `Driver: ${view.driverName}` : null,
    `Tour start: ${start}`,
    `Guest: ${view.leadPassenger ?? '—'} (${view.paxAdults ?? 0}A/${view.paxChildren ?? 0}C)`,
    '',
    `🎟️ *Tour Advance* (${c.tourPct}% of ${money(c.tourAdvanceBase, cur)})`,
    `   → ${money(c.tourAdvance, cur)}`,
    `⛽ *Fuel Advance* (${c.fuelPct}% of ${money(c.fuelTotal, cur)})`,
    `   → ${money(c.fuelAdvance, cur)}`,
    '',
    `💰 *Total Advance: ${money(c.grandAdvance, cur)}*`,
    `🧾 Rest Payment${c.excludedTotal > 0 ? ' (incl. excluded)' : ''}: ${money(c.restPayment, cur)}`,
    '',
    'Full breakdown is in the attached PDF. Please confirm receipt.',
  ]
  return lines.filter(l => l !== null).join('\n')
}

export interface SendResult {
  ok: boolean
  reason?: string
  phone?: string
  /** How it went out — a template (cold) or free-form (inside the 24h window). */
  channel?: 'template' | 'freeform'
}

/**
 * Send the Driver Advance Sheet to a driver over WhatsApp. Uses the snapshot /
 * allocation phone unless `phoneOverride` is given. Never throws.
 */
export async function sendDriverLog(
  bookingRef: string,
  opts: { phoneOverride?: string | null; senderTag?: string } = {},
): Promise<SendResult> {
  const view = await buildDriverLogView(bookingRef)
  if (!view) return { ok: false, reason: 'booking not found' }

  const phone = normalisePhone(opts.phoneOverride || view.driverPhone || '')
  if (!phone) return { ok: false, reason: 'no driver phone' }

  // 1. Render the sheet.
  let pdf: { buffer: Buffer; filename: string }
  try {
    pdf = await generateDriverLogPdf(view)
  } catch (err) {
    return { ok: false, reason: `pdf failed: ${err instanceof Error ? err.message : err}`, phone }
  }

  // Archive copy — handy for support, never a delivery dependency.
  await putUpload(`driver-logs/${pdf.filename}`, pdf.buffer, 'application/pdf').catch(err => {
    console.warn(`[DriverLog] archive copy failed for ${pdf.filename}:`, err instanceof Error ? err.message : err)
  })

  // 2. Upload the bytes to Meta once; the id serves both delivery paths.
  let mediaId: string
  try {
    mediaId = await uploadMetaMedia(pdf.buffer, pdf.filename)
  } catch (err) {
    return { ok: false, reason: `whatsapp media upload failed: ${err instanceof Error ? err.message : err}`, phone }
  }

  // 3. Deliver. Free-form only reaches a driver who messaged us in the last 24h;
  //    everyone else needs the approved template, PDF in its DOCUMENT header.
  const windowOpen = await isWithin24hWindow(phone).catch(() => false)
  const bodyParams = driverAdvanceParams(view)

  let message: string
  let channel: 'template' | 'freeform'
  let sendResult: unknown

  try {
    if (windowOpen) {
      message = formatDriverLogMessage(view)
      channel = 'freeform'
      const res = await sendViaMetaApi({
        to: phone,
        message,
        media: {
          buffer:   pdf.buffer,
          filename: pdf.filename,
          kind:     'document' as const,
          caption:  `Driver Advance Sheet — ${view.bookingRef}`,
        },
      })
      if (!res) return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured', phone }
      sendResult = res.text
    } else {
      message = renderTemplateBody(DRIVER_ADVANCE_BODY, bodyParams)
      channel = 'template'
      const res = await sendViaMetaTemplate({
        to:             phone,
        templateName:   TEMPLATE_DRIVER_ADVANCE,
        lang:           DRIVER_ADVANCE_TEMPLATE_LANG,
        bodyParams,
        headerDocument: { id: mediaId, filename: pdf.filename },
      })
      if (!res) return { ok: false, reason: 'WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured', phone }
      sendResult = res.template
    }
  } catch (err) {
    let reason = err instanceof Error ? err.message : String(err)
    // The commonest first-run failure: the template was never registered.
    if (/template name does not exist|132001|does not exist in .*locale/i.test(reason)) {
      reason =
        `WhatsApp template "${TEMPLATE_DRIVER_ADVANCE}" (${DRIVER_ADVANCE_TEMPLATE_LANG}) is not approved on this ` +
        `WhatsApp account — register it via POST /api/whatsapp/templates/bootstrap-driver, then retry. (${reason})`
    }
    console.error(`[DriverLog] send failed for ${phone} / ${bookingRef}:`, reason)
    return { ok: false, reason, phone }
  }

  // Log + stamp snapshot so re-sends are visible and de-duplicated.
  const now = new Date().toISOString()
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef,
      phone,
      direction:   'outbound',
      body:        message,
      waMessageId: (sendResult as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
      status:      'sent',
      senderName:  opts.senderTag ?? `[DRIVER-LOG] ${view.driverName ?? phone}`,
    },
  }).catch(() => {})

  const existing = await readSnapshot(bookingRef)
  const snap: DriverLogSnapshot = existing
    ? { ...existing, waSentAt: now }
    : {
        currency:    view.computation.currency,
        tourPct:     view.computation.tourPct,
        fuelPct:     view.computation.fuelPct,
        driverPhone: view.driverPhone,
        lines:       view.computation.lines,
        notes:       view.notes,
        autoSend:    view.autoSend,
        waSentAt:    now,
        updatedBy:   opts.senderTag ?? 'system',
        updatedAt:   now,
      }
  await saveSnapshot(bookingRef, snap).catch(() => {})

  console.log(`[DriverLog] ${channel} sent to ${view.driverName ?? phone} (${phone}) for ${bookingRef}`)
  return { ok: true, phone, channel }
}

// ── Auto-send job (called by the Node scheduler) ────────────────────────────

const TZ = process.env.DRIVER_LOG_TZ || 'Asia/Colombo'

/** Date (YYYY-MM-DD) for "tomorrow" evaluated in the Sri Lanka timezone. */
function tomorrowInTz(): string {
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
  const d = new Date(`${nowParts}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface AutoSendResult {
  ran: boolean
  reason?: string
  targetDate?: string
  sent: number
  skipped: number
  failed: number
}

/**
 * Send tomorrow's Driver Advance Sheets. Gated by the global auto-send switch.
 * Idempotent within a tour: a booking already sent (waSentAt within 20h) is
 * skipped, as is any booking whose snapshot opts out (autoSend === false).
 */
export async function runDriverLogAutoSend(): Promise<AutoSendResult> {
  const master = await prisma.systemSetting.findUnique({ where: { key: SETTING_AUTO_SEND } })
  if (master?.value !== 'true') {
    return { ran: false, reason: 'auto-send disabled', sent: 0, skipped: 0, failed: 0 }
  }

  const targetDate = tomorrowInTz()
  const dayStart = new Date(`${targetDate}T00:00:00.000Z`)
  const dayEnd   = new Date(`${targetDate}T23:59:59.999Z`)

  const bookings = await prisma.booking.findMany({
    where: {
      operationCountry: 'SRILANKA',
      arrivalDate: { gte: dayStart, lte: dayEnd },
      externalPnlLink: { isNot: null },
      slDriverAllocation: { driver: { isNot: null } },
    },
    select: { bookingRef: true },
  })

  console.log(`[DriverLogAutoSend] ${bookings.length} SL booking(s) starting ${targetDate}`)

  let sent = 0, skipped = 0, failed = 0
  const cutoff = Date.now() - 20 * 60 * 60 * 1000

  for (const { bookingRef } of bookings) {
    const snap = await readSnapshot(bookingRef)
    if (snap?.autoSend === false) { skipped++; continue }               // opted out
    if (snap?.waSentAt && new Date(snap.waSentAt).getTime() > cutoff) { skipped++; continue } // already sent

    const res = await sendDriverLog(bookingRef, { senderTag: '[DRIVER-LOG-AUTO]' })
    if (res.ok) { sent++; console.log(`[DriverLogAutoSend] ✅ ${bookingRef} → ${res.phone}`) }
    else        { failed++; console.warn(`[DriverLogAutoSend] ❌ ${bookingRef}: ${res.reason}`) }
  }

  console.log(`[DriverLogAutoSend] Done ${targetDate} — sent:${sent} skipped:${skipped} failed:${failed}`)
  return { ran: true, targetDate, sent, skipped, failed }
}
