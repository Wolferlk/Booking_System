/**
 * Aahaas B2B bookings — read model.
 *
 * `b2b_bookings` is the order header written by the Aahaas B2B agent portal.
 * Every component the agent bought hangs off it by `booking_id`:
 *
 *     b2b_bookings ──┬── b2b_booking_flights
 *                    ├── b2b_booking_hotels
 *                    ├── b2b_booking_insurances
 *                    └── b2b_booking_lifestyles
 *
 * Only `status = 'confirmed'` headers are ever surfaced — that is the product
 * decision, enforced here in one place (`CONFIRMED_ONLY`) rather than repeated
 * across the routes, so no caller can accidentally widen it.
 *
 * Everything in this file reads through `b2b-db.ts`, which physically refuses to
 * send anything but SELECT/SHOW. There is no write path, by construction.
 *
 * Robustness note: the four component tables are newer than the header table and
 * may not exist on every environment. Each read is probed once (`hasTable`) and
 * degrades to an empty list plus a warning rather than 500-ing the page.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { b2bQuery, b2bBatch, isB2bConfigured } from './b2b-db'

/** The single gate: nothing but confirmed orders leaves this module. */
const CONFIRMED_ONLY = "b.status = 'confirmed' AND b.deleted_at IS NULL"

export const COMPONENT_TABLES = [
  'b2b_booking_flights',
  'b2b_booking_hotels',
  'b2b_booking_insurances',
  'b2b_booking_lifestyles',
] as const

export type ComponentTable = (typeof COMPONENT_TABLES)[number]

// ─── Raw row types ────────────────────────────────────────────────────────────

export interface B2bBookingRow extends RowDataPacket {
  id: number
  uuid: string | null
  type: string | null
  user_id: number | null
  order_id: number | null
  category_id: number | null
  amount: string | null
  currency: string | null
  status: string | null
  order_status: string | null
  payment_status: string | null
  payment_method: string | null
  payment_reference: string | null
  transaction_id: number | null
  booking_data: string | null
  created_at: string | null
  updated_at: string | null
}

