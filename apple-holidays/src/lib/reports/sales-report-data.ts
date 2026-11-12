/**
 * The Daily Sales Report — everything the mail and the workbook print.
 *
 * B2C first. B2B (Apple System confirmations, the accounts invoice ledger,
 * partners) belongs to the Ops and accounts mails and is not read here.
 *
 *  - **Aahaas store (read-only)** — storefront orders placed in the window,
 *    split by the channel badge AahaasFlow shows on each order (user 2026-11-12):
 *    **Aahaas B2B** = B2B portal + AI Chat (Travel Quote GPT) + B2B console;
 *    **Aahaas B2C** = every other channel (AI Mobile, AI WhatsApp, AI Web,
 *    AI Voice, social, not recorded). The B2C side is the headline sales
 *    figure; the B2B side is reported beside it, never added in.
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
import { readStoreOrderSegments, STORE_CHANNEL_LABEL } from '@/lib/store-order-segment'

/** Report side for an order. */
export type SalesSide = 'b2b' | 'b2c'

/**
 * The badges that make an order Aahaas B2B in this report (user, 2026-11-12:
 * "B2B portal and AI Chat is Aahaas B2B, all others Aahaas B2C"). B2B console
 * orders are confirmations of Travel Quote GPT quotes, so they go with AI Chat.
 */
export const B2B_CHANNELS = new Set(['b2b_portal', 'travel_quote_gpt', 'confirmation'])
export const sideOfChannel = (channel: string | null): SalesSide => (channel && B2B_CHANNELS.has(channel) ? 'b2b' : 'b2c')
export const channelLabel = (channel: string | null) => (channel ? STORE_CHANNEL_LABEL[channel] ?? channel : 'Not recorded')

/** Orders and value per channel badge on one side of the store. */
export interface ChannelRow { channel: string | null; label: string; orders: number; value: MoneyByCurrency[] }

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
  /** Aahaas B2C or Aahaas B2B — null when the split could not be read. */
  segment: SalesSide | null
  /** The AahaasFlow badge key (app, whatsapp, travel_quote_gpt, b2b_portal…); null = not recorded. */
  channel: string | null
  channelLabel: string
}

/** The Aahaas B2B half of the store: agency orders, kept out of every B2C figure. */
export interface B2bStoreSide {
  orders: number
  previousOrders: number | null
  lines: number
  value: MoneyByCurrency[]
  /** B2B portal / AI Chat / B2B console, biggest first. */
  byChannel: ChannelRow[]
  list: B2cStoreOrder[]
}

export interface B2cTestOrder extends B2cStoreOrder {
  reason: string | null
  markedBy: string | null
  markedAt: string | null
}

