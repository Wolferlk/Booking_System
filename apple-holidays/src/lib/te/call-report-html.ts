/**
 * The AI voice-call report as HTML — one renderer, two destinations.
 *
 * The same markup is emailed by the daily schedule and served by the download
 * button (`?format=html`, which opens print-ready and can be saved as PDF from
 * the browser). Written to mail-client rules for that reason: nested tables, a
 * fixed shell width, no flexbox or grid, and the repeating rules in a `<style>`
 * block rather than inline on every cell — same reasoning as `report-html.ts`.
 */
import { formatReportDate } from '@/lib/reports/report-window'
import {
  CALL_PHASES, PHASE_LABEL,
  type CallCounts, type CallReportData, type CallReportRow,
} from './call-report-data'

const C = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  wash: '#f8fafc',
  card: '#ffffff',
  brand: '#7c3aed',
  brandDeep: '#4c1d95',
  good: '#059669',
  warn: '#d97706',
  bad: '#dc2626',
  info: '#0284c7',
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

const STYLE_BLOCK = `
body,table,td,th,div,span,a,p{font-family:${FONT};}
table{border-collapse:collapse;}
.sec{background:${C.card};border:1px solid ${C.line};border-radius:14px;border-collapse:separate;overflow:hidden;}
.sec-t{font-size:16px;line-height:1.3;font-weight:700;color:${C.ink};letter-spacing:-.01em;}
.sec-s{font-size:12px;line-height:1.5;color:${C.muted};padding-top:3px;}
.kpi{background:${C.wash};border:1px solid ${C.line};border-radius:10px;}
.kpi-l{font-size:10px;line-height:1.2;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;}
.kpi-v{font-size:24px;line-height:1.15;font-weight:800;padding-top:6px;letter-spacing:-.02em;}
.kpi-n{font-size:11px;line-height:1.4;color:${C.faint};padding-top:4px;}
.th{font-size:10px;line-height:1.4;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;padding:0 7px 7px 7px;border-bottom:1px solid ${C.line};white-space:nowrap;}
.c{font-size:12px;line-height:1.5;color:${C.body};padding:8px 7px;border-bottom:1px solid ${C.wash};}
.b{font-weight:700;color:${C.ink};}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}
.nw{white-space:nowrap;}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.5;white-space:nowrap;}
.note{font-size:13px;line-height:1.6;color:${C.faint};padding:16px 0;text-align:center;background:${C.wash};border-radius:8px;}
.foot{font-size:11px;line-height:1.7;color:${C.faint};padding-top:16px;}
@media print{.noprint{display:none !important;}body{background:#fff !important;}}
`.replace(/\n+/g, '\n').trim()

// ─── Primitives ───────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const num = (n: number) => n.toLocaleString('en-US')

function pill(text: string, color: string, bg: string): string {
  return `<span class="pill" style="color:${color};background:${bg};">${esc(text)}</span>`
}

function dateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return esc(iso)
  return esc(d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))
}

function approvalPill(row: CallReportRow): string {
  if (row.approval === 'approved') return pill('Approved', '#065f46', '#d1fae5')
  if (row.approval === 'pending') return pill('Awaiting customer', '#92400e', '#fef3c7')
  return pill('Not sent', '#475569', '#e2e8f0')
}

function callDonePill(row: CallReportRow): string {
  if (row.callDone === 'done') return pill('Done', '#065f46', '#d1fae5')
  if (row.callDone === 'partial') return pill(`${row.counts.done}/${row.counts.assigned}`, '#1e40af', '#dbeafe')
  return pill('Not called', '#991b1b', '#fee2e2')
}

function urgentCell(row: CallReportRow): string {
  if (!row.urgent.open) return `<span style="color:${C.faint};">—</span>`
  const sev = row.urgent.severity
  const colour = sev === 'high' ? ['#991b1b', '#fee2e2'] : sev === 'medium' ? ['#92400e', '#fef3c7'] : ['#475569', '#e2e8f0']
  const label = `${row.urgent.open} ${sev ? sev.toUpperCase() : 'OPEN'}`
  const title = row.urgent.latestTitle
    ? `<div style="font-size:10px;color:${C.faint};padding-top:3px;">${esc(row.urgent.latestTitle.slice(0, 48))}</div>`
    : ''
  return `${pill(label, colour[0], colour[1])}${title}`
}

function kpi(label: string, value: string | number, note: string, colour: string): string {
  return `<td class="kpi" width="25%" style="padding:12px 14px;" valign="top">
    <div class="kpi-l">${esc(label)}</div>
    <div class="kpi-v" style="color:${colour};">${esc(String(value))}</div>
    <div class="kpi-n">${esc(note)}</div>
  </td>`
}

function section(title: string, subtitle: string, inner: string): string {
  return `<table class="sec" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
    <tr><td style="padding:18px 20px 12px 20px;">
      <div class="sec-t">${esc(title)}</div>
      <div class="sec-s">${esc(subtitle)}</div>
    </td></tr>
    <tr><td style="padding:0 20px 18px 20px;">${inner}</td></tr>
  </table>`
}

