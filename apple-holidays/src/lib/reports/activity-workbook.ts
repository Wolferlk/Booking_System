/**
 * The "Booking Activity" tabs — shared by the daily and the weekly / monthly
 * workbooks so every Excel file counts a period the same way:
 *
 *   • **Booking Activity** — the three-stage summary (created / created &
 *     updated / old booking updated), how each stage was created (AppleSystem,
 *     OneDrive, mail, by hand…) and the invoice money each stage moved.
 *   • **Created**, **Created & Updated**, **Old Updated** — one row per booking,
 *     with the invoice before and after the update and the difference.
 *
 * The daily workbook keeps its own "New Bookings" tab (every file on one tab),
 * so it takes the summary only; the periodic workbook takes all four.
 */
import { P, type Col, type SheetPlan } from '@/lib/excel-kit'
import { detectCountryFromRef } from '@/lib/country-detection'
import type { ReportData, SplitFile } from './report-data'
import { labelFor as reportCountryLabel } from './booking-lines'
import { activityBreakdown, changeWord, stageOf, ACTIVITY_STAGES, STAGE_NOTE, type ActivityStage } from './activity-breakdown'

const STAGE_TAB: Record<ActivityStage, { name: string; tab: string }> = {
  'Created': { name: 'Created', tab: P.brand },
  'Created & updated': { name: 'Created & Updated', tab: P.blue },
  'Old booking updated': { name: 'Old Updated', tab: P.amber },
}

/** Columns for one booking of any stage. `stage` adds the Stage column (mixed tabs). */
export function activityFileCols(opts: { stage?: boolean; updated?: boolean } = {}): Col<SplitFile>[] {
  const cols: Col<SplitFile>[] = []
  if (opts.stage) cols.push({ header: 'Stage', width: 18, value: f => stageOf(f) })
  cols.push(
    { header: 'Booking ref', width: 13, value: f => f.booking?.bookingRef ?? f.ref },
    { header: 'Created by', width: 17, value: f => f.intake },
    { header: 'Country', width: 12, value: f => f.booking?.countryLabel ?? reportCountryLabel(detectCountryFromRef(f.ref) ?? 'UNASSIGNED') },
    { header: 'Agent', width: 26, value: f => f.booking?.agent ?? f.agent },
    { header: 'Guest', width: 22, value: f => f.guest },
    { header: 'Status', width: 15, value: f => f.booking?.status.replace(/_/g, ' ') ?? '' },
    { header: 'Arrival', width: 12, kind: 'date', value: f => f.booking?.arrivalDate ?? null },
    { header: 'Pax', width: 6, kind: 'int', value: f => f.booking?.pax ?? null, total: 'sum' },
    { header: 'Currency', width: 9, value: f => f.currency },
  )
  if (opts.updated !== false) {
    cols.push(
      { header: 'Previous invoice', width: 16, value: f => f.previousInvoice ?? '' },
      { header: 'Previous amount', width: 14, kind: 'money', value: f => f.previousAmount },
    )
  }
  cols.push(
    { header: 'Invoice no.', width: 16, value: f => f.invoiceNumber },
    { header: 'Invoice amount', width: 14, kind: 'money', value: f => f.amount },
  )
  if (opts.updated !== false) {
    cols.push(
      {
        header: 'Change', width: 13, kind: 'money', value: f => f.amountChange,
        tone: f => (f.amountChange === null || Math.abs(f.amountChange) < 0.005 ? null : f.amountChange > 0 ? 'good' : 'bad'),
      },
      {
        header: 'Up / Down', width: 11, value: f => changeWord(f),
        tone: f => (changeWord(f) === 'Up' ? 'good' : changeWord(f) === 'Down' ? 'bad' : changeWord(f) === 'No baseline' ? 'warn' : null),
      },
      { header: 'Updates in period', width: 10, kind: 'int', value: f => f.issuesInWindow, total: 'sum' },
    )
  }
  cols.push(
    { header: 'First raised', width: 12, kind: 'date', value: f => f.firstOn },
    { header: 'Age (days)', width: 9, kind: 'int', value: f => f.ageDays },
    { header: 'Revisions', width: 9, kind: 'int', value: f => f.revisions },
    { header: 'Last raised at', width: 17, kind: 'stamp', value: f => f.raisedAt },
  )
  return cols
}

/**
 * Adds the activity tabs to a plan. `perStage` adds the three per-stage tabs
 * (the periodic workbook); without it only the summary is added.
 */
