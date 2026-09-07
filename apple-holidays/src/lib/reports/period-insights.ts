/**
 * Weekly and monthly analytics — the part of a periodic report a daily one
 * cannot have.
 *
 * ## Why this exists
 *
 * The weekly and monthly mails used to be the daily mail with a wider window:
 * the same booking tables, the same chase lists, just longer. That is the wrong
 * deliverable twice over. Nobody chases an arrival that landed nine days ago,
 * and nobody reads two hundred booking rows in an email — so the rows were
 * scrolled past and the one thing a period *can* say, which a day cannot, was
 * never said at all: **is this getting better or worse, and where.**
 *
 * So the periodic mails no longer print bookings. They print movement — this
 * period against the one before it, market by market, partner by partner — and
 * every individual row moves to the attached workbook, which is the tool for
 * that job. This module computes the movement.
 *
 * ## What it costs
 *
 * Four extra reads, all of them narrow, none of them on the send path's
 * critical section:
 *
 *  1. the previous period's counted bookings (for every delta in the mail),
 *  2. tours overlapping the window (what operations actually delivered),
 *  3. cancellations inside the window (attrition, and what it cost),
 *  4. the previous period's complaint count (service-quality direction).
 *
 * Every one of them degrades: a failure marks that block unavailable and the
 * rest of the report is unaffected. The collector as a whole is wrapped by its
 * caller for the same reason — analytics are the reason to read the mail, but
 * the sections beneath them are the reason to send it.
 *
 * ## The comparison rule
 *
 * Like is compared with like or not at all. When the report counts AppleSystem
 * confirmations (`basis: 'apple'`), the previous period is counted the same
 * way — its own cohort, read from the same ledger — never this system's raw
 * intake. When the ledger is unreadable both sides fall back to filed bookings
 * together. A delta between two different populations is not a trend, it is a
 * measurement artefact, and it would be indistinguishable from a real one in
 * the mail.
 */
import { prisma } from '@/lib/prisma'
import { groupByAgent, agentKey } from './agent-names'
import { collectAppleCohort, cohortKey } from './apple-cohort'
import {
  BOOKING_SELECT, DEAD_STATUSES, channelSplit, countryWhere, daysBetween,
  inSelectedCountries, isoDate, labelFor, resolveCountry, rollUpByCountry, sumByCurrency,
  toLine, toNumber,
  type BookingLine, type ChannelSplit, type CountryRow, type MoneyByCurrency,
} from './booking-lines'
import {
  formatReportDate, previousWindow, shiftDate, zonedDayStart, type ReportWindow,
} from './report-window'
import type { ComplaintsSection } from './report-data'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One bucket of the intake trend — a day on a weekly report, a week on a monthly one. */
export interface PeriodPoint {
  /** `yyyy-mm-dd` — the day, or the first day of the week bucket. */
  key: string
  /** "Mon 03 Aug" / "03–09 Aug". */
  label: string
  /** Bookings counted into this bucket, by the date they were filed. */
  bookings: number
  pax: number
  /** Tours starting in this bucket. */
  arrivals: number
  /** Tours ending in this bucket. */
  departures: number
}

/** A named thing that moved between the two periods — a market, or a partner. */
export interface MoverRow {
  label: string
  current: number
  previous: number
  delta: number
  /** Percentage change, or null when the previous period was zero. */
  pct: number | null
  pax: number
  /** No business last period, business this period. */
  isNew: boolean
  /** Business last period, none this period — the row nobody notices otherwise. */
  isLost: boolean
}

/** How far ahead the business is being booked. */
export interface LeadTime {
  /** Bookings the measure could be taken on (both dates present, arrival ≥ filing). */
  measured: number
  avgDays: number | null
  medianDays: number | null
  /** Booked to travel inside a week — the volatile end of the book. */
  within7: number
  within30: number
  beyond90: number
  /** Same average over the previous period, for the direction of travel. */
  previousAvgDays: number | null
}

export interface DeliverySection {
  available: boolean
  /** Tours that were on the ground for at least one day of the window. */
  toursOperated: number
  /** Tours that started inside the window. */
  arrivals: number
  /** Tours that ended inside the window. */
  departures: number
  /** Guests carried on the tours that operated. */
  pax: number
  /**
   * Guest-days delivered: for every tour, the days it was on the ground inside
   * the window multiplied by its party size. The one figure that says how much
   * operation the period actually contained — a hundred one-night files and ten
   * two-week tours are not the same week's work, and a tour count says they are.
   */
  guestDays: number
  avgPartySize: number | null
  avgTourNights: number | null
  hotelOnly: number
  byCountry: CountryRow[]
  channel: ChannelSplit
  previousArrivals: number
  /**
   * Arrivals and departures per local date inside the window, so the intake
   * trend can be drawn against the operation it produced — the week you sell is
   * not the week you fly, and one axis showing both is the cheapest way to see it.
   */
  byDate: { date: string; arrivals: number; departures: number }[]
  /**
   * Every tour that operated, with the slice of it this period owns.
   *
   * Carried for the workbook rather than the mail: "63 tours operated" is the
   * figure a manager reads, and "which 63, and which of them straddled the
   * period" is the question they ask ten minutes later.
   */
  lines: OperatedLine[]
}

