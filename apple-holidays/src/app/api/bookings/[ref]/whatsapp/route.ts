import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'

const WHATSAPP_API = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['TE_USER', 'BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const { to, name, message, attachPdf } = await req.json() as {
    to: string
    name: string
    message: string
    attachPdf?: boolean
  }

  if (!to || !message) return buildApiError('Phone number and message are required')

  const notifySecret = process.env.WHATSAPP_NOTIFY_SECRET
  if (!notifySecret) return buildApiError('WHATSAPP_NOTIFY_SECRET not configured', 500)

  const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '')

  const payload: Record<string, unknown> = { to, name, message }

  if (attachPdf && appUrl) {
    payload.files = [
      {
        url:      `${appUrl}/print/booking/${params.ref}`,
        filename: `AppleHolidays-${params.ref}-TourDetails.pdf`,
        caption:  'Your tour details from Apple Holidays',
      },
    ]
  }

  const res = await fetch(WHATSAPP_API, {
    method:  'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-notify-secret': notifySecret,
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()
  let json: unknown
  try { json = JSON.parse(text) } catch { json = { raw: text } }

  if (!res.ok) {
    console.error('[WhatsApp] send failed:', res.status, text.slice(0, 500))
    return buildApiError(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`, 502)
  }

  return buildApiSuccess(json, `WhatsApp message sent to ${to}`)
}
