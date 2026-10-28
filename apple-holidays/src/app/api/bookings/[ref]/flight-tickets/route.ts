/**
 * Printed flight tickets for an Aahaas B2C booking — A4, double-sided, cut to size.
 *
 *   GET   → the ticket data the store holds for this order, to prefill the print dialog
 *   POST  { data, options, format: 'pdf' | 'html' } → the sheets, built from what the
 *         desk confirmed in the dialog (see lib/flight-ticket/render.ts)
 *
 * Read-only everywhere: the store is read through the b2cQuery guard, and
 * nothing is written to OPS — a printed ticket is a document, not a record.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { ticketDataFromStore } from '@/lib/flight-ticket/store-ticket'
import { renderTicketSheets } from '@/lib/flight-ticket/render'
import { sanitizePrintOptions, sanitizeTicketData, ticketAssets } from '@/lib/flight-ticket/server'
import { launchBrowser, PdfEngineUnavailableError } from '@/lib/html-to-pdf'
import type { Page } from 'puppeteer-core'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const gate = await loadB2cBookingForOrder(params.ref, await getServerSession(authOptions))
  if ('error' in gate) return gate.error
  const { booking } = gate

  try {
    const data = await ticketDataFromStore(booking.orderId)
    return buildApiSuccess({ orderId: booking.orderId, data })
  } catch (err) {
    console.error('[GET /api/bookings/[ref]/flight-tickets]', err)
    // The dialog still works from an uploaded e-ticket or typed details.
    return buildApiSuccess({ orderId: booking.orderId, data: null, storeError: (err as Error).message })
  }
}

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const gate = await loadB2cBookingForOrder(params.ref, await getServerSession(authOptions))
  if ('error' in gate) return gate.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Send the ticket details as JSON.', 400)
  }

  const data = sanitizeTicketData(body.data)
  const options = sanitizePrintOptions(body.options)
  if (data.passengers.length === 0) return buildApiError('Add at least one passenger.', 422)
  if (data.segments.length === 0) return buildApiError('Add at least one flight (from and to airport codes).', 422)

  const html = await renderTicketSheets(data, options, await ticketAssets(new URL(req.url).origin))
  const name = `Aahaas-Tickets-${data.bookingRef ?? data.orderId ?? gate.booking.bookingRef}`.replace(/[^A-Za-z0-9_-]/g, '')

  if (body.format !== 'pdf') {
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  }

  let browser: Awaited<ReturnType<typeof launchBrowser>> | null = null
  try {
    browser = await launchBrowser()
    // Both launch paths return a puppeteer Page; the union hides evaluate().
    const page = (await browser.newPage()) as unknown as Page
    // Artwork is inlined; the web fonts are the only network fetch, so wait for them.
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
    await page.evaluate(() => document.fonts.ready.then(() => true))
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } })
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    console.error('[POST /api/bookings/[ref]/flight-tickets] PDF failed', err)
    return buildApiError(
      err instanceof PdfEngineUnavailableError
        ? 'The PDF engine is not available on this server — use "Open print view" and print from the browser.'
        : `Could not build the PDF: ${(err as Error).message}`,
      err instanceof PdfEngineUnavailableError ? 503 : 500,
    )
  } finally {
    await browser?.close().catch(() => {})
  }
}
