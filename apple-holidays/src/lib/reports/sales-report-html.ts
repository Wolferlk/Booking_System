/**
 * The Daily Sales Report email.
 *
 * Built from the same kit as the Daily Ops Report (`email-kit.ts`) — the same
 * 680px table shell, header gradient, ribbon and section cards — so the two
 * mails land in the same inbox reading as one product. What is different is
 * the shape of the story: a sales mail leads with *where to look*, then walks
 * the funnel from the first AI prompt to the invoice, and only then breaks the
 * day down by market, partner, consultant and hour.
 *
 * Every number on it comes from `sales-report-data.ts`; this file adds,
 * divides and infers nothing beyond formatting and the bar widths.
 */
import {
  bar, C, compact, emptyNote, esc, FONT, kpiRow, money, moreNote, num, pill, section, shortDate,
  STYLE_BLOCK, TABLE_CLOSE, tableOpen, td, trend, truncate,
} from './email-kit'
import { formatReportDate, PERIOD_LABEL } from './report-window'
import type { MoneyByCurrency } from './booking-lines'
import type { Highlight, SalesReportData } from './sales-report-data'
import type { PipelineCounts } from './sales-pipeline-data'
import { teamLabel } from './sales-teams'

export interface SalesSections {
  salesHighlights?: boolean
  salesBookings?: boolean
  salesRevenue?: boolean
  salesPipeline?: boolean
  salesCalls?: boolean
  salesSignups?: boolean
  salesAdoption?: boolean
  salesStaff?: boolean
  salesActivity?: boolean
}

export interface SalesRenderOptions {
  sections?: SalesSections
  narrative?: string | null
  dashboardUrl?: string | null
  scheduleName?: string
  testSend?: boolean
  maxRows?: number
  workbookAttached?: boolean
  workbookSheets?: string[]
}

/** The heatmap's cells and five shades — emitted once beside the shared kit.
 *  `q0`–`q4`, not `h*`: the kit already owns `.h3` for sub-headings. */
const HEAT_STYLE = '.hm{height:16px;border:1px solid #ffffff;font-size:0;line-height:0;}'
  + '.q0{background:#f1f5f9;}.q1{background:#99d5cf;}.q2{background:#4fb3a9;}.q3{background:#14897e;}.q4{background:#0b5c55;}'

const ACCENT = {
  look: '#dc2626',
  funnel: '#0f766e',
  bookings: '#2563eb',
  revenue: '#059669',
  pipeline: '#4f46e5',
  calls: '#0284c7',
  signups: '#db2777',
  adoption: '#7c3aed',
  staff: '#d97706',
  activity: '#134e4a',
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/** "USD 12,340 · LKR 220,000" — money never crosses a currency. */
function moneyLine(list: MoneyByCurrency[], max = 3, decimals = false): string {
  if (!list.length) return '—'
  const fmt = (m: MoneyByCurrency) => decimals
    ? money(m.total, m.currency)
    : `${esc(m.currency)} ${Math.round(m.total).toLocaleString('en-US')}`
  const shown = list.slice(0, max).map(fmt).join(' · ')
  return list.length > max ? `${shown} · +${list.length - max}` : shown
}

/** The headline figure for a money tile: the biggest currency, others in the note. */
function moneyHeadline(list: MoneyByCurrency[]): { value: string; note: string } {
  if (!list.length) return { value: '—', note: 'nothing priced' }
  const [first, ...rest] = list
  return {
    value: `<span style="font-size:15px;font-weight:700;">${esc(first.currency)}</span> ${compactMoney(first.total)}`,
    note: rest.length ? rest.slice(0, 2).map(m => `${esc(m.currency)} ${compactMoney(m.total)}`).join(' · ') : 'single currency',
  }
}

function compactMoney(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`
  if (a >= 10_000) return `${Math.round(n / 1000).toLocaleString('en-US')}k`
  return Math.round(n).toLocaleString('en-US')
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

function cmp(now: number, before: number | null | undefined): string {
  return before === null || before === undefined ? '' : trend(now, before)
}

function vsNote(before: number | null | undefined, word: string): string {
  return before === null || before === undefined ? '&nbsp;' : `${num(before)} ${esc(word)}`
}

function timeOnly(isoAt: string, tz: string): string {
  if (!isoAt) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(isoAt))
  } catch { return isoAt.slice(11, 16) }
}

function whenCell(isoAt: string, d: SalesReportData): string {
  return d.window.days === 1 ? timeOnly(isoAt, d.window.timezone) : shortDate(isoAt)
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

const SEV: Record<Highlight['severity'], { bg: string; ink: string; edge: string; word: string }> = {
  critical: { bg: '#fef2f2', ink: '#991b1b', edge: '#dc2626', word: 'Act now' },
  warning: { bg: '#fffbeb', ink: '#92400e', edge: '#d97706', word: 'Attention' },
  watch: { bg: '#eff6ff', ink: '#1e40af', edge: '#2563eb', word: 'Watch' },
  good: { bg: '#ecfdf5', ink: '#065f46', edge: '#059669', word: 'Going well' },
}

function highlightsSection(d: SalesReportData): string {
  const cards = d.highlights.map(h => {
    const s = SEV[h.severity]
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.bg};border-left:4px solid ${s.edge};border-radius:8px;margin-bottom:8px;">
      <tr><td style="padding:10px 14px;">
        <div><span class="pill" style="background:#ffffff;color:${s.ink};">${esc(s.word)}</span>
        <span style="font:700 13px/1.4 ${FONT};color:${s.ink};padding-left:6px;">${esc(h.title)}</span></div>
        <div style="font:400 12px/1.6 ${FONT};color:${C.body};padding-top:5px;">${esc(h.detail)}</div>
      </td></tr></table>`
  }).join('')
  return section('Where to look', 'Derived from the figures below by fixed rules — no AI decides what matters.', ACCENT.look, cards)
}

