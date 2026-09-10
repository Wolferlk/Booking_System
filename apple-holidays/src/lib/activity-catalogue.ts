/**
 * The Activity Explorer — "what could I even search for?"
 *
 * A keyword box is only useful to someone who already knows the keyword. This
 * builds the other half: the list of things the book actually contains, mined
 * from the activity names on real agendas and itineraries, so a user can pick
 * "Ba Na Hills" out of a list instead of guessing how it was typed.
 *
 * It is not a distinct-titles list. Titles are written a dozen ways —
 * "Full-Day Ba Na Hill & Golden Hands Bridge with Cable Car", "Bana Hills Cable
 * Car & Golden Bridge", "SIC Tour Ba Na Hills" — and a list of those is a list
 * of noise. Instead the titles are broken into phrases and the phrases are
 * ranked by how many *distinct bookings* they appear on, which is what pulls
 * the product name out of the packaging.
 *
 * Read-only: two `findMany`s over a bounded date window and nothing else.
 */

import { prisma } from '@/lib/prisma'
import { normalise, bookingWhere, startOfDay, endOfDay, type SessionScope, type ActivityCheckQuery } from '@/lib/activity-check'

/**
 * Words that describe the *packaging* rather than the product. A phrase is
 * dropped if it begins or ends with one of these, which is what turns
 * "day ba na hills with" into "ba na hills".
 */
const NOISE = new Set([
  'a', 'an', 'and', 'the', 'to', 'from', 'at', 'in', 'on', 'of', 'for', 'with', 'by', 'or', 'via',
  'tour', 'tours', 'transfer', 'transfers', 'private', 'shared', 'basis', 'sic', 'pvt',
  'full', 'half', 'day', 'days', 'night', 'nights', 'am', 'pm',
  'hotel', 'airport', 'pick', 'pickup', 'drop', 'dropoff', 'off', 'up',
  'free', 'included', 'includes', 'including', 'lunch', 'dinner', 'breakfast', 'meal',
  'ticket', 'tickets', 'entrance', 'visit', 'visiting', 'guide', 'guided',
  'arrival', 'departure', 'check', 'out', 'city', 'own', 'arrangement', 'leisure',
  'return', 'one', 'way', 'combo', 'package', 'experience', 'excursion', 'trip',
])

/** Phrases this short are noise even when their words are not. */
const MIN_PHRASE_CHARS = 4

export type CatalogueEntry = {
  /** Normalised phrase — what gets pushed into the keyword box. */
  key:        string
  /** Title-cased phrase, for display. */
  label:      string
  /** Activity records containing the phrase. */
  count:      number
  /** Distinct bookings — the number that actually ranks a product. */
  bookings:   number
  firstDate:  string | null
  lastDate:   string | null
  /** Where the phrase was seen: agenda rows, itinerary rows, or both. */
  sources:    ('AGENDA' | 'ITINERARY')[]
  /** A real title containing it, so the user can see what they are picking. */
  example:    string
}

export type CatalogueResult = {
  activities: CatalogueEntry[]
  /** Locations, which are a controlled-ish list and worth offering separately. */
  locations:  CatalogueEntry[]
  scanned:    number
  truncated:  boolean
}

const titleCase = (phrase: string) =>
  phrase.split(' ').map(w => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')

type Seen = {
  count:     number
  bookings:  Set<string>
  first:     string | null
  last:      string | null
  sources:   Set<'AGENDA' | 'ITINERARY'>
  example:   string
}

function touch(
  map: Map<string, Seen>,
  key: string,
  bookingId: string,
  date: string,
  source: 'AGENDA' | 'ITINERARY',
  example: string,
): void {
  let s = map.get(key)
  if (!s) {
    s = { count: 0, bookings: new Set(), first: null, last: null, sources: new Set(), example }
    map.set(key, s)
  }
  s.count++
  s.bookings.add(bookingId)
  s.sources.add(source)
  if (!s.first || date < s.first) s.first = date
  if (!s.last || date > s.last) s.last = date
  // Prefer the shortest example: the least padded way the product was written.
  if (example && example.length < s.example.length) s.example = example
}

/** Every 1–4 word phrase in `title` that does not start or end on a noise word. */
function phrasesOf(title: string): string[] {
  const tokens = normalise(title).split(' ').filter(Boolean)
  const out: string[] = []
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const window = tokens.slice(i, i + n)
      if (NOISE.has(window[0]) || NOISE.has(window[window.length - 1])) continue
      // A single number ("2", "5") carries no meaning on its own.
      if (n === 1 && /^\d+$/.test(window[0])) continue
      const phrase = window.join(' ')
      if (phrase.length < MIN_PHRASE_CHARS) continue
      out.push(phrase)
    }
  }
  // A title mentioning "ba na hills" three times should still count once.
  return Array.from(new Set(out))
}