/** One tour that was on the ground during the period. */
export interface OperatedLine extends BookingLine {
  /** Days of this tour that fell inside the window. */
  daysInPeriod: number
  /** `daysInPeriod` × party size — this period's share of the workload. */
  guestDaysInPeriod: number
  /** True when the tour started before the window or ended after it. */
  straddles: boolean
}

/** One cancelled booking, for the workbook. */
export interface CancellationLine extends BookingLine {
  cancelledAt: string
  cancelledBy: string | null
  reason: string | null
  feeTotal: number | null
  /** Days between the cancellation and the arrival it was booked for. */
  noticeDays: number | null
}

export interface CancellationSection {
  available: boolean
  total: number
  pax: number
  previousTotal: number
  /** Cancellations as a share of everything the period confirmed, in percent. */
  ratePct: number | null
  /** Quoted value withdrawn, never blended across currencies. */
  byCurrency: MoneyByCurrency[]
  /** Cancellation fees recorded against those files, by currency. */
  feesByCurrency: MoneyByCurrency[]
  /** Cancelled with less than a week to arrival — the expensive kind. */
  shortNotice: number
  byCountry: CountryRow[]
  byAgent: { agent: string; bookings: number; pax: number }[]
  topReasons: { reason: string; count: number }[]
  lines: CancellationLine[]
}

export interface QualitySection {
  /** Distinct complaints raised in the window (mirrors the complaints section). */
  complaints: number
  previousComplaints: number | null
  /** Complaints per 100 tours operated — volume-adjusted, so a busy period is judged fairly. */
  per100Tours: number | null
  resolvedPct: number | null
  avgResolutionHours: number | null
  recurringOpen: number
  highSeverityOpen: number
  /**
   * Share of everything travelling inside D-10 whose guest reconfirmation is not
   * late. The service promise, as a percentage.
   */
  reconfirmCompliancePct: number | null
  unexplainedBreaches: number
  /** Share of the next three days' arrivals that are fully ready. */
  readinessPct: number | null
}

export interface IntegritySection {
  /** AppleSystem confirmations this system never received. */
  parityMissing: number
  paritySource: 'live' | 'ledger' | 'none'
  /** P&L + invoice + booking shortfalls across the count check. */
  countCheckShort: number
  countCheckAvailable: boolean
  /** True when nobody swept the accounts ledger for this window. */
  unswept: boolean
  /** Reconciler runs over the window, and what they had to fix. */
  automationCreated: number
  automationCancelled: number
  automationFlagged: number
  automationErrors: number
}

/** One thing the period says somebody should do, ranked. */
export interface PeriodAction {
  severity: 'critical' | 'warning' | 'watch' | 'good'
  title: string
  detail: string
  /** Which workbook sheet holds the rows behind it, when there are rows. */
  sheet?: string
}

export interface PeriodInsights {
  /** Which population the comparisons are drawn on. */
  basis: 'apple' | 'ops'
  /** True when the previous period could be counted on the same basis. */
  comparable: boolean
  previousLabel: string
  granularity: 'day' | 'week'
  series: PeriodPoint[]
  busiest: PeriodPoint | null
  quietest: PeriodPoint | null
  /** Bookings per active day, this period against last. */
  runRate: { current: number | null; previous: number | null }

  totals: {
    bookings: number
    previousBookings: number
    pax: number
    previousPax: number
    channel: ChannelSplit
    previousChannel: ChannelSplit
    byCurrency: MoneyByCurrency[]
    previousByCurrency: MoneyByCurrency[]
    /** Average quoted value per booking, per currency, this period. */
    avgBookingValue: MoneyByCurrency[]
    avgPartySize: number | null
    previousAvgPartySize: number | null
  }

  countryMovers: MoverRow[]
  agentMovers: MoverRow[]
  /** Partners who bought this period and not last — the ones to thank. */
  newAgents: string[]
  /** Partners who bought last period and not this — the ones to ring. */
  lapsedAgents: string[]
  /** Share of the period's bookings held by the top three partners, in percent. */
  agentConcentrationPct: number | null

