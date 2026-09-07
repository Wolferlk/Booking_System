/**
 * The weekly / monthly report workbook.
 *
 * ## Why the periodic reports attach this instead of a CSV
 *
 * The periodic mails print no individual bookings — see `period-html.ts` for
 * why. That only works if the rows land somewhere better, and a CSV is not
 * better: it is one flat file with `# heading` lines pretending to be sheets,
 * so a reader who wants the cancellations has to scroll past four hundred
 * bookings, and a reader who sorts one block destroys the others.
 *
 * A workbook gives every population its own tab, its own header row and its own
 * filter — and, crucially, room for a sentence at the top of each one saying
 * what the sheet holds and how its figures were derived. That sentence is the
 * point. A spreadsheet arriving in a manager's inbox with sixteen unlabelled
 * tabs is not detail, it is homework; the same file where every tab explains
 * itself is something a person can actually use on their own.
 *
 * ## The rules the sheets follow
 *
 *  - **One population per sheet.** Nothing on a sheet is a different kind of
 *    thing from the rest of it, so a column can always be summed.
 *  - **Row 1 names it, row 2 explains it, row 4 is the header, data from row 5.**
 *    Every sheet, without exception, so a reader learns the shape once.
 *  - **Numbers are written as numbers.** A count that arrives as text cannot be
 *    summed, and a report whose totals do not add up is not trusted twice.
 *  - **Money is never blended.** Currency is always its own column beside the
 *    amount, and no sheet totals across two of them.
 *  - **No styling.** SheetJS's community build writes none, so legibility comes
 *    from structure — sized columns, autofilters, one idea per sheet.
 */
import * as XLSX from 'xlsx'
import type { ReportData } from './report-data'
import type { PeriodInsights } from './period-insights'
import { PERIOD_LABEL, formatReportDate } from './report-window'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'

type Cell = string | number | null | undefined

interface SheetSpec {
  /** Tab name. Excel caps these at 31 characters. */
  name: string
  /** Row 1 — what the sheet is. */
  title: string
  /** Row 2 — what it holds and how it was derived. */
  description: string
  headers: string[]
  rows: Cell[][]
  widths?: number[]
  /** Printed under the table when there is nothing in it. */
  emptyNote?: string
}

/** Every sheet this workbook can contain, with the line the email quotes back. */
export const SHEET_GUIDE: { name: string; what: string }[] = [
  { name: 'Contents', what: 'This page — what every other sheet holds, and the rules they all follow.' },
  { name: 'Scorecard', what: 'The headline figures with the previous period beside them, and the change between.' },
  { name: 'Trend', what: 'Intake by day (weekly) or week (monthly), against the arrivals and departures it produced.' },
  { name: 'Countries', what: 'Every market: this period, last period, the change, and the guests behind it.' },
  { name: 'Agents', what: 'Every partner on the same basis — including the ones who booked nothing this period.' },
  { name: 'Value', what: 'Quoted value by currency, never blended, with the average per booking.' },
  { name: 'Bookings', what: 'Every booking the period counted, one row each. The population every figure in the email is drawn from.' },
  { name: 'Not Counted', what: 'Filed in this period against an earlier confirmation, plus confirmations that never arrived. Deliberately excluded from every count.' },
  { name: 'Cancellations', what: 'Everything withdrawn during the period, with the notice given, the reason recorded and the fee.' },
  { name: 'Operated', what: 'Every tour that was on the ground for at least one day of the period, with the guest-days it contributed.' },
  { name: 'On Ground', what: 'Tours in-country on the morning the report was written.' },
  { name: 'Arrivals 3 Days', what: 'The next three days of arrivals with their readiness checklist resolved — the live chase list.' },
  { name: 'Reconfirmation', what: `Everything travelling inside D-${RECONFIRM_DUE_DAYS} that is past its guest-reconfirmation deadline, with the reason recorded.` },
  { name: 'Complaints', what: 'One row per issue, not per call, with the recurrence trail and the resolution.' },
  { name: 'Forward Book', what: 'Everything already sold and not yet travelled, by arrival month.' },
  { name: 'Count Check', what: 'Upstream against bookings, P&Ls and invoices, as the accounts ledger holds it.' },
  { name: 'AS Parity', what: 'AppleSystem confirmations against what this system received, day by day.' },
]

