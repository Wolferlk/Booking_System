/**
 * The Drive Log as a workbook.
 *
 * Split out of the route so the auth check and the rendering are separable, and
 * so the sheet is built from the same rows the screen showed — one fetch, one
 * filter, one set of numbers.
 *
 * SheetJS's community build writes no cell styling, so the sheet earns its
 * legibility structurally: a banner carrying the window and the filters, an
 * autofilter on the header row, sized columns, real numeric cells (so the
 * accountant can total a column without retyping it), and two further tabs —
 * a per-driver payment summary, which is what a transfer is actually made
 * from, and the exceptions the desk has to chase.
 */

import * as XLSX from 'xlsx'
import {
  STAGE_LABEL, SETTLEMENT_LABEL, driveLogTotals, formatDay, groupDriveLogRows, windowLabel,
  type DriveLogQuery, type DriveLogRow,
} from './sl-drive-log'

/** A money cell, or blank — never a zero standing in for "not costed". */
const cell = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '' : Number(v.toFixed(2))

const bankLine = (r: DriveLogRow) => {
  const b = r.driver?.bank
  if (!b) return ''
  return [b.name, b.branch, b.accountNo, b.holder].filter(Boolean).join(' · ')
}

const vehicleLine = (r: DriveLogRow) => {
  const v = r.driver?.vehicle
  if (!v) return ''
  return [v.plateNo, [v.brand, v.model].filter(Boolean).join(' '), v.type].filter(Boolean).join(' · ')
}

const LEDGER_HEADERS = [
  'IS Number', 'CNTL', 'Booking Ref', 'Arrival', 'Departure', 'Nights', 'Pax',
  'Client', 'Agent', 'File Handler',
  'Driver', 'Driver Phone', 'Vehicle', 'Bank Details',
  'Invoice No', 'Invoice Ccy', 'Invoice Amount', 'Invoice Paid', 'Invoice Balance',
  'Currency', 'Total Transport Cost', 'Driver Advance', 'Balance Payable',
  'Advance Paid', 'Actual Paid Balance', 'Total Paid', 'Transport P/L',
  'Stage', 'P&L Approval', 'Costing', 'Computed At',
]

function ledgerRow(r: DriveLogRow): (string | number)[] {
  const s = r.settlement
  return [
    r.isNumber ?? '', r.cntlNumber ?? '', r.bookingRef,
    formatDay(r.arrivalDate), formatDay(r.departureDate), r.nights ?? '', r.pax,
    r.clientName ?? '', r.agent ?? '', r.fileHandler ?? '',
    r.driver?.name ?? '', r.driver?.phone ?? '', vehicleLine(r), bankLine(r),
    r.invoice?.invoiceNumber ?? '', r.invoice?.currency ?? '',
    cell(r.invoice?.amount), cell(r.invoice?.paid), cell(r.invoice?.balance),
    s.state === 'ok' ? s.currency : '',
    cell(s.totalCost), cell(s.advance), cell(s.balancePayable),
    cell(s.advancePaid), cell(s.restPaid), cell(s.paid), cell(s.profitLoss),
    s.stage ? STAGE_LABEL[s.stage] : '',
    s.approval,
    SETTLEMENT_LABEL[s.state],
    s.computedAt ? new Date(s.computedAt).toLocaleString('en-GB', { hour12: false }) : '',
  ]
}

