/**
 * The Daily Sales Report — everything the mail and the workbook print.
 *
 * Three systems, each asked only what it is the authority on:
 *
 *  - **Booking system (this DB)** — the confirmed bookings, counted exactly as
 *    the Daily Ops Report counts them (`collectCreated()`, Apple System cohort
 *    basis), so the two morning mails cannot disagree on how much was sold.
 *  - **Accounts (read-only)** — the invoice ledger: what was invoiced as new
 *    business and what older confirmations were re-issued, with their values
 *    (`collectActivitySplit()`, the same split the accounts mails lead with).
 *  - **Aahaas B2C store (read-only)** — storefront orders placed in the window.
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
import { collectAppleCohort } from './apple-cohort'
import { bookingKey, collectActivitySplit, type ActivitySplit, type SplitLine } from './activity-split'
import { agentKey, canonicalAgentName } from './agent-names'
import { collectCreated, type CreatedSection } from './report-data'
import {
  buildReportWindow, dateInTz, formatReportDate, isValidDate, previousWindow, shiftDate, zonedDayStart,
  type ReportPeriod, type ReportWindow,
} from './report-window'
import { countryWhere, daysBetween, labelFor, type BookingLine, type MoneyByCurrency } from './booking-lines'
import { collectSalesPipeline, emptyCounts, type PipelineCounts, type PipelineSection } from './sales-pipeline-data'
import { testBookingWhere } from '@/lib/test-bookings'

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

export interface PartnerRow {
  agent: string
  bookings: number
  pax: number
  /** Quoted value on the bookings filed here, by currency. */
  quoted: MoneyByCurrency[]
  /** New business invoiced in the window. */
  invoicedNew: number
  invoicedNewValue: MoneyByCurrency[]
  /** Older confirmations re-issued in the window. */
  amended: number
  /** New invoices in the comparison window — the movers column. */
  previousNew: number
  share: number
}

