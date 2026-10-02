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
 * Built with ExcelJS rather than the SheetJS community build the periodic
 * workbook uses, because SheetJS community writes no styling at all.
 */
import ExcelJS from 'exceljs'
import type { ReadinessState } from '@/lib/booking-readiness'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'
import type { ReportData, BookingLine } from './report-data'
import type { BoardRow, BoardView } from './ops-board-digest'
import { formatReportDate, PERIOD_LABEL } from './report-window'

// ─── Palette ──────────────────────────────────────────────────────────────────

const P = {
  deep: 'FF134E4A',
  brand: 'FF0F766E',
  brandWash: 'FFE6F4F1',
  indigo: 'FF4F46E5',
  indigoWash: 'FFEEF2FF',
  green: 'FF059669',
  blue: 'FF0284C7',
  b2b: 'FF2563EB',
  b2bWash: 'FFEFF6FF',
  b2c: 'FF7C3AED',
  b2cWash: 'FFF5F3FF',
  amber: 'FFD97706',
  amberWash: 'FFFEF3C7',
  red: 'FFDC2626',
  redWash: 'FFFEE2E2',
  okWash: 'FFD1FAE5',
  okInk: 'FF065F46',
  warnWash: 'FFFEF3C7',
  warnInk: 'FF92400E',
  badWash: 'FFFEE2E2',
  badInk: 'FF991B1B',
  naInk: 'FF94A3B8',
  ink: 'FF0F172A',
  body: 'FF334155',
  muted: 'FF64748B',
  line: 'FFE2E8F0',
  zebra: 'FFF8FAFC',
  header: 'FF1E293B',
  white: 'FFFFFFFF',
}

const FONT = 'Calibri'
const DATE_FMT = 'dd mmm yyyy'
const THIN = { style: 'thin' as const, color: { argb: P.line } }

// ─── Small helpers ────────────────────────────────────────────────────────────

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

/** `yyyy-mm-dd` → a real date cell. Empty stays empty rather than 1900-01-00. */
function day(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  return isNaN(t) ? null : new Date(t)
}

function stamp(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return isNaN(t) ? null : new Date(t)
}

const STATE_WORD: Record<ReadinessState, string> = {
  DONE: 'Done', PARTIAL: 'Partial', PENDING: 'Pending', NA: 'N/A',
}

const yes = (b: boolean) => (b ? 'Yes' : 'No')

/** Excel sheet names: ≤31 chars, none of []:*?/\ */
function sheetName(s: string): string {
  return s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)
}

// ─── Column model ─────────────────────────────────────────────────────────────

type Kind = 'text' | 'int' | 'date' | 'stamp' | 'money' | 'state' | 'flag' | 'yes' | 'source' | 'pct'

interface Col<T> {
  header: string
  width: number
  kind?: Kind
  value: (r: T) => unknown
  /** Text columns that hold sentences wrap instead of overflowing. */
  wrap?: boolean
}

interface TableSpec<T> {
  name: string
  title: string
  description: string
  tab: string
  cols: Col<T>[]
  rows: T[]
  /** Short totals line printed in row 3. */
  totals?: string
  /** Rows to tint as a whole, e.g. cancelled files. */
  rowTint?: (r: T) => string | null
  empty?: string
}

function styleState(cell: ExcelJS.Cell, word: string) {
  const map: Record<string, [string, string]> = {
    Done: [P.okWash, P.okInk], Yes: [P.okWash, P.okInk], Ready: [P.okWash, P.okInk],
    Allocated: [P.okWash, P.okInk], Completed: [P.okWash, P.okInk], Approved: [P.okWash, P.okInk],
    Partial: [P.warnWash, P.warnInk], 'Part-allocated': [P.warnWash, P.warnInk], 'Requested': [P.warnWash, P.warnInk],
    Pending: [P.badWash, P.badInk], No: [P.badWash, P.badInk], 'Not ready': [P.badWash, P.badInk],
    'Not requested': [P.badWash, P.badInk],
    Cancelled: [P.badWash, P.badInk], 'Cancel pending': [P.warnWash, P.warnInk],
  }
  const hit = map[word]
  if (hit) {
    cell.fill = fill(hit[0])
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: hit[1] } }
  } else if (word === 'N/A' || word === '') {
    cell.font = { name: FONT, size: 10, color: { argb: P.naInk } }
  }
  cell.alignment = { horizontal: 'center', vertical: 'middle' }
}

