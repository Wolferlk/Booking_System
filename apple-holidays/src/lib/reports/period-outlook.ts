/**
 * The monthly review's look forward — booking history, a statistical forecast
 * for the next two months, and the slot the AI advice is written into.
 *
 * ## Why the forecast is computed here and not by the model
 *
 * A language model asked "how many bookings next month?" produces a confident
 * number with nothing under it. So the number that anchors the forecast is
 * worked out in code from the business's own history — a weighted recent level,
 * adjusted by last year's seasonality where the ledger reaches that far back —
 * with a range taken from how much the months actually swing. The model is then
 * given that baseline, the history, the forward book and the month's movers,
 * and may move its own estimate within the range only, with a reason. An AI
 * estimate outside the statistical range is discarded, not printed.
 *
 * History is counted exactly the way the report's headline is (see
 * `cohortLinesForRange`): AppleSystem confirmations held here, test bookings
 * out, country-scoped. A month the ledger holds nothing for is "no data", not
 * zero — the ledger began on a date, and a run of zeros before it would drag
 * every average towards nothing.
 */
import { cohortLinesForRange } from './period-insights'
import type { ReportWindow } from './report-window'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryPoint {
  /** yyyy-mm */
  month: string
  label: string
  /** B2B confirmations held, tests out. null = the ledger holds nothing for it. */
  bookings: number | null
}

export interface ForecastMonth {
  month: string
  label: string
  /** The statistical estimate. */
  baseline: number
  low: number
  high: number
  /** The AI's estimate, kept only when it sits inside low–high. */
  aiExpected: number | null
  aiReason: string | null
}

export interface ComplaintFix {
  theme: string
  /** How many of the period's complaints sit under it — counted, not estimated. */
  count: number
  rootCause: string
  fix: string
  owner: string
}

export interface GrowthIdea {
  title: string
  detail: string
  /** The figure from this report the idea rests on. */
  evidence: string
}

export interface PeriodAdvice {
  history: HistoryPoint[]
  forecast: ForecastMonth[]
  /** How the baseline was made, in one sentence the reader can check. */
  method: string
  complaintFixes: ComplaintFix[]
  growth: GrowthIdea[]
  /** The model that wrote the advice, or null when only the statistics ran. */
  model: string | null
  /** Why the AI half is missing, when it is. */
  aiNote: string | null
}

// ─── History ─────────────────────────────────────────────────────────────────

const MONTH_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' })

function monthLabel(month: string): string {
  return MONTH_FMT.format(new Date(`${month}-01T00:00:00Z`))
}

/** `yyyy-mm` shifted by `n` months. */
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthRange(month: string): { fromDate: string; toDate: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, '0')}` }
}

/**
 * The last `months` months up to and including the report's own, oldest first.
 *
 * The report's month is passed in rather than re-counted, so the last bar on
 * the chart is the headline figure to the booking. Fifteen months by default:
 * twelve to see a year, three more so last year's seasonality has a base.
 */
export async function collectBookingHistory(
  w: ReportWindow,
  countries: string[],
  currentBookings: number,
  months = 15,
): Promise<HistoryPoint[]> {
  const current = w.fromDate.slice(0, 7)
  const out: HistoryPoint[] = []
  // Sequential on purpose: each month is a ledger read plus a booking IN-query,
  // and fifteen of them at once is a burst the shared accounts DB does not need.
  for (let k = months - 1; k >= 1; k--) {
    const month = shiftMonth(current, -k)
    let bookings: number | null = null
    try {
      const lines = await cohortLinesForRange(monthRange(month), countries)
      bookings = lines === null || lines.length === 0 ? null : lines.length
    } catch (err) {
      console.warn(`[Reports] history ${month} unavailable:`, err instanceof Error ? err.message : err)
    }
    out.push({ month, label: monthLabel(month), bookings })
  }
  out.push({ month: current, label: monthLabel(current), bookings: currentBookings })
  return out
}

// ─── Baseline ────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * The next `horizon` months, statistically.
 *
 *   level    = the last three months with data, weighted 1 : 2 : 3
 *   season   = last year's same month ÷ the average of the three months before
 *              it, clamped to 0.7–1.4, and only when all four are in the ledger
 *   baseline = level × season
 *   range    = ± 1.28 × the standard deviation of month-on-month % changes
 *              (an 80% band), never narrower than ±8% or wider than ±40%
 */
export function baselineForecast(history: HistoryPoint[], horizon = 2): { forecast: ForecastMonth[]; method: string } {
  const valid = history.filter((h): h is HistoryPoint & { bookings: number } => h.bookings !== null)
  if (valid.length < 3) {
    return { forecast: [], method: 'Not enough history in the ledger to forecast — at least three months are needed.' }
  }

  const recent = valid.slice(-3)
  const level = (recent[0].bookings * 1 + recent[1].bookings * 2 + recent[2].bookings * 3) / 6

  const changes: number[] = []
  for (let i = 1; i < valid.length; i++) {
    if (valid[i - 1].bookings > 0) changes.push((valid[i].bookings - valid[i - 1].bookings) / valid[i - 1].bookings)
  }
  const mean = changes.reduce((s, c) => s + c, 0) / (changes.length || 1)
  const sd = Math.sqrt(changes.reduce((s, c) => s + (c - mean) ** 2, 0) / (changes.length || 1))
  const band = clamp(1.28 * sd, 0.08, 0.4)

  const byMonth = new Map(history.map(h => [h.month, h.bookings]))
  const last = history[history.length - 1].month
  let seasonalUsed = false

  const forecast: ForecastMonth[] = []
  for (let k = 1; k <= horizon; k++) {
    const month = shiftMonth(last, k)
    const lastYear = byMonth.get(shiftMonth(month, -12)) ?? null
    const base = [1, 2, 3].map(n => byMonth.get(shiftMonth(month, -12 - n)) ?? null)
    let season = 1
    if (lastYear !== null && base.every(b => b !== null && b > 0)) {
      const avg = (base as number[]).reduce((s, b) => s + b, 0) / 3
      season = clamp(lastYear / avg, 0.7, 1.4)
      seasonalUsed = true
    }
    const baseline = Math.round(level * season)
    // The band widens with distance: the second month out is less certain.
    const width = band * (1 + (k - 1) * 0.35)
    forecast.push({
      month,
      label: monthLabel(month),
      baseline,
      low: Math.max(0, Math.round(baseline * (1 - width))),
      high: Math.round(baseline * (1 + width)),
      aiExpected: null,
      aiReason: null,
    })
  }

  const method = `Weighted average of the last three months (${recent.map(r => `${r.label} ${r.bookings}`).join(', ')}, weighted 1:2:3)`
    + (seasonalUsed ? ', adjusted by last year\'s seasonal pattern' : ' — the ledger does not reach back a full year yet, so no seasonal adjustment')
    + `. The range is an 80% band from how much months have swung (±${Math.round(band * 100)}% for next month).`

  return { forecast, method }
}

/** Keep the AI's estimate only where it respects the statistical range. */
export function mergeAiForecast(
  forecast: ForecastMonth[],
  ai: { month?: unknown; expected?: unknown; reason?: unknown }[] | undefined,
): ForecastMonth[] {
  return forecast.map(f => {
    const hit = (ai ?? []).find(a => String(a.month ?? '') === f.month)
    const expected = hit ? Math.round(Number(hit.expected)) : NaN
    if (!Number.isFinite(expected) || expected < f.low || expected > f.high) return f
    return { ...f, aiExpected: expected, aiReason: typeof hit?.reason === 'string' ? hit.reason.trim().slice(0, 400) : null }
  })
}
