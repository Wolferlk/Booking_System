/**
 * Booking activity in three stages — the cut every report (daily, weekly,
 * monthly; mail and workbook) prints from one function so they never disagree.
 *
 *   1. **Created** — a booking whose first invoice was raised in the period and
 *      has not been re-issued since.
 *   2. **Created & updated** — opened in the period *and* re-issued in it.
 *      Measured against the invoice it was first raised on.
 *   3. **Old booking updated** — opened before the period, re-issued in it.
 *      Measured against its last invoice raised before the period, so the
 *      change is exactly what this period did to the books.
 *
 * Each stage is also split by **how the booking was created** in this system —
 * AppleSystem import, OneDrive drop, confirmation mail, entered by hand… — the
 * intake label `collectActivitySplitSection()` already resolved per file.
 *
 * Pure: reads `ReportData.split`, never the database.
 */
import type { ActivitySplitSection, SplitFile } from './report-data'

export type ActivityStage = 'Created' | 'Created & updated' | 'Old booking updated'

export const ACTIVITY_STAGES: ActivityStage[] = ['Created', 'Created & updated', 'Old booking updated']

export const STAGE_NOTE: Record<ActivityStage, string> = {
  'Created': 'First invoice raised in the period, not re-issued since.',
  'Created & updated': 'Opened in the period and re-issued in it — change is against the first invoice.',
  'Old booking updated': 'Opened before the period, re-issued in it — change is against its last invoice before the period.',
}

export function stageOf(f: SplitFile): ActivityStage {
  if (f.pass === 'Amended') return 'Old booking updated'
  return f.type === 'Updated' ? 'Created & updated' : 'Created'
}

/** 'Up' / 'Down' / 'Same' / 'No baseline' — the amount verdict on an updated file. */
export function changeWord(f: SplitFile): 'Up' | 'Down' | 'Same' | 'No baseline' | '' {
  if (stageOf(f) === 'Created') return ''
  if (f.amountChange === null) return 'No baseline'
  if (Math.abs(f.amountChange) < 0.005) return 'Same'
  return f.amountChange > 0 ? 'Up' : 'Down'
}

export interface CurrencyMove {
  currency: string
  /** Sum of the current invoices. */
  amount: number
  /** Sum of the baselines, where one exists. */
  previous: number
  /** Sum of the current invoices of those same files — `compared − previous = change`. */
  compared: number
  /** Net change across files with a comparable baseline. */
  change: number
}

export interface StageSummary {
  stage: ActivityStage
  count: number
  files: SplitFile[]
  /** Intake label → bookings. */
  byIntake: Map<string, number>
  /** Per currency — money is never added across currencies. */
  money: CurrencyMove[]
  /** Updated stages only. */
  up: number
  down: number
  same: number
  noBaseline: number
}

export interface ActivityBreakdown {
  available: boolean
  total: number
  stages: StageSummary[]
  /** Every intake label seen, biggest first, "Not filed here" last. */
  intakes: string[]
  /** Updated files whose amount moved, biggest absolute move first. */
  biggestMoves: SplitFile[]
}

const LAST = new Set(['Not recorded', 'Not filed here'])

export function activityBreakdown(sp: ActivitySplitSection): ActivityBreakdown {
  const stages: StageSummary[] = ACTIVITY_STAGES.map(stage => ({
    stage, count: 0, files: [], byIntake: new Map(), money: [], up: 0, down: 0, same: 0, noBaseline: 0,
  }))
  const byStage = new Map(stages.map(s => [s.stage, s]))
  const intakeTotals = new Map<string, number>()

  for (const f of sp.files) {
    const s = byStage.get(stageOf(f))!
    s.count++
    s.files.push(f)
    s.byIntake.set(f.intake, (s.byIntake.get(f.intake) ?? 0) + 1)
    intakeTotals.set(f.intake, (intakeTotals.get(f.intake) ?? 0) + 1)

    let m = s.money.find(x => x.currency === f.currency)
    if (!m) { m = { currency: f.currency, amount: 0, previous: 0, compared: 0, change: 0 }; s.money.push(m) }
    m.amount += f.amount
    if (f.amountChange !== null && f.previousAmount !== null) {
      m.previous += f.previousAmount
      m.compared += f.amount
      m.change += f.amountChange
    }

    switch (changeWord(f)) {
      case 'Up': s.up++; break
      case 'Down': s.down++; break
      case 'Same': s.same++; break
      case 'No baseline': s.noBaseline++; break
    }
  }

  for (const s of stages) {
    s.money.sort((a, b) => b.amount - a.amount)
    for (const m of s.money) {
      m.amount = Math.round(m.amount * 100) / 100
      m.previous = Math.round(m.previous * 100) / 100
      m.compared = Math.round(m.compared * 100) / 100
      m.change = Math.round(m.change * 100) / 100
    }
  }

  const intakes = Array.from(intakeTotals.entries())
    .sort((a, b) => Number(LAST.has(a[0])) - Number(LAST.has(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)

  const biggestMoves = sp.files
    .filter(f => stageOf(f) !== 'Created' && f.amountChange !== null && Math.abs(f.amountChange) >= 0.005)
    .sort((a, b) => Math.abs(b.amountChange!) - Math.abs(a.amountChange!))

  return { available: sp.available, total: sp.files.length, stages, intakes, biggestMoves }
}
