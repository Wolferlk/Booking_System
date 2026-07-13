import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { identifyCustomerOrigin, type CustomerOrigin } from '@/lib/openai'

export const dynamic = 'force-dynamic'

const cacheKey = (ref: string) => `customer_origin_${ref}`

interface CachedOrigin extends CustomerOrigin {
  detectedAt: string
  auto: boolean
}

/** GET — return the cached origin (if one has been detected before). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const row = await prisma.systemSetting.findUnique({ where: { key: cacheKey(params.ref) } })
  if (!row) return buildApiSuccess(null)

  try {
    return buildApiSuccess(JSON.parse(row.value) as CachedOrigin)
  } catch {
    return buildApiSuccess(null)
  }
}

/** POST — (re)detect the customer's origin country via AI and cache the result. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

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
