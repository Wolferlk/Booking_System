/**
 * The Daily Sales Report — everything the mail and the workbook print.
 *
 * B2C only. B2B (Apple System confirmations, the accounts invoice ledger,
 * partners) belongs to the Ops and accounts mails and is not read here.
 *
 *  - **Aahaas B2C store (read-only)** — storefront orders placed in the window:
 *    the headline sales figure.
 *  - **Booking system (this DB)** — the B2C orders filed here as bookings in
 *    the window (agent "Aahaas B2C"), for guests, markets and lead time.
 *  - **Travel Quote GPT (read-only)** — quotations, confirmations, calls,
 *    signups, AI adoption and staff performance: the "Aahaas BLR Daily
 *    Performance" digest's figures, see `sales-pipeline-data.ts`.
 *
 * Every source degrades on its own. A system that cannot be read is named in
 * the mail's warnings and its tiles read "—", never 0 — three correct sections
 * beside a confident zero is the one failure the reader cannot see.
 *
 * Nothing here writes anywhere.
 */
import { prisma } from '@/lib/prisma'
import { fetchOrderProducts, fetchOrdersBookedBetween, isB2cConfigured } from '@/lib/b2c-db'
import type { AppleCohort } from './apple-cohort'
import { collectCreated, type CreatedSection } from './report-data'
import {
  buildReportWindow, dateInTz, formatReportDate, isValidDate, previousWindow, shiftDate, zonedDayStart,
  type ReportPeriod, type ReportWindow,
} from './report-window'
import { countryWhere, daysBetween, labelFor, type BookingLine, type MoneyByCurrency } from './booking-lines'
import { collectSalesPipeline, emptyCounts, type PipelineCounts, type PipelineSection } from './sales-pipeline-data'
import { loadTestBookings, testBookingKey, testBookingWhere } from '@/lib/test-bookings'
import { bookingSourceWhere } from '@/lib/booking-source'

// ─── Window ───────────────────────────────────────────────────────────────────

export interface SalesWindow extends ReportWindow {
  /** Calendar days covered, inclusive. */
  days: number
  /** True when a free date range was picked rather than a period. */
  custom: boolean
  /** True when the range runs up to now — today's figures are still moving. */
  live: boolean
  /** The comparison baseline: the same length immediately before. */
  previous: { start: Date; end: Date; fromDate: string; toDate: string; label: string }
}

/**
 * The window a sales report covers.
 *
 * Without a range it is exactly the Ops report's window for the same period —
 * yesterday, last week, last month, or the one containing `anchorDate`. With a
 * range it is those dates, and the comparison is the same number of days
 * immediately before them, so "1–15 Oct" is read against "16–30 Sep".
 */
