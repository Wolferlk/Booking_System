/**
 * GET ?kind=… → one of the order's documents, relayed from Aahaas Flow so the
 * booking page has what AahaasFlow's Documents menu has:
 *
 *   invoice          the invoice, selling prices only (HTML)
 *   vouchers         every supplier voucher, one page per service (HTML)
 *   voucher&line=ID  one product's supplier voucher (HTML)
 *   pnl              the P&L statement (HTML) — roles with pnl:view_profit only
 *   confirmation     the customer confirmation the agency received (PDF)
 *   supplier&line=ID the voucher as the supplier portal holds it (PDF)
 *
 * `&download=1` saves instead of opening. HTML is sandboxed when opened
 * directly; the booking page shows it in its own sandboxed frame and turns it
 * into a PDF in the browser (no PDF engine needed on this server).
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { loadB2cBookingForOrder } from '@/lib/b2c-order-access'
import { FlowError, flowFetch, flowGet } from '@/lib/aahaas-flow-api'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HTML_KINDS = new Set(['invoice', 'vouchers', 'voucher', 'pnl'])

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  const gate = await loadB2cBookingForOrder(params.ref, session)
  if ('error' in gate) return gate.error
  const id = gate.booking.orderId
  const actor = session!.user.email ?? session!.user.name ?? null

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind') ?? ''
  const line = url.searchParams.get('line') ?? ''
  const download = url.searchParams.get('download') === '1'
  if (line && !/^\d+$/.test(line)) return buildApiError('That is not a product line.', 400)
  if (kind === 'pnl' && !hasPermission(session!.user.role, 'pnl:view_profit')) {
    return buildApiError('Profit, cost and margin are not visible to your role.', 403)
  }

  try {
    if (HTML_KINDS.has(kind)) {
      if (kind === 'voucher' && !line) return buildApiError('Which product? Pass &line=', 400)
      const qs = kind === 'voucher' ? `?line=${line}` : ''
      const res = await flowFetch(`documents/${kind}/${id}${qs}`, actor)
      const name = kind === 'invoice' ? `INV-${id}` : kind === 'pnl' ? `PNL-${id}` : kind === 'voucher' ? `Voucher-${id}-${line}` : `Vouchers-${id}`
      return new Response(await res.text(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          // Opened directly, a document is a page to read — never one that runs script.
          'Content-Security-Policy': "sandbox allow-modals; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:",
          ...(download ? { 'Content-Disposition': `attachment; filename="${name}.html"` } : {}),
        },
      })
    }

    let path: string
    let name: string
    if (kind === 'confirmation') {
      path = `documents/confirmation/${id}`
      name = `AHCNF_${id}`
    } else if (kind === 'supplier' && line) {
      // That line id is the store's, not scoped to an order upstream — make sure
      // it is one of THIS booking's products before relaying it.
      const order = await flowGet<{ lines?: { checkoutId?: number | string }[] }>(`b2c/orders/${id}`, actor)
      if (!(order.lines ?? []).some((l) => String(l.checkoutId) === line)) {
        return buildApiError('That product is not on this order.', 404)
      }
      path = `b2c/lines/${line}/voucher/pdf`
      name = `Voucher-${id}-${line}`
    } else {
      return buildApiError('Unknown document.', 400)
    }

    const res = await flowFetch(path, actor)
    const type = res.headers.get('content-type') ?? ''
    // Relayed onto our origin: only ever as a PDF, never as a page that could run script.
    if (!/pdf|octet-stream/i.test(type)) return buildApiError('Aahaas Flow did not send a PDF for this document.', 502)
    return new Response(await res.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    if (err instanceof FlowError) return buildApiError(err.message, err.status >= 400 && err.status < 600 ? err.status : 502)
    console.error('[GET /api/bookings/[ref]/b2c-flow/doc]', err)
    return buildApiError(`Could not read the document: ${(err as Error).message}`, 502)
  }
}
