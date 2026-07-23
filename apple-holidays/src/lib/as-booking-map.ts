/**
 * AppleSystem quote → local Booking mapper.
 *
 * Pure, side-effect-free translation of the AppleSystem "quote template"
 * payload (see `getQuoteTemplate` in `applesystem.ts`) into the exact shape our
 * `POST /api/bookings` creation logic already consumes. Keeping this as a pure
 * function means it can be reused by both the manual "Import to System" action
 * and the daily auto-create job, and unit-reasoned about without any network or
 * database access.
 *
 * Field mapping is defined by the AppleSystem integration spec:
 *   bookingRef        ← pnl.quotation_info.is_number   (spaces stripped, upper-cased)
 *   cntlNumber        ← quotation_no
 *   operationCountry  ← detected from the is_number prefix (VN/IS/SG/MY)
 *   agent             ← pnl.quotation_info.agent_name  (or relevant_parties.agent)
 *   fileHandler       ← confirmation_voucher.file_handler_name
 *   arrival/departure ← first / last itinerary date
 *   pax               ← pnl.quotation_info.pax.{adult,child}
 *   quotedTotal       ← pnl.cost.total
 *   currency          ← pnl.quotation_info.currency
 *   terms/includes/excludes/VAS ← the respective string arrays, newline-joined
 *   passengers        ← [ confirmation_voucher.guest_name ] (lead adult)
 *   accommodations    ← accommodation[]
 *   itineraryItems    ← itinerary[]
 *   emergencyContacts ← [ confirmation_voucher.emergency_contact ]
 *   flights           ← [] (not present in the AppleSystem payload)
 */

import { detectCountryFromRef, type OperationCountry } from './country-detection'