  leadTime: LeadTime
  delivery: DeliverySection
  cancellations: CancellationSection
  quality: QualitySection
  integrity: IntegritySection
  actions: PeriodAction[]
}

export interface PeriodInsightOptions {
  window: ReportWindow
  countries: string[]
  /** The population the report counted — `created.allBookings`. */
  counted: BookingLine[]
  basis: 'apple' | 'ops'
  complaints: ComplaintsSection
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(values: number[]): number | null {
  if (!values.length) return null
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
}

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null
  return Math.round((part / whole) * 1000) / 10
}

function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

/** Every `yyyy-mm-dd` from `from` to `to`, inclusive. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    out.push(d)
    if (out.length > 400) break
  }
  return out
}

/**
 * The date a booking is bucketed under.
 *
 * The filing timestamp is an instant; the buckets are local business days, so
 * it is read in the report's timezone rather than sliced off the ISO string —
 * a booking filed at 23:40 UTC belongs to the next morning in Colombo, and
 * slicing would put it in the wrong day, or the wrong week at a month boundary.
 */
function localDay(iso: string, timezone: string): string {
  const at = new Date(iso)
  if (isNaN(at.getTime())) return iso.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/** Compare two named roll-ups and describe what moved. */
function movers(
  current: Map<string, { label: string; count: number; pax: number }>,
  previous: Map<string, { label: string; count: number; pax: number }>,
): MoverRow[] {
  const keys = new Set([...Array.from(current.keys()), ...Array.from(previous.keys())])
  const rows: MoverRow[] = []
  for (const key of Array.from(keys)) {
    const now = current.get(key)
    const before = previous.get(key)
    const c = now?.count ?? 0
    const p = before?.count ?? 0
    rows.push({
      label: now?.label ?? before?.label ?? key,
      current: c,
      previous: p,
      delta: c - p,
      pct: changePct(c, p),
      pax: now?.pax ?? 0,
      isNew: p === 0 && c > 0,
      isLost: c === 0 && p > 0,
    })
  }
  // Biggest book first; a market that lost everything still has to be visible,
  // so a zero-current row is ranked by what it used to be worth.
  return rows.sort((a, b) => b.current - a.current || b.previous - a.previous || a.label.localeCompare(b.label))
}

// ─── The previous period, on the same basis ───────────────────────────────────

async function collectPrevious(
  window: ReportWindow,
  countries: string[],
  basis: 'apple' | 'ops',
): Promise<{ lines: BookingLine[]; comparable: boolean; label: string }> {
  const prev = previousWindow(window)
  const label = window.period === 'MONTHLY'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .format(new Date(`${prev.fromDate}T00:00:00Z`))
    : `${formatReportDate(prev.fromDate)} – ${formatReportDate(prev.toDate)}`

  // Filed basis: what this system took in over the previous window. Also the
  // fallback population when the ledger cannot be read for either side.
  const filed = async () => {
    const rows = await prisma.booking.findMany({
      where: { createdAt: { gte: prev.start, lt: prev.end }, ...(countryWhere(countries) ?? {}) },
      select: BOOKING_SELECT,
    })
    return rows.map(toLine).filter(l => inSelectedCountries(l.country, countries))
  }

  if (basis !== 'apple') return { lines: await filed(), comparable: true, label }

  const cohort = await collectAppleCohort(prev)
  if (!cohort.available || !cohort.keys.size) {
    // The ledger could not answer for the previous window while it answered for
    // this one. Rather than compare a confirmation count with an intake count —
    // which reads as a trend and is not one — the deltas are marked
    // incomparable and the mail says so instead of drawing an arrow.
    return { lines: cohort.available ? [] : await filed(), comparable: cohort.available, label }
  }

  const refs = Array.from(cohort.keys)
  const rows = await prisma.booking.findMany({
    where: { OR: [{ bookingRef: { in: refs } }, { bookingRef: { in: refs.map(spacedRef) } }] },
    select: BOOKING_SELECT,
  })

  const held = new Map<string, BookingLine>()
  for (const line of rows.map(toLine)) {
    const key = cohortKey(line.bookingRef)
    if (key && cohort.keys.has(key) && !held.has(key)) held.set(key, line)
  }

  return {
    lines: Array.from(held.values()).filter(l => inSelectedCountries(l.country, countries)),
    comparable: true,
    label,
  }
}

/** "VN41054" as this system usually stores it — "VN 41054". */
function spacedRef(key: string): string {
  const m = /^([A-Z]+)(\d.*)$/.exec(key)
  return m ? `${m[1]} ${m[2]}` : key
}

// ─── What operations actually delivered ───────────────────────────────────────

async function collectDelivery(
  window: ReportWindow,
  countries: string[],
): Promise<DeliverySection> {
  const empty: DeliverySection = {
    available: false, toursOperated: 0, arrivals: 0, departures: 0, pax: 0, guestDays: 0,
    avgPartySize: null, avgTourNights: null, hotelOnly: 0, byCountry: [],
    channel: { b2b: 0, b2c: 0 }, previousArrivals: 0, byDate: [], lines: [],
  }

  try {
    const prev = previousWindow(window)
    const [rows, previousArrivals] = await Promise.all([
      // Overlap, not containment: a fortnight's tour that straddles the whole
      // week never starts or ends inside it, and a report that only counted
      // arrivals would say that week carried nobody.
      prisma.booking.findMany({
        where: {
          arrivalDate: { lt: window.end },
          departureDate: { gte: window.start },
          status: { notIn: [...DEAD_STATUSES] },
          ...(countryWhere(countries) ?? {}),
        },
        select: BOOKING_SELECT,
      }),
      prisma.booking.count({
        where: {
          arrivalDate: { gte: prev.start, lt: prev.end },
          status: { notIn: [...DEAD_STATUSES] },
          ...(countryWhere(countries) ?? {}),
        },
      }),
    ])

    const lines = rows.map(toLine).filter(l => inSelectedCountries(l.country, countries))

    let guestDays = 0
    const operated: OperatedLine[] = []
    for (const l of lines) {
      // Only the part of the tour that fell inside the window is this period's
      // work — the rest belongs to the report either side of it.
      const from = l.arrivalDate > window.fromDate ? l.arrivalDate : window.fromDate
      const to = l.departureDate < window.toDate ? l.departureDate : window.toDate
      const days = Math.max(0, daysBetween(from, to) + 1)
      guestDays += days * l.pax
      operated.push({
        ...l,
        daysInPeriod: days,
        guestDaysInPeriod: days * l.pax,
        straddles: l.arrivalDate < window.fromDate || l.departureDate > window.toDate,
      })
    }
    operated.sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate) || a.bookingRef.localeCompare(b.bookingRef))

    const perDate = new Map<string, { date: string; arrivals: number; departures: number }>()
    const touch = (date: string) => {
      const e = perDate.get(date) ?? { date, arrivals: 0, departures: 0 }
      perDate.set(date, e)
      return e
    }
    for (const l of lines) {
      if (l.arrivalDate >= window.fromDate && l.arrivalDate <= window.toDate) touch(l.arrivalDate).arrivals += 1
      if (l.departureDate >= window.fromDate && l.departureDate <= window.toDate) touch(l.departureDate).departures += 1
    }

    const nights = lines
      .map(l => daysBetween(l.arrivalDate, l.departureDate))
      .filter(n => n >= 0 && n < 400)

    return {
      available: true,
      toursOperated: lines.length,
      arrivals: lines.filter(l => l.arrivalDate >= window.fromDate && l.arrivalDate <= window.toDate).length,
      departures: lines.filter(l => l.departureDate >= window.fromDate && l.departureDate <= window.toDate).length,
      pax: lines.reduce((s, l) => s + l.pax, 0),
      guestDays,
      avgPartySize: lines.length ? Math.round((lines.reduce((s, l) => s + l.pax, 0) / lines.length) * 10) / 10 : null,
      avgTourNights: avg(nights),
      hotelOnly: lines.filter(l => l.hotelOnly).length,
      byCountry: rollUpByCountry(lines),
      channel: channelSplit(lines),
      previousArrivals,
      byDate: Array.from(perDate.values()).sort((a, b) => a.date.localeCompare(b.date)),
      lines: operated,
    }
  } catch (err) {
    console.warn('[Reports] delivery block failed:', err instanceof Error ? err.message : err)
    return empty
  }
}

