import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { bookingSourceWhere } from '@/lib/booking-source'
import { QUICK_FILTERS, quickFilterWhere, type QuickFilter } from '@/lib/booking-quick-filters'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

interface Bucket { count: number; pax: number }

/**
 * Counts behind the operational cards on the All Bookings page.
 *
 * Only the scope filters (role/country/source) are applied — deliberately not
 * the page's search or date filters, so the cards stay a stable "what's
 * happening right now" pulse rather than shifting as the user types.
 *
 * Every bucket is evaluated from one query: the union of the seven fragments is
 * fetched once and bucketed in memory, which also gives us pax totals for free.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { searchParams } = req.nextUrl
  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const countryOverride = searchParams.get('country')

  const andClauses: Prisma.BookingWhereInput[] = []

  if (role === 'CLIENT') {
    andClauses.push({ clientUserId: session.user.id })
  } else if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) andClauses.push({ operationCountry: { in: scope as any } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    if (countryOverride === 'SINGAPORE_MALAYSIA') {
      andClauses.push({ operationCountry: { in: countryScope(countryOverride)! as any } })
    } else {
      andClauses.push({ operationCountry: countryOverride as any })
    }
  }

  const sourceClause = bookingSourceWhere(searchParams.get('source'))
  if (sourceClause) andClauses.push(sourceClause as Prisma.BookingWhereInput)

  const now = new Date()
  const fragments = QUICK_FILTERS.map(f => quickFilterWhere(f, now))

  const rows = await prisma.booking.findMany({
    where: { AND: [...andClauses, { OR: fragments }] },
    select: {
      id: true,
      status: true,
      arrivalDate: true,
      departureDate: true,
      paxAdults: true,
      paxChildren: true,
    },
  })

  // Re-apply each fragment's date logic in memory. Kept in lockstep with
  // `quickFilterWhere` by deriving both from the same day boundaries.
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d }
  const tomorrow = day(1), dayAfter = day(2), yesterday = day(-1), horizon = day(8)

  const empty = (): Bucket => ({ count: 0, pax: 0 })
  const stats: Record<QuickFilter, Bucket> = {
    on_ground:           empty(),
    arrivals_today:      empty(),
    arrivals_tomorrow:   empty(),
    arrivals_upcoming:   empty(),
    departures_today:    empty(),
    departures_upcoming: empty(),
    completed_yesterday: empty(),
  }

  const inRange = (d: Date, from: Date, to: Date) => d >= from && d < to

  for (const b of rows) {
    const arr = new Date(b.arrivalDate)
    const dep = new Date(b.departureDate)
    const pax = (b.paxAdults ?? 0) + (b.paxChildren ?? 0)
    const hit = (k: QuickFilter) => { stats[k].count += 1; stats[k].pax += pax }

    if (arr < tomorrow && dep >= today)          hit('on_ground')
    if (inRange(arr, today, tomorrow))           hit('arrivals_today')
    if (inRange(arr, tomorrow, dayAfter))        hit('arrivals_tomorrow')
    if (inRange(arr, dayAfter, horizon))         hit('arrivals_upcoming')
    if (inRange(dep, today, tomorrow))           hit('departures_today')
    if (inRange(dep, tomorrow, horizon))         hit('departures_upcoming')
    if (inRange(dep, yesterday, today))          hit('completed_yesterday')
  }

  return buildApiSuccess({ stats, asOf: now.toISOString() })
}
