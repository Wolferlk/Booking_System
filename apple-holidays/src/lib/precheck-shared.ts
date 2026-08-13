/**
 * Pre-checking — shared shapes and pure D-10 logic.
 *
 * Split out from `hotel-precheck.ts` because the browser needs these: the
 * queue page, the stay card and the booking panel all render `PrecheckStay`
 * and count days against the deadline. `hotel-precheck.ts` imports Prisma, and
 * a single value import from it (not just a type) drags the database client
 * into the client bundle and breaks the build.
 *
 * Everything here is pure — no Prisma, no I/O, no server-only APIs — so it is
 * safe to import from either side. `hotel-precheck.ts` re-exports all of it,
 * so server code has one import to reach for.
 */
import type { ContactHealth } from './hotel-contact'
import { normalizeHotelName } from './hotel-match'

/** Days before check-in that a stay enters the reconfirmation queue. */
export const RECONFIRM_LEAD_DAYS = 10
/** How far past the due date a stay stays visible before it is just history. */
export const OVERDUE_GRACE_DAYS = 30

const DAY_MS = 86_400_000

/** Midnight UTC of a date — all D-10 arithmetic is whole days, never hours. */
export function startOfUtcDay(d: Date | string): Date {
  const dt = typeof d === 'string' ? new Date(d) : d
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
}

/** Whole days from `from` to `to`, positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS)
}

/** yyyy-mm-dd in UTC. */
export function utcDateKey(d: Date | string): string {
  return startOfUtcDay(d).toISOString().slice(0, 10)
}

/**
 * Stable identity for a hotel stay.
 *
 * Amendments delete and re-create every `accommodations` row, so the row id is
 * useless as a long-lived key. Booking ref + normalised hotel + check-in day
 * survives re-extraction, and the three together are unique in practice: the
 * same guest does not check into the same hotel twice on one day.
 */
export function buildStayKey(bookingRef: string, hotel: string, checkIn: Date | string): string {
  return `${bookingRef.trim().toUpperCase()}::${normalizeHotelName(hotel)}::${utcDateKey(checkIn)}`
}

export type Urgency = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'UPCOMING' | 'SETTLED' | 'PAST'

/** Statuses that mean nobody needs to chase this stay any more. */
const SETTLED_STATUSES = new Set(['CONFIRMED', 'CANCELLED', 'NOT_REQUIRED'])

export interface UrgencyInfo {
  urgency: Urgency
  /** Days until check-in (negative once the guest has arrived). */
  daysToCheckIn: number
  /** Days until the D-10 due date (negative = overdue). */
  daysToDue: number
  dueAt: Date
  /** True when the stay is inside the D-10 action window and unresolved. */
  actionable: boolean
}

/**
 * Classify one stay against today.
 *
 * `dueAtOverride` exists because some properties demand reconfirmation earlier
 * than D-10 (or a chain handles it centrally at D-21); when set it replaces the
 * computed date entirely rather than shifting it.
 */
export function classifyStay(
  checkIn: Date,
  status: string,
  now: Date = new Date(),
  dueAtOverride?: Date | null,
): UrgencyInfo {
  const dueAt = dueAtOverride
    ? startOfUtcDay(dueAtOverride)
    : new Date(startOfUtcDay(checkIn).getTime() - RECONFIRM_LEAD_DAYS * DAY_MS)

  const daysToCheckIn = daysBetween(now, checkIn)
  const daysToDue = daysBetween(now, dueAt)

  if (SETTLED_STATUSES.has(status)) {
    return { urgency: 'SETTLED', daysToCheckIn, daysToDue, dueAt, actionable: false }
  }
  if (daysToCheckIn < 0) {
    return { urgency: 'PAST', daysToCheckIn, daysToDue, dueAt, actionable: false }
  }
  if (daysToDue < 0)  return { urgency: 'OVERDUE',   daysToCheckIn, daysToDue, dueAt, actionable: true }
  if (daysToDue === 0) return { urgency: 'DUE_TODAY', daysToCheckIn, daysToDue, dueAt, actionable: true }
  if (daysToDue <= 3)  return { urgency: 'DUE_SOON',  daysToCheckIn, daysToDue, dueAt, actionable: true }
  return { urgency: 'UPCOMING', daysToCheckIn, daysToDue, dueAt, actionable: false }
}

// ─── Queue row shape ─────────────────────────────────────────────────────────

