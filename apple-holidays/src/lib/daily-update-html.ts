/**
 * The Daily Update sheet as a standalone HTML document.
 *
 * This is the source of truth for the *printed* sheet: the PDF download is
 * this exact document rendered through headless Chromium, and the HTML
 * download is the same file handed over directly. Building it once means the
 * two can never drift, and it buys two things the previous PDFKit table could
 * not have:
 *
 *  - Real Unicode. PDFKit's standard fonts are Latin-1, so Vietnamese and
 *    Sinhala guest names had to be transliterated down to ASCII before they
 *    could be drawn. Chromium renders them as written.
 *  - Real layout. Column widths, wrapping and page breaks are CSS's problem
 *    rather than hand-computed x-offsets, so a long agent name reflows instead
 *    of being clipped.
 *
 * The document is deliberately self-contained — no external CSS, fonts or
 * images — so the HTML download works from a mail attachment with no network.
 */

import {
  DATE_FIELD_LABELS, SOURCE_LABELS, summarise, resolveRange,
  type DailyUpdateQuery, type DailyUpdateRow,
} from '@/lib/daily-update'
import { CALL_KINDS, CALL_LABELS, type CallCell } from '@/lib/daily-update-calls'
import {
  FEEDBACK_RATING_FIELDS, FEEDBACK_RATING_LABELS, worstRating,
  type FeedbackFormCell,
} from '@/lib/daily-update-feedback'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : '—'

