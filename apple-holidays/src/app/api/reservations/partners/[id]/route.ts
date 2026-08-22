/**
 * GET /api/reservations/partners/:id — Hotel Partner 360.
 *
 * The profile and its channels come from the existing hotel directory; this
 * route adds the trading history the Reservation Team accumulates against it.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation } from '@/lib/reservation-guard'
import { getPartnerStats } from '@/lib/reservations'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  const [profile, stats, contracts, recent] = await Promise.all([
    prisma.hotelProfile.findUnique({ where: { id: params.id }, include: { channels: true } }),
    getPartnerStats(params.id),
    prisma.hotelContract.findMany({
      where: { hotelProfileId: params.id },
      include: { rates: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { validFrom: 'desc' },
    }),
    prisma.hotelReservation.findMany({
      where: { hotelProfileId: params.id },
      orderBy: { checkIn: 'desc' },
      take: 25,
      select: {
        id: true, bookingRef: true, checkIn: true, checkOut: true, status: true,
        currency: true, totalCost: true, confirmationNumber: true,
      },
    }),
  ])

  if (!profile) return buildApiError('Hotel profile not found', 404)
  return buildApiSuccess({ profile, stats, contracts, recent })
}
