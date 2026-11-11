import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { sendDailyBriefingForBooking } from '@/lib/customer-whatsapp-automation'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ALLOWED: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** Bulk daily-plan sender for the filtered/selected MC Report movements. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as { rows?: { bookingRef: string; date: string }[] } | null
  const rows = Array.isArray(body?.rows)
    ? body!.rows.filter(r => r && typeof r.bookingRef === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).slice(0, 100)
    : []
  if (!rows.length) return buildApiError('Select at least one movement')

  const results: { bookingRef: string; date: string; ok: boolean; reason?: string }[] = []
  for (const row of rows) {
    try {
      const sent = await sendDailyBriefingForBooking(row.bookingRef, row.date, { force: true, allowEmpty: true })
      results.push({ bookingRef: row.bookingRef, date: row.date, ok: sent.ok, ...(sent.ok ? {} : { reason: sent.reason }) })
    } catch (err) {
      results.push({ bookingRef: row.bookingRef, date: row.date, ok: false, reason: err instanceof Error ? err.message : 'Send failed' })
    }
  }
  const sent = results.filter(r => r.ok).length
  return buildApiSuccess({ results, sent, failed: results.length - sent }, `${sent} daily plan${sent === 1 ? '' : 's'} sent`)
}
