/**
 * Report data collection — the single source of every number an auto-report shows.
 *
 * One `collectReportData()` call produces a fully self-describing snapshot that
 * both the HTML email renderer and the on-screen preview consume, so what
 * operations sees in the browser is byte-for-byte what lands in the mailbox.
 *
 * Design notes:
 *  - **Channel split (B2B / B2C)** is derived from `Booking.agent` via
 *    `bookingSourceOf()`. There is no channel column on the live DB and adding
 *    one is not worth the drift risk — see `booking-source.ts`.
 *  - **Country** is `Booking.operationCountry`, which may be null for orders
 *    sold outside the four ops markets; those roll up under `UNASSIGNED` rather
 *    than being dropped, because a booking nobody owns is exactly the thing a
 *    daily report exists to surface.
 *  - **Complaints** come from `tbl_te_important_alerts` (the TE call-agent raises
 *    one row per call+category). That table is part of the TE stack and may be
 *    absent on some environments, so the query is defensive: a missing table
 *    degrades to an empty complaints section instead of failing the whole report.
 *  - **Money** is never summed across currencies. Totals are grouped by currency
 *    code; a single blended number would be quietly wrong.
 */
import { prisma } from '@/lib/prisma'
import { countryLabel, detectCountryFromRef, detectCountryFromText } from '@/lib/country-detection'
import { bookingSourceOf, type BookingSource } from '@/lib/booking-source'
import { groupByAgent } from './agent-names'
import {
  buildReportWindow, previousWindow, zonedDayStart, shiftDate, dateInTz,
  type ReportPeriod, type ReportWindow,
} from './report-window'
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
}

export interface TourLine extends BookingLine {
  /** 1-based day of the tour that the report date falls on. */
  dayNo: number
  totalDays: number
  leadPassenger: string | null
}

export interface ComplaintLine {
  id: string
  bookingRef: string | null
  customerName: string | null
  country: string
  countryLabel: string
  category: string
  severity: 'high' | 'medium' | 'low'
  status: 'open' | 'resolved' | string
  title: string | null
  details: string | null
  customerQuote: string | null
  sentiment: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
  /** Hours between the complaint being raised and resolved; null while open. */
  resolutionHours: number | null
}

export interface CreatedSection {
  total: number
  pax: number
  channel: ChannelSplit
  byCountry: CountryRow[]
  byCurrency: MoneyByCurrency[]
  byAgent: { agent: string; bookings: number; pax: number }[]
  bookings: BookingLine[]
  /** Same metric over the immediately preceding window, for the trend arrow. */
  previousTotal: number
}

export interface OnGroundSection {
  /** The local date this section describes — always "today", not the window. */
  date: string
  total: number
  pax: number
  channel: ChannelSplit
  byCountry: CountryRow[]
  arrivingToday: number
  departingToday: number
  tours: TourLine[]
}

export interface ComplaintsSection {
  available: boolean
  total: number
  resolved: number
  open: number
  highSeverityOpen: number
  avgResolutionHours: number | null
  byCategory: { category: string; total: number; open: number }[]
  bySeverity: { severity: string; total: number; open: number }[]
  byCountry: CountryRow[]
  items: ComplaintLine[]
  /** Complaints raised before the window that are still open — carried debt. */
  carriedOpen: ComplaintLine[]
}

export interface UpcomingSection {
  total: number
  pax: number
  channel: ChannelSplit
  next7: number
  next30: number
  beyond30: number
  byCountry: CountryRow[]
  byMonth: { month: string; label: string; bookings: number; pax: number }[]
  /** The soonest departures, for an at-a-glance "what lands next" list. */
  imminent: BookingLine[]
}

export interface ReportData {
  window: ReportWindow
  generatedAt: string
  countries: string[]
  created: CreatedSection
  onGround: OnGroundSection
  complaints: ComplaintsSection
  upcoming: UpcomingSection
}