function countsCell(c: CallCounts): string {
  const parts: string[] = []
  if (c.done) parts.push(`<span style="color:${C.good};font-weight:700;">${c.done} done</span>`)
  if (c.pending) parts.push(`<span style="color:${C.warn};font-weight:700;">${c.pending} pending</span>`)
  if (c.missed) parts.push(`<span style="color:${C.bad};font-weight:700;">${c.missed} missed</span>`)
  if (c.skipped) parts.push(`<span style="color:${C.faint};">${c.skipped} skipped</span>`)
  return parts.length ? parts.join(' · ') : '—'
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function kpiGrid(d: CallReportData): string {
  const t = d.totals
  return `<table width="100%" cellpadding="0" cellspacing="6" style="margin-bottom:18px;"><tr>
    ${kpi('Assigned calls', num(t.calls.assigned), `${num(t.bookings)} booking${t.bookings === 1 ? '' : 's'}`, C.brand)}
    ${kpi('Completed', num(t.calls.done), `${t.completionRate}% of assigned`, C.good)}
    ${kpi('Pending', num(t.calls.pending), `${num(t.calls.missed)} missed`, t.calls.pending ? C.warn : C.faint)}
    ${kpi('Urgent', num(t.urgentBookings), `${num(t.openAlerts)} open alert${t.openAlerts === 1 ? '' : 's'}`, t.urgentBookings ? C.bad : C.faint)}
  </tr></table>
  <table width="100%" cellpadding="0" cellspacing="6" style="margin-bottom:18px;"><tr>
    ${kpi('WhatsApp approved', num(t.approval.approved), 'customers accepting AI calls', C.good)}
    ${kpi('Awaiting approval', num(t.approval.pending), 'approval sent, no answer yet', t.approval.pending ? C.warn : C.faint)}
    ${kpi('Approval not sent', num(t.approval.not_requested), 'cannot be called yet', t.approval.not_requested ? C.bad : C.faint)}
    ${kpi('Not called at all', num(t.bookingsNotCalled), `${num(t.bookingsFullyCalled)} fully done`, t.bookingsNotCalled ? C.warn : C.faint)}
  </tr></table>`
}

function phaseTable(d: CallReportData): string {
  const t = d.totals
  const rows = [
    { label: 'All calls', c: t.calls, colour: C.ink },
    ...CALL_PHASES.map(p => ({ label: PHASE_LABEL[p], c: t.byPhase[p], colour: C.body })),
  ]
  return section('Daily calls — full breakdown', d.window.label,
    `<table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th class="th" align="left">Call type</th>
        <th class="th" align="right">Assigned</th>
        <th class="th" align="right">Done</th>
        <th class="th" align="right">Pending</th>
        <th class="th" align="right">Missed</th>
        <th class="th" align="right">Skipped</th>
      </tr>
      ${rows.map(r => `<tr>
        <td class="c b" style="color:${r.colour};">${esc(r.label)}</td>
        <td class="c b" align="right">${num(r.c.assigned)}</td>
        <td class="c" align="right" style="color:${r.c.done ? C.good : C.faint};font-weight:700;">${num(r.c.done)}</td>
        <td class="c" align="right" style="color:${r.c.pending ? C.warn : C.faint};font-weight:700;">${num(r.c.pending)}</td>
        <td class="c" align="right" style="color:${r.c.missed ? C.bad : C.faint};font-weight:700;">${num(r.c.missed)}</td>
        <td class="c" align="right" style="color:${C.faint};">${num(r.c.skipped)}</td>
      </tr>`).join('')}
    </table>`)
}

function dailyTable(d: CallReportData): string {
  if (d.daily.length < 2) return ''
  return section('Calls by date', `${formatReportDate(d.window.fromDate)} → ${formatReportDate(d.window.toDate)}`,
    `<table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th class="th" align="left">Date</th>
        <th class="th" align="right">All</th>
        <th class="th" align="right">Pre-tour</th>
        <th class="th" align="right">On-tour</th>
        <th class="th" align="right">Post-tour</th>
        <th class="th" align="right">Done</th>
        <th class="th" align="right">Pending</th>
        <th class="th" align="right">Missed</th>
      </tr>
      ${d.daily.map(x => `<tr>
        <td class="c b nw">${esc(formatReportDate(x.date, { weekday: true }))}</td>
        <td class="c b" align="right">${num(x.all)}</td>
        <td class="c" align="right">${num(x.pre_tour)}</td>
        <td class="c" align="right">${num(x.on_tour)}</td>
        <td class="c" align="right">${num(x.post_tour)}</td>
        <td class="c" align="right" style="color:${x.done ? C.good : C.faint};">${num(x.done)}</td>
        <td class="c" align="right" style="color:${x.pending ? C.warn : C.faint};">${num(x.pending)}</td>
        <td class="c" align="right" style="color:${x.missed ? C.bad : C.faint};">${num(x.missed)}</td>
      </tr>`).join('')}
    </table>`)
}

function bookingTable(d: CallReportData, maxRows: number): string {
  if (!d.rows.length) {
    return section('Assigned calls by booking', d.window.label,
      `<div class="note">No calls assigned in this window.</div>`)
  }

  const shown = d.rows.slice(0, maxRows)
  const more = d.rows.length - shown.length

  return section('Assigned calls by booking', `${num(d.rows.length)} booking${d.rows.length === 1 ? '' : 's'} · ${d.window.label}`,
    `<table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th class="th" align="left">Booking</th>
        <th class="th" align="left">Contact</th>
        <th class="th" align="center">Urgent</th>
        <th class="th" align="center">Approval</th>
        <th class="th" align="right">Calls</th>
        <th class="th" align="left">Status</th>
        <th class="th" align="center">Call done</th>
        <th class="th" align="left">Last call</th>
      </tr>
      ${shown.map(r => `<tr>
        <td class="c" valign="top">
          <div class="b mono">${esc(r.bookingRef)}</div>
          ${r.customerName ? `<div style="font-size:11px;color:${C.faint};padding-top:2px;">${esc(r.customerName)}</div>` : ''}
        </td>
        <td class="c mono nw" valign="top">${esc(r.phone ?? '—')}</td>
        <td class="c" align="center" valign="top">${urgentCell(r)}</td>
        <td class="c" align="center" valign="top">${approvalPill(r)}</td>
        <td class="c b" align="right" valign="top">${num(r.counts.assigned)}</td>
        <td class="c nw" valign="top">${countsCell(r.counts)}</td>
        <td class="c" align="center" valign="top">${callDonePill(r)}</td>
        <td class="c nw" valign="top" style="color:${C.faint};">${dateTime(r.lastCallAt)}</td>
      </tr>`).join('')}
    </table>
    ${more > 0 ? `<div style="font-size:11px;color:${C.faint};padding-top:10px;">+ ${num(more)} more booking${more === 1 ? '' : 's'} — see the attached CSV for the full list.</div>` : ''}`)
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export interface CallReportHtmlOptions {
  /** Adds a print button and page chrome — for the downloadable copy. */
  standalone?: boolean
  dashboardUrl?: string | null
  scheduleName?: string | null
  testSend?: boolean
  maxRows?: number
}

export function renderCallReportHtml(d: CallReportData, opts: CallReportHtmlOptions = {}): string {
  const maxRows = opts.maxRows ?? 200
  const warnings = d.warnings.length
    ? `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#92400e;">
        ${d.warnings.map(w => esc(w)).join('<br>')}
      </div>`
    : ''

  const banner = opts.testSend
    ? `<div style="background:#ede9fe;border:1px solid #c4b5fd;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:${C.brandDeep};font-weight:700;">
        Test send — this report was triggered manually.
      </div>`
    : ''

  const printBar = opts.standalone
    ? `<div class="noprint" style="text-align:right;padding-bottom:12px;">
        <button onclick="window.print()" style="background:${C.brand};color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;">Print / Save as PDF</button>
      </div>`
    : ''

  const body = `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${C.wash};padding:24px 12px;">
      <tr><td align="center">
        <table width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;">
          <tr><td>${printBar}</td></tr>
          <tr><td style="background:linear-gradient(135deg,${C.brandDeep},${C.brand});border-radius:14px;padding:22px 24px;margin-bottom:18px;">
            <div style="font-size:11px;font-weight:700;color:#ddd6fe;text-transform:uppercase;letter-spacing:.08em;">AI Voice Calls · Traveller Experience</div>
            <div style="font-size:21px;font-weight:800;color:#ffffff;padding-top:6px;letter-spacing:-.02em;">Call Report</div>
            <div style="font-size:13px;color:#e9d5ff;padding-top:4px;">${esc(d.window.label)}</div>
          </td></tr>
          <tr><td style="height:18px;"></td></tr>
          <tr><td>
            ${banner}
            ${warnings}
            ${kpiGrid(d)}
            ${phaseTable(d)}
            ${dailyTable(d)}
            ${bookingTable(d, maxRows)}
            <div class="foot">
              Generated ${esc(new Date(d.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))} · ${esc(d.window.timezone)}
              ${opts.scheduleName ? ` · schedule &ldquo;${esc(opts.scheduleName)}&rdquo;` : ''}
              ${opts.dashboardUrl ? `<br><a href="${esc(opts.dashboardUrl)}" style="color:${C.brand};font-weight:700;text-decoration:none;">Open the AI Call Report in ops</a>` : ''}
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Voice Call Report — ${esc(d.window.label)}</title>
<style>${STYLE_BLOCK}</style>
</head><body style="margin:0;padding:0;background:${C.wash};">${body}</body></html>`
}

export function renderCallReportSubject(d: CallReportData, prefix?: string | null, testSend?: boolean): string {
  const t = d.totals
  const head = `AI Calls — ${d.window.label}`
  const stats = `${t.calls.assigned} assigned · ${t.calls.done} done · ${t.calls.pending} pending`
  const urgent = t.urgentBookings ? ` · ${t.urgentBookings} urgent` : ''
  return `${testSend ? '[TEST] ' : ''}${prefix ? `${prefix} ` : ''}${head} — ${stats}${urgent}`
}
