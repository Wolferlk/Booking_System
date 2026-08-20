/**
 * GET /api/srilanka/drive-log/driver?driverId=… — the whole driver, on demand.
 *
 * The Drive Log rows already carry the name, phone, vehicle and bank details,
 * because the columns and the downloads need them. This route is for the panel
 * that opens when a name is clicked, and it adds only what a list has no
 * business carrying for every row: the vehicle photographs, the running advance
 * balance the ground team keeps against the driver, and the other Sri Lankan
 * files he is on either side of today.
 *
 * That last part is the reason the panel exists. "What else is this driver
 * carrying this week" is the question that decides whether one transfer settles
 * three bookings, and it cannot be answered from a single row.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { dayKey, shiftDay } from '@/lib/sl-drive-log'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/** How far either side of today the driver's other files are listed. */
const PAST_DAYS = 30
const FUTURE_DAYS = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const driverId = (req.nextUrl.searchParams.get('driverId') ?? '').trim()
  if (!driverId) return buildApiError('driverId is required', 400)

  const today = dayKey()

  try {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true, name: true, phone: true, email: true, licenseNo: true,
        isActive: true, photoUrl: true, country: true, advanceBalance: true,
        createdAt: true,
        bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true,
        vehicle: {
          select: {
            id: true, type: true, plateNo: true, brand: true, model: true,
            capacity: true, description: true, isActive: true,
            photoInside: true, photoOutside: true,
          },
        },
        vendorOwner: { select: { id: true, name: true, phone: true, email: true } },
      },
    })

    if (!driver) return buildApiError('Driver not found', 404)

    // Both ways a driver ends up on a file: allocated on the board, or named on
    // a movement. A driver carried only by the chart would otherwise show an
    // empty schedule here while plainly being out on the road.
    const bookings = await prisma.booking.findMany({
      where: {
        operationCountry: 'SRILANKA',
        status: { not: 'CANCELLED' },
        arrivalDate: {
          gte: new Date(`${shiftDay(today, -PAST_DAYS)}T00:00:00.000Z`),
          lte: new Date(`${shiftDay(today, FUTURE_DAYS)}T23:59:59.999Z`),
        },
        OR: [
          { slDriverAllocation: { driverId } },
          { tourAgenda: { items: { some: { assignment: { driverId } } } } },
        ],
      },
      select: {
        id: true, bookingRef: true, isNumber: true, cntlNumber: true,
        arrivalDate: true, departureDate: true, status: true,
        paxAdults: true, paxChildren: true,
        passengers: { where: { isLead: true }, take: 1, select: { name: true } },
      },
      orderBy: { arrivalDate: 'asc' },
      take: 100,
    })

    return buildApiSuccess({
      driver: {
        ...driver,
        // Decimal does not survive JSON; the panel wants a number it can print.
        advanceBalance: Number(driver.advanceBalance ?? 0),
      },
      bookings: bookings.map(b => ({
        id: b.id,
        bookingRef: b.bookingRef,
        isNumber: b.isNumber,
        cntlNumber: b.cntlNumber,
        arrivalDate: b.arrivalDate.toISOString().slice(0, 10),
        departureDate: b.departureDate ? b.departureDate.toISOString().slice(0, 10) : null,
        status: b.status,
        pax: (b.paxAdults ?? 0) + (b.paxChildren ?? 0),
        clientName: b.passengers[0]?.name ?? null,
      })),
      window: { from: shiftDay(today, -PAST_DAYS), to: shiftDay(today, FUTURE_DAYS) },
    })
  } catch (err) {
    console.error('[drive-log/driver]', err)
    return buildApiError('Failed to load the driver', 500)
  }
}
