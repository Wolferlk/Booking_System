/**
 * The Driver Settlement Register as a printable statement.
 *
 * Built as HTML and rendered by the shared Chromium (`launchBrowser` from
 * `html-to-pdf.ts`), the same way the Drive Log statement and the Daily Update
 * are — one launcher, so there is one place to fix the serverless Chromium.
 *
 * ---- The PDF is not the screen ----
 *
 * A screen is scanned; a printout is *read*, usually across a table from
 * somebody approving a payment run. So it drops the interactive apparatus and
 * keeps what paper has to carry on its own: the window and the filters it was
 * drawn under, the totals in the head where they can be read first, the group
 * subtotals that make each page self-checking, a bulk summary to approve from,
 * and an explicit note of every tour whose figures are incomplete. A settlement
 * approved off a page that quietly omitted the eleven tours with no package
 * cost saved would be approved on a number that is not the truth.
 *
 * ---- The columns are the reader's ----
 *
 * It prints the layout the person arranged, under the headings they gave it,
 * because the whole point of a saved view is that the desk's version of this
 * page and accounts' version are different pages. Landscape always, and the
 * type steps down as the column count climbs — twenty columns will not fit at
 * nine point, and shrinking is better than truncating a figure.
 */

import { launchBrowser } from './html-to-pdf'
import { formatDay } from './sl-drive-log'
import {
  amount, bracketed, groupRegisterRows, registerTotals,
  type RegisterQuery, type RegisterRow,
} from './sl-settlement-register'
import {
  columnText, columnTotal, columnValue, isNumericKind, resolveColumns,
  type RegisterColumnDef, type RegisterView,
} from './sl-settlement-columns'

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** A money figure, or an em dash — a blank cell would read as zero. */
const m = (v: number | null | undefined) => (v === null || v === undefined ? '—' : bracketed(v))

const windowLabel = (q: RegisterQuery) =>
  `${q.dateField === 'arrivalDate' ? 'Arrival' : 'Departure'} `
  + (q.from === q.to ? formatDay(q.from) : `${formatDay(q.from)} → ${formatDay(q.to)}`)

