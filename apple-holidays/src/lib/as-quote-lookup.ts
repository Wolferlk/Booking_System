/**
 * Resolve a local booking ref / IS number back to its AppleSystem quote.
 *
 * Our `bookingRef` is stored compact and upper-cased ("VN40801", see
 * `normalizeIsNumber`), but AppleSystem's `/api/quotation/list` filter only
 * matches its own spaced form ("VN 40801") — searching "VN40801" or "40801"
 * returns zero rows. So we widen the ref into candidate spellings and try them
 * in turn, which is what lets a booking that was imported months ago be looked
 * up again from nothing but its ref.
 *
 * Shared by the "Refetch from AppleSystem" and "Raw API response" endpoints so
 * both resolve identically.
 */

import {
  searchBookings,
  getQuoteTemplate,
  type ASBookingListItem,
  type ASQuoteTemplate,
} from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'

export class ASLookupError extends Error {}

/**
 * Candidate spellings of an IS number, most-likely first.
 * "VN40801" → ["VN 40801", "VN40801", "40801"]
 */
export function isNumberVariants(ref: string): string[] {
  const raw = ref.trim()
  const compact = normalizeIsNumber(raw)
  const m = compact.match(/^([A-Z]+)\s*(\d+)$/)
  const out = [
    m ? `${m[1]} ${m[2]}` : null, // AppleSystem's own spelling
    compact,
    m ? m[2] : null,              // digits only, last resort
    raw,
  ]
  return Array.from(new Set(out.filter((v): v is string => !!v && v.toUpperCase() !== 'NA')))
}

/** The row's IS number, normalised for comparison against a local bookingRef. */
function refOf(it: ASBookingListItem): string | null {
  const own = (it.is_number ?? '').trim()
  const raw = own && own.toUpperCase() !== 'NA'
    ? own
    : it.reference_id_full?.find((r) => /^(IS|VN|SG|MY)/i.test(r))
  return raw ? normalizeIsNumber(raw) : null
}

/**
 * Find the AppleSystem list row for a booking ref. Prefers an exact IS match,
 * then a confirmed row (status "2"), then whatever came back first.
 */
export async function findQuoteRow(ref: string): Promise<ASBookingListItem | null> {
  const wanted = normalizeIsNumber(ref)

  for (const variant of isNumberVariants(ref)) {
    const { items } = await searchBookings({ isNumber: variant, statuses: [] })
    if (!items.length) continue
    return (
      items.find((it) => refOf(it) === wanted) ??
      items.find((it) => String(it.status) === '2') ??
      items[0]
    )
  }
  return null
}

export interface QuoteLookupResult {
  row: ASBookingListItem
  quote: ASQuoteTemplate
}

/**
 * Fetch the composed quote template for a booking ref.
 *
 * `reference_id` must be the list row's **`id`**, not its `reference_id` field
 * (which mirrors the quotation number) — passing the latter still returns 200,
 * but with a stub payload whose `is_number` is "NA".
 */
export async function fetchQuoteForRef(ref: string): Promise<QuoteLookupResult> {
  const row = await findQuoteRow(ref)
  if (!row) throw new ASLookupError(`No AppleSystem quotation found for ${ref}.`)

  const quote = await getQuoteTemplate(row.quotation_no, String(row.id ?? row.reference_id))
  return { row, quote }
}