// ─── Attrition ────────────────────────────────────────────────────────────────

async function collectCancellations(
  window: ReportWindow,
  countries: string[],
  confirmed: number,
): Promise<CancellationSection> {
  const empty: CancellationSection = {
    available: false, total: 0, pax: 0, previousTotal: 0, ratePct: null,
    byCurrency: [], feesByCurrency: [], shortNotice: 0,
    byCountry: [], byAgent: [], topReasons: [], lines: [],
  }

  try {
    const prev = previousWindow(window)
    const [rows, previousTotal] = await Promise.all([
      prisma.booking.findMany({
        where: { cancelledAt: { gte: window.start, lt: window.end }, ...(countryWhere(countries) ?? {}) },
        select: {
          ...BOOKING_SELECT,
          cancelledAt: true,
          cancelledByName: true,
          cancellationReason: true,
          cancellationFeeTotal: true,
        },
        orderBy: { cancelledAt: 'desc' },
      }),
      prisma.booking.count({
        where: { cancelledAt: { gte: prev.start, lt: prev.end }, ...(countryWhere(countries) ?? {}) },
      }),
    ])

    const lines: CancellationLine[] = rows
      .map(r => {
        const line = toLine(r)
        const cancelledOn = isoDate(r.cancelledAt)
        return {
          ...line,
          cancelledAt: r.cancelledAt?.toISOString() ?? '',
          cancelledBy: r.cancelledByName,
          reason: r.cancellationReason?.trim() || null,
          feeTotal: toNumber(r.cancellationFeeTotal),
          noticeDays: cancelledOn && line.arrivalDate ? daysBetween(cancelledOn, line.arrivalDate) : null,
        }
      })
      .filter(l => inSelectedCountries(l.country, countries))

    // First line of the recorded reason, normalised — enough to group by, and
    // the workbook carries every word of it for anyone who wants the rest.
    const reasonCount = new Map<string, number>()
    for (const l of lines) {
      const key = (l.reason ?? '').split('\n')[0].trim().slice(0, 60) || 'No reason recorded'
      reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1)
    }

    const fees = lines
      .filter(l => l.feeTotal !== null && l.feeTotal !== 0)
      .map(l => ({ currency: l.currency, quotedTotal: l.feeTotal }))

    return {
      available: true,
      total: lines.length,
      pax: lines.reduce((s, l) => s + l.pax, 0),
      previousTotal,
      // Against the period's own confirmations: "we lost 4 of the 92 we took"
      // is a rate somebody can act on; 4 on its own is not.
      ratePct: pct(lines.length, confirmed + lines.length),
      byCurrency: sumByCurrency(lines),
      feesByCurrency: sumByCurrency(fees),
      shortNotice: lines.filter(l => l.noticeDays !== null && l.noticeDays <= 7).length,
      byCountry: rollUpByCountry(lines),
      byAgent: groupByAgent(lines, l => l.agent, l => l.pax).slice(0, 10),
      topReasons: Array.from(reasonCount.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
        .slice(0, 8),
      lines,
    }
  } catch (err) {
    console.warn('[Reports] cancellation block failed:', err instanceof Error ? err.message : err)
    return empty
  }
}

