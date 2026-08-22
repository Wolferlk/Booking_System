/**
 * Proforma Invoice — the booking side.
 *
 * A desk with a supplier's invoice in front of it does not know a reservation
 * id. It knows a control number ("472160CNTL") or an Apple System reference
 * ("IS 48525"), and it knows which hotel sent the paper. So this module is
 * organised the way that desk is: find the booking, lay its hotels out, and
 * file an invoice against one of them.
 *
 * The rows land in `proforma_invoices` — the same table the Reservation Team's
 * deadline pipeline reads — with `origin = 'BOOKING'`. One list, two doors.
 *
 * What this module deliberately does NOT do:
 *
 *   * touch `accommodations`. The booking's hotel list is the Booking Team's
 *     record of what was sold; filing an invoice never edits it. A hotel that
 *     is genuinely missing is added *to the invoice* (`hotelAdded`), not to the
 *     booking.
 *   * decide anything about money. Whether an invoice is paid is Accounts'
 *     answer, read back over `accounts-proforma-db.ts`. Nothing here writes a
 *     payment, and no status in this file means "paid".
 */
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { putUpload } from './storage'

/** Letters and digits only, upper-cased — the one key both systems can produce. */
export function refKey(value: string | null | undefined): string {
  return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/** Hotel names are compared this way everywhere in this module. */
export function hotelKey(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|hotel|hotels|resort|resorts|spa|by|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB', 'AI'] as const

/** Statuses this component may set. PAID is Accounts' word, never ours. */
export const BOOKING_INVOICE_STATUSES = [
  'RECEIVED',
  'UNDER_REVIEW',
  'DISCREPANCY',
  'VERIFIED',
  'FORWARDED',
  'REJECTED',
  'VOID',
] as const

export interface BookingHit {
  id: string
  bookingRef: string
  isNumber: string | null
  agent: string | null
  status: string
  operationCountry: string | null
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  currency: string
  quotedTotal: number | null
  leadGuest: string | null
  dealName: string | null
  tourDestination: string | null
}

function toHit(b: {
  id: string
  bookingRef: string
  isNumber: string | null
  agent: string | null
  status: string
  operationCountry: string | null
  arrivalDate: Date
  departureDate: Date
  paxAdults: number
  paxChildren: number
  currency: string
  quotedTotal: unknown
  dealName: string | null
  tourDestination: string | null
  passengers?: { name: string }[]
}): BookingHit {
  return {
    id: b.id,
    bookingRef: b.bookingRef,
    isNumber: b.isNumber,
    agent: b.agent,
    status: b.status,
    operationCountry: b.operationCountry,
    arrivalDate: b.arrivalDate.toISOString(),
    departureDate: b.departureDate.toISOString(),
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    currency: b.currency,
    quotedTotal: b.quotedTotal == null ? null : Number(b.quotedTotal),
    leadGuest: b.passengers?.[0]?.name ?? null,
    dealName: b.dealName,
    tourDestination: b.tourDestination,
  }
}

const HIT_SELECT = Prisma.validator<Prisma.BookingSelect>()({
  id: true, bookingRef: true, isNumber: true, agent: true, status: true,
  operationCountry: true, arrivalDate: true, departureDate: true,
  paxAdults: true, paxChildren: true, currency: true, quotedTotal: true,
  dealName: true, tourDestination: true,
  // The lead passenger is the guest a hotel invoice is made out to.
  passengers: { select: { name: true }, orderBy: [{ isLead: 'desc' }, { id: 'asc' }], take: 1 },
})

/**
 * Find bookings by control number or IS number.
 *
 * Two passes, because the reference the user types is almost never spelled the
 * way it is stored. First an exact/`contains` pass that MySQL can index; then,
 * only if that found nothing, a normalised pass over a bounded candidate set —
 * "IS 48525", "is48525" and "IS48525" are one booking, and a LIKE cannot say so.
 */
export async function searchBookings(query: string, limit = 12): Promise<BookingHit[]> {
  const raw = query.trim()
  if (raw.length < 3) return []

  const rows = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingRef: { contains: raw } },
        { isNumber: { contains: raw } },
      ],
    },
    select: HIT_SELECT,
    orderBy: { arrivalDate: 'desc' },
    take: limit,
  })
  if (rows.length > 0) return rows.map(toHit)

  const key = refKey(raw)
  if (key.length < 3) return []

  // The digits alone are what survives every spelling of a reference on either
  // side, so they are what the fallback searches on.
  const digits = key.replace(/[^0-9]/g, '')
  if (digits.length < 3) return []

  const candidates = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingRef: { contains: digits } },
        { isNumber: { contains: digits } },
      ],
    },
    select: HIT_SELECT,
    orderBy: { arrivalDate: 'desc' },
    take: 200,
  })

  return candidates
    .filter(b => {
      const ref = refKey(b.bookingRef)
      const is = refKey(b.isNumber)
      return ref.includes(key) || key.includes(ref) || is.includes(key) || key.includes(is)
    })
    .slice(0, limit)
    .map(toHit)
}

