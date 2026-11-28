import { prisma } from '@/lib/prisma'
import { HOTEL_ONLY_VEHICLE, movementNeedsDriver, resolveNoDriverNeeded } from '@/lib/driver-requirement'

/**
 * Keeps the Sri Lanka booking-level driver allocation in step with the per-movement
 * assignments on the tour agenda.
 *
 * The Driver Allocation board reads `SriLankaDriverAllocation`, while the Movement
 * Chart writes `Assignment` rows per agenda item. Assigning from the allocation
 * board pushes down to every agenda item (see the SL driver-allocation POST), but
 * assigning from the Movement Chart used to write only the agenda side — leaving
 * the board showing PENDING for a booking that already had a driver.
 *
 * This runs the missing direction: agenda → allocation.
 */

type AgendaAssignment = {
  driverId: string | null
  vendorId: string | null
  vehicleType: string | null
}

/** The driver/vendor covering the most movements; earliest movement breaks ties. */
function dominantAssignment(assignments: AgendaAssignment[]): AgendaAssignment | null {
  const counts = new Map<string, { count: number; first: number; value: AgendaAssignment }>()

  assignments.forEach((a, index) => {
    if (!a.driverId && !a.vendorId) return
    const key = `${a.driverId ?? ''}|${a.vendorId ?? ''}`
    const entry = counts.get(key)
    if (entry) entry.count++
    else counts.set(key, { count: 1, first: index, value: a })
  })

  if (counts.size === 0) return null

  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.first - b.first)[0]!.value
}

/**
 * Recomputes the allocation for one booking from its agenda assignments.
 * No-op for non-Sri Lanka bookings, and for agendas that carry no driver or
 * vendor id (a free-text driver name has nowhere to live on the allocation row).
 *
 * The stored allocation wins while it still matches a driver/vendor present on
 * the agenda — only an allocation that is empty or stale adopts the agenda's.
 *
 * Returns true when a row was written.
 */
export async function syncSlAllocationFromAgenda(bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      operationCountry: true,
      slDriverAllocation: { select: { driverId: true, vendorId: true, vehicleType: true } },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              assignment: { select: { driverId: true, vendorId: true, vehicleType: true } },
            },
          },
        },
      },
    },
  })

  if (!booking || booking.operationCountry !== 'SRILANKA') return false

  const assignments = (booking.tourAgenda?.items ?? [])
    .map(i => i.assignment)
    .filter((a): a is AgendaAssignment => !!a)

  const dominant = dominantAssignment(assignments)
  if (!dominant) return false

  const current = booking.slDriverAllocation

  // An allocation whose driver/vendor still holds a movement on this booking is
  // left alone — the board and the chart already agree.
  const stillOnAgenda =
    !!current &&
    (!!current.driverId || !!current.vendorId) &&
    assignments.some(a =>
      (current.driverId && a.driverId === current.driverId) ||
      (current.vendorId && a.vendorId === current.vendorId),
    )
  if (stillOnAgenda) return false

  const vehicleType = current?.vehicleType ?? dominant.vehicleType ?? null

  await prisma.sriLankaDriverAllocation.upsert({
    where:  { bookingId },
    create: {
      bookingId,
      driverId:  dominant.driverId,
      vendorId:  dominant.vendorId,
      vehicleType,
      changedAt: new Date(),
    },
    update: {
      driverId:  dominant.driverId,
      vendorId:  dominant.vendorId,
      vehicleType,
      changedAt: new Date(),
    },
  })

  return true
}

/** Same as above, keyed by booking ref (the agenda routes work in refs). */
export async function syncSlAllocationFromAgendaByRef(bookingRef: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where:  { bookingRef },
    select: { id: true },
  })
  if (!booking) return false
  return syncSlAllocationFromAgenda(booking.id)
}

/**
 * Mirrors the chart's "Hotel Only" marks up onto the booking-level vehicle type,
 * so the two screens tell the same story.
 *
 *  • Every movement hotel-only → vehicle type becomes `hotel_only`, and the
 *    board shows the file as allocated rather than pending.
 *  • A file marked `hotel_only` that has gained a movement needing a driver →
 *    the vehicle type is cleared, so the board stops claiming it is done.
 *
 * A mixed chart (some hotel-only rows, some driven) leaves the vehicle type
 * alone — an operator's choice of Car/Bus for the driven part must survive.
 * Non-Sri Lanka bookings are a no-op. Returns true when a row was written.
 */
export async function syncHotelOnlyFromAgenda(bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where:  { id: bookingId },
    select: {
      operationCountry: true,
      slDriverAllocation: { select: { vehicleType: true } },
      tourAgenda: {
        select: {
          items: {
            select: {
              isLeisure: true, isHotelOnly: true, serviceType: true,
              location: true, toPoint: true, details: true,
            },
          },
        },
      },
    },
  })

  if (!booking || booking.operationCountry !== 'SRILANKA') return false

  const items = booking.tourAgenda?.items ?? []
  if (items.length === 0) return false

  const current      = booking.slDriverAllocation?.vehicleType ?? null
  // No Driver Needed rows carry both flags; they are not hotel-only stays.
  const allHotelOnly = items.every(i => i.isHotelOnly === true && !resolveNoDriverNeeded(i))

  // A whole chart of hotel-only rows is a hotel-only file.
  if (allHotelOnly && current !== HOTEL_ONLY_VEHICLE) {
    await prisma.sriLankaDriverAllocation.upsert({
      where:  { bookingId },
      create: { bookingId, vehicleType: HOTEL_ONLY_VEHICLE },
      update: { vehicleType: HOTEL_ONLY_VEHICLE },
    })
    return true
  }

  // Was hotel-only, but something on the chart now has to be driven.
  if (!allHotelOnly && current === HOTEL_ONLY_VEHICLE && items.some(movementNeedsDriver)) {
    await prisma.sriLankaDriverAllocation.update({
      where: { bookingId },
      data:  { vehicleType: null },
    })
    return true
  }

  return false
}

