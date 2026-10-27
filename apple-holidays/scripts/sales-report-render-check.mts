/**
 * Render the Daily Sales Report from a fixture — no database, no mail.
 *
 * Writes the email HTML, the Excel workbook and the subject line to an output
 * folder so a layout change can be looked at in a browser and in Excel before
 * it goes anywhere near a director's inbox.
 *
 *   npx tsx scripts/sales-report-render-check.mts /tmp/sales-check
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderSalesEmail, renderSalesSubject } from '../src/lib/reports/sales-report-html'
import { renderSalesWorkbook } from '../src/lib/reports/sales-workbook'
import type { SalesReportData } from '../src/lib/reports/sales-report-data'
import type { QuoteRow, StaffRow } from '../src/lib/reports/sales-pipeline-data'

const out = process.argv[2] ?? join(process.cwd(), 'sales-render-check')
mkdirSync(out, { recursive: true })

const day = '2026-10-25'
const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 25, h - 5, m - 30)).toISOString()
const agencies = ['Make My Trip', 'Indian Rounds', 'Fenta Holidays', 'Travelfantasie', 'Pick Your Trail', 'Thomas Cook']
const people = ['Prem Kumar', 'Abdul Hameed', 'Nisha R', 'Karthik S', 'Divya M', 'Ravi T', 'Sahana P']
const dests = ['Vietnam', 'Sri Lanka', 'Singapore', 'Malaysia', 'Thailand', 'Bali']

const quotes: QuoteRow[] = Array.from({ length: 34 }, (_, i) => {
  const confirmed = i % 7 === 0
  return {
    ref: `AH5${String(10200 + i)}`, issuedAt: at(9 + (i % 10), (i * 7) % 60), lastIssuedAt: at(10 + (i % 9)),
    versions: 1 + (i % 3), ownerName: people[i % people.length], ownerEmail: `p${i % people.length}@aahaas.com`,
    team: i % 4 === 0 ? 'madurai_b2b' : 'bangalore_b2b', createdBy: i % 3 === 0 ? 'agency' : 'staff',
    agency: i % 9 === 8 ? null : agencies[i % agencies.length], destination: dests[i % dests.length],
    trip: `${4 + (i % 5)}N ${dests[i % dests.length]} family escape`, nights: 4 + (i % 5), pax: 2 + (i % 4),
    travelDate: '2026-12-1' + (i % 9), currency: i % 5 === 0 ? 'INR' : 'USD', latestTotal: 1200 + i * 137,
    quoteStatus: 'sent', bookingStatus: confirmed ? 'confirmed' : i % 6 === 0 ? 'follow_up' : 'pending',
    confirmationType: confirmed ? 'b2b' : null, confirmedAt: confirmed ? at(15 + (i % 4)) : null,
    confirmedOrderId: confirmed ? 14500 + i : null, isNew: i < 28, amendmentsInWindow: i % 3,
    confirmedInWindow: confirmed, cohortConfirmed: confirmed,
  }
})

const staff: StaffRow[] = people.map((name, i) => ({
  name, role: i === 1 ? 'leader' : 'staff', team: i % 4 === 0 ? 'madurai_b2b' : 'bangalore_b2b', leader: i === 1 ? null : 'Abdul Hameed',
  newQuotes: i === 6 ? 0 : 8 - i, amendments: i === 6 ? 0 : 5 - (i % 4), cohortConfirmed: i % 3 === 0 ? 1 : 0, confirmations: i % 2,
  manualCalls: i === 6 ? 0 : 14 - i, manualConnected: i === 6 ? 0 : 7 - (i % 5), aiCalls: i === 0 ? 40 : 0, agenciesHandled: 12 - i,
  agenciesContacted: i === 6 ? 0 : 6 - (i % 3), prompts: i === 6 ? 0 : 20 + i * 3,
  quotedValue: [{ currency: 'USD', total: 9000 - i * 800 }], confirmedValue: i % 2 ? [{ currency: 'USD', total: 3200 }] : [],
}))

const data: SalesReportData = {
  window: {
    period: 'DAILY', fromDate: day, toDate: day, start: new Date(`${day}T00:00:00+05:30`), end: new Date('2026-10-26T00:00:00+05:30'),
    today: '2026-10-26', anchored: false, timezone: 'Asia/Colombo', label: 'Yesterday — Sun, 25 Oct 2026', days: 1, custom: false, live: false,
    previous: { fromDate: '2026-10-24', toDate: '2026-10-24', start: new Date('2026-10-24T00:00:00+05:30'), end: new Date(`${day}T00:00:00+05:30`), label: 'Sat, 24 Oct 2026' },
  },
  generatedAt: new Date().toISOString(),
  countries: [],
  bookings: {
    available: true, error: null, created: null, total: 18, previousTotal: 14, pax: 61, b2b: 17, b2c: 1,
    value: [{ currency: 'USD', total: 48210 }, { currency: 'SGD', total: 6120 }], avgLeadDays: 38.5, avgPax: 3.4, avgNights: 5.2, hotelOnly: 2,
    markets: [
      { country: 'VIETNAM', label: 'Vietnam', bookings: 9, pax: 31, b2b: 9, b2c: 0, quoted: [{ currency: 'USD', total: 26400 }], avgLeadDays: 41 },
      { country: 'SRILANKA', label: 'Sri Lanka', bookings: 5, pax: 18, b2b: 4, b2c: 1, quoted: [{ currency: 'USD', total: 15800 }], avgLeadDays: 33 },
      { country: 'SINGAPORE', label: 'Singapore', bookings: 4, pax: 12, b2b: 4, b2c: 0, quoted: [{ currency: 'SGD', total: 6120 }], avgLeadDays: 29 },
    ],
    partners: agencies.map((agent, i) => ({
      agent, bookings: 6 - i, pax: (6 - i) * 3, quoted: [{ currency: 'USD', total: (6 - i) * 2600 }], invoicedNew: Math.max(0, 5 - i),
      invoicedNewValue: [{ currency: 'USD', total: Math.max(0, 5 - i) * 2400 }], amended: i % 2, previousNew: i === 5 ? 3 : 4 - i, share: (6 - i) / 18,
    })),
    missingRefs: ['VN 41092'],
    lines: Array.from({ length: 18 }, (_, i) => ({
      bookingRef: `VN 410${60 + i}`, agent: agencies[i % agencies.length], source: i === 17 ? 'B2C' as const : 'B2B' as const,
      country: 'VIETNAM', countryLabel: 'Vietnam', status: 'CONFIRMED', arrivalDate: '2026-12-0' + (1 + (i % 9)), departureDate: '2026-12-1' + (i % 9),
      pax: 2 + (i % 4), paxAdults: 2, paxChildren: i % 4, paxInfants: 0, currency: 'USD', quotedTotal: 1800 + i * 210,
      destination: 'Hanoi · Halong · Saigon', createdAt: at(9 + (i % 10)), hotelOnly: i % 9 === 0,
    })),
  },
  invoices: {
    available: true, error: null, newCount: 16, amendedCount: 9, newValue: [{ currency: 'USD', total: 44120.5 }], amendedValue: [{ currency: 'USD', total: 18200 }],
    previousNewCount: 13, previousNewValue: [{ currency: 'USD', total: 36000 }],
    newLines: Array.from({ length: 16 }, (_, i) => ({
      key: `VN410${60 + i}`, ref: `VN 410${60 + i}`, invoiceNumber: `AHDS-2610-${300 + i}`, type: 'New' as const, agent: agencies[i % agencies.length],
      guest: `Guest ${i + 1}`, currency: 'USD', amount: 1500 + i * 250, firstOn: day, ageDays: 0, revisions: 0, raisedAt: at(11 + (i % 8)),
    })),
    amendedLines: [],
  },
  store: {
    available: true, error: null, orders: 7, previousOrders: 5, lines: 11, value: [{ currency: 'USD', total: 2380 }],
    byCategory: [{ category: 'Lifestyle', orders: 4, lines: 6, value: [{ currency: 'USD', total: 820 }] }, { category: 'Flights', orders: 3, lines: 5, value: [{ currency: 'USD', total: 1560 }] }],
    list: [],
  },
  pipeline: {
    available: true, configured: true, error: null, team: null, warnings: [],
    counts: {
      newQuotes: 28, amendments: 31, cohortConfirmed: 4, conversion: 4 / 28, agenciesQuotedFor: 17, agencyRaised: 9, staffRaised: 19, consultants: 6,
      confirmations: 5, quotedValue: [{ currency: 'USD', total: 61200 }, { currency: 'INR', total: 940000 }], confirmedValue: [{ currency: 'USD', total: 12800 }],
      calls: { total: 152, manual: 72, ai: 80, connected: 61, manualConnected: 38, aiConnected: 23, rate: 61 / 152, agenciesReached: 44, talkSecs: 5400, interested: 9 },
      signups: { total: 9, agencies: 7, self: 3, desk: 4, internal: 2, pending: 2 },
      adoption: { activeAgencies: 11, agencyPrompts: 96, staffPrompts: 210, prompts: 306, aiUsers: 23, trips: 58 },
    },
    previous: {
      newQuotes: 24, amendments: 26, cohortConfirmed: 2, conversion: 2 / 24, agenciesQuotedFor: 15, agencyRaised: 8, staffRaised: 16, consultants: 6,
      confirmations: 3, quotedValue: [], confirmedValue: [],
      calls: { total: 130, manual: 60, ai: 70, connected: 52, manualConnected: 30, aiConnected: 22, rate: 0.4, agenciesReached: 40, talkSecs: 4000, interested: 6 },
      signups: { total: 6, agencies: 5, self: 2, desk: 3, internal: 1, pending: 1 },
      adoption: { activeAgencies: 9, agencyPrompts: 70, staffPrompts: 190, prompts: 260, aiUsers: 20, trips: 50 },
    },
    quotes,
    amendments: quotes.slice(0, 12).map((q, i) => ({ ref: q.ref, version: 2 + (i % 2), issuedAt: at(12 + (i % 6)), author: q.ownerName, authorEmail: q.ownerEmail, team: q.team, agency: q.agency, destination: q.destination, currency: q.currency, total: q.latestTotal, firstIssuedAt: '2026-10-20T06:00:00.000Z' })),
    calls: Array.from({ length: 40 }, (_, i) => ({ at: at(9 + (i % 10), i), source: i % 2 ? 'ai' as const : 'manual' as const, actor: people[i % people.length], actorEmail: `p${i % 7}@aahaas.com`, team: 'bangalore_b2b', agency: agencies[i % agencies.length], contact: `Contact ${i}`, outcome: i % 3 ? 'answered' : 'no_answer', connected: i % 3 !== 0, interested: i % 7 === 0, durationSecs: i % 2 ? 60 + i * 3 : null, campaign: i % 2 ? 'oct-reactivation' : null })),
    signups: [
      { at: at(10), name: 'Rahul Mehta', role: 'partner', audience: 'agency', agency: 'Wanderlust Tours', source: 'Onboarded by our team', onboardedBy: 'Abdul Hameed', status: 'active', team: 'bangalore_b2b' },
      { at: at(13), name: 'Priya Shah', role: 'partner', audience: 'agency', agency: 'Skyline Holidays', source: 'Registered themselves', onboardedBy: null, status: 'pending', team: null },
    ],
    onboarders: [{ name: 'Abdul Hameed', count: 3 }, { name: 'Prem Kumar', count: 1 }],
    destinations: dests.map((destination, i) => ({ destination, quotes: 9 - i, amendments: 6 - i, confirmed: i % 2, confirmations: i % 2, quotedValue: [{ currency: 'USD', total: 9000 - i * 900 }] })),
    agencies: agencies.map((agency, i) => ({ agency, team: 'bangalore_b2b', prompts: i === 4 ? 14 : 10 - i, aiUsers: 2, trips: 3, quotes: i === 4 ? 0 : 6 - i, byAgency: 2, byStaff: Math.max(0, 4 - i), amendments: 3, confirmed: i % 2, confirmations: i % 2, calls: 5, connected: 3 })),
    direct: { agency: 'Direct business (no agency)', team: null, prompts: 0, aiUsers: 0, trips: 0, quotes: 3, byAgency: 0, byStaff: 3, amendments: 1, confirmed: 0, confirmations: 0, calls: 0, connected: 0 },
    staff,
    teams: [
      { team: 'bangalore_b2b', label: 'Bangalore B2B Team', quotes: 21, amendments: 24, confirmations: 4, calls: 120, connected: 50, prompts: 230, signups: 5, people: 9 },
      { team: 'madurai_b2b', label: 'Madurai B2B Team', quotes: 7, amendments: 7, confirmations: 1, calls: 32, connected: 11, prompts: 76, signups: 2, people: 4 },
    ],
    activity: {
      axis: 'hour', labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
      lanes: ['New quotations', 'Amendments', 'Confirmations', 'Calls by our team', 'Calls by the AI', 'AI prompts', 'Signups'].map((label, k) => ({
        key: String(k), label, values: Array.from({ length: 24 }, (_, h) => (h >= 9 && h <= 19 ? Math.round(Math.abs(Math.sin(h + k)) * (k === 5 ? 40 : 8)) : 0)),
      })),
    },
  },
  highlights: [
    { severity: 'critical', title: '1 confirmation sold but not filed here', detail: 'Confirmed in the Apple System today with no booking in OPS yet: VN 41092. Sales that are not filed are not operated.' },
    { severity: 'good', title: 'Confirmed bookings up 29% vs the day before', detail: '18 now against 14 before.' },
    { severity: 'watch', title: '1 agency used the AI but got no quotation', detail: 'Pick Your Trail (14 prompts). Warm leads — a consultant can turn these into quotes.' },
    { severity: 'watch', title: '1 consultant with no recorded activity', detail: 'Sahana P — no quote, amendment, call or prompt today. On leave, or working outside the system?' },
  ],
  warnings: [],
}

const wb = await renderSalesWorkbook(data)
const html = renderSalesEmail(data, { maxRows: 30, workbookAttached: true, workbookSheets: wb.sheets, scheduleName: 'Daily Sales Report', dashboardUrl: 'https://ops.example/dashboard/reports/sales' })
writeFileSync(join(out, 'sales-email.html'), html)
writeFileSync(join(out, 'sales-report.xlsx'), wb.buffer)
console.log('subject ', renderSalesSubject(data))
console.log('html    ', `${(html.length / 1024).toFixed(1)} KB`, '(Gmail clips over ~102 KB)')
console.log('sheets  ', wb.sheets.join(', '))
console.log('written ', out)