export interface B2bFlightRow extends RowDataPacket {
  id: number
  booking_id: number
  pnr_number: string | null
  booking_type: string | null
  aahaas_booking_id: number | null
  aahaas_order_id: number | null
  airline_code: string | null
  airline_name: string | null
  departure_city: string | null
  arrival_city: string | null
  departure_date: string | null
  return_date: string | null
  trip_type: string | null
  adult_count: number | null
  child_count: number | null
  infant_count: number | null
  cabin_class: string | null
  base_fare: string | null
  taxes: string | null
  total_amount: string | null
  currency: string | null
  status: string | null
  ticket_status: string | null
  flight_data: string | null
  passenger_data: string | null
  issued_at: string | null
  ticketed_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface B2bHotelRow extends RowDataPacket {
  id: number
  booking_id: number
  aahaas_prebooking_id: number | null
  aahaas_order_id: number | null
  hotel_id: number | null
  hotel_name: string | null
  hotel_code: string | null
  star_rating: number | null
  city: string | null
  country: string | null
  check_in_date: string | null
  check_out_date: string | null
  nights: number | null
  room_count: number | null
  adult_count: number | null
  child_count: number | null
  room_category: string | null
  room_type: string | null
  meal_plan: string | null
  room_rate: string | null
  total_amount: string | null
  currency: string | null
  status: string | null
  confirmation_number: string | null
  hotel_data: string | null
  guest_data: string | null
  room_breakdown: string | null
  special_requests: string | null
  confirmed_at: string | null
  cancellation_info: string | null
  created_at: string | null
  updated_at: string | null
}

export interface B2bInsuranceRow extends RowDataPacket {
  id: number
  booking_id: number
  aahaas_booking_id: number | null
  aahaas_order_id: number | null
  provider: string | null
  policy_type: string | null
  plan_name: string | null
  policy_number: string | null
  coverage_start_date: string | null
  coverage_end_date: string | null
  coverage_days: number | null
  destination_country: string | null
  traveler_count: number | null
  premium_amount: string | null
  coverage_amount: string | null
  total_amount: string | null
  currency: string | null
  status: string | null
  insurance_data: string | null
  traveler_data: string | null
  coverage_details: string | null
  issued_at: string | null
  expires_at: string | null
  created_at: string | null
  updated_at: string | null
}

export interface B2bLifestyleRow extends RowDataPacket {
  id: number
  booking_id: number
  aahaas_prebooking_id: number | null
  aahaas_order_id: number | null
  lifestyle_id: number | null
  lifestyle_name: string | null
  category: string | null
  sub_category: string | null
  service_date: string | null
  service_time: string | null
  adult_count: number | null
  child_count: number | null
  package_count: number | null
  unit_price: string | null
  discount_amount: string | null
  total_amount: string | null
  paid_amount: string | null
  currency: string | null
  status: string | null
  confirmation_number: string | null
  lifestyle_data: string | null
  participant_data: string | null
  special_requests: string | null
  confirmed_at: string | null
  cancellation_info: string | null
  created_at: string | null
  updated_at: string | null
}

// ─── JSON helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a longtext JSON column without ever throwing. Some of these columns are
 * written by different services at different times; a malformed blob must
 * degrade to `null`, never take a page down.
 */
export function parseJson<T = unknown>(raw: string | null | undefined): T | null {
  if (raw == null) return null
  if (typeof raw === 'object') return raw as T   // mysql2 already decoded a JSON column
  const text = String(raw).trim()
  if (!text || text === 'null') return null
  try {
    return JSON.parse(text) as T
  } catch {
    // Occasionally stored double-encoded ("\"{...}\"").
    try {
      const once = JSON.parse(`"${text.replace(/"/g, '\\"')}"`)
      return JSON.parse(once) as T
    } catch {
      return null
    }
  }
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ─── Table probing ────────────────────────────────────────────────────────────

const tableCache = new Map<string, boolean>()

async function hasTable(
  q: <R extends RowDataPacket>(sql: string, p?: unknown[]) => Promise<R[]>,
  table: string,
): Promise<boolean> {
  const cached = tableCache.get(table)
  if (cached !== undefined) return cached
  const rows = await q<RowDataPacket>('SHOW TABLES LIKE ?', [table])
  const exists = rows.length > 0
  tableCache.set(table, exists)
  return exists
}

// ─── Shaped output ────────────────────────────────────────────────────────────

/** What a component contributes to the header card: an icon key and a count. */
export interface ComponentCounts {
  flights: number
  hotels: number
  insurances: number
  lifestyles: number
}

export interface B2bBookingSummary {
  id: number
  uuid: string | null
  reference: string            // human reference: AAH-B2B-000123
  type: string | null
  orderId: number | null
  categoryId: number | null
  amount: number | null
  currency: string | null
  status: string | null
  orderStatus: string | null
  paymentStatus: string | null
  paymentMethod: string | null
  paymentReference: string | null
  createdAt: string | null
  updatedAt: string | null
  /** Agent / booker, resolved from booking_data when the portal stored it. */
  agentName: string | null
  agentEmail: string | null
  /** Lead traveller, best-effort across the component tables. */
  leadTraveller: string | null
  components: ComponentCounts
  /** e.g. ["CMB → SIN", "SIN → CMB"] — what the card shows at a glance. */
  routes: string[]
  /** Earliest travel date across every component; drives sorting and filters. */
  travelDate: string | null
  pnrs: string[]
  pax: number | null
}

export interface B2bBookingDetail extends B2bBookingSummary {
  transactionId: number | null
  bookingData: unknown
  flights: FlightComponent[]
  hotels: HotelComponent[]
  insurances: InsuranceComponent[]
  lifestyles: LifestyleComponent[]
  /** Component tables that are absent on this database. */
  warnings: string[]
}

export interface FlightSegment {
  itemId: unknown
  airlineCode: string | null
  airlineName: string | null
  flightNumber: string | null
  fromAirportCode: string | null
  toAirportCode: string | null
  departureDate: string | null
  departureTime: string | null
  arrivalDate: string | null
  arrivalTime: string | null
  departureTerminal: string | null
  arrivalTerminal: string | null
  departureGate: string | null
  arrivalGate: string | null
  cabinTypeName: string | null
  bookingClass: string | null
  aircraftTypeName: string | null
  durationInMinutes: number | null
  distanceInMiles: number | null
  status: string | null
  confirmationId: string | null
  meals: unknown
  baggage: { checkedKg: number | null; cabinKg: number | null; cabinPieces: number | null } | null
}

export interface FlightTraveler {
  type: string | null
  givenName: string | null
  surname: string | null
  fullName: string | null
  email: string | null
  phone: string | null
  documents: { type: string | null; number: string | null; nationality: string | null; expiry: string | null }[]
  ticketNumber: string | null
}

export interface FlightComponent {
  id: number
  pnr: string | null
  bookingType: string | null
  aahaasBookingId: number | null
  aahaasOrderId: number | null
  airlineCode: string | null
  airlineName: string | null
  departureCity: string | null
  arrivalCity: string | null
  departureDate: string | null
  returnDate: string | null
  tripType: string | null
  adults: number | null
  children: number | null
  infants: number | null
  cabinClass: string | null
  baseFare: number | null
  taxes: number | null
  total: number | null
  currency: string | null
  status: string | null
  ticketStatus: string | null
  issuedAt: string | null
  ticketedAt: string | null
  segments: FlightSegment[]
  travelers: FlightTraveler[]
  fareTotals: { subtotal: number | null; taxes: number | null; total: number | null; currency: string | null } | null
  fareRules: { passengerCode: string | null; refundable: boolean | null; changeable: boolean | null }[]
  tickets: { number: string | null; date: string | null; statusName: string | null; total: number | null; currency: string | null }[]
  /** Whole decoded blobs, kept so the UI can offer a raw inspector. */
  raw: { flightData: unknown; passengerData: unknown }
}

export interface HotelComponent {
  id: number
  hotelName: string | null
  hotelCode: string | null
  starRating: number | null
  city: string | null
  country: string | null
  checkIn: string | null
  checkOut: string | null
  nights: number | null
  rooms: number | null
  adults: number | null
  children: number | null
  roomCategory: string | null
  roomType: string | null
  mealPlan: string | null
  roomRate: number | null
  total: number | null
  currency: string | null
  status: string | null
  confirmationNumber: string | null
  specialRequests: string | null
  confirmedAt: string | null
  guests: { name: string | null; type: string | null }[]
  roomBreakdown: unknown
  cancellation: unknown
  raw: { hotelData: unknown; guestData: unknown }
}

export interface InsuranceComponent {
  id: number
  provider: string | null
  policyType: string | null
  planName: string | null
  policyNumber: string | null
  coverageStart: string | null
  coverageEnd: string | null
  coverageDays: number | null
  destinationCountry: string | null
  travelerCount: number | null
  premium: number | null
  coverageAmount: number | null
  total: number | null
  currency: string | null
  status: string | null
  issuedAt: string | null
  expiresAt: string | null
  travelers: { name: string | null; passport: string | null; dob: string | null }[]
  coverageDetails: unknown
  raw: { insuranceData: unknown; travelerData: unknown }
}

export interface LifestyleComponent {
  id: number
  name: string | null
  category: string | null
  subCategory: string | null
  serviceDate: string | null
  serviceTime: string | null
  adults: number | null
  children: number | null
  packages: number | null
  unitPrice: number | null
  discount: number | null
  total: number | null
  paid: number | null
  currency: string | null
  status: string | null
  confirmationNumber: string | null
  specialRequests: string | null
  confirmedAt: string | null
  participants: { name: string | null; type: string | null }[]
  cancellation: unknown
  raw: { lifestyleData: unknown; participantData: unknown }
}

// ─── Shapers ──────────────────────────────────────────────────────────────────

export function bookingReference(id: number, uuid?: string | null): string {
  void uuid
  return `AAH-B2B-${String(id).padStart(6, '0')}`
}

/** Pull the first non-empty value at any of the given dotted paths. */
function pick(obj: unknown, paths: string[]): unknown {
  for (const path of paths) {
    let cur: unknown = obj
    for (const key of path.split('.')) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break }
      cur = (cur as Record<string, unknown>)[key]
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur
  }
  return null
}

function str(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v.trim() || null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>)
  return []
}

