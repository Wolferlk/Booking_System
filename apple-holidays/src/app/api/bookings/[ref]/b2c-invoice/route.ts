/**
 * The B2C invoice, INV-<order>, for a booking imported from the Aahaas store.
 *
 *   GET                 → the invoice page (prints / saves as PDF from the browser)
 *   GET ?download=1     → the same page as an .html attachment
 *   GET ?format=pdf     → a PDF attachment (headless Chromium)
 *
 * Built from the store's own figures (`b2c-order-money.ts`, read-only), so it
 * matches the invoice AahaasFlow issues. When the PDF engine is unavailable on
 * this host the error says so and the page itself still works.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { fetchB2cOrderMoney } from '@/lib/b2c-order-money'
import { b2cInvoiceNo, renderB2cInvoiceHtml } from '@/lib/b2c-invoice-html'
import { invoiceParties, loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { launchBrowser, PdfEngineUnavailableError } from '@/lib/html-to-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const gate = await loadB2cBookingForOrder(params.ref, await getServerSession(authOptions))
  if ('error' in gate) return gate.error
  const { booking } = gate

  const url = new URL(req.url)
  const asPdf = url.searchParams.get('format') === 'pdf'
  const download = url.searchParams.get('download') === '1'

  let money
  try {
    money = await fetchB2cOrderMoney(booking.orderId)
  } catch (err) {
    console.error('[GET /api/bookings/[ref]/b2c-invoice]', err)
    return buildApiError(`Could not read order ${booking.orderId} from the Aahaas store: ${(err as Error).message}`, 502)
  }
  if (!money) return buildApiError(`Order ${booking.orderId} is no longer in the Aahaas store.`, 404)

  const number = b2cInvoiceNo(money.orderId)
  const parties = invoiceParties(booking, money)

  if (!asPdf) {
    return new Response(renderB2cInvoiceHtml(money, parties), {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(download ? { 'Content-Disposition': `attachment; filename="${number}.html"` } : {}),
      },
    })
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setContent(renderB2cInvoiceHtml(money, parties, { forPdf: true }), { waitUntil: 'load' })
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[GET /api/bookings/[ref]/b2c-invoice] PDF failed', err)
    const engine = err instanceof PdfEngineUnavailableError
    return buildApiError(
      engine
        ? 'PDF engine is not available on this server — open the invoice and use Print / Save as PDF.'
        : `Could not build the PDF: ${(err as Error).message}`,
      engine ? 503 : 500,
    )
  } finally {
    await browser?.close().catch(() => {})
  }
}
