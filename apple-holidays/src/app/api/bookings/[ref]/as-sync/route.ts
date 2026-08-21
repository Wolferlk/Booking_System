/**
 * Full AppleSystem sync for one already-imported booking.
 *
 *   GET  → when this booking was last synced, and what changed on that run.
 *   POST → re-pull the quotation and refresh the booking's content in place.
 *
 * All of the "what is safe to overwrite" reasoning lives in `as-booking-sync.ts`.
 * This route only does auth, country scoping, and error-code translation — the
 * sync itself refuses to touch workflow state, so it is safe to run on a live
 * file that is already ticketed, driver-allocated or client-confirmed.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { syncBookingFromAs, getSyncState, AsSyncError } from '@/lib/as-booking-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Booking row + country-scope check shared by both handlers. */
async function loadScoped(ref: string, sessionCountry: OperationCountry | undefined) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { id: true, bookingRef: true, isNumber: true, operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }
  if (
    sessionCountry &&
    sessionCountry !== 'ALL' &&
    !isInCountryScope(booking.operationCountry as OperationCountry, sessionCountry)
  ) {
    return { error: buildApiError('Forbidden — this booking belongs to another country.', 403) }
  }
  return { booking }
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const { booking, error } = await loadScoped(
    params.ref,
    session.user.country as OperationCountry | undefined,
  )
  if (error) return error

  return buildApiSuccess({
    bookingRef: booking!.bookingRef,
    lastSync: await getSyncState(booking!.bookingRef),
  })
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:edit')) {
    return buildApiError('Forbidden', 403)
  }

  const { booking, error } = await loadScoped(
    params.ref,
    session.user.country as OperationCountry | undefined,
  )
  if (error) return error

  try {
    const result = await syncBookingFromAs(booking!.bookingRef, {
      actorId: session.user.id,
      actorName: session.user.name || session.user.email || 'Unknown user',
      mode: 'manual',
    })

    const changedCount = result.fields.length
    const message = result.unchanged
      ? 'Already up to date — AppleSystem has nothing newer for this booking.'
      : `Booking updated from AppleSystem — ${changedCount} field(s) changed. Workflow status, tickets, drivers and confirmations were not touched.`

    return buildApiSuccess(result, message)
  } catch (err) {
    if (err instanceof AsSyncError) return buildApiError(err.message, err.status)
    return buildApiError(err instanceof Error ? err.message : 'Sync failed', 500)
  }
}
