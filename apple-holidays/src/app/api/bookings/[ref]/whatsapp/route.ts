/**
 * POST /api/bookings/[ref]/whatsapp — send a customer their booking documents.
 *
 * Delivery goes through the APPROVED Meta template `aahaas_booking_details`
 * with the PDF in its DOCUMENT header, so it lands whether or not the customer
 * has messaged us in the last 24 hours. Nothing is queued and nobody is asked
 * to reply first; see lib/booking-details-template.ts for why that changed.
 *
 * Two things a template cannot carry, and what happens to them:
 *   • a Word (.docx) attachment — Meta accepts only a PDF in a template header
 *   • a send with no attachment at all — a document header needs a document
 * Both fall back to free-form, which WhatsApp only delivers inside the 24h
 * window; outside it the caller is told plainly rather than being told "sent".
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  isWithin24hWindow,
  deliverConfirmationNow,
  buildBookingPdf,
  type PdfType,
  type FileFormat,
} from '@/lib/booking-whatsapp-delivery'
import { sendBookingDocTemplate } from '@/lib/booking-details-template'

export const dynamic = 'force-dynamic'
// Rendering the document then uploading it to Meta takes far longer than the
// platform's default function timeout. Without this the request is killed mid-flight
// and the gateway serves its own HTML 502 in place of our JSON. Matches agenda/send.
export const maxDuration = 120

const DOC_LABEL: Record<PdfType, string> = {
  confirmation: 'Tour Confirmation (PDF)',
  full:         'Full Tour Details & Vouchers (PDF)',
}

function getPublicBaseUrl(req: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    req.nextUrl.origin
  ).replace(/\/+$/, '')
}

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name, message, note, attachPdf, pdfType, fileFormat } = await req.json() as {
    to:          string
    name:        string
    /** Free-form body — used only on the fallback path a template cannot cover. */
    message?:    string
    /** The desk's own line inside the template ({{6}}). */
    note?:       string
    attachPdf?:  boolean
    pdfType?:    PdfType
    /** 'word' attaches the .docx twin of the same document; defaults to PDF. */
    fileFormat?: FileFormat
  }

  if (!to) return buildApiError('Phone number is required')

  const type       = pdfType === 'full' ? 'full' : 'confirmation'
  const format     = fileFormat === 'word' ? 'word' : 'pdf'
  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const baseUrl    = getPublicBaseUrl(req)
  const attach     = attachPdf !== false
  const docLabel   = type === 'full' ? 'Full Details + Vouchers' : 'Tour Confirmation'

  try {
    // ── The normal path: template + PDF, delivered cold ───────────────────
    if (attach && format === 'pdf') {
      const pdf = await buildBookingPdf(params.ref, type as PdfType, 'pdf')
      const sent = await sendBookingDocTemplate({
        bookingRef:    params.ref,
        to,
        document:      pdf,
        attachedLabel: DOC_LABEL[type as PdfType],
        note,
        facts:         name?.trim() ? { guestName: name.trim() } : undefined,
        senderName,
        baseUrl,
      })
      return buildApiSuccess(
        { delivered: true, channel: 'template', waMessageId: sent.waMessageId },
        `WhatsApp ${docLabel} sent to ${sent.phone}`,
      )
    }

    // ── Fallback: no PDF to put in the header, so free-form or nothing ────
    if (!message) return buildApiError('A message is required for a free-form send')

    if (!(await isWithin24hWindow(to))) {
      return buildApiError(
        attach
          ? 'WhatsApp only accepts a PDF in a template attachment, and this customer has not messaged us in the ' +
            'last 24 hours, so a Word file cannot reach them. Switch the format to PDF to send it now.'
          : 'A message with no attachment can only be delivered inside the 24h window, and this customer has not ' +
            'messaged us in the last 24 hours. Attach the PDF to send it now.',
        409,
      )
    }

    await deliverConfirmationNow({
      ref: params.ref, to, name: name ?? 'Guest', message,
      attachPdf: attach, pdfType: type as PdfType, fileFormat: format as FileFormat,
      senderName, baseUrl,
    })
    return buildApiSuccess({ delivered: true, channel: 'freeform' }, `WhatsApp ${docLabel} sent to ${to}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] send failed:', msg)
    return buildApiError(msg, 502)
  }
}