// ── Safe accessors ───────────────────────────────────────────────────────────
function get(obj: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

function str(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  return ''
}

function intOf(node: unknown): number {
  const n = Number(node)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function numOrNull(node: unknown): number | null {
  if (node == null || node === '') return null
  const n = Number(node)
  return Number.isFinite(n) ? n : null
}

/** Join a string[] with newlines, tolerating a scalar string or a missing value. */
function joinLines(node: unknown): string | null {
  if (Array.isArray(node)) {
    const lines = node.map((x) => str(x).trim()).filter(Boolean)
    return lines.length ? lines.join('\n') : null
  }
  const s = str(node).trim()
  return s || null
}

/** Normalise an is_number ("VN 40659") to a compact, upper-case ref ("VN40659"). */
export function normalizeIsNumber(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase().trim()
}

// ── Output shapes (match the POST /api/bookings body) ────────────────────────
export interface MappedPassenger {
  name: string
  type: 'ADULT' | 'CHILD' | 'INFANT'
  age: number | null
  isLead: boolean
  passport: string
  nationality: string
}

export interface MappedAccommodation {
  city: string
  hotel: string
  checkIn: string
  checkOut: string
  nights: number
  roomType: string | null
  mealType: string | null
  address: string
}

export interface MappedItineraryItem {
  dayNo: number
  date: string
  title: string
  description: string
}

export interface MappedEmergencyContact {
  name: string
  phone: string
  role: string
}

export interface MappedBookingInput {
  bookingRef: string
  isNumber: string
  cntlNumber: string | null
  agentBookingId: string | null
  operationCountry: OperationCountry | null
  agent: string | null
  fileHandler: string | null
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: number | null
  currency: string
  terms: string | null
  packageIncludes: string | null
  packageExcludes: string | null
  valueAddedServices: string | null
  contactEmail: string | null
  passengers: MappedPassenger[]
  accommodations: MappedAccommodation[]
  itineraryItems: MappedItineraryItem[]
  emergencyContacts: MappedEmergencyContact[]
  flights: never[]
  /** Source references, kept for auditing / linking back to AppleSystem. */
  source: { quotationNo: string; referenceId: string; revision: number | null }
}

export class ASMappingError extends Error {}

/**
 * Map a raw AppleSystem quote-template object into a `MappedBookingInput`.
 * Throws `ASMappingError` when the payload is missing the identifiers we cannot
 * synthesise (is_number, and at least one dated itinerary day).
 */
export function mapQuoteToBooking(quote: Record<string, unknown>): MappedBookingInput {
  const info = (get(quote, 'pnl', 'quotation_info') ?? {}) as Record<string, unknown>
  const voucher = (get(quote, 'confirmation_voucher') ?? {}) as Record<string, unknown>
  const parties = (get(quote, 'relevant_parties') ?? {}) as Record<string, unknown>

  const rawIsNumber = str(info.is_number).trim()
  if (!rawIsNumber || rawIsNumber.toUpperCase() === 'NA') {
    throw new ASMappingError('This AppleSystem quotation has no IS number, so it cannot be imported.')
  }
  const bookingRef = normalizeIsNumber(rawIsNumber)

  // Itinerary → dated days (sorted), driving arrival/departure + itinerary items.
  const rawItin = Array.isArray(quote.itinerary) ? (quote.itinerary as Record<string, unknown>[]) : []
  const days = rawItin
    .map((d) => ({
      dayNo: intOf(d.day),
      date: str(d.date).trim(),
      title: str(d.route).trim() || `Day ${intOf(d.day)}`,
      description: str(d.description).trim(),
    }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d.date))
    .sort((a, b) => (a.dayNo - b.dayNo) || a.date.localeCompare(b.date))

  if (days.length === 0) {
    throw new ASMappingError('This AppleSystem quotation has no dated itinerary, so arrival/departure cannot be determined.')
  }
  const arrivalDate = days[0].date
  const departureDate = days[days.length - 1].date

  const pax = (info.pax ?? {}) as Record<string, unknown>

  // Accommodations
  const rawAcc = Array.isArray(quote.accommodation) ? (quote.accommodation as Record<string, unknown>[]) : []
  const accommodations: MappedAccommodation[] = rawAcc
    .map((h) => ({
      city: str(h.city).trim(),
      hotel: str(h.name).trim(),
      checkIn: str(h.check_in).trim(),
      checkOut: str(h.check_out).trim(),
      nights: intOf(h.nights),
      roomType: str(h.room_type).trim() || str(h.cabin_type).trim() || null,
      mealType: str(h.meal_plan).trim() || null,
      address: '',
    }))
    .filter((h) => h.hotel && /^\d{4}-\d{2}-\d{2}/.test(h.checkIn) && /^\d{4}-\d{2}-\d{2}/.test(h.checkOut))

  // Lead passenger from the confirmation voucher.
  const guestName = str(voucher.guest_name).trim()
  const passengers: MappedPassenger[] = guestName
    ? [{ name: guestName, type: 'ADULT', age: null, isLead: true, passport: '', nationality: '' }]
    : []

  // Emergency contact (a free-text blob in the AS payload).
  const emergency = str(voucher.emergency_contact).trim()
  const emergencyContacts: MappedEmergencyContact[] = emergency
    ? [{ name: 'Emergency', phone: emergency, role: '24/7 Emergency' }]
    : []

  const quotedTotal =
    numOrNull(get(quote, 'pnl', 'cost', 'total')) ??
    numOrNull(get(quote, 'pnl', 'cost'))

  return {
    bookingRef,
    isNumber: bookingRef,
    cntlNumber: str(quote.quotation_no).trim() || null,
    agentBookingId: null,
    operationCountry: detectCountryFromRef(bookingRef),
    agent: str(info.agent_name).trim() || str(parties.agent).trim() || null,
    fileHandler: str(voucher.file_handler_name).trim() || null,
    arrivalDate,
    departureDate,
    paxAdults: intOf(pax.adult),
    paxChildren: intOf(pax.child),
    quotedTotal,
    currency: str(info.currency).trim() || 'USD',
    terms: joinLines(quote.terms_and_conditions),
    packageIncludes: joinLines(quote.package_includes),
    packageExcludes: joinLines(quote.package_excludes),
    valueAddedServices: joinLines(quote.value_added_services),
    contactEmail: str(voucher.guest_email).trim() || null,
    passengers,
    accommodations,
    itineraryItems: days.map((d) => ({ dayNo: d.dayNo, date: d.date, title: d.title.slice(0, 1000), description: d.description })),
    emergencyContacts,
    flights: [],
    source: {
      quotationNo: str(quote.quotation_no).trim(),
      referenceId: str(quote.reference_id).trim(),
      revision: numOrNull(quote.revision),
    },
  }
}