export interface PrecheckHotel {
  id: string
  name: string
  accountsHotelId: number | null
  accountsHotelName: string | null
  city: string | null
  countryCode: string
  phone: string | null
  email: string | null
  whatsapp: string | null
  whatsappVerified: boolean
  website: string | null
  address: string | null
  googleMapsUrl: string | null
  source: string
  notes: string | null
  aiResearchedAt: string | null
  verifiedAt: string | null
  channels: Array<{
    id: string
    kind: string
    label: string | null
    value: string
    e164: string | null
    isPrimary: boolean
    verified: boolean
    guessed: boolean
    notes: string | null
  }>
  health: ContactHealth
}

export interface PrecheckStay {
  stayKey: string
  /** Null until the row has been materialised. */
  reconfirmId: string | null

  bookingRef: string
  isNumber: string | null
  agent: string | null
  leadGuest: string | null
  operationCountry: string | null
  countryCode: string
  bookingStatus: string
  arrivalDate: string
  departureDate: string

  accommodationId: string | null
  hotelName: string
  city: string | null
  ownArrangement: boolean
  /** Contact string carried on the accommodation row itself. */
  bookingContact: string | null

  checkIn: string
  checkOut: string
  nights: number
  roomType: string | null
  roomCategory: string | null
  roomCount: number | null
  mealType: string | null
  adults: number | null
  children: number | null
  cwb: number | null
  cnb: number | null
  infants: number | null

  status: string
  confirmationNumber: string | null
  lastChannel: string | null
  attempts: number
  lastCheckedAt: string | null
  lastCheckedBy: string | null
  followUpAt: string | null
  discrepancyNote: string | null
  notes: string | null

  dueAt: string
  dueAtOverride: string | null
  urgency: Urgency
  daysToCheckIn: number
  daysToDue: number
  actionable: boolean

  hotel: PrecheckHotel | null
  /** True when no hotel profile is linked yet — the "needs matching" state. */
  unmatched: boolean
  /** True when we hold no way at all to reach the property. */
  noContact: boolean
}

export interface QueueStats {
  total: number
  overdue: number
  dueToday: number
  dueSoon: number
  upcoming: number
  confirmed: number
  issues: number
  unmatched: number
  noContact: number
  /** Share of actionable stays already confirmed, 0–100. */
  completion: number
  /** Own-arrangement stays — checking them is optional, so they sit outside the progress. */
  optional: number
  /** Stays we actually have to reconfirm (everything that is not own arrangement). */
  required: number
  /** Required stays already settled — confirmed, or explicitly marked not required. */
  requiredDone: number
}

/** Headline counts for the queue's KPI strip. */
export function summarizeQueue(rows: PrecheckStay[]): QueueStats {
  const s: QueueStats = {
    total: rows.length, overdue: 0, dueToday: 0, dueSoon: 0, upcoming: 0,
    confirmed: 0, issues: 0, unmatched: 0, noContact: 0, completion: 0,
    optional: 0, required: 0, requiredDone: 0,
  }
  for (const r of rows) {
    // Own arrangement: the guest booked it, so nothing is owed to us or by us.
    // It is counted separately and left out of every "needs work" number —
    // an operator may still check it, but the booking is complete without it.
    if (r.ownArrangement) {
      s.optional++
      continue
    }

    s.required++
    if (r.urgency === 'OVERDUE') s.overdue++
    else if (r.urgency === 'DUE_TODAY') s.dueToday++
    else if (r.urgency === 'DUE_SOON') s.dueSoon++
    else if (r.urgency === 'UPCOMING') s.upcoming++

    if (r.status === 'CONFIRMED') s.confirmed++
    if (r.status === 'CONFIRMED' || r.status === 'NOT_REQUIRED') s.requiredDone++
    if (r.status === 'ISSUE' || r.status === 'DISCREPANCY') s.issues++
    if (r.unmatched) s.unmatched++
    if (r.noContact) s.noContact++
  }
  // Completion is still measured over the action window only (a stay two months
  // out is not "outstanding"), but a queue holding nothing but own arrangements
  // reads as done rather than as 0%.
  const inWindow = s.overdue + s.dueToday + s.dueSoon + s.confirmed
  s.completion = inWindow === 0
    ? (s.required === 0 ? 100 : 0)
    : Math.round((s.confirmed / inWindow) * 100)
  return s
}