export interface MarketRow {
  country: string
  label: string
  bookings: number
  pax: number
  b2b: number
  b2c: number
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

export interface B2cStoreSection {
  available: boolean
  error: string | null
  orders: number
  previousOrders: number | null
  lines: number
  value: MoneyByCurrency[]
  byCategory: { category: string; orders: number; lines: number; value: MoneyByCurrency[] }[]
  list: B2cStoreOrder[]
}

export interface InvoiceSection {
  available: boolean
  error: string | null
  newCount: number
  amendedCount: number
  newValue: MoneyByCurrency[]
  amendedValue: MoneyByCurrency[]
  previousNewCount: number | null
  previousNewValue: MoneyByCurrency[]
  newLines: SplitLine[]
  amendedLines: SplitLine[]
}

/**
 * Bookings against invoices, ref by ref — why "54 bookings" and "41 new
 * invoices" are both right. Built in memory from the two lists above; the
 * accounts split is B2B only, so B2C bookings are set aside first.
 */
export interface BookingInvoiceMatch {
  available: boolean
  b2bBooked: number
  b2cBooked: number
  /** B2B bookings of the window that carry a new invoice of the window. */
  matched: number
  /** B2B bookings of the window with no invoice raised in it yet. */
  notInvoiced: string[]
  /** New invoices whose booking is not in this window's confirmations. */
  invoicedOnly: string[]
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
    b2b: number
    b2c: number
    value: MoneyByCurrency[]
    avgLeadDays: number | null
    avgPax: number | null
    avgNights: number | null
    hotelOnly: number
    markets: MarketRow[]
    partners: PartnerRow[]
    /** Confirmed upstream in the window with no booking filed here. */
    missingRefs: string[]
    lines: BookingLine[]
  }
  invoices: InvoiceSection
  match: BookingInvoiceMatch
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

function agentDisplay(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  return canonicalAgentName(s) ?? (s || 'Unknown agent')
}

// ─── Bookings ─────────────────────────────────────────────────────────────────

async function collectBookings(
  w: SalesWindow, countries: string[], maxRows: number,
): Promise<{ created: CreatedSection | null; previousTotal: number | null; error: string | null }> {
  try {
    const cohort = await collectAppleCohort(w)
    const created = await collectCreated(w, countries, maxRows, cohort)
    // The comparison on the same basis as the count itself: the Apple System
    // cohort when it was readable, the booking system's own intake when not.
    let previousTotal: number | null = null
    if (cohort.available) {
      const prev = await collectAppleCohort(w.previous)
      previousTotal = prev.available ? prev.expected : null
    } else {
      const scope = countryWhere(countries)
      const { clause } = await testBookingWhere('exclude')
      previousTotal = await prisma.booking.count({
        where: {
          createdAt: { gte: w.previous.start, lt: w.previous.end },
          ...(scope ?? {}),
          ...(clause ? { AND: [clause as never] } : {}),
        },
      })
    }
    return { created, previousTotal, error: null }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[SalesReport] bookings failed:', msg)
    return { created: null, previousTotal: null, error: msg }
  }
}

function partnersFrom(lines: BookingLine[], split: ActivitySplit | null, prevSplit: ActivitySplit | null): PartnerRow[] {
  type Acc = { agent: string; bookings: number; pax: number; quoted: Map<string, number>; invoicedNew: number; newValue: Map<string, number>; amended: number; previousNew: number }
  const map = new Map<string, Acc>()
  const at = (raw: string | null | undefined) => {
    const key = agentKey(raw)
    const hit = map.get(key)
    if (hit) return hit
    const row: Acc = { agent: agentDisplay(raw), bookings: 0, pax: 0, quoted: moneyMap(), invoicedNew: 0, newValue: moneyMap(), amended: 0, previousNew: 0 }
    map.set(key, row)
    return row
  }
  for (const l of lines) {
    const r = at(l.agent)
    r.bookings++
    r.pax += l.pax
    add(r.quoted, l.currency, l.quotedTotal)
  }
  if (split?.available) {
    for (const l of split.today.lines) { const r = at(l.agent); r.invoicedNew++; add(r.newValue, l.currency, l.amount) }
    for (const l of split.old.lines) at(l.agent).amended++
  }
  if (prevSplit?.available) for (const l of prevSplit.today.lines) at(l.agent).previousNew++

  const totalBookings = lines.length || 1
  return Array.from(map.values())
    .filter(r => r.bookings || r.invoicedNew || r.amended || r.previousNew)
    .map(r => ({
      agent: r.agent, bookings: r.bookings, pax: r.pax, quoted: list(r.quoted),
      invoicedNew: r.invoicedNew, invoicedNewValue: list(r.newValue), amended: r.amended,
      previousNew: r.previousNew, share: lines.length ? r.bookings / totalBookings : 0,
    }))
    .sort((a, b) => b.bookings - a.bookings || b.invoicedNew - a.invoicedNew || a.agent.localeCompare(b.agent))
}

function marketsFrom(lines: BookingLine[]): MarketRow[] {
  const map = new Map<string, MarketRow & { q: Map<string, number>; leads: number[] }>()
  for (const l of lines) {
    let r = map.get(l.country)
    if (!r) {
      r = { country: l.country, label: labelFor(l.country), bookings: 0, pax: 0, b2b: 0, b2c: 0, quoted: [], avgLeadDays: null, q: moneyMap(), leads: [] }
      map.set(l.country, r)
    }
    r.bookings++
    r.pax += l.pax
    if (l.source === 'B2C') r.b2c++
    else r.b2b++
    add(r.q, l.currency, l.quotedTotal)
    if (l.arrivalDate) r.leads.push(daysBetween(l.createdAt.slice(0, 10), l.arrivalDate))
  }
  return Array.from(map.values())
    .map(({ q, leads, ...r }) => ({ ...r, quoted: list(q), avgLeadDays: avg(leads) }))
    .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label))
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

function invoicesFrom(split: ActivitySplit, prev: ActivitySplit | null): InvoiceSection {
  const nv = moneyMap(); split.today.lines.forEach(l => add(nv, l.currency, l.amount))
  const av = moneyMap(); split.old.lines.forEach(l => add(av, l.currency, l.amount))
  const pv = moneyMap(); prev?.today.lines.forEach(l => add(pv, l.currency, l.amount))
  return {
    available: split.available,
    error: split.available ? null : split.error ?? 'The accounts invoice ledger could not be read.',
    newCount: split.today.count,
    amendedCount: split.old.count,
    newValue: list(nv),
    amendedValue: list(av),
    previousNewCount: prev?.available ? prev.today.count : null,
    previousNewValue: prev?.available ? list(pv) : [],
    newLines: split.today.lines,
    amendedLines: split.old.lines,
  }
}

function matchBookingsToInvoices(lines: BookingLine[], split: ActivitySplit, bookingsOk: boolean): BookingInvoiceMatch {
  const b2b = lines.filter(l => l.source !== 'B2C')
  const empty: BookingInvoiceMatch = { available: false, b2bBooked: b2b.length, b2cBooked: lines.length - b2b.length, matched: 0, notInvoiced: [], invoicedOnly: [] }
  if (!bookingsOk || !split.available) return empty
  const invoiced = new Set([...split.today.keys, ...split.old.keys])
  const booked = new Set(b2b.map(l => bookingKey(l.bookingRef)).filter(Boolean))
  const notInvoiced = b2b.filter(l => !invoiced.has(bookingKey(l.bookingRef))).map(l => l.bookingRef)
  const invoicedOnly = split.today.lines.filter(l => l.key && !booked.has(l.key)).map(l => l.ref)
  return { ...empty, available: true, matched: b2b.length - notInvoiced.length, notInvoiced, invoicedOnly }
}

