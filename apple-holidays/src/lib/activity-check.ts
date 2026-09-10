/**
 * Activity Check — "which files are doing Ba Na Hills next week?"
 *
 * Every other search in this system starts from a *booking*: you know the ref,
 * or the guest, or the agent, and you drill down to what they are doing. This
 * one runs the other way. It starts from the activity — a keyword, a tour name,
 * a place — and finds every file that touches it inside a date window.
 *
 * Two record types answer that question and they are deliberately merged here:
 *
 *  - `AgendaItem` (the Movement Chart) is the operational truth. It has the
 *    real date, the pickup time, the service type, the driver and the vendor.
 *  - `ItineraryItem` (the day-by-day itinerary) is the sold truth. It has the
 *    long marketing description and it exists on files whose agenda was never
 *    built.
 *
 * A file can have either, both, or one with the detail missing from the other,
 * so a row from one side is enriched with its same-day counterpart from the
 * other (`counterpart` below): search the agenda, and if the agenda movement
 * has no usable description, the itinerary day supplies it.
 *
 * ── Read-only ────────────────────────────────────────────────────────────────
 * This module and everything built on it issue `findMany` / `count` and nothing
 * else. There is no write path, no schema change and no new table: the feature
 * is a lens over rows other screens already own.
 */

import { prisma } from '@/lib/prisma'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { SERVICE_TYPE_LABELS, SERVICE_TYPE_VALUES } from '@/lib/service-types'
import { ACTIVITY_FIELDS as FIELDS } from '@/lib/activity-check-shared'
import type { ActivityField, RangePreset } from '@/lib/activity-check-shared'
import type { Prisma, UserRole } from '@prisma/client'

/**
 * Who may run it. Read-only across the operational desks — the same reach as
 * the Daily Update sheet, which shows strictly more per booking than this does.
 */
export const ACTIVITY_CHECK_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'AC_USER', 'RS_USER',
  'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

// ─── Query shape ──────────────────────────────────────────────────────────────

/** Which record a row came from. */
export type ActivitySource = 'AGENDA' | 'ITINERARY'

/** Which records the search reads. */
export type SourceFilter = 'BOTH' | 'AGENDA' | 'ITINERARY'

/** `any` = at least one keyword hits. `all` = every keyword hits the same row. */
export type MatchMode = 'any' | 'all'

/**
 * The text a keyword is matched against — see `activity-check-shared.ts`.
 *
 * Selectable because the same word means different things in different columns:
 * "Hanoi" in `location` is the city the movement belongs to, in `route` it is a
 * pickup point, and in `activity` it is part of a tour name. A desk chasing a
 * *product* wants `activity` only; a desk chasing a *region* wants `location`.
 */
export { ACTIVITY_FIELDS, ACTIVITY_FIELD_LABELS, RANGE_PRESET_LABELS } from '@/lib/activity-check-shared'
export type { ActivityField, RangePreset } from '@/lib/activity-check-shared'

export type SortBy = 'date' | 'booking' | 'activity' | 'location' | 'relevance'

export type ActivityCheckQuery = {
  /** Keywords / activity names. Empty = browse the whole window. */
  terms:            string[]
  matchMode:        MatchMode
  /** Tolerate typos and spacing slips — "Bana hils" finds "Ba Na Hills". */
  fuzzy:            boolean
  fields:           ActivityField[]
  from:             Date | null
  to:               Date | null
  source:           SourceFilter
  /** Agenda service types to keep. Empty = all of them. */
  serviceTypes:     string[]
  country:          string
  agent:            string
  /** Narrows to particular files — ref, IS number, agent or guest name. */
  booking:          string
  includeCancelled: boolean
  /** Only rows whose movement still has nobody driving it. */
  unassignedOnly:   boolean
  sortBy:           SortBy
  sortDir:          'asc' | 'desc'
}

