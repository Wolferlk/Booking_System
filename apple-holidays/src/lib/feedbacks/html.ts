/**
 * The Feedbacks dossier as a print-ready HTML document.
 *
 * Served inline with `?format=html` and opened with `window.print()` already
 * queued, so the browser's own PDF engine does the rendering. That is the same
 * trade the AI call report makes (`lib/te/call-report-html.ts`) and for the same
 * reason: it keeps a headless Chromium off the Lambda, where the binary does not
 * fit and the cold start would blow the request budget.
 *
 * Written to print rules rather than screen rules — explicit page sizing, no
 * dark mode, `break-inside: avoid` on every card, and a repeating table head so
 * a long batch report stays readable across page breaks.
 */
import type {
  BatchReport, CallRecord, ComplaintRecord, FeedbackDossier, HealthBand, Sentiment,
} from './types'

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  ink: '#0b1220',
  body: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  hair: '#f1f5f9',
  wash: '#f8fafc',
  card: '#ffffff',
  brand: '#6d28d9',
  brandLite: '#ede9fe',
  good: '#059669',
  goodLite: '#d1fae5',
  warn: '#d97706',
  warnLite: '#fef3c7',
  bad: '#dc2626',
  badLite: '#fee2e2',
  info: '#0284c7',
  infoLite: '#e0f2fe',
}

const BAND: Record<HealthBand, { label: string; color: string; bg: string; blurb: string }> = {
  excellent: { label: 'Excellent', color: C.good, bg: C.goodLite, blurb: 'Every channel came back strong.' },
  good:      { label: 'Good',      color: C.info, bg: C.infoLite, blurb: 'Solid trip, nothing outstanding.' },
  watch:     { label: 'Watch',     color: C.warn, bg: C.warnLite, blurb: 'Mixed signals — worth a read.' },
  at_risk:   { label: 'At risk',   color: C.bad,  bg: C.badLite,  blurb: 'Negative feedback or an open complaint.' },
  unknown:   { label: 'No data',   color: C.faint, bg: C.hair,    blurb: 'No feedback captured yet.' },
}

const SENTIMENT: Record<Sentiment, { label: string; color: string; bg: string }> = {
  positive: { label: 'Positive', color: C.good, bg: C.goodLite },
  neutral:  { label: 'Neutral',  color: C.info, bg: C.infoLite },
  negative: { label: 'Negative', color: C.bad,  bg: C.badLite },
  unknown:  { label: 'Unread',   color: C.muted, bg: C.hair },
}

const KIND_LABEL: Record<CallRecord['kind'], string> = {
  reconfirm: 'Reconfirmation call',
  on_ground: 'On-ground call',
  post_tour: 'Post-tour call',
}

const KIND_COLOR: Record<CallRecord['kind'], string> = {
  reconfirm: '#0284c7',
  on_ground: '#7c3aed',
  post_tour: '#ea580c',
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"

// ─── Primitives ───────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Free text from a call summary keeps its paragraph breaks in the PDF. */
function escMultiline(v: unknown): string {
  return esc(v).replace(/\n/g, '<br>')
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return esc(value)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return esc(value)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function pill(text: string, color: string, bg: string): string {
  return `<span class="pill" style="color:${color};background:${bg};">${esc(text)}</span>`
}

function bandPill(band: HealthBand): string {
  const b = BAND[band]
  return pill(b.label, b.color, b.bg)
}

function sentimentPill(s: Sentiment): string {
  const v = SENTIMENT[s]
  return pill(v.label, v.color, v.bg)
}

/**
 * The score ring. Drawn as SVG rather than a CSS conic-gradient because print
 * engines drop background gradients when "background graphics" is unticked, and
 * the score is the one thing on the page that must survive that.
 */
function scoreRing(value: number | null, band: HealthBand, size = 96): string {
  const b = BAND[band]
  const r = (size - 12) / 2
  const circ = 2 * Math.PI * r
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value))
  const dash = (pct / 100) * circ

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="display:block;">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${C.line}" stroke-width="9"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${b.color}" stroke-width="9"
      stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
      transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" text-anchor="middle" dy="0.10em"
      style="font:800 ${Math.round(size * 0.29)}px ${FONT};fill:${value == null ? C.faint : C.ink};">${value == null ? '—' : value}</text>
    <text x="50%" y="50%" text-anchor="middle" dy="1.55em"
      style="font:700 ${Math.round(size * 0.1)}px ${FONT};fill:${C.faint};letter-spacing:.08em;">SCORE</text>
  </svg>`
}

/** A horizontal proportion bar — used for sentiment mix and coverage. */
function stackBar(parts: { value: number; color: string }[], height = 8): string {
  const total = parts.reduce((n, p) => n + p.value, 0)
  if (!total) return `<div class="bar"><div style="width:100%;background:${C.hair};"></div></div>`
  const segs = parts
    .filter(p => p.value > 0)
    .map(p => `<div style="width:${((p.value / total) * 100).toFixed(2)}%;background:${p.color};"></div>`)
    .join('')
  return `<div class="bar" style="height:${height}px;">${segs}</div>`
}

function kpi(label: string, value: string | number, note: string, color: string): string {
  return `<div class="kpi">
    <div class="kpi-l">${esc(label)}</div>
    <div class="kpi-v" style="color:${color};">${esc(String(value))}</div>
    <div class="kpi-n">${esc(note)}</div>
  </div>`
}

function section(title: string, subtitle: string, inner: string, opts: { tight?: boolean } = {}): string {
  return `<section class="sec${opts.tight ? ' tight' : ''}">
    <div class="sec-h">
      <div class="sec-t">${esc(title)}</div>
      <div class="sec-s">${esc(subtitle)}</div>
    </div>
    <div class="sec-b">${inner}</div>
  </section>`
}

function empty(text: string): string {
  return `<div class="empty">${esc(text)}</div>`
}

function kv(rows: [string, string][]): string {
  return `<table class="kv">${rows
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
    .join('')}</table>`
}

// ─── Style ────────────────────────────────────────────────────────────────────

const STYLE = `
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:${FONT};color:${C.body};background:${C.wash};font-size:12px;line-height:1.55;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.page{max-width:960px;margin:0 auto;padding:24px 22px 56px;}
h1,h2,h3{margin:0;}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;line-height:1.6;white-space:nowrap;letter-spacing:.01em;}
.mono{font-family:${MONO};}
.bar{display:flex;width:100%;height:8px;border-radius:999px;overflow:hidden;background:${C.hair};}
.muted{color:${C.muted};}
.faint{color:${C.faint};}
.b{font-weight:700;color:${C.ink};}

