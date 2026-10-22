/**
 * The daily Operations Report workbook — the attachment on the morning mail.
 *
 * Replaces the flat CSV the daily report used to attach. The desk reads this
 * file beside the mail, so it is built to be read, not just pivoted:
 *
 *  - **Overview first.** A banner, the day's headline tiles, Today vs Next 7
 *    days side by side, the five board checks split B2B / B2C, and an index
 *    whose every line jumps to its tab.
 *  - **One population per tab.** B2B, B2C, Hotel Only and Cancelled each have a
 *    tab of their own, so a column can always be summed and nothing on a sheet
 *    is a different kind of thing from the rest of it.
 *  - **Same shape on every data tab.** Row 1 names it, row 2 says what it holds
 *    and how it was counted, row 3 carries the tab's own totals, row 4 is the
 *    frozen, filterable header, data from row 5.
 *  - **Typed cells.** Counts are numbers and dates are dates, so a reader can
 *    sum, sort and filter without cleaning anything first. Check states are
 *    words *and* colours — colour is never the only signal.
 *
 * Built on `@/lib/excel-kit`, the house style the weekly, Ops Board and MC
 * workbooks share: live SUBTOTAL footers that follow a filter, in-cell bars on
 * volume columns, and a heatmap / breakdown tab where a pivot would otherwise
 * have to be built by hand.
 */
import type { ReadinessState } from '@/lib/booking-readiness'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'
import { detectCountryFromRef } from '@/lib/country-detection'
import { todayNewAndUpdated, reportCountryLabel, type ReportData, type BookingLine, type SplitFile } from './report-data'
import type { BoardRow, BoardView } from './ops-board-digest'
import { formatReportDate, PERIOD_LABEL } from './report-window'
import {
  P, SERIES, Canvas, SheetPlan, newWorkbook, yes, daysBetween, shortDay, groupBy,
  type Col,
} from '@/lib/excel-kit'

const STATE_WORD: Record<ReadinessState, string> = {
  DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A',
}

// ─── Column sets ──────────────────────────────────────────────────────────────

function movement(r: BoardRow, single: boolean): string {
  const arr = single ? r.arrivesToday : r.isArrival
  const dep = single ? r.departsToday : r.isDeparture
  if (arr && dep) return 'Arrives + departs'
  if (arr) return 'Arrives'
  if (dep) return 'Departs'
  return 'In tour'
}

