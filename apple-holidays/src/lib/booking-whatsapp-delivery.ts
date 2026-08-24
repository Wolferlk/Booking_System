/**
 * Free-form Tour Confirmation delivery, and the tail of the old queue.
 *
 * The live path for sending a customer their booking documents is now the
 * approved `aahaas_booking_details` TEMPLATE — see `booking-details-template.ts`.
 * A template delivers cold, so the 24h customer-service window no longer decides
 * whether a confirmation reaches anybody.
 *
 * What is still here, and why:
 *
 *   • buildBookingPdf() / deliverConfirmationNow() — the free-form send. It is
 *     the only way to put a Word file or a bare message in front of a customer,
 *     and both need the 24h window, which the callers check and say so.
 *   • flushPendingConfirmations() — drains queued rows when their customer
 *     replies and reopens the window.
 *   • sendOpenerAndQueue() — the Word / no-attachment path when the window is
 *     shut: opener template out now, document queued for the customer's reply.
 *
 * The queue reuses the existing whatsapp_messages table (no migration): a pending
 * outbound row stores the message in `body` and the attachment in `mediaType`
 * ('confirmation' | 'full' | null when nothing is attached). A ':word' suffix
 * ('full:word') means the Word version was picked; no suffix means PDF, so rows
 * queued before the Word option existed still flush correctly.
 */

import { prisma } from '@/lib/prisma'
import { generateConfirmationPdf, generateFullDetailsPdf } from '@/lib/generate-booking-pdf'
import { generateConfirmationDocx, generateFullDetailsDocx } from '@/lib/generate-booking-docx'
import { putUpload } from '@/lib/storage'
import { sendViaMetaApi, sendViaNotifyProxy, sendViaMetaTemplate, normalisePhone } from '@/lib/whatsapp'

export type PdfType = 'confirmation' | 'full'
/** Attachment file format — the same document rendered as PDF or Word. */
export type FileFormat = 'pdf' | 'word'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Encode / decode the queue's `mediaType` field: "full" (PDF) vs "full:word". */
export function encodeQueuedAttachment(pdfType: PdfType, fileFormat: FileFormat): string {
  return fileFormat === 'word' ? `${pdfType}:word` : pdfType
}
export function decodeQueuedAttachment(
  mediaType: string | null | undefined,
): { pdfType: PdfType; fileFormat: FileFormat } | null {
  if (!mediaType) return null
  const [type, format] = mediaType.split(':')
  if (type !== 'full' && type !== 'confirmation') return null
  return { pdfType: type, fileFormat: format === 'word' ? 'word' : 'pdf' }
}

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

/** Build the confirmation / full-details document for a booking, as PDF or Word. */
export async function buildBookingPdf(
  ref: string,
  pdfType: PdfType,
  fileFormat: FileFormat = 'pdf',
): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
  const isFull  = pdfType === 'full'
  const isWord  = fileFormat === 'word'
  const booking = await prisma.booking.findUnique({
    where:   { bookingRef: ref },
    include: bookingInclude(isFull),
  })
  if (!booking) throw new Error(`Booking ${ref} not found for the attachment`)

  const buffer = isWord
    ? (isFull ? await generateFullDetailsDocx(booking) : await generateConfirmationDocx(booking))
    : (isFull ? await generateFullDetailsPdf(booking)  : await generateConfirmationPdf(booking))
  if (!buffer.length) throw new Error(`Generated ${isWord ? 'Word file' : 'PDF'} is empty`)

  const typeTag  = isFull ? 'FullDetails' : 'TourConfirmation'
  const filename = `AppleHolidays-${ref}-${typeTag}-${Date.now()}.${isWord ? 'docx' : 'pdf'}`
  return { buffer, filename, mimeType: isWord ? DOCX_MIME : 'application/pdf' }
}

export interface ConfirmationSend {
  ref:        string
  to:         string
  name:       string
  message:    string
  attachPdf:  boolean
  pdfType:    PdfType
  /** PDF (default) or the Word twin of the same document. */
  fileFormat?: FileFormat
  senderName: string
  /** Public base URL for the file link used by the notify-proxy fallback. */
  baseUrl:    string
}

/**
 * Deliver the confirmation NOW as free-form (Meta first, notify proxy fallback).
 * Caller must have confirmed the 24h window is open. Also used by the queue flush.
 */
export async function deliverConfirmationNow(p: ConfirmationSend): Promise<void> {
  const phone   = normalisePhone(p.to)
  const isFull  = p.pdfType === 'full'

  let pdf: { buffer: Buffer; filename: string; mimeType: string } | undefined
  let fileUrl: string | undefined
  if (p.attachPdf) {
    pdf     = await buildBookingPdf(p.ref, p.pdfType, p.fileFormat ?? 'pdf')
    await putUpload(`whatsapp/${pdf.filename}`, pdf.buffer, pdf.mimeType)
    fileUrl = `${p.baseUrl.replace(/\/+$/, '')}/api/uploads/whatsapp/${encodeURIComponent(pdf.filename)}`
  }

  const metaResult = await sendViaMetaApi({
    to: p.to,
    message: p.message,
    ...(pdf ? { media: { buffer: pdf.buffer, filename: pdf.filename, kind: 'document' as const, caption: isFull ? 'Full tour details & vouchers' : 'Tour confirmation' } } : {}),
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
 * Window closed on a send a template cannot carry (a Word file, or a bare
 * message): send the approved opener template — which DOES deliver cold — and
 * QUEUE the document as a `pending` row. Meta only reopens the 24h window when
 * the CUSTOMER messages us, never because we sent them a template, so the
 * opener asks them to reply; flushPendingConfirmations() delivers the queued
 * row the moment they do.
 *
 * PDF sends never come here — they go out on `aahaas_booking_details`, which
 * carries the document in its header and lands cold.
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

  // Queue the confirmation. body = message, mediaType encodes the document type
  // and file format ('full', 'full:word', …) or null when nothing is attached.
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef: p.ref,
      phone,
      direction:  'outbound',
      body:       p.message,
      status:     'pending',
      senderName: p.senderName,
      mediaType:  p.attachPdf ? encodeQueuedAttachment(p.pdfType, p.fileFormat ?? 'pdf') : null,
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
    const attachment = decodeQueuedAttachment(row.mediaType)
    try {
      await deliverConfirmationNow({
        ref:        row.bookingRef,
        to:         p,
        name:       '',
        message:    row.body ?? '',
        attachPdf:  Boolean(attachment),
        pdfType:    attachment?.pdfType ?? 'confirmation',
        fileFormat: attachment?.fileFormat ?? 'pdf',
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
