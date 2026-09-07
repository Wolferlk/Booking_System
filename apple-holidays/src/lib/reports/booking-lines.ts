/**
 * Booking-line primitives shared by every report collector.
 *
 * Moved out of `report-data.ts` when the weekly/monthly insights collector was
 * added: both files have to resolve a country, split a channel and shape a
 * booking row exactly the same way, and a second copy of the legacy SG/MY rules
 * would have drifted from the first the day either was touched.
 *
 * Nothing here queries anything — it is the vocabulary the collectors share.
 */
import { countryLabel, detectCountryFromRef, detectCountryFromText } from '@/lib/country-detection'
import { bookingSourceOf, type BookingSource } from '@/lib/booking-source'
import type { Prisma } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MoneyByCurrency { currency: string; total: number }

export interface ChannelSplit { b2b: number; b2c: number }

export interface CountryRow {
  country: string
  label: string
  bookings: number
  pax: number
  b2b: number
  b2c: number
}

export interface BookingLine {
  bookingRef: string
  agent: string | null
  source: BookingSource
  country: string
  countryLabel: string
  status: string
  arrivalDate: string
  departureDate: string
  pax: number
  paxAdults: number
  paxChildren: number
  paxInfants: number
  currency: string
  quotedTotal: number | null
  destination: string | null
  createdAt: string
  /**
   * Accommodation-only booking — see `src/lib/hotel-only.ts`. Carried on every
   * line so the readiness table can explain an all-N/A row, and so a reader
   * scanning the mail can tell a room-only sale from a tour at a glance.
   */
  hotelOnly: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const UNASSIGNED = 'UNASSIGNED'
/** Legacy combined value on old rows; reports always split it into SG / MY. */
export const LEGACY_SG_MY = 'SINGAPORE_MALAYSIA'

/** Statuses that mean "this booking is not happening" — excluded from operational counts. */
export const DEAD_STATUSES = ['CANCELLED'] as const

// ─── Country ──────────────────────────────────────────────────────────────────

export function labelFor(country: string): string {
  // "Others" rather than "Unassigned": reports are read by people who want the
  // rest-of-the-world bucket, not a data-quality label.
  if (country === UNASSIGNED || country === LEGACY_SG_MY) return 'Others'
  return countryLabel(country as never)
}

/**
 * Country a report row is counted under.
 *
 * Singapore and Malaysia are stored separately today, but older rows carry the
 * combined `SINGAPORE_MALAYSIA` value. Reports must never show that combined
 * bucket, so it is resolved to one of the two by booking-ref prefix (SG / MY,
 * the authoritative signal) and, failing that, by the destination text. Anything
 * still unresolved falls into Others rather than being guessed at.
 */
export function resolveCountry(
  operationCountry: string | null | undefined,
  bookingRef: string | null | undefined,
  destination: string | null | undefined,
): string {
  const stored = operationCountry ?? UNASSIGNED
  if (stored !== LEGACY_SG_MY) return stored

  const fromRef = detectCountryFromRef(bookingRef ?? '')
  if (fromRef === 'SINGAPORE' || fromRef === 'MALAYSIA') return fromRef

  const fromText = detectCountryFromText('', destination ?? '')
  if (fromText === 'SINGAPORE' || fromText === 'MALAYSIA') return fromText

  return UNASSIGNED
}

/**
 * The stored values to query for, given the selected report countries.
 * Selecting Singapore or Malaysia must also pull the legacy combined rows in;
 * `resolveCountry` then decides which of the two each one actually belongs to,
 * and `inSelectedCountries` drops the ones that resolved elsewhere.
 */
export function storedCountriesFor(countries: string[]): string[] {
  const out = new Set(countries)
  if (countries.some(c => c === 'SINGAPORE' || c === 'MALAYSIA' || c === LEGACY_SG_MY || c === UNASSIGNED)) {
    out.add(LEGACY_SG_MY)
  }
  // A saved schedule may still name the legacy value on its own — treat it as both.
  if (countries.includes(LEGACY_SG_MY)) { out.add('SINGAPORE'); out.add('MALAYSIA'); out.add(UNASSIGNED) }
  return Array.from(out)
}

/** Post-query check against the resolved (split) country. */
export function inSelectedCountries(country: string, countries: string[]): boolean {
  if (!countries.length) return true
  if (countries.includes(country)) return true
  // Legacy-only selection means "the SG/MY desk", whichever side a row resolved to.
  return countries.includes(LEGACY_SG_MY) && (country === 'SINGAPORE' || country === 'MALAYSIA')
}

/** Prisma `where` fragment restricting to the selected ops countries. */
export function countryWhere(countries: string[]): Prisma.BookingWhereInput | null {
  if (!countries.length) return null
  const stored = storedCountriesFor(countries)
  const named = stored.filter(c => c !== UNASSIGNED) as never[]
  const clauses: Prisma.BookingWhereInput[] = []
  if (named.length) clauses.push({ operationCountry: { in: named } })
  if (stored.includes(UNASSIGNED)) clauses.push({ operationCountry: null })
  if (!clauses.length) return null
  return clauses.length === 1 ? clauses[0] : { OR: clauses }
}

// ─── Scalars ──────────────────────────────────────────────────────────────────

export function toNumber(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return typeof v === 'number' ? v : Number(v)
}

export function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

/** Whole days between two local dates, `to - from`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

// ─── Roll-ups ─────────────────────────────────────────────────────────────────

/**
 * Roll a set of bookings up by country, keeping the channel split per row.
 * Sorted by booking count so the busiest market leads the table.
 */
export function rollUpByCountry(rows: { country: string; pax: number; source: BookingSource }[]): CountryRow[] {
  const map = new Map<string, CountryRow>()
  for (const r of rows) {
    let entry = map.get(r.country)
    if (!entry) {
      entry = { country: r.country, label: labelFor(r.country), bookings: 0, pax: 0, b2b: 0, b2c: 0 }
      map.set(r.country, entry)
    }
    entry.bookings += 1
    entry.pax += r.pax
    if (r.source === 'B2C') entry.b2c += 1
    else entry.b2b += 1
  }
  return Array.from(map.values()).sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label))
}