/** The whole book. */
export function buildDriveLogWorkbook(
  rows: DriveLogRow[],
  q: DriveLogQuery,
  now = new Date(),
  generatedBy: string | null = null,
): Buffer {
  const wb = XLSX.utils.book_new()
  const totals = driveLogTotals(rows)

  // ── Ledger ──────────────────────────────────────────────────────────────────
  const banner = [
    ['Drive Log — Sri Lanka transport settlement'],
    [`${windowLabel(q)} · ${rows.length} booking${rows.length === 1 ? '' : 's'}`
      + (q.search ? ` · search "${q.search}"` : '')
      + (q.stage !== 'all' ? ` · stage ${q.stage}` : '')
      + (q.approval !== 'all' ? ` · P&L ${q.approval}` : '')
      + (q.openOnly ? ' · open items only' : '')],
    [`Generated ${now.toLocaleString('en-GB', { hour12: false })}`
      + (generatedBy ? ` by ${generatedBy}` : '')
      + ' · figures derived by the Apple Accounts system, read here unchanged'],
    [],
  ]

  const ledger = XLSX.utils.aoa_to_sheet([
    ...banner,
    LEDGER_HEADERS,
    ...rows.map(ledgerRow),
    [],
    [
      'TOTALS', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'USD',
      cell(totals.invoiceUsd), '', '',
      'LKR',
      cell(totals.totalCost), cell(totals.advance), cell(totals.balancePayable),
      cell(totals.advancePaid), cell(totals.restPaid), cell(totals.paid), cell(totals.profitLoss),
    ],
    [`Totalled over ${totals.costedRows} costed booking(s).`
      + (totals.uncostedRows ? ` ${totals.uncostedRows} not costed yet.` : '')
      + (totals.noRateRows ? ` ${totals.noRateRows} carry no LKR rate and are excluded.` : '')
      + (totals.invoiceOtherCcy ? ` ${totals.invoiceOtherCcy} invoice(s) in another currency are excluded.` : '')],
  ])

  const headerRow = banner.length
  ledger['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 12 } },
  ]
  ledger['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRow, c: 0 },
      e: { r: headerRow + rows.length, c: LEDGER_HEADERS.length - 1 },
    }),
  }
  ledger['!cols'] = [
    { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 7 }, { wch: 5 },
    { wch: 24 }, { wch: 18 }, { wch: 16 },
    { wch: 26 }, { wch: 15 }, { wch: 26 }, { wch: 38 },
    { wch: 16 }, { wch: 6 }, { wch: 14 }, { wch: 13 }, { wch: 13 },
    { wch: 6 }, { wch: 18 }, { wch: 15 }, { wch: 15 },
    { wch: 14 }, { wch: 18 }, { wch: 13 }, { wch: 14 },
    { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(wb, ledger, 'Drive Log')

  // ── By driver — what a transfer is made from ────────────────────────────────
  const byDriver = groupDriveLogRows(rows, 'driver')
  const driverSheet = XLSX.utils.aoa_to_sheet([
    ['Payment summary by driver'],
    [`${windowLabel(q)} · one line per driver, LKR`],
    [],
    ['Driver', 'Phone', 'Vehicle', 'Bank Details', 'Bookings',
     'Total Cost', 'Advance', 'Balance Payable', 'Advance Paid', 'Actual Paid Balance', 'Still Owed'],
    ...byDriver.map(g => {
      const first = g.rows[0]
      return [
        g.label, first.driver?.phone ?? '', vehicleLine(first), bankLine(first), g.rows.length,
        cell(g.totals.totalCost), cell(g.totals.advance), cell(g.totals.balancePayable),
        cell(g.totals.advancePaid), cell(g.totals.restPaid), cell(g.totals.profitLoss),
      ]
    }),
  ])
  driverSheet['!cols'] = [
    { wch: 28 }, { wch: 15 }, { wch: 26 }, { wch: 38 }, { wch: 9 },
    { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 18 }, { wch: 14 },
  ]
  XLSX.utils.book_append_sheet(wb, driverSheet, 'By Driver')

  // ── Exceptions — the rows somebody has to act on ────────────────────────────
  const exceptions = rows.filter(r =>
    r.settlement.state !== 'ok'
    || r.settlement.approval !== 'approved'
    || !r.driver
    || (r.settlement.profitLoss !== null && r.settlement.profitLoss < -0.01))

  const reason = (r: DriveLogRow): string => {
    const why: string[] = []
    if (r.settlement.state !== 'ok') why.push(SETTLEMENT_LABEL[r.settlement.state])
    if (r.settlement.state === 'ok' && r.settlement.approval !== 'approved') {
      why.push('P&L not approved — Payable 1.0 will not release the advance')
    }
    if (!r.driver) why.push('No driver allocated')
    if (r.settlement.profitLoss !== null && r.settlement.profitLoss < -0.01) {
      why.push('Paid more than the booking costed')
    }
    return why.join(' · ')
  }

  const exSheet = XLSX.utils.aoa_to_sheet([
    ['Exceptions'],
    ['Bookings in this window that need a decision before the driver can be paid.'],
    [],
    ['IS Number', 'Arrival', 'Client', 'Driver', 'Total Cost', 'Advance', 'Still Owed', 'Why'],
    ...exceptions.map(r => [
      r.isNumber ?? r.bookingRef, formatDay(r.arrivalDate), r.clientName ?? '',
      r.driver?.name ?? '', cell(r.settlement.totalCost), cell(r.settlement.advance),
      cell(r.settlement.profitLoss), reason(r),
    ]),
    ...(exceptions.length === 0 ? [['Nothing outstanding in this window.']] : []),
  ])
  exSheet['!cols'] = [
    { wch: 12 }, { wch: 13 }, { wch: 24 }, { wch: 26 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 60 },
  ]
  XLSX.utils.book_append_sheet(wb, exSheet, 'Exceptions')

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
