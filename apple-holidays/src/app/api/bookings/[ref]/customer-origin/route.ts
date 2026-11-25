/**
 * "Customer Came From" — the country the traveller flew in from (flights + AI).
 *
 * This used to live at `/api/bookings/[ref]/origin`, but that path was later
 * taken over by booking provenance (who filed the booking — see
 * `lib/booking-origin.ts`), which only exports GET. The booking page's
 * Re-detect button kept POSTing there, got an empty 405, and failed with
 * "Unexpected end of JSON input". The two features now have separate routes.
 *
 * The cache key (`customer_origin_<ref>`) is unchanged, so origins detected
 * before the split are still picked up.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope } from '@/lib/country-detection'
import { identifyCustomerOrigin, type CustomerOrigin } from '@/lib/openai'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const cacheKey = (ref: string) => `customer_origin_${ref}`

interface CachedOrigin extends CustomerOrigin {
  detectedAt: string
  auto: boolean
}

/** Staff only, and only for bookings in the user's country scope. */
async function authorise(ref: string) {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return { error: buildApiError('Forbidden', 403) }

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    select: { operationCountry: true },
  })
  if (!booking) return { error: buildApiError('Booking not found', 404) }

  const userCountry = session.user.country as string | undefined
  if (!canSeeAllCountries(role, userCountry as never) && userCountry && userCountry !== 'ALL') {
    if (!isInCountryScope(booking.operationCountry, userCountry)) return { error: buildApiError('Forbidden', 403) }
  }
  return { error: null }
}

/** GET — return the cached origin (if one has been detected before). */
export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const { error } = await authorise(params.ref)
  if (error) return error

  const row = await prisma.systemSetting.findUnique({ where: { key: cacheKey(params.ref) } })
  if (!row) return buildApiSuccess(null)

  try {
    return buildApiSuccess(JSON.parse(row.value) as CachedOrigin)
  } catch {
    return buildApiSuccess(null)
  }
}

/** POST — (re)detect the customer's origin country via AI and cache the result. */
export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  const { error } = await authorise(params.ref)
  if (error) return error

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      flights: { orderBy: { date: 'asc' } },
      passengers: { select: { nationality: true } },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)

  if (booking.flights.length === 0 && !booking.agentCountry && !booking.contactCountry) {
    return buildApiError('Not enough information — add flight details or an agent/customer country first.', 422)
  }

  let origin: CustomerOrigin
  try {
    origin = await identifyCustomerOrigin(
      {
        flights: booking.flights.map(f => ({
          flightNo: f.flightNo, date: f.date?.toISOString?.() ?? String(f.date),
          fromApt: f.fromApt, toApt: f.toApt, airline: f.airline,
        })),
        agentCountry: booking.agentCountry,
        contactCountry: booking.contactCountry,
        nationalities: booking.passengers.map(p => p.nationality),
        operationCountry: booking.operationCountry,
      },
      params.ref,
    )
  } catch (err) {
    console.error('[POST /api/bookings/[ref]/customer-origin]', err)
    return buildApiError(err instanceof Error ? err.message : 'AI origin detection failed', 500)
  }

  const payload: CachedOrigin = { ...origin, detectedAt: new Date().toISOString(), auto: false }
  await prisma.systemSetting.upsert({
    where: { key: cacheKey(params.ref) },
    create: { key: cacheKey(params.ref), value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  })

  return buildApiSuccess(payload, 'Customer origin detected')
}
