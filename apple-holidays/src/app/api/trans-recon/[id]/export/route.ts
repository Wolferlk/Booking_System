import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { reconFailure, reconSession } from '@/lib/trans-recon/access'
import { loadSheet } from '@/lib/trans-recon/server'
import {
  breakdown, byBooking, byDay, byVendor, computeSheet, isLive, RECON_COUNTRY_META, type Breakdown,
} from '@/lib/trans-recon/shared'

export const dynamic = 'force-dynamic'

const HEAD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }
const BAND_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }
const THIN = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN }

/**
 * The sheet as the desk's own workbook: the same nine columns their Excel had
 * (DATE … RATES), then what the system adds — MC description, P&L line, P&L
 * rate, difference, Accounts' decision. A second tab is the report.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await reconSession('view')
  if (s instanceof Response) return s
  try {
    const { sheet, lines } = await loadSheet(params.id, s.allowed)
    const withCancelled = req.nextUrl.searchParams.get('cancelled') === '1'
    const shown = lines.filter(l => !l.isRemoved && (withCancelled || !l.bookingCancelled))
    const { figures, totals } = computeSheet(lines, sheet.currency, sheet.fxRates)
    const cur = sheet.currency
    const money = cur === 'VND' || cur === 'LKR' ? '#,##0' : '#,##0.00'

    const wb = new ExcelJS.Workbook()
    wb.creator = 'Apple Holidays OPS — Trans-Reconsultation'
    wb.created = new Date()

    // ── Sheet 1 — the transport sheet ────────────────────────────────────────
    const ws = wb.addWorksheet(sheet.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ state: 'frozen', ySplit: 3 }] })
    const cols = [
      ['DATE', 12], ['TOUR NO', 16], ['GUEST NAME', 24], ['PAX', 9], ['PICK UP', 28], ['DROP OFF', 28], ['TIME', 8],
      ['DETAILS', 46], ['MC DESCRIPTION', 46], ['PNL DESCRIPTION', 36], [`RATES (${cur})`, 14], ['RATE (TOTAL)', 12],
      [`PNL RATE (${cur})`, 14], ['DIFFERENCE', 13], ['ACCOUNTS', 12], ['NOTE', 30],
    ] as const
    ws.columns = cols.map(([, w]) => ({ width: w }))
    ws.mergeCells(1, 1, 1, cols.length)
    ws.getCell(1, 1).value = `${RECON_COUNTRY_META[sheet.country].flag} ${sheet.title}`
    ws.getCell(1, 1).font = { bold: true, size: 14 }
    ws.mergeCells(2, 1, 2, cols.length)
    ws.getCell(2, 1).value = `Status ${sheet.status} · ${totals.lines} lines · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
      + (Object.keys(sheet.fxRates).length ? ` · FX ${Object.entries(sheet.fxRates).map(([k, v]) => `1 ${k} = ${v} ${cur}`).join(', ')}` : '')
    ws.getCell(2, 1).font = { size: 9, color: { argb: 'FF64748B' } }
    const head = ws.getRow(3)
    cols.forEach(([h], i) => {
      const c = head.getCell(i + 1)
      c.value = h; c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 }; c.fill = HEAD_FILL
      c.alignment = { vertical: 'middle', wrapText: true }; c.border = BOX
    })
    head.height = 20

    let r = 4
    for (const l of shown) {
      const f = figures.get(l.id)!
      const row = ws.getRow(r++)
      row.values = [
        new Date(`${l.serviceDate}T00:00:00Z`), l.tourNo ?? '', l.guestName ?? '', l.pax ?? '', l.pickUp ?? '', l.dropOff ?? '',
        l.time ?? '', l.details ?? '', l.mcDescription ?? '', l.pnlDescription ?? '',
        l.rateText ?? '', l.rate ?? null,
        f.pnlShare ?? null, f.difference ?? null,
        l.bookingCancelled ? 'CANCELLED' : l.approvalStatus === 'PENDING' ? 'Pending' : l.approvalStatus === 'APPROVED' ? 'Approved' : 'Not approved',
        [l.approvalNote, l.remarks, f.sharedBy > 1 ? `P&L line shared by ${f.sharedBy} movements` : null, f.gap === 'NO_FX' ? `No FX for ${l.pnlCurrency}` : null].filter(Boolean).join(' · '),
      ]
      row.getCell(1).numFmt = 'dd-mmm-yy'
      for (const c of [12, 13, 14]) row.getCell(c).numFmt = money
      row.eachCell({ includeEmpty: true }, c => { c.border = BOX; c.alignment = { vertical: 'top', wrapText: true } })
      if (f.difference != null && Math.abs(f.difference) > 0.005) {
        row.getCell(14).font = { bold: true, color: { argb: f.difference > 0 ? 'FFBE123C' : 'FF047857' } }
      }
      if (l.bookingCancelled) row.font = { strike: true, color: { argb: 'FF94A3B8' } }
      else if (l.approvalStatus === 'APPROVED') row.getCell(15).font = { bold: true, color: { argb: 'FF047857' } }
      else if (l.approvalStatus === 'REJECTED') row.getCell(15).font = { bold: true, color: { argb: 'FFBE123C' } }
    }
    const tot = ws.getRow(r + 1)
    tot.getCell(11).value = 'TOTAL'
    tot.getCell(12).value = totals.totalRate
    tot.getCell(13).value = totals.totalPnl
    tot.getCell(14).value = totals.difference
    for (const c of [11, 12, 13, 14]) { tot.getCell(c).font = { bold: true }; tot.getCell(c).fill = BAND_FILL; tot.getCell(c).border = BOX }
    for (const c of [12, 13, 14]) tot.getCell(c).numFmt = money
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3, r - 1), column: cols.length } }

    // ── Sheet 2 — the report ─────────────────────────────────────────────────
    const rp = wb.addWorksheet('Report')
    rp.columns = [{ width: 30 }, { width: 26 }, { width: 10 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 10 }, { width: 10 }, { width: 10 }]
    rp.getCell('A1').value = `${sheet.title} — Report`
    rp.getCell('A1').font = { bold: true, size: 14 }
    const kpis: [string, string | number][] = [
      ['Lines on the sheet', totals.lines],
      ['Lines with a rate', totals.rated],
      ['Lines paired with a P&L line', totals.matched],
      [`Total rate (${cur})`, totals.totalRate],
      [`Total P&L (${cur})`, totals.totalPnl],
      [`Difference on paired lines (${cur})`, totals.difference],
      [`Rate with no P&L to compare (${cur})`, totals.unmatchedRate],
      ['Lines over P&L', totals.over],
      ['Lines under P&L', totals.under],
      ['Approved / Not approved / Pending', `${totals.approved} / ${totals.rejected} / ${totals.pending}`],
      [`Approved rate (${cur})`, totals.approvedRate],
      ['Cancelled-file lines (excluded)', totals.cancelled],
      ['Removed lines (excluded)', totals.removed],
    ]
    kpis.forEach(([k, v], i) => {
      const row = rp.getRow(3 + i)
      row.getCell(1).value = k; row.getCell(2).value = v
      row.getCell(1).font = { color: { argb: 'FF475569' } }; row.getCell(2).font = { bold: true }
      if (typeof v === 'number' && /\(/.test(k)) row.getCell(2).numFmt = money
    })

    const table = (start: number, title: string, rows: Breakdown[], first: string) => {
      rp.getCell(start, 1).value = title
      rp.getCell(start, 1).font = { bold: true, size: 12 }
      const h = rp.getRow(start + 1)
      ;[first, 'Detail', 'Lines', `Rate`, `P&L`, 'Difference', 'No P&L', 'Approved', 'Rejected', 'Pending'].forEach((t, i) => {
        const c = h.getCell(i + 1); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL
      })
      rows.forEach((b, i) => {
        const row = rp.getRow(start + 2 + i)
        row.values = [b.label, b.sub ?? '', b.lines, b.rate, b.pnl, b.difference, b.unmatched, b.approved, b.rejected, b.pending]
        for (const c of [4, 5, 6, 7]) row.getCell(c).numFmt = money
        if (Math.abs(b.difference) > 0.005) row.getCell(6).font = { bold: true, color: { argb: b.difference > 0 ? 'FFBE123C' : 'FF047857' } }
      })
      return start + rows.length + 3
    }
    const live = lines.filter(isLive)
    let next = table(3 + kpis.length + 2, 'By booking', breakdown(live, figures, byBooking).sort((a, b) => b.difference - a.difference), 'Tour no')
    next = table(next, 'By vendor / driver', breakdown(live, figures, byVendor).sort((a, b) => b.rate - a.rate), 'Vendor')
    table(next, 'By day', breakdown(live, figures, byDay).sort((a, b) => a.key.localeCompare(b.key)), 'Date')

    const buf = await wb.xlsx.writeBuffer()
    const name = `${sheet.title}.xlsx`.replace(/[^\w .-]+/g, '')
    return new Response(buf as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return reconFailure(err, 'export')
  }
}