function shapeSegment(f: unknown): FlightSegment {
  const o = (f ?? {}) as Record<string, unknown>
  const bag = (o.baggage ?? o.baggageAllowance ?? null) as Record<string, unknown> | null
  const checked = bag ? (bag.checkedBaggageAllowance as Record<string, unknown> | undefined) : undefined
  const cabin = bag ? (bag.cabinBaggageAllowance as Record<string, unknown> | undefined) : undefined
  return {
    itemId: o.itemId ?? null,
    airlineCode: str(o.airlineCode),
    airlineName: str(o.airlineName),
    flightNumber: str(o.flightNumber),
    fromAirportCode: str(o.fromAirportCode ?? o.from ?? o.origin),
    toAirportCode: str(o.toAirportCode ?? o.to ?? o.destination),
    departureDate: str(o.departureDate),
    departureTime: str(o.departureTime),
    arrivalDate: str(o.arrivalDate),
    arrivalTime: str(o.arrivalTime),
    departureTerminal: str(o.departureTerminalName),
    arrivalTerminal: str(o.arrivalTerminalName),
    departureGate: str(o.departureGate),
    arrivalGate: str(o.arrivalGate),
    cabinTypeName: str(o.cabinTypeName ?? o.cabinTypeCode),
    bookingClass: str(o.bookingClass),
    aircraftTypeName: str(o.aircraftTypeName ?? o.aircraftTypeCode),
    durationInMinutes: num(o.durationInMinutes),
    distanceInMiles: num(o.distanceInMiles),
    status: str(o.flightStatusName ?? o.status),
    confirmationId: str(o.confirmationId),
    meals: o.meals ?? null,
    baggage: bag
      ? {
          checkedKg: num(checked?.totalWeightInKilograms),
          cabinKg: num(cabin?.maximumWeightInKilograms),
          cabinPieces: num(cabin?.maximumPieces),
        }
      : null,
  }
}