export type SessionScope = {
  role:       UserRole
  country?:   string
  countries?: string[]
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function endOfDay(d: Date): Date {
  return new Date(startOfDay(d).getTime() + DAY_MS - 1)
}

// Weeks are Monday-based below, matching how the operations desk reads a roster.

/** Monday of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d)
  const shift = (s.getDay() + 6) % 7 // Sunday(0) -> 6, Monday(1) -> 0
  return new Date(s.getTime() - shift * DAY_MS)
}

export function resolvePreset(preset: RangePreset, now = new Date()): { from: Date; to: Date } | null {
  const today = startOfDay(now)
  const week = startOfWeek(now)
  const month = (offset: number) => new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const monthEnd = (offset: number) => endOfDay(new Date(now.getFullYear(), now.getMonth() + offset + 1, 0))
  const plus = (base: Date, days: number) => new Date(base.getTime() + days * DAY_MS)

  switch (preset) {
    case 'today':     return { from: today, to: endOfDay(today) }
    case 'tomorrow':  return { from: plus(today, 1), to: endOfDay(plus(today, 1)) }
    case 'thisWeek':  return { from: week, to: endOfDay(plus(week, 6)) }
    case 'lastWeek':  return { from: plus(week, -7), to: endOfDay(plus(week, -1)) }
    case 'nextWeek':  return { from: plus(week, 7), to: endOfDay(plus(week, 13)) }
    case 'next7':     return { from: today, to: endOfDay(plus(today, 6)) }
    case 'next14':    return { from: today, to: endOfDay(plus(today, 13)) }
    case 'next30':    return { from: today, to: endOfDay(plus(today, 29)) }
    case 'last30':    return { from: plus(today, -30), to: endOfDay(today) }
    case 'thisMonth': return { from: month(0), to: monthEnd(0) }
    case 'lastMonth': return { from: month(-1), to: monthEnd(-1) }
    case 'nextMonth': return { from: month(1), to: monthEnd(1) }
    default:          return null
  }
}

// ─── Text matching ────────────────────────────────────────────────────────────

/**
 * Fold text down to something two humans typing the same tour name will agree
 * on: lowercase, no Vietnamese diacritics, punctuation collapsed to spaces.
 *
 * The diacritic strip is what makes "Da Nang" find "Đà Nẵng". NFD handles the
 * combining marks; `đ`/`Đ` is a distinct letter rather than a d-with-mark, so
 * it is mapped by hand.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Levenshtein distance, capped — we only ever ask "is it within 1 or 2?". */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
      row.push(v)
      if (v < best) best = v
    }
    if (best > cap) return cap + 1
    prev = row
  }
  return prev[b.length]
}

/**
 * How much edit-distance slack a token of this length earns.
 *
 * Four characters is the floor for any slack at all: below that, one edit is
 * most of the word and "hue" would match "the". At four it is worth having —
 * "hils" for "hills" is exactly the slip this is here to absorb — and the cost
 * of the occasional loose hit is bounded, because every word of the keyword
 * still has to land somewhere in the same row before it counts as a match.
 */
function slackFor(token: string): number {
  if (token.length >= 8) return 2
  if (token.length >= 4) return 1
  return 0
}

/**
 * Does `haystack` (already normalised) contain `token`, allowing for typos?
 *
 * Exact substring first — that is the overwhelming majority and it is cheap.
 * Only then the fuzzy pass, which compares the token against each word of the
 * haystack and against sliding windows of the joined-up text, so a missing
 * space ("banahills") still lands.
 */
function tokenHits(haystack: string, token: string, fuzzy: boolean): boolean {
  if (!token) return false
  if (haystack.includes(token)) return true
  if (!fuzzy) return false

  // Spacing slips before typos: "banahills" and "Ba Na Hills" are the same
  // product written two ways, and matching them needs no slack at all — it is
  // still an exact substring, just of the space-free text. This has to come
  // before the slack check, or a short token like "bana" (which earns only one
  // edit of slack) would never get here.
  const squashed = haystack.replace(/ /g, '')
  if (squashed.includes(token)) return true

  const slack = slackFor(token)
  if (slack === 0) return false

  for (const word of haystack.split(' ')) {
    if (!word) continue
    if (editDistance(word, token, slack) <= slack) return true
  }

  // A typo *and* a missing space at once — compare the token against sliding
  // windows of the space-free text rather than against whole words.
  const width = token.length
  for (let i = 0; i + width - slack <= squashed.length; i++) {
    const window = squashed.slice(i, i + width + slack)
    if (editDistance(window, token, slack) <= slack) return true
  }
  return false
}

