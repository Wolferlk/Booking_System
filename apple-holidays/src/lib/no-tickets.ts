/**
 * "No Tickets" bookings — files that sell no tickets at all.
 *
 * A great many tours are pure transfers: no attractions, no entrances, no
 * vouchers to buy. Their tickets page is empty on day one and stays empty, and
 * every checklist that looked at it had to guess what that emptiness meant.
 * QC guessed "N/A" — a grey dash that reads exactly like *nobody has got to it
 * yet*, so the ticket rung could never be shown as finished and the file kept
 * looking half-done to anyone scanning it.
 *
 * This flag turns that emptiness into a decision somebody made. Recorded on
 * `Booking.noTickets` from the tickets page, it says: this booking has no
 * tickets, on purpose, and Ticket Activation is therefore **done**.
 *
 * What it is not:
 *  • It is not Hotel Only (`hotel-only.ts`). That waives seven modules across
 *    the whole file; this touches tickets and nothing else. A Hotel Only
 *    booking already waives tickets, so the two never need to be combined.
 *  • It is not a status. The booking walks its normal lifecycle; the flag only
 *    changes what the ticket check *reports*.
 *  • It is not permanent. Adding a ticket to a booking marked No Tickets
 *    contradicts the decision, so the flag is cleared when that happens and
 *    the normal purchase rules apply again.
 *
 * Pure and Prisma-free — the API route, the tickets page, the QC panel and the
 * readiness report all import it, so the wording exists once.
 */

/** Badge text, kept in one place so no screen invents its own wording. */
export const NO_TICKETS_LABEL = 'No Tickets'

/** Anything carrying the flag — API payloads, Prisma rows, `any`-typed bookings. */
export interface NoTicketsCandidate {
  noTickets?: boolean | null
}

/** Has this booking been marked as selling no tickets? Explicit only. */
export function isNoTicketsBooking(b: NoTicketsCandidate | null | undefined): boolean {
  return b?.noTickets === true
}

/**
 * What the ticket check reads as once the mark is on — one sentence for every
 * surface, so QC, the ops board and the daily mail never phrase it three ways.
 */
export const NO_TICKETS_DONE = {
  short: 'No tickets',
  label: 'Ticket Activation done',
  detail: 'Ticket Activation done (No tickets added to this booking)',
} as const

/** The audit note written to `StatusEvent` when the mark is toggled. */
export function noTicketsAuditNote(on: boolean, reason?: string | null): string {
  const head = on
    ? 'Marked as No Tickets — this booking sells no tickets, so Ticket Activation counts as done'
    : 'No Tickets removed — tickets are required on this booking again'
  const tail = reason?.trim() ? ` · ${reason.trim()}` : ''
  return `${head}${tail}`
}
