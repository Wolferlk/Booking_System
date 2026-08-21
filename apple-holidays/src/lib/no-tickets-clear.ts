/**
 * Server-side counterpart to `no-tickets.ts` — kept separate because that module
 * is Prisma-free on purpose (client components import it).
 *
 * The moment a ticket lands on a booking, "this booking has no tickets" has
 * stopped being true. Rather than leave the two contradicting each other — QC
 * reporting Ticket Activation done over a draft nobody has bought — the mark is
 * dropped and the normal purchase rules apply again.
 */
import { prisma } from '@/lib/prisma'

/** Drop the No Tickets mark, if it is on. Never throws — creating the ticket matters more. */
export async function clearNoTicketsMark(bookingId: string): Promise<void> {
  await prisma.booking.updateMany({
    where: { id: bookingId, noTickets: true },
    data:  { noTickets: false, noTicketsAt: null, noTicketsBy: null, noTicketsNote: null },
  }).catch(() => { /* best-effort */ })
}