/* Cover */
.cover{background:linear-gradient(135deg,#4c1d95 0%,#6d28d9 46%,#9333ea 100%);color:#fff;border-radius:18px;padding:22px 24px;margin-bottom:16px;}
.cover .eyebrow{font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.72);}
.cover h1{font-size:26px;font-weight:800;letter-spacing:-.02em;padding-top:4px;}
.cover .sub{font-size:12px;color:rgba(255,255,255,.82);padding-top:5px;}
.cover-grid{display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap;}
.cover-chips{display:flex;gap:6px;flex-wrap:wrap;padding-top:12px;}
.cover-chip{background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:3px 11px;font-size:10px;font-weight:700;}
.ring-wrap{background:rgba(255,255,255,.96);border-radius:16px;padding:12px 16px;text-align:center;min-width:150px;}
.ring-band{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;padding-top:6px;}
.ring-blurb{font-size:10px;color:${C.muted};padding-top:2px;max-width:140px;margin:0 auto;line-height:1.4;}

/* Sections */
.sec{background:${C.card};border:1px solid ${C.line};border-radius:14px;margin-bottom:14px;overflow:hidden;break-inside:avoid;}
.sec.tight{break-inside:auto;}
.sec-h{padding:14px 18px 10px;border-bottom:1px solid ${C.hair};}
.sec-t{font-size:14px;font-weight:800;color:${C.ink};letter-spacing:-.01em;}
.sec-s{font-size:11px;color:${C.muted};padding-top:2px;}
.sec-b{padding:14px 18px 16px;}

/* KPI grid */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
.kpis.six{grid-template-columns:repeat(6,1fr);}
.kpi{background:${C.wash};border:1px solid ${C.line};border-radius:10px;padding:10px 12px;}
.kpi-l{font-size:9px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.07em;}
.kpi-v{font-size:22px;font-weight:800;letter-spacing:-.02em;line-height:1.15;padding-top:4px;}
.kpi-n{font-size:10px;color:${C.faint};padding-top:2px;line-height:1.35;}

/* Key/value */
table.kv{width:100%;border-collapse:collapse;}
table.kv th{text-align:left;font-size:10px;font-weight:700;color:${C.muted};text-transform:uppercase;letter-spacing:.05em;padding:5px 12px 5px 0;width:150px;vertical-align:top;white-space:nowrap;}
table.kv td{font-size:12px;color:${C.ink};padding:5px 0;vertical-align:top;border-bottom:1px solid ${C.hair};}

/* Data tables */
table.data{width:100%;border-collapse:collapse;}
table.data th{font-size:9px;font-weight:800;color:${C.muted};text-transform:uppercase;letter-spacing:.06em;text-align:left;padding:0 8px 7px;border-bottom:1px solid ${C.line};white-space:nowrap;}
table.data td{font-size:11px;color:${C.body};padding:7px 8px;border-bottom:1px solid ${C.hair};vertical-align:top;}
table.data tr{break-inside:avoid;}
thead{display:table-header-group;}

/* Call card */
.call{border:1px solid ${C.line};border-radius:12px;margin-bottom:10px;overflow:hidden;break-inside:avoid;}
.call-h{display:flex;align-items:center;gap:8px;padding:9px 13px;background:${C.wash};border-bottom:1px solid ${C.hair};flex-wrap:wrap;}
.call-k{font-size:11px;font-weight:800;color:${C.ink};}
.call-d{font-size:10px;color:${C.faint};margin-left:auto;}
.call-b{padding:11px 13px;}
.checks{display:flex;gap:6px;flex-wrap:wrap;padding-bottom:8px;}
.note{padding:7px 0;border-top:1px dashed ${C.hair};}
.note:first-child{border-top:0;padding-top:0;}
.note-l{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:${C.faint};}
.note-t{font-size:11.5px;color:${C.ink};padding-top:2px;}
.summary{background:${C.brandLite};border-left:3px solid ${C.brand};border-radius:0 8px 8px 0;padding:8px 11px;font-size:11.5px;color:#3b0764;margin-bottom:8px;}

/* Transcript */
.tr{margin-top:9px;border-top:1px solid ${C.hair};padding-top:9px;}
.tr-h{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:${C.faint};padding-bottom:6px;}
.turn{display:flex;gap:8px;padding:3px 0;font-size:11px;break-inside:avoid;}
.turn-s{flex:0 0 62px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;padding-top:2px;}
.turn-t{flex:1;color:${C.body};}
.s-agent{color:${C.brand};}
.s-customer{color:${C.good};}
.s-system{color:${C.faint};}

/* Timeline */
.tl{position:relative;padding-left:16px;}
.tl::before{content:'';position:absolute;left:4px;top:4px;bottom:4px;width:2px;background:${C.line};}
.tl-i{position:relative;padding:0 0 12px 6px;break-inside:avoid;}
.tl-i::before{content:'';position:absolute;left:-16px;top:4px;width:9px;height:9px;border-radius:50%;border:2px solid ${C.card};}
.tl-t{font-size:11.5px;font-weight:700;color:${C.ink};}
.tl-d{font-size:10px;color:${C.faint};}
.tl-x{font-size:11px;color:${C.body};padding-top:2px;}

/* Complaint */
.cmp{border:1px solid ${C.line};border-left-width:4px;border-radius:10px;padding:10px 12px;margin-bottom:8px;break-inside:avoid;}
.cmp-t{font-size:12px;font-weight:800;color:${C.ink};}
.cmp-q{font-size:11px;font-style:italic;color:${C.body};border-left:2px solid ${C.line};padding-left:8px;margin-top:6px;}

/* Booking block in the batch report */
.bk{background:${C.card};border:1px solid ${C.line};border-radius:14px;margin-bottom:14px;overflow:hidden;break-inside:auto;}
.bk-h{display:flex;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid ${C.hair};background:${C.wash};flex-wrap:wrap;}
.bk-ref{font-family:${MONO};font-size:15px;font-weight:800;color:${C.ink};letter-spacing:-.02em;}
.bk-n{font-size:11px;color:${C.muted};}
.bk-b{padding:14px 16px 16px;}
.bk-sub{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:${C.faint};padding:12px 0 7px;border-top:1px solid ${C.hair};margin-top:12px;}
.bk-sub:first-child{border-top:0;margin-top:0;padding-top:0;}

.empty{font-size:11px;color:${C.faint};background:${C.wash};border-radius:8px;padding:11px 13px;text-align:center;}
.foot{font-size:10px;color:${C.faint};text-align:center;padding-top:14px;border-top:1px solid ${C.line};margin-top:6px;}
.toolbar{position:sticky;top:0;z-index:9;background:${C.ink};color:#fff;padding:9px 14px;border-radius:12px;margin-bottom:14px;display:flex;align-items:center;gap:12px;font-size:11px;}
.toolbar button{background:#fff;color:${C.ink};border:0;border-radius:8px;padding:6px 14px;font-size:11px;font-weight:800;cursor:pointer;font-family:${FONT};}

@page{size:A4;margin:12mm 10mm;}
@media print{
  body{background:#fff;font-size:10.5px;}
  .page{max-width:none;padding:0;}
  .noprint{display:none !important;}
  .sec,.call,.bk,.cmp,.tl-i,.turn{break-inside:avoid;}
  .bk{break-before:page;}
  .bk:first-of-type{break-before:auto;}
}
`.trim()

function shell(title: string, body: string, autoPrint: boolean): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head><body>
<div class="page">
${autoPrint ? `<div class="toolbar noprint">
  <span><strong>${esc(title)}</strong> — ready to save as PDF.</span>
  <button onclick="window.print()">Save as PDF</button>
  <span style="opacity:.6;margin-left:auto;">Tip: tick “Background graphics” in the print dialog.</span>
</div>` : ''}
${body}
</div>
${autoPrint ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},350)})</script>` : ''}
</body></html>`
}

// ─── Shared blocks ────────────────────────────────────────────────────────────

function coverageChips(d: FeedbackDossier): string {
  const items: [string, boolean][] = [
    ['Reconfirmation call', d.coverage.reconfirmCall],
    ['On-ground call', d.coverage.onGroundCall],
    ['Post-tour call', d.coverage.postTourCall],
    ['Feedback form', d.coverage.guestForm],
    ['Desk note', d.coverage.deskNote],
  ]
  return items
    .map(([label, on]) => pill(`${on ? '✓' : '·'} ${label}`, on ? C.good : C.faint, on ? C.goodLite : C.hair))
    .join(' ')
}

function scoreBreakdown(d: FeedbackDossier): string {
  if (!d.score.components.length) return empty('No channel produced a score for this booking.')

  const rows = d.score.components
    .map(c => `<tr>
      <td class="b">${esc(c.label)}</td>
      <td style="width:44%;">${stackBar([
        { value: c.value, color: c.value >= 70 ? C.good : c.value >= 50 ? C.warn : C.bad },
        { value: 100 - c.value, color: C.hair },
      ])}</td>
      <td class="b" style="text-align:right;white-space:nowrap;">${Math.round(c.value)}</td>
      <td class="faint">${esc(c.detail)}</td>
      <td class="faint" style="text-align:right;white-space:nowrap;">×${c.weight}</td>
    </tr>`)
    .join('')

  const penalty = d.score.complaintPenalty
    ? `<tr><td class="b" style="color:${C.bad};">Open complaints</td><td colspan="3" style="color:${C.bad};">Deduction applied for complaints still open</td><td class="b" style="text-align:right;color:${C.bad};">−${d.score.complaintPenalty}</td></tr>`
    : ''

  return `<table class="data">
    <thead><tr><th>Channel</th><th>Result</th><th style="text-align:right;">Score</th><th>Basis</th><th style="text-align:right;">Weight</th></tr></thead>
    <tbody>${rows}${penalty}</tbody>
  </table>
  <div style="padding-top:9px;font-size:11px;color:${C.body};">
    ${d.score.reasons.map(r => `<div>• ${esc(r)}</div>`).join('')}
  </div>`
}

function callCard(c: CallRecord, opts: { transcripts: boolean }): string {
  const checks = c.checks.length
    ? `<div class="checks">${c.checks
        .map(ch => pill(
          `${ch.label}: ${ch.raw}`,
          ch.answer === 'good' ? C.good : ch.answer === 'bad' ? C.bad : C.muted,
          ch.answer === 'good' ? C.goodLite : ch.answer === 'bad' ? C.badLite : C.hair,
        ))
        .join(' ')}</div>`
    : ''

  const notes = c.notes.length
    ? c.notes.map(n => `<div class="note"><div class="note-l">${esc(n.label)}</div><div class="note-t">${escMultiline(n.text)}</div></div>`).join('')
    : ''

  const transcript = opts.transcripts && c.transcript.length
    ? `<div class="tr">
        <div class="tr-h">Transcript — ${c.transcript.length} turns</div>
        ${c.transcript.map(t => `<div class="turn">
          <div class="turn-s s-${t.speaker}">${t.speaker === 'agent' ? 'AI' : t.speaker === 'customer' ? 'Guest' : 'System'}</div>
          <div class="turn-t">${escMultiline(t.text)}</div>
        </div>`).join('')}
      </div>`
    : ''

  const body = c.summary || notes || checks || transcript
    ? `${c.summary ? `<div class="summary">${escMultiline(c.summary)}</div>` : ''}${checks}${notes}${transcript}`
    : `<div class="faint" style="font-size:11px;">The call was logged but recorded no answers — nothing was captured.</div>`

  return `<div class="call" style="border-left:4px solid ${KIND_COLOR[c.kind]};">
    <div class="call-h">
      <span class="call-k">${esc(KIND_LABEL[c.kind])}${c.dayNo != null ? ` · Day ${c.dayNo}` : ''}</span>
      ${sentimentPill(c.sentiment)}
      ${c.rating != null ? pill(`${c.rating}/10`, C.brand, C.brandLite) : ''}
      ${c.outcome ? pill(c.outcome, C.muted, C.hair) : ''}
      <span class="call-d">${fmtDateTime(c.at)}</span>
    </div>
    <div class="call-b">${body}</div>
  </div>`
}

function complaintCard(c: ComplaintRecord): string {
  const color = c.severity === 'high' ? C.bad : c.severity === 'medium' ? C.warn : C.muted
  const bg = c.severity === 'high' ? C.badLite : c.severity === 'medium' ? C.warnLite : C.hair

  return `<div class="cmp" style="border-left-color:${color};">
    <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;">
      ${pill(c.severity.toUpperCase(), color, bg)}
      ${pill(c.isOpen ? 'OPEN' : c.status.toUpperCase(), c.isOpen ? C.bad : C.good, c.isOpen ? C.badLite : C.goodLite)}
      ${c.category ? pill(c.category, C.muted, C.hair) : ''}
      ${c.callKind ? pill(c.callKind, C.info, C.infoLite) : ''}
      <span class="faint" style="margin-left:auto;font-size:10px;">${fmtDateTime(c.createdAt)}</span>
    </div>
    <div class="cmp-t" style="padding-top:6px;">${esc(c.title ?? 'Complaint raised on a call')}</div>
    ${c.details ? `<div style="font-size:11px;padding-top:3px;">${escMultiline(c.details)}</div>` : ''}
    ${c.customerQuote ? `<div class="cmp-q">“${escMultiline(c.customerQuote)}”</div>` : ''}
    ${c.resolutionNote ? `<div style="font-size:11px;color:${C.good};padding-top:6px;"><strong>Resolution:</strong> ${escMultiline(c.resolutionNote)}${c.resolvedAt ? ` <span class="faint">(${fmtDateTime(c.resolvedAt)})</span>` : ''}</div>` : ''}
  </div>`
}

function formBlock(d: FeedbackDossier): string {
  if (!d.form) return empty('The guest did not submit a feedback form.')

  const rows = d.form.answers
    .map(a => `<tr>
      <td class="b">${esc(a.label)}</td>
      <td style="width:38%;">${a.score == null ? `<span class="faint">Not answered</span>` : stackBar([
        { value: a.score, color: a.score >= 4 ? C.good : a.score === 3 ? C.info : a.score === 2 ? C.warn : C.bad },
        { value: 4 - a.score, color: C.hair },
      ])}</td>
      <td style="text-align:right;white-space:nowrap;">${a.value ? pill(a.value, a.score! >= 3 ? C.good : a.score === 2 ? C.warn : C.bad, a.score! >= 3 ? C.goodLite : a.score === 2 ? C.warnLite : C.badLite) : '<span class="faint">—</span>'}</td>
    </tr>`)
    .join('')

  return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding-bottom:10px;">
      ${d.form.scorePct != null ? pill(`${d.form.scorePct}% overall`, C.brand, C.brandLite) : ''}
      ${d.form.purpose ? pill(`Purpose: ${d.form.purpose}`, C.info, C.infoLite) : ''}
      ${d.form.clientName ? `<span class="faint">Submitted by ${esc(d.form.clientName)}</span>` : ''}
      <span class="faint" style="margin-left:auto;">${fmtDateTime(d.form.submittedAt)}</span>
    </div>
    <table class="data"><tbody>${rows}</tbody></table>
    ${d.form.remarks ? `<div class="summary" style="margin-top:10px;margin-bottom:0;"><strong>Guest remarks:</strong> ${escMultiline(d.form.remarks)}</div>` : ''}`
}

function timelineBlock(d: FeedbackDossier): string {
  if (!d.timeline.length) return empty('Nothing has been recorded against this booking yet.')

  const dot: Record<string, string> = {
    call: C.brand, form: C.good, desk_note: C.info,
    complaint: C.bad, contact_log: C.faint, experience_report: C.warn,
  }

  return `<div class="tl">${d.timeline
    .map(e => `<div class="tl-i">
      <span style="position:absolute;left:-16px;top:4px;width:9px;height:9px;border-radius:50%;background:${dot[e.kind] ?? C.faint};box-shadow:0 0 0 2px ${C.card};"></span>
      <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
        <span class="tl-t">${esc(e.title)}</span>
        ${e.sentiment !== 'unknown' ? sentimentPill(e.sentiment) : ''}
        ${e.severity ? pill(e.severity.toUpperCase(), e.severity === 'high' ? C.bad : C.warn, e.severity === 'high' ? C.badLite : C.warnLite) : ''}
        <span class="tl-d" style="margin-left:auto;">${fmtDateTime(e.at)}</span>
      </div>
      ${e.detail ? `<div class="tl-x">${escMultiline(e.detail.slice(0, 400))}${e.detail.length > 400 ? '…' : ''}</div>` : ''}
    </div>`)
    .join('')}</div>`
}

function dossierKpis(d: FeedbackDossier): string {
  const s = d.stats
  return `<div class="kpis six">
    ${kpi('Calls logged', s.callsLogged, `${s.callsCompleted}/${s.callsScheduled} scheduled done`, C.brand)}
    ${kpi('Positive', s.sentiment.positive, `${s.sentiment.negative} negative`, s.sentiment.positive ? C.good : C.faint)}
    ${kpi('Service checks', `${s.goodChecks}/${s.goodChecks + s.badChecks}`, `${s.badChecks} flagged`, s.badChecks ? C.warn : C.good)}
    ${kpi('Complaints', s.complaintsTotal, `${s.complaintsOpen} still open`, s.complaintsOpen ? C.bad : C.faint)}
    ${kpi('Post-tour', s.npsRating == null ? '—' : `${s.npsRating}/10`, s.wouldRecommend == null ? 'no recommendation' : s.wouldRecommend ? 'would recommend' : 'would not recommend', s.npsRating == null ? C.faint : s.npsRating >= 8 ? C.good : s.npsRating >= 6 ? C.warn : C.bad)}
    ${kpi('Channels', `${d.coverage.count}/5`, 'produced feedback', d.coverage.count >= 3 ? C.good : d.coverage.count ? C.warn : C.faint)}
  </div>`
}

function factsBlock(d: FeedbackDossier): string {
  const f = d.facts
  return kv([
    ['Booking ref', `<span class="mono b">${esc(f.bookingRef)}</span>${f.isNumber ? ` <span class="faint">· IS ${esc(f.isNumber)}</span>` : ''}`],
    ['Guest', `${esc(f.clientName ?? '—')}${f.leadPassenger && f.leadPassenger !== f.clientName ? ` <span class="faint">(lead: ${esc(f.leadPassenger)})</span>` : ''}`],
    ['Party', `${f.pax.total} pax — ${f.pax.adults} adult${f.pax.adults === 1 ? '' : 's'}, ${f.pax.children} child${f.pax.children === 1 ? '' : 'ren'}, ${f.pax.infants} infant${f.pax.infants === 1 ? '' : 's'}`],
    ['Travel dates', `${fmtDate(f.arrivalDate)} → ${fmtDate(f.departureDate)}${f.nights != null ? ` <span class="faint">(${f.nights} night${f.nights === 1 ? '' : 's'})</span>` : ''}`],
    ['Destination', esc(f.tourDestination ?? f.operationCountry ?? '—')],
    ['Agent', `${esc(f.agent ?? '—')}${f.agentEmail ? ` <span class="faint">· ${esc(f.agentEmail)}</span>` : ''}`],
    ['Booking status', esc(f.status)],
    ['AI calls', f.callService
      ? `Registered <span class="faint">· ${esc(f.callService.status)}${f.callService.callPhone ? ` · ${esc(f.callService.callPhone)}` : ''}${f.callService.callTime ? ` · daily ${esc(f.callService.callTime)}` : ''}</span>`
      : '<span class="faint">Not registered for AI voice calls</span>'],
    ...(f.specialOccasions ? ([['Special occasions', escMultiline(f.specialOccasions)]] as [string, string][]) : []),
  ])
}

// ─── Single-booking document ──────────────────────────────────────────────────

export interface RenderOptions {
  /** Adds the sticky toolbar and fires `window.print()` on load. */
  autoPrint?: boolean
  includeTranscripts?: boolean
  /** Who pressed the button — printed in the footer for provenance. */
  generatedBy?: string | null
}

export function renderDossierHtml(d: FeedbackDossier, opts: RenderOptions = {}): string {
  const transcripts = opts.includeTranscripts !== false
  const f = d.facts
  const b = BAND[d.score.band]

  const cover = `<div class="cover">
    <div class="cover-grid">
      <div style="min-width:260px;flex:1;">
        <div class="eyebrow">Feedback Dossier</div>
        <h1>${esc(f.bookingRef)}${f.clientName ? ` — ${esc(f.clientName)}` : ''}</h1>
        <div class="sub">${esc(f.tourDestination ?? f.operationCountry ?? 'Tour')} · ${fmtDate(f.arrivalDate)} → ${fmtDate(f.departureDate)} · ${f.pax.total} pax${f.agent ? ` · ${esc(f.agent)}` : ''}</div>
        <div class="cover-chips">
          <span class="cover-chip">${d.stats.callsLogged} call${d.stats.callsLogged === 1 ? '' : 's'}</span>
          <span class="cover-chip">${d.coverage.guestForm ? 'Form submitted' : 'No form'}</span>
          <span class="cover-chip">${d.stats.complaintsOpen} open complaint${d.stats.complaintsOpen === 1 ? '' : 's'}</span>
          <span class="cover-chip">${d.coverage.count}/5 channels</span>
        </div>
      </div>
      <div class="ring-wrap">
        ${scoreRing(d.score.value, d.score.band, 104)}
        <div class="ring-band" style="color:${b.color};">${esc(b.label)}</div>
        <div class="ring-blurb">${esc(b.blurb)}</div>
      </div>
    </div>
  </div>`

  const calls = d.calls.length
    ? (['reconfirm', 'on_ground', 'post_tour'] as CallRecord['kind'][])
        .map(kind => {
          const list = d.calls.filter(c => c.kind === kind)
          if (!list.length) return ''
          return `<div class="bk-sub">${esc(KIND_LABEL[kind])} — ${list.length}</div>${list.map(c => callCard(c, { transcripts })).join('')}`
        })
        .join('')
    : empty('No AI voice call has been logged for this booking.')

  const scheduleTable = d.schedule.length
    ? `<table class="data">
        <thead><tr><th>Day</th><th>Date</th><th>Phase</th><th>Status</th><th>Attempts</th><th>Brief</th></tr></thead>
        <tbody>${d.schedule.map(s => `<tr>
          <td class="b">${s.dayNo ?? '—'}</td>
          <td>${fmtDate(s.callDate)}</td>
          <td>${esc(s.phase ?? '—')}</td>
          <td>${pill(s.status, ['done', 'answered', 'completed'].includes(s.status) ? C.good : ['missed', 'failed', 'error'].includes(s.status) ? C.bad : C.warn, ['done', 'answered', 'completed'].includes(s.status) ? C.goodLite : ['missed', 'failed', 'error'].includes(s.status) ? C.badLite : C.warnLite)}</td>
          <td>${s.attempts}</td>
          <td class="faint">${esc((s.dayBrief ?? s.error ?? '—').slice(0, 90))}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : empty('No call schedule exists for this booking.')

  const deskBlock = d.deskNotes.length
    ? d.deskNotes.map(n => `<div class="cmp" style="border-left-color:${C.info};">
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;">
          ${n.rating != null ? pill(`${n.rating}/5`, n.rating >= 4 ? C.good : n.rating >= 3 ? C.warn : C.bad, n.rating >= 4 ? C.goodLite : n.rating >= 3 ? C.warnLite : C.badLite) : pill('No rating', C.muted, C.hair)}
          ${n.savedBy ? `<span class="faint">saved by ${esc(n.savedBy)}</span>` : ''}
          <span class="faint" style="margin-left:auto;font-size:10px;">${fmtDateTime(n.createdAt)}</span>
        </div>
        ${n.comment ? `<div style="font-size:11.5px;padding-top:5px;">${escMultiline(n.comment)}</div>` : ''}
      </div>`).join('')
    : empty('The desk has not saved a rating for this booking.')

  const contactTable = d.contactLogs.length
    ? `<table class="data">
        <thead><tr><th>When</th><th>Type</th><th>Subject</th><th>Notes</th><th>By</th></tr></thead>
        <tbody>${d.contactLogs.map(l => `<tr>
          <td style="white-space:nowrap;">${fmtDateTime(l.contactedAt)}</td>
          <td>${pill(l.type, C.info, C.infoLite)}</td>
          <td class="b">${esc(l.subject)}</td>
          <td>${escMultiline((l.notes ?? '—').slice(0, 300))}</td>
          <td class="faint">${esc(l.by ?? '—')}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : empty('No contact has been logged against this booking.')

  const reportsTable = d.experienceReports.length
    ? `<table class="data">
        <thead><tr><th>Created</th><th>Status</th><th>Risk</th><th>Subject</th><th>Sent to</th><th>Sent</th></tr></thead>
        <tbody>${d.experienceReports.map(r => `<tr>
          <td style="white-space:nowrap;">${fmtDate(r.createdAt)}</td>
          <td>${pill(r.status, r.status === 'sent' ? C.good : r.status === 'held' ? C.bad : C.warn, r.status === 'sent' ? C.goodLite : r.status === 'held' ? C.badLite : C.warnLite)}</td>
          <td>${r.riskLevel === 'none' ? '<span class="faint">none</span>' : pill(`${r.riskLevel} (${r.riskScore})`, C.bad, C.badLite)}</td>
          <td>${esc(r.subject ?? r.holdReason ?? '—')}</td>
          <td class="faint">${esc(r.toEmail ?? '—')}</td>
          <td style="white-space:nowrap;">${fmtDateTime(r.sentAt)}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : empty('No experience report has been built for this booking.')

  const warnings = d.warnings.length
    ? `<div class="sec" style="border-color:${C.warn};"><div class="sec-b" style="padding:11px 16px;">
        ${d.warnings.map(w => `<div style="font-size:11px;color:${C.warn};">⚠ ${esc(w)}</div>`).join('')}
      </div></div>`
    : ''

  const body = `${cover}
${warnings}
${section('Experience score', `${d.score.value ?? '—'}/100 — ${b.label}. Weighted across the channels that spoke.`, scoreBreakdown(d))}
${section('Booking', 'Trip facts as they stand today.', `${factsBlock(d)}<div style="padding-top:11px;">${coverageChips(d)}</div>`)}
${section('At a glance', 'Everything the channels produced, counted.', dossierKpis(d))}
${section('Timeline', `${d.timeline.length} event${d.timeline.length === 1 ? '' : 's'}, newest first.`, timelineBlock(d), { tight: true })}
${section('AI call responses', `${d.stats.callsLogged} logged — reconfirmation, on-ground and post-tour${transcripts ? ', with full transcripts' : ''}.`, calls, { tight: true })}
${section('Guest feedback form', d.form ? `Submitted ${fmtDateTime(d.form.submittedAt)}.` : 'Not submitted.', formBlock(d))}
${section('Complaints & urgent asks', `${d.stats.complaintsTotal} raised, ${d.stats.complaintsOpen} still open.`, d.complaints.length ? d.complaints.map(complaintCard).join('') : empty('No complaint was raised on any call.'), { tight: true })}
${section('Desk-saved feedback', 'What the team recorded by hand.', deskBlock)}
${section('Call schedule', `${d.stats.callsScheduled} scheduled · ${d.stats.callsCompleted} done · ${d.stats.callsMissed} missed · ${d.stats.callsPending} pending.`, scheduleTable, { tight: true })}
${section('Contact log', `${d.contactLogs.length} interaction${d.contactLogs.length === 1 ? '' : 's'} recorded by the team.`, contactTable, { tight: true })}
${section('Experience reports', 'What went out to the agent afterwards.', reportsTable, { tight: true })}
<div class="foot">
  AppleHolidays MMT — Feedback Dossier for ${esc(f.bookingRef)} · generated ${fmtDateTime(d.collectedAt)}${opts.generatedBy ? ` by ${esc(opts.generatedBy)}` : ''}<br>
  Read-only snapshot of live operational data. Internal use only.
</div>`

  return shell(`Feedback Dossier — ${f.bookingRef}`, body, opts.autoPrint !== false)
}

// ─── Batch document ───────────────────────────────────────────────────────────

export function renderBatchHtml(report: BatchReport, opts: RenderOptions = {}): string {
  const transcripts = opts.includeTranscripts === true
  const t = report.totals

  const cover = `<div class="cover">
    <div class="cover-grid">
      <div style="min-width:280px;flex:1;">
        <div class="eyebrow">Bulk Feedback Report</div>
        <h1>${t.found} booking${t.found === 1 ? '' : 's'}</h1>
        <div class="sub">Every AI call, feedback form, complaint and desk note across the selected references.</div>
        <div class="cover-chips">
          <span class="cover-chip">${t.calls.logged} calls</span>
          <span class="cover-chip">${t.forms} forms</span>
          <span class="cover-chip">${t.complaints.open} open complaints</span>
          <span class="cover-chip">${t.withNoFeedback} with no feedback</span>
          ${t.missing.length ? `<span class="cover-chip">${t.missing.length} not found</span>` : ''}
        </div>
      </div>
      <div class="ring-wrap">
        ${scoreRing(t.avgScore, t.avgScore == null ? 'unknown' : t.avgScore >= 85 ? 'excellent' : t.avgScore >= 70 ? 'good' : t.avgScore >= 50 ? 'watch' : 'at_risk', 104)}
        <div class="ring-band" style="color:${C.brand};">Average</div>
        <div class="ring-blurb">Mean experience score across the batch.</div>
      </div>
    </div>
  </div>`

  const kpis = `<div class="kpis">
      ${kpi('Bookings', t.found, `${t.requested} requested${t.missing.length ? `, ${t.missing.length} not found` : ''}`, C.brand)}
      ${kpi('With feedback', t.withAnyFeedback, `${t.withNoFeedback} silent`, t.withAnyFeedback ? C.good : C.faint)}
      ${kpi('Calls logged', t.calls.logged, `${t.calls.completed}/${t.calls.scheduled} scheduled done`, C.info)}
      ${kpi('Open complaints', t.complaints.open, `${t.complaints.total} total · ${t.complaints.high} high`, t.complaints.open ? C.bad : C.faint)}
    </div>
    <div class="kpis" style="margin-top:8px;">
      ${kpi('Feedback forms', t.forms, `${t.deskNotes} desk notes`, t.forms ? C.good : C.faint)}
      ${kpi('Post-tour avg', t.npsAverage == null ? '—' : `${t.npsAverage}/10`, `${t.promoters} promoters · ${t.detractors} detractors`, t.npsAverage == null ? C.faint : t.npsAverage >= 8 ? C.good : C.warn)}
      ${kpi('Would recommend', t.recommendYes, `${t.recommendNo} would not`, t.recommendYes ? C.good : C.faint)}
      ${kpi('At risk', t.band.at_risk, `${t.band.watch} to watch · ${t.band.excellent} excellent`, t.band.at_risk ? C.bad : C.good)}
    </div>`

  const mix = `<table class="data">
    <tbody>
      <tr>
        <td class="b" style="width:120px;">Sentiment</td>
        <td>${stackBar([
          { value: t.sentiment.positive, color: C.good },
          { value: t.sentiment.neutral, color: C.info },
          { value: t.sentiment.negative, color: C.bad },
          { value: t.sentiment.unknown, color: C.line },
        ], 10)}</td>
        <td style="width:230px;white-space:nowrap;">
          ${pill(`${t.sentiment.positive} positive`, C.good, C.goodLite)}
          ${pill(`${t.sentiment.neutral} neutral`, C.info, C.infoLite)}
          ${pill(`${t.sentiment.negative} negative`, C.bad, C.badLite)}
        </td>
      </tr>
      <tr>
        <td class="b">Call mix</td>
        <td>${stackBar([
          { value: t.byKind.reconfirm, color: KIND_COLOR.reconfirm },
          { value: t.byKind.on_ground, color: KIND_COLOR.on_ground },
          { value: t.byKind.post_tour, color: KIND_COLOR.post_tour },
        ], 10)}</td>
        <td style="white-space:nowrap;">
          ${pill(`${t.byKind.reconfirm} reconfirm`, KIND_COLOR.reconfirm, C.infoLite)}
          ${pill(`${t.byKind.on_ground} on-ground`, KIND_COLOR.on_ground, C.brandLite)}
          ${pill(`${t.byKind.post_tour} post-tour`, KIND_COLOR.post_tour, C.warnLite)}
        </td>
      </tr>
      <tr>
        <td class="b">Health bands</td>
        <td>${stackBar([
          { value: t.band.excellent, color: C.good },
          { value: t.band.good, color: C.info },
          { value: t.band.watch, color: C.warn },
          { value: t.band.at_risk, color: C.bad },
          { value: t.band.unknown, color: C.line },
        ], 10)}</td>
        <td style="white-space:nowrap;">
          ${pill(`${t.band.excellent} excellent`, C.good, C.goodLite)}
          ${pill(`${t.band.watch} watch`, C.warn, C.warnLite)}
          ${pill(`${t.band.at_risk} at risk`, C.bad, C.badLite)}
        </td>
      </tr>
      <tr>
        <td class="b">Channel reach</td>
        <td colspan="2">
          ${pill(`Reconfirmation ${t.coverage.reconfirmCall}/${t.found}`, C.info, C.infoLite)}
          ${pill(`On-ground ${t.coverage.onGroundCall}/${t.found}`, C.brand, C.brandLite)}
          ${pill(`Post-tour ${t.coverage.postTourCall}/${t.found}`, C.warn, C.warnLite)}
          ${pill(`Form ${t.coverage.guestForm}/${t.found}`, C.good, C.goodLite)}
          ${pill(`Desk note ${t.coverage.deskNote}/${t.found}`, C.muted, C.hair)}
        </td>
      </tr>
    </tbody>
  </table>`

  const attention = t.attention.length
    ? `<table class="data">
        <thead><tr><th>Booking</th><th>Guest</th><th>Score</th><th>Band</th><th>Why</th></tr></thead>
        <tbody>${t.attention.map(a => `<tr>
          <td class="mono b">${esc(a.bookingRef)}</td>
          <td>${esc(a.clientName ?? '—')}</td>
          <td class="b">${a.score ?? '—'}</td>
          <td>${bandPill(a.band)}</td>
          <td>${esc(a.reason)}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : empty('Nothing in this batch needs attention — no low scores and no open complaints.')

  const categories = t.topComplaintCategories.length
    ? `<table class="data">
        <thead><tr><th>Category</th><th>Raised</th><th>Still open</th><th>Share</th></tr></thead>
        <tbody>${t.topComplaintCategories.map(c => `<tr>
          <td class="b">${esc(c.category)}</td>
          <td>${c.count}</td>
          <td style="color:${c.open ? C.bad : C.good};font-weight:700;">${c.open}</td>
          <td style="width:40%;">${stackBar([
            { value: c.count, color: C.bad },
            { value: Math.max(0, t.complaints.total - c.count), color: C.hair },
          ])}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : empty('No complaint was raised on any booking in this batch.')

  const index = `<table class="data">
    <thead><tr><th>#</th><th>Booking</th><th>Guest</th><th>Travel</th><th>Score</th><th>Calls</th><th>Form</th><th>Complaints</th><th>Channels</th></tr></thead>
    <tbody>${report.dossiers.map((d, i) => `<tr>
      <td class="faint">${i + 1}</td>
      <td class="mono b">${esc(d.facts.bookingRef)}</td>
      <td>${esc(d.facts.clientName ?? '—')}</td>
      <td style="white-space:nowrap;">${fmtDate(d.facts.arrivalDate)}</td>
      <td>${d.score.value == null ? '<span class="faint">—</span>' : `<span class="b">${d.score.value}</span>`} ${bandPill(d.score.band)}</td>
      <td>${d.stats.callsLogged}</td>
      <td>${d.coverage.guestForm ? pill('Yes', C.good, C.goodLite) : '<span class="faint">—</span>'}</td>
      <td>${d.stats.complaintsTotal ? pill(`${d.stats.complaintsOpen}/${d.stats.complaintsTotal} open`, d.stats.complaintsOpen ? C.bad : C.good, d.stats.complaintsOpen ? C.badLite : C.goodLite) : '<span class="faint">—</span>'}</td>
      <td>${d.coverage.count}/5</td>
    </tr>`).join('')}</tbody>
  </table>`

  // Per-booking detail — the whole point of the bulk tab is that it does not
  // stop at the summary. Each booking gets its own page in the printed PDF.
  const details = report.dossiers.map(d => {
    const b = BAND[d.score.band]
    const calls = d.calls.length
      ? d.calls.map(c => callCard(c, { transcripts })).join('')
      : empty('No AI voice call logged.')

    return `<div class="bk">
      <div class="bk-h">
        <span class="bk-ref">${esc(d.facts.bookingRef)}</span>
        <span class="bk-n">${esc(d.facts.clientName ?? '—')} · ${fmtDate(d.facts.arrivalDate)} → ${fmtDate(d.facts.departureDate)} · ${d.facts.pax.total} pax${d.facts.agent ? ` · ${esc(d.facts.agent)}` : ''}</span>
        <span style="margin-left:auto;display:flex;gap:6px;align-items:center;">
          ${d.score.value != null ? `<span class="b" style="font-size:17px;color:${b.color};">${d.score.value}</span>` : ''}
          ${bandPill(d.score.band)}
        </span>
      </div>
      <div class="bk-b">
        ${dossierKpis(d)}
        <div style="padding-top:10px;">${coverageChips(d)}</div>

        <div class="bk-sub">Booking</div>
        ${factsBlock(d)}

        <div class="bk-sub">AI call responses — ${d.stats.callsLogged}</div>
        ${calls}

        <div class="bk-sub">Guest feedback form</div>
        ${formBlock(d)}

        <div class="bk-sub">Complaints — ${d.stats.complaintsOpen} open of ${d.stats.complaintsTotal}</div>
        ${d.complaints.length ? d.complaints.map(complaintCard).join('') : empty('No complaint raised.')}

        <div class="bk-sub">Desk-saved feedback</div>
        ${d.deskNotes.length
          ? d.deskNotes.map(n => `<div style="font-size:11.5px;">${n.rating != null ? pill(`${n.rating}/5`, C.info, C.infoLite) : ''} ${escMultiline(n.comment ?? '—')} <span class="faint">— ${esc(n.savedBy ?? 'team')}, ${fmtDateTime(n.createdAt)}</span></div>`).join('')
          : empty('Nothing saved by the desk.')}

        <div class="bk-sub">Contact log — ${d.contactLogs.length}</div>
        ${d.contactLogs.length
          ? `<table class="data"><thead><tr><th>When</th><th>Type</th><th>Subject</th><th>Notes</th><th>By</th></tr></thead><tbody>${d.contactLogs.slice(0, 20).map(l => `<tr><td style="white-space:nowrap;">${fmtDateTime(l.contactedAt)}</td><td>${esc(l.type)}</td><td class="b">${esc(l.subject)}</td><td>${escMultiline((l.notes ?? '—').slice(0, 220))}</td><td class="faint">${esc(l.by ?? '—')}</td></tr>`).join('')}</tbody></table>`
          : empty('No contact logged.')}

        <div class="bk-sub">Score basis</div>
        ${scoreBreakdown(d)}
      </div>
    </div>`
  }).join('')

  const missing = t.missing.length
    ? section('References not matched', 'These were asked for but no booking you can see carries them.',
        `<div class="mono" style="font-size:11px;color:${C.bad};">${t.missing.map(esc).join(' · ')}</div>`)
    : ''

  const body = `${cover}
${section('Batch totals', `${t.found} of ${t.requested} reference${t.requested === 1 ? '' : 's'} matched.`, kpis)}
${section('Distribution', 'How the batch splits across sentiment, call type and health.', mix)}
${section('Needs attention', `${t.attention.length} booking${t.attention.length === 1 ? '' : 's'} scoring below good or carrying an open complaint.`, attention, { tight: true })}
${section('Complaint categories', `${t.complaints.total} complaint${t.complaints.total === 1 ? '' : 's'} across the batch.`, categories, { tight: true })}
${section('Index', 'Every booking in this report, in the order requested.', index, { tight: true })}
${missing}
${details}
<div class="foot">
  AppleHolidays MMT — Bulk Feedback Report · ${t.found} booking${t.found === 1 ? '' : 's'} · generated ${fmtDateTime(report.generatedAt)}${opts.generatedBy ? ` by ${esc(opts.generatedBy)}` : ''}<br>
  Read-only snapshot of live operational data. Internal use only.
</div>`

  return shell(`Bulk Feedback Report — ${t.found} bookings`, body, opts.autoPrint !== false)
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per booking — the spreadsheet view of the same batch. */
export function renderBatchCsv(report: BatchReport): string {
  const head = [
    'Booking Ref', 'IS Number', 'Guest', 'Agent', 'Country', 'Destination',
    'Arrival', 'Departure', 'Pax', 'Score', 'Band',
    'Calls Logged', 'Reconfirm Calls', 'On-Ground Calls', 'Post-Tour Calls',
    'Positive', 'Neutral', 'Negative',
    'Checks Good', 'Checks Bad',
    'Form Submitted', 'Form Score %', 'Form Remarks',
    'Desk Rating', 'Desk Comment',
    'Post-Tour Rating', 'Would Recommend',
    'Complaints Total', 'Complaints Open', 'Complaints High', 'Complaint Titles',
    'Channels Covered', 'Latest Call Summary',
  ]

  const rows = report.dossiers.map(d => {
    const latest = d.calls.find(c => c.summary)
    return [
      d.facts.bookingRef, d.facts.isNumber ?? '', d.facts.clientName ?? '', d.facts.agent ?? '',
      d.facts.operationCountry ?? '', d.facts.tourDestination ?? '',
      d.facts.arrivalDate?.slice(0, 10) ?? '', d.facts.departureDate?.slice(0, 10) ?? '', d.facts.pax.total,
      d.score.value ?? '', d.score.band,
      d.stats.callsLogged, d.stats.byKind.reconfirm, d.stats.byKind.on_ground, d.stats.byKind.post_tour,
      d.stats.sentiment.positive, d.stats.sentiment.neutral, d.stats.sentiment.negative,
      d.stats.goodChecks, d.stats.badChecks,
      d.form ? 'Yes' : 'No', d.form?.scorePct ?? '', d.form?.remarks ?? '',
      d.deskNotes[0]?.rating ?? '', d.deskNotes[0]?.comment ?? '',
      d.stats.npsRating ?? '', d.stats.wouldRecommend == null ? '' : d.stats.wouldRecommend ? 'Yes' : 'No',
      d.stats.complaintsTotal, d.stats.complaintsOpen, d.stats.complaintsHigh,
      d.complaints.map(c => c.title ?? c.category ?? 'complaint').join(' | '),
      `${d.coverage.count}/5`, latest?.summary ?? '',
    ].map(csvCell).join(',')
  })

  // Excel opens UTF-8 CSV correctly only with a BOM; guest names carry accents.
  return '﻿' + [head.map(csvCell).join(','), ...rows].join('\n')
}
