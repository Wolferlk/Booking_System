import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findBookingByPhone, normalisePhone } from '@/lib/whatsapp'
import { flushPendingConfirmations } from '@/lib/booking-whatsapp-delivery'

export const dynamic = 'force-dynamic'

/**
 * Lightweight inbound signal from n8n.
 *
 * n8n owns the Operations number's WhatsApp webhook (a number delivers inbound to
 * only one endpoint). But the booking system SENDS its own messages and needs to
 * know when a customer replies — to (a) open their 24h window for our send checks
 * and (b) flush any Tour Confirmations queued while the window was closed.
 *
 * So n8n forwards a tiny `{ from, name }` signal here for every inbound. We record
 * a minimal inbound row (only for known booking contacts / numbers with a queued
 * message, to avoid noise) and flush their pending confirmations. No media, no
 * bulk — just the fact that they replied.
 */
export async function POST(req: NextRequest) {
  const secret   = process.env.WHATSAPP_INBOUND_SIGNAL_SECRET?.trim()
  const provided = req.headers.get('x-inbound-secret')?.trim()
  if (secret && provided !== secret) return new NextResponse('Forbidden', { status: 403 })

  let body: { from?: string; name?: string }
  try { body = await req.json() as { from?: string; name?: string } }
  catch { return new NextResponse('Bad request', { status: 400 }) }

  const phone = normalisePhone(body.from ?? '')
  if (!phone) return new NextResponse('Bad request', { status: 400 })

  // Only relevant if this number belongs to a booking contact or has a queued
  // (pending) confirmation — otherwise ignore, so we don't store every inbound.
  const [booking, hasPending] = await Promise.all([
    findBookingByPhone(phone),
    prisma.whatsAppMessage.findFirst({ where: { phone, direction: 'outbound', status: 'pending' }, select: { id: true } }),
  ])
  if (!booking && !hasPending) return NextResponse.json({ ok: true, relevant: false })

  // Record a minimal inbound row so isWithin24hWindow() sees the reply.
  await prisma.whatsAppMessage.create({
    data: {
      bookingRef: booking?.bookingRef ?? `UNKNOWN:${phone}`,
      phone,
      direction:  'inbound',
      body:       '[customer replied]',
      status:     'received',
      senderName: body.name ?? null,
      read:       false,
    },
  })

  const base    = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim()
  const flushed = await flushPendingConfirmations(phone, base).catch(() => 0)
  return NextResponse.json({ ok: true, relevant: true, flushed })
}
