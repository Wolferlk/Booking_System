import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import { bookingSourceWhere } from '@/lib/booking-source'
import type { Prisma, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Agents behind the All Bookings "Agent" filter, with booking counts.
 *
 * Scoped the same way as the list (role/country/source) so a Vietnam user never
 * sees a Sri Lanka-only agent. Spellings that differ only by case or spaces are
 * folded into one entry, shown under the most common spelling.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  const { searchParams } = req.nextUrl
  const role = session.user.role as UserRole
  const userCountry = (session.user as any).country as string | undefined
  const userCountries = (session.user as any).countries as string[] | undefined
  const countryOverride = searchParams.get('country')

  const andClauses: Prisma.BookingWhereInput[] = [{ agent: { not: null } }]
  if (!canSeeAllCountries(role, userCountry as any)) {
    const scope = userCountryScope(userCountry, userCountries)
    if (scope) andClauses.push({ operationCountry: { in: scope as any } })
  } else if (countryOverride && countryOverride !== 'ALL') {
    andClauses.push(countryOverride === 'SINGAPORE_MALAYSIA'
      ? { operationCountry: { in: countryScope(countryOverride)! as any } }
      : { operationCountry: countryOverride as any })
  }
  const sourceClause = bookingSourceWhere(searchParams.get('source'))
  if (sourceClause) andClauses.push(sourceClause as Prisma.BookingWhereInput)

  const groups = await prisma.booking.groupBy({
    by: ['agent'],
    where: { AND: andClauses },
    _count: { _all: true },
  })

  const folded = new Map<string, { name: string; best: number; count: number }>()
  for (const g of groups) {
    const raw = (g.agent ?? '').trim()
    if (!raw) continue
    const key = raw.replace(/\s+/g, ' ').toLowerCase()
    const n = g._count._all
    const cur = folded.get(key)
    if (!cur) folded.set(key, { name: raw, best: n, count: n })
    else {
      cur.count += n
      if (n > cur.best) { cur.best = n; cur.name = raw }
    }
  }

  const agents = Array.from(folded.values())
    .map(({ name, count }) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return buildApiSuccess({ agents })
}
