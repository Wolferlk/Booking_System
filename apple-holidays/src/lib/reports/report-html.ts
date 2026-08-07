/**
 * The report email itself.
 *
 * Written for mail clients, not browsers: nested tables, a 680px shell that
 * degrades to full width on phones, and no flexbox, grid, float or positioning
 * — Outlook's Word renderer drops all four. The palette matches the ops
 * dashboard so the mail reads as part of the product rather than a machine dump.
 *
 * **Why classes and not pure inline styles.** A busy day produces ~1,300 table
 * cells. Fully inline, the repeated font stack and cell rules pushed the message
 * past 370 KB — and Gmail clips anything over ~102 KB behind a "View entire
 * message" link, which would hide the complaints section on exactly the days it
 * matters. The repetitive rules therefore live in a `<style>` block (element and
 * class selectors are the part of embedded CSS that Word *does* honour) and only
 * genuinely per-instance values — bar widths, pill colours, accent bars — stay
 * inline.
 */
import {
  formatReportDate, PERIOD_LABEL, type ReportWindow,
} from './report-window'
import type {
  BookingLine, ComplaintLine, CountryRow, ReadinessLine, ReportData, TourLine,
} from './report-data'
import type { ReadinessCheck } from '@/lib/booking-readiness'

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
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

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/**
 * Every rule that repeats more than a handful of times. Kept deliberately terse
 * — this block is emitted once, but each class name it saves is paid for on
 * every one of the ~1,300 cells in a busy report.
 */
const STYLE_BLOCK = `
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
.bar{border-radius:999px;height:6px;}
.foot{font-size:11px;line-height:1.7;color:${C.faint};padding-top:16px;}
`.replace(/\n+/g, '\n').trim()

// ─── Primitives ───────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function num(n: number): string {
  return n.toLocaleString('en-US')
}

function money(n: number, currency: string): string {
  return `${esc(currency)} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function shortDate(iso: string): string {
  if (!iso) return '—'
  return formatReportDate(iso.slice(0, 10))
}

function statusWord(s: string): string {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function truncate(s: string | null | undefined, n: number): string {
  const v = (s ?? '').trim()
  if (!v) return '—'
  return esc(v.length > n ? `${v.slice(0, n - 1)}…` : v)
}

function pill(text: string, color: string, bg: string): string {
  return `<span class="pill" style="background:${bg};color:${color};">${esc(text)}</span>`
}

const SEVERITY_PILL: Record<string, string> = {
  high: pill('HIGH', '#ffffff', C.bad),
  medium: pill('MEDIUM', '#ffffff', C.warn),
  low: pill('LOW', '#ffffff', C.faint),
}

/** Classed, not inline: this one renders on every booking row in three tables. */
function sourcePill(source: string): string {
  return source === 'B2C'
    ? '<span class="pill sc">B2C</span>'
    : '<span class="pill sb">B2B</span>'
}

/** Percentage-of-total bar used in the country breakdowns. */
function bar(value: number, max: number, color: string): string {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="bar" style="background:${C.line};"><tr><td width="${pct}%" class="bar" style="background:${color};line-height:6px;font-size:0;">&nbsp;</td><td>&nbsp;</td></tr></table>`
}

/** Trend chip comparing this window with the one before it. */
function trend(current: number, previous: number): string {
  if (previous === 0 && current === 0) return pill('no change', C.muted, C.wash)
  if (previous === 0) return pill(`new`, '#ffffff', C.good)
  const delta = Math.round(((current - previous) / previous) * 100)
  if (delta === 0) return pill('flat vs prev', C.muted, C.wash)
  const up = delta > 0
  return pill(`${up ? '▲' : '▼'} ${Math.abs(delta)}% vs prev`, up ? C.good : C.bad, up ? '#ecfdf5' : '#fef2f2')
}

// ─── Layout blocks ────────────────────────────────────────────────────────────

