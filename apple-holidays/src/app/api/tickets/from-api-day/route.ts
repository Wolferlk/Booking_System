import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { OperationCountry, Prisma, UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries, hasPermission } from '@/lib/rbac'
import { countryScope } from '@/lib/country-detection'

export const dynamic = 'force-dynamic'

/**
 * GET /api/tickets/from-api-day?from=YYYY-MM-DD&to=YYYY-MM-DD&mode=arriving|travelling
 *
 * The bookings the bulk "Create Tickets from API" runs over. Reads the local DB
 * only — the run itself is the browser calling POST /api/bookings/[ref]/as-tickets
 * once per booking, so every booking gets exactly the same create-only logic as
 * the single button and no single request outlives the Lambda timeout.
 *
 *   arriving   — arrival date falls in [from, to]
 *   travelling — the trip overlaps [from, to] (arrived on/before `to`, leaves on/after `from`)
 *
 * Dates are matched ±12h around UTC midnight so a date saved as local midnight
 * (Colombo / Singapore / Hanoi, all ahead of UTC) still lands on its own day.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const HALF_DAY = 12 * 3_600_000
const MAX_DAYS = 31
const MAX_ROWS = 400

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role, 'ticket:create')) return buildApiError('Forbidden', 403)

  const sp = req.nextUrl.searchParams
  const from = sp.get('from') ?? ''
  const to = sp.get('to') || from
  const mode = sp.get('mode') === 'travelling' ? 'travelling' : 'arriving'
  if (!DAY_RE.test(from) || !DAY_RE.test(to)) return buildApiError('Pick a travel date (YYYY-MM-DD).', 400)

  const fromMid = new Date(`${from}T00:00:00Z`).getTime()
  const toMid = new Date(`${to}T00:00:00Z`).getTime()
  if (Number.isNaN(fromMid) || Number.isNaN(toMid)) return buildApiError('Invalid date.', 400)
  if (toMid < fromMid) return buildApiError('The end date is before the start date.', 400)
  if ((toMid - fromMid) / 86_400_000 + 1 > MAX_DAYS) return buildApiError(`Pick at most ${MAX_DAYS} days at a time.`, 400)

  const lo = new Date(fromMid - HALF_DAY)
  const hi = new Date(toMid + HALF_DAY)

  // Country — same rule as the ticket list: only all-country users may override.
  const role = session.user.role as UserRole
  const userCountry = (session.user.country ?? 'ALL') as OperationCountry
  const override = sp.get('country') as OperationCountry | null
  const effective = canSeeAllCountries(role, userCountry) ? override || null : userCountry || null
  const scope = countryScope(effective)

  const where: Prisma.BookingWhereInput = {
    ...(scope ? { operationCountry: { in: scope } } : {}),
    ...(mode === 'arriving'
      ? { arrivalDate: { gte: lo, lt: hi } }
      : { arrivalDate: { lt: hi }, departureDate: { gte: lo } }),
  }

  const rows = await prisma.booking.findMany({
    where,
    select: {
      bookingRef: true,
      isNumber: true,
      agent: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      operationCountry: true,
      paxAdults: true,
      paxChildren: true,
      paxInfants: true,
      _count: { select: { tickets: true } },
    },
    orderBy: [{ arrivalDate: 'asc' }, { bookingRef: 'asc' }],
    take: MAX_ROWS + 1,
  })

  const truncated = rows.length > MAX_ROWS
  const bookings = rows.slice(0, MAX_ROWS).map(b => ({
    bookingRef: b.bookingRef,
    isNumber: b.isNumber,
    agent: b.agent,
    status: b.status,
    arrivalDate: b.arrivalDate.toISOString(),
    departureDate: b.departureDate.toISOString(),
    operationCountry: b.operationCountry,
    pax: b.paxAdults + b.paxChildren + b.paxInfants,
    ticketCount: b._count.tickets,
  }))

  return buildApiSuccess({ from, to, mode, truncated, bookings })
}
