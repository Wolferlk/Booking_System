/**
 * Render check for the weekly / monthly business review.
 *
 * Builds a complete report from synthetic figures and writes out both halves of
 * what a scheduled send would carry — the email body and the Excel workbook —
 * so the layout, the derived action list and every sheet can be opened and read
 * before either reaches an inbox.
 *
 *   npx tsx scripts/period-report-render.mts [WEEKLY|MONTHLY] [outDir]
 *
 * **Touches nothing.** No database, no Apple System, no mail, no AI. The data is
 * fabricated in this file, which is the point: it exercises the renderers on a
 * period that has one of everything — a lost partner, a slipping market, a
 * short-notice cancellation, a parity gap — which a real quiet week would not,
 * and it can be run from a laptop that cannot reach the production databases.
 */
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { renderPeriodEmail, renderPeriodSubject } from '../src/lib/reports/period-html'
import { renderReportWorkbook } from '../src/lib/reports/report-workbook'
import { buildReportWindow, DEFAULT_REPORT_TZ, type ReportPeriod } from '../src/lib/reports/report-window'
import { finaliseInsights, type PeriodInsights } from '../src/lib/reports/period-insights'
import type { ReportData } from '../src/lib/reports/report-data'
import { baselineForecast, mergeAiForecast, shiftMonth } from '../src/lib/reports/period-outlook'

const period = (process.argv[2] ?? 'WEEKLY').toUpperCase() as ReportPeriod
const outDir = path.resolve(process.argv[3] ?? '.render-check/period-report')

const window = buildReportWindow(period, DEFAULT_REPORT_TZ, new Date())

/** A booking line, varied enough that the sheets are not all one shape. */
function line(n: number) {
  const day = window.fromDate.slice(0, 8) + String(((n % 26) + 1)).padStart(2, '0')
  const country = ['SRI_LANKA', 'MALDIVES', 'SINGAPORE', 'MALAYSIA', 'UNASSIGNED'][n % 5]
  return {
    bookingRef: `SL ${41000 + n}`,
    agent: ['Make My Trip', 'Pick Your Trail', '30 Sundays', 'Aahaas Direct', null][n % 5],
    source: (n % 4 === 0 ? 'B2C' : 'B2B') as 'B2B' | 'B2C',
    country,
    countryLabel: ['Sri Lanka', 'Maldives', 'Singapore', 'Malaysia', 'Others'][n % 5],
    status: 'CONFIRMED',
    arrivalDate: `${day.slice(0, 8)}${String(((n % 26) + 2)).padStart(2, '0')}`,
    departureDate: `${day.slice(0, 8)}${String(((n % 26) + 6)).padStart(2, '0')}`,
    pax: 2 + (n % 4),
    paxAdults: 2, paxChildren: n % 3, paxInfants: 0,
    currency: n % 3 === 0 ? 'LKR' : 'USD',
    quotedTotal: 1200 + n * 37,
    destination: 'Kandy · Ella · Galle',
    createdAt: `${day}T0${n % 9}:15:00.000Z`,
    hotelOnly: n % 11 === 0,
  }
}

const counted = Array.from({ length: 48 }, (_, n) => line(n + 1))