function boardCols(single: boolean): Col<BoardRow>[] {
  // A cancelled file is listed but never graded — nothing is left to get ready.
  const st = (r: BoardRow, s: ReadinessState) => (r.cancelled ? '' : STATE_WORD[s])
  return [
    { header: 'Booking ref', width: 13, value: r => r.bookingRef },
    { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
    { header: 'Channel', width: 9, kind: 'source', value: r => r.source },
    { header: 'Country', width: 12, value: r => r.countryLabel },
    { header: 'Agent', width: 22, value: r => r.agent ?? '' },
    { header: 'File handler', width: 16, value: r => r.fileHandler ?? '' },
    { header: 'Status', width: 18, value: r => r.statusLabel },
    { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
    { header: 'Departure', width: 12, kind: 'date', value: r => r.departureDate },
    { header: single ? 'Day' : 'Day (on D+0)', width: 9, value: r => `${r.dayNo}/${r.totalDays}` },
    { header: 'Movement', width: 15, value: r => movement(r, single) },
    { header: 'Pax', width: 6, kind: 'int', value: r => r.pax, total: 'sum' },
    { header: 'Adults', width: 7, kind: 'int', value: r => r.paxAdults, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: r => r.paxChildren, total: 'sum' },
    { header: 'Infants', width: 7, kind: 'int', value: r => r.paxInfants, total: 'sum' },
    { header: 'Booking type', width: 12, value: r => (r.hotelOnly ? 'Hotel Only' : 'Full tour') },
    { header: 'Cancelled', width: 10, value: r => (r.cancelled ? 'CANCELLED' : r.cancelPending ? 'Pending' : '') },
    { header: 'Reconfirmation', width: 13, kind: 'state', value: r => st(r, r.reconfirmState) },
    { header: 'Client confirmed', width: 10, kind: 'yes', value: r => (r.hotelOnly || r.cancelled ? '' : yes(r.clientConfirmed)) },
    { header: 'Pre-tour call', width: 10, kind: 'yes', value: r => (r.hotelOnly || r.cancelled ? '' : yes(!!r.preTourCall)) },
    { header: 'Call request', width: 12, kind: 'state', value: r => st(r, r.callState) },
    { header: 'Driver / Vendor', width: 12, kind: 'state', value: r => st(r, r.driver.state) },
    { header: 'Transfers covered', width: 11, value: r => (r.driver.required ? `${r.driver.done}/${r.driver.required}` : '') },
    { header: 'Tickets', width: 10, kind: 'state', value: r => st(r, r.tickets.state) },
    { header: 'Tickets issued', width: 10, value: r => (r.tickets.required ? `${r.tickets.done}/${r.tickets.required}` : '') },
    { header: 'QC stage', width: 9, value: r => (r.qc.stage === 'NONE' ? '—' : r.qc.stage) },
    { header: 'QC', width: 9, kind: 'state', value: r => st(r, r.qc.state) },
    { header: 'Fully ready', width: 10, kind: 'flag', value: r => (r.cancelled ? '' : r.ready ? 'Ready' : 'Not ready') },
    { header: 'Outstanding', width: 34, wrap: true, value: r => r.outstanding.join(', ') },
    { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: r => r.reconfirmStanding.dueAt },
    { header: `Past D-${RECONFIRM_DUE_DAYS}`, width: 9, value: r => (r.reconfirmBreached ? `${Math.abs(r.reconfirmStanding.daysToDue)}d late` : '') },
    { header: 'Delay reason', width: 24, wrap: true, value: r => (r.reconfirmDelay ? `${r.reconfirmDelay.reasonLabel}${r.reconfirmDelay.note ? ` — ${r.reconfirmDelay.note}` : ''}` : r.reconfirmBreached ? 'NO REASON RECORDED' : '') },
    { header: 'Driver detail', width: 34, wrap: true, value: r => r.driver.detail },
    { header: 'Ticket detail', width: 30, wrap: true, value: r => r.tickets.detail },
    { header: 'Test file', width: 9, value: r => (r.testFile ? 'Test' : '') },
  ]
}

const tintRow = (r: BoardRow): string | null =>
  r.cancelled ? 'FFF1F5F9' : r.cancelPending ? 'FFFFF7ED' : r.hotelOnly ? 'FFFFFBEB' : null

function bookingCols(): Col<BookingLine>[] {
  return [
    { header: 'Booking ref', width: 13, value: b => b.bookingRef },
    { header: 'Channel', width: 9, kind: 'source', value: b => b.source },
    { header: 'Country', width: 12, value: b => b.countryLabel },
    { header: 'Agent', width: 26, value: b => b.agent ?? '' },
    { header: 'Status', width: 16, value: b => b.status.replace(/_/g, ' ') },
    { header: 'Booking type', width: 12, value: b => (b.hotelOnly ? 'Hotel Only' : 'Full tour') },
    { header: 'Arrival', width: 12, kind: 'date', value: b => b.arrivalDate },
    { header: 'Departure', width: 12, kind: 'date', value: b => b.departureDate },
    { header: 'Pax', width: 6, kind: 'int', value: b => b.pax, total: 'sum' },
    { header: 'Adults', width: 7, kind: 'int', value: b => b.paxAdults, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: b => b.paxChildren, total: 'sum' },
    { header: 'Infants', width: 7, kind: 'int', value: b => b.paxInfants, total: 'sum' },
    { header: 'Currency', width: 9, value: b => b.currency },
    { header: 'Quoted total', width: 13, kind: 'money', value: b => b.quotedTotal },
    { header: 'Created at', width: 17, kind: 'stamp', value: b => b.createdAt },
    { header: 'Nights', width: 8, kind: 'int', value: b => daysBetween(b.arrivalDate, b.departureDate) },
    { header: 'Lead time (days)', width: 11, kind: 'int', value: b => daysBetween(b.createdAt, b.arrivalDate), total: 'avg' },
  ]
}

/**
 * The Today new & updated files, one row per booking as the accounts ledger
 * counts it — the invoice it was last raised on, and this system's file beside
 * it. Blank OPS columns mean no file is held here (Intake = Not filed here).
 */
function splitFileCols(): Col<SplitFile>[] {
  return [
    { header: 'New / Amended', width: 11, kind: 'flag', value: f => f.pass },
    { header: 'Booking ref', width: 13, value: f => f.booking?.bookingRef ?? f.ref },
    { header: 'Invoice no.', width: 16, value: f => f.invoiceNumber },
    { header: 'Document', width: 10, value: f => f.type },
    { header: 'Channel', width: 9, kind: 'source', value: () => 'B2B' },
    { header: 'Country', width: 12, value: f => f.booking?.countryLabel ?? reportCountryLabel(detectCountryFromRef(f.ref) ?? 'UNASSIGNED') },
    { header: 'Agent', width: 26, value: f => f.booking?.agent ?? f.agent },
    { header: 'Guest', width: 24, value: f => f.guest },
    { header: 'Status', width: 16, value: f => f.booking?.status.replace(/_/g, ' ') ?? '' },
    { header: 'Booking type', width: 12, value: f => (f.booking ? (f.booking.hotelOnly ? 'Hotel Only' : 'Full tour') : '') },
    { header: 'Arrival', width: 12, kind: 'date', value: f => f.booking?.arrivalDate ?? null },
    { header: 'Departure', width: 12, kind: 'date', value: f => f.booking?.departureDate ?? null },
    { header: 'Pax', width: 6, kind: 'int', value: f => f.booking?.pax ?? null, total: 'sum' },
    { header: 'Adults', width: 7, kind: 'int', value: f => f.booking?.paxAdults ?? null, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: f => f.booking?.paxChildren ?? null, total: 'sum' },
    { header: 'Infants', width: 7, kind: 'int', value: f => f.booking?.paxInfants ?? null, total: 'sum' },
    { header: 'Currency', width: 9, value: f => f.currency },
    { header: 'Invoice amount', width: 13, kind: 'money', value: f => f.amount },
    { header: 'First raised', width: 12, kind: 'date', value: f => f.firstOn },
    { header: 'Age (days)', width: 9, kind: 'int', value: f => f.ageDays },
    { header: 'Revisions', width: 9, kind: 'int', value: f => f.revisions },
    { header: 'Raised at', width: 17, kind: 'stamp', value: f => f.raisedAt },
    { header: 'Intake', width: 16, value: f => f.intake },
  ]
}

function paxOf<T extends { pax: number }>(rows: T[]): number {
  return rows.reduce((s, r) => s + r.pax, 0)
}

function splitLine(rows: { source: string; pax: number }[]): string {
  const b2b = rows.filter(r => r.source === 'B2B')
  const b2c = rows.filter(r => r.source === 'B2C')
  return `${rows.length} files · ${paxOf(rows)} pax · B2B ${b2b.length} · B2C ${b2c.length}`
}


/** How urgent one open item is: by how close the guest is and whether D-10 is silent. */
function priorityOf(r: BoardRow): 'Critical' | 'High' | 'Medium' {
  const away = r.reconfirmStanding.daysToArrival
  if (away <= 1) return 'Critical'
  if (away <= 3 || (r.reconfirmBreached && !r.reconfirmDelay)) return 'High'
  return 'Medium'
}

interface ActionItem { row: BoardRow; item: string; priority: 'Critical' | 'High' | 'Medium' }

/** One line per open item per live file — the chase list, worst first. */
function actionItems(rows: BoardRow[]): ActionItem[] {
  const rank = { Critical: 0, High: 1, Medium: 2 }
  const out: ActionItem[] = []
  for (const r of rows) {
    if (r.cancelled || r.hotelOnly) continue
    const items = [...r.outstanding]
    if (r.reconfirmBreached && !r.reconfirmDelay) items.push(`D-${RECONFIRM_DUE_DAYS} reason not recorded`)
    for (const item of items) out.push({ row: r, item, priority: priorityOf(r) })
  }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority]
    || a.row.arrivalDate.localeCompare(b.row.arrivalDate) || a.row.bookingRef.localeCompare(b.row.bookingRef))
}

