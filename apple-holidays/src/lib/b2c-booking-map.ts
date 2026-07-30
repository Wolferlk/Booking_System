/**
 * Aahaas B2C order → ops Booking mapping.
 *
 * Pure functions only: no DB, no clock, no side effects. Everything the mapper
 * needs is passed in, which is what lets the dry-run script validate the mapping
 * against live orders without writing anything.
 *
 * The output shape deliberately mirrors what `as-booking-map.ts` produces for
 * AppleSystem quotations, so `b2c-import.ts` can persist it the same way.
 */
import {
  operationCountryFromAirportCode,
  operationCountryFromIso,
  operationCountryFromText,
} from './b2c-country'
import { describeRoute } from './b2c-flight'
import type { OperationCountry } from './country-detection'
import type { ParsedFlightBooking } from './b2c-flight'
import type {
  B2cOrderCustomer,
  B2cOrderHeader,
  B2cOrderProduct,
} from './b2c-db'

/**
 * Aahaas is our own storefront, not a third-party agent. Re-exported from
 * `booking-source.ts`, which is the single definition — that value doubles as the
 * B2C channel marker the list filter keys off.
 */
export { B2C_AGENT_NAME } from './booking-source'
import { B2C_AGENT_NAME } from './booking-source'

/** `tbl_maincategory.id` for Flights — the one category with no product record. */
const FLIGHT_CATEGORY_ID = 6

export type PnlCategory =
  | 'HOTEL' | 'TICKETS' | 'GUIDES' | 'MEALS' | 'CRUISE'
  | 'WATER' | 'TRANSPORT' | 'TAX_FEES' | 'FLIGHT_TICKETS' | 'OTHER'

export type PaymentStatus = 'PENDING' | 'CONFIRMED'

export interface MappedB2cPnlLine {
  activity: string
  category: PnlCategory
  /** Selling price (revenue side) — `net_seling_amount`. */
  mmtRate: number
  sicRate: number
  pvtRatePP: number
  adEntrance: number
  chEntrance: number
  otherRate: number
  paymentStatus: PaymentStatus
  sortOrder: number
  notes: string
}

export interface MappedB2cItineraryItem {
  dayNo: number
  date: string
  title: string
  description: string | null
}

export interface MappedB2cBooking {
  bookingRef: string
  isNumber: string
  agent: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  paxInfants: number
  quotedTotal: number | null
  currency: string
  /**
   * Null when the destination is known but outside the markets ops operates —
   * Aahaas sells flights worldwide. The order is still imported (it must appear in
   * the all-bookings list) but stays unscoped, so only ULTRA_SUPER_ADMIN and
   * country=ALL users see it. `tourDestination` carries the real destination.
   */
  operationCountry: OperationCountry | null
  contactEmail: string | null
  contactPhone: string | null
  contactCountry: string | null
  tourDestination: string | null
  leadPassengerName: string | null
  itineraryItems: MappedB2cItineraryItem[]
  pnlLines: MappedB2cPnlLine[]
  /** Raw source figures, persisted to `PNL.isPnlData` for audit. */
  source: Record<string, unknown>
}

/**
 * Why an order could not be mapped — surfaced in the run summary, never guessed
 * around. Note an unsupported *destination* is not a skip reason: those orders are
 * imported with a null `operationCountry` so they still appear in the list.
 */
export type B2cSkipReason =
  | 'no-travel-products'
  | 'missing-dates'

