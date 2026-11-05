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

/** Our own mailboxes (admin@it.aahaas.com, …) — never the guest's address. */
export function isStaffEmail(email: string): boolean {
  return /@([a-z0-9-]+\.)*aahaas\.com$/i.test(email.trim())
}

/**
 * The customer email to show for a booking. A B2C booking imported from the
 * shared desk login can still hold the desk's own inbox; printing that as the
 * customer's address is wrong, so it is hidden until the guest's is known.
 */
export function customerEmailForDisplay(agent: string | null | undefined, email: string | null | undefined): string | null {
  const v = email?.trim()
  if (!v) return null
  return isB2cBooking(agent) && isStaffEmail(v) ? null : v
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

/** The `StatusEvent.note` prefix the B2C importer writes on the DRAFT event. */
export const B2C_IMPORT_NOTE_PREFIX = 'Imported from Aahaas B2C'

/** `PNL.isPnlData.channel` stamped by the B2C importer. */
export const B2C_PNL_CHANNEL = 'AAHAAS_B2C'

/**
 * Did this booking come from the Aahaas storefront, judged on every marker the
 * importer leaves rather than `agent` alone?
 *
 * `agent` is editable on the booking page, and an AppleSystem sync used to be
 * able to overwrite it, so a B2C order can end up carrying an agency's name.
 * The importer also stamps the P&L source (`isPnlData.channel`) and writes an
 * append-only DRAFT status note — either of those still identifies it. Use this
 * wherever the answer decides which upstream a booking may be refreshed from.
 */
export function isB2cOrigin(input: {
  agent: string | null | undefined
  pnlData?: unknown
  statusNotes?: (string | null | undefined)[]
}): boolean {
  if (isB2cBooking(input.agent)) return true
  const data = input.pnlData
  if (data && typeof data === 'object' && (data as Record<string, unknown>).channel === B2C_PNL_CHANNEL) {
    return true
  }
  return (input.statusNotes ?? []).some((n) => (n ?? '').startsWith(B2C_IMPORT_NOTE_PREFIX))
}
