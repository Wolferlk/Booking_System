import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
/**
 * DELETE /api/onedrive/remove?ref=VN19866[&deleteBooking=true]
 *
 * Removes all OneDriveEvent records for the given bookingRef so the entry
 * disappears from the Drive Bookings explorer.
 * When deleteBooking=true also hard-deletes the booking record from the DB.
 * Requires SUPER_ADMIN or ULTRA_SUPER_ADMIN.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role !== 'SUPER_ADMIN' && role !== 'ULTRA_SUPER_ADMIN') {
    return buildApiError('Forbidden', 403)
  }

  const { searchParams } = new URL(req.url)
  const ref           = searchParams.get('ref')?.trim().toUpperCase()
  const deleteBooking = searchParams.get('deleteBooking') === 'true'

  if (!ref) return buildApiError('ref is required')

  // Remove all OneDrive events for this ref
  const { count } = await prisma.oneDriveEvent.deleteMany({ where: { bookingRef: ref } })

  let bookingDeleted = false
  if (deleteBooking) {
    const booking = await prisma.booking.findUnique({ where: { bookingRef: ref } })
    if (booking) {
      await prisma.booking.delete({ where: { bookingRef: ref } })
      await logActivity({
        userId:     session.user.id,
        action:     ACTION.BOOKING_DELETED,
        entityType: 'Booking',
        entityId:   ref,
        details:    { bookingRef: ref, source: 'drive-bookings-remove', status: booking.status },
      })
      bookingDeleted = true
    }
  }

  return buildApiSuccess(
    { eventsRemoved: count, bookingDeleted },
    bookingDeleted
      ? `Booking ${ref} and ${count} drive event(s) removed`
      : `${count} drive event(s) removed for ${ref}`,
  )
}
