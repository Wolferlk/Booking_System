import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchPnlById } from '@/lib/accounts-db'
import type { UserRole } from '@prisma/client'

/** POST { externalPnlId: number } — manually link a booking to a specific
 *  external PNL record by ID.  Replaces any existing link. */
export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => null)
  const externalPnlId = Number(body?.externalPnlId)
  if (!externalPnlId || isNaN(externalPnlId)) {
    return buildApiError('externalPnlId is required', 400)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  try {
    const full = await fetchPnlById(externalPnlId)
    if (!full) return buildApiError('External PNL record not found', 404)

    const link = await prisma.externalPnlLink.upsert({
      where: { bookingId: booking.id },
      create: {
        bookingId:     booking.id,
        externalPnlId: full.record.id,
        matchedBy:     'manual',
        matchedValue:  String(full.record.id),
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
      update: {
        externalPnlId: full.record.id,
        matchedBy:     'manual',
        matchedValue:  String(full.record.id),
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
    })
    return buildApiSuccess(link)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'External DB unreachable'
    return buildApiError(msg, 502)
  }
}