export function buildSalesWindow(
  period: ReportPeriod,
  timezone: string,
  now: Date = new Date(),
  anchorDate?: string | null,
  sendDay?: number | null,
  range?: { fromDate?: string | null; toDate?: string | null } | null,
): SalesWindow {
  const realToday = dateInTz(now, timezone)
  const a = range?.fromDate && isValidDate(range.fromDate) ? range.fromDate : null
  const b = range?.toDate && isValidDate(range.toDate) ? range.toDate : null

  if (a || b) {
    let fromDate = a ?? b!
    let toDate = b ?? a!
    if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate]
    if (toDate > realToday) toDate = realToday
    if (fromDate > toDate) fromDate = toDate
    const days = daysBetween(fromDate, toDate) + 1
    const live = toDate === realToday
    const prevTo = shiftDate(fromDate, -1)
    const prevFrom = shiftDate(prevTo, -(days - 1))
    const single = days === 1
    const label = single
      ? `${live ? 'Today so far — ' : ''}${formatReportDate(fromDate, { weekday: true })}`
      : `${formatReportDate(fromDate)} to ${formatReportDate(toDate)}${live ? ' (to now)' : ''}`
    return {
      period: single ? 'DAILY' : period,
      fromDate, toDate,
      start: zonedDayStart(fromDate, timezone),
      end: zonedDayStart(shiftDate(toDate, 1), timezone),
      today: live ? realToday : shiftDate(toDate, 1),
      anchored: true,
      timezone,
      label,
      days,
      custom: true,
      live,
      previous: {
        fromDate: prevFrom, toDate: prevTo,
        start: zonedDayStart(prevFrom, timezone),
        end: zonedDayStart(shiftDate(prevTo, 1), timezone),
        label: single ? formatReportDate(prevFrom, { weekday: true }) : `${formatReportDate(prevFrom)} to ${formatReportDate(prevTo)}`,
      },
    }
  }

  const w = buildReportWindow(period, timezone, now, anchorDate, sendDay)
  const prev = previousWindow(w)
  const days = daysBetween(w.fromDate, w.toDate) + 1
  return {
    ...w,
    days,
    custom: false,
    live: false,
    previous: {
      ...prev,
      label: days === 1 ? formatReportDate(prev.fromDate, { weekday: true }) : `${formatReportDate(prev.fromDate)} to ${formatReportDate(prev.toDate)}`,
    },
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MarketRow {
  country: string
  label: string
  bookings: number
  pax: number
  quoted: MoneyByCurrency[]
  avgLeadDays: number | null
}

export interface B2cStoreOrder {
  orderId: number
  bookedDate: string | null
  serviceDate: string | null
  lines: number
  categories: string
  products: string
  currency: string
  value: number | null
}

export interface B2cTestOrder extends B2cStoreOrder {
  reason: string | null
  markedBy: string | null
  markedAt: string | null
}

export interface B2cStoreSection {
  available: boolean
  error: string | null
  /** Real orders only — test orders are counted in `tests`, never here. */
  orders: number
  previousOrders: number | null
  lines: number
  value: MoneyByCurrency[]
  byCategory: { category: string; orders: number; lines: number; value: MoneyByCurrency[] }[]
  list: B2cStoreOrder[]
  /** Orders in the window marked as tests in the shared test-booking register. */
  tests: {
    /** False when the register could not be read: test orders may then sit in the figures above. */
    checked: boolean
    orders: number
    value: MoneyByCurrency[]
    list: B2cTestOrder[]
  }
}

export interface Highlight {
  severity: 'good' | 'watch' | 'warning' | 'critical'
  title: string
  detail: string
}

export interface SalesReportData {
  window: SalesWindow
  generatedAt: string
  countries: string[]
  bookings: {
    available: boolean
    error: string | null
    created: CreatedSection | null
    total: number
    previousTotal: number | null
    pax: number
    value: MoneyByCurrency[]
    avgLeadDays: number | null
    avgPax: number | null
    avgNights: number | null
    hotelOnly: number
    markets: MarketRow[]
    lines: BookingLine[]
  }
  store: B2cStoreSection
  pipeline: PipelineSection
  highlights: Highlight[]
  warnings: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function moneyMap(): Map<string, number> { return new Map() }
function add(map: Map<string, number>, currency: string | null | undefined, amount: number | null | undefined) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return
  const c = (currency || 'USD').toUpperCase()
  map.set(c, (map.get(c) ?? 0) + amount)
}
function list(map: Map<string, number>): MoneyByCurrency[] {
  return Array.from(map.entries()).map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total)
}
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null)

// ─── Bookings ─────────────────────────────────────────────────────────────────

/** No Apple System cohort: that ledger is B2B. Counting falls to what was filed here. */
const NO_COHORT: AppleCohort = {
  available: false, error: null, keys: new Set(), entries: [], total: 0, expected: 0, cancelled: 0, sweptAt: null,
}

async function collectBookings(
  w: SalesWindow, countries: string[], maxRows: number,
): Promise<{ created: CreatedSection | null; lines: BookingLine[]; previousTotal: number | null; error: string | null }> {
  try {
    const created = await collectCreated(w, countries, maxRows, NO_COHORT)
    const lines = created.allBookings.filter(l => l.source === 'B2C')
    const scope = countryWhere(countries)
    const { clause } = await testBookingWhere('exclude')
    const previousTotal = await prisma.booking.count({
      where: {
        createdAt: { gte: w.previous.start, lt: w.previous.end },
        ...(scope ?? {}),
        AND: [bookingSourceWhere('B2C') as never, ...(clause ? [clause as never] : [])],
      },
    })
    return { created, lines, previousTotal, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[SalesReport] bookings failed:', msg)
    return { created: null, lines: [], previousTotal: null, error: msg }
  }
}

function marketsFrom(lines: BookingLine[]): MarketRow[] {
  const map = new Map<string, MarketRow & { q: Map<string, number>; leads: number[] }>()
  for (const l of lines) {
    let r = map.get(l.country)
    if (!r) {
      r = { country: l.country, label: labelFor(l.country), bookings: 0, pax: 0, quoted: [], avgLeadDays: null, q: moneyMap(), leads: [] }
      map.set(l.country, r)
    }
    r.bookings++
    r.pax += l.pax
    add(r.q, l.currency, l.quotedTotal)
    if (l.arrivalDate) r.leads.push(daysBetween(l.createdAt.slice(0, 10), l.arrivalDate))
  }
  return Array.from(map.values())
    .map(({ q, leads, ...r }) => ({ ...r, quoted: list(q), avgLeadDays: avg(leads) }))
    .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label))
}