/** Everything interpolated into the document is escaped — guest and agent
 *  names are free text typed by staff and arriving from extracted documents. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const or = (value: unknown, fallback = '—') => {
  const s = String(value ?? '').trim()
  return s ? esc(s) : fallback
}

/** "13 Aug 26 00:30" — the audit column's form, short enough not to wrap. */
const fmtStamp = (iso: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  const month = d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)
  return `${pad(d.getDate())} ${month} ${String(d.getFullYear()).slice(2)}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function whenLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'landed yesterday'
  return `landed ${Math.abs(days)}d ago`
}

/** Urgency band — the whole point of the sheet is that today shouts. */
function whenClass(days: number): string {
  if (days < 0) return 'w-ground'
  if (days === 0) return 'w-today'
  if (days <= 2) return 'w-soon'
  if (days <= 5) return 'w-week'
  return 'w-later'
}

/**
 * Country as a two-letter chip rather than a flag emoji.
 *
 * Headless Chromium has no colour-emoji font on a server, so regional-indicator
 * flags print as blank boxes or monochrome fragments — which is exactly where
 * the PDF is generated. A text chip renders identically everywhere.
 */
const COUNTRY_CODES: Record<string, string> = {
  VIETNAM: 'VN', SRILANKA: 'LK', SINGAPORE: 'SG', MALAYSIA: 'MY',
  SINGAPORE_MALAYSIA: 'SG/MY',
}

function countryChip(country: string | null): string {
  const code = COUNTRY_CODES[country ?? '']
  return code ? `<span class="cc">${code}</span>` : ''
}

function contactBlock(phone: string | null, whatsapp: string | null, email: string | null): string {
  const parts: string[] = []
  if (phone) parts.push(`<span class="c-line"><b>T</b>${esc(phone)}</span>`)
  if (whatsapp && whatsapp !== phone) parts.push(`<span class="c-line c-wa"><b>W</b>${esc(whatsapp)}</span>`)
  if (email) parts.push(`<span class="c-line c-mail"><b>@</b>${esc(email)}</span>`)
  return parts.length ? parts.join('') : '<span class="muted">—</span>'
}

/** A blank IS or CNTL is the sheet's action item, so it is flagged, not empty. */
function idCell(value: string | null): string {
  return value
    ? `<span class="id">${esc(value)}</span>`
    : '<span class="id-missing">missing</span>'
}

/**
 * A call column, printed.
 *
 * Deliberately terser than the screen: the sheet carries fourteen columns on a
 * landscape page, so a printed call cell is a tick, when it happened, how many
 * there were, and one clamped line of what came of it. The full history stays
 * on screen where it can be opened.
 */
function callCellHtml(cell: CallCell): string {
  if (cell.count === 0) return '<span class="call-no">—</span>'
  const latest = cell.latest!
  const stamp = new Date(latest.at).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `
    <div class="call-yes">
      <span class="call-tick">✓</span>
      <span class="call-at">${esc(stamp)}</span>
      ${cell.count > 1 ? `<span class="call-n">×${cell.count}</span>` : ''}
      ${latest.source === 'AI' ? '<span class="call-ai">AI</span>' : ''}
    </div>
    <div class="call-sum">${esc(latest.summary)}</div>`
}

/**
 * The digital feedback form, printed.
 *
 * Ratings first and words second: on paper the useful signal is which section
 * came back weak, so the overall badge leads and any section that is not
 * Excellent is listed under it. A form that was sent and never answered says so
 * — that is a chase, and an empty cell would hide it.
 */
function feedbackCellHtml(cell: FeedbackFormCell): string {
  if (!cell.form) {
    return cell.sentAt
      ? `<div class="ff-wait">Sent ${fmtStamp(cell.sentAt)} · awaiting reply</div>`
      : '<span class="call-no">—</span>'
  }
  const f = cell.form
  const weak = FEEDBACK_RATING_FIELDS
    .map(({ key, label }) => ({ label, value: f.ratings[key] }))
    .filter(x => x.value && x.value !== 'EXCELLENT')
    .map(x => `${esc(x.label.replace(/^.*— /, ''))}: ${esc(FEEDBACK_RATING_LABELS[x.value!] ?? x.value!)}`)

  const overall = f.overall ? (FEEDBACK_RATING_LABELS[f.overall] ?? f.overall) : 'Submitted'
  return `
    <div class="ff-head">
      <span class="ff-badge ff-${esc((worstRating(f) ?? 'GOOD').toLowerCase())}">${esc(overall)}</span>
      <span class="call-at">${esc(fmtStamp(f.submittedAt))}</span>
    </div>
    ${weak.length ? `<div class="call-sum">${weak.join(' · ')}</div>` : ''}
    ${f.remarks ? `<div class="call-sum">${esc(f.remarks)}</div>` : ''}`
}

function rowHtml(r: DailyUpdateRow, index: number): string {
  const badges = [
    r.cancelled   ? '<span class="tag t-cancel">Cancelled</span>' : '',
    r.createdToday && !r.cancelled ? '<span class="tag t-new">New today</span>' : '',
    r.amended && !r.createdToday   ? '<span class="tag t-amend">Amended</span>' : '',
    r.hotelOnly   ? '<span class="tag t-hotel">Hotel only</span>' : '',
  ].join('')

  return `
  <tr class="${r.cancelled ? 'is-cancelled' : r.createdToday ? 'is-new' : ''}">
    <td class="c-idx"><span class="accent ${whenClass(r.daysToArrival)}${r.cancelled ? ' w-cancel' : ''}"></span>${index}</td>
    <td>
      <div class="ref">${esc(r.bookingRef)}</div>
      <div class="sub">${countryChip(r.operationCountry)}${or(String(r.status).replace(/_/g, ' '), '')}</div>
      <div class="tags">${badges}</div>
    </td>
    <td>${idCell(r.isNumber)}</td>
    <td>
      ${idCell(r.cntlNumber)}
      ${r.agentBookingId ? `<div class="sub">ID ${esc(r.agentBookingId)}</div>` : ''}
    </td>
    <td class="c-travel">
      <div class="dates"><b>${fmtDate(r.arrivalDate)}</b> <span class="arrow">→</span> ${fmtDate(r.departureDate)}</div>
      <div class="sub">${r.nights}N · ${r.totalPax} pax (${r.paxAdults}A/${r.paxChildren}C/${r.paxInfants}I)</div>
      <div><span class="when ${whenClass(r.daysToArrival)}">${whenLabel(r.daysToArrival)}</span></div>
    </td>
    <td>
      <div class="name">${or(r.guestName)}</div>
      ${r.fileHandler ? `<div class="sub">Handler: ${esc(r.fileHandler)}</div>` : ''}
    </td>
    <td class="c-contact">${contactBlock(r.guestPhone, r.guestWhatsapp, r.guestEmail)}</td>
    <td><div class="name">${or(r.agent)}</div></td>
    <td class="c-contact">${contactBlock(r.agentPhone, r.agentWhatsapp, r.agentEmail)}</td>
    ${CALL_KINDS.map(kind => `<td class="c-call">${callCellHtml(r.calls[kind])}</td>`).join('')}
    <td class="c-call c-ff">${feedbackCellHtml(r.feedbackForm)}</td>
    <td class="c-audit">
      <div class="sub"><span class="lbl">Created</span>${fmtStamp(r.createdAt)}</div>
      <div class="sub ${r.amended ? 'upd' : ''}"><span class="lbl">Updated</span>${fmtStamp(r.updatedAt)}</div>
    </td>
  </tr>`
}

const HEAD_ROW: string = `
  <tr>
    <th class="c-idx">#</th>
    <th>Booking</th>
    <th>IS number</th>
    <th>CNTL number</th>
    <th>Travel dates</th>
    <th>Guest</th>
    <th>Guest contact</th>
    <th>Agent</th>
    <th>Agent contact</th>
    ${CALL_KINDS.map(kind => `<th class="c-call">${CALL_LABELS[kind]}</th>`).join('')}
    <th class="c-call c-ff">Feedback Form</th>
    <th>Created / Updated</th>
  </tr>`

export type HtmlOptions = {
  /** Shown in the masthead so a forwarded copy says who ran it. */
  generatedBy?: string | null
  /** Screen copy gets a print button; the PDF render does not. */
  interactive?: boolean
  /** True scope-wide count of bookings sold today, for the headline. */
  bookedToday?: number
}

export function buildDailyUpdateHtml(
  rows: DailyUpdateRow[],
  q: DailyUpdateQuery,
  now = new Date(),
  opts: HtmlOptions = {},
): string {
  const stats = summarise(rows, opts.bookedToday)
  const { start, end } = resolveRange(q, now)

  // One band, one continuous numbering: the sheet is the date window and
  // nothing else, so a row's number means the same thing on screen, in the
  // workbook and here.
  let n = 0
  const rowsHtml = rows.map(r => rowHtml(r, ++n)).join('')

  const band = (title: string, cls: string, count: number) => `
    <tr class="band ${cls}">
      <td colspan="14">${esc(title)} <span class="band-count">${count}</span></td>
    </tr>`

  const kpi = (label: string, value: number, cls: string) => `
    <div class="kpi ${cls}">
      <div class="kpi-v">${value}</div>
      <div class="kpi-l">${esc(label)}</div>
    </div>`

  const filterBits = [
    `Channel: ${SOURCE_LABELS[q.source]}`,
    `Agent: ${q.agent || 'All'}`,
    `Country: ${q.country ? q.country.replace('_', ' & ') : 'as permitted'}`,
    q.search ? `Search: "${q.search}"` : 'Search: none',
    `Cancelled: ${q.includeCancelled ? 'included' : 'excluded'}`,
  ].join(' &nbsp;·&nbsp; ')

  const body = rows.length === 0
    ? '<tr><td colspan="14" class="empty">No bookings match the current filters.</td></tr>'
    : band(
        `${DATE_FIELD_LABELS[q.dateField]} — ${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}`,
        'band-win', rows.length,
      ) + rowsHtml

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Daily Update Sheet — ${fmtDate(now.toISOString())}</title>
<style>
  /* Landscape: the sheet is ten columns wide and is read across, not down. */
  @page { size: A4 landscape; margin: 9mm 8mm 12mm; }

  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
    color: #0f172a;
    background: #f1f5f9;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page { max-width: 1600px; margin: 0 auto; background: #fff; }

  /* ── Masthead ─────────────────────────────────────────────────────────── */
  .masthead {
    background: linear-gradient(115deg, #0f172a 0%, #1e293b 55%, #334155 100%);
    color: #fff; padding: 18px 22px 16px; position: relative; overflow: hidden;
  }
  .masthead::after {
    content: ''; position: absolute; inset: auto 0 0 0; height: 3px;
    background: linear-gradient(90deg, #f59e0b, #ef4444, #8b5cf6, #06b6d4);
  }
  .mast-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 21px; font-weight: 800; letter-spacing: -0.4px; }
  .mast-sub { margin-top: 4px; font-size: 11px; color: #cbd5e1; }
  .mast-meta { margin-top: 2px; font-size: 10px; color: #94a3b8; }

  .kpis { display: flex; gap: 8px; flex-wrap: wrap; }
  .kpi {
    min-width: 88px; padding: 8px 12px; border-radius: 10px;
    background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12);
    text-align: right;
  }
  .kpi-v { font-size: 20px; font-weight: 800; line-height: 1; }
  .kpi-l { font-size: 8px; letter-spacing: .09em; text-transform: uppercase; color: #94a3b8; margin-top: 4px; }
  .k-new .kpi-v { color: #4ade80; }
  .k-arr .kpi-v { color: #f87171; }
  .k-miss .kpi-v { color: #fbbf24; }

  .filters {
    padding: 6px 22px; font-size: 9.5px; color: #64748b;
    background: #f8fafc; border-bottom: 1px solid #e2e8f0;
  }

  /* ── Table ────────────────────────────────────────────────────────────── */
  table { width: 100%; border-collapse: collapse; }
  thead th {
    background: #1e293b; color: #cbd5e1;
    font-size: 8px; letter-spacing: .07em; text-transform: uppercase;
    text-align: left; padding: 7px 6px; font-weight: 700;
    border-bottom: 2px solid #0f172a;
  }
  /* Repeat the header on every printed page — a loose sheet must be readable. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  tbody td {
    padding: 4px 6px; font-size: 9px; line-height: 1.35; vertical-align: top;
    border-bottom: 1px solid #f1f5f9;
  }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  tbody tr.is-new td      { background: #f0fdf4; }
  tbody tr.is-cancelled td { background: #fef2f2; }

  .c-idx { width: 24px; color: #94a3b8; position: relative; padding-left: 9px !important; }
  .accent { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 0 2px 2px 0; }
  .w-ground { background: #06b6d4; } .w-today { background: #ef4444; }
  .w-soon   { background: #f97316; } .w-week  { background: #eab308; }
  .w-later  { background: #cbd5e1; } .w-cancel { background: #dc2626; }

  .ref { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 10px; font-weight: 700; }
  .is-cancelled .ref { color: #991b1b; text-decoration: line-through; }
  .sub { font-size: 7.5px; color: #94a3b8; margin-top: 1px; }
  .cc {
    display: inline-block; margin-right: 4px; padding: 0 3px; border-radius: 3px;
    background: #e2e8f0; color: #475569; font-size: 6.5px; font-weight: 800; letter-spacing: .03em;
  }
  .lbl { display: block; color: #cbd5e1; font-weight: 700; text-transform: uppercase; font-size: 6px; }
  .c-audit .sub { white-space: nowrap; }
  .upd { color: #7c3aed; }
  .name { font-size: 9.5px; font-weight: 600; }
  .muted { color: #cbd5e1; }

  .tags { margin-top: 2px; }
  .tag {
    display: inline-block; margin: 1px 2px 0 0; padding: 1px 4px; border-radius: 3px;
    font-size: 6.5px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em;
  }
  .t-new    { background: #dcfce7; color: #15803d; }
  .t-amend  { background: #ede9fe; color: #6d28d9; }
  .t-hotel  { background: #e0f2fe; color: #0369a1; }
  .t-cancel { background: #fee2e2; color: #b91c1c; }

  .id { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9px; font-weight: 700; color: #1e293b; }
  .id-missing {
    display: inline-block; padding: 1px 5px; border: 1px dashed #f59e0b; border-radius: 4px;
    background: #fffbeb; color: #b45309; font-size: 7.5px; font-weight: 700; font-style: italic;
  }

  .c-travel { width: 116px; }
  .dates { font-size: 9px; white-space: nowrap; }
  .arrow { color: #cbd5e1; }
  .when {
    display: inline-block; margin-top: 2px; padding: 1px 5px; border-radius: 999px;
    font-size: 7px; font-weight: 800; color: #fff;
  }
  .when.w-later { color: #475569; background: #e2e8f0; }

  .c-contact { width: 104px; }
  .c-line {
    display: block; font-size: 8px; line-height: 1.45;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .c-line b { display: inline-block; width: 9px; color: #cbd5e1; font-weight: 800; }
  .c-wa   { color: #059669; }
  .c-mail { color: #64748b; }
  .c-audit { width: 92px; }

  .c-call { width: 92px; }
  .call-no { color: #cbd5e1; }
  .call-yes { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  .call-tick {
    display: inline-flex; align-items: center; justify-content: center;
    width: 9px; height: 9px; border-radius: 50%;
    background: #16a34a; color: #fff; font-size: 6px; line-height: 1;
  }
  .call-at { font-size: 7.5px; font-weight: 700; color: #334155; }
  .call-n  { background: #1e293b; color: #fff; border-radius: 999px; padding: 0 3px; font-size: 6.5px; font-weight: 800; }
  .call-ai { background: #ede9fe; color: #6d28d9; border-radius: 3px; padding: 0 3px; font-size: 6.5px; font-weight: 800; }
  .call-sum {
    margin-top: 1px; font-size: 7px; line-height: 1.3; color: #64748b;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  .c-ff { width: 104px; }
  .ff-head { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  .ff-badge {
    border-radius: 3px; padding: 0 3px; font-size: 6.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: .04em;
  }
  .ff-excellent { background: #dcfce7; color: #15803d; }
  .ff-good      { background: #e0f2fe; color: #0369a1; }
  .ff-average   { background: #fef3c7; color: #b45309; }
  .ff-poor      { background: #ffe4e6; color: #be123c; }
  .ff-wait      { font-size: 7px; font-weight: 700; color: #b45309; }

  /* ── Section bands ────────────────────────────────────────────────────── */
  tr.band td {
    padding: 5px 8px; font-size: 8.5px; font-weight: 800;
    text-transform: uppercase; letter-spacing: .11em; color: #fff;
  }
  .band-new td { background: linear-gradient(90deg, #16a34a, #4ade80); }
  .band-win td { background: linear-gradient(90deg, #334155, #64748b); }
  .band-count {
    background: rgba(255,255,255,.25); padding: 0 5px; border-radius: 999px;
    margin-left: 6px; font-size: 8px;
  }

  .empty { padding: 44px; text-align: center; color: #94a3b8; font-size: 12px; }

  footer {
    padding: 8px 22px; font-size: 8px; color: #94a3b8;
    background: #f8fafc; border-top: 1px solid #e2e8f0;
  }

  .print-bar { padding: 10px 22px; background: #0f172a; text-align: right; }
  .print-bar button {
    background: #f59e0b; color: #0f172a; border: 0; border-radius: 8px;
    padding: 8px 16px; font-size: 12px; font-weight: 700; cursor: pointer;
  }
  @media print { .print-bar { display: none; } body { background: #fff; } }
</style>
</head>
<body>
<div class="page">
  <div class="masthead">
    <div class="mast-top">
      <div>
        <h1>Daily Update Sheet</h1>
        <div class="mast-sub">
          ${esc(DATE_FIELD_LABELS[q.dateField])} · ${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}
        </div>
        <div class="mast-meta">
          Apple Holidays MMT · generated ${fmtDateTime(now.toISOString())}${
            opts.generatedBy ? ` by ${esc(opts.generatedBy)}` : ''}
        </div>
      </div>
      <div class="kpis">
        ${kpi('Bookings', stats.total, '')}
        ${kpi('Booked today', stats.bookedToday, 'k-new')}
        ${kpi('Arriving today', stats.arrivingToday, 'k-arr')}
        ${kpi('On the ground', stats.onGround, '')}
        ${kpi('Total pax', stats.totalPax, '')}
        ${kpi('Missing IDs', stats.missingIds, 'k-miss')}
      </div>
    </div>
  </div>

  <div class="filters">${filterBits}</div>
  ${opts.interactive ? '<div class="print-bar"><button onclick="window.print()">Print / Save as PDF</button></div>' : ''}

  <table>
    <thead>${HEAD_ROW}</thead>
    <tbody>${body}</tbody>
  </table>

  <footer>
    Apple Holidays MMT — internal operations sheet. Contains guest and agent contact data; do not forward outside the company.
  </footer>
</div>
</body>
</html>`
}
