/**
 * The Ops Board's Excel export — built in the browser from the board already
 * on screen, so the file is exactly what the desk is looking at.
 *
 * Replaces the flat CSV the Export button used to write. Same house style as
 * the daily report's workbook (`@/lib/excel-kit`): an Overview dashboard first,
 * then one population per tab with its own totals, a frozen filterable header
 * and a live SUBTOTAL footer that follows any filter the reader applies.
 *
 * Two populations are kept apart on purpose. "All Files" is every file in the
 * window regardless of the chips on screen; "Your View" is only what the chips
 * left visible, and only appears when the two differ — so a file sent on to
 * someone else can never be mistaken for the whole board when it was a slice.
 */
import type { OpsDayBoard, OpsDayRow } from './ops-day-data'
import type { ReadinessState } from '@/lib/booking-readiness'
import { reconfirmState, callState } from './ops-board-states'
import { APPROVAL_LABEL } from './reconfirm-filters'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'
import { bookingSourceOf } from '@/lib/booking-source'
import {
  P, Canvas, SheetPlan, newWorkbook, downloadWorkbook, dateRange, shortDay, yes, groupBy,
  type Col, type Measure,
} from '@/lib/excel-kit'

const STATE_WORD: Record<ReadinessState, string> = { DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A' }
const STANDING_WORD: Record<string, string> = {
  NA: 'N/A', DONE: 'Done', BREACHED: 'Overdue', DUE: 'Due today', UPCOMING: 'On track', PAST: 'Late',
}

const sumPax = (rs: { pax: number }[]) => rs.reduce((s, r) => s + r.pax, 0)
const source = (r: OpsDayRow) => bookingSourceOf(r.agent)

function qcTick(r: OpsDayRow, round: 1 | 2): 'Pass' | 'Pending' {
  if (r.qc.stage === 'QC2') return 'Pass'
  if (r.qc.stage === 'QC1') return round === 1 ? 'Pass' : 'Pending'
  return 'Pending'
}

function movement(r: OpsDayRow): string {
  if (r.cancelled) return 'Cancelled'
  if (r.isArrival && r.isDeparture) return 'Arrives + departs'
  if (r.isArrival) return 'Arriving'
  if (r.isDeparture) return 'Departing'
  return r.hotelOnly ? 'In hotel' : 'On tour'
}

const tint = (r: OpsDayRow): string | null =>
  r.cancelled ? P.cancelled : r.cancelPending ? P.pendingWash : r.hotelOnly ? P.hotelWash : null

function priorityOf(r: OpsDayRow, today: string): 'Critical' | 'High' | 'Medium' {
  const away = r.reconfirmStanding.daysToArrival
  if (away <= 1 || r.arrivalDate <= today) return 'Critical'
  if (away <= 3 || (r.reconfirmBreached && !r.reconfirmDelay)) return 'High'
  return 'Medium'
}

/** Every column the CSV carried, typed and coloured. */
function fileCols(): Col<OpsDayRow>[] {
  // A cancelled file is listed but never graded — nothing is left to get ready.
  const st = (r: OpsDayRow, s: ReadinessState) => (r.cancelled ? '' : STATE_WORD[s])
  return [
    { header: 'Booking ref', width: 13, value: r => r.bookingRef },
    { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
    { header: 'Channel', width: 9, kind: 'source', value: source },
    { header: 'Booking type', width: 12, value: r => (r.cancelled ? 'CANCELLED' : r.hotelOnly ? 'Hotel Only' : 'Full tour') },
    { header: 'Country', width: 12, value: r => r.countryLabel },
    { header: 'Destination', width: 18, value: r => r.destination ?? '' },
    { header: 'Agent', width: 22, value: r => r.agent ?? '' },
    { header: 'File handler', width: 16, value: r => r.fileHandler ?? '' },
    { header: 'Status', width: 18, value: r => r.statusLabel },
    { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
    { header: 'Departure', width: 12, kind: 'date', value: r => r.departureDate },
    { header: 'Day', width: 8, value: r => `${r.dayNo}/${r.totalDays}` },
    { header: 'Movement', width: 15, value: movement },
    { header: 'Pax', width: 6, kind: 'int', value: r => r.pax, total: 'sum' },
    { header: 'Adults', width: 7, kind: 'int', value: r => r.paxAdults, total: 'sum' },
    { header: 'Children', width: 8, kind: 'int', value: r => r.paxChildren, total: 'sum' },
    { header: 'Infants', width: 7, kind: 'int', value: r => r.paxInfants, total: 'sum' },
    { header: 'Reconfirmation', width: 13, kind: 'state', value: r => st(r, reconfirmState(r)) },
    { header: 'Client confirmed', width: 10, kind: 'yes', value: r => (r.hotelOnly || r.cancelled ? '' : yes(r.clientConfirmed)) },
    { header: 'Pre-tour call', width: 10, kind: 'yes', value: r => (r.hotelOnly || r.cancelled ? '' : yes(!!r.preTourCall)) },
    { header: 'Call outcome', width: 13, value: r => r.preTourCall?.outcome ?? '' },
    { header: 'WhatsApp call request', width: 12, kind: 'flag', value: r => (r.hotelOnly || r.cancelled ? '' : APPROVAL_LABEL[r.call.approval]) },
    { header: 'Call request', width: 11, kind: 'state', value: r => st(r, callState(r)) },
    { header: 'Driver / Vendor', width: 12, kind: 'state', value: r => st(r, r.driver.state) },
    { header: 'Transfers covered', width: 10, value: r => (r.driver.required ? `${r.driver.done}/${r.driver.required}` : '') },
    { header: 'Tickets', width: 10, kind: 'state', value: r => st(r, r.tickets.state) },
    { header: 'Tickets issued', width: 10, value: r => (r.tickets.required ? `${r.tickets.done}/${r.tickets.required}` : '') },
    { header: 'QC1', width: 8, kind: 'flag', value: r => (r.cancelled || r.hotelOnly ? '' : qcTick(r, 1)) },
    { header: 'QC2', width: 8, kind: 'flag', value: r => (r.cancelled || r.hotelOnly ? '' : qcTick(r, 2)) },
    { header: 'Fully ready', width: 10, kind: 'flag', value: r => (r.cancelled ? '' : r.ready ? 'Ready' : 'Not ready') },
    { header: 'Open items', width: 8, kind: 'int', value: r => (r.cancelled ? null : r.outstanding.length), total: 'sum' },
    { header: 'Outstanding', width: 34, wrap: true, value: r => r.outstanding.join(', ') },
    { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: r => r.reconfirmStanding.dueAt },
    { header: `D-${RECONFIRM_DUE_DAYS} status`, width: 11, kind: 'flag', value: r => (r.cancelled ? '' : STANDING_WORD[r.reconfirmStanding.state] ?? r.reconfirmStanding.state) },
    { header: 'Days late', width: 8, kind: 'int', value: r => (r.reconfirmBreached ? Math.abs(r.reconfirmStanding.daysToDue) : null), tone: r => (r.reconfirmBreached ? 'bad' : null) },
    { header: 'Delay reason', width: 24, wrap: true, value: r => (r.reconfirmBreached ? (r.reconfirmDelay?.reasonLabel ?? 'NO REASON RECORDED') : r.reconfirmDelay?.reasonLabel ?? ''), tone: r => (r.reconfirmBreached && !r.reconfirmDelay ? 'bad' : null) },
    { header: 'Delay detail', width: 30, wrap: true, value: r => r.reconfirmDelay?.note ?? '' },
    { header: 'Cancel approval', width: 15, kind: 'flag', value: r => (r.cancelPending ? 'Awaiting approval' : r.cancelled ? 'Cancelled' : '') },
    { header: 'Cancel reason', width: 26, wrap: true, value: r => r.cancellation?.reason ?? '' },
    { header: 'Cancellation fee', width: 11, kind: 'money', value: r => r.cancellation?.feeTotal ?? null },
    { header: 'Driver detail', width: 34, wrap: true, value: r => r.driver.detail },
    { header: 'Ticket detail', width: 30, wrap: true, value: r => r.tickets.detail },
    { header: 'Test file', width: 9, value: r => (r.testFile ? `Test — ${r.testFile.field}` : '') },
  ]
}

function loadMeasures(): Measure<OpsDayRow>[] {
  return [
    { header: 'Live files', value: rs => rs.length, bar: P.brand },
    { header: 'Pax', value: rs => sumPax(rs) },
    { header: 'Arriving', value: rs => rs.filter(r => r.isArrival).length },
    { header: 'Departing', value: rs => rs.filter(r => r.isDeparture).length },
    { header: 'Fully ready', value: rs => rs.filter(r => r.ready).length },
    { header: 'Not ready', value: rs => rs.filter(r => !r.ready && !r.hotelOnly).length, bar: P.red },
    { header: 'Open items', value: rs => rs.reduce((s, r) => s + (r.hotelOnly ? 0 : r.outstanding.length), 0) },
    { header: `Past D-${RECONFIRM_DUE_DAYS}`, value: rs => rs.filter(r => r.reconfirmBreached).length },
    { header: 'Ready %', kind: 'pct', total: false, traffic: true, value: rs => { const s = rs.filter(r => !r.hotelOnly); return s.length ? s.filter(r => r.ready).length / s.length : null } },
  ]
}

export interface OpsBoardExportOptions {
  board: OpsDayBoard
  /** Rows the on-screen filters left visible. */
  view: OpsDayRow[]
  /** Plain words for the filters behind `view`, e.g. "On ground · B2C · Pending only". */
  viewLabel: string
  /** Local `yyyy-mm-dd` today, for urgency. */
  today: string
}

export function buildOpsBoardWorkbook({ board, view, viewLabel, today }: OpsBoardExportOptions) {
  const wb = newWorkbook(`Operations Board — ${board.label}`)
  const gen = `Exported ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · times in ${board.timezone}`
  const plan = new SheetPlan()
  const all = board.rows
  const live = all.filter(r => !r.cancelled)
  const tours = live.filter(r => !r.hotelOnly)
  const s = board.summary
  const range = board.from !== board.to
  const splitLine = (rs: OpsDayRow[]) =>
    `${rs.length} files · ${sumPax(rs)} pax · B2B ${rs.filter(r => source(r) === 'B2B').length} · B2C ${rs.filter(r => source(r) === 'B2C').length}`

  // ── Action list
  type Item = { r: OpsDayRow; item: string; priority: 'Critical' | 'High' | 'Medium' }
  const rank = { Critical: 0, High: 1, Medium: 2 }
  const items: Item[] = []
  for (const r of tours) {
    const list = [...r.outstanding]
    if (r.reconfirmBreached && !r.reconfirmDelay) list.push(`D-${RECONFIRM_DUE_DAYS} reason not recorded`)
    for (const item of list) items.push({ r, item, priority: priorityOf(r, today) })
  }
  items.sort((a, b) => rank[a.priority] - rank[b.priority] || a.r.arrivalDate.localeCompare(b.r.arrivalDate) || a.r.bookingRef.localeCompare(b.r.bookingRef))

  if (view.length !== all.length) {
    plan.table({
      name: 'Your View', tab: P.indigo,
      title: `Your view — ${viewLabel}`,
      description: 'Only the files the board’s filters left visible when this was exported. The whole window is on "All Files".',
      totals: splitLine(view),
      what: `The files visible on screen at export (${viewLabel})`,
      cols: fileCols(), rows: view, rowTint: tint, strike: r => r.cancelled, freezeCols: 2,
    })
  }
  plan.table({
    name: 'All Files', tab: P.brand,
    title: `Operations board — every file · ${board.label}`,
    description: 'Every file on the ground at any point in the window, whatever the chips on screen were set to. Cancelled rows are greyed and struck through but never counted; Hotel Only rows are tinted amber and their checks read N/A; cancellation-pending rows are tinted orange.',
    totals: `${splitLine(live)} live · ${s.cancelled} cancelled · ${s.hotelOnly} Hotel Only · ${s.ready} fully ready`,
    what: 'Every file in the window with all checks, reconfirmation, D-10 and cancellation detail',
    cols: fileCols(), rows: all, rowTint: tint, strike: r => r.cancelled, freezeCols: 2,
  })
  plan.table<Item>({
    name: 'Action List', tab: P.red,
    title: `Action list — every open item · ${board.label}`,
    description: `One row per open item per live tour, worst first. Critical = guest already on the ground or landing within a day; High = landing within 3 days, or past D-${RECONFIRM_DUE_DAYS} with no reason recorded; Medium = everything else. Hotel Only and cancelled files have nothing to chase.`,
    totals: `${items.length} items · ${items.filter(i => i.priority === 'Critical').length} critical · ${items.filter(i => i.priority === 'High').length} high · on ${new Set(items.map(i => i.r.bookingRef)).size} files`,
    what: 'Every open item on every live tour, ranked Critical / High / Medium',
    cols: [
      { header: 'Priority', width: 11, kind: 'flag', value: i => i.priority },
      { header: 'Booking ref', width: 13, value: i => i.r.bookingRef },
      { header: 'Open item', width: 30, wrap: true, value: i => i.item },
      { header: 'Arrival', width: 12, kind: 'date', value: i => i.r.arrivalDate },
      { header: 'Days to arrival', width: 10, kind: 'int', value: i => i.r.reconfirmStanding.daysToArrival },
      { header: 'Movement', width: 15, value: i => movement(i.r) },
      { header: 'Lead guest', width: 22, value: i => i.r.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: i => source(i.r) },
      { header: 'Country', width: 12, value: i => i.r.countryLabel },
      { header: 'File handler', width: 16, value: i => i.r.fileHandler ?? '' },
      { header: 'Agent', width: 22, value: i => i.r.agent ?? '' },
      { header: 'Pax', width: 6, kind: 'int', value: i => i.r.pax },
      { header: 'Cancel pending', width: 10, value: i => (i.r.cancelPending ? 'Yes' : '') },
    ],
    rows: items,
    rowTint: i => (i.priority === 'Critical' ? 'FFFFF1F2' : null),
    freezeCols: 2,
    empty: 'Nothing open on any live tour in this window.',
  })
  plan.table({
    name: 'Arrivals', tab: P.green,
    title: `Arrivals — ${board.label}`,
    description: 'Live files whose guest lands inside the window.',
    totals: splitLine(live.filter(r => r.isArrival)),
    what: 'Live files arriving in the window',
    cols: fileCols(), rows: live.filter(r => r.isArrival), rowTint: tint, freezeCols: 2,
    empty: 'No arrivals in this window.',
  })
  plan.table({
    name: 'Departures', tab: P.blue,
    title: `Departures — ${board.label}`,
    description: 'Live files whose guest leaves inside the window.',
    totals: splitLine(live.filter(r => r.isDeparture)),
    what: 'Live files departing in the window',
    cols: fileCols(), rows: live.filter(r => r.isDeparture), rowTint: tint, freezeCols: 2,
    empty: 'No departures in this window.',
  })

  // ── Reconfirmation & WhatsApp
  plan.table({
    name: 'Reconfirmation', tab: P.amber,
    title: `Reconfirmation & D-${RECONFIRM_DUE_DAYS} — ${board.label}`,
    description: `Every live tour with both reconfirmation signals, where it stands against D-${RECONFIRM_DUE_DAYS}, and the reason recorded for a miss. Overdue first. A blank reason on an overdue file is the finding.`,
    totals: `${s.reconfirm.clientConfirmed} client confirmed · ${s.reconfirm.preTourCalled} pre-tour called · ${s.reconfirm.neither} neither · ${s.reconfirmDelay.breached} past D-${RECONFIRM_DUE_DAYS} (${s.reconfirmDelay.unexplained} unexplained)`,
    what: `Both reconfirmation signals and D-${RECONFIRM_DUE_DAYS} standing for every live tour`,
    cols: [
      { header: 'Booking ref', width: 13, value: r => r.bookingRef },
      { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: source },
      { header: 'Country', width: 12, value: r => r.countryLabel },
      { header: 'File handler', width: 16, value: r => r.fileHandler ?? '' },
      { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
      { header: 'Pax', width: 6, kind: 'int', value: r => r.pax, total: 'sum' },
      { header: 'Reconfirmation', width: 13, kind: 'state', value: r => STATE_WORD[reconfirmState(r)] },
      { header: 'Client confirmed', width: 10, kind: 'yes', value: r => yes(r.clientConfirmed) },
      { header: 'Pre-tour call', width: 10, kind: 'yes', value: r => yes(!!r.preTourCall) },
      { header: 'Call on', width: 12, kind: 'date', value: r => r.preTourCall?.at ?? null },
      { header: 'Call outcome', width: 13, value: r => r.preTourCall?.outcome ?? '' },
      { header: 'Dates OK', width: 8, value: r => r.preTourCall?.datesOk ?? '' },
      { header: 'Flight OK', width: 8, value: r => r.preTourCall?.flightOk ?? '' },
      { header: 'Pax OK', width: 8, value: r => r.preTourCall?.paxOk ?? '' },
      { header: 'Change asked', width: 24, wrap: true, value: r => r.preTourCall?.requestedChange ?? '' },
      { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: r => r.reconfirmStanding.dueAt },
      { header: 'Standing', width: 11, kind: 'flag', value: r => STANDING_WORD[r.reconfirmStanding.state] ?? '' },
      { header: 'Days to due', width: 9, kind: 'int', value: r => r.reconfirmStanding.daysToDue, tone: r => (r.reconfirmBreached ? 'bad' : null) },
      { header: 'Reason', width: 24, value: r => (r.reconfirmBreached ? r.reconfirmDelay?.reasonLabel ?? 'NO REASON RECORDED' : r.reconfirmDelay?.reasonLabel ?? ''), tone: r => (r.reconfirmBreached && !r.reconfirmDelay ? 'bad' : null) },
      { header: 'Detail', width: 34, wrap: true, value: r => r.reconfirmDelay?.note ?? '' },
      { header: 'Recorded by', width: 18, value: r => r.reconfirmDelay?.recordedBy ?? '' },
      { header: 'Recorded on', width: 12, kind: 'date', value: r => r.reconfirmDelay?.recordedAt ?? null },
      { header: 'Stale', width: 7, kind: 'flag', value: r => (r.reconfirmDelay?.stale ? 'Yes' : '') },
    ],
    rows: [...tours].sort((a, b) => Number(b.reconfirmBreached) - Number(a.reconfirmBreached) || a.reconfirmStanding.daysToDue - b.reconfirmStanding.daysToDue),
    rowTint: r => (r.reconfirmBreached && !r.reconfirmDelay ? 'FFFFF1F2' : null),
  })
  if (board.approvalDataAvailable || board.callDataAvailable) {
    plan.table({
      name: 'Call Requests', tab: P.green,
      title: `WhatsApp call permission & pre-tour calls — ${board.label}`,
      description: 'The bot can only ring a number the guest accepted over WhatsApp, so the request is the gate and the schedule is what happens behind it. "Unknown" means the approval ledger could not be read — not a refusal.',
      totals: `${s.callApproval.approved ?? 0} accepted · ${s.callApproval.pending ?? 0} sent · ${s.callApproval.not_requested ?? 0} not sent · ${s.callApproval.unknown ?? 0} unknown`,
      what: 'WhatsApp call request, acceptance and pre-tour call schedule for every live tour',
      cols: [
        { header: 'Booking ref', width: 13, value: r => r.bookingRef },
        { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
        { header: 'Channel', width: 9, kind: 'source', value: source },
        { header: 'Country', width: 12, value: r => r.countryLabel },
        { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
        { header: 'Request', width: 11, kind: 'flag', value: r => APPROVAL_LABEL[r.call.approval] },
        { header: 'Request sent', width: 16, kind: 'stamp', value: r => r.call.approvalRequestedAt },
        { header: 'Accepted on', width: 16, kind: 'stamp', value: r => r.call.approvedAt },
        { header: 'Registered with bot', width: 10, kind: 'yes', value: r => yes(r.call.registered) },
        { header: 'Call scheduled', width: 16, kind: 'stamp', value: r => r.call.scheduledAt },
        { header: 'Schedule status', width: 13, value: r => r.call.scheduleStatus ?? '' },
        { header: 'Attempts', width: 8, kind: 'int', value: r => r.call.attempts, total: 'sum' },
        { header: 'Call completed', width: 10, kind: 'yes', value: r => yes(r.call.completed) },
      ],
      rows: tours,
    })
  }

  // ── Cancellations, hotel only, test files
  const cx = all.filter(r => r.cancelled || r.cancelPending)
  plan.table({
    name: 'Cancellations', tab: P.red,
    title: `Cancelled & awaiting approval — ${board.label}`,
    description: 'Cancelled files are excluded from every count. Files awaiting accounts are still live until accounts decides — anything allocated against them may be about to be called off. Waiting 3+ days is in red.',
    totals: `${s.cancelled} cancelled · ${s.cancelPending} awaiting approval · ${sumPax(cx)} pax`,
    what: 'Cancelled files and cancellation requests awaiting accounts, with fee and wait',
    cols: [
      { header: 'Booking ref', width: 13, value: r => r.bookingRef },
      { header: 'State', width: 16, kind: 'flag', value: r => (r.cancelled ? 'Cancelled' : 'Awaiting approval') },
      { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: source },
      { header: 'Country', width: 12, value: r => r.countryLabel },
      { header: 'Agent', width: 22, value: r => r.agent ?? '' },
      { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
      { header: 'Departure', width: 12, kind: 'date', value: r => r.departureDate },
      { header: 'Pax', width: 6, kind: 'int', value: r => r.pax, total: 'sum' },
      { header: 'Driver / Vendor', width: 12, kind: 'state', value: r => STATE_WORD[r.driver.state] },
      { header: 'Tickets', width: 10, kind: 'state', value: r => STATE_WORD[r.tickets.state] },
      { header: 'Requested', width: 16, kind: 'stamp', value: r => r.cancellation?.requestedAt ?? null },
      { header: 'Requested by', width: 18, value: r => r.cancellation?.requestedBy ?? '' },
      { header: 'Held at', width: 16, value: r => r.cancellation?.heldAtLabel ?? '' },
      { header: 'Waiting (days)', width: 9, kind: 'int', value: r => (r.cancelled ? null : r.cancellation?.waitingDays ?? null), tone: r => (!r.cancelled && (r.cancellation?.waitingDays ?? 0) >= 3 ? 'bad' : null) },
      { header: 'Reason', width: 36, wrap: true, value: r => r.cancellation?.reason ?? '' },
      { header: 'Fee', width: 11, kind: 'money', value: r => r.cancellation?.feeTotal ?? null },
      { header: 'Currency', width: 9, value: r => r.cancellation?.currency ?? '' },
      { header: 'Decided', width: 16, kind: 'stamp', value: r => r.cancellation?.decidedAt ?? null },
    ],
    rows: cx,
    rowTint: r => (r.cancelled ? P.cancelled : P.pendingWash),
    empty: 'No cancellations in this window.',
  })
  plan.table({
    name: 'Hotel Only', tab: P.amber,
    title: `Hotel Only — ${board.label}`,
    description: 'Accommodation-only files. Live and counted, but there is no tour to allocate, ticket, QC or reconfirm.',
    totals: splitLine(live.filter(r => r.hotelOnly)),
    what: 'Accommodation-only files in the window',
    cols: fileCols().filter(c => !['Reconfirmation', 'Client confirmed', 'Pre-tour call', 'Call outcome', 'WhatsApp call request', 'Call request', 'Driver / Vendor', 'Transfers covered', 'Tickets', 'Tickets issued', 'QC1', 'QC2', 'Open items', 'Outstanding', 'Driver detail', 'Ticket detail'].includes(c.header)),
    rows: live.filter(r => r.hotelOnly),
    empty: 'No Hotel Only files in this window.',
  })
  const tests = all.filter(r => r.testFile)
  if (tests.length) {
    plan.table({
      name: 'Test Files', tab: P.muted,
      title: 'Files that look like tests',
      description: '"Test" appears as a word in a note, cancellation reason or the lead guest’s name. Field says where — a false positive is fixed at the source.',
      what: 'Files flagged as tests, with where the word was found',
      cols: [
        { header: 'Booking ref', width: 13, value: r => r.bookingRef },
        { header: 'Lead guest', width: 24, value: r => r.leadPassenger ?? '' },
        { header: 'Agent', width: 22, value: r => r.agent ?? '' },
        { header: 'Found in', width: 16, value: r => r.testFile?.field ?? '' },
        { header: 'Snippet', width: 60, wrap: true, value: r => r.testFile?.snippet ?? '' },
        { header: 'Arrival', width: 12, kind: 'date', value: r => r.arrivalDate },
        { header: 'Status', width: 18, value: r => r.statusLabel },
      ],
      rows: tests,
    })
  }

  // ── Per day + heatmap (ranges only)
  const days = range ? dateRange(board.from, board.to, 92) : []
  if (days.length > 1) {
    const onDay = (r: OpsDayRow, d: string) => r.arrivalDate <= d && r.departureDate >= d
    type DayRow = { d: string; ground: OpsDayRow[]; cancelled: number }
    const dayRows: DayRow[] = days.map(d => ({ d, ground: live.filter(r => onDay(r, d)), cancelled: all.filter(r => r.cancelled && onDay(r, d)).length }))
    plan.table<DayRow>({
      name: 'Day by Day', tab: P.blue,
      title: `Day by day — ${board.label}`,
      description: 'One row per date in the window. On ground counts live files from arrival day through departure day; bars are drawn to scale inside the cells. Today is highlighted.',
      what: 'One row per date: on ground, guests, arrivals, departures, readiness',
      cols: [
        { header: 'Date', width: 13, kind: 'date', value: x => x.d },
        { header: 'Day', width: 12, value: x => shortDay(x.d).slice(0, 3) },
        { header: 'On ground', width: 11, kind: 'int', value: x => x.ground.length, bar: P.indigo },
        { header: 'Guests', width: 9, kind: 'int', value: x => sumPax(x.ground), bar: P.b2c },
        { header: 'Arrivals', width: 10, kind: 'int', value: x => x.ground.filter(r => r.arrivalDate === x.d).length, total: 'sum', bar: P.green },
        { header: 'Departures', width: 11, kind: 'int', value: x => x.ground.filter(r => r.departureDate === x.d).length, total: 'sum', bar: P.blue },
        { header: 'B2B', width: 7, kind: 'int', value: x => x.ground.filter(r => source(r) === 'B2B').length },
        { header: 'B2C', width: 7, kind: 'int', value: x => x.ground.filter(r => source(r) === 'B2C').length },
        { header: 'Hotel Only', width: 9, kind: 'int', value: x => x.ground.filter(r => r.hotelOnly).length },
        { header: 'Fully ready', width: 10, kind: 'int', value: x => x.ground.filter(r => r.ready).length },
        { header: 'Not ready', width: 10, kind: 'int', value: x => x.ground.filter(r => !r.ready && !r.hotelOnly).length, tone: x => (x.ground.some(r => !r.ready && !r.hotelOnly) ? 'bad' : null) },
        { header: 'Cancelled', width: 9, kind: 'int', value: x => x.cancelled },
      ],
      rows: dayRows,
      rowTint: x => (x.d === today ? P.indigoWash : null),
    })
    const byCountry = groupBy(live, r => r.countryLabel)
    plan.matrix({
      name: 'Country Heatmap', tab: P.green,
      title: `Country × day — live files on the ground · ${board.label}`,
      description: 'Each cell is the number of live files in that country on that day. Darker is busier. Cancelled files are not counted.',
      what: 'Country × day heatmap of live files on the ground',
      rowHeader: 'Country',
      rows: Array.from(byCountry.keys()).sort(),
      cols: days.map(d => ({ key: d, label: shortDay(d) })),
      value: (c, d) => (byCountry.get(c) ?? []).filter(r => onDay(r, d)).length,
      color: P.green, colWidth: 11,
    })
  }

  // ── Breakdowns
  plan.breakdown({
    name: 'Countries', tab: P.green,
    title: `Countries — ${board.label}`,
    description: 'Live files grouped by operating country, with readiness.',
    what: 'Live files by country with readiness and D-10',
    rows: live, keyHeader: 'Country', key: r => r.countryLabel, measures: loadMeasures(),
  })
  plan.breakdown({
    name: 'Handlers', tab: P.indigo,
    title: `File handlers — workload & readiness · ${board.label}`,
    description: 'Live files grouped by the person handling them. Not ready and open items are the work still on each desk.',
    what: 'Workload and readiness by file handler',
    rows: live, keyHeader: 'File handler', key: r => r.fileHandler ?? 'Unassigned', measures: loadMeasures(),
  })
  plan.breakdown({
    name: 'Agents', tab: P.b2b,
    title: `Agents — ${board.label}`,
    description: 'Live files grouped by the agent who sold them.',
    what: 'Live files by agent with readiness',
    rows: live, keyHeader: 'Agent', keyWidth: 34, key: r => r.agent ?? 'No agent', measures: loadMeasures(),
  })
  plan.breakdown({
    name: 'Statuses', tab: P.muted,
    title: `Booking status — ${board.label}`,
    description: 'Every file in the window grouped by its workflow status, cancelled included.',
    what: 'Every file by workflow status',
    rows: all, keyHeader: 'Status', key: r => r.statusLabel,
    measures: [
      { header: 'Files', value: rs => rs.length, bar: P.muted },
      { header: 'Pax', value: rs => sumPax(rs) },
      { header: 'Fully ready', value: rs => rs.filter(r => r.ready && !r.cancelled).length },
    ],
  })

  // ── Overview
  const c = new Canvas(wb, 'Overview', { tab: P.deep })
  c.banner('AppleHolidays Operations', `Operations Board — ${range ? 'date range' : board.isToday ? 'today' : 'single day'}`,
    `${board.label}   ·   ${board.days} day${board.days === 1 ? '' : 's'}   ·   ${gen}${board.truncated ? '   ·   ROW CAP HIT — partial picture' : ''}`)
  const readyPct = tours.length ? Math.round((tours.filter(r => r.ready).length / tours.length) * 100) : 0
  c.tiles([
    { label: 'On ground (live)', value: s.onGround, note: `${s.paxOnGround} guests · ${s.hotelOnly} Hotel Only`, color: P.indigo },
    { label: 'Arrivals', value: s.arrivals, note: `${s.paxArriving} guests`, color: P.green },
    { label: 'Departures', value: s.departures, note: `${s.paxDeparting} guests`, color: P.blue },
    { label: 'Fully ready', value: s.ready, note: `${readyPct}% of tours`, color: P.brand },
    { label: `Past D-${RECONFIRM_DUE_DAYS}`, value: s.reconfirmDelay.breached, note: `${s.reconfirmDelay.unexplained} with no reason`, color: P.red },
    { label: 'Cancel pending', value: s.cancelPending, note: `${s.cancelled} cancelled (not counted)`, color: P.amber },
  ])

  const crit = items.filter(i => i.priority === 'Critical')
  c.title('Focus', 'The chase list in three lines — every item is on the Action List tab.')
  c.callout(crit.length ? 'critical' : 'good', `${crit.length} critical`, crit.length
    ? `On files on the ground or landing within a day: ${Array.from(new Set(crit.map(i => i.r.bookingRef))).slice(0, 14).join(', ')}`
    : 'Nothing open on files that are on the ground or landing tomorrow.')
  c.callout(s.reconfirmDelay.unexplained ? 'warning' : 'good', `${s.reconfirmDelay.unexplained} silent D-${RECONFIRM_DUE_DAYS} breach${s.reconfirmDelay.unexplained === 1 ? '' : 'es'}`,
    s.reconfirmDelay.unexplained ? 'Past the reconfirmation deadline with no reason recorded on the booking page — see the Reconfirmation tab.' : 'Every breach has a reason recorded.')
  if (s.cancelPending) c.callout('watch', `${s.cancelPending} awaiting accounts`, 'Still live until accounts decides — check before allocating more against them. See Cancellations.')
  if (view.length !== all.length) c.callout('watch', 'Filters were on', `The screen showed ${view.length} of ${all.length} files (${viewLabel}). Those are on "Your View"; every file is on "All Files".`)
  c.gap()

  c.title('Board checks', 'Done / partly done / pending / N/A across live files — the same counts as the board’s rings. Covered % = (done + partial) / in scope.')
  c.header(['Check', 'Done', 'Partial', 'Pending', 'N/A', 'In scope', 'Covered %'], [undefined, P.green, P.amber, P.red, P.muted, P.indigo, P.brand])
  const first = c.r
  for (const k of s.checks) {
    const scope = k.done + k.partial + k.pending
    c.line([k.label, k.done, k.partial, k.pending, k.na, scope, scope ? (k.done + k.partial) / scope : null], { pctCols: [7], alarmCols: [4] })
  }
  c.bars(2, first, c.r - 1, P.green)
  c.gap()

  c.title('Reconfirmation & WhatsApp')
  c.header(['Signal', 'Files'], [undefined, P.brand])
  c.line(['Client confirmed', s.reconfirm.clientConfirmed])
  c.line(['Pre-tour call logged', s.reconfirm.preTourCalled])
  c.line(['Neither signal yet', s.reconfirm.neither], { alarmCols: [2] })
  c.line(['WhatsApp request accepted', s.callApproval.approved ?? 0], { color: P.okInk })
  c.line(['WhatsApp request sent, waiting', s.callApproval.pending ?? 0])
  c.line(['WhatsApp request not sent', s.callApproval.not_requested ?? 0], { alarmCols: [2] })
  if (!board.callDataAvailable || !board.approvalDataAvailable) c.note('Part of the call data could not be read when this was exported — call figures may be low.', P.warnInk)
  c.gap()

  if (s.byCountry.length) {
    c.title('By country')
    c.header(['Country', 'Files', 'Pax'], [undefined, P.green, P.b2c])
    const f = c.r
    for (const x of s.byCountry) c.line([x.label, x.bookings, x.pax])
    c.bars(2, f, c.r - 1, P.green)
    c.gap()
  }

  c.index(plan.index())
  plan.write(wb, gen)
  return wb
}

export async function downloadOpsBoardWorkbook(opts: OpsBoardExportOptions, filename: string) {
  await downloadWorkbook(buildOpsBoardWorkbook(opts), filename)
}
