/**
 * POST /api/driver-app/templates — submit the Driver App sign-in code template
 * (`aahaas_driver_app_code`) to Meta. AUTHENTICATION category with a
 * copy-code button: Meta writes the body text itself ("<code> is your
 * verification code…"), so there is nothing to word here. Admins only.
 * A name that already exists comes back as Meta's error.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { DRIVER_APP_CODE_LANG, TEMPLATE_DRIVER_APP_CODE } from '@/lib/mobile/otp'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Admins only', 403)
  const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim()
  if (!token || !waba) return buildApiError('WHATSAPP_ACCESS_TOKEN / WHATSAPP_BUSINESS_ACCOUNT_ID not configured', 500)
  const version = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
  const res = await fetch(`https://graph.facebook.com/${version}/${waba}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: TEMPLATE_DRIVER_APP_CODE,
      language: DRIVER_APP_CODE_LANG,
      category: 'AUTHENTICATION',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 10 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    }),
  })
  const json = await res.json().catch(() => null) as { id?: string; status?: string; error?: { message?: string } } | null
  if (!res.ok) return buildApiError(json?.error?.message || `Meta ${res.status}`, 502)
  return buildApiSuccess({ name: TEMPLATE_DRIVER_APP_CODE, id: json?.id ?? null, status: json?.status ?? 'PENDING' })
}
