/**
 * Render check for the daily Operations Report email.
 *
 *   npx tsx scripts/daily-report-render.mts [yyyy-mm-dd] [outDir]
 *
 * The OPS database is not reachable from a laptop (Vercel holds that URL), so
 * the operational sections are stubbed with representative figures and the one
 * part that can be read for real — the Today new & updated / Old amendments
 * split, which comes from the accounts database over the read-only client — is
 * read for real. That is the half this script exists to check: the new ribbon
 * tiles, the New bookings card and its intake split, and the CSV header block.
 *
 * **Read-only.** Two SELECTs on the accounts database. Writes an .html and a
 * .csv to the output directory and nothing else; sends no mail.
 */
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

const { collectActivitySplit } = await import('../src/lib/reports/activity-split')
const { renderReportEmail, renderReportCsv, renderReportSubject } = await import('../src/lib/reports/report-html')
const { buildReportWindow, DEFAULT_REPORT_TZ } = await import('../src/lib/reports/report-window')
type ReportData = import('../src/lib/reports/report-data').ReportData

const arg = process.argv[2]
const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? '') ? arg : undefined
const outDir = path.resolve(process.argv[3] ?? '.render-check/daily-report')

const window = buildReportWindow('DAILY', DEFAULT_REPORT_TZ, new Date(), anchorDate)
const split = await collectActivitySplit(window)

if (!split.available) {
  console.error('accounts split unavailable:', split.error)
  process.exit(1)
}

// A representative stand-in for the OPS half of the mail, so the sections
// either side of the new ones still render and can be eyeballed in place.
const line = (ref: string, country: string, label: string) => ({
  bookingRef: ref, agent: 'Make My Trip', source: 'B2B' as const, country, countryLabel: label,
  status: 'DRAFT', arrivalDate: '2026-10-26', departureDate: '2026-11-05', pax: 2,
  paxAdults: 2, paxChildren: 0, paxInfants: 0, currency: 'USD', quotedTotal: 220,
  destination: null, createdAt: '2026-09-11T18:30:41.936Z', hotelOnly: false,
})

const bookings = [line('VN41915', 'VIETNAM', 'Vietnam'), line('VN41914', 'VIETNAM', 'Vietnam'), line('IS49091', 'SRI_LANKA', 'Sri Lanka')]

const data = {
  window,
  generatedAt: new Date().toISOString(),
  countries: [],
  created: {
    total: 74, pax: 208, channel: { b2b: 74, b2c: 0 },
    byCountry: [
      { country: 'VIETNAM', label: 'Vietnam', bookings: 61, pax: 174, b2b: 61, b2c: 0 },
      { country: 'SRI_LANKA', label: 'Sri Lanka', bookings: 13, pax: 34, b2b: 13, b2c: 0 },
    ],
    byCurrency: [{ currency: 'USD', total: 44421.72 }],
    byAgent: [{ agent: 'Make My Trip', bookings: 40, pax: 120 }, { agent: '30 SUNDAYS', bookings: 20, pax: 60 }],
    bookings, allBookings: bookings, previousTotal: 70,
    basis: 'apple', upstream: 74, cancelledUpstream: 0, missingRefs: [],
    outside: [], allOutside: [], sweptAt: new Date().toISOString(),
  },
  split: {
    available: true,
    todayCount: split.today.count,
    oldCount: split.old.count,
    oldBookings: split.old.bookings,
    oldest: split.old.lines.reduce<number | null>((m, l) => (l.ageDays !== null && (m === null || l.ageDays > m) ? l.ageDays : m), null),
    appleCount: 74,
    // Stubbed: resolving these needs the OPS database.
    origins: [
      { channel: 'APPLESYSTEM' as const, label: 'Apple System', bookings: Math.max(0, split.today.count - 5) },
      { channel: 'ONEDRIVE' as const, label: 'OneDrive', bookings: 3 },
      { channel: 'EMAIL' as const, label: 'Confirmation mail', bookings: 1 },
      { channel: 'MISSING' as const, label: 'Not filed here', bookings: 1 },
    ],
    held: split.today.count - 1,
    index: split.index,
  },
  parity: {
    available: true, source: 'ledger', upstreamConfirmed: 74, systemHeld: 74, missing: 0,
    missingRefs: [], inParity: true, createdByAutomation: 70, refreshed: 12, cancelled: 0,
    flagged: 0, errors: 0, runs: 96, lastRunAt: null, sweptAt: null, gaps: [], reconcileDays: [], cancellations: [], flaggedItems: [], errorItems: [], byDate: [],
  },
  countCheck: { available: false, channels: [], overall: {}, balanced: false, sweptAt: null, headline: '', intake: null, activity: null },
  onGround: { date: '2026-09-12', total: 130, pax: 326, arrivingToday: 12, departingToday: 9, byCountry: [], items: [], tours: [] },
  readiness: { total: 51, pax: 120, ready: 14, notReady: 37, tomorrow: 18, tomorrowNotReady: 11, hotelOnly: 2, pendingClient: 4, pendingDriver: 36, pendingTickets: 8, pendingQc: 3, items: [], byCountry: [], arrivals: [], bookings: [], tomorrowOutstanding: [] },
  reconfirm: { total: 76, breached: 76, unexplained: 12, explained: 64, stale: 3, items: [], bookings: [], breaches: [] },
  complaints: { available: true, total: 4, resolved: 4, open: 0, avgResolutionHours: 3.2, items: [], carriedOpen: [], byCountry: [], occurrences: [] },
  upcoming: { total: 1467, next7: 137, next30: 480, pax: 3800, byCountry: [], byMonth: [], imminent: [] },
  insights: null,
} as unknown as ReportData

// Only the sections this change touches are rendered: the rest need OPS rows
// that a laptop cannot read, and stubbing them would prove nothing.
const html = renderReportEmail(data, {
  scheduleName: 'Daily Operations Report',
  sections: { onGround: false, readiness: false, reconfirm: false, complaints: false, upcoming: false },
})
const csv = renderReportCsv(data)

await mkdir(outDir, { recursive: true })
await writeFile(path.join(outDir, 'daily-report.html'), html, 'utf8')
await writeFile(path.join(outDir, 'daily-report.csv'), csv, 'utf8')

console.log(`Window  : ${window.label}`)
console.log(`Subject : ${renderReportSubject(data)}`)
console.log(`Split   : today ${split.today.count} · old ${split.old.count} · apple 74`)
console.log(`Written : ${path.join(outDir, 'daily-report.html')}`)
console.log(`          ${path.join(outDir, 'daily-report.csv')}`)
console.log('\nCSV head:')
console.log(csv.split('\n').slice(0, 12).join('\n'))

process.exit(0)
