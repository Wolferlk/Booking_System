/**
 * Shared building blocks for the report emails.
 *
 * Extracted from `report-html.ts` when the reconciliation report was added:
 * both mails go to the same inboxes, so they have to look like the same
 * product, and two copies of the palette would have drifted the first time
 * anyone touched one of them.
 *
 * Everything here is written for mail clients, not browsers: nested tables, a
 * 680px shell that degrades to full width on phones, and no flexbox, grid,
 * float or positioning — Outlook's Word renderer drops all four.
 *
 * **Why classes and not pure inline styles.** A busy day produces ~1,300 table
 * cells. Fully inline, the repeated font stack and cell rules pushed the message
 * past 370 KB — and Gmail clips anything over ~102 KB behind a "View entire
 * message" link, which would hide a section on exactly the days it matters. The
 * repetitive rules therefore live in a `<style>` block (element and class
 * selectors are the part of embedded CSS that Word *does* honour) and only
 * genuinely per-instance values — bar widths, pill colours, accent bars — stay
 * inline.
 */
import { formatReportDate } from './report-window'

// ─── Palette ──────────────────────────────────────────────────────────────────

export const C = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  wash: '#f8fafc',
  card: '#ffffff',
  brand: '#0f766e',
  brandDeep: '#134e4a',
  b2b: '#2563eb',
  b2c: '#7c3aed',
  good: '#059669',
  warn: '#d97706',
  bad: '#dc2626',
}

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/**
 * Every rule that repeats more than a handful of times. Kept deliberately terse
 * — this block is emitted once, but each class name it saves is paid for on
 * every one of the ~1,300 cells in a busy report.
 */
export const STYLE_BLOCK = `
body,table,td,th,div,span,a,p{font-family:${FONT};}
table{border-collapse:collapse;}
.sec{background:${C.card};border:1px solid ${C.line};border-radius:14px;border-collapse:separate;overflow:hidden;}
.sec-t{font-size:16px;line-height:1.3;font-weight:700;color:${C.ink};letter-spacing:-.01em;}
.sec-s{font-size:12px;line-height:1.5;color:${C.muted};padding-top:3px;}
.h3{font-size:12px;line-height:1.4;font-weight:700;color:${C.ink};padding-bottom:8px;}
.kpi{background:${C.wash};border:1px solid ${C.line};border-radius:10px;}
.kpi-l{font-size:11px;line-height:1.2;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;}
.kpi-v{font-size:26px;line-height:1.15;font-weight:800;padding-top:6px;letter-spacing:-.02em;}
.kpi-n{font-size:11px;line-height:1.4;color:${C.faint};padding-top:4px;}
.th{font-size:10px;line-height:1.4;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;padding:0 8px 7px 8px;border-bottom:1px solid ${C.line};white-space:nowrap;}
.c{font-size:12px;line-height:1.5;font-weight:400;color:${C.body};padding:9px 8px;border-bottom:1px solid ${C.wash};}
.b{font-weight:700;color:${C.ink};}
.nw{white-space:nowrap;}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;line-height:1.5;white-space:nowrap;}
.ok{background:#ecfdf5;color:#065f46;}
.wn{background:#fffbeb;color:#92400e;}
.bd{background:#fef2f2;color:#991b1b;}
.na{color:${C.faint};}
.sb{background:${C.b2b};color:#ffffff;}
.sc{background:${C.b2c};color:#ffffff;}
.note{font-size:13px;line-height:1.6;color:${C.faint};padding:14px 0;text-align:center;background:${C.wash};border-radius:8px;}
.more{font-size:11px;line-height:1.5;color:${C.faint};padding-top:10px;}
.cmp{border:1px solid ${C.line};border-radius:8px;margin-bottom:10px;}
.cmp-t{font-size:13px;line-height:1.4;font-weight:700;color:${C.ink};padding-right:8px;}
.cmp-m{font-size:11px;line-height:1.6;color:${C.faint};padding-top:4px;}
.cmp-d{font-size:12px;line-height:1.65;color:${C.body};padding-top:8px;}
.cmp-q{font-style:italic;font-size:12px;line-height:1.6;color:${C.muted};padding:8px 0 0 10px;border-left:2px solid ${C.line};margin-top:8px;}
.cmp-r{margin-top:8px;padding:8px 10px;border-radius:6px;font-size:12px;line-height:1.6;}
.cmp-rep{margin-top:8px;padding:7px 10px;border-radius:6px;font-size:11px;line-height:1.6;background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;}
.bar{border-radius:999px;height:6px;}
.foot{font-size:11px;line-height:1.7;color:${C.faint};padding-top:16px;}
`.replace(/\n+/g, '\n').trim()

// ─── Primitives ───────────────────────────────────────────────────────────────

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export function num(n: number): string {
  return n.toLocaleString('en-US')
}

