/**
 * The Activity Check result as a standalone HTML document.
 *
 * This is the source of truth for the *printed* report: the PDF download is
 * this exact document rendered through headless Chromium, and the HTML
 * download is the same file handed over directly, so the two can never drift.
 * It follows the Daily Update sheet's approach for the same two reasons —
 * Chromium renders Vietnamese as written where PDFKit's Latin-1 fonts cannot,
 * and column widths, wrapping and page breaks are CSS's problem rather than
 * hand-computed offsets.
 *
 * Self-contained: no external CSS, fonts or images, so it survives being
 * forwarded as a mail attachment and opened offline.
 */

import { resolveRange, type ActivityCheckQuery, type ActivityRow } from '@/lib/activity-check'
import { resolveColumns, whenLabel, type ColumnKey } from '@/lib/activity-check-columns'
import { summarise } from '@/lib/activity-check-stats'
import { describeSearch } from '@/lib/activity-check-xlsx'

/** Everything interpolated is escaped — activity text is free text typed by
 *  staff and extracted from agent documents. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/**
 * Highlights the searched keywords inside a cell.
 *
 * Marking has to happen *after* escaping, or a `<mark>` inserted before it
 * would itself be escaped into visible tags. The keyword's own words are
 * matched one at a time and case-insensitively against the escaped text, which
 * is why this cannot reuse the diacritic-folding matcher: that one works on a
 * normalised string with no index correspondence to what is printed.
 */