// ─── Sheet construction ───────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

function yesNo(v: boolean): string {
  return v ? 'Yes' : 'No'
}

function addSheet(wb: XLSX.WorkBook, spec: SheetSpec): void {
  const aoa: Cell[][] = [
    [spec.title],
    [spec.description],
    [],
    spec.headers,
    ...(spec.rows.length ? spec.rows : [[spec.emptyNote ?? 'Nothing in this period.']]),
  ]

  const ws = XLSX.utils.aoa_to_sheet(aoa as unknown[][])
  const cols = spec.headers.length

  ws['!cols'] = spec.headers.map((h, idx) => ({ wch: spec.widths?.[idx] ?? Math.min(40, Math.max(11, h.length + 3)) }))

  // The title and the description read as a heading rather than as data in A1.
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(0, cols - 1) } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: Math.max(0, cols - 1) } },
  ]
  ws['!rows'] = [{ hpt: 22 }, { hpt: 30 }]

  // Frozen panes are deliberately not attempted: the community build writes no
  // pane element, so the setting would be silently dropped. The autofilter is
  // what actually lands, and it is what a reader re-slicing the sheet needs.
  if (spec.rows.length) {
    ws['!autofilter'] = {
      ref: XLSX.utils.encode_range(
        { s: { r: 3, c: 0 }, e: { r: 3 + spec.rows.length, c: Math.max(0, cols - 1) } },
      ),
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, spec.name.slice(0, 31))
}

// ─── The workbook ─────────────────────────────────────────────────────────────

export function reportWorkbookSheets(d: ReportData): string[] {
  // Names in the order `renderReportWorkbook` appends them, so the email's
  // footer chips and the file's tabs cannot disagree.
  const names = ['Contents', 'Scorecard', 'Trend', 'Countries', 'Agents', 'Value', 'Bookings']
  if (d.created.allOutside.length || d.created.missingRefs.length) names.push('Not Counted')
  if (d.insights?.cancellations.available) names.push('Cancellations')
  if (d.insights?.delivery.available) names.push('Operated')
  names.push('On Ground', 'Arrivals 3 Days')
  if (d.reconfirm.breached) names.push('Reconfirmation')
  if (d.complaints.available) names.push('Complaints')
  names.push('Forward Book')
  if (d.countCheck.available) names.push('Count Check')
  if (d.parity.available) names.push('AS Parity')
  return names
}