/** Measures shared by the handler and agent breakdowns. */
function loadMeasures(): import('@/lib/excel-kit').Measure<BoardRow>[] {
  return [
    { header: 'Live files', value: rs => rs.length, bar: P.brand },
    { header: 'Pax', value: rs => paxOf(rs) },
    { header: 'Arriving', value: rs => rs.filter(r => r.isArrival).length },
    { header: 'Fully ready', value: rs => rs.filter(r => r.ready).length },
    { header: 'Not ready', value: rs => rs.filter(r => !r.ready && !r.hotelOnly).length, bar: P.red },
    { header: 'Open items', value: rs => rs.reduce((s, r) => s + (r.hotelOnly ? 0 : r.outstanding.length), 0) },
    { header: `Past D-${RECONFIRM_DUE_DAYS}`, value: rs => rs.filter(r => r.reconfirmBreached).length },
    { header: 'Ready %', kind: 'pct', total: false, traffic: true, value: rs => { const s = rs.filter(r => !r.hotelOnly); return s.length ? s.filter(r => r.ready).length / s.length : null } },
  ]
}

// ─── Overview sheet ───────────────────────────────────────────────────────────

function overview(wb: import('exceljs').Workbook, d: ReportData, index: { name: string; what: string; tab: string }[]) {
  const c = new Canvas(wb, 'Overview', { tab: P.deep })
  c.banner(
    'AppleHolidays Operations',
    `${PERIOD_LABEL[d.window.period]} Operations Report`,
    `${d.window.label}   ·   Board today: ${d.opsBoard?.today?.label ?? formatReportDate(d.window.today, { weekday: true })}   ·   Generated ${d.generatedAt.replace('T', ' ').slice(0, 16)} UTC · times in ${d.window.timezone}`,
  )

  const sp = d.split
  c.tiles([
    { label: 'Today new & updated', value: todayNewAndUpdated(d), note: sp.available ? `${sp.todayCount} new + ${sp.oldCount} amended` : `B2B ${d.created.channel.b2b} · B2C ${d.created.channel.b2c}`, color: P.brand },
    { label: 'Old amendments', value: sp.available ? sp.oldCount : '—', note: sp.available && sp.oldest ? `oldest ${sp.oldest}d back` : 'earlier files re-opened', color: P.amber },
    { label: 'On ground today', value: d.opsBoard?.today?.onGround.files ?? d.onGround.total, note: `${d.opsBoard?.today?.onGround.pax ?? d.onGround.pax} guests`, color: P.indigo },
    { label: 'D-3 drivers', value: `${d.readiness.drivers.allocated}/${d.readiness.drivers.tours}`, note: `${d.readiness.drivers.partial + d.readiness.drivers.pending} need a driver`, color: P.blue },
    { label: 'Reconfirmed', value: `${d.reconfirm.status.completed}/${d.reconfirm.total}`, note: `${d.reconfirm.status.pending} pending · ${d.reconfirm.status.overdue} late`, color: P.green },
    { label: 'Complaints', value: d.complaints.total, note: `${d.complaints.open} open`, color: P.red },
  ])

  const b = d.opsBoard
  if (b?.available && b.today && b.week) {
    const t = b.today
    const w = b.week

    // ── What needs a human today
    const items = actionItems(w.rows)
    const crit = items.filter(i => i.priority === 'Critical')
    const high = items.filter(i => i.priority === 'High')
    c.title('Today’s focus', 'The chase list in three lines. Every item is listed on the Action List tab, worst first.')
    c.callout(crit.length ? 'critical' : 'good', `${crit.length} critical item${crit.length === 1 ? '' : 's'}`,
      crit.length
        ? `On files on the ground or landing within a day: ${Array.from(new Set(crit.map(i => i.row.bookingRef))).slice(0, 12).join(', ')}${new Set(crit.map(i => i.row.bookingRef)).size > 12 ? ' …' : ''}`
        : 'Nothing open on files that are on the ground or arriving tomorrow.')
    c.callout(high.length ? 'warning' : 'good', `${high.length} high-priority item${high.length === 1 ? '' : 's'}`,
      high.length ? `Arriving within 3 days, or past D-${RECONFIRM_DUE_DAYS} with no reason recorded — ${new Set(high.map(i => i.row.bookingRef)).size} files.` : 'Nothing due in the next three days.')
    if (w.cancelPending) c.callout('watch', `${w.cancelPending} cancellation${w.cancelPending === 1 ? '' : 's'} awaiting accounts`, 'Still live until accounts decides — check before allocating more drivers or tickets against them. See the Cancelled tab.')
    c.gap()

    // ── Today vs next 7 days
    c.title('Operations board — Today vs Next 7 days',
      `Today = ${t.label}. Next 7 days = ${w.label} (today included). Live files exclude Cancelled; Hotel Only is part of live and shown on its own line. Same rules as the dashboard board.`)
    c.header(['Measure', 'Today files', 'Today pax', 'Today B2B', 'Today B2C', '', '7-day files', '7-day pax', '7-day B2B', '7-day B2C'],
      [undefined, P.indigo, P.indigo, P.b2b, P.b2c, P.white, P.brand, P.brand, P.b2b, P.b2c])
    type Quad = { files: number; pax: number; b2b: number; b2c: number }
    const pair = (label: string, a: Quad, x: Quad, opts: Parameters<Canvas['line']>[1] = {}) =>
      c.line([label, a.files, a.pax, a.b2b, a.b2c, null, x.files, x.pax, x.b2b, x.b2c], opts)
    pair('On ground (live)', t.onGround, w.onGround, { bold: true, bg: P.indigoWash })
    pair('Arrivals', t.arrivals, w.arrivals)
    pair('Departures', t.departures, w.departures)
    const seg = (v: BoardView, key: string): Quad => {
      const s = v.segments.find(x => x.key === key)!
      return { files: s.files, pax: s.pax, b2b: s.b2b, b2c: s.b2c }
    }
    pair('Hotel Only (in live)', seg(t, 'HOTEL_ONLY'), seg(w, 'HOTEL_ONLY'), { labelColor: P.warnInk, bg: P.hotelWash })
    pair('Cancellation pending (in live)', seg(t, 'CANCEL_PENDING'), seg(w, 'CANCEL_PENDING'), { labelColor: P.amber })
    pair('Cancelled — not counted', seg(t, 'CANCELLED'), seg(w, 'CANCELLED'), { labelColor: P.badInk, bg: P.cancelled })
    const ready = (v: BoardView, src: string) => v.rows.filter(x => !x.cancelled && x.ready && x.source === src).length
    c.line([`Fully ready (${t.live ? Math.round((t.ready / t.live) * 100) : 0}% today · ${w.live ? Math.round((w.ready / w.live) * 100) : 0}% 7-day)`,
      t.ready, null, ready(t, 'B2B'), ready(t, 'B2C'), null, w.ready, null, ready(w, 'B2B'), ready(w, 'B2C')], { color: P.okInk, labelColor: P.okInk })
    c.line([`Past D-${RECONFIRM_DUE_DAYS} — breached`, t.d10.breached, null, null, null, null, w.d10.breached, null, null, null], { color: P.badInk })
    c.line([`Past D-${RECONFIRM_DUE_DAYS} — no reason recorded`, t.d10.unexplained, null, null, null, null, w.d10.unexplained, null, null, null], { color: P.badInk, labelColor: P.badInk })
    c.gap()

    // ── Check matrix
    c.title('Board checks — covered / in scope',
      'Covered = done + partly done, the way the board’s rings count. N/A files (Hotel Only, no tickets, no transfers) are out of scope. Pending is the outstanding work.')
    c.header(['Check', 'Today done', 'Today pending', 'Today %', 'Today B2B', 'Today B2C', '7-day done', '7-day pending', '7-day %', '7-day B2B', '7-day B2C'],
      [undefined, P.indigo, P.red, P.indigo, P.b2b, P.b2c, P.brand, P.red, P.brand, P.b2b, P.b2c])
    t.checks.forEach((k, i) => {
      const wc = w.checks[i]
      const frac = (x: { covered: number; scope: number }) => (x.scope ? `${x.covered}/${x.scope}` : '—')
      c.line([
        k.label,
        `${k.covered}/${k.scope}`, k.pending, k.scope ? k.covered / k.scope : null, frac(k.b2b), frac(k.b2c),
        `${wc.covered}/${wc.scope}`, wc.pending, wc.scope ? wc.covered / wc.scope : null, frac(wc.b2b), frac(wc.b2c),
      ], { pctCols: [4, 9], alarmCols: [3, 8] })
    })
    c.gap()

    // ── The week at a glance, with bars
    c.title('Next 7 days at a glance', 'Live files on the ground each day, with arrivals and departures. The bars are drawn to scale inside the cells.')
    c.header(['Day', 'On ground', 'Guests', 'Arrivals', 'Departures', 'Fully ready', 'No driver', 'Reconfirm pending'],
      [undefined, P.indigo, P.indigo, P.green, P.blue, P.green, P.red, P.amber])
    const first = c.r
    for (const x of w.perDay) {
      c.line([shortDay(x.date), x.onGround, x.pax, x.arrivals, x.departures, x.ready, x.driverPending, x.reconfirmPending],
        { alarmCols: [7, 8], bg: x.date === w.from ? P.indigoWash : undefined })
    }
    c.bars(2, first, c.r - 1, P.indigo)
    c.bars(4, first, c.r - 1, P.green)
    c.bars(5, first, c.r - 1, P.blue)
    c.gap()
  }

  // ── Intake
  c.title('Intake — Today new & updated',
    'New + booked & amended same day, plus order confirmations from earlier days edited in the period — as the accounts invoice mail counts the day. B2C / pax are AppleSystem\'s confirmations; every B2B file is on the New Bookings tab.')
  c.header(['Measure', 'Count'])
  c.line(['Today new & updated', todayNewAndUpdated(d)], { bold: true, bg: P.brandWash })
  // The ledger split is B2B only, so it is the B2B figure once it is read.
  c.line(['  B2B', sp.available ? todayNewAndUpdated(d) : d.created.channel.b2b], { labelColor: P.b2b })
  c.line(['  B2C', d.created.channel.b2c], { labelColor: P.b2c })
  c.line(['  Pax booked', d.created.pax])
  if (sp.available) {
    c.line(['New + booked & amended same day', sp.todayCount])
    c.line(['Old amendments (order confirmations edited)', sp.oldCount], { labelColor: P.amber })
  }
  if (d.created.missingRefs.length) c.line(['Confirmed upstream, not filed here', d.created.missingRefs.length], { labelColor: P.red, color: P.red })
  c.gap()

  c.index(index)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderDailyWorkbook(d: ReportData): Promise<{ buffer: Buffer; sheets: string[] }> {
  const wb = newWorkbook(`${PERIOD_LABEL[d.window.period]} Operations Report — ${d.window.label}`, new Date(d.generatedAt))
  const gen = `Generated ${d.generatedAt.replace('T', ' ').slice(0, 16)} UTC`
  const plan = new SheetPlan()

  // ── Intake
  // New Bookings is the tile itself: one row per file behind Today new &
  // updated, so the tab's row count is the mail's number. AppleSystem's own
  // confirmations follow on a tab of their own.
  const sp = d.split
  if (sp.available) {
    const fresh = sp.files.filter(f => f.pass === 'New').length
    const notHere = sp.files.filter(f => !f.booking).length
    plan.table<SplitFile>({
      name: 'New Bookings', tab: P.brand,
      title: `Today new & updated — ${d.window.label}`,
      description: 'Every booking behind the mail\'s Today new & updated tile, as the accounts invoice ledger counts it: New = this period\'s own business (new, or booked & amended the same day); Amended = an order confirmation from an earlier day edited in the period. One row per booking, on its latest invoice. OPS columns are blank where this system holds no file.',
      totals: `${sp.files.length} files · ${fresh} new · ${sp.files.length - fresh} amended · B2B ${sp.files.length}${notHere ? ` · ${notHere} not filed here` : ''}`,
      what: 'Every file behind Today new & updated — new and amended, with invoice, pax and intake',
      cols: splitFileCols(), rows: sp.files,
      empty: 'The accounts ledger shows no new or amended bookings in this period.',
    })
  }
  const created = d.created.allBookings ?? d.created.bookings
  plan.table({
    name: sp.available ? 'AS Confirmed' : 'New Bookings', tab: sp.available ? P.indigo : P.brand,
    title: sp.available ? `Confirmed by AppleSystem — ${d.window.label}` : `Today new & updated — ${d.window.label}`,
    description: 'Every booking AppleSystem confirmed in the report period. B2B is agent work; B2C is the Aahaas storefront. Lead time is days from filing to arrival.',
    totals: splitLine(created),
    what: 'Every booking confirmed in the period, B2B and B2C, with pax, quoted value and lead time',
    cols: bookingCols(), rows: created,
    empty: 'AppleSystem confirmed no bookings in this period.',
  })
  const outside = d.created.allOutside ?? d.created.outside
  if (outside.length) {
    plan.table({
      name: 'Filed - Not Counted', tab: P.muted,
      title: 'Also filed here — not counted',
      description: 'Entered in this system during the period against a confirmation AppleSystem raised on an earlier day. Real work, another day’s business — never added into the counts.',
      totals: splitLine(outside),
      what: 'Bookings filed in the period against earlier confirmations (not counted)',
      cols: bookingCols(), rows: outside,
    })
  }

  // ── Board
  const b = d.opsBoard
  if (b?.available && b.today && b.week) {
    const t = b.today
    const w = b.week
    const live = w.rows.filter(r => !r.cancelled)
    const items = actionItems(w.rows)

    plan.table<ActionItem>({
      name: 'Action List', tab: P.red,
      title: `Action list — every open item · next 7 days (${w.label})`,
      description: `One row per open item per live file, worst first. Critical = guest on the ground or landing within a day; High = landing within 3 days, or past D-${RECONFIRM_DUE_DAYS} with no reason recorded; Medium = everything else in the window. Hotel Only and cancelled files have nothing to chase and are left out.`,
      totals: `${items.length} items · ${items.filter(i => i.priority === 'Critical').length} critical · ${items.filter(i => i.priority === 'High').length} high · on ${new Set(items.map(i => i.row.bookingRef)).size} files`,
      what: 'Every open item on every live file in the next 7 days, ranked Critical / High / Medium',
      cols: [
        { header: 'Priority', width: 11, kind: 'flag', value: i => i.priority },
        { header: 'Booking ref', width: 13, value: i => i.row.bookingRef },
        { header: 'Open item', width: 30, wrap: true, value: i => i.item },
        { header: 'Arrival', width: 12, kind: 'date', value: i => i.row.arrivalDate },
        { header: 'Days to arrival', width: 10, kind: 'int', value: i => i.row.reconfirmStanding.daysToArrival },
        { header: 'Movement', width: 15, value: i => movement(i.row, false) },
        { header: 'Lead guest', width: 22, value: i => i.row.leadPassenger ?? '' },
        { header: 'Channel', width: 9, kind: 'source', value: i => i.row.source },
        { header: 'Country', width: 12, value: i => i.row.countryLabel },
        { header: 'File handler', width: 16, value: i => i.row.fileHandler ?? '' },
        { header: 'Agent', width: 22, value: i => i.row.agent ?? '' },
        { header: 'Pax', width: 6, kind: 'int', value: i => i.row.pax },
        { header: 'Cancel pending', width: 10, value: i => (i.row.cancelPending ? 'Yes' : '') },
      ],
      rows: items,
      rowTint: i => (i.priority === 'Critical' ? 'FFFFF1F2' : null),
      freezeCols: 2,
      empty: 'Nothing open on any live file in the next 7 days.',
    })
    plan.table({
      name: 'Board Today', tab: P.indigo,
      title: `Operations board — Today · ${t.label}`,
      description: 'Every file on the ground today, exactly as the dashboard board lists it. Cancelled rows are shown (greyed, struck through) but not counted; Hotel Only rows are tinted amber and their checks read N/A.',
      totals: `${t.live} live · ${t.onGround.pax} pax · B2B ${t.onGround.b2b} · B2C ${t.onGround.b2c} · ${t.arrivals.files} arriving · ${t.departures.files} departing · ${t.hotelOnly} Hotel Only · ${t.cancelled} cancelled · ${t.ready} fully ready`,
      what: 'Every file on the ground today, with all five checks',
      cols: boardCols(true), rows: t.rows, rowTint: tintRow, strike: r => r.cancelled,
    })
    plan.table({
      name: 'Board Next 7 Days', tab: P.brand,
      title: `Operations board — Next 7 days · ${w.label}`,
      description: 'Every file on the ground at any point from today through D+6. Movement says whether the guest arrives or departs inside the window. Cancelled rows are shown but not counted.',
      totals: `${w.live} live · ${w.onGround.pax} pax · B2B ${w.onGround.b2b} · B2C ${w.onGround.b2c} · ${w.arrivals.files} arriving · ${w.departures.files} departing · ${w.hotelOnly} Hotel Only · ${w.cancelled} cancelled`,
      what: 'Every file on the ground in the next 7 days, with all five checks',
      cols: boardCols(false), rows: w.rows, rowTint: tintRow, strike: r => r.cancelled,
    })
    plan.table({
      name: '7-Day Outlook', tab: P.blue,
      title: `Day by day — ${w.label}`,
      description: 'One row per day. On ground counts live files only. No driver = live files with no driver on any transfer yet. Reconfirm pending = that day’s arrivals with neither reconfirmation signal in. Bars are drawn to scale inside the cells.',
      what: 'One row per day: on ground, arrivals, departures, B2B / B2C, Hotel Only, cancelled, readiness',
      cols: [
        { header: 'Date', width: 14, kind: 'date', value: x => x.date },
        { header: 'Weekday', width: 10, value: x => formatReportDate(x.date, { weekday: true }).slice(0, 3) },
        { header: 'On ground', width: 11, kind: 'int', value: x => x.onGround, bar: P.indigo },
        { header: 'Guests', width: 9, kind: 'int', value: x => x.pax, bar: P.b2c },
        { header: 'Arrivals', width: 10, kind: 'int', value: x => x.arrivals, total: 'sum', bar: P.green },
        { header: 'Arrival pax', width: 11, kind: 'int', value: x => x.arrivalPax, total: 'sum' },
        { header: 'Departures', width: 11, kind: 'int', value: x => x.departures, total: 'sum', bar: P.blue },
        { header: 'Departure pax', width: 12, kind: 'int', value: x => x.departurePax, total: 'sum' },
        { header: 'B2B', width: 8, kind: 'int', value: x => x.b2b },
        { header: 'B2C', width: 8, kind: 'int', value: x => x.b2c },
        { header: 'Hotel Only', width: 10, kind: 'int', value: x => x.hotelOnly },
        { header: 'Cancelled', width: 10, kind: 'int', value: x => x.cancelled },
        { header: 'Fully ready', width: 11, kind: 'int', value: x => x.ready },
        { header: 'No driver', width: 10, kind: 'int', value: x => x.driverPending, tone: x => (x.driverPending ? 'bad' : null) },
        { header: 'Reconfirm pending', width: 12, kind: 'int', value: x => x.reconfirmPending, tone: x => (x.reconfirmPending ? 'warn' : null) },
      ],
      rows: w.perDay,
      rowTint: x => (x.date === w.from ? P.indigoWash : null),
    })

    // Country × day — live files on the ground each day, as a heatmap.
    const days = w.perDay.map(x => x.date)
    const byCountry = groupBy(live, r => r.countryLabel)
    plan.matrix({
      name: 'Country Heatmap', tab: P.green,
      title: `Country × day — live files on the ground · ${w.label}`,
      description: 'Each cell is the number of live files in that country on that day (arrival day through departure day). Darker is busier. Cancelled files are not counted.',
      what: 'Country × day heatmap of live files on the ground over the next 7 days',
      rowHeader: 'Country',
      rows: Array.from(byCountry.keys()).sort(),
      cols: days.map(x => ({ key: x, label: shortDay(x) })),
      value: (country, dt) => (byCountry.get(country) ?? []).filter(r => r.arrivalDate <= dt && r.departureDate >= dt).length,
      color: P.green, colWidth: 12,
    })
    plan.breakdown<BoardRow>({
      name: 'Handlers', tab: P.indigo,
      title: `File handlers — workload & readiness · next 7 days (${w.label})`,
      description: 'Live files grouped by the person handling them. Not ready and open items are the work still on each desk; Ready % is fully-ready files over files with a tour to run (Hotel Only left out).',
      what: 'Workload and readiness by file handler for the next 7 days',
      rows: live, keyHeader: 'File handler', key: r => r.fileHandler ?? 'Unassigned',
      measures: loadMeasures(),
    })
    plan.breakdown<BoardRow>({
      name: 'Agents', tab: P.b2b,
      title: `Agents — files on the ground · next 7 days (${w.label})`,
      description: 'Live files grouped by the agent who sold them. B2C storefront orders sit under their own channel name.',
      what: 'Live files by agent with readiness for the next 7 days',
      rows: live, keyHeader: 'Agent', keyWidth: 34, key: r => r.agent ?? (r.source === 'B2C' ? 'Aahaas (B2C)' : 'No agent'),
      measures: loadMeasures(),
    })
    plan.table({
      name: 'B2B Files', tab: P.b2b,
      title: `B2B — agent files · next 7 days (${w.label})`,
      description: 'Live B2B files on the ground at any point in the next 7 days (cancelled are on their own tab). Hotel Only files are included and tinted.',
      totals: splitLine(live.filter(r => r.source === 'B2B')),
      what: 'Live B2B (agent) files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.source === 'B2B'), rowTint: tintRow,
    })
    plan.table({
      name: 'B2C Files', tab: P.b2c,
      title: `B2C — Aahaas storefront · next 7 days (${w.label})`,
      description: 'Live B2C files on the ground at any point in the next 7 days (cancelled are on their own tab).',
      totals: splitLine(live.filter(r => r.source === 'B2C')),
      what: 'Live B2C (Aahaas storefront) files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.source === 'B2C'), rowTint: tintRow,
      empty: 'No B2C files on the ground in the next 7 days.',
    })
    plan.table({
      name: 'Hotel Only', tab: P.amber,
      title: `Hotel Only — next 7 days (${w.label})`,
      description: 'Accommodation-only files. The guest is in the country and counted as live, but there is no tour to allocate, ticket, QC or reconfirm — every check reads N/A.',
      totals: splitLine(live.filter(r => r.hotelOnly)),
      what: 'Accommodation-only files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.hotelOnly),
      empty: 'No Hotel Only files in the next 7 days.',
    })
    const cancelled = w.rows.filter(r => r.cancelled || r.cancelPending)
    plan.table({
      name: 'Cancelled', tab: P.red,
      title: `Cancelled & cancellation pending — next 7 days (${w.label})`,
      description: 'Cancelled files are listed so a driver is never sent for a guest who is not coming; they are excluded from every count. Cancellation pending files are still live until accounts decides.',
      totals: `${w.rows.filter(r => r.cancelled).length} cancelled · ${w.rows.filter(r => r.cancelPending && !r.cancelled).length} pending · ${paxOf(cancelled)} pax`,
      what: 'Cancelled files and pending cancellation requests in the next 7 days',
      cols: [
        { header: 'Booking ref', width: 13, value: r => r.bookingRef },
        { header: 'State', width: 15, kind: 'flag', value: r => (r.cancelled ? 'Cancelled' : 'Cancel pending') },
        { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
        { header: 'Channel', width: 9, kind: 'source', value: r => r.source },
        { header: 'Country', width: 12, value: r => r.countryLabel },
        { header: 'Agent', width: 22, value: r => r.agent ?? '' },
        { header: 'Booking type', width: 12, value: r => (r.hotelOnly ? 'Hotel Only' : 'Full tour') },
        { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
        { header: 'Departure', width: 12, kind: 'date', value: r => r.departureDate },
        { header: 'Pax', width: 6, kind: 'int', value: r => r.pax, total: 'sum' },
        { header: 'On ground today', width: 10, value: r => (r.onToday ? 'Yes' : '') },
        { header: 'Requested', width: 17, kind: 'stamp', value: r => r.cancellation?.requestedAt ?? null },
        { header: 'Requested by', width: 18, value: r => r.cancellation?.requestedBy ?? '' },
        { header: 'Reason', width: 36, wrap: true, value: r => r.cancellation?.reason ?? '' },
        { header: 'Fee', width: 11, kind: 'money', value: r => r.cancellation?.feeTotal ?? null },
        { header: 'Currency', width: 9, value: r => r.cancellation?.currency ?? '' },
        { header: 'Waiting (days)', width: 10, kind: 'int', value: r => (r.cancelled ? null : r.cancellation?.waitingDays ?? null), tone: r => ((r.cancellation?.waitingDays ?? 0) >= 3 && !r.cancelled ? 'bad' : null) },
        { header: 'Decided', width: 17, kind: 'stamp', value: r => r.cancellation?.decidedAt ?? null },
      ],
      rows: cancelled,
      empty: 'No cancelled files in the next 7 days.',
    })
    plan.table({
      name: 'Countries', tab: P.green,
      title: `Country-wise — next 7 days (${w.label})`,
      description: 'Live files by operating country with the B2B / B2C split; Hotel Only is part of live, Cancelled is counted apart.',
      what: 'Country breakdown with B2B / B2C, Hotel Only and Cancelled',
      cols: [
        { header: 'Country', width: 16, value: x => x.label },
        { header: 'Live files', width: 11, kind: 'int', value: x => x.files, total: 'sum', bar: P.green },
        { header: 'Pax', width: 9, kind: 'int', value: x => x.pax, total: 'sum', bar: P.b2c },
        { header: 'B2B', width: 9, kind: 'int', value: x => x.b2b, total: 'sum' },
        { header: 'B2C', width: 9, kind: 'int', value: x => x.b2c, total: 'sum' },
        { header: 'Hotel Only', width: 11, kind: 'int', value: x => x.hotelOnly, total: 'sum' },
        { header: 'Cancelled', width: 11, kind: 'int', value: x => x.cancelled, total: 'sum' },
      ],
      rows: w.byCountry,
    })
  }

  // ── Readiness, drivers, reconfirmation (the mail's own sections)
  const rd = d.readiness
  type RdLine = typeof rd.bookings[number]
  plan.table<RdLine>({
    name: 'D-3 Drivers', tab: P.blue,
    title: `D-3 driver allocation — arrivals ${formatReportDate(rd.fromDate)} to ${formatReportDate(rd.toDate)}`,
    description: 'Operating tours only — cancelled and accommodation-only files are left out. Outstanding first.',
    totals: `${rd.drivers.allocated}/${rd.drivers.tours} allocated · ${rd.drivers.partial} part · ${rd.drivers.pending} pending`,
    what: 'D-3 driver allocation for the next three days of arrivals',
    cols: [
      { header: 'Booking ref', width: 13, value: x => x.bookingRef },
      { header: 'Lead guest', width: 24, value: x => x.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: x => x.source },
      { header: 'Country', width: 12, value: x => x.countryLabel },
      { header: 'Arrival', width: 12, kind: 'date', value: x => x.arrivalDate },
      { header: 'Day', width: 6, value: x => `D-${x.daysToArrival}` },
      { header: 'Pax', width: 6, kind: 'int', value: x => x.pax, total: 'sum' },
      { header: 'Allocation', width: 14, kind: 'flag', value: x => (x.readiness.driver.state === 'DONE' ? 'Allocated' : x.readiness.driver.state === 'PARTIAL' ? 'Part-allocated' : 'Pending') },
      { header: 'Covered', width: 9, kind: 'int', value: x => x.readiness.driver.done, total: 'sum' },
      { header: 'Required', width: 9, kind: 'int', value: x => x.readiness.driver.required, total: 'sum' },
      { header: 'Coverage', width: 10, kind: 'pct', value: x => (x.readiness.driver.required ? x.readiness.driver.done / x.readiness.driver.required : null), bar: P.blue },
      { header: 'Detail', width: 50, wrap: true, value: x => x.readiness.driver.detail },
    ],
    rows: [...rd.drivers.outstanding, ...rd.drivers.done],
  })
  plan.table<RdLine>({
    name: 'Readiness 3 Days', tab: P.indigo,
    title: `Arrivals ${formatReportDate(rd.fromDate)} to ${formatReportDate(rd.toDate)} — readiness`,
    description: 'Every arrival in the next three days with its checklist. Blocking items stop the guest landing cleanly; QC does not block.',
    totals: `${rd.bookings.length} arrivals · ${rd.notReady} not ready`,
    what: 'Next three days of arrivals with client, driver, ticket and QC readiness',
    cols: [
      { header: 'Booking ref', width: 13, value: x => x.bookingRef },
      { header: 'Lead guest', width: 24, value: x => x.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: x => x.source },
      { header: 'Country', width: 12, value: x => x.countryLabel },
      { header: 'Booking type', width: 12, value: x => (x.hotelOnly ? 'Hotel Only' : 'Full tour') },
      { header: 'Arrival', width: 12, kind: 'date', value: x => x.arrivalDate },
      { header: 'Days', width: 6, kind: 'int', value: x => x.daysToArrival },
      { header: 'Pax', width: 6, kind: 'int', value: x => x.pax, total: 'sum' },
      { header: 'Client', width: 10, kind: 'state', value: x => STATE_WORD[x.readiness.client.state] },
      { header: 'Driver', width: 10, kind: 'state', value: x => STATE_WORD[x.readiness.driver.state] },
      { header: 'Tickets', width: 10, kind: 'state', value: x => STATE_WORD[x.readiness.tickets.state] },
      { header: 'QC', width: 10, kind: 'state', value: x => STATE_WORD[x.readiness.qc.state] },
      { header: 'Ready', width: 10, kind: 'flag', value: x => (x.readiness.ready ? 'Ready' : 'Not ready') },
      { header: 'Blocking', width: 30, wrap: true, value: x => x.readiness.blocking.join(', ') },
      { header: 'Outstanding', width: 30, wrap: true, value: x => x.readiness.outstanding.join(', ') },
    ],
    rows: rd.bookings,
  })
  const rc = d.reconfirm
  type RcLine = typeof rc.status.pendingLines[number]
  plan.table<RcLine>({
    name: 'Reconfirmation', tab: P.green,
    title: `Reconfirmation status — arrivals ${formatReportDate(rc.fromDate)} to ${formatReportDate(rc.toDate)}`,
    description: `Cancelled and Hotel Only excluded. A booking is reconfirmed once the client confirms or a pre-tour call is logged; D-${RECONFIRM_DUE_DAYS} is the deadline.`,
    totals: `${rc.status.completed} completed · ${rc.status.pending} pending · ${rc.status.overdue} late`,
    what: `Reconfirmation status and D-${RECONFIRM_DUE_DAYS} standing for upcoming arrivals`,
    cols: [
      { header: 'Booking ref', width: 13, value: l => l.bookingRef },
      { header: 'Lead guest', width: 24, value: l => l.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: l => l.source },
      { header: 'Country', width: 12, value: l => l.countryLabel },
      { header: 'Arrival', width: 12, kind: 'date', value: l => l.arrivalDate },
      { header: 'Pax', width: 6, kind: 'int', value: l => l.pax, total: 'sum' },
      { header: 'Reconfirmation', width: 14, kind: 'flag', value: l => (l.completed ? 'Completed' : 'Pending') },
      { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: l => l.dueAt },
      { header: 'Standing', width: 14, kind: 'flag', value: l => (l.completed ? '' : l.stage === 'OVERDUE' ? 'Overdue' : l.stage === 'DUE_TODAY' ? 'Due today' : 'On track') },
      { header: 'Days to due', width: 9, kind: 'int', value: l => (l.completed ? null : l.daysToDue), tone: l => (!l.completed && l.daysToDue < 0 ? 'bad' : null) },
      { header: 'Client confirmed', width: 10, kind: 'yes', value: l => yes(l.clientConfirmed) },
      { header: 'Pre-tour call', width: 10, kind: 'yes', value: l => yes(l.preTourCalled) },
      { header: 'Reason', width: 36, wrap: true, value: l => (l.delay ? `${l.delay.reasonLabel}${l.delay.note ? ` — ${l.delay.note}` : ''}` : '') },
    ],
    rows: [...rc.status.pendingLines, ...rc.status.completedLines],
  })

  // ── Complaints & upcoming
  const complaints = [...d.complaints.items, ...d.complaints.carriedOpen]
  type CLine = typeof complaints[number]
  plan.table<CLine>({
    name: 'Complaints', tab: P.red,
    title: 'Complaints',
    description: 'One row per issue — repeats of one issue count once; "Times raised" keeps the underlying alerts visible.',
    totals: `${d.complaints.total} in period · ${d.complaints.open} open`,
    what: 'Complaints raised in the period and still-open earlier ones',
    cols: [
      { header: 'First raised', width: 17, kind: 'stamp', value: x => x.createdAt },
      { header: 'Booking ref', width: 13, value: x => x.bookingRef ?? '' },
      { header: 'Customer', width: 22, value: x => x.customerName ?? '' },
      { header: 'Country', width: 12, value: x => x.countryLabel },
      { header: 'Category', width: 18, value: x => x.categories.join(', ') },
      { header: 'Severity', width: 10, kind: 'flag', value: x => x.severity.charAt(0).toUpperCase() + x.severity.slice(1).toLowerCase() },
      { header: 'Status', width: 12, value: x => x.status },
      { header: 'Times raised', width: 8, kind: 'int', value: x => x.occurrences, total: 'sum' },
      { header: 'Title', width: 30, wrap: true, value: x => x.title ?? '' },
      { header: 'Details', width: 50, wrap: true, value: x => x.details ?? '' },
      { header: 'Resolution', width: 36, wrap: true, value: x => x.resolutionNote ?? '' },
      { header: 'Hours to resolve', width: 10, kind: 'int', value: x => x.resolutionHours ?? null, total: 'avg' },
    ],
    rows: complaints,
    empty: 'No complaints in this period.',
  })
  plan.table({
    name: 'Upcoming', tab: P.b2c,
    title: 'Upcoming arrivals',
    description: 'The nearest upcoming arrivals in scope.',
    totals: `${d.upcoming.total} upcoming · ${d.upcoming.next7} in the next 7 days`,
    what: 'Upcoming arrivals',
    cols: bookingCols(),
    rows: d.upcoming.imminent,
  })

  if (d.parity.available && d.parity.byDate.length) {
    type PLine = typeof d.parity.byDate[number]
    plan.table<PLine>({
      name: 'AppleSystem Parity', tab: P.muted,
      title: 'AppleSystem parity by create date',
      description: 'Confirmations raised in AppleSystem against bookings created here. Missing is the number to act on.',
      what: 'AppleSystem ↔ OPS parity by date',
      cols: [
        { header: 'Create date', width: 14, kind: 'date', value: x => x.date },
        { header: 'Confirmed in AppleSystem', width: 16, kind: 'int', value: x => x.upstreamConfirmed, total: 'sum' },
        { header: 'Created here', width: 14, kind: 'int', value: x => x.systemHeld, total: 'sum' },
        { header: 'Missing', width: 10, kind: 'int', value: x => x.missing, total: 'sum', tone: x => (x.missing ? 'bad' : null) },
      ],
      rows: d.parity.byDate,
    })
  }

  // Overview goes first, then every table in the order above.
  overview(wb, d, plan.index())
  plan.write(wb, gen)

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, sheets: ['Overview', ...plan.names()] }
}