const insightsBase: PeriodInsights = {
  basis: 'apple',
  comparable: true,
  previousLabel: 'the period before',
  granularity: period === 'MONTHLY' ? 'week' : 'day',
  series: Array.from({ length: period === 'MONTHLY' ? 5 : 7 }, (_, n) => ({
    key: `${window.fromDate.slice(0, 8)}${String(n + 1).padStart(2, '0')}`,
    label: period === 'MONTHLY' ? `Wk ${n + 1}` : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][n],
    bookings: [9, 6, 11, 4, 8, 7, 3][n % 7],
    pax: [22, 14, 28, 9, 19, 16, 7][n % 7],
    arrivals: [3, 5, 2, 6, 4, 8, 1][n % 7],
    departures: [2, 4, 3, 5, 3, 6, 2][n % 7],
  })),
  busiest: null, quietest: null,
  runRate: { current: 6.9, previous: 5.4 },
  totals: {
    bookings: counted.length, previousBookings: 38,
    pax: 132, previousPax: 101,
    channel: { b2b: 36, b2c: 12 }, previousChannel: { b2b: 31, b2c: 7 },
    byCurrency: [{ currency: 'USD', total: 118400 }, { currency: 'LKR', total: 8_940_000 }],
    previousByCurrency: [{ currency: 'USD', total: 97300 }],
    avgBookingValue: [{ currency: 'USD', total: 3700 }, { currency: 'LKR', total: 558750 }],
    avgPartySize: 2.8, previousAvgPartySize: 2.7,
  },
  countryMovers: [
    { label: 'Sri Lanka', current: 22, previous: 18, delta: 4, pct: 22.2, pax: 61, isNew: false, isLost: false },
    { label: 'Maldives', current: 11, previous: 16, delta: -5, pct: -31.3, pax: 30, isNew: false, isLost: false },
    { label: 'Singapore', current: 9, previous: 4, delta: 5, pct: 125, pax: 26, isNew: false, isLost: false },
    { label: 'Malaysia', current: 6, previous: 0, delta: 6, pct: null, pax: 15, isNew: true, isLost: false },
  ],
  agentMovers: [
    { label: 'Make My Trip', current: 17, previous: 12, delta: 5, pct: 41.7, pax: 44, isNew: false, isLost: false },
    { label: 'Pick Your Trail', current: 12, previous: 15, delta: -3, pct: -20, pax: 33, isNew: false, isLost: false },
    { label: '30 Sundays', current: 8, previous: 0, delta: 8, pct: null, pax: 21, isNew: true, isLost: false },
    { label: 'Ceylon Roots', current: 0, previous: 6, delta: -6, pct: -100, pax: 0, isNew: false, isLost: true },
  ],
  newAgents: ['30 Sundays'],
  lapsedAgents: ['Ceylon Roots'],
  agentConcentrationPct: 77.1,
  leadTime: { measured: 44, avgDays: 38, medianDays: 29, within7: 6, within30: 23, beyond90: 5, previousAvgDays: 46 },
  b2c: {
    available: true, orders: 9, pax: 21, previousOrders: 5, previousPax: 12,
    byCurrency: [{ currency: 'USD', total: 14300 }], cancelled: 1,
    byCountry: [{ country: 'SRI_LANKA', label: 'Sri Lanka', bookings: 7, pax: 17, b2b: 0, b2c: 7 }, { country: 'MALAYSIA', label: 'Malaysia', bookings: 2, pax: 4, b2b: 0, b2c: 2 }],
    lines: counted.filter(b => b.source === 'B2C').slice(0, 9),
  },
  storeMix: {
    available: true, error: null, fromDate: window.fromDate, toDate: window.toDate,
    all: 41, previousAll: 33, b2bPackages: 6, b2bFlights: 26, b2c: 9,
    previousB2bPackages: 4, previousB2bFlights: 24, previousB2c: 5,
    boards: [
      { board: 'b2b_packages', label: 'B2B Packages', orders: 6, previous: 4, filedInOps: 5 },
      { board: 'b2b_flights', label: 'B2B Flights', orders: 26, previous: 24, filedInOps: 22 },
      { board: 'b2c_packages', label: 'B2C packages', orders: 7, previous: 4, filedInOps: 7 },
      { board: 'b2c_flights', label: 'B2C flights', orders: 2, previous: 1, filedInOps: 1 },
      { board: 'cancelled', label: 'Cancelled', orders: 2, previous: null, filedInOps: 0 },
    ],
    cancelled: 2, tests: { checked: true, orders: 1 }, notInOps: 6, truncated: false,
  },
  delivery: {
    available: true, toursOperated: 63, arrivals: 29, departures: 26, pax: 178, guestDays: 742,
    avgPartySize: 2.8, avgTourNights: 6.1, hotelOnly: 7,
    byCountry: [
      { country: 'SRI_LANKA', label: 'Sri Lanka', bookings: 41, pax: 118, b2b: 33, b2c: 8 },
      { country: 'MALDIVES', label: 'Maldives', bookings: 14, pax: 38, b2b: 12, b2c: 2 },
      { country: 'SINGAPORE', label: 'Singapore', bookings: 8, pax: 22, b2b: 6, b2c: 2 },
    ],
    channel: { b2b: 51, b2c: 12 }, previousArrivals: 24,
    byDate: [],
    lines: counted.slice(0, 12).map((b, n) => ({
      ...b, daysInPeriod: 4 + (n % 3), guestDaysInPeriod: (4 + (n % 3)) * b.pax, straddles: n % 5 === 0,
    })),
  },
  cancellations: {
    available: true, total: 4, pax: 11, previousTotal: 2, ratePct: 7.7,
    byCurrency: [{ currency: 'USD', total: 9400 }],
    feesByCurrency: [{ currency: 'USD', total: 1250 }],
    shortNotice: 2,
    byCountry: [{ country: 'MALDIVES', label: 'Maldives', bookings: 3, pax: 8, b2b: 3, b2c: 0 }],
    byAgent: [{ agent: 'Pick Your Trail', bookings: 3, pax: 8 }, { agent: 'Make My Trip', bookings: 1, pax: 3 }],
    topReasons: [{ reason: 'Guest changed dates', count: 2 }, { reason: 'No reason recorded', count: 1 }, { reason: 'Visa refused', count: 1 }],
    lines: [1, 2, 3, 4].map(n => ({
      ...line(100 + n),
      cancelledAt: `${window.toDate}T09:12:00.000Z`,
      cancelledBy: 'Nimali P.',
      reason: n === 3 ? null : 'Guest changed dates',
      feeTotal: n === 1 ? 1250 : null,
      noticeDays: n <= 2 ? 4 : 31,
    })),
  },
  quality: {
    complaints: 6, previousComplaints: 9, per100Tours: 9.5, resolvedPct: 66.7,
    avgResolutionHours: 14.5, recurringOpen: 2, highSeverityOpen: 1,
    reconfirmCompliancePct: 86.4, unexplainedBreaches: 3, readinessPct: 71.4,
  },
  integrity: {
    parityMissing: 2, paritySource: 'live', countCheckShort: 1, countCheckAvailable: true,
    unswept: false, automationCreated: 44, automationCancelled: 3, automationFlagged: 1, automationErrors: 0,
  },
  actions: [],
}