// ─── B2C storefront ───────────────────────────────────────────────────────────

async function collectStore(w: SalesWindow, maxRows: number): Promise<B2cStoreSection> {
  const empty: B2cStoreSection = {
    available: false, error: null, orders: 0, previousOrders: null, lines: 0, value: [], byCategory: [], list: [],
    tests: { checked: false, orders: 0, value: [], list: [] },
  }
  if (!isB2cConfigured()) return { ...empty, error: 'The Aahaas B2C store database is not configured.' }
  try {
    const [all, prevAll, register] = await Promise.all([
      fetchOrdersBookedBetween({ from: w.fromDate, to: w.toDate, limit: 5000 }),
      fetchOrdersBookedBetween({ from: w.previous.fromDate, to: w.previous.toDate, limit: 5000 }).catch(() => null),
      loadTestBookings(),
    ])
    // The register files a store order as AHS-<order id> (testBookingReference()).
    const markOf = (orderId: number | string) => register.marks.get(testBookingKey(`AHS-${orderId}`)) ?? null

    const products = all.length ? await fetchOrderProducts(all.map(o => Number(o.order_id))) : []
    const byOrder = new Map<number, typeof products>()
    products.forEach(p => { const l = byOrder.get(Number(p.order_id)) ?? []; l.push(p); byOrder.set(Number(p.order_id), l) })

    const total = moneyMap()
    const testTotal = moneyMap()
    let realLines = 0
    const cats = new Map<string, { orders: Set<number>; lines: number; value: Map<string, number> }>()
    const rows: B2cStoreOrder[] = []
    const tests: B2cTestOrder[] = []
    for (const o of all) {
      const lines = byOrder.get(Number(o.order_id)) ?? []
      // `net_total_amount` is already in `base_currency` — the importer's rule
      // (b2c-booking-map.ts); `paid_currency` is only what the card was charged in.
      const currency = (lines.find(p => p.base_currency)?.base_currency ?? 'USD').trim().toUpperCase()
      const value = lines.reduce((s, p) => s + (Number(p.net_total_amount) || 0), 0)
      const row: B2cStoreOrder = {
        orderId: Number(o.order_id),
        bookedDate: o.bookedDate,
        serviceDate: o.serviceDate,
        lines: Number(o.productLines) || lines.length,
        categories: Array.from(new Set(lines.map(p => (p.maincat_type ?? '').trim()).filter(Boolean))).join(', '),
        products: lines.map(p => (p.product_name ?? '').trim()).filter(Boolean).slice(0, 4).join(' · '),
        currency,
        value: value > 0 ? Math.round(value * 100) / 100 : null,
      }
      const mark = markOf(o.order_id)
      if (mark) {
        if (value > 0) add(testTotal, currency, value)
        tests.push({ ...row, reason: mark.reason, markedBy: mark.markedBy, markedAt: mark.markedAt })
        continue
      }
      if (value > 0) add(total, currency, value)
      realLines += lines.length
      for (const p of lines) {
        const cat = (p.maincat_type ?? '').trim() || 'Other'
        const c = cats.get(cat) ?? { orders: new Set<number>(), lines: 0, value: moneyMap() }
        c.orders.add(Number(o.order_id))
        c.lines++
        add(c.value, (p.base_currency ?? currency).toUpperCase(), Number(p.net_total_amount) || 0)
        cats.set(cat, c)
      }
      rows.push(row)
    }
    return {
      available: true,
      error: null,
      orders: rows.length,
      previousOrders: prevAll ? prevAll.filter(o => !markOf(o.order_id)).length : null,
      lines: realLines,
      value: list(total),
      byCategory: Array.from(cats.entries())
        .map(([category, c]) => ({ category, orders: c.orders.size, lines: c.lines, value: list(c.value) }))
        .sort((a, b) => b.orders - a.orders),
      list: rows.sort((a, b) => b.orderId - a.orderId).slice(0, Math.max(maxRows, 500)),
      tests: { checked: register.checked, orders: tests.length, value: list(testTotal), list: tests.sort((a, b) => b.orderId - a.orderId) },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[SalesReport] B2C store read failed:', msg)
    return { ...empty, error: `The Aahaas B2C store could not be read (${msg}).` }
  }
}

// ─── Highlights ───────────────────────────────────────────────────────────────

const pctChange = (now: number, before: number | null) =>
  before === null || before === 0 ? null : Math.round(((now - before) / before) * 100)

/**
 * "Where to look today" — derived from the figures, reproducibly, never by AI.
 * An AI that invented a priority would be read as management having set one.
 */
function deriveHighlights(d: Omit<SalesReportData, 'highlights' | 'warnings'>): Highlight[] {
  const out: Highlight[] = []
  const p = d.pipeline
  const c = p.counts
  const span = d.window.days === 1 ? 'today' : 'in this period'
  const vs = d.window.days === 1 ? 'the day before' : 'the previous period'

  const so = pctChange(d.store.orders, d.store.previousOrders)
  if (d.store.available && so !== null && Math.abs(so) >= 20 && (d.store.previousOrders ?? 0) >= 3) {
    out.push({
      severity: so > 0 ? 'good' : 'warning',
      title: `Store orders ${so > 0 ? 'up' : 'down'} ${Math.abs(so)}% vs ${vs}`,
      detail: `${d.store.orders} orders now against ${d.store.previousOrders} before.`,
    })
  }
  if (d.store.available && d.store.orders === 0 && (d.store.previousOrders ?? 0) > 0) {
    out.push({ severity: 'warning', title: `No store orders ${span}`, detail: `${d.store.previousOrders} ${vs}. Check the storefront and checkout are working.` })
  }

  const ch = pctChange(d.bookings.total, d.bookings.previousTotal)
  if (ch !== null && Math.abs(ch) >= 20 && (d.bookings.previousTotal ?? 0) >= 3) {
    out.push({
      severity: ch > 0 ? 'good' : 'warning',
      title: `B2C bookings filed ${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}% vs ${vs}`,
      detail: `${d.bookings.total} now against ${d.bookings.previousTotal} before.`,
    })
  }

  if (p.available) {
    const warm = p.agencies.filter(a => a.prompts >= 3 && a.quotes === 0).slice(0, 6)
    if (warm.length) {
      out.push({
        severity: 'watch',
        title: `${warm.length} agenc${warm.length === 1 ? 'y' : 'ies'} used the AI but got no quotation`,
        detail: `${warm.map(a => `${a.agency} (${a.prompts} prompts)`).join(', ')}. Warm leads — a consultant can turn these into quotes.`,
      })
    }
    const follow = p.quotes.filter(q => q.bookingStatus === 'follow_up')
    if (follow.length) {
      out.push({ severity: 'watch', title: `${follow.length} quotation${follow.length === 1 ? '' : 's'} marked for follow-up`, detail: follow.slice(0, 6).map(q => `${q.ref}${q.agency ? ` · ${q.agency}` : ''}`).join(', ') })
    }
    if (c.calls.total >= 10 && c.calls.rate !== null && c.calls.rate < 0.3) {
      out.push({ severity: 'warning', title: `Only ${Math.round(c.calls.rate * 100)}% of calls were answered`, detail: `${c.calls.connected} of ${c.calls.total} dials reached a person. Check the calling hours and the numbers on the list.` })
    }
    if (c.signups.pending > 0) {
      out.push({ severity: 'watch', title: `${c.signups.pending} new account${c.signups.pending === 1 ? '' : 's'} waiting on approval`, detail: 'Agencies cannot quote until they are approved.' })
    }
    const idle = p.staff.filter(s => !s.newQuotes && !s.amendments && !s.manualCalls && !s.prompts && !s.confirmations)
    if (idle.length && d.window.days <= 7 && !d.window.live) {
      out.push({ severity: 'watch', title: `${idle.length} consultant${idle.length === 1 ? '' : 's'} with no recorded activity`, detail: `${idle.slice(0, 8).map(s => s.name).join(', ')}${idle.length > 8 ? '…' : ''} — no quote, amendment, call or prompt ${span}. On leave, or working outside the system?` })
    }
    const prevConv = p.previous?.conversion ?? null
    if (c.conversion !== null && prevConv !== null && c.newQuotes >= 5 && Math.abs(c.conversion - prevConv) >= 0.1) {
      out.push({
        severity: c.conversion > prevConv ? 'good' : 'warning',
        title: `Quote conversion ${c.conversion > prevConv ? 'improved' : 'fell'} to ${Math.round(c.conversion * 100)}%`,
        detail: `From ${Math.round(prevConv * 100)}% ${vs}.`,
      })
    }
  }

  if (!out.length) out.push({ severity: 'good', title: 'Nothing needs chasing', detail: 'No drop in store orders, unanswered calls or idle desks were found in these figures.' })
  const rank = { critical: 0, warning: 1, watch: 2, good: 3 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 10)
}

// ─── Collect ──────────────────────────────────────────────────────────────────

export interface SalesCollectOptions {
  period: ReportPeriod
  timezone: string
  countries?: string[]
  now?: Date
  anchorDate?: string | null
  sendDay?: number | null
  range?: { fromDate?: string | null; toDate?: string | null } | null
  maxRows?: number
  /** Office team for the Travel Quote GPT sections; empty = the whole company. */
  team?: string | null
}

export async function collectSalesReportData(opts: SalesCollectOptions): Promise<SalesReportData> {
  const countries = opts.countries ?? []
  const maxRows = opts.maxRows ?? 30
  const w = buildSalesWindow(opts.period, opts.timezone, opts.now, opts.anchorDate, opts.sendDay, opts.range)

  const [booked, store, pipeline] = await Promise.all([
    collectBookings(w, countries, maxRows),
    collectStore(w, maxRows),
    collectSalesPipeline({
      window: { start: w.start, end: w.end, fromDate: w.fromDate, toDate: w.toDate, timezone: w.timezone },
      previous: { start: w.previous.start, end: w.previous.end, fromDate: w.previous.fromDate, toDate: w.previous.toDate, timezone: w.timezone },
      team: opts.team,
    }),
  ])

  const created = booked.created
  const lines = booked.lines
  const value = moneyMap()
  lines.forEach(l => add(value, l.currency, l.quotedTotal))
  const leads = lines.filter(l => l.arrivalDate).map(l => daysBetween(l.createdAt.slice(0, 10), l.arrivalDate))
  const nights = lines.filter(l => l.arrivalDate && l.departureDate).map(l => daysBetween(l.arrivalDate, l.departureDate))

  const base = {
    window: w,
    generatedAt: new Date().toISOString(),
    countries,
    bookings: {
      available: !!created,
      error: booked.error,
      created,
      total: lines.length,
      previousTotal: booked.previousTotal,
      pax: lines.reduce((n, l) => n + l.pax, 0),
      value: list(value),
      avgLeadDays: avg(leads),
      avgPax: avg(lines.map(l => l.pax)),
      avgNights: avg(nights),
      hotelOnly: lines.filter(l => l.hotelOnly).length,
      markets: marketsFrom(lines),
      lines,
    },
    store,
    pipeline,
  }

  const warnings = [
    booked.error ? `Bookings could not be read — ${booked.error}` : '',
    store.error ?? '',
    store.available && !store.tests.checked ? 'The test-order register could not be read, so test orders may be counted in the store figures.' : '',
    ...pipeline.warnings,
  ].filter(Boolean)

  return { ...base, highlights: deriveHighlights(base), warnings }
}

/** True when the window holds nothing worth anyone's inbox. */
export function isEmptySalesReport(d: SalesReportData): boolean {
  const c: PipelineCounts = d.pipeline.available ? d.pipeline.counts : emptyCounts()
  return d.bookings.total === 0 && d.store.orders === 0 && c.newQuotes === 0 && c.amendments === 0 && c.confirmations === 0
    && c.calls.total === 0 && c.signups.total === 0 && c.adoption.prompts === 0
}
