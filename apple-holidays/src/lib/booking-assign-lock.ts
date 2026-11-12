/**
 * No new driver or vendor on a booking that is being cancelled.
 *
 * Once a cancellation has been *requested* (PENDING_CANCELLATION) — by a person
 * or by the AppleSystem cancellation check — the file is waiting on accounts.
 * Allocating a driver or vendor to it now commits a supplier to a tour that is
 * probably off, and the driver gets a WhatsApp brief for it.
 *
 * What stays allowed, deliberately:
 *   • **Removing** a driver / vendor (releasing them is the right thing to do).
 *   • **Keeping** the allocation already there — a chart re-save that carries
 *     the same people through is not a new allocation.
 *   • **Tickets** — issuing and uploading ticket files is not gated here at
 *     all; accounts may yet reject the cancellation and the files are needed.
 *   • Guides, notes, times, vehicles on an existing allocation.
 *
 * Accounts *rejecting* the request restores the previous status, which lifts
 * the lock with no further action.
 */
import type { BookingStatus } from '@prisma/client'

export const ASSIGN_LOCKED_STATUSES: readonly BookingStatus[] = ['PENDING_CANCELLATION', 'CANCELLED']

export function isAssignLocked(status: string | null | undefined): boolean {
  return !!status && (ASSIGN_LOCKED_STATUSES as readonly string[]).includes(status)
}

/** The sentence every refusing route returns — one wording everywhere. */
export function assignLockMessage(status: string | null | undefined, ref?: string | null): string {
  const who = ref ? `${ref} ` : 'This booking '
  return status === 'CANCELLED'
    ? `${who}is cancelled — drivers and vendors cannot be assigned.`
    : `${who}is requested to cancel and waiting for accounts approval — drivers and vendors cannot be ` +
      'assigned until accounts reject the cancellation. Removing an existing driver is still allowed, ' +
      'and tickets can still be issued.'
}

/** The driver / vendor identity fields an allocation carries. */
export interface PartnerFields {
  driverId?: string | null
  driverName?: string | null
  vendorId?: string | null
  vendorName?: string | null
  tourVendorId?: string | null
  tourVendorName?: string | null
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Stable keys for "who is on this movement" — ids and names both count. */
export function partnerKeys(a: PartnerFields | null | undefined): string[] {
  if (!a) return []
  const out: string[] = []
  if (a.driverId) out.push(`d:${a.driverId}`)
  if (norm(a.driverName)) out.push(`dn:${norm(a.driverName)}`)
  if (a.vendorId) out.push(`v:${a.vendorId}`)
  if (norm(a.vendorName)) out.push(`vn:${norm(a.vendorName)}`)
  if (a.tourVendorId) out.push(`t:${a.tourVendorId}`)
  if (norm(a.tourVendorName)) out.push(`tn:${norm(a.tourVendorName)}`)
  return out
}

/**
 * True when `next` names a driver or vendor that is not already among `held`.
 * An emptied allocation (removal) is never "new".
 */
export function introducesNewPartner(next: PartnerFields | null | undefined, held: Set<string>): boolean {
  return partnerKeys(next).some((k) => !held.has(k))
}
