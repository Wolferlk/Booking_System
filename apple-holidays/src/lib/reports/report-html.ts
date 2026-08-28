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
import {
  bar, C, compact, csvBlock, emptyNote, esc, FONT, kpiRow, money, moreNote, num,
  pill, section, shortDate, stamp, statusWord, STYLE_BLOCK, TABLE_CLOSE, tableOpen,
  td, trend, truncate,
} from './email-kit'
import type {
  BookingLine, ComplaintLine, CountryRow, ReadinessLine, ReconfirmLine, ReportData, TourLine,
} from './report-data'
import type { ReadinessCheck } from '@/lib/booking-readiness'
import { RECONFIRM_DUE_DAYS } from '@/lib/reconfirm-delay-shared'

const SEVERITY_PILL: Record<string, string> = {
  high: pill('HIGH', '#ffffff', C.bad),
  medium: pill('MEDIUM', '#ffffff', C.warn),
  low: pill('LOW', '#ffffff', C.faint),
}

/**
 * The Hotel Only mark, for a booking row.
 *
 * Small and inline rather than a column of its own: it appears on a minority of
 * rows, and a mostly-empty column would cost width the checklist tables cannot
 * spare. Where it does appear it is the explanation for a row of dashes — those
 * checks are waived, not forgotten.
 */
function hotelOnlyPill(): string {
  return '<span class="pill" style="background:#fef3c7;color:#92400e;">HOTEL ONLY</span>'
}