function shapeTraveler(t: unknown, tickets: FlightComponent['tickets']): FlightTraveler {
  const o = (t ?? {}) as Record<string, unknown>
  const given = str(o.givenName ?? o.firstName ?? o.first_name)
  const sur = str(o.surname ?? o.lastName ?? o.last_name)
  const emails = asArray(o.emails)
  const phones = asArray(o.phones)
  const docs = asArray(o.identityDocuments ?? o.documents).map((d) => {
    const dd = (d ?? {}) as Record<string, unknown>
    return {
      type: str(dd.documentType ?? dd.type),
      number: str(dd.documentNumber ?? dd.number),
      nationality: str(dd.issuingCountryCode ?? dd.nationality ?? dd.nationalityCode),
      expiry: str(dd.expiryDate ?? dd.expirationDate),
    }
  })
  const fullName = [given, sur].filter(Boolean).join(' ') || str(o.name ?? o.fullName)
  // A ticket carries no traveller id in every provider payload, so only match
  // when the count lines up 1:1 — a wrong ticket number is worse than none.
  const ticketNumber = tickets.length === 1 ? tickets[0].number : null
  return {
    type: str(o.type ?? o.passengerType),
    givenName: given,
    surname: sur,
    fullName: fullName || null,
    email: str(typeof emails[0] === 'object' ? (emails[0] as Record<string, unknown>).address : emails[0]) ?? str(o.email),
    phone: str(typeof phones[0] === 'object' ? (phones[0] as Record<string, unknown>).number : phones[0]) ?? str(o.phone),
    documents: docs,
    ticketNumber,
  }
}

function shapeFlight(r: B2bFlightRow): FlightComponent {
  const fd = parseJson<Record<string, unknown>>(r.flight_data)
  const pd = parseJson<unknown>(r.passenger_data)

  const segments = asArray(pick(fd, ['flights', 'segments', 'itineraries'])).map(shapeSegment)

  const tickets = asArray(pick(fd, ['flightTickets', 'tickets'])).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>
    const pay = (o.payment ?? {}) as Record<string, unknown>
    return {
      number: str(o.number),
      date: str(o.date),
      statusName: str(o.ticketStatusName ?? o.ticketStatusCode),
      total: num(pay.total),
      currency: str(pay.currencyCode),
    }
  })

  // Passengers may live in either column depending on which portal flow wrote it.
  const travelerSource = asArray(pd).length ? asArray(pd) : asArray(pick(fd, ['travelers', 'passengers']))
  const travelers = travelerSource.map((t) => shapeTraveler(t, tickets))

  const fare0 = asArray(pick(fd, ['fares']))[0] as Record<string, unknown> | undefined
  const totals = (fare0?.totals ?? null) as Record<string, unknown> | null

  const fareRules = asArray(pick(fd, ['fareRules'])).map((fr) => {
    const o = (fr ?? {}) as Record<string, unknown>
    return {
      passengerCode: str(o.passengerCode),
      refundable: typeof o.isRefundable === 'boolean' ? o.isRefundable : null,
      changeable: typeof o.isChangeable === 'boolean' ? o.isChangeable : null,
    }
  })

  return {
    id: r.id,
    pnr: r.pnr_number,
    bookingType: r.booking_type,
    aahaasBookingId: r.aahaas_booking_id,
    aahaasOrderId: r.aahaas_order_id,
    airlineCode: r.airline_code,
    airlineName: r.airline_name,
    departureCity: r.departure_city,
    arrivalCity: r.arrival_city,
    departureDate: r.departure_date,
    returnDate: r.return_date,
    tripType: r.trip_type,
    adults: r.adult_count,
    children: r.child_count,
    infants: r.infant_count,
    cabinClass: r.cabin_class,
    baseFare: num(r.base_fare),
    taxes: num(r.taxes),
    total: num(r.total_amount),
    currency: r.currency,
    status: r.status,
    ticketStatus: r.ticket_status,
    issuedAt: r.issued_at,
    ticketedAt: r.ticketed_at,
    segments,
    travelers,
    fareTotals: totals
      ? {
          subtotal: num(totals.subtotal),
          taxes: num(totals.taxes),
          total: num(totals.total),
          currency: str(totals.currencyCode),
        }
      : null,
    fareRules,
    tickets,
    raw: { flightData: fd, passengerData: pd },
  }
}

