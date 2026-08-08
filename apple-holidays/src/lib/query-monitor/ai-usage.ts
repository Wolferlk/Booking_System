/**
 * OpenAI spend, bucketed for the Query Monitor's usage screen.
 *
 * Every GPT call in the system already writes a row into `ai_usage_logs` with
 * its token counts and the dollar figure they cost (see `logAiUsage`). This
 * turns those rows into the four grains the team asks about — hourly, daily,
 * weekly, monthly — as both token counts and USD.
 *
 * Two things worth knowing:
 *
 *   1. Buckets are cut on the *sheet's* wall clock (`SHEET_TZ`), not UTC, so a
 *      call at 02:00 in Colombo counts against that morning and not the previous
 *      day — the same rule the workbook's date columns follow.
 *
 *   2. Grouping happens in this process rather than in SQL. The table is narrow,
 *      indexed on `createdAt`, and a year of it is a small read; doing the date
 *      maths here keeps the query portable across the MySQL dev database and the
 *      MariaDB live one, which disagree about timezone functions.
 */
import { prisma } from '@/lib/prisma'
import { SHEET_TZ, wallClockInTz, startOfDayInTz } from './dates'

/** Every call type the Query Monitor itself books its spend under. */
export const QM_CALL_TYPE_PREFIX = 'query_monitor'

export type UsageScope = 'qm' | 'all'
export type UsageGrain = 'hourly' | 'daily' | 'weekly' | 'monthly'

export interface UsageBucket {
  /** Stable identity of the bucket, e.g. `2026-08-08 14` or `2026-08`. */
  key:              string
  /** Short axis label — `14:00`, `08 Aug`, `Aug 2026`. */
  label:            string
  /** The full spelling, used in the workbook's Period column and in tooltips. */
  periodLabel:      string
  calls:            number
  promptTokens:     number
  completionTokens: number
  totalTokens:      number
  costUsd:          number
}

export interface UsageTotals {
  calls:            number
  promptTokens:     number
  completionTokens: number
  totalTokens:      number
  costUsd:          number
}

export interface UsageByType {
  callType:    string
  label:       string
  model:       string
  calls:       number
  totalTokens: number
  costUsd:     number
}

export interface AiUsageStats {
  scope:       UsageScope
  timezone:    string
  generatedAt: string
  /** How many buckets each series carries — the window the charts cover. */
  windows: { hourly: number; daily: number; weekly: number; monthly: number }
  totals: {
    hour:    UsageTotals
    today:   UsageTotals
    week:    UsageTotals
    month:   UsageTotals
    allTime: UsageTotals
  }
  series:     Record<UsageGrain, UsageBucket[]>
  /** Spend split by what asked for it, over the last 30 days. */
  byCallType: UsageByType[]
}

const HOURS_BACK  = 24
const DAYS_BACK   = 30
const WEEKS_BACK  = 12
const MONTHS_BACK = 12

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY  = 86_400_000

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CALL_LABELS: Record<string, string> = {
  query_monitor_extraction: 'Query extraction',
  query_monitor_summary:    'Query summary',
  booking_extraction:       'Booking extraction',
  pnl_extraction:           'PNL extraction',
  is_pnl_extraction:        'IS PNL extraction',
  pnl_classify:             'PNL classify',
  agenda_generation:        'Agenda generation',
  ticket_details:           'Ticket details',
  ai_suggestion:            'AI suggestion',
  customer_origin:          'Customer origin',
  destination_image:        'Destination image',
  extract_flights_image:    'Flights from image',
  extract_flights_text:     'Flights from text',
}