function highlight(text: string, terms: string[]): string {
  let html = esc(text)
  if (!terms.length) return html
  const words = Array.from(new Set(
    // Strip punctuation so "Ba Na Hills," highlights as three clean words.
    // A plain character class rather than a Unicode property escape: the build
    // targets ES5, where the `u` flag is unavailable.
    terms.flatMap(t => t.split(/\s+/)).map(w => w.replace(/[^0-9A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/g, '')).filter(w => w.length >= 3),
  )).sort((a, b) => b.length - a.length)
  for (const w of words) {
    const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    html = html.replace(re, '<mark>$1</mark>')
  }
  return html
}

/** Urgency band — the same colour language as every other roster in the app. */
function whenClass(days: number): string {
  if (days < 0) return 'w-past'
  if (days === 0) return 'w-today'
  if (days <= 2) return 'w-soon'
  if (days <= 7) return 'w-week'
  return 'w-later'
}

const COUNTRY_CODES: Record<string, string> = {
  VIETNAM: 'VN', SRILANKA: 'LK', SINGAPORE: 'SG', MALAYSIA: 'MY', SINGAPORE_MALAYSIA: 'SG/MY',
}

export type HtmlOptions = {
  generatedBy?: string | null
  truncated?: boolean
  /** false for the PDF — drops the on-screen Print button from the printed copy. */
  interactive?: boolean
  /** Long free text is clipped in print; the screen copy keeps all of it. */
  maxDetail?: number
}

/**
 * A miniature bar chart of activities per day, drawn in CSS.
 *
 * Deliberately not a charting library: the report has to render inside
 * Chromium with no network, and "which days are heavy" needs bars, not axes.
 */
function dayChart(days: { date: string; label: string; weekday: string; count: number; pax: number }[]): string {
  if (days.length < 2) return ''
  const max = Math.max(...days.map(d => d.count), 1)
  const bars = days.map(d => `
    <div class="bar-col">
      <div class="bar-n">${d.count}</div>
      <div class="bar-track"><div class="bar" style="height:${Math.round((d.count / max) * 100)}%"></div></div>
      <div class="bar-lbl">${esc(d.label)}<br><span>${esc(d.weekday)}</span></div>
    </div>`).join('')
  return `<section class="block"><h2>Activities per day</h2><div class="chart">${bars}</div></section>`
}

function bucketTable(title: string, buckets: { label: string; count: number; bookings: number; pax: number }[]): string {
  if (!buckets.length) return ''
  const rows = buckets.slice(0, 12).map(b => `
    <tr><td class="b-lbl">${esc(b.label)}</td><td class="num">${b.count}</td>
        <td class="num">${b.bookings}</td><td class="num">${b.pax}</td></tr>`).join('')
  return `
    <div class="mini">
      <h3>${esc(title)}</h3>
      <table class="mini-t">
        <thead><tr><th></th><th class="num">Act.</th><th class="num">Files</th><th class="num">Pax</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

export function buildActivityCheckHtml(
  rows: ActivityRow[],
  q: ActivityCheckQuery,
  columnKeys: ColumnKey[],
  now = new Date(),
  opts: HtmlOptions = {},
): string {
  const { interactive = true, maxDetail = interactive ? 100_000 : 420 } = opts
  const columns = resolveColumns(columnKeys)
  const stats = summarise(rows, q)
  const { start, end } = resolveRange(q, now)

  const stamp = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })

  const chips = q.terms.length
    ? q.terms.map(t => {
        const hit = stats.byTerm.find(b => b.key === t)
        return `<span class="kw">${esc(t)}<b>${hit?.count ?? 0}</b></span>`
      }).join('')
    : '<span class="kw kw-all">Every activity in the window</span>'

  const headCells = columns.map(c => `<th class="${c.wide ? 'wide' : ''}">${esc(c.label)}</th>`).join('')

  const bodyRows = rows.map(r => {
    const cells = columns.map(c => {
      const raw = String(c.value(r) ?? '')
      const clipped = c.wide && raw.length > maxDetail ? `${raw.slice(0, maxDetail)}…` : raw
      // Only the text columns are worth highlighting; a date or a count that
      // happens to contain the letters of a keyword is noise, not a match.
      const inner = c.wide || c.key === 'activity' || c.key === 'location' || c.key === 'snippet'
        ? highlight(clipped, r.matchedTerms)
        : esc(clipped)
      const cls = [
        c.wide ? 'wide' : '',
        c.key === 'bookingRef' ? 'ref' : '',
        c.key === 'date' ? 'dt' : '',
        typeof c.value(r) === 'number' ? 'num' : '',
      ].filter(Boolean).join(' ')
      return `<td class="${cls}">${inner || '<span class="muted">—</span>'}</td>`
    }).join('')
    const flags = [
      r.cancelled ? 'r-cancelled' : '',
      r.source === 'ITINERARY' ? 'r-itin' : '',
    ].filter(Boolean).join(' ')
    return `<tr class="${flags}" data-when="${whenClass(r.daysAway)}">${cells}</tr>`
  }).join('')

  const termTable = stats.byTerm.length > 1 ? `
    <section class="block">
      <h2>By keyword</h2>
      <table class="mini-t wide-t">
        <thead><tr><th>Keyword</th><th class="num">Activities</th><th class="num">Files</th>
          <th class="num">Pax</th><th>First</th><th>Last</th><th class="num">Variants</th></tr></thead>
        <tbody>${stats.byTerm.map(t => `
          <tr><td class="b-lbl">${esc(t.label)}</td><td class="num">${t.count}</td>
              <td class="num">${t.bookings}</td><td class="num">${t.pax}</td>
              <td>${fmtDate(t.firstDate)}</td><td>${fmtDate(t.lastDate)}</td>
              <td class="num">${t.variants}</td></tr>`).join('')}
        </tbody>
      </table>
    </section>` : ''

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Activity Check — ${esc(q.terms.join(', ') || 'All activities')}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#f1f5f9;color:#0f172a;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif;font-size:11px}
  .page{background:#fff;margin:0 auto;padding:10mm 8mm 14mm}
  .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;
            border-bottom:3px solid #f59e0b;padding-bottom:10px;margin-bottom:12px}
  .brand{font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b45309}
  h1{font-size:19px;margin:2px 0 4px;letter-spacing:-.01em}
  .sub{font-size:10px;color:#64748b;line-height:1.6;max-width:640px}
  .stamp{text-align:right;font-size:9px;color:#94a3b8;line-height:1.6;white-space:nowrap}
  .kws{margin:10px 0 12px;display:flex;flex-wrap:wrap;gap:6px}
  .kw{background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:99px;
      padding:3px 9px;font-size:10px;font-weight:700;display:inline-flex;align-items:center;gap:6px}
  .kw b{background:#f59e0b;color:#fff;border-radius:99px;padding:0 6px;font-size:9px}
  .kw-all{background:#f1f5f9;border-color:#cbd5e1;color:#475569}
  .stats{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
  .stat{flex:1;min-width:92px;border:1px solid #e2e8f0;border-radius:8px;padding:7px 10px;background:#f8fafc}
  .stat .v{font-size:17px;font-weight:800;line-height:1.1}
  .stat .l{font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;margin-top:2px}
  .stat.warn{background:#fef2f2;border-color:#fecaca} .stat.warn .v{color:#b91c1c}
  .stat.good{background:#f0fdf4;border-color:#bbf7d0} .stat.good .v{color:#15803d}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  th{background:#1e293b;color:#fff;font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;
     padding:5px 5px;text-align:left;font-weight:700;border-right:1px solid #334155}
  td{padding:5px;border-bottom:1px solid #e2e8f0;border-right:1px solid #f1f5f9;
     vertical-align:top;font-size:9.5px;line-height:1.45;word-wrap:break-word;overflow-wrap:anywhere}
  tr:nth-child(even) td{background:#f8fafc}
  td.wide{font-size:9px;color:#334155}
  td.ref{font-family:'SF Mono',Menlo,Consolas,monospace;font-weight:700;color:#b45309;white-space:nowrap}
  td.dt{white-space:nowrap;font-weight:600}
  td.num{text-align:right;font-variant-numeric:tabular-nums}
  th.num{text-align:right}
  .muted{color:#cbd5e1}
  mark{background:#fef08a;color:#713f12;padding:0 1px;border-radius:2px}
  tr.r-cancelled td{background:#fef2f2;color:#991b1b;text-decoration:line-through}
  tr.r-itin td.ref{color:#7c3aed}
  tr[data-when="w-today"] td:first-child{box-shadow:inset 3px 0 0 #dc2626}
  tr[data-when="w-soon"] td:first-child{box-shadow:inset 3px 0 0 #f59e0b}
  tr[data-when="w-past"] td:first-child{box-shadow:inset 3px 0 0 #cbd5e1}
  .block{margin-top:16px;page-break-inside:avoid}
  h2{font-size:12px;margin:0 0 7px;padding-bottom:4px;border-bottom:2px solid #e2e8f0;
     text-transform:uppercase;letter-spacing:.07em;color:#475569}
  h3{font-size:9.5px;margin:0 0 5px;color:#64748b;text-transform:uppercase;letter-spacing:.06em}
  .grid{display:flex;flex-wrap:wrap;gap:10px}
  .mini{flex:1;min-width:210px}
  .mini-t th{background:#f1f5f9;color:#475569;border-right:1px solid #e2e8f0}
  .mini-t td{font-size:9px}
  .mini-t .b-lbl{word-break:break-word}
  .wide-t{table-layout:auto}
  .chart{display:flex;align-items:flex-end;gap:3px;height:96px;padding:4px 0;overflow:hidden}
  .bar-col{flex:1;min-width:14px;display:flex;flex-direction:column;align-items:center;height:100%}
  .bar-n{font-size:8px;color:#64748b;font-weight:700}
  .bar-track{flex:1;width:100%;display:flex;align-items:flex-end}
  .bar{width:100%;background:linear-gradient(180deg,#fbbf24,#f59e0b);border-radius:2px 2px 0 0;min-height:2px}
  .bar-lbl{font-size:7px;color:#64748b;text-align:center;margin-top:3px;line-height:1.25}
  .bar-lbl span{color:#cbd5e1}
  .foot{margin-top:18px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8}
  .empty{padding:34px;text-align:center;color:#94a3b8;border:1px dashed #cbd5e1;border-radius:10px}
  .cap{margin:8px 0;padding:6px 10px;background:#fffbeb;border:1px solid #fcd34d;border-radius:6px;
       font-size:9px;color:#92400e}
  .print{position:fixed;top:14px;right:14px;background:#f59e0b;color:#fff;border:0;border-radius:8px;
         padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.15)}
  @media print{.print{display:none}body{background:#fff}.page{padding:0}
    thead{display:table-header-group}tr{page-break-inside:avoid}}
</style></head>
<body>
${interactive ? '<button class="print" onclick="window.print()">Print / Save as PDF</button>' : ''}
<div class="page">
  <div class="masthead">
    <div>
      <div class="brand">Apple Holidays · MMT</div>
      <h1>Activity Check</h1>
      <div class="sub">${esc(describeSearch(q, now))}</div>
    </div>
    <div class="stamp">
      Generated ${esc(stamp)}${opts.generatedBy ? `<br>by ${esc(opts.generatedBy)}` : ''}
      <br>${fmtDate(start.toISOString())} → ${fmtDate(end.toISOString())}
    </div>
  </div>

  <div class="kws">${chips}</div>

  <div class="stats">
    <div class="stat"><div class="v">${stats.activities}</div><div class="l">Activities</div></div>
    <div class="stat"><div class="v">${stats.bookings}</div><div class="l">Bookings</div></div>
    <div class="stat"><div class="v">${stats.pax}</div><div class="l">Total pax</div></div>
    <div class="stat"><div class="v">${stats.byDay.length}</div><div class="l">Days covered</div></div>
    <div class="stat"><div class="v">${stats.fromAgenda}</div><div class="l">From agenda</div></div>
    <div class="stat"><div class="v">${stats.fromItinerary}</div><div class="l">From itinerary</div></div>
    <div class="stat ${stats.unassigned ? 'warn' : 'good'}"><div class="v">${stats.unassigned}</div><div class="l">No driver yet</div></div>
    <div class="stat"><div class="v">${stats.distinctAgents}</div><div class="l">Agents</div></div>
  </div>

  ${opts.truncated ? '<div class="cap">Results were capped — this report shows the first matches only. Narrow the date window or add a keyword to see everything.</div>' : ''}

  ${rows.length === 0
    ? '<div class="empty">No activity matched this search in this window.</div>'
    : `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`}

  ${dayChart(stats.byDay)}
  ${termTable}

  <section class="block">
    <h2>Breakdown</h2>
    <div class="grid">
      ${bucketTable('Top activities', stats.byActivity)}
      ${bucketTable('By location', stats.byLocation)}
      ${bucketTable('By service type', stats.byServiceType)}
      ${bucketTable('By agent', stats.byAgent)}
      ${bucketTable('By vendor', stats.byVendor)}
    </div>
  </section>

  <div class="foot">
    Apple Holidays MMT · Activity Check · read-only report generated from the live booking record.
    ${rows.length} row${rows.length === 1 ? '' : 's'} across ${stats.bookings} booking${stats.bookings === 1 ? '' : 's'}.
  </div>
</div>
</body></html>`
}
