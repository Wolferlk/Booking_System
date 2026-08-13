/**
 * Own-arrangement detection for hotel stays.
 *
 * A stay is "own arrangement" when the guest or the agent booked the property
 * themselves — Apple Holidays holds no reservation with it, so there is nothing
 * for us to reconfirm at D-10. Pre-checking such a stay is allowed (an operator
 * may still want to ring the hotel) but never required, and it never counts
 * against the booking's reconfirmation progress.
 *
 * The `accommodations.ownArrangement` column is authoritative when it is set,
 * but a lot of stays predate it or arrive through TC extraction, where the
 * signal only exists as text. The heuristic below reads those text fields —
 * it is the same rule the booking detail page has always used for its
 * "Own Arrangement" badge, lifted here so the badge, the queue and the
 * reconfirmation write path cannot disagree.
 *
 * Pure — no Prisma, no I/O — so both server and browser can import it.
 */

/** Hotel names that mean "no property chosen yet", i.e. nothing to reconfirm. */
const PLACEHOLDER_HOTELS = new Set([
  'tba', 'tbc', 'n/a', 'na', 'to be advised', 'to be confirmed', '-',
])

const OWN_ARRANGEMENT_TEXT =
  /own\s*arrangement|self[\s-]*book|guest\s*arrang|by\s*guest|not\s*included|own\s*acc/

export interface OwnArrangementInput {
  ownArrangement?: boolean | null
  hotel?: string | null
  roomType?: string | null
  mealType?: string | null
  address?: string | null
  contact?: string | null
}

/**
 * True when the stay is the customer's own arrangement.
 *
 * Accepts a loose record so callers can pass a Prisma row, an API payload or an
 * unknown-keyed object from a page's state without casting each field.
 */
export function isOwnArrangement(a: OwnArrangementInput | Record<string, unknown>): boolean {
  const r = a as Record<string, unknown>
  if (r.ownArrangement === true) return true

  const hay = [r.hotel, r.roomType, r.mealType, r.address, r.contact]
    .map(v => String(v ?? '').toLowerCase())
    .join(' | ')
  if (OWN_ARRANGEMENT_TEXT.test(hay)) return true

  const hotel = String(r.hotel ?? '').trim().toLowerCase()
  return !hotel || PLACEHOLDER_HOTELS.has(hotel)
}