export function callTypeLabel(callType: string): string {
  return CALL_LABELS[callType]
    ?? callType.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

const pad = (n: number) => String(n).padStart(2, '0')

function emptyTotals(): UsageTotals {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
}

// ── Bucket keys, all cut on the sheet's wall clock ───────────────────────────

interface Wall { year: number; month: number; day: number; hour: number }

function wall(date: Date): Wall {
  const w = wallClockInTz(date)
  return { year: w.year, month: w.month, day: w.day, hour: w.hour }
}

const hourKey  = (w: Wall) => `${w.year}-${pad(w.month)}-${pad(w.day)} ${pad(w.hour)}`
const dayKey   = (w: Wall) => `${w.year}-${pad(w.month)}-${pad(w.day)}`
const monthKey = (w: Wall) => `${w.year}-${pad(w.month)}`

/** Monday of the wall-clock week, as a `YYYY-MM-DD` key. */
function weekKey(w: Wall): string {
  const utc  = Date.UTC(w.year, w.month - 1, w.day)
  const dow  = new Date(utc).getUTCDay()          // 0 = Sunday
  const back = (dow + 6) % 7                      // days since Monday
  const mon  = new Date(utc - back * MS_PER_DAY)
  return `${mon.getUTCFullYear()}-${pad(mon.getUTCMonth() + 1)}-${pad(mon.getUTCDate())}`
}

/** `2026-08-08` → `08 Aug`. */
function shortDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  return `${pad(d)} ${MONTH_NAMES[m - 1]}${y === new Date().getUTCFullYear() ? '' : ` ${y}`}`
}

function longDate(isoDay: string): string {
  const [y, m, d] = isoDay.split('-').map(Number)
  return `${pad(d)} ${MONTH_NAMES[m - 1]} ${y}`
}

// ── Scaffolds — every bucket in the window, including the silent ones ────────

/**
 * A chart with holes in it reads as missing data rather than as an idle hour, so
 * each grain is laid out end to end first and the logs are dropped into it.
 */
function buildScaffold(grain: UsageGrain, now: Date): UsageBucket[] {
  const blank = (key: string, label: string, periodLabel: string): UsageBucket => ({
    key, label, periodLabel, calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0,
  })

  if (grain === 'hourly') {
    return Array.from({ length: HOURS_BACK }, (_, i) => {
      const w = wall(new Date(now.getTime() - (HOURS_BACK - 1 - i) * MS_PER_HOUR))
      return blank(
        hourKey(w),
        `${pad(w.hour)}:00`,
        `${longDate(dayKey(w))} ${pad(w.hour)}:00`,
      )
    })
  }

  if (grain === 'daily') {
    return Array.from({ length: DAYS_BACK }, (_, i) => {
      const key = dayKey(wall(new Date(now.getTime() - (DAYS_BACK - 1 - i) * MS_PER_DAY)))
      return blank(key, shortDate(key), longDate(key))
    })
  }

  if (grain === 'weekly') {
    const thisMonday = weekKey(wall(now))
    const anchor = Date.parse(`${thisMonday}T00:00:00Z`)
    return Array.from({ length: WEEKS_BACK }, (_, i) => {
      const start = new Date(anchor - (WEEKS_BACK - 1 - i) * 7 * MS_PER_DAY)
      const key   = `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`
      const end   = new Date(start.getTime() + 6 * MS_PER_DAY)
      const endKey = `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`
      return blank(key, `w/c ${shortDate(key)}`, `${longDate(key)} – ${longDate(endKey)}`)
    })
  }

  const w = wall(now)
  return Array.from({ length: MONTHS_BACK }, (_, i) => {
    const offset = MONTHS_BACK - 1 - i
    const date   = new Date(Date.UTC(w.year, w.month - 1 - offset, 1))
    const key    = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
    const name   = `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`
    return blank(key, name, name)
  })
}

/** The instant the oldest bucket of any grain begins — how far back to read. */
function windowStart(now: Date): Date {
  const w     = wall(now)
  const first = new Date(Date.UTC(w.year, w.month - 1 - (MONTHS_BACK - 1), 1))
  const iso   = `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-01`
  return startOfDayInTz(iso) ?? new Date(now.getTime() - 400 * MS_PER_DAY)
}

// ── Public API ───────────────────────────────────────────────────────────────

function scopeFilter(scope: UsageScope) {
  return scope === 'qm' ? { callType: { startsWith: QM_CALL_TYPE_PREFIX } } : {}
}