function section(title: string, subtitle: string, accent: string, body: string): string {
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
function kpiRow(tiles: { label: string; value: string; note?: string; color?: string }[]): string {
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

function tableOpen(headers: { text: string; align?: string; width?: string }[]): string {
  const th = headers.map(h => `<th align="${h.align ?? 'left'}"${h.width ? ` width="${h.width}"` : ''} class="th">${esc(h.text)}</th>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><thead><tr>${th}</tr></thead><tbody>`
}

const TABLE_CLOSE = '</tbody></table>'

function td(content: string, opts: { align?: string; bold?: boolean; color?: string; nowrap?: boolean } = {}): string {
  const cls = `c${opts.bold ? ' b' : ''}${opts.nowrap ? ' nw' : ''}`
  // Only a colour that differs from the class default is worth an inline style.
  const colour = opts.color && opts.color !== (opts.bold ? C.ink : C.body) ? ` style="color:${opts.color};"` : ''
  return `<td align="${opts.align ?? 'left'}" class="${cls}"${colour}>${content}</td>`
}

function emptyNote(text: string): string {
  return `<div class="note">${esc(text)}</div>`
}

function moreNote(shown: number, total: number, what: string): string {
  if (total <= shown) return ''
  return `<div class="more">Showing the first ${num(shown)} of ${num(total)} ${esc(what)} — the attached CSV and the dashboard carry the full list.</div>`
}

// ─── Country breakdown table ──────────────────────────────────────────────────

function countryTable(rows: CountryRow[], opts: { showPax?: boolean; showChannel?: boolean } = {}): string {
  if (!rows.length) return emptyNote('No country activity in this period.')
  const max = Math.max(...rows.map(r => r.bookings))
  const showPax = opts.showPax !== false
  const showChannel = opts.showChannel !== false

  const headers = [
    { text: 'Country' },
    { text: 'Bookings', align: 'right', width: '70' },
    ...(showChannel ? [{ text: 'B2B', align: 'right', width: '45' }, { text: 'B2C', align: 'right', width: '45' }] : []),
    ...(showPax ? [{ text: 'Pax', align: 'right', width: '55' }] : []),
    { text: 'Share', width: '110' },
  ]

  const body = rows.map(r => `<tr>
    ${td(esc(r.label), { bold: true, color: C.ink })}
    ${td(num(r.bookings), { align: 'right', bold: true, color: C.ink })}
    ${showChannel ? td(num(r.b2b), { align: 'right', color: C.b2b }) : ''}
    ${showChannel ? td(num(r.b2c), { align: 'right', color: C.b2c }) : ''}
    ${showPax ? td(num(r.pax), { align: 'right' }) : ''}
    ${td(bar(r.bookings, max, C.brand))}
  </tr>`).join('')

  return tableOpen(headers) + body + TABLE_CLOSE
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function createdSection(d: ReportData): string {
  const c = d.created
  const currencyNote = c.byCurrency.length
    ? c.byCurrency.slice(0, 3).map(x => money(x.total, x.currency)).join(' · ')
    : 'No quoted value recorded'

  const kpis = kpiRow([
    { label: 'New bookings', value: num(c.total), note: trend(c.total, c.previousTotal) },
    { label: 'B2B', value: num(c.channel.b2b), note: `${c.total ? Math.round((c.channel.b2b / c.total) * 100) : 0}% of intake`, color: C.b2b },
    { label: 'B2C', value: num(c.channel.b2c), note: `${c.total ? Math.round((c.channel.b2c / c.total) * 100) : 0}% of intake`, color: C.b2c },
    { label: 'Pax booked', value: num(c.pax) },
  ])

  const value = `<div style="font:400 12px/1.6 ${FONT};color:${C.muted};padding:0 0 14px 0;"><strong style="color:${C.ink};">Quoted value</strong> &nbsp;${currencyNote}</div>`

  const list = c.bookings.length
    ? tableOpen([
        { text: 'Ref' }, { text: 'Src', width: '46' }, { text: 'Country' },
        { text: 'Agent' }, { text: 'Travel dates' }, { text: 'Pax', align: 'right', width: '45' },
        { text: 'Value', align: 'right' },
      ]) + c.bookings.map(b => `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>`, { nowrap: true })}
        ${td(sourcePill(b.source), { nowrap: true })}
        ${td(esc(b.countryLabel), { nowrap: true })}
        ${td(truncate(b.agent, 26))}
        ${td(`${shortDate(b.arrivalDate)} → ${shortDate(b.departureDate)}`, { nowrap: true })}
        ${td(num(b.pax), { align: 'right' })}
        ${td(b.quotedTotal !== null ? money(b.quotedTotal, b.currency) : '—', { align: 'right', nowrap: true })}
      </tr>`).join('') + TABLE_CLOSE + moreNote(c.bookings.length, c.total, 'bookings')
    : emptyNote('No bookings were created in this period.')

  const agents = c.byAgent.length > 1
    ? `<div style="padding-top:18px;"><div class="h3">Top sources</div>` +
      tableOpen([{ text: 'Agent / channel' }, { text: 'Bookings', align: 'right', width: '70' }, { text: 'Pax', align: 'right', width: '55' }]) +
      c.byAgent.map(a => `<tr>${td(truncate(a.agent, 40))}${td(num(a.bookings), { align: 'right', bold: true, color: C.ink })}${td(num(a.pax), { align: 'right' })}</tr>`).join('') +
      TABLE_CLOSE + '</div>'
    : ''

  return section(
    'Bookings created',
    `${d.window.label} · B2B and B2C shown separately`,
    C.brand,
    kpis + value +
      `<div class="h3">Country-wise</div>${countryTable(c.byCountry)}` +
      `<div style="padding-top:18px;"><div class="h3">Booking detail</div>${list}</div>` +
      agents,
  )
}

function onGroundSection(d: ReportData): string {
  const g = d.onGround

  const kpis = kpiRow([
    { label: 'Tours on ground', value: num(g.total), color: C.brand },
    { label: 'Guests in-country', value: num(g.pax) },
    { label: 'Arriving today', value: num(g.arrivingToday), color: C.good },
    { label: 'Departing today', value: num(g.departingToday), color: C.warn },
  ])

  const list = g.tours.length
    ? tableOpen([
        { text: 'Ref' }, { text: 'Src', width: '46' }, { text: 'Country' },
        { text: 'Lead guest' }, { text: 'Day', align: 'center', width: '60' },
        { text: 'Pax', align: 'right', width: '45' }, { text: 'Status' },
      ]) + g.tours.map((t: TourLine) => {
        const arriving = t.arrivalDate === g.date
        const departing = t.departureDate === g.date
        const dayCell = arriving
          ? pill('ARRIVES', '#ffffff', C.good)
          : departing
            ? pill('DEPARTS', '#ffffff', C.warn)
            : `${t.dayNo}/${t.totalDays}`
        return `<tr>
          ${td(`<strong style="color:${C.ink};">${esc(t.bookingRef)}</strong>`, { nowrap: true })}
          ${td(sourcePill(t.source), { nowrap: true })}
          ${td(esc(t.countryLabel), { nowrap: true })}
          ${td(truncate(t.leadPassenger ?? t.destination, 24))}
          ${td(dayCell, { align: 'center', nowrap: true })}
          ${td(num(t.pax), { align: 'right' })}
          ${td(esc(statusWord(t.status)), { nowrap: true, color: C.muted })}
        </tr>`
      }).join('') + TABLE_CLOSE + moreNote(g.tours.length, g.total, 'tours')
    : emptyNote('No tours are on the ground today.')

  return section(
    'On ground today',
    `${formatReportDate(g.date, { weekday: true })} · live tours by country`,
    C.b2b,
    kpis +
      `<div class="h3">Country-wise</div>${countryTable(g.byCountry)}` +
      `<div style="padding-top:18px;"><div class="h3">Tour detail</div>${list}</div>`,
  )
}

/**
 * One checklist cell. Green when done, amber part-done, red outstanding, grey
 * when the check does not apply — every cell also carries the words, so colour
 * is never the only signal.
 *
 * Classed rather than inline-styled: this cell is emitted four times per row and
 * the inline palette alone cost ~7 KB on a busy day, which is real money against
 * Gmail's ~102 KB clipping threshold (see the note at the top of this file).
 */
function checkCell(c: ReadinessCheck): string {
  const cls = c.state === 'DONE' ? 'ok' : c.state === 'PARTIAL' ? 'wn' : 'bd'
  if (c.state === 'NA') return `<span class="na">${esc(c.short === 'None' ? 'None' : '—')}</span>`
  return `<span class="pill ${cls}">${esc(c.short === 'Confirmed' ? 'DONE' : c.short)}</span>`
}

function readinessSection(d: ReportData): string {
  const r = d.readiness

  const kpis = kpiRow([
    { label: 'Arriving in 3 days', value: num(r.total), note: `${num(r.pax)} guests`, color: C.brand },
    { label: 'Tomorrow', value: num(r.tomorrow), note: r.tomorrowNotReady ? `${num(r.tomorrowNotReady)} not ready` : 'all ready', color: r.tomorrowNotReady ? C.bad : C.good },
    { label: 'Fully ready', value: num(r.ready), color: C.good },
    { label: 'Needs action', value: num(r.notReady), color: r.notReady ? C.bad : C.ink },
  ])

  const banner = r.tomorrowNotReady
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#991b1b;">
         ${num(r.tomorrowNotReady)} tour${r.tomorrowNotReady === 1 ? '' : 's'} arriving tomorrow ${r.tomorrowNotReady === 1 ? 'is' : 'are'} not fully ready — clear ${r.tomorrowNotReady === 1 ? 'it' : 'them'} first.
       </div>`
    : ''

  // What is outstanding, counted per check — tells the desk which queue to work.
  const gaps: { label: string; count: number }[] = [
    { label: 'Client confirmation', count: r.pendingClient },
    { label: 'Driver allocation', count: r.pendingDriver },
    { label: 'Tickets', count: r.pendingTickets },
    { label: 'QC', count: r.pendingQc },
  ]
  const gapTable = r.total
    ? `<div class="h3">Outstanding by check</div>` +
      tableOpen([{ text: 'Check' }, { text: 'Bookings pending', align: 'right', width: '120' }, { text: '', width: '130' }]) +
      gaps.map(g => `<tr>
        ${td(esc(g.label), { bold: true, color: C.ink })}
        ${td(num(g.count), { align: 'right', bold: g.count > 0, color: g.count ? C.bad : C.good })}
        ${td(bar(g.count, r.total, g.count ? C.bad : C.line))}
      </tr>`).join('') + TABLE_CLOSE
    : ''

  const dayTable = r.total
    ? `<div style="padding-top:18px;"><div class="h3">By arrival day</div>` +
      tableOpen([
        { text: 'Arrives' }, { text: 'Tours', align: 'right', width: '60' },
        { text: 'Pax', align: 'right', width: '55' },
        { text: 'Ready', align: 'right', width: '60' }, { text: 'Not ready', align: 'right', width: '75' },
      ]) + r.byDay.map(day => `<tr>
        ${td(`${esc(day.label)}${day.label === 'Tomorrow' ? ` <span style="color:${C.faint};">${esc(formatReportDate(day.date))}</span>` : ''}`, { bold: true, color: C.ink, nowrap: true })}
        ${td(num(day.bookings), { align: 'right', bold: true, color: C.ink })}
        ${td(num(day.pax), { align: 'right' })}
        ${td(num(day.ready), { align: 'right', color: C.good })}
        ${td(num(day.notReady), { align: 'right', bold: day.notReady > 0, color: day.notReady ? C.bad : C.body })}
      </tr>`).join('') + TABLE_CLOSE + '</div>'
    : ''

  const list = r.bookings.length
    ? tableOpen([
        { text: 'Ref' }, { text: 'Arrives' }, { text: 'Country' },
        { text: 'Pax', align: 'right', width: '40' },
        { text: 'Client', align: 'center' }, { text: 'Driver', align: 'center' },
        { text: 'Tickets', align: 'center' }, { text: 'QC', align: 'center' },
      ]) + r.bookings.map((b: ReadinessLine) => {
        const arrives = b.daysToArrival === 1 ? 'Tomorrow' : formatReportDate(b.arrivalDate, { weekday: true })
        const guest = b.leadPassenger ?? b.destination
        return `<tr>
          ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>${guest ? `<div style="color:${C.faint};font-size:11px;">${truncate(guest, 22)}</div>` : ''}`, { nowrap: true })}
          ${td(esc(arrives), { nowrap: true, color: b.daysToArrival === 1 ? C.bad : C.body, bold: b.daysToArrival === 1 })}
          ${td(esc(b.countryLabel), { nowrap: true })}
          ${td(num(b.pax), { align: 'right' })}
          ${td(checkCell(b.readiness.client), { align: 'center', nowrap: true })}
          ${td(checkCell(b.readiness.driver), { align: 'center', nowrap: true })}
          ${td(checkCell(b.readiness.tickets), { align: 'center', nowrap: true })}
          ${td(checkCell(b.readiness.qc), { align: 'center', nowrap: true })}
        </tr>`
      }).join('') + TABLE_CLOSE + moreNote(r.bookings.length, r.total, 'arrivals')
    : emptyNote('No tours arrive in the next three days.')

  const legend = r.bookings.length
    ? `<div class="more">Driver and ticket cells read “done / total”. Red is nothing done, amber is part-done, green is complete; “—” or “None” means the check does not apply — no transfers, or no tickets on the booking.</div>`
    : ''

  return section(
    'Arriving next 3 days — readiness',
    `${formatReportDate(r.fromDate, { weekday: true })} to ${formatReportDate(r.toDate, { weekday: true })} · client confirmation, drivers, tickets and QC`,
    C.warn,
    banner + kpis + gapTable + dayTable +
      `<div style="padding-top:18px;"><div class="h3">Booking-by-booking checklist</div>${list}${legend}</div>` +
      (r.byCountry.length ? `<div style="padding-top:18px;"><div class="h3">Country-wise</div>${countryTable(r.byCountry)}</div>` : ''),
  )
}

function complaintCard(c: ComplaintLine): string {
  const resolved = c.status === 'resolved'
  const edge = resolved ? C.good : c.severity === 'high' ? C.bad : C.warn
  const meta = [
    c.bookingRef ? `Ref ${esc(c.bookingRef)}` : null,
    c.customerName ? esc(c.customerName) : null,
    esc(c.countryLabel),
    esc(c.category),
    new Date(c.createdAt).toISOString().slice(11, 16) + ' UTC',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')

  const resolution = resolved
    ? `<div class="cmp-r" style="background:#ecfdf5;color:#065f46;">
         <strong>Resolved${c.resolutionHours !== null ? ` in ${c.resolutionHours}h` : ''}:</strong> ${truncate(c.resolutionNote, 300)}
       </div>`
    : `<div class="cmp-r b" style="background:#fef2f2;color:#991b1b;">
         Still unresolved — needs an owner.
       </div>`

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="cmp" style="border-left:3px solid ${edge};">
    <tr><td style="padding:12px 14px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="cmp-t">${truncate(c.title ?? c.category, 90)}</td>
        <td align="right" style="white-space:nowrap;">${SEVERITY_PILL[c.severity] ?? SEVERITY_PILL.medium} ${resolved ? pill('RESOLVED', '#ffffff', C.good) : pill('OPEN', '#ffffff', C.bad)}</td>
      </tr></table>
      <div class="cmp-m">${meta}</div>
      ${c.details ? `<div class="cmp-d">${truncate(c.details, 420)}</div>` : ''}
      ${c.customerQuote ? `<div class="cmp-q">“${truncate(c.customerQuote, 220)}”</div>` : ''}
      ${resolution}
    </td></tr>
  </table>`
}

function complaintsSection(d: ReportData): string {
  const x = d.complaints

  if (!x.available) {
    return section('Complaints', 'Guest issues raised on TE calls', C.bad,
      emptyNote('Complaint tracking is not available on this environment.'))
  }

  const kpis = kpiRow([
    { label: 'Raised', value: num(x.total) },
    { label: 'Resolved', value: num(x.resolved), color: C.good },
    { label: 'Unresolved', value: num(x.open), color: x.open ? C.bad : C.ink },
    { label: 'Avg. fix time', value: x.avgResolutionHours !== null ? `${x.avgResolutionHours}h` : '—' },
  ])

  const banner = x.highSeverityOpen
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#991b1b;">
         ${num(x.highSeverityOpen)} high-severity complaint${x.highSeverityOpen === 1 ? '' : 's'} still open — escalate today.
       </div>`
    : ''

  const breakdown = x.byCategory.length
    ? `<div class="h3">By category</div>` +
      tableOpen([{ text: 'Category' }, { text: 'Total', align: 'right', width: '60' }, { text: 'Open', align: 'right', width: '60' }]) +
      x.byCategory.map(r => `<tr>
        ${td(esc(statusWord(r.category)), { color: C.ink, bold: true })}
        ${td(num(r.total), { align: 'right' })}
        ${td(num(r.open), { align: 'right', bold: r.open > 0, color: r.open ? C.bad : C.body })}
      </tr>`).join('') + TABLE_CLOSE
    : ''

  const countries = x.byCountry.length
    ? `<div style="padding-top:18px;"><div class="h3">Country-wise</div>${countryTable(x.byCountry, { showPax: false, showChannel: false })}</div>`
    : ''

  const detail = x.items.length
    ? `<div style="padding-top:18px;"><div class="h3">Every complaint, in full</div>${x.items.map(complaintCard).join('')}${moreNote(x.items.length, x.total, 'complaints')}</div>`
    : emptyNote('No complaints were raised in this period. 🎉')

  const carried = x.carriedOpen.length
    ? `<div style="padding-top:14px;"><div class="h3">Carried over — opened earlier, still unresolved (${num(x.carriedOpen.length)})</div>${x.carriedOpen.map(complaintCard).join('')}</div>`
    : ''

  return section(
    'Complaints',
    `${d.window.label} · resolved and unresolved, with detail`,
    C.bad,
    banner + kpis + breakdown + countries + detail + carried,
  )
}

function upcomingSection(d: ReportData): string {
  const u = d.upcoming

  const kpis = kpiRow([
    { label: 'Upcoming tours', value: num(u.total), color: C.brand },
    { label: 'Next 7 days', value: num(u.next7), color: C.warn },
    { label: 'Next 30 days', value: num(u.next30) },
    { label: 'Guests expected', value: num(u.pax) },
  ])

  const months = u.byMonth.length
    ? (() => {
        const max = Math.max(...u.byMonth.map(m => m.bookings))
        return `<div class="h3">Arrivals by month</div>` +
          tableOpen([{ text: 'Month' }, { text: 'Tours', align: 'right', width: '60' }, { text: 'Pax', align: 'right', width: '55' }, { text: '', width: '130' }]) +
          u.byMonth.map(m => `<tr>
            ${td(esc(m.label), { bold: true, color: C.ink, nowrap: true })}
            ${td(num(m.bookings), { align: 'right', bold: true, color: C.ink })}
            ${td(num(m.pax), { align: 'right' })}
            ${td(bar(m.bookings, max, C.b2b))}
          </tr>`).join('') + TABLE_CLOSE
      })()
    : ''

  const imminent = u.imminent.length
    ? `<div style="padding-top:18px;"><div class="h3">Next arrivals</div>` +
      tableOpen([{ text: 'Ref' }, { text: 'Src', width: '46' }, { text: 'Country' }, { text: 'Arrives' }, { text: 'Pax', align: 'right', width: '45' }, { text: 'Status' }]) +
      u.imminent.map((b: BookingLine) => `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>`, { nowrap: true })}
        ${td(sourcePill(b.source), { nowrap: true })}
        ${td(esc(b.countryLabel), { nowrap: true })}
        ${td(shortDate(b.arrivalDate), { nowrap: true })}
        ${td(num(b.pax), { align: 'right' })}
        ${td(esc(statusWord(b.status)), { color: C.muted, nowrap: true })}
      </tr>`).join('') + TABLE_CLOSE
    : emptyNote('Nothing on the forward book.')

  return section(
    'Upcoming tours',
    `From ${formatReportDate(d.window.today)} onwards · full forward book`,
    C.b2c,
    kpis +
      `<div class="h3">Country-wise</div>${countryTable(u.byCountry)}` +
      (months ? `<div style="padding-top:18px;">${months}</div>` : '') +
      imminent,
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Which sections to include, in the order they appear. */
  sections?: { created?: boolean; onGround?: boolean; readiness?: boolean; complaints?: boolean; upcoming?: boolean }
  /** Optional AI-written paragraph placed above the sections. */
  narrative?: string | null
  /** Absolute dashboard URL for the footer link. */
  dashboardUrl?: string | null
  scheduleName?: string
  /** Marks the mail as a manual/test send. */
  testSend?: boolean
}

function headerBlock(w: ReportWindow, opts: RenderOptions): string {
  const badge = opts.testSend
    ? `<span style="display:inline-block;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.18);color:#ffffff;font:700 10px/1.5 ${FONT};letter-spacing:.08em;">TEST SEND</span>`
    : ''
  return `
  <tr><td style="background:${C.brandDeep};background-image:linear-gradient(135deg,${C.brandDeep} 0%,${C.brand} 100%);padding:26px 24px;border-radius:16px 16px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <div style="font:700 11px/1.4 ${FONT};color:rgba(255,255,255,.72);text-transform:uppercase;letter-spacing:.14em;">AppleHolidays Operations</div>
          <div style="font:800 24px/1.25 ${FONT};color:#ffffff;padding-top:6px;letter-spacing:-0.02em;">${esc(PERIOD_LABEL[w.period])} Operations Report</div>
          <div style="font:400 13px/1.5 ${FONT};color:rgba(255,255,255,.82);padding-top:5px;">${esc(w.label)}</div>
        </td>
        <td align="right" valign="top" style="white-space:nowrap;">${badge}</td>
      </tr>
    </table>
  </td></tr>`
}

function summaryStrip(d: ReportData): string {
  const cells = [
    { label: 'Created', value: num(d.created.total), sub: `${num(d.created.channel.b2b)} B2B / ${num(d.created.channel.b2c)} B2C` },
    { label: 'On ground', value: num(d.onGround.total), sub: `${num(d.onGround.pax)} guests` },
    { label: 'Next 3 days', value: num(d.readiness.total), sub: `${num(d.readiness.notReady)} not ready` },
    { label: 'Complaints', value: num(d.complaints.total), sub: `${num(d.complaints.open)} open` },
    { label: 'Upcoming', value: num(d.upcoming.total), sub: `${num(d.upcoming.next7)} in 7d` },
  ]
  return `
  <tr><td style="background:#0b3d3a;padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${cells.map(c => `<td width="${Math.floor(100 / cells.length)}%" align="center" style="padding:2px 4px;">
        <div style="font:800 22px/1.2 ${FONT};color:#ffffff;">${c.value}</div>
        <div style="font:700 10px/1.4 ${FONT};color:rgba(255,255,255,.66);text-transform:uppercase;letter-spacing:.08em;padding-top:3px;">${esc(c.label)}</div>
        <div style="font:400 10px/1.4 ${FONT};color:rgba(255,255,255,.45);padding-top:2px;">${esc(c.sub)}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>`
}

/**
 * Strip the indentation the templates above are written with.
 *
 * Only whitespace that spans a newline *between two tags* is removed, so a
 * deliberate single space written inline (`</span> <span>`) survives — losing
 * those would run words together in the rendered mail.
 */
function compact(html: string): string {
  return html.replace(/>\s*\n\s*</g, '><')
}

export function renderReportEmail(d: ReportData, opts: RenderOptions = {}): string {
  const want = {
    created: opts.sections?.created !== false,
    onGround: opts.sections?.onGround !== false,
    readiness: opts.sections?.readiness !== false,
    complaints: opts.sections?.complaints !== false,
    upcoming: opts.sections?.upcoming !== false,
  }

  const scopeNote = d.countries.length
    ? `Scoped to ${d.countries.map(c => esc(c.replace(/_/g, ' '))).join(', ')}`
    : 'All operating countries'

  const narrative = opts.narrative
    ? `<tr><td style="padding:0 0 22px 0;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:14px;">
           <tr><td style="padding:16px 18px;">
             <div style="font:700 11px/1.4 ${FONT};color:#0e7490;text-transform:uppercase;letter-spacing:.08em;">Summary</div>
             <div style="font:400 13px/1.7 ${FONT};color:#134e4a;padding-top:7px;">${esc(opts.narrative).replace(/\n/g, '<br>')}</div>
           </td></tr>
         </table>
       </td></tr>`
    : ''

  const body = [
    want.created ? createdSection(d) : '',
    want.onGround ? onGroundSection(d) : '',
    want.readiness ? readinessSection(d) : '',
    want.complaints ? complaintsSection(d) : '',
    want.upcoming ? upcomingSection(d) : '',
  ].join('')

  const footerLink = opts.dashboardUrl
    ? `<a href="${esc(opts.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:${C.brand};color:#ffffff;text-decoration:none;border-radius:8px;font:700 13px/1 ${FONT};">Open the dashboard</a>`
    : ''

  return compact(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(PERIOD_LABEL[d.window.period])} Operations Report</title>
<style type="text/css">${STYLE_BLOCK}</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(d.window.label)} — ${num(d.created.total)} new bookings, ${num(d.onGround.total)} tours on ground, ${num(d.readiness.notReady)} arrivals not ready, ${num(d.complaints.open)} open complaints.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;padding:22px 12px;">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;">
      ${headerBlock(d.window, opts)}
      ${summaryStrip(d)}
      <tr><td style="background:#ffffff;padding:20px 18px 6px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${narrative}
          ${body}
        </table>
      </td></tr>
      <tr><td align="center" style="background:#ffffff;padding:6px 18px 24px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};border-radius:0 0 16px 16px;">
        ${footerLink}
        <div class="foot">
          ${esc(opts.scheduleName ? `“${opts.scheduleName}” · ` : '')}${esc(scopeNote)}<br>
          Generated ${esc(new Date(d.generatedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC · times in ${esc(d.window.timezone)}<br>
          Automated report from AppleHolidays MMT — replies are not monitored.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`)
}

/** Subject line: informative enough to triage from the inbox list alone. */
export function renderReportSubject(d: ReportData, opts: { prefix?: string; testSend?: boolean } = {}): string {
  const parts = [
    `${d.created.total} new`,
    `${d.onGround.total} on ground`,
  ]
  if (d.readiness.notReady > 0) parts.push(`${d.readiness.notReady} not ready in 3d`)
  if (d.complaints.open > 0) parts.push(`${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`)
  const range = d.window.period === 'DAILY'
    ? formatReportDate(d.window.fromDate)
    : `${formatReportDate(d.window.fromDate)}–${formatReportDate(d.window.toDate)}`
  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}${PERIOD_LABEL[d.window.period]} Ops Report · ${range} · ${parts.join(', ')}`
}

// ─── CSV attachment ───────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Flat CSV of the report's booking-level rows, attached so finance/ops can pivot
 * without asking anyone to export it. One file, three labelled blocks.
 */
export function renderReportCsv(d: ReportData): string {
  const rows: string[] = []
  const block = (title: string, header: string[], lines: string[][]) => {
    rows.push(`# ${title}`)
    rows.push(header.map(csvCell).join(','))
    for (const l of lines) rows.push(l.map(csvCell).join(','))
    rows.push('')
  }

  block('Bookings created', ['Ref', 'Source', 'Country', 'Agent', 'Status', 'Arrival', 'Departure', 'Adults', 'Children', 'Infants', 'Currency', 'Quoted total', 'Created at'],
    d.created.bookings.map(b => [b.bookingRef, b.source, b.countryLabel, b.agent ?? '', b.status, b.arrivalDate, b.departureDate, b.paxAdults, b.paxChildren, b.paxInfants, b.currency, b.quotedTotal ?? '', b.createdAt].map(String)))

  block(`On ground ${d.onGround.date}`, ['Ref', 'Source', 'Country', 'Lead guest', 'Day', 'Total days', 'Pax', 'Status'],
    d.onGround.tours.map(t => [t.bookingRef, t.source, t.countryLabel, t.leadPassenger ?? '', t.dayNo, t.totalDays, t.pax, t.status].map(String)))

  block(`Arriving ${d.readiness.fromDate} to ${d.readiness.toDate} — readiness`,
    ['Ref', 'Source', 'Country', 'Lead guest', 'Arrival', 'Days to arrival', 'Pax', 'Status', 'Client confirmed', 'Driver allocation', 'Driver detail', 'Tickets', 'Ticket detail', 'QC stage', 'Ready', 'Outstanding'],
    d.readiness.bookings.map(b => [
      b.bookingRef, b.source, b.countryLabel, b.leadPassenger ?? '', b.arrivalDate, b.daysToArrival, b.pax, b.status,
      b.readiness.client.state === 'DONE' ? 'Yes' : 'No',
      b.readiness.driver.short, b.readiness.driver.detail,
      b.readiness.tickets.short, b.readiness.tickets.detail,
      b.readiness.qc.short,
      b.readiness.ready ? 'Yes' : 'No',
      b.readiness.outstanding.join('; '),
    ].map(String)))

  block('Complaints', ['Raised at', 'Ref', 'Customer', 'Country', 'Category', 'Severity', 'Status', 'Title', 'Details', 'Resolution', 'Resolved at', 'Hours to resolve'],
    [...d.complaints.items, ...d.complaints.carriedOpen].map(c => [c.createdAt, c.bookingRef ?? '', c.customerName ?? '', c.countryLabel, c.category, c.severity, c.status, c.title ?? '', c.details ?? '', c.resolutionNote ?? '', c.resolvedAt ?? '', c.resolutionHours ?? ''].map(String)))

  block('Upcoming arrivals', ['Ref', 'Source', 'Country', 'Arrival', 'Departure', 'Pax', 'Status'],
    d.upcoming.imminent.map(b => [b.bookingRef, b.source, b.countryLabel, b.arrivalDate, b.departureDate, b.pax, b.status].map(String)))

  return rows.join('\r\n')
}
