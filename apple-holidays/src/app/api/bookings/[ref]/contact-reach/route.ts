/**
 * GET — what the guest's WhatsApp number currently drives on this booking:
 * daily trip plan (time + timezone), feedback request, and the AI-call service
 * (registered? which number does it dial?). Read-only; sends nothing.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { getContactReach } from '@/lib/contact-reach'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { bookingRef: true, operationCountry: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL' &&
      !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  return buildApiSuccess(await getContactReach(booking))
}
