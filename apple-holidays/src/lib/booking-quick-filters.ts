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
 * Day boundaries are computed in server-local time, matching the existing
 * `dateFilter` handling in the bookings API.
 */

import type { Prisma } from '@prisma/client'

export const QUICK_FILTERS = [
  'on_ground',
  'arrivals_today',
  'arrivals_tomorrow',
  'arrivals_upcoming',
  'departures_today',
  'departures_upcoming',
  'completed_yesterday',
] as const

export type QuickFilter = typeof QUICK_FILTERS[number]

export function isQuickFilter(value: string): value is QuickFilter {
  return (QUICK_FILTERS as readonly string[]).includes(value)
}

/** Number of days ahead the two "upcoming" buckets look. */
export const UPCOMING_WINDOW_DAYS = 7

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

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
  const today     = startOfDay(now)
  const tomorrow  = addDays(today, 1)
  const dayAfter  = addDays(today, 2)
  const yesterday = addDays(today, -1)
  const horizon   = addDays(today, UPCOMING_WINDOW_DAYS + 1)

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
  }
}

/** Human labels, shared by the cards and the active-filter chip. */
export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  on_ground:           'On Ground',
  arrivals_today:      'Arriving Today',
  arrivals_tomorrow:   'Arriving Tomorrow',
  arrivals_upcoming:   `Arrivals · Next ${UPCOMING_WINDOW_DAYS}d`,
  departures_today:    'Departing Today',
  departures_upcoming: `Departures · Next ${UPCOMING_WINDOW_DAYS}d`,
  completed_yesterday: 'Completed Yesterday',
}

/**
 * Sort that makes each bucket read naturally once clicked — soonest first for
 * anything forward-looking, most recent first for anything already finished.
 */
export const QUICK_FILTER_SORT: Record<QuickFilter, { sortBy: 'arrivalDate' | 'departureDate'; sortDir: 'asc' | 'desc' }> = {
  on_ground:           { sortBy: 'departureDate', sortDir: 'asc'  },
  arrivals_today:      { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  arrivals_tomorrow:   { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  arrivals_upcoming:   { sortBy: 'arrivalDate',   sortDir: 'asc'  },
  departures_today:    { sortBy: 'departureDate', sortDir: 'asc'  },
  departures_upcoming: { sortBy: 'departureDate', sortDir: 'asc'  },
  completed_yesterday: { sortBy: 'departureDate', sortDir: 'desc' },
}
