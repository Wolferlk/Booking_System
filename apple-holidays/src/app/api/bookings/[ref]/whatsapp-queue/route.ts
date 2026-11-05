import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { decodeQueuedAttachment } from '@/lib/booking-whatsapp-delivery'
import { whatsappInboxCountry } from '@/lib/whatsapp'
import { sendGuestMessageTemplate, GuestTemplateUnavailableError } from '@/lib/guest-message-template'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = ['TE_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// GET — the Tour Confirmations currently QUEUED for this booking (waiting for the
// customer to reply so their 24h window opens). Powers the "message still in the
// queue?" indicator on the booking page.
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!STAFF_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const rows = await prisma.whatsAppMessage.findMany({
    where:   { bookingRef: params.ref, direction: 'outbound', status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select:  { id: true, phone: true, body: true, mediaType: true, senderName: true, createdAt: true },
  })

  const queued = rows.map(r => {
    const attachment = decodeQueuedAttachment(r.mediaType)
    return {
      id:         r.id,
      phone:      r.phone,
      preview:    (r.body ?? '').slice(0, 120),
      pdfType:    attachment?.pdfType ?? null,
      fileFormat: attachment?.fileFormat ?? null,
      queuedBy:   r.senderName,
      queuedAt:   r.createdAt,
    }
  })

  return buildApiSuccess({ queued, count: queued.length })
}

// DELETE ?id=<messageId> — cancel a queued confirmation (marks it 'cancelled' so it
// won't be sent when the customer replies). Kept as an audit row, not deleted.
export async function DELETE(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!STAFF_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return buildApiError('Message id is required')

  const row = await prisma.whatsAppMessage.findFirst({
    where: { id, bookingRef: params.ref, direction: 'outbound', status: 'pending' },
  })
  if (!row) return buildApiError('Queued message not found (it may have already been sent or cancelled)', 404)

  await prisma.whatsAppMessage.update({ where: { id }, data: { status: 'cancelled' } })
  return buildApiSuccess({ cancelled: id }, 'Queued message cancelled')
}

const SEND_ROLES = ['TE_USER', 'BT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// POST ?id=<messageId> — send a queued message NOW on the guest-message template
// instead of waiting for the customer's reply. Text only: a queued Word file
// cannot ride a template, so it keeps waiting. The queued row is claimed first
// ('sending') so a double click, or the customer replying at the same moment
// (flushPendingConfirmations), can never send it twice.
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!SEND_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: params.ref },
    select: {
      operationCountry: true,
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }], take: 1, select: { name: true } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  // The Vietnam desk sends only on its own bookings — same scope as the inbox.
  const scopeCountry = whatsappInboxCountry(session.user.role)
  if (scopeCountry && booking.operationCountry !== scopeCountry) return buildApiError('Forbidden', 403)

  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) return buildApiError('Message id is required')

  const row = await prisma.whatsAppMessage.findFirst({
    where: { id, bookingRef: params.ref, direction: 'outbound', status: 'pending' },
  })
  if (!row) return buildApiError('Queued message not found (it may have already been sent or cancelled)', 404)
  if (decodeQueuedAttachment(row.mediaType)) {
    return buildApiError('This queued send carries a document, which a text template cannot deliver — it goes out when the customer replies, or send it as a PDF from the WhatsApp button.', 422)
  }
  if (!row.body?.trim()) return buildApiError('Queued message is empty', 422)

  const claimed = await prisma.whatsAppMessage.updateMany({
    where: { id, status: 'pending' },
    data:  { status: 'sending' },
  })
  if (claimed.count === 0) return buildApiError('This message is already being sent', 409)

  const senderName = row.senderName ?? session.user.name ?? session.user.email ?? 'Staff'
  try {
    const sent = await sendGuestMessageTemplate({
      to:         row.phone,
      guestName:  booking.passengers[0]?.name ?? 'Guest',
      bookingRef: params.ref,
      text:       row.body,
    })
    for (const part of sent.sent) {
      await prisma.whatsAppMessage.create({
        data: {
          bookingRef: params.ref, phone: sent.phone, direction: 'outbound',
          body: part.text, waMessageId: part.waMessageId, status: 'sent', senderName,
        },
      })
    }
    // 'sent-queued' = a queued send that has since gone out (same as the reply flush).
    // When a later part failed, the queued row keeps just the rest, still pending.
    await prisma.whatsAppMessage.update({
      where: { id },
      data:  sent.unsent ? { status: 'pending', body: sent.unsent } : { status: 'sent-queued' },
    })
    const parts = sent.sent.length
    console.log(`[WhatsApp queue] ${params.ref} message ${id} sent via template (${parts} part${parts === 1 ? '' : 's'}) by ${session.user.email}`)
    return buildApiSuccess(
      { sent: id, parts, queued: Boolean(sent.unsent) },
      sent.unsent
        ? `Sent ${parts} part${parts === 1 ? '' : 's'} via WhatsApp template; the rest stays queued until the guest replies.`
        : `Sent via WhatsApp template${parts > 1 ? ` in ${parts} parts` : ''}.`,
    )
  } catch (err) {
    // Nothing went out — put the row back in the queue exactly as it was.
    await prisma.whatsAppMessage.update({ where: { id }, data: { status: 'pending' } }).catch(() => {})
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[WhatsApp queue] template send failed for ${params.ref}/${id}:`, msg)
    if (err instanceof GuestTemplateUnavailableError) {
      return buildApiError(
        `${msg}. Register it in Settings → Customer Daily Trip Details and wait for Meta to approve it; the message stays queued until then.`,
        422,
      )
    }
    return buildApiError(msg, 422)
  }
}