/** Banner + description + totals line, merged across the table width. */
function sheetHead(ws: ExcelJS.Worksheet, width: number, title: string, description: string, totals: string | undefined, generated: string) {
  ws.mergeCells(1, 1, 1, width)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: FONT, size: 16, bold: true, color: { argb: P.white } }
  t.fill = fill(P.deep)
  t.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 32

  ws.mergeCells(2, 1, 2, width)
  const d = ws.getCell(2, 1)
  d.value = description
  d.font = { name: FONT, size: 10, italic: true, color: { argb: P.muted } }
  d.fill = fill(P.brandWash)
  d.alignment = { vertical: 'middle', wrapText: true, indent: 1 }
  ws.getRow(2).height = Math.min(90, 18 + Math.ceil(description.length / Math.max(60, width * 11)) * 14)

  ws.mergeCells(3, 1, 3, width)
  const s = ws.getCell(3, 1)
  s.value = totals ? `${totals}   ·   ${generated}` : generated
  s.font = { name: FONT, size: 10, bold: true, color: { argb: P.brand } }
  s.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(3).height = 20
}

function addTable<T>(wb: ExcelJS.Workbook, spec: TableSpec<T>, generated: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetName(spec.name), {
    properties: { tabColor: { argb: spec.tab } },
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  const width = spec.cols.length
  sheetHead(ws, width, spec.title, spec.description, spec.totals, generated)

  spec.cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width })

  const head = ws.getRow(4)
  spec.cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.value = c.header
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.white } }
    cell.fill = fill(P.header)
    cell.alignment = { vertical: 'middle', horizontal: c.kind && c.kind !== 'text' ? 'center' : 'left', wrapText: true }
    cell.border = { bottom: { style: 'medium', color: { argb: P.brand } } }
  })
  head.height = 30

  if (!spec.rows.length) {
    ws.mergeCells(5, 1, 5, width)
    const e = ws.getCell(5, 1)
    e.value = spec.empty ?? 'Nothing in this population for the period.'
    e.font = { name: FONT, size: 11, italic: true, color: { argb: P.muted } }
    e.alignment = { horizontal: 'center', vertical: 'middle' }
    e.fill = fill(P.zebra)
    ws.getRow(5).height = 28
    return ws
  }

  spec.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri)
    const tint = spec.rowTint?.(r) ?? (ri % 2 ? P.zebra : null)
    spec.cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1)
      const raw = c.value(r)
      const kind = c.kind ?? 'text'
      if (kind === 'date') cell.value = day(raw as string)
      else if (kind === 'stamp') cell.value = stamp(raw as string)
      else if (kind === 'int' || kind === 'money' || kind === 'pct') cell.value = typeof raw === 'number' && isFinite(raw) ? raw : null
      else cell.value = raw === null || raw === undefined ? '' : String(raw)

      cell.font = { name: FONT, size: 10, color: { argb: P.body } }
      cell.alignment = { vertical: 'top', wrapText: !!c.wrap }
      cell.border = { bottom: THIN }
      if (tint) cell.fill = fill(tint)

      if (kind === 'date') { cell.numFmt = DATE_FMT; cell.alignment = { horizontal: 'center', vertical: 'top' } }
      if (kind === 'stamp') { cell.numFmt = 'dd mmm yyyy hh:mm'; cell.alignment = { horizontal: 'center', vertical: 'top' } }
      if (kind === 'int') { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right', vertical: 'top' } }
      if (kind === 'money') { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right', vertical: 'top' } }
      if (kind === 'pct') { cell.numFmt = '0%'; cell.alignment = { horizontal: 'right', vertical: 'top' } }
      if (kind === 'state' || kind === 'flag') styleState(cell, String(cell.value ?? ''))
      // A signal that is one of two acceptable routes: green when in, plain
      // when not — its absence alone is not a problem worth colouring red.
      if (kind === 'yes') {
        cell.alignment = { horizontal: 'center', vertical: 'top' }
        if (cell.value === 'Yes') cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.okInk } }
        else cell.font = { name: FONT, size: 10, color: { argb: P.naInk } }
      }
      if (kind === 'source') {
        const b2c = cell.value === 'B2C'
        cell.fill = fill(b2c ? P.b2cWash : P.b2bWash)
        cell.font = { name: FONT, size: 10, bold: true, color: { argb: b2c ? P.b2c : P.b2b } }
        cell.alignment = { horizontal: 'center', vertical: 'top' }
      }
      if (ci === 0) cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.ink } }
    })
  })

  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + spec.rows.length, column: width } }
  return ws
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
    { header: 'Pax', width: 6, kind: 'int', value: r => r.pax },
    { header: 'Adults', width: 7, kind: 'int', value: r => r.paxAdults },
    { header: 'Children', width: 8, kind: 'int', value: r => r.paxChildren },
    { header: 'Infants', width: 7, kind: 'int', value: r => r.paxInfants },
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
    { header: 'Pax', width: 6, kind: 'int', value: b => b.pax },
    { header: 'Adults', width: 7, kind: 'int', value: b => b.paxAdults },
    { header: 'Children', width: 8, kind: 'int', value: b => b.paxChildren },
    { header: 'Infants', width: 7, kind: 'int', value: b => b.paxInfants },
    { header: 'Currency', width: 9, value: b => b.currency },
    { header: 'Quoted total', width: 13, kind: 'money', value: b => b.quotedTotal },
    { header: 'Created at', width: 17, kind: 'stamp', value: b => b.createdAt },
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