function shapeHotel(r: B2bHotelRow): HotelComponent {
  const guestData = parseJson<unknown>(r.guest_data)
  const guests = asArray(guestData).map((g) => {
    const o = (g ?? {}) as Record<string, unknown>
    const name = str(o.name ?? o.fullName)
      ?? [str(o.firstName ?? o.givenName), str(o.lastName ?? o.surname)].filter(Boolean).join(' ')
    return { name: name || null, type: str(o.type ?? o.paxType) }
  })
  return {
    id: r.id,
    hotelName: r.hotel_name,
    hotelCode: r.hotel_code,
    starRating: r.star_rating,
    city: r.city,
    country: r.country,
    checkIn: r.check_in_date,
    checkOut: r.check_out_date,
    nights: r.nights,
    rooms: r.room_count,
    adults: r.adult_count,
    children: r.child_count,
    roomCategory: r.room_category,
    roomType: r.room_type,
    mealPlan: r.meal_plan,
    roomRate: num(r.room_rate),
    total: num(r.total_amount),
    currency: r.currency,
    status: r.status,
    confirmationNumber: r.confirmation_number,
    specialRequests: r.special_requests,
    confirmedAt: r.confirmed_at,
    guests,
    roomBreakdown: parseJson(r.room_breakdown),
    cancellation: parseJson(r.cancellation_info),
    raw: { hotelData: parseJson(r.hotel_data), guestData },
  }
}

function shapeInsurance(r: B2bInsuranceRow): InsuranceComponent {
  const travelerData = parseJson<unknown>(r.traveler_data)
  const travelers = asArray(travelerData).map((t) => {
    const o = (t ?? {}) as Record<string, unknown>
    const name = str(o.name ?? o.fullName)
      ?? [str(o.firstName ?? o.givenName), str(o.lastName ?? o.surname)].filter(Boolean).join(' ')
    return {
      name: name || null,
      passport: str(o.passport ?? o.passportNumber ?? o.nic),
      dob: str(o.dob ?? o.dateOfBirth ?? o.birthDate),
    }
  })
  return {
    id: r.id,
    provider: r.provider,
    policyType: r.policy_type,
    planName: r.plan_name,
    policyNumber: r.policy_number,
    coverageStart: r.coverage_start_date,
    coverageEnd: r.coverage_end_date,
    coverageDays: r.coverage_days,
    destinationCountry: r.destination_country,
    travelerCount: r.traveler_count,
    premium: num(r.premium_amount),
    coverageAmount: num(r.coverage_amount),
    total: num(r.total_amount),
    currency: r.currency,
    status: r.status,
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
    travelers,
    coverageDetails: parseJson(r.coverage_details),
    raw: { insuranceData: parseJson(r.insurance_data), travelerData },
  }
}

function shapeLifestyle(r: B2bLifestyleRow): LifestyleComponent {
  const participantData = parseJson<unknown>(r.participant_data)
  const participants = asArray(participantData).map((p) => {
    const o = (p ?? {}) as Record<string, unknown>
    const name = str(o.name ?? o.fullName)
      ?? [str(o.firstName ?? o.givenName), str(o.lastName ?? o.surname)].filter(Boolean).join(' ')
    return { name: name || null, type: str(o.type ?? o.paxType) }
  })
  return {
    id: r.id,
    name: r.lifestyle_name,
    category: r.category,
    subCategory: r.sub_category,
    serviceDate: r.service_date,
    serviceTime: r.service_time,
    adults: r.adult_count,
    children: r.child_count,
    packages: r.package_count,
    unitPrice: num(r.unit_price),
    discount: num(r.discount_amount),
    total: num(r.total_amount),
    paid: num(r.paid_amount),
    currency: r.currency,
    status: r.status,
    confirmationNumber: r.confirmation_number,
    specialRequests: r.special_requests,
    confirmedAt: r.confirmed_at,
    participants,
    cancellation: parseJson(r.cancellation_info),
    raw: { lifestyleData: parseJson(r.lifestyle_data), participantData },
  }
}

/** Agent identity, if the portal put it in booking_data. Shapes vary by flow. */
function agentFromBookingData(bd: unknown): { name: string | null; email: string | null } {
  return {
    name: str(pick(bd, ['agent.name', 'user.name', 'company.name', 'agent_name', 'customer.name', 'contact.name'])),
    email: str(pick(bd, ['agent.email', 'user.email', 'agent_email', 'customer.email', 'contact.email', 'email'])),
  }
}

function earliest(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d) && d !== '0000-00-00')
  if (!valid.length) return null
  return valid.sort()[0]
}

// ─── Queries ──────────────────────────────────────────────────────────────────

const HEADER_COLS = `
  b.id, b.uuid, b.type, b.user_id, b.order_id, b.category_id, b.amount, b.currency,
  b.status, b.order_status, b.payment_status, b.payment_method, b.payment_reference,
  b.transaction_id, b.booking_data, b.created_at, b.updated_at
`

export interface ListParams {
  search?: string
  from?: string          // created_at floor (YYYY-MM-DD)
  to?: string            // created_at ceiling (YYYY-MM-DD)
  component?: 'flights' | 'hotels' | 'insurances' | 'lifestyles' | 'all'
  paymentStatus?: string
  limit?: number
  offset?: number
}

