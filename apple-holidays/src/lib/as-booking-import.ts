/**
 * Shared persistence for AppleSystem-sourced bookings.
 *
 * Used by both the manual "Import to System" endpoint and the daily auto-create
 * job so the two paths behave identically. The write is idempotent: a booking
 * whose `bookingRef` already exists is returned untouched rather than
 * duplicated, which keeps re-runs and overlapping jobs safe against the live
 * production data. A quotation already held by another live booking under a
 * different file number is refused (QuotationAlreadyInOpsError).
 */

import { prisma } from '@/lib/prisma'
import { countryLabel, type OperationCountry } from '@/lib/country-detection'
import type { MappedBookingInput } from '@/lib/as-booking-map'
import { saveAsExtras } from '@/lib/as-booking-extras'
import { autoCreateTicketsOnImport } from '@/lib/as-auto-tickets'
import { withOwnStayHotels } from '@/lib/own-stay-hotels'
import { withFlowParties } from '@/lib/flow-parties'

export class AlreadyImportedError extends Error {
  constructor(public bookingRef: string, public bookingId: string) {
    super(`Booking ${bookingRef} already exists`)
    this.name = 'AlreadyImportedError'
  }
}

/**
 * The quotation is already in OPS under a DIFFERENT file number.
 *
 * Apple keys a tour by its quotation number; the IS (file) number is typed on
 * the quote and can change or be mistyped between revisions. Without this the
 * import checked the file number only, so a re-confirmed quote carrying
 * another IS number became a second live booking for the same tour
 * (VN41106 next to VN41108, both quotation 485929, 2026-11-24).
 */
export class QuotationAlreadyInOpsError extends Error {
  constructor(
    public quotationNo: string,
    public incomingRef: string,
    public existing: { id: string; bookingRef: string }[],
  ) {
    const refs = existing.map((b) => b.bookingRef).join(', ')
    super(
      `AppleSystem quotation ${quotationNo} is already in OPS as ${refs}, but AppleSystem now gives IS number ` +
      `${incomingRef}. Not imported, so no duplicate booking was created. Check which file number is correct — ` +
      `fix the IS number in AppleSystem, or cancel ${refs} in OPS first if this really is a new booking.`,
    )
    this.name = 'QuotationAlreadyInOpsError'
  }
}

/** Bookings in these states no longer hold their quotation (cancel-and-rebook is allowed). */
const RELEASED_STATUSES = ['CANCELLED'] as const

/** The bare quotation digits: "485929", "485929CNTL", "CNTL485929" → "485929". */
function quotationDigitsOf(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const s = String(v ?? '').toUpperCase().replace(/CNTL/g, '').replace(/\s+/g, '')
    if (/^\d{3,12}$/.test(s)) return s
  }
  return null
}

/**
 * Live bookings (other than `bookingRef`) already holding this quotation.
 * Read-only. Exported so callers can warn before they try an import.
 */
export async function findOtherBookingsForQuotation(
  quotationNo: string | null,
  bookingRef: string,
): Promise<{ id: string; bookingRef: string }[]> {
  if (!quotationNo) return []
  return prisma.booking.findMany({
    where: {
      cntlNumber: { in: [quotationNo, `${quotationNo}CNTL`, `CNTL${quotationNo}`, `${quotationNo} CNTL`, `CNTL ${quotationNo}`] },
      bookingRef: { not: bookingRef },
      status: { notIn: [...RELEASED_STATUSES] },
    },
    select: { id: true, bookingRef: true },
    take: 5,
  })
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

  // Same tour already in OPS under another file number → refuse, never duplicate.
  const quotationNo = quotationDigitsOf(mapped.source?.quotationNo, mapped.cntlNumber)
  const sameQuote = await findOtherBookingsForQuotation(quotationNo, mapped.bookingRef)
  if (quotationNo && sameQuote.length > 0) {
    throw new QuotationAlreadyInOpsError(quotationNo, mapped.bookingRef, sameQuote)
  }

  // Agent ID, Sales Person and Guest as the confirmation voucher prints them.
  // Apple drops them on every re-save; the AI Quotation system keeps them.
  // Never throws, and Flow down = import exactly as before. See flow-parties.ts.
  mapped = await withFlowParties(mapped)

  // AppleSystem sends own-arrangement stays with no hotel name; the AI Quotation
  // system (SME / Corporate) may know it. Fills blanks only, never throws, and
  // makes no call at all when no stay is blank. See own-stay-hotels.ts.
  const accommodations = await withOwnStayHotels(mapped.source?.quotationNo, mapped.accommodations)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const booking = await (prisma.booking.create as any)({
    data: {
      bookingRef: mapped.bookingRef,
      isNumber: mapped.isNumber || null,
      cntlNumber: mapped.cntlNumber,
      agentBookingId: mapped.agentBookingId,
      agent: mapped.agent,
      agentEmail: mapped.agentEmail,
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
      // AppleSystem sends no "Destination" line (the TC used to supply it), so
      // derive it from the country the IS number resolved to.
      tourDestination: operationCountry && operationCountry !== 'ALL' ? countryLabel(operationCountry) : null,
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
        create: accommodations.map((a) => ({
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

  await saveAsExtras(booking.bookingRef, mapped)

  // The quote's own P&L → DRAFT tickets, so the ground team has them before
  // Accounts has pulled the costing. Never throws; see as-auto-tickets.ts.
  await autoCreateTicketsOnImport(booking, mapped, operationCountry)

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
