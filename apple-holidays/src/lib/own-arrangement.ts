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

/**
 * Wording that means "the guest holds this reservation, not us".
 *
 * TCs say this a dozen ways, and the list grew from the ones that were coming
 * through as *company* arranged — `self arranged`, `own basis`, `booked by the
 * client`, `direct booking`, a bare `OWN`. Each alternative tolerates a hyphen,
 * a plural or an extra article ("booked by the guest") while staying tight
 * enough not to swallow a hotel that merely has the word in its name
 * ("Guest House Hanoi" is a property, not an arrangement).
 */
const OWN_ARRANGEMENT_TEXT = new RegExp([
  'own\\s*arrangement',                            // own arrangement / arrangements
  'own[\\s-]*arrang',                              // own arranged / own-arranging
  'self[\\s-]*(book|arrang|made|organis|organiz)', // self-booked / self arranged
  '(guest|client|customer|traveller|traveler|pax)[\\s-]*(own|arrang|book)',
  'book(ed|ing)?\\s*by\\s*(the\\s*)?(guest|client|customer|traveller|traveler|pax)',
  'own\\s*(acc|hotel|stay|basis|booking|expense|cost|account)',
  'direct[\\s-]*book',                             // guest booked direct with the hotel
].join('|'), 'i')

/**
 * "Not ours" said about the stay itself.
 *
 * Only tested against the hotel and room fields. It deliberately never reads
 * `mealType`: a company-arranged hotel routinely carries "Not included" there,
 * meaning breakfast is not in the package — which says nothing at all about who
 * booked the room, and used to flip the whole stay to own-arrangement.
 */
const NOT_OURS_TEXT = /not\s*(included|booked|provided|arranged)|^\s*own\s*$/i

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

  const field = (k: string) => String(r[k] ?? '').toLowerCase()

  // Explicitly false is the extractor saying "we hold this reservation", so the
  // text heuristics below — which exist only for rows that predate the column or
  // arrived without it — are not consulted. The placeholder-hotel rule at the
  // end still applies: a stay with no property named has nothing to reconfirm
  // whoever booked it.
  if (r.ownArrangement !== false) {
    const fields = ['hotel', 'roomType', 'mealType', 'address', 'contact'].map(field)
    if (fields.some(v => OWN_ARRANGEMENT_TEXT.test(v))) return true

    // "Not included" / a bare "OWN" only counts when said about the property or
    // the room — see NOT_OURS_TEXT.
    if ([field('hotel'), field('roomType')].some(v => NOT_OURS_TEXT.test(v))) return true
  }

  const hotel = String(r.hotel ?? '').trim().toLowerCase()
  return !hotel || PLACEHOLDER_HOTELS.has(hotel)
}
