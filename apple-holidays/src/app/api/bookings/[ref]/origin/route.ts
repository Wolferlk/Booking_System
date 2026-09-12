/**
 * Who filed this booking, when, and where it came in from.
 *
 * Kept off the main booking payload deliberately: it is six extra lookups
 * across the activity log, the mailbox, the drive events and the version trail,
 * and the booking page already carries enough. It is fetched when somebody asks
 * the question. See `lib/booking-origin.ts` for why `createdBy` alone is not
 * the answer.
 *
 * Country scoping matches the booking route — a user who cannot see the booking
 * cannot see where it came from either.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { resolveBookingOrigin } from '@/lib/booking-origin'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  // Provenance is staff-facing: it names internal accounts, mailboxes and IPs.
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      id: true, bookingRef: true, createdAt: true, createdById: true,
      isNumber: true, agentBookingId: true, sourceDocName: true, sourceDocUrl: true,
      operationCountry: true,
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) return buildApiError('Forbidden', 403)
  }

  try {
    return buildApiSuccess(await resolveBookingOrigin({
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      createdAt: booking.createdAt,
      isNumber: booking.isNumber,
      agentBookingId: booking.agentBookingId,
      sourceDocName: booking.sourceDocName,
      sourceDocUrl: booking.sourceDocUrl,
      createdById: booking.createdById,
    }))
  } catch (err) {
    console.error('[GET /api/bookings/[ref]/origin]', err)
    return buildApiError('Could not work out where this booking came from', 500)
  }
}
