/**
 * The reconciliation email.
 *
 * Same shell, palette and mail-client constraints as the operations report —
 * see `email-kit.ts` for why the styling is written the way it is.
 *
 * The layout follows one argument, in order: here is what each system says,
 * here is whether the numbers match, and here is why they do not. The verdict
 * strip sits directly under the header because for most readers that single
 * line is the whole email.
 */
import {
  C, compact, csvBlock, emptyNote, esc, FONT, kpiRow, num, pill, section,
  STYLE_BLOCK, TABLE_CLOSE, tableOpen, td,
} from './email-kit'
import { formatReportDate, PERIOD_LABEL } from './report-window'
import {
  ORIGINS, ORIGIN_LABEL,
  type ConfirmationLine, type Finding, type ParityCheck, type ReconcileReportData,
} from './reconcile-report-data'
import type { OriginTally } from './reconcile-accounts-db'

export interface ReconcileSections {
  asStatus?: boolean
  opsIntake?: boolean
  accountsOutput?: boolean
  countCheck?: boolean
  b2c?: boolean
  /** The per-booking table under the count check. */
  detail?: boolean
}

export interface ReconcileRenderOptions {
  sections?: ReconcileSections
  dashboardUrl?: string | null
  scheduleName?: string
  testSend?: boolean
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

const TICK = '<span class="pill ok">✓</span>'
const CROSS = '<span class="pill bd">✗</span>'
const DASH = '<span class="na">—</span>'

function mark(ok: boolean, known = true): string {
  if (!known) return DASH
  return ok ? TICK : CROSS
}

/** The verdict as a coloured banner. One line, no hedging. */
function verdictBanner(check: ParityCheck): string {
  const tone = check.unchecked
    ? { bg: '#fffbeb', border: '#fde68a', ink: '#92400e' }
    : check.balanced
      ? { bg: '#ecfdf5', border: '#a7f3d0', ink: '#065f46' }
      : { bg: '#fef2f2', border: '#fecaca', ink: '#991b1b' }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${tone.bg};border:1px solid ${tone.border};border-radius:10px;margin-bottom:14px;">
    <tr><td style="padding:12px 14px;font:700 13px/1.6 ${FONT};color:${tone.ink};">${esc(check.verdict)}</td></tr>
  </table>`
}

/** The four counts side by side, with the shortfall called out under each. */
function checkTiles(check: ParityCheck, opsLabel: string, opsCountsAgainstVerdict: boolean): string {
  const shortNote = (n: number) => (n > 0 ? `${num(n)} missing` : 'complete')
  const shortColor = (n: number) => (n > 0 ? C.bad : C.good)

  return kpiRow([
    { label: 'Upstream', value: num(check.expected), note: 'confirmed bookings', color: C.ink },
    {
      label: opsLabel,
      value: num(check.ops),
      note: opsCountsAgainstVerdict ? shortNote(check.opsShort) : 'informational',
      color: opsCountsAgainstVerdict ? shortColor(check.opsShort) : C.muted,
    },
    { label: 'P&Ls', value: num(check.pnls), note: shortNote(check.pnlShort), color: shortColor(check.pnlShort) },
    { label: 'Invoices', value: num(check.invoices), note: shortNote(check.invoiceShort), color: shortColor(check.invoiceShort) },
  ])
}

// ─── 1. Apple System intake ───────────────────────────────────────────────────

function asSection(d: ReconcileReportData): string {
  const as = d.b2b.as

  if (!as.available) {
    return section('Apple System — raised today', 'Quotations the Apple System created in this window',
      C.bad, emptyNote(`The Apple System could not be reached: ${as.error ?? 'unknown error'}`))
  }

  const rows = as.byStatus.map(s => `<tr>
    ${td(esc(s.status), { bold: true, nowrap: true })}
    ${td(esc(s.label))}
    ${td(num(s.count), { align: 'right', bold: true })}
  </tr>`).join('')

  const body = kpiRow([
    { label: 'Confirmed', value: num(as.confirmed), note: 'status 2', color: C.good },
    { label: 'Not confirmed', value: num(as.unconfirmed), note: 'status 1 — quoted only', color: C.warn },
    { label: 'Other', value: num(as.other), note: 'cancelled and everything else', color: C.muted },
    { label: 'Total raised', value: num(as.total), note: 'every status', color: C.ink },
  ])
    + (as.unnumbered > 0
      ? `<div class="note" style="background:#fef2f2;color:#991b1b;text-align:left;padding:10px 12px;">${num(as.unnumbered)} confirmation${as.unnumbered === 1 ? '' : 's'} carry no IS number upstream — nothing downstream can match them.</div>`
      : '')
    + (rows
      ? tableOpen([{ text: 'Status' }, { text: 'Meaning' }, { text: 'Count', align: 'right' }]) + rows + TABLE_CLOSE
      : emptyNote('The Apple System raised nothing in this window.'))

  return section(
    'Apple System — raised in this window',
    'Every quotation created upstream, by status. Only status 2 is owed a booking, a P&L and an invoice.',
    C.brand, body,
  )
}

// ─── 2. OPS intake ────────────────────────────────────────────────────────────

function opsSection(d: ReconcileReportData): string {
  const ops = d.b2b.ops

  const cancelRows = ops.cancellations.map(c => `<tr>
    ${td(esc(c.ref), { bold: true, nowrap: true })}
    ${td(c.at ? esc(`${formatReportDate(c.at.slice(0, 10))} ${c.at.slice(11, 16)} UTC`) : DASH, { nowrap: true })}
    ${td(c.reason ? esc(c.reason.slice(0, 120)) : DASH)}
  </tr>`).join('')

  const body = kpiRow([
    { label: 'Created', value: num(ops.created), note: 'B2B bookings filed here', color: C.ink },
    { label: 'From this window', value: num(ops.createdFromWindow), note: "of today's confirmations", color: C.b2b },
    { label: 'Held', value: num(ops.held), note: 'confirmations matched', color: ops.missing.length ? C.warn : C.good },
    { label: 'Cancelled', value: num(ops.cancelled), note: 'cancelled in this window', color: ops.cancelled ? C.bad : C.muted },
  ])
    + (cancelRows
      ? `<div class="h3">Cancelled in this window</div>`
        + tableOpen([{ text: 'Booking' }, { text: 'Cancelled at' }, { text: 'Reason' }]) + cancelRows + TABLE_CLOSE
      : emptyNote('No bookings were cancelled in this window.'))

  return section(
    'Booking system — what OPS holds',
    'Bookings this system created and cancelled, and how many of the window\'s confirmations it holds.',
    C.b2b, body,
  )
}

// ─── 3. Accounts output ───────────────────────────────────────────────────────

function originTable(pnls: OriginTally, invoices: OriginTally): string {
  const rows = ORIGINS
    .filter(o => pnls.byOrigin[o] > 0 || invoices.byOrigin[o] > 0)
    .map(o => `<tr>
      ${td(esc(ORIGIN_LABEL[o]), { bold: true })}
      ${td(num(pnls.byOrigin[o]), { align: 'right' })}
      ${td(num(pnls.bookingsByOrigin[o]), { align: 'right', color: C.muted })}
      ${td(num(invoices.byOrigin[o]), { align: 'right' })}
      ${td(num(invoices.bookingsByOrigin[o]), { align: 'right', color: C.muted })}
    </tr>`).join('')

  if (!rows) return emptyNote('Accounts created no P&Ls or invoices in this window.')

  return tableOpen([
    { text: 'Created through' },
    { text: 'P&L rows', align: 'right' },
    { text: 'P&L bookings', align: 'right' },
    { text: 'Invoice rows', align: 'right' },
    { text: 'Invoice bookings', align: 'right' },
  ]) + rows + `<tr>
    ${td('All origins', { bold: true })}
    ${td(num(pnls.rows), { align: 'right', bold: true })}
    ${td(num(pnls.bookings), { align: 'right', bold: true })}
    ${td(num(invoices.rows), { align: 'right', bold: true })}
    ${td(num(invoices.bookings), { align: 'right', bold: true })}
  </tr>` + TABLE_CLOSE
}

function accountsSection(d: ReconcileReportData): string {
  const acc = d.b2b.accounts

  if (!acc.available) {
    return section('Accounts — produced today', 'P&Ls and invoices written in this window',
      C.bad, emptyNote(`The accounts database could not be read: ${acc.error ?? 'unknown error'}`))
  }

  const o = acc.output
  const asApi = { pnls: o.pnls.byOrigin.apple_system_api, invoices: o.invoices.byOrigin.apple_system_api }
  const byHand = ORIGINS
    .filter(x => x !== 'apple_system_api' && x !== 'b2c')
    .reduce((acc2, x) => ({
      pnls: acc2.pnls + o.pnls.byOrigin[x],
      invoices: acc2.invoices + o.invoices.byOrigin[x],
    }), { pnls: 0, invoices: 0 })

  const body = kpiRow([
    { label: 'Via the AS API', value: `${num(asApi.pnls)} / ${num(asApi.invoices)}`, note: 'P&Ls / invoices', color: C.brand },
    { label: 'Manual, OneDrive, mail', value: `${num(byHand.pnls)} / ${num(byHand.invoices)}`, note: 'P&Ls / invoices', color: C.b2b },
    { label: 'B2C sweep', value: `${num(o.pnls.byOrigin.b2c)} / ${num(o.invoices.byOrigin.b2c)}`, note: 'P&Ls / invoices', color: C.b2c },
    { label: 'Revisions', value: num(o.invoiceRevisions), note: `${num(o.cancellationInvoices)} cancellation invoice${o.cancellationInvoices === 1 ? '' : 's'}`, color: C.muted },
  ])
    + originTable(o.pnls, o.invoices)
    + `<div class="more">Row counts include every revision; the booking columns count each booking once. These figures are what accounts <em>produced</em> in the window — a P&amp;L written today for a booking confirmed last week is correct, and is why this table is not expected to equal the confirmation count.</div>`

  return section(
    'Accounts — produced in this window',
    'P&Ls and invoices written in accounts, split by the door they came through.',
    C.brandDeep, body,
  )
}

// ─── 4. The count check ───────────────────────────────────────────────────────

function detailTable(lines: ConfirmationLine[], maxRows: number, accountsKnown: boolean): string {
  if (!lines.length) return emptyNote('No confirmations to follow through in this window.')

  // Broken bookings first — a reader scanning the top of the table should be
  // looking at the ones that need work, not at page one of the alphabet.
  const sorted = [...lines].sort((a, b) => Number(a.whole) - Number(b.whole) || a.label.localeCompare(b.label))
  const shown = sorted.slice(0, maxRows)

  const rows = shown.map(l => `<tr>
    ${td(esc(l.label), { bold: true, nowrap: true })}
    ${td(esc(l.country ?? '—'))}
    ${td(esc(formatReportDate(l.createdDate)), { nowrap: true })}
    ${td(mark(l.inOps, !!l.ref), { align: 'center' })}
    ${td(mark(l.hasPnl, !!l.ref && accountsKnown), { align: 'center' })}
    ${td(mark(l.hasInvoice, !!l.ref && accountsKnown), { align: 'center' })}
  </tr>`).join('')

  const more = sorted.length > shown.length
    ? `<div class="more">Showing ${num(shown.length)} of ${num(sorted.length)} confirmations — the attached CSV carries every row.</div>`
    : ''

  return tableOpen([
    { text: 'Booking' }, { text: 'Country' }, { text: 'Confirmed' },
    { text: 'OPS', align: 'center', width: '46' },
    { text: 'P&L', align: 'center', width: '46' },
    { text: 'Invoice', align: 'center', width: '56' },
  ]) + rows + TABLE_CLOSE + more
}

function countCheckSection(d: ReconcileReportData, maxRows: number, withDetail: boolean): string {
  const body = verdictBanner(d.b2b.check)
    + checkTiles(d.b2b.check, 'OPS bookings', true)
    + (withDetail ? detailTable(d.b2b.as.confirmations, maxRows, d.b2b.accounts.available) : '')

  return section(
    'Count check — B2B',
    'One booking counts once. These four numbers must be equal.',
    d.b2b.check.balanced ? C.good : C.bad,
    body,
  )
}

// ─── 5. B2C ───────────────────────────────────────────────────────────────────

function b2cSection(d: ReconcileReportData, maxRows: number): string {
  const b = d.b2c

  if (!b.available) {
    return section('Aahaas B2C', 'Storefront orders, their P&Ls and their invoices',
      C.warn, emptyNote(`The B2C channel could not be checked: ${b.error ?? 'unknown error'}`))
  }

  const shown = b.lines.slice(0, maxRows)
  const rows = shown.map(l => `<tr>
    ${td(esc(`#${l.orderId}`), { bold: true, nowrap: true })}
    ${td(l.bookedDate ? esc(formatReportDate(l.bookedDate)) : DASH, { nowrap: true })}
    ${td(l.serviceDate ? esc(formatReportDate(l.serviceDate)) : (l.flightOnly ? '<span class="na">flight</span>' : DASH), { nowrap: true })}
    ${td(mark(l.inOps, l.importable !== false), { align: 'center' })}
    ${td(mark(l.hasPnl), { align: 'center' })}
    ${td(mark(l.hasInvoice), { align: 'center' })}
  </tr>`).join('')

  const body = verdictBanner(b.check)
    + checkTiles(b.check, 'OPS bookings', false)
    + kpiRow([
      { label: 'Orders booked', value: num(b.orders), note: 'in the storefront', color: C.b2c },
      {
        label: 'Filed in OPS',
        value: `${num(b.opsHeld)} / ${num(b.orders - (b.notImportable?.length ?? 0))}`,
        // The denominator is the orders OPS could file, not every order taken:
        // a flight sale with no service date is outside the importer by
        // construction, and counting it here read as a shortfall every day.
        note: b.notImportable?.length
          ? `${num(b.notImportable.length)} flight order${b.notImportable.length === 1 ? '' : 's'} outside the importer`
          : `${num(b.opsCreated)} created here in the window`,
        color: C.muted,
      },
      { label: 'With a P&L', value: num(b.withPnl), note: b.missingPnl.length ? `${num(b.missingPnl.length)} missing` : 'complete', color: b.missingPnl.length ? C.bad : C.good },
      { label: 'Invoiced', value: num(b.withInvoice), note: b.missingInvoice.length ? `${num(b.missingInvoice.length)} missing` : 'complete', color: b.missingInvoice.length ? C.bad : C.good },
    ])
    + (rows
      ? tableOpen([
          { text: 'Order' }, { text: 'Booked' }, { text: 'Service' },
          { text: 'OPS', align: 'center', width: '46' },
          { text: 'P&L', align: 'center', width: '46' },
          { text: 'Invoice', align: 'center', width: '56' },
        ]) + rows + TABLE_CLOSE
          + (b.lines.length > shown.length
            ? `<div class="more">Showing ${num(shown.length)} of ${num(b.lines.length)} orders — the attached CSV carries every row.</div>`
            : '')
      : emptyNote('The storefront took no travel orders in this window.'))
    + `<div class="more">The storefront stores neither a P&amp;L nor an invoice — the rows in accounts are the only durable record these orders will ever have. OPS files only orders whose service date is still ahead, so its column is reported but never counted against the verdict. An order marked <span class="na">flight</span> carries no service date at all — the importer cannot see it, so its OPS column reads &mdash; rather than a cross.</div>`

  return section(
    'Aahaas B2C',
    'Storefront orders taken in this window, followed into accounts.',
    b.check.balanced ? C.good : C.bad,
    body,
  )
}

// ─── 6. Why ───────────────────────────────────────────────────────────────────

const FINDING_TONE: Record<Finding['severity'], { bg: string; border: string; ink: string; word: string }> = {
  critical: { bg: '#fef2f2', border: '#fecaca', ink: '#991b1b', word: 'ACTION' },
  warning: { bg: '#fffbeb', border: '#fde68a', ink: '#92400e', word: 'CHECK' },
  info: { bg: '#f8fafc', border: '#e2e8f0', ink: '#475569', word: 'NOTE' },
}

function findingsSection(d: ReconcileReportData): string {
  if (d.balanced && !d.findings.length) {
    return section('Why', 'What is behind the numbers', C.good,
      emptyNote('Every system agrees. Nothing to explain.'))
  }

  const narrative = d.narrative
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;margin-bottom:14px;">
        <tr><td style="padding:14px 16px;">
          <div style="font:700 11px/1.4 ${FONT};color:#0e7490;text-transform:uppercase;letter-spacing:.08em;">Written explanation</div>
          <div style="font:400 13px/1.7 ${FONT};color:#134e4a;padding-top:7px;">${esc(d.narrative).replace(/\n/g, '<br>')}</div>
        </td></tr>
      </table>`
    : ''

  const cards = d.findings.map(f => {
    const tone = FINDING_TONE[f.severity]
    const refs = f.refs.length
      ? `<div style="font:400 11px/1.7 ${FONT};color:${tone.ink};opacity:.85;padding-top:7px;word-break:break-word;">${f.refs.map(r => esc(r)).join(' · ')}</div>`
      : ''
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${tone.bg};border:1px solid ${tone.border};border-radius:8px;margin-bottom:10px;">
      <tr><td style="padding:12px 14px;">
        <div>${pill(tone.word, '#ffffff', tone.ink)} <span style="font:700 13px/1.5 ${FONT};color:${tone.ink};">${esc(f.title)}</span></div>
        <div style="font:400 12px/1.7 ${FONT};color:${tone.ink};padding-top:6px;">${esc(f.detail)}</div>
        ${refs}
      </td></tr>
    </table>`
  }).join('')

  return section(
    'Why the numbers differ',
    'Each cause the data can prove, and the bookings behind it.',
    d.findings.some(f => f.severity === 'critical') ? C.bad : C.warn,
    narrative + (cards || emptyNote('No cause could be isolated from the data.')),
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function headerBlock(d: ReconcileReportData, opts: ReconcileRenderOptions): string {
  const badge = [
    opts.testSend ? 'TEST SEND' : '',
    d.window.anchored ? `BACK-DATED TO ${formatReportDate(d.window.toDate).toUpperCase()}` : '',
  ].filter(Boolean).map(text =>
    `<span style="display:inline-block;margin-left:5px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.18);color:#ffffff;font:700 10px/1.5 ${FONT};letter-spacing:.08em;">${esc(text)}</span>`,
  ).join('')

  return `
  <tr><td style="background:${C.brandDeep};background-image:linear-gradient(135deg,${C.brandDeep} 0%,${C.brand} 100%);padding:26px 24px;border-radius:16px 16px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <div style="font:700 11px/1.4 ${FONT};color:rgba(255,255,255,.72);text-transform:uppercase;letter-spacing:.14em;">AppleHolidays Operations</div>
          <div style="font:800 24px/1.25 ${FONT};color:#ffffff;padding-top:6px;letter-spacing:-0.02em;">${esc(PERIOD_LABEL[d.window.period])} Reconciliation</div>
          <div style="font:400 13px/1.5 ${FONT};color:rgba(255,255,255,.82);padding-top:5px;">${esc(d.window.label)}</div>
        </td>
        <td align="right" valign="top" style="white-space:nowrap;">${badge}</td>
      </tr>
    </table>
  </td></tr>`
}

/** The single line the whole mail exists to deliver. */
function verdictStrip(d: ReconcileReportData): string {
  const unchecked = d.b2b.check.unchecked || d.b2c.check.unchecked
  const bg = unchecked ? '#7c2d12' : d.balanced ? '#065f46' : '#7f1d1d'
  const word = unchecked ? 'PARTLY CHECKED' : d.balanced ? 'BALANCED' : 'NOT BALANCED'

  const cells = [
    { label: 'AS confirmed', value: num(d.b2b.as.confirmed) },
    { label: 'OPS bookings', value: num(d.b2b.check.ops) },
    { label: 'P&Ls', value: num(d.b2b.check.pnls) },
    { label: 'Invoices', value: num(d.b2b.check.invoices) },
    { label: 'B2C orders', value: d.b2c.available ? num(d.b2c.orders) : '—' },
    { label: 'B2C invoices', value: d.b2c.available ? num(d.b2c.withInvoice) : '—' },
  ]

  return `
  <tr><td style="background:${bg};padding:14px 18px;">
    <div style="font:800 12px/1.4 ${FONT};color:#ffffff;letter-spacing:.14em;text-transform:uppercase;padding-bottom:10px;">${word}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${cells.map(c => `<td width="${Math.floor(100 / cells.length)}%" align="center" style="padding:2px 4px;">
        <div style="font:800 22px/1.2 ${FONT};color:#ffffff;">${c.value}</div>
        <div style="font:700 10px/1.4 ${FONT};color:rgba(255,255,255,.66);text-transform:uppercase;letter-spacing:.08em;padding-top:3px;">${esc(c.label)}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>`
}

export function renderReconcileEmail(
  d: ReconcileReportData,
  opts: ReconcileRenderOptions = {},
  maxRows = 40,
): string {
  const want = {
    asStatus: opts.sections?.asStatus !== false,
    opsIntake: opts.sections?.opsIntake !== false,
    accountsOutput: opts.sections?.accountsOutput !== false,
    countCheck: opts.sections?.countCheck !== false,
    b2c: opts.sections?.b2c !== false,
    detail: opts.sections?.detail !== false,
  }

  const body = [
    // The check leads: for most readers the verdict and the four numbers under
    // it are the entire email, and everything below is the evidence for them.
    want.countCheck ? countCheckSection(d, maxRows, want.detail) : '',
    findingsSection(d),
    want.asStatus ? asSection(d) : '',
    want.opsIntake ? opsSection(d) : '',
    want.accountsOutput ? accountsSection(d) : '',
    want.b2c ? b2cSection(d, maxRows) : '',
  ].join('')

  const footerLink = opts.dashboardUrl
    ? `<a href="${esc(opts.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:${C.brand};color:#ffffff;text-decoration:none;border-radius:8px;font:700 13px/1 ${FONT};">Open the dashboard</a>`
    : ''

  return compact(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(PERIOD_LABEL[d.window.period])} Reconciliation</title>
<style type="text/css">${STYLE_BLOCK}</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(d.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;padding:22px 12px;">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;">
      ${headerBlock(d, opts)}
      ${verdictStrip(d)}
      <tr><td style="background:#ffffff;padding:20px 18px 6px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${body}
        </table>
      </td></tr>
      <tr><td align="center" style="background:#ffffff;padding:6px 18px 24px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};border-radius:0 0 16px 16px;">
        ${footerLink}
        <div class="foot">
          ${esc(opts.scheduleName ? `“${opts.scheduleName}” · ` : '')}Apple System · Booking system · Accounts · Aahaas B2C<br>
          Generated ${esc(new Date(d.generatedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC · days resolved in ${esc(d.window.timezone)}<br>
          Automated report from AppleHolidays MMT — replies are not monitored.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`)
}

/** Subject line: triage-able from the inbox list without opening the mail. */
export function renderReconcileSubject(
  d: ReconcileReportData,
  opts: { prefix?: string; testSend?: boolean } = {},
): string {
  const range = d.window.period === 'DAILY'
    ? formatReportDate(d.window.fromDate)
    : `${formatReportDate(d.window.fromDate)}–${formatReportDate(d.window.toDate)}`

  const c = d.b2b.check
  const state = c.unchecked || d.b2c.check.unchecked
    ? 'PARTLY CHECKED'
    : d.balanced ? 'balanced' : 'NOT BALANCED'

  const parts = [`${c.expected} confirmed`, `${c.ops} OPS`, `${c.pnls} P&L`, `${c.invoices} inv`]
  if (d.b2c.available) parts.push(`B2C ${d.b2c.orders}/${d.b2c.withInvoice}`)

  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}Reconciliation · ${range} · ${state} · ${parts.join(', ')}`
}

// ─── CSV attachment ───────────────────────────────────────────────────────────

export function renderReconcileCsv(d: ReconcileReportData): string {
  const rows: string[] = []

  csvBlock(rows, 'Count check', ['Channel', 'Upstream', 'OPS bookings', 'P&Ls', 'Invoices', 'OPS short', 'P&L short', 'Invoice short', 'Verdict'],
    [d.b2b.check, d.b2c.check].map(c =>
      [c.label, c.expected, c.ops, c.pnls, c.invoices, c.opsShort, c.pnlShort, c.invoiceShort, c.verdict]))

  csvBlock(rows, 'Apple System by status', ['Status', 'Meaning', 'Count'],
    d.b2b.as.byStatus.map(s => [s.status, s.label, s.count]))

  csvBlock(rows, 'Confirmations followed through', ['Booking', 'Quotation', 'Country', 'Confirmed on', 'In OPS', 'Has P&L', 'Has invoice'],
    d.b2b.as.confirmations.map(l =>
      [l.label, l.quotationNo, l.country ?? '', l.createdDate, l.inOps ? 'yes' : 'no', l.hasPnl ? 'yes' : 'no', l.hasInvoice ? 'yes' : 'no']))

  const o = d.b2b.accounts.output
  csvBlock(rows, 'Accounts produced in the window', ['Created through', 'P&L rows', 'P&L bookings', 'Invoice rows', 'Invoice bookings'],
    ORIGINS.map(x => [ORIGIN_LABEL[x], o.pnls.byOrigin[x], o.pnls.bookingsByOrigin[x], o.invoices.byOrigin[x], o.invoices.bookingsByOrigin[x]]))

  csvBlock(rows, 'OPS cancellations', ['Booking', 'Cancelled at', 'Reason'],
    d.b2b.ops.cancellations.map(c => [c.ref, c.at, c.reason ?? '']))

  csvBlock(rows, 'Aahaas B2C orders', ['Order', 'Booked', 'Service date', 'Flight only', 'In OPS', 'Has P&L', 'Has invoice'],
    d.b2c.lines.map(l => [
      l.orderId, l.bookedDate ?? '', l.serviceDate ?? '', l.flightOnly ? 'yes' : 'no',
      l.importable === false ? 'n/a' : l.inOps ? 'yes' : 'no',
      l.hasPnl ? 'yes' : 'no', l.hasInvoice ? 'yes' : 'no',
    ]))

  csvBlock(rows, 'Findings', ['Severity', 'Title', 'Detail', 'References'],
    d.findings.map(f => [f.severity, f.title, f.detail, f.refs.join(' ')]))

  return rows.join('\n')
}
