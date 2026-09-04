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
 *   bookingRef        ← pnl.quotation_info.is_number   (spaces stripped, upper-cased;
 *                       falls back to the list row's is_number when the template says "NA")
 *   cntlNumber        ← quotation_no
 *   operationCountry  ← detected from the is_number prefix (VN/IS/SG/MY)
 *   agent             ← pnl.quotation_info.agent_name  (or relevant_parties.agent)
 *   agentBookingId    ← relevant_parties.agent_ref     (the operator's own ref)
 *   agentEmail        ← relevant_parties.agent_email
 *   fileHandler       ← confirmation_voucher.file_handler_name
 *   arrival/departure ← first / last itinerary date
 *   pax               ← pnl.quotation_info.pax.{adult,child}
 *   quotedTotal       ← pnl.cost.total
 *   currency          ← pnl.quotation_info.currency
 *   terms/includes/excludes/VAS ← the respective string arrays, newline-joined
 *   passengers        ← [ confirmation_voucher.guest_name ] (lead adult)
 *   accommodations    ← accommodation[]
 *   itineraryItems    ← itinerary[].activities[] (one item per activity), falling
 *                       back to the day's own route/description when a day sells
 *                       no activity — see `expandDay`
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
  ownArrangement: boolean
}

export interface MappedItineraryItem {
  dayNo: number
  date: string
  title: string
  description: string
}

/**
 * AppleSystem truncates long activity names to 50 characters, cutting the title
 * mid-word ("4 Island Tour (Professional Photoshoot & Drone Vid"). Those tours
 * repeat their full title as the first line of the description, so recover it
 * from there — the agenda generator copies `title` verbatim into `toPoint`, and
 * a half-word title makes the whole movement chart unusable.
 */
function resolveActivityTitle(name: string, description: string): string {
  const n = name.trim()
  const firstLine = description.split(/\r?\n/)[0].trim()
  if (n && firstLine.length > n.length && firstLine.startsWith(n)) return firstLine
  if (n) return n
  return firstLine
}

/**
 * Expand one AppleSystem itinerary day into the itinerary items we store.
 *
 * A day carries a generic `route`/`description` pair (often the boilerplate
 * "Day at leisure at the Hotel!") plus an `activities[]` array holding the
 * services actually sold that day. When activities are present they ARE the
 * day's content: each becomes its own item so a day with two transfers yields
 * two rows. Only a day with no activities falls back to the day-level route and
 * description.
 */
function expandDay(day: {
  dayNo: number
  date: string
  route: string
  description: string
  activities: { name: string; description: string }[]
}): MappedItineraryItem[] {
  const acts = day.activities
    .map((a) => ({ title: resolveActivityTitle(a.name, a.description), description: a.description.trim() }))
    .filter((a) => a.title || a.description)

  if (acts.length === 0) {
    return [{
      dayNo: day.dayNo,
      date: day.date,
      title: (day.route || `Day ${day.dayNo}`).slice(0, 1000),
      description: day.description,
    }]
  }

  return acts.map((a) => ({
    dayNo: day.dayNo,
    date: day.date,
    title: (a.title || day.route || `Day ${day.dayNo}`).slice(0, 1000),
    description: a.description,
  }))
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
  agentEmail: string | null
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

export interface MapQuoteOptions {
  /**
   * IS number from the `/api/quotation/list` row, used when the quote template
   * itself carries none (some payloads return "NA"). The list is the same
   * source of truth, so this only fills a gap — it never overrides.
   */
  fallbackIsNumber?: string | null
}

/**
 * Map a raw AppleSystem quote-template object into a `MappedBookingInput`.
 * Throws `ASMappingError` when the payload is missing the identifiers we cannot
 * synthesise (is_number, and at least one dated itinerary day).
 */
export function mapQuoteToBooking(
  quote: Record<string, unknown>,
  options: MapQuoteOptions = {},
): MappedBookingInput {
  const info = (get(quote, 'pnl', 'quotation_info') ?? {}) as Record<string, unknown>
  const voucher = (get(quote, 'confirmation_voucher') ?? {}) as Record<string, unknown>
  const parties = (get(quote, 'relevant_parties') ?? {}) as Record<string, unknown>

  const usable = (v: string) => !!v && v.toUpperCase() !== 'NA'
  const templateIsNumber = str(info.is_number).trim()
  const fallback = str(options.fallbackIsNumber).trim()
  const rawIsNumber = usable(templateIsNumber) ? templateIsNumber : fallback
  if (!usable(rawIsNumber)) {
    throw new ASMappingError('This AppleSystem quotation has no IS number, so it cannot be imported.')
  }
  const bookingRef = normalizeIsNumber(rawIsNumber)

  // Itinerary → dated days (sorted), driving arrival/departure + itinerary items.
  const rawItin = Array.isArray(quote.itinerary) ? (quote.itinerary as Record<string, unknown>[]) : []
  const days = rawItin
    .map((d) => ({
      dayNo: intOf(d.day),
      date: str(d.date).trim(),
      route: str(d.route).trim(),
      description: str(d.description).trim(),
      activities: (Array.isArray(d.activities) ? (d.activities as Record<string, unknown>[]) : []).map((a) => ({
        name: str(a.name).trim(),
        description: str(a.description).trim(),
      })),
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
    .map((h) => {
      const ownArrangement = str(h.type).trim().toLowerCase() === 'own_arrangement'
      return {
        city: str(h.city).trim(),
        // Never invent a hotel name. AppleSystem sends no `name` for own-arrangement
        // stays, and writing "Own Arrangement" into the name field wipes whatever the
        // real hotel was — the own-arrangement flag already drives the UI badge.
        hotel: str(h.name).trim(),
        checkIn: str(h.check_in).trim(),
        checkOut: str(h.check_out).trim(),
        nights: intOf(h.nights),
        roomType: str(h.room_type).trim() || str(h.cabin_type).trim() || null,
        mealType: str(h.meal_plan).trim() || null,
        address: '',
        ownArrangement,
      }
    })
    .filter(
      (h) =>
        (h.hotel || h.ownArrangement) &&
        /^\d{4}-\d{2}-\d{2}/.test(h.checkIn) &&
        /^\d{4}-\d{2}-\d{2}/.test(h.checkOut),
    )

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

  // ── Agent / relevant parties ───────────────────────────────────────────────
  // AppleSystem carries the whole agent block under `relevant_parties`:
  //   agent       → tour operator name           ("Make My Trip")
  //   agent_ref   → the operator's OWN booking reference ("143") → agentBookingId
  //   agent_email → the operator's contact mailbox
  //   agent_id    → AppleSystem's internal party id, not an agent-facing ref
  // Only the name was being read before, which is why "Agent Ref. No." stayed
  // empty on every imported file. `agent_id` is deliberately NOT used as the
  // agent ref — it is an internal id and mirrors the guest id.
  const agentName = str(info.agent_name).trim() || str(parties.agent).trim()
  const agentRef = str(parties.agent_ref).trim()
  const agentEmail = str(parties.agent_email).trim()

  const quotedTotal =
    numOrNull(get(quote, 'pnl', 'cost', 'total')) ??
    numOrNull(get(quote, 'pnl', 'cost'))

  return {
    bookingRef,
    isNumber: bookingRef,
    cntlNumber:
      str(quote.quotation_no).trim() ||
      str(get(quote, 'reference_numbers', 'quotation_no')).trim() ||
      str(get(quote, 'reference_numbers', 'formatted')).trim() ||
      null,
    agentBookingId: usable(agentRef) ? agentRef : null,
    operationCountry: detectCountryFromRef(bookingRef),
    agent: usable(agentName) ? agentName : null,
    agentEmail: usable(agentEmail) ? agentEmail : null,
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
    itineraryItems: days.flatMap(expandDay),
    emergencyContacts,
    flights: [],
    source: {
      quotationNo: str(quote.quotation_no).trim(),
      referenceId: str(quote.reference_id).trim(),
      revision: numOrNull(quote.revision),
    },
  }
}