/**
 * The funnel, from the first AI prompt to the invoice. Bars are scaled to the
 * widest stage; each stage names the system it is read from, because the six
 * numbers come from four databases and are not a single cohort.
 */
function funnelBlock(d: SalesReportData): string {
  const c = d.pipeline.counts
  const p = d.pipeline.available
  const stages: { label: string; value: number | null; note: string; color: string }[] = [
    { label: 'AI prompts', value: p ? c.adoption.prompts : null, note: `${p ? num(c.adoption.aiUsers) : '—'} people · Travel Quote GPT`, color: '#7c3aed' },
    { label: 'Quotations issued', value: p ? c.newQuotes : null, note: `${p ? num(c.amendments) : '—'} amendments · Travel Quote GPT`, color: '#4f46e5' },
    { label: 'Quotes confirmed', value: p ? c.confirmations : null, note: `dated by confirmation · Travel Quote GPT`, color: '#2563eb' },
    { label: 'Bookings confirmed', value: d.bookings.available ? d.bookings.total : null, note: `${num(d.bookings.pax)} guests · Booking system`, color: '#0284c7' },
    { label: 'Invoiced as new', value: d.invoices.available ? d.invoices.newCount : null, note: `${moneyLine(d.invoices.newValue, 2)} · Accounts`, color: '#059669' },
    { label: 'B2C store orders', value: d.store.available ? d.store.orders : null, note: `${moneyLine(d.store.value, 2)} · Aahaas store`, color: '#db2777' },
  ]
  const max = Math.max(1, ...stages.map(s => s.value ?? 0))
  const rows = stages.map(s => `<tr>
    <td width="34%" style="padding:6px 8px 6px 0;font:700 12px/1.3 ${FONT};color:${C.ink};white-space:nowrap;">${esc(s.label)}</td>
    <td width="12%" align="right" style="padding:6px 10px 6px 0;font:800 16px/1.2 ${FONT};color:${s.color};">${s.value === null ? '—' : num(s.value)}</td>
    <td style="padding:6px 0;">${s.value === null ? '<span class="sub">unavailable</span>' : bar(s.value, max, s.color)}<div class="sub" style="padding-top:3px;">${s.note}</div></td>
  </tr>`).join('')
  return `<div class="h3">The sales funnel</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`
}

function bookingsSection(d: SalesReportData, maxRows: number): string {
  const b = d.bookings
  if (!b.available) return section('Confirmed bookings', 'Booking system', ACCENT.bookings, emptyNote(`Bookings could not be read${b.error ? ` — ${b.error}` : ''}.`))
  const value = moneyHeadline(b.value)
  const tiles = kpiRow([
    { label: 'Confirmed', value: num(b.total), note: `${cmp(b.total, b.previousTotal)} ${b.previousTotal !== null ? `${num(b.previousTotal)} before` : ''}`, color: ACCENT.bookings },
    { label: 'Guests', value: num(b.pax), note: b.avgPax !== null ? `avg party ${b.avgPax}` : '&nbsp;' },
    { label: 'Quoted value', value: value.value, note: value.note, color: ACCENT.revenue },
    { label: 'Lead time', value: b.avgLeadDays !== null ? `${b.avgLeadDays}d` : '—', note: b.avgNights !== null ? `avg ${b.avgNights} nights` : '&nbsp;' },
  ])
  const channel = `<div class="sub" style="padding-bottom:12px;">${pill(`B2B ${num(b.b2b)}`, '#ffffff', C.b2b)} ${pill(`B2C ${num(b.b2c)}`, '#ffffff', C.b2c)}${b.hotelOnly ? ` ${pill(`${num(b.hotelOnly)} hotel only`, '#92400e', '#fffbeb')}` : ''}
    &nbsp;Counted as the Daily Ops Report counts them${b.created?.basis === 'apple' ? ' — the Apple System confirmations of the window' : ' — bookings filed here in the window'}.</div>`

  const maxM = Math.max(1, ...b.markets.map(m => m.bookings))
  const markets = b.markets.length
    ? `<div class="h3">By market</div>${tableOpen([{ text: 'Market' }, { text: 'Bookings', align: 'right' }, { text: 'Guests', align: 'right' }, { text: 'Lead', align: 'right' }, { text: 'Quoted value', align: 'right' }, { text: '', width: '26%' }])}
      ${b.markets.map(m => `<tr>${td(esc(m.label), { bold: true })}${td(num(m.bookings), { align: 'right', bold: true })}${td(num(m.pax), { align: 'right' })}${td(m.avgLeadDays !== null ? `${m.avgLeadDays}d` : '—', { align: 'right' })}${td(moneyLine(m.quoted, 2), { align: 'right', nowrap: true })}<td class="c">${bar(m.bookings, maxM, ACCENT.bookings)}</td></tr>`).join('')}${TABLE_CLOSE}`
    : ''

  const partners = b.partners.filter(p => p.bookings || p.invoicedNew).slice(0, 12)
  const maxP = Math.max(1, ...partners.map(p => p.bookings))
  const partnerTable = partners.length
    ? `<div class="h3" style="padding-top:18px;">Top partners</div>${tableOpen([{ text: 'Partner' }, { text: 'Bookings', align: 'right' }, { text: 'Guests', align: 'right' }, { text: 'Invoiced new', align: 'right' }, { text: 'Amended', align: 'right' }, { text: 'Share', width: '18%' }])}
      ${partners.map(p => `<tr>${td(truncate(p.agent, 34), { bold: true })}${td(num(p.bookings), { align: 'right', bold: true })}${td(num(p.pax), { align: 'right' })}${td(p.invoicedNew ? `${num(p.invoicedNew)}<div class="sub">${moneyLine(p.invoicedNewValue, 1)}</div>` : '—', { align: 'right' })}${td(p.amended ? num(p.amended) : '—', { align: 'right' })}<td class="c">${bar(p.bookings, maxP, '#6366f1')}<div class="sub">${pct(p.share)}</div></td></tr>`).join('')}${TABLE_CLOSE}
      ${moreNote(partners.length, b.partners.length, 'partners')}`
    : ''

  const rows = b.lines.slice(0, maxRows)
  const list = rows.length
    ? `<div class="h3" style="padding-top:18px;">The bookings</div>${tableOpen([{ text: 'Ref' }, { text: 'Partner' }, { text: 'Market' }, { text: 'Arrival' }, { text: 'Pax', align: 'right' }, { text: 'Value', align: 'right' }])}
      ${rows.map(l => `<tr>${td(`${esc(l.bookingRef)}${l.source === 'B2C' ? ` <span class="pill sc">B2C</span>` : ''}`, { bold: true, nowrap: true })}${td(truncate(l.agent, 26))}${td(esc(l.countryLabel))}${td(shortDate(l.arrivalDate), { nowrap: true })}${td(num(l.pax), { align: 'right' })}${td(l.quotedTotal !== null ? money(l.quotedTotal, l.currency) : '—', { align: 'right', nowrap: true })}</tr>`).join('')}${TABLE_CLOSE}
      ${moreNote(rows.length, b.lines.length, 'bookings')}`
    : emptyNote('No confirmed bookings in this window.')

  const missing = b.missingRefs.length
    ? `<div style="margin-top:12px;padding:10px 12px;border-radius:8px;background:#fef2f2;color:#991b1b;font:400 12px/1.6 ${FONT};"><b>${num(b.missingRefs.length)} confirmed but not filed here:</b> ${esc(b.missingRefs.slice(0, 20).join(', '))}</div>`
    : ''

  return section('Confirmed bookings', `What was sold — ${d.window.label}`, ACCENT.bookings, tiles + channel + markets + partnerTable + list + missing)
}

