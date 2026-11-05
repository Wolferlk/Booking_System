import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { FLIGHT_RESTORE_ROLES } from '@/lib/data-protection'
import { getDataProtectionPolicy, listRestorableFlights, restoreFlights } from '@/lib/data-protection-server'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function authorise(ref: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  const role = session.user.role as UserRole
  if (!FLIGHT_RESTORE_ROLES.includes(role)) return { error: buildApiError('Forbidden', 403) }

  if (!(await getDataProtectionPolicy()).flightRestore) {
    return { error: buildApiError('Flight restore is switched off in Settings → Data Protection', 403) }
  }

  const booking = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { id: true, bookingRef: true, operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL'
      && !isInCountryScope(booking.operationCountry, userCountry)) {
    return { error: buildApiError('Forbidden', 403) }
  }
  return { session, booking }
}

// GET /api/bookings/[ref]/flights/restore — flights older versions held that are gone or changed now.
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const ctx = await authorise(params.ref)
  if ('error' in ctx) return ctx.error
  return buildApiSuccess({ flights: await listRestorableFlights(ctx.booking.id) })
}

// POST /api/bookings/[ref]/flights/restore   { fingerprints: string[] }
export async function POST(req: NextRequest, { params }: { params: { ref: string } }) {
  const ctx = await authorise(params.ref)
  if ('error' in ctx) return ctx.error

  const body = await req.json().catch(() => ({})) as { fingerprints?: unknown }
  const fingerprints = Array.isArray(body.fingerprints) ? body.fingerprints.map(String).slice(0, 100) : []
  if (fingerprints.length === 0) return buildApiError('Pick at least one flight to restore')

  const result = await restoreFlights(ctx.booking.id, fingerprints, {
    id: ctx.session.user.id,
    bookingRef: ctx.booking.bookingRef,
  })
  if (result.created + result.replaced === 0) {
    return buildApiError('Those flights are already on the booking — refresh and try again', 409)
  }
  return buildApiSuccess(result, `Restored ${result.created + result.replaced} flight(s)`)
}
