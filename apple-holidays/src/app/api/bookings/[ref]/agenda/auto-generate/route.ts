/**
 * Agenda page ↔ background auto-generate.
 *
 * GET  — the run's status for this booking, plus when the sweep will pick it up
 *        if it has not started yet. The page polls this while the chart is built.
 * POST — "build it now if it isn't built". Goes through the same per-booking
 *        claim as the sweep: if the sweep is already building this chart, it
 *        returns the running status at once instead of starting a second AI call.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/rbac'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import {
  autoGenerateAgenda, readAutoGenStatus, isAutoGenEnabled,
  AUTOGEN_DELAY_SEC, AUTOGEN_WINDOW_HRS,
} from '@/lib/agenda-auto-generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { createdAt: true, tourAgenda: { select: { _count: { select: { items: true } } } } },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const [status, enabled] = await Promise.all([readAutoGenStatus(params.ref), isAutoGenEnabled()])
  const created = booking.createdAt.getTime()
  const inWindow = Date.now() - created < AUTOGEN_WINDOW_HRS * 3_600_000

  return buildApiSuccess({
    status,
    enabled,
    chartItems: booking.tourAgenda?._count.items ?? 0,
    createdAt: booking.createdAt.toISOString(),
    // When the background sweep will reach this booking (null = it won't).
    scheduledAt: enabled && inWindow ? new Date(created + AUTOGEN_DELAY_SEC * 1000).toISOString() : null,
  })
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'agenda:create')) return buildApiError('Forbidden', 403)

  const status = await autoGenerateAgenda(params.ref, 'page-open')
  return buildApiSuccess({ status })
}