/** Same as above, keyed by booking ref. */
export async function syncHotelOnlyFromAgendaByRef(bookingRef: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where:  { bookingRef },
    select: { id: true },
  })
  if (!booking) return false
  return syncHotelOnlyFromAgenda(booking.id)
}

/**
 * Repairs every Sri Lanka booking whose agenda carries a driver/vendor that the
 * allocation row does not. Used by the Driver Allocation board on load so files
 * assigned from the Movement Chart before this sync existed stop reading PENDING.
 */
export async function backfillSlAllocationsFromAgenda(): Promise<number> {
  const candidates = await prisma.booking.findMany({
    where: {
      operationCountry: 'SRILANKA',
      status: { not: 'CANCELLED' },
      tourAgenda: {
        items: { some: { assignment: { OR: [{ driverId: { not: null } }, { vendorId: { not: null } }] } } },
      },
      OR: [
        { slDriverAllocation: null },
        { slDriverAllocation: { driverId: null, vendorId: null } },
      ],
    },
    select: { id: true },
  })

  let written = 0
  for (const b of candidates) {
    if (await syncSlAllocationFromAgenda(b.id)) written++
  }
  return written
}

/**
 * The other direction, for a chart that did not exist yet: allocation → a new chart.
 *
 * A Sri Lanka file can be allocated before it has a movement chart — Driver-Auto
 * approves a whole-booking request for a file with no chart, or the desk picks on
 * the allocation board. The pick lands on the allocation row only. When the chart
 * is then built (the AI auto-generate sweep, or the agenda page on first open), it
 * starts with no assignments, so the driver / vendor silently fell off the chart
 * and out of their app (IS49189, 2026-11-27).
 *
 * Copies the allocation onto every driven movement — but only while NOBODY is on
 * the chart yet. Once any movement has a driver or vendor, the chart is the
 * desk's and this does nothing. Returns the number of movements written.
 */
export async function applySlAllocationToNewChart(bookingId: string): Promise<number> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      operationCountry: true,
      slDriverAllocation: { select: { driverId: true, vendorId: true, vehicleType: true } },
      tourAgenda: {
        select: {
          items: {
            select: {
              id: true, location: true, fromPoint: true, toPoint: true, details: true, serviceType: true,
              isLeisure: true, isHotelOnly: true,
              assignment: { select: { id: true, driverId: true, vendorId: true, driverName: true, vendorName: true, vehicleType: true } },
            },
          },
        },
      },
    },
  })
  const alloc = booking?.slDriverAllocation
  if (!booking || booking.operationCountry !== 'SRILANKA' || !alloc || (!alloc.driverId && !alloc.vendorId)) return 0
  const items = booking.tourAgenda?.items ?? []
  if (!items.length) return 0
  if (items.some(i => i.assignment && (i.assignment.driverId || i.assignment.vendorId || i.assignment.driverName || i.assignment.vendorName))) return 0

  const allocType = alloc.vehicleType && alloc.vehicleType !== HOTEL_ONLY_VEHICLE ? alloc.vehicleType : null
  let data: {
    driverId: string | null; vendorId: string | null; vendorName: string | null
    driverName: string | null; driverPhone: string | null; vehicleType: string | null; vehiclePlate: string | null
  }
  if (alloc.driverId) {
    const d = await prisma.driver.findUnique({
      where: { id: alloc.driverId },
      select: { name: true, phone: true, vehicle: { select: { type: true, plateNo: true } } },
    })
    if (!d) return 0
    data = {
      driverId: alloc.driverId, vendorId: null, vendorName: null, driverName: d.name, driverPhone: d.phone || null,
      vehicleType: allocType ?? d.vehicle?.type ?? null, vehiclePlate: d.vehicle?.plateNo ?? null,
    }
  } else {
    const v = await prisma.vehicleVendor.findUnique({ where: { id: alloc.vendorId! }, select: { name: true, phone: true, whatsappPhone: true } })
    if (!v) return 0
    // Same shape Driver-Auto and the allocation board write for a vendor pick.
    data = {
      driverId: null, vendorId: alloc.vendorId, vendorName: v.name, driverName: v.name, driverPhone: v.whatsappPhone || v.phone || null,
      vehicleType: allocType, vehiclePlate: null,
    }
  }

  let written = 0
  for (const item of items) {
    if (!movementNeedsDriver(item)) continue
    if (!item.assignment) {
      try {
        await prisma.assignment.create({ data: { agendaItemId: item.id, ...data } })
        written++
      } catch (err) {
        if ((err as { code?: string })?.code !== 'P2002') throw err
      }
      continue
    }
    const res = await prisma.assignment.updateMany({
      where: { id: item.assignment.id, driverId: null, vendorId: null },
      data: { ...data, vehicleType: item.assignment.vehicleType ?? data.vehicleType },
    })
    written += res.count
  }
  if (written) console.log(`[SL allocation] carried ${alloc.driverId ? 'driver' : 'vendor'} onto ${written} movement(s) of a new chart (booking ${bookingId})`)
  return written
}