// ─── Overview sheet ───────────────────────────────────────────────────────────

function overview(wb: ExcelJS.Workbook, d: ReportData, index: { name: string; what: string; tab: string }[]) {
  const ws = wb.addWorksheet('Overview', {
    properties: { tabColor: { argb: P.deep } },
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  const W = 12
  for (let i = 1; i <= W; i++) ws.getColumn(i).width = 13
  ws.getColumn(1).width = 42

  // Banner
  ws.mergeCells(1, 1, 1, W)
  const b1 = ws.getCell(1, 1)
  b1.value = 'APPLEHOLIDAYS OPERATIONS'
  b1.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFB2DFDB' } }
  b1.fill = fill(P.deep)
  b1.alignment = { vertical: 'bottom', indent: 1 }
  ws.getRow(1).height = 22
  ws.mergeCells(2, 1, 2, W)
  const b2 = ws.getCell(2, 1)
  b2.value = `${PERIOD_LABEL[d.window.period]} Operations Report`
  b2.font = { name: FONT, size: 22, bold: true, color: { argb: P.white } }
  b2.fill = fill(P.deep)
  b2.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(2).height = 36
  ws.mergeCells(3, 1, 3, W)
  const b3 = ws.getCell(3, 1)
  b3.value = `${d.window.label}   ·   Board today: ${d.opsBoard?.today?.label ?? formatReportDate(d.window.today, { weekday: true })}   ·   Generated ${d.generatedAt.replace('T', ' ').slice(0, 16)} UTC · times in ${d.window.timezone}`
  b3.font = { name: FONT, size: 10, color: { argb: 'FFCCFBF1' } }
  b3.fill = fill(P.brand)
  b3.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(3).height = 22

  // Headline tiles — two columns each, value over label over note.
  const sp = d.split
  const tiles: { label: string; value: string | number; note: string; color: string }[] = [
    { label: 'Today new & updated', value: sp.appleCount || d.created.total, note: `B2B ${d.created.channel.b2b} · B2C ${d.created.channel.b2c}`, color: P.brand },
    { label: 'Old amendments', value: sp.available ? sp.oldCount : '—', note: sp.available && sp.oldest ? `oldest ${sp.oldest}d back` : 'earlier files re-opened', color: P.amber },
    { label: 'On ground today', value: d.opsBoard?.today?.onGround.files ?? d.onGround.total, note: `${d.opsBoard?.today?.onGround.pax ?? d.onGround.pax} guests`, color: P.indigo },
    { label: 'D-3 drivers', value: `${d.readiness.drivers.allocated}/${d.readiness.drivers.tours}`, note: `${d.readiness.drivers.partial + d.readiness.drivers.pending} need a driver`, color: P.blue },
    { label: 'Reconfirmed', value: `${d.reconfirm.status.completed}/${d.reconfirm.total}`, note: `${d.reconfirm.status.pending} pending · ${d.reconfirm.status.overdue} late`, color: P.green },
    { label: 'Complaints', value: d.complaints.total, note: `${d.complaints.open} open`, color: P.red },
  ]
  let r = 5
  tiles.forEach((t, i) => {
    // The first tile sits in the wide label column; the rest take two columns each.
    const c0 = i === 0 ? 1 : 2 + (i - 1) * 2
    const c1 = i === 0 ? 1 : c0 + 1
    for (const [row, val, font] of [
      [r, t.value, { name: FONT, size: 22, bold: true, color: { argb: t.color } }],
      [r + 1, t.label.toUpperCase(), { name: FONT, size: 9, bold: true, color: { argb: P.muted } }],
      [r + 2, t.note, { name: FONT, size: 9, color: { argb: P.naInk } }],
    ] as [number, string | number, Partial<ExcelJS.Font>][]) {
      if (c1 > c0) ws.mergeCells(row, c0, row, c1)
      const cell = ws.getCell(row, c0)
      cell.value = val
      cell.font = font
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
      for (let k = c0; k <= c1; k++) ws.getCell(row, k).fill = fill(P.zebra)
    }
    for (let k = c0; k <= c1; k++) {
      ws.getCell(r, k).border = { top: { style: 'thick', color: { argb: t.color } } }
    }
  })
  ws.getRow(r).height = 34
  r += 4

  // Section title helper
  const title = (text: string, sub?: string) => {
    ws.mergeCells(r, 1, r, W)
    const c = ws.getCell(r, 1)
    c.value = text
    c.font = { name: FONT, size: 13, bold: true, color: { argb: P.ink } }
    c.border = { bottom: { style: 'medium', color: { argb: P.brand } } }
    ws.getRow(r).height = 22
    r += 1
    if (sub) {
      ws.mergeCells(r, 1, r, W)
      const s = ws.getCell(r, 1)
      s.value = sub
      s.font = { name: FONT, size: 9, italic: true, color: { argb: P.muted } }
      s.alignment = { wrapText: true }
      ws.getRow(r).height = 26
      r += 1
    }
  }
  const header = (cols: string[], colors?: (string | undefined)[]) => {
    cols.forEach((h, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = h
      cell.font = { name: FONT, size: 9, bold: true, color: { argb: P.white } }
      cell.fill = fill(colors?.[i] ?? P.header)
      cell.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', wrapText: true, indent: i ? 0 : 1 }
    })
    ws.getRow(r).height = 28
    r += 1
  }
  const line = (vals: (string | number | null)[], opts: { bold?: boolean; bg?: string; color?: string; labelColor?: string } = {}) => {
    vals.forEach((v, i) => {
      const cell = ws.getCell(r, i + 1)
      cell.value = v
      cell.font = { name: FONT, size: 10, bold: opts.bold || i === 0, color: { argb: i === 0 ? (opts.labelColor ?? P.ink) : (opts.color ?? P.body) } }
      cell.alignment = { horizontal: i ? 'center' : 'left', vertical: 'middle', indent: i ? 0 : 1 }
      cell.border = { bottom: THIN }
      if (typeof v === 'number') cell.numFmt = '#,##0'
      if (opts.bg) cell.fill = fill(opts.bg)
    })
    r += 1
  }

  const b = d.opsBoard
  if (b?.available && b.today && b.week) {
    const t = b.today
    const w = b.week

    // ── Today vs next 7 days
    title('Operations board — Today vs Next 7 days',
      `Today = ${t.label}. Next 7 days = ${w.label} (today included). Live files exclude Cancelled; Hotel Only is part of live and shown on its own line. Same rules as the dashboard board.`)
    header(['Measure', 'Today files', 'Today pax', 'Today B2B', 'Today B2C', '', '7-day files', '7-day pax', '7-day B2B', '7-day B2C'],
      [undefined, P.indigo, P.indigo, P.b2b, P.b2c, P.white, P.brand, P.brand, P.b2b, P.b2c])
    const pair = (label: string, a: { files: number; pax: number; b2b: number; b2c: number }, c: { files: number; pax: number; b2b: number; b2c: number }, opts: Parameters<typeof line>[1] = {}) =>
      line([label, a.files, a.pax, a.b2b, a.b2c, null, c.files, c.pax, c.b2b, c.b2c], opts)
    pair('On ground (live)', t.onGround, w.onGround, { bold: true, bg: P.indigoWash })
    pair('Arrivals', t.arrivals, w.arrivals)
    pair('Departures', t.departures, w.departures)
    const seg = (v: BoardView, key: string) => {
      const s = v.segments.find(x => x.key === key)!
      return { files: s.files, pax: s.pax, b2b: s.b2b, b2c: s.b2c }
    }
    pair('Hotel Only (in live)', seg(t, 'HOTEL_ONLY'), seg(w, 'HOTEL_ONLY'), { labelColor: P.warnInk, bg: 'FFFFFBEB' })
    pair('Cancellation pending (in live)', seg(t, 'CANCEL_PENDING'), seg(w, 'CANCEL_PENDING'), { labelColor: P.amber })
    pair('Cancelled — not counted', seg(t, 'CANCELLED'), seg(w, 'CANCELLED'), { labelColor: P.badInk, bg: 'FFF1F5F9' })
    const readyB2b = (v: BoardView) => v.rows.filter(x => !x.cancelled && x.ready && x.source === 'B2B').length
    const readyB2c = (v: BoardView) => v.rows.filter(x => !x.cancelled && x.ready && x.source === 'B2C').length
    line([`Fully ready (${t.live ? Math.round((t.ready / t.live) * 100) : 0}% today · ${w.live ? Math.round((w.ready / w.live) * 100) : 0}% 7-day)`,
      t.ready, null, readyB2b(t), readyB2c(t), null, w.ready, null, readyB2b(w), readyB2c(w)], { color: P.okInk, labelColor: P.okInk })
    line([`Past D-${RECONFIRM_DUE_DAYS} — breached`, t.d10.breached, null, null, null, null, w.d10.breached, null, null, null], { color: P.badInk })
    line([`Past D-${RECONFIRM_DUE_DAYS} — no reason recorded`, t.d10.unexplained, null, null, null, null, w.d10.unexplained, null, null, null], { color: P.badInk, labelColor: P.badInk })
    r += 1

    // ── Check matrix
    title('Board checks — covered / in scope',
      'Covered = done + partly done, the way the board’s rings count. N/A files (Hotel Only, no tickets, no transfers) are out of scope. Pending is the outstanding work.')
    header(['Check', 'Today done', 'Today pending', 'Today %', 'Today B2B', 'Today B2C', '7-day done', '7-day pending', '7-day %', '7-day B2B', '7-day B2C'],
      [undefined, P.indigo, P.red, P.indigo, P.b2b, P.b2c, P.brand, P.red, P.brand, P.b2b, P.b2c])
    t.checks.forEach((c, i) => {
      const wc = w.checks[i]
      const frac = (x: { covered: number; scope: number }) => (x.scope ? `${x.covered}/${x.scope}` : '—')
      const start = r
      line([
        c.label,
        `${c.covered}/${c.scope}`, c.pending, c.scope ? c.covered / c.scope : null, frac(c.b2b), frac(c.b2c),
        `${wc.covered}/${wc.scope}`, wc.pending, wc.scope ? wc.covered / wc.scope : null, frac(wc.b2b), frac(wc.b2c),
      ])
      for (const col of [4, 9]) {
        const cell = ws.getCell(start, col)
        cell.numFmt = '0%'
        const v = typeof cell.value === 'number' ? cell.value : null
        if (v !== null) {
          const [bg, fg] = v >= 0.9 ? [P.okWash, P.okInk] : v >= 0.5 ? [P.warnWash, P.warnInk] : [P.badWash, P.badInk]
          cell.fill = fill(bg)
          cell.font = { name: FONT, size: 10, bold: true, color: { argb: fg } }
        }
      }
      for (const col of [3, 8]) {
        const cell = ws.getCell(start, col)
        if (typeof cell.value === 'number' && cell.value > 0) cell.font = { name: FONT, size: 10, bold: true, color: { argb: P.red } }
      }
    })
    r += 1
  }

  // ── Intake
  title('Intake — Today new & updated',
    'Every booking AppleSystem confirmed in the report period. Old amendments are revisions raised in the period against confirmations from earlier days.')
  header(['Measure', 'Count'])
  line(['Today new & updated', sp.appleCount || d.created.total], { bold: true, bg: P.brandWash })
  line(['  B2B', d.created.channel.b2b], { labelColor: P.b2b })
  line(['  B2C', d.created.channel.b2c], { labelColor: P.b2c })
  line(['  Pax booked', d.created.pax])
  if (sp.available) {
    line(['Accounts ledger: first document in period', sp.todayCount])
    line(['Old amendments (documents)', sp.oldCount], { labelColor: P.amber })
    line(['Old amendments (bookings)', sp.oldBookings], { labelColor: P.amber })
  }
  if (d.created.missingRefs.length) line(['Confirmed upstream, not filed here', d.created.missingRefs.length], { labelColor: P.red, color: P.red })
  r += 1

  // ── Sheet index with links
  title('In this workbook', 'Click a tab name to jump to it.')
  header(['Tab', 'What it holds'])
  for (const s of index) {
    ws.mergeCells(r, 2, r, W)
    const a = ws.getCell(r, 1)
    a.value = { text: s.name, hyperlink: `#'${s.name}'!A1` }
    a.font = { name: FONT, size: 10, bold: true, underline: true, color: { argb: s.tab } }
    a.alignment = { indent: 1, vertical: 'middle' }
    const w = ws.getCell(r, 2)
    w.value = s.what
    w.font = { name: FONT, size: 10, color: { argb: P.body } }
    w.alignment = { vertical: 'middle' }
    a.border = { bottom: THIN }
    w.border = { bottom: THIN }
    r += 1
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function renderDailyWorkbook(d: ReportData): Promise<{ buffer: Buffer; sheets: string[] }> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'AppleHolidays Operations'
  wb.created = new Date(d.generatedAt)
  wb.title = `${PERIOD_LABEL[d.window.period]} Operations Report — ${d.window.label}`

  const gen = `Generated ${d.generatedAt.replace('T', ' ').slice(0, 16)} UTC`
  const specs: (TableSpec<any> & { what: string })[] = []
  const add = <T,>(s: TableSpec<T> & { what: string }) => { specs.push(s as TableSpec<any> & { what: string }) }

  // ── Intake
  const created = d.created.allBookings ?? d.created.bookings
  add({
    name: 'New Bookings', tab: P.brand,
    title: `Today new & updated — ${d.window.label}`,
    description: 'Every booking AppleSystem confirmed in the report period — the population the mail’s Today new & updated tile counts. B2B is agent work; B2C is the Aahaas storefront.',
    totals: splitLine(created),
    what: 'Every booking confirmed in the period, B2B and B2C, with pax and quoted value',
    cols: bookingCols(), rows: created,
    empty: 'AppleSystem confirmed no bookings in this period.',
  })
  const outside = d.created.allOutside ?? d.created.outside
  if (outside.length) {
    add({
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
    add({
      name: 'Board Today', tab: P.indigo,
      title: `Operations board — Today · ${t.label}`,
      description: 'Every file on the ground today, exactly as the dashboard board lists it. Cancelled rows are shown (greyed) but not counted; Hotel Only rows are tinted amber and their checks read N/A.',
      totals: `${t.live} live · ${t.onGround.pax} pax · B2B ${t.onGround.b2b} · B2C ${t.onGround.b2c} · ${t.arrivals.files} arriving · ${t.departures.files} departing · ${t.hotelOnly} Hotel Only · ${t.cancelled} cancelled · ${t.ready} fully ready`,
      what: 'Every file on the ground today, with all five checks',
      cols: boardCols(true), rows: t.rows, rowTint: tintRow,
    })
    add({
      name: 'Board Next 7 Days', tab: P.brand,
      title: `Operations board — Next 7 days · ${w.label}`,
      description: 'Every file on the ground at any point from today through D+6. Movement says whether the guest arrives or departs inside the window. Cancelled rows are shown but not counted.',
      totals: `${w.live} live · ${w.onGround.pax} pax · B2B ${w.onGround.b2b} · B2C ${w.onGround.b2c} · ${w.arrivals.files} arriving · ${w.departures.files} departing · ${w.hotelOnly} Hotel Only · ${w.cancelled} cancelled`,
      what: 'Every file on the ground in the next 7 days, with all five checks',
      cols: boardCols(false), rows: w.rows, rowTint: tintRow,
    })
    add({
      name: '7-Day Outlook', tab: P.blue,
      title: `Day by day — ${w.label}`,
      description: 'One row per day. On ground counts live files only. No driver = live files with no driver on any transfer yet. Reconfirm pending = that day’s arrivals with neither reconfirmation signal in.',
      what: 'One row per day: on ground, arrivals, departures, B2B / B2C, Hotel Only, cancelled, readiness',
      cols: [
        { header: 'Date', width: 14, kind: 'date', value: x => x.date },
        { header: 'Weekday', width: 10, value: x => formatReportDate(x.date, { weekday: true }).slice(0, 3) },
        { header: 'On ground', width: 11, kind: 'int', value: x => x.onGround },
        { header: 'Guests', width: 9, kind: 'int', value: x => x.pax },
        { header: 'Arrivals', width: 10, kind: 'int', value: x => x.arrivals },
        { header: 'Arrival pax', width: 11, kind: 'int', value: x => x.arrivalPax },
        { header: 'Departures', width: 11, kind: 'int', value: x => x.departures },
        { header: 'Departure pax', width: 12, kind: 'int', value: x => x.departurePax },
        { header: 'B2B', width: 8, kind: 'int', value: x => x.b2b },
        { header: 'B2C', width: 8, kind: 'int', value: x => x.b2c },
        { header: 'Hotel Only', width: 10, kind: 'int', value: x => x.hotelOnly },
        { header: 'Cancelled', width: 10, kind: 'int', value: x => x.cancelled },
        { header: 'Fully ready', width: 11, kind: 'int', value: x => x.ready },
        { header: 'No driver', width: 10, kind: 'int', value: x => x.driverPending },
        { header: 'Reconfirm pending', width: 12, kind: 'int', value: x => x.reconfirmPending },
      ],
      rows: w.perDay,
      rowTint: x => (x.date === w.from ? P.indigoWash : null),
    })
    add({
      name: 'B2B Files', tab: P.b2b,
      title: `B2B — agent files · next 7 days (${w.label})`,
      description: 'Live B2B files on the ground at any point in the next 7 days (cancelled are on their own tab). Hotel Only files are included and tinted.',
      totals: splitLine(live.filter(r => r.source === 'B2B')),
      what: 'Live B2B (agent) files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.source === 'B2B'), rowTint: tintRow,
    })
    add({
      name: 'B2C Files', tab: P.b2c,
      title: `B2C — Aahaas storefront · next 7 days (${w.label})`,
      description: 'Live B2C files on the ground at any point in the next 7 days (cancelled are on their own tab).',
      totals: splitLine(live.filter(r => r.source === 'B2C')),
      what: 'Live B2C (Aahaas storefront) files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.source === 'B2C'), rowTint: tintRow,
      empty: 'No B2C files on the ground in the next 7 days.',
    })
    add({
      name: 'Hotel Only', tab: P.amber,
      title: `Hotel Only — next 7 days (${w.label})`,
      description: 'Accommodation-only files. The guest is in the country and counted as live, but there is no tour to allocate, ticket, QC or reconfirm — every check reads N/A.',
      totals: splitLine(live.filter(r => r.hotelOnly)),
      what: 'Accommodation-only files in the next 7 days',
      cols: boardCols(false), rows: live.filter(r => r.hotelOnly),
      empty: 'No Hotel Only files in the next 7 days.',
    })
    const cancelled = w.rows.filter(r => r.cancelled || r.cancelPending)
    add({
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
        { header: 'Pax', width: 6, kind: 'int', value: r => r.pax },
        { header: 'On ground today', width: 10, value: r => (r.onToday ? 'Yes' : '') },
        { header: 'Requested', width: 17, kind: 'stamp', value: r => r.cancellation?.requestedAt ?? null },
        { header: 'Requested by', width: 18, value: r => r.cancellation?.requestedBy ?? '' },
        { header: 'Reason', width: 36, wrap: true, value: r => r.cancellation?.reason ?? '' },
        { header: 'Fee', width: 11, kind: 'money', value: r => r.cancellation?.feeTotal ?? null },
        { header: 'Currency', width: 9, value: r => r.cancellation?.currency ?? '' },
        { header: 'Waiting (days)', width: 10, kind: 'int', value: r => (r.cancelled ? null : r.cancellation?.waitingDays ?? null) },
        { header: 'Decided', width: 17, kind: 'stamp', value: r => r.cancellation?.decidedAt ?? null },
      ],
      rows: cancelled,
      empty: 'No cancelled files in the next 7 days.',
    })
    add({
      name: 'Countries', tab: P.green,
      title: `Country-wise — next 7 days (${w.label})`,
      description: 'Live files by operating country with the B2B / B2C split; Hotel Only is part of live, Cancelled is counted apart.',
      what: 'Country breakdown with B2B / B2C, Hotel Only and Cancelled',
      cols: [
        { header: 'Country', width: 16, value: c => c.label },
        { header: 'Live files', width: 11, kind: 'int', value: c => c.files },
        { header: 'Pax', width: 9, kind: 'int', value: c => c.pax },
        { header: 'B2B', width: 9, kind: 'int', value: c => c.b2b },
        { header: 'B2C', width: 9, kind: 'int', value: c => c.b2c },
        { header: 'Hotel Only', width: 11, kind: 'int', value: c => c.hotelOnly },
        { header: 'Cancelled', width: 11, kind: 'int', value: c => c.cancelled },
      ],
      rows: w.byCountry,
    })
  }

  // ── Readiness, drivers, reconfirmation (the mail's own sections)
  const rd = d.readiness
  add({
    name: 'D-3 Drivers', tab: P.blue,
    title: `D-3 driver allocation — arrivals ${formatReportDate(rd.fromDate)} to ${formatReportDate(rd.toDate)}`,
    description: 'Operating tours only — cancelled and accommodation-only files are left out. Outstanding first.',
    totals: `${rd.drivers.allocated}/${rd.drivers.tours} allocated · ${rd.drivers.partial} part · ${rd.drivers.pending} pending`,
    what: 'D-3 driver allocation for the next three days of arrivals',
    cols: [
      { header: 'Booking ref', width: 13, value: (x: typeof rd.bookings[number]) => x.bookingRef },
      { header: 'Lead guest', width: 24, value: x => x.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: x => x.source },
      { header: 'Country', width: 12, value: x => x.countryLabel },
      { header: 'Arrival', width: 12, kind: 'date', value: x => x.arrivalDate },
      { header: 'Day', width: 6, value: x => `D-${x.daysToArrival}` },
      { header: 'Pax', width: 6, kind: 'int', value: x => x.pax },
      { header: 'Allocation', width: 14, kind: 'flag', value: x => (x.readiness.driver.state === 'DONE' ? 'Allocated' : x.readiness.driver.state === 'PARTIAL' ? 'Part-allocated' : 'Pending') },
      { header: 'Covered', width: 9, kind: 'int', value: x => x.readiness.driver.done },
      { header: 'Required', width: 9, kind: 'int', value: x => x.readiness.driver.required },
      { header: 'Detail', width: 50, wrap: true, value: x => x.readiness.driver.detail },
    ],
    rows: [...rd.drivers.outstanding, ...rd.drivers.done],
  })
  add({
    name: 'Readiness 3 Days', tab: P.indigo,
    title: `Arrivals ${formatReportDate(rd.fromDate)} to ${formatReportDate(rd.toDate)} — readiness`,
    description: 'Every arrival in the next three days with its checklist. Blocking items stop the guest landing cleanly; QC does not block.',
    totals: `${rd.bookings.length} arrivals · ${rd.notReady} not ready`,
    what: 'Next three days of arrivals with client, driver, ticket and QC readiness',
    cols: [
      { header: 'Booking ref', width: 13, value: (x: typeof rd.bookings[number]) => x.bookingRef },
      { header: 'Lead guest', width: 24, value: x => x.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: x => x.source },
      { header: 'Country', width: 12, value: x => x.countryLabel },
      { header: 'Booking type', width: 12, value: x => (x.hotelOnly ? 'Hotel Only' : 'Full tour') },
      { header: 'Arrival', width: 12, kind: 'date', value: x => x.arrivalDate },
      { header: 'Days', width: 6, kind: 'int', value: x => x.daysToArrival },
      { header: 'Pax', width: 6, kind: 'int', value: x => x.pax },
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
  add({
    name: 'Reconfirmation', tab: P.green,
    title: `Reconfirmation status — arrivals ${formatReportDate(rc.fromDate)} to ${formatReportDate(rc.toDate)}`,
    description: `Cancelled and Hotel Only excluded. A booking is reconfirmed once the client confirms or a pre-tour call is logged; D-${RECONFIRM_DUE_DAYS} is the deadline.`,
    totals: `${rc.status.completed} completed · ${rc.status.pending} pending · ${rc.status.overdue} late`,
    what: `Reconfirmation status and D-${RECONFIRM_DUE_DAYS} standing for upcoming arrivals`,
    cols: [
      { header: 'Booking ref', width: 13, value: (l: typeof rc.status.pendingLines[number]) => l.bookingRef },
      { header: 'Lead guest', width: 24, value: l => l.leadPassenger ?? '' },
      { header: 'Channel', width: 9, kind: 'source', value: l => l.source },
      { header: 'Country', width: 12, value: l => l.countryLabel },
      { header: 'Arrival', width: 12, kind: 'date', value: l => l.arrivalDate },
      { header: 'Pax', width: 6, kind: 'int', value: l => l.pax },
      { header: 'Reconfirmation', width: 14, kind: 'flag', value: l => (l.completed ? 'Completed' : 'Pending') },
      { header: `D-${RECONFIRM_DUE_DAYS} due`, width: 12, kind: 'date', value: l => l.dueAt },
      { header: 'Standing', width: 14, value: l => (l.completed ? '' : l.stage === 'OVERDUE' ? `${Math.abs(l.daysToDue)}d overdue` : l.stage === 'DUE_TODAY' ? 'Due today' : `Due in ${l.daysToDue}d`) },
      { header: 'Client confirmed', width: 10, kind: 'yes', value: l => yes(l.clientConfirmed) },
      { header: 'Pre-tour call', width: 10, kind: 'yes', value: l => yes(l.preTourCalled) },
      { header: 'Reason', width: 36, wrap: true, value: l => (l.delay ? `${l.delay.reasonLabel}${l.delay.note ? ` — ${l.delay.note}` : ''}` : '') },
    ],
    rows: [...rc.status.pendingLines, ...rc.status.completedLines],
  })

  // ── Complaints & upcoming
  const complaints = [...d.complaints.items, ...d.complaints.carriedOpen]
  add({
    name: 'Complaints', tab: P.red,
    title: 'Complaints',
    description: 'One row per issue — repeats of one issue count once; "Times raised" keeps the underlying alerts visible.',
    totals: `${d.complaints.total} in period · ${d.complaints.open} open`,
    what: 'Complaints raised in the period and still-open earlier ones',
    cols: [
      { header: 'First raised', width: 17, kind: 'stamp', value: (c: typeof complaints[number]) => c.createdAt },
      { header: 'Booking ref', width: 13, value: c => c.bookingRef ?? '' },
      { header: 'Customer', width: 22, value: c => c.customerName ?? '' },
      { header: 'Country', width: 12, value: c => c.countryLabel },
      { header: 'Category', width: 18, value: c => c.categories.join(', ') },
      { header: 'Severity', width: 10, value: c => c.severity.toUpperCase() },
      { header: 'Status', width: 12, value: c => c.status },
      { header: 'Times raised', width: 8, kind: 'int', value: c => c.occurrences },
      { header: 'Title', width: 30, wrap: true, value: c => c.title ?? '' },
      { header: 'Details', width: 50, wrap: true, value: c => c.details ?? '' },
      { header: 'Resolution', width: 36, wrap: true, value: c => c.resolutionNote ?? '' },
      { header: 'Hours to resolve', width: 10, kind: 'int', value: c => c.resolutionHours ?? null },
    ],
    rows: complaints,
    empty: 'No complaints in this period.',
  })
  add({
    name: 'Upcoming', tab: P.b2c,
    title: 'Upcoming arrivals',
    description: 'The nearest upcoming arrivals in scope.',
    totals: `${d.upcoming.total} upcoming · ${d.upcoming.next7} in the next 7 days`,
    what: 'Upcoming arrivals',
    cols: bookingCols(),
    rows: d.upcoming.imminent,
  })

  if (d.parity.available && d.parity.byDate.length) {
    add({
      name: 'AppleSystem Parity', tab: P.muted,
      title: 'AppleSystem parity by create date',
      description: 'Confirmations raised in AppleSystem against bookings created here. Missing is the number to act on.',
      what: 'AppleSystem ↔ OPS parity by date',
      cols: [
        { header: 'Create date', width: 14, kind: 'date', value: (x: typeof d.parity.byDate[number]) => x.date },
        { header: 'Confirmed in AppleSystem', width: 16, kind: 'int', value: x => x.upstreamConfirmed },
        { header: 'Created here', width: 14, kind: 'int', value: x => x.systemHeld },
        { header: 'Missing', width: 10, kind: 'int', value: x => x.missing },
      ],
      rows: d.parity.byDate,
    })
  }

  // Overview goes first, then every table in the order above.
  overview(wb, d, specs.map(s => ({ name: sheetName(s.name), what: s.what, tab: s.tab })))
  for (const s of specs) addTable(wb, s, gen)

  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  return { buffer, sheets: ['Overview', ...specs.map(s => sheetName(s.name))] }
}
