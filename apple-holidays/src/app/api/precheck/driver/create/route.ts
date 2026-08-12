import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { OperationCountry } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { handlePrismaApiError } from '@/lib/prisma-error'
import { guardPrecheck } from '@/lib/precheck-guard'
import { normalisePhone } from '@/lib/whatsapp'
import { logActivity, ACTION } from '@/lib/activity'

export const dynamic = 'force-dynamic'

/**
 * POST /api/precheck/driver/create — register a driver who is not in the system.
 *
 * Writes a real row to `drivers`, exactly as the Ground Team's driver manager
 * does. That is the point: the driver has to be allocatable to *any* booking
 * afterwards, not just this one. Two fields make that true —
 *
 *   - `isActive: true`  — inactive drivers are filtered out of every picker
 *   - `country`         — inherited from the booking (or the chosen vendor),
 *                         because the allocation boards are country-scoped and
 *                         a driver with no country shows up in the wrong lists
 *
 * The driver is created only; assigning them to the movement is a second call
 * to /assign, so a half-finished form can never leave an agenda item pointing
 * at a driver row that failed to save.
 */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard
  const authSession = await getServerSession(authOptions)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const s = (v: unknown) => (v == null || String(v).trim() === '' ? null : String(v).trim())

  const name = s(body.name)
  const phone = s(body.phone)
  if (!name)  return buildApiError('A driver name is required')
  if (!phone) return buildApiError('A phone number is required — without one no briefing can be sent')

  const bookingRef = s(body.bookingRef)

  // Country: the booking's, then the vendor's, then whatever was passed.
  let country: OperationCountry | null = null
  if (bookingRef) {
    const booking = await prisma.booking.findUnique({
      where: { bookingRef },
      select: { operationCountry: true },
    })
    if (!booking) return buildApiError('Booking not found', 404)
    if (session.countries && !(booking.operationCountry && session.countries.includes(booking.operationCountry))) {
      return buildApiError('Forbidden — this booking is outside your country scope', 403)
    }
    country = booking.operationCountry
  }

  const vendorId = s(body.vendorId)
  if (!country && vendorId) {
    const vendor = await prisma.vehicleVendor.findUnique({ where: { id: vendorId }, select: { country: true } })
    if (!vendor) return buildApiError('Selected vendor not found', 400)
    country = vendor.country
  }
  if (!country) country = (s(body.country) as OperationCountry | null) ?? null

  // A driver already on file under this number is an edit, not a duplicate —
  // duplicated drivers are what makes the allocation boards untrustworthy.
  //
  // Numbers are stored however they were typed ("077 123 4567", "+94771234567"),
  // so SQL narrows on the last nine digits — enough to be selective, short
  // enough to survive any country-code or trunk-prefix spelling — and the
  // authoritative comparison is done on the normalised form.
  const wanted = normalisePhone(phone)
  const tail = phone.replace(/\D/g, '').slice(-9)
  const existing = tail.length < 6 ? undefined : (await prisma.driver.findMany({
    where: { phone: { contains: tail } },
    select: { id: true, name: true, phone: true, isActive: true },
    take: 25,
  })).find(d => normalisePhone(d.phone) === wanted)

  if (existing) {
    return buildApiSuccess(
      { driver: existing, duplicate: true },
      `${existing.name} is already registered on this number — select them instead.`,
    )
  }

  try {
    const driver = await prisma.driver.create({
      data: {
        name,
        phone,
        email:     s(body.email),
        licenseNo: s(body.licenseNo),
        vendorId,
        country,
        // Allocatable from the moment it is saved.
        isActive: true,
      },
      select: { id: true, name: true, phone: true, isActive: true, country: true },
    })

    if (authSession?.user?.id) {
      await logActivity({
        userId: authSession.user.id,
        action: ACTION.DRIVER_CREATED,
        entityType: 'Driver',
        entityId: driver.id,
        details: { name: driver.name, via: 'pre-checking', bookingRef },
      })
    }

    return buildApiSuccess({ driver, duplicate: false }, `${driver.name} added and available for allocation`)
  } catch (error) {
    return handlePrismaApiError(error, 'Failed to add the driver', 'A driver with these details already exists')
  }
}
