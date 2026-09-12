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
import type { BookingSource } from '@/lib/booking-source'
import {
  BOOKING_SELECT, DEAD_STATUSES, UNASSIGNED, channelSplit, countryWhere, daysBetween,
  inSelectedCountries, isoDate, labelFor, resolveCountry, rollUpByCountry, sumByCurrency, toLine,
  type BookingLine, type ChannelSplit, type CountryRow, type MoneyByCurrency,
} from './booking-lines'
import { computeReadiness, type BookingReadiness } from '@/lib/booking-readiness'
import {
  RECONFIRM_DUE_DAYS, REASON_META, classifyReconfirm, loadReconfirmDelays,
  type ReconfirmDelay,
} from '@/lib/reconfirm-delay'
import { listByCreateDate } from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { getReconcileDays, type ReconcileDay } from '@/lib/as-reconcile'
import { collectCountCheck, type CountCheckSection } from './count-check'
import { collectActivitySplit, bookingKey, type ActivitySplit } from './activity-split'
import { resolveBookingOriginChannels, type OriginChannel } from '@/lib/booking-origin'
import { collectAppleCohort, cohortKey, type AppleCohort } from './apple-cohort'
import { groupByAgent } from './agent-names'
import { dedupeComplaints, type ComplaintOccurrence } from './complaint-dedupe'
import {
  buildReportWindow, previousWindow, zonedDayStart, shiftDate, dateInTz, formatReportDate,
  type ReportPeriod, type ReportWindow,
} from './report-window'
import { collectPeriodInsights, finaliseInsights, type PeriodInsights } from './period-insights'
import type { Prisma } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /**
   * How many raw alert rows this line stands for. The TE agent files one row
   * per call, so a guest repeating the same problem produces several; they are
   * merged into one line by `complaint-dedupe` and counted here rather than
   * printed again. `1` means it was raised once.
   */
  occurrences: number
  /** Most recent time this same issue came up again; equals `createdAt` at 1. */
  lastRaisedAt: string
  /** Every raw alert behind this line, oldest first. */
  trail: ComplaintOccurrence[]
  /** Categories the agent filed it under, when successive calls disagreed. */
  categories: string[]
}

/**
 * What the report counts as "created", and everything it deliberately does not.
 *
 * `total` and every figure beside it describe the bookings **AppleSystem
 * confirmed** in the window (see `apple-cohort.ts`) — not the bookings this
 * system happened to file that day. The two differ by a booking confirmed at
 * 23:50 and entered here after midnight, and by a booking entered here today
 * against a confirmation raised last week; counting the second as today's
 * intake is why this mail said 42 while the accounts mail's count check said
 * 38 for the same day.
 *
 * Nothing is hidden by the change: `outside` carries what this system filed in
 * the window against an earlier confirmation, `missingRefs` names the
 * confirmations it has not filed at all, and both are printed — uncounted — in
 * the mail and the CSV.
 */
export interface CreatedSection {
  total: number
  pax: number
  channel: ChannelSplit
  byCountry: CountryRow[]
  byCurrency: MoneyByCurrency[]
  byAgent: { agent: string; bookings: number; pax: number }[]
  bookings: BookingLine[]
  /**
   * Every counted booking, uncapped — what the CSV attachment writes.
   *
   * `bookings` is cut to `maxRows` because a mail nobody scrolls is worse than
   * a short one, but the attachment exists precisely so finance can pivot the
   * whole population: a day with 50 confirmations that exported 30 rows read as
   * a report contradicting itself.
   */
  allBookings: BookingLine[]
  /** Same metric over the immediately preceding window, for the trend arrow. */
  previousTotal: number

  /** How the population was decided. `ops` = the accounts ledger was unreadable. */
  basis: 'apple' | 'ops'
  /** Confirmations AppleSystem raised in the window, cancellations included. */
  upstream: number
  /** Of those, how many were withdrawn upstream. */
  cancelledUpstream: number
  /** Confirmed in the window, nothing filed here. The number to act on. */
  missingRefs: string[]
  /**
   * Filed here inside the window against a confirmation raised on an earlier
   * day. Real work, not this day's business — shown, never counted.
   */
  outside: BookingLine[]
  /** The same not-counted population, uncapped, for the CSV attachment. */
  allOutside: BookingLine[]
  /** ISO instant the accounts ledger last swept these dates; null = never. */
  sweptAt: string | null
}

/**
 * The day in the two passes the desk works it in, and where its own new
 * business came in from.
 *
 * ## Why the strip changed
 *
 * The ribbon used to lead with `Created` (this period's confirmations),
 * `AS parity` and the accounts `Count check`. Those three answered "is the
 * integration whole?", which is a question about plumbing; the answer to it now
 * lives on /sync-ledger and in the reconciliation mail, and it was crowding out
 * the two figures the desk actually opens the mail for.
 *
 * Both accounts mails for the same day now lead with this split, and so does
 * this one — read from the same rows, so three reports cannot describe one day
 * three ways. See `activity-split.ts`.
 *
 * ## The origin split
 *
 * `origins` breaks **Today new & updated** down by how each of those bookings
 * actually reached this system — the AppleSystem importer, a OneDrive drop, the
 * confirmation mailbox, a person typing it. The parts sum to `todayCount`;
 * bookings this system does not hold at all are the `missing` line, which is
 * the one to act on. See `resolveBookingOriginChannels()`.
 */
export interface ActivityOriginRow {
  channel: OriginChannel | 'MISSING'
  label: string
  bookings: number
}

