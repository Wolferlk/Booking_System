/**
 * The weekly and monthly report email.
 *
 * ## What makes it different from the daily mail
 *
 * The daily mail is a work list: these bookings came in, these tours land
 * tomorrow, this one has no driver. Every row is something somebody does that
 * morning, so every row belongs in the message.
 *
 * A week is not a longer morning. Nobody chases an arrival that landed nine
 * days ago, and nobody reads two hundred booking rows in an email — printing
 * them made the periodic mails long, slow and unread, and hid the only thing a
 * period can say that a day cannot: **what moved, and in which direction.**
 *
 * So this renderer prints no individual bookings at all. Not the intake list,
 * not the readiness checklist, not the complaint cards. It prints movement —
 * this period against the one before it, market by market, partner by partner —
 * and every row it does not print is in the attached workbook, which is the
 * right tool for rows and says so on its first sheet.
 *
 * ## The shape
 *
 *  1. **Header + scorecard** — the B2B headline with its delta, then eight
 *     numbers in two rows, each carrying its own movement.
 *  2. **What to do** — the derived action list. Deliberately above the analysis:
 *     a reader who stops after one screen should have stopped in the right place.
 *  3. **Biggest moves** — the rising and falling partner and market, in bookings.
 *  4. **Trend** — intake by day (week) or week (month), drawn against the
 *     arrivals it produced.
 *  5. **Markets / partners** — who grew, who slipped, who went quiet.
 *  6. **B2C store orders** — beside the B2B count, never inside it.
 *  7. **Commercial** — value, party size, lead time, concentration.
 *  8. **Delivered** — what operations actually carried, in guest-days.
 *  9. **Attrition** — cancellations, their notice and their cost.
 * 10. **Service quality** — complaints per hundred tours, resolution, D-10.
 * 11. **Integrity** — parity, the count check, the reconciler's own work.
 * 12. **Forward book** — what the next period is already carrying.
 * 13. **Test bookings** — every test left out of the figures, named.
 *
 * Written for mail clients under exactly the rules `email-kit` documents:
 * tables, a 680px shell, classes over inline styles, nothing Word drops.
 */
import {
  formatReportDate, PERIOD_LABEL, type ReportWindow,
} from './report-window'
import {
  bar, C, compact, emptyNote, esc, FONT, kpiRow, money, moreNote, num, pill, section,
  STYLE_BLOCK, TABLE_CLOSE, tableOpen, td, truncate,
} from './email-kit'
import { todayNewAndUpdated, type ReportData } from './report-data'
import { activitySection } from './activity-html'
import { activityBreakdown } from './activity-breakdown'
import type { MoverRow, PeriodAction, PeriodInsights, PeriodPoint } from './period-insights'
import type { PeriodAdvice } from './period-outlook'
import type { CountryRow } from './booking-lines'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'

// ─── Small pieces ─────────────────────────────────────────────────────────────

/** Signed delta chip. `null` percentages print the absolute move instead. */
function deltaChip(current: number, previous: number, opts: { comparable?: boolean; invert?: boolean } = {}): string {
  if (opts.comparable === false) return pill('no baseline', C.muted, C.wash)
  const delta = current - previous
  if (delta === 0) return pill('level', C.muted, C.wash)
  const up = delta > 0
  // On a metric where up is bad (cancellations, complaints) the colour flips but
  // the arrow does not — the arrow is the direction, the colour is the verdict.
  const good = opts.invert ? !up : up
  const pctText = previous > 0 ? ` (${up ? '+' : ''}${Math.round(((current - previous) / previous) * 100)}%)` : ''
  return pill(
    `${up ? '▲' : '▼'} ${Math.abs(delta).toLocaleString('en-US')}${pctText}`,
    good ? C.good : C.bad,
    good ? '#ecfdf5' : '#fef2f2',
  )
}

const SEVERITY_STYLE: Record<PeriodAction['severity'], { bg: string; border: string; ink: string; word: string }> = {
  critical: { bg: '#fef2f2', border: '#fecaca', ink: '#991b1b', word: 'ACT NOW' },
  warning:  { bg: '#fffbeb', border: '#fde68a', ink: '#92400e', word: 'ATTENTION' },
  watch:    { bg: '#f8fafc', border: '#e2e8f0', ink: '#334155', word: 'WATCH' },
  good:     { bg: '#ecfdf5', border: '#a7f3d0', ink: '#065f46', word: 'GOOD NEWS' },
}

/** "USD 412,900 · LKR 8.1m" — the currency line, never blended. */
function currencyLine(rows: { currency: string; total: number }[], limit = 3): string {
  if (!rows.length) return 'No quoted value recorded'
  return rows.slice(0, limit).map(r => money(r.total, r.currency)).join(' · ')
}