/**
 * Does one keyword hit this text?
 *
 * A keyword is matched *by its words*: "ba na hills" needs `ba`, `na` and
 * `hills` all present, in any order and anywhere in the text. That is what
 * makes a keyword survive the many ways the same product is written across
 * files — "Full-Day Ba Na Hill & Golden Hands Bridge" and "Bana Hills Cable
 * Car" are the same activity to a desk, and to this.
 */
export function termHits(haystack: string, term: string, fuzzy: boolean): boolean {
  const tokens = normalise(term).split(' ').filter(Boolean)
  if (tokens.length === 0) return false
  return tokens.every(t => tokenHits(haystack, t, fuzzy))
}

/**
 * A readable fragment of `text` around the first place `term` appears, for the
 * "why did this row match?" line under each result.
 */
export function snippetFor(text: string, term: string, width = 150): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const tokens = normalise(term).split(' ').filter(Boolean)
  const hay = normalise(flat)

  // Anchor on the longest token — the most distinctive one, and the least
  // likely to be a stop word that appears in the first sentence by chance.
  const anchor = [...tokens].sort((a, b) => b.length - a.length)[0] ?? ''
  const at = hay.indexOf(anchor)
  if (at < 0 || flat.length <= width) return flat.slice(0, width)

  // The normalised string is not index-aligned with the original (punctuation
  // collapses), so treat the hit position as a ratio rather than an offset.
  const approx = Math.round((at / Math.max(hay.length, 1)) * flat.length)
  const start = Math.max(0, approx - Math.floor(width / 3))
  const end = Math.min(flat.length, start + width)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

/** The same-day record from the *other* side, when there is one. */
export type Counterpart = {
  source:      ActivitySource
  activity:    string
  details:     string | null
  /** Itinerary day number, when the counterpart is an itinerary row. */
  dayNo:       number | null
}

export type ActivityRow = {
  /** `${source}:${recordId}` — unique across both tables. */
  id:               string
  source:           ActivitySource
  bookingId:        string
  bookingRef:       string
  isNumber:         string | null
  cntlNumber:       string | null
  agentBookingId:   string | null
  agent:            string | null
  fileHandler:      string | null
  operationCountry: string | null
  status:           string
  cancelled:        boolean
  hotelOnly:        boolean
  arrivalDate:      string
  departureDate:    string
  /** The activity's own date — what the window filters on. */
  date:             string
  /** Day 1, day 2… counted from arrival, so a row reads like the itinerary. */
  dayNo:            number | null
  weekday:          string
  /** Whole days from today. Negative once the activity is in the past. */
  daysAway:         number
  activity:         string
  location:         string | null
  fromPoint:        string | null
  toPoint:          string | null
  details:          string | null
  serviceType:      string | null
  serviceTypeLabel: string | null
  meetingTime:      string | null
  timeFrom:         string | null
  timeTo:           string | null
  mealPlan:         string | null
  isLeisure:        boolean | null
  isHotelOnly:      boolean | null
  driverName:       string | null
  driverPhone:      string | null
  vehicleType:      string | null
  vehiclePlate:     string | null
  vendorName:       string | null
  guideName:        string | null
  guidePhone:       string | null
  tourVendorName:   string | null
  tourVendorPhone:  string | null
  assigned:         boolean
  guestName:        string | null
  guestPhone:       string | null
  guestEmail:       string | null
  guestWhatsapp:    string | null
  paxAdults:        number
  paxChildren:      number
  paxInfants:       number
  totalPax:         number
  /** Which of the searched keywords this row answered to. */
  matchedTerms:     string[]
  /** Which fields the hit was found in — the "why" behind the match. */
  matchedFields:    ActivityField[]
  /** A fragment of the matching text, for the result card. */
  snippet:          string
  /** Higher = a better match. Drives the relevance sort. */
  score:            number
  counterpart:      Counterpart | null
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

/** Splits the keyword box. Commas and newlines separate; quotes group. */
export function parseTerms(raw: string): string[] {
  if (!raw) return []
  const out: string[] = []
  const re = /"([^"]+)"|'([^']+)'|([^,\n;]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (value) out.push(value)
  }
  // De-duplicate on the normalised form so "Ba Na Hills" and "bana hills"
  // don't produce two identical columns in the per-keyword breakdown.
  const seen = new Set<string>()
  return out.filter(t => {
    const key = normalise(t)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 25)
}

