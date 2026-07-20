import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { sendViaMetaTemplate, normalisePhone } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

// Approved "please reply to us" opener template. It carries {{1}} = customer
// first name and {{2}} = booking ref, and delivers OUTSIDE the 24h window (a
// template does). Staff send this to a cold customer so the customer replies,
// which reopens the 24h window — only then can the full Tour Confirmation
// (dynamic text + PDF, which can't be a template) be sent free-form.
const OPENER_TEMPLATE      = process.env.WHATSAPP_BOOKING_OPENER_TEMPLATE?.trim() || 'apple_holidays_booking_update'
const OPENER_TEMPLATE_LANG = process.env.WHATSAPP_BOOKING_OPENER_TEMPLATE_LANG?.trim() || 'en'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name } = await req.json() as { to: string; name?: string }
  const phone = normalisePhone(to || '')
  if (!phone) return buildApiError('Phone number is required')

  const firstName  = ((name || '').trim().split(/\s+/)[0]) || 'there'
  const senderName = session.user.name ?? session.user.email ?? 'Staff'

  try {
    // Meta-only: the opener MUST carry the approved Apple Holidays template, so it
    // can't fall back to the (free-form) notify proxy. Requires the booking
    // server's WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID (Aahaas Operations).
    const result = await sendViaMetaTemplate({
      to:           phone,
      templateName: OPENER_TEMPLATE,
      lang:         OPENER_TEMPLATE_LANG,
      bodyParams:   [firstName, params.ref],
    })
    if (!result) {
      return buildApiError('WhatsApp Meta credentials are not configured on the server — set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID (Aahaas Operations).', 500)
    }

    await prisma.whatsAppMessage.create({
      data: {
        bookingRef:  params.ref,
        phone,
        direction:   'outbound',
        body:        `[Reply request sent] Asked ${firstName} to message us so we can share booking ${params.ref} details.`,
        waMessageId: (result.template as { messages?: Array<{ id?: string }> })?.messages?.[0]?.id ?? null,
        status:      'sent',
        senderName,
      },
    })

    return buildApiSuccess(
      result,
      `Reply request sent to ${phone}. Once the customer replies, send them the full Tour Confirmation.`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[WhatsApp opener] send failed:', msg)
    return buildApiError(msg, 502)
  }
}
