/**
 * The Driver Settlement Register as a workbook.
 *
 * ---- What changed, and why ----
 *
 * The register used to download as a CSV built in the browser from a fixed list
 * of seventeen headings. That was wrong in two ways once columns became the
 * user's: it ignored the layout the person had arranged, and a CSV cannot carry
 * a total, a subtotal or a note about what is missing — so every download
 * arrived as a wall of text somebody re-typed into a real sheet before they
 * could use it.
 *
 * This builds the sheet the person is looking at: their columns, in their
 * order, under their headings, with the group subtotals the screen shows and a
 * grand total that says what it was totalled over. Money is written as real
 * numeric cells, so a column can be summed without being retyped.
 *
 * ---- The other tabs ----
 *
 * A settlement download is used for two jobs, and the register sheet only does
 * the first. "By bulk" is what a payment run is approved from — one line per
 * bulk, the balance to release. "By chauffeur" is what a transfer is actually
 * made from. "Exceptions" is the list somebody has to chase before either can
 * happen. All three are derived from the same filtered rows, so no tab can
 * disagree with another.
 *
 * SheetJS's community build writes no styling, so legibility is structural:
 * a banner, an autofilter on the header row, sized columns from the catalogue's
 * own widths, and blank cells rather than zeroes where a figure is unknown.
 */

import * as XLSX from 'xlsx'
import { formatDay } from './sl-drive-log'
import {
  REGISTER_STATE_LABEL, registerTotals, groupRegisterRows,
  type RegisterGroupBy, type RegisterQuery, type RegisterRow,
} from './sl-settlement-register'
import {
  COLUMN_BY_ID, columnText, columnTotal, columnValue, isNumericKind, resolveColumns, stamp,
  type RegisterColumnDef, type RegisterView,
} from './sl-settlement-columns'

/** The window this download covers, in the register's own words. */
const windowLabel = (q: RegisterQuery) =>
  `${q.dateField === 'arrivalDate' ? 'Arrival' : 'Departure'} `
  + (q.from === q.to ? formatDay(q.from) : `${formatDay(q.from)} → ${formatDay(q.to)}`)

/** A money cell, or blank — never a zero standing in for "not costed". */
const cell = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : Number(v.toFixed(2))

/**
 * One cell, typed for the sheet.
 *
 * Numeric kinds go in as numbers so they can be totalled in Excel; everything
 * else goes in as the text the screen shows. The outflow columns are the one
 * place the two disagree on sign — the screen prints an advance as money
 * leaving, "(4,500.00)", and the sheet stores it as a positive 4500 so a column
 * of them adds up to what was handed out rather than to its negative.
 */
function sheetCell(row: RegisterRow, col: RegisterColumnDef): string | number {
  const v = columnValue(row, col.id)
  if (v === null || v === undefined || v === '') return ''
  if (isNumericKind(col.kind)) return typeof v === 'number' ? Number(v.toFixed(2)) : ''
  if (col.kind === 'stamp') return stamp(String(v))
  return columnText(row, col, '')
}

const GROUP_NOUN: Record<RegisterGroupBy, string> = {
  none: '', bulk: 'bulk', chauffeur: 'chauffeur', agent: 'agent', month: 'month',
}