const data = {
  window,
  generatedAt: new Date().toISOString(),
  countries: [],
  created: {
    total: counted.length, pax: 132, channel: { b2b: 36, b2c: 12 },
    byCountry: insightsBase.delivery.byCountry,
    byCurrency: insightsBase.totals.byCurrency,
    byAgent: [{ agent: 'Make My Trip', bookings: 17, pax: 44 }],
    bookings: counted.slice(0, 30), allBookings: counted,
    previousTotal: 38, basis: 'apple' as const, upstream: 50, cancelledUpstream: 2,
    missingRefs: ['SL 41999', 'MV 20441'], outside: counted.slice(0, 3), allOutside: counted.slice(0, 3),
    sweptAt: new Date().toISOString(),
  },
  parity: {
    available: true, source: 'live' as const, upstreamConfirmed: 50, systemHeld: 48, missing: 2,
    inParity: false, gaps: [{ ref: 'SL 41999', date: window.toDate }, { ref: 'MV 20441', date: window.fromDate }],
    createdByAutomation: 44, refreshed: 12, cancelled: 3, flagged: 1, errors: 0, runs: 670,
    lastRunAt: new Date().toISOString(),
    cancellations: [{ ref: 'SL 41500', at: `${window.toDate}T04:00:00Z`, prevStatus: 'CONFIRMED', upstreamStatus: '5' }],
    byDate: [{ date: window.fromDate, upstreamConfirmed: 9, systemHeld: 8, missing: 1 }],
    note: null,
  },
  countCheck: {
    available: true, error: null, sweptAt: new Date().toISOString(), balanced: false, unchecked: [],
    headline: '50 upstream · 49 P&Ls · 49 invoices',
    channels: [], overall: {
      channel: 'all' as const, label: 'Both businesses', upstream: 50, bookings: 48, pnls: 49, invoices: 49,
      cancelled: 2, notBillable: 0, expected: 48, expectedInvoices: 48,
      pnlShort: 0, invoiceShort: 1, bookingShort: 0, balanced: false,
      status: 'short' as never, verdict: 'One invoice outstanding', checkedAt: new Date().toISOString(),
    },
    activity: null, intake: null,
  },
  onGround: {
    date: window.today, total: 21, pax: 58, channel: { b2b: 18, b2c: 3 },
    byCountry: insightsBase.delivery.byCountry, arrivingToday: 4, departingToday: 3,
    tours: counted.slice(0, 8).map((b, n) => ({ ...b, dayNo: n + 1, totalDays: 8, leadPassenger: `Guest ${n + 1}` })),
  },
  readiness: {
    fromDate: window.today, toDate: window.today, total: 14, pax: 39, tomorrow: 5, tomorrowNotReady: 2,
    ready: 10, notReady: 4, pendingClient: 3, pendingDriver: 2, pendingTickets: 1, pendingQc: 2, hotelOnly: 2,
    byDay: [], byCountry: insightsBase.delivery.byCountry, channel: { b2b: 12, b2c: 2 },
    bookings: counted.slice(0, 6).map((b, n) => ({
      ...b, leadPassenger: `Guest ${n + 1}`, daysToArrival: (n % 3) + 1,
      readiness: {
        ready: n % 2 === 0, blocking: n % 2 === 0 ? [] : ['driver allocation'],
        outstanding: n % 2 === 0 ? [] : ['driver allocation', 'tickets'],
        client: { state: 'DONE', short: 'Confirmed', detail: 'Client confirmed' },
        driver: { state: 'TODO', short: 'None', detail: 'No driver allocated' },
        tickets: { state: 'TODO', short: '0/3', detail: '3 tickets unissued' },
        qc: { state: 'DONE', short: 'Passed', detail: 'QC passed' },
      } as never,
      delay: null,
    })),
    tomorrowOutstanding: [],
  },
  reconfirm: {
    fromDate: window.today, toDate: window.today, total: 22, breached: 3, explained: 1, unexplained: 3, stale: 0,
    byReason: [], byCountry: [], channel: { b2b: 3, b2c: 0 },
    bookings: counted.slice(0, 3).map((b, n) => ({
      ...b, leadPassenger: `Guest ${n + 1}`, daysToArrival: 5, dueAt: window.fromDate, daysLate: n + 2,
      clientConfirmed: false, preTourCalled: n === 0, delay: null,
    })),
  },
  complaints: {
    available: true, total: 6, rawTotal: 8, duplicatesMerged: 2, resolved: 4, open: 2,
    highSeverityOpen: 1, recurringOpen: 2, avgResolutionHours: 14.5,
    byCategory: [{ category: 'hotel', total: 3, open: 1 }, { category: 'driver', total: 2, open: 1 }, { category: 'itinerary', total: 1, open: 0 }],
    bySeverity: [], byCountry: [],
    items: [1, 2].map(n => ({
      id: String(n), bookingRef: `SL 4100${n}`, customerName: `Guest ${n}`, country: 'SRI_LANKA', countryLabel: 'Sri Lanka',
      category: 'hotel', severity: 'high' as const, status: n === 1 ? 'open' : 'resolved',
      title: 'Room not as booked', details: 'Guest was moved to a garden view.', customerQuote: 'This is not what we paid for.',
      sentiment: 'negative', resolutionNote: n === 1 ? null : 'Upgraded and comped a dinner.',
      resolvedAt: n === 1 ? null : new Date().toISOString(), createdAt: new Date().toISOString(),
      resolutionHours: n === 1 ? null : 12, occurrences: n, lastRaisedAt: new Date().toISOString(),
      trail: [{ id: String(n), createdAt: new Date().toISOString(), status: 'open', severity: 'high', category: 'hotel' }],
      categories: ['hotel'],
    })),
    carriedOpen: [],
  },
  upcoming: {
    total: 212, pax: 604, channel: { b2b: 180, b2c: 32 }, next7: 19, next30: 74, beyond30: 138,
    byCountry: insightsBase.delivery.byCountry,
    byMonth: [
      { month: '2026-09', label: 'Sep 2026', bookings: 74, pax: 205 },
      { month: '2026-10', label: 'Oct 2026', bookings: 88, pax: 251 },
      { month: '2026-11', label: 'Nov 2026', bookings: 50, pax: 148 },
    ],
    imminent: counted.slice(0, 10),
  },
  insights: null,
  guestVoice: {
    calls: {
      available: true, source: 'database', warnings: [], assigned: 212, done: 171, missed: 29, completionRate: 80.7,
      verdicts: { calls: 171, good: 128, warning: 27, bad: 11, none: 5 },
      byPhase: [
        { phase: 'pre_tour', label: 'Pre-tour', assigned: 64, done: 55, good: 44, warning: 8, bad: 2 },
        { phase: 'on_tour', label: 'On-tour', assigned: 110, done: 86, good: 61, warning: 16, bad: 7 },
        { phase: 'post_tour', label: 'Post-tour', assigned: 38, done: 30, good: 23, warning: 3, bad: 2 },
      ],
      postTour: { calls: 30, rated: 26, avgRating: 8.4, nps: 42, promoters: 15, detractors: 4, recommendYes: 24, recommendNo: 2 },
      areaProblems: [{ area: 'Hotel', bad: 6, good: 70 }, { area: 'Driver', bad: 3, good: 78 }, { area: 'Meals', bad: 2, good: 60 }, { area: 'Vehicle', bad: 1, good: 80 }],
      reconfirmMismatches: { dates: 2, flight: 3, pax: 1, contact: 0 },
      issues: [
        { id: '1', phase: 'on_tour', level: 'bad', source: 'call', bookingRef: 'SL 41012', customerName: null, phone: null, date: window.fromDate, at: `${window.fromDate}T08:00:00Z`, reason: 'Guest unhappy with hotel room — moved to a smaller room than booked', detail: null, verdictBy: 'ai', alert: null },
        { id: '2', phase: 'pre_tour', level: 'warning', source: 'call', bookingRef: 'VN 40221', customerName: null, phone: null, date: window.fromDate, at: `${window.fromDate}T07:00:00Z`, reason: 'Flight number does not match the booking', detail: null, verdictBy: 'rules', alert: null },
      ],
      issueTotals: { bad: 11, warning: 27 },
    },
    forms: {
      available: true, total: 14, overall: { EXCELLENT: 7, GOOD: 5, AVERAGE: 1, POOR: 1 },
      areas: [
        { area: 'Hotel room', rated: 14, excellent: 6, good: 5, average: 2, poor: 1, score: 76 },
        { area: 'Driver', rated: 13, excellent: 10, good: 3, average: 0, poor: 0, score: 94 },
        { area: 'Restaurant food', rated: 12, excellent: 3, good: 4, average: 3, poor: 2, score: 59 },
      ],
      remarks: [
        { bookingRef: 'SL 41044', country: 'Sri Lanka', overall: 'POOR', remarks: 'The hotel in Ella was not what the itinerary showed and nobody called us back.', submittedAt: `${window.toDate}T10:00:00Z` },
        { bookingRef: 'SL 41009', country: 'Sri Lanka', overall: 'EXCELLENT', remarks: 'Our driver Chaminda made the trip — would book again.', submittedAt: `${window.toDate}T11:00:00Z` },
      ],
    },
    desk: { available: true, total: 9, rated: 8, avgRating: 4.1, low: [{ bookingRef: 'MY 20011', rating: 2, comment: 'Late pickup on day 1', savedAt: `${window.toDate}T09:00:00Z` }] },
  },
  history: [] as unknown[],
  testBookings: {
    available: true, total: 3, pax: 6, b2b: 2, b2c: 1,
    byCurrency: [{ currency: 'USD', total: 2400 }],
    lines: [
      { ref: 'SL 41888', seenAs: 'AppleSystem confirmation', inOps: true, agent: 'Make My Trip', source: 'B2B', countryLabel: 'Sri Lanka', status: 'CONFIRMED', arrivalDate: window.toDate, pax: 2, currency: 'USD', quotedTotal: 1200, createdAt: `${window.fromDate}T04:00:00.000Z`, markedBy: 'Sasindu D.', markedAt: `${window.fromDate}T05:00:00.000Z`, reason: 'Integration test from AppleSystem sandbox' },
      { ref: 'AHS15001', seenAs: 'Filed in OPS', inOps: true, agent: 'Aahaas B2C', source: 'B2C', countryLabel: 'Sri Lanka', status: 'CONFIRMED', arrivalDate: window.toDate, pax: 4, currency: 'USD', quotedTotal: 1200, createdAt: `${window.fromDate}T06:00:00.000Z`, markedBy: 'Shafraz A.', markedAt: null, reason: 'Store checkout test' },
      { ref: 'VN 40999', seenAs: 'AppleSystem confirmation', inOps: false, agent: null, source: 'B2B', countryLabel: '—', status: 'NOT FILED', arrivalDate: '', pax: 0, currency: '', quotedTotal: null, createdAt: '', markedBy: 'Karthik S', markedAt: null, reason: null },
    ],
  },
} as unknown as ReportData

