/**
 * Shared auth + country scoping for the Pre-checking API routes.
 *
 * Reconfirmation is Travel Experience and Ground work, with Booking Team and
 * Accounts reading along, so the audience is every internal staff role. What
 * differs is *scope*: a user assigned to Sri Lanka must never see or edit a
 * Vietnam stay, which is enforced here rather than in each route.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from './auth'
import { prisma } from './prisma'
import { userCountryScope } from './country-detection'
import type { Actor } from './hotel-precheck-write'

/** Every internal role may work the reconfirmation queue. Clients may not. */
export const PRECHECK_ROLES = [
  'BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER',
  'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export interface PrecheckSession {
  actor: Actor
  role: string
  /** Country values this user may see, or null for all. */
  countries: string[] | null
}

export type GuardResult =
  | { ok: true; session: PrecheckSession }
  | { ok: false; response: Response }

/** Resolve the caller, or return the Response to send back. */
export async function guardPrecheck(): Promise<GuardResult> {
  const session = await getServerSession(authOptions)
  if (!session) {
    return { ok: false, response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!PRECHECK_ROLES.includes(session.user.role)) {
    return { ok: false, response: Response.json({ success: false, error: 'Forbidden' }, { status: 403 }) }
  }

  return {
    ok: true,
    session: {
      actor: { name: session.user.name, email: session.user.email },
      role: session.user.role,
      countries: userCountryScope(session.user.country, session.user.countries),
    },
  }
}

/**
 * Confirm a booking is inside the caller's country scope.
 *
 * Write routes address stays by `stayKey`, which begins with the booking ref —
 * so scope has to be re-derived from the database on every write rather than
 * trusted from the request.
 */
export async function assertBookingInScope(bookingRef: string, s: PrecheckSession): Promise<boolean> {
  if (!s.countries) return true
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { operationCountry: true },
  })
  if (!booking) return false
  return booking.operationCountry != null && s.countries.includes(booking.operationCountry)
}

/** The booking ref encoded in a stay key. */
export function bookingRefFromStayKey(stayKey: string): string {
  return (stayKey.split('::')[0] ?? '').trim().toUpperCase()
}