export async function getAiUsageStats(scope: UsageScope = 'qm'): Promise<AiUsageStats> {
  const now   = new Date()
  const where = scopeFilter(scope)
  const since = windowStart(now)

  const [logs, allTime, byType] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where:  { ...where, createdAt: { gte: since } },
      select: {
        createdAt: true, promptTokens: true, completionTokens: true,
        totalTokens: true, estimatedCostUsd: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.aiUsageLog.aggregate({
      where,
      _sum:   { promptTokens: true, completionTokens: true, totalTokens: true, estimatedCostUsd: true },
      _count: { id: true },
    }),
    prisma.aiUsageLog.groupBy({
      by:      ['callType', 'model'],
      where:   { ...where, createdAt: { gte: new Date(now.getTime() - DAYS_BACK * MS_PER_DAY) } },
      _sum:    { totalTokens: true, estimatedCostUsd: true },
      _count:  { id: true },
      orderBy: { _sum: { estimatedCostUsd: 'desc' } },
    }),
  ])

  const series: Record<UsageGrain, UsageBucket[]> = {
    hourly:  buildScaffold('hourly',  now),
    daily:   buildScaffold('daily',   now),
    weekly:  buildScaffold('weekly',  now),
    monthly: buildScaffold('monthly', now),
  }

  const index: Record<UsageGrain, Map<string, UsageBucket>> = {
    hourly:  new Map(series.hourly.map(b => [b.key, b])),
    daily:   new Map(series.daily.map(b => [b.key, b])),
    weekly:  new Map(series.weekly.map(b => [b.key, b])),
    monthly: new Map(series.monthly.map(b => [b.key, b])),
  }

  for (const log of logs) {
    const w    = wall(log.createdAt)
    const keys: [UsageGrain, string][] = [
      ['hourly',  hourKey(w)],
      ['daily',   dayKey(w)],
      ['weekly',  weekKey(w)],
      ['monthly', monthKey(w)],
    ]
    for (const [grain, key] of keys) {
      const bucket = index[grain].get(key)
      if (!bucket) continue
      bucket.calls            += 1
      bucket.promptTokens     += log.promptTokens
      bucket.completionTokens += log.completionTokens
      bucket.totalTokens      += log.totalTokens
      bucket.costUsd          += log.estimatedCostUsd
    }
  }

  // The headline tiles are the *current* bucket of each grain — the hour we are
  // in, today, this week, this month — not a rolling 24h/7d/30d window.
  const nowWall = wall(now)
  const pick = (grain: UsageGrain, key: string): UsageTotals => {
    const b = index[grain].get(key)
    return b
      ? { calls: b.calls, promptTokens: b.promptTokens, completionTokens: b.completionTokens, totalTokens: b.totalTokens, costUsd: b.costUsd }
      : emptyTotals()
  }

  return {
    scope,
    timezone:    SHEET_TZ,
    generatedAt: now.toISOString(),
    windows: { hourly: HOURS_BACK, daily: DAYS_BACK, weekly: WEEKS_BACK, monthly: MONTHS_BACK },
    totals: {
      hour:  pick('hourly',  hourKey(nowWall)),
      today: pick('daily',   dayKey(nowWall)),
      week:  pick('weekly',  weekKey(nowWall)),
      month: pick('monthly', monthKey(nowWall)),
      allTime: {
        calls:            allTime._count.id,
        promptTokens:     allTime._sum.promptTokens     ?? 0,
        completionTokens: allTime._sum.completionTokens ?? 0,
        totalTokens:      allTime._sum.totalTokens      ?? 0,
        costUsd:          allTime._sum.estimatedCostUsd ?? 0,
      },
    },
    series,
    byCallType: byType.map(r => ({
      callType:    r.callType,
      label:       callTypeLabel(r.callType),
      model:       r.model,
      calls:       r._count.id,
      totalTokens: r._sum.totalTokens      ?? 0,
      costUsd:     r._sum.estimatedCostUsd ?? 0,
    })),
  }
}