/** The whole book. */
export function buildSettlementWorkbook(
  rows: RegisterRow[],
  q: RegisterQuery,
  view: RegisterView,
  now = new Date(),
  generatedBy: string | null = null,
): Buffer {
  const wb = XLSX.utils.book_new()
  const cols = resolveColumns(view)
  const totals = registerTotals(rows)
  const groups = groupRegisterRows(rows, q.groupBy)

  // ── The register, as laid out on screen ────────────────────────────────────
  const filters = [
    q.search ? `search "${q.search}"` : '',
    q.bulkNo ? `bulk ${q.bulkNo}` : q.bulk !== 'all' ? q.bulk.replace('_', ' ') : '',
    q.costType !== 'all' ? `cost type ${q.costType}` : '',
    q.state !== 'all' ? `status ${q.state}` : '',
    q.variance !== 'all' ? `variance ${q.variance}` : '',
    q.payment !== 'all' ? `payment ${q.payment}` : '',
    q.chauffeur ? `chauffeur ${q.chauffeur}` : '',
    q.agent ? `agent ${q.agent}` : '',
    q.approvedOnly ? 'approved P&L only' : '',
    q.openOnly ? 'open items only' : '',
  ].filter(Boolean).join(' · ')

  const banner: (string | number)[][] = [
    ['Driver Settlement Register — Sri Lanka'],
    [`${windowLabel(q)} · ${rows.length} tour${rows.length === 1 ? '' : 's'}`
      + (filters ? ` · ${filters}` : '')],
    [`Layout "${view.name}" · generated ${now.toLocaleString('en-GB', { hour12: false })}`
      + (generatedBy ? ` by ${generatedBy}` : '')
      + ' · figures derived by the Apple Accounts system, read here unchanged'],
    [],
  ]

  const header = cols.map(c => c.label)
  const body: (string | number)[][] = []

  // Grouped downloads keep the screen's subtotals. Ungrouped ones do not get a
  // spurious "All rows" band above a table that is already all the rows.
  for (const g of groups) {
    if (q.groupBy !== 'none') {
      const band = cols.map((c, i) => {
        if (i === 0) return `${g.label} — ${g.rows.length} tour${g.rows.length === 1 ? '' : 's'}`
        const t = columnTotal(g.totals, c)
        return t === null ? '' : cell(t)
      })
      body.push([], band)
    }
    for (const r of g.rows) body.push(cols.map(c => sheetCell(r, c)))
  }

  const grand = cols.map((c, i) => {
    if (i === 0) return `TOTAL — ${totals.rows} tours, ${totals.pax} pax`
    const t = columnTotal(totals, c)
    return t === null ? '' : cell(t)
  })

  const sheet = XLSX.utils.aoa_to_sheet([
    ...banner,
    header,
    ...body,
    [],
    grand,
    [`Totalled over the ${totals.rows} tour(s) shown.`
      + (totals.noRate ? ` ${totals.noRate} carry no rupee rate and are shown in their costed currency.` : '')
      + (totals.rows - totals.packaged > 0
        ? ` ${totals.rows - totals.packaged} have no package cost saved yet — their balance falls back to the costed total and they carry no variance.`
        : '')],
    ['Balance payable = package cost − advance paid. Excess / (shortage) = package cost − total transport cost.'],
    ['This sheet records a settlement request. The rest payment itself is released by the accounts team on Payable 1.0.'],
  ])

  const headerRow = banner.length
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRow, c: 0 },
      e: { r: headerRow + body.length, c: Math.max(0, cols.length - 1) },
    }),
  }
  sheet['!cols'] = cols.map(c => ({ wch: c.width ?? 14 }))
  XLSX.utils.book_append_sheet(wb, sheet, 'Register')

  // ── By bulk — what a payment run is approved from ──────────────────────────
  appendSummary(wb, rows, 'bulk', 'By Bulk',
    'One line per payment run. This is the sheet a bulk is approved from.')

  // ── By chauffeur — what a transfer is made from ────────────────────────────
  appendSummary(wb, rows, 'chauffeur', 'By Chauffeur',
    'One line per chauffeur, over the window shown. This is what a transfer is made from.')

  // ── Exceptions — the rows somebody has to act on ───────────────────────────
  const exceptions = rows.filter(r =>
    !r.payable
    || r.packageCost === null
    || !r.chauffeur
    || r.state === 'rejected'
    || r.state === 'pending'
    || !r.lkrAvailable
    || (r.excess !== null && r.excess < -0.01))

  const why = (r: RegisterRow): string => {
    const out: string[] = []
    if (!r.payable) out.push('P&L not approved — accounts cannot release against it')
    if (r.packageCost === null) out.push('No package cost saved on the transport settlement sheet')
    if (!r.chauffeur) out.push(r.vendorName ? `No chauffeur named (vendor ${r.vendorName})` : 'No chauffeur allocated')
    if (!r.lkrAvailable) out.push(`No rupee rate — figures are in ${r.currency}`)
    if (r.state === 'pending') out.push('Submitted — waiting on the accounts team')
    if (r.state === 'rejected') out.push(`Sent back: ${r.decisionNote ?? 'no reason given'}`)
    if (r.excess !== null && r.excess < -0.01) out.push('Cost ran over the agreed package')
    return out.join(' · ')
  }

  const ex = XLSX.utils.aoa_to_sheet([
    ['Exceptions'],
    ['Tours in this window that need a decision before the rest payment can be released.'],
    [],
    ['Bulk', 'Tour', 'Date', 'Chauffeur', 'A/C Name', 'Package Cost', 'Total Cost',
     'Balance Payable', 'Status', 'Why'],
    ...exceptions.map(r => [
      r.bulkNo ?? '', r.tour, columnText(r, COLUMN_BY_ID.date, ''),
      r.chauffeur ?? r.vendorName ?? '', r.acName ?? '',
      cell(r.packageCost), cell(r.totalCost), cell(r.balancePayable),
      REGISTER_STATE_LABEL[r.state], why(r),
    ]),
    ...(exceptions.length === 0 ? [['Nothing outstanding in this window.']] : []),
  ])
  ex['!cols'] = [
    { wch: 8 }, { wch: 14 }, { wch: 13 }, { wch: 22 }, { wch: 22 },
    { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 14 }, { wch: 60 },
  ]
  XLSX.utils.book_append_sheet(wb, ex, 'Exceptions')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * A one-line-per-group tab.
 *
 * Deliberately a fixed set of money columns rather than the user's: this is the
 * payment side of the download and the figures a transfer needs are the same
 * whichever columns somebody arranged on screen.
 */
