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
 * point. A spreadsheet arriving in a manager's inbox with twenty unlabelled
 * tabs is not detail, it is homework; the same file where every tab explains
 * itself is something a person can actually use on their own.
 *
 * ## The rules the sheets follow
 *
 *  - **Overview first.** A dashboard — headline tiles, the ranked actions, the
 *    trend drawn as in-cell bars — and a linked index of every other tab.
 *  - **One population per sheet.** Nothing on a sheet is a different kind of
 *    thing from the rest of it, so a column can always be summed.
 *  - **Row 1 names it, row 2 explains it, row 3 totals it, row 4 is the header,
 *    data from row 5.** A live SUBTOTAL row under the data follows any filter.
 *  - **Numbers are numbers and dates are dates.** A count that arrives as text
 *    cannot be summed, and a report whose totals do not add up is not trusted
 *    twice.
 *  - **Money is never blended.** Currency is always its own column beside the
 *    amount, and no sheet totals across two of them.
 *
 * Built on `@/lib/excel-kit`, the same house style as the daily workbook.
 */
import type { ReportData } from './report-data'
import type { PeriodInsights } from './period-insights'
import { PERIOD_LABEL, formatReportDate } from './report-window'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'
import {
  P, Canvas, SheetPlan, newWorkbook, yes, daysBetween, groupBy,
  type Col, type Measure,
} from '@/lib/excel-kit'

type Booking = ReportData['created']['allBookings'][number]
type Complaint = ReportData['complaints']['items'][number]

const LEAD_BUCKETS = ['0–7 days', '8–30 days', '31–60 days', '61–90 days', '91+ days', 'Not measurable'] as const

function leadBucket(b: Booking): (typeof LEAD_BUCKETS)[number] {
  const d = daysBetween(b.createdAt, b.arrivalDate)
  if (d === null || d < 0) return 'Not measurable'
  if (d <= 7) return '0–7 days'
  if (d <= 30) return '8–30 days'
  if (d <= 60) return '31–60 days'
  if (d <= 90) return '61–90 days'
  return '91+ days'
}

function stampText(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10)
}

const sumPax = (rs: { pax: number }[]) => rs.reduce((s, r) => s + r.pax, 0)

function bookingCols(): Col<Booking>[] {
  return [
    { header: 'Booking ref', width: 15, value: b => b.bookingRef },
    { header: 'Channel', width: 9, kind: 'source', value: b => b.source },
    { header: 'Country', width: 16, value: b => b.countryLabel },
    { header: 'Agent', width: 28, value: b => b.agent ?? '' },
    { header: 'Status', width: 16, value: b => b.status.replace(/_/g, ' ') },
    { header: 'Booking type', width: 12, value: b => (b.hotelOnly ? 'Hotel only' : 'Full tour') },
    { header: 'Arrival', width: 12, kind: 'date', value: b => b.arrivalDate },
    { header: 'Departure', width: 12, kind: 'date', value: b => b.departureDate },
    { header: 'Nights', width: 8, kind: 'int', value: b => daysBetween(b.arrivalDate, b.departureDate), total: 'avg' },
    { header: 'Adults', width: 8, kind: 'int', value: b => b.paxAdults, total: 'sum' },
    { header: 'Children', width: 9, kind: 'int', value: b => b.paxChildren, total: 'sum' },
    { header: 'Infants', width: 8, kind: 'int', value: b => b.paxInfants, total: 'sum' },
    { header: 'Total pax', width: 9, kind: 'int', value: b => b.pax, total: 'sum', bar: P.b2c },
    { header: 'Currency', width: 9, value: b => b.currency },
    { header: 'Quoted total', width: 14, kind: 'money', value: b => b.quotedTotal },
    { header: 'Destination', width: 26, value: b => b.destination ?? '' },
    { header: 'Filed at', width: 17, kind: 'stamp', value: b => b.createdAt },
    { header: 'Lead time (days)', width: 11, kind: 'int', value: b => daysBetween(b.createdAt, b.arrivalDate), total: 'avg' },
    { header: 'Lead bucket', width: 13, value: b => leadBucket(b) },
  ]
}

function moverCols(label: string, width: number, comparable: boolean): Col<PeriodInsights['countryMovers'][number]>[] {
  return [
    { header: label, width, value: m => m.label },
    { header: 'Bookings', width: 11, kind: 'int', value: m => m.current, total: 'sum', bar: P.brand },
    { header: 'Guests', width: 10, kind: 'int', value: m => m.pax, total: 'sum', bar: P.b2c },
    { header: 'Previous', width: 11, kind: 'int', value: m => (comparable ? m.previous : null), total: 'sum' },
    { header: 'Change', width: 10, kind: 'int', value: m => (comparable ? m.delta : null), total: 'sum', tone: m => (!comparable || !m.delta ? null : m.delta > 0 ? 'good' : 'bad') },
    { header: 'Change %', width: 10, kind: 'pct', value: m => (m.pct === null ? null : m.pct / 100), tone: m => (m.pct === null || !m.pct ? null : m.pct > 0 ? 'good' : 'bad') },
    { header: 'Status', width: 14, kind: 'flag', value: m => (m.isNew ? 'New' : m.isLost ? 'Went quiet' : '') },
  ]
}

// ─── The workbook ─────────────────────────────────────────────────────────────