function revenueSection(d: SalesReportData, maxRows: number): string {
  const inv = d.invoices
  const s = d.store
  let body = ''
  if (inv.available) {
    const nv = moneyHeadline(inv.newValue)
    const av = moneyHeadline(inv.amendedValue)
    body += kpiRow([
      { label: 'Invoiced new', value: num(inv.newCount), note: `${cmp(inv.newCount, inv.previousNewCount)} ${inv.previousNewCount !== null ? `${num(inv.previousNewCount)} before` : ''}`, color: ACCENT.revenue },
      { label: 'New value', value: nv.value, note: nv.note, color: ACCENT.revenue },
      { label: 'Re-issued', value: num(inv.amendedCount), note: 'older confirmations amended' },
      { label: 'Re-issued value', value: av.value, note: av.note },
    ])
    const top = [...inv.newLines].sort((a, b) => b.amount - a.amount).slice(0, Math.min(10, maxRows))
    body += top.length
      ? `<div class="h3">Largest new invoices</div>${tableOpen([{ text: 'Booking' }, { text: 'Invoice' }, { text: 'Partner' }, { text: 'Guest' }, { text: 'Amount', align: 'right' }])}
        ${top.map(l => `<tr>${td(esc(l.ref), { bold: true, nowrap: true })}${td(esc(l.invoiceNumber), { nowrap: true })}${td(truncate(l.agent, 24))}${td(truncate(l.guest, 22))}${td(money(l.amount, l.currency), { align: 'right', nowrap: true, bold: true })}</tr>`).join('')}${TABLE_CLOSE}
        ${moreNote(top.length, inv.newLines.length, 'new invoices')}`
      : emptyNote('No new invoices in this window.')
  } else body += emptyNote(`Invoices unavailable — ${inv.error ?? 'the accounts ledger could not be read'}.`)

  body += `<div class="h3" style="padding-top:18px;">Aahaas B2C store</div>`
  if (s.available) {
    const sv = moneyHeadline(s.value)
    body += kpiRow([
      { label: 'Orders placed', value: num(s.orders), note: `${cmp(s.orders, s.previousOrders)} ${s.previousOrders !== null ? `${num(s.previousOrders)} before` : ''}`, color: '#db2777' },
      { label: 'Products sold', value: num(s.lines), note: 'travel lines' },
      { label: 'Store value', value: sv.value, note: sv.note, color: '#db2777' },
    ])
    body += s.byCategory.length
      ? `${tableOpen([{ text: 'Category' }, { text: 'Orders', align: 'right' }, { text: 'Lines', align: 'right' }, { text: 'Value', align: 'right' }])}
        ${s.byCategory.map(c => `<tr>${td(esc(c.category), { bold: true })}${td(num(c.orders), { align: 'right' })}${td(num(c.lines), { align: 'right' })}${td(moneyLine(c.value, 2), { align: 'right', nowrap: true })}</tr>`).join('')}${TABLE_CLOSE}`
      : emptyNote('No storefront orders in this window.')
  } else body += emptyNote(s.error ?? 'The Aahaas B2C store could not be read.')

  return section('Revenue', 'Invoices from the accounts ledger, and the Aahaas storefront — read-only', ACCENT.revenue, body)
}

function pipelineUnavailable(d: SalesReportData, title: string, accent: string): string | null {
  if (d.pipeline.available) return null
  return section(title, 'Travel Quote GPT', accent, emptyNote(d.pipeline.error ?? 'Travel Quote GPT could not be read.'))
}