// ─── B2C storefront ───────────────────────────────────────────────────────────

async function collectStore(w: SalesWindow, maxRows: number): Promise<B2cStoreSection> {
  const empty: B2cStoreSection = { available: false, error: null, orders: 0, previousOrders: null, lines: 0, value: [], byCategory: [], list: [] }
  if (!isB2cConfigured()) return { ...empty, error: 'The Aahaas B2C store database is not configured.' }
  try {
    const [orders, prevOrders] = await Promise.all([
      fetchOrdersBookedBetween({ from: w.fromDate, to: w.toDate, limit: 5000 }),
      fetchOrdersBookedBetween({ from: w.previous.fromDate, to: w.previous.toDate, limit: 5000 }).catch(() => null),
    ])
    const products = orders.length ? await fetchOrderProducts(orders.map(o => Number(o.order_id))) : []
    const byOrder = new Map<number, typeof products>()
    products.forEach(p => { const l = byOrder.get(Number(p.order_id)) ?? []; l.push(p); byOrder.set(Number(p.order_id), l) })

    const total = moneyMap()
    const cats = new Map<string, { orders: Set<number>; lines: number; value: Map<string, number> }>()
    const rows: B2cStoreOrder[] = orders.map(o => {
      const lines = byOrder.get(Number(o.order_id)) ?? []
      // `net_total_amount` is already in `base_currency` — the importer's rule
      // (b2c-booking-map.ts); `paid_currency` is only what the card was charged in.
      const currency = (lines.find(p => p.base_currency)?.base_currency ?? 'USD').trim().toUpperCase()
      const value = lines.reduce((s, p) => s + (Number(p.net_total_amount) || 0), 0)
      if (value > 0) add(total, currency, value)
      for (const p of lines) {
        const cat = (p.maincat_type ?? '').trim() || 'Other'
        const c = cats.get(cat) ?? { orders: new Set<number>(), lines: 0, value: moneyMap() }
        c.orders.add(Number(o.order_id))
        c.lines++
        add(c.value, (p.base_currency ?? currency).toUpperCase(), Number(p.net_total_amount) || 0)
        cats.set(cat, c)
      }
      return {
        orderId: Number(o.order_id),
        bookedDate: o.bookedDate,
        serviceDate: o.serviceDate,
        lines: Number(o.productLines) || lines.length,
        categories: Array.from(new Set(lines.map(p => (p.maincat_type ?? '').trim()).filter(Boolean))).join(', '),
        products: lines.map(p => (p.product_name ?? '').trim()).filter(Boolean).slice(0, 4).join(' · '),
        currency,
        value: value > 0 ? Math.round(value * 100) / 100 : null,
      }
    })
    return {
      available: true,
      error: null,
      orders: orders.length,
      previousOrders: prevOrders ? prevOrders.length : null,
      lines: products.length,
      value: list(total),
      byCategory: Array.from(cats.entries())
        .map(([category, c]) => ({ category, orders: c.orders.size, lines: c.lines, value: list(c.value) }))
        .sort((a, b) => b.orders - a.orders),
      list: rows.sort((a, b) => b.orderId - a.orderId).slice(0, Math.max(maxRows, 500)),
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

  if (d.bookings.missingRefs.length) {
    out.push({
      severity: 'critical',
      title: `${d.bookings.missingRefs.length} confirmation${d.bookings.missingRefs.length === 1 ? '' : 's'} sold but not filed here`,
      detail: `Confirmed in the Apple System ${span} with no booking in OPS yet: ${d.bookings.missingRefs.slice(0, 8).join(', ')}${d.bookings.missingRefs.length > 8 ? '…' : ''}. Sales that are not filed are not operated.`,
    })
  }

  const m = d.match
  if (m.available && m.notInvoiced.length) {
    out.push({
      severity: m.notInvoiced.length >= 5 ? 'warning' : 'watch',
      title: `${m.notInvoiced.length} B2B booking${m.notInvoiced.length === 1 ? '' : 's'} confirmed ${span} with no invoice yet`,
      detail: `${m.notInvoiced.slice(0, 8).join(', ')}${m.notInvoiced.length > 8 ? '…' : ''}. Usually raised next morning. Check if it is still open a day later.`,
    })
  }

  const ch = pctChange(d.bookings.total, d.bookings.previousTotal)
  if (ch !== null && Math.abs(ch) >= 20 && (d.bookings.previousTotal ?? 0) >= 3) {
    out.push({
      severity: ch > 0 ? 'good' : 'warning',
      title: `Confirmed bookings ${ch > 0 ? 'up' : 'down'} ${Math.abs(ch)}% vs ${vs}`,
      detail: `${d.bookings.total} now against ${d.bookings.previousTotal} before.`,
    })
  }

  const top = d.bookings.partners[0]
  if (top && top.bookings >= 2) {
    out.push({
      severity: 'good',
      title: `${top.agent} led ${span}`,
      detail: `${top.bookings} booking${top.bookings === 1 ? '' : 's'} (${Math.round(top.share * 100)}% of the total), ${top.pax} guests.`,
    })
  }

  if (d.window.days >= 7) {
    const quiet = d.bookings.partners.filter(r => r.previousNew >= 2 && r.invoicedNew === 0).slice(0, 6)
    if (quiet.length) {
      out.push({
        severity: 'warning',
        title: `${quiet.length} regular partner${quiet.length === 1 ? '' : 's'} went quiet`,
        detail: `Invoiced new business ${vs} but nothing now: ${quiet.map(q => `${q.agent} (${q.previousNew} before)`).join(', ')}. Worth a call.`,
      })
    }
    const fresh = d.bookings.partners.filter(r => r.invoicedNew > 0 && r.previousNew === 0).slice(0, 6)
    if (fresh.length) {
      out.push({ severity: 'good', title: `${fresh.length} partner${fresh.length === 1 ? '' : 's'} back or new`, detail: fresh.map(f => `${f.agent} (${f.invoicedNew})`).join(', ') })
    }
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

  if (!out.length) out.push({ severity: 'good', title: 'Nothing needs chasing', detail: 'No missing confirmations, quiet partners, unanswered calls or idle desks were found in these figures.' })
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

  const [booked, split, prevSplit, store, pipeline] = await Promise.all([
    collectBookings(w, countries, maxRows),
    collectActivitySplit(w),
    collectActivitySplit({ ...w, ...w.previous }),
    collectStore(w, maxRows),
    collectSalesPipeline({
      window: { start: w.start, end: w.end, fromDate: w.fromDate, toDate: w.toDate, timezone: w.timezone },
      previous: { start: w.previous.start, end: w.previous.end, fromDate: w.previous.fromDate, toDate: w.previous.toDate, timezone: w.timezone },
      team: opts.team,
    }),
  ])

  const created = booked.created
  const lines = created?.allBookings ?? []
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
      total: created?.total ?? 0,
      previousTotal: booked.previousTotal,
      pax: created?.pax ?? 0,
      b2b: created?.channel.b2b ?? 0,
      b2c: created?.channel.b2c ?? 0,
      value: list(value),
      avgLeadDays: avg(leads),
      avgPax: avg(lines.map(l => l.pax)),
      avgNights: avg(nights),
      hotelOnly: lines.filter(l => l.hotelOnly).length,
      markets: marketsFrom(lines),
      partners: partnersFrom(lines, split, prevSplit),
      missingRefs: created?.missingRefs ?? [],
      lines,
    },
    invoices: invoicesFrom(split, prevSplit),
    match: matchBookingsToInvoices(lines, split, !!created),
    store,
    pipeline,
  }

  const warnings = [
    booked.error ? `Bookings could not be read — ${booked.error}` : '',
    created && created.basis === 'ops' ? 'The Apple System confirmation ledger was unreadable, so bookings are counted from what was filed here.' : '',
    !split.available ? `Invoices: ${split.error ?? 'the accounts ledger could not be read.'}` : '',
    store.error ?? '',
    ...pipeline.warnings,
  ].filter(Boolean)

  return { ...base, highlights: deriveHighlights(base), warnings }
}

/** True when the window holds nothing worth anyone's inbox. */
export function isEmptySalesReport(d: SalesReportData): boolean {
  const c: PipelineCounts = d.pipeline.available ? d.pipeline.counts : emptyCounts()
  return d.bookings.total === 0 && d.invoices.newCount === 0 && d.invoices.amendedCount === 0
    && d.store.orders === 0 && c.newQuotes === 0 && c.amendments === 0 && c.confirmations === 0
    && c.calls.total === 0 && c.signups.total === 0 && c.adoption.prompts === 0
    && d.bookings.missingRefs.length === 0
}
