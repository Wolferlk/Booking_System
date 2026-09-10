/**
 * The Activity Explorer's data — the phrases the book actually contains.
 *
 * Loaded on demand rather than with the page: it reads a wide date window, and
 * most searches start from a keyword the user already has in mind.
 */

import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { ACTIVITY_CHECK_ROLES } from '@/lib/activity-check'
import { fetchActivityCatalogue } from '@/lib/activity-catalogue'
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

  const sp = req.nextUrl.searchParams
  const parseDate = (v: string | null) => {
    if (!v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  try {
    const result = await fetchActivityCatalogue(scope, {
      q:       (sp.get('q') ?? '').trim(),
      from:    parseDate(sp.get('from')),
      to:      parseDate(sp.get('to')),
      country: (sp.get('country') ?? '').trim(),
      limit:   Math.min(Math.max(Number(sp.get('limit') ?? 60) || 60, 10), 200),
    })
    return buildApiSuccess(result)
  } catch (error) {
    console.error('[activity-check/catalogue]', error)
    return buildApiError(error instanceof Error ? error.message : 'Could not build the activity list', 500)
  }
}
