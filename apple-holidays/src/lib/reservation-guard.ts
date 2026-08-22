/**
 * Shared auth + country scoping for the Reservation API routes.
 *
 * Mirrors `precheck-guard.ts`. The audience differs from pre-checking: only the
 * Reservation Team and admins may *write*, while most internal roles may read,
 * so the guard takes the permission it is protecting rather than a fixed role
 * list. Country scope is re-derived from the database on every write, never
 * trusted from the request body.
 */
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from './auth'
import { prisma } from './prisma'
import { userCountryScope } from './country-detection'
import { hasPermission, type Permission } from './rbac'

export interface ReservationActor {
  name?: string | null
  email?: string | null
}

export interface ReservationSession {
  actor: ReservationActor
  role: UserRole
  /** Country values this user may see, or null for all. */
  countries: string[] | null
}

export type GuardResult =
  | { ok: true; session: ReservationSession }
  | { ok: false; response: Response }

function deny(status: number, error: string): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ success: false, error }, { status }) }
}

/**
 * Resolve the caller and confirm they hold `permission`, or return the Response
 * to send back.
 */
export async function guardReservation(permission: Permission): Promise<GuardResult> {
  const session = await getServerSession(authOptions)
  if (!session) return deny(401, 'Unauthorized')

  const role = session.user.role as UserRole
  if (!hasPermission(role, permission)) return deny(403, 'Forbidden')

  return {
    ok: true,
    session: {
      actor: { name: session.user.name, email: session.user.email },
      role,
      countries: userCountryScope(session.user.country, session.user.countries),
    },
  }
}

/**
 * Confirm a booking is inside the caller's country scope.
 *
 * Reservations are addressed by id or reservationKey, both of which carry a
 * booking ref the caller supplied — so scope is re-read from `bookings` rather
 * than believed.
 */
export async function assertBookingInScope(
  bookingRef: string,
  s: ReservationSession,
): Promise<boolean> {
  if (!s.countries) return true
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: { operationCountry: true },
  })
  if (!booking) return false
  return booking.operationCountry != null && s.countries.includes(booking.operationCountry)
}

/** Confirm a reservation row is in scope, by its id. */
export async function assertReservationInScope(
  reservationId: string,
  s: ReservationSession,
): Promise<boolean> {
  if (!s.countries) return true
  const row = await prisma.hotelReservation.findUnique({
    where: { id: reservationId },
    select: { bookingRef: true },
  })
  if (!row) return false
  return assertBookingInScope(row.bookingRef, s)
}

/** The booking ref encoded in a reservation key. */
export function bookingRefFromReservationKey(key: string): string {
  return (key.split('::')[0] ?? '').trim().toUpperCase()
}
