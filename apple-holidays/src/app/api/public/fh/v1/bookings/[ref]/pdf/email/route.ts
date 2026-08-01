import { NextRequest } from 'next/server'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, readJsonBody, runRoute, str, FhApiError } from '@/lib/public-api/fh-http'
import { logFhAction, requireBooking } from '@/lib/public-api/fh-actions'
import { sendMailViaGraph } from '@/lib/send-mail'
import { buildFhPdfFileName, buildFhBookingEmailHtml, type FhPdfBooking } from '@/lib/filehandler-booking-html'
import { generateFhBookingPdf } from '@/lib/filehandler-booking-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * POST /api/public/fh/v1/bookings/{ref}/pdf/email
 * Body: { "to": "agent@example.com", "subject": "…", "message": "…", "self": false }
 *
 * Emails the Booking Update PDF as an attachment. This is the portal's
 * "Save & Confirm" action: omit `to` (or send `"self": true`) and it goes to the
 * acting file handler's own address.
 */
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  return runRoute('pdf/email', async (requestId) => {
    const caller = await requireCaller(req, 'document:send')
    const booking = await requireBooking(decodeURIComponent(params.ref))
    const body = await readJsonBody(req)

    const self = body.self === true
    const to = (self ? '' : str(body, 'to', 'email', 'recipient')) || caller.handler.email.trim()
    if (!to || !EMAIL_RE.test(to)) {
      throw new FhApiError(
        self || !body.to
          ? 'No email address on file for this file handler — send "to" explicitly'
          : '"to" is not a valid email address',
        422,
        'RECIPIENT_INVALID',
      )
    }

    const doc = booking as unknown as FhPdfBooking
    const filename = buildFhPdfFileName(doc)
    const subject = str(body, 'subject') || `Booking Update — ${booking.bookingRef}`

    try {
      const pdf = await generateFhBookingPdf(doc, { generatedBy: caller.handler.name })
      const bodyHtml = buildFhBookingEmailHtml(doc, {
        generatedBy: caller.handler.name,
        note: str(body, 'message', 'note'),
      })
      await sendMailViaGraph({
        to,
        subject,
        bodyHtml,
        attachment: { name: filename, contentType: 'application/pdf', buffer: pdf },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send the email'
      throw new FhApiError(msg, 502, 'EMAIL_FAILED')
    }

    await logFhAction(caller, booking, 'PDF_EMAILED', `Emailed ${filename} to ${to}`)

    return apiOk({ sent: true, to, filename, subject, message: `Email sent to ${to}` }, 200, requestId)
  })
}