export interface ActivitySplitSection {
  available: boolean
  error?: string
  /** Bookings whose ledger chain opened inside the window. One per booking. */
  todayCount: number
  /** Revisions raised in the window against a booking opened before it. */
  oldCount: number
  /** Distinct bookings behind `oldCount`. */
  oldBookings: number
  /** The oldest confirmation re-opened, in days. */
  oldest: number | null
  /** The confirmations AppleSystem raised — what the two are checked against. */
  appleCount: number
  /** `todayCount`, split by how the booking reached this system. Sums to it. */
  origins: ActivityOriginRow[]
  /** Of `todayCount`, how many this system holds a booking for. */
  held: number
  /** Booking key → which table it belongs to, for marking the detail rows. */
  index: Record<string, 'today' | 'old'>
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
  /** Distinct issues in the window — repeats of one issue count once. */
  total: number
  /** Raw alert rows before merging; `total` plus `duplicatesMerged`. */
  rawTotal: number
  /** Repeat rows folded into an existing issue, so the numbers reconcile. */
  duplicatesMerged: number
  resolved: number
  open: number
  highSeverityOpen: number
  /** Still open *and* raised more than once — the ones that keep coming back. */
  recurringOpen: number
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

/** One imminent arrival, with its operational checklist resolved. */
export interface ReadinessLine extends BookingLine {
  leadPassenger: string | null
  /** Whole days from the report date to arrival — 1 = tomorrow. */
  daysToArrival: number
  readiness: BookingReadiness
  /**
   * The recorded reason this booking's guest reconfirmation is late, when its
   * D-10 deadline has passed and someone has explained it.
   *
   * A tour arriving in three days that is still unconfirmed is by definition
   * seven days past D-10, so the explanation belongs on the chase list too —
   * without it, the desk re-discovers the same blocker every morning of the
   * final week. Null on a booking that is either confirmed or unexplained.
   */
  delay: ReconfirmDelay | null
}

export interface ReadinessDay {
  date: string
  /** "Tomorrow", "Fri 07 Aug 2026". */
  label: string
  bookings: number
  pax: number
  ready: number
  notReady: number
}

export interface ReadinessSection {
  /** First and last local date covered — tomorrow through tomorrow + 2. */
  fromDate: string
  toDate: string
  total: number
  pax: number
  /** Arriving tomorrow, the subset ops acts on first. */
  tomorrow: number
  tomorrowNotReady: number
  ready: number
  notReady: number
  /** Counts of bookings with each check still outstanding. */
  pendingClient: number
  pendingDriver: number
  pendingTickets: number
  pendingQc: number
  /**
   * Arrivals that are Hotel Only. They are counted in `ready` because nothing is
   * outstanding on them, so the mail states the number separately — a morning
   * that looks 100% ready reads differently when four of the six arrivals are
   * room-only files with no operation to prepare.
   */
  hotelOnly: number
  byDay: ReadinessDay[]
  byCountry: CountryRow[]
  /** Arrivals split by trade channel — the two are worked by different desks. */
  channel: ChannelSplit
  /** Not-ready first, soonest first — the work list. */
  bookings: ReadinessLine[]
  /**
   * Every tour landing tomorrow that is still not ready, so the mail can spell
   * out what is missing on each one. Kept separate from `bookings` because that
   * list is capped for message size and would otherwise hide the arrivals the
   * desk has one day left to fix.
   */
  tomorrowOutstanding: ReadinessLine[]
}

/** One booking that has blown its D-10 guest reconfirmation deadline. */
export interface ReconfirmLine extends BookingLine {
  leadPassenger: string | null
  /** Whole days from the report date to arrival. */
  daysToArrival: number
  /** `yyyy-mm-dd` the D-10 deadline fell on. */
  dueAt: string
  /** Whole days past that deadline. Always ≥ 1 on a line in this section. */
  daysLate: number
  clientConfirmed: boolean
  preTourCalled: boolean
  /**
   * The reason the desk recorded on the booking page, or null when nobody has
   * said. Null is the finding, not a gap in the data — see `reconfirm-delay.ts`.
   */
  delay: ReconfirmDelay | null
}

/**
 * The D-10 guest reconfirmation deadline across everything about to travel.
 *
 * Distinct from `readiness`, which looks three days out and asks whether a tour
 * can *run*. This looks ten days out and asks whether the guest has been
 * *spoken to* — a slower, earlier failure that the three-day window catches far
 * too late to fix politely.
 */
export interface ReconfirmSection {
  /** First and last arrival date covered — today through today + D-10. */
  fromDate: string
  toDate: string
  /** Bookings arriving inside the window at all. */
  total: number
  /** Past the deadline with the guest still unreconfirmed. */
  breached: number
  /** Breaches with a recorded reason. */
  explained: number
  /** Breaches nobody has explained — the number this section exists for. */
  unexplained: number
  /** Explained, but by an answer nobody has refreshed in days. */
  stale: number
  /** Breach counts per recorded reason, biggest first. Excludes the unexplained. */
  byReason: { reason: string; label: string; owner: string; count: number }[]
  byCountry: CountryRow[]
  channel: ChannelSplit
  /** Unexplained first, then most overdue — the order the desk works. */
  bookings: ReconfirmLine[]
}

/** One AppleSystem confirmation the reconciler could not get into the system. */
export interface ParityGap {
  ref: string
  /** `yyyy-mm-dd` the quotation was confirmed on, upstream. */
  date: string
}

/** One booking withdrawn upstream and cancelled here by the reconciler. */
export interface ParityCancellation {
  ref: string
  at: string
  /** The workflow status the booking held before it was cancelled. */
  prevStatus: string
  /** The AppleSystem status it moved to, which is why it was cancelled. */
  upstreamStatus: string
}

/**
 * **AppleSystem parity** — the two numbers that must be equal, and what the
 * automation did to make them so.
 *
 * The whole point of the section is the pair `upstreamConfirmed` /
 * `systemHeld`. Every other figure exists to explain a gap between them or to
 * evidence that there was none.
 *
 * `source` says where the pair came from. `live` means the report asked
 * AppleSystem itself while it was being written, which is the authoritative
 * answer; `ledger` means AppleSystem could not be reached and the numbers are
 * the last ones the 15-minute reconciler recorded. The difference matters to
 * anyone reading a mismatch, so it is stated in the mail rather than hidden.
 */
export interface ParitySection {
  /** False when the reconciler has never run for this window and upstream was unreachable. */
  available: boolean
  source: 'live' | 'ledger' | 'none'
  /** Confirmations AppleSystem created in the window. */
  upstreamConfirmed: number
  /** How many of those this system holds. Equal to the above, or something is wrong. */
  systemHeld: number
  /** `upstreamConfirmed - systemHeld`. Zero on a healthy day. */
  missing: number
  /** True when the two counts agree. The headline of the section. */
  inParity: boolean
  gaps: ParityGap[]

