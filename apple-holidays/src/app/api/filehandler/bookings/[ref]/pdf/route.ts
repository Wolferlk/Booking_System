import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getFileHandlerSession } from '@/lib/filehandler-auth'
import { FH_BOOKING_SELECT } from '../../search/route'
import { htmlToPdf } from '@/lib/html-to-pdf'
import { sendMailViaGraph } from '@/lib/send-mail'
import {
  buildFhBookingHtml, buildFhPdfFileName, type FhPdfBooking,
} from '@/lib/filehandler-booking-html'

export const dynamic = 'force-dynamic'
// PDF rendering (puppeteer/chromium) needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

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
    const html = buildFhBookingHtml(booking, { generatedBy: handler.name })
    const pdf = await htmlToPdf(html, filename, { bookingRef: booking.bookingRef })
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
    const html = buildFhBookingHtml(booking, { generatedBy: handler.name })
    const pdf = await htmlToPdf(html, filename, { bookingRef: booking.bookingRef })

    const note = body.message?.trim()
    const bodyHtml = `
      <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:14px;line-height:1.6">
        <p>Hi,</p>
        <p>Please find attached the latest booking update for
          <strong>${booking.bookingRef}</strong>${booking.isNumber ? ` (IS ${booking.isNumber})` : ''}.</p>
        ${note ? `<p style="padding:10px 12px;background:#f1f5f9;border-radius:8px">${note.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</p>` : ''}
        <p style="color:#64748b;font-size:12px;margin-top:18px">Sent from the Apple Holidays File-Handler portal by ${handler.name}.</p>
      </div>`

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
