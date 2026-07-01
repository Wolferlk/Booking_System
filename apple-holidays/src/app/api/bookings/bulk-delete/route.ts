import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role !== 'SUPER_ADMIN' && role !== 'ULTRA_SUPER_ADMIN') {
    return buildApiError('Only Super Admin can delete bookings', 403)
  }

  const body = await req.json().catch(() => ({}))
  const refs: string[] = Array.isArray(body.bookingRefs) ? body.bookingRefs : []

  if (refs.length === 0) return buildApiError('No booking refs provided', 400)
  if (refs.length > 100) return buildApiError('Cannot delete more than 100 bookings at once', 400)

  const bookings = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: { id: true, bookingRef: true, status: true },
  })

  if (bookings.length === 0) return buildApiError('No matching bookings found', 404)

  await prisma.booking.deleteMany({ where: { bookingRef: { in: refs } } })

  await logActivity({
    userId: session.user.id,
    action: ACTION.BOOKING_DELETED,
    entityType: 'Booking',
    entityId: 'bulk',
    details: { bookingRefs: bookings.map(b => b.bookingRef), count: bookings.length },
  })

  return buildApiSuccess(
    { deleted: bookings.length },
    `${bookings.length} booking${bookings.length !== 1 ? 's' : ''} permanently deleted`,
  )
}
