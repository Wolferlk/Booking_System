/**
 * Shared auth + country scope for the Feedbacks API.
 *
 * Every route here is read-only, so the only thing that has to be got right is
 * *who may read what*: a country-scoped user must never see another country's
 * feedback, and the scope has to be resolved once so the three routes cannot
 * drift apart.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canSeeAllCountries } from '@/lib/rbac'
import { countryScope, userCountryScope } from '@/lib/country-detection'
import type { OperationCountry, UserRole } from '@prisma/client'

export const FEEDBACK_ROLES: UserRole[] = [
  'BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER',
  'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN',
]

export interface FeedbackViewer {
  role: UserRole
  name: string
  /** null = every country. */
  countries: OperationCountry[] | null
}

export type ScopeResult =
  | { ok: true; viewer: FeedbackViewer }
  | { ok: false; status: 401 | 403; error: string }

/**
 * `countryOverride` is honoured only for users who can already see every
 * country — for anyone else it is ignored, never widened.
 */
export async function resolveViewer(countryOverride?: string | null): Promise<ScopeResult> {
  const session = await getServerSession(authOptions)
  if (!session) return { ok: false, status: 401, error: 'Unauthorized' }

  const role = session.user.role as UserRole
  if (!FEEDBACK_ROLES.includes(role)) return { ok: false, status: 403, error: 'Forbidden' }

  const userCountry = (session.user as { country?: string }).country
  const userCountries = (session.user as { countries?: string[] }).countries

  let countries: OperationCountry[] | null
  if (canSeeAllCountries(role, userCountry as OperationCountry)) {
    countries = countryOverride && countryOverride !== 'ALL' ? countryScope(countryOverride) : null
  } else {
    countries = userCountryScope(userCountry, userCountries)
  }

  return {
    ok: true,
    viewer: {
      role,
      name: session.user.name ?? session.user.email ?? 'Unknown user',
      countries,
    },
  }
}
