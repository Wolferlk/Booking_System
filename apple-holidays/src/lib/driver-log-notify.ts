/**
 * Driver Log (Sri Lanka) — WhatsApp delivery + auto-send job.
 *
 * `sendDriverLog()` builds the advance sheet, renders it to a PDF, drops it in
 * the public uploads folder (so Meta can fetch it by link), and sends the driver
 * a text summary + the PDF document. It also logs to WhatsAppMessage and stamps
 * `waSentAt` on the saved snapshot so re-sends are traceable and de-duplicated.
 *
 * `runDriverLogAutoSend()` is the scheduler entry point — invoked from the
 * always-on Node process (see driver-log-scheduler.ts), NOT Vercel/OS cron. When
 * the global auto-send switch is on it sends the sheet to the driver of every
 * Sri Lanka booking whose tour starts tomorrow, the evening before (default 6pm
 * Asia/Colombo). A booking is skipped if its saved snapshot opts out
 * (`autoSend === false`) or was already sent for this tour.
 */
import path from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { prisma } from '@/lib/prisma'
import { sendWhatsAppText, sendWhatsAppMedia, normalisePhone } from '@/lib/whatsapp'
import { generateDriverLogPdf } from '@/lib/generate-driver-log-pdf'
import { buildDriverLogView, readSnapshot, saveSnapshot, type DriverLogView } from '@/lib/driver-log-server'
import { SETTING_AUTO_SEND, type DriverLogSnapshot } from '@/lib/driver-log'

function money(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n)
}

function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    'http://localhost:3000'
  ).replace(/\/+$/, '')
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
    `🎟️ *Tour Advance* (${c.tourPct}% of ${money(c.tourTotal, cur)})`,
    `   → ${money(c.tourAdvance, cur)}`,
    `⛽ *Fuel Advance* (${c.fuelPct}% of ${money(c.fuelTotal, cur)})`,
    `   → ${money(c.fuelAdvance, cur)}`,
    '',
    `💰 *Total Advance: ${money(c.grandAdvance, cur)}*`,
    '',
    'Full breakdown is in the attached PDF. Please confirm receipt.',
  ]
  return lines.filter(l => l !== null).join('\n')
}

export interface SendResult {
  ok: boolean
  reason?: string
  phone?: string
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

  let filename = ''
  let fileUrl = ''
  try {
    const pdf = await generateDriverLogPdf(view)
    filename = pdf.filename
    const dir = path.join(process.cwd(), 'public', 'uploads', 'driver-logs')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), pdf.buffer)
    fileUrl = `${publicBaseUrl()}/uploads/driver-logs/${encodeURIComponent(filename)}`
  } catch (err) {
    return { ok: false, reason: `pdf failed: ${err instanceof Error ? err.message : err}`, phone }
  }

  const message = formatDriverLogMessage(view)
  const textOk = await sendWhatsAppText(phone, message, view.driverName ?? undefined)
  // Media send only works over Meta (link-based); best-effort.
  const docOk = await sendWhatsAppMedia(phone, fileUrl, 'document', {
    filename,
    caption: `Driver Advance Sheet — ${view.bookingRef}`,
  })

  if (!textOk && !docOk) return { ok: false, reason: 'whatsapp send failed', phone }

  // Log + stamp snapshot so re-sends are visible and de-duplicated.
  const now = new Date().toISOString()
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef,
      phone,
      direction:  'outbound',
      body:       message,
      status:     'sent',
      senderName: opts.senderTag ?? `[DRIVER-LOG] ${view.driverName ?? phone}`,
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

  return { ok: true, phone }
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
