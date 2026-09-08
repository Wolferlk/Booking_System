/**
 * Operational quick filters for the All Bookings page.
 *
 * These are the buckets ops staff ask for every morning — who is in the country
 * right now, who lands today/tomorrow, who flies out, what finished yesterday.
 * None of them are stored: each is derived purely from (arrivalDate,
 * departureDate) so they stay correct without any extra bookkeeping.
 *
 * The same fragments back both the counts on the cards and the filtered list,
 * which is what makes "card count == rows you see after clicking" true.
 *
 * Day boundaries come from `booking-date-window.ts`, so "today" is the day the
 * office is having in the operations timezone — not the day the server's UTC
 * clock is on. The two disagree for the 5½ hours after midnight in Colombo,
 * which is when the overnight import runs.
 */

import type { Prisma } from '@prisma/client'
import { calendarDayStart, createdDayStart, opsToday } from '@/lib/booking-date-window'
import { shiftDate } from '@/lib/reports/report-window'

/** The buckets that have a card of their own above the list. */
export const QUICK_FILTERS = [
  'on_ground',
  'arrivals_today',
  'arrivals_tomorrow',
  'arrivals_upcoming',
  'departures_today',
  'departures_upcoming',
  'completed_yesterday',
] as const

/** One card each, above the list. */
export type CardQuickFilter = typeof QUICK_FILTERS[number]

/**
 * The buckets that live as buttons on the filter bar instead of as cards.
 *
 * "On ground today" is not here because it already exists: it is `on_ground`,
 * the guests in the country right now. Giving it a second name would mean two
 * filters that can never disagree and a card and a button that could look like
 * they were counting different things.
 */
export const BAR_QUICK_FILTERS = [
  'created_today',
  'created_yesterday',
  'on_ground',
  'on_ground_yesterday',
] as const

export const QUICK_FILTERS_ALL = [
  ...QUICK_FILTERS,
  'created_today',
  'created_yesterday',
  'on_ground_yesterday',
] as const

export type QuickFilter = typeof QUICK_FILTERS_ALL[number]

export function isQuickFilter(value: string): value is QuickFilter {
  return (QUICK_FILTERS_ALL as readonly string[]).includes(value)
}

export function isCardQuickFilter(value: string): value is CardQuickFilter {
  return (QUICK_FILTERS as readonly string[]).includes(value)
}

/** Number of days ahead the two "upcoming" buckets look. */
export const UPCOMING_WINDOW_DAYS = 7


/** Cancelled trips never ran, so they are excluded from every operational bucket. */
const NOT_CANCELLED: Prisma.BookingWhereInput = {
  status: { notIn: ['CANCELLED', 'PENDING_CANCELLATION'] },
}

/**
 * Prisma `where` fragment for a quick filter.
 *
 * `on_ground` is the only two-sided one: the guest has landed (arrival day has
 * begun) and has not yet flown out (departure day has not ended).
 */