export interface HotelSlot {
  /** accommodations.id, or `added:<hotelKey>` for a hotel only the invoices know. */
  key: string
  accommodationId: string | null
  hotelName: string
  city: string | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  roomType: string | null
  mealType: string | null
  /** The stay is the client's own arrangement — we owe the hotel nothing. */
  ownArrangement: boolean
  /** Not on the booking; it exists because somebody filed an invoice for it. */
  addedByUser: boolean
  invoices: ProformaRow[]
}

export interface ProformaRow {
  id: string
  bookingRef: string | null
  isNumber: string | null
  accommodationId: string | null
  hotelName: string | null
  city: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  currency: string
  amount: number | null
  taxAmount: number | null
  totalAmount: number | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  roomType: string | null
  mealPlan: string | null
  roomCount: number | null
  status: string
  origin: string
  hotelAdded: boolean
  fileUrl: string | null
  fileName: string | null
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** Accounts' answer, attached in the API layer. Null until they have one. */
  settlement: ProformaSettlement | null
}

/** What the Accounts app has done with an invoice. Read-only on this side. */
export interface ProformaSettlement {
  status: string
  payableStatus: string | null
  payableMatched: boolean
  hotelName: string | null
  currency: string | null
  paidAmount: number | null
  paidAt: string | null
  paidBy: string | null
  reference: string | null
  note: string | null
  hasReceipt: boolean
  receiptName: string | null
  receiptUrl: string | null
  updatedAt: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function toProformaRow(r: any): ProformaRow {
  const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : null)
  const num = (v: unknown) => (v == null ? null : Number(v))

