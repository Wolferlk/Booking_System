/**
 * Hotel Only bookings — accommodation, and nothing else.
 *
 * Some files the agent sells are a bed and no more: the guest books their own
 * flights, drives themselves, and buys their own entrance tickets. Operations
 * still owns the hotel — it must be reserved and reconfirmed at D-10 — but every
 * other rung of the normal lifecycle is noise on that file. Chasing a driver for
 * a booking that has no transport, or leaving it red on the ops board because
 * nobody built a movement chart, wastes the desk's attention on the one thing it
 * can never finish.
 *
 * So a Hotel Only booking is an explicit operator decision, recorded on
 * `Booking.hotelOnly`, that **waives** a fixed set of modules. This module is the
 * only place that list lives. Every screen and report that needs to know "does
 * this booking still need X?" asks here, which is what keeps the booking page,
 * the movement chart, the ops board and the daily mail telling one story.
 *
 * Scope, and what it is *not*:
 *  • It is a booking-level flag. The per-movement `isHotelOnly` on an agenda row
 *    and the `hotel_only` vehicle type on a Sri Lanka allocation are older,
 *    narrower signals about transport only — see `driver-requirement.ts`. Both
 *    still work; this flag simply implies them for the whole file.
 *  • It never touches accommodation or hotel reconfirmation. That is the entire
 *    content of the booking, so the D-10 Pre-checking queue keeps every one of
 *    these stays. Waiving the hotel would defeat the point.
 *  • It is not a status. The booking still walks its lifecycle and can still be
 *    cancelled, amended and completed; the flag only changes what is *required*
 *    along the way.
 *
 * Pure and Prisma-free on purpose — server queries, API routes and client
 * components all import it.
 */

/** Badge text, kept in one place so no screen invents its own wording. */
export const HOTEL_ONLY_LABEL = 'Hotel Only'
export const HOTEL_ONLY_SHORT = 'HO'

/** The parts of the lifecycle a Hotel Only booking does not have to clear. */
export type HotelOnlyModule =
  | 'itinerary'
  | 'agenda'
  | 'drivers'
  | 'tickets'
  | 'flights'
  | 'clientReconfirm'
  | 'qc'

export interface WaivedModule {
  key: HotelOnlyModule
  /** Sentence-case name, as an operator would say it. */
  label: string
  /** One line of why it does not apply — shown in the confirm dialog. */
  why: string
  /** Emoji marker; the confirm dialog and the checklist both use it. */
  icon: string
}

/**
 * Everything Hotel Only switches off, in the order operations meets it.
 *
 * The confirmation dialog renders this list verbatim, so an operator setting the
 * flag sees exactly what they are turning off before they commit — nothing here
 * is hidden behind a one-word toggle.
 */
export const HOTEL_ONLY_WAIVED: WaivedModule[] = [
  { key: 'itinerary',       label: 'Itinerary',             icon: '🗺️', why: 'No day-by-day plan — the guest fills their own days' },
  { key: 'agenda',          label: 'Tour agenda',           icon: '📋', why: 'No movement chart is built for this file' },
  { key: 'drivers',         label: 'Drivers & allocation',  icon: '🚗', why: 'No transport is sold, so nothing to allocate' },
  { key: 'tickets',         label: 'Tickets',               icon: '🎫', why: 'No excursions or entrances to issue' },
  { key: 'flights',         label: 'Flights',               icon: '✈️', why: 'The guest arranges their own travel' },
  { key: 'clientReconfirm', label: 'Client reconfirmation', icon: '📞', why: 'No pre-tour call — there is no tour to run through' },
  { key: 'qc',              label: 'QC1 / QC2',             icon: '🛡️', why: 'The QC rounds check an operation this file does not have' },
]

const WAIVED_KEYS = new Set<HotelOnlyModule>(HOTEL_ONLY_WAIVED.map(m => m.key))

/**
 * Anything carrying the flag. Deliberately loose — API payloads, Prisma rows and
 * the `any`-typed booking object on the detail page all satisfy it.
 */
export interface HotelOnlyCandidate {
  hotelOnly?: boolean | null
}

/**
 * Is this booking Hotel Only?
 *
 * Explicit only. Unlike leisure days there is no text heuristic to fall back on:
 * a file with no agenda yet is not Hotel Only, it is unstarted, and guessing
 * would silently waive QC on every booking the moment it was created.
 */
export function isHotelOnlyBooking(b: HotelOnlyCandidate | null | undefined): boolean {
  return b?.hotelOnly === true
}

/** Does Hotel Only waive `module` on this booking? */
export function waives(
  b: HotelOnlyCandidate | null | undefined,
  module: HotelOnlyModule,
): boolean {
  return isHotelOnlyBooking(b) && WAIVED_KEYS.has(module)
}

/**
 * What a waived check reads as on a board or in a report — one wording for every
 * surface, so "Hotel only" never appears as three different phrases.
 */
export const HOTEL_ONLY_NA = {
  short: HOTEL_ONLY_LABEL,
  detail: 'Hotel only booking — accommodation only, so this check does not apply',
} as const

/** Tailwind classes for the badge. Amber: informational, not a warning. */
export const HOTEL_ONLY_BADGE_CLASS =
  'bg-amber-50 text-amber-800 border-amber-300'

/**
 * The audit note written to `StatusEvent` when the flag is toggled. Kept here so
 * the API route and anything that later reads the trail agree on the prefix.
 */
export function hotelOnlyAuditNote(on: boolean, reason?: string | null): string {
  const head = on
    ? 'Marked as Hotel Only booking — itinerary, agenda, drivers, tickets, flights, client reconfirmation and QC waived'
    : 'Hotel Only removed — the full operational checklist applies again'
  const tail = reason?.trim() ? ` · ${reason.trim()}` : ''
  return `${head}${tail}`
}
