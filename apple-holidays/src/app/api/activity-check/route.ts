/**
 * Activity Check — the search.
 *
 * Read-only. This route issues `findMany` and `groupBy` and nothing else; the
 * feature has no write path anywhere.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  ACTIVITY_CHECK_ROLES, parseActivityCheckQuery, fetchActivityRows,
  resolveRange, countryClause,
} from '@/lib/activity-check'
import { summarise } from '@/lib/activity-check-stats'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!ACTIVITY_CHECK_ROLES.includes(role)) return buildApiError('Forbidden', 403)

  const scope = {
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const now = new Date()
  const q = parseActivityCheckQuery(req.nextUrl.searchParams, now)

  try {
    const { rows, truncated, scanned } = await fetchActivityRows(q, scope, { now })

    // The agent dropdown is built from the agents this user can see, not from
    // the matched rows — otherwise picking an agent empties the list you would
    // need in order to pick a different one.
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
      stats: summarise(rows, q),
      range: { start: start.toISOString(), end: end.toISOString() },
      truncated,
      scanned,
      generatedAt: now.toISOString(),
    })
  } catch (error) {
    console.error('[activity-check]', error)
    return buildApiError(error instanceof Error ? error.message : 'Activity search failed', 500)
  }
}
