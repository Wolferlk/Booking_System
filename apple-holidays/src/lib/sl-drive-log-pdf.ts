/**
 * The Drive Log as a printable statement.
 *
 * Built as HTML and rendered by the shared Chromium (`launchBrowser` from
 * `html-to-pdf.ts`), like the Daily Update sheet — the same launcher means one
 * place to fix the serverless Chromium binary. `htmlToPdf()` itself is not used
 * because it fixes portrait A4 and stamps a booking-confirmation masthead on
 * every page, neither of which suits a nine-column ledger.
 *
 * The PDF is not the screen. A screen is scanned; a printout is *read*, usually
 * next to a bank transfer, so it drops the interactive apparatus and keeps the
 * things a piece of paper has to carry on its own: the window it covers, the
 * age of the accounts figures behind it, per-day subtotals that make the page
 * self-checking, a driver summary at the back to pay from, and an explicit note
 * of every booking left out of the totals for want of a rate.
 *
 * Landscape, because nine money columns will not fit portrait without shrinking
 * the figures past reading size.
 */

import { launchBrowser } from './html-to-pdf'
import {
  STAGE_LABEL, SETTLEMENT_LABEL, amount, driveLogTotals, formatDay, groupDriveLogRows,
  windowLabel, type DriveLogQuery, type DriveLogRow,
} from './sl-drive-log'
import { freshness } from './driver-advance'

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** A money figure, or an em dash — a blank cell would read as zero. */
const m = (v: number | null | undefined) => (v === null || v === undefined ? '—' : amount(v))

/** Still-owed money is the number the reader is looking for, so it is coloured. */
function plCell(v: number | null | undefined): string {
  if (v === null || v === undefined) return '<td class="num muted">—</td>'
  if (v < -0.01) return `<td class="num over">(${amount(Math.abs(v))})</td>`
  if (v < 0.01)  return '<td class="num ok">settled</td>'
  return `<td class="num due">${amount(v)}</td>`
}

function rowHtml(r: DriveLogRow): string {
  const s = r.settlement
  const ref = esc(r.isNumber ?? r.bookingRef)
  const driver = r.driver
    ? `${esc(r.driver.name)}${r.driver.vehicle?.plateNo ? `<span class="sub">${esc(r.driver.vehicle.plateNo)}</span>` : ''}`
    : '<span class="muted">not allocated</span>'

  // An uncosted booking is shown as a row that says so, spanning the money
  // columns. Printing seven em dashes across would look like a rendering fault.
  if (s.state !== 'ok') {
    return `<tr>
      <td><b>${ref}</b><span class="sub">${esc(r.cntlNumber ?? '')}</span></td>
      <td>${esc(formatDay(r.arrivalDate))}<span class="sub">${esc(r.clientName ?? '')}</span></td>
      <td>${driver}</td>
      <td class="num">${r.invoice?.amount != null ? `${esc(r.invoice.currency)} ${m(r.invoice.amount)}` : '—'}</td>
      <td colspan="6" class="note">${esc(SETTLEMENT_LABEL[s.state])} — ${esc(s.message ?? '')}</td>
    </tr>`
  }

  return `<tr>
    <td><b>${ref}</b><span class="sub">${esc(r.cntlNumber ?? '')}</span></td>
    <td>${esc(formatDay(r.arrivalDate))}<span class="sub">${esc(r.clientName ?? '')}</span></td>
    <td>${driver}</td>
    <td class="num">${r.invoice?.amount != null ? `${esc(r.invoice.currency)} ${m(r.invoice.amount)}` : '—'}</td>
    <td class="num strong">${m(s.totalCost)}</td>
    <td class="num">${m(s.advance)}${s.edited ? '<span class="sub">edited</span>' : ''}</td>
    <td class="num">${m(s.balancePayable)}</td>
    <td class="num">${m(s.advancePaid)}</td>
    <td class="num">${m(s.restPaid)}</td>
    ${plCell(s.profitLoss)}
  </tr>`
}

