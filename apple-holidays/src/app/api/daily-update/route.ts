import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  DAILY_UPDATE_ROLES, DAILY_UPDATE_EDIT_ROLES,
  parseDailyUpdateQuery, fetchDailyUpdateRows, sortDailyUpdateRows,
  summarise, resolveRange, countryClause,
} from '@/lib/daily-update'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!DAILY_UPDATE_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const scope = {
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const q = parseDailyUpdateQuery(req.nextUrl.searchParams)
  const now = new Date()

  const rows = sortDailyUpdateRows(await fetchDailyUpdateRows(q, scope, 1500, now), q)

  // The agent dropdown is built from the agents this user can actually see, not
  // from the filtered rows — otherwise picking an agent empties the list you
  // would need in order to pick a different one.
  const country = countryClause(scope, q.country)
  const agentGroups = await prisma.booking.groupBy({
    by: ['agent'],
    where: { AND: [...(country ? [country] : []), { agent: { not: null } }] },
    _count: { agent: true },
    orderBy: { agent: 'asc' },
  })

  const agents = agentGroups
    .map(g => ({ name: g.agent as string, count: g._count.agent }))
    .filter(a => a.name.trim().length > 0)

  const { start, end } = resolveRange(q, now)

  return buildApiSuccess({
    rows,
    agents,
    stats: summarise(rows),
    range: { start: start.toISOString(), end: end.toISOString() },
    canEdit: DAILY_UPDATE_EDIT_ROLES.includes(role),
    generatedAt: now.toISOString(),
  })
}
