import { prisma } from '@/lib/prisma'
import { HOTEL_ONLY_VEHICLE, movementNeedsDriver } from '@/lib/driver-requirement'

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
  const allHotelOnly = items.every(i => i.isHotelOnly === true)

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