function pipelineSection(d: SalesReportData): string {
  const off = pipelineUnavailable(d, 'Quotation pipeline', ACCENT.pipeline)
  if (off) return off
  const c = d.pipeline.counts
  const pv: PipelineCounts | null = d.pipeline.previous
  const word = d.window.days === 1 ? 'the day before' : 'before'
  const qv = moneyHeadline(c.quotedValue)
  const cv = moneyHeadline(c.confirmedValue)
  const body = kpiRow([
    { label: 'New quotations', value: num(c.newQuotes), note: `${cmp(c.newQuotes, pv?.newQuotes)} ${vsNote(pv?.newQuotes, word)}`, color: ACCENT.pipeline },
    { label: 'Amendments', value: num(c.amendments), note: vsNote(pv?.amendments, word) },
    { label: 'Confirmed', value: num(c.confirmations), note: `${cmp(c.confirmations, pv?.confirmations)} ${vsNote(pv?.confirmations, word)}`, color: ACCENT.bookings },
    { label: 'Confirmed of quoted', value: pct(c.conversion), note: `${num(c.cohortConfirmed)} of today's ${num(c.newQuotes)}` },
  ]) + kpiRow([
    { label: 'Agencies quoted for', value: num(c.agenciesQuotedFor), note: vsNote(pv?.agenciesQuotedFor, word) },
    { label: 'Quoted by agency', value: num(c.agencyRaised), note: `${num(c.staffRaised)} by our team` },
    { label: 'Consultants quoting', value: num(c.consultants), note: vsNote(pv?.consultants, word) },
    { label: 'Quoted value', value: qv.value, note: qv.note },
  ]) + (c.confirmedValue.length ? `<div class="sub" style="padding:0 0 12px 0;">Confirmed value: <b style="color:${C.ink};">${cv.value.replace(/<[^>]+>/g, '')}</b>${c.confirmedValue.length > 1 ? ` · ${cv.note}` : ''}</div>` : '')

  const dest = d.pipeline.destinations.slice(0, 12)
  const maxD = Math.max(1, ...dest.map(x => x.quotes))
  const destTable = dest.length
    ? `<div class="h3">Where we are quoting</div>${tableOpen([{ text: 'Destination' }, { text: 'Quotes', align: 'right' }, { text: 'Amendments', align: 'right' }, { text: 'Confirmed', align: 'right' }, { text: '', width: '30%' }])}
      ${dest.map(x => `<tr>${td(esc(x.destination), { bold: true })}${td(num(x.quotes), { align: 'right', bold: true })}${td(num(x.amendments), { align: 'right' })}${td(num(x.confirmations), { align: 'right', color: x.confirmations ? C.good : undefined })}<td class="c">${bar(x.quotes, maxD, ACCENT.pipeline)}</td></tr>`).join('')}${TABLE_CLOSE}
      ${moreNote(dest.length, d.pipeline.destinations.length, 'destinations')}`
    : emptyNote('No quotations in this window.')

  const conf = d.pipeline.quotes.filter(q => q.confirmedInWindow).slice(0, 12)
  const confTable = conf.length
    ? `<div class="h3" style="padding-top:18px;">Confirmed quotations</div>${tableOpen([{ text: 'Quote' }, { text: 'Agency' }, { text: 'Consultant' }, { text: 'Destination' }, { text: 'Value', align: 'right' }])}
      ${conf.map(q => `<tr>${td(`${esc(q.ref)}${q.confirmedOrderId ? `<div class="sub">AHCNF_${esc(q.confirmedOrderId)}/AMD${num(q.versions)}</div>` : ''}`, { bold: true, nowrap: true })}${td(truncate(q.agency ?? 'Direct', 22))}${td(truncate(q.ownerName, 20))}${td(truncate(q.destination, 16))}${td(q.latestTotal !== null && q.currency ? money(q.latestTotal, q.currency) : '—', { align: 'right', nowrap: true })}</tr>`).join('')}${TABLE_CLOSE}`
    : ''

  const scope = d.pipeline.team ? `${d.pipeline.team.label} only` : 'Every office team'
  return section('Quotation pipeline', `Travel Quote GPT · ${scope}`, ACCENT.pipeline, body + destTable + confTable)
}

function callsSection(d: SalesReportData): string {
  const off = pipelineUnavailable(d, 'Calls', ACCENT.calls)
  if (off) return off
  const c = d.pipeline.counts.calls
  const pv = d.pipeline.previous?.calls
  const word = d.window.days === 1 ? 'the day before' : 'before'
  const mins = Math.round(c.talkSecs / 60)
  const body = kpiRow([
    { label: 'Calls by our team', value: num(c.manual), note: `${num(c.manualConnected)} answered`, color: ACCENT.calls },
    { label: 'Calls by the AI', value: num(c.ai), note: `${num(c.aiConnected)} answered${mins ? ` · ${num(mins)} min talk` : ''}` },
    { label: 'Total', value: num(c.total), note: `${cmp(c.total, pv?.total)} ${vsNote(pv?.total, word)}` },
    { label: 'Answered', value: pct(c.rate), note: `${num(c.connected)} reached a person` },
    { label: 'Agencies reached', value: num(c.agenciesReached), note: c.interested ? `${num(c.interested)} interested` : '&nbsp;' },
  ])
  const note = d.pipeline.team ? `<div class="sub">A team report counts its own people's dialling only — AI campaigns belong to whoever created them.</div>` : ''
  return section('Calls', 'Manual and AI dialling — answered means a person picked up', ACCENT.calls, body + note)
}