export async function buildDriveLogPdf(
  rows: DriveLogRow[],
  q: DriveLogQuery,
  now = new Date(),
  generatedBy: string | null = null,
): Promise<Buffer> {
  const totals = driveLogTotals(rows)
  const days   = groupDriveLogRows(rows, 'day')
  const drivers = groupDriveLogRows(rows, 'driver')

  // The oldest snapshot on the page. A printout that does not say how stale its
  // figures are invites someone to treat it as live an hour later.
  const oldest = rows
    .map(r => r.settlement.computedAt)
    .filter((v): v is string => !!v)
    .sort()[0] ?? null

  const dayBlocks = days.map(g => `
    <tr class="day"><td colspan="10">${esc(g.label)} · ${g.rows.length} booking${g.rows.length === 1 ? '' : 's'}</td></tr>
    ${g.rows.map(rowHtml).join('')}
    <tr class="subtotal">
      <td colspan="4">Subtotal · ${g.totals.costedRows} costed</td>
      <td class="num">${m(g.totals.totalCost)}</td>
      <td class="num">${m(g.totals.advance)}</td>
      <td class="num">${m(g.totals.balancePayable)}</td>
      <td class="num">${m(g.totals.advancePaid)}</td>
      <td class="num">${m(g.totals.restPaid)}</td>
      <td class="num">${m(g.totals.profitLoss)}</td>
    </tr>`).join('')

  const driverRows = drivers.map(g => `
    <tr>
      <td><b>${esc(g.label)}</b>${g.sublabel ? `<span class="sub">${esc(g.sublabel)}</span>` : ''}</td>
      <td>${esc([g.rows[0].driver?.bank?.name, g.rows[0].driver?.bank?.accountNo].filter(Boolean).join(' · ') || '—')}</td>
      <td class="num">${g.rows.length}</td>
      <td class="num">${m(g.totals.totalCost)}</td>
      <td class="num">${m(g.totals.advance)}</td>
      <td class="num">${m(g.totals.advancePaid)}</td>
      <td class="num">${m(g.totals.restPaid)}</td>
      <td class="num">${m(g.totals.profitLoss)}</td>
    </tr>`).join('')

  const caveats: string[] = []
  if (totals.uncostedRows) caveats.push(`${totals.uncostedRows} booking(s) the accounts system has not costed yet are excluded from every total.`)
  if (totals.noRateRows)   caveats.push(`${totals.noRateRows} booking(s) carry no LKR rate and are excluded from every rupee total.`)
  if (totals.invoiceOtherCcy) caveats.push(`${totals.invoiceOtherCcy} invoice(s) are billed in a currency other than USD and are excluded from the invoice total.`)
  if (totals.unapproved)   caveats.push(`${totals.unapproved} booking(s) have an unapproved P&L — Payable 1.0 will not release those advances.`)
  if (totals.unassigned)   caveats.push(`${totals.unassigned} booking(s) have no driver allocated.`)

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Drive Log</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 9px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #12151c; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; letter-spacing: -0.2px; }
  .lede { font-size: 9.5px; color: #556; margin: 0 0 1px; }
  .meta { font-size: 8px; color: #889; margin: 0; }
  header { border-bottom: 2px solid #12151c; padding-bottom: 6px; margin-bottom: 8px;
           display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .kpis { display: flex; gap: 6px; margin-bottom: 8px; }
  .kpi { flex: 1; border: 1px solid #dfe3ea; border-radius: 4px; padding: 5px 7px; }
  .kpi .k { font-size: 7px; text-transform: uppercase; letter-spacing: 0.6px; color: #7a8290; }
  .kpi .v { font-size: 12px; font-weight: 700; margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 7px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280;
       text-align: left; border-bottom: 1px solid #12151c; padding: 4px 5px; }
  td { padding: 4px 5px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .strong { font-weight: 700; }
  .sub { display: block; font-size: 7px; color: #8a919c; }
  .muted { color: #9aa0aa; }
  .note { font-size: 8px; color: #8a6d3b; background: #fdf6e6; }
  .due  { color: #b45309; font-weight: 700; }
  .over { color: #b91c1c; font-weight: 700; }
  .ok   { color: #15803d; }
  tr.day td { background: #f2f4f8; font-weight: 700; font-size: 8.5px; padding: 4px 5px;
              border-top: 1px solid #ced4de; border-bottom: 1px solid #ced4de; }
  tr.subtotal td { background: #fafbfd; font-weight: 700; border-bottom: 1px solid #ced4de; }
  tr { page-break-inside: avoid; }
  h2 { font-size: 11px; margin: 14px 0 5px; padding-top: 8px; border-top: 1px solid #ced4de; }
  .caveats { margin-top: 10px; font-size: 8px; color: #6b7280; }
  .caveats li { margin-bottom: 2px; }
  footer { margin-top: 12px; border-top: 1px solid #dfe3ea; padding-top: 5px;
           font-size: 7.5px; color: #9aa0aa; }
</style></head>
<body>
<header>
  <div>
    <h1>Drive Log · Sri Lanka</h1>
    <p class="lede">${esc(windowLabel(q))} · ${rows.length} booking${rows.length === 1 ? '' : 's'} · all figures LKR unless stated</p>
    <p class="meta">Transport cost, driver advance and settlement — derived by the Apple Accounts system and reproduced here unchanged.</p>
  </div>
  <div style="text-align:right">
    <p class="meta">Generated ${esc(now.toLocaleString('en-GB', { hour12: false }))}${generatedBy ? ` · ${esc(generatedBy)}` : ''}</p>
    <p class="meta">Accounts figures ${oldest ? `last computed ${esc(freshness(oldest) ?? '—')}` : 'age unknown'}</p>
  </div>
</header>

<div class="kpis">
  <div class="kpi"><div class="k">Total transport cost</div><div class="v">${m(totals.totalCost)}</div></div>
  <div class="kpi"><div class="k">Driver advance</div><div class="v">${m(totals.advance)}</div></div>
  <div class="kpi"><div class="k">Balance payable</div><div class="v">${m(totals.balancePayable)}</div></div>
  <div class="kpi"><div class="k">Actually paid</div><div class="v">${m(totals.paid)}</div></div>
  <div class="kpi"><div class="k">Still owed</div><div class="v">${m(totals.profitLoss)}</div></div>
  <div class="kpi"><div class="k">Client invoiced</div><div class="v">USD ${m(totals.invoiceUsd)}</div></div>
</div>

<table>
  <thead><tr>
    <th>IS / CNTL</th><th>Arrival / Client</th><th>Driver</th>
    <th class="num">Invoice</th>
    <th class="num">Total cost</th><th class="num">Advance</th><th class="num">Balance payable</th>
    <th class="num">Advance paid</th><th class="num">Paid balance</th><th class="num">Still owed</th>
  </tr></thead>
  <tbody>
    ${dayBlocks || '<tr><td colspan="10" class="muted">No bookings in this window.</td></tr>'}
    <tr class="subtotal">
      <td colspan="4">TOTAL · ${totals.costedRows} costed booking(s)</td>
      <td class="num">${m(totals.totalCost)}</td>
      <td class="num">${m(totals.advance)}</td>
      <td class="num">${m(totals.balancePayable)}</td>
      <td class="num">${m(totals.advancePaid)}</td>
      <td class="num">${m(totals.restPaid)}</td>
      <td class="num">${m(totals.profitLoss)}</td>
    </tr>
  </tbody>
</table>

<h2>Payment summary by driver</h2>
<table>
  <thead><tr>
    <th>Driver</th><th>Bank</th><th class="num">Files</th>
    <th class="num">Total cost</th><th class="num">Advance</th>
    <th class="num">Advance paid</th><th class="num">Paid balance</th><th class="num">Still owed</th>
  </tr></thead>
  <tbody>${driverRows || '<tr><td colspan="8" class="muted">Nothing to summarise.</td></tr>'}</tbody>
</table>

${caveats.length ? `<div class="caveats"><b>Notes</b><ul>${caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}

<footer>
  Stage counts — settled ${totals.settled} · advance due ${totals.advanceDue} · rest due ${totals.restDue}${totals.overpaid ? ` · overpaid ${totals.overpaid}` : ''}.
  Transport P/L is the total transport cost less what has actually been released to the driver; a figure in brackets means the driver has been paid more than the booking costed.
</footer>
</body></html>`

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    const raw = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:1px;"> </div>',
      footerTemplate: `
        <div style="width:100%;padding:0 10mm;box-sizing:border-box;font:7px Arial,Helvetica,sans-serif;
                    color:#9aa0aa;display:flex;justify-content:space-between;">
          <span>Apple Holidays · Drive Log · ${esc(windowLabel(q))}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      // The masthead is part of the document, so only the footer needs room.
      margin: { top: '6mm', right: '0', bottom: '10mm', left: '0' },
    })

    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
