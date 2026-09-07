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
import { renderReportWorkbook, reportWorkbookSheets } from '../src/lib/reports/report-workbook'
import { buildReportWindow, DEFAULT_REPORT_TZ, type ReportPeriod } from '../src/lib/reports/report-window'
import { finaliseInsights, type PeriodInsights } from '../src/lib/reports/period-insights'
import type { ReportData } from '../src/lib/reports/report-data'

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
} as unknown as ReportData

async function main() {
  // Run the real finaliser so the action list under test is the one a send
  // would derive, not a list written by hand in this file.
  data.insights = finaliseInsights(insightsBase, {
    window,
    parity: data.parity,
    countCheck: data.countCheck,
    readiness: data.readiness,
    reconfirm: data.reconfirm,
  })

  const sheets = reportWorkbookSheets(data)
  const html = renderPeriodEmail(data, {
    narrative: 'A synthetic period, written to exercise every block at once.',
    dashboardUrl: 'https://ops.aahaas.com/dashboard/reports',
    scheduleName: 'Render check',
    testSend: true,
    workbookAttached: true,
    workbookSheets: sheets,
  })
  const workbook = renderReportWorkbook(data)

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
