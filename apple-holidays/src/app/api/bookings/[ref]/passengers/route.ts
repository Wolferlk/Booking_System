import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { loadPassengerNotes } from '@/lib/passenger-notes'

export const dynamic = 'force-dynamic'
const ALLOWED_ROLES: UserRole[] = ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

// GET /api/bookings/[ref]/passengers → { passengers, notes }
// Read-only and light: lets the agenda page pick up meal preferences and
// Special Notes edited on the booking page without reloading the whole booking.
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: {
      operationCountry: true,
      passengers: {
        select: {
          id: true, name: true, type: true, age: true, isLead: true, mealPreference: true,
          passport: true, nationality: true, contact: true,
        },
      },
      // Hotel meal plans are edited on the booking page too.
      accommodations: {
        orderBy: { checkIn: 'asc' },
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true },
      },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL'
    && !isInCountryScope(booking.operationCountry, userCountry)) {
    return buildApiError('Forbidden', 403)
  }

  return buildApiSuccess({
    passengers: booking.passengers,
    accommodations: booking.accommodations,
    notes: await loadPassengerNotes(params.ref),
  })
}

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

  // Each write is pinned to (passenger id AND this booking), so a stale or
  // tampered id can never touch another booking's passenger.
  const results = await Promise.all(
    body.updates
      .filter(u => u && typeof u.id === 'string' && u.id)
      .map(u =>
        prisma.passenger.updateMany({
          where: { id: u.id, bookingId: booking.id },
          data: { mealPreference: String(u.mealPreference ?? '').trim().slice(0, 191) || null },
        })
      )
  )
  const saved = results.reduce((n, r) => n + r.count, 0)
  if (saved === 0) return buildApiError('Passenger not found — reload the booking', 404)

  return buildApiSuccess({ saved }, 'Meal preferences saved')
}
