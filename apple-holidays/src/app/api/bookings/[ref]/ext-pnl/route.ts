import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { findPnlByIdentifiers, fetchPnlById } from '@/lib/accounts-db'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
/** GET — return the cached external PNL link for a booking. If none exists,
 *  attempt auto-linking by matching booking identifiers against the Accounts DB. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, isNumber: true, bookingRef: true, agentBookingId: true, externalPnlLink: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  // If already linked, return cached data
  if (booking.externalPnlLink) {
    return buildApiSuccess(booking.externalPnlLink)
  }

  // Try to auto-link now
  try {
    const match = await findPnlByIdentifiers({
      isNumber:      booking.isNumber,
      tourRef:       booking.bookingRef,
      invoiceNumber: booking.agentBookingId,
    })

    if (!match) return buildApiSuccess(null)

    const full = await fetchPnlById(match.record.id)
    if (!full) return buildApiSuccess(null)

    const link = await prisma.externalPnlLink.create({
      data: {
        bookingId:     booking.id,
        externalPnlId: match.record.id,
        matchedBy:     match.matchedBy,
        matchedValue:  match.matchedValue,
        cachedRecord:  full.record as object,
        cachedItems:   full.items as object[],
        lastFetchedAt: new Date(),
      },
    })
    return buildApiSuccess(link)
  } catch (err) {
    // External DB may be unreachable — return null without crashing
    console.error('[ext-pnl] auto-link failed:', err)
    return buildApiSuccess(null)
  }
}

/** DELETE — remove the external PNL link from a booking. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)) {
    return buildApiError('Forbidden', 403)
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  await prisma.externalPnlLink.deleteMany({ where: { bookingId: booking.id } })
  return buildApiSuccess({ unlinked: true })
}
