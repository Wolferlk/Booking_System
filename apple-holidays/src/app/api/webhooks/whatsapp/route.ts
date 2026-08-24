import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findBookingByPhone, normalisePhone } from '@/lib/whatsapp'
import { flushPendingConfirmations } from '@/lib/booking-whatsapp-delivery'
import { putUpload } from '@/lib/storage'

export const dynamic = 'force-dynamic'

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

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

/** Fetch a Meta media object's temp CDN URL, then download the bytes. */
async function downloadMetaMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  if (!accessToken || !mediaId) return null

  const metaRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!metaRes.ok) {
    console.error('[WA Webhook] media metadata fetch failed', metaRes.status)
    return null
  }
  const meta = await metaRes.json() as { url?: string; mime_type?: string }
  if (!meta.url) return null

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!fileRes.ok) {
    console.error('[WA Webhook] media download failed', fileRes.status)
    return null
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer())
  return { buffer, mimeType: meta.mime_type ?? 'application/octet-stream' }
}

function extFor(filename: string | undefined, mime: string): string {
  const fromName = filename?.split('.').pop()
  if (fromName && fromName.length <= 5) return fromName
  return mime.split('/')[1]?.split(';')[0] ?? 'bin'
}

/**
 * Delivery receipts.
 *
 * Meta accepts a send and answers 200 long before it knows whether the message
 * can be delivered: the number may not be on WhatsApp, the template may be
 * unapproved, the 24-hour window may have shut between our check and the send.
 * The truth arrives here, minutes later, as a status against the wamid.
 *
 * Two things are moved by it — the chat message, so a thread shows its ticks,
 * and the driver-document receipt, so the Drive Log can tell the desk that the
 * settlement pack it "sent" this morning has never reached the driver's phone.
 *
 * Statuses arrive out of order and are re-sent, so the ladder only ever climbs:
 * a `sent` landing after a `read` must not walk the row backwards.
 */
const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3, failed: 4 }

async function processStatuses(statuses: MetaStatus[]) {
  for (const s of statuses) {
    if (!s?.id || !s.status) continue

    const status = s.status.toLowerCase()
    const rank   = STATUS_RANK[status]
    if (rank === undefined) continue

    const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date()
    const reason = s.errors?.length
      ? s.errors
          .map(e => [e.title, e.message, e.error_data?.details].filter(Boolean).join(' — ') || `Meta error ${e.code ?? ''}`.trim())
          .join('; ')
      : null

    // The chat log. `updateMany` because a wamid is unique in practice but not
    // by constraint, and a receipt must not throw on a message we never stored.
    await prisma.whatsAppMessage.updateMany({
      where: { waMessageId: s.id },
      data:  { status },
    }).catch(err => console.warn('[WA Webhook] status log failed:', err instanceof Error ? err.message : err))

    // The document receipt.
    try {
      const row = await prisma.driverDocSend.findFirst({
        where:  { waMessageId: s.id },
        select: { id: true, status: true },
      })
      if (!row) continue
      if ((STATUS_RANK[row.status] ?? 0) >= rank && status !== 'failed') continue

      await prisma.driverDocSend.update({
        where: { id: row.id },
        data: {
          status,
          ...(status === 'sent'      ? { sentAt: at }      : {}),
          ...(status === 'delivered' ? { deliveredAt: at } : {}),
          ...(status === 'read'      ? { readAt: at }      : {}),
          ...(status === 'failed'    ? { failedAt: at, failureReason: reason ?? 'WhatsApp could not deliver this message.' } : {}),
        },
      })
    } catch (err) {
      console.warn('[WA Webhook] delivery receipt failed:', err instanceof Error ? err.message : err)
    }
  }
}

async function processIncoming(payload: MetaWebhookPayload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value

      if (value?.statuses?.length) await processStatuses(value.statuses)

      if (!value?.messages?.length) continue

      for (const msg of value.messages) {
        const waMessageId = msg.id
        const phone = normalisePhone(msg.from)

        // Dedup — skip if we already stored this wamid
        const exists = await prisma.whatsAppMessage.findFirst({ where: { waMessageId } })
        if (exists) continue

        let text: string | null = null
        let mediaUrl: string | null = null
        let mediaType: string | null = null
        let mediaMimeType: string | null = null

        if (msg.type === 'text' && msg.text?.body) {
          text = msg.text.body
        } else if (isMediaType(msg.type)) {
          const field = (msg as unknown as Record<string, MetaMediaField | undefined>)[msg.type]
          if (!field?.id) continue

          const downloaded = await downloadMetaMedia(field.id)
          if (!downloaded) continue

          const mime = field.mime_type ?? downloaded.mimeType
          const ext = extFor(field.filename, mime)
          const storedUrl = await putUpload(
            `whatsapp-inbound/${phone}/${waMessageId}.${ext}`,
            downloaded.buffer,
            mime,
          )

          mediaUrl = storedUrl
          mediaType = msg.type
          mediaMimeType = mime
          text = field.caption ?? null
        } else {
          // Unsupported type (location, contacts, reaction, etc.) — skip for now.
          continue
        }

        // Find the booking whose contact/agent phone matches
        const booking = await findBookingByPhone(phone)
        const bookingRef = booking ? booking.bookingRef : `UNKNOWN:${phone}`

        await prisma.whatsAppMessage.create({
          data: {
            bookingRef,
            phone,
            direction:  'inbound',
            body:       text,
            waMessageId,
            status:     'received',
            senderName: value.contacts?.[0]?.profile?.name ?? null,
            mediaUrl,
            mediaType,
            mediaMimeType,
            read: false,
          },
        })

        if (!booking) console.warn('[WA Webhook] no booking found for phone', phone)
        else console.log(`[WA Webhook] ✓ inbound from ${phone} → booking ${booking.bookingRef}`)

        // This inbound reopened the customer's 24h window — flush any Tour
        // Confirmations that were queued while it was closed (send now).
        const flushBase = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').trim()
        flushPendingConfirmations(phone, flushBase).catch(err =>
          console.error('[WA Webhook] flush pending confirmations failed', err))
      }
    }
  }
}

function isMediaType(type: string): type is MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(type)
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
  statuses?: MetaStatus[]
}

/**
 * A delivery receipt. Meta sends one of these per state change, minutes after
 * the send that returned 200 — which is the only reason we can ever say a
 * document *arrived* rather than that we handed it over.
 */
interface MetaStatus {
  /** The wamid of the outbound message this is about. */
  id: string
  /** sent | delivered | read | failed. */
  status: string
  /** Unix seconds. */
  timestamp?: string
  recipient_id?: string
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>
}

interface MetaMediaField {
  id:         string
  mime_type?: string
  caption?:   string
  filename?:  string
}

interface MetaMessage {
  id:   string
  from: string
  type: string
  text?: { body: string }
  timestamp: string
  image?:    MetaMediaField
  document?: MetaMediaField
  audio?:    MetaMediaField
  video?:    MetaMediaField
  sticker?:  MetaMediaField
}

interface MetaContact {
  profile?: { name?: string }
}