function signupsSection(d: SalesReportData): string {
  const off = pipelineUnavailable(d, 'New agencies', ACCENT.signups)
  if (off) return off
  const c = d.pipeline.counts.signups
  const pv = d.pipeline.previous?.signups
  const word = d.window.days === 1 ? 'the day before' : 'before'
  let body = kpiRow([
    { label: 'New agencies', value: num(c.agencies), note: `${cmp(c.agencies, pv?.agencies)} ${vsNote(pv?.agencies, word)}`, color: ACCENT.signups },
    { label: 'Signed up alone', value: num(c.self), note: 'registered themselves' },
    { label: 'Onboarded by us', value: num(c.desk), note: 'added from the CRM desk' },
    { label: 'Internal accounts', value: num(c.internal), note: `${num(c.total)} accounts in all` },
    { label: 'Awaiting approval', value: num(c.pending), note: '&nbsp;', color: c.pending ? C.warn : undefined },
  ])
  if (d.pipeline.onboarders.length) {
    const max = Math.max(1, ...d.pipeline.onboarders.map(o => o.count))
    body += `<div class="h3">Who onboarded them</div>${tableOpen([{ text: 'Colleague' }, { text: 'Agencies', align: 'right' }, { text: '', width: '50%' }])}
      ${d.pipeline.onboarders.slice(0, 15).map(o => `<tr>${td(esc(o.name), { bold: true })}${td(num(o.count), { align: 'right', bold: true })}<td class="c">${bar(o.count, max, ACCENT.signups)}</td></tr>`).join('')}${TABLE_CLOSE}`
  }
  const agencies = d.pipeline.signups.filter(s => s.audience === 'agency').slice(0, 12)
  if (agencies.length) {
    body += `<div class="h3" style="padding-top:18px;">The new agencies</div>${tableOpen([{ text: 'When' }, { text: 'Agency' }, { text: 'Contact' }, { text: 'How' }, { text: 'Status' }])}
      ${agencies.map(s => `<tr>${td(whenCell(s.at, d), { nowrap: true })}${td(truncate(s.agency ?? 'Not named yet', 26), { bold: true })}${td(truncate(s.name, 20))}${td(s.onboardedBy ? `by ${esc(s.onboardedBy)}` : esc(s.source))}${td(s.status === 'pending' ? '<span class="pill wn">Pending</span>' : s.status === 'active' ? '<span class="pill ok">Approved</span>' : esc(s.status))}</tr>`).join('')}${TABLE_CLOSE}`
  }
  return section('New agencies', 'Signups, and whether they walked in or were brought in', ACCENT.signups, body)
}

function adoptionSection(d: SalesReportData, maxRows: number): string {
  const off = pipelineUnavailable(d, 'Agency adoption', ACCENT.adoption)
  if (off) return off
  const c = d.pipeline.counts.adoption
  const pv = d.pipeline.previous?.adoption
  const word = d.window.days === 1 ? 'the day before' : 'before'
  let body = kpiRow([
    { label: 'Agencies using it', value: num(c.activeAgencies), note: `${cmp(c.activeAgencies, pv?.activeAgencies)} ${vsNote(pv?.activeAgencies, word)}`, color: ACCENT.adoption },
    { label: 'Prompts by agencies', value: num(c.agencyPrompts), note: `${num(c.staffPrompts)} by our team` },
    { label: 'Total prompts', value: num(c.prompts), note: vsNote(pv?.prompts, word) },
    { label: 'People on the AI', value: num(c.aiUsers), note: `${num(c.trips)} trips worked` },
  ])
  const rows = d.pipeline.agencies.slice(0, Math.min(25, maxRows))
  body += rows.length
    ? `<div class="h3">Agency by agency</div>${tableOpen([{ text: 'Agency' }, { text: 'Prompts', align: 'right' }, { text: 'Quotes', align: 'right' }, { text: 'By them', align: 'right' }, { text: 'By us', align: 'right' }, { text: 'Amend.', align: 'right' }, { text: 'Conf.', align: 'right' }, { text: 'Calls', align: 'right' }])}
      ${rows.map(a => `<tr>${td(truncate(a.agency, 28), { bold: true })}${td(a.prompts ? num(a.prompts) : '—', { align: 'right' })}${td(num(a.quotes), { align: 'right', bold: true })}${td(num(a.byAgency), { align: 'right' })}${td(num(a.byStaff), { align: 'right' })}${td(num(a.amendments), { align: 'right' })}${td(a.confirmations ? num(a.confirmations) : '—', { align: 'right', color: a.confirmations ? C.good : undefined })}${td(a.calls ? num(a.calls) : '—', { align: 'right' })}</tr>`).join('')}${TABLE_CLOSE}
      ${moreNote(rows.length, d.pipeline.agencies.length, 'agencies')}`
    : emptyNote('No agency activity in this window.')
  const direct = d.pipeline.direct
  if (direct && (direct.quotes || direct.amendments || direct.confirmations)) {
    body += `<div class="sub" style="padding-top:10px;">Direct business, no agency on it: <b style="color:${C.ink};">${num(direct.quotes)} quotations</b> · ${num(direct.amendments)} amendments · ${num(direct.confirmations)} confirmed — kept out of the ranking so it does not read as our biggest account.</div>`
  }
  return section('Agency adoption', 'Agencies typing into the AI themselves, and what came of it', ACCENT.adoption, body)
}

