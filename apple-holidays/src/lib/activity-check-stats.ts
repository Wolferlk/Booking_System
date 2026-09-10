/**
 * What the matched activities add up to.
 *
 * The row list answers "which files"; these aggregates answer the questions a
 * desk asks straight afterwards — how many pax is that, which days are heavy,
 * which agent is sending them, and how much of it still has nobody driving it.
 *
 * Every aggregate is computed from the *result rows*, never from a second
 * query, so the headline numbers can never disagree with the table beneath
 * them or with the exported file.
 */

import type { ActivityRow, ActivityCheckQuery } from '@/lib/activity-check'
import { SERVICE_TYPE_LABELS } from '@/lib/service-types'

export type Bucket = {
  key:       string
  label:     string
  count:     number
  bookings:  number
  pax:       number
}

export type DayBucket = Bucket & {
  /** ISO date (yyyy-mm-dd) — the histogram's x-axis. */
  date:    string
  weekday: string
}

export type TermBucket = Bucket & {
  /** First and last date this keyword appears on, inside the window. */
  firstDate: string | null
  lastDate:  string | null
  /** Distinct activity titles this keyword matched — how many ways it is written. */
  variants:  number
}

export type ActivityStats = {
  activities:     number
  bookings:       number
  pax:            number
  /** Agenda-sourced rows vs itinerary-sourced rows. */
  fromAgenda:     number
  fromItinerary:  number
  /** Agenda movements that still need a driver, guide or vendor. */
  unassigned:     number
  /** Rows on files marked cancelled — only ever non-zero when they were asked for. */
  cancelled:      number
  /** Activities dated before today. */
  past:           number
  today:          number
  upcoming:       number
  distinctAgents: number
  byTerm:         TermBucket[]
  byDay:          DayBucket[]
  byLocation:     Bucket[]
  byServiceType:  Bucket[]
  byAgent:        Bucket[]
  byVendor:       Bucket[]
  /** The distinct activity titles behind the matches, most common first. */
  byActivity:     Bucket[]
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * A grouping pass.
 *
 * Bookings are counted distinctly and pax is summed *per distinct booking*
 * rather than per row: one file doing Ba Na Hills on an agenda line and again
 * on its itinerary line is two activities but four people once, not eight.
 */
function group(
  rows: ActivityRow[],
  keyOf: (r: ActivityRow) => string | null,
  labelOf: (r: ActivityRow, key: string) => string,
): Bucket[] {
  const map = new Map<string, { label: string; count: number; bookings: Set<string>; pax: Map<string, number> }>()
  for (const r of rows) {
    const key = keyOf(r)
    if (!key) continue
    let bucket = map.get(key)
    if (!bucket) {
      bucket = { label: labelOf(r, key), count: 0, bookings: new Set(), pax: new Map() }
      map.set(key, bucket)
    }
    bucket.count++
    bucket.bookings.add(r.bookingId)
    bucket.pax.set(r.bookingId, r.totalPax)
  }
  return Array.from(map.entries())
    .map(([key, b]) => ({
      key,
      label: b.label,
      count: b.count,
      bookings: b.bookings.size,
      pax: Array.from(b.pax.values()).reduce((s, n) => s + n, 0),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** Total pax across a set of rows, counting each booking once. */
function distinctPax(rows: ActivityRow[]): number {
  const perBooking = new Map<string, number>()
  for (const r of rows) perBooking.set(r.bookingId, r.totalPax)
  return Array.from(perBooking.values()).reduce((s, n) => s + n, 0)
}

export function summarise(rows: ActivityRow[], q: ActivityCheckQuery): ActivityStats {
  const bookings = new Set(rows.map(r => r.bookingId))

  // Per keyword. A row can match more than one keyword, so this is built by
  // walking the keywords rather than grouping the rows — the columns overlap
  // on purpose, and they should.
  const byTerm: TermBucket[] = q.terms.map(term => {
    const hits = rows.filter(r => r.matchedTerms.includes(term))
    const dates = hits.map(r => r.date).sort()
    const variants = new Set(hits.map(r => r.activity.trim().toLowerCase()))
    return {
      key: term,
      label: term,
      count: hits.length,
      bookings: new Set(hits.map(r => r.bookingId)).size,
      pax: distinctPax(hits),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      variants: variants.size,
    }
  }).sort((a, b) => b.count - a.count)

  const byDay: DayBucket[] = group(rows, r => r.date.slice(0, 10), (_r, key) => key)
    .map(b => ({
      ...b,
      date: b.key,
      weekday: WEEKDAYS[new Date(`${b.key}T00:00:00`).getDay()],
      label: new Date(`${b.key}T00:00:00`).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short',
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    activities: rows.length,
    bookings: bookings.size,
    pax: distinctPax(rows),
    fromAgenda: rows.filter(r => r.source === 'AGENDA').length,
    fromItinerary: rows.filter(r => r.source === 'ITINERARY').length,
    unassigned: rows.filter(r => r.source === 'AGENDA' && !r.assigned && !r.isLeisure && !r.isHotelOnly).length,
    cancelled: rows.filter(r => r.cancelled).length,
    past: rows.filter(r => r.daysAway < 0).length,
    today: rows.filter(r => r.daysAway === 0).length,
    upcoming: rows.filter(r => r.daysAway > 0).length,
    distinctAgents: new Set(rows.map(r => r.agent).filter(Boolean)).size,
    byTerm,
    byDay,
    byLocation: group(rows, r => (r.location ?? '').trim() || null, r => (r.location ?? '').trim()).slice(0, 20),
    byServiceType: group(rows, r => r.serviceType, r => SERVICE_TYPE_LABELS[r.serviceType!] ?? r.serviceType!),
    byAgent: group(rows, r => (r.agent ?? '').trim() || null, r => (r.agent ?? '').trim()).slice(0, 20),
    byVendor: group(
      rows,
      r => (r.tourVendorName ?? r.vendorName ?? '').trim() || null,
      r => (r.tourVendorName ?? r.vendorName ?? '').trim(),
    ).slice(0, 20),
    // Normalised so casing and stray spacing don't split one product into three
    // rows; the label keeps whichever spelling was seen first.
    byActivity: group(
      rows,
      r => r.activity.trim().toLowerCase().replace(/\s+/g, ' ') || null,
      r => r.activity.trim(),
    ).slice(0, 30),
  }
}