export interface ListResult {
  bookings: B2bBookingSummary[]
  total: number
  stats: {
    confirmed: number
    grossByCurrency: { currency: string; amount: number; count: number }[]
    componentTotals: ComponentCounts
    last30Days: number
  }
  warnings: string[]
}

/**
 * Confirmed B2B bookings, newest first, with a one-line component summary each.
 *
 * Deliberately two round-trips inside one connection instead of a five-way JOIN:
 * joining four one-to-many tables multiplies rows and makes the header amounts
 * wrong the moment a booking has two flights and two hotels.
 */
export async function listB2bBookings(params: ListParams = {}): Promise<ListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)

  return b2bBatch(async (q) => {
    const warnings: string[] = []
    const present: Record<ComponentTable, boolean> = {
      b2b_booking_flights: await hasTable(q, 'b2b_booking_flights'),
      b2b_booking_hotels: await hasTable(q, 'b2b_booking_hotels'),
      b2b_booking_insurances: await hasTable(q, 'b2b_booking_insurances'),
      b2b_booking_lifestyles: await hasTable(q, 'b2b_booking_lifestyles'),
    }
    for (const t of COMPONENT_TABLES) {
      if (!present[t]) warnings.push(`Table ${t} is not present on this database — those components are not shown.`)
    }

    const where: string[] = [CONFIRMED_ONLY]
    const args: unknown[] = []

    if (params.from) { where.push('b.created_at >= ?'); args.push(`${params.from} 00:00:00`) }
    if (params.to)   { where.push('b.created_at <= ?'); args.push(`${params.to} 23:59:59`) }
    if (params.paymentStatus && params.paymentStatus !== 'all') {
      where.push('b.payment_status = ?'); args.push(params.paymentStatus)
    }

    // Search spans the header and — when the table exists — the flight PNR,
    // because "find me PNR X" is the single most common lookup on this desk.
    const term = (params.search ?? '').trim()
    if (term) {
      const like = `%${term}%`
      const clauses = [
        'b.uuid LIKE ?', 'b.payment_reference LIKE ?', 'CAST(b.id AS CHAR) LIKE ?',
        'CAST(b.order_id AS CHAR) LIKE ?', 'b.booking_data LIKE ?',
      ]
      args.push(like, like, like, like, like)
      if (present.b2b_booking_flights) {
        clauses.push('EXISTS (SELECT 1 FROM b2b_booking_flights f WHERE f.booking_id = b.id AND f.deleted_at IS NULL AND (f.pnr_number LIKE ? OR f.airline_name LIKE ? OR f.departure_city LIKE ? OR f.arrival_city LIKE ? OR f.passenger_data LIKE ?))')
        args.push(like, like, like, like, like)
      }
      if (present.b2b_booking_hotels) {
        clauses.push('EXISTS (SELECT 1 FROM b2b_booking_hotels h WHERE h.booking_id = b.id AND h.deleted_at IS NULL AND (h.hotel_name LIKE ? OR h.confirmation_number LIKE ? OR h.city LIKE ?))')
        args.push(like, like, like)
      }
      if (present.b2b_booking_insurances) {
        clauses.push('EXISTS (SELECT 1 FROM b2b_booking_insurances i WHERE i.booking_id = b.id AND i.deleted_at IS NULL AND (i.policy_number LIKE ? OR i.plan_name LIKE ? OR i.provider LIKE ?))')
        args.push(like, like, like)
      }
      if (present.b2b_booking_lifestyles) {
        clauses.push('EXISTS (SELECT 1 FROM b2b_booking_lifestyles l WHERE l.booking_id = b.id AND l.deleted_at IS NULL AND (l.lifestyle_name LIKE ? OR l.confirmation_number LIKE ? OR l.category LIKE ?))')
        args.push(like, like, like)
      }
      where.push(`(${clauses.join(' OR ')})`)
    }

    const comp = params.component && params.component !== 'all' ? params.component : null
    if (comp) {
      const table = `b2b_booking_${comp}` as ComponentTable
      if (present[table]) {
        where.push(`EXISTS (SELECT 1 FROM ${table} c WHERE c.booking_id = b.id AND c.deleted_at IS NULL)`)
      } else {
        where.push('1 = 0')
      }
    }

    const whereSql = where.join(' AND ')

    const [countRow] = await q<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM b2b_bookings b WHERE ${whereSql}`, args,
    )
    const total = Number(countRow?.n ?? 0)

    const rows = await q<B2bBookingRow>(
      `SELECT ${HEADER_COLS} FROM b2b_bookings b WHERE ${whereSql}
       ORDER BY b.created_at DESC, b.id DESC LIMIT ${limit} OFFSET ${offset}`,
      args,
    )

    const summaries = await decorate(q, rows, present)

    // Board-level stats over the whole confirmed set, not just this page.
    const grossRows = await q<RowDataPacket & { currency: string; amount: string; n: number }>(
      `SELECT COALESCE(b.currency,'—') AS currency, SUM(b.amount) AS amount, COUNT(*) AS n
       FROM b2b_bookings b WHERE ${CONFIRMED_ONLY} GROUP BY b.currency ORDER BY amount DESC`,
    )
    const [recentRow] = await q<RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM b2b_bookings b
       WHERE ${CONFIRMED_ONLY} AND b.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
    )

    const componentTotals: ComponentCounts = { flights: 0, hotels: 0, insurances: 0, lifestyles: 0 }
    for (const [key, table] of [
      ['flights', 'b2b_booking_flights'],
      ['hotels', 'b2b_booking_hotels'],
      ['insurances', 'b2b_booking_insurances'],
      ['lifestyles', 'b2b_booking_lifestyles'],
    ] as const) {
      if (!present[table]) continue
      const [row] = await q<RowDataPacket & { n: number }>(
        `SELECT COUNT(*) AS n FROM ${table} c
         JOIN b2b_bookings b ON b.id = c.booking_id
         WHERE ${CONFIRMED_ONLY} AND c.deleted_at IS NULL`,
      )
      componentTotals[key] = Number(row?.n ?? 0)
    }

    return {
      bookings: summaries,
      total,
      stats: {
        confirmed: total,
        grossByCurrency: grossRows.map((g) => ({
          currency: g.currency, amount: Number(g.amount ?? 0), count: Number(g.n ?? 0),
        })),
        componentTotals,
        last30Days: Number(recentRow?.n ?? 0),
      },
      warnings,
    }
  })
}

/** Attach component counts / routes / lead traveller to a page of headers. */
async function decorate(
  q: <R extends RowDataPacket>(sql: string, p?: unknown[]) => Promise<R[]>,
  rows: B2bBookingRow[],
  present: Record<ComponentTable, boolean>,
): Promise<B2bBookingSummary[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const inList = ids.join(',')   // integers straight from the DB — no injection surface

  const flights = present.b2b_booking_flights
    ? await q<B2bFlightRow>(
        `SELECT * FROM b2b_booking_flights WHERE booking_id IN (${inList}) AND deleted_at IS NULL`)
    : []
  const hotels = present.b2b_booking_hotels
    ? await q<B2bHotelRow>(
        `SELECT id, booking_id, hotel_name, city, country, check_in_date, check_out_date, adult_count, child_count, guest_data
         FROM b2b_booking_hotels WHERE booking_id IN (${inList}) AND deleted_at IS NULL`)
    : []
  const insurances = present.b2b_booking_insurances
    ? await q<B2bInsuranceRow>(
        `SELECT id, booking_id, plan_name, provider, coverage_start_date, traveler_count, traveler_data
         FROM b2b_booking_insurances WHERE booking_id IN (${inList}) AND deleted_at IS NULL`)
    : []
  const lifestyles = present.b2b_booking_lifestyles
    ? await q<B2bLifestyleRow>(
        `SELECT id, booking_id, lifestyle_name, category, service_date, adult_count, child_count, participant_data
         FROM b2b_booking_lifestyles WHERE booking_id IN (${inList}) AND deleted_at IS NULL`)
    : []

  const by = <T extends { booking_id: number }>(list: T[]) => {
    const m = new Map<number, T[]>()
    for (const r of list) {
      const arr = m.get(r.booking_id) ?? []
      arr.push(r)
      m.set(r.booking_id, arr)
    }
    return m
  }
  const fMap = by(flights), hMap = by(hotels), iMap = by(insurances), lMap = by(lifestyles)

  return rows.map((r) => {
    const bd = parseJson(r.booking_data)
    const agent = agentFromBookingData(bd)
    const f = fMap.get(r.id) ?? []
    const h = hMap.get(r.id) ?? []
    const i = iMap.get(r.id) ?? []
    const l = lMap.get(r.id) ?? []

    const routes = f.flatMap((row) => {
      const legs: string[] = []
      const dep = row.departure_city, arr = row.arrival_city
      if (dep && arr) legs.push(`${dep} → ${arr}`)
      if (row.return_date && dep && arr) legs.push(`${arr} → ${dep}`)
      return legs
    })
    if (!routes.length) {
      for (const row of h) if (row.city) routes.push(row.city)
    }

    // Lead traveller: first flight passenger, else first hotel guest, else insurance.
    let lead: string | null = null
    for (const row of f) {
      const first = asArray(parseJson(row.passenger_data))[0]
      const o = (first ?? {}) as Record<string, unknown>
      lead = str(o.name ?? o.fullName)
        ?? ([str(o.givenName ?? o.firstName), str(o.surname ?? o.lastName)].filter(Boolean).join(' ') || null)
      if (lead) break
    }
    if (!lead) {
      for (const row of h) {
        const first = asArray(parseJson(row.guest_data))[0] as Record<string, unknown> | undefined
        lead = str(first?.name ?? first?.fullName)
          ?? ([str(first?.givenName ?? first?.firstName), str(first?.surname ?? first?.lastName)].filter(Boolean).join(' ') || null)
        if (lead) break
      }
    }
    if (!lead) lead = str(pick(bd, ['leadPassenger', 'lead_passenger', 'customer.name', 'contact.name']))

    const pax = f.reduce((s, row) => s + (row.adult_count ?? 0) + (row.child_count ?? 0) + (row.infant_count ?? 0), 0)
      || h.reduce((s, row) => s + (row.adult_count ?? 0) + (row.child_count ?? 0), 0)
      || i.reduce((s, row) => s + (row.traveler_count ?? 0), 0)
      || l.reduce((s, row) => s + (row.adult_count ?? 0) + (row.child_count ?? 0), 0)
      || null

    return {
      id: r.id,
      uuid: r.uuid,
      reference: bookingReference(r.id, r.uuid),
      type: r.type,
      orderId: r.order_id,
      categoryId: r.category_id,
      amount: num(r.amount),
      currency: r.currency,
      status: r.status,
      orderStatus: r.order_status,
      paymentStatus: r.payment_status,
      paymentMethod: r.payment_method,
      paymentReference: r.payment_reference,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      agentName: agent.name,
      agentEmail: agent.email,
      leadTraveller: lead,
      components: { flights: f.length, hotels: h.length, insurances: i.length, lifestyles: l.length },
      routes: Array.from(new Set(routes)).slice(0, 4),
      travelDate: earliest([
        ...f.map((x) => x.departure_date),
        ...h.map((x) => x.check_in_date),
        ...i.map((x) => x.coverage_start_date),
        ...l.map((x) => x.service_date),
      ]),
      pnrs: Array.from(new Set(f.map((x) => x.pnr_number).filter((p): p is string => Boolean(p)))),
      pax,
    }
  })
}

/** One confirmed booking with every component fully expanded. */
export async function getB2bBooking(id: number): Promise<B2bBookingDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null

  return b2bBatch(async (q) => {
    const [header] = await q<B2bBookingRow>(
      `SELECT ${HEADER_COLS} FROM b2b_bookings b WHERE b.id = ? AND ${CONFIRMED_ONLY} LIMIT 1`,
      [id],
    )
    if (!header) return null

    const warnings: string[] = []
    const present: Record<ComponentTable, boolean> = {
      b2b_booking_flights: await hasTable(q, 'b2b_booking_flights'),
      b2b_booking_hotels: await hasTable(q, 'b2b_booking_hotels'),
      b2b_booking_insurances: await hasTable(q, 'b2b_booking_insurances'),
      b2b_booking_lifestyles: await hasTable(q, 'b2b_booking_lifestyles'),
    }
    for (const t of COMPONENT_TABLES) {
      if (!present[t]) warnings.push(`Table ${t} is not present on this database.`)
    }

    const flightRows = present.b2b_booking_flights
      ? await q<B2bFlightRow>('SELECT * FROM b2b_booking_flights WHERE booking_id = ? AND deleted_at IS NULL ORDER BY departure_date, id', [id])
      : []
    const hotelRows = present.b2b_booking_hotels
      ? await q<B2bHotelRow>('SELECT * FROM b2b_booking_hotels WHERE booking_id = ? AND deleted_at IS NULL ORDER BY check_in_date, id', [id])
      : []
    const insuranceRows = present.b2b_booking_insurances
      ? await q<B2bInsuranceRow>('SELECT * FROM b2b_booking_insurances WHERE booking_id = ? AND deleted_at IS NULL ORDER BY coverage_start_date, id', [id])
      : []
    const lifestyleRows = present.b2b_booking_lifestyles
      ? await q<B2bLifestyleRow>('SELECT * FROM b2b_booking_lifestyles WHERE booking_id = ? AND deleted_at IS NULL ORDER BY service_date, id', [id])
      : []

    const [summary] = await decorate(q, [header], present)
    const bd = parseJson(header.booking_data)

    return {
      ...summary,
      transactionId: header.transaction_id,
      bookingData: bd,
      flights: flightRows.map(shapeFlight),
      hotels: hotelRows.map(shapeHotel),
      insurances: insuranceRows.map(shapeInsurance),
      lifestyles: lifestyleRows.map(shapeLifestyle),
      warnings,
    }
  })
}

export { isB2bConfigured, b2bQuery }
