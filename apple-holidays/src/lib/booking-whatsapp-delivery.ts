/**
 * Window-aware Tour Confirmation delivery.
 *
 * WhatsApp only delivers a free-form message + PDF inside the customer's 24h
 * service window (i.e. they messaged us in the last 24h). So a "Send Tour
 * Confirmation" click does one of two things:
 *
 *   • window OPEN  → deliver the confirmation (text + PDF) right now.
 *   • window CLOSED → send the approved opener template (which DOES deliver cold)
 *                     and QUEUE the confirmation as a `pending` row. When the
 *                     customer replies, the inbound webhook calls
 *                     flushPendingConfirmations() and the queued confirmation goes
 *                     out as normal free-form.
 *
 * The queue reuses the existing whatsapp_messages table (no migration): a pending
 * outbound row stores the message in `body` and the PDF type in `mediaType`
 * ('confirmation' | 'full' | null when no PDF).
 */

import { prisma } from '@/lib/prisma'
import { generateConfirmationPdf, generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { putUpload } from '@/lib/storage'
import { sendViaMetaApi, sendViaNotifyProxy, sendViaMetaTemplate, normalisePhone } from '@/lib/whatsapp'

export type PdfType = 'confirmation' | 'full'

const WINDOW_MS = 24 * 60 * 60 * 1000

const OPENER_TEMPLATE      = process.env.WHATSAPP_BOOKING_OPENER_TEMPLATE?.trim() || 'apple_holidays_booking_update'
const OPENER_TEMPLATE_LANG = process.env.WHATSAPP_BOOKING_OPENER_TEMPLATE_LANG?.trim() || 'en'

/** Booking relations needed to render the confirmation / full-details PDF. */
function bookingInclude(isFull: boolean) {
  return {
    passengers:        { orderBy: [{ isLead: 'desc' as const }, { name: 'asc' as const }] },
    flights:           { orderBy: { date: 'asc' as const } },
    accommodations:    { orderBy: { checkIn: 'asc' as const } },
    itineraryItems:    { orderBy: [{ dayNo: 'asc' as const }, { date: 'asc' as const }] },
    emergencyContacts: true,
    tourAgenda: {
      include: {
        items: {
          orderBy: [{ date: 'asc' as const }, { sortOrder: 'asc' as const }],
          include: { assignment: { include: { driver: { include: { vehicle: true } } } } },
        },
      },
    },
    ...(isFull ? { tickets: { orderBy: { createdAt: 'asc' as const } } } : {}),
  }
}

/**
 * True when the customer's 24h WhatsApp service window is open — i.e. we have an
 * INBOUND message from them within the last 24h. This is the only reliable signal
 * (Meta exposes no "is the window open?" API), and it depends on inbound webhooks
 * for this number reaching THIS app (n8n forwards them to /api/webhooks/whatsapp).
 */
export async function isWithin24hWindow(phone: string): Promise<boolean> {
  const p = normalisePhone(phone)
  if (!p) return false
  const lastInbound = await prisma.whatsAppMessage.findFirst({
    where:   { phone: p, direction: 'inbound', createdAt: { gte: new Date(Date.now() - WINDOW_MS) } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  })
  return Boolean(lastInbound)
}

/** Build the confirmation / full-details PDF for a booking. */
export async function buildBookingPdf(
  ref: string,
  pdfType: PdfType,
): Promise<{ buffer: Buffer; filename: string }> {
  const isFull  = pdfType === 'full'
  const booking = await prisma.booking.findUnique({
    where:   { bookingRef: ref },
    include: bookingInclude(isFull),
  })
  if (!booking) throw new Error(`Booking ${ref} not found for PDF attachment`)

  const buffer = isFull
    ? await generateFullDetailsPdf(booking)
    : await generateConfirmationPdf(booking)
  if (!buffer.length) throw new Error('Generated PDF is empty')

  const typeTag  = isFull ? 'FullDetails' : 'TourConfirmation'
  const filename = `AppleHolidays-${ref}-${typeTag}-${Date.now()}.pdf`
  return { buffer, filename }
}

export interface ConfirmationSend {
  ref:        string
  to:         string
  name:       string
  message:    string
  attachPdf:  boolean
  pdfType:    PdfType
  senderName: string
  /** Public base URL for the PDF link used by the notify-proxy fallback. */
  baseUrl:    string
}

/**
 * Deliver the confirmation NOW as free-form (Meta first, notify proxy fallback).
 * Caller must have confirmed the 24h window is open. Also used by the queue flush.
 */
export async function deliverConfirmationNow(p: ConfirmationSend): Promise<void> {
  const phone   = normalisePhone(p.to)
  const isFull  = p.pdfType === 'full'

  let pdf: { buffer: Buffer; filename: string } | undefined
  let fileUrl: string | undefined
  if (p.attachPdf) {
    pdf     = await buildBookingPdf(p.ref, p.pdfType)
    await putUpload(`whatsapp/${pdf.filename}`, pdf.buffer, 'application/pdf')
    fileUrl = `${p.baseUrl.replace(/\/+$/, '')}/api/uploads/whatsapp/${encodeURIComponent(pdf.filename)}`
  }

  const metaResult = await sendViaMetaApi({
    to: p.to,
    message: p.message,
    ...(pdf ? { media: { buffer: pdf.buffer, filename: pdf.filename, kind: 'document' as const, caption: isFull ? 'Full tour details & vouchers PDF' : 'Tour confirmation PDF' } } : {}),
  })

  let waMessageId: string | null = null
  if (metaResult) {
    waMessageId = (metaResult.text as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null
  } else {
    const proxyResult = await sendViaNotifyProxy({
      to: p.to, name: p.name, message: p.message,
      ...(pdf && fileUrl ? { files: [{ url: fileUrl, filename: pdf.filename, caption: isFull ? 'Full tour details & vouchers' : 'Tour confirmation' }] } : {}),
    })
    if (!proxyResult) throw new Error('No WhatsApp credentials configured')
  }

  await prisma.whatsAppMessage.create({
    data: { bookingRef: p.ref, phone, direction: 'outbound', body: p.message, waMessageId, status: 'sent', senderName: p.senderName },
  })
}

/**
 * Window closed: send the approved opener template (delivers cold) and QUEUE the
 * confirmation as a `pending` row. It is flushed by flushPendingConfirmations()
 * the moment the customer replies.
 */
export async function sendOpenerAndQueue(p: ConfirmationSend): Promise<void> {
  const phone     = normalisePhone(p.to)
  const firstName = (p.name || '').trim().split(/\s+/)[0] || 'there'

  const opener = await sendViaMetaTemplate({
    to: p.to, templateName: OPENER_TEMPLATE, lang: OPENER_TEMPLATE_LANG, bodyParams: [firstName, p.ref],
  })
  if (!opener) {
    throw new Error('WhatsApp Meta credentials are not configured — set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID (Aahaas Operations).')
  }

  // Queue the confirmation. body = message, mediaType encodes the PDF type
  // ('confirmation' | 'full') or null when no PDF is attached.
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef: p.ref,
      phone,
      direction:  'outbound',
      body:       p.message,
      status:     'pending',
      senderName: p.senderName,
      mediaType:  p.attachPdf ? p.pdfType : null,
    },
  })
}