async function main() {
  // Fifteen months of history ending in this one, and the real baseline over it.
  const month = window.fromDate.slice(0, 7)
  const shape = [31, 34, 38, 44, 41, 36, 33, 35, 39, 46, 49, 44, 40, 43]
  const label = (m: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${m}-01T00:00:00Z`))
  data.history = [...shape.map((n, k) => ({ month: shiftMonth(month, k - 14), label: label(shiftMonth(month, k - 14)), bookings: k < 2 ? null : n })), { month, label: label(month), bookings: counted.length }]
  const { forecast, method } = baselineForecast(data.history)
  data.advice = {
    history: data.history, method,
    forecast: mergeAiForecast(forecast, forecast.map((f, k) => ({ month: f.month, expected: f.baseline + (k ? -2 : 3), reason: k ? 'Forward book for this month is lighter than last year, so slightly under the baseline.' : 'November last year rose 9% on October and 74 tours are already on the book for it.' }))),
    complaintFixes: [
      { theme: 'Complaint: hotel', count: 3, rootCause: 'Rooms sold from the contract sheet do not match what the property allocates on arrival.', fix: 'Reservations to reconfirm room category in writing at D-7 for every stay; Ground Team to check in person on arrival day for repeat offenders.', owner: 'Reservations' },
      { theme: 'Pre-tour call: booking details did not match', count: 6, rootCause: 'Flight details changed after the TC was issued and were never updated.', fix: 'Booking Team to re-pull flight details from the partner at D-10 and update before the reconfirmation call.', owner: 'Booking Team' },
    ],
    growth: [
      { title: 'Win back Ceylon Roots', detail: 'They booked 6 last month and none this month — a call this week with a November offer.', evidence: 'Ceylon Roots: 6 → 0 bookings' },
      { title: 'Reduce dependence on the top three partners', detail: 'Activate two mid-sized partners with a co-marketing push in India.', evidence: 'Top 3 partners hold 77.1% of bookings' },
    ],
    model: 'gpt-4o', aiNote: null,
  } as never

  // Run the real finaliser so the action list under test is the one a send
  // would derive, not a list written by hand in this file.
  data.insights = finaliseInsights(insightsBase, {
    window,
    parity: data.parity,
    countCheck: data.countCheck,
    readiness: data.readiness,
    reconfirm: data.reconfirm,
  })

  const { buffer: workbook, sheets } = await renderReportWorkbook(data)
  const html = renderPeriodEmail(data, {
    narrative: 'A synthetic period, written to exercise every block at once.',
    dashboardUrl: 'https://ops.aahaas.com/dashboard/reports',
    scheduleName: 'Render check',
    testSend: true,
    workbookAttached: true,
    workbookSheets: sheets,
  })

  console.log('Subject :', renderPeriodSubject(data, { testSend: true }))
  console.log('Email   :', `${Math.round(html.length / 1024)} KB${html.length > 102_400 ? '  ← OVER GMAIL CLIP THRESHOLD' : ''}`)
  console.log('Workbook:', `${Math.round(workbook.length / 1024)} KB · ${sheets.length} sheets`)
  console.log('Actions :')
  for (const a of data.insights!.actions) console.log(`  [${a.severity.padEnd(8)}] ${a.title}`)

  await mkdir(outDir, { recursive: true })
  const stem = `${period.toLowerCase()}-${window.fromDate}`
  await writeFile(path.join(outDir, `${stem}.html`), html, 'utf8')
  await writeFile(path.join(outDir, `${stem}.xlsx`), workbook)
  console.log(`\nWritten: ${path.join(outDir, `${stem}.html`)}`)
  console.log(`Written: ${path.join(outDir, `${stem}.xlsx`)}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1) })