export function channelSplit(rows: { source: BookingSource }[]): ChannelSplit {
  return {
    b2b: rows.filter(r => r.source === 'B2B').length,
    b2c: rows.filter(r => r.source === 'B2C').length,
  }
}

/** Money never crosses a currency — totals are grouped, never blended. */
export function sumByCurrency(lines: { currency: string; quotedTotal: number | null }[]): MoneyByCurrency[] {
  const map = new Map<string, number>()
  for (const l of lines) {
    if (l.quotedTotal === null) continue
    map.set(l.currency, (map.get(l.currency) ?? 0) + l.quotedTotal)
  }
  return Array.from(map.entries())
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total)
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

export const BOOKING_SELECT = {
  bookingRef: true,
  agent: true,
  status: true,
  operationCountry: true,
  arrivalDate: true,
  departureDate: true,
  paxAdults: true,
  paxChildren: true,
  paxInfants: true,
  currency: true,
  quotedTotal: true,
  tourDestination: true,
  createdAt: true,
  hotelOnly: true,
  noTickets: true,
} satisfies Prisma.BookingSelect

export type RawBooking = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>

export function toLine(b: RawBooking): BookingLine {
  const country = resolveCountry(b.operationCountry, b.bookingRef, b.tourDestination)
  return {
    bookingRef: b.bookingRef,
    agent: b.agent,
    source: bookingSourceOf(b.agent),
    country,
    countryLabel: labelFor(country),
    status: b.status,
    arrivalDate: isoDate(b.arrivalDate),
    departureDate: isoDate(b.departureDate),
    pax: b.paxAdults + b.paxChildren + b.paxInfants,
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    paxInfants: b.paxInfants,
    currency: b.currency,
    quotedTotal: toNumber(b.quotedTotal),
    destination: b.tourDestination,
    createdAt: b.createdAt.toISOString(),
    hotelOnly: b.hotelOnly,
  }
}
