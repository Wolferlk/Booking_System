/**
 * Shared persistence for AppleSystem-sourced bookings.
 *
 * Used by both the manual "Import to System" endpoint and the daily auto-create
 * job so the two paths behave identically. The write is idempotent: a booking
 * whose `bookingRef` already exists is returned untouched rather than
 * duplicated, which keeps re-runs and overlapping jobs safe against the live
 * production data.
 */

import { prisma } from '@/lib/prisma'
import type { OperationCountry } from '@/lib/country-detection'
import type { MappedBookingInput } from '@/lib/as-booking-map'

export class AlreadyImportedError extends Error {
  constructor(public bookingRef: string, public bookingId: string) {
    super(`Booking ${bookingRef} already exists`)
    this.name = 'AlreadyImportedError'
  }
}

export interface ImportOptions {
  createdById: string
  cancellationDeadline: Date | null
}

export interface ImportResult {
  booking: { id: string; bookingRef: string }
  alreadyExists: boolean
}

/**
 * Create a Booking (+ passengers, accommodations, itinerary, emergency
 * contacts) from a mapped AppleSystem quote. Returns `alreadyExists: true`
 * without writing when the ref is already present.
 */
export async function importMappedBooking(
  mapped: MappedBookingInput,
  operationCountry: OperationCountry,
  opts: ImportOptions,
): Promise<ImportResult> {
  const existing = await prisma.booking.findUnique({
    where: { bookingRef: mapped.bookingRef },
    select: { id: true, bookingRef: true },
  })
  if (existing) return { booking: existing, alreadyExists: true }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await (prisma.booking.create as any)({
    data: {
      bookingRef: mapped.bookingRef,
      isNumber: mapped.isNumber || null,
      cntlNumber: mapped.cntlNumber,
      agentBookingId: mapped.agentBookingId,
      agent: mapped.agent,
      fileHandler: mapped.fileHandler,
      arrivalDate: new Date(mapped.arrivalDate),
      departureDate: new Date(mapped.departureDate),
      paxAdults: mapped.paxAdults,
      paxChildren: mapped.paxChildren,
      quotedTotal: mapped.quotedTotal,
      currency: mapped.currency,
      terms: mapped.terms,
      packageIncludes: mapped.packageIncludes,
      packageExcludes: mapped.packageExcludes,
      valueAddedServices: mapped.valueAddedServices,
      contactEmail: mapped.contactEmail,
      cancellationDeadline: opts.cancellationDeadline,
      operationCountry,
      createdById: opts.createdById,
      passengers: {
        create: mapped.passengers.map((p) => ({
          name: p.name,
          type: p.type,
          age: p.age,
          isLead: p.isLead,
          passport: p.passport || null,
          nationality: p.nationality || null,
        })),
      },
      accommodations: {
        create: mapped.accommodations.map((a) => ({
          city: a.city,
          hotel: a.hotel,
          checkIn: new Date(a.checkIn),
          checkOut: new Date(a.checkOut),
          nights: a.nights,
          roomType: a.roomType,
          mealType: a.mealType,
          address: a.address || null,
          ownArrangement: a.ownArrangement,
        })),
      },
      itineraryItems: {
        create: mapped.itineraryItems.map((i) => ({
          dayNo: i.dayNo,
          date: new Date(i.date),
          title: i.title,
          description: i.description || null,
        })),
      },
      emergencyContacts: {
        create: mapped.emergencyContacts.map((e) => ({
          name: e.name,
          phone: e.phone || null,
          role: e.role || null,
        })),
      },
    },
    select: { id: true, bookingRef: true },
  })

  await prisma.statusEvent.create({
    data: {
      bookingId: booking.id,
      toState: 'DRAFT',
      actorId: opts.createdById,
      note: `Imported from AppleSystem (quotation ${mapped.source.quotationNo || '—'})`,
    },
  })

  return { booking, alreadyExists: false }
}

/** The user a background/automated import is attributed to. */
export async function getAutomationUserId(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } })
  if (u) return u.id
  const bt = await prisma.user.findFirst({ where: { role: 'BT_USER' }, select: { id: true } })
  if (bt) return bt.id
  throw new Error('No automation user found (need SUPER_ADMIN or BT_USER)')
}
