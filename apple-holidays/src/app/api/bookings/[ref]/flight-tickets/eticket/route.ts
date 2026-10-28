/**
 * POST multipart `file` — an Aahaas e-ticket PDF — → the ticket data on it.
 *
 * The issued e-ticket is the most exact source for a printed ticket (each
 * passenger beside their own e-ticket number, the airline PNR, the real
 * times). The file is read in memory and discarded; nothing is stored.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { extractTextFromPdf } from '@/lib/parsers/pdf-parser'
import { looksLikeAahaasEticket, parseAahaasEticketText } from '@/lib/flight-ticket/eticket-parse'
import { ticketDataFromStore } from '@/lib/flight-ticket/store-ticket'
import { mergeTicketData } from '@/lib/flight-ticket/sources'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const gate = await loadB2cBookingForOrder(params.ref, await getServerSession(authOptions))
  if ('error' in gate) return gate.error

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string') return buildApiError('Choose the e-ticket PDF.', 400)
  if (file.size > MAX_BYTES) return buildApiError('That file is over 10 MB.', 413)

  const buf = Buffer.from(await file.arrayBuffer())
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return buildApiError('That is not a PDF.', 415)

  let text: string
  try {
    text = await extractTextFromPdf(buf)
  } catch (err) {
    return buildApiError(`The PDF could not be read: ${(err as Error).message}`, 422)
  }
  if (!looksLikeAahaasEticket(text)) {
    return buildApiError('This does not look like an Aahaas e-ticket (no booking reference / airline PNR found).', 422)
  }

  const data = parseAahaasEticketText(text)
  if (data.orderId && data.orderId !== String(gate.booking.orderId)) {
    data.warnings.unshift(`This e-ticket is for order #${data.orderId}, but this booking is order #${gate.booking.orderId}. Check you uploaded the right file.`)
  }

  // Cross-check against the store's own booking, and fill what the PDF lacks:
  // a PDF from another order, or an outdated one after a reissue, must not
  // quietly become a guest's ticket.
  const store = await ticketDataFromStore(gate.booking.orderId).catch(() => null)
  return buildApiSuccess({ data: mergeTicketData(data, store) })
}
