/**
 * Delivery receipts forwarded from n8n.
 *
 * ---- Why this endpoint exists ----
 *
 * A WhatsApp number delivers its webhook to exactly one endpoint, and on the
 * Operations number that endpoint is n8n's. Inbound replies already reach this
 * system by a small forwarded signal (`/api/webhooks/whatsapp-inbound-signal`);
 * this is the same arrangement for the other half of the traffic — the
 * `statuses` array, which is Meta telling us whether the message we sent was
 * actually delivered, read, or never arrived at all.
 *
 * Without it every driver document in this system reads "sent" forever, which
 * is the one thing the delivery tracking was built to stop.
 *
 * ---- What to forward ----
 *
 * Anything convenient. The parser accepts Meta's whole webhook body, the bare
 * `value` object, a single status, or an array of them:
 *
 *   POST /api/webhooks/whatsapp-status-signal
 *   x-inbound-secret: <WHATSAPP_INBOUND_SIGNAL_SECRET>
 *   { "statuses": [ { "id": "wamid.…", "status": "delivered", "timestamp": "1756000000" } ] }
 *
 * A failed status should carry Meta's `errors` array — that is where the reason
 * an operator actually needs comes from.
 *
 * Shares the inbound signal's secret, because it is the same trust boundary and
 * a second secret to rotate is a second secret to forget.
 */
import { NextRequest, NextResponse } from 'next/server'
import { applyDeliveryStatuses, extractStatuses } from '@/lib/whatsapp-delivery-status'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret   = process.env.WHATSAPP_INBOUND_SIGNAL_SECRET?.trim()
  const provided = req.headers.get('x-inbound-secret')?.trim()
  if (secret && provided !== secret) return new NextResponse('Forbidden', { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  const statuses = extractStatuses(body)
  if (!statuses.length) return NextResponse.json({ ok: true, seen: 0 })

  // Awaited rather than fired and forgotten: a status batch is a handful of
  // indexed updates, and the forwarder deserves an honest answer about whether
  // they landed — that answer is the only way to debug this path from outside.
  const result = await applyDeliveryStatuses(statuses)
  return NextResponse.json({ ok: true, ...result })
}