export function addActivitySheets(plan: SheetPlan, d: ReportData, opts: { periodWord: string; perStage: boolean }): void {
  const sp = d.split
  if (!sp.available) return
  const a = activityBreakdown(sp)
  const pw = opts.periodWord

  plan.canvas({
    name: 'Booking Activity', tab: P.deep, width: 10,
    what: `Created / created & updated / old bookings updated this ${pw} — by creation method, with invoice changes`,
    draw: c => {
      c.title(`Booking activity — ${d.window.label}`,
        `Every B2B booking the accounts invoice ledger touched this ${pw}, split three ways. ${a.total} bookings in all. One row per booking, on its latest invoice. Test bookings and B2C are excluded.`)
      c.tiles(a.stages.map((s, i) => ({
        label: s.stage,
        value: s.count,
        note: s.stage === 'Created' ? `first invoice this ${pw}` : `▲ ${s.up} up · ▼ ${s.down} down · ${s.same} same`,
        color: [P.brand, P.blue, P.amber][i],
      })))

      c.title('How these bookings were created',
        'Apple System = imported from AppleSystem · OneDrive = picked up from the Drive folder · Confirmation mail = read from the mailbox · Entered by hand = typed in manually · Not filed here = invoiced by accounts, no booking in OPS.')
      c.header(['Created by', ...ACTIVITY_STAGES, 'Total'], [undefined, P.brand, P.blue, P.amber, P.deep])
      const first = c.r
      for (const label of a.intakes) {
        const counts = a.stages.map(s => s.byIntake.get(label) ?? 0)
        c.line([label, ...counts, counts.reduce((x, y) => x + y, 0)],
          label === 'Not filed here' ? { labelColor: P.badInk } : {})
      }
      c.bars(5, first, c.r - 1, P.deep)
      c.line(['Total', ...a.stages.map(s => s.count), a.total], { bold: true, bg: P.brandWash })
      c.gap()

      c.title('Invoice value by stage',
        'Per currency — never added across currencies. "Before" is the invoice each updated booking replaced: for a booking created and updated in the period, its first invoice; for an old booking, its last invoice before the period. Change = now − before, over the bookings that have an earlier invoice ("Now (same bookings)"); a booking whose earlier invoice cannot be read is counted under "No earlier invoice".')
      c.header(['Stage', 'Currency', 'Bookings', 'Invoices now', 'Before', 'Now (same bookings)', 'Change', 'Went up', 'Went down', 'No earlier invoice'],
        [undefined, P.muted, P.deep, P.brand, P.muted, P.muted, P.indigo, P.green, P.red, P.amber])
      for (const s of a.stages) {
        if (!s.money.length) {
          c.line([s.stage, '—', 0, null, null, null, null, null, null, null])
          continue
        }
        for (const m of s.money) {
          const inCur = s.files.filter(f => f.currency === m.currency)
          const updated = s.stage !== 'Created'
          c.line([
            s.stage, m.currency, inCur.length, m.amount,
            updated ? m.previous : null, updated ? m.compared : null, updated ? m.change : null,
            updated ? inCur.filter(f => changeWord(f) === 'Up').length : null,
            updated ? inCur.filter(f => changeWord(f) === 'Down').length : null,
            updated ? inCur.filter(f => changeWord(f) === 'No baseline').length : null,
          ], { kinds: [undefined, undefined, 'int', 'money', 'money', 'money', 'money', 'int', 'int', 'int'], deltaCols: [7] })
        }
      }
      c.gap()
      for (const s of ACTIVITY_STAGES) c.note(`${s}: ${STAGE_NOTE[s]}`)
    },
  })

  if (!opts.perStage) return

  for (const s of a.stages) {
    const updated = s.stage !== 'Created'
    const money = s.money.map(m => `${m.currency} ${m.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}${updated ? ` (${m.change >= 0 ? '+' : ''}${m.change.toLocaleString('en-US', { maximumFractionDigits: 2 })})` : ''}`).join(' · ')
    const rows = updated
      ? [...s.files].sort((x, y) => Math.abs(y.amountChange ?? 0) - Math.abs(x.amountChange ?? 0))
      : [...s.files].sort((x, y) => x.ref.localeCompare(y.ref))
    plan.table<SplitFile>({
      name: STAGE_TAB[s.stage].name, tab: STAGE_TAB[s.stage].tab,
      title: `${s.stage} — ${d.window.label}`,
      description: `${STAGE_NOTE[s.stage]} One row per booking, on its latest invoice in the ${pw}. "Created by" is how the booking reached OPS.${updated ? ' Sorted by the biggest invoice change first.' : ''}`,
      totals: `${s.count} bookings${updated ? ` · ${s.up} up · ${s.down} down · ${s.same} same${s.noBaseline ? ` · ${s.noBaseline} no baseline` : ''}` : ''}${money ? ` · ${money}` : ''}`,
      what: `${s.stage} this ${pw}, one row per booking${updated ? ', invoice before / after and the change' : ''}`,
      cols: activityFileCols({ updated }),
      rows,
      empty: `No bookings ${s.stage.toLowerCase()} this ${pw}.`,
    })
  }
}
