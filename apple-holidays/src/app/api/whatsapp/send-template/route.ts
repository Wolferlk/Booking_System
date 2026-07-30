/** Global WhatsApp inbox — send a chosen APPROVED template to a customer. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { sendViaMetaTemplate, findBookingByPhone, normalisePhone, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json() as {
    phone?: string
    template?: string
    lang?: string
    bodyParams?: string[]
    headerParams?: string[]
    previewText?: string
  }
  const phone = normalisePhone(body.phone ?? '')
  const templateName = (body.template ?? '').trim()
  if (!phone) return buildApiError('phone is required')
  if (!templateName) return buildApiError('template is required')

  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const booking = await findBookingByPhone(phone)
  const bookingRef = booking ? booking.bookingRef : `UNKNOWN:${phone}`

  try {
    const result = await sendViaMetaTemplate({
      to: phone,
      templateName,
      lang: body.lang || 'en',
      bodyParams: Array.isArray(body.bodyParams) ? body.bodyParams : [],
      headerParams: Array.isArray(body.headerParams) ? body.headerParams : [],
    })
    if (!result) return buildApiError('WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured', 503)

    const waMessageId = (result.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null
    await prisma.whatsAppMessage.create({
      data: {
        bookingRef,
        phone,
        direction:   'outbound',
        body:        (body.previewText ?? '').trim() || `[Template: ${templateName}]`,
        waMessageId,
        status:      'sent',
        senderName,
      },
    })
    return buildApiSuccess(result, `Template sent to ${phone}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] template send failed:', msg)
    return buildApiError(msg, 502)
  }
}
