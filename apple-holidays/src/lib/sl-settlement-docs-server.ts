/**
 * Filling the Sri Lankan settlement paperwork in from what the systems already
 * know — and keeping what the desk typed on top of it.
 *
 * Two jobs, and the boundary between them is the point of the file:
 *
 *   derivePack()   reads the booking, its movement chart, its allocated driver
 *                  and the accounts system's costed lines, and lays them out as
 *                  a first draft of the four sheets. It writes nothing.
 *   loadDocState() returns the desk's saved pack when there is one, the draft
 *                  when there is not, and *always* returns the draft alongside
 *                  so the editor can show what the systems currently say.
 *
 * A saved pack is never silently refreshed from the databases. These sheets
 * carry hand-approved extras, signatures and agreed rates that exist nowhere
 * else; a background "update" that replaced a typed figure with a derived one
 * would destroy the only copy. Pulling a fresh figure in is a button the user
 * presses, in the editor, on the field they mean.
 *
 * ---- Reads only, in the accounts database ----
 *
 * The accounts side is touched through `fetchDriverAdvanceDetail`, which is a
 * SELECT against `sl_driver_advance_snapshots`. Nothing here writes to the
 * accounts database, and the only write anywhere in this feature is one row per
 * booking in this system's own `sl_settlement_docs` table.
 */

import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { fetchDriverAdvanceDetail } from './accounts-driver-advance-db'
import type { DriverAdvanceDetail, DriverAdvanceLine } from './driver-advance'
import {
  defaultLocalVisit, emptyPack, emptyTransportTotals, parsePack, rowId,
  type SettlementDocPack, type SettlementDocState, type TourLine, type TransportLine,
} from './sl-settlement-docs'

/** `yyyy-mm-dd` from a stored midnight-UTC calendar day. */
const day = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null

const clean = (v: string | null | undefined): string => (v ?? '').trim()

