import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// ── GET: Meta hub verification ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const mode      = req.nextUrl.searchParams.get('hub.mode')
  const token     = req.nextUrl.searchParams.get('hub.verify_token')
  const challenge = req.nextUrl.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN ?? '')) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('Forbidden', { status: 403 })
}

// ── POST: Incoming messages from Meta ────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: MetaWebhookPayload
  try {
    body = await req.json() as MetaWebhookPayload
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  // Respond immediately so Meta doesn't retry
  processIncoming(body).catch(err => console.error('[WA Webhook]', err))
  return new NextResponse(null, { status: 200 })
}

async function processIncoming(payload: MetaWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value?.messages?.length) continue

      for (const msg of value.messages) {
        // Only handle text for now
        const body = msg.text?.body
        if (!body) continue

        const phone = normalisePhone(msg.from)
        const waMessageId = msg.id

        // Dedup — skip if we already stored this wamid
        const exists = await prisma.whatsAppMessage.findFirst({ where: { waMessageId } })
        if (exists) continue

        // Find the booking whose contact/agent phone matches
        const booking = await findBookingByPhone(phone)

        if (!booking) {
          console.warn('[WA Webhook] no booking found for phone', phone)
          // Store the message anyway under a synthetic ref so we don't lose it
          await prisma.whatsAppMessage.create({
            data: {
              bookingRef:  `UNKNOWN:${phone}`,
              phone,
              direction:   'inbound',
              body,
              waMessageId,
              status:      'received',
              senderName:  value.contacts?.[0]?.profile?.name ?? null,
            },
          })
          continue
        }

        await prisma.whatsAppMessage.create({
          data: {
            bookingRef:  booking.bookingRef,
            phone,
            direction:   'inbound',
            body,
            waMessageId,
            status:      'received',
            senderName:  value.contacts?.[0]?.profile?.name ?? null,
          },
        })

        console.log(`[WA Webhook] ✓ inbound from ${phone} → booking ${booking.bookingRef}`)
      }
    }
  }
}

function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

async function findBookingByPhone(phone: string) {
  // Try exact match on all four phone fields
  const variants = [phone, `+${phone}`]

  const booking = await prisma.booking.findFirst({
    where: {
      OR: [
        { contactWhatsapp: { in: variants } },
        { contactPhone:    { in: variants } },
        { agentWhatsapp:   { in: variants } },
        { agentPhone:      { in: variants } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  })

  return booking
}

// ── Meta payload types ────────────────────────────────────────────────────

interface MetaWebhookPayload {
  entry?: MetaEntry[]
}

interface MetaEntry {
  changes?: MetaChange[]
}

interface MetaChange {
  value?: MetaChangeValue
}

interface MetaChangeValue {
  messages?: MetaMessage[]
  contacts?: MetaContact[]
}

interface MetaMessage {
  id:   string
  from: string
  type: string
  text?: { body: string }
  timestamp: string
}

interface MetaContact {
  profile?: { name?: string }
}