/**
 * A customer inbound reopened their 24h window — deliver any confirmations that
 * were queued while it was closed (oldest first). Each pending row is delivered
 * then flipped to 'sent'; stops on the first failure so order is preserved and
 * the rest retry on a later inbound. Best-effort, safe to call on every inbound.
 */
export async function flushPendingConfirmations(phone: string, baseUrl: string): Promise<number> {
  const p = normalisePhone(phone)
  if (!p) return 0

  const pending = await prisma.whatsAppMessage.findMany({
    where:   { phone: p, direction: 'outbound', status: 'pending' },
    orderBy: { createdAt: 'asc' },
  })
  if (pending.length === 0) return 0

  let sent = 0
  for (const row of pending) {
    const pdfType   = (row.mediaType === 'full' || row.mediaType === 'confirmation') ? row.mediaType as PdfType : null
    try {
      await deliverConfirmationNow({
        ref:        row.bookingRef,
        to:         p,
        name:       '',
        message:    row.body ?? '',
        attachPdf:  Boolean(pdfType),
        pdfType:    pdfType ?? 'confirmation',
        senderName: row.senderName ?? 'System',
        baseUrl,
      })
      // deliverConfirmationNow inserts its own 'sent' row; mark this queued row done.
      await prisma.whatsAppMessage.update({ where: { id: row.id }, data: { status: 'sent-queued' } })
      sent += 1
    } catch (err) {
      console.error('[WhatsApp flush] pending confirmation send failed for', p, '-', err instanceof Error ? err.message : err)
      break // keep order; retry the rest on the next inbound
    }
  }
  return sent
}
