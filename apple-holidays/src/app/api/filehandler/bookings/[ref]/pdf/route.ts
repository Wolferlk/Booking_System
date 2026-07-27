import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { FH_BOOKING_SELECT } from '../../search/route'
import { sendMailViaGraph } from '@/lib/send-mail'
import { buildFhPdfFileName, buildFhBookingEmailHtml, type FhPdfBooking } from '@/lib/filehandler-booking-html'
import { generateFhBookingPdf } from '@/lib/filehandler-booking-pdf'

export const dynamic = 'force-dynamic'
// PDFKit renders in-process (no headless browser), so it needs the Node runtime
// but only a small time budget — no Chromium cold-start or /tmp extract.
export const runtime = 'nodejs'
export const maxDuration = 30

async function loadBooking(ref: string) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: FH_BOOKING_SELECT,
  })
  return booking as unknown as (FhPdfBooking & { id: string; bookingRef: string }) | null
}

/**
 * GET /api/filehandler/bookings/[ref]/pdf
 * Streams the creative "Booking Update" PDF as a download. Filename follows the
 * `<IS>_<CNTL>CNTL_Updates.PDF` convention.
 */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const filename = buildFhPdfFileName(booking)
  try {
    const pdf = await generateFhBookingPdf(booking, { generatedBy: handler.name })
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate PDF'
    return buildApiError(msg, 502)
  }
}

/**
 * POST /api/filehandler/bookings/[ref]/pdf
 * Emails the same PDF as an attachment.
 * Body: { to?, subject?, message?, self? }.
 * When `to` is omitted (or `self` is true) the mail is sent to the logged-in
 * file handler's own address — this backs the portal's "Save & Confirm" button.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const handler = await getFileHandlerSession()
  if (!handler) return buildApiError('Unauthorized', 401)

  const booking = await loadBooking(params.ref)
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json().catch(() => ({})) as { to?: string; subject?: string; message?: string; self?: boolean }
  const to = (body.self ? '' : body.to?.trim()) || handler.email?.trim() || ''
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return buildApiError(
      body.self || !body.to ? 'No email address on file for your account' : 'A valid recipient email is required',
      400,
    )
  }

  const filename = buildFhPdfFileName(booking)
  const subject = body.subject?.trim() || `Booking Update — ${booking.bookingRef}`

  try {
    const pdf = await generateFhBookingPdf(booking, { generatedBy: handler.name })

    const bodyHtml = buildFhBookingEmailHtml(booking, {
      generatedBy: handler.name,
      note: body.message?.trim() || undefined,
    })

    await sendMailViaGraph({
      to,
      subject,
      bodyHtml,
      attachment: { name: filename, contentType: 'application/pdf', buffer: pdf },
    })

    return buildApiSuccess({ sent: true, to }, 'Email sent')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send email'
    return buildApiError(msg, 502)
  }
}
