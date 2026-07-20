/** Global WhatsApp inbox — send an image or document attachment to any phone number. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { putUpload } from '@/lib/storage'
import { sendViaMetaApi, findBookingByPhone, normalisePhone, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
const MAX_BYTES = 16 * 1024 * 1024 // Meta's own cap for documents/images

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const form = await req.formData()
  const file = form.get('file')
  const rawPhone = form.get('phone')
  const caption = form.get('caption')

  if (!(file instanceof File)) return buildApiError('file is required')
  if (typeof rawPhone !== 'string') return buildApiError('phone is required')
  const phone = normalisePhone(rawPhone)
  if (!phone) return buildApiError('phone is required')
  if (file.size > MAX_BYTES) return buildApiError('File is too large (max 16 MB)')

  const buffer = Buffer.from(await file.arrayBuffer())
  const kind: 'image' | 'document' = file.type.startsWith('image/') ? 'image' : 'document'
  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const booking = await findBookingByPhone(phone)
  const bookingRef = booking ? booking.bookingRef : `UNKNOWN:${phone}`
  const captionText = typeof caption === 'string' && caption.trim() ? caption.trim() : undefined

  try {
    const metaResult = await sendViaMetaApi({
      to: phone,
      media: { buffer, filename: file.name || `attachment-${Date.now()}`, kind, caption: captionText },
    })
    if (!metaResult) return buildApiError('No WhatsApp credentials configured', 500)

    const storedUrl = await putUpload(`whatsapp-outbound/${phone}/${Date.now()}-${file.name}`, buffer, file.type)

    await prisma.whatsAppMessage.create({
      data: {
        bookingRef,
        phone,
        direction:     'outbound',
        body:          captionText ?? null,
        waMessageId:   (metaResult.media as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
        status:        'sent',
        senderName,
        mediaUrl:      storedUrl,
        mediaType:     kind,
        mediaMimeType: file.type,
      },
    })

    return buildApiSuccess(metaResult, `Sent to ${phone}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] global media send failed:', msg)
    return buildApiError(msg, 502)
  }
}
