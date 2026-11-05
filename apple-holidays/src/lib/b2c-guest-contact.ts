/**
 * Guest contact repair for Aahaas B2C bookings.
 *
 * Orders placed on the shared desk login (admin6611) were imported holding the
 * desk's own inbox (admin@it.aahaas.com) and often no phone at all, while
 * AahaasFlow shows the real guest (pradmu@gmail.com, +94703288141). The importer
 * never revisits an existing booking, so {@link repairB2cGuestContact} corrects
 * those in place — the agenda print, the guest card and every automation then
 * reach the guest instead of the desk.
 *
 * It only ever fills a blank or replaces a staff inbox. A value ops typed is
 * never touched, the write is conditional on the values it read (an edit made in
 * the meantime wins), and each change is in the activity log with the old value.
 */
import { prisma } from './prisma'
import { isB2cBooking, isStaffEmail } from './booking-source'
import { ACTION, logActivity } from './activity'

type ContactField = 'contactEmail' | 'contactPhone' | 'contactWhatsapp'

export interface GuestContactRepair {
  bookingRef: string
  status: 'repaired' | 'would-repair' | 'unchanged'
  changes: { field: ContactField; from: string | null; to: string }[]
  reason?: string
}

const blank = (v: string | null | undefined) => !v || !v.trim()

/** Usable as a guest address: looks like an email and is not one of ours. */
export function isGuestEmail(v: string | null | undefined): v is string {
  return Boolean(v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) && !isStaffEmail(v))
}

/** At least 8 digits — shorter is an extension or a fragment, not a number to dial. */
export function isDialable(v: string | null | undefined): v is string {
  return String(v ?? '').replace(/\D/g, '').length >= 8
}

export async function repairB2cGuestContact(params: {
  bookingRef: string
  /** The guest's own email / phone per the store — never the desk account's. */
  email: string | null | undefined
  phone: string | null | undefined
  /** Where the values came from, for the activity log. */
  source: string
  apply: boolean
  actorId: string
}): Promise<GuestContactRepair> {
  const { bookingRef, source, apply, actorId } = params
  const unchanged = (reason: string): GuestContactRepair => ({ bookingRef, status: 'unchanged', changes: [], reason })

  const email = isGuestEmail(params.email) ? params.email.trim() : null
  const phone = isDialable(params.phone) ? params.phone.trim() : null
  if (!email && !phone) return unchanged('store has no guest contact for this order')

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { id: true, agent: true, contactEmail: true, contactPhone: true, contactWhatsapp: true },
  })
  if (!booking || !isB2cBooking(booking.agent)) return unchanged('not an Aahaas B2C booking')

  const changes: GuestContactRepair['changes'] = []
  const current = booking.contactEmail?.trim() || null
  if (email && (blank(current) || isStaffEmail(current!)) && current?.toLowerCase() !== email.toLowerCase()) {
    changes.push({ field: 'contactEmail', from: booking.contactEmail, to: email })
  }
  if (phone && blank(booking.contactPhone)) {
    changes.push({ field: 'contactPhone', from: booking.contactPhone, to: phone })
  }
  // The importer seeds WhatsApp from the store phone, so a blank one gets the
  // same number. One set here on purpose is left alone.
  if (phone && blank(booking.contactWhatsapp)) {
    changes.push({ field: 'contactWhatsapp', from: booking.contactWhatsapp, to: phone })
  }
  if (changes.length === 0) return unchanged('booking already holds a guest contact')
  if (!apply) return { bookingRef, status: 'would-repair', changes }

  // Conditional on every value read above, so an edit made meanwhile always wins.
  const { count } = await prisma.booking.updateMany({
    where: {
      id: booking.id,
      contactEmail: booking.contactEmail,
      contactPhone: booking.contactPhone,
      contactWhatsapp: booking.contactWhatsapp,
    },
    data: Object.fromEntries(changes.map((c) => [c.field, c.to])),
  })
  if (count === 0) return unchanged('contact changed while repairing — left as is')

  await logActivity({
    userId: actorId,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId: booking.id,
    details: { change: 'b2c-guest-contact', bookingRef, source, changes },
  })
  return { bookingRef, status: 'repaired', changes }
}
