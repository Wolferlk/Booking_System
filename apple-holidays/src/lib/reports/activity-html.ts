/**
 * "Booking activity" — the three-stage block every report mail prints:
 * created / created & updated / old booking updated, how each was created
 * (AppleSystem, OneDrive, by hand…), and what the updates did to the invoice
 * amounts. One renderer for the daily, weekly and monthly mails, so the three
 * describe a period the same way. See `activity-breakdown.ts`.
 */
import { C, FONT, esc, num, money, pill, section, tableOpen, td, TABLE_CLOSE, truncate, emptyNote, moreNote } from './email-kit'
import { activityBreakdown, changeWord, stageOf, ACTIVITY_STAGES, STAGE_NOTE, type ActivityStage, type CurrencyMove } from './activity-breakdown'
import type { ReportData } from './report-data'

const STAGE_COLOR: Record<ActivityStage, string> = {
  'Created': C.brand,
  'Created & updated': C.b2b,
  'Old booking updated': C.warn,
}

function signed(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return `${esc(currency)} 0.00`
  return `${n > 0 ? '+' : '−'}${money(Math.abs(n), currency)}`
}

function changeColor(n: number | null): string {
  if (n === null || Math.abs(n) < 0.005) return C.muted
  return n > 0 ? C.good : C.bad
}

function moneyLines(rows: CurrencyMove[], withChange: boolean): string {
  if (!rows.length) return '—'
  return rows.slice(0, 3).map(m => withChange
    ? `${money(m.amount, m.currency)} <span style="color:${changeColor(m.change)};font-weight:700;">(${signed(m.change, m.currency)})</span>`
      + (m.previous ? `<div style="font:400 10.5px/1.4 ${FONT};color:${C.faint};">${money(m.previous, m.currency)} → ${money(m.compared, m.currency)} on the bookings with an earlier invoice</div>` : '')
    : money(m.amount, m.currency)).join('<br>')
}