function appendSummary(
  wb: XLSX.WorkBook,
  rows: RegisterRow[],
  by: Exclude<RegisterGroupBy, 'none'>,
  tab: string,
  note: string,
) {
  const groups = groupRegisterRows(rows, by)
  const all = registerTotals(rows)

  const sheet = XLSX.utils.aoa_to_sheet([
    [`Settlement summary by ${GROUP_NOUN[by]}`],
    [note],
    [],
    [tab === 'By Bulk' ? 'Bulk' : 'Chauffeur', 'Tours', 'Pax',
     'Package Cost', 'Total Transport Cost', 'Advance Due', 'Advance Paid', 'Advance Pending',
     'Balance Payable', 'Rest Released', 'Still To Release', 'Excess / (Shortage)', 'Settled'],
    ...groups.map(g => [
      g.label, g.totals.rows, g.totals.pax,
      cell(g.totals.packageCost), cell(g.totals.totalCost),
      cell(g.totals.advanceDue), cell(g.totals.advancePaid), cell(g.totals.advancePending),
      cell(g.totals.balancePayable), cell(g.totals.restPaid), cell(g.totals.restOutstanding),
      cell(g.totals.excess), `${g.totals.settled}/${g.totals.rows}`,
    ]),
    [],
    ['TOTAL', all.rows, all.pax,
     cell(all.packageCost), cell(all.totalCost),
     cell(all.advanceDue), cell(all.advancePaid), cell(all.advancePending),
     cell(all.balancePayable), cell(all.restPaid), cell(all.restOutstanding),
     cell(all.excess), `${all.settled}/${all.rows}`],
  ])
  sheet['!cols'] = [
    { wch: 26 }, { wch: 7 }, { wch: 6 },
    { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    { wch: 16 }, { wch: 15 }, { wch: 16 }, { wch: 17 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, sheet, tab)
}
