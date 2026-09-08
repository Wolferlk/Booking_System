/**
 * The date window behind the bookings list's period pills and Created/Arrival
 * range — the one place that decides which day a booking belongs to.
 *
 * ## Why this is not just `new Date(value)`
 *
 * The list used to build every boundary in UTC, so "created on 7 Sept" meant
 * `07T00:00Z → 07T23:59:59.999Z`. Every reporting path in the system
 * (`report-window.ts`) anchors the same day to the *operations* timezone,
 * Asia/Colombo, which is `06T18:30Z → 07T18:30Z`. The two windows are the same
 * length and five and a half hours apart, so a booking filed between midnight
 * and 05:30 Colombo — exactly when the overnight auto-import runs — landed in
 * the report's day and outside the list's. That is how the daily report could
 * say 72 bookings created yesterday while the list, filtered on the same date,
 * showed 53.
 *
 * So `createdAt` — a real instant, stamped by the database at the moment of
 * filing — is now bounded on Colombo business days, and the list agrees with
 * the report by construction.
 *
 * ## Why `arrivalDate` is still UTC
 *
 * `arrivalDate` and `departureDate` are *calendar* dates that happen to be
 * stored in a DateTime column, written as midnight UTC. Shifting their
 * boundaries into Colombo would push each stored midnight into the previous
 * local day and move every arrival one day earlier. They keep the UTC calendar
 * boundaries they have always had.
 */
import { DEFAULT_REPORT_TZ, dateInTz, shiftDate, zonedDayStart } from '@/lib/reports/report-window'

/** The date columns the list is allowed to filter on. */
export type BookingDateField = 'createdAt' | 'arrivalDate'

export type BookingDateFilter = 'today' | 'this_week' | 'this_month'

export const OPS_TZ = DEFAULT_REPORT_TZ

/** True for columns holding an instant rather than a calendar date. */
function isInstantColumn(field: BookingDateField): boolean {
  return field === 'createdAt'
}

/**
 * UTC instant that starts the calendar day `yyyy-mm-dd` for a date-only column
 * (`arrivalDate`, `departureDate`) — those are written as midnight UTC.
 */
export function calendarDayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** UTC instant that starts the operations-timezone day `yyyy-mm-dd`. */
export function createdDayStart(date: string): Date {
  return zonedDayStart(date, OPS_TZ)
}

/** The operations-timezone day an instant falls on, `yyyy-mm-dd`. */
export function opsDayOf(at: Date): string {
  return dateInTz(at, OPS_TZ)
}

/** Today's `yyyy-mm-dd` in the operations timezone — never the server's. */
export function opsToday(now: Date = new Date()): string {
  return dateInTz(now, OPS_TZ)
}

/** UTC instant that starts the local day `yyyy-mm-dd` for this column. */
function dayStart(date: string, field: BookingDateField): Date {
  return isInstantColumn(field) ? createdDayStart(date) : calendarDayStart(date)
}

/**
 * Which calendar day "today" is — always read in the operations timezone, for
 * every column. The *boundaries* differ per column (an instant vs a stored
 * midnight), but the day being asked for is the same one the office is having:
 * at 02:00 in Colombo the server's UTC clock still says yesterday, and the
 * Today pill would have shown the wrong day's arrivals for that whole window.
 */
function todayFor(_field: BookingDateField, now: Date): string {
  return opsToday(now)
}

/**
 * Half-open `[gte, lt)` for an explicit `dateFrom`/`dateTo` range. The end date
 * is inclusive to the user, so the boundary is the start of the following day —
 * which also catches the last millisecond that a `23:59:59.999` ceiling drops.
 */
export function explicitDateRange(
  field: BookingDateField,
  dateFrom?: string | null,
  dateTo?: string | null,
): Record<string, Date> | null {
  const range: Record<string, Date> = {}
  if (dateFrom) range.gte = dayStart(dateFrom, field)
  if (dateTo)   range.lt  = dayStart(shiftDate(dateTo, 1), field)
  return Object.keys(range).length ? range : null
}

/** Half-open `[gte, lt)` for one of the Today / This Week / This Month pills. */
export function periodDateRange(
  field: BookingDateField,
  filter: BookingDateFilter,
  now: Date = new Date(),
): Record<string, Date> {
  const today = todayFor(field, now)

  if (filter === 'today') {
    return { gte: dayStart(today, field), lt: dayStart(shiftDate(today, 1), field) }
  }

  if (filter === 'this_week') {
    // Weeks start on Sunday, as they did before — read off the calendar date so
    // the arithmetic never crosses a timezone boundary.
    const [y, m, d] = today.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    const from = shiftDate(today, -weekday)
    return { gte: dayStart(from, field), lt: dayStart(shiftDate(from, 7), field) }
  }

  // this_month
  const first = `${today.slice(0, 7)}-01`
  const nextMonth = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1))
  return { gte: dayStart(first, field), lt: dayStart(nextMonth.toISOString().slice(0, 10), field) }
}

export function isBookingDateFilter(value: string): value is BookingDateFilter {
  return value === 'today' || value === 'this_week' || value === 'this_month'
}