export function renderReportWorkbook(d: ReportData): Buffer {
  const i: PeriodInsights | null = d.insights
  const wb = XLSX.utils.book_new()
  const periodWord = d.window.period === 'MONTHLY' ? 'month' : 'week'
  const included = new Set(reportWorkbookSheets(d))

  wb.Props = {
    Title: `Apple Holidays — ${PERIOD_LABEL[d.window.period]} Business Review`,
    Subject: `${d.window.fromDate} to ${d.window.toDate}`,
    Author: 'Apple Holidays MMT',
    CreatedDate: new Date(d.generatedAt),
  }

  // ── Contents ───────────────────────────────────────────────────────────────
  // First tab on purpose: the file is opened by people who did not ask for it,
  // and a workbook that cannot explain itself gets closed again.
  addSheet(wb, {
    name: 'Contents',
    title: `APPLE HOLIDAYS — ${PERIOD_LABEL[d.window.period].toUpperCase()} BUSINESS REVIEW`,
    description:
      `${d.window.label} · ${d.window.fromDate} to ${d.window.toDate} · times in ${d.window.timezone} · `
      + `generated ${fmtStamp(d.generatedAt)} UTC · `
      + (d.countries.length ? `scoped to ${d.countries.map(c => c.replace(/_/g, ' ')).join(', ')}` : 'all operating countries'),
    headers: ['Sheet', 'What it holds'],
    widths: [20, 118],
    rows: [
      ...SHEET_GUIDE.filter(s => included.has(s.name)).map(s => [s.name, s.what]),
      [],
      ['HOW TO READ THIS FILE', ''],
      ['Counted population', d.created.basis === 'apple'
        ? `Every figure counts the ${d.created.total} bookings AppleSystem confirmed inside the period — the same population the accounts invoice and P&L mails report. A booking filed here in the period against an earlier confirmation is on "Not Counted".`
        : `The accounts Sync Ledger could not be read, so the period counts the ${d.created.total} bookings this system filed. These figures may not match the accounts mails.`],
      ['Comparisons', i?.comparable
        ? `Every "previous" column is ${i.previousLabel}, counted exactly the same way. A change between two differently-counted populations is not a trend, so where the previous period could not be counted on the same basis the columns are left blank rather than filled.`
        : 'The previous period could not be counted on the same basis, so change columns are blank on every sheet.'],
      ['Money', 'Never blended across currencies. Currency is always its own column; no sheet totals two of them together.'],
      ['Dates', `Business days in ${d.window.timezone}, not server time. A booking filed at 23:40 UTC belongs to the next morning here.`],
      ['Forward-looking sheets', `"Arrivals 3 Days", "Reconfirmation" and "Forward Book" describe the position as at ${d.onGround.date} — the morning after the ${periodWord} closed — not the ${periodWord} itself. They are the only sheets that can still be acted on.`],
      ['Row counts', 'Every sheet carries its full population. Nothing here is capped for size — the email is where the summary lives.'],
    ] as Cell[][],
  })

  // ── Scorecard ──────────────────────────────────────────────────────────────
  const scorecardRows: Cell[][] = []
  const line = (measure: string, current: Cell, previous: Cell, note: string) => {
    const change = typeof current === 'number' && typeof previous === 'number' ? current - previous : ''
    const pct = typeof current === 'number' && typeof previous === 'number' && previous > 0
      ? Math.round(((current - previous) / previous) * 1000) / 10
      : ''
    scorecardRows.push([measure, current ?? '', previous ?? '', change, pct, note])
  }

  if (i) {
    line('Bookings confirmed', i.totals.bookings, i.comparable ? i.totals.previousBookings : '', 'The period\'s intake, counted on the basis named on Contents.')
    line('Guests booked', i.totals.pax, i.comparable ? i.totals.previousPax : '', 'Adults + children + infants across those bookings.')
    line('B2B bookings', i.totals.channel.b2b, i.comparable ? i.totals.previousChannel.b2b : '', 'Trade bookings, derived from the agent on the file.')
    line('B2C bookings', i.totals.channel.b2c, i.comparable ? i.totals.previousChannel.b2c : '', 'Direct storefront orders.')
    line('Average party size', i.totals.avgPartySize ?? '', i.totals.previousAvgPartySize ?? '', 'Guests per booking.')
    line('Average lead time (days)', i.leadTime.avgDays ?? '', i.leadTime.previousAvgDays ?? '', 'Days between filing the booking and the guest arriving. Falling means the book is being written later.')
    line('Bookings per day', i.runRate.current ?? '', i.runRate.previous ?? '', 'Run rate across the period.')
    line('Tours operated', i.delivery.toursOperated, '', 'Tours on the ground for at least one day of the period, including ones that started before it.')
    line('Tours started', i.delivery.arrivals, i.delivery.previousArrivals, 'Arrivals inside the period.')
    line('Guest-days delivered', i.delivery.guestDays, '', 'Days on the ground inside the period × party size. The workload measure a tour count cannot give.')
    line('Cancellations', i.cancellations.total, i.cancellations.previousTotal, `${i.cancellations.shortNotice} of them with a week or less to arrival.`)
    line('Cancellation rate (%)', i.cancellations.ratePct ?? '', '', 'Cancellations as a share of everything the period took.')
    line('Complaints raised', i.quality.complaints, i.quality.previousComplaints ?? '', 'Distinct issues — repeat calls about one problem count once.')
    line('Complaints per 100 tours', i.quality.per100Tours ?? '', '', 'Volume-adjusted, so a busy period is judged fairly.')
    line('Complaints resolved (%)', i.quality.resolvedPct ?? '', '', i.quality.avgResolutionHours !== null ? `Average ${i.quality.avgResolutionHours} hours to resolve.` : '')
    line(`D-${RECONFIRM_DUE_DAYS} compliance (%)`, i.quality.reconfirmCompliancePct ?? '', '', `Live standing as at ${d.onGround.date}: guests inside D-${RECONFIRM_DUE_DAYS} who are not late. ${i.quality.unexplainedBreaches} breaches have no reason recorded.`)
    line('Arrivals ready (%)', i.quality.readinessPct ?? '', '', 'Of the next three days of arrivals, the share with nothing outstanding.')
    line('AppleSystem confirmations missing', i.integrity.parityMissing, '', 'Confirmed upstream, never received here. Anything above zero means the figures above understate the period.')
    line('Count check shortfall', i.integrity.countCheckShort, '', 'Bookings, P&Ls and invoices owed but not present, per the accounts ledger.')
    line('Forward book', d.upcoming.total, '', `${d.upcoming.next30} of them arriving within 30 days.`)
  }

  addSheet(wb, {
    name: 'Scorecard',
    title: 'SCORECARD',
    description: `Every headline figure with ${i?.comparable ? i.previousLabel : 'the previous period'} beside it. Change is this period minus last; a blank previous column means the two could not be counted the same way.`,
    headers: ['Measure', 'This period', 'Previous', 'Change', 'Change %', 'What it means'],
    widths: [34, 14, 12, 10, 11, 96],
    rows: scorecardRows,
    emptyNote: 'Period analytics were unavailable for this run.',
  })

  // ── Trend ──────────────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Trend',
    title: `INTAKE BY ${i?.granularity === 'week' ? 'WEEK' : 'DAY'}`,
    description: 'Booked counts a confirmation against the day it was filed here; arrived and departed count tours by their travel dates. The gap between the two columns is the lead time — the period you sell is not the period you fly.',
    headers: [i?.granularity === 'week' ? 'Week starting' : 'Date', 'Label', 'Bookings', 'Guests booked', 'Tours arrived', 'Tours departed'],
    widths: [15, 20, 11, 14, 14, 15],
    rows: (i?.series ?? []).map(p => [p.key, p.label, p.bookings, p.pax, p.arrivals, p.departures]),
  })

  // ── Countries ──────────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Countries',
    title: 'MARKETS',
    description: `Every market that booked in this period or the last one. A market with bookings last period and none this one is kept deliberately — a row that disappears is a fall nobody notices.`,
    headers: ['Country', 'Bookings', 'Guests', 'Previous', 'Change', 'Change %', 'Status'],
    widths: [26, 11, 10, 11, 10, 11, 14],
    rows: (i?.countryMovers ?? []).map(m => [
      m.label, m.current, m.pax, i?.comparable ? m.previous : '', i?.comparable ? m.delta : '', m.pct ?? '',
      m.isNew ? 'New' : m.isLost ? 'Went quiet' : '',
    ]),
  })

  // ── Agents ─────────────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Agents',
    title: 'PARTNERS',
    description: 'Every partner and channel, this period against last. Spelling variants of one partner ("MMT" / "Make My Trip") are merged into a single row. Partners who booked last period and nothing this one are kept — they are the calls worth making.',
    headers: ['Agent / channel', 'Bookings', 'Guests', 'Previous', 'Change', 'Change %', 'Status'],
    widths: [38, 11, 10, 11, 10, 11, 14],
    rows: (i?.agentMovers ?? []).map(m => [
      m.label, m.current, m.pax, i?.comparable ? m.previous : '', i?.comparable ? m.delta : '', m.pct ?? '',
      m.isNew ? 'New this period' : m.isLost ? 'Went quiet' : '',
    ]),
  })

  // ── Value ──────────────────────────────────────────────────────────────────
  const valueRows: Cell[][] = []
  for (const c of d.created.byCurrency) {
    const quoted = d.created.allBookings.filter(b => b.currency === c.currency && b.quotedTotal !== null)
    const prev = i?.totals.previousByCurrency.find(p => p.currency === c.currency)
    valueRows.push([
      c.currency,
      Math.round(c.total * 100) / 100,
      quoted.length,
      quoted.length ? Math.round((c.total / quoted.length) * 100) / 100 : '',
      i?.comparable && prev ? Math.round(prev.total * 100) / 100 : '',
    ])
  }
  for (const c of i?.cancellations.byCurrency ?? []) {
    valueRows.push([`${c.currency} — withdrawn by cancellation`, Math.round(c.total * 100) / 100, i?.cancellations.total ?? '', '', ''])
  }
  for (const c of i?.cancellations.feesByCurrency ?? []) {
    valueRows.push([`${c.currency} — cancellation fees recorded`, Math.round(c.total * 100) / 100, '', '', ''])
  }

  addSheet(wb, {
    name: 'Value',
    title: 'QUOTED VALUE BY CURRENCY',
    description: 'Never blended: each currency is its own row, and no cell here totals two of them. "Bookings quoted" is how many of the period\'s bookings carried a quoted total at all — the average is over those, not over every booking.',
    headers: ['Currency', 'Quoted total', 'Bookings quoted', 'Average per booking', 'Previous period total'],
    widths: [38, 16, 16, 20, 20],
    rows: valueRows,
    emptyNote: 'No quoted value was recorded against this period\'s bookings.',
  })

  // ── Bookings ───────────────────────────────────────────────────────────────
  const bookingHeaders = [
    'Booking ref', 'Channel', 'Country', 'Agent', 'Status', 'Booking type',
    'Arrival', 'Departure', 'Nights', 'Adults', 'Children', 'Infants', 'Total pax',
    'Currency', 'Quoted total', 'Destination', 'Filed at', 'Lead time (days)',
  ]
  const bookingWidths = [16, 9, 20, 30, 16, 13, 12, 12, 8, 8, 9, 8, 10, 9, 14, 30, 17, 15]
  const nights = (a: string, b: string) => {
    if (!a || !b) return ''
    const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
    return isNaN(days) ? '' : days
  }
  const bookingRow = (b: ReportData['created']['allBookings'][number]): Cell[] => [
    b.bookingRef, b.source, b.countryLabel, b.agent ?? '', b.status, b.hotelOnly ? 'Hotel only' : 'Full tour',
    b.arrivalDate, b.departureDate, nights(b.arrivalDate, b.departureDate),
    b.paxAdults, b.paxChildren, b.paxInfants, b.pax,
    b.currency, b.quotedTotal ?? '', b.destination ?? '', fmtStamp(b.createdAt),
    nights(fmtDate(b.createdAt), b.arrivalDate),
  ]

  addSheet(wb, {
    name: 'Bookings',
    title: 'BOOKINGS COUNTED IN THIS PERIOD',
    description: d.created.basis === 'apple'
      ? 'Every booking AppleSystem confirmed inside the period — the exact population every figure in the email is drawn from, so this sheet\'s row count is the email\'s headline number. Lead time is the days between filing and arrival.'
      : 'Every booking this system filed inside the period. The accounts ledger could not be read, so this could not be cut to AppleSystem\'s own confirmations.',
    headers: bookingHeaders,
    widths: bookingWidths,
    rows: d.created.allBookings.map(bookingRow),
  })

  // ── Not counted ────────────────────────────────────────────────────────────
  if (included.has('Not Counted')) {
    const rows: Cell[][] = [
      ...d.created.allOutside.map(b => ['Filed here, confirmed earlier', ...bookingRow(b)] as Cell[]),
      ...d.created.missingRefs.map(ref => ['Confirmed upstream, never filed here', ref, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''] as Cell[]),
    ]
    addSheet(wb, {
      name: 'Not Counted',
      title: 'DELIBERATELY NOT COUNTED',
      description: 'Two populations the period touched but does not count. Rows filed here against an earlier confirmation are real work belonging to another period. Rows confirmed upstream with nothing filed here are the ones to chase — until they are filed, this period is understated by that many.',
      headers: ['Why it is not counted', ...bookingHeaders],
      widths: [34, ...bookingWidths],
      rows,
    })
  }

  // ── Cancellations ──────────────────────────────────────────────────────────
  if (included.has('Cancellations') && i) {
    addSheet(wb, {
      name: 'Cancellations',
      title: 'CANCELLATIONS',
      description: 'Every booking withdrawn during the period, by the date it was cancelled. Notice is the days between the cancellation and the arrival it was booked for — a negative number means it was cancelled after the guest was due. "No reason recorded" is a finding, not a gap.',
      headers: [
        'Booking ref', 'Channel', 'Country', 'Agent', 'Arrival', 'Notice (days)',
        'Total pax', 'Currency', 'Quoted total', 'Fee recorded', 'Cancelled at', 'Cancelled by', 'Reason',
      ],
      widths: [16, 9, 20, 30, 12, 14, 10, 9, 14, 14, 17, 24, 70],
      rows: i.cancellations.lines.map(c => [
        c.bookingRef, c.source, c.countryLabel, c.agent ?? '', c.arrivalDate, c.noticeDays ?? '',
        c.pax, c.currency, c.quotedTotal ?? '', c.feeTotal ?? '', fmtStamp(c.cancelledAt),
        c.cancelledBy ?? '', c.reason ?? 'No reason recorded',
      ]),
      emptyNote: 'Nothing was cancelled in this period.',
    })
  }

  // ── Operated ───────────────────────────────────────────────────────────────
  if (included.has('Operated') && i) {
    addSheet(wb, {
      name: 'Operated',
      title: 'TOURS THAT OPERATED IN THIS PERIOD',
      description: 'Every tour on the ground for at least one day of the period, including ones that started before it or ran past it — those are marked "straddles". Days in period counts only the days inside the window, so the guest-days column sums to the figure in the email without double-counting a tour the report either side of this one also carries.',
      headers: [
        'Booking ref', 'Channel', 'Country', 'Agent', 'Booking type', 'Arrival', 'Departure',
        'Days in period', 'Total pax', 'Guest-days in period', 'Straddles period', 'Status',
      ],
      widths: [16, 9, 20, 30, 13, 12, 12, 15, 10, 21, 17, 16],
      rows: i.delivery.lines.map(l => [
        l.bookingRef, l.source, l.countryLabel, l.agent ?? '', l.hotelOnly ? 'Hotel only' : 'Full tour',
        l.arrivalDate, l.departureDate, l.daysInPeriod, l.pax, l.guestDaysInPeriod,
        yesNo(l.straddles), l.status,
      ]),
      emptyNote: 'No tours were on the ground in this period.',
    })
  }

  // ── On ground ──────────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'On Ground',
    title: `TOURS IN COUNTRY — ${d.onGround.date}`,
    description: `A live position as at the morning the report was written, not the period it covers. Day shows how far into the tour each file is: "3 of 9" is a tour on its third day.`,
    headers: ['Booking ref', 'Channel', 'Country', 'Lead guest', 'Booking type', 'Day', 'Of', 'Arrival', 'Departure', 'Total pax', 'Status'],
    widths: [16, 9, 20, 28, 13, 7, 7, 12, 12, 10, 16],
    rows: d.onGround.tours.map(t => [
      t.bookingRef, t.source, t.countryLabel, t.leadPassenger ?? '', t.hotelOnly ? 'Hotel only' : 'Full tour',
      t.dayNo, t.totalDays, t.arrivalDate, t.departureDate, t.pax, t.status,
    ]),
    emptyNote: 'No tours were in country on this date.',
  })

  // ── Readiness ──────────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Arrivals 3 Days',
    title: `ARRIVALS ${d.readiness.fromDate} TO ${d.readiness.toDate} — READINESS`,
    description: 'The live chase list, as at the morning after the period closed. "Ready" means nothing on the checklist is outstanding; a Hotel Only file waives the itinerary rungs, which is why its checks read N/A rather than failing.',
    headers: [
      'Booking ref', 'Channel', 'Country', 'Lead guest', 'Booking type', 'Arrival', 'Days away', 'Total pax', 'Status',
      'Ready', 'Blocking', 'Client confirmed', 'Drivers', 'Tickets', 'QC', 'Outstanding', 'D-10 reason recorded',
    ],
    widths: [16, 9, 20, 28, 13, 12, 11, 10, 16, 8, 34, 16, 26, 26, 16, 40, 40],
    rows: d.readiness.bookings.map(b => [
      b.bookingRef, b.source, b.countryLabel, b.leadPassenger ?? '', b.hotelOnly ? 'Hotel only' : 'Full tour',
      b.arrivalDate, b.daysToArrival, b.pax, b.status,
      yesNo(b.readiness.ready), b.readiness.blocking.join('; '),
      b.readiness.client.state === 'DONE' ? 'Yes' : 'No',
      b.readiness.driver.detail, b.readiness.tickets.detail, b.readiness.qc.short,
      b.readiness.outstanding.join('; '),
      b.delay ? `${b.delay.reasonLabel}${b.delay.note ? ` — ${b.delay.note}` : ''}` : '',
    ]),
    emptyNote: 'Nothing arrives in the next three days.',
  })

  // ── Reconfirmation ─────────────────────────────────────────────────────────
  if (included.has('Reconfirmation')) {
    addSheet(wb, {
      name: 'Reconfirmation',
      title: `GUEST RECONFIRMATION — PAST D-${RECONFIRM_DUE_DAYS}`,
      description: `Every booking arriving within ${RECONFIRM_DUE_DAYS} days whose guest has still not been reconfirmed. The reason column carries the desk's own words, unedited — a blank one is the finding, because nobody has said why. Days late counts from the D-${RECONFIRM_DUE_DAYS} deadline, not from arrival.`,
      headers: [
        'Booking ref', 'Channel', 'Country', 'Lead guest', 'Arrival', `D-${RECONFIRM_DUE_DAYS} due`, 'Days late',
        'Total pax', 'Status', 'Client confirmed', 'Pre-tour call', 'Reason', 'Detail', 'Recorded by', 'Recorded on', 'Reason age (days)', 'Stale',
      ],
      widths: [16, 9, 20, 28, 12, 12, 10, 10, 16, 16, 14, 26, 60, 24, 14, 16, 8],
      rows: d.reconfirm.bookings.map(b => [
        b.bookingRef, b.source, b.countryLabel, b.leadPassenger ?? '', b.arrivalDate, b.dueAt, b.daysLate,
        b.pax, b.status, yesNo(b.clientConfirmed), yesNo(b.preTourCalled),
        b.delay?.reasonLabel ?? 'NO REASON RECORDED', b.delay?.note ?? '', b.delay?.recordedBy ?? '',
        fmtDate(b.delay?.recordedAt), b.delay?.ageDays ?? '', b.delay?.stale ? 'Yes' : '',
      ]),
    })
  }

  // ── Complaints ─────────────────────────────────────────────────────────────
  if (included.has('Complaints')) {
    addSheet(wb, {
      name: 'Complaints',
      title: 'COMPLAINTS',
      description: 'One row per issue, not per call. A guest raising the same problem three times is one row with "Times raised" of 3 — the individual call timestamps are in the trail column. Rows marked carried were raised before this period and are still open.',
      headers: [
        'First raised', 'Last raised', 'Times raised', 'From this period', 'Booking ref', 'Customer', 'Country',
        'Category', 'Severity', 'Status', 'Title', 'Details', 'Guest words', 'Resolution', 'Resolved at', 'Hours to resolve', 'Call trail',
      ],
      widths: [17, 17, 13, 17, 16, 26, 20, 22, 10, 11, 40, 60, 50, 50, 17, 16, 44],
      rows: [
        ...d.complaints.items.map(c => complaintRow(c, 'This period')),
        ...d.complaints.carriedOpen.map(c => complaintRow(c, 'Carried, still open')),
      ],
      emptyNote: 'No complaints were raised in this period.',
    })
  }

  // ── Forward book ───────────────────────────────────────────────────────────
  addSheet(wb, {
    name: 'Forward Book',
    title: 'FORWARD BOOK BY ARRIVAL MONTH',
    description: `Everything sold and not yet travelled, as at ${d.onGround.date}. This is the only sheet describing the future rather than the period just closed.`,
    headers: ['Arrival month', 'Tours', 'Guests', 'Share of book (%)'],
    widths: [18, 11, 11, 18],
    rows: d.upcoming.byMonth.map(m => [
      m.label, m.bookings, m.pax,
      d.upcoming.total ? Math.round((m.bookings / d.upcoming.total) * 1000) / 10 : '',
    ]),
    emptyNote: 'Nothing is on the forward book.',
  })

  // ── Count check ────────────────────────────────────────────────────────────
  if (included.has('Count Check')) {
    const rows: Cell[][] = [...d.countCheck.channels, { ...d.countCheck.overall, label: 'Both businesses' }].map(t => [
      t.label, t.upstream, t.cancelled, t.notBillable, t.bookings, t.pnls, t.invoices,
      t.pnlShort, t.invoiceShort, t.bookingShort, t.status, fmtStamp(t.checkedAt) || 'never swept',
    ])

    if (d.countCheck.intake) {
      const n = d.countCheck.intake
      rows.push([])
      rows.push(['HOW THIS REPORT\'S INTAKE MEETS THE CONFIRMATIONS'])
      rows.push(['Created here, confirmed upstream in this period', n.matched])
      rows.push(['Created here against an earlier confirmation', n.earlierConfirmations])
      rows.push(['Confirmed in this period, filed here after midnight', n.enteredLater])
      rows.push(['Confirmed upstream, nothing here', n.missing])
      for (const ref of n.missingRefs) rows.push(['  → missing reference', ref])
    }

    addSheet(wb, {
      name: 'Count Check',
      title: 'COUNT CHECK — UPSTREAM vs OPS vs P&L vs INVOICE',
      description: 'Read from the accounts Sync Ledger, so this sheet and the accounts mails cannot quote different figures for the same period. One booking counts once; a booking cancelled upstream is not owed an invoice; a period nobody swept reads "never swept" rather than "balanced".',
      headers: ['Business', 'Upstream', 'Cancelled upstream', 'Settle to zero', 'OPS bookings', 'P&Ls', 'Invoices', 'P&L short', 'Invoice short', 'OPS short', 'Status', 'Last checked'],
      widths: [30, 11, 18, 15, 14, 9, 11, 12, 14, 12, 22, 18],
      rows,
    })
  }

  // ── Parity ─────────────────────────────────────────────────────────────────
  if (included.has('AS Parity')) {
    const rows: Cell[][] = d.parity.byDate.map(b => [b.date, b.upstreamConfirmed, b.systemHeld, b.missing, ''])
    if (d.parity.gaps.length) {
      rows.push([])
      rows.push(['CONFIRMATIONS MISSING FROM THIS SYSTEM'])
      for (const g of d.parity.gaps) rows.push([g.date, '', '', 1, g.ref])
    }
    if (d.parity.cancellations.length) {
      rows.push([])
      rows.push(['WITHDRAWN UPSTREAM AND CANCELLED HERE BY THE RECONCILER'])
      for (const c of d.parity.cancellations) rows.push([fmtDate(c.at), '', '', '', `${c.ref} — was ${c.prevStatus}, upstream ${c.upstreamStatus}`])
    }

    addSheet(wb, {
      name: 'AS Parity',
      title: 'APPLESYSTEM PARITY BY CONFIRMATION DATE',
      description: `The two counts that must be equal: what AppleSystem confirmed, and what this system holds. Source: ${
        d.parity.source === 'live' ? 'asked of AppleSystem while this report was written' : 'the last reconciliation, because AppleSystem could not be reached'
      }.${d.parity.note ? ` ${d.parity.note}` : ''}`,
      headers: ['Confirmation date', 'Confirmed in AppleSystem', 'Held in this system', 'Missing', 'Reference'],
      widths: [20, 26, 22, 12, 56],
      rows,
    })
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** Complaint columns, shared by the two blocks of the complaints sheet. */
function complaintRow(c: ReportData['complaints']['items'][number], origin: string): Cell[] {
  return [
    fmtStamp(c.createdAt), fmtStamp(c.lastRaisedAt), c.occurrences, origin,
    c.bookingRef ?? '', c.customerName ?? '', c.countryLabel,
    c.categories.join(' | '), c.severity, c.status,
    c.title ?? '', c.details ?? '', c.customerQuote ?? '', c.resolutionNote ?? '',
    fmtStamp(c.resolvedAt), c.resolutionHours ?? '',
    c.trail.map(t => fmtStamp(t.createdAt)).join(' | '),
  ]
}
