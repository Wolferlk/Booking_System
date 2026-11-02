/** WhatsApp inbox — message-count report for a date range (?from&to ISO, &tz = getTimezoneOffset()). */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import { buildMessageReport, REPORT_MAX_DAYS } from '@/lib/whatsapp-message-report'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return buildApiError('Forbidden', 403)
  }

  const q = req.nextUrl.searchParams
  const from = new Date(q.get('from') ?? '')
  const to = new Date(q.get('to') ?? '')
  const tz = Number(q.get('tz') ?? 0)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return buildApiError('from and to must be ISO dates, from before to')
  }
  if (to.getTime() - from.getTime() > REPORT_MAX_DAYS * 86400000) {
    return buildApiError(`A report covers at most ${REPORT_MAX_DAYS} days`)
  }
  if (!Number.isFinite(tz) || Math.abs(tz) > 14 * 60) return buildApiError('tz is out of range')

  return buildApiSuccess(await buildMessageReport(from, to, tz, session.user.role))
}
