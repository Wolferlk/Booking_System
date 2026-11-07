/**
 * Ticket pack — which bookings go out on a given day. Pure: the server loads
 * the bookings and what was already sent, this decides. Three reasons to send:
 *
 *   DUE     arrival is exactly D-n from the send day
 *   LATE    arrives sooner than that and was never sent: the booking came in
 *           late, or was held back until its tickets were ready
 *   UPDATE  already sent, and a ticket has become downloadable since
 */
import { addDays, fmtShort, type DigestBlockResult, type DigestBooking, type DigestConfig, type DigestPayload } from './shared'
import type { TicketPackConfig } from './tickets-config'

/** What earlier sends of this rule delivered: booking ref → ticket ids that were ready. */
export type PriorSends = Map<string, Set<string>>

export interface PackBooking {
  view: DigestBooking
  /** Marked "No Tickets" or Hotel Only: nothing to send, on purpose. */
  waived: boolean
}

export const readyTickets = (b: DigestBooking) => (b.tickets ?? []).filter(t => t.files.length > 0)

export function passesHold(pack: TicketPackConfig, b: DigestBooking): boolean {
  const total = b.tickets?.length ?? 0
  const ready = readyTickets(b).length
  if (pack.hold === 'ANY_READY') return ready > 0
  if (pack.hold === 'ALL_READY') return total > 0 && ready === total
  return true
}

export interface PackSelection { due: DigestBooking[]; late: DigestBooking[]; update: DigestBooking[]; held: DigestBooking[] }

/** `prior` is null when there is no saved rule (a test or a new design): no history, so D-n only. */
export function selectPackBookings(bookings: PackBooking[], runDate: string, pack: TicketPackConfig, prior: PriorSends | null): PackSelection {
  const dueDate = addDays(runDate, pack.daysBefore)
  const out: PackSelection = { due: [], late: [], update: [], held: [] }
  for (const { view: b, waived } of bookings) {
    if (waived || b.arrival < runDate || b.arrival > dueDate) continue
    if (!b.tickets?.length && !pack.includeEmpty) continue
    const isDue = b.arrival === dueDate
    const before = prior?.get(b.ref)

    if (before && !isDue) {
      if (!pack.followUps) continue
      const fresh = readyTickets(b).filter(t => !before.has(t.id))
      if (fresh.length) {
        const ids = new Set(fresh.map(t => t.id))
        out.update.push({ ...b, reason: 'UPDATE', tickets: b.tickets!.map(t => (ids.has(t.id) ? { ...t, isNew: true } : t)) })
      }
      continue
    }
    if (!isDue && !(prior && pack.catchUp)) continue
    if (!passesHold(pack, b)) { out.held.push(b); continue }
    if (isDue) out.due.push({ ...b, reason: 'DUE' })
    else out.late.push({ ...b, reason: 'LATE' })
  }
  return out
}

const byArrival = (a: DigestBooking, b: DigestBooking) => a.arrival.localeCompare(b.arrival) || a.tripNo.localeCompare(b.tripNo)

export function countPack(blocks: DigestBlockResult[]) {
  const refs = new Set<string>()
  let tickets = 0, ready = 0, files = 0
  for (const blk of blocks) for (const b of blk.bookings) {
    refs.add(b.ref)
    tickets += b.tickets?.length ?? 0
    ready += readyTickets(b).length
    files += (b.tickets ?? []).reduce((n, t) => n + t.files.length, 0)
  }
  return { bookings: refs.size, tickets, ready, files }
}

export function packPayload(sel: PackSelection, config: DigestConfig, runDate: string, ruleName: string, agentLabel: string): DigestPayload {
  const pack = config.ticketPack
  const dueDate = addDays(runDate, pack.daysBefore)
  const block = (id: string, label: string, date: string, bookings: DigestBooking[]): DigestBlockResult =>
    ({ id, label, basis: 'ARRIVAL', scope: 'TOUR', date, bookings: [...bookings].sort(byArrival) })
  const blocks = [
    block('due', `Arriving ${fmtShort(dueDate)}`, dueDate, sel.due),
    block('late', 'Arriving soon', runDate, sel.late),
    block('update', 'New tickets ready', runDate, sel.update),
  ].filter(b => b.bookings.length)
  const n = countPack(blocks)
  return {
    kind: 'TICKETS', ruleName, runDate, agentLabel, countries: config.countries, generatedAt: new Date().toISOString(), blocks,
    totals: { bookings: n.bookings, lines: n.tickets, missing: n.tickets - n.ready },
    pack: {
      dueDate, daysBefore: pack.daysBefore, ready: n.ready, files: n.files,
      held: sel.held.map(b => ({ ref: b.ref, lead: b.lead, arrival: b.arrival, ready: readyTickets(b).length, tickets: b.tickets?.length ?? 0 })),
    },
  }
}

/** Last departure in the pack plus the configured days: when the link stops working. */
export function packLinkExpiry(p: DigestPayload, pack: TicketPackConfig): string {
  const last = p.blocks.flatMap(b => b.bookings.map(x => x.departure)).sort().pop() ?? p.runDate
  return addDays(last, pack.linkDaysAfterTrip)
}