function ratio(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

// ─── Sections ─────────────────────────────────────────────────────────────────

/**
 * The action list.
 *
 * Placed first on purpose. Everything below it is evidence; this is the verdict,
 * and a reader who only ever opens the preview pane should still leave with it.
 */
function actionSection(i: PeriodInsights, periodWord: string): string {
  if (!i.actions.length) {
    return section(
      'What needs doing',
      `Nothing this ${periodWord} met the thresholds this report watches`,
      C.good,
      emptyNote('No parity gaps, no count-check shortfall, no unexplained reconfirmation breaches, no market or partner falling away. A clean period.'),
    )
  }

  const cards = i.actions.map(a => {
    const s = SEVERITY_STYLE[a.severity]
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${s.bg};border:1px solid ${s.border};border-radius:10px;margin-bottom:9px;">
      <tr><td style="padding:12px 14px;">
        <div style="font:700 10px/1.4 ${FONT};color:${s.ink};text-transform:uppercase;letter-spacing:.08em;">${s.word}</div>
        <div style="font:700 13px/1.45 ${FONT};color:${C.ink};padding-top:5px;">${esc(a.title)}</div>
        <div style="font:400 12px/1.65 ${FONT};color:${C.body};padding-top:5px;">${esc(a.detail)}</div>
        ${a.sheet ? `<div style="font:400 11px/1.5 ${FONT};color:${C.faint};padding-top:6px;">Rows: “${esc(a.sheet)}” sheet in the attached workbook</div>` : ''}
      </td></tr>
    </table>`
  }).join('')

  return section(
    'What needs doing',
    `Derived from this ${periodWord}'s figures — most urgent first`,
    C.bad,
    cards,
  )
}

/** The intake trend, as a bar per bucket with the arrivals it produced beside it. */
function trendSection(i: PeriodInsights, periodWord: string): string {
  if (!i.series.length) return ''
  const max = Math.max(1, ...i.series.map(p => p.bookings))
  const totalArrivals = i.series.reduce((s, p) => s + p.arrivals, 0)

  const rows = i.series.map((p: PeriodPoint) => `<tr>
    ${td(esc(p.label), { bold: true, color: C.ink, nowrap: true })}
    ${td(num(p.bookings), { align: 'right', bold: true, color: C.ink })}
    ${td(num(p.pax), { align: 'right' })}
    ${td(bar(p.bookings, max, C.brand))}
    ${td(num(p.arrivals), { align: 'right', color: C.muted })}
    ${td(num(p.departures), { align: 'right', color: C.muted })}
  </tr>`).join('')

  const shape = i.busiest && i.quietest && i.busiest.key !== i.quietest.key
    ? `<div style="font:400 12px/1.7 ${FONT};color:${C.muted};padding-top:10px;">
         Busiest: <strong style="color:${C.ink};">${esc(i.busiest.label)}</strong> with ${num(i.busiest.bookings)} ·
         Quietest: <strong style="color:${C.ink};">${esc(i.quietest.label)}</strong> with ${num(i.quietest.bookings)} ·
         Run rate ${i.runRate.current ?? '—'} a day${i.runRate.previous !== null ? ` against ${i.runRate.previous} last ${periodWord}` : ''}.
       </div>`
    : ''

  return section(
    `Intake shape — by ${i.granularity}`,
    `${num(i.totals.bookings)} confirmed across the ${periodWord}, and the ${num(totalArrivals)} tour${totalArrivals === 1 ? '' : 's'} that started in it`,
    C.brand,
    tableOpen([
      { text: i.granularity === 'day' ? 'Day' : 'Week' },
      { text: 'Booked', align: 'right', width: '60' },
      { text: 'Pax', align: 'right', width: '50' },
      { text: 'Share', width: '150' },
      { text: 'Arrived', align: 'right', width: '60' },
      { text: 'Departed', align: 'right', width: '65' },
    ]) + rows + TABLE_CLOSE + shape +
    `<div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding-top:8px;">
       Booked counts the confirmation against the ${i.granularity === 'day' ? 'day' : 'week'} it was filed here; arrived and departed count tours by their travel dates. The two rarely line up — that gap is the lead time below.
     </div>`,
  )
}

/** Markets, ranked, with what each one did last period beside it. */
function marketSection(i: PeriodInsights, periodWord: string): string {
  const rows = i.countryMovers.filter(m => m.current > 0 || m.previous > 0)
  if (!rows.length) return ''
  const max = Math.max(1, ...rows.map(r => r.current))

  const body = rows.slice(0, 12).map((m: MoverRow) => `<tr>
    ${td(esc(m.label), { bold: true, color: C.ink })}
    ${td(num(m.current), { align: 'right', bold: true, color: C.ink })}
    ${td(num(m.pax), { align: 'right' })}
    ${td(bar(m.current, max, C.brand))}
    ${td(num(m.previous), { align: 'right', color: C.muted })}
    ${td(deltaChip(m.current, m.previous, { comparable: i.comparable }), { align: 'right', nowrap: true })}
  </tr>`).join('')

  return section(
    'Markets',
    `Where the ${periodWord}'s business came from, against ${esc(i.previousLabel)}`,
    C.b2b,
    tableOpen([
      { text: 'Country' },
      { text: 'Booked', align: 'right', width: '60' },
      { text: 'Pax', align: 'right', width: '50' },
      { text: 'Share', width: '120' },
      { text: 'Prev', align: 'right', width: '50' },
      { text: 'Change', align: 'right', width: '110' },
    ]) + body + TABLE_CLOSE,
  )
}

/** Partners, ranked, with the new and the silent called out by name. */
function partnerSection(i: PeriodInsights, periodWord: string): string {
  const active = i.agentMovers.filter(m => m.current > 0)
  if (!active.length && !i.lapsedAgents.length) return ''
  const max = Math.max(1, ...active.map(r => r.current))

  const body = active.slice(0, 12).map(m => `<tr>
    ${td(truncate(m.label, 34), { bold: true, color: C.ink })}
    ${td(num(m.current), { align: 'right', bold: true, color: C.ink })}
    ${td(num(m.pax), { align: 'right' })}
    ${td(bar(m.current, max, C.b2b))}
    ${td(num(m.previous), { align: 'right', color: C.muted })}
    ${td(m.isNew ? pill('NEW', '#ffffff', C.good) : deltaChip(m.current, m.previous, { comparable: i.comparable }), { align: 'right', nowrap: true })}
  </tr>`).join('')

  const lapsed = i.lapsedAgents.length
    ? `<div style="margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:11px 13px;font:400 12px/1.7 ${FONT};color:#92400e;">
         <strong>Booked last ${periodWord}, nothing this ${periodWord} — ${num(i.lapsedAgents.length)}:</strong>
         ${i.lapsedAgents.map(a => esc(a)).join(' · ')}
       </div>`
    : ''

  const concentration = i.agentConcentrationPct !== null
    ? `<div style="font:400 12px/1.7 ${FONT};color:${C.muted};padding-top:10px;">
         The top three partners hold <strong style="color:${C.ink};">${i.agentConcentrationPct}%</strong> of the ${periodWord}'s book${
           i.agentConcentrationPct >= 60 ? ' — concentrated enough that one of them going quiet would be felt immediately.' : '.'
         }
       </div>`
    : ''

  return section(
    'Partners',
    `Who sold, who grew, and who went quiet`,
    C.b2c,
    (active.length
      ? tableOpen([
          { text: 'Agent / channel' },
          { text: 'Booked', align: 'right', width: '60' },
          { text: 'Pax', align: 'right', width: '50' },
          { text: 'Share', width: '110' },
          { text: 'Prev', align: 'right', width: '50' },
          { text: 'Change', align: 'right', width: '110' },
        ]) + body + TABLE_CLOSE
      : emptyNote('No partner booked in this period.')) + concentration + lapsed,
  )
}

/** Value, party size and how far ahead the book is being written. */
function commercialSection(i: PeriodInsights, periodWord: string): string {
  const t = i.totals
  const lt = i.leadTime

  const tiles = kpiRow([
    {
      label: 'Quoted value',
      value: `<span style="font-size:15px;line-height:1.4;">${currencyLine(t.byCurrency, 2)}</span>`,
      note: t.previousByCurrency.length ? `Prev ${esc(currencyLine(t.previousByCurrency, 1))}` : 'No prior baseline',
    },
    {
      label: 'Avg per booking',
      value: `<span style="font-size:15px;line-height:1.4;">${currencyLine(t.avgBookingValue, 2)}</span>`,
      note: 'Quoted total ÷ bookings quoted',
    },
    {
      label: 'Avg party',
      value: t.avgPartySize !== null ? String(t.avgPartySize) : '—',
      note: t.previousAvgPartySize !== null ? `Prev ${t.previousAvgPartySize}` : '&nbsp;',
    },
    {
      label: 'Lead time',
      value: lt.avgDays !== null ? `${lt.avgDays}d` : '—',
      note: lt.medianDays !== null ? `Median ${lt.medianDays}d` : '&nbsp;',
    },
  ])

  const leadTable = lt.measured
    ? tableOpen([{ text: 'How far ahead the period sold' }, { text: 'Bookings', align: 'right', width: '80' }, { text: 'Share', width: '140' }]) +
      [
        { label: 'Travelling within 7 days of booking', n: lt.within7 },
        { label: 'Travelling within 30 days', n: lt.within30 },
        { label: 'Travelling more than 90 days out', n: lt.beyond90 },
      ].map(r => `<tr>
        ${td(esc(r.label))}
        ${td(num(r.n), { align: 'right', bold: true, color: C.ink })}
        ${td(bar(r.n, Math.max(1, lt.measured), C.brand))}
      </tr>`).join('') + TABLE_CLOSE +
      `<div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding-top:8px;">
         Measured on ${num(lt.measured)} of ${num(t.bookings)} bookings${
           lt.previousAvgDays !== null
             ? ` · average was ${lt.previousAvgDays} days last ${periodWord}${
                 lt.avgDays !== null && lt.avgDays < lt.previousAvgDays ? ' — the book is being written later' : ''
               }`
             : ''
         }. A short lead time is cash sooner and less time to prepare the file; a long one is the reverse.
       </div>`
    : ''

  return section(
    'Commercial shape',
    'Value, party size and how far ahead the business is selling',
    C.brand,
    tiles + leadTable,
  )
}

/** What operations actually carried — the counterweight to the intake number. */
function deliverySection(i: PeriodInsights, periodWord: string): string {
  const d = i.delivery
  if (!d.available) return ''

  const tiles = kpiRow([
    { label: 'Tours operated', value: num(d.toursOperated), note: `${num(d.hotelOnly)} hotel only` },
    { label: 'Guests carried', value: num(d.pax), note: d.avgPartySize !== null ? `${d.avgPartySize} per tour` : '&nbsp;' },
    { label: 'Guest-days', value: num(d.guestDays), note: 'Days on the ground × party size' },
    { label: 'Started / ended', value: `${num(d.arrivals)}/${num(d.departures)}`, note: deltaChip(d.arrivals, d.previousArrivals, { comparable: i.comparable }) },
  ])

  return section(
    'What was delivered',
    `The operation this ${periodWord} actually carried — not what it sold`,
    C.good,
    tiles +
      `<div style="font:400 12px/1.7 ${FONT};color:${C.muted};padding:0 0 14px 0;">
         Counts every tour that was on the ground for at least one day of the ${periodWord}, including the ones that
         started before it and the ones still running. Guest-days is the honest measure of workload: a hundred
         one-night files and ten two-week tours are not the same ${periodWord}'s work, and a tour count says they are.
         ${d.avgTourNights !== null ? `The average tour ran ${d.avgTourNights} nights.` : ''}
       </div>` +
      `<div class="h3">By market</div>${countryOnlyTable(d.byCountry)}`,
  )
}

/** A country roll-up without the per-booking detail the daily mail carries. */
function countryOnlyTable(rows: CountryRow[]): string {
  if (!rows.length) return emptyNote('No country activity in this period.')
  const max = Math.max(...rows.map(r => r.bookings))
  return tableOpen([
    { text: 'Country' },
    { text: 'Tours', align: 'right', width: '60' },
    { text: 'B2B', align: 'right', width: '45' },
    { text: 'B2C', align: 'right', width: '45' },
    { text: 'Guests', align: 'right', width: '60' },
    { text: 'Share', width: '110' },
  ]) + rows.map(r => `<tr>
    ${td(esc(r.label), { bold: true, color: C.ink })}
    ${td(num(r.bookings), { align: 'right', bold: true, color: C.ink })}
    ${td(num(r.b2b), { align: 'right', color: C.b2b })}
    ${td(num(r.b2c), { align: 'right', color: C.b2c })}
    ${td(num(r.pax), { align: 'right' })}
    ${td(bar(r.bookings, max, C.good))}
  </tr>`).join('') + TABLE_CLOSE
}

/** Cancellations: how many, how late, and what they were worth. */
function attritionSection(i: PeriodInsights, periodWord: string): string {
  const c = i.cancellations
  if (!c.available) return ''

  if (c.total === 0) {
    return section(
      'Attrition',
      `Bookings withdrawn during the ${periodWord}`,
      C.good,
      emptyNote(`Nothing was cancelled this ${periodWord}${c.previousTotal ? ` — ${num(c.previousTotal)} last ${periodWord}.` : '.'}`),
    )
  }

  const tiles = kpiRow([
    { label: 'Cancelled', value: num(c.total), note: deltaChip(c.total, c.previousTotal, { comparable: i.comparable, invert: true }), color: C.bad },
    { label: 'Rate', value: ratio(c.ratePct), note: 'Of everything the period took' },
    { label: 'Short notice', value: num(c.shortNotice), note: '7 days or less to arrival' },
    { label: 'Guests lost', value: num(c.pax), note: '&nbsp;' },
  ])

  const value = `<div style="font:400 12px/1.7 ${FONT};color:${C.muted};padding:0 0 14px 0;">
      <strong style="color:${C.ink};">Value withdrawn</strong> ${currencyLine(c.byCurrency)}${
        c.feesByCurrency.length ? ` &nbsp;·&nbsp; <strong style="color:${C.ink};">Fees recorded</strong> ${currencyLine(c.feesByCurrency)}` : ''
      }
    </div>`

  const reasons = c.topReasons.length
    ? `<div class="h3">Why</div>` +
      tableOpen([{ text: 'Recorded reason' }, { text: 'Bookings', align: 'right', width: '80' }]) +
      c.topReasons.map(r => `<tr>
        ${td(truncate(r.reason, 70), { color: r.reason === 'No reason recorded' ? C.bad : C.body })}
        ${td(num(r.count), { align: 'right', bold: true, color: C.ink })}
      </tr>`).join('') + TABLE_CLOSE
    : ''

  const byAgent = c.byAgent.length > 1
    ? `<div style="padding-top:18px;"><div class="h3">Which partners</div>` +
      tableOpen([{ text: 'Agent / channel' }, { text: 'Cancelled', align: 'right', width: '80' }, { text: 'Guests', align: 'right', width: '60' }]) +
      c.byAgent.map(a => `<tr>${td(truncate(a.agent, 34))}${td(num(a.bookings), { align: 'right', bold: true, color: C.ink })}${td(num(a.pax), { align: 'right' })}</tr>`).join('') +
      TABLE_CLOSE + '</div>'
    : ''

  return section(
    'Attrition',
    `Bookings withdrawn during the ${periodWord} — every file is on the “Cancellations” sheet`,
    C.bad,
    tiles + value + reasons + byAgent,
  )
}

/** Service quality, volume-adjusted so a busy period is judged fairly. */
function qualitySection(d: ReportData, i: PeriodInsights, periodWord: string): string {
  const q = i.quality

  const tiles = kpiRow([
    {
      label: 'Complaints',
      value: num(q.complaints),
      note: q.previousComplaints !== null ? deltaChip(q.complaints, q.previousComplaints, { invert: true }) : 'No baseline',
      color: q.complaints ? C.warn : C.ink,
    },
    { label: 'Per 100 tours', value: q.per100Tours !== null ? String(q.per100Tours) : '—', note: 'Volume-adjusted' },
    { label: 'Resolved', value: ratio(q.resolvedPct), note: q.avgResolutionHours !== null ? `Avg ${q.avgResolutionHours}h` : '&nbsp;' },
    { label: `D-${RECONFIRM_DUE_DAYS} kept`, value: ratio(q.reconfirmCompliancePct), note: `${num(q.unexplainedBreaches)} unexplained`, color: q.reconfirmCompliancePct !== null && q.reconfirmCompliancePct < 90 ? C.bad : C.ink },
  ])

  const categories = d.complaints.byCategory.length
    ? `<div class="h3">What guests raised</div>` +
      tableOpen([{ text: 'Theme' }, { text: 'Raised', align: 'right', width: '60' }, { text: 'Still open', align: 'right', width: '75' }, { text: 'Share', width: '120' }]) +
      d.complaints.byCategory.slice(0, 8).map(c => `<tr>
        ${td(esc(c.category), { bold: true, color: C.ink })}
        ${td(num(c.total), { align: 'right' })}
        ${td(num(c.open), { align: 'right', color: c.open ? C.bad : C.muted })}
        ${td(bar(c.total, Math.max(1, ...d.complaints.byCategory.map(x => x.total)), C.warn))}
      </tr>`).join('') + TABLE_CLOSE
    : emptyNote('No complaints were raised in this period.')

  const recurring = q.recurringOpen
    ? `<div style="margin-top:14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:11px 13px;font:400 12px/1.7 ${FONT};color:#9a3412;">
         <strong>${num(q.recurringOpen)} open issue${q.recurringOpen === 1 ? ' has' : 's have'} been raised more than once.</strong>
         A guest repeating themselves is the clearest signal a resolution did not land. The full trail is on the “Complaints” sheet.
       </div>`
    : ''

  const reconfirmNote = `<div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding-top:10px;">
      D-${RECONFIRM_DUE_DAYS} kept measures everything travelling in the next ${RECONFIRM_DUE_DAYS} days from today, not the ${periodWord} just closed — it is a live standing, and it is the one number here that can still be fixed.
    </div>`

  return section('Service quality', `Complaints, resolution and the guest reconfirmation promise`, C.warn, tiles + categories + recurring + reconfirmNote)
}

/** Can the rest of the report be trusted? */
function integritySection(d: ReportData, i: PeriodInsights, periodWord: string): string {
  const g = i.integrity
  const clean = g.parityMissing === 0 && g.countCheckShort === 0 && !g.unswept

  const tiles = kpiRow([
    {
      label: 'AS parity',
      value: `${num(d.parity.systemHeld)}/${num(d.parity.upstreamConfirmed)}`,
      note: !d.parity.available
        ? 'Apple System unreachable'
        : `${g.parityMissing ? `${num(g.parityMissing)} missing` : 'all imported'}${d.parity.source === 'ledger' ? ' · last reconciliation' : ''}`,
      color: g.parityMissing ? C.bad : C.good,
    },
    {
      label: 'Count check',
      value: g.countCheckAvailable
        ? `${num(d.countCheck.overall.upstream)}/${num(d.countCheck.overall.pnls)}/${num(d.countCheck.overall.invoices)}`
        : '—',
      note: g.unswept ? 'not swept' : g.countCheckAvailable ? (g.countCheckShort ? `${num(g.countCheckShort)} short` : 'balanced') : 'unreachable',
      color: g.countCheckShort ? C.bad : C.ink,
    },
    { label: 'Auto-imported', value: num(g.automationCreated), note: `${num(g.automationCancelled)} auto-cancelled` },
    { label: 'Flagged / errors', value: `${num(g.automationFlagged)}/${num(g.automationErrors)}`, note: 'Left for a person', color: g.automationFlagged || g.automationErrors ? C.warn : C.ink },
  ])

  const verdict = clean
    ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px 14px;font:400 12px/1.7 ${FONT};color:#065f46;">
         <strong>Every confirmation AppleSystem raised this ${periodWord} is in this system, and the accounts ledger agrees.</strong>
         The figures above describe a whole ${periodWord}, not the part of one that made it through.
       </div>`
    : `<div style="background:#fff5f5;border:1px solid ${C.bad};border-radius:10px;padding:12px 14px;font:400 12px/1.7 ${FONT};color:${C.ink};">
         <strong>This ${periodWord}'s figures are incomplete.</strong>
         ${g.parityMissing ? `${num(g.parityMissing)} confirmation${g.parityMissing === 1 ? '' : 's'} never reached this system. ` : ''}
         ${g.countCheckShort ? `The count check is short by ${num(g.countCheckShort)} across bookings, P&amp;Ls and invoices. ` : ''}
         ${g.unswept ? 'The accounts ledger was never swept for this period, so the count check could not be made. ' : ''}
         Every reference is in the workbook — “AS Parity” and “Count Check”.
       </div>`

  // The Apple System did not answer while this mail was written: the report
  // was still sent, and this says which parity figures the reader is holding.
  const upstreamNote = d.parity.source !== 'live' && d.parity.note
    ? `<div style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;font:400 12px/1.6 ${FONT};color:#92400e;">
         ${esc(d.parity.note)}
       </div>`
    : ''

  return section(
    'Integrity',
    `Whether the numbers above describe the whole ${periodWord}`,
    clean ? C.good : C.bad,
    tiles + verdict + upstreamNote,
  )
}

/** The forward book — the only forward-looking block a backward report carries. */
function forwardSection(d: ReportData, periodWord: string): string {
  const u = d.upcoming
  const tiles = kpiRow([
    { label: 'On the book', value: num(u.total), note: `${num(u.pax)} guests` },
    { label: 'Next 7 days', value: num(u.next7), note: `${num(d.readiness.notReady)} of the next 3 days not ready`, color: d.readiness.notReady ? C.warn : C.ink },
    { label: 'Next 30 days', value: num(u.next30), note: '&nbsp;' },
    { label: 'Beyond 30', value: num(u.beyond30), note: '&nbsp;' },
  ])

  const months = u.byMonth.length
    ? tableOpen([{ text: 'Arrival month' }, { text: 'Tours', align: 'right', width: '60' }, { text: 'Guests', align: 'right', width: '60' }, { text: 'Share', width: '150' }]) +
      u.byMonth.map(m => `<tr>
        ${td(esc(m.label), { bold: true, color: C.ink, nowrap: true })}
        ${td(num(m.bookings), { align: 'right', bold: true, color: C.ink })}
        ${td(num(m.pax), { align: 'right' })}
        ${td(bar(m.bookings, Math.max(1, ...u.byMonth.map(x => x.bookings)), C.b2b))}
      </tr>`).join('') + TABLE_CLOSE
    : emptyNote('Nothing is on the forward book.')

  return section(
    'Forward book',
    `What the business is already carrying, as at the morning after the ${periodWord} closed`,
    C.b2b,
    tiles + months,
  )
}

// ─── Guest voice ──────────────────────────────────────────────────────────────

/** One stacked good / warning / bad bar. */
function verdictBar(good: number, warning: number, bad: number): string {
  const total = good + warning + bad
  if (!total) return `<div style="font:400 11px/1.4 ${FONT};color:${C.faint};">No calls judged</div>`
  const w = (n: number) => Math.max(n ? 2 : 0, Math.round((n / total) * 100))
  const cell = (n: number, color: string) => n
    ? `<td width="${w(n)}%" style="background:${color};height:10px;line-height:10px;font-size:0;">&nbsp;</td>`
    : ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:999px;overflow:hidden;"><tr>${cell(good, C.good)}${cell(warning, C.warn)}${cell(bad, C.bad)}</tr></table>`
}

const LEVEL_STYLE = { bad: { ink: '#991b1b', bg: '#fef2f2', word: 'BAD' }, warning: { ink: '#92400e', bg: '#fffbeb', word: 'WARNING' } }
const RATING_STYLE: Record<string, { ink: string; bg: string }> = {
  EXCELLENT: { ink: '#065f46', bg: '#ecfdf5' }, GOOD: { ink: '#1e40af', bg: '#eff6ff' },
  AVERAGE: { ink: '#92400e', bg: '#fffbeb' }, POOR: { ink: '#991b1b', bg: '#fef2f2' },
}

/**
 * What guests said — the AI operation calls, the feedback forms and the desk.
 *
 * Complaints are not repeated here: they are the alerts these calls raised, and
 * the service-quality block above already counts them once, de-duplicated.
 */
function guestVoiceSection(d: ReportData, periodWord: string): string {
  const { calls, forms, desk } = d.guestVoice
  if (!calls.available && !forms.available && !desk.available) return ''

  const v = calls.verdicts
  const judged = v.good + v.warning + v.bad
  const pt = calls.postTour

  const tiles = kpiRow([
    {
      label: 'AI calls made',
      value: calls.available ? num(calls.done) : '—',
      note: calls.available ? `of ${num(calls.assigned)} assigned · ${calls.completionRate}%` : 'Call service unavailable',
    },
    {
      label: 'Went well',
      value: judged ? `${Math.round((v.good / judged) * 100)}%` : '—',
      note: judged ? `${num(v.good)} good · ${num(v.warning)} warn · ${num(v.bad)} bad` : 'No calls judged',
      color: judged && v.bad / judged > 0.15 ? C.bad : C.good,
    },
    {
      label: 'Post-tour rating',
      value: pt.avgRating !== null ? `${pt.avgRating}<span style="font-size:13px;color:${C.faint};">/10</span>` : '—',
      note: pt.nps !== null ? `NPS ${pt.nps > 0 ? '+' : ''}${pt.nps} · ${num(pt.rated)} rated` : `${num(pt.calls)} post-tour calls`,
      color: pt.avgRating !== null && pt.avgRating < 7 ? C.warn : C.ink,
    },
    {
      label: 'Feedback forms',
      value: forms.available ? num(forms.total) : '—',
      note: desk.rated ? `Desk avg ${desk.avgRating}/5 (${num(desk.rated)})` : forms.total ? `${num(forms.overall.EXCELLENT + forms.overall.GOOD)} rated good+` : '&nbsp;',
    },
  ])

  const phases = calls.available && calls.byPhase.some(p => p.assigned)
    ? `<div class="h3">AI calls by stage</div>` +
      tableOpen([
        { text: 'Stage' },
        { text: 'Made', align: 'right', width: '55' },
        { text: 'Assigned', align: 'right', width: '65' },
        { text: 'How they went', width: '200' },
        { text: 'Bad', align: 'right', width: '40' },
      ]) +
      calls.byPhase.map(p => `<tr>
        ${td(esc(p.label), { bold: true, color: C.ink })}
        ${td(num(p.done), { align: 'right', bold: true, color: C.ink })}
        ${td(num(p.assigned), { align: 'right', color: C.muted })}
        ${td(verdictBar(p.good, p.warning, p.bad))}
        ${td(num(p.bad), { align: 'right', color: p.bad ? C.bad : C.muted })}
      </tr>`).join('') + TABLE_CLOSE +
      `<div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding:6px 0 14px 0;">
         <span style="color:${C.good};">■</span> good &nbsp; <span style="color:${C.warn};">■</span> warning &nbsp; <span style="color:${C.bad};">■</span> bad — the same sort the AI Call Report page uses.
       </div>`
    : ''

  const areas = calls.areaProblems.filter(a => a.bad || a.good)
  const areaBlock = areas.length
    ? `<div class="h3">On-tour checks — where guests said it went wrong</div>` +
      tableOpen([{ text: 'Area' }, { text: 'Bad', align: 'right', width: '50' }, { text: 'Good', align: 'right', width: '50' }, { text: 'Share bad', width: '160' }]) +
      areas.map(a => `<tr>
        ${td(esc(a.area), { bold: true, color: C.ink })}
        ${td(num(a.bad), { align: 'right', bold: true, color: a.bad ? C.bad : C.muted })}
        ${td(num(a.good), { align: 'right', color: C.muted })}
        ${td(bar(a.bad, Math.max(1, a.bad + a.good), C.bad))}
      </tr>`).join('') + TABLE_CLOSE
    : ''

  const issues = calls.issues.slice(0, 8)
  const issueBlock = issues.length
    ? `<div class="h3" style="padding-top:16px;">Calls that need a look — ${num(calls.issueTotals.bad)} bad, ${num(calls.issueTotals.warning)} warning</div>` +
      issues.map(x => {
        const st = LEVEL_STYLE[x.level]
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-left:3px solid ${st.ink};border-radius:8px;margin-bottom:7px;border-collapse:separate;">
          <tr><td style="padding:9px 12px;">
            <span class="pill" style="background:${st.bg};color:${st.ink};">${st.word}</span>
            <span style="font:700 12px/1.5 ${FONT};color:${C.ink};padding-left:6px;">${esc(x.bookingRef)}</span>
            <span style="font:400 11px/1.5 ${FONT};color:${C.faint};"> · ${esc(PHASE_NAME[x.phase] ?? x.phase)}${x.date ? ` · ${esc(formatReportDate(x.date))}` : ''}</span>
            <div style="font:400 12px/1.6 ${FONT};color:${C.body};padding-top:4px;">${truncate(x.reason, 160)}</div>
          </td></tr>
        </table>`
      }).join('') + moreNote(issues.length, calls.issueTotals.bad + calls.issueTotals.warning, 'calls')
    : ''

  const formAreas = forms.areas.filter(a => a.rated)
  const formBlock = formAreas.length
    ? `<div class="h3" style="padding-top:16px;">Feedback forms — score by area</div>` +
      tableOpen([
        { text: 'Area' },
        { text: 'Rated', align: 'right', width: '50' },
        { text: 'Excellent', align: 'right', width: '65' },
        { text: 'Poor', align: 'right', width: '45' },
        { text: 'Score', width: '150' },
      ]) +
      formAreas.map(a => `<tr>
        ${td(esc(a.area), { bold: true, color: C.ink })}
        ${td(num(a.rated), { align: 'right' })}
        ${td(num(a.excellent), { align: 'right', color: C.good })}
        ${td(num(a.poor), { align: 'right', color: a.poor ? C.bad : C.muted })}
        ${td(`${bar(a.score ?? 0, 100, (a.score ?? 0) >= 75 ? C.good : (a.score ?? 0) >= 50 ? C.warn : C.bad)}<div style="font:700 10px/1.4 ${FONT};color:${C.muted};padding-top:2px;">${a.score ?? '—'}/100</div>`)}
      </tr>`).join('') + TABLE_CLOSE
    : ''

  const remarks = forms.remarks.slice(0, 4)
  const remarkBlock = remarks.length
    ? `<div class="h3" style="padding-top:16px;">In their words</div>` +
      remarks.map(r => {
        const st = RATING_STYLE[r.overall ?? ''] ?? { ink: C.muted, bg: C.wash }
        return `<div style="border-left:3px solid ${st.ink};background:${st.bg};border-radius:0 8px 8px 0;padding:9px 12px;margin-bottom:7px;">
          <div style="font:italic 400 12px/1.65 ${FONT};color:${C.body};">“${truncate(r.remarks, 240)}”</div>
          <div style="font:400 11px/1.5 ${FONT};color:${C.faint};padding-top:3px;">${esc(r.bookingRef)} · ${esc(r.country)}${r.overall ? ` · overall ${esc(r.overall.toLowerCase())}` : ''}</div>
        </div>`
      }).join('')
    : ''

  const partial = calls.source === 'api'
    ? `<div style="margin-top:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;font:400 11px/1.6 ${FONT};color:#92400e;">The call database could not be read, so the AI-call figures came from the capped upstream API and may be low.</div>`
    : ''

  return section(
    'Guest voice — AI calls & feedback',
    `What guests told the AI operation calls, the feedback forms and the desk this ${periodWord} — every call is on the “Guest Voice” sheet`,
    C.b2c,
    tiles + phases + areaBlock + issueBlock + formBlock + remarkBlock + partial,
  )
}

const PHASE_NAME: Record<string, string> = { pre_tour: 'Pre-tour call', on_tour: 'On-tour call', post_tour: 'Post-tour call' }

// ─── AI outlook ───────────────────────────────────────────────────────────────

/** The booking history as a column chart, drawn with table cells so Outlook keeps it. */
function historyChart(history: PeriodAdvice['history'], forecast: PeriodAdvice['forecast']): string {
  const shown = history.slice(-12)
  const points = [
    ...shown.map(h => ({ label: h.label.slice(0, 3), value: h.bookings, kind: 'actual' as const })),
    ...forecast.map(f => ({ label: f.label.slice(0, 3), value: f.aiExpected ?? f.baseline, kind: 'forecast' as const })),
  ]
  const max = Math.max(1, ...points.map(p => p.value ?? 0), ...forecast.map(f => f.high))
  const H = 110
  const cols = points.map((p, idx) => {
    const h = p.value ? Math.max(3, Math.round((p.value / max) * H)) : 0
    const last = idx === shown.length - 1
    const color = p.kind === 'forecast' ? '#c4b5fd' : last ? C.brand : '#99d5cf'
    return `<td valign="bottom" align="center" style="padding:0 2px;">
      <div style="font:700 9px/1.2 ${FONT};color:${p.kind === 'forecast' ? C.b2c : C.muted};padding-bottom:2px;">${p.value === null ? '' : num(p.value)}</div>
      ${h ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${h}" style="height:${h}px;background:${color};border-radius:4px 4px 0 0;${p.kind === 'forecast' ? `border:1px dashed ${C.b2c};` : ''}font-size:0;line-height:0;">&nbsp;</td></tr></table>`
        : `<div style="font:400 9px/1.2 ${FONT};color:${C.faint};">n/a</div>`}
    </td>`
  }).join('')
  const labels = points.map(p => `<td align="center" style="font:600 9px/1.4 ${FONT};color:${p.kind === 'forecast' ? C.b2c : C.faint};padding-top:4px;">${esc(p.label)}</td>`).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-bottom:1px solid ${C.line};"><tr>${cols}</tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${labels}</tr></table>
    <div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding-top:6px;">
      <span style="color:#99d5cf;">■</span> B2B confirmed per month &nbsp; <span style="color:${C.brand};">■</span> this month &nbsp; <span style="color:#c4b5fd;">■</span> forecast
    </div>`
}

const OWNER_COLOR: Record<string, string> = {
  'Ground Team': C.good, 'Booking Team': C.b2b, 'Travel Experience': C.b2c, Reservations: '#0891b2', Accounts: C.warn, Management: C.ink,
}

/**
 * The closing section: where bookings are heading, how to fix what guests
 * complained about, and how to grow — written with OpenAI from this report's
 * own figures, with the forecast anchored on a statistical baseline.
 */
function outlookSection(d: ReportData): string {
  const a = d.advice
  if (!a) return ''

  const forecastCards = a.forecast.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -5px 14px -5px;"><tr>${a.forecast.map(f => `
        <td width="${Math.floor(100 / a.forecast.length)}%" valign="top" style="padding:0 5px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;border-collapse:separate;">
            <tr><td style="padding:14px 15px;">
              <div style="font:700 10px/1.3 ${FONT};color:${C.b2c};text-transform:uppercase;letter-spacing:.08em;">${esc(f.label)} · expected B2B bookings</div>
              <div style="font:800 32px/1.1 ${FONT};color:${C.ink};padding-top:6px;letter-spacing:-.02em;">${num(f.aiExpected ?? f.baseline)}</div>
              <div style="font:400 12px/1.5 ${FONT};color:${C.muted};padding-top:3px;">likely range <strong style="color:${C.ink};">${num(f.low)} – ${num(f.high)}</strong>${f.aiExpected !== null && f.aiExpected !== f.baseline ? ` · statistical ${num(f.baseline)}` : ''}</div>
              ${f.aiReason ? `<div style="font:400 12px/1.6 ${FONT};color:${C.body};padding-top:8px;border-top:1px solid #ddd6fe;margin-top:9px;">${esc(f.aiReason)}</div>` : ''}
            </td></tr>
          </table>
        </td>`).join('')}</tr></table>`
    : emptyNote(a.method)

  const chart = a.history.some(h => h.bookings !== null) ? historyChart(a.history, a.forecast) : ''

  const fixes = a.complaintFixes.length
    ? `<div class="h3" style="padding-top:20px;">Fixing what guests complained about</div>` +
      a.complaintFixes.map((f, idx) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:10px;margin-bottom:9px;border-collapse:separate;">
          <tr>
            <td width="34" valign="top" style="padding:12px 0 12px 12px;">
              <div style="width:26px;height:26px;border-radius:13px;background:${C.bad};color:#ffffff;font:800 12px/26px ${FONT};text-align:center;">${idx + 1}</div>
            </td>
            <td style="padding:11px 13px 12px 10px;">
              <div style="font:700 13px/1.4 ${FONT};color:${C.ink};">${esc(f.theme)} <span style="font-weight:400;color:${C.muted};">· ${num(f.count)} this month</span></div>
              <div style="font:400 12px/1.6 ${FONT};color:${C.muted};padding-top:4px;"><strong style="color:${C.body};">Likely cause:</strong> ${esc(f.rootCause)}</div>
              <div style="font:400 12px/1.6 ${FONT};color:${C.body};padding-top:4px;"><strong style="color:${C.good};">Fix:</strong> ${esc(f.fix)}</div>
              <div style="padding-top:6px;"><span class="pill" style="background:${C.wash};color:${OWNER_COLOR[f.owner] ?? C.ink};border:1px solid ${C.line};">Owner · ${esc(f.owner)}</span></div>
            </td>
          </tr>
        </table>`).join('')
    : ''

  const growth = a.growth.length
    ? `<div class="h3" style="padding-top:20px;">How to grow the business</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
      a.growth.map((g, idx) => `
        <tr><td style="padding:0 0 9px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;border-collapse:separate;">
            <tr>
              <td width="34" valign="top" style="padding:12px 0 12px 12px;font:800 16px/1.2 ${FONT};color:${C.good};">${String(idx + 1).padStart(2, '0')}</td>
              <td style="padding:11px 13px 12px 8px;">
                <div style="font:700 13px/1.4 ${FONT};color:${C.ink};">${esc(g.title)}</div>
                <div style="font:400 12px/1.6 ${FONT};color:${C.body};padding-top:3px;">${esc(g.detail)}</div>
                <div style="font:600 11px/1.5 ${FONT};color:#047857;padding-top:5px;">↳ ${esc(g.evidence)}</div>
              </td>
            </tr>
          </table>
        </td></tr>`).join('') + '</table>'
    : ''

  const note = a.aiNote
    ? `<div style="margin-top:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:9px 12px;font:400 12px/1.6 ${FONT};color:#92400e;">${esc(a.aiNote)}</div>`
    : ''

  const howMade = `<div style="margin-top:14px;padding-top:12px;border-top:1px dashed ${C.line};font:400 11px/1.65 ${FONT};color:${C.faint};">
      <strong style="color:${C.muted};">How this was made.</strong> ${esc(a.method)}
      ${a.model ? ` The estimate, the fixes and the growth ideas were written by OpenAI (${esc(a.model)}) from this report's own figures only; its estimate is kept only when it falls inside the statistical range, each complaint count is ours, and each idea cites the figure it rests on. Treat it as a well-briefed second opinion, not a decision.` : ''}
    </div>`

  return section(
    'Outlook — forecast, fixes and growth',
    'The next two months, what to fix, and where to grow — prepared with OpenAI from this report',
    C.b2c,
    forecastCards + chart + fixes + growth + note + howMade,
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export interface PeriodRenderOptions {
  /**
   * The schedule's section toggles, mapped onto the blocks this layout has.
   *
   * The periodic report has different blocks from the daily one, so the toggles
   * cannot map one-to-one — but a schedule that switched a subject off should
   * not have it reappear under a new heading, so each toggle governs the block
   * that answers the same question: `created` the commercial analysis,
   * `onGround` what was delivered, `complaints` service quality, `parity`
   * integrity and `upcoming` the forward book. The action list is never gated:
   * it is the reason the mail is sent.
   */
  sections?: { created?: boolean; parity?: boolean; onGround?: boolean; readiness?: boolean; reconfirm?: boolean; complaints?: boolean; upcoming?: boolean }
  narrative?: string | null
  dashboardUrl?: string | null
  scheduleName?: string
  testSend?: boolean
  /** Whether the workbook is actually attached — the mail must not promise a file that is not there. */
  workbookAttached?: boolean
  /** Sheet names, listed in the footer so a reader knows what they have. */
  workbookSheets?: string[]
}

/**
 * Solid colours only on the dark header. Outlook's Word renderer drops `rgba()`
 * and falls back to black, which is how the labels on the old scorecard ended
 * up near-invisible dark grey on dark teal.
 */
const HERO = {
  deep: '#0b3d3a',
  tile: '#115e59',
  tileLine: '#1f7a72',
  eyebrow: '#99f6e4',
  soft: '#ccfbf1',
  dim: '#a7d3cc',
  up: '#6ee7b7',
  down: '#fca5a5',
}

/** "October 2026" for a month, "03 Aug – 09 Aug 2026" for a week. */
function periodName(w: ReportWindow): string {
  return w.period === 'MONTHLY'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .format(new Date(`${w.fromDate}T00:00:00Z`))
    : `${formatReportDate(w.fromDate)} – ${formatReportDate(w.toDate)}`
}

/** "▲ 12 (+4%)" in the colour of its verdict, for the dark header. */
function heroDelta(current: number, previous: number | null, opts: { invert?: boolean; comparable?: boolean } = {}): string {
  if (previous === null || opts.comparable === false) return `<span style="color:${HERO.dim};">no baseline</span>`
  const delta = current - previous
  if (delta === 0) return `<span style="color:${HERO.dim};">level with last</span>`
  const up = delta > 0
  const good = opts.invert ? !up : up
  const pctText = previous > 0 ? ` (${up ? '+' : '−'}${Math.abs(Math.round((delta / previous) * 100))}%)` : ''
  return `<span style="color:${good ? HERO.up : HERO.down};font-weight:700;">${up ? '▲' : '▼'} ${num(Math.abs(delta))}${pctText}</span>`
}

function headerBlock(d: ReportData, opts: PeriodRenderOptions): string {
  const w = d.window
  const i = d.insights
  const badge = [
    opts.testSend ? 'TEST SEND' : '',
    w.anchored ? `BACK-DATED TO ${formatReportDate(w.toDate).toUpperCase()}` : '',
  ].filter(Boolean).map(text =>
    `<span style="display:inline-block;margin:0 0 6px 5px;padding:3px 9px;border-radius:999px;background:${HERO.tile};border:1px solid ${HERO.tileLine};color:#ffffff;font:700 10px/1.5 ${FONT};letter-spacing:.08em;">${esc(text)}</span>`,
  ).join('')

  // The monthly review leads with the activity split in the scorecard below,
  // not a B2B confirmed headline.
  const headline = i && w.period !== 'MONTHLY'
    ? `<div style="font:700 10px/1.4 ${FONT};color:${HERO.eyebrow};text-transform:uppercase;letter-spacing:.12em;">B2B confirmed</div>
       <div style="font:800 40px/1.05 ${FONT};color:#ffffff;letter-spacing:-0.03em;padding-top:2px;">${num(i.totals.bookings)}</div>
       <div style="font:400 12px/1.5 ${FONT};padding-top:3px;">${heroDelta(i.totals.bookings, i.comparable ? i.totals.previousBookings : null)}<span style="color:${HERO.dim};"> vs ${esc(i.previousLabel)}</span></div>`
    : ''

  return `
  <tr><td style="background:${C.brandDeep};background-image:linear-gradient(135deg,${C.brandDeep} 0%,${C.brand} 100%);padding:28px 26px 24px 26px;border-radius:16px 16px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td valign="top">
          <div style="font:700 11px/1.4 ${FONT};color:${HERO.eyebrow};text-transform:uppercase;letter-spacing:.14em;">AppleHolidays Operations · ${esc(PERIOD_LABEL[w.period])} Review</div>
          <div style="font:800 30px/1.15 ${FONT};color:#ffffff;padding-top:8px;letter-spacing:-0.02em;">${esc(periodName(w))}</div>
          <div style="font:400 13px/1.5 ${FONT};color:${HERO.soft};padding-top:6px;">${esc(formatReportDate(w.fromDate))} – ${esc(formatReportDate(w.toDate))} · ${esc(w.timezone)}</div>
        </td>
        <td align="right" valign="top" style="white-space:nowrap;padding-left:12px;">${badge}${headline}</td>
      </tr>
    </table>
  </td></tr>`
}

/** "82% good" — the share of connected AI calls that went well. */
function guestTile(d: ReportData): { label: string; value: string; sub: string } {
  const v = d.guestVoice.calls.verdicts
  const judged = v.good + v.warning + v.bad
  if (!d.guestVoice.calls.available || !judged) {
    return { label: 'Guest feedback', value: '—', sub: `<span style="color:${HERO.dim};">no AI calls judged</span>` }
  }
  const good = Math.round((v.good / judged) * 100)
  return {
    label: 'Guest feedback',
    value: `${good}%`,
    sub: `<span style="color:${good >= 80 ? HERO.up : HERO.down};font-weight:700;">good</span><span style="color:${HERO.dim};"> · ${num(v.bad)} bad of ${num(judged)} calls</span>`,
  }
}

/** The scorecard — two rows of four, each number carrying its own movement. */
function scorecard(d: ReportData, i: PeriodInsights): string {
  const short = i.integrity.parityMissing + i.integrity.countCheckShort
  const b2c = b2cOrders(i)
  const sp = d.split
  // The monthly review opens on the same two-pass split as the daily mails —
  // the month's own files, then older files re-opened — and the trips that
  // finished inside the month.
  const lead: { label: string; value: string; sub: string }[] = d.window.period === 'MONTHLY'
    ? [
        {
          label: 'This month new & updated',
          value: num(todayNewAndUpdated(d)),
          sub: `<span style="color:${HERO.dim};">${sp.available
            ? (() => { const [c, u, o] = activityBreakdown(sp).stages; return `${num(c.count)} created · ${num(u.count)} created &amp; updated · ${num(o.count)} old updated` })()
            : 'accounts unreachable'}</span>`,
        },
        {
          label: 'Old amendments',
          value: sp.available ? num(sp.oldCount) : '—',
          sub: `<span style="color:${HERO.dim};">${sp.available
            ? (sp.oldCount ? (sp.oldest ? `oldest ${num(sp.oldest)}d back` : 'older files re-opened') : 'none re-opened')
            : 'accounts unreachable'}</span>`,
        },
        {
          label: 'Completed trips',
          value: i.delivery.available ? num(i.delivery.departures) : '—',
          sub: `<span style="color:${HERO.dim};">${i.delivery.available ? 'tours that ended this month' : 'unavailable'}</span>`,
        },
      ]
    : [
        {
          label: 'B2C store orders',
          value: b2c.available ? num(b2c.orders) : '—',
          sub: b2c.available ? heroDelta(b2c.orders, b2c.previous) : `<span style="color:${HERO.dim};">unavailable</span>`,
        },
        { label: 'Guests booked', value: num(i.totals.pax + (i.b2c.available ? i.b2c.pax : 0)), sub: `<span style="color:${HERO.dim};">${num(i.totals.pax)} B2B · ${num(i.b2c.pax)} store, in OPS</span>` },
        { label: 'Tours operated', value: num(i.delivery.toursOperated), sub: `<span style="color:${HERO.dim};">${num(i.delivery.pax)} guests · ${num(i.delivery.guestDays)} guest-days</span>` },
      ]
  const cells: { label: string; value: string; sub: string }[] = [
    ...lead,
    { label: 'Forward book', value: num(d.upcoming.total), sub: `<span style="color:${HERO.dim};">${num(d.upcoming.next30)} arriving in 30 days</span>` },
    {
      label: 'Cancelled',
      value: num(i.cancellations.total),
      sub: i.cancellations.ratePct !== null
        ? `<span style="color:${HERO.dim};">${i.cancellations.ratePct}% of intake · </span>${heroDelta(i.cancellations.total, i.cancellations.previousTotal, { invert: true, comparable: i.comparable })}`
        : '—',
    },
    {
      label: 'Complaints',
      value: num(i.quality.complaints),
      sub: `${heroDelta(i.quality.complaints, i.quality.previousComplaints, { invert: true })}${i.quality.per100Tours !== null ? `<span style="color:${HERO.dim};"> · ${i.quality.per100Tours}/100 tours</span>` : ''}`,
    },
    // The monthly review is for management and carries no integrity block —
    // that chase lives in the daily mail — so its tile is the guests' verdict.
    d.window.period === 'MONTHLY'
      ? guestTile(d)
      : {
          label: 'Integrity',
          value: short ? 'SHORT' : 'OK',
          sub: short
            ? `<span style="color:${HERO.down};font-weight:700;">${num(short)} to chase</span>`
            : `<span style="color:${HERO.up};font-weight:700;">parity + accounts agree</span>`,
        },
    {
      label: 'Test bookings',
      value: num(d.testBookings.total),
      sub: `<span style="color:${HERO.dim};">${d.testBookings.available ? 'left out of every figure' : 'register unreadable'}</span>`,
    },
  ]

  const tile = (c: { label: string; value: string; sub: string }) => `
    <td width="25%" valign="top" style="padding:5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${HERO.tile};border:1px solid ${HERO.tileLine};border-radius:12px;border-collapse:separate;">
        <tr><td style="padding:12px 12px 11px 12px;">
          <div style="font:700 10px/1.3 ${FONT};color:${HERO.eyebrow};text-transform:uppercase;letter-spacing:.08em;">${esc(c.label)}</div>
          <div style="font:800 24px/1.15 ${FONT};color:#ffffff;padding-top:5px;letter-spacing:-0.02em;">${esc(c.value)}</div>
          <div style="font:400 11px/1.45 ${FONT};padding-top:4px;">${c.sub}</div>
        </td></tr>
      </table>
    </td>`

  return `
  <tr><td style="background:${HERO.deep};padding:12px 13px 14px 13px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>${cells.slice(0, 4).map(tile).join('')}</tr>
      <tr>${cells.slice(4).map(tile).join('')}</tr>
    </table>
  </td></tr>`
}

/**
 * The four biggest moves of the period, by bookings — the rising and falling
 * partner, the rising and falling market. Absolute numbers on purpose: "−75%"
 * on a market that went 4 → 1 is three bookings, and a percentage strip would
 * put it above a partner that lost forty.
 */
function moversStrip(i: PeriodInsights, periodWord: string): string {
  if (!i.comparable) return ''
  const pick = (rows: MoverRow[], dir: 1 | -1) => rows
    .filter(m => Math.sign(m.delta) === dir)
    .sort((a, b) => dir * (b.delta - a.delta))[0] ?? null

  const cards = [
    { title: 'Partner up', m: pick(i.agentMovers, 1), up: true },
    { title: 'Partner down', m: pick(i.agentMovers, -1), up: false },
    { title: 'Market up', m: pick(i.countryMovers, 1), up: true },
    { title: 'Market down', m: pick(i.countryMovers, -1), up: false },
  ]
  if (cards.every(c => !c.m)) return ''

  const cell = (c: (typeof cards)[number]) => {
    const tone = c.up ? { ink: '#065f46', bg: '#ecfdf5', line: '#a7f3d0' } : { ink: '#991b1b', bg: '#fef2f2', line: '#fecaca' }
    const body = c.m
      ? `<div style="font:700 13px/1.35 ${FONT};color:${C.ink};padding-top:5px;">${truncate(c.m.label, 26)}</div>
         <div style="font:800 18px/1.2 ${FONT};color:${tone.ink};padding-top:4px;">${c.up ? '▲' : '▼'} ${num(Math.abs(c.m.delta))}</div>
         <div style="font:400 11px/1.4 ${FONT};color:${C.muted};padding-top:2px;">${num(c.m.previous)} → ${num(c.m.current)} bookings</div>`
      : `<div style="font:400 12px/1.5 ${FONT};color:${C.faint};padding-top:8px;">Nothing ${c.up ? 'grew' : 'fell'}</div>`
    return `<td width="25%" valign="top" style="padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${tone.bg};border:1px solid ${tone.line};border-radius:10px;border-collapse:separate;">
        <tr><td style="padding:11px 12px;">
          <div style="font:700 10px/1.3 ${FONT};color:${tone.ink};text-transform:uppercase;letter-spacing:.08em;">${c.title}</div>
          ${body}
        </td></tr>
      </table>
    </td>`
  }

  return section(
    'Biggest moves',
    `What changed most against ${i.previousLabel}, in bookings — the ${periodWord}'s story in four cards`,
    C.b2b,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -4px;"><tr>${cards.map(cell).join('')}</tr></table>`,
  )
}

/**
 * The period's B2C order count — the store's own figure, split the way the
 * AahaasFlow board splits it, when it could be read; otherwise what OPS imported.
 */
function b2cOrders(i: PeriodInsights): { available: boolean; orders: number; previous: number | null } {
  if (i.storeMix.available) return { available: true, orders: i.storeMix.b2c, previous: i.storeMix.previousB2c }
  return { available: i.b2c.available, orders: i.b2c.orders, previous: i.b2c.available ? i.b2c.previousOrders : null }
}

/** Every Aahaas store order, on the AahaasFlow boards. Beside the B2B intake, never inside it. */
function b2cSection(i: PeriodInsights, periodWord: string): string {
  const m = i.storeMix
  const b = i.b2c
  if (!m.available && !b.available) return ''
  if (!m.all && !m.cancelled && !b.orders && !b.previousOrders && !b.cancelled) return ''

  const chip = (now: number, prev: number | null) => (prev === null ? deltaChip(now, 0, { comparable: false }) : deltaChip(now, prev))
  const store = m.available
    ? kpiRow([
      { label: 'All orders', value: num(m.all), note: chip(m.all, m.previousAll), color: C.ink },
      { label: 'B2B Packages', value: num(m.b2bPackages), note: chip(m.b2bPackages, m.previousB2bPackages), color: C.b2b },
      { label: 'B2B Flights', value: num(m.b2bFlights), note: chip(m.b2bFlights, m.previousB2bFlights), color: C.b2b },
      { label: 'B2C', value: num(m.b2c), note: chip(m.b2c, m.previousB2c), color: C.b2c },
    ]) +
      `<div class="h3">By board</div>` +
      tableOpen([
        { text: 'Board' },
        { text: 'Orders', align: 'right', width: '60' },
      ]) + m.boards.map(r => `<tr>
        ${td(esc(r.label), { bold: true, color: r.board === 'cancelled' ? C.bad : r.board.startsWith('b2c') ? C.b2c : C.b2b })}
        ${td(num(r.orders), { align: 'right', bold: true, color: C.ink })}
      </tr>`).join('') + TABLE_CLOSE +
      `<div style="font:400 11px/1.6 ${FONT};color:${C.faint};padding-top:8px;">
         Counted by the date each order was booked in the Aahaas store, on the same boards and the same rule as AahaasFlow: confirmed on the console as B2B or B2C, or placed by a B2B portal account, or a direct customer; a flight order is one whose every product is a flight.
         Travel orders only (shop goods are not bookings), all markets.
         ${m.cancelled ? `${num(m.cancelled)} order${m.cancelled === 1 ? '' : 's'} with every product cancelled or refunded ${m.cancelled === 1 ? 'is' : 'are'} not in the counts.` : ''}
         ${m.tests.orders ? `${num(m.tests.orders)} test order${m.tests.orders === 1 ? ' is' : 's are'} left out.` : ''}
         ${m.tests.checked ? '' : 'The test-order register could not be read, so test orders may be in the counts.'}
         ${m.truncated ? '<strong>The period held more orders than one read allows, so every count is a floor.</strong>' : ''}
       </div>`
    : emptyNote(m.error ?? 'The Aahaas store could not be read, so the orders could not be split by board.')

  return section(
    'Aahaas store orders',
    `Every order the Aahaas store took this ${periodWord}, split as AahaasFlow shows it — reported beside the AppleSystem B2B count, not added to it`,
    C.b2c,
    store,
  )
}

/**
 * Test bookings — named, counted, and kept out of everything else.
 *
 * A figure that silently drops rows reads as a number that does not add up. So
 * every test the period left out is listed here with who marked it and why, and
 * nothing in any other block of this mail includes it.
 */
function testBookingSection(d: ReportData, periodWord: string): string {
  const t = d.testBookings
  if (!t.available && !t.total) {
    return section(
      'Test bookings',
      'Kept out of every figure in this report',
      C.warn,
      emptyNote('The test-booking register could not be read while this report was written, so nothing was left out. If test bookings exist this period, they are inside the figures above.'),
    )
  }
  if (!t.total) return ''

  const shown = t.lines.slice(0, 25)
  const rows = shown.map(l => `<tr>
    ${td(esc(l.ref), { bold: true, color: C.ink, nowrap: true })}
    ${td(l.inOps ? (l.source === 'B2C' ? pill('B2C', '#ffffff', C.b2c) : pill('B2B', '#ffffff', C.b2b)) : pill('not filed', C.muted, C.wash))}
    ${td(truncate(l.agent, 22))}
    ${td(l.inOps ? num(l.pax) : '—', { align: 'right' })}
    ${td(l.quotedTotal !== null && l.currency ? money(l.quotedTotal, l.currency) : '—', { align: 'right', nowrap: true })}
    ${td(truncate(l.markedBy, 18))}
    ${td(truncate(l.reason, 40), { color: l.reason ? C.body : C.faint })}
  </tr>`).join('')

  return section(
    `Test bookings — ${num(t.total)} not counted`,
    `Marked as tests in the shared register and left out of every figure in this ${periodWord}'s report`,
    C.warn,
    kpiRow([
      { label: 'Test bookings', value: num(t.total), note: `${num(t.b2b)} B2B · ${num(t.b2c)} B2C`, color: C.warn },
      { label: 'Guests', value: num(t.pax), note: 'Not in guests booked' },
      { label: 'Value', value: `<span style="font-size:15px;line-height:1.4;">${t.byCurrency.length ? currencyLine(t.byCurrency, 2) : '—'}</span>`, note: 'Not in revenue' },
    ]) +
    tableOpen([
      { text: 'Reference' },
      { text: 'Channel', width: '70' },
      { text: 'Agent' },
      { text: 'Pax', align: 'right', width: '40' },
      { text: 'Value', align: 'right', width: '110' },
      { text: 'Marked by', width: '90' },
      { text: 'Reason' },
    ]) + rows + TABLE_CLOSE +
    moreNote(shown.length, t.lines.length, 'test bookings') +
    `<div style="margin-top:12px;background:#fffbeb;border:1px dashed #f59e0b;border-radius:10px;padding:10px 13px;font:400 12px/1.65 ${FONT};color:#92400e;">
       A booking marked as a test is out of confirmed, guests, value, tours operated, cancellations and every comparison — this ${periodWord} and the one it is compared with. Release it in the register and it comes back in on the next send.
     </div>`,
  )
}

/**
 * The paragraph that explains the attachment.
 *
 * The one thing this mail must never do is look like it lost the detail. It did
 * not print the rows — it moved them — and the reader is told exactly where, and
 * what each sheet is for, before they go looking.
 */
function workbookNote(opts: PeriodRenderOptions, periodWord: string): string {
  if (!opts.workbookAttached) {
    return `<tr><td style="padding:0 0 22px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fffbeb;border:1px solid #fde68a;border-radius:14px;">
        <tr><td style="padding:14px 16px;font:400 12px/1.7 ${FONT};color:#92400e;">
          <strong>No workbook is attached to this send.</strong> This report deliberately prints no individual bookings —
          they live in the Excel workbook, which is switched off on this schedule. Turn “Attach workbook” on to receive it.
        </td></tr>
      </table>
    </td></tr>`
  }

  const sheets = (opts.workbookSheets ?? []).map(s => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:6px;background:#ffffff;border:1px solid ${C.line};font:600 11px/1.6 ${FONT};color:${C.body};">${esc(s)}</span>`).join('')

  return `<tr><td style="padding:0 0 22px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.wash};border:1px solid ${C.line};border-radius:14px;">
      <tr><td style="padding:15px 17px;">
        <div style="font:700 12px/1.4 ${FONT};color:${C.ink};">Every booking is in the attached Excel workbook — not in this email</div>
        <div style="font:400 12px/1.7 ${FONT};color:${C.muted};padding-top:6px;">
          This ${periodWord}'s report analyses; the workbook lists. Each sheet opens with a line saying what it holds and
          how its figures were derived, every table is filterable with a live total underneath, and the first sheet is an
          overview dashboard with a linked index of the whole file. Nothing has been summarised away — it has been moved somewhere it can be sorted.
        </div>
        <div style="padding-top:9px;">${sheets}</div>
      </td></tr>
    </table>
  </td></tr>`
}

/**
 * Drop the font stack from every inline `font:` shorthand.
 *
 * The style block already gives body, table, td, div and span the family, so
 * the stack repeated inline is ~80 bytes of nothing, a few hundred times over —
 * enough to push a full monthly review past Gmail's ~102 KB clip. The weight,
 * size, line height and style stay inline, where per-element values belong.
 */
function slimFonts(html: string): string {
  const stack = FONT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`font:(italic )?(\\d+) (\\d+px)\\/([\\d.]+px|[\\d.]+) ${stack};`, 'g')
  return html.replace(re, (_m, italic: string | undefined, weight: string, size: string, lh: string) =>
    `${italic ? 'font-style:italic;' : ''}font-weight:${weight};font-size:${size};line-height:${lh};`)
}

export function renderPeriodEmail(d: ReportData, opts: PeriodRenderOptions = {}): string {
  const i = d.insights
  const periodWord = d.window.period === 'MONTHLY' ? 'month' : 'week'
  const monthly = d.window.period === 'MONTHLY'

  // Insights are best-effort; without them there is nothing this renderer can
  // honestly say, so the caller falls back to the daily layout instead.
  if (!i) return ''

  const scopeNote = d.countries.length
    ? `Scoped to ${d.countries.map(c => esc(c.replace(/_/g, ' '))).join(', ')}`
    : 'All operating countries'

  const narrative = opts.narrative
    ? `<tr><td style="padding:0 0 22px 0;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:14px;">
           <tr><td style="padding:16px 18px;">
             <div style="font:700 11px/1.4 ${FONT};color:#0e7490;text-transform:uppercase;letter-spacing:.08em;">The ${esc(periodWord)} in a paragraph</div>
             <div style="font:400 13px/1.7 ${FONT};color:#134e4a;padding-top:7px;">${esc(opts.narrative).replace(/\n/g, '<br>')}</div>
           </td></tr>
         </table>
       </td></tr>`
    : ''

  const basisNote = `<tr><td style="padding:0 0 22px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.wash};border:1px solid ${C.line};border-radius:14px;">
        <tr><td style="padding:13px 16px;font:400 12px/1.7 ${FONT};color:${C.muted};">
          <strong style="color:${C.ink};">Counted: the ${num(i.totals.bookings)} B2B booking${i.totals.bookings === 1 ? '' : 's'} ${
            i.basis === 'apple' ? 'AppleSystem confirmed' : 'this system filed'
          } in ${esc(periodName(d.window))}${b2cOrders(i).available ? `, plus ${num(b2cOrders(i).orders)} B2C store order${b2cOrders(i).orders === 1 ? '' : 's'} shown separately` : ''}.</strong>
          ${d.testBookings.total ? `${num(d.testBookings.total)} test booking${d.testBookings.total === 1 ? ' is' : 's are'} left out of every figure and listed at the end.` : ''}
          ${i.basis === 'apple'
            ? 'The same population the accounts invoice and P&amp;L mails report, so the three figures line up.'
            : 'The accounts Sync Ledger could not be read for this period, so the count is this system\'s own intake and may not match the accounts mails.'}
          ${i.comparable
            ? `Every comparison is against ${esc(i.previousLabel)}, counted the same way.`
            : 'The previous period could not be counted on the same basis, so no change figures are shown — a delta between two different populations is not a trend.'}
        </td></tr>
      </table>
    </td></tr>`

  const want = {
    commercial: opts.sections?.created !== false,
    delivery: opts.sections?.onGround !== false,
    quality: opts.sections?.complaints !== false,
    integrity: opts.sections?.parity !== false,
    forward: opts.sections?.upcoming !== false,
  }

  const body = [
    actionSection(i, periodWord),
    // Created / created & updated / old booking updated — the same three-stage
    // cut the daily mail prints, with the creation method and the money moved.
    want.commercial ? activitySection(d, periodWord) : '',
    want.commercial ? moversStrip(i, periodWord) : '',
    want.commercial ? trendSection(i, periodWord) : '',
    want.commercial ? marketSection(i, periodWord) : '',
    want.commercial ? partnerSection(i, periodWord) : '',
    want.commercial ? b2cSection(i, periodWord) : '',
    want.commercial ? commercialSection(i, periodWord) : '',
    want.delivery ? deliverySection(i, periodWord) : '',
    // Attrition rides with intake: a period's cancellations are the other half
    // of what it sold, and reading one without the other overstates the book.
    want.commercial ? attritionSection(i, periodWord) : '',
    want.quality ? qualitySection(d, i, periodWord) : '',
    want.quality ? guestVoiceSection(d, periodWord) : '',
    // The monthly review is a management read: the parity / count-check chase
    // belongs to the daily mail and the workbook, not here.
    want.integrity && !monthly ? integritySection(d, i, periodWord) : '',
    want.forward ? forwardSection(d, periodWord) : '',
    // Never gated: a schedule that hid this block would hide why its totals
    // are lower than the raw counts somebody else is quoting.
    testBookingSection(d, periodWord),
    // Last on purpose — the look forward closes the review.
    monthly ? outlookSection(d) : '',
  ].join('')

  const footerLink = opts.dashboardUrl
    ? `<a href="${esc(opts.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:${C.brand};color:#ffffff;text-decoration:none;border-radius:8px;font:700 13px/1 ${FONT};">Open the dashboard</a>`
    : ''

  return slimFonts(compact(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(PERIOD_LABEL[d.window.period])} Business Review · ${esc(periodName(d.window))}</title>
<style type="text/css">${STYLE_BLOCK}</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(periodName(d.window))} — ${d.window.period === 'MONTHLY'
  ? `${num(todayNewAndUpdated(d))} this month new &amp; updated, ${d.split.available ? num(d.split.oldCount) : '—'} old amendments, ${num(i.delivery.departures)} completed trips,`
  : `${num(i.totals.bookings)} B2B confirmed (prev ${num(i.totals.previousBookings)}), ${num(b2cOrders(i).orders)} B2C orders, ${num(i.delivery.toursOperated)} tours operated,`} ${num(i.cancellations.total)} cancelled, ${num(i.quality.complaints)} complaints, ${i.actions.length} action${i.actions.length === 1 ? '' : 's'} to take. Every booking is in the attached workbook.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;padding:22px 12px;">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;">
      ${headerBlock(d, opts)}
      ${scorecard(d, i)}
      <tr><td style="background:#ffffff;padding:20px 18px 6px 18px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${narrative}
          ${basisNote}
          ${body}
          ${workbookNote(opts, periodWord)}
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
</body></html>`))
}

/**
 * Subject line for a periodic report.
 *
 * Written to be triaged from the inbox list: what the period did, which way it
 * moved, and the single thing that is wrong with it — in that order, because a
 * week with a parity gap is a different mail from a week without one.
 */
export function renderPeriodSubject(d: ReportData, opts: { prefix?: string; testSend?: boolean } = {}): string {
  const i = d.insights
  const range = periodName(d.window)

  const parts: string[] = []
  if (i && d.window.period === 'MONTHLY') {
    parts.push(`${todayNewAndUpdated(d)} this month new & updated`)
    if (d.split.available) parts.push(`${d.split.oldCount} old amendments`)
    if (i.delivery.available) parts.push(`${i.delivery.departures} completed trips`)
    if (i.cancellations.total) parts.push(`${i.cancellations.total} cancelled`)
    if (d.complaints.open) parts.push(`${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`)
    if (d.testBookings.total) parts.push(`${d.testBookings.total} test excluded`)
  } else if (i) {
    const move = i.comparable && i.totals.previousBookings > 0
      ? ` (${i.totals.bookings >= i.totals.previousBookings ? '+' : ''}${Math.round(((i.totals.bookings - i.totals.previousBookings) / i.totals.previousBookings) * 100)}%)`
      : ''
    parts.push(`${i.totals.bookings} B2B confirmed${move}`)
    const b2c = b2cOrders(i)
    if (b2c.available && b2c.orders) parts.push(`${b2c.orders} B2C orders`)
    if (i.delivery.available) parts.push(`${i.delivery.toursOperated} tours operated`)
    if (d.window.period !== 'MONTHLY') {
      if (i.integrity.parityMissing) parts.push(`${i.integrity.parityMissing} MISSING upstream`)
      if (i.integrity.countCheckShort) parts.push(`count check short ${i.integrity.countCheckShort}`)
    }
    if (i.cancellations.total) parts.push(`${i.cancellations.total} cancelled`)
    if (i.quality.unexplainedBreaches) parts.push(`${i.quality.unexplainedBreaches} D-${RECONFIRM_DUE_DAYS} unexplained`)
    if (d.complaints.open) parts.push(`${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`)
    if (d.testBookings.total) parts.push(`${d.testBookings.total} test excluded`)
  } else {
    parts.push(`${d.created.total} confirmed`)
  }

  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}${PERIOD_LABEL[d.window.period]} Business Review · ${range} · ${parts.join(', ')}`
}