const SORTS: SortBy[] = ['date', 'booking', 'activity', 'location', 'relevance']
const SOURCES: SourceFilter[] = ['BOTH', 'AGENDA', 'ITINERARY']

export function parseActivityCheckQuery(sp: URLSearchParams, now = new Date()): ActivityCheckQuery {
  const parseDate = (v: string | null): Date | null => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  const preset = (sp.get('preset') ?? '') as RangePreset
  const presetRange = preset && preset !== 'custom' ? resolvePreset(preset, now) : null

  const rawFields = (sp.get('fields') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const fields = rawFields.filter((f): f is ActivityField => (FIELDS as string[]).includes(f))

  const serviceTypes = (sp.get('serviceTypes') ?? '')
    .split(',').map(s => s.trim()).filter(s => (SERVICE_TYPE_VALUES as readonly string[]).includes(s))

  const sortBy = SORTS.includes(sp.get('sortBy') as SortBy) ? sp.get('sortBy') as SortBy : 'date'

  return {
    terms:    parseTerms(sp.get('terms') ?? sp.get('q') ?? ''),
    matchMode: sp.get('matchMode') === 'all' ? 'all' : 'any',
    // On by default: the whole point of a keyword search over free text typed
    // by a dozen people is that it survives how they each spelled it.
    fuzzy:    sp.get('fuzzy') !== '0',
    fields:   fields.length ? fields : [...FIELDS],
    from:     presetRange ? presetRange.from : parseDate(sp.get('from')),
    to:       presetRange ? presetRange.to   : parseDate(sp.get('to')),
    source:   SOURCES.includes(sp.get('source') as SourceFilter) ? sp.get('source') as SourceFilter : 'BOTH',
    serviceTypes,
    country:  (sp.get('country') ?? '').trim(),
    agent:    (sp.get('agent') ?? '').trim(),
    booking:  (sp.get('booking') ?? '').trim(),
    includeCancelled: sp.get('includeCancelled') === '1',
    unassignedOnly:   sp.get('unassignedOnly') === '1',
    sortBy,
    sortDir:  sp.get('sortDir') === 'desc' ? 'desc' : 'asc',
  }
}

/**
 * The window actually searched.
 *
 * An unbounded search over every activity ever sold is not a question anyone
 * asks, and it would be an expensive way to find out — so an absent range
 * defaults to the coming fortnight, and any range is clamped to two years.
 */
export function resolveRange(q: ActivityCheckQuery, now = new Date()): { start: Date; end: Date } {
  const start = q.from ? startOfDay(q.from) : startOfDay(now)
  const fallbackEnd = endOfDay(new Date(start.getTime() + 13 * DAY_MS))
  let end = q.to ? endOfDay(q.to) : fallbackEnd
  if (end < start) end = endOfDay(start)
  const maxEnd = endOfDay(new Date(start.getTime() + 730 * DAY_MS))
  if (end > maxEnd) end = maxEnd
  return { start, end }
}

// ─── Booking scope ────────────────────────────────────────────────────────────

/** Country scoping, identical in shape to every other list route in the app. */
export function countryClause(scope: SessionScope, override: string): Prisma.BookingWhereInput | null {
  if (!canSeeAllCountries(scope.role, (scope.country ?? 'ALL') as never)) {
    const allowed = userCountryScope(scope.country, scope.countries)
    return allowed ? { operationCountry: { in: allowed as never } } : null
  }
  if (!override || override === 'ALL') return null
  const expanded = countryScope(override)
  return expanded && expanded.length > 1
    ? { operationCountry: { in: expanded as never } }
    : { operationCountry: override as never }
}

/** The booking-side filter both halves of the search share. */
export function bookingWhere(q: ActivityCheckQuery, scope: SessionScope): Prisma.BookingWhereInput {
  const and: Prisma.BookingWhereInput[] = []

  const country = countryClause(scope, q.country)
  if (country) and.push(country)

  if (q.agent) and.push({ agent: q.agent })
  if (!q.includeCancelled) and.push({ status: { not: 'CANCELLED' } })

  if (q.booking) {
    and.push({
      OR: [
        { bookingRef:     { contains: q.booking } },
        { isNumber:       { contains: q.booking } },
        { cntlNumber:     { contains: q.booking } },
        { agentBookingId: { contains: q.booking } },
        { agent:          { contains: q.booking } },
        { fileHandler:    { contains: q.booking } },
        { passengers: { some: { name: { contains: q.booking } } } },
      ],
    })
  }

  return and.length ? { AND: and } : {}
}

const BOOKING_SELECT = {
  id: true, bookingRef: true, isNumber: true, cntlNumber: true, agentBookingId: true,
  agent: true, fileHandler: true, operationCountry: true, status: true,
  arrivalDate: true, departureDate: true, hotelOnly: true,
  paxAdults: true, paxChildren: true, paxInfants: true,
  contactPhone: true, contactEmail: true, contactWhatsapp: true,
  passengers: { select: { name: true, isLead: true }, orderBy: { isLead: 'desc' as const } },
} satisfies Prisma.BookingSelect

type BookingShape = Prisma.BookingGetPayload<{ select: typeof BOOKING_SELECT }>

/**
 * SQL pre-filter for the keywords.
 *
 * Only used when fuzzy matching is off. With fuzzy on, a typo'd keyword by
 * definition does not appear in any column, so the database cannot narrow the
 * set for us and the window itself is the bound — see `fetchActivityRows`.
 * Tokens shorter than three characters are dropped: they match everything and
 * would turn the pre-filter into a full scan with extra steps.
 */
function keywordPrefilter(q: ActivityCheckQuery, columns: string[]): { OR: Record<string, unknown>[] } | null {
  if (q.fuzzy || q.terms.length === 0) return null
  const or: Record<string, unknown>[] = []
  for (const term of q.terms) {
    // The longest word of the keyword is the most selective — and requiring
    // only one word keeps the pre-filter *wider* than the real match, which is
    // what a pre-filter must be if it is not to drop true hits.
    const token = normalise(term).split(' ').filter(t => t.length >= 3).sort((a, b) => b.length - a.length)[0]
    if (!token) return null
    for (const col of columns) or.push({ [col]: { contains: token } })
  }
  return or.length ? { OR: or } : null
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function dayNumber(activityDate: Date, arrival: Date): number | null {
  const diff = Math.round((startOfDay(activityDate).getTime() - startOfDay(arrival).getTime()) / DAY_MS)
  return diff >= 0 ? diff + 1 : null
}

function leadGuest(b: BookingShape): string | null {
  return b.passengers[0]?.name ?? null
}

/** The text each field contributes to matching, per row. */
function fieldText(row: ActivityRow): Record<ActivityField, string> {
  return {
    activity: row.activity ?? '',
    details:  row.details ?? '',
    location: row.location ?? '',
    route:    [row.fromPoint, row.toPoint].filter(Boolean).join(' '),
  }
}

/**
 * Scores and annotates a row against the keywords, or rejects it.
 *
 * Returns null when the row does not satisfy the match mode, so the caller can
 * filter and annotate in one pass. Score is only used for the relevance sort:
 * a hit in the activity name is worth more than one buried in a description,
 * an exact substring is worth more than a fuzzy one, and matching more of the
 * keywords is worth more than matching fewer.
 */
function scoreRow(row: ActivityRow, q: ActivityCheckQuery): ActivityRow | null {
  if (q.terms.length === 0) {
    return { ...row, matchedTerms: [], matchedFields: [], snippet: '', score: 0 }
  }

  const texts = fieldText(row)
  const normalised = {} as Record<ActivityField, string>
  for (const f of q.fields) normalised[f] = normalise(texts[f])

  const FIELD_WEIGHT: Record<ActivityField, number> = {
    activity: 10, location: 4, route: 3, details: 2,
  }

  const matchedTerms: string[] = []
  const matchedFields = new Set<ActivityField>()
  let score = 0
  let snippet = ''

  for (const term of q.terms) {
    let hitThisTerm = false
    for (const field of q.fields) {
      const hay = normalised[field]
      if (!hay) continue
      if (!termHits(hay, term, q.fuzzy)) continue

      hitThisTerm = true
      matchedFields.add(field)
      // An exact substring is the strong signal; a fuzzy-only hit scores half.
      const exact = hay.includes(normalise(term))
      score += FIELD_WEIGHT[field] * (exact ? 1 : 0.5)
      if (!snippet) snippet = snippetFor(texts[field], term)
    }
    if (hitThisTerm) matchedTerms.push(term)
  }

  if (q.matchMode === 'all') {
    if (matchedTerms.length !== q.terms.length) return null
  } else if (matchedTerms.length === 0) {
    return null
  }

  score += matchedTerms.length * 5
  return { ...row, matchedTerms, matchedFields: Array.from(matchedFields), snippet, score }
}

export type FetchResult = {
  rows: ActivityRow[]
  /** True when the window held more activities than the cap allowed us to read. */
  truncated: boolean
  /** How many agenda + itinerary records the window held before keyword matching. */
  scanned: number
}

/**
 * The search.
 *
 * The date window and the booking scope are the SQL query; the keywords are
 * applied in memory afterwards. That split is deliberate — it is what allows
 * typo tolerance, per-keyword attribution and snippets, none of which a
 * `LIKE '%…%'` can produce — and the window is what keeps the in-memory half
 * bounded. `scanCap` is the safety net for a two-year window with no keywords.
 */
export async function fetchActivityRows(
  q: ActivityCheckQuery,
  scope: SessionScope,
  opts: { scanCap?: number; rowCap?: number; now?: Date; withCounterparts?: boolean } = {},
): Promise<FetchResult> {
  const { scanCap = 20_000, rowCap = 3_000, now = new Date(), withCounterparts = true } = opts
  const { start, end } = resolveRange(q, now)
  const booking = bookingWhere(q, scope)
  const today = startOfDay(now).getTime()

  const wantAgenda = q.source !== 'ITINERARY'
  const wantItinerary = q.source !== 'AGENDA'

  const agendaPrefilter = keywordPrefilter(q, ['toPoint', 'details', 'location', 'fromPoint'])
  const itineraryPrefilter = keywordPrefilter(q, ['title', 'description'])

  const [agendaItems, itineraryItems] = await Promise.all([
    wantAgenda
      ? prisma.agendaItem.findMany({
          where: {
            AND: [
              { date: { gte: start, lte: end } },
              ...(q.serviceTypes.length ? [{ serviceType: { in: q.serviceTypes as never[] } }] : []),
              ...(q.unassignedOnly ? [{ assignment: null }] : []),
              ...(agendaPrefilter ? [agendaPrefilter as Prisma.AgendaItemWhereInput] : []),
              { agenda: { booking: booking } },
            ],
          },
          select: {
            id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
            mealPlan: true, meetingTime: true, serviceType: true, timeFrom: true, timeTo: true,
            isLeisure: true, isHotelOnly: true,
            assignment: {
              select: {
                driverName: true, driverPhone: true, vehicleType: true, vehiclePlate: true,
                vendorName: true, guideName: true, guidePhone: true,
                tourVendorName: true, tourVendorPhone: true,
              },
            },
            agenda: { select: { booking: { select: BOOKING_SELECT } } },
          },
          orderBy: { date: 'asc' },
          take: scanCap,
        })
      : Promise.resolve([]),
    wantItinerary
      ? prisma.itineraryItem.findMany({
          where: {
            AND: [
              { date: { gte: start, lte: end } },
              ...(itineraryPrefilter ? [itineraryPrefilter as Prisma.ItineraryItemWhereInput] : []),
              { booking: booking },
            ],
          },
          select: {
            id: true, dayNo: true, date: true, title: true, description: true,
            inclusions: true, exclusions: true,
            booking: { select: BOOKING_SELECT },
          },
          orderBy: { date: 'asc' },
          take: scanCap,
        })
      : Promise.resolve([]),
  ])

  const scanned = agendaItems.length + itineraryItems.length
  const truncated = agendaItems.length >= scanCap || itineraryItems.length >= scanCap

  const base = (b: BookingShape, date: Date) => ({
    bookingId: b.id,
    bookingRef: b.bookingRef,
    isNumber: b.isNumber,
    cntlNumber: b.cntlNumber,
    agentBookingId: b.agentBookingId,
    agent: b.agent,
    fileHandler: b.fileHandler,
    operationCountry: b.operationCountry as string | null,
    status: b.status as string,
    cancelled: b.status === 'CANCELLED',
    hotelOnly: b.hotelOnly,
    arrivalDate: b.arrivalDate.toISOString(),
    departureDate: b.departureDate.toISOString(),
    date: date.toISOString(),
    weekday: WEEKDAYS[date.getDay()],
    daysAway: Math.round((startOfDay(date).getTime() - today) / DAY_MS),
    guestName: leadGuest(b),
    guestPhone: b.contactPhone,
    guestEmail: b.contactEmail,
    guestWhatsapp: b.contactWhatsapp,
    paxAdults: b.paxAdults,
    paxChildren: b.paxChildren,
    paxInfants: b.paxInfants,
    totalPax: b.paxAdults + b.paxChildren + b.paxInfants,
    matchedTerms: [] as string[],
    matchedFields: [] as ActivityField[],
    snippet: '',
    score: 0,
    counterpart: null as Counterpart | null,
  })

  const candidates: ActivityRow[] = []

  for (const it of agendaItems) {
    const b = it.agenda.booking
    const a = it.assignment
    candidates.push({
      ...base(b, it.date),
      id: `AGENDA:${it.id}`,
      source: 'AGENDA',
      dayNo: dayNumber(it.date, b.arrivalDate),
      // The Movement Chart's "To / Activity" is where the tour name lives; a
      // pure transfer leaves it empty, so the route stands in as the label.
      activity: (it.toPoint ?? '').trim() || [it.fromPoint, it.location].filter(Boolean).join(' → ') || 'Movement',
      location: it.location,
      fromPoint: it.fromPoint,
      toPoint: it.toPoint,
      details: it.details,
      serviceType: it.serviceType as string,
      serviceTypeLabel: SERVICE_TYPE_LABELS[it.serviceType as string] ?? (it.serviceType as string),
      meetingTime: it.meetingTime,
      timeFrom: it.timeFrom,
      timeTo: it.timeTo,
      mealPlan: it.mealPlan,
      isLeisure: it.isLeisure,
      isHotelOnly: it.isHotelOnly,
      driverName: a?.driverName ?? null,
      driverPhone: a?.driverPhone ?? null,
      vehicleType: a?.vehicleType ?? null,
      vehiclePlate: a?.vehiclePlate ?? null,
      vendorName: a?.vendorName ?? null,
      guideName: a?.guideName ?? null,
      guidePhone: a?.guidePhone ?? null,
      tourVendorName: a?.tourVendorName ?? null,
      tourVendorPhone: a?.tourVendorPhone ?? null,
      assigned: Boolean(a?.driverName || a?.vendorName || a?.tourVendorName),
    })
  }

  for (const it of itineraryItems) {
    const b = it.booking
    // Inclusions and exclusions are part of what was sold, so they are
    // searchable text too — appended rather than given their own field, which
    // would put two more checkboxes on the screen for a rare question.
    const extra = [
      it.inclusions ? `Includes: ${it.inclusions}` : '',
      it.exclusions ? `Excludes: ${it.exclusions}` : '',
    ].filter(Boolean).join('\n')
    candidates.push({
      ...base(b, it.date),
      id: `ITINERARY:${it.id}`,
      source: 'ITINERARY',
      dayNo: it.dayNo,
      activity: it.title.trim() || `Day ${it.dayNo}`,
      location: null,
      fromPoint: null,
      toPoint: null,
      details: [it.description ?? '', extra].filter(Boolean).join('\n') || null,
      serviceType: null,
      serviceTypeLabel: null,
      meetingTime: null,
      timeFrom: null,
      timeTo: null,
      mealPlan: null,
      isLeisure: null,
      isHotelOnly: null,
      driverName: null, driverPhone: null, vehicleType: null, vehiclePlate: null,
      vendorName: null, guideName: null, guidePhone: null,
      tourVendorName: null, tourVendorPhone: null,
      assigned: false,
    })
  }

  let rows = candidates
    .map(r => scoreRow(r, q))
    .filter((r): r is ActivityRow => r !== null)

  rows = sortActivityRows(rows, q).slice(0, rowCap)

  if (withCounterparts && rows.length) await attachCounterparts(rows)

  return { rows, truncated, scanned }
}

/**
 * "Find it in the agenda; if the detail isn't there, take it from the
 * itinerary" — and the reverse.
 *
 * An agenda movement often carries a terse operational note ("7h30 pickup")
 * while the itinerary for the same day carries the paragraph the guest was
 * sold; a file with no agenda built yet has only the itinerary. Rather than
 * make the user open the booking to find out which, each row is paired with
 * the other side's record for the same booking and the same day.
 *
 * One extra query per side for the whole result set, keyed on the booking ids
 * actually in the results.
 */
async function attachCounterparts(rows: ActivityRow[]): Promise<void> {
  const agendaRows = rows.filter(r => r.source === 'AGENDA')
  const itineraryRows = rows.filter(r => r.source === 'ITINERARY')

  const dayKey = (bookingId: string, iso: string) => `${bookingId}|${iso.slice(0, 10)}`

  const needItinerary = Array.from(new Set(agendaRows.map(r => r.bookingId)))
  const needAgenda = Array.from(new Set(itineraryRows.map(r => r.bookingId)))

  const [itineraries, agendas] = await Promise.all([
    needItinerary.length
      ? prisma.itineraryItem.findMany({
          where: { bookingId: { in: needItinerary } },
          select: { bookingId: true, date: true, dayNo: true, title: true, description: true },
        })
      : Promise.resolve([]),
    needAgenda.length
      ? prisma.agendaItem.findMany({
          where: { agenda: { bookingId: { in: needAgenda } } },
          select: {
            date: true, toPoint: true, location: true, details: true, serviceType: true,
            agenda: { select: { bookingId: true } },
          },
        })
      : Promise.resolve([]),
  ])

  const itineraryByDay = new Map<string, Counterpart>()
  for (const i of itineraries) {
    const key = dayKey(i.bookingId, i.date.toISOString())
    // First one wins: a day with two itinerary lines is rare, and the earlier
    // row is the day's headline.
    if (!itineraryByDay.has(key)) {
      itineraryByDay.set(key, {
        source: 'ITINERARY', activity: i.title, details: i.description, dayNo: i.dayNo,
      })
    }
  }

  const agendaByDay = new Map<string, Counterpart>()
  for (const a of agendas) {
    const key = dayKey(a.agenda.bookingId, a.date.toISOString())
    if (!agendaByDay.has(key)) {
      agendaByDay.set(key, {
        source: 'AGENDA',
        activity: (a.toPoint ?? '').trim() || a.location || 'Movement',
        details: a.details,
        dayNo: null,
      })
    }
  }

  for (const row of rows) {
    const key = dayKey(row.bookingId, row.date)
    row.counterpart = row.source === 'AGENDA'
      ? itineraryByDay.get(key) ?? null
      : agendaByDay.get(key) ?? null
  }
}

export function sortActivityRows(rows: ActivityRow[], q: ActivityCheckQuery): ActivityRow[] {
  const dir = q.sortDir === 'desc' ? -1 : 1
  const byDate = (a: ActivityRow, b: ActivityRow) => a.date.localeCompare(b.date)

  const cmp: Record<SortBy, (a: ActivityRow, b: ActivityRow) => number> = {
    date:      byDate,
    booking:   (a, b) => a.bookingRef.localeCompare(b.bookingRef),
    activity:  (a, b) => a.activity.localeCompare(b.activity),
    location:  (a, b) => (a.location ?? '').localeCompare(b.location ?? ''),
    // Relevance is descending by nature — the best match belongs at the top
    // whichever way the direction toggle happens to be pointing.
    relevance: (a, b) => b.score - a.score,
  }

  return [...rows].sort((a, b) => {
    const primary = cmp[q.sortBy](a, b) * (q.sortBy === 'relevance' ? 1 : dir)
    if (primary !== 0) return primary
    // Same day, same booking: keep a file's movements in chronological order.
    return byDate(a, b) || a.bookingRef.localeCompare(b.bookingRef) || (a.dayNo ?? 0) - (b.dayNo ?? 0)
  })
}
