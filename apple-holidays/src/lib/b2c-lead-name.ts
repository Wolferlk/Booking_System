/**
 * Lead-traveller names for Aahaas B2C bookings.
 *
 * Bookings imported before checkout travellers were read carry the store
 * *account* name as their lead passenger ("admin6611"), while AahaasFlow shows
 * the real traveller ("Rithika Annadurai"). The importer never revisits an
 * existing booking, so {@link repairB2cLeadName} corrects those in place.
 *
 * It only ever touches a passenger name that is provably the importer's own
 * fallback — the lead's name must still equal the store account name. Anything
 * ops has typed since then is left exactly as it is.
 */
import { prisma } from './prisma'
import { fetchOrderLineTravellers, fetchPassengerDetails } from './b2c-db'
import type { B2cOrderLineTravellers, B2cPassengerDetail } from './b2c-db'
import { collectPassengerIds, resolveOrderTravellers } from './b2c-travellers'
import type { OrderTravellers } from './b2c-travellers'
import { isB2cBooking } from './booking-source'
import { passengerNameKey } from './passenger-note-key'
import { isPassengerNotesMissing } from './passenger-notes'
import { ACTION, logActivity } from './activity'

/**
 * Travellers for each order, from the live store (read-only). Returns an error
 * string instead of throwing so a broken lookup degrades to the account name
 * rather than failing the whole import.
 */
export async function loadOrderTravellers(
  orderIds: number[],
): Promise<{ byOrder: Map<number, OrderTravellers>; error: string | null }> {
  const byOrder = new Map<number, OrderTravellers>()
  try {
    const lines = await fetchOrderLineTravellers(orderIds)
    const passengers = await fetchPassengerDetails(collectPassengerIds(lines))
    const passengersById = new Map<number, B2cPassengerDetail>(passengers.map((p) => [Number(p.id), p]))

    const linesByOrder = new Map<number, B2cOrderLineTravellers[]>()
    for (const l of lines) {
      const id = Number(l.order_id)
      const list = linesByOrder.get(id)
      if (list) list.push(l)
      else linesByOrder.set(id, [l])
    }
    linesByOrder.forEach((orderLines, orderId) => {
      byOrder.set(orderId, resolveOrderTravellers(orderLines, passengersById))
    })
    return { byOrder, error: null }
  } catch (err) {
    return { byOrder, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface LeadNameRepair {
  bookingRef: string
  status: 'renamed' | 'would-rename' | 'unchanged'
  from?: string
  to?: string
  reason?: string
}

/**
 * Replace a B2C booking's lead passenger name when — and only when — it is
 * still the store account name the importer fell back to.
 *
 * With `apply: false` nothing is written; the result says what would change.
 */
export async function repairB2cLeadName(params: {
  bookingRef: string
  /** The traveller name the importer would now choose. */
  newName: string | null
  /** Where `newName` came from — only real traveller sources may overwrite. */
  via: string
  /** The store account name, i.e. what the old importer wrote. */
  accountName: string | null
  apply: boolean
  actorId: string
}): Promise<LeadNameRepair> {
  const { bookingRef, newName, via, accountName, apply, actorId } = params
  const unchanged = (reason: string): LeadNameRepair => ({ bookingRef, status: 'unchanged', reason })

  if (!newName || (via !== 'checkout-travellers' && via !== 'flight-manifest')) {
    return unchanged('store has no traveller name for this order')
  }
  const accountKey = accountName ? passengerNameKey(accountName) : ''
  if (!accountKey) return unchanged('store account has no name to compare against')

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { id: true, agent: true, passengers: { where: { isLead: true }, select: { id: true, name: true } } },
  })
  if (!booking || !isB2cBooking(booking.agent)) return unchanged('not an Aahaas B2C booking')
  if (booking.passengers.length !== 1) return unchanged(`expected one lead passenger, found ${booking.passengers.length}`)

  const lead = booking.passengers[0]
  const leadKey = passengerNameKey(lead.name)
  if (leadKey === passengerNameKey(newName)) return unchanged('already the traveller name')
  if (leadKey !== accountKey) return unchanged('lead name was changed in ops — left as is')

  if (!apply) return { bookingRef, status: 'would-rename', from: lead.name, to: newName }

  // Conditional on the old value so an edit made in the meantime always wins.
  const { count } = await prisma.passenger.updateMany({
    where: { id: lead.id, name: lead.name },
    data: { name: newName },
  })
  if (count === 0) return unchanged('lead passenger changed while repairing — left as is')

  await moveSpecialNote(bookingRef, lead.name, newName)
  await logActivity({
    userId: actorId,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      change: 'b2c-lead-passenger-name',
      bookingRef,
      from: lead.name,
      to: newName,
      source: via,
    },
  })
  return { bookingRef, status: 'renamed', from: lead.name, to: newName }
}

/**
 * Special notes are keyed by passenger name, so a note left against
 * "admin6611" would otherwise disappear from the booking page. It follows the
 * rename unless the traveller already has a note of their own.
 */
async function moveSpecialNote(bookingRef: string, fromName: string, toName: string): Promise<void> {
  const fromKey = passengerNameKey(fromName)
  const toKey = passengerNameKey(toName)
  try {
    const [oldNote, newNote] = await Promise.all([
      prisma.passengerSpecialNote.findUnique({ where: { bookingRef_nameKey: { bookingRef, nameKey: fromKey } } }),
      prisma.passengerSpecialNote.findUnique({ where: { bookingRef_nameKey: { bookingRef, nameKey: toKey } } }),
    ])
    if (!oldNote || newNote) return
    await prisma.passengerSpecialNote.update({
      where: { bookingRef_nameKey: { bookingRef, nameKey: fromKey } },
      data: { nameKey: toKey, passengerName: toName.slice(0, 191) },
    })
  } catch (err) {
    if (!isPassengerNotesMissing(err)) console.error(`[b2c-lead-name] note move failed for ${bookingRef} (non-fatal):`, err)
  }
}
