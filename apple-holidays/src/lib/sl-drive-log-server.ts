/**
 * Assembles the Drive Log: OPS bookings on the left, accounts money on the right.
 *
 * Three reads, one row:
 *
 *   Prisma                       the Sri Lankan bookings in the window, and who
 *                                is driving them.
 *   sl_driver_advance_snapshots  what the driver is owed and what he has been
 *                                handed — derived by the accounts system, read
 *                                here verbatim.
 *   generated_invoices           what the client was billed and has paid.
 *
 * The two accounts reads are *decorations*, not joins: either can fail and the
 * log still renders, with the affected cells saying why instead of the whole
 * screen falling over. That is the same contract the bookings list already
 * keeps with the same two databases — a supplier database being unreachable
 * must never take an operations screen down.
 *
 * Everything here reads. Nothing in this file writes to either database.
 */

import { prisma } from './prisma'
import { fetchDriverAdvanceEnvelopes } from './accounts-driver-advance-db'
import { fetchInvoicePaymentSummaries, type InvoicePaymentSummary } from './accounts-invoice-db'
import { bookingNeedsDriver } from './driver-requirement'
import {
  MAX_ROWS, applyDriveLogFilters, dayKey, daysBetween, deriveSettlement, emptySettlement,
  sortDriveLogRows, toDriveLogInvoice,
  type DriveLogDriverInfo, type DriveLogQuery, type DriveLogRow,
} from './sl-drive-log'
import type { Prisma } from '@prisma/client'

/**
 * How long a decoration may take before the log gives up on it.
 *
 * The accounts database is on RDS and the log is a screen someone refreshes all
 * day: a slow supplier read has to degrade to "unavailable" on a stated budget
 * rather than hold the page open until the platform's own timeout fires.
 */
const ACCOUNTS_BUDGET_MS = 12_000

/** What the screen gets back, decorations included. */
export interface DriveLogResult {
  rows: DriveLogRow[]
  /** False when the driver-advance snapshots could not be read. */
  advancesAvailable: boolean
  /** False when the invoice ledger could not be read. */
  invoicesAvailable: boolean
  /** True when the window held more bookings than one request may carry. */
  truncated: boolean
  /** How many bookings the window actually held. */
  matched: number
  /** The Sri Lankan calendar day the window was resolved against. */
  today: string
}

/**
 * Runs a decoration under a budget; a failure is a `null`, never a throw.
 *
 * The rejection is caught on `work` itself rather than on the race, because a
 * query that loses the race and fails *afterwards* would otherwise reject with
 * nobody listening — an unhandled rejection that takes the whole server process
 * down on Node's default policy, over a supplier database being slow.
 *
 * The timer is cleared on the way out so a fast read does not hold the event
 * loop open for the rest of the budget.
 */
