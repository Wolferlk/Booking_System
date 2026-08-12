import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardPrecheck } from '@/lib/precheck-guard'
import { buildDriverPrecheck } from '@/lib/driver-precheck'
import { normalisePhone } from '@/lib/whatsapp'
import { logActivity, ACTION } from '@/lib/activity'

export const dynamic = 'force-dynamic'

interface AssignBody {
  bookingRef: string
  /** Movement to assign. Ignored when `applyToAll` is set. */
  agendaItemId?: string
  /** Link to a registered driver, or null to keep the assignment ad-hoc. */
  driverId?: string | null
  driverName?: string | null
  driverPhone?: string | null
  vehicleType?: string | null
  vehiclePlate?: string | null
  driverRate?: number | null
  rateCurrency?: string | null
  notes?: string | null
  /** Apply to every movement on the booking that still needs a driver. */
  applyToAll?: boolean
  /** Also write the phone back to the registered driver's master record. */
  syncMaster?: boolean
  /** Clear the driver off this movement entirely. */
  clear?: boolean
}

const s = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t === '' ? null : t
}

/**
 * POST /api/precheck/driver/assign — set or edit the driver on a movement.
 *
 * Three deliberate behaviours here, all of them things an operator would
 * otherwise have to remember:
 *
 *  1. **Changing the driver clears `waSentAt`.** That stamp means "the daily
 *     briefing went out". Once a different person (or number) is driving, the
 *     briefing that was sent went to the wrong phone, so the flag is reset and
 *     the cron will brief the new driver on the day. Silently keeping it would
 *     leave a movement showing "Sent" to a driver who never got it.
 *  2. **`applyToAll`** fills every movement that still needs a driver in one
 *     action — one driver for the whole tour is the norm, not the exception.
 *  3. **Sri Lanka bookings mirror to `sl_driver_allocations`**, so the SL
 *     Driver Allocation board and this panel never disagree.
 *
 * Nothing here deletes an agenda item, a booking or a driver.
 */
export async function POST(req: NextRequest) {
  const guard = await guardPrecheck()
  if (!guard.ok) return guard.response
  const { session } = guard
  const authSession = await getServerSession(authOptions)

  let body: AssignBody
  try {
    body = await req.json() as AssignBody
  } catch {
    return buildApiError('Invalid JSON body')
  }

  const bookingRef = s(body.bookingRef)
  if (!bookingRef) return buildApiError('bookingRef is required')

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, operationCountry: true,
      tourAgenda: { select: { items: { select: { id: true, date: true, assignment: { select: { id: true, driverName: true, driverPhone: true, driverId: true } } } } } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (session.countries && !(booking.operationCountry && session.countries.includes(booking.operationCountry))) {
    return buildApiError('Forbidden — this booking is outside your country scope', 403)
  }

  const items = booking.tourAgenda?.items ?? []
  if (items.length === 0) return buildApiError('This booking has no tour agenda to assign against', 400)

  // ── Which movements are we writing to?
  let targets: typeof items
  if (body.applyToAll) {
    // Only fill the gaps — never silently overwrite a movement somebody else
    // has already staffed with a different driver.
    targets = items.filter(i => !i.assignment?.driverName)
    if (body.agendaItemId) {
      const one = items.find(i => i.id === body.agendaItemId)
      if (one && !targets.includes(one)) targets = [one, ...targets]
    }
    if (targets.length === 0) return buildApiError('Every movement already has a driver', 400)
  } else {
    const one = items.find(i => i.id === body.agendaItemId)
    if (!one) return buildApiError('Movement not found on this booking', 404)
    targets = [one]
  }

  // ── Resolve the driver being assigned.
  let driverId = s(body.driverId)
  let driverName = s(body.driverName)
  let driverPhone = s(body.driverPhone)
  let vehicleType = s(body.vehicleType)
  let vehiclePlate = s(body.vehiclePlate)

  if (!body.clear) {
    if (driverId) {
      const master = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, name: true, phone: true, isActive: true, vehicle: { select: { type: true, plateNo: true } } },
      })
      if (!master) return buildApiError('Selected driver no longer exists', 404)
      if (!master.isActive) return buildApiError(`${master.name} is deactivated and cannot be allocated`, 400)
      // The master record wins for identity; the form may still override the
      // vehicle, which legitimately changes trip to trip.
      driverName = driverName ?? master.name
      driverPhone = driverPhone ?? master.phone
      vehicleType = vehicleType ?? master.vehicle?.type ?? null
      vehiclePlate = vehiclePlate ?? master.vehicle?.plateNo ?? null
    }
    if (!driverName) return buildApiError('A driver name is required')
  } else {
    driverId = null; driverName = null; driverPhone = null
    vehicleType = null; vehiclePlate = null
  }

  const rate = body.driverRate == null || Number.isNaN(Number(body.driverRate))
    ? null
    : Number(body.driverRate)

  try {
    for (const item of targets) {
      const prev = item.assignment
      // Identity change = the sent briefing went to somebody else.
      const changedWho =
        (prev?.driverId ?? null) !== driverId ||
        (prev?.driverName ?? null) !== driverName ||
        normalisePhone(prev?.driverPhone ?? '') !== normalisePhone(driverPhone ?? '')

      const data = {
        driverId,
        driverName,
        driverPhone,
        vehicleType,
        vehiclePlate,
        driverRate: rate,
        rateCurrency: s(body.rateCurrency) ?? 'USD',
        notes: s(body.notes),
        ...(changedWho ? { waSentAt: null } : {}),
      }

      await prisma.assignment.upsert({
        where: { agendaItemId: item.id },
        create: { agendaItemId: item.id, ...data },
        update: data,
      })
    }

    // ── Keep the registered driver's number current, when asked.
    if (body.syncMaster && driverId && driverPhone) {
      await prisma.driver.update({ where: { id: driverId }, data: { phone: driverPhone } })
    }

    // ── Mirror onto the Sri Lanka allocation board.
    if (booking.operationCountry === 'SRILANKA') {
      await prisma.sriLankaDriverAllocation.upsert({
        where: { bookingId: booking.id },
        create: { bookingId: booking.id, driverId, vehicleType },
        update: { driverId, ...(vehicleType ? { vehicleType } : {}) },
      })
    }

    if (authSession?.user?.id) {
      await logActivity({
        userId: authSession.user.id,
        action: ACTION.DRIVER_UPDATED,
        entityType: 'Assignment',
        entityId: targets[0].id,
        details: {
          bookingRef,
          driverName: driverName ?? '(cleared)',
          movements: targets.length,
          syncedMaster: !!body.syncMaster,
        },
      })
    }

    const view = await buildDriverPrecheck(bookingRef)
    const verb = body.clear ? 'Driver removed from' : 'Driver assigned to'
    return buildApiSuccess(
      view,
      `${verb} ${targets.length} movement${targets.length === 1 ? '' : 's'}`,
    )
  } catch (e) {
    console.error('[precheck/driver/assign]', e)
    return buildApiError((e as Error).message, 400)
  }
}
