/** Global WhatsApp inbox — send a plain text reply to any phone number. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { sendViaMetaApi, sendViaMetaTemplate, sendViaNotifyProxy, findBookingByPhone, normalisePhone, isWithin24hWindow, WHATSAPP_STAFF_ROLES, canAccessWhatsAppPhone } from '@/lib/whatsapp'
import { sendGuestMessageTemplate, GuestTemplateUnavailableError } from '@/lib/guest-message-template'
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
  if (!(await canAccessWhatsAppPhone(session.user.role, phone))) {
    return buildApiError('This chat is outside your country scope', 403)
  }

  const senderName = session.user.name ?? session.user.email ?? 'Staff'
  const booking = await findBookingByPhone(phone)
  const bookingRef = booking ? booking.bookingRef : `UNKNOWN:${phone}`
  const text = message.trim()

  // PROACTIVE 24h-window decision — mirrors n8n-project's WhatsAppService.sendText():
  // Meta returns 200 for an out-of-window free-form send and then drops it with a
  // `failed` receipt (131047), so we decide up front from our own inbound-message
  // history rather than trust a successful-looking response. Outside the window
  // the text must ride a template; if none can carry it we refuse, so the desk
  // sees why instead of a red "Not delivered" bubble a minute later.
  if (!(await isWithin24hWindow(phone))) {
    // 1. A booking's guest: the guest-message template carries the desk's own text.
    //    Not for an agent's number — that template greets the guest by name.
    const isGuest = !!booking &&
      [booking.contactWhatsapp, booking.contactPhone].some(p => p && normalisePhone(p) === phone)
    if (booking && isGuest) {
      try {
        const lead = await prisma.passenger.findFirst({
          where:  { bookingId: booking.id, isLead: true },
          select: { name: true },
        })
        const sent = await sendGuestMessageTemplate({
          to: phone, guestName: lead?.name ?? 'Guest', bookingRef, text,
        })
        for (const part of sent.sent) {
          await prisma.whatsAppMessage.create({
            data: {
              bookingRef, phone: sent.phone, direction: 'outbound',
              body: part.text, waMessageId: part.waMessageId, status: 'sent', senderName,
            },
          })
        }
        // A later part failed: the guest has the start, so the rest waits for their reply.
        if (sent.unsent) {
          await prisma.whatsAppMessage.create({
            data: {
              bookingRef, phone: sent.phone, direction: 'outbound',
              body: sent.unsent, status: 'pending', senderName,
            },
          })
        }
        const parts = sent.sent.length
        return buildApiSuccess(
          { channel: 'guest-template', parts, queued: Boolean(sent.unsent) },
          sent.unsent
            ? `Sent ${parts} part${parts === 1 ? '' : 's'} via approved template (outside 24h window); the rest is queued until the guest replies`
            : `Sent to ${phone} via approved template (outside 24h window)`,
        )
      } catch (err) {
        if (!(err instanceof GuestTemplateUnavailableError)) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error('[WhatsApp] guest template send failed:', msg)
          return buildApiError(msg, 422)
        }
        console.warn('[WhatsApp] guest template unavailable, trying re-engagement template:', err.message)
      }
    }

    // 2. The re-engagement template, when this deployment has one configured.
    const reengageTemplate = process.env.WHATSAPP_REENGAGE_TEMPLATE?.trim()
    if (reengageTemplate) {
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
        return buildApiSuccess(result, `Sent to ${phone} via approved template (outside 24h window)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[WhatsApp] re-engagement template send failed:', msg)
        return buildApiError(msg, 422)
      }
    }

    // 3. Nothing can carry it. Free-form text would be accepted and then dropped.
    return buildApiError(
      'Not sent: this chat is outside the 24h window, so WhatsApp drops plain text. ' +
      'Use "Send template" above to reach them, then reply once they answer.',
      422,
    )
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
