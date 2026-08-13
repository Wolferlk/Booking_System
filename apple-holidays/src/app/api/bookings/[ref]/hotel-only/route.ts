/**
 * Mark a booking as Hotel Only — or take the mark off again.
 *
 * The flag waives most of the operational checklist (see `hotel-only.ts`), so it
 * is treated as a decision rather than a preference: only the desks that own the
 * file may set it, the actor and the moment are stamped on the booking, and a
 * `StatusEvent` is appended so the trail says who decided and why.
 *
 * The booking's lifecycle status is never touched. Hotel Only changes what is
 * *required*, not where the file is.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { hotelOnlyAuditNote } from '@/lib/hotel-only'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Who may decide. Booking, Ground and TE all handle these files day to day;
 * Accounts is deliberately absent — the flag changes operations, not money.
 */
const CAN_SET: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

/** A cancelled file is not worth re-scoping, and the mark would only confuse the trail. */
const FROZEN_STATUSES = new Set<string>(['CANCELLED'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!CAN_SET.includes(role)) {
    return buildApiError('Forbidden — your role cannot change the Hotel Only mark', 403)
  }

  const body = await req.json().catch(() => ({})) as { hotelOnly?: unknown; note?: unknown }
  if (typeof body.hotelOnly !== 'boolean') {
    return buildApiError('`hotelOnly` must be true or false')
  }
  const on = body.hotelOnly
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    select: { id: true, status: true, operationCountry: true, hotelOnly: true },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as any) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) {
      return buildApiError('Forbidden', 403)
    }
  }

  if (FROZEN_STATUSES.has(booking.status)) {
    return buildApiError('This booking is cancelled — the Hotel Only mark cannot be changed', 409)
  }

  // Idempotent: setting what is already set is a no-op rather than a second
  // audit line, so a double-click does not litter the trail.
  if (booking.hotelOnly === on) {
    return buildApiSuccess(
      { bookingRef: params.ref, hotelOnly: on },
      on ? 'Already marked as Hotel Only' : 'Not marked as Hotel Only',
    )
  }

  const actor = session.user.name || session.user.email || 'Unknown'
  const now = new Date()

  const updated = await prisma.booking.update({
    where: { bookingRef: params.ref },
    data: on
      ? { hotelOnly: true, hotelOnlyAt: now, hotelOnlyBy: actor, hotelOnlyNote: note || null }
      // Clearing keeps nothing behind: the next mark writes its own stamp, and a
      // stale "set by" on an unmarked booking reads as if it were still on.
      : { hotelOnly: false, hotelOnlyAt: null, hotelOnlyBy: null, hotelOnlyNote: null },
    select: {
      bookingRef: true, hotelOnly: true, hotelOnlyAt: true,
      hotelOnlyBy: true, hotelOnlyNote: true, status: true,
    },
  })

  // Audit. `toState` is the unchanged current status — the event records a
  // decision about the file, not a move along the lifecycle.
  await prisma.statusEvent.create({
    data: {
      bookingId: booking.id,
      fromState: booking.status,
      toState:   booking.status,
      actorId:   session.user.id as string,
      note:      hotelOnlyAuditNote(on, note),
    },
  }).catch(() => { /* the flag is the record that matters; never fail the write on its trail */ })

  return buildApiSuccess(
    updated,
    on
      ? `${params.ref} is now a Hotel Only booking`
      : `Hotel Only removed from ${params.ref}`,
  )
}
