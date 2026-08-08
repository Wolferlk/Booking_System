/**
 * Timezone-aware reporting windows.
 *
 * Every figure in an auto-report is anchored to a *business day* in an
 * operations timezone (Asia/Colombo by default), never to server-local time —
 * ops runs on Amplify/Vercel where the process clock is UTC, so "yesterday"
 * computed from `new Date()` would silently shift the whole report by a day
 * for the 05:30 window either side of midnight in Colombo.
 *
 * A window is a half-open UTC instant range `[start, end)` plus the local
 * calendar dates it represents, so callers can both query Prisma (instants)
 * and label the email (dates) from one object.
 */

export type ReportPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY'

export const REPORT_PERIODS: ReportPeriod[] = ['DAILY', 'WEEKLY', 'MONTHLY']

export const PERIOD_LABEL: Record<ReportPeriod, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
}

export const DEFAULT_REPORT_TZ = process.env.REPORT_TZ || process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

export interface ReportWindow {
  period: ReportPeriod
  /** Inclusive first local date of the reporting range, `yyyy-mm-dd`. */
  fromDate: string
  /** Inclusive last local date of the reporting range, `yyyy-mm-dd`. */
  toDate: string
  /** UTC instant of local midnight on `fromDate`. */
  start: Date
  /** UTC instant of local midnight on the day *after* `toDate` (exclusive). */
  end: Date
  /** Local "today" the report was generated for, `yyyy-mm-dd`. */
  today: string
  /**
   * True when the range was pinned to a chosen date rather than derived from
   * the real clock — a back-dated view, not what a scheduled send would produce.
   */
  anchored: boolean
  timezone: string
  /** Human label, e.g. "Yesterday — Thu 30 Jul 2026". */
  label: string
}

// ─── Primitives ───────────────────────────────────────────────────────────────

/** Offset (ms) that must be *subtracted* from a naive UTC reading to get the real instant. */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)

  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0')
  // `hour` comes back as 24 at midnight under some ICU versions.
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return asUtc - at.getTime()
}

/** `yyyy-mm-dd` for an instant in a timezone. */
export function dateInTz(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(at)
}

/** `{ hour, minute }` for an instant in a timezone. */
export function clockInTz(at: Date, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  return {
    hour: Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24,
    minute: Number(parts.find(p => p.type === 'minute')?.value ?? '0'),
  }
}

/** UTC instant of local midnight starting `yyyy-mm-dd` in `timeZone`. */
export function zonedDayStart(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  // Two passes: the first offset may be read on the wrong side of a DST edge.
  let instant = naive - tzOffsetMs(new Date(naive), timeZone)
  instant = naive - tzOffsetMs(new Date(instant), timeZone)
  return new Date(instant)
}

/** Shift a `yyyy-mm-dd` by whole days, staying on the calendar (DST-safe). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return shifted.toISOString().slice(0, 10)
}

/** Day of week for a `yyyy-mm-dd`, 0 = Sunday. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Day of month for a `yyyy-mm-dd`. */
export function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10))
}