const BOOKING_SELECT = {
  id: true, bookingRef: true, isNumber: true, cntlNumber: true,
  agent: true, fileHandler: true, status: true, operationCountry: true,
  arrivalDate: true, departureDate: true, paxAdults: true, paxChildren: true,
  chauffeurContact: true,
  passengers: {
    orderBy: [{ isLead: 'desc' }, { name: 'asc' }] as const,
    select: { name: true, isLead: true, type: true },
  },
  tourAgenda: {
    select: {
      items: {
        orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] as const,
        select: {
          date: true, location: true, fromPoint: true, toPoint: true, details: true,
          isLeisure: true, isHotelOnly: true,
          assignment: {
            select: {
              driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
              guideName: true, vendorName: true,
              driver: { select: { name: true, phone: true, bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true, vehicle: { select: { type: true, plateNo: true } } } },
            },
          },
        },
      },
    },
  },
  slDriverAllocation: {
    select: {
      vehicleType: true,
      driver: {
        select: {
          name: true, phone: true, licenseNo: true,
          bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true,
          vehicle: { select: { type: true, plateNo: true } },
        },
      },
      vendor: {
        select: {
          name: true, phone: true,
          bankName: true, bankBranch: true, bankCode: true, bankHolder: true, bankAccountNo: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>

function findBooking(bookingRef: string) {
  return prisma.booking.findUnique({ where: { bookingRef }, select: BOOKING_SELECT })
}

// ── Bits of the draft ─────────────────────────────────────────────────────────

/** The name that goes on the board — the lead passenger, or the first one listed. */
function leadGuest(b: BookingRow): string {
  const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
  return clean(lead?.name)
}

/**
 * The driver, the vendor, or the name typed onto a movement — in that order.
 *
 * Same precedence the Drive Log itself resolves a driver with, deliberately: a
 * settlement sheet that named a different person from the row it was printed
 * from would be worse than useless at the counter.
 */
function resolveDriver(b: BookingRow) {
  const alloc = b.slDriverAllocation
  if (alloc?.driver) {
    const d = alloc.driver
    return {
      name: d.name, phone: d.phone,
      vehicleType: d.vehicle?.type ?? alloc.vehicleType ?? null,
      vehiclePlate: d.vehicle?.plateNo ?? null,
      bank: { name: d.bankName, branch: d.bankBranch, code: d.bankCode, holder: d.bankHolder, accountNo: d.bankAccountNo },
    }
  }
  if (alloc?.vendor) {
    const v = alloc.vendor
    return {
      name: v.name, phone: v.phone,
      vehicleType: alloc.vehicleType ?? null, vehiclePlate: null,
      bank: { name: v.bankName, branch: v.bankBranch, code: v.bankCode, holder: v.bankHolder, accountNo: v.bankAccountNo },
    }
  }
  const asg = b.tourAgenda?.items.find(i => i.assignment?.driver || i.assignment?.driverName)?.assignment
  if (!asg) return null
  if (asg.driver) {
    const d = asg.driver
    return {
      name: d.name, phone: d.phone,
      vehicleType: d.vehicle?.type ?? asg.vehicleType ?? null,
      vehiclePlate: d.vehicle?.plateNo ?? asg.vehiclePlate ?? null,
      bank: { name: d.bankName, branch: d.bankBranch, code: d.bankCode, holder: d.bankHolder, accountNo: d.bankAccountNo },
    }
  }
  return {
    name: asg.driverName ?? asg.vendorName ?? '', phone: asg.driverPhone ?? null,
    vehicleType: asg.vehicleType ?? null, vehiclePlate: asg.vehiclePlate ?? null,
    bank: null,
  }
}

/** The first guide named anywhere on the chart. Ad-hoc names count. */
function resolveGuide(b: BookingRow): string {
  const named = b.tourAgenda?.items.find(i => clean(i.assignment?.guideName))
  return clean(named?.assignment?.guideName)
}

/** "Kandy – Nuwara Eliya" or the day's location — the description column, prefilled. */
function movementText(item: {
  location: string | null
  fromPoint: string | null
  toPoint: string | null
  details: string | null
}): string {
  const from = clean(item.fromPoint)
  const to   = clean(item.toPoint)
  if (from && to) return `${from} – ${to}`
  return clean(item.location) || clean(item.details).slice(0, 120)
}

/**
 * The itinerary as Transport-sheet lines.
 *
 * One line per driven day, with the amount left blank: the paper form's amount
 * column is for what the driver *claims on top of* the package — extra mileage,
 * a diversion, a night off-route — and prefilling it with any derived figure
 * would put a number in a box that means something else entirely. Leisure and
 * hotel-only days are dropped; there is no driver on them to settle with.
 */
function transportLines(b: BookingRow): TransportLine[] {
  const items = b.tourAgenda?.items ?? []
  return items
    .filter(i => !i.isLeisure && !i.isHotelOnly)
    .map((i, idx) => ({
      id: rowId('t', idx + 1),
      date: day(i.date) ?? '',
      description: movementText(i),
      amount: null,
    }))
    .filter(l => l.description)
}

/**
 * Entrance tickets, from the lines the accounts system costed.
 *
 * Attractions and the guide's own charges are what the Tour Settlement is
 * about, so those two categories come across and the rest (transport, hotels,
 * meals) do not — they are settled on the other sheets. The per-person rate is
 * shown as the costed total over the pax count, and the *total* is carried as
 * the authoritative figure so a rounding artefact in the division can never
 * change what the sheet adds up to.
 */
function tourLines(detail: DriverAdvanceDetail | null, pax: number): TourLine[] {
  if (!detail) return []
  const wanted = (l: DriverAdvanceLine) => l.category === 'ATTRACTION' || l.category === 'OTHERS'

  return detail.lines.filter(wanted).map((l, idx) => {
    const total = typeof l.lkr_amount === 'number' && Number.isFinite(l.lkr_amount)
      ? l.lkr_amount
      : l.actual_amount
    const amount = Number.isFinite(total) ? Math.round(total * 100) / 100 : null
    return {
      id: rowId('e', idx + 1),
      name: clean(l.activity_name) || clean(l.category_label),
      perPersonRate: amount !== null && pax > 0 ? Math.round((amount / pax) * 100) / 100 : null,
      count: pax > 0 ? pax : null,
      totalCost: amount,
    }
  })
}

/** The transport section's costed total, in rupees where a rate resolved. */
function packageCost(detail: DriverAdvanceDetail | null): number | null {
  const t = detail?.transport
  if (!t) return null
  const v = typeof t.lkr_total === 'number' && Number.isFinite(t.lkr_total) ? t.lkr_total : t.total
  return Number.isFinite(v) ? Math.round((v as number) * 100) / 100 : null
}

/** The envelope already handed over, which the paper form calls the tour advance. */
function tourAdvance(detail: DriverAdvanceDetail | null): number | null {
  if (!detail) return null
  const src = detail.lkr?.advance_paid ?? detail.advance_paid
  return typeof src === 'number' && Number.isFinite(src) ? Math.round(src * 100) / 100 : null
}

/** One line of bank detail, the way it is written on the form. */
function bankText(bank: { name: string | null; branch: string | null; code: string | null; holder: string | null; accountNo: string | null } | null): string {
  if (!bank) return ''
  return [bank.accountNo, bank.holder, [bank.name, bank.branch].filter(Boolean).join(' · ')]
    .map(v => clean(v))
    .filter(Boolean)
    .join('\n')
}

// ── The draft ─────────────────────────────────────────────────────────────────

export interface DerivedPack {
  pack: SettlementDocPack
  notices: string[]
}

/**
 * The four sheets as the systems would fill them in today.
 *
 * The accounts read is allowed to fail: a booking two days out often has no
 * costed P&L at all, and the paperwork still has to print — with the header,
 * the itinerary and the shop list, and blanks where the money goes. The reason
 * comes back as a notice so the editor can say why a box is empty rather than
 * leaving the user to wonder.
 */
export async function derivePack(bookingRef: string): Promise<DerivedPack | null> {
  const b = await findBooking(bookingRef)
  if (!b) return null

  const notices: string[] = []
  let detail: DriverAdvanceDetail | null = null

  try {
    const res = await fetchDriverAdvanceDetail({ reference: b.isNumber ?? b.bookingRef, controlNumber: b.cntlNumber })
    if (res.detail) detail = res.detail
    else notices.push(res.reason)
  } catch (err) {
    console.error('[sl-settlement-docs] accounts read failed', err)
    notices.push('The accounts database could not be read, so the costed figures are blank on these sheets.')
  }

  const pax    = (b.paxAdults ?? 0) + (b.paxChildren ?? 0)
  const driver = resolveDriver(b)
  const guide  = resolveGuide(b)
  const pack   = emptyPack(b.bookingRef, b.isNumber)

  pack.header = {
    tourNo:        clean(b.isNumber) || b.bookingRef,
    arrivalDate:   day(b.arrivalDate),
    departureDate: day(b.departureDate),
    pax:           pax || null,
    tourHandler:   clean(b.fileHandler),
    driverName:    clean(driver?.name),
    driverPhone:   clean(driver?.phone),
    guideName:     guide,
    vehicleType:   clean(driver?.vehicleType),
    vehiclePlate:  clean(driver?.vehiclePlate),
  }

  pack.nameBoard = {
    ...pack.nameBoard,
    guestName: leadGuest(b),
    subtitle:  'Welcome to Sri Lanka',
    footnote:  pax ? `${pax} pax` : '',
    showReference: true,
  }

  pack.transport = {
    vehicleType: clean(driver?.vehicleType),
    perKmRate:   null,
    maxMileage:  null,
    km:          null,
    packageCost: packageCost(detail),
    lines:       transportLines(b),
    totals:      { ...emptyTransportTotals(), tourAdvance: tourAdvance(detail) },
    chequeFavour: clean(driver?.bank?.holder) || clean(driver?.name),
    bankDetails:  bankText(driver?.bank ?? null),
    idNo: '',
    note: '',
  }

  pack.localVisit = {
    ...defaultLocalVisit(),
    driverRef: clean(b.cntlNumber) || clean(b.isNumber) || b.bookingRef,
  }

  pack.tour = {
    guideName:     guide,
    chauffeurName: clean(driver?.name),
    lines:         tourLines(detail, pax),
    note: '',
  }

  return { pack, notices }
}

// ── Saved packs ───────────────────────────────────────────────────────────────

/**
 * The saved row, or null — including when the table is not there yet.
 *
 * `sl_settlement_docs` is created by an additive migration that is applied by
 * hand (see `prisma/sql/2026-08-20-sl-settlement-docs.sql`). Until it has been,
 * every booking simply has no saved pack: the sheets still derive, preview and
 * print, and only saving is unavailable. Falling over instead would take the
 * whole feature down for want of a table nobody has edited a document in.
 */
async function findSavedRow(bookingRef: string, notices: string[]) {
  try {
    return await prisma.slSettlementDoc.findUnique({ where: { bookingRef } })
  } catch (err) {
    // P2021: the table does not exist in the current database.
    if ((err as { code?: string })?.code === 'P2021') {
      notices.push('Saved documents are not available yet — the sl_settlement_docs table has not been created on this database. The sheets below still print.')
      return null
    }
    throw err
  }
}

/**
 * The pack in force for a booking, and the draft beside it.
 *
 * A stored row that cannot be parsed is treated as absent rather than fatal —
 * the desk gets the draft and can save over it — but the failure is logged,
 * because a pack that will not parse is a bug and not a user's problem.
 */
export async function loadDocState(bookingRef: string): Promise<SettlementDocState | null> {
  const derived = await derivePack(bookingRef)
  if (!derived) return null

  const row = await findSavedRow(bookingRef, derived.notices)
  if (!row) {
    return { pack: derived.pack, derived: derived.pack, saved: false, savedAt: null, savedBy: null, notices: derived.notices }
  }

  let pack: SettlementDocPack
  try {
    pack = parsePack(row.pack, derived.pack)
  } catch (err) {
    console.error('[sl-settlement-docs] stored pack unreadable', bookingRef, err)
    return {
      pack: derived.pack, derived: derived.pack, saved: false, savedAt: null, savedBy: null,
      notices: [...derived.notices, 'The saved version of these documents could not be read, so the derived draft is shown. Saving will replace it.'],
    }
  }

  return {
    pack,
    derived: derived.pack,
    saved: true,
    savedAt: row.updatedAt.toISOString(),
    savedBy: row.updatedBy,
    notices: derived.notices,
  }
}

/** Write the desk's version. One row per booking, replaced wholesale. */
export async function saveDocPack(
  bookingRef: string,
  raw: unknown,
  savedBy: string | null,
): Promise<SettlementDocState | null> {
  const derived = await derivePack(bookingRef)
  if (!derived) return null

  const pack = parsePack(raw, derived.pack)

  const row = await prisma.slSettlementDoc.upsert({
    where:  { bookingRef },
    create: { bookingRef, pack: pack as unknown as object, updatedBy: savedBy },
    update: { pack: pack as unknown as object, updatedBy: savedBy },
  })

  return {
    pack,
    derived: derived.pack,
    saved: true,
    savedAt: row.updatedAt.toISOString(),
    savedBy: row.updatedBy,
    notices: derived.notices,
  }
}

/**
 * Throw the desk's version away and go back to the draft.
 *
 * A hard delete of exactly one row, keyed by primary key — the only destructive
 * operation in the feature, and it destroys nothing but a printable form that
 * can be filled in again. `deleteMany` rather than `delete` so that resetting a
 * booking that was never saved is a no-op instead of an error.
 */
export async function resetDocPack(bookingRef: string): Promise<SettlementDocState | null> {
  await prisma.slSettlementDoc.deleteMany({ where: { bookingRef } })
  return loadDocState(bookingRef)
}

/** The pack a print request should use — saved if there is one, derived if not. */
export async function packForPrint(bookingRef: string): Promise<SettlementDocPack | null> {
  const state = await loadDocState(bookingRef)
  return state?.pack ?? null
}