export function money(n: number, currency: string): string {
  return `${esc(currency)} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function shortDate(iso: string): string {
  if (!iso) return '—'
  return formatReportDate(iso.slice(0, 10))
}

/** Date + UTC time, for the recurrence trail where the time of day matters. */
export function stamp(iso: string): string {
  if (!iso) return '—'
  return `${formatReportDate(iso.slice(0, 10))} ${iso.slice(11, 16)} UTC`
}

export function statusWord(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function truncate(s: string | null | undefined, n: number): string {
  const v = (s ?? '').trim()
  if (!v) return '—'
  return esc(v.length > n ? `${v.slice(0, n - 1)}…` : v)
}

export function pill(text: string, color: string, bg: string): string {
  return `<span class="pill" style="background:${bg};color:${color};">${esc(text)}</span>`
}

/** Percentage-of-total bar used in the country breakdowns. */
export function bar(value: number, max: number, color: string): string {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bar" style="background:${C.line};"><tr><td width="${pct}%" class="bar" style="background:${color};line-height:6px;font-size:0;">&nbsp;</td><td>&nbsp;</td></tr></table>`
}

/** Trend chip comparing this window with the one before it. */
export function trend(current: number, previous: number): string {
  if (previous === 0 && current === 0) return pill('no change', C.muted, C.wash)
  if (previous === 0) return pill(`new`, '#ffffff', C.good)
  const delta = Math.round(((current - previous) / previous) * 100)
  if (delta === 0) return pill('flat vs prev', C.muted, C.wash)
  const up = delta > 0
  return pill(`${up ? '▲' : '▼'} ${Math.abs(delta)}% vs prev`, up ? C.good : C.bad, up ? '#ecfdf5' : '#fef2f2')
}

// ─── Layout blocks ────────────────────────────────────────────────────────────

export function section(title: string, subtitle: string, accent: string, body: string): string {
  return `
  <tr><td style="padding:0 0 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sec">
      <tr><td style="height:4px;background:${accent};line-height:4px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:18px 20px 6px 20px;">
        <div class="sec-t">${esc(title)}</div>
        <div class="sec-s">${esc(subtitle)}</div>
      </td></tr>
      <tr><td style="padding:12px 20px 20px 20px;">${body}</td></tr>
    </table>
  </td></tr>`
}

/** A row of KPI tiles. Uses a table so Outlook keeps them side by side. */
export function kpiRow(tiles: { label: string; value: string; note?: string; color?: string }[]): string {
  if (!tiles.length) return ''
  const cells = tiles.map(t => `
    <td width="${Math.floor(100 / tiles.length)}%" valign="top" style="padding:0 5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kpi">
        <tr><td style="padding:12px 12px 11px 12px;">
          <div class="kpi-l">${esc(t.label)}</div>
          <div class="kpi-v" style="color:${t.color ?? C.ink};">${t.value}</div>
          <div class="kpi-n">${t.note ?? '&nbsp;'}</div>
        </td></tr>
      </table>
    </td>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -5px 14px -5px;"><tr>${cells}</tr></table>`
}

export function tableOpen(headers: { text: string; align?: string; width?: string }[]): string {
  const th = headers.map(h => `<th align="${h.align ?? 'left'}"${h.width ? ` width="${h.width}"` : ''} class="th">${esc(h.text)}</th>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><thead><tr>${th}</tr></thead><tbody>`
}

export const TABLE_CLOSE = '</tbody></table>'

export function td(content: string, opts: { align?: string; bold?: boolean; color?: string; nowrap?: boolean } = {}): string {
  const cls = `c${opts.bold ? ' b' : ''}${opts.nowrap ? ' nw' : ''}`
  // Only a colour that differs from the class default is worth an inline style.
  const colour = opts.color && opts.color !== (opts.bold ? C.ink : C.body) ? ` style="color:${opts.color};"` : ''
  return `<td align="${opts.align ?? 'left'}" class="${cls}"${colour}>${content}</td>`
}

export function emptyNote(text: string): string {
  return `<div class="note">${esc(text)}</div>`
}

export function moreNote(shown: number, total: number, what: string): string {
  if (total <= shown) return ''
  return `<div class="more">Showing the first ${num(shown)} of ${num(total)} ${esc(what)} — the attached CSV and the dashboard carry the full list.</div>`
}

/**
 * Strip the indentation the templates are written with.
 *
 * Only whitespace that spans a newline *between two tags* is removed, so a
 * deliberate single space written inline (`</span> <span>`) survives — losing
 * those would run words together in the rendered mail.
 */
export function compact(html: string): string {
  return html.replace(/>\s*\n\s*</g, '><')
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One labelled block of rows inside a multi-block CSV attachment. */
export function csvBlock(rows: string[], title: string, header: string[], lines: unknown[][]): void {
  rows.push(`# ${title}`)
  rows.push(header.map(csvCell).join(','))
  for (const l of lines) rows.push(l.map(csvCell).join(','))
  rows.push('')
}
