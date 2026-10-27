/**
 * The Daily Sales Report workbook — the attachment on the sales mail.
 *
 * Same house style as the Ops workbooks (`@/lib/excel-kit`): an Overview
 * dashboard first, then one population per tab, each with the same shape —
 * row 1 names it, row 2 says what it holds and how it was counted, row 3 its
 * totals, row 4 the frozen, filterable header, data from row 5 and a live
 * SUBTOTAL footer that follows a filter.
 *
 * The mail is the story; this is every row behind it. Nothing here computes a
 * figure the data layer did not — the sheets are the same arrays, laid flat.
 */
import { formatReportDate } from './report-window'
import type { MoneyByCurrency } from './booking-lines'
import type { SalesReportData } from './sales-report-data'
import { teamLabel, type AgencyRow, type AmendmentRow, type CallRow, type QuoteRow, type SignupRow, type StaffRow } from './sales-pipeline-data'
import type { BookingLine } from './booking-lines'
import { P, Canvas, SheetPlan, newWorkbook, daysBetween, type Col } from '@/lib/excel-kit'

const moneyText = (list: MoneyByCurrency[], max = 4) =>
  list.length ? list.slice(0, max).map(m => `${m.currency} ${Math.round(m.total).toLocaleString('en-US')}`).join(' · ') : '—'