function staffSection(d: SalesReportData, maxRows: number): string {
  const off = pipelineUnavailable(d, 'Team performance', ACCENT.staff)
  if (off) return off
  const staff = d.pipeline.staff
  // At most 20 in the mail — a full floor would push it past Gmail's clip; the
  // workbook's Staff Performance sheet carries everyone.
  const rows = staff.slice(0, Math.min(20, Math.max(10, maxRows)))
  const max = Math.max(1, ...rows.map(s => s.newQuotes))
  let body = rows.length
    ? `${tableOpen([{ text: '#' }, { text: 'Consultant' }, { text: 'Quotes', align: 'right' }, { text: 'Amend.', align: 'right' }, { text: 'Conf.', align: 'right' }, { text: 'Calls', align: 'right' }, { text: 'Prompts', align: 'right' }, { text: '', width: '16%' }])}
      ${rows.map((s, i) => {
        const idle = !s.newQuotes && !s.amendments && !s.manualCalls && !s.prompts && !s.confirmations
        const medal = i < 3 && s.newQuotes ? ['🥇', '🥈', '🥉'][i] : String(i + 1)
        return `<tr>${td(medal, { nowrap: true })}${td(`${esc(s.name)}<div class="sub">${esc([s.leader ? `TL ${s.leader}` : '', s.team ? teamLabel(s.team).replace(/ Team$/, '') : ''].filter(Boolean).join(' · ') || s.role)}</div>`, { bold: true, color: idle ? C.faint : undefined })}${td(num(s.newQuotes), { align: 'right', bold: true })}${td(num(s.amendments), { align: 'right' })}${td(s.confirmations ? num(s.confirmations) : '—', { align: 'right', color: s.confirmations ? C.good : undefined })}${td(s.manualCalls ? `${num(s.manualCalls)}<div class="sub">${num(s.manualConnected)} ans.</div>` : '—', { align: 'right' })}${td(s.prompts ? num(s.prompts) : '—', { align: 'right' })}<td class="c">${idle ? '<span class="pill bd">no activity</span>' : bar(s.newQuotes, max, ACCENT.staff)}</td></tr>`
      }).join('')}${TABLE_CLOSE}
      ${moreNote(rows.length, staff.length, 'people')}`
    : emptyNote('No consultants on the roster for this scope.')

  const teams = d.pipeline.teams.filter(t => t.quotes || t.calls || t.prompts || t.amendments || t.signups)
  if (teams.length) {
    body += `<div class="h3" style="padding-top:18px;">By office team</div>${tableOpen([{ text: 'Team' }, { text: 'People', align: 'right' }, { text: 'Quotes', align: 'right' }, { text: 'Amend.', align: 'right' }, { text: 'Conf.', align: 'right' }, { text: 'Calls', align: 'right' }, { text: 'Prompts', align: 'right' }, { text: 'Signups', align: 'right' }])}
      ${teams.map(t => `<tr>${td(esc(t.label), { bold: true })}${td(num(t.people), { align: 'right' })}${td(num(t.quotes), { align: 'right', bold: true })}${td(num(t.amendments), { align: 'right' })}${td(num(t.confirmations), { align: 'right' })}${td(num(t.calls), { align: 'right' })}${td(num(t.prompts), { align: 'right' })}${td(num(t.signups), { align: 'right' })}</tr>`).join('')}${TABLE_CLOSE}`
  }
  return section('Team performance', 'One row per person — a desk that did nothing is shown, not hidden', ACCENT.staff, body)
}