/** Classed, not inline: this one renders on every booking row in three tables. */
function sourcePill(source: string): string {
  return source === 'B2C'
    ? '<span class="pill sc">B2C</span>'
    : '<span class="pill sb">B2B</span>'
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

/**
 * AppleSystem parity — the integrity gate.
 *
 * Deliberately the shortest section in the mail and deliberately the loudest
 * when it fails. On a healthy day it is two matching numbers and a green line
 * saying so, which is the entire point: someone scanning the report at 6 AM
 * should be able to satisfy themselves in one glance that nothing was dropped
 * between the two systems overnight. On an unhealthy day it names the
 * confirmations that are missing, because a count nobody can act on is not a
 * finding.
 */
function paritySection(d: ReportData): string {
  const p = d.parity

  if (!p.available) {
    return section(
      'AppleSystem parity',
      'Confirmed upstream vs held here',
      C.faint,
      emptyNote(p.note ?? 'No reconciliation data is available for this period.'),
    )
  }

  const accent = p.inParity ? C.good : C.bad
  const verdict = p.inParity
    ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
         <div style="font:800 14px/1.4 ${FONT};color:#065f46;">In parity — every confirmation is in the system</div>
         <div style="font:400 12px/1.6 ${FONT};color:#047857;padding-top:4px;">
           AppleSystem confirmed ${num(p.upstreamConfirmed)} booking${p.upstreamConfirmed === 1 ? '' : 's'} in this period and the booking system holds all ${num(p.systemHeld)}.
         </div>
       </div>`
    : `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;margin-bottom:14px;">
         <div style="font:800 14px/1.4 ${FONT};color:#991b1b;">${num(p.missing)} confirmation${p.missing === 1 ? '' : 's'} missing from the booking system</div>
         <div style="font:400 12px/1.6 ${FONT};color:#b91c1c;padding-top:4px;">
           AppleSystem confirmed ${num(p.upstreamConfirmed)}; this system holds ${num(p.systemHeld)}. The reconciler retries every 15 minutes — if the same reference is still listed tomorrow, the quotation needs looking at by hand.
         </div>
       </div>`

  const kpis = kpiRow([
    { label: 'AppleSystem confirmed', value: num(p.upstreamConfirmed), note: 'status 2, by create date' },
    { label: 'Created in system', value: num(p.systemHeld), note: p.inParity ? 'complete' : `${num(p.missing)} short`, color: accent },
    { label: 'Imported by automation', value: num(p.createdByAutomation), note: 'of the above' },
    { label: 'Refreshed', value: num(p.refreshed), note: 'amended upstream' },
    { label: 'Auto-cancelled', value: num(p.cancelled), note: 'withdrawn upstream', color: p.cancelled ? C.warn : C.ink },
  ])

  const gapList = p.gaps.length
    ? `<div style="padding-top:14px;"><div class="h3">Not in the booking system</div>` +
      tableOpen([{ text: 'Reference' }, { text: 'Confirmed on', align: 'right', width: '120' }]) +
      p.gaps.slice(0, 25).map(g => `<tr>
        ${td(`<strong style="color:${C.bad};">${esc(g.ref)}</strong>`, { nowrap: true })}
        ${td(shortDate(g.date), { align: 'right', nowrap: true })}
      </tr>`).join('') + TABLE_CLOSE +
      moreNote(Math.min(25, p.gaps.length), p.gaps.length, 'gaps') + '</div>'
    : ''

  const cancelList = p.cancellations.length
    ? `<div style="padding-top:18px;"><div class="h3">Cancelled — no longer confirmed in AppleSystem</div>` +
      tableOpen([
        { text: 'Ref' }, { text: 'Was', width: '150' },
        { text: 'Upstream status', align: 'right', width: '110' }, { text: 'At', align: 'right', width: '110' },
      ]) +
      p.cancellations.map(c => `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(c.ref)}</strong>`, { nowrap: true })}
        ${td(statusWord(c.prevStatus))}
        ${td(esc(c.upstreamStatus), { align: 'right' })}
        ${td(stamp(c.at), { align: 'right', nowrap: true })}
      </tr>`).join('') + TABLE_CLOSE +
      `<div class="more">Nothing was deleted — each booking keeps the status it held, so a cancellation made in error is one field away from being undone.</div></div>`
    : ''

  const flagged = p.flagged
    ? `<div style="padding-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;margin-top:14px;">
         <div style="font:700 12px/1.5 ${FONT};color:#92400e;">${num(p.flagged)} withdrawn upstream but left for a person</div>
         <div style="font:400 12px/1.6 ${FONT};color:#b45309;padding-top:3px;">
           These tours have already started, so they were not cancelled automatically. They need a decision.
         </div>
       </div>`
    : ''

  const errors = p.errors
    ? `<div class="more" style="color:${C.warn};">${num(p.errors)} import or refresh error${p.errors === 1 ? '' : 's'} were retried during the period.</div>`
    : ''

  const byDate = p.byDate.length > 1
    ? `<div style="padding-top:18px;"><div class="h3">Day by day</div>` +
      tableOpen([
        { text: 'Date' }, { text: 'AppleSystem', align: 'right', width: '95' },
        { text: 'In system', align: 'right', width: '85' }, { text: 'Missing', align: 'right', width: '75' },
      ]) +
      p.byDate.map(b => `<tr>
        ${td(shortDate(b.date), { nowrap: true })}
        ${td(num(b.upstreamConfirmed), { align: 'right' })}
        ${td(num(b.systemHeld), { align: 'right', bold: true, color: C.ink })}
        ${td(b.missing ? num(b.missing) : '—', { align: 'right', bold: b.missing > 0, color: b.missing ? C.bad : C.faint })}
      </tr>`).join('') + TABLE_CLOSE + '</div>'
    : ''

  const provenance = [
    p.source === 'ledger' ? (p.note ?? 'Figures taken from the last reconciliation, not a live check.') : '',
    p.lastRunAt ? `Last reconciled ${stamp(p.lastRunAt)} · ${num(p.runs)} run${p.runs === 1 ? '' : 's'} covered this period.` : '',
  ].filter(Boolean).join(' ')

  return section(
    'AppleSystem parity',
    'Confirmed upstream vs held here — these two numbers must match',
    accent,
    verdict + kpis + gapList + cancelList + flagged + errors + byDate +
      (provenance ? `<div class="more">${esc(provenance)}</div>` : ''),
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
          ${td(`<strong style="color:${C.ink};">${esc(t.bookingRef)}</strong>${t.hotelOnly ? ` ${hotelOnlyPill()}` : ''}`, { nowrap: true })}
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

/**
 * The blocking checks on one booking, spelled out — "Client not confirmed",
 * "3 of 5 transfers still need a driver". QC never appears: it is an internal
 * sign-off that does not stop the guest landing, so it is reported separately
 * rather than mixed into tomorrow's chase list.
 */
function outstandingReasons(b: ReadinessLine): string {
  const parts: { label: string; check: ReadinessCheck }[] = [
    { label: 'Client', check: b.readiness.client },
    { label: 'Drivers', check: b.readiness.driver },
    { label: 'Tickets', check: b.readiness.tickets },
  ].filter(p => p.check.state === 'PENDING' || p.check.state === 'PARTIAL')

  if (!parts.length) return `<span style="color:${C.good};">Nothing blocking</span>`

  // The recorded D-10 reason, appended once under the checks rather than beside
  // the client line it explains — it accounts for the file as a whole, and the
  // desk reading this list needs it before it decides who to ring.
  const why = b.delay
    ? `<div style="padding:3px 0 0 0;">
         <strong style="color:${C.warn};">Reason:</strong>
         <span style="color:${C.body};">${esc(b.delay.reasonLabel)}${b.delay.note ? ` — ${truncate(b.delay.note, 110)}` : ''}</span>
         <span style="color:${C.faint};font-size:11px;">${esc(
           b.delay.stale ? ` (recorded ${b.delay.ageDays}d ago — not refreshed)` : ` (${b.delay.recordedBy ?? 'recorded'})`,
         )}</span>
       </div>`
    : ''

  return parts.map(p => {
    const colour = p.check.state === 'PARTIAL' ? C.warn : C.bad
    return `<div style="padding:1px 0;">
      <strong style="color:${colour};">${esc(p.label)}:</strong>
      <span style="color:${C.body};">${esc(p.check.detail)}</span>
    </div>`
  }).join('') + why
}

/**
 * Splits an arrival list into a B2B block and a B2C block, each under its own
 * channel pill and count.
 *
 * The two are worked by different desks — trade bookings by the agent-facing
 * team, direct guests by the B2C desk — and a single mixed table buries the
 * handful of B2C tours among dozens of B2B refs. Order within each block is
 * whatever the caller sorted by; only the grouping happens here. A channel with
 * no arrivals emits nothing rather than an empty table.
 */
function byChannel<T extends { source: string }>(
  lines: T[],
  render: (rows: T[], source: 'B2B' | 'B2C') => string,
): string {
  return (['B2B', 'B2C'] as const).map(source => {
    const rows = lines.filter(l => l.source === source)
    if (!rows.length) return ''
    return `<div style="padding-top:14px;">
      <div style="padding-bottom:6px;">${sourcePill(source)}
        <span style="font:700 12px/1.4 ${FONT};color:${C.muted};">${num(rows.length)} tour${rows.length === 1 ? '' : 's'}</span>
      </div>
      ${render(rows, source)}
    </div>`
  }).join('')
}

/**
 * Tomorrow's not-ready arrivals, one row each with the reason. The banner above
 * says how many; this says which, and what to do about them — the desk has one
 * day left on these, so they get the detail the three-day table cannot afford.
 */
function tomorrowGapTable(lines: ReadinessLine[]): string {
  if (!lines.length) return ''
  const table = (rows: ReadinessLine[]) =>
    tableOpen([
      { text: 'Ref' }, { text: 'Country' },
      { text: 'Pax', align: 'right', width: '40' },
      { text: 'Outstanding' }, { text: 'QC', align: 'center', width: '80' },
    ]) + rows.map(b => `<tr>
      ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>${b.hotelOnly ? ` ${hotelOnlyPill()}` : ''}${b.leadPassenger ? `<div style="color:${C.faint};font-size:11px;">${truncate(b.leadPassenger, 22)}</div>` : ''}`, { nowrap: true })}
      ${td(esc(b.countryLabel), { nowrap: true })}
      ${td(num(b.pax), { align: 'right' })}
      ${td(outstandingReasons(b))}
      ${td(checkCell(b.readiness.qc), { align: 'center', nowrap: true })}
    </tr>`).join('') + TABLE_CLOSE

  return `<div style="padding-top:18px;">
    <div class="h3">Tomorrow — what is missing, tour by tour</div>
    ${byChannel(lines, table)}
    <div class="more">QC is shown for information only — a tour waiting on QC alone is counted as ready.</div>
  </div>`
}

function readinessSection(d: ReportData): string {
  const r = d.readiness

  const kpis = kpiRow([
    { label: 'Arriving in 3 days', value: num(r.total), note: `${num(r.pax)} guests`, color: C.brand },
    { label: 'Tomorrow', value: num(r.tomorrow), note: r.tomorrowNotReady ? `${num(r.tomorrowNotReady)} not ready` : 'all ready', color: r.tomorrowNotReady ? C.bad : C.good },
    // Hotel Only arrivals are inside `ready` — nothing is outstanding on them —
    // so the note says how many, or a room-only morning reads as a prepared one.
    { label: 'Fully ready', value: num(r.ready), note: r.hotelOnly ? `${num(r.hotelOnly)} hotel only` : undefined, color: C.good },
    { label: 'Needs action', value: num(r.notReady), color: r.notReady ? C.bad : C.ink },
  ])

  const banner = r.tomorrowNotReady
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#991b1b;">
         ${num(r.tomorrowNotReady)} tour${r.tomorrowNotReady === 1 ? '' : 's'} arriving tomorrow ${r.tomorrowNotReady === 1 ? 'is' : 'are'} not fully ready — clear ${r.tomorrowNotReady === 1 ? 'it' : 'them'} first.
         <div style="font-weight:400;padding-top:3px;">Missing client confirmation, drivers or tickets. QC is not counted.</div>
       </div>`
    : ''

  // What is outstanding, counted per check — tells the desk which queue to work.
  const gaps: { label: string; count: number; blocking: boolean }[] = [
    { label: 'Client confirmation', count: r.pendingClient, blocking: true },
    { label: 'Driver allocation', count: r.pendingDriver, blocking: true },
    { label: 'Tickets', count: r.pendingTickets, blocking: true },
    // Informational: QC does not hold up an arrival, so it is never counted as
    // "not ready" — it is listed here only so the desk can see the backlog.
    { label: 'QC (not blocking)', count: r.pendingQc, blocking: false },
  ]
  const gapTable = r.total
    ? `<div class="h3">Outstanding by check</div>` +
      tableOpen([{ text: 'Check' }, { text: 'Bookings pending', align: 'right', width: '120' }, { text: '', width: '130' }]) +
      gaps.map(g => {
        const colour = !g.blocking ? C.muted : g.count ? C.bad : C.good
        return `<tr>
        ${td(esc(g.label), { bold: true, color: g.blocking ? C.ink : C.muted })}
        ${td(num(g.count), { align: 'right', bold: g.blocking && g.count > 0, color: colour })}
        ${td(bar(g.count, r.total, g.count ? colour : C.line))}
      </tr>`
      }).join('') + TABLE_CLOSE
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

  // Each channel is capped separately upstream, so each carries its own
  // "showing X of Y" note against that channel's arrival count.
  const checklistTable = (rows: ReadinessLine[], source: 'B2B' | 'B2C') =>
    tableOpen([
      { text: 'Ref' }, { text: 'Arrives' }, { text: 'Country' },
      { text: 'Pax', align: 'right', width: '40' },
      { text: 'Client', align: 'center' }, { text: 'Driver', align: 'center' },
      { text: 'Tickets', align: 'center' }, { text: 'QC', align: 'center' },
    ]) + rows.map((b: ReadinessLine) => {
      const arrives = b.daysToArrival === 1 ? 'Tomorrow' : formatReportDate(b.arrivalDate, { weekday: true })
      const guest = b.leadPassenger ?? b.destination
      return `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>${b.hotelOnly ? ` ${hotelOnlyPill()}` : ''}${guest ? `<div style="color:${C.faint};font-size:11px;">${truncate(guest, 22)}</div>` : ''}`, { nowrap: true })}
        ${td(esc(arrives), { nowrap: true, color: b.daysToArrival === 1 ? C.bad : C.body, bold: b.daysToArrival === 1 })}
        ${td(esc(b.countryLabel), { nowrap: true })}
        ${td(num(b.pax), { align: 'right' })}
        ${td(checkCell(b.readiness.client), { align: 'center', nowrap: true })}
        ${td(checkCell(b.readiness.driver), { align: 'center', nowrap: true })}
        ${td(checkCell(b.readiness.tickets), { align: 'center', nowrap: true })}
        ${td(checkCell(b.readiness.qc), { align: 'center', nowrap: true })}
      </tr>`
    }).join('') + TABLE_CLOSE +
    moreNote(rows.length, source === 'B2C' ? r.channel.b2c : r.channel.b2b, `${source} arrivals`)

  const list = r.bookings.length
    ? byChannel(r.bookings, checklistTable)
    : emptyNote('No tours arrive in the next three days.')

  const legend = r.bookings.length
    ? `<div class="more">Driver and ticket cells read “done / total”. Red is nothing done, amber is part-done, green is complete; “—” or “None” means the check does not apply — no transfers, or no tickets on the booking. A row marked <strong>HOTEL ONLY</strong> is accommodation only: every check is waived by design, and the hotel is reconfirmed on the Pre-checking queue instead.</div>`
    : ''

  return section(
    'Arriving next 3 days — readiness',
    `${formatReportDate(r.fromDate, { weekday: true })} to ${formatReportDate(r.toDate, { weekday: true })} · client confirmation, drivers, tickets and QC · ${num(r.channel.b2b)} B2B and ${num(r.channel.b2c)} B2C, listed separately`,
    C.warn,
    banner + kpis + tomorrowGapTable(r.tomorrowOutstanding) + gapTable + dayTable +
      `<div style="padding-top:18px;"><div class="h3">Booking-by-booking checklist</div>${list}${legend}</div>` +
      (r.byCountry.length ? `<div style="padding-top:18px;"><div class="h3">Country-wise</div>${countryTable(r.byCountry)}</div>` : ''),
  )
}

/**
 * The D-10 reconfirmation section — who is late, and why.
 *
 * The one number this section is built around is `unexplained`: bookings past
 * their deadline that nobody has written a word about. Everything else on the
 * page is context for it, which is why it leads the banner and sorts to the top
 * of the table rather than being averaged into a single "late" count.
 *
 * Recorded reasons are printed verbatim and attributed. An explanation that has
 * gone unrefreshed is marked, because a reason from nine days ago is a stale
 * fact being used as a live excuse, and the mail is the only place that
 * distinction reliably gets noticed.
 */
function reconfirmSection(d: ReportData): string {
  const r = d.reconfirm

  const kpis = kpiRow([
    { label: `Past D-${RECONFIRM_DUE_DAYS}`, value: num(r.breached), note: `of ${num(r.total)} travelling within ${RECONFIRM_DUE_DAYS} days`, color: r.breached ? C.warn : C.good },
    { label: 'No reason given', value: num(r.unexplained), color: r.unexplained ? C.bad : C.good },
    { label: 'Reason on file', value: num(r.explained), note: r.stale ? `${num(r.stale)} not refreshed` : undefined, color: r.explained ? C.warn : C.ink },
    { label: 'Reconfirmed on time', value: num(Math.max(0, r.total - r.breached)), color: C.good },
  ])

  if (!r.breached) {
    return section(
      `Guest reconfirmation — D-${RECONFIRM_DUE_DAYS}`,
      `Arrivals ${formatReportDate(r.fromDate)} to ${formatReportDate(r.toDate)} · every tour reconfirmed with the guest ten days before travel`,
      C.good,
      kpis + emptyNote(`Every tour travelling in the next ${RECONFIRM_DUE_DAYS} days has been reconfirmed on time.`),
    )
  }

  const banner = r.unexplained
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#991b1b;">
         ${num(r.unexplained)} booking${r.unexplained === 1 ? '' : 's'} missed D-${RECONFIRM_DUE_DAYS} with no reason recorded.
         <div style="font-weight:400;padding-top:3px;">Open the booking and record why on the Guest reconfirmation panel — it appears here and on the ops board from the next run.</div>
       </div>`
    : `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#92400e;">
         Every one of the ${num(r.breached)} late booking${r.breached === 1 ? '' : 's'} has a recorded reason.
         <div style="font-weight:400;padding-top:3px;">They are still late — accounted for is not the same as reconfirmed.</div>
       </div>`

  // Where the delays are coming from. Sorted by volume, with the desk that owns
  // each reason named, so the section routes work rather than only reporting it.
  const reasonTable = r.byReason.length
    ? `<div class="h3">Why they are late</div>` +
      tableOpen([
        { text: 'Reason' }, { text: 'Owner' },
        { text: 'Bookings', align: 'right', width: '80' }, { text: '', width: '120' },
      ]) +
      r.byReason.map(row => `<tr>
        ${td(esc(row.label), { bold: true, color: C.ink })}
        ${td(esc(row.owner), { color: C.muted })}
        ${td(num(row.count), { align: 'right', bold: true, color: C.warn })}
        ${td(bar(row.count, r.breached, C.warn))}
      </tr>`).join('') +
      (r.unexplained
        ? `<tr>
             ${td('<strong>No reason recorded</strong>', { color: C.bad })}
             ${td('—', { color: C.faint })}
             ${td(num(r.unexplained), { align: 'right', bold: true, color: C.bad })}
             ${td(bar(r.unexplained, r.breached, C.bad))}
           </tr>`
        : '') +
      TABLE_CLOSE
    : ''

  const rowsTable = (rows: ReconfirmLine[], source: 'B2B' | 'B2C') =>
    tableOpen([
      { text: 'Ref' }, { text: 'Arrives' },
      { text: `D-${RECONFIRM_DUE_DAYS}`, align: 'center', width: '90' },
      { text: 'Country' }, { text: 'Pax', align: 'right', width: '40' },
      { text: 'Reason not reconfirmed' },
    ]) + rows.map(b => {
      const guest = b.leadPassenger ?? b.destination
      const late = `<span class="pill ${b.delay ? 'wn' : 'bd'}">${esc(`${b.daysLate}d late`)}</span>`
      // The reason cell is the whole point of the row, so it carries the desk's
      // own sentence, who wrote it, and — when it has gone stale — that it is
      // being quoted back from a week ago.
      const why = b.delay
        ? `<div><strong style="color:${C.ink};">${esc(b.delay.reasonLabel)}</strong>
             ${b.delay.stale ? `<span class="pill bd" style="margin-left:6px;">${esc(`${b.delay.ageDays}d old`)}</span>` : ''}</div>
           ${b.delay.note ? `<div style="color:${C.body};padding-top:2px;">${truncate(b.delay.note, 150)}</div>` : ''}
           <div style="color:${C.faint};font-size:11px;padding-top:2px;">recorded ${esc(formatReportDate(b.delay.recordedAt.slice(0, 10)))}${b.delay.recordedBy ? ` by ${esc(b.delay.recordedBy)}` : ''}</div>`
        : `<strong style="color:${C.bad};">No reason recorded</strong>
           <div style="color:${C.faint};font-size:11px;padding-top:2px;">${esc(
             [b.clientConfirmed ? 'client confirmed' : 'client not confirmed',
              b.preTourCalled ? 'pre-tour call logged' : 'no pre-tour call'].join(' · '),
           )}</div>`
      return `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(b.bookingRef)}</strong>${guest ? `<div style="color:${C.faint};font-size:11px;">${truncate(guest, 22)}</div>` : ''}`, { nowrap: true })}
        ${td(esc(formatReportDate(b.arrivalDate, { weekday: true })), { nowrap: true })}
        ${td(late, { align: 'center', nowrap: true })}
        ${td(esc(b.countryLabel), { nowrap: true })}
        ${td(num(b.pax), { align: 'right' })}
        ${td(why)}
      </tr>`
    }).join('') + TABLE_CLOSE +
    moreNote(rows.length, source === 'B2C' ? r.channel.b2c : r.channel.b2b, `${source} late bookings`)

  return section(
    `Guest reconfirmation — D-${RECONFIRM_DUE_DAYS}`,
    `Arrivals ${formatReportDate(r.fromDate)} to ${formatReportDate(r.toDate)} · ${num(r.breached)} past the deadline, ${num(r.unexplained)} of them unexplained`,
    r.unexplained ? C.bad : C.warn,
    banner + kpis + reasonTable +
      `<div style="padding-top:18px;"><div class="h3">Booking by booking</div>${byChannel(r.bookings, rowsTable)}
        <div class="more">A booking counts as reconfirmed once the client confirms <em>or</em> the pre-tour call is logged — either signal is enough. Hotel Only files are excluded: there is no tour to reconfirm with the guest.</div>
      </div>` +
      (r.byCountry.length ? `<div style="padding-top:18px;"><div class="h3">Country-wise</div>${countryTable(r.byCountry)}</div>` : ''),
  )
}

/**
 * One card per *issue*, not per alert row.
 *
 * The TE agent writes a row every time a complaint comes up on a call, so the
 * same problem used to print two or three times in a row and the section read
 * like a stutter. `complaint-dedupe` merges them upstream; what is left to do
 * here is show that the merge happened — a repeated complaint is a worse
 * complaint, and hiding the repetition would trade one distortion for another.
 */
function complaintCard(c: ComplaintLine): string {
  const resolved = c.status === 'resolved'
  const repeated = c.occurrences > 1
  const edge = resolved ? C.good : c.severity === 'high' ? C.bad : C.warn
  const meta = [
    c.bookingRef ? `Ref ${esc(c.bookingRef)}` : null,
    c.customerName ? esc(c.customerName) : null,
    esc(c.countryLabel),
    esc(c.categories.length > 1 ? c.categories.join(' / ') : c.category),
    new Date(c.createdAt).toISOString().slice(11, 16) + ' UTC',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ')

  // The recurrence trail, in place of the repeated cards this used to print.
  const recurrence = repeated
    ? `<div class="cmp-rep">
         <strong>Raised ${num(c.occurrences)} times</strong> on separate calls — first ${esc(stamp(c.createdAt))}, last ${esc(stamp(c.lastRaisedAt))}.
         ${resolved ? '' : ' The guest has brought this up again after it was logged.'}
       </div>`
    : ''

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
        <td align="right" style="white-space:nowrap;">${repeated ? pill(`${c.occurrences}\u00d7`, '#ffffff', '#ea580c') + ' ' : ''}${SEVERITY_PILL[c.severity] ?? SEVERITY_PILL.medium} ${resolved ? pill('RESOLVED', '#ffffff', C.good) : pill('OPEN', '#ffffff', C.bad)}</td>
      </tr></table>
      <div class="cmp-m">${meta}</div>
      ${c.details ? `<div class="cmp-d">${truncate(c.details, 420)}</div>` : ''}
      ${c.customerQuote ? `<div class="cmp-q">“${truncate(c.customerQuote, 220)}”</div>` : ''}
      ${recurrence}
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

  // "Raised" counts distinct issues. The agent logs one row per call, so
  // counting rows would inflate the number every time a guest repeats himself
  // — one angry guest on four calls is one complaint, not four.
  const kpis = kpiRow([
    { label: 'Issues raised', value: num(x.total) },
    { label: 'Resolved', value: num(x.resolved), color: C.good },
    { label: 'Unresolved', value: num(x.open), color: x.open ? C.bad : C.ink },
    { label: 'Avg. fix time', value: x.avgResolutionHours !== null ? `${x.avgResolutionHours}h` : '—' },
  ])

  const alerts: string[] = []
  if (x.highSeverityOpen) {
    alerts.push(`${num(x.highSeverityOpen)} high-severity complaint${x.highSeverityOpen === 1 ? '' : 's'} still open — escalate today.`)
  }
  if (x.recurringOpen) {
    alerts.push(`${num(x.recurringOpen)} unresolved issue${x.recurringOpen === 1 ? ' has' : 's have'} now been raised on more than one call — the guest is repeating themselves because nothing changed.`)
  }

  const banner = alerts.length
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:11px 14px;margin-bottom:14px;font:700 13px/1.5 ${FONT};color:#991b1b;">
         ${alerts.map(a => `<div style="padding:2px 0;">${a}</div>`).join('')}
       </div>`
    : ''

  // Reconciles the KPI against the raw row count, so nobody reading both the
  // mail and the alerts table thinks the report lost something.
  const mergeNote = x.duplicatesMerged
    ? `<div class="more">${num(x.rawTotal)} alert${x.rawTotal === 1 ? ' was' : 's were'} logged across calls; ${num(x.duplicatesMerged)} of them repeated an issue already listed and ${x.duplicatesMerged === 1 ? 'has been folded into it' : 'have been folded into theirs'}. Nothing is dropped — each card shows how many times its issue came up.</div>`
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
    ? `<div style="padding-top:18px;"><div class="h3">Every issue, in full — most urgent first</div>${x.items.map(complaintCard).join('')}${moreNote(x.items.length, x.total, 'issues')}${mergeNote}</div>`
    : emptyNote('No complaints were raised in this period. 🎉')

  const carried = x.carriedOpen.length
    ? `<div style="padding-top:14px;"><div class="h3">Carried over — opened earlier, still unresolved (${num(x.carriedOpen.length)})</div>${x.carriedOpen.map(complaintCard).join('')}</div>`
    : ''

  return section(
    'Complaints',
    `${d.window.label} · one card per issue, repeats merged`,
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
  sections?: { created?: boolean; parity?: boolean; onGround?: boolean; readiness?: boolean; reconfirm?: boolean; complaints?: boolean; upcoming?: boolean }
  /** Optional AI-written paragraph placed above the sections. */
  narrative?: string | null
  /** Absolute dashboard URL for the footer link. */
  dashboardUrl?: string | null
  scheduleName?: string
  /** Marks the mail as a manual/test send. */
  testSend?: boolean
}

function headerBlock(w: ReportWindow, opts: RenderOptions): string {
  // A back-dated view says so on its face: the counts are for the chosen period,
  // but the forward-looking sections read from today's booking records, so it is
  // not the mail that went out that morning and must not be mistaken for it.
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
    // The parity pair earns a place in the strip because it is the one figure
    // that says whether every other figure in the mail is complete.
    { label: 'AS parity', value: `${num(d.parity.systemHeld)}/${num(d.parity.upstreamConfirmed)}`, sub: d.parity.available ? (d.parity.inParity ? 'all imported' : `${num(d.parity.missing)} missing`) : 'not checked' },
    { label: 'On ground', value: num(d.onGround.total), sub: `${num(d.onGround.pax)} guests` },
    { label: 'Next 3 days', value: num(d.readiness.total), sub: `${num(d.readiness.notReady)} not ready` },
    { label: `D-${RECONFIRM_DUE_DAYS} late`, value: num(d.reconfirm.breached), sub: `${num(d.reconfirm.unexplained)} unexplained` },
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

export function renderReportEmail(d: ReportData, opts: RenderOptions = {}): string {
  const want = {
    created: opts.sections?.created !== false,
    parity: opts.sections?.parity !== false,
    onGround: opts.sections?.onGround !== false,
    readiness: opts.sections?.readiness !== false,
    reconfirm: opts.sections?.reconfirm !== false,
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
    // Immediately after intake, because it qualifies it: the created count above
    // is only trustworthy if the two systems agree on what was confirmed.
    want.parity ? paritySection(d) : '',
    want.onGround ? onGroundSection(d) : '',
    want.readiness ? readinessSection(d) : '',
    // Placed after readiness and before complaints: readiness is the next three
    // days, this is the next ten, and both are things to fix before the guest
    // lands — complaints are what happens when neither was.
    want.reconfirm ? reconfirmSection(d) : '',
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(d.window.label)} — ${num(d.created.total)} new bookings, ${num(d.onGround.total)} tours on ground, ${num(d.readiness.notReady)} arrivals not ready, ${num(d.reconfirm.unexplained)} unexplained D-${RECONFIRM_DUE_DAYS} breaches, ${num(d.complaints.open)} open complaints, AppleSystem parity ${num(d.parity.systemHeld)}/${num(d.parity.upstreamConfirmed)}.</div>
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
  // A parity gap outranks everything else in the subject: it means the mail's
  // own numbers are incomplete, so it has to be visible without opening it.
  if (d.parity.available && !d.parity.inParity) parts.push(`${d.parity.missing} AS booking${d.parity.missing === 1 ? '' : 's'} MISSING`)
  if (d.readiness.notReady > 0) parts.push(`${d.readiness.notReady} not ready in 3d`)
  // Only the unexplained breaches earn a place in the subject. A late booking
  // somebody has accounted for is inside-the-mail detail; a late booking nobody
  // has spoken for is the reason to open the mail at all.
  if (d.reconfirm.unexplained > 0) parts.push(`${d.reconfirm.unexplained} D-${RECONFIRM_DUE_DAYS} unexplained`)
  if (d.complaints.open > 0) parts.push(`${d.complaints.open} open complaint${d.complaints.open === 1 ? '' : 's'}`)
  const range = d.window.period === 'DAILY'
    ? formatReportDate(d.window.fromDate)
    : `${formatReportDate(d.window.fromDate)}–${formatReportDate(d.window.toDate)}`
  const prefix = opts.prefix?.trim() ? `${opts.prefix.trim()} ` : ''
  return `${opts.testSend ? '[TEST] ' : ''}${prefix}${PERIOD_LABEL[d.window.period]} Ops Report · ${range} · ${parts.join(', ')}`
}

// ─── CSV attachment ───────────────────────────────────────────────────────────

/**
 * Flat CSV of the report's booking-level rows, attached so finance/ops can pivot
 * without asking anyone to export it. One file, three labelled blocks.
 */
export function renderReportCsv(d: ReportData): string {
  const rows: string[] = []
  const block = (title: string, header: string[], lines: string[][]) =>
    csvBlock(rows, title, header, lines)

  block('Bookings created', ['Ref', 'Source', 'Country', 'Agent', 'Status', 'Arrival', 'Departure', 'Adults', 'Children', 'Infants', 'Currency', 'Quoted total', 'Created at'],
    d.created.bookings.map(b => [b.bookingRef, b.source, b.countryLabel, b.agent ?? '', b.status, b.arrivalDate, b.departureDate, b.paxAdults, b.paxChildren, b.paxInfants, b.currency, b.quotedTotal ?? '', b.createdAt].map(String)))

  // Parity is a two-row-per-day answer, but it goes in the CSV because "prove to
  // me nothing was lost last month" is a question someone eventually pivots.
  if (d.parity.available) {
    block('AppleSystem parity by create date', ['Create date', 'Confirmed in AppleSystem', 'Created in system', 'Missing'],
      d.parity.byDate.map(b => [b.date, b.upstreamConfirmed, b.systemHeld, b.missing].map(String)))

    if (d.parity.gaps.length) {
      block('AppleSystem confirmations missing from the booking system', ['Reference', 'Confirmed on'],
        d.parity.gaps.map(g => [g.ref, g.date]))
    }

    if (d.parity.cancellations.length) {
      block('Cancelled — withdrawn in AppleSystem', ['Ref', 'Previous status', 'Upstream status', 'Cancelled at'],
        d.parity.cancellations.map(c => [c.ref, c.prevStatus, c.upstreamStatus, c.at]))
    }
  }

  block(`On ground ${d.onGround.date}`, ['Ref', 'Booking type', 'Source', 'Country', 'Lead guest', 'Day', 'Total days', 'Pax', 'Status'],
    d.onGround.tours.map(t => [t.bookingRef, t.hotelOnly ? 'Hotel Only' : 'Full tour', t.source, t.countryLabel, t.leadPassenger ?? '', t.dayNo, t.totalDays, t.pax, t.status].map(String)))

  block(`Arriving ${d.readiness.fromDate} to ${d.readiness.toDate} — readiness`,
    ['Ref', 'Booking type', 'Source', 'Country', 'Lead guest', 'Arrival', 'Days to arrival', 'Pax', 'Status', 'Client confirmed', 'Driver allocation', 'Driver detail', 'Tickets', 'Ticket detail', 'QC stage', 'Ready', 'Blocking', 'Outstanding'],
    d.readiness.bookings.map(b => [
      b.bookingRef, b.hotelOnly ? 'Hotel Only' : 'Full tour', b.source, b.countryLabel, b.leadPassenger ?? '', b.arrivalDate, b.daysToArrival, b.pax, b.status,
      b.readiness.client.state === 'DONE' ? 'Yes' : 'No',
      b.readiness.driver.short, b.readiness.driver.detail,
      b.readiness.tickets.short, b.readiness.tickets.detail,
      b.readiness.qc.short,
      b.readiness.ready ? 'Yes' : 'No',
      b.readiness.blocking.join('; '),
      b.readiness.outstanding.join('; '),
    ].map(String)))

  // The mail caps the readiness list for size; tomorrow's chase list never is,
  // so it gets its own uncapped block with the reason spelled out per booking.
  if (d.readiness.tomorrowOutstanding.length) {
    block(`Arriving ${d.readiness.fromDate} — not ready`,
      ['Ref', 'Source', 'Country', 'Lead guest', 'Pax', 'Status', 'Blocking', 'Client', 'Drivers', 'Tickets', 'QC (not blocking)'],
      d.readiness.tomorrowOutstanding.map(b => [
        b.bookingRef, b.source, b.countryLabel, b.leadPassenger ?? '', b.pax, b.status,
        b.readiness.blocking.join('; '),
        b.readiness.client.detail, b.readiness.driver.detail, b.readiness.tickets.detail, b.readiness.qc.detail,
      ].map(String)))
  }

  // Every breached booking, with the desk's own words. Uncapped in the CSV even
  // though the mail caps its table: this is the block someone pivots by reason
  // at the end of the month, and a truncated one would answer wrongly.
  if (d.reconfirm.breached) {
    block(`Guest reconfirmation — past D-${RECONFIRM_DUE_DAYS} (arrivals ${d.reconfirm.fromDate} to ${d.reconfirm.toDate})`,
      ['Ref', 'Source', 'Country', 'Lead guest', 'Arrival', 'D-10 due', 'Days late', 'Pax', 'Status',
        'Client confirmed', 'Pre-tour call', 'Reason', 'Detail', 'Recorded by', 'Recorded on', 'Reason age (days)', 'Stale'],
      d.reconfirm.bookings.map(b => [
        b.bookingRef, b.source, b.countryLabel, b.leadPassenger ?? '', b.arrivalDate, b.dueAt, b.daysLate, b.pax, b.status,
        b.clientConfirmed ? 'Yes' : 'No',
        b.preTourCalled ? 'Yes' : 'No',
        b.delay?.reasonLabel ?? 'NO REASON RECORDED',
        b.delay?.note ?? '',
        b.delay?.recordedBy ?? '',
        b.delay?.recordedAt.slice(0, 10) ?? '',
        b.delay?.ageDays ?? '',
        b.delay?.stale ? 'Yes' : '',
      ].map(String)))
  }

  // One row per issue, matching the mail. `Times raised` and `Raised on` keep
  // the underlying alert rows recoverable from the export.
  block('Complaints',
    ['First raised at', 'Last raised at', 'Times raised', 'Raised on', 'Ref', 'Customer', 'Country', 'Category', 'Severity', 'Status', 'Title', 'Details', 'Resolution', 'Resolved at', 'Hours to resolve'],
    [...d.complaints.items, ...d.complaints.carriedOpen].map(c => [
      c.createdAt, c.lastRaisedAt, c.occurrences, c.trail.map(t => t.createdAt).join(' | '),
      c.bookingRef ?? '', c.customerName ?? '', c.countryLabel, c.categories.join(' | '),
      c.severity, c.status, c.title ?? '', c.details ?? '', c.resolutionNote ?? '',
      c.resolvedAt ?? '', c.resolutionHours ?? '',
    ].map(String)))

  block('Upcoming arrivals', ['Ref', 'Source', 'Country', 'Arrival', 'Departure', 'Pax', 'Status'],
    d.upcoming.imminent.map(b => [b.bookingRef, b.source, b.countryLabel, b.arrivalDate, b.departureDate, b.pax, b.status].map(String)))

  return rows.join('\r\n')
}