export type MapResult =
  | { ok: true; booking: MappedB2cBooking }
  | { ok: false; orderId: number; reason: B2cSkipReason; detail: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** MySQL DECIMAL comes back as a string; treat unparseable/absent as 0. */
function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Whole days between two 'YYYY-MM-DD' dates, computed in UTC to dodge DST. */
function dayOffset(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Map an Aahaas main category (plus the product name, which is often more
 * specific than the category) onto an ops P&L category.
 */
export function toPnlCategory(maincat: string | null, productName: string | null): PnlCategory {
  const name = (productName ?? '').toLowerCase()
  const cat = (maincat ?? '').toLowerCase()

  if (cat.includes('flight')) return 'FLIGHT_TICKETS'
  if (cat.includes('hotel')) return 'HOTEL'

  // Product name beats the broad "Lifestyle" bucket, which covers everything.
  if (/\b(transfer|transport|taxi|cab|car|van|shuttle|pick\s*-?\s*up|drop)\b/.test(name)) return 'TRANSPORT'
  if (/\b(cruise|boat|yacht|sail|catamaran|ferry)\b/.test(name)) return 'CRUISE'
  if (/\b(dive|diving|snorkel|raft|kayak|surf|jet\s*ski|water\s*sport)\b/.test(name)) return 'WATER'
  if (/\b(lunch|dinner|breakfast|meal|restaurant|dining|buffet|high\s*tea)\b/.test(name)) return 'MEALS'
  if (/\b(guide|guiding|chauffeur\s*guide)\b/.test(name)) return 'GUIDES'
  if (/\b(tax|vat|fee|surcharge|levy)\b/.test(name)) return 'TAX_FEES'
  if (/\b(ticket|entrance|entry|admission|pass)\b/.test(name)) return 'TICKETS'

  if (cat.includes('lifestyle')) return 'TICKETS'
  return 'OTHER'
}

/**
 * Pax for the whole order.
 *
 * `MAX` across products, not `SUM`: one party of two booking three activities is
 * two people, not six, and pax multiplies every P&L line total.
 *
 * Flights are the exception — `checkouts_more_data` stores them with zero
 * quantities, so `aahaas_flight_bookings` is the only truthful source and its
 * counts win when the product rows say nothing.
 */
export function resolvePax(
  products: B2cOrderProduct[],
  flights: ParsedFlightBooking[],
): { paxAdults: number; paxChildren: number; paxInfants: number; paxSource: string } {
  const prodAdults = Math.max(0, ...products.map((p) => num(p.adult_quantity)))
  const prodChildren = Math.max(0, ...products.map((p) => num(p.child_quantity)))

  const flightAdults = Math.max(0, ...flights.map((f) => f.paxAdults), 0)
  const flightChildren = Math.max(0, ...flights.map((f) => f.paxChildren), 0)
  const flightInfants = Math.max(0, ...flights.map((f) => f.paxInfants), 0)

  if (prodAdults > 0 || prodChildren > 0) {
    // Product rows carry pax; still take the flight counts if they are larger,
    // since a mixed order's flight leg covers the whole party.
    return {
      paxAdults: Math.max(prodAdults, flightAdults),
      paxChildren: Math.max(prodChildren, flightChildren),
      paxInfants: flightInfants,
      paxSource: 'products',
    }
  }

  if (flightAdults > 0 || flightChildren > 0) {
    return {
      paxAdults: flightAdults,
      paxChildren: flightChildren,
      paxInfants: flightInfants,
      paxSource: 'flight-booking',
    }
  }

  // Nothing recorded pax. Default to a single adult rather than zero: a zero
  // headcount would silently collapse every computed P&L total to 0.
  return { paxAdults: 1, paxChildren: 0, paxInfants: 0, paxSource: 'defaulted' }
}

/**
 * Country for the order, walking the confidence chain in `b2c-country.ts`.
 *
 * A null `country` does NOT mean "unknown" — it means "not a market ops operates".
 * `via` records which signal fired so a run can be audited, and
 * `destinationLabel` carries the destination even when it is unsupported, so a
 * Colombo→Tokyo ticket still shows "CMB → NRT" in the booking.
 */
export function resolveOrderCountry(
  products: B2cOrderProduct[],
  flights: ParsedFlightBooking[],
): { country: OperationCountry | null; via: string; destinationLabel: string | null } {
  // 1. An explicit product country (Lifestyle / most Hotels).
  for (const p of products) {
    const c = operationCountryFromIso(p.product_country)
    if (c) return { country: c, via: 'product-country', destinationLabel: p.product_city ?? null }
  }

  // 2. A flight's destination airport — the only signal a flight-only order carries.
  for (const f of flights) {
    const c = operationCountryFromAirportCode(f.destinationCode)
    if (c) return { country: c, via: 'flight-airport', destinationLabel: describeRoute(f) }
  }

  // 3. Free text — Ratehawk hotels name the destination even without a product row.
  for (const p of products) {
    const c = operationCountryFromText(
      p.product_name, p.product_city, p.service_location, p.vendor_name,
    )
    if (c) return { country: c, via: 'text', destinationLabel: p.product_city ?? null }
  }

  // 4. Nothing maps to an ops market. Keep whatever destination we do know so the
  //    booking is still meaningful, and leave the country unset.
  for (const f of flights) {
    const label = describeRoute(f)
    if (label) return { country: null, via: 'unsupported-destination', destinationLabel: label }
  }

  return { country: null, via: 'none', destinationLabel: null }
}

/**
 * Cost side of a P&L line.
 *
 * Ops computes a line total as
 *   `(sic + pvtPP + other) × (adults + children) + adEntrance × adults + chEntrance × children`
 * so the mapping has to reproduce the true B2C cost *through that formula*,
 * using the booking-level pax the P&L will be evaluated with.
 *
 * Per-person entrance rates are used only when the line's own quantities match
 * the booking pax AND they reconcile with `net_cost_amount` — then the result is
 * both exact and keeps the adult/child split. Otherwise the cost is spread over
 * pax via `otherRate`, which works for any quantities but carries no split.
 *
 * The spread branch cannot always be exact: rate columns are `DECIMAL(10,2)`, so
 * a cost that does not divide evenly by pax loses up to half a cent per head
 * (a 234.52 hotel line over 5 pax stores 46.90 and recomputes to 234.50). The
 * residual is bounded by `0.005 × pax` and is a property of the schema, not a
 * mapping error — `notes` records the true source figures either way.
 */
export function mapCostToRates(
  product: B2cOrderProduct,
  paxAdults: number,
  paxChildren: number,
): { adEntrance: number; chEntrance: number; otherRate: number; basis: string } {
  const netCost = num(product.net_cost_amount)
  const totalPax = Math.max(1, paxAdults + paxChildren)

  const lineAdults = num(product.adult_quantity)
  const lineChildren = num(product.child_quantity)
  const adCost = num(product.adult_cost_amount)
  const chCost = num(product.child_cost_amount)

  const quantitiesMatchBooking = lineAdults === paxAdults && lineChildren === paxChildren
  const perPersonTotal = adCost * lineAdults + chCost * lineChildren
  // 1% tolerance absorbs the store's rounding of converted amounts.
  const reconciles = netCost > 0 && Math.abs(perPersonTotal - netCost) <= Math.max(0.01, netCost * 0.01)

  if (quantitiesMatchBooking && reconciles) {
    return { adEntrance: round2(adCost), chEntrance: round2(chCost), otherRate: 0, basis: 'per-person' }
  }

  return { adEntrance: 0, chEntrance: 0, otherRate: round2(netCost / totalPax), basis: 'spread-over-pax' }
}

/**
 * Whether the customer has actually paid, which decides whether Accounts still
 * needs to confirm each P&L line before Ground Team can purchase tickets.
 * `payment_status` is free text in the store, so the amounts are the primary
 * signal and the status string only ever *blocks* (a rejected payment is never
 * treated as paid).
 */
export function resolvePaymentStatus(customer: B2cOrderCustomer | undefined): PaymentStatus {
  if (!customer) return 'PENDING'
  const status = (customer.payment_status ?? '').trim().toLowerCase()
  if (status === 'rejected') return 'PENDING'

  const total = num(customer.total_amount)
  const paid = num(customer.paid_amount)
  const balance = num(customer.balance_amount)

  if (total > 0 && paid >= total - 0.01) return 'CONFIRMED'
  if (paid > 0 && balance <= 0.01) return 'CONFIRMED'
  if (status === 'approved' && paid > 0) return 'CONFIRMED'
  return 'PENDING'
}

// ─── Main mapping ─────────────────────────────────────────────────────────────

export function mapB2cOrder(input: {
  header: B2cOrderHeader
  products: B2cOrderProduct[]
  customer: B2cOrderCustomer | undefined
  flights: ParsedFlightBooking[]
}): MapResult {
  const { header, products, customer, flights } = input
  const orderId = Number(header.order_id)

  if (products.length === 0) {
    return { ok: false, orderId, reason: 'no-travel-products', detail: 'order has no travel-category lines' }
  }
  if (!header.arrival || !header.departure) {
    return { ok: false, orderId, reason: 'missing-dates', detail: 'no service_date on any line' }
  }

  const { country, via: countryVia, destinationLabel } = resolveOrderCountry(products, flights)
  const { paxAdults, paxChildren, paxInfants, paxSource } = resolvePax(products, flights)
  const paymentStatus = resolvePaymentStatus(customer)

  // `net_total_amount` is already expressed in `base_currency`; `paid_currency`
  // is only what the customer was charged in, so it must not be used here.
  const currency =
    products.find((p) => p.base_currency)?.base_currency?.trim().toUpperCase() || 'USD'
  const quotedTotalRaw = products.reduce((sum, p) => sum + num(p.net_total_amount), 0)
  const quotedTotal = quotedTotalRaw > 0 ? round2(quotedTotalRaw) : null

  // Flight lines carry no product name, so their itinerary entry and P&L activity
  // are built from the parsed GDS data instead — route, PNR and airline.
  const flightForLine = (p: B2cOrderProduct): ParsedFlightBooking | undefined =>
    p.category_id === FLIGHT_CATEGORY_ID ? flights[0] : undefined

  const lineTitle = (p: B2cOrderProduct, i: number): string => {
    const name = (p.product_name ?? '').trim()
    if (name) return name.slice(0, 1000)
    const flight = flightForLine(p)
    const route = flight ? describeRoute(flight) : null
    if (route) return `Flight ${route}${flight?.pnr ? ` (PNR ${flight.pnr})` : ''}`.slice(0, 1000)
    return (p.sku && p.sku !== 'N/A' ? p.sku : p.maincat_type || `Line ${i + 1}`).slice(0, 1000)
  }

  const itineraryItems: MappedB2cItineraryItem[] = products.map((p, i) => {
    const date = p.service_date ?? header.arrival
    const flight = flightForLine(p)
    const bits = [
      p.maincat_type,
      p.vendor_name ? `Vendor: ${p.vendor_name}` : null,
      p.time_slot ? `Time: ${p.time_slot}` : null,
      p.service_location ? `Location: ${p.service_location}` : null,
      flight?.pnr ? `PNR: ${flight.pnr}` : null,
      flight?.provider ? `GDS: ${flight.provider}` : null,
      p.provider && p.provider.toLowerCase() !== 'aahaas' && !flight ? `Supplier: ${p.provider}` : null,
    ].filter(Boolean)
    return {
      dayNo: Math.max(1, dayOffset(header.arrival, date) + 1),
      date,
      title: lineTitle(p, i),
      description: bits.length > 0 ? bits.join(' · ') : null,
    }
  })

  const pnlLines: MappedB2cPnlLine[] = products.map((p, i) => {
    const { adEntrance, chEntrance, otherRate, basis } = mapCostToRates(p, paxAdults, paxChildren)
    const netCost = num(p.net_cost_amount)
    const netSell = num(p.net_seling_amount)
    return {
      activity: lineTitle(p, i).slice(0, 500),
      category: toPnlCategory(p.maincat_type, p.product_name),
      mmtRate: round2(netSell),
      sicRate: 0,
      pvtRatePP: 0,
      adEntrance,
      chEntrance,
      otherRate,
      paymentStatus,
      sortOrder: i,
      notes: [
        `B2C line #${p.id} (checkout ${p.checkout_id})`,
        `cost ${netCost.toFixed(2)} / sell ${netSell.toFixed(2)} ${currency}`,
        `qty ad ${num(p.adult_quantity)} ch ${num(p.child_quantity)}`,
        `rate basis: ${basis}`,
      ].join(' · '),
    }
  })

  // Prefer a product city/location; fall back to the flight route so a
  // Colombo→Tokyo ticket still says where it is going.
  const destination =
    products.map((p) => p.product_city || p.service_location).find((v) => v && v.trim()) ??
    destinationLabel ??
    null

  return {
    ok: true,
    booking: {
      // The Aahaas order id becomes both the booking ref and the IS number.
      bookingRef: String(orderId),
      isNumber: String(orderId),
      agent: B2C_AGENT_NAME,
      arrivalDate: header.arrival,
      departureDate: header.departure,
      paxAdults,
      paxChildren,
      paxInfants,
      quotedTotal,
      currency,
      operationCountry: country,
      contactEmail: customer?.customer_email?.trim() || null,
      contactPhone: customer?.customer_phone?.trim() || null,
      contactCountry: customer?.customer_nationality?.trim() || null,
      tourDestination: destination ? destination.trim().slice(0, 191) : null,
      // The store account name is often a username ("admin6611"); a flight's
      // passenger manifest carries the traveller's real name, so it wins.
      leadPassengerName:
        flights.find((f) => f.leadPassengerName)?.leadPassengerName ??
        customer?.customer_name?.trim() ??
        null,
      itineraryItems,
      pnlLines,
      source: {
        channel: 'AAHAAS_B2C',
        orderId,
        bookedDate: header.bookedDate,
        checkoutDate: customer?.checkout_date ?? null,
        checkoutStatus: customer?.checkout_status ?? null,
        paymentStatus: customer?.payment_status ?? null,
        orderTotal: customer?.total_amount ?? null,
        orderPaid: customer?.paid_amount ?? null,
        orderBalance: customer?.balance_amount ?? null,
        orderDiscount: customer?.discount_amount ?? null,
        orderDelivery: customer?.delivery_amount ?? null,
        currency,
        countryResolvedVia: countryVia,
        paxResolvedVia: paxSource,
        productLines: products.length,
        flightBookings: flights.length,
        flightRoutes: flights.map((f) => describeRoute(f)).filter(Boolean),
        flightPnrs: flights.map((f) => f.pnr).filter(Boolean),
      },
    },
  }
}