export interface CollectOptions {
  period: ReportPeriod
  timezone: string
  /** Empty = every country, including unassigned. */
  countries?: string[]
  now?: Date
  /** Cap on the per-section detail tables. */
  maxRows?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNASSIGNED = 'UNASSIGNED'
/** Legacy combined value on old rows; reports always split it into SG / MY. */
const LEGACY_SG_MY = 'SINGAPORE_MALAYSIA'
/**
 * Cap on rows per detail table. Kept modest so a busy day's email stays under
 * Gmail's ~102 KB clipping threshold — the CSV attachment and the dashboard
 * carry every row, the email carries the readable summary.
 */
const DEFAULT_MAX_ROWS = 30

/** Statuses that mean "this booking is not happening" — excluded from operational counts. */
const DEAD_STATUSES = ['CANCELLED'] as const

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function labelFor(country: string): string {
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
function resolveCountry(
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
function storedCountriesFor(countries: string[]): string[] {
  const out = new Set(countries)
  if (countries.some(c => c === 'SINGAPORE' || c === 'MALAYSIA' || c === LEGACY_SG_MY || c === UNASSIGNED)) {
    out.add(LEGACY_SG_MY)
  }
  // A saved schedule may still name the legacy value on its own — treat it as both.
  if (countries.includes(LEGACY_SG_MY)) { out.add('SINGAPORE'); out.add('MALAYSIA'); out.add(UNASSIGNED) }
  return Array.from(out)
}

/** Post-query check against the resolved (split) country. */
function inSelectedCountries(country: string, countries: string[]): boolean {
  if (!countries.length) return true
  if (countries.includes(country)) return true
  // Legacy-only selection means "the SG/MY desk", whichever side a row resolved to.
  return countries.includes(LEGACY_SG_MY) && (country === 'SINGAPORE' || country === 'MALAYSIA')
}

function toNumber(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return typeof v === 'number' ? v : Number(v)
}

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

/** Whole days between two local dates, `to - from`. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (isNaN(a) || isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * Roll a set of bookings up by country, keeping the channel split per row.
 * Sorted by booking count so the busiest market leads the table.
 */
function rollUpByCountry(rows: { country: string; pax: number; source: BookingSource }[]): CountryRow[] {
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

function channelSplit(rows: { source: BookingSource }[]): ChannelSplit {
  return {
    b2b: rows.filter(r => r.source === 'B2B').length,
    b2c: rows.filter(r => r.source === 'B2C').length,
  }
}

/** Prisma `where` fragment restricting to the selected ops countries. */
function countryWhere(countries: string[]): Prisma.BookingWhereInput | null {
  if (!countries.length) return null
  const stored = storedCountriesFor(countries)
  const named = stored.filter(c => c !== UNASSIGNED) as never[]
  const clauses: Prisma.BookingWhereInput[] = []
  if (named.length) clauses.push({ operationCountry: { in: named } })
  if (stored.includes(UNASSIGNED)) clauses.push({ operationCountry: null })
  if (!clauses.length) return null
  return clauses.length === 1 ? clauses[0] : { OR: clauses }
}

const BOOKING_SELECT = {
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
} satisfies Prisma.BookingSelect

type RawBooking = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>

function toLine(b: RawBooking): BookingLine {
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
  }
}

// ─── Sections ─────────────────────────────────────────────────────────────────

async function collectCreated(w: ReportWindow, countries: string[], maxRows: number): Promise<CreatedSection> {
  const scope = countryWhere(countries)
  const prev = previousWindow(w)

  const [rows, prevRows] = await Promise.all([
    prisma.booking.findMany({
      where: { createdAt: { gte: w.start, lt: w.end }, ...(scope ?? {}) },
      select: BOOKING_SELECT,
      orderBy: { createdAt: 'desc' },
    }),
    // Counted, not aggregated — but still resolved country-by-country so the
    // trend arrow compares like with like once legacy SG/MY rows are split.
    prisma.booking.findMany({
      where: { createdAt: { gte: prev.start, lt: prev.end }, ...(scope ?? {}) },
      select: { operationCountry: true, bookingRef: true, tourDestination: true },
    }),
  ])
  const previousTotal = prevRows.filter(r =>
    inSelectedCountries(resolveCountry(r.operationCountry, r.bookingRef, r.tourDestination), countries)).length

  const lines = rows.map(toLine).filter(l => inSelectedCountries(l.country, countries))

  const currencyMap = new Map<string, number>()
  for (const l of lines) {
    if (l.quotedTotal === null) continue
    currencyMap.set(l.currency, (currencyMap.get(l.currency) ?? 0) + l.quotedTotal)
  }

  // Spelling variants of one partner ("MMT" / "Make My Trip") are merged here.
  const byAgent = groupByAgent(lines, l => l.agent, l => l.pax)

  return {
    total: lines.length,
    pax: lines.reduce((s, l) => s + l.pax, 0),
    channel: channelSplit(lines),
    byCountry: rollUpByCountry(lines),
    byCurrency: Array.from(currencyMap.entries())
      .map(([currency, total]) => ({ currency, total }))
      .sort((a, b) => b.total - a.total),
    byAgent: byAgent.slice(0, 10),
    bookings: lines.slice(0, maxRows),
    previousTotal,
  }
}

/**
 * Tours physically on the ground **today** — arrival ≤ today ≤ departure.
 *
 * Deliberately keyed to today rather than to the report window: this is the
 * "who is in-country right now" panel that ops acts on the morning the mail
 * arrives, so it must not drift back to yesterday on a daily report.
 */
async function collectOnGround(w: ReportWindow, countries: string[], maxRows: number): Promise<OnGroundSection> {
  const scope = countryWhere(countries)
  const dayStart = zonedDayStart(w.today, w.timezone)
  const dayEnd = zonedDayStart(shiftDate(w.today, 1), w.timezone)

  const rows = await prisma.booking.findMany({
    where: {
      arrivalDate: { lt: dayEnd },
      departureDate: { gte: dayStart },
      status: { notIn: [...DEAD_STATUSES] },
      ...(scope ?? {}),
    },
    select: { ...BOOKING_SELECT, passengers: { where: { isLead: true }, select: { name: true }, take: 1 } },
    orderBy: [{ operationCountry: 'asc' }, { arrivalDate: 'asc' }],
  })

  const tours: TourLine[] = rows.map(r => {
    const line = toLine(r)
    return {
      ...line,
      dayNo: daysBetween(line.arrivalDate, w.today) + 1,
      totalDays: daysBetween(line.arrivalDate, line.departureDate) + 1,
      leadPassenger: r.passengers[0]?.name ?? null,
    }
  }).filter(t => inSelectedCountries(t.country, countries))

  return {
    date: w.today,
    total: tours.length,
    pax: tours.reduce((s, t) => s + t.pax, 0),
    channel: channelSplit(tours),
    byCountry: rollUpByCountry(tours),
    arrivingToday: tours.filter(t => t.arrivalDate === w.today).length,
    departingToday: tours.filter(t => t.departureDate === w.today).length,
    tours: tours.slice(0, maxRows),
  }
}

/**
 * Complaints raised in the window, plus anything still open from before it.
 *
 * `tbl_te_important_alerts` has no country column, so country is resolved by
 * joining `booking_ref` back to Booking in one batched lookup rather than N+1.
 */
async function collectComplaints(w: ReportWindow, countries: string[], maxRows: number): Promise<ComplaintsSection> {
  const empty: ComplaintsSection = {
    available: false, total: 0, resolved: 0, open: 0, highSeverityOpen: 0,
    avgResolutionHours: null, byCategory: [], bySeverity: [], byCountry: [],
    items: [], carriedOpen: [],
  }

  let raw: Awaited<ReturnType<typeof prisma.tbl_te_important_alerts.findMany>>
  let carriedRaw: typeof raw
  try {
    ;[raw, carriedRaw] = await Promise.all([
      prisma.tbl_te_important_alerts.findMany({
        where: { created_at: { gte: w.start, lt: w.end } },
        orderBy: { created_at: 'desc' },
      }),
      prisma.tbl_te_important_alerts.findMany({
        where: { created_at: { lt: w.start }, status: { not: 'resolved' } },
        orderBy: { created_at: 'asc' },
        take: 25,
      }),
    ])
  } catch (err) {
    // The TE stack is not deployed everywhere; an absent table must not sink the report.
    console.warn('[Reports] complaints unavailable:', err instanceof Error ? err.message : err)
    return empty
  }

  const refs = Array.from(new Set(raw.concat(carriedRaw).map(r => r.booking_ref).filter((r): r is string => !!r)))
  const bookings = refs.length
    ? await prisma.booking.findMany({
        where: { bookingRef: { in: refs } },
        select: { bookingRef: true, operationCountry: true, tourDestination: true },
      })
    : []
  const countryByRef = new Map(bookings.map(b =>
    [b.bookingRef, resolveCountry(b.operationCountry, b.bookingRef, b.tourDestination)]))

  const map = (r: (typeof raw)[number]): ComplaintLine => {
    const country = (r.booking_ref && countryByRef.get(r.booking_ref)) || UNASSIGNED
    const severity = (r.severity ?? 'medium').toLowerCase()
    const resolvedAt = r.resolved_at ?? null
    return {
      id: String(r.id),
      bookingRef: r.booking_ref,
      customerName: r.customer_name,
      country,
      countryLabel: labelFor(country),
      category: r.category?.trim() || 'general',
      severity: (['high', 'medium', 'low'].includes(severity) ? severity : 'medium') as ComplaintLine['severity'],
      status: (r.status ?? 'open').toLowerCase(),
      title: r.title,
      details: r.details,
      customerQuote: r.customer_quote,
      sentiment: r.sentiment,
      resolutionNote: r.resolution_note,
      resolvedAt: resolvedAt ? resolvedAt.toISOString() : null,
      createdAt: r.created_at.toISOString(),
      resolutionHours: resolvedAt
        ? Math.max(0, Math.round(((resolvedAt.getTime() - r.created_at.getTime()) / 3_600_000) * 10) / 10)
        : null,
    }
  }

  const inScope = (c: ComplaintLine) => inSelectedCountries(c.country, countries)
  const items = raw.map(map).filter(inScope)
  const carriedOpen = carriedRaw.map(map).filter(inScope)

  const resolvedItems = items.filter(c => c.status === 'resolved')
  const openItems = items.filter(c => c.status !== 'resolved')

  const group = <K extends string>(keyOf: (c: ComplaintLine) => K) => {
    const m = new Map<K, { total: number; open: number }>()
    for (const c of items) {
      const k = keyOf(c)
      const e = m.get(k) ?? { total: 0, open: 0 }
      e.total += 1
      if (c.status !== 'resolved') e.open += 1
      m.set(k, e)
    }
    return m
  }

  const withHours = resolvedItems.filter(c => c.resolutionHours !== null)

  return {
    available: true,
    total: items.length,
    resolved: resolvedItems.length,
    open: openItems.length,
    highSeverityOpen: openItems.filter(c => c.severity === 'high').length,
    avgResolutionHours: withHours.length
      ? Math.round((withHours.reduce((s, c) => s + (c.resolutionHours ?? 0), 0) / withHours.length) * 10) / 10
      : null,
    byCategory: Array.from(group(c => c.category).entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.total - a.total),
    bySeverity: Array.from(group(c => c.severity).entries())
      .map(([severity, v]) => ({ severity, ...v }))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)),
    byCountry: rollUpByCountry(items.map(c => ({ country: c.country, pax: 0, source: 'B2B' as BookingSource }))),
    // Unresolved first, then most severe, then newest — the action list, in order.
    items: items.slice()
      .sort((a, b) =>
        Number(a.status === 'resolved') - Number(b.status === 'resolved') ||
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        b.createdAt.localeCompare(a.createdAt))
      .slice(0, maxRows),
    carriedOpen,
  }
}

/** Every confirmed tour that has not started yet, from tomorrow onwards. */
async function collectUpcoming(w: ReportWindow, countries: string[], maxRows: number): Promise<UpcomingSection> {
  const scope = countryWhere(countries)
  const tomorrow = zonedDayStart(shiftDate(w.today, 1), w.timezone)
  const in7 = zonedDayStart(shiftDate(w.today, 8), w.timezone)
  const in30 = zonedDayStart(shiftDate(w.today, 31), w.timezone)

  const rows = await prisma.booking.findMany({
    where: {
      arrivalDate: { gte: tomorrow },
      status: { notIn: [...DEAD_STATUSES] },
      ...(scope ?? {}),
    },
    select: BOOKING_SELECT,
    orderBy: { arrivalDate: 'asc' },
  })

  const inScope = rows.filter(r =>
    inSelectedCountries(resolveCountry(r.operationCountry, r.bookingRef, r.tourDestination), countries))
  const lines = inScope.map(toLine)

  const monthMap = new Map<string, { month: string; label: string; bookings: number; pax: number }>()
  for (const l of lines) {
    const month = l.arrivalDate.slice(0, 7)
    const entry = monthMap.get(month) ?? {
      month,
      label: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' })
        .format(new Date(`${month}-01T00:00:00Z`)),
      bookings: 0,
      pax: 0,
    }
    entry.bookings += 1
    entry.pax += l.pax
    monthMap.set(month, entry)
  }

  return {
    total: lines.length,
    pax: lines.reduce((s, l) => s + l.pax, 0),
    channel: channelSplit(lines),
    next7: inScope.filter(r => r.arrivalDate < in7).length,
    next30: inScope.filter(r => r.arrivalDate < in30).length,
    beyond30: inScope.filter(r => r.arrivalDate >= in30).length,
    byCountry: rollUpByCountry(lines),
    byMonth: Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(0, 12),
    imminent: lines.slice(0, Math.min(maxRows, 25)),
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function collectReportData(opts: CollectOptions): Promise<ReportData> {
  const now = opts.now ?? new Date()
  const countries = (opts.countries ?? []).filter(Boolean)
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const window = buildReportWindow(opts.period, opts.timezone, now)

  const [created, onGround, complaints, upcoming] = await Promise.all([
    collectCreated(window, countries, maxRows),
    collectOnGround(window, countries, maxRows),
    collectComplaints(window, countries, maxRows),
    collectUpcoming(window, countries, maxRows),
  ])

  return {
    window,
    generatedAt: now.toISOString(),
    countries,
    created,
    onGround,
    complaints,
    upcoming,
  }
}

export { UNASSIGNED as UNASSIGNED_COUNTRY, labelFor as reportCountryLabel, dateInTz }