/**
 * Drops a phrase that is merely a fragment of a longer, near-as-common one.
 *
 * Without this the list reads "Ba Na", "Na Hills", "Ba Na Hills", "Hills" —
 * four rows for one product. A shorter phrase survives only if it appears on
 * meaningfully more bookings than the longer phrase containing it, which is
 * exactly the case where it *is* a broader product in its own right.
 */
function dropFragments(entries: CatalogueEntry[]): CatalogueEntry[] {
  const byKey = new Map(entries.map(e => [e.key, e]))
  return entries.filter(e => {
    for (const other of Array.from(byKey.values())) {
      if (other.key === e.key) continue
      if (other.key.length <= e.key.length) continue
      if (!` ${other.key} `.includes(` ${e.key} `)) continue
      if (other.bookings >= e.bookings * 0.8) return false
    }
    return true
  })
}

export async function fetchActivityCatalogue(
  scope: SessionScope,
  opts: {
    from?: Date | null
    to?: Date | null
    /** Free text to narrow the list — matched against the phrase itself. */
    q?: string
    limit?: number
    scanCap?: number
    country?: string
    now?: Date
  } = {},
): Promise<CatalogueResult> {
  const { q = '', limit = 60, scanCap = 12_000, country = '', now = new Date() } = opts

  // A generous default window: the catalogue is meant to show what the product
  // list *is*, not what next week holds, so it reaches back six months and
  // forward twelve.
  const start = opts.from ? startOfDay(opts.from) : startOfDay(new Date(now.getFullYear(), now.getMonth() - 6, 1))
  const end = opts.to ? endOfDay(opts.to) : endOfDay(new Date(now.getFullYear(), now.getMonth() + 12, 0))

  const booking = bookingWhere(
    { country, agent: '', booking: '', includeCancelled: false } as ActivityCheckQuery,
    scope,
  )

  const [agendaItems, itineraryItems] = await Promise.all([
    prisma.agendaItem.findMany({
      where: { AND: [{ date: { gte: start, lte: end } }, { agenda: { booking } }] },
      select: {
        date: true, toPoint: true, location: true,
        agenda: { select: { bookingId: true } },
      },
      orderBy: { date: 'desc' },
      take: scanCap,
    }),
    prisma.itineraryItem.findMany({
      where: { AND: [{ date: { gte: start, lte: end } }, { booking }] },
      select: { date: true, title: true, bookingId: true },
      orderBy: { date: 'desc' },
      take: scanCap,
    }),
  ])

  const activityMap = new Map<string, Seen>()
  const locationMap = new Map<string, Seen>()

  for (const it of agendaItems) {
    const iso = it.date.toISOString()
    const title = (it.toPoint ?? '').trim()
    if (title) {
      for (const p of phrasesOf(title)) touch(activityMap, p, it.agenda.bookingId, iso, 'AGENDA', title)
    }
    const loc = (it.location ?? '').trim()
    if (loc) touch(locationMap, normalise(loc), it.agenda.bookingId, iso, 'AGENDA', loc)
  }

  for (const it of itineraryItems) {
    const iso = it.date.toISOString()
    const title = it.title.trim()
    if (title) {
      for (const p of phrasesOf(title)) touch(activityMap, p, it.bookingId, iso, 'ITINERARY', title)
    }
  }

  const needle = normalise(q)

  const toEntries = (map: Map<string, Seen>, minBookings: number): CatalogueEntry[] =>
    Array.from(map.entries())
      .filter(([key, s]) => s.bookings.size >= minBookings && (!needle || key.includes(needle)))
      .map(([key, s]) => ({
        key,
        label: titleCase(key),
        count: s.count,
        bookings: s.bookings.size,
        firstDate: s.first,
        lastDate: s.last,
        sources: Array.from(s.sources),
        example: s.example,
      }))

  // A phrase on a single booking is somebody's one-off wording, not a product —
  // unless the user is actively searching, in which case showing the one hit is
  // more useful than showing nothing.
  const minBookings = needle ? 1 : 2

  const activities = dropFragments(
    toEntries(activityMap, minBookings)
      .sort((a, b) => b.bookings - a.bookings || b.count - a.count || a.label.localeCompare(b.label))
      // Fragment removal is O(n²), so it is handed a shortlist rather than the
      // full phrase space of every title in the window.
      .slice(0, limit * 6),
  ).slice(0, limit)

  const locations = toEntries(locationMap, 1)
    .sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label))
    .slice(0, 40)

  return {
    activities,
    locations,
    scanned: agendaItems.length + itineraryItems.length,
    truncated: agendaItems.length >= scanCap || itineraryItems.length >= scanCap,
  }
}
