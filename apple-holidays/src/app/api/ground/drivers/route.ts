import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { logActivity, ACTION } from '@/lib/activity'
import { countryScope } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = new URL(req.url)
  const date           = searchParams.get('date')          // YYYY-MM-DD — check availability for this date
  const excludeBooking = searchParams.get('excludeRef')    // booking ref to exclude from busy check

  const userCountry = session.user.country as OperationCountry | undefined
  const countryOverride = searchParams.get('country') as OperationCountry | null
  const effectiveCountry = (!userCountry || userCountry === 'ALL') ? countryOverride : userCountry
  const countryWhere = effectiveCountry ? { country: { in: countryScope(effectiveCountry)! } } : {}

  let drivers
  try {
    drivers = await prisma.driver.findMany({
      where: countryWhere,
      include: { vehicle: { include: { vendor: true } } },
      orderBy: { name: 'asc' },
    })
  } catch (err) {
    console.error('[drivers GET] Prisma error:', err)
    return buildApiError('Failed to load drivers', 500)
  }

  if (!date) return buildApiSuccess(drivers)

  // Find all assignments on this date, optionally excluding a specific booking
  const dayStart = new Date(date)
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setHours(23, 59, 59, 999)

  const busyAssignments = await prisma.assignment.findMany({
    where: {
      driverId: { not: null },
      agendaItem: {
        date: { gte: dayStart, lte: dayEnd },
        ...(excludeBooking
          ? {
              agenda: {
                booking: { bookingRef: { not: excludeBooking } },
              },
            }
          : {}),
      },
    },
    select: {
      driverId:  true,
      agendaItem: {
        select: {
          date: true,
          agenda: { select: { booking: { select: { bookingRef: true } } } },
        },
      },
    },
  })

  const busyDriverIds = new Set(busyAssignments.map(a => a.driverId!))
  const busyBookingMap: Record<string, string[]> = {}
  for (const a of busyAssignments) {
    const did = a.driverId!
    const bRef = a.agendaItem.agenda?.booking?.bookingRef ?? 'another booking'
    if (!busyBookingMap[did]) busyBookingMap[did] = []
    if (!busyBookingMap[did].includes(bRef)) busyBookingMap[did].push(bRef)
  }

  const enriched = drivers.map(d => ({
    ...d,
    isBusyOnDate: busyDriverIds.has(d.id),
    busyBookings: busyBookingMap[d.id] ?? [],
  }))

  return buildApiSuccess(enriched)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json()
  const { name, phone, email, licenseNo, vehicleId, bankName, bankAccountNo, bankHolder, bankBranch, bankCode, isActive, photoUrl, country } = body
  if (!name || !phone) return buildApiError('name and phone are required')

  // Non-ALL users can only create drivers for their own country
  const userCountry = session.user.country as OperationCountry | undefined
  const driverCountry = (!userCountry || userCountry === 'ALL') ? (country || null) : userCountry

  const driver = await prisma.driver.create({
    data: {
      name, phone,
      email:        email        || null,
      licenseNo:    licenseNo    || null,
      isActive:     isActive     ?? true,
      photoUrl:     photoUrl     || null,
      vehicleId:    vehicleId    || null,
      country:      driverCountry || null,
      bankName:     bankName     || null,
      bankAccountNo: bankAccountNo || null,
      bankHolder:   bankHolder   || null,
      bankBranch:   bankBranch   || null,
      bankCode:     bankCode     || null,
    },
    include: { vehicle: { include: { vendor: true } } },
  })

  await logActivity({
    userId: session.user.id,
    action: ACTION.DRIVER_CREATED,
    entityType: 'Driver',
    entityId: driver.id,
    details: { name: driver.name },
  })

  return buildApiSuccess(driver, 'Driver added')
}