async function settled<T>(work: Promise<T>, label: string): Promise<T | null> {
  const guarded = work.catch((err: unknown) => {
    console.error(`[drive-log] ${label} skipped (non-fatal):`, err)
    return null
  })

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>(resolve => {
    timer = setTimeout(() => {
      console.error(`[drive-log] ${label} exceeded ${ACCOUNTS_BUDGET_MS}ms — showing the page without it`)
      resolve(null)
    }, ACCOUNTS_BUDGET_MS)
  })

  try {
    return await Promise.race([guarded, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The window as instants.
 *
 * `arrivalDate` and `departureDate` are stored as midnight UTC standing for a
 * plain calendar day — see `last-minute-shared.ts` — so the bounds are built in
 * UTC too. Re-projecting them into a timezone would move a guest's arrival by a
 * day for anyone west of the line.
 */
function windowBounds(q: DriveLogQuery): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${q.from}T00:00:00.000Z`),
    lte: new Date(`${q.to}T23:59:59.999Z`),
  }
}

/** The driver on a booking — the allocation first, the movement chart as backup. */
function resolveDriver(b: BookingRow): DriveLogDriverInfo | null {
  const alloc = b.slDriverAllocation

  if (alloc?.driver) {
    const d = alloc.driver
    return {
      id: d.id,
      name: d.name,
      phone: d.phone,
      photoUrl: d.photoUrl,
      isActive: d.isActive,
      licenseNo: d.licenseNo,
      vehicle: d.vehicle
        ? {
            id: d.vehicle.id, type: d.vehicle.type, plateNo: d.vehicle.plateNo,
            brand: d.vehicle.brand, model: d.vehicle.model, capacity: d.vehicle.capacity,
          }
        : null,
      vendorName: d.vendorOwner?.name ?? alloc.vendor?.name ?? null,
      bank: {
        name: d.bankName, branch: d.bankBranch, code: d.bankCode,
        holder: d.bankHolder, accountNo: d.bankAccountNo,
      },
      source: 'allocation',
    }
  }

  // A vendor-run file has no named driver until the vendor supplies one; the
  // money still goes somewhere, so the vendor stands in the driver's place and
  // the column says which it is.
  if (alloc?.vendor) {
    const v = alloc.vendor
    return {
      id: v.id, name: v.name, phone: v.phone, photoUrl: null, isActive: v.isActive,
      licenseNo: null, vehicle: null, vendorName: v.name,
      bank: {
        name: v.bankName, branch: v.bankBranch, code: v.bankCode,
        holder: v.bankHolder, accountNo: v.bankAccountNo,
      },
      source: 'vendor',
    }
  }

  // Files driven by a name typed straight onto a movement never reach the
  // allocation row. They are still driven, and still cost money.
  const named = b.tourAgenda?.items.find(i => i.assignment?.driver || i.assignment?.driverName)
  const asg = named?.assignment
  if (!asg) return null

  if (asg.driver) {
    return {
      id: asg.driver.id, name: asg.driver.name, phone: asg.driver.phone,
      photoUrl: asg.driver.photoUrl, isActive: asg.driver.isActive,
      licenseNo: asg.driver.licenseNo,
      vehicle: asg.driver.vehicle
        ? {
            id: asg.driver.vehicle.id, type: asg.driver.vehicle.type,
            plateNo: asg.driver.vehicle.plateNo, brand: asg.driver.vehicle.brand,
            model: asg.driver.vehicle.model, capacity: asg.driver.vehicle.capacity,
          }
        : null,
      vendorName: asg.vendorName,
      bank: {
        name: asg.driver.bankName, branch: asg.driver.bankBranch, code: asg.driver.bankCode,
        holder: asg.driver.bankHolder, accountNo: asg.driver.bankAccountNo,
      },
      source: 'movement',
    }
  }

  return {
    id: null,
    name: asg.driverName ?? asg.vendorName ?? 'Unnamed driver',
    phone: asg.driverPhone,
    photoUrl: null,
    isActive: true,
    licenseNo: null,
    vehicle: asg.vehiclePlate || asg.vehicleType
      ? { id: null, type: asg.vehicleType, plateNo: asg.vehiclePlate, brand: null, model: null, capacity: null }
      : null,
    vendorName: asg.vendorName,
    bank: null,
    source: 'movement',
  }
}

const DRIVER_SELECT = {
  id: true, name: true, phone: true, isActive: true, photoUrl: true, licenseNo: true,
  bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true,
  vehicle: { select: { id: true, type: true, plateNo: true, brand: true, model: true, capacity: true } },
  vendorOwner: { select: { id: true, name: true } },
} satisfies Prisma.DriverSelect

const BOOKING_SELECT = {
  id: true, bookingRef: true, isNumber: true, cntlNumber: true,
  agent: true, fileHandler: true, status: true, hotelOnly: true,
  arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true,
  passengers: { where: { isLead: true }, take: 1, select: { name: true } },
  tourAgenda: {
    select: {
      items: {
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] as const,
        select: {
          // The leisure-day rule reads the title and the description when the
          // flag is silent, so the same columns it inspects are selected here —
          // otherwise this screen would call a day driven that the allocation
          // board calls free.
          isLeisure: true, isHotelOnly: true,
          location: true, fromPoint: true, toPoint: true, details: true, serviceType: true,
          assignment: {
            select: {
              driverName: true, driverPhone: true, vendorName: true,
              vehicleType: true, vehiclePlate: true,
              driver: { select: DRIVER_SELECT },
            },
          },
        },
      },
    },
  },
  slDriverAllocation: {
    select: {
      vehicleType: true, isEmergency: true, notes: true,
      driver: { select: DRIVER_SELECT },
      vendor: {
        select: {
          id: true, name: true, phone: true, isActive: true,
          bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>

/**
 * Every Sri Lankan booking in the window, with its money.
 *
 * Cancelled bookings are dropped the way they are on every other operational
 * list. Hotel-only files are *kept* here and filtered afterwards, because
 * "these ten files need no driver" is itself an answer the desk wants on the
 * screen, behind a toggle.
 */
export async function fetchDriveLogRows(q: DriveLogQuery, now = new Date()): Promise<DriveLogResult> {
  const today  = dayKey(now)
  const bounds = windowBounds(q)

  const where: Prisma.BookingWhereInput = {
    AND: [
      { operationCountry: 'SRILANKA' },
      { status: { not: 'CANCELLED' } },
      { [q.dateField]: bounds },
      ...(q.search
        ? [{
            OR: [
              { bookingRef:  { contains: q.search } },
              { isNumber:    { contains: q.search } },
              { cntlNumber:  { contains: q.search } },
              { agent:       { contains: q.search } },
              { fileHandler: { contains: q.search } },
              { passengers:  { some: { name: { contains: q.search } } } },
              { slDriverAllocation: { driver: { name: { contains: q.search } } } },
            ],
          } as Prisma.BookingWhereInput]
        : []),
    ],
  }

  const [matched, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      select: BOOKING_SELECT,
      orderBy: [{ arrivalDate: 'asc' }, { bookingRef: 'asc' }],
      take: MAX_ROWS,
    }),
  ])

  const lookups = bookings.map(b => ({
    reference: b.bookingRef,
    isNumber: b.isNumber,
    controlNumber: b.cntlNumber,
  }))

  const [envelopes, invoices] = await Promise.all([
    settled(fetchDriverAdvanceEnvelopes(lookups), 'driver advance snapshots'),
    settled(
      fetchInvoicePaymentSummaries(lookups) as Promise<Map<string, InvoicePaymentSummary>>,
      'invoice ledger',
    ),
  ])

  const rows: DriveLogRow[] = bookings.map(b => {
    const arrival   = b.arrivalDate.toISOString().slice(0, 10)
    const departure = b.departureDate ? b.departureDate.toISOString().slice(0, 10) : null
    const envelope  = envelopes?.get(b.bookingRef) ?? null

    // "Needs no driver", read exactly as the allocation board reads it: the
    // booking-level flag, the hotel-only vehicle type, or a chart on which not
    // one movement has to be driven.
    const hotelOnly = !bookingNeedsDriver({
      hotelOnly: b.hotelOnly,
      vehicleType: b.slDriverAllocation?.vehicleType ?? null,
      items: b.tourAgenda?.items ?? [],
    })

    return {
      bookingId: b.id,
      bookingRef: b.bookingRef,
      isNumber: b.isNumber,
      cntlNumber: b.cntlNumber,
      clientName: b.passengers[0]?.name ?? null,
      agent: b.agent,
      fileHandler: b.fileHandler,
      arrivalDate: arrival,
      departureDate: departure,
      nights: departure ? Math.max(0, daysBetween(arrival, departure)) : null,
      pax: (b.paxAdults ?? 0) + (b.paxChildren ?? 0),
      status: b.status,
      hotelOnly,
      daysToArrival: daysBetween(today, arrival),
      driver: resolveDriver(b),
      invoice: invoices
        ? toDriveLogInvoice(invoices.get(b.bookingRef))
        : { ...EMPTY_INVOICE },
      settlement: envelopes
        ? deriveSettlement(envelope?.summary ?? null, envelope?.detail ?? null)
        : emptySettlement('unavailable', 'The accounts database could not be reached.'),
    }
  })

  return {
    rows: sortDriveLogRows(applyDriveLogFilters(rows, q), q),
    advancesAvailable: envelopes !== null,
    invoicesAvailable: invoices !== null,
    truncated: matched > bookings.length,
    matched,
    today,
  }
}

/** What an invoice cell says when the ledger could not be read at all. */
const EMPTY_INVOICE = {
  state: 'unknown' as const,
  message: 'The accounts database could not be reached.',
  invoiceNumber: null, currency: 'USD', amount: null, paid: null, balance: null,
  paidPercent: null, revision: null, revisionCount: null, invoiceDate: null, lastPaymentAt: null,
}
