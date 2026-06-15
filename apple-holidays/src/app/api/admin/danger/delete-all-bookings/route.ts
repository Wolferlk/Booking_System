import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { logActivity, ACTION } from '@/lib/activity'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // ── Auth: SUPER_ADMIN only ───────────────────────────────────────────────
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role !== 'SUPER_ADMIN') return buildApiError('Forbidden — Super Admin only', 403)

  // ── Validate critical password ───────────────────────────────────────────
  const { password } = (await req.json()) as { password?: string }

  const criticalPassword = process.env.CRITICAL_OPS_PASSWORD
  if (!criticalPassword) return buildApiError('Critical operations password is not configured on the server', 500)
  if (!password || password !== criticalPassword) {
    return buildApiError('Incorrect critical operations password', 403)
  }

  // ── Count before deletion ────────────────────────────────────────────────
  const totalBefore = await prisma.booking.count()

  // ── Delete all bookings (all child tables cascade automatically) ──────────
  await prisma.booking.deleteMany({})

  // ── Audit log ────────────────────────────────────────────────────────────
  await logActivity({
    userId:     session.user.id,
    action:     ACTION.BOOKING_DELETED,
    entityType: 'System',
    entityId:   'all-bookings',
    details:    {
      operation:     'DELETE_ALL_BOOKINGS',
      deletedCount:  totalBefore,
      performedBy:   session.user.email,
      performedAt:   new Date().toISOString(),
    },
  })

  return buildApiSuccess(
    { deletedCount: totalBefore },
    `${totalBefore} booking${totalBefore !== 1 ? 's' : ''} permanently deleted`,
  )
}