  /** What the reconciler did over the window. */
  createdByAutomation: number
  refreshed: number
  cancelled: number
  /** Withdrawn upstream but deliberately left for a person (tour already running). */
  flagged: number
  errors: number
  runs: number
  /** ISO instant of the most recent reconciliation covering the window. */
  lastRunAt: string | null
  cancellations: ParityCancellation[]
  /** Per-day pairs, so a multi-day report shows which day broke parity. */
  byDate: { date: string; upstreamConfirmed: number; systemHeld: number; missing: number }[]
  /** Set when the live check failed — explains why `source` fell back to the ledger. */
  note: string | null
}

export interface ReportData {
  window: ReportWindow
  generatedAt: string
  countries: string[]
  created: CreatedSection
  /** The two-pass split all three daily mails lead with. See above. */
  split: ActivitySplitSection
  /** AppleSystem ↔ this system confirmation parity. Never scoped by country. */
  parity: ParitySection
  /**
   * The four-way count check both daily mails lead with — upstream, OPS, P&L,
   * invoice — read from the accounts Sync Ledger so this report and the accounts
   * report can never quote different figures for the same day. Never scoped by
   * country, for the same reason parity is not.
   */
  countCheck: CountCheckSection
  onGround: OnGroundSection
  readiness: ReadinessSection
  reconfirm: ReconfirmSection
  complaints: ComplaintsSection
  upcoming: UpcomingSection
  /**
   * Period analytics — trends, movers, delivery, attrition and the derived
   * action list the weekly and monthly mails are built from.
   *
   * Null on a daily report. A day is not a trend: the daily mail is a work list
   * for the morning it lands, and computing week-shaped analytics for it would
   * cost four extra queries every night to render nothing.
   */
  insights: PeriodInsights | null
}

export interface CollectOptions {
  period: ReportPeriod
  timezone: string
  /** Empty = every country, including unassigned. */
  countries?: string[]
  now?: Date
  /**
   * `yyyy-mm-dd` inside the period to report on — back-dates the whole report.
   * Omitted for scheduled sends, which always report the period just closed.
   */
  anchorDate?: string | null
  /** Cap on the per-section detail tables. */
  maxRows?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Cap on rows per detail table. Kept modest so a busy day's email stays under
 * Gmail's ~102 KB clipping threshold — the attachment and the dashboard carry
 * every row, the email carries the readable summary.
 */
const DEFAULT_MAX_ROWS = 30

/**
 * How far ahead the readiness section looks: tomorrow plus the two days after
 * it. Three days is the window in which an unallocated driver or an unissued
 * ticket can still be fixed without scrambling.
 */
const READINESS_DAYS = 3

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

// ─── Sections ─────────────────────────────────────────────────────────────────

async function collectCreated(
  w: ReportWindow,
  countries: string[],
  maxRows: number,
  cohort: AppleCohort,
): Promise<CreatedSection> {
  const scope = countryWhere(countries)
  const prev = previousWindow(w)

  // Everything the window could possibly be about: bookings filed here inside
  // it, plus the bookings AppleSystem confirmed inside it however late they
  // were filed. One query for both — a confirmation entered here the next
  // morning is not missing, and a report that called it missing sent somebody
  // looking for a booking that was already on the board.
  const refs = cohort.available ? Array.from(cohort.keys) : []

  const [rows, cohortRows, prevRows] = await Promise.all([
    prisma.booking.findMany({
      where: { createdAt: { gte: w.start, lt: w.end }, ...(scope ?? {}) },
      select: BOOKING_SELECT,
      orderBy: { createdAt: 'desc' },
    }),
    refs.length
      ? prisma.booking.findMany({
          // The ledger's key has no spacing; this system stores the reference
          // as it was written, so both spellings are asked for and the match
          // itself is made on the normalised key below.
          where: { OR: [{ bookingRef: { in: refs } }, { bookingRef: { in: refs.map(spacedRef) } }] },
          select: BOOKING_SELECT,
          orderBy: { createdAt: 'desc' },
        })
      : Promise.resolve([]),
    // Counted, not aggregated — but still resolved country-by-country so the
    // trend arrow compares like with like once legacy SG/MY rows are split.
    prisma.booking.findMany({
      where: { createdAt: { gte: prev.start, lt: prev.end }, ...(scope ?? {}) },
      select: { operationCountry: true, bookingRef: true, tourDestination: true },
    }),
  ])

  // The previous window on the same basis as this one, or the arrow compares a
  // confirmation count against an intake count and invents a trend.
  const previousTotal = cohort.available
    ? await previousCohortTotal(prev, countries)
    : prevRows.filter(r =>
        inSelectedCountries(resolveCountry(r.operationCountry, r.bookingRef, r.tourDestination), countries)).length

  const filed = rows.map(toLine).filter(l => inSelectedCountries(l.country, countries))

  // ---- Cut to the day's confirmations ----
  // Without a readable ledger there is no cohort to cut to, and the section
  // falls back to this system's own intake exactly as it behaved before.
  let lines = filed
  let outside: BookingLine[] = []
  let missingRefs: string[] = []

  if (cohort.available) {
    const held = new Map<string, BookingLine>()

    for (const line of [...filed, ...cohortRows.map(toLine)]) {
      const key = cohortKey(line.bookingRef)
      if (key && cohort.keys.has(key) && !held.has(key)) held.set(key, line)
    }

    // A country filter is a filter on this report, not on the ledger: a
    // confirmation for a country nobody asked about is neither counted nor
    // reported missing.
    lines = Array.from(held.values())
      .filter(l => inSelectedCountries(l.country, countries))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

    outside = filed.filter(l => {
      const key = cohortKey(l.bookingRef)
      return !key || !cohort.keys.has(key)
    })

    missingRefs = cohort.entries
      .filter(e => !e.cancelled && !held.has(e.key))
      .map(e => e.ref)
  }

  // Spelling variants of one partner ("MMT" / "Make My Trip") are merged here.
  const byAgent = groupByAgent(lines, l => l.agent, l => l.pax)

  return {
    total: lines.length,
    pax: lines.reduce((s, l) => s + l.pax, 0),
    channel: channelSplit(lines),
    byCountry: rollUpByCountry(lines),
    byCurrency: sumByCurrency(lines),
    byAgent: byAgent.slice(0, 10),
    bookings: lines.slice(0, maxRows),
    allBookings: lines,
    previousTotal,
    basis: cohort.available ? 'apple' : 'ops',
    upstream: cohort.total,
    cancelledUpstream: cohort.cancelled,
    missingRefs: missingRefs.slice(0, 40),
    outside: outside.slice(0, maxRows),
    allOutside: outside,
    sweptAt: cohort.sweptAt,
  }
}

/** "VN41054" as this system usually stores it — "VN 41054". */
function spacedRef(key: string): string {
  const m = /^([A-Z]+)(\d.*)$/.exec(key)
  return m ? `${m[1]} ${m[2]}` : key
}

/**
 * The previous window's confirmation count, for the trend arrow only.
 *
 * Read straight off the ledger rather than by re-running the whole section: the
 * arrow needs one number, and the cheapest honest way to get it is to count the
 * same rows the cohort is built from. Country scoping is deliberately not
 * applied — the ledger holds no country, and an arrow is a direction, not a
 * figure anybody reconciles.
 */
async function previousCohortTotal(
  prev: { fromDate: string; toDate: string },
  _countries: string[],
): Promise<number> {
  const cohort = await collectAppleCohort(prev)
  return cohort.available ? cohort.total : 0
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
 * Tours arriving tomorrow and the two days after — each with its readiness
 * checklist (client confirmation, driver allocation, tickets, QC).
 *
 * Anchored to "today" like the on-ground section, not to the report window: a
 * daily mail read at 04:00 is used to chase what is about to land, and a list
 * that quietly meant "three days after yesterday" would drop a day of arrivals.
 *
 * The checklist itself is `computeReadiness()` — the same rules the booking QC
 * panel shows on screen, so the mail and the dashboard cannot disagree.
 */
async function collectReadiness(w: ReportWindow, countries: string[], maxRows: number): Promise<ReadinessSection> {
  const scope = countryWhere(countries)
  const fromDate = shiftDate(w.today, 1)
  const toDate = shiftDate(w.today, READINESS_DAYS)
  const start = zonedDayStart(fromDate, w.timezone)
  const end = zonedDayStart(shiftDate(toDate, 1), w.timezone)

  const rows = await prisma.booking.findMany({
    where: {
      arrivalDate: { gte: start, lt: end },
      status: { notIn: [...DEAD_STATUSES] },
      ...(scope ?? {}),
    },
    select: {
      ...BOOKING_SELECT,
      qcPassedAt: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      tourAgenda: {
        select: {
          items: {
            select: {
              serviceType: true,
              isLeisure: true,
              isHotelOnly: true,
              assignment: { select: { driverId: true, vendorId: true } },
            },
          },
        },
      },
      slDriverAllocation: { select: { driverId: true, vendorId: true, vehicleType: true } },
      tickets: { select: { activated: true, status: true } },
    },
    orderBy: { arrivalDate: 'asc' },
  })

  // Any arrival inside this three-day window is already well past its D-10
  // deadline, so a recorded reason is fetched for all of them in one query and
  // attached to the ones it is still true of.
  const delays = await loadReconfirmDelays(rows.map(r => r.bookingRef))

  const lines: ReadinessLine[] = rows
    .map(r => {
      const line = toLine(r)
      const readiness = computeReadiness({
        status: r.status,
        qcPassedAt: r.qcPassedAt,
        hotelOnly: r.hotelOnly,
        noTickets: r.noTickets,
        tourAgenda: r.tourAgenda,
        slDriverAllocation: r.slDriverAllocation,
        tickets: r.tickets,
      })
      // Only carried while the reconfirmation is genuinely still outstanding: an
      // explanation for a booking that has since been confirmed is history, and
      // printing it on the chase list would read as a live blocker.
      const stillOutstanding = !r.hotelOnly && readiness.client.state !== 'DONE'
      return {
        ...line,
        leadPassenger: r.passengers[0]?.name ?? null,
        daysToArrival: daysBetween(w.today, line.arrivalDate),
        readiness,
        delay: stillOutstanding ? delays.get(r.bookingRef) ?? null : null,
      }
    })
    .filter(l => inSelectedCountries(l.country, countries))

  const dayMap = new Map<string, ReadinessDay>()
  for (let i = 1; i <= READINESS_DAYS; i++) {
    const date = shiftDate(w.today, i)
    dayMap.set(date, {
      date,
      label: i === 1 ? 'Tomorrow' : formatReportDate(date, { weekday: true }),
      bookings: 0,
      pax: 0,
      ready: 0,
      notReady: 0,
    })
  }
  for (const l of lines) {
    const day = dayMap.get(l.arrivalDate)
    if (!day) continue
    day.bookings += 1
    day.pax += l.pax
    if (l.readiness.ready) day.ready += 1
    else day.notReady += 1
  }

  const tomorrow = lines.filter(l => l.arrivalDate === fromDate)
  const notReady = lines.filter(l => !l.readiness.ready)

  // Anything outstanding first, then by arrival — the order the desk works in.
  const byUrgency = (a: ReadinessLine, b: ReadinessLine) =>
    Number(a.readiness.ready) - Number(b.readiness.ready) ||
    a.arrivalDate.localeCompare(b.arrivalDate) ||
    a.bookingRef.localeCompare(b.bookingRef)

  // Eight columns a row makes the checklist the widest table in the mail, so it
  // is capped tighter than the rest to keep the message under Gmail's clip. The
  // cap is spent per channel rather than on one queue: B2C is a handful of
  // bookings against dozens of B2B, and a straight top-25 would drop every one
  // of them off a busy day's mail — the desk that works them would see nothing.
  const cap = Math.min(maxRows, 25)
  const ranked = lines.slice().sort(byUrgency)
  const b2c = ranked.filter(l => l.source === 'B2C')
  const b2b = ranked.filter(l => l.source === 'B2B')
  // Half the cap is held for B2C; whatever it does not use goes back to B2B.
  const b2cCount = Math.min(b2c.length, Math.max(Math.floor(cap / 2), cap - b2b.length))
  const b2bCount = Math.min(b2b.length, cap - b2cCount)
  const shown = [...b2c.slice(0, b2cCount), ...b2b.slice(0, b2bCount)].sort(byUrgency)

  return {
    fromDate,
    toDate,
    total: lines.length,
    pax: lines.reduce((s, l) => s + l.pax, 0),
    tomorrow: tomorrow.length,
    tomorrowNotReady: tomorrow.filter(l => !l.readiness.ready).length,
    ready: lines.length - notReady.length,
    notReady: notReady.length,
    pendingClient: lines.filter(l => l.readiness.outstanding.includes('client confirmation')).length,
    pendingDriver: lines.filter(l => l.readiness.outstanding.includes('driver allocation')).length,
    pendingTickets: lines.filter(l => l.readiness.outstanding.includes('tickets')).length,
    pendingQc: lines.filter(l => l.readiness.outstanding.includes('QC')).length,
    hotelOnly: lines.filter(l => l.hotelOnly).length,
    byDay: Array.from(dayMap.values()),
    byCountry: rollUpByCountry(lines),
    channel: channelSplit(lines),
    bookings: shown,
    tomorrowOutstanding: tomorrow
      .filter(l => !l.readiness.ready)
      .sort((a, b) =>
        b.readiness.blocking.length - a.readiness.blocking.length ||
        a.bookingRef.localeCompare(b.bookingRef)),
  }
}

/**
 * The D-10 guest reconfirmation deadline, and why it was missed.
 *
 * Scope is every booking arriving from the report date through the next ten
 * days: outside that window the deadline either has not arrived yet or the
 * guest has already travelled, and neither is worth a line in a morning mail.
 *
 * Two lookups sit behind it, both defensive in the same way the rest of this
 * file is. The TE pre-tour call table may be absent on an environment, and the
 * delay-reason table is new enough that it may not have been applied yet; either
 * missing degrades to "no call logged" / "no reason recorded", which are also
 * the honest answers when the tables are present and empty.
 *
 * Rows carry the recorded reason verbatim. The mail does not summarise or
 * re-word it: the whole point is that the desk's own sentence reaches the people
 * who would otherwise ask the same question again tomorrow.
 */
async function collectReconfirm(w: ReportWindow, countries: string[], maxRows: number): Promise<ReconfirmSection> {
  const scope = countryWhere(countries)
  const fromDate = w.today
  const toDate = shiftDate(w.today, RECONFIRM_DUE_DAYS)
  const start = zonedDayStart(fromDate, w.timezone)
  const end = zonedDayStart(shiftDate(toDate, 1), w.timezone)

  const rows = await prisma.booking.findMany({
    where: {
      arrivalDate: { gte: start, lt: end },
      status: { notIn: [...DEAD_STATUSES] },
      ...(scope ?? {}),
    },
    select: {
      ...BOOKING_SELECT,
      qcPassedAt: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
    },
    orderBy: { arrivalDate: 'asc' },
  })

  // Country is resolved on the built line, not the raw row — `toLine` is where
  // the legacy SG/MY bucket gets split, and filtering before that would keep
  // rows the rest of the report has already decided belong elsewhere.
  const inScope = rows
    .map(r => ({ raw: r, line: toLine(r) }))
    .filter(x => inSelectedCountries(x.line.country, countries))
  const refs = inScope.map(x => x.line.bookingRef)

  // Which of these have a written-up pre-tour call, and which carry a reason.
  const [calledRefs, delays] = await Promise.all([
    refs.length
      ? prisma.tbl_te_reconfirmation
          .findMany({ where: { booking_ref: { in: refs } }, select: { booking_ref: true } })
          .then(cs => new Set(cs.map(c => c.booking_ref)))
          .catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    loadReconfirmDelays(refs),
  ])

  const lines: ReconfirmLine[] = []
  for (const { raw: r, line } of inScope) {
    const clientConfirmed = computeReadiness({
      status: r.status,
      qcPassedAt: r.qcPassedAt,
      hotelOnly: r.hotelOnly,
    }).client.state === 'DONE'
    const preTourCalled = calledRefs.has(r.bookingRef)
    const standing = classifyReconfirm({
      arrivalDate: line.arrivalDate,
      today: w.today,
      clientConfirmed,
      preTourCalled,
      hotelOnly: r.hotelOnly,
    })
    // Only breaches make the list. A booking still inside its window is counted
    // in `total` and nowhere else — the section reports failures, not workload.
    if (!standing.breached) continue

    lines.push({
      ...line,
      leadPassenger: r.passengers[0]?.name ?? null,
      daysToArrival: standing.daysToArrival,
      dueAt: standing.dueAt,
      daysLate: Math.abs(standing.daysToDue),
      clientConfirmed,
      preTourCalled,
      delay: delays.get(r.bookingRef) ?? null,
    })
  }

  // Reasons, commonest first. Only the explained appear: "no reason" is not a
  // reason, and mixing it in would make the biggest bar on the chart a
  // non-answer. It is reported as its own number instead.
  const reasonCount = new Map<string, number>()
  for (const l of lines) {
    if (!l.delay) continue
    reasonCount.set(l.delay.reason, (reasonCount.get(l.delay.reason) ?? 0) + 1)
  }
  const byReason = Array.from(reasonCount.entries())
    .map(([reason, count]) => ({
      reason,
      label: REASON_META[reason as keyof typeof REASON_META]?.label ?? reason,
      owner: REASON_META[reason as keyof typeof REASON_META]?.owner ?? '',
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  // Unexplained first — those need a person before they need a plan — then the
  // most overdue, then a stable tiebreak so two runs never reorder the mail.
  const ranked = lines.slice().sort((a, b) =>
    Number(!!a.delay) - Number(!!b.delay) ||
    b.daysLate - a.daysLate ||
    a.bookingRef.localeCompare(b.bookingRef))

  return {
    fromDate,
    toDate,
    total: inScope.length,
    breached: lines.length,
    explained: lines.filter(l => l.delay).length,
    unexplained: lines.filter(l => !l.delay).length,
    stale: lines.filter(l => l.delay?.stale).length,
    byReason,
    byCountry: rollUpByCountry(lines),
    channel: channelSplit(lines),
    bookings: ranked.slice(0, maxRows),
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
    available: false, total: 0, rawTotal: 0, duplicatesMerged: 0, resolved: 0, open: 0,
    highSeverityOpen: 0, recurringOpen: 0,
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
      // Seeded as a single occurrence; `dedupeComplaints` rewrites these on any
      // line it merges into.
      occurrences: 1,
      lastRaisedAt: r.created_at.toISOString(),
      trail: [{
        id: String(r.id),
        createdAt: r.created_at.toISOString(),
        status: (r.status ?? 'open').toLowerCase(),
        severity,
        category: r.category?.trim() || 'general',
      }],
      categories: [r.category?.trim() || 'general'],
    }
  }

  const inScope = (c: ComplaintLine) => inSelectedCountries(c.country, countries)
  const scoped = raw.concat(carriedRaw).map(map).filter(inScope)

  // Window rows and carried-over rows are merged in one pass rather than
  // separately: a complaint opened last week and raised again today is one
  // issue, and de-duplicating the two lists in isolation would still print it
  // twice — once as carried debt, once as new. After merging, a cluster belongs
  // to the window if any of its occurrences landed inside it.
  const windowIds = new Set(raw.map(r => String(r.id)))
  const merged = dedupeComplaints(scoped)
  const raisedInWindow = (c: ComplaintLine) => c.trail.some(t => windowIds.has(t.id))
  const items = merged.filter(raisedInWindow)
  const carriedOpen = merged.filter(c => !raisedInWindow(c))

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

  const rawInWindow = raw.map(map).filter(inScope).length

  return {
    available: true,
    total: items.length,
    rawTotal: rawInWindow,
    duplicatesMerged: Math.max(0, scoped.length - merged.length),
    resolved: resolvedItems.length,
    open: openItems.length,
    highSeverityOpen: openItems.filter(c => c.severity === 'high').length,
    recurringOpen: items.concat(carriedOpen)
      .filter(c => c.status !== 'resolved' && c.occurrences > 1).length,
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
    // The action list, in the order someone should work it: unresolved first,
    // then most severe, then whatever has been raised most times — an issue the
    // guest brought up on three calls outranks a one-off of equal severity —
    // and finally the most recently active.
    items: items.slice()
      .sort((a, b) =>
        Number(a.status === 'resolved') - Number(b.status === 'resolved') ||
        (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
        b.occurrences - a.occurrences ||
        b.lastRaisedAt.localeCompare(a.lastRaisedAt))
      .slice(0, maxRows),
    // Oldest-first: carried debt is ranked by how long it has been ignored.
    carriedOpen: carriedOpen.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
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

// ─── AppleSystem parity ───────────────────────────────────────────────────────

/**
 * Ask both systems the same question and put the answers next to each other.
 *
 * Two passes, in order of authority:
 *
 *  1. **Live.** List AppleSystem's status-2 quotations created in the window and
 *     check each predicted `bookingRef` against our own table in one query. This
 *     is the honest answer *at send time* — it cannot be stale, and it does not
 *     depend on the reconciler having run.
 *  2. **Ledger.** If AppleSystem cannot be reached, fall back to the per-date
 *     rows the 15-minute reconciler writes, and say so in `note`. A number from
 *     twenty minutes ago beats no number at all, but the reader is told which
 *     one they are looking at.
 *
 * The counters describing what the automation *did* (created, refreshed,
 * cancelled) always come from the ledger — only the reconciler knows those, and
 * no live query can reconstruct them.
 *
 * Never throws: a report that cannot render because an upstream API blipped is
 * worse than a report with one section marked unavailable.
 */
async function collectParity(window: ReportWindow): Promise<ParitySection> {
  const empty: ParitySection = {
    available: false, source: 'none',
    upstreamConfirmed: 0, systemHeld: 0, missing: 0, inParity: true, gaps: [],
    createdByAutomation: 0, refreshed: 0, cancelled: 0, flagged: 0, errors: 0, runs: 0,
    lastRunAt: null, cancellations: [], byDate: [], note: null,
  }

  // ── Ledger: what the reconciler recorded ──────────────────────────────────
  let days: ReconcileDay[] = []
  try {
    days = await getReconcileDays(window.fromDate, window.toDate)
  } catch (err) {
    console.error('[report] parity ledger read failed:', err instanceof Error ? err.message : err)
  }

  const ledgerTotals = days.reduce(
    (acc, d) => ({
      upstreamConfirmed: acc.upstreamConfirmed + d.upstreamConfirmed,
      systemHeld:        acc.systemHeld        + d.systemHeld,
      created:           acc.created           + d.createdTotal,
      refreshed:         acc.refreshed         + d.refreshedTotal,
      cancelled:         acc.cancelled         + d.cancelledTotal,
      flagged:           acc.flagged           + d.flaggedTotal,
      errors:            acc.errors            + d.errorsTotal,
      runs:              acc.runs              + d.runs,
    }),
    { upstreamConfirmed: 0, systemHeld: 0, created: 0, refreshed: 0, cancelled: 0, flagged: 0, errors: 0, runs: 0 },
  )

  const lastRunAt = days.map(d => d.lastRunAt).filter(Boolean).sort().pop() ?? null
  const cancellations = days
    .flatMap(d => d.cancelled ?? [])
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 25)

  const base: ParitySection = {
    ...empty,
    createdByAutomation: ledgerTotals.created,
    refreshed: ledgerTotals.refreshed,
    cancelled: ledgerTotals.cancelled,
    flagged: ledgerTotals.flagged,
    errors: ledgerTotals.errors,
    runs: ledgerTotals.runs,
    lastRunAt,
    cancellations,
  }

  // ── Live: ask AppleSystem now ─────────────────────────────────────────────
  try {
    const { items } = await listByCreateDate({
      fromCreateDate: window.fromDate,
      toCreateDate: window.toDate,
      statuses: ['2'],
    })

    const perDate = new Map<string, { upstreamConfirmed: number; systemHeld: number; missing: number }>()
    const rows = items.map(it => {
      const raw = normalizeIsNumber(String(it.is_number ?? ''))
      const ref = !raw || raw === 'NA' ? null : raw
      const created = (typeof it.created_at === 'string' ? it.created_at : it.created_at?.date)?.slice(0, 10)
      return {
        ref,
        label: ref ?? `Quotation ${it.quotation_no}`,
        date: created && /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : window.toDate,
      }
    })

    const refs = Array.from(new Set(rows.map(r => r.ref).filter((r): r is string => r !== null)))
    const held = new Set(
      (await prisma.booking.findMany({ where: { bookingRef: { in: refs } }, select: { bookingRef: true } }))
        .map(b => b.bookingRef),
    )

    const gaps: ParityGap[] = []
    for (const r of rows) {
      const bucket = perDate.get(r.date) ?? { upstreamConfirmed: 0, systemHeld: 0, missing: 0 }
      bucket.upstreamConfirmed++
      // A row upstream has not given an IS number to cannot be matched by ref;
      // it is counted as a gap rather than assumed present, because "we cannot
      // tell" and "it is here" are not the same answer.
      if (r.ref && held.has(r.ref)) bucket.systemHeld++
      else { bucket.missing++; if (gaps.length < 40) gaps.push({ ref: r.label, date: r.date }) }
      perDate.set(r.date, bucket)
    }

    const upstreamConfirmed = rows.length
    const systemHeld = Array.from(perDate.values()).reduce((n, b) => n + b.systemHeld, 0)

    return {
      ...base,
      available: true,
      source: 'live',
      upstreamConfirmed,
      systemHeld,
      missing: upstreamConfirmed - systemHeld,
      inParity: upstreamConfirmed === systemHeld,
      gaps,
      byDate: Array.from(perDate.entries())
        .map(([date, b]) => ({ date, ...b }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[report] live parity check failed:', message)

    if (!days.length) {
      return { ...base, note: `AppleSystem could not be reached (${message}) and the reconciler has no record for this period.` }
    }

    return {
      ...base,
      available: true,
      source: 'ledger',
      upstreamConfirmed: ledgerTotals.upstreamConfirmed,
      systemHeld: ledgerTotals.systemHeld,
      missing: Math.max(0, ledgerTotals.upstreamConfirmed - ledgerTotals.systemHeld),
      inParity: ledgerTotals.upstreamConfirmed === ledgerTotals.systemHeld,
      gaps: days.flatMap(d => (d.missingRefs ?? []).map(ref => ({ ref, date: d.date }))).slice(0, 40),
      byDate: days.map(d => ({
        date: d.date,
        upstreamConfirmed: d.upstreamConfirmed,
        systemHeld: d.systemHeld,
        missing: d.missing,
      })),
      note: `AppleSystem could not be reached while the report was written (${message}) — these figures are from the last reconciliation${lastRunAt ? ` at ${lastRunAt.slice(11, 16)} UTC` : ''}.`,
    }
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function collectReportData(opts: CollectOptions): Promise<ReportData> {
  const now = opts.now ?? new Date()
  const countries = (opts.countries ?? []).filter(Boolean)
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const window = buildReportWindow(opts.period, opts.timezone, now, opts.anchorDate)

/** The labels the mail prints for each intake channel. */
const ORIGIN_LABELS: Record<OriginChannel | 'MISSING', string> = {
  APPLESYSTEM: 'Apple System',
  ONEDRIVE: 'OneDrive',
  EMAIL: 'Confirmation mail',
  OPS_AI: 'OPS AI',
  API: 'Public API',
  MANUAL: 'Entered by hand',
  UNKNOWN: 'Not recorded',
  MISSING: 'Not filed here',
}

/** The order they are printed in — biggest intake paths first. */
const ORIGIN_ORDER: (OriginChannel | 'MISSING')[] =
  ['APPLESYSTEM', 'ONEDRIVE', 'EMAIL', 'API', 'OPS_AI', 'MANUAL', 'UNKNOWN', 'MISSING']

/**
 * The split, plus where this system's own new business came in from.
 *
 * The accounts ledger decides *which* bookings are this period's own — it is
 * the only place that holds every revision and can therefore date a booking —
 * and this system then says how each of them arrived here. Two systems, one
 * population, neither re-deciding the other's half.
 *
 * Never fatal: an unreachable accounts database, or an OPS query that fails,
 * leaves the section marked unavailable and the mail renders without the tiles.
 */
async function collectActivitySplitSection(
  window: ReportWindow,
  appleCount: number,
): Promise<ActivitySplitSection> {
  const empty: ActivitySplitSection = {
    available: false, todayCount: 0, oldCount: 0, oldBookings: 0, oldest: null,
    appleCount, origins: [], held: 0, index: {},
  }

  let split: ActivitySplit
  try {
    split = await collectActivitySplit(window)
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }

  if (!split.available) return { ...empty, error: split.error }

  const base: ActivitySplitSection = {
    available: true,
    todayCount: split.today.count,
    oldCount: split.old.count,
    oldBookings: split.old.bookings,
    oldest: split.old.lines.reduce<number | null>(
      (max, l) => (l.ageDays !== null && (max === null || l.ageDays > max) ? l.ageDays : max), null),
    appleCount,
    origins: [],
    held: 0,
    index: split.index,
  }

  const keys = split.today.keys
  if (keys.length === 0) return base

  try {
    // Matched on the ledger's own key rule rather than on the reference as
    // either system happens to spell it: "VN 40499" here is "VN40499" there.
    // The lookup itself cannot use that rule — it is a SQL `IN` on a stored
    // column — so it asks for both spellings and the filter below decides.
    const spellings = Array.from(new Set(keys.flatMap(k => {
      const parts = /^([A-Z]+)(\d+)$/.exec(k)
      return parts ? [k, `${parts[1]} ${parts[2]}`] : [k]
    })))

    const candidates = await prisma.booking.findMany({
      where: {
        OR: [
          { createdAt: { gte: window.start, lt: window.end } },
          { bookingRef: { in: spellings } },
          { isNumber: { in: spellings } },
        ],
      },
      select: { id: true, bookingRef: true, isNumber: true, sourceDocUrl: true },
    })

    const wanted = new Set(keys)
    // One booking per key: a reference filed twice is one booking to the
    // accounts ledger, and counting both here would push the parts past the
    // headline they are supposed to add up to.
    const seen = new Set<string>()
    const held = candidates.filter(b => {
      const key = wanted.has(bookingKey(b.bookingRef))
        ? bookingKey(b.bookingRef)
        : wanted.has(bookingKey(b.isNumber)) ? bookingKey(b.isNumber) : ''

      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })

    const channels = await resolveBookingOriginChannels(held)

    const counts = new Map<OriginChannel | 'MISSING', number>()
    for (const booking of held) {
      const channel = channels.get(booking.id) ?? 'UNKNOWN'
      counts.set(channel, (counts.get(channel) ?? 0) + 1)
    }

    // Confirmed and dated to this period by accounts, with no booking here at
    // all. Counted into the split so the parts still add up to the whole.
    const missing = Math.max(0, split.today.count - held.length)
    if (missing > 0) counts.set('MISSING', missing)

    base.held = held.length
    base.origins = ORIGIN_ORDER
      .filter(c => (counts.get(c) ?? 0) > 0)
      .map(c => ({ channel: c, label: ORIGIN_LABELS[c], bookings: counts.get(c) ?? 0 }))

    return base
  } catch (error) {
    console.warn('[Reports] intake origins unavailable:', error instanceof Error ? error.message : error)
    return base
  }
}

  // Read first, because the "bookings created" section is now a cut of it: the
  // report counts the confirmations AppleSystem raised in the window, not this
  // system's own intake. See apple-cohort.ts.
  const cohort = await collectAppleCohort(window)

  const [created, split, parity, countCheck, onGround, readiness, reconfirm, complaints, upcoming] = await Promise.all([
    // The two figures this mail now leads with, read from the accounts ledger
    // so all three daily mails describe the day with one set of numbers.
    // `cohort.total` is the Apple System count they are checked against.
    collectCreated(window, countries, maxRows, cohort),
    collectActivitySplitSection(window, cohort.available ? cohort.total : 0),
    // Deliberately unscoped by country: parity is a question about the integration
    // as a whole, and a per-country view of it would hide a gap in whichever
    // market the reader was not looking at.
    collectParity(window),
    // Same reasoning, one system further down: the count check asks whether the
    // day is whole across all four systems, and a per-country slice of it would
    // hide a shortfall in whichever market the reader was not looking at.
    collectCountCheck(window),
    collectOnGround(window, countries, maxRows),
    collectReadiness(window, countries, maxRows),
    collectReconfirm(window, countries, maxRows),
    collectComplaints(window, countries, maxRows),
    collectUpcoming(window, countries, maxRows),
  ])

  // Only the periodic mails carry analytics, and only they pay for the extra
  // reads. Never allowed to sink a report: an insight is a nice-to-have, the
  // sections above are the deliverable.
  const insights = window.period === 'DAILY'
    ? null
    : await collectPeriodInsights({
        window,
        countries,
        counted: created.allBookings,
        basis: created.basis,
        complaints,
      })
        // The figures parity, the count check, readiness and D-10 already hold
        // are handed over rather than re-queried, and the action list is derived
        // from the complete picture.
        .then(base => finaliseInsights(base, { window, parity, countCheck, readiness, reconfirm }))
        .catch(err => {
          console.warn('[Reports] period insights failed:', err instanceof Error ? err.message : err)
          return null
        })

  return {
    window,
    generatedAt: now.toISOString(),
    countries,
    created,
    split,
    parity,
    countCheck,
    onGround,
    readiness,
    reconfirm,
    complaints,
    upcoming,
    insights,
  }
}

export { UNASSIGNED as UNASSIGNED_COUNTRY, labelFor as reportCountryLabel, dateInTz }
// Re-exported from `booking-lines` so every consumer keeps importing the report
// vocabulary from one place, wherever the definitions happen to live.
export type { BookingLine, ChannelSplit, CountryRow, MoneyByCurrency } from './booking-lines'
