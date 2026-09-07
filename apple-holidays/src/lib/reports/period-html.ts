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
 *  1. **Scorecard** — the eight numbers, each with its own delta.
 *  2. **What to do** — the derived action list. Deliberately above the analysis:
 *     a reader who stops after one screen should have stopped in the right place.
 *  3. **Trend** — intake by day (week) or week (month), drawn against the
 *     arrivals it produced.
 *  4. **Markets / partners** — who grew, who slipped, who went quiet.
 *  5. **Commercial** — value, party size, lead time, concentration.
 *  6. **Delivered** — what operations actually carried, in guest-days.
 *  7. **Attrition** — cancellations, their notice and their cost.
 *  8. **Service quality** — complaints per hundred tours, resolution, D-10.
 *  9. **Integrity** — parity, the count check, the reconciler's own work.
 * 10. **Forward book** — what the next period is already carrying.
 *
 * Written for mail clients under exactly the rules `email-kit` documents:
 * tables, a 680px shell, classes over inline styles, nothing Word drops.
 */
import {
  formatReportDate, PERIOD_LABEL, type ReportWindow,
} from './report-window'
import {
  bar, C, compact, emptyNote, esc, FONT, kpiRow, money, num, pill, section,
  STYLE_BLOCK, TABLE_CLOSE, tableOpen, td, truncate,
} from './email-kit'
import type { ReportData } from './report-data'
import type { MoverRow, PeriodAction, PeriodInsights, PeriodPoint } from './period-insights'
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
      note: d.parity.available ? (g.parityMissing ? `${num(g.parityMissing)} missing` : 'all imported') : 'not checked',
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

  return section(
    'Integrity',
    `Whether the numbers above describe the whole ${periodWord}`,
    clean ? C.good : C.bad,
    tiles + verdict,
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

function headerBlock(w: ReportWindow, opts: PeriodRenderOptions): string {
  const badge = [
    opts.testSend ? 'TEST SEND' : '',
    w.anchored ? `BACK-DATED TO ${formatReportDate(w.toDate).toUpperCase()}` : '',
  ].filter(Boolean).map(text =>
    `<span style="display:inline-block;margin-left:5px;padding:3px 9px;border-radius:999px;background:rgba(255,255,255,.18);color:#ffffff;font:700 10px/1.5 ${FONT};letter-spacing:.08em;">${esc(text)}</span>`,
  ).join('')

  return `
  <tr><td style="background:${C.brandDeep};background-image:linear-gradient(135deg,${C.brandDeep} 0%,${C.brand} 100%);padding:26px 24px;border-radius:16px 16px 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td>
          <div style="font:700 11px/1.4 ${FONT};color:rgba(255,255,255,.72);text-transform:uppercase;letter-spacing:.14em;">AppleHolidays Operations</div>
          <div style="font:800 24px/1.25 ${FONT};color:#ffffff;padding-top:6px;letter-spacing:-0.02em;">${esc(PERIOD_LABEL[w.period])} Business Review</div>
          <div style="font:400 13px/1.5 ${FONT};color:rgba(255,255,255,.82);padding-top:5px;">${esc(w.label)}</div>
        </td>
        <td align="right" valign="top" style="white-space:nowrap;">${badge}</td>
      </tr>
    </table>
  </td></tr>`
}

/** The scorecard strip — eight numbers, each carrying its own movement. */
function scorecard(d: ReportData, i: PeriodInsights): string {
  const cells: { label: string; value: string; sub: string }[] = [
    { label: 'Confirmed', value: num(i.totals.bookings), sub: i.comparable ? `prev ${num(i.totals.previousBookings)}` : 'no baseline' },
    { label: 'Guests', value: num(i.totals.pax), sub: i.comparable ? `prev ${num(i.totals.previousPax)}` : '—' },
    { label: 'B2B / B2C', value: `${num(i.totals.channel.b2b)}/${num(i.totals.channel.b2c)}`, sub: `prev ${num(i.totals.previousChannel.b2b)}/${num(i.totals.previousChannel.b2c)}` },
    { label: 'Operated', value: num(i.delivery.toursOperated), sub: `${num(i.delivery.guestDays)} guest-days` },
    { label: 'Cancelled', value: num(i.cancellations.total), sub: i.cancellations.ratePct !== null ? `${i.cancellations.ratePct}% of book` : '—' },
    { label: 'Complaints', value: num(i.quality.complaints), sub: i.quality.per100Tours !== null ? `${i.quality.per100Tours}/100 tours` : `${num(d.complaints.open)} open` },
    { label: 'Integrity', value: i.integrity.parityMissing || i.integrity.countCheckShort ? 'SHORT' : 'OK', sub: i.integrity.parityMissing || i.integrity.countCheckShort ? `${num(i.integrity.parityMissing + i.integrity.countCheckShort)} to chase` : 'parity + accounts' },
    { label: 'Forward book', value: num(d.upcoming.total), sub: `${num(d.upcoming.next30)} in 30d` },
  ]

  return `
  <tr><td style="background:#0b3d3a;padding:14px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      ${cells.map(c => `<td width="${Math.floor(100 / cells.length)}%" align="center" style="padding:2px 4px;">
        <div style="font:800 21px/1.2 ${FONT};color:#ffffff;">${esc(c.value)}</div>
        <div style="font:700 10px/1.4 ${FONT};color:rgba(255,255,255,.66);text-transform:uppercase;letter-spacing:.08em;padding-top:3px;">${esc(c.label)}</div>
        <div style="font:400 10px/1.4 ${FONT};color:rgba(255,255,255,.45);padding-top:2px;">${esc(c.sub)}</div>
      </td>`).join('')}
    </tr></table>
  </td></tr>`
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
          how its figures were derived, every table is filterable, and the first sheet is a contents page that explains
          the whole file. Nothing has been summarised away — it has been moved somewhere it can be sorted.
        </div>
        <div style="padding-top:9px;">${sheets}</div>
      </td></tr>
    </table>
  </td></tr>`
}

export function renderPeriodEmail(d: ReportData, opts: PeriodRenderOptions = {}): string {
  const i = d.insights
  const periodWord = d.window.period === 'MONTHLY' ? 'month' : 'week'

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
          <strong style="color:${C.ink};">Counted: the ${num(i.totals.bookings)} booking${i.totals.bookings === 1 ? '' : 's'} ${
            i.basis === 'apple' ? 'AppleSystem confirmed' : 'this system filed'
          } in ${esc(d.window.label.replace(/^Last \w+ — /, ''))}.</strong>
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
    want.commercial ? trendSection(i, periodWord) : '',
    want.commercial ? marketSection(i, periodWord) : '',
    want.commercial ? partnerSection(i, periodWord) : '',
    want.commercial ? commercialSection(i, periodWord) : '',
    want.delivery ? deliverySection(i, periodWord) : '',
    // Attrition rides with intake: a period's cancellations are the other half
    // of what it sold, and reading one without the other overstates the book.
    want.commercial ? attritionSection(i, periodWord) : '',
    want.quality ? qualitySection(d, i, periodWord) : '',
    want.integrity ? integritySection(d, i, periodWord) : '',
    want.forward ? forwardSection(d, periodWord) : '',
  ].join('')

  const footerLink = opts.dashboardUrl
    ? `<a href="${esc(opts.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:${C.brand};color:#ffffff;text-decoration:none;border-radius:8px;font:700 13px/1 ${FONT};">Open the dashboard</a>`
    : ''

  return compact(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(PERIOD_LABEL[d.window.period])} Business Review</title>
<style type="text/css">${STYLE_BLOCK}</style>
</head>
<body style="margin:0;padding:0;background:#eef2f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(d.window.label)} — ${num(i.totals.bookings)} confirmed (prev ${num(i.totals.previousBookings)}), ${num(i.delivery.toursOperated)} tours operated, ${num(i.cancellations.total)} cancelled, ${num(i.quality.complaints)} complaints, ${i.actions.length} action${i.actions.length === 1 ? '' : 's'} to take. Every booking is in the attached workbook.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f6;padding:22px 12px;">
  <tr><td align="center">
    <table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;border-collapse:collapse;">
      ${headerBlock(d.window, opts)}
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
</body></html>`)
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
  const range = d.window.period === 'MONTHLY'
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .format(new Date(`${d.window.fromDate}T00:00:00Z`))
    : `${formatReportDate(d.window.fromDate)}–${formatReportDate(d.window.toDate)}`

  const parts: string[] = []
  if (i) {
    const move = i.comparable && i.totals.previousBookings > 0
      ? ` (${i.totals.bookings >= i.totals.previousBookings ? '+' : ''}${Math.round(((i.totals.bookings - i.totals.previousBookings) / i.totals.previousBookings) * 100)}%)`
      : ''
    parts.push(`${i.totals.bookings} confirmed${move}`)
    if (i.delivery.available) parts.push(`${i.delivery.toursOperated} tours operated`)
    if (i.integrity.parityMissing) parts.push(`${i.integrity.parityMissing} MISSING upstream`)
    if (i.integrity.countCheckShort) parts.push(`count check short ${i.integrity.countCheckShort}`)
    if (i.cancellations.total) parts.push(`${i.cancellations.total} cancelled`)
    if (i.quality.unexplainedBreaches) parts.push(`${i.quality.unexplainedBreaches} D-${RECONFIRM_DUE_DAYS} unexplained`)
    if (d.complaints.open) parts.push(`${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`)
  } else {
    parts.push(`${d.created.total} confirmed`)
  }

  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}${PERIOD_LABEL[d.window.period]} Business Review · ${range} · ${parts.join(', ')}`
}