export function quickFilterWhere(filter: QuickFilter, now: Date = new Date()): Prisma.BookingWhereInput {
  // The office's calendar day, then boundaries in the units each column is
  // stored in: arrival/departure are dates written as midnight UTC, `createdAt`
  // is a real instant and gets the operations-timezone day.
  const day       = opsToday(now)
  const today     = calendarDayStart(day)
  const tomorrow  = calendarDayStart(shiftDate(day, 1))
  const dayAfter  = calendarDayStart(shiftDate(day, 2))
  const yesterday = calendarDayStart(shiftDate(day, -1))
  const horizon   = calendarDayStart(shiftDate(day, UPCOMING_WINDOW_DAYS + 1))

  switch (filter) {
    case 'on_ground':
      return {
        ...NOT_CANCELLED,
        arrivalDate:   { lt: tomorrow },
        departureDate: { gte: today },
      }

    case 'arrivals_today':
      return { ...NOT_CANCELLED, arrivalDate: { gte: today, lt: tomorrow } }

    case 'arrivals_tomorrow':
      return { ...NOT_CANCELLED, arrivalDate: { gte: tomorrow, lt: dayAfter } }

    // Day after tomorrow through the end of the window — today and tomorrow have
    // their own cards, so this one shows only what they don't.
    case 'arrivals_upcoming':
      return { ...NOT_CANCELLED, arrivalDate: { gte: dayAfter, lt: horizon } }

    case 'departures_today':
      return { ...NOT_CANCELLED, departureDate: { gte: today, lt: tomorrow } }

    case 'departures_upcoming':
      return { ...NOT_CANCELLED, departureDate: { gte: tomorrow, lt: horizon } }

    case 'completed_yesterday':
      return { ...NOT_CANCELLED, departureDate: { gte: yesterday, lt: today } }

    // Anyone who was in the country at any point during yesterday: landed on or
    // before it, flew out on or after it. A guest mid-trip is counted on every
    // day of the trip, which is what "on ground on that day" means.
    case 'on_ground_yesterday':
      return {
        ...NOT_CANCELLED,
        arrivalDate:   { lt: today },
        departureDate: { gte: yesterday },
      }

    // Intake, not operations — so cancelled bookings are *not* excluded here.
    // A booking filed yesterday and cancelled since was still filed yesterday,
    // and hiding it would put this count back out of step with the daily report.
    case 'created_today':
      return { createdAt: { gte: createdDayStart(day), lt: createdDayStart(shiftDate(day, 1)) } }

    case 'created_yesterday':
      return { createdAt: { gte: createdDayStart(shiftDate(day, -1)), lt: createdDayStart(day) } }
  }
}

/** Human labels, shared by the cards and the active-filter chip. */
export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  created_today:       'Created Today',
  created_yesterday:   'Created Yesterday',
  on_ground_yesterday: 'On Ground Yesterday',
  on_ground:           'On Ground',
  arrivals_today:      'Arriving Today',
  arrivals_tomorrow:   'Arriving Tomorrow',
  arrivals_upcoming:   `Arrivals · Next ${UPCOMING_WINDOW_DAYS}d`,
  departures_today:    'Departing Today',
  departures_upcoming: `Departures · Next ${UPCOMING_WINDOW_DAYS}d`,
  completed_yesterday: 'Completed Yesterday',
}

/**
 * Labels for the filter-bar buttons. Only `on_ground` differs from its card
 * label: on the card it sits under the heading "Operations today" and reads
 * correctly as "On Ground", but next to an "On Ground Yesterday" button it has
 * to say which day it means.
 */
export const BAR_QUICK_FILTER_LABELS: Record<typeof BAR_QUICK_FILTERS[number], string> = {
  created_today:       'Created Today',
  created_yesterday:   'Created Yesterday',
  on_ground:           'On Ground Today',
  on_ground_yesterday: 'On Ground Yesterday',
}

/**
 * Sort that makes each bucket read naturally once clicked — soonest first for
 * anything forward-looking, most recent first for anything already finished.
 */
export const QUICK_FILTER_SORT: Record<QuickFilter, { sortBy: 'arrivalDate' | 'departureDate' | 'createdAt'; sortDir: 'asc' | 'desc' }> = {
  created_today:       { sortBy: 'createdAt',     sortDir: 'desc' },
  created_yesterday:   { sortBy: 'createdAt',     sortDir: 'desc' },
  on_ground_yesterday: { sortBy: 'departureDate', sortDir: 'asc'  },
  on_ground:           { sortBy: 'departureDate', sortDir: 'asc'  },
  arrivals_today:      { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  arrivals_tomorrow:   { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  arrivals_upcoming:   { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  departures_today:    { sortBy: 'departureDate', sortDir: 'asc'  },
  departures_upcoming: { sortBy: 'departureDate', sortDir: 'asc'  },
  completed_yesterday: { sortBy: 'departureDate', sortDir: 'desc' },
}
