/**
 * Sales channel of a booking: B2B (agent quotations via email / OneDrive /
 * AppleSystem) vs B2C (the Aahaas storefront).
 *
 * This is derived from `Booking.agent` rather than stored in a dedicated column.
 * The B2C importer stamps every order it creates with `agent = 'Aahaas B2C'`, so
 * the field already identifies the channel unambiguously — and keying off it means
 * the whole feature ships with **no schema change** to the live ops database,
 * which carries drift and real booking data.
 *
 * Deliberately dependency-free so both server routes and client components can
 * import it.
 */

/** The exact `agent` value the B2C importer writes. The channel marker. */
export const B2C_AGENT_NAME = 'Aahaas B2C'

export type BookingSource = 'B2B' | 'B2C'

/** True when a booking came from the Aahaas storefront. */
export function isB2cBooking(agent: string | null | undefined): boolean {
  return (agent ?? '').trim() === B2C_AGENT_NAME
}

export function bookingSourceOf(agent: string | null | undefined): BookingSource {
  return isB2cBooking(agent) ? 'B2C' : 'B2B'
}

/**
 * Prisma `where` fragment for a source filter, or null when no filter applies.
 * Returned as a fragment so callers can push it onto their existing
 * `andClauses` array alongside country scoping and status filters.
 */
export function bookingSourceWhere(source: string | null | undefined): Record<string, unknown> | null {
  if (source === 'B2C') return { agent: B2C_AGENT_NAME }
  if (source === 'B2B') return { OR: [{ agent: { not: B2C_AGENT_NAME } }, { agent: null }] }
  return null
}