/** Number of days in the month containing `yyyy-mm-dd`. */
export function daysInMonth(date: string): number {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function formatReportDate(date: string, opts: { weekday?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    ...(opts.weekday ? { weekday: 'short' as const } : {}),
    day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// ─── Window construction ──────────────────────────────────────────────────────

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Is `yyyy-mm-dd` a real calendar date? Guards user-supplied anchors. */
export function isValidDate(date: string): boolean {
  if (!ISO_DATE.test(date)) return false
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d))
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d
}

/** The whole period containing `anchor` — the range itself, without labels. */
function periodAround(period: ReportPeriod, anchor: string): { fromDate: string; toDate: string } {
  if (period === 'DAILY') return { fromDate: anchor, toDate: anchor }

  if (period === 'WEEKLY') {
    const monday = shiftDate(anchor, -((dayOfWeek(anchor) + 6) % 7))
    return { fromDate: monday, toDate: shiftDate(monday, 6) }
  }

  const y = Number(anchor.slice(0, 4))
  const m = Number(anchor.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { fromDate: `${y}-${mm}-01`, toDate: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

/**
 * The range a report covers when generated on `today` (local date).
 *
 * Every period looks *backwards* at completed business — a report sent at 08:00
 * on Monday reports Sunday, last week, or last month. Reporting a partial
 * current period would make consecutive emails disagree with each other.
 *
 *  - DAILY   → yesterday
 *  - WEEKLY  → the previous Mon–Sun week
 *  - MONTHLY → the previous calendar month
 *
 * `anchorDate` re-points that at a chosen past day: the report then covers the
 * day, week or month *containing* that date. It exists for the dashboard's date
 * picker — "show me the 07 Aug report" — and scheduled sends never pass it.
 *
 * An anchored window also moves `today` to the morning after the range ends,
 * because the forward-looking sections ("on ground today", "arriving next three
 * days") are written from the point of view of the reader opening the mail. Left
 * at the real today they would show this week's operations stapled to a report
 * about a month ago, which reads as a bug and is worse than useless.
 */
export function buildReportWindow(
  period: ReportPeriod,
  timezone: string,
  now: Date = new Date(),
  anchorDate?: string | null,
): ReportWindow {
  const realToday = dateInTz(now, timezone)
  const anchored = !!anchorDate && isValidDate(anchorDate)

  // Default anchor: any date inside the previous period. Yesterday sits in it
  // for every period — the day before this month's 1st is last month, the day
  // before this week's Monday is last week.
  const defaultAnchor = period === 'DAILY'
    ? shiftDate(realToday, -1)
    : period === 'WEEKLY'
      ? shiftDate(realToday, -(((dayOfWeek(realToday) + 6) % 7) + 1))
      : shiftDate(`${realToday.slice(0, 7)}-01`, -1)

  const anchor = anchored ? anchorDate! : defaultAnchor
  const { fromDate, toDate } = periodAround(period, anchor)

  // "Yesterday" / "Last week" only make sense relative to the real today; a
  // picked date is labelled as the plain range it is.
  const label = period === 'DAILY'
    ? `${anchored ? '' : 'Yesterday — '}${formatReportDate(fromDate, { weekday: true })}`
    : period === 'WEEKLY'
      ? `${anchored ? 'Week of ' : 'Last week — '}${formatReportDate(fromDate)} to ${formatReportDate(toDate)}`
      : `${anchored ? '' : 'Last month — '}${new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' })
        .format(new Date(Date.UTC(Number(fromDate.slice(0, 4)), Number(fromDate.slice(5, 7)) - 1, 1)))}`

  return {
    period,
    fromDate,
    toDate,
    start: zonedDayStart(fromDate, timezone),
    end: zonedDayStart(shiftDate(toDate, 1), timezone),
    today: anchored ? shiftDate(toDate, 1) : realToday,
    anchored,
    timezone,
    label,
  }
}

/** The same window shifted one full period earlier — the comparison baseline. */
export function previousWindow(w: ReportWindow): { start: Date; end: Date; fromDate: string; toDate: string } {
  if (w.period === 'MONTHLY') {
    const y = Number(w.fromDate.slice(0, 4))
    const m = Number(w.fromDate.slice(5, 7))
    const pm = m === 1 ? 12 : m - 1
    const py = m === 1 ? y - 1 : y
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
    const fromDate = `${py}-${String(pm).padStart(2, '0')}-01`
    const toDate = `${py}-${String(pm).padStart(2, '0')}-${String(last).padStart(2, '0')}`
    return {
      fromDate, toDate,
      start: zonedDayStart(fromDate, w.timezone),
      end: zonedDayStart(shiftDate(toDate, 1), w.timezone),
    }
  }

  const span = w.period === 'DAILY' ? 1 : 7
  const fromDate = shiftDate(w.fromDate, -span)
  const toDate = shiftDate(w.toDate, -span)
  return {
    fromDate, toDate,
    start: zonedDayStart(fromDate, w.timezone),
    end: zonedDayStart(shiftDate(toDate, 1), w.timezone),
  }
}