export function activitySection(d: ReportData, periodWord: string): string {
  const sp = d.split
  if (!sp.available) {
    return section('Booking activity', `Created and updated this ${periodWord}`, C.brand,
      emptyNote(`The accounts invoice ledger could not be read while this report was written${sp.error ? ` (${sp.error})` : ''}, so this ${periodWord}'s created and updated bookings could not be split.`))
  }
  const a = activityBreakdown(sp)
  const [created, both, old] = a.stages

  const tile = (s: typeof created) => {
    const color = STAGE_COLOR[s.stage]
    const sub = s.stage === 'Created'
      ? 'first invoice this ' + periodWord
      : `<span style="color:${C.good};font-weight:700;">▲ ${num(s.up)}</span> &nbsp;<span style="color:${C.bad};font-weight:700;">▼ ${num(s.down)}</span> &nbsp;<span style="color:${C.muted};">= ${num(s.same)}</span>`
    return `<td width="33%" valign="top" style="padding:0 5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="kpi" style="border-top:3px solid ${color};">
        <tr><td style="padding:12px 12px 11px 12px;">
          <div class="kpi-l">${esc(s.stage)}</div>
          <div class="kpi-v" style="color:${color};">${num(s.count)}</div>
          <div class="kpi-n">${sub}</div>
        </td></tr>
      </table>
    </td>`
  }
  const tiles = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -5px 6px -5px;"><tr>${[created, both, old].map(tile).join('')}</tr></table>
    <div style="font:400 11.5px/1.6 ${FONT};color:${C.muted};padding:0 0 14px 0;">
      ${num(a.total)} bookings touched = ${num(created.count)} created + ${num(both.count)} created &amp; updated + ${num(old.count)} old bookings updated.
      ${sp.oldest ? `The oldest booking re-opened was first raised ${num(sp.oldest)} days earlier.` : ''}
      ▲ / ▼ = invoice amount went up / down after the update.
    </div>`

  // How each stage was created — the method matrix.
  const matrix = a.intakes.length
    ? `<div class="h3">How these bookings were created</div>` +
      tableOpen([
        { text: 'Created by' },
        ...ACTIVITY_STAGES.map(s => ({ text: s, align: 'right', width: '92' })),
        { text: 'Total', align: 'right', width: '60' },
      ]) +
      a.intakes.map(label => {
        const counts = a.stages.map(s => s.byIntake.get(label) ?? 0)
        const total = counts.reduce((x, y) => x + y, 0)
        const warn = label === 'Not filed here'
        return `<tr>
          ${td(esc(label), { bold: true, color: warn ? C.bad : C.ink })}
          ${counts.map(n => td(n ? num(n) : '—', { align: 'right', color: n ? C.ink : C.faint })).join('')}
          ${td(num(total), { align: 'right', bold: true, color: warn ? C.bad : C.ink })}
        </tr>`
      }).join('') +
      `<tr>${td('Total', { bold: true })}${a.stages.map(s => td(num(s.count), { align: 'right', bold: true })).join('')}${td(num(a.total), { align: 'right', bold: true })}</tr>` +
      TABLE_CLOSE +
      `<div style="font:400 11px/1.6 ${FONT};color:${C.muted};padding:6px 0 16px 0;">
         Apple System = imported from AppleSystem · OneDrive = picked up from the Drive folder · Confirmation mail = read from the mailbox ·
         Entered by hand = typed in manually · Not filed here = invoiced by accounts but no booking in OPS.
       </div>`
    : ''

  // Invoice value per stage, with the net change the updates made.
  const value = `<div class="h3">Invoice value</div>` +
    tableOpen([{ text: 'Stage' }, { text: 'Current invoices (net change from updates)', align: 'right' }]) +
    a.stages.map(s => `<tr>
      ${td(`${pill(s.stage, '#ffffff', STAGE_COLOR[s.stage])}<div style="font:400 11px/1.5 ${FONT};color:${C.muted};padding-top:3px;">${esc(STAGE_NOTE[s.stage])}</div>`)}
      ${td(moneyLines(s.money, s.stage !== 'Created'), { align: 'right', nowrap: true })}
    </tr>`).join('') + TABLE_CLOSE

  // The updates that moved the money most.
  const shown = a.biggestMoves.slice(0, 12)
  const moves = shown.length
    ? `<div style="padding-top:18px;"><div class="h3">Biggest invoice changes from updates</div>` +
      tableOpen([
        { text: 'Booking' }, { text: 'Stage', width: '90' }, { text: 'Agent' },
        { text: 'Before', align: 'right' }, { text: 'After', align: 'right' }, { text: 'Change', align: 'right' },
      ]) +
      shown.map(f => `<tr>
        ${td(`<strong style="color:${C.ink};">${esc(f.booking?.bookingRef ?? f.ref)}</strong><div style="font:400 10.5px/1.4 ${FONT};color:${C.faint};">${esc(f.previousInvoice ?? '')} → ${esc(f.invoiceNumber)}</div>`, { nowrap: true })}
        ${td(stageOf(f) === 'Old booking updated' ? `Old${f.ageDays !== null ? ` · ${num(f.ageDays)}d` : ''}` : 'This ' + periodWord, { color: C.muted, nowrap: true })}
        ${td(truncate(f.booking?.agent ?? f.agent, 22))}
        ${td(money(f.previousAmount ?? 0, f.previousCurrency ?? f.currency), { align: 'right', nowrap: true })}
        ${td(money(f.amount, f.currency), { align: 'right', nowrap: true })}
        ${td(`${changeWord(f) === 'Up' ? '▲' : '▼'} ${signed(f.amountChange!, f.currency)}`, { align: 'right', nowrap: true, bold: true, color: changeColor(f.amountChange) })}
      </tr>`).join('') + TABLE_CLOSE + moreNote(shown.length, a.biggestMoves.length, 'changed invoices') + '</div>'
    : ''

  return section(
    `Booking activity — ${num(a.total)} bookings`,
    `Created this ${periodWord}, created & updated this ${periodWord}, and older bookings updated this ${periodWord} · B2B, from the accounts invoice ledger`,
    C.brand,
    tiles + matrix + value + moves,
  )
}