const STATUS_WORD: Record<string, string> = {
  pending: 'Pending', follow_up: 'Follow-up', confirmed: 'Confirmed', cancelled: 'Cancelled', lost: 'Lost',
}
const word = (s: string | null | undefined) => (s ? STATUS_WORD[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '')
const CREATED_BY: Record<string, string> = { staff: 'Our team', agency: 'Agency', unattributed: 'Unattributed' }

/** The currencies worth a column of their own: the three biggest by total. */
function topCurrencies(lists: MoneyByCurrency[][], n = 3): string[] {
  const sum = new Map<string, number>()
  lists.flat().forEach(m => sum.set(m.currency, (sum.get(m.currency) ?? 0) + m.total))
  return Array.from(sum.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c)
}
const amountIn = (list: MoneyByCurrency[], c: string) => list.find(m => m.currency === c)?.total ?? null

// ─── Overview ─────────────────────────────────────────────────────────────────

function overview(wb: ReturnType<typeof newWorkbook>, d: SalesReportData, index: { name: string; what: string; tab: string }[]) {
  const cv = new Canvas(wb, 'Overview', { tab: P.indigo, width: 12, firstCol: 34, colWidth: 12 })
  const c = d.pipeline.counts
  const pv = d.pipeline.previous
  const p = d.pipeline.available
  const scope = [
    d.countries.length ? `Bookings: ${d.countries.join(', ')}` : 'Bookings: all countries',
    d.pipeline.team ? `Travel Quote GPT: ${d.pipeline.team.label}` : 'Travel Quote GPT: every team',
  ].join(' · ')
  cv.banner('AppleHolidays Sales', d.window.custom && d.window.days > 1 ? 'Sales Report' : 'Daily Sales Report',
    `${d.window.label} · compared with ${d.window.previous.label} · ${scope} · times in ${d.window.timezone}`)

  cv.tiles([
    { label: 'B2C store orders', value: d.store.available ? d.store.orders : '—', note: moneyText(d.store.value, 2), color: P.pink },
    { label: 'B2C bookings filed', value: d.bookings.total, note: `${d.bookings.pax} guests`, color: P.b2b },
    { label: 'Quotations', value: p ? c.newQuotes : '—', note: p ? `${c.amendments} amendments` : 'unavailable', color: P.indigo },
    { label: 'Confirmed quotes', value: p ? c.confirmations : '—', note: p && c.conversion !== null ? `${Math.round(c.conversion * 100)}% of quoted` : '', color: P.blue },
    { label: 'Calls', value: p ? c.calls.total : '—', note: p && c.calls.rate !== null ? `${Math.round(c.calls.rate * 100)}% answered` : '', color: P.amber },
    { label: 'New agencies', value: p ? c.signups.agencies : '—', note: p ? `${c.signups.desk} onboarded by us` : '', color: P.pink },
  ])

  cv.title('This period against the last', `Previous = ${d.window.previous.label}. Change is the plain difference; a dash means the comparison could not be read.`)
  cv.header(['Measure', 'Now', 'Before', 'Change', 'Source'])
  const line = (label: string, now: number | null, before: number | null | undefined, source: string) =>
    cv.line([label, now, before ?? null, now !== null && before !== null && before !== undefined ? now - before : null, source], { deltaCols: [4] })
  line('B2C store orders', d.store.available ? d.store.orders : null, d.store.previousOrders, 'Aahaas store')
  line('B2C bookings filed', d.bookings.available ? d.bookings.total : null, d.bookings.previousTotal, 'Booking system')
  if (p) {
    line('New quotations', c.newQuotes, pv?.newQuotes, 'Travel Quote GPT')
    line('Amendments', c.amendments, pv?.amendments, 'Travel Quote GPT')
    line('Quotes confirmed', c.confirmations, pv?.confirmations, 'Travel Quote GPT')
    line('Agencies quoted for', c.agenciesQuotedFor, pv?.agenciesQuotedFor, 'Travel Quote GPT')
    line('Calls made', c.calls.total, pv?.calls.total, 'Travel Quote GPT')
    line('Calls answered', c.calls.connected, pv?.calls.connected, 'Travel Quote GPT')
    line('New agencies', c.signups.agencies, pv?.signups.agencies, 'Travel Quote GPT')
    line('Agencies using the AI', c.adoption.activeAgencies, pv?.adoption.activeAgencies, 'Travel Quote GPT')
    line('AI prompts', c.adoption.prompts, pv?.adoption.prompts, 'Travel Quote GPT')
  }
  cv.gap()

  cv.title('Money, by currency', 'Never added across currencies.')
  cv.header(['What', 'Value'])
  cv.line(['Aahaas B2C store sales', moneyText(d.store.value)])
  cv.line(['Value of B2C bookings filed', moneyText(d.bookings.value)])
  if (p) {
    cv.line(['Quoted on new quotations', moneyText(c.quotedValue)])
    cv.line(['Confirmed quotations', moneyText(c.confirmedValue)])
  }
  cv.gap()

  cv.title('Where to look', 'Derived from the figures by fixed rules — no AI decides what matters.')
  for (const h of d.highlights) cv.callout(h.severity === 'critical' ? 'critical' : h.severity === 'warning' ? 'warning' : h.severity === 'good' ? 'good' : 'watch', h.title, h.detail)
  if (d.warnings.length) {
    cv.gap()
    cv.title('Read with care', 'Sources that were incomplete when this file was written. A figure that could not be read is blank, never 0.')
    d.warnings.forEach(w => cv.callout('warning', 'Incomplete', w))
  }
  cv.gap()
  cv.index(index)
}

// ─── Columns ──────────────────────────────────────────────────────────────────

function bookingCols(): Col<BookingLine>[] {
  return [
    { header: 'Booking ref', width: 13, value: b => b.bookingRef },
    { header: 'Market', width: 12, value: b => b.countryLabel },
    { header: 'Destination', width: 18, value: b => b.destination ?? '' },
    { header: 'Status', width: 16, value: b => b.status.replace(/_/g, ' ') },
    { header: 'Booking type', width: 12, value: b => (b.hotelOnly ? 'Hotel Only' : 'Full tour') },
    { header: 'Arrival', width: 12, kind: 'date', value: b => b.arrivalDate },
    { header: 'Departure', width: 12, kind: 'date', value: b => b.departureDate },
    { header: 'Nights', width: 8, kind: 'int', value: b => daysBetween(b.arrivalDate, b.departureDate), total: 'avg' },
    { header: 'Pax', width: 6, kind: 'int', value: b => b.pax, total: 'sum', bar: P.b2b },
    { header: 'Adults', width: 7, kind: 'int', value: b => b.paxAdults, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: b => b.paxChildren, total: 'sum' },
    { header: 'Infants', width: 7, kind: 'int', value: b => b.paxInfants, total: 'sum' },
    { header: 'Currency', width: 9, value: b => b.currency },
    { header: 'Quoted total', width: 13, kind: 'money', value: b => b.quotedTotal, total: 'sum' },
    { header: 'Filed at', width: 17, kind: 'stamp', value: b => b.createdAt },
    { header: 'Lead time (days)', width: 11, kind: 'int', value: b => daysBetween(b.createdAt, b.arrivalDate), total: 'avg' },
  ]
}

function quoteCols(): Col<QuoteRow>[] {
  return [
    { header: 'Quote ID', width: 14, value: q => q.ref },
    { header: 'First issued', width: 17, kind: 'stamp', value: q => q.issuedAt },
    { header: 'New in window', width: 9, kind: 'yes', value: q => (q.isNew ? 'Yes' : 'No') },
    { header: 'Consultant', width: 22, value: q => q.ownerName },
    { header: 'Office team', width: 18, value: q => teamLabel(q.team) },
    { header: 'Created by', width: 12, value: q => CREATED_BY[q.createdBy] },
    { header: 'Agency', width: 24, value: q => q.agency ?? 'Direct' },
    { header: 'Destination', width: 14, value: q => q.destination ?? '' },
    { header: 'Trip', width: 28, wrap: true, value: q => q.trip ?? '' },
    { header: 'Travel date', width: 12, kind: 'date', value: q => q.travelDate },
    { header: 'Nights', width: 7, kind: 'int', value: q => q.nights, total: 'avg' },
    { header: 'Pax', width: 6, kind: 'int', value: q => q.pax, total: 'sum' },
    { header: 'Versions', width: 8, kind: 'int', value: q => q.versions, total: 'sum' },
    { header: 'Amended in window', width: 10, kind: 'int', value: q => q.amendmentsInWindow, total: 'sum' },
    { header: 'Quote status', width: 12, value: q => word(q.quoteStatus) },
    { header: 'Booking status', width: 12, kind: 'state', value: q => word(q.bookingStatus) },
    { header: 'Confirmed in window', width: 10, kind: 'yes', value: q => (q.confirmedInWindow ? 'Yes' : 'No') },
    { header: 'Confirmed at', width: 17, kind: 'stamp', value: q => q.confirmedAt },
    { header: 'Order', width: 18, value: q => (q.confirmedOrderId ? `AHCNF_${q.confirmedOrderId}/AMD${q.versions}` : '') },
    { header: 'Confirmation type', width: 10, value: q => (q.confirmationType ?? '').toUpperCase() },
    { header: 'Currency', width: 9, value: q => q.currency ?? '' },
    { header: 'Latest total', width: 13, kind: 'money', value: q => q.latestTotal, total: 'sum' },
    { header: 'Last issued', width: 17, kind: 'stamp', value: q => q.lastIssuedAt },
  ]
}

function amendmentCols(): Col<AmendmentRow>[] {
  return [
    { header: 'Quote ID', width: 14, value: a => a.ref },
    { header: 'Version', width: 8, value: a => `AMD${a.version}` },
    { header: 'Issued', width: 17, kind: 'stamp', value: a => a.issuedAt },
    { header: 'By', width: 22, value: a => a.author },
    { header: 'Office team', width: 18, value: a => teamLabel(a.team) },
    { header: 'Agency', width: 24, value: a => a.agency ?? 'Direct' },
    { header: 'Destination', width: 14, value: a => a.destination ?? '' },
    { header: 'Currency', width: 9, value: a => a.currency ?? '' },
    { header: 'Total', width: 13, kind: 'money', value: a => a.total, total: 'sum' },
    { header: 'First issued', width: 17, kind: 'stamp', value: a => a.firstIssuedAt },
    { header: 'Quote age (days)', width: 10, kind: 'int', value: a => daysBetween(a.firstIssuedAt, a.issuedAt), total: 'avg' },
  ]
}

function callCols(): Col<CallRow>[] {
  return [
    { header: 'When', width: 17, kind: 'stamp', value: c => c.at },
    { header: 'Source', width: 9, kind: 'flag', value: c => (c.source === 'ai' ? 'AI' : 'Manual') },
    { header: 'Caller', width: 22, value: c => c.actor },
    { header: 'Office team', width: 18, value: c => teamLabel(c.team) },
    { header: 'Agency', width: 24, value: c => c.agency ?? '' },
    { header: 'Contact', width: 20, value: c => c.contact ?? '' },
    { header: 'Outcome', width: 18, value: c => (c.outcome ?? '').replace(/_/g, ' ') },
    { header: 'Answered', width: 9, kind: 'yes', value: c => (c.connected ? 'Yes' : 'No') },
    { header: 'Interested', width: 9, kind: 'yes', value: c => (c.interested ? 'Yes' : 'No') },
    { header: 'Duration (s)', width: 10, kind: 'int', value: c => c.durationSecs, total: 'sum' },
    { header: 'Campaign', width: 18, value: c => c.campaign ?? '' },
  ]
}

function signupCols(): Col<SignupRow>[] {
  return [
    { header: 'Signed up', width: 17, kind: 'stamp', value: s => s.at },
    { header: 'Name', width: 22, value: s => s.name },
    { header: 'Audience', width: 10, value: s => (s.audience === 'agency' ? 'Agency' : 'Internal') },
    { header: 'Agency', width: 26, value: s => s.agency ?? '' },
    { header: 'How they joined', width: 20, value: s => s.source },
    { header: 'Onboarded by', width: 20, value: s => s.onboardedBy ?? '' },
    { header: 'Role', width: 10, value: s => s.role },
    { header: 'Status', width: 10, kind: 'state', value: s => (s.status === 'pending' ? 'Pending' : s.status === 'active' ? 'Approved' : s.status) },
    { header: 'Office team', width: 18, value: s => teamLabel(s.team) },
  ]
}

function staffCols(currencies: string[]): Col<StaffRow>[] {
  return [
    { header: 'Consultant', width: 22, value: s => s.name },
    { header: 'Role', width: 10, value: s => s.role },
    { header: 'Office team', width: 18, value: s => teamLabel(s.team) },
    { header: 'Team leader', width: 18, value: s => s.leader ?? '' },
    { header: 'New quotes', width: 9, kind: 'int', value: s => s.newQuotes, total: 'sum', bar: P.amber },
    { header: 'Amendments', width: 10, kind: 'int', value: s => s.amendments, total: 'sum' },
    { header: 'Confirmed of own quotes', width: 11, kind: 'int', value: s => s.cohortConfirmed, total: 'sum' },
    { header: 'Confirmations', width: 11, kind: 'int', value: s => s.confirmations, total: 'sum', bar: P.green },
    { header: 'Calls', width: 8, kind: 'int', value: s => s.manualCalls, total: 'sum' },
    { header: 'Answered', width: 9, kind: 'int', value: s => s.manualConnected, total: 'sum' },
    { header: 'Answer rate', width: 9, kind: 'pct', value: s => (s.manualCalls ? s.manualConnected / s.manualCalls : null) },
    { header: 'AI calls', width: 8, kind: 'int', value: s => s.aiCalls, total: 'sum' },
    { header: 'Agencies handled', width: 10, kind: 'int', value: s => s.agenciesHandled },
    { header: 'Agencies called', width: 10, kind: 'int', value: s => s.agenciesContacted, total: 'sum' },
    { header: 'AI prompts', width: 9, kind: 'int', value: s => s.prompts, total: 'sum' },
    ...currencies.map((c): Col<StaffRow> => ({ header: `Quoted ${c}`, width: 13, kind: 'money', value: s => amountIn(s.quotedValue, c), total: 'sum' })),
    ...currencies.map((c): Col<StaffRow> => ({ header: `Confirmed ${c}`, width: 13, kind: 'money', value: s => amountIn(s.confirmedValue, c), total: 'sum' })),
    { header: 'Activity', width: 12, kind: 'flag', value: s => (!s.newQuotes && !s.amendments && !s.manualCalls && !s.prompts && !s.confirmations ? 'No activity' : 'Active') },
  ]
}

function agencyCols(): Col<AgencyRow>[] {
  return [
    { header: 'Agency', width: 28, value: a => a.agency },
    { header: 'Office team', width: 18, value: a => teamLabel(a.team) },
    { header: 'AI prompts', width: 9, kind: 'int', value: a => a.prompts, total: 'sum', bar: P.b2c },
    { header: 'People on the AI', width: 9, kind: 'int', value: a => a.aiUsers, total: 'sum' },
    { header: 'Trips worked', width: 9, kind: 'int', value: a => a.trips, total: 'sum' },
    { header: 'New quotes', width: 9, kind: 'int', value: a => a.quotes, total: 'sum', bar: P.indigo },
    { header: 'Raised by agency', width: 10, kind: 'int', value: a => a.byAgency, total: 'sum' },
    { header: 'Raised by us', width: 10, kind: 'int', value: a => a.byStaff, total: 'sum' },
    { header: 'Amendments', width: 10, kind: 'int', value: a => a.amendments, total: 'sum' },
    { header: 'Confirmations', width: 11, kind: 'int', value: a => a.confirmations, total: 'sum' },
    { header: 'Calls', width: 8, kind: 'int', value: a => a.calls, total: 'sum' },
    { header: 'Answered', width: 9, kind: 'int', value: a => a.connected, total: 'sum' },
    { header: 'Signal', width: 18, kind: 'flag', value: a => (a.prompts >= 3 && !a.quotes ? 'Warm lead' : a.confirmations ? 'Converting' : '') },
  ]
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

export async function renderSalesWorkbook(d: SalesReportData): Promise<{ buffer: Buffer; sheets: string[] }> {
  const wb = newWorkbook('Daily Sales Report', new Date(d.generatedAt))
  const gen = `Generated ${new Date(d.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`
  const plan = new SheetPlan()
  const range = d.window.days === 1 ? formatReportDate(d.window.fromDate) : `${formatReportDate(d.window.fromDate)} to ${formatReportDate(d.window.toDate)}`
  const pl = d.pipeline

  // ── B2C only: the store, then its orders as filed bookings
  type SO = SalesReportData['store']['list'][number]
  plan.table<SO>({
    name: 'B2C Store', tab: P.pink,
    title: 'Aahaas B2C storefront orders',
    description: 'Orders placed (booked_date) in the window, travel categories only. Value is net_total_amount in the base currency — the importer\'s rule.',
    totals: `${d.store.orders} orders · ${moneyText(d.store.value)}`,
    what: 'Storefront orders with categories, products and value',
    cols: [
      { header: 'Order', width: 10, value: o => o.orderId },
      { header: 'Booked', width: 12, kind: 'date', value: o => o.bookedDate },
      { header: 'First service', width: 12, kind: 'date', value: o => o.serviceDate },
      { header: 'Lines', width: 7, kind: 'int', value: o => o.lines, total: 'sum' },
      { header: 'Categories', width: 22, value: o => o.categories },
      { header: 'Products', width: 48, wrap: true, value: o => o.products },
      { header: 'Currency', width: 9, value: o => o.currency },
      { header: 'Value', width: 13, kind: 'money', value: o => o.value, total: 'sum', bar: P.pink },
    ],
    rows: d.store.list,
    empty: d.store.available ? 'No storefront orders in this window.' : d.store.error ?? 'Unavailable.',
  })

  plan.table<BookingLine>({
    name: 'Bookings', tab: P.b2b,
    title: `B2C bookings filed — ${range}`,
    description: 'Aahaas store orders filed as bookings in this system inside the window. Test bookings are excluded. B2B is not in this report.',
    totals: `${d.bookings.total} bookings · ${d.bookings.pax} guests · ${moneyText(d.bookings.value)}`,
    what: 'Every B2C booking with market, dates, pax and value',
    cols: bookingCols(), rows: d.bookings.lines,
    rowTint: b => (b.hotelOnly ? P.hotelWash : null),
    empty: d.bookings.available ? 'No B2C bookings filed in this window.' : `Unavailable — ${d.bookings.error ?? 'bookings could not be read'}.`,
  })

  const mc = topCurrencies(d.bookings.markets.map(m => m.quoted))
  type M = SalesReportData['bookings']['markets'][number]
  plan.table<M>({
    name: 'By Market', tab: P.blue,
    title: 'B2C bookings by market',
    description: 'Country resolved from the booking (legacy SG/MY rows split by reference). Lead time is filed date to arrival.',
    totals: `${d.bookings.markets.length} markets`,
    what: 'Bookings, guests, lead time and value per market',
    cols: [
      { header: 'Market', width: 18, value: m => m.label },
      { header: 'Bookings', width: 10, kind: 'int', value: m => m.bookings, total: 'sum', bar: P.blue },
      { header: 'Share', width: 9, kind: 'pct', value: m => (d.bookings.total ? m.bookings / d.bookings.total : null) },
      { header: 'Guests', width: 9, kind: 'int', value: m => m.pax, total: 'sum' },
      { header: 'Avg lead (days)', width: 10, kind: 'num', value: m => m.avgLeadDays },
      ...mc.map((c): Col<M> => ({ header: `Quoted ${c}`, width: 14, kind: 'money', value: m => amountIn(m.quoted, c), total: 'sum' })),
    ],
    rows: d.bookings.markets,
  })



  // ── Travel Quote GPT
  if (pl.available) {
    plan.table<QuoteRow>({
      name: 'Quotations', tab: P.indigo,
      title: `Quotations touched — ${range}`,
      description: 'One row per quotation_ref: new in the window, amended in it, or confirmed in it. Consultant = first internal author. Booking status is where the money is; confirmations are dated by confirmed_at and exclude B2C and cancelled.',
      totals: `${pl.counts.newQuotes} new · ${pl.counts.amendments} amendments · ${pl.counts.confirmations} confirmed`,
      what: 'Every quotation with consultant, agency, destination, status and value',
      cols: quoteCols(), rows: pl.quotes,
      rowTint: q => (q.confirmedInWindow ? P.okWash : q.bookingStatus === 'lost' || q.bookingStatus === 'cancelled' ? P.cancelled : null),
      freezeCols: 1,
    })
    plan.table<AmendmentRow>({
      name: 'Amendments', tab: P.amber,
      title: 'Amendment documents issued',
      description: 'Every AMD2+ version issued in the window, whichever day its quotation was first written. (The BLR digest counts only amendments within the day\'s own new quotations.)',
      totals: `${pl.amendments.length} amendments`,
      what: 'Each amendment with author, agency and the quote\'s age',
      cols: amendmentCols(), rows: pl.amendments,
    })
    plan.table<QuoteRow>({
      name: 'Confirmations', tab: P.green,
      title: 'Quotations confirmed in the window',
      description: 'Dated by confirmed_at, written by the confirmation itself — not when somebody opened the quote. B2C and since-cancelled excluded.',
      totals: `${pl.counts.confirmations} confirmed · ${moneyText(pl.counts.confirmedValue)}`,
      what: 'Confirmed quotations with order number and value',
      cols: quoteCols(), rows: pl.quotes.filter(q => q.confirmedInWindow),
      empty: 'No quotations confirmed in this window.',
    })
    const dc = topCurrencies(pl.destinations.map(x => x.quotedValue))
    type DR = typeof pl.destinations[number]
    plan.table<DR>({
      name: 'Destinations', tab: P.blue,
      title: 'Where we are quoting',
      description: 'Destination as the structured plan recorded it. Quotes = new in the window; Confirmed of quoted = those of them now confirmed.',
      totals: `${pl.destinations.length} destinations`,
      what: 'Quotes, amendments and confirmations per destination',
      cols: [
        { header: 'Destination', width: 18, value: x => x.destination },
        { header: 'New quotes', width: 10, kind: 'int', value: x => x.quotes, total: 'sum', bar: P.indigo },
        { header: 'Amendments', width: 10, kind: 'int', value: x => x.amendments, total: 'sum' },
        { header: 'Confirmed of quoted', width: 11, kind: 'int', value: x => x.confirmed, total: 'sum' },
        { header: 'Confirmations', width: 11, kind: 'int', value: x => x.confirmations, total: 'sum', bar: P.green },
        { header: 'Conversion', width: 10, kind: 'pct', value: x => (x.quotes ? x.confirmed / x.quotes : null) },
        ...dc.map((c): Col<DR> => ({ header: `Quoted ${c}`, width: 14, kind: 'money', value: x => amountIn(x.quotedValue, c), total: 'sum' })),
      ],
      rows: pl.destinations,
    })
    plan.table<CallRow>({
      name: 'Calls', tab: P.amber,
      title: 'Every call attempt',
      description: `Manual (logged on the CRM desk) and AI (provider log). Answered = a person picked up — the provider's answered flag, never the accepted-dial flag.${pl.team ? ' This team report counts its own people\'s dialling only.' : ''}`,
      totals: `${pl.counts.calls.total} calls · ${pl.counts.calls.connected} answered`,
      what: 'Each call with caller, agency, outcome and duration',
      cols: callCols(), rows: pl.calls,
    })
    plan.table<SignupRow>({
      name: 'Signups', tab: P.pink,
      title: 'New accounts',
      description: 'Agency = partner or guest role. "Onboarded by our team" carries the colleague who added it from the CRM desk.',
      totals: `${pl.counts.signups.agencies} agencies · ${pl.counts.signups.internal} internal · ${pl.counts.signups.pending} pending`,
      what: 'Each signup with how they joined and who onboarded them',
      cols: signupCols(), rows: pl.signups,
      rowTint: s => (s.status === 'pending' ? P.pendingWash : null),
    })
    const agencies = pl.direct ? [...pl.agencies, pl.direct] : pl.agencies
    plan.table<AgencyRow>({
      name: 'Agency Activity', tab: P.b2c,
      title: 'Agency by agency',
      description: 'Prompts are the agency\'s own turns in Travel Quote GPT; quotes are split by who raised them. Direct business (no agency) is the last row, never ranked. "Warm lead" = 3+ prompts and no quotation.',
      totals: `${pl.agencies.length} agencies`,
      what: 'Prompts, quotes, amendments, confirmations and calls per agency',
      cols: agencyCols(), rows: agencies,
      rowTint: a => (a === pl.direct ? P.zebra : a.prompts >= 3 && !a.quotes ? P.amberWash : null),
    })
    const sc = topCurrencies(pl.staff.flatMap(s => [s.quotedValue, s.confirmedValue]), 2)
    plan.table<StaffRow>({
      name: 'Staff Performance', tab: P.amber,
      title: 'Consultant performance',
      description: 'One row per person on the roster, zeros kept — "opened nothing" is the most actionable line. Quotes are credited to the first internal author; amendments to whoever issued them.',
      totals: `${pl.staff.length} people · ${pl.staff.filter(s => !s.newQuotes && !s.amendments && !s.manualCalls && !s.prompts && !s.confirmations).length} with no activity`,
      what: 'Quotes, amendments, confirmations, calls and prompts per consultant',
      cols: staffCols(sc), rows: pl.staff,
      rowTint: s => (!s.newQuotes && !s.amendments && !s.manualCalls && !s.prompts && !s.confirmations ? P.zebra : null),
    })
    if (pl.teams.length) {
      type TR = typeof pl.teams[number]
      plan.table<TR>({
        name: 'Teams', tab: P.deep,
        title: 'By office team',
        description: 'A consultant counts for the team they picked; an agent for the team of whoever permanently handles their agency.',
        totals: `${pl.teams.length} teams`,
        what: 'Each office team side by side',
        cols: [
          { header: 'Team', width: 26, value: t => t.label },
          { header: 'People', width: 8, kind: 'int', value: t => t.people, total: 'sum' },
          { header: 'New quotes', width: 10, kind: 'int', value: t => t.quotes, total: 'sum', bar: P.indigo },
          { header: 'Amendments', width: 10, kind: 'int', value: t => t.amendments, total: 'sum' },
          { header: 'Confirmations', width: 11, kind: 'int', value: t => t.confirmations, total: 'sum' },
          { header: 'Calls', width: 8, kind: 'int', value: t => t.calls, total: 'sum' },
          { header: 'Answered', width: 9, kind: 'int', value: t => t.connected, total: 'sum' },
          { header: 'AI prompts', width: 9, kind: 'int', value: t => t.prompts, total: 'sum' },
          { header: 'Signups', width: 8, kind: 'int', value: t => t.signups, total: 'sum' },
          { header: 'Quotes per person', width: 10, kind: 'num', value: t => (t.people ? Math.round((t.quotes / t.people) * 10) / 10 : null) },
        ],
        rows: pl.teams,
      })
    }
    const a = pl.activity
    if (a.labels.length) {
      plan.matrix({
        name: 'Activity Heatmap', tab: P.brand,
        title: a.axis === 'hour' ? `When the work happened — by hour, ${d.window.timezone}` : 'When the work happened — by day',
        description: 'Each cell is the number of actions of that kind in that slot. Read across a row to see when the floor quotes, calls and prompts.',
        what: 'Quotes, amendments, confirmations, calls, prompts and signups by hour or day',
        rowHeader: 'Activity',
        rows: a.lanes.map(l => l.label),
        cols: a.labels.map((l, i) => ({ key: String(i), label: a.axis === 'hour' ? l : l.slice(5) })),
        value: (row, col) => a.lanes.find(l => l.label === row)?.values[Number(col)] ?? 0,
        colWidth: a.axis === 'hour' ? 6 : 7,
      })
    }
  }

  plan.canvas({
    name: 'Data Notes', tab: P.muted, width: 6, firstCol: 30,
    what: 'Where every figure comes from and how it is counted',
    draw: c => {
      c.banner('Sales report', 'Data notes', 'Every source is read-only. Nothing in this report writes to any system.')
      c.title('Sources')
      c.header(['Section', 'System', 'How it is counted'])
      const rows: [string, string, string][] = [
        ['B2C store', 'Aahaas store (read-only)', 'Orders by booked_date, travel categories 3–6; value = net_total_amount in base_currency.'],
        ['B2C bookings filed', 'Booking system', 'Bookings with agent "Aahaas B2C" filed in the window. Test bookings excluded. No B2B bookings, partners or invoices are read for this report.'],
        ['Quotations', 'Travel Quote GPT (read-only)', 'One quotation_ref = one quotation, dated by its first version. Owner = first internal author.'],
        ['Amendments', 'Travel Quote GPT', 'Every AMD2+ document issued in the window. The BLR digest counts only amendments of the day\'s own new quotations.'],
        ['Confirmations', 'Travel Quote GPT', 'confirmed_at inside the window, order stamped, not cancelled, not B2C.'],
        ['Confirmed of quoted', 'Travel Quote GPT', 'New quotations of the window whose booking status is confirmed (B2B) ÷ new quotations.'],
        ['Calls', 'Travel Quote GPT', 'Manual: CRM desk manual_call rows. AI: provider call log; answered flag only.'],
        ['Signups', 'Travel Quote GPT', 'ai_users created in the window. Agency = partner/guest role; desk-onboarded = crm_source "desk".'],
        ['AI adoption', 'Travel Quote GPT', 'User turns in the prompt log. Agency prompts = partner role.'],
        ['Office team', 'Travel Quote GPT', 'A person\'s own pick; an agent belongs to the team of their agency\'s permanent handler, then account manager.'],
      ]
      rows.forEach(r => c.line(r))
      c.gap()
      c.title('Window')
      c.line(['Covered', `${d.window.label} (${d.window.fromDate} to ${d.window.toDate}, ${d.window.days} day${d.window.days === 1 ? '' : 's'})`])
      c.line(['Compared with', `${d.window.previous.label} (${d.window.previous.fromDate} to ${d.window.previous.toDate})`])
      c.line(['Timezone', d.window.timezone])
      if (d.window.live) c.note('This range runs up to now — today\'s figures are still moving.', P.amber)
    },
  })

  overview(wb, d, plan.index())
  plan.write(wb, gen)
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, sheets: ['Overview', ...plan.names()] }
}