/** A heat strip per activity: the hour (or day) the floor actually worked. */
function activitySection(d: SalesReportData): string {
  const off = pipelineUnavailable(d, 'When the work happened', ACCENT.activity)
  if (off) return off
  const a = d.pipeline.activity
  if (!a.labels.length || a.labels.length > 31) {
    return section('When the work happened', 'Activity by hour', ACCENT.activity, emptyNote('The span is too long to draw here — the workbook carries the full heatmap.'))
  }
  const lanes = a.lanes.filter(l => l.values.some(v => v > 0))
  if (!lanes.length) return section('When the work happened', 'Activity by hour', ACCENT.activity, emptyNote('No activity recorded in this window.'))
  const head = a.labels.map((l, i) => {
    const show = a.axis === 'hour' ? i % 3 === 0 : i % Math.ceil(a.labels.length / 8) === 0
    const text = a.axis === 'hour' ? l.slice(0, 2) : l.slice(8, 10)
    return `<td align="center" style="font:700 8px/1.2 ${FONT};color:${C.faint};padding:0 0 3px 0;">${show ? esc(text) : ''}</td>`
  }).join('')
  // Five shades as classes, not a colour per cell: 7 lanes × 24 hours of inline
  // styles was 30 KB on its own and pushed the mail towards Gmail's clip.
  const rows = lanes.map(l => {
    const max = Math.max(1, ...l.values)
    const cells = l.values.map(v => `<td class="hm q${v === 0 ? 0 : Math.min(4, 1 + Math.floor((v / max) * 3.999))}">&nbsp;</td>`).join('')
    const total = l.values.reduce((s, v) => s + v, 0)
    return `<tr><td style="font:700 11px/1.3 ${FONT};color:${C.ink};padding-right:8px;white-space:nowrap;">${esc(l.label)}</td>${cells}<td align="right" style="font:700 11px/1.3 ${FONT};color:${C.muted};padding-left:6px;">${num(total)}</td></tr>`
  }).join('')
  const busiest = (() => {
    const totals = a.labels.map((_, i) => lanes.reduce((s, l) => s + l.values[i], 0))
    const top = totals.indexOf(Math.max(...totals))
    return top >= 0 && totals[top] > 0 ? `Busiest ${a.axis === 'hour' ? 'hour' : 'day'}: <b style="color:${C.ink};">${esc(a.axis === 'hour' ? a.labels[top] : formatReportDate(a.labels[top]))}</b> (${num(totals[top])} actions).` : ''
  })()
  return section('When the work happened', a.axis === 'hour' ? `Activity by hour of day, ${d.window.timezone}` : 'Activity by day', ACCENT.activity,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr><td></td>${head}<td></td></tr>${rows}</table><div class="sub" style="padding-top:8px;">${busiest} Darker is busier, scaled per row.</div>`)
}

function warningsBlock(d: SalesReportData): string {
  if (!d.warnings.length) return ''
  return `<tr><td style="padding:0 0 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;"><tr><td style="padding:12px 16px;">
    <div style="font:700 11px/1.4 ${FONT};color:#92400e;text-transform:uppercase;letter-spacing:.08em;">Read with care — ${num(d.warnings.length)} source${d.warnings.length === 1 ? '' : 's'} incomplete</div>
    ${d.warnings.map(w => `<div style="font:400 12px/1.6 ${FONT};color:#78350f;padding-top:4px;">• ${esc(w)}</div>`).join('')}
    <div style="font:400 11px/1.6 ${FONT};color:#a16207;padding-top:6px;">A figure that could not be read shows “—”, never 0.</div>
  </td></tr></table></td></tr>`
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function reportTitle(d: SalesReportData): string {
  if (d.window.custom && d.window.days > 1) return 'Sales Report'
  return `${PERIOD_LABEL[d.window.period]} Sales Report`
}

function headerBlock(d: SalesReportData, opts: SalesRenderOptions): string {
  const badges = [
    opts.testSend ? 'TEST SEND' : '',
    d.window.live ? 'LIVE — STILL MOVING' : '',
    d.window.custom && !d.window.live ? 'CHOSEN DATES' : '',
    d.pipeline.team ? d.pipeline.team.label.toUpperCase() : '',
  ].filter(Boolean).map(text =>
    `<span style="display:inline-block;margin:0 0 4px 5px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.18);color:#ffffff;font:700 10px/1.5 ${FONT};letter-spacing:.08em;">${esc(text)}</span>`,
  ).join('')
  return `
  <tr><td style="background:#1e1b4b;background-image:linear-gradient(135deg,#1e1b4b 0%,#4338ca 55%,${C.brand} 100%);padding:26px 24px;border-radius:16px 16px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td>
        <div style="font:700 11px/1.4 ${FONT};color:rgba(255,255,255,.72);text-transform:uppercase;letter-spacing:.14em;">AppleHolidays Sales</div>
        <div style="font:800 24px/1.25 ${FONT};color:#ffffff;padding-top:6px;letter-spacing:-0.02em;">${esc(reportTitle(d))}</div>
        <div style="font:400 13px/1.5 ${FONT};color:rgba(255,255,255,.82);padding-top:5px;">${esc(d.window.label)}</div>
        <div style="font:400 11px/1.5 ${FONT};color:rgba(255,255,255,.6);padding-top:2px;">Compared with ${esc(d.window.previous.label)}</div>
      </td>
      <td align="right" valign="top">${badges}</td>
    </tr></table>
  </td></tr>`
}

function ribbon(d: SalesReportData): string {
  const c = d.pipeline.counts
  const p = d.pipeline.available
  const top = d.invoices.newValue[0]
  const cells = [
    { label: 'Bookings', value: d.bookings.available ? num(d.bookings.total) : '—', sub: `${num(d.bookings.pax)} guests` },
    { label: 'Invoiced new', value: top ? `${compactMoney(top.total)}` : d.invoices.available ? '0' : '—', sub: top ? `${top.currency} · ${num(d.invoices.newCount)} inv.` : 'no invoices' },
    { label: 'Quotations', value: p ? num(c.newQuotes) : '—', sub: p ? `${num(c.amendments)} amended` : 'unavailable' },
    { label: 'Confirmed', value: p ? num(c.confirmations) : '—', sub: p ? `${pct(c.conversion)} of quoted` : '' },
    { label: 'Calls', value: p ? num(c.calls.total) : '—', sub: p ? `${pct(c.calls.rate)} answered` : '' },
    { label: 'New agencies', value: p ? num(c.signups.agencies) : '—', sub: p ? `${num(c.signups.desk)} by us` : '' },
    { label: 'AI prompts', value: p ? num(c.adoption.prompts) : '—', sub: p ? `${num(c.adoption.activeAgencies)} agencies` : '' },
  ]
  return `
  <tr><td style="background:#16133d;padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${cells.map(c => `<td width="${Math.floor(100 / cells.length)}%" align="center" style="padding:2px 4px;">
        <div style="font:800 21px/1.2 ${FONT};color:#ffffff;">${c.value}</div>
        <div style="font:700 10px/1.4 ${FONT};color:rgba(255,255,255,.66);text-transform:uppercase;letter-spacing:.08em;padding-top:3px;">${esc(c.label)}</div>
        <div style="font:400 10px/1.4 ${FONT};color:rgba(255,255,255,.45);padding-top:2px;">${esc(c.sub)}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>`
}

export function renderSalesEmail(d: SalesReportData, opts: SalesRenderOptions = {}): string {
  const s = opts.sections ?? {}
  const on = (k: keyof SalesSections) => s[k] !== false
  const maxRows = opts.maxRows ?? 30

  const narrative = opts.narrative
    ? `<tr><td style="padding:0 0 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:14px;"><tr><td style="padding:16px 18px;">
        <div style="font:700 11px/1.4 ${FONT};color:#4338ca;text-transform:uppercase;letter-spacing:.08em;">Summary</div>
        <div style="font:400 13px/1.7 ${FONT};color:#1e1b4b;padding-top:7px;">${esc(opts.narrative).replace(/\n/g, '<br>')}</div>
      </td></tr></table></td></tr>`
    : ''

  const funnel = section(d.window.days === 1 ? 'The day at a glance' : 'The period at a glance', `${d.window.label} — six stages, four systems, read-only`, ACCENT.funnel, funnelBlock(d))

  const body = [
    warningsBlock(d),
    on('salesHighlights') ? highlightsSection(d) : '',
    funnel,
    on('salesBookings') ? bookingsSection(d, maxRows) : '',
    on('salesRevenue') ? revenueSection(d, maxRows) : '',
    on('salesPipeline') ? pipelineSection(d) : '',
    on('salesCalls') ? callsSection(d) : '',
    on('salesSignups') ? signupsSection(d) : '',
    on('salesAdoption') ? adoptionSection(d, maxRows) : '',
    on('salesStaff') ? staffSection(d, maxRows) : '',
    on('salesActivity') ? activitySection(d) : '',
  ].join('')

  const attach = opts.workbookAttached && opts.workbookSheets?.length
    ? `<div style="margin:0 0 14px 0;padding:12px 14px;border-radius:10px;background:${C.wash};border:1px solid ${C.line};text-align:left;">
        <div style="font:700 12px/1.4 ${FONT};color:${C.ink};">📎 The Excel workbook carries every row</div>
        <div style="font:400 11px/1.7 ${FONT};color:${C.muted};padding-top:4px;">${opts.workbookSheets.map(n => `<span class="pill" style="background:#ffffff;color:${C.body};border:1px solid ${C.line};margin:2px 2px 0 0;">${esc(n)}</span>`).join(' ')}</div>
      </div>`
    : ''
  const footerLink = opts.dashboardUrl
    ? `<a href="${esc(opts.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:#4338ca;color:#ffffff;text-decoration:none;border-radius:8px;font:700 13px/1 ${FONT};">Open the sales dashboard</a>`
    : ''
  const scope = [
    d.countries.length ? `Bookings scoped to ${d.countries.map(c => c.replace(/_/g, ' ')).join(', ')}` : 'All operating countries',
    d.pipeline.team ? `Travel Quote GPT: ${d.pipeline.team.label}` : 'Travel Quote GPT: every team',
  ].join(' · ')
  const pre = `${d.window.label} — ${num(d.bookings.total)} bookings, ${num(d.invoices.newCount)} new invoices, ${num(d.pipeline.counts.newQuotes)} quotations, ${num(d.pipeline.counts.confirmations)} confirmed, ${num(d.pipeline.counts.calls.total)} calls, ${num(d.pipeline.counts.signups.agencies)} new agencies.`

  return compact(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(reportTitle(d))}</title>
<style type="text/css">${STYLE_BLOCK}
${HEAT_STYLE}</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;padding:22px 12px;">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;">
      ${headerBlock(d, opts)}
      ${ribbon(d)}
      <tr><td style="background:#ffffff;padding:20px 18px 6px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${narrative}
          ${body}
        </table>
      </td></tr>
      <tr><td align="center" style="background:#ffffff;padding:6px 18px 24px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};border-radius:0 0 16px 16px;">
        ${attach}
        ${footerLink}
        <div class="foot">
          ${esc(opts.scheduleName ? `“${opts.scheduleName}” · ` : '')}${esc(scope)}<br>
          Generated ${esc(new Date(d.generatedAt).toISOString().replace('T', ' ').slice(0, 16))} UTC · times in ${esc(d.window.timezone)}<br>
          Automated report from AppleHolidays MMT — every source read-only. Replies are not monitored.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`)
}

