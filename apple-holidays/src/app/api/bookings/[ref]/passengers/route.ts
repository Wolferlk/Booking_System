import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES: UserRole[] = ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// PATCH /api/bookings/[ref]/passengers
// Body: { updates: [{ id: string, mealPreference: string | null }] }
export async function PATCH(req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ALLOWED_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const body = await req.json() as { updates: { id: string; mealPreference: string | null }[] }
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    return buildApiError('updates array is required')
  }

  await Promise.all(
    body.updates.map(u =>
      prisma.passenger.update({
        where: { id: u.id },
        data: { mealPreference: u.mealPreference || null },
      })
    )
  )

  return buildApiSuccess(null, 'Meal preferences saved')
}
