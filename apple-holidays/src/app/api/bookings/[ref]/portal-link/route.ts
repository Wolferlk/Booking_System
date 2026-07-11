/**
 * Returns the signed, auth-free customer trip portal link for a booking.
 * Staff-only: the token itself is what makes the public /trip page reachable,
 * so it is minted here behind the normal session guard.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { portalLinkPath, portalLinkToken } from '@/lib/portal-link'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  return buildApiSuccess({
    path: portalLinkPath(booking.bookingRef),
    token: portalLinkToken(booking.bookingRef),
  })
}