/** Subject line: the headline numbers, so most days are answered from the inbox list. */
export function renderSalesSubject(d: SalesReportData, opts: { prefix?: string; testSend?: boolean } = {}): string {
  const c = d.pipeline.counts
  const range = d.window.days === 1
    ? formatReportDate(d.window.fromDate)
    : `${formatReportDate(d.window.fromDate)}–${formatReportDate(d.window.toDate)}`
  const top = d.invoices.newValue[0]
  const parts = [
    d.bookings.available ? `${d.bookings.total} booking${d.bookings.total === 1 ? '' : 's'}` : '',
    top ? `${top.currency} ${Math.round(top.total).toLocaleString('en-US')} invoiced` : '',
    d.pipeline.available ? `${c.newQuotes} quote${c.newQuotes === 1 ? '' : 's'}` : '',
    d.pipeline.available && c.confirmations ? `${c.confirmations} confirmed` : '',
    d.pipeline.available ? `${c.calls.total} calls` : '',
    d.pipeline.available && c.signups.agencies ? `${c.signups.agencies} new agenc${c.signups.agencies === 1 ? 'y' : 'ies'}` : '',
    d.bookings.missingRefs.length ? `${d.bookings.missingRefs.length} NOT FILED` : '',
  ].filter(Boolean)
  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  const team = d.pipeline.team ? ` (${d.pipeline.team.label.replace(/ Team$/, '')})` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}${reportTitle(d)}${team} · ${range}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
}

/** A flat CSV fallback when the workbook cannot be written. */
export function renderSalesCsv(d: SalesReportData): string {
  const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const rows: string[] = []
  const block = (title: string, header: string[], lines: unknown[][]) => {
    rows.push(`# ${title}`, header.map(cell).join(','))
    lines.forEach(l => rows.push(l.map(cell).join(',')))
    rows.push('')
  }
  block('Confirmed bookings', ['Ref', 'Channel', 'Partner', 'Market', 'Arrival', 'Pax', 'Currency', 'Value', 'Created'],
    d.bookings.lines.map(l => [l.bookingRef, l.source, l.agent, l.countryLabel, l.arrivalDate, l.pax, l.currency, l.quotedTotal, l.createdAt]))
  block('New invoices', ['Booking', 'Invoice', 'Partner', 'Guest', 'Currency', 'Amount', 'Raised'],
    d.invoices.newLines.map(l => [l.ref, l.invoiceNumber, l.agent, l.guest, l.currency, l.amount, l.raisedAt]))
  block('Quotations', ['Quote', 'Issued', 'Consultant', 'Agency', 'Destination', 'Versions', 'Booking status', 'Currency', 'Latest total', 'Confirmed at'],
    d.pipeline.quotes.map(q => [q.ref, q.issuedAt, q.ownerName, q.agency, q.destination, q.versions, q.bookingStatus, q.currency, q.latestTotal, q.confirmedAt]))
  block('Staff', ['Consultant', 'Team', 'Quotes', 'Amendments', 'Confirmed', 'Calls', 'Answered', 'Prompts'],
    d.pipeline.staff.map(s => [s.name, s.team, s.newQuotes, s.amendments, s.confirmations, s.manualCalls, s.manualConnected, s.prompts]))
  return rows.join('\n')
}
