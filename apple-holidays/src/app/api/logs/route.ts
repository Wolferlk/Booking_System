/**
 * GET /api/logs?q=&section=&ref=&actor=&from=YYYY-MM-DD&to=YYYY-MM-DD&failed=1&before=ISO&limit=
 *
 * Every booking's history in one searchable list (Logs page). Read-only.
 * Country-scoped staff only see bookings of their country (by booking ref).
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { canSeeAllCountries } from '@/lib/rbac'
import { detectCountryFromRef, isInCountryScope } from '@/lib/country-detection'
import { isLogSection, readLogs } from '@/lib/booking-logs'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

const day = (v: string | null, endOfDay = false): Date | null => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const userCountry = session.user.country as string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCountries = canSeeAllCountries(role, userCountry as any) || !userCountry || userCountry === 'ALL'

  const sp = req.nextUrl.searchParams
  const section = sp.get('section')
  const before = sp.get('before')
  // Default window: the last 7 days, so an empty search stays light on the live DB.
  const from = day(sp.get('from')) ?? (sp.get('ref') || sp.get('q') ? null : new Date(Date.now() - 7 * 86_400_000))
  const data = await readLogs({
    bookingRef: sp.get('ref')?.trim().toUpperCase() || null,
    section: isLogSection(section) ? section : null,
    q: sp.get('q'),
    actor: sp.get('actor')?.trim() || null,
    tone: sp.get('failed') === '1' ? 'fail' : null,
    from,
    to: day(sp.get('to'), true),
    before: before && !Number.isNaN(Date.parse(before)) ? new Date(before) : null,
    limit: Number(sp.get('limit')) || 80,
    countryRefFilter: allCountries ? undefined : (ref) => {
      const c = detectCountryFromRef(ref)
      return !!c && isInCountryScope(c, userCountry)
    },
  })
  return buildApiSuccess(data)
}
