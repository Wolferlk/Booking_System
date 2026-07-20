/** Global WhatsApp inbox — send a plain text reply to any phone number. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { sendViaMetaApi, sendViaMetaTemplate, sendViaNotifyProxy, findBookingByPhone, normalisePhone, isWithin24hWindow, WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const { phone: rawPhone, message } = await req.json() as { phone?: string; message?: string }
  const phone = normalisePhone(rawPhone ?? '')
  if (!phone || !message?.trim()) return buildApiError('phone and message are required')

  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const booking = await findBookingByPhone(phone)
  const bookingRef = booking ? booking.bookingRef : `UNKNOWN:${phone}`
  const text = message.trim()

  // PROACTIVE 24h-window decision — mirrors n8n-project's WhatsAppService.sendText():
  // Meta can return 200 for an out-of-window free-form send WITHOUT actually
  // delivering it, so we decide up front from our own inbound-message history
  // rather than trust a successful-looking response. Outside the window, the
  // staff member's message goes out as the {{1}} body param of the approved
  // re-engagement template instead — same template n8n uses for this exact
  // purpose — so composing a reply never silently fails to reach the customer.
  const reengageTemplate = process.env.WHATSAPP_REENGAGE_TEMPLATE?.trim()
  if (reengageTemplate) {
    const open = await isWithin24hWindow(phone)
    if (open === false) {
      try {
        const result = await sendViaMetaTemplate({
          to: phone,
          templateName: reengageTemplate,
          lang: process.env.WHATSAPP_REENGAGE_TEMPLATE_LANG?.trim() || 'en',
          bodyParams: [text],
        })
        if (!result) return buildApiError('No WhatsApp credentials configured', 500)
        await prisma.whatsAppMessage.create({
          data: {
            bookingRef,
            phone,
            direction:   'outbound',
            body:        text, // the agent's original text, not "[template …]" — history reads naturally
            waMessageId: (result.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
            status:      'sent',
            senderName,
          },
        })
        return buildApiSuccess(result, `Sent to ${phone} via re-engagement template (outside 24h window)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[WhatsApp] re-engagement template send failed:', msg)
        return buildApiError(msg, 502)
      }
    }
  }

  try {
    const metaResult = await sendViaMetaApi({ to: phone, message })
    if (metaResult) {
      await prisma.whatsAppMessage.create({
        data: {
          bookingRef,
          phone,
          direction:   'outbound',
          body:        message,
          waMessageId: (metaResult.text as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
          status:      'sent',
          senderName,
        },
      })
      return buildApiSuccess(metaResult, `Sent to ${phone}`)
    }

    const proxyResult = await sendViaNotifyProxy({ to: phone, message })
    if (proxyResult) {
      await prisma.whatsAppMessage.create({
        data: { bookingRef, phone, direction: 'outbound', body: message, status: 'sent', senderName },
      })
      return buildApiSuccess(proxyResult, `Sent to ${phone}`)
    }

    return buildApiError('No WhatsApp credentials configured', 500)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp] global send failed:', msg)
    return buildApiError(msg, 502)
  }
}
