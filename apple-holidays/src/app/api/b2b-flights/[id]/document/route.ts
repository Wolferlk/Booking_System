/**
 * GET /api/b2b-flights/[id]/document?doc=details|invoice&format=pdf|html
 *
 * `format=html` renders the same document inline in the browser (the in-app
 * viewer and a working Ctrl-P fallback when Chromium is unavailable on the
 * host); `format=pdf` streams it as a download.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { getB2bBooking } from '@/lib/b2b-flights'
import { isB2bConfigured } from '@/lib/b2b-db'
import { buildBookingDetailHtml, buildInvoiceHtml, invoiceNumber, renderB2bPdf } from '@/lib/b2b-documents'

export const dynamic = 'force-dynamic'
// PDF rendering (puppeteer/chromium) needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!isB2bConfigured()) return buildApiError('B2B database is not configured', 503)

  const id = Number(params.id)
  if (!Number.isInteger(id) || id <= 0) return buildApiError('Invalid booking id', 400)

  const url = new URL(req.url)
  const doc = url.searchParams.get('doc') === 'invoice' ? 'invoice' : 'details'
  const format = url.searchParams.get('format') === 'html' ? 'html' : 'pdf'
  const inline = url.searchParams.get('inline') === '1'

  const booking = await getB2bBooking(id).catch((err) => {
    throw err instanceof Error ? err : new Error(String(err))
  })
  if (!booking) return buildApiError('Booking not found, or not confirmed', 404)

  const html = doc === 'invoice' ? buildInvoiceHtml(booking) : buildBookingDetailHtml(booking)
  const name = doc === 'invoice' ? invoiceNumber(booking) : `${booking.reference}-details`

  if (format === 'html') {
    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  try {
    const pdf = await renderB2bPdf(html)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    // Chromium missing on this host is an environment problem, not a data one —
    // say so, and point at the HTML view that always works.
    const msg = err instanceof Error ? err.message : 'PDF rendering failed'
    return buildApiError(`${msg} — use the "View" option (HTML) and print from the browser instead.`, 502)
  }
}