/** The previous period's complaint count, for the direction of service quality. */
async function previousComplaintCount(window: ReportWindow): Promise<number | null> {
  const prev = previousWindow(window)
  try {
    return await prisma.tbl_te_important_alerts.count({
      where: { created_at: { gte: prev.start, lt: prev.end } },
    })
  } catch {
    // The TE stack is not deployed everywhere. No number is not zero, and the
    // mail says "not comparable" rather than inventing an improvement.
    return null
  }
}

// ─── The action list ──────────────────────────────────────────────────────────

/**
 * What the period says somebody should do next.
 *
 * Deliberately rule-based rather than written by the model: these are the lines
 * a manager acts on, so each one has to be reproducible, defensible and tied to
 * a number printed elsewhere in the same mail. The AI paragraph explains; this
 * decides.
 *
 * Ordered by severity, then by size, and capped — a list of twenty actions is a
 * list of none.
 */
function deriveActions(
  i: Omit<PeriodInsights, 'actions'>,
  window: ReportWindow,
): PeriodAction[] {
  const out: PeriodAction[] = []
  const periodWord = window.period === 'MONTHLY' ? 'month' : 'week'

  if (i.integrity.parityMissing > 0) {
    out.push({
      severity: 'critical',
      title: `${i.integrity.parityMissing} AppleSystem confirmation${i.integrity.parityMissing === 1 ? '' : 's'} never reached this system`,
      detail: 'Until these are filed, every other figure in this report understates the period. The references are listed in the workbook.',
      sheet: 'AS Parity',
    })
  }

  if (i.integrity.countCheckAvailable && i.integrity.countCheckShort > 0) {
    out.push({
      severity: 'critical',
      title: `Count check is short by ${i.integrity.countCheckShort} across the ${periodWord}`,
      detail: 'Confirmed upstream but missing a booking, a P&L or an invoice — revenue that is operationally live and financially invisible.',
      sheet: 'Count Check',
    })
  }

  if (i.quality.unexplainedBreaches > 0) {
    out.push({
      severity: 'warning',
      title: `${i.quality.unexplainedBreaches} guest${i.quality.unexplainedBreaches === 1 ? '' : 's'} past the D-10 deadline with no reason recorded`,
      detail: 'Nobody has said why. Each one is a guest travelling soon who has not been spoken to, and the desk cannot plan around a blank.',
      sheet: 'Reconfirmation',
    })
  }

  if (i.cancellations.available && i.cancellations.total > 0) {
    const worse = i.cancellations.total > i.cancellations.previousTotal
    const rate = i.cancellations.ratePct
    if (i.cancellations.shortNotice > 0 || (rate !== null && rate >= 5) || worse) {
      out.push({
        severity: rate !== null && rate >= 10 ? 'warning' : 'watch',
        title: `${i.cancellations.total} cancellation${i.cancellations.total === 1 ? '' : 's'}${rate !== null ? ` — ${rate}% of the ${periodWord}'s book` : ''}`,
        detail: `${i.cancellations.shortNotice} came in with a week or less to arrival${
          i.cancellations.previousTotal ? `, against ${i.cancellations.previousTotal} last ${periodWord}` : ''
        }. The reasons are grouped in the workbook.`,
        sheet: 'Cancellations',
      })
    }
  }

  const lostAgents = i.agentMovers.filter(a => a.isLost)
  if (lostAgents.length) {
    const top = lostAgents.slice(0, 3).map(a => a.label).join(', ')
    out.push({
      severity: 'watch',
      title: `${lostAgents.length} partner${lostAgents.length === 1 ? '' : 's'} booked nothing this ${periodWord}`,
      detail: `${top}${lostAgents.length > 3 ? ` and ${lostAgents.length - 3} more` : ''} were buying last ${periodWord} and are silent now — worth a call before it becomes a quarter.`,
      sheet: 'Agents',
    })
  }

  const slippingMarkets = i.countryMovers.filter(c => c.previous >= 5 && c.pct !== null && c.pct <= -25)
  for (const m of slippingMarkets.slice(0, 2)) {
    out.push({
      severity: 'watch',
      title: `${m.label} down ${Math.abs(m.pct ?? 0)}% (${m.previous} → ${m.current})`,
      detail: `The steepest market fall of the ${periodWord}. Nothing here says why — it is the question to take into the market review.`,
      sheet: 'Countries',
    })
  }

  if (i.quality.per100Tours !== null && i.quality.complaints > 0) {
    const worse = i.quality.previousComplaints !== null && i.quality.complaints > i.quality.previousComplaints
    out.push({
      severity: worse ? 'warning' : 'watch',
      title: `${i.quality.complaints} complaint${i.quality.complaints === 1 ? '' : 's'} — ${i.quality.per100Tours} per 100 tours operated`,
      detail: i.quality.previousComplaints === null
        ? 'No comparable figure for the previous period.'
        : `Last ${periodWord}: ${i.quality.previousComplaints}. ${i.quality.recurringOpen} open issue${i.quality.recurringOpen === 1 ? ' has' : 's have'} been raised more than once.`,
      sheet: 'Complaints',
    })
  }

  if (i.quality.readinessPct !== null && i.quality.readinessPct < 80) {
    out.push({
      severity: 'warning',
      title: `Only ${i.quality.readinessPct}% of the next three days' arrivals are ready`,
      detail: 'This is the one forward-looking number in a backward-looking report — it is next week\'s problem, visible today.',
      sheet: 'Arrivals 3 Days',
    })
  }

  const newAgents = i.newAgents.length
  if (newAgents) {
    out.push({
      severity: 'good',
      title: `${newAgents} partner${newAgents === 1 ? '' : 's'} bought for the first time this ${periodWord}`,
      detail: `${i.newAgents.slice(0, 4).join(', ')}${newAgents > 4 ? ` and ${newAgents - 4} more` : ''} — worth confirming the first file went well.`,
      sheet: 'Agents',
    })
  }

  const rank = { critical: 0, warning: 1, watch: 2, good: 3 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 8)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function collectPeriodInsights(opts: PeriodInsightOptions): Promise<PeriodInsights> {
  const { window, countries, counted, basis, complaints } = opts

  const [previous, delivery, cancellations, previousComplaints] = await Promise.all([
    collectPrevious(window, countries, basis),
    collectDelivery(window, countries),
    collectCancellations(window, countries, counted.length),
    previousComplaintCount(window),
  ])

  // ---- Trend series ----
  // A week is read day by day; a month day by day would be thirty-one bars
  // nobody can compare, so it is read week by week. Both are built from the same
  // day buckets, which is what keeps the two reports' totals identical.
  const days = dateRange(window.fromDate, window.toDate)
  const dayBuckets = new Map<string, PeriodPoint>()
  for (const date of days) {
    dayBuckets.set(date, {
      key: date,
      label: formatReportDate(date, { weekday: true }).replace(/,? \d{4}$/, ''),
      bookings: 0, pax: 0, arrivals: 0, departures: 0,
    })
  }

  for (const l of counted) {
    const bucket = dayBuckets.get(localDay(l.createdAt, window.timezone))
    if (!bucket) continue
    bucket.bookings += 1
    bucket.pax += l.pax
  }

  const granularity: 'day' | 'week' = window.period === 'MONTHLY' ? 'week' : 'day'
  let series: PeriodPoint[] = Array.from(dayBuckets.values())

  if (granularity === 'week') {
    const weeks = new Map<string, PeriodPoint>()
    for (const point of series) {
      // Bucketed by the Monday of the containing week, clamped to the window so
      // the first and last bars describe the days the month actually holds.
      const dow = (new Date(`${point.key}T00:00:00Z`).getUTCDay() + 6) % 7
      const monday = shiftDate(point.key, -dow)
      const key = monday < window.fromDate ? window.fromDate : monday
      const entry = weeks.get(key) ?? {
        key,
        label: '',
        bookings: 0, pax: 0, arrivals: 0, departures: 0,
      }
      entry.bookings += point.bookings
      entry.pax += point.pax
      weeks.set(key, entry)
    }
    series = Array.from(weeks.values()).sort((a, b) => a.key.localeCompare(b.key))
    series.forEach((w, idx) => {
      const end = idx + 1 < series.length ? shiftDate(series[idx + 1].key, -1) : window.toDate
      w.label = `${formatReportDate(w.key).slice(0, 6)} – ${formatReportDate(end).slice(0, 6)}`
    })
  }

  // Arrivals and departures land on the same buckets, so the trend can show
  // intake and operation on one axis: the week you sell is not the week you fly.
  const bucketFor = (date: string): PeriodPoint | undefined => {
    if (granularity === 'day') return dayBuckets.get(date)
    let found: PeriodPoint | undefined
    for (const point of series) {
      if (point.key <= date) found = point
      else break
    }
    return found
  }
  for (const day of delivery.byDate) {
    const bucket = bucketFor(day.date)
    if (!bucket) continue
    bucket.arrivals += day.arrivals
    bucket.departures += day.departures
  }

  // ---- Totals and movement ----
  const prevLines = previous.lines
  const byCountryMap = (lines: BookingLine[]) => {
    const m = new Map<string, { label: string; count: number; pax: number }>()
    for (const l of lines) {
      const e = m.get(l.country) ?? { label: labelFor(l.country), count: 0, pax: 0 }
      e.count += 1
      e.pax += l.pax
      m.set(l.country, e)
    }
    return m
  }
  const byAgentMap = (lines: BookingLine[]) => {
    const m = new Map<string, { label: string; count: number; pax: number }>()
    for (const group of groupByAgent(lines, l => l.agent, l => l.pax)) {
      m.set(agentKey(group.agent), { label: group.agent, count: group.bookings, pax: group.pax })
    }
    return m
  }

  const countryMovers = movers(byCountryMap(counted), byCountryMap(prevLines))
  const agentMovers = movers(byAgentMap(counted), byAgentMap(prevLines))

  const topThree = agentMovers.slice(0, 3).reduce((s, a) => s + a.current, 0)

  // ---- Lead time ----
  const leadDays = counted
    .map(l => daysBetween(localDay(l.createdAt, window.timezone), l.arrivalDate))
    .filter(d => d >= 0 && d < 800)
  const prevLeadDays = prevLines
    .map(l => daysBetween(localDay(l.createdAt, window.timezone), l.arrivalDate))
    .filter(d => d >= 0 && d < 800)

  const pax = counted.reduce((s, l) => s + l.pax, 0)
  const prevPax = prevLines.reduce((s, l) => s + l.pax, 0)

  const activeDays = days.length || 1
  const prevRange = previousWindow(window)
  const prevActiveDays = Math.max(1, daysBetween(prevRange.fromDate, prevRange.toDate) + 1)

  const base: Omit<PeriodInsights, 'actions'> = {
    basis,
    comparable: previous.comparable,
    previousLabel: previous.label,
    granularity,
    series,
    busiest: series.length ? series.reduce((a, b) => (b.bookings > a.bookings ? b : a)) : null,
    quietest: series.length ? series.reduce((a, b) => (b.bookings < a.bookings ? b : a)) : null,
    runRate: {
      current: Math.round((counted.length / activeDays) * 10) / 10,
      previous: previous.comparable ? Math.round((prevLines.length / prevActiveDays) * 10) / 10 : null,
    },
    totals: {
      bookings: counted.length,
      previousBookings: prevLines.length,
      pax,
      previousPax: prevPax,
      channel: channelSplit(counted),
      previousChannel: channelSplit(prevLines),
      byCurrency: sumByCurrency(counted),
      previousByCurrency: sumByCurrency(prevLines),
      avgBookingValue: sumByCurrency(counted).map(c => {
        const n = counted.filter(l => l.currency === c.currency && l.quotedTotal !== null).length
        return { currency: c.currency, total: n ? Math.round((c.total / n) * 100) / 100 : 0 }
      }),
      avgPartySize: counted.length ? Math.round((pax / counted.length) * 10) / 10 : null,
      previousAvgPartySize: prevLines.length ? Math.round((prevPax / prevLines.length) * 10) / 10 : null,
    },
    countryMovers,
    agentMovers,
    newAgents: agentMovers.filter(a => a.isNew).map(a => a.label).slice(0, 12),
    lapsedAgents: agentMovers.filter(a => a.isLost).map(a => a.label).slice(0, 12),
    agentConcentrationPct: pct(topThree, counted.length),
    leadTime: {
      measured: leadDays.length,
      avgDays: avg(leadDays),
      medianDays: median(leadDays),
      within7: leadDays.filter(d => d <= 7).length,
      within30: leadDays.filter(d => d <= 30).length,
      beyond90: leadDays.filter(d => d > 90).length,
      previousAvgDays: previous.comparable ? avg(prevLeadDays) : null,
    },
    delivery,
    cancellations,
    quality: {
      complaints: complaints.total,
      previousComplaints,
      per100Tours: delivery.toursOperated
        ? Math.round((complaints.total / delivery.toursOperated) * 1000) / 10
        : null,
      resolvedPct: pct(complaints.resolved, complaints.total),
      avgResolutionHours: complaints.avgResolutionHours,
      recurringOpen: complaints.recurringOpen,
      highSeverityOpen: complaints.highSeverityOpen,
      reconfirmCompliancePct: null,
      unexplainedBreaches: 0,
      readinessPct: null,
    },
    integrity: {
      parityMissing: 0,
      paritySource: 'none',
      countCheckShort: 0,
      countCheckAvailable: false,
      unswept: false,
      automationCreated: 0,
      automationCancelled: 0,
      automationFlagged: 0,
      automationErrors: 0,
    },
  }

  return { ...base, actions: [] }
}

/**
 * Fill in the figures that live on other sections, then derive the actions.
 *
 * Split from the collector because parity, the count check, readiness and the
 * D-10 standing are all computed by `collectReportData` in parallel with this
 * one — asking for them again here would double four queries to restate numbers
 * the report already holds.
 */
export function finaliseInsights(
  insights: PeriodInsights,
  d: {
    window: ReportWindow
    parity: { available: boolean; source: 'live' | 'ledger' | 'none'; missing: number; createdByAutomation: number; cancelled: number; flagged: number; errors: number }
    countCheck: { available: boolean; sweptAt: string | null; overall: { pnlShort: number; invoiceShort: number; bookingShort: number } }
    readiness: { total: number; ready: number }
    reconfirm: { total: number; breached: number; unexplained: number }
  },
): PeriodInsights {
  const filled: PeriodInsights = {
    ...insights,
    quality: {
      ...insights.quality,
      reconfirmCompliancePct: d.reconfirm.total
        ? Math.round(((d.reconfirm.total - d.reconfirm.breached) / d.reconfirm.total) * 1000) / 10
        : null,
      unexplainedBreaches: d.reconfirm.unexplained,
      readinessPct: d.readiness.total
        ? Math.round((d.readiness.ready / d.readiness.total) * 1000) / 10
        : null,
    },
    integrity: {
      parityMissing: d.parity.available ? d.parity.missing : 0,
      paritySource: d.parity.source,
      countCheckShort: d.countCheck.available
        ? d.countCheck.overall.pnlShort + d.countCheck.overall.invoiceShort + d.countCheck.overall.bookingShort
        : 0,
      countCheckAvailable: d.countCheck.available && d.countCheck.sweptAt !== null,
      unswept: d.countCheck.available && d.countCheck.sweptAt === null,
      automationCreated: d.parity.createdByAutomation,
      automationCancelled: d.parity.cancelled,
      automationFlagged: d.parity.flagged,
      automationErrors: d.parity.errors,
    },
  }

  return { ...filled, actions: deriveActions(filled, d.window) }
}