export interface B2cStoreSection {
  available: boolean
  error: string | null
  /**
   * False when the B2B/B2C split could not be read: every real order is then in
   * the figures below as before, and a warning says so.
   */
  split: boolean
  /** Real Aahaas B2C orders only — test orders are in `tests`, B2B orders in `b2b`. */
  orders: number
  previousOrders: number | null
  lines: number
  value: MoneyByCurrency[]
  byCategory: { category: string; orders: number; lines: number; value: MoneyByCurrency[] }[]
  /** B2C orders per channel badge (AI Mobile, AI WhatsApp…), biggest first. */
  byChannel: ChannelRow[]
  list: B2cStoreOrder[]
  /** Aahaas B2B orders placed on the same store in the window. */
  b2b: B2bStoreSide
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
  available: false, error: null, keys: new Set(), entries: [], total: 0, expected: 0, cancelled: 0, sweptAt: null, tests: [],
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
  const emptyB2b: B2bStoreSide = { orders: 0, previousOrders: null, lines: 0, value: [], byChannel: [], list: [] }
  const empty: B2cStoreSection = {
    available: false, error: null, split: false, orders: 0, previousOrders: null, lines: 0, value: [], byCategory: [], byChannel: [], list: [],
    b2b: emptyB2b, tests: { checked: false, orders: 0, value: [], list: [] },
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

    // Each order's channel badge, read the way AahaasFlow reads it. A failed
    // read is shown as a warning and the orders stay unsplit — never silently all-B2C.
    let segments: Map<number, { channel: string | null }> | null = null
    let splitError: string | null = null
    try {
      const ids = [...all, ...(prevAll ?? [])].map(o => Number(o.order_id))
      segments = ids.length ? await readStoreOrderSegments(ids) : new Map()
    } catch (err) {
      splitError = err instanceof Error ? err.message : String(err)
      console.warn('[SalesReport] B2B/B2C split failed:', splitError)
    }
    const chOf = (orderId: number | string) => segments?.get(Number(orderId))?.channel ?? null
    const isB2b = (orderId: number | string) => !!segments && sideOfChannel(chOf(orderId)) === 'b2b'

    const products = all.length ? await fetchOrderProducts(all.map(o => Number(o.order_id))) : []
    const byOrder = new Map<number, typeof products>()
    products.forEach(p => { const l = byOrder.get(Number(p.order_id)) ?? []; l.push(p); byOrder.set(Number(p.order_id), l) })

    const total = moneyMap()
    const testTotal = moneyMap()
    const b2bTotal = moneyMap()
    const b2bRows: B2cStoreOrder[] = []
    let b2bLines = 0
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
        segment: segments ? sideOfChannel(chOf(o.order_id)) : null,
        channel: chOf(o.order_id),
        channelLabel: channelLabel(chOf(o.order_id)),
      }
      const mark = markOf(o.order_id)
      if (mark) {
        if (value > 0) add(testTotal, currency, value)
        tests.push({ ...row, reason: mark.reason, markedBy: mark.markedBy, markedAt: mark.markedAt })
        continue
      }
      if (row.segment === 'b2b') {
        if (value > 0) add(b2bTotal, currency, value)
        b2bLines += lines.length
        b2bRows.push(row)
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
    const prevReal = prevAll ? prevAll.filter(o => !markOf(o.order_id)) : null
    return {
      available: true,
      error: splitError ? `The B2B / B2C split could not be read (${splitError}), so B2B portal and AI Chat orders may be counted as B2C.` : null,
      split: !splitError,
      orders: rows.length,
      previousOrders: prevReal ? prevReal.filter(o => !isB2b(o.order_id)).length : null,
      lines: realLines,
      value: list(total),
      byCategory: Array.from(cats.entries())
        .map(([category, c]) => ({ category, orders: c.orders.size, lines: c.lines, value: list(c.value) }))
        .sort((a, b) => b.orders - a.orders),
      byChannel: channelRows(rows),
      list: rows.sort((a, b) => b.orderId - a.orderId).slice(0, Math.max(maxRows, 500)),
      b2b: {
        orders: b2bRows.length,
        previousOrders: prevReal && !splitError ? prevReal.filter(o => isB2b(o.order_id)).length : null,
        lines: b2bLines,
        value: list(b2bTotal),
        byChannel: channelRows(b2bRows),
        list: b2bRows.sort((a, b) => b.orderId - a.orderId).slice(0, Math.max(maxRows, 500)),
      },
      tests: { checked: register.checked, orders: tests.length, value: list(testTotal), list: tests.sort((a, b) => b.orderId - a.orderId) },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[SalesReport] B2C store read failed:', msg)
    return { ...empty, error: `The Aahaas B2C store could not be read (${msg}).` }
  }
}

/** Orders and value per channel badge, biggest first. */
function channelRows(rows: B2cStoreOrder[]): ChannelRow[] {
  const map = new Map<string, { channel: string | null; orders: number; value: Map<string, number> }>()
  for (const r of rows) {
    const k = r.channel ?? ''
    const c = map.get(k) ?? { channel: r.channel, orders: 0, value: moneyMap() }
    c.orders++
    add(c.value, r.currency, r.value)
    map.set(k, c)
  }
  return Array.from(map.values())
    .map(c => ({ channel: c.channel, label: channelLabel(c.channel), orders: c.orders, value: list(c.value) }))
    .sort((a, b) => b.orders - a.orders || a.label.localeCompare(b.label))
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
  return d.bookings.total === 0 && d.store.orders === 0 && d.store.b2b.orders === 0 && c.newQuotes === 0 && c.amendments === 0 && c.confirmations === 0
    && c.calls.total === 0 && c.signups.total === 0 && c.adoption.prompts === 0
}