/** The filters, said in words, so the page can be trusted on its own. */
function filterLine(q: RegisterQuery): string {
  const bits = [
    q.search ? `search “${q.search}”` : '',
    q.bulkNo ? `bulk ${q.bulkNo}`
      : q.bulk === 'in_bulk' ? 'in a bulk'
      : q.bulk === 'no_bulk' ? 'not in a bulk' : '',
    q.costType !== 'all' ? `cost type ${q.costType.replace(/_/g, ' ')}` : '',
    q.state !== 'all' ? `status ${q.state}` : '',
    q.variance !== 'all' ? `variance ${q.variance.replace(/_/g, ' ')}` : '',
    q.payment !== 'all' ? `payment ${q.payment.replace(/_/g, ' ')}` : '',
    q.chauffeur ? `chauffeur ${q.chauffeur}` : '',
    q.agent ? `agent ${q.agent}` : '',
    q.minBalance !== null ? `balance ≥ ${amount(q.minBalance)}` : '',
    q.maxBalance !== null ? `balance ≤ ${amount(q.maxBalance)}` : '',
    q.approvedOnly ? 'approved P&L only' : '',
    q.openOnly ? 'still owed only' : '',
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : 'no filters'
}

/** A cell, coloured where the colour is the information. */
function cellHtml(row: RegisterRow, col: RegisterColumnDef): string {
  const raw = columnValue(row, col.id)
  const cls = isNumericKind(col.kind) ? 'num' : ''
  const text = columnText(row, col, '—')

  if (col.kind === 'status') {
    return `<td class="st">${esc(text)}${row.payable ? '' : '<span class="sub warn">P&amp;L not approved</span>'}</td>`
  }
  if (col.id === 'tour') {
    return `<td><b>${esc(text)}</b>${row.clientName ? `<span class="sub">${esc(row.clientName)}</span>` : ''}</td>`
  }
  if (col.id === 'chauffeur' && !row.chauffeur) {
    return `<td class="muted">${row.vendorName ? esc(row.vendorName) : 'not allocated'}</td>`
  }
  if ((col.id === 'excess' || col.id === 'budgetVariance') && typeof raw === 'number') {
    return `<td class="num ${raw < -0.009 ? 'over' : raw > 0.009 ? 'ok' : ''}">${esc(text)}</td>`
  }
  if (col.id === 'balancePayable' || col.id === 'restOutstanding' || col.id === 'advancePending') {
    return `<td class="num ${typeof raw === 'number' && raw > 0.009 ? 'due' : ''}">${esc(text)}</td>`
  }
  if (raw === null || raw === undefined || raw === '') return `<td class="${cls} muted">—</td>`
  return `<td class="${cls}">${esc(text)}</td>`
}

export function buildSettlementPdfHtml(
  rows: RegisterRow[],
  q: RegisterQuery,
  view: RegisterView,
  now = new Date(),
  generatedBy: string | null = null,
): string {
  const cols = resolveColumns(view)
  const totals = registerTotals(rows)
  const groups = groupRegisterRows(rows, q.groupBy)

  // Nine point reads well to about a dozen columns; past that the page has to
  // give, and giving on type size loses less than giving on digits.
  const fontPt = cols.length <= 12 ? 8.5 : cols.length <= 16 ? 7.6 : 6.8

  const totalRow = (label: string, t: ReturnType<typeof registerTotals>, cls: string) =>
    `<tr class="${cls}">${cols.map((c, i) => {
      if (i === 0) return `<td>${esc(label)}</td>`
      const v = columnTotal(t, c)
      if (v === null) return '<td></td>'
      return `<td class="num">${c.id === 'variancePct' ? `${v.toFixed(2)}%` : m(v)}</td>`
    }).join('')}</tr>`

  const body = groups.map(g => {
    const head = q.groupBy !== 'none'
      ? totalRow(`${g.label} · ${g.totals.rows} tour${g.totals.rows === 1 ? '' : 's'}`, g.totals, 'band')
      : ''
    const lines = g.rows.map(r => `<tr>${cols.map(c => cellHtml(r, c)).join('')}</tr>`).join('')
    return head + lines
  }).join('')

  // The bulk summary is what a payment run is actually approved from, so it is
  // printed whatever the screen was grouped by.
  const bulks = groupRegisterRows(rows, 'bulk')
  const bulkRows = bulks.map(g => `<tr>
    <td><b>${esc(g.label)}</b></td>
    <td class="num">${g.totals.rows}</td>
    <td class="num">${m(g.totals.packageCost)}</td>
    <td class="num">${m(g.totals.totalCost)}</td>
    <td class="num">${m(g.totals.advancePaid)}</td>
    <td class="num ${g.totals.advancePending > 0.009 ? 'due' : ''}">${m(g.totals.advancePending)}</td>
    <td class="num due">${m(g.totals.balancePayable)}</td>
    <td class="num">${m(g.totals.restOutstanding)}</td>
    <td class="num ${g.totals.excess < -0.009 ? 'over' : ''}">${m(g.totals.excess)}</td>
    <td class="num">${g.totals.settled}/${g.totals.rows}</td>
  </tr>`).join('')

  const unpackaged = totals.rows - totals.packaged
  const caveats: string[] = []
  if (unpackaged > 0) {
    caveats.push(`${unpackaged} tour(s) have no package cost saved on their transport settlement sheet. `
      + 'Their balance payable falls back to the costed transport total and they carry no excess or shortage.')
  }
  if (totals.noRate > 0) {
    caveats.push(`${totals.noRate} tour(s) carry no rupee rate and are shown in the currency they were costed in — `
      + 'their figures are still included in the totals above.')
  }
  if (totals.advancePending > 0.009) {
    caveats.push(`${amount(totals.advancePending)} of advance was promised and has not been handed over. `
      + 'That is owed at the start of a tour, separately from the balance payable at the end of it.')
  }
  if (totals.pending > 0) {
    caveats.push(`${totals.pending} row(s) are with the accounts team and have not been released.`)
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Driver Settlement Register</title>
<style>
  @page { size: A4 landscape; margin: 12mm 9mm 14mm; }
  * { box-sizing: border-box; }
  body { font: ${fontPt}px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; color: #12151c; margin: 0; }
  h1 { font-size: 16px; margin: 0 0 2px; letter-spacing: -0.2px; }
  .lede { font-size: 9.5px; color: #556; margin: 0 0 1px; }
  .meta { font-size: 8px; color: #889; margin: 0; }
  header { border-bottom: 2px solid #12151c; padding-bottom: 6px; margin-bottom: 8px;
           display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .kpis { display: flex; gap: 6px; margin-bottom: 8px; }
  .kpi { flex: 1; border: 1px solid #dfe3ea; border-radius: 4px; padding: 5px 7px; }
  .kpi .k { font-size: 7px; text-transform: uppercase; letter-spacing: 0.6px; color: #7a8290; }
  .kpi .v { font-size: 12px; font-weight: 700; margin-top: 1px; }
  .kpi .s { font-size: 7px; color: #8a919c; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  th { font-size: ${(fontPt - 1.6).toFixed(1)}px; text-transform: uppercase; letter-spacing: 0.4px;
       color: #6b7280; text-align: left; border-bottom: 1px solid #12151c; padding: 4px 4px; }
  th.num { text-align: right; }
  td { padding: 3.5px 4px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sub { display: block; font-size: ${(fontPt - 1.8).toFixed(1)}px; color: #8a919c; }
  .warn { color: #b45309; }
  .muted { color: #9aa0aa; }
  .due  { color: #b45309; font-weight: 700; }
  .over { color: #b91c1c; font-weight: 700; }
  .ok   { color: #15803d; }
  .st { white-space: nowrap; }
  tr.band td { background: #f2f4f8; font-weight: 700; border-top: 1px solid #ced4de;
               border-bottom: 1px solid #ced4de; }
  tr.grand td { background: #eef1f6; font-weight: 800; border-top: 1.5px solid #12151c;
                border-bottom: 1.5px solid #12151c; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  h2 { font-size: 11px; margin: 14px 0 5px; padding-top: 8px; border-top: 1px solid #ced4de; }
  .caveats { margin-top: 10px; font-size: 8px; color: #6b7280; }
  .caveats li { margin-bottom: 2px; }
  footer { margin-top: 12px; border-top: 1px solid #dfe3ea; padding-top: 5px;
           font-size: 7.5px; color: #9aa0aa; }
</style></head>
<body>
<header>
  <div>
    <h1>Driver Settlement Register · Sri Lanka</h1>
    <p class="lede">${esc(windowLabel(q))} · ${rows.length} tour${rows.length === 1 ? '' : 's'} · all figures LKR unless stated</p>
    <p class="meta">${esc(filterLine(q))}</p>
  </div>
  <div style="text-align:right">
    <p class="meta">Layout “${esc(view.name)}”</p>
    <p class="meta">Generated ${esc(now.toLocaleString('en-GB', { hour12: false }))}${generatedBy ? ` · ${esc(generatedBy)}` : ''}</p>
    <p class="meta">Figures derived by the Apple Accounts system, reproduced unchanged</p>
  </div>
</header>

<div class="kpis">
  <div class="kpi"><div class="k">Balance payable</div><div class="v">${m(totals.balancePayable)}</div>
    <div class="s">still to release ${amount(totals.restOutstanding)}</div></div>
  <div class="kpi"><div class="k">Package cost</div><div class="v">${m(totals.packageCost)}</div>
    <div class="s">${totals.packaged} of ${totals.rows} tours agreed</div></div>
  <div class="kpi"><div class="k">Total transport cost</div><div class="v">${m(totals.totalCost)}</div></div>
  <div class="kpi"><div class="k">Advance paid</div><div class="v">${m(totals.advancePaid)}</div>
    <div class="s">${totals.advancePending > 0.009 ? `${amount(totals.advancePending)} still pending` : 'nothing pending'}</div></div>
  <div class="kpi"><div class="k">Excess / (shortage)</div>
    <div class="v ${totals.excess < -0.009 ? 'over' : ''}">${totals.packaged === 0 ? '—' : m(totals.excess)}</div>
    <div class="s">${totals.variancePct !== null ? `${totals.variancePct.toFixed(2)}% of the package` : 'no package cost saved'}</div></div>
  <div class="kpi"><div class="k">Settled</div><div class="v">${totals.settled} / ${totals.rows}</div>
    <div class="s">${totals.pending} with accounts</div></div>
</div>

<table>
  <thead><tr>${cols.map(c => `<th class="${isNumericKind(c.kind) ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
  <tbody>
    ${body || `<tr><td colspan="${cols.length}" class="muted">No tours match these filters.</td></tr>`}
    ${rows.length ? totalRow(`TOTAL · ${totals.rows} tours · ${totals.pax} pax`, totals, 'grand') : ''}
  </tbody>
</table>

<h2>Summary by bulk</h2>
<table>
  <thead><tr>
    <th>Bulk</th><th class="num">Tours</th><th class="num">Package cost</th><th class="num">Transport cost</th>
    <th class="num">Advance paid</th><th class="num">Advance pending</th><th class="num">Balance payable</th>
    <th class="num">Still to release</th><th class="num">Excess / (shortage)</th><th class="num">Settled</th>
  </tr></thead>
  <tbody>${bulkRows || '<tr><td colspan="10" class="muted">Nothing to summarise.</td></tr>'}</tbody>
</table>

${caveats.length ? `<div class="caveats"><b>Notes</b><ul>${caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}

<footer>
  Balance payable = package cost &minus; advance paid. Excess / (shortage) = package cost &minus; total transport cost;
  a figure in brackets is an overrun on the agreed package. Advance pending is the envelope promised at the start of a
  tour and not yet handed over — it is not part of the balance payable.
  Recording a settlement here raises a request; the rest payment itself is released by the accounts team on Payable 1.0.
</footer>
</body></html>`
}

export async function buildSettlementPdf(
  rows: RegisterRow[],
  q: RegisterQuery,
  view: RegisterView,
  now = new Date(),
  generatedBy: string | null = null,
): Promise<Buffer> {
  const html = buildSettlementPdfHtml(rows, q, view, now, generatedBy)

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
        <div style="width:100%;padding:0 9mm;box-sizing:border-box;font:7px Arial,Helvetica,sans-serif;
                    color:#9aa0aa;display:flex;justify-content:space-between;">
          <span>Apple Holidays · Driver Settlement Register · ${esc(windowLabel(q))}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '6mm', right: '0', bottom: '10mm', left: '0' },
    })

    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
