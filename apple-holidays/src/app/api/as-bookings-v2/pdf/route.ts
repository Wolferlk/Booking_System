import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { getQuoteTemplate } from '@/lib/applesystem'
import { buildConfirmationHtml } from '@/lib/as-confirmation-html'
import { htmlToPdf } from '@/lib/html-to-pdf'

export const dynamic = 'force-dynamic'
// PDF rendering (puppeteer/chromium) needs the Node runtime and time to spin up.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/as-bookings-v2/pdf?quotation_no=..&reference_id=..&costs=1|0
 * Streams a booking-confirmation PDF. `costs=1` includes the financial
 * breakdown; `costs=0` produces the customer-facing copy without any amounts.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const url = new URL(req.url)
  const quotationNo = url.searchParams.get('quotation_no') || ''
  const referenceId = url.searchParams.get('reference_id') || ''
  const withCosts = url.searchParams.get('costs') === '1'
  if (!quotationNo || !referenceId) {
    return buildApiError('quotation_no and reference_id are required', 400)
  }

  try {
    const quote = await getQuoteTemplate(quotationNo, referenceId)
    const html = buildConfirmationHtml(quote, withCosts)
    const suffix = withCosts ? 'with-costs' : 'no-costs'
    const filename = `AS-${quotationNo}-confirmation-${suffix}.pdf`
    const pdf = await htmlToPdf(html, filename, { bookingRef: quotationNo })

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate confirmation PDF'
    return buildApiError(msg, 502)
  }
}