export async function renderReportWorkbook(d: ReportData): Promise<{ buffer: Buffer; sheets: string[] }> {
  const i: PeriodInsights | null = d.insights
  const periodWord = d.window.period === 'MONTHLY' ? 'month' : 'week'
  const wb = newWorkbook(`Apple Holidays — ${PERIOD_LABEL[d.window.period]} Business Review`, new Date(d.generatedAt))
  wb.subject = `${d.window.fromDate} to ${d.window.toDate}`
  const gen = `Generated ${stampText(d.generatedAt)} UTC`
  const plan = new SheetPlan()
  const comparable = !!i?.comparable
  const all = d.created.allBookings

  // ── Scorecard ──────────────────────────────────────────────────────────────
  interface Score { measure: string; current: number | null; previous: number | null; note: string; better?: 'up' | 'down'; pct?: boolean }
  const scores: Score[] = []
  const score = (measure: string, current: number | null | undefined, previous: number | null | undefined, note: string, better?: 'up' | 'down', isPct = false) =>
    scores.push({ measure, current: current ?? null, previous: previous ?? null, note, better, pct: isPct })
  if (i) {
    const prev = (v: number | null | undefined) => (comparable ? v ?? null : null)
    score('Bookings confirmed', i.totals.bookings, prev(i.totals.previousBookings), 'The period\'s intake, counted on the basis named on the Overview.', 'up')
    score('Guests booked', i.totals.pax, prev(i.totals.previousPax), 'Adults + children + infants across those bookings.', 'up')
    score('B2B bookings', i.totals.channel.b2b, prev(i.totals.previousChannel.b2b), 'Trade bookings, derived from the agent on the file.', 'up')
    score('B2C bookings', i.totals.channel.b2c, prev(i.totals.previousChannel.b2c), 'Direct storefront orders.', 'up')
    score('Average party size', i.totals.avgPartySize, i.totals.previousAvgPartySize, 'Guests per booking.')
    score('Average lead time (days)', i.leadTime.avgDays, i.leadTime.previousAvgDays, 'Days between filing the booking and the guest arriving. Falling means the book is being written later.', 'up')
    score('Median lead time (days)', i.leadTime.medianDays, null, 'Half the period\'s bookings were made closer to travel than this.')
    score('Booked inside 7 days', i.leadTime.within7, null, 'The volatile end of the book — little time to set it up.', 'down')
    score('Bookings per day', i.runRate.current, i.runRate.previous, 'Run rate across the period.', 'up')
    score('Top-3 partner share (%)', i.agentConcentrationPct === null ? null : i.agentConcentrationPct / 100, null, 'Share of bookings held by the three biggest partners. High means concentrated risk.', 'down', true)
    score('Tours operated', i.delivery.toursOperated, null, 'Tours on the ground for at least one day of the period, including ones that started before it.')
    score('Tours started', i.delivery.arrivals, i.delivery.previousArrivals, 'Arrivals inside the period.', 'up')
    score('Guest-days delivered', i.delivery.guestDays, null, 'Days on the ground inside the period × party size. The workload measure a tour count cannot give.')
    score('Average tour nights', i.delivery.avgTourNights, null, 'Length of the tours that operated.')
    score('Cancellations', i.cancellations.total, i.cancellations.previousTotal, `${i.cancellations.shortNotice} of them with a week or less to arrival.`, 'down')
    score('Cancellation rate (%)', i.cancellations.ratePct === null ? null : i.cancellations.ratePct / 100, null, 'Cancellations as a share of everything the period took.', 'down', true)
    score('Complaints raised', i.quality.complaints, i.quality.previousComplaints, 'Distinct issues — repeat calls about one problem count once.', 'down')
    score('Complaints per 100 tours', i.quality.per100Tours, null, 'Volume-adjusted, so a busy period is judged fairly.', 'down')
    score('Complaints resolved (%)', i.quality.resolvedPct === null ? null : i.quality.resolvedPct / 100, null, i.quality.avgResolutionHours !== null ? `Average ${i.quality.avgResolutionHours} hours to resolve.` : '', 'up', true)
    score('High-severity complaints open', i.quality.highSeverityOpen, null, 'Serious issues still not closed.', 'down')
    score(`D-${RECONFIRM_DUE_DAYS} compliance (%)`, i.quality.reconfirmCompliancePct === null ? null : i.quality.reconfirmCompliancePct / 100, null, `Live standing as at ${d.onGround.date}: guests inside D-${RECONFIRM_DUE_DAYS} who are not late. ${i.quality.unexplainedBreaches} breaches have no reason recorded.`, 'up', true)
    score('Arrivals ready (%)', i.quality.readinessPct === null ? null : i.quality.readinessPct / 100, null, 'Of the next three days of arrivals, the share with nothing outstanding.', 'up', true)
    score('AppleSystem confirmations missing', i.integrity.parityMissing, null, 'Confirmed upstream, never received here. Anything above zero means the figures above understate the period.', 'down')
    score('Count check shortfall', i.integrity.countCheckShort, null, 'Bookings, P&Ls and invoices owed but not present, per the accounts ledger.', 'down')
    score('Forward book', d.upcoming.total, null, `${d.upcoming.next30} of them arriving within 30 days.`, 'up')
  }
  const change = (s: Score) => (s.current !== null && s.previous !== null ? s.current - s.previous : null)
  const changePct = (s: Score) => (s.current !== null && s.previous !== null && s.previous > 0 && !s.pct ? (s.current - s.previous) / s.previous : null)
  const direction = (s: Score): 'Better' | 'Worse' | '' => {
    const c = change(s)
    if (!c || !s.better) return ''
    return (c > 0) === (s.better === 'up') ? 'Better' : 'Worse'
  }
  plan.table<Score>({
    name: 'Scorecard', tab: P.deep,
    title: 'Scorecard',
    description: `Every headline figure with ${comparable ? i!.previousLabel : 'the previous period'} beside it. Change is this period minus last; a blank previous column means the two could not be counted the same way. Direction says whether the move is good news for that measure.`,
    what: 'The headline figures with the previous period beside them, the change, and whether it is better or worse',
    cols: [
      { header: 'Measure', width: 34, value: s => s.measure },
      { header: 'This period', width: 13, kind: 'num', value: s => s.current },
      { header: 'Previous', width: 12, kind: 'num', value: s => s.previous },
      { header: 'Change', width: 11, kind: 'num', value: change, tone: s => (direction(s) === 'Better' ? 'good' : direction(s) === 'Worse' ? 'bad' : null) },
      { header: 'Change %', width: 10, kind: 'pct', value: changePct, tone: s => (direction(s) === 'Better' ? 'good' : direction(s) === 'Worse' ? 'bad' : null) },
      { header: 'Direction', width: 11, kind: 'flag', value: s => (direction(s) === 'Better' ? 'Good' : direction(s) === 'Worse' ? 'Warning' : '') },
      { header: 'What it means', width: 90, wrap: true, value: s => s.note },
    ],
    rows: scores,
    empty: 'Period analytics were unavailable for this run.',
  })

  // ── Actions ────────────────────────────────────────────────────────────────
  if (i?.actions.length) {
    const sev = { critical: 'Critical', warning: 'Warning', watch: 'Watch', good: 'Good' } as const
    plan.table({
      name: 'Actions', tab: P.red,
      title: `What this ${periodWord} says somebody should do`,
      description: 'Ranked findings, worst first. Sheet names the tab that holds the rows behind each one.',
      totals: `${i.actions.length} findings · ${i.actions.filter(a => a.severity === 'critical').length} critical · ${i.actions.filter(a => a.severity === 'warning').length} warnings`,
      what: 'Ranked findings — critical, warning, watch and good news — with the tab behind each',
      cols: [
        { header: 'Severity', width: 11, kind: 'flag', value: a => sev[a.severity] },
        { header: 'Finding', width: 48, wrap: true, value: a => a.title },
        { header: 'Detail', width: 90, wrap: true, value: a => a.detail },
        { header: 'Sheet', width: 18, kind: 'link', value: a => (a.sheet ? { text: a.sheet, hyperlink: `#'${a.sheet}'!A1` } : '') },
      ],
      rows: i.actions,
    })
  }

  // ── Trend ──────────────────────────────────────────────────────────────────
  const series = i?.series ?? []
  plan.table({
    name: 'Trend', tab: P.indigo,
    title: `Intake by ${i?.granularity === 'week' ? 'week' : 'day'}`,
    description: 'Booked counts a confirmation against the day it was filed here; arrived and departed count tours by their travel dates. The gap between the two columns is the lead time — the period you sell is not the period you fly. Bars are drawn to scale inside the cells.',
    totals: i?.busiest ? `Busiest ${i.busiest.label} (${i.busiest.bookings}) · quietest ${i.quietest?.label ?? '—'} (${i.quietest?.bookings ?? 0})` : undefined,
    what: `Intake by ${i?.granularity === 'week' ? 'week' : 'day'}, against the arrivals and departures it produced`,
    cols: [
      { header: i?.granularity === 'week' ? 'Week starting' : 'Date', width: 14, kind: 'date', value: p => p.key },
      { header: 'Label', width: 18, value: p => p.label },
      { header: 'Bookings', width: 12, kind: 'int', value: p => p.bookings, total: 'sum', bar: P.brand },
      { header: 'Guests booked', width: 13, kind: 'int', value: p => p.pax, total: 'sum', bar: P.b2c },
      { header: 'Tours arrived', width: 13, kind: 'int', value: p => p.arrivals, total: 'sum', bar: P.green },
      { header: 'Tours departed', width: 14, kind: 'int', value: p => p.departures, total: 'sum', bar: P.blue },
      { header: 'Guests per booking', width: 12, kind: 'num', value: p => (p.bookings ? p.pax / p.bookings : null) },
    ],
    rows: series,
    rowTint: p => (p.key === i?.busiest?.key ? P.okWash : null),
  })

  // ── Country × period heatmap ───────────────────────────────────────────────
  if (series.length && all.length) {
    const keys = series.map(p => p.key).sort()
    const bucketOf = (iso: string) => {
      const dt = iso.slice(0, 10)
      let k: string | null = null
      for (const key of keys) if (key <= dt) k = key
      return k ?? keys[0]
    }
    const byCountry = groupBy(all, b => b.countryLabel)
    const cells = new Map<string, number>()
    for (const b of all) {
      const k = `${b.countryLabel}|${bucketOf(b.createdAt)}`
      cells.set(k, (cells.get(k) ?? 0) + 1)
    }
    plan.matrix({
      name: 'Heatmap', tab: P.green,
      title: `Bookings by market × ${i?.granularity === 'week' ? 'week' : 'day'}`,
      description: 'Each cell is the number of bookings a market sent in that bucket, by filing date. Darker is busier — a market that goes pale for a stretch is the conversation to have.',
      what: `Market × ${i?.granularity === 'week' ? 'week' : 'day'} heatmap of bookings`,
      rowHeader: 'Market',
      rows: Array.from(byCountry.keys()).sort((a, b) => (byCountry.get(b)!.length - byCountry.get(a)!.length) || a.localeCompare(b)),
      cols: series.map(p => ({ key: p.key, label: p.label })),
      value: (country, key) => cells.get(`${country}|${key}`) ?? 0,
      color: P.green, colWidth: i?.granularity === 'week' ? 13 : 11,
    })
  }

  // ── Countries / Agents ─────────────────────────────────────────────────────
  plan.table({
    name: 'Countries', tab: P.green,
    title: 'Markets',
    description: 'Every market that booked in this period or the last one. A market with bookings last period and none this one is kept deliberately — a row that disappears is a fall nobody notices.',
    what: 'Every market: this period, last period, the change, and the guests behind it',
    cols: moverCols('Country', 24, comparable),
    rows: i?.countryMovers ?? [],
  })
  plan.table({
    name: 'Agents', tab: P.b2b,
    title: 'Partners',
    description: `Every partner and channel, this period against last. Spelling variants of one partner ("MMT" / "Make My Trip") are merged into a single row. Partners who booked last period and nothing this one are kept — they are the calls worth making.${i?.newAgents.length ? ` New: ${i.newAgents.slice(0, 8).join(', ')}.` : ''}${i?.lapsedAgents.length ? ` Went quiet: ${i.lapsedAgents.slice(0, 8).join(', ')}.` : ''}`,
    what: 'Every partner on the same basis — including the ones who booked nothing this period',
    cols: moverCols('Agent / channel', 36, comparable),
    rows: i?.agentMovers ?? [],
  })

  // ── Mix: channel, lead time, party size ────────────────────────────────────
  const mixMeasures: Measure<Booking>[] = [
    { header: 'Bookings', value: rs => rs.length, bar: P.brand },
    { header: 'Guests', value: rs => sumPax(rs), bar: P.b2c },
    { header: 'B2B', value: rs => rs.filter(b => b.source === 'B2B').length },
    { header: 'B2C', value: rs => rs.filter(b => b.source === 'B2C').length },
    { header: 'Hotel only', value: rs => rs.filter(b => b.hotelOnly).length },
    { header: 'Guests per booking', kind: 'num', total: false, value: rs => (rs.length ? sumPax(rs) / rs.length : null) },
    {
      header: 'Avg nights', kind: 'num', total: false, value: rs => {
        const n = rs.map(b => daysBetween(b.arrivalDate, b.departureDate)).filter((x): x is number => x !== null && x >= 0)
        return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null
      },
    },
  ]
  plan.breakdown<Booking>({
    name: 'Lead Time', tab: P.amber,
    title: 'How far ahead the period was booked',
    description: `Bookings grouped by the days between filing and arrival. ${i?.leadTime.avgDays != null ? `Average ${i.leadTime.avgDays} days, median ${i.leadTime.medianDays ?? '—'}.` : ''} A heavy 0–7 row is business set up in a rush; a growing 91+ row is a healthy forward book.`,
    what: 'Bookings by lead-time bucket with guests, channel split and average stay',
    rows: all, keyHeader: 'Lead time', key: leadBucket, measures: mixMeasures,
    sort: (a, b) => LEAD_BUCKETS.indexOf(a[0] as (typeof LEAD_BUCKETS)[number]) - LEAD_BUCKETS.indexOf(b[0] as (typeof LEAD_BUCKETS)[number]),
  })
  plan.breakdown<Booking>({
    name: 'Party Size', tab: P.b2c,
    title: 'Party size mix',
    description: 'Bookings grouped by how many guests travel on them. Families and groups need different vehicles, rooms and guides — this is the mix the desk had to plan for.',
    what: 'Bookings by party size — solo, couple, family, group',
    rows: all, keyHeader: 'Party', key: b => (b.pax <= 1 ? '1 guest' : b.pax === 2 ? '2 guests' : b.pax <= 4 ? '3–4 guests' : b.pax <= 9 ? '5–9 guests' : '10+ guests'),
    measures: mixMeasures,
    sort: (a, b) => ['1 guest', '2 guests', '3–4 guests', '5–9 guests', '10+ guests'].indexOf(a[0]) - ['1 guest', '2 guests', '3–4 guests', '5–9 guests', '10+ guests'].indexOf(b[0]),
  })
  plan.breakdown<Booking>({
    name: 'Destinations', tab: P.blue,
    title: 'Destinations sold',
    description: 'Bookings grouped by the destination on the file. Blank destinations are grouped under "—".',
    what: 'Bookings by destination with guests and channel split',
    rows: all, keyHeader: 'Destination', keyWidth: 32, key: b => b.destination ?? '—', measures: mixMeasures,
  })

  // ── Value ──────────────────────────────────────────────────────────────────
  interface ValueRow { label: string; currency: string; total: number; quoted: number | null; avg: number | null; previous: number | null }
  const valueRows: ValueRow[] = []
  for (const c of d.created.byCurrency) {
    const quoted = all.filter(b => b.currency === c.currency && b.quotedTotal !== null)
    const prev = i?.totals.previousByCurrency.find(p => p.currency === c.currency)
    valueRows.push({ label: 'Quoted this period', currency: c.currency, total: c.total, quoted: quoted.length, avg: quoted.length ? c.total / quoted.length : null, previous: comparable && prev ? prev.total : null })
  }
  for (const c of i?.cancellations.byCurrency ?? []) valueRows.push({ label: 'Withdrawn by cancellation', currency: c.currency, total: c.total, quoted: null, avg: null, previous: null })
  for (const c of i?.cancellations.feesByCurrency ?? []) valueRows.push({ label: 'Cancellation fees recorded', currency: c.currency, total: c.total, quoted: null, avg: null, previous: null })
  plan.table<ValueRow>({
    name: 'Value', tab: P.green,
    title: 'Quoted value by currency',
    description: 'Never blended: each currency is its own row, and no cell here totals two of them. "Bookings quoted" is how many of the period\'s bookings carried a quoted total at all — the average is over those, not over every booking.',
    what: 'Quoted value by currency, never blended, with the average per booking',
    cols: [
      { header: 'Line', width: 28, value: v => v.label },
      { header: 'Currency', width: 10, value: v => v.currency },
      { header: 'Total', width: 16, kind: 'money', value: v => v.total },
      { header: 'Bookings quoted', width: 12, kind: 'int', value: v => v.quoted },
      { header: 'Average per booking', width: 16, kind: 'money', value: v => v.avg },
      { header: 'Previous period', width: 16, kind: 'money', value: v => v.previous },
      { header: 'Change %', width: 10, kind: 'pct', value: v => (v.previous ? (v.total - v.previous) / v.previous : null), tone: v => (!v.previous ? null : v.total >= v.previous ? 'good' : 'bad') },
    ],
    rows: valueRows,
    empty: 'No quoted value was recorded against this period\'s bookings.',
  })

  // ── Bookings ───────────────────────────────────────────────────────────────
  plan.table({
    name: 'Bookings', tab: P.brand,
    title: 'Bookings counted in this period',
    description: d.created.basis === 'apple'
      ? 'Every booking AppleSystem confirmed inside the period — the exact population every figure in the email is drawn from, so this sheet\'s row count is the email\'s headline number. Lead time is the days between filing and arrival.'
      : 'Every booking this system filed inside the period. The accounts ledger could not be read, so this could not be cut to AppleSystem\'s own confirmations.',
    totals: `${all.length} bookings · ${sumPax(all)} guests · B2B ${all.filter(b => b.source === 'B2B').length} · B2C ${all.filter(b => b.source === 'B2C').length}`,
    what: 'Every booking the period counted, one row each — the population every figure in the email is drawn from',
    cols: bookingCols(), rows: all, rowTint: b => (b.hotelOnly ? P.hotelWash : null),
  })

  // ── Not counted ────────────────────────────────────────────────────────────
  if (d.created.allOutside.length || d.created.missingRefs.length) {
    type NC = { why: string; b: Booking | null; ref: string }
    const rows: NC[] = [
      ...d.created.allOutside.map(b => ({ why: 'Filed here, confirmed earlier', b, ref: b.bookingRef })),
      ...d.created.missingRefs.map(ref => ({ why: 'Confirmed upstream, never filed here', b: null, ref })),
    ]
    plan.table<NC>({
      name: 'Not Counted', tab: P.muted,
      title: 'Deliberately not counted',
      description: 'Two populations the period touched but does not count. Rows filed here against an earlier confirmation are real work belonging to another period. Rows confirmed upstream with nothing filed here are the ones to chase — until they are filed, this period is understated by that many.',
      what: 'Filed in this period against an earlier confirmation, plus confirmations that never arrived',
      cols: [
        { header: 'Why it is not counted', width: 32, kind: 'text', value: x => x.why },
        { header: 'Booking ref', width: 15, value: x => x.ref },
        ...bookingCols().slice(1).map((c): Col<NC> => ({ header: c.header, width: c.width, kind: c.kind, total: c.total, value: x => (x.b ? c.value(x.b) : null) })),
      ],
      rows,
      rowTint: x => (x.b ? null : P.redWash),
    })
  }

  // ── Cancellations ──────────────────────────────────────────────────────────
  if (i?.cancellations.available) {
    const cx = i.cancellations
    plan.table({
      name: 'Cancellations', tab: P.red,
      title: 'Cancellations',
      description: 'Every booking withdrawn during the period, by the date it was cancelled. Notice is the days between the cancellation and the arrival it was booked for — a negative number means it was cancelled after the guest was due. "No reason recorded" is a finding, not a gap.',
      totals: `${cx.total} cancelled · ${cx.pax} guests · ${cx.shortNotice} at a week or less${cx.ratePct !== null ? ` · ${cx.ratePct}% of intake` : ''}`,
      what: 'Everything withdrawn during the period, with the notice given, the reason recorded and the fee',
      cols: [
        { header: 'Booking ref', width: 15, value: c => c.bookingRef },
        { header: 'Channel', width: 9, kind: 'source', value: c => c.source },
        { header: 'Country', width: 16, value: c => c.countryLabel },
        { header: 'Agent', width: 28, value: c => c.agent ?? '' },
        { header: 'Arrival', width: 12, kind: 'date', value: c => c.arrivalDate },
        { header: 'Notice (days)', width: 10, kind: 'int', value: c => c.noticeDays, total: 'avg', tone: c => (c.noticeDays !== null && c.noticeDays <= 7 ? 'bad' : null) },
        { header: 'Short notice', width: 9, kind: 'flag', value: c => (c.noticeDays !== null && c.noticeDays <= 7 ? 'Yes' : '') },
        { header: 'Total pax', width: 9, kind: 'int', value: c => c.pax, total: 'sum' },
        { header: 'Currency', width: 9, value: c => c.currency },
        { header: 'Quoted total', width: 14, kind: 'money', value: c => c.quotedTotal },
        { header: 'Fee recorded', width: 13, kind: 'money', value: c => c.feeTotal },
        { header: 'Cancelled at', width: 17, kind: 'stamp', value: c => c.cancelledAt },
        { header: 'Cancelled by', width: 22, value: c => c.cancelledBy ?? '' },
        { header: 'Reason', width: 60, wrap: true, value: c => c.reason ?? 'No reason recorded', tone: c => (c.reason ? null : 'warn') },
      ],
      rows: cx.lines,
      empty: 'Nothing was cancelled in this period.',
    })
    if (cx.lines.length) {
      plan.breakdown({
        name: 'Cancel Reasons', tab: P.red,
        title: 'Why bookings were cancelled',
        description: 'Cancellations grouped by the reason recorded, with the notice they gave. A reason that keeps coming back is a fix, not a fact of life.',
        what: 'Cancellations grouped by reason, with guests and average notice',
        rows: cx.lines, keyHeader: 'Reason', keyWidth: 44, key: c => (c.reason?.trim() || 'No reason recorded').slice(0, 120),
        measures: [
          { header: 'Cancellations', value: rs => rs.length, bar: P.red },
          { header: 'Guests', value: rs => sumPax(rs) },
          { header: 'Short notice', value: rs => rs.filter(c => c.noticeDays !== null && c.noticeDays <= 7).length },
          { header: 'Avg notice (days)', kind: 'num', total: false, value: rs => { const n = rs.map(c => c.noticeDays).filter((x): x is number => x !== null); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : null } },
        ],
        notes: [{ header: 'Agents', value: rs => Array.from(new Set(rs.map(c => c.agent ?? '—'))).slice(0, 6).join(', ') }],
      })
    }
  }

  // ── Operated ───────────────────────────────────────────────────────────────
  if (i?.delivery.available) {
    const dv = i.delivery
    plan.table({
      name: 'Operated', tab: P.indigo,
      title: 'Tours that operated in this period',
      description: 'Every tour on the ground for at least one day of the period, including ones that started before it or ran past it — those are marked "straddles". Days in period counts only the days inside the window, so the guest-days column sums to the figure in the email without double-counting.',
      totals: `${dv.toursOperated} tours · ${dv.pax} guests · ${dv.guestDays.toLocaleString('en-US')} guest-days · ${dv.arrivals} started · ${dv.departures} ended`,
      what: 'Every tour that was on the ground for at least one day of the period, with the guest-days it contributed',
      cols: [
        { header: 'Booking ref', width: 15, value: l => l.bookingRef },
        { header: 'Channel', width: 9, kind: 'source', value: l => l.source },
        { header: 'Country', width: 16, value: l => l.countryLabel },
        { header: 'Agent', width: 28, value: l => l.agent ?? '' },
        { header: 'Booking type', width: 12, value: l => (l.hotelOnly ? 'Hotel only' : 'Full tour') },
        { header: 'Arrival', width: 12, kind: 'date', value: l => l.arrivalDate },
        { header: 'Departure', width: 12, kind: 'date', value: l => l.departureDate },
        { header: 'Days in period', width: 10, kind: 'int', value: l => l.daysInPeriod, total: 'sum' },
        { header: 'Total pax', width: 9, kind: 'int', value: l => l.pax, total: 'sum' },
        { header: 'Guest-days in period', width: 12, kind: 'int', value: l => l.guestDaysInPeriod, total: 'sum', bar: P.indigo },
        { header: 'Straddles period', width: 10, kind: 'yes', value: l => yes(l.straddles) },
        { header: 'Status', width: 16, value: l => l.status.replace(/_/g, ' ') },
      ],
      rows: dv.lines,
      empty: 'No tours were on the ground in this period.',
    })
    if (dv.byDate.length) {
      plan.table({
        name: 'Movements by Day', tab: P.blue,
        title: 'Arrivals and departures by day',
        description: 'Tours starting and ending on each local date inside the window — the airport and hotel workload the period actually contained.',
        what: 'Arrivals and departures per day inside the period',
        cols: [
          { header: 'Date', width: 14, kind: 'date', value: x => x.date },
          { header: 'Day', width: 12, value: x => formatReportDate(x.date, { weekday: true }).slice(0, 3) },
          { header: 'Arrivals', width: 11, kind: 'int', value: x => x.arrivals, total: 'sum', bar: P.green },
          { header: 'Departures', width: 11, kind: 'int', value: x => x.departures, total: 'sum', bar: P.blue },
          { header: 'Net', width: 9, kind: 'int', value: x => x.arrivals - x.departures, total: 'sum', tone: x => (x.arrivals - x.departures > 0 ? 'good' : x.arrivals - x.departures < 0 ? 'warn' : null) },
        ],
        rows: dv.byDate,
      })
    }
  }

  // ── On ground ──────────────────────────────────────────────────────────────
  plan.table({
    name: 'On Ground', tab: P.indigo,
    title: `Tours in country — ${d.onGround.date}`,
    description: 'A live position as at the morning the report was written, not the period it covers. Day shows how far into the tour each file is; Progress draws it as a bar.',
    totals: `${d.onGround.total} tours · ${d.onGround.pax} guests`,
    what: 'Tours in-country on the morning the report was written',
    cols: [
      { header: 'Booking ref', width: 15, value: t => t.bookingRef },
      { header: 'Channel', width: 9, kind: 'source', value: t => t.source },
      { header: 'Country', width: 16, value: t => t.countryLabel },
      { header: 'Lead guest', width: 26, value: t => t.leadPassenger ?? '' },
      { header: 'Booking type', width: 12, value: t => (t.hotelOnly ? 'Hotel only' : 'Full tour') },
      { header: 'Day', width: 7, kind: 'int', value: t => t.dayNo },
      { header: 'Of', width: 7, kind: 'int', value: t => t.totalDays },
      { header: 'Progress', width: 11, kind: 'pct', value: t => (t.totalDays ? t.dayNo / t.totalDays : null), bar: P.indigo },
      { header: 'Arrival', width: 12, kind: 'date', value: t => t.arrivalDate },
      { header: 'Departure', width: 12, kind: 'date', value: t => t.departureDate },
      { header: 'Total pax', width: 9, kind: 'int', value: t => t.pax, total: 'sum' },
      { header: 'Status', width: 16, value: t => t.status.replace(/_/g, ' ') },
    ],
    rows: d.onGround.tours,
    empty: 'No tours were in country on this date.',
  })

  // ── Readiness ──────────────────────────────────────────────────────────────
  plan.table({
    name: 'Arrivals 3 Days', tab: P.blue,
    title: `Arrivals ${formatReportDate(d.readiness.fromDate)} to ${formatReportDate(d.readiness.toDate)} — readiness`,
    description: 'The live chase list, as at the morning after the period closed. "Ready" means nothing on the checklist is outstanding. Operating tours only: cancelled files (including a cancellation awaiting accounts) and accommodation-only bookings are left out.',
    totals: `${d.readiness.bookings.length} arrivals · ${d.readiness.notReady} not ready`,
    what: 'The next three days of arrivals with their readiness checklist resolved — the live chase list',
    cols: [
      { header: 'Booking ref', width: 15, value: b => b.bookingRef },
      { header: 'Channel', width: 9, kind: 'source', value: b => b.source },
      { header: 'Country', width: 16, value: b => b.countryLabel },
      { header: 'Lead guest', width: 26, value: b => b.leadPassenger ?? '' },
      { header: 'Arrival', width: 12, kind: 'date', value: b => b.arrivalDate },
      { header: 'Days away', width: 9, kind: 'int', value: b => b.daysToArrival },
      { header: 'Total pax', width: 9, kind: 'int', value: b => b.pax, total: 'sum' },
      { header: 'Ready', width: 10, kind: 'flag', value: b => (b.readiness.ready ? 'Ready' : 'Not ready') },
      { header: 'Client', width: 10, kind: 'state', value: b => ({ DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A' })[b.readiness.client.state] },
      { header: 'Driver', width: 10, kind: 'state', value: b => ({ DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A' })[b.readiness.driver.state] },
      { header: 'Tickets', width: 10, kind: 'state', value: b => ({ DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A' })[b.readiness.tickets.state] },
      { header: 'QC', width: 10, kind: 'state', value: b => ({ DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A' })[b.readiness.qc.state] },
      { header: 'Blocking', width: 32, wrap: true, value: b => b.readiness.blocking.join('; ') },
      { header: 'Drivers', width: 28, wrap: true, value: b => b.readiness.driver.detail },
      { header: 'Tickets detail', width: 28, wrap: true, value: b => b.readiness.tickets.detail },
      { header: 'Outstanding', width: 36, wrap: true, value: b => b.readiness.outstanding.join('; ') },
      { header: `D-${RECONFIRM_DUE_DAYS} reason recorded`, width: 36, wrap: true, value: b => (b.delay ? `${b.delay.reasonLabel}${b.delay.note ? ` — ${b.delay.note}` : ''}` : '') },
    ],
    rows: d.readiness.bookings,
    empty: 'Nothing arrives in the next three days.',
  })

  // ── Reconfirmation ─────────────────────────────────────────────────────────
  if (d.reconfirm.breached) {
    plan.table({
      name: 'Reconfirmation', tab: P.amber,
      title: `Guest reconfirmation — past D-${RECONFIRM_DUE_DAYS}`,
      description: `Every booking arriving within ${RECONFIRM_DUE_DAYS} days whose guest has still not been reconfirmed. The reason column carries the desk's own words, unedited — a blank one is the finding, because nobody has said why. Days late counts from the D-${RECONFIRM_DUE_DAYS} deadline, not from arrival.`,
      totals: `${d.reconfirm.bookings.length} past the deadline · ${d.reconfirm.bookings.filter(b => !b.delay).length} with no reason recorded`,
      what: `Everything travelling inside D-${RECONFIRM_DUE_DAYS} that is past its guest-reconfirmation deadline, with the reason recorded`,
      cols: [
        { header: 'Booking ref', width: 15, value: b => b.bookingRef },
        { header: 'Channel', width: 9, kind: 'source', value: b => b.source },
        { header: 'Country', width: 16, value: b => b.countryLabel },
        { header: 'Lead guest', width: 26, value: b => b.leadPassenger ?? '' },
        { header: 'Arrival', width: 12, kind: 'date', value: b => b.arrivalDate },
        { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: b => b.dueAt },
        { header: 'Days late', width: 9, kind: 'int', value: b => b.daysLate, total: 'avg', bar: P.red },
        { header: 'Total pax', width: 9, kind: 'int', value: b => b.pax, total: 'sum' },
        { header: 'Status', width: 16, value: b => b.status.replace(/_/g, ' ') },
        { header: 'Client confirmed', width: 10, kind: 'yes', value: b => yes(b.clientConfirmed) },
        { header: 'Pre-tour call', width: 10, kind: 'yes', value: b => yes(b.preTourCalled) },
        { header: 'Reason', width: 26, value: b => b.delay?.reasonLabel ?? 'NO REASON RECORDED', tone: b => (b.delay ? null : 'bad') },
        { header: 'Detail', width: 50, wrap: true, value: b => b.delay?.note ?? '' },
        { header: 'Recorded by', width: 22, value: b => b.delay?.recordedBy ?? '' },
        { header: 'Recorded on', width: 13, kind: 'date', value: b => b.delay?.recordedAt ?? null },
        { header: 'Reason age (days)', width: 10, kind: 'int', value: b => b.delay?.ageDays ?? null },
        { header: 'Stale', width: 8, kind: 'flag', value: b => (b.delay?.stale ? 'Yes' : '') },
      ],
      rows: d.reconfirm.bookings,
    })
  }

  // ── Complaints ─────────────────────────────────────────────────────────────
  if (d.complaints.available) {
    type CRow = { c: Complaint; origin: string }
    const rows: CRow[] = [
      ...(d.complaints.allItems ?? d.complaints.items).map(c => ({ c, origin: 'This period' })),
      ...d.complaints.carriedOpen.map(c => ({ c, origin: 'Carried, still open' })),
    ]
    plan.table<CRow>({
      name: 'Complaints', tab: P.red,
      title: 'Complaints',
      description: 'One row per issue, not per call. A guest raising the same problem three times is one row with "Times raised" of 3 — the individual call timestamps are in the trail column. Rows marked carried were raised before this period and are still open.',
      totals: `${d.complaints.total} in period · ${d.complaints.open} open · ${d.complaints.carriedOpen.length} carried`,
      what: 'One row per issue, not per call, with the recurrence trail and the resolution',
      cols: [
        { header: 'First raised', width: 17, kind: 'stamp', value: x => x.c.createdAt },
        { header: 'Last raised', width: 17, kind: 'stamp', value: x => x.c.lastRaisedAt },
        { header: 'Times raised', width: 9, kind: 'int', value: x => x.c.occurrences, total: 'sum' },
        { header: 'From', width: 16, value: x => x.origin },
        { header: 'Booking ref', width: 15, value: x => x.c.bookingRef ?? '' },
        { header: 'Customer', width: 24, value: x => x.c.customerName ?? '' },
        { header: 'Country', width: 16, value: x => x.c.countryLabel },
        { header: 'Category', width: 20, value: x => x.c.categories.join(' | ') },
        { header: 'Severity', width: 10, kind: 'flag', value: x => x.c.severity.charAt(0).toUpperCase() + x.c.severity.slice(1).toLowerCase() },
        { header: 'Status', width: 11, value: x => x.c.status },
        { header: 'Title', width: 36, wrap: true, value: x => x.c.title ?? '' },
        { header: 'Details', width: 56, wrap: true, value: x => x.c.details ?? '' },
        { header: 'Guest words', width: 44, wrap: true, value: x => x.c.customerQuote ?? '' },
        { header: 'Resolution', width: 44, wrap: true, value: x => x.c.resolutionNote ?? '' },
        { header: 'Resolved at', width: 17, kind: 'stamp', value: x => x.c.resolvedAt },
        { header: 'Hours to resolve', width: 10, kind: 'int', value: x => x.c.resolutionHours, total: 'avg' },
        { header: 'Call trail', width: 40, wrap: true, value: x => x.c.trail.map(t => stampText(t.createdAt)).join(' | ') },
      ],
      rows,
      rowTint: x => (x.origin === 'This period' ? null : P.pendingWash),
      empty: 'No complaints were raised in this period.',
    })
    const flat = rows.map(r => r.c)
    if (flat.length) {
      plan.breakdown<Complaint>({
        name: 'Complaint Themes', tab: P.red,
        title: 'What guests complained about',
        description: 'Issues grouped by their first category. Times raised counts the calls behind them, so a theme guests had to chase stands out.',
        what: 'Complaints grouped by category, with recurrences, open count and time to resolve',
        rows: flat, keyHeader: 'Category', key: c => c.categories[0] ?? 'Uncategorised',
        measures: [
          { header: 'Issues', value: rs => rs.length, bar: P.red },
          { header: 'Times raised', value: rs => rs.reduce((s, c) => s + c.occurrences, 0) },
          { header: 'Still open', value: rs => rs.filter(c => !c.resolvedAt).length },
          { header: 'Avg hours to resolve', kind: 'num', total: false, value: rs => { const h = rs.map(c => c.resolutionHours).filter((x): x is number => x !== null); return h.length ? h.reduce((s, x) => s + x, 0) / h.length : null } },
        ],
      })
    }
  }

  // ── Forward book ───────────────────────────────────────────────────────────
  plan.table({
    name: 'Forward Book', tab: P.b2c,
    title: 'Forward book by arrival month',
    description: `Everything sold and not yet travelled, as at ${d.onGround.date}. This is the only sheet describing the future rather than the period just closed.`,
    totals: `${d.upcoming.total} tours on the book · ${d.upcoming.next7} within 7 days · ${d.upcoming.next30} within 30`,
    what: 'Everything already sold and not yet travelled, by arrival month',
    cols: [
      { header: 'Arrival month', width: 18, value: m => m.label },
      { header: 'Tours', width: 11, kind: 'int', value: m => m.bookings, total: 'sum', bar: P.b2c },
      { header: 'Guests', width: 11, kind: 'int', value: m => m.pax, total: 'sum', bar: P.brand },
      { header: 'Share of book', width: 12, kind: 'pct', value: m => (d.upcoming.total ? m.bookings / d.upcoming.total : null), total: 'sum' },
      { header: 'Guests per tour', width: 12, kind: 'num', value: m => (m.bookings ? m.pax / m.bookings : null) },
    ],
    rows: d.upcoming.byMonth,
    empty: 'Nothing is on the forward book.',
  })

  // ── Count check ────────────────────────────────────────────────────────────
  if (d.countCheck.available) {
    const cc = d.countCheck
    plan.canvas({
      name: 'Count Check', tab: P.muted, width: 12, firstCol: 30,
      what: 'Upstream against bookings, P&Ls and invoices, as the accounts ledger holds it',
      draw: c => {
        c.banner('Accounts Sync Ledger', 'Count check — upstream vs OPS vs P&L vs invoice',
          'Read from the accounts Sync Ledger, so this sheet and the accounts mails cannot quote different figures for the same period. One booking counts once; a booking cancelled upstream is not owed an invoice; a period nobody swept reads "never swept" rather than "balanced".')
        c.header(['Business', 'Upstream', 'Cancelled upstream', 'Settle to zero', 'OPS bookings', 'P&Ls', 'Invoices', 'P&L short', 'Invoice short', 'OPS short', 'Status', 'Last checked'],
          [undefined, P.deep, P.muted, P.muted, P.brand, P.indigo, P.green, P.red, P.red, P.red, undefined, undefined])
        for (const t of [...cc.channels, { ...cc.overall, label: 'Both businesses' }]) {
          c.line([t.label, t.upstream, t.cancelled, t.notBillable, t.bookings, t.pnls, t.invoices, t.pnlShort, t.invoiceShort, t.bookingShort, t.status, stampText(t.checkedAt) || 'never swept'],
            { alarmCols: [8, 9, 10], bold: t.label === 'Both businesses', bg: t.label === 'Both businesses' ? P.brandWash : undefined })
        }
        if (cc.intake) {
          const n = cc.intake
          c.gap()
          c.title('How this report\'s intake meets the confirmations')
          c.header(['Measure', 'Count'])
          c.line(['Created here, confirmed upstream in this period', n.matched])
          c.line(['Created here against an earlier confirmation', n.earlierConfirmations])
          c.line(['Confirmed in this period, filed here after midnight', n.enteredLater])
          c.line(['Confirmed upstream, nothing here', n.missing], { alarmCols: [2] })
          if (n.missingRefs.length) c.note(`Missing references: ${n.missingRefs.join(', ')}`, P.badInk)
        }
      },
    })
  }

  // ── Parity ─────────────────────────────────────────────────────────────────
  if (d.parity.available) {
    const pt = d.parity
    plan.table({
      name: 'AS Parity', tab: P.muted,
      title: 'AppleSystem parity by confirmation date',
      description: `The two counts that must be equal: what AppleSystem confirmed, and what this system holds. Source: ${pt.source === 'live' ? 'asked of AppleSystem while this report was written' : 'the last reconciliation, because AppleSystem could not be reached'}.${pt.note ? ` ${pt.note}` : ''}`,
      what: 'AppleSystem confirmations against what this system received, day by day',
      cols: [
        { header: 'Confirmation date', width: 16, kind: 'date', value: b => b.date },
        { header: 'Confirmed in AppleSystem', width: 16, kind: 'int', value: b => b.upstreamConfirmed, total: 'sum' },
        { header: 'Held in this system', width: 16, kind: 'int', value: b => b.systemHeld, total: 'sum' },
        { header: 'Missing', width: 10, kind: 'int', value: b => b.missing, total: 'sum', tone: b => (b.missing ? 'bad' : null) },
        { header: 'Match', width: 10, kind: 'pct', value: b => (b.upstreamConfirmed ? b.systemHeld / b.upstreamConfirmed : null) },
      ],
      rows: pt.byDate,
    })
    if (pt.gaps.length || pt.cancellations.length) {
      type Gap = { kind: string; date: string; ref: string; detail: string }
      plan.table<Gap>({
        name: 'Parity Gaps', tab: P.red,
        title: 'Parity gaps — what to chase',
        description: 'Confirmations AppleSystem raised that never arrived here, and files the reconciler cancelled here because they were withdrawn upstream.',
        what: 'Missing confirmations and reconciler cancellations, one per reference',
        cols: [
          { header: 'Type', width: 30, kind: 'text', value: g => g.kind },
          { header: 'Date', width: 13, kind: 'date', value: g => g.date },
          { header: 'Reference', width: 18, value: g => g.ref },
          { header: 'Detail', width: 60, wrap: true, value: g => g.detail },
        ],
        rows: [
          ...pt.gaps.map(g => ({ kind: 'Missing from this system', date: g.date, ref: g.ref, detail: 'Confirmed in AppleSystem, not filed here' })),
          ...pt.cancellations.map(x => ({ kind: 'Cancelled here by the reconciler', date: x.at.slice(0, 10), ref: x.ref, detail: `Was ${x.prevStatus}, upstream ${x.upstreamStatus}` })),
        ],
        rowTint: g => (g.kind.startsWith('Missing') ? P.redWash : null),
      })
    }
  }

  // ── Overview (written first, so it is the tab the file opens on) ───────────
  const c = new Canvas(wb, 'Overview', { tab: P.deep })
  c.banner(
    `Apple Holidays · ${PERIOD_LABEL[d.window.period]} business review`,
    `${PERIOD_LABEL[d.window.period]} Business Review — ${d.window.label}`,
    `${formatReportDate(d.window.fromDate)} to ${formatReportDate(d.window.toDate)} · times in ${d.window.timezone} · ${gen} · `
      + (d.countries.length ? `scoped to ${d.countries.map(x => x.replace(/_/g, ' ')).join(', ')}` : 'all operating countries'),
  )
  const delta = (cur: number, prev: number | null | undefined) => {
    if (!comparable || prev === null || prev === undefined) return ''
    const diff = cur - prev
    return `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)} vs ${i!.previousLabel}`
  }
  if (i) {
    c.tiles([
      { label: 'Bookings confirmed', value: i.totals.bookings, note: delta(i.totals.bookings, i.totals.previousBookings) || `B2B ${i.totals.channel.b2b} · B2C ${i.totals.channel.b2c}`, color: P.brand },
      { label: 'Guests booked', value: i.totals.pax, note: delta(i.totals.pax, i.totals.previousPax), color: P.b2c },
      { label: 'Tours operated', value: i.delivery.toursOperated, note: `${i.delivery.guestDays.toLocaleString('en-US')} guest-days`, color: P.indigo },
      { label: 'Cancellations', value: i.cancellations.total, note: i.cancellations.ratePct !== null ? `${i.cancellations.ratePct}% of intake` : '', color: P.red },
      { label: 'Complaints', value: i.quality.complaints, note: i.quality.per100Tours !== null ? `${i.quality.per100Tours} per 100 tours` : '', color: P.amber },
      { label: 'Forward book', value: d.upcoming.total, note: `${d.upcoming.next30} within 30 days`, color: P.green },
    ])

    if (i.actions.length) {
      c.title('What needs attention', 'The ranked findings from the Actions tab.')
      for (const a of i.actions.slice(0, 8)) c.callout(a.severity, a.title, a.sheet ? `${a.detail}  →  ${a.sheet}` : a.detail)
      c.gap()
    }

    c.title('Headline figures', `This ${periodWord} against ${comparable ? i.previousLabel : 'the previous period (not comparable — change left blank)'}.`)
    c.header(['Measure', 'This period', 'Previous', 'Change', 'Change %'], [undefined, P.brand, P.muted, P.indigo, P.indigo])
    for (const s of scores.slice(0, 10)) {
      const ch = change(s)
      const cp = changePct(s)
      c.line([s.measure, s.current, s.previous, ch, cp], { kinds: [undefined, s.pct ? 'pct' : 'num', s.pct ? 'pct' : 'num', s.pct ? 'pct' : 'num', 'pct'], deltaCols: [4, 5] })
    }
    c.gap()

    if (series.length) {
      c.title(`Intake by ${i.granularity === 'week' ? 'week' : 'day'}`, 'Bookings filed against tours arriving — drawn as bars inside the cells.')
      c.header(['Bucket', 'Bookings', 'Guests', 'Arrived', 'Departed'], [undefined, P.brand, P.b2c, P.green, P.blue])
      const first = c.r
      for (const p of series) c.line([p.label, p.bookings, p.pax, p.arrivals, p.departures])
      c.bars(2, first, c.r - 1, P.brand)
      c.bars(4, first, c.r - 1, P.green)
      c.gap()
    }

    if (i.countryMovers.length) {
      c.title('Markets at a glance', 'Top markets this period with the change on last.')
      c.header(['Market', 'Bookings', 'Guests', 'Previous', 'Change'], [undefined, P.green, P.b2c, P.muted, P.indigo])
      const first = c.r
      for (const m of i.countryMovers.slice(0, 8)) c.line([m.label, m.current, m.pax, comparable ? m.previous : null, comparable ? m.delta : null], { deltaCols: [5] })
      c.bars(2, first, c.r - 1, P.green)
      c.gap()
    }
  } else {
    c.note('Period analytics were unavailable for this run, so the dashboard is limited to the tabs below.', P.warnInk)
    c.gap()
  }

  c.title('How to read this file')
  c.callout('watch', 'Counted population', d.created.basis === 'apple'
    ? `Every figure counts the ${d.created.total} bookings AppleSystem confirmed inside the period — the same population the accounts invoice and P&L mails report. A booking filed here in the period against an earlier confirmation is on "Not Counted".`
    : `The accounts Sync Ledger could not be read, so the period counts the ${d.created.total} bookings this system filed. These figures may not match the accounts mails.`)
  c.callout('watch', 'Comparisons', comparable
    ? `Every "previous" column is ${i!.previousLabel}, counted exactly the same way. Where the previous period could not be counted on the same basis the columns are left blank rather than filled.`
    : 'The previous period could not be counted on the same basis, so change columns are blank on every sheet.')
  c.callout('watch', 'Money', 'Never blended across currencies. Currency is always its own column; no sheet totals two of them together.')
  c.callout('watch', 'Forward-looking tabs', `"Arrivals 3 Days", "Reconfirmation", "On Ground" and "Forward Book" describe the position as at ${d.onGround.date} — the morning after the ${periodWord} closed. They are the only tabs that can still be acted on.`)
  c.gap()
  c.index(plan.index())

  plan.write(wb, gen)
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, sheets: ['Overview', ...plan.names()] }
}