  return {
    id: r.id,
    bookingRef: r.bookingRef ?? null,
    isNumber: r.isNumber ?? null,
    accommodationId: r.accommodationId ?? null,
    hotelName: r.hotelName ?? null,
    city: r.city ?? null,
    invoiceNumber: r.invoiceNumber ?? null,
    invoiceDate: iso(r.invoiceDate),
    dueDate: iso(r.dueDate),
    currency: r.currency ?? 'USD',
    amount: num(r.amount),
    taxAmount: num(r.taxAmount),
    totalAmount: num(r.totalAmount),
    checkIn: iso(r.checkIn),
    checkOut: iso(r.checkOut),
    nights: r.nights ?? null,
    roomType: r.roomType ?? null,
    mealPlan: r.mealPlan ?? null,
    roomCount: r.roomCount ?? null,
    status: r.status,
    origin: r.origin ?? 'RESERVATION',
    hotelAdded: Boolean(r.hotelAdded),
    fileUrl: r.fileUrl ?? null,
    fileName: r.fileName ?? null,
    notes: r.notes ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: iso(r.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(r.updatedAt) ?? new Date().toISOString(),
    settlement: null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Every proforma filed against a booking, under either of its references.
 *
 * Matched on the *normalised* reference rather than the stored string: an
 * invoice filed before an amendment carries the reference as it was spelled
 * then, and it still belongs to this booking.
 */
export async function invoicesForBooking(booking: { id: string; bookingRef: string; isNumber: string | null }) {
  const refs = [refKey(booking.bookingRef), refKey(booking.isNumber)].filter(Boolean)

  const rows = await prisma.proformaInvoice.findMany({
    where: {
      OR: [
        { bookingId: booking.id },
        { bookingRef: booking.bookingRef },
        ...(booking.isNumber ? [{ isNumber: booking.isNumber }] : []),
      ],
    },
    orderBy: [{ checkIn: 'asc' }, { createdAt: 'asc' }],
    take: 500,
  })

  return rows.filter(r =>
    r.bookingId === booking.id ||
    refs.includes(refKey(r.bookingRef)) ||
    refs.includes(refKey(r.isNumber)),
  )
}

/**
 * The booking's hotels, each with the invoices filed against it.
 *
 * An invoice binds to a slot by accommodation id when it has one, and by hotel
 * name otherwise — which is what lets an invoice filed before an amendment
 * still appear under the right hotel after the accommodation rows were
 * rewritten. Anything that binds to nothing becomes its own "added" slot, so a
 * filed invoice can never disappear from the screen just because the booking
 * changed underneath it.
 */
export function buildHotelSlots(
  accommodations: {
    id: string
    hotel: string
    city: string
    checkIn: Date
    checkOut: Date
    nights: number
    roomType: string | null
    mealType: string | null
    ownArrangement: boolean
  }[],
  invoices: ProformaRow[],
): HotelSlot[] {
  const slots: HotelSlot[] = accommodations.map(a => ({
    key: a.id,
    accommodationId: a.id,
    hotelName: a.hotel,
    city: a.city,
    checkIn: a.checkIn.toISOString(),
    checkOut: a.checkOut.toISOString(),
    nights: a.nights,
    roomType: a.roomType,
    mealType: a.mealType,
    ownArrangement: a.ownArrangement,
    addedByUser: false,
    invoices: [],
  }))

  const byId = new Map(slots.map(s => [s.accommodationId as string, s]))
  const byName = new Map<string, HotelSlot>()
  for (const s of slots) {
    const k = hotelKey(s.hotelName)
    if (k && !byName.has(k)) byName.set(k, s)
  }

  for (const inv of invoices) {
    const direct = inv.accommodationId ? byId.get(inv.accommodationId) : undefined
    const named = direct ?? byName.get(hotelKey(inv.hotelName))
    if (named) {
      named.invoices.push(inv)
      continue
    }

    const k = hotelKey(inv.hotelName) || inv.id
    let extra = byName.get(k)
    if (!extra) {
      extra = {
        key: `added:${k}`,
        accommodationId: null,
        hotelName: inv.hotelName ?? 'Unnamed hotel',
        city: inv.city,
        checkIn: inv.checkIn,
        checkOut: inv.checkOut,
        nights: inv.nights,
        roomType: inv.roomType,
        mealType: inv.mealPlan,
        ownArrangement: false,
        addedByUser: true,
        invoices: [],
      }
      byName.set(k, extra)
      slots.push(extra)
    }
    extra.invoices.push(inv)
  }

  return slots
}

/** Where a booking's proforma PDFs live under the `uploads/` prefix. */
export function proformaFileKey(bookingRef: string, fileName: string): string {
  const safeRef = refKey(bookingRef) || 'UNFILED'
  const ext = (fileName.split('.').pop() ?? 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf'
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  return `proforma/${safeRef}/${stamp}.${ext}`
}

/** Accepted uploads. A proforma is paper — a PDF or a photograph of one. */
export const ACCEPTED_UPLOAD = /\.(pdf|jpe?g|png|webp|heic|heif)$/i
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024

/**
 * Store the invoice document and return what goes on the row.
 *
 * `putUpload` writes to the S3 bucket under `uploads/`; the returned path is
 * this app's own served URL. The key is kept alongside it because Accounts
 * streams the object out of the bucket directly rather than through a route
 * that would need an OPS session.
 */
export async function storeProformaFile(
  bookingRef: string,
  file: File,
): Promise<{ fileUrl: string; fileKey: string; fileName: string }> {
  const key = proformaFileKey(bookingRef, file.name)
  const buffer = Buffer.from(await file.arrayBuffer())
  const fileUrl = await putUpload(key, buffer, file.type || undefined)
  return { fileUrl, fileKey: `uploads/${key}`, fileName: file.name }
}
