import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendDriverLog } from '@/lib/driver-log-notify'

export const dynamic = 'force-dynamic'

const SEND_ROLES = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** POST — send the Driver Advance Sheet (text + PDF) to the driver on WhatsApp. */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!SEND_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const { phone } = await req.json().catch(() => ({})) as { phone?: string }

  const senderTag = `[DRIVER-LOG] ${session.user.name ?? session.user.email ?? 'Staff'}`
  const res = await sendDriverLog(params.ref, { phoneOverride: phone ?? null, senderTag })

  if (!res.ok) {
    return buildApiError(res.reason ?? 'Failed to send Driver Log', 502)
  }
  const how = res.channel === 'template' ? ' (template + PDF)' : ' with PDF'
  return buildApiSuccess(
    { phone: res.phone, channel: res.channel },
    `Driver Advance Sheet sent to ${res.phone}${how}`,
  )
}
