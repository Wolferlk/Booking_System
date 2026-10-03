/**
 * Staff-side guard for the Driver-Auto API: an authenticated user holding
 * `assignment:create` (the same permission the SL allocation board needs),
 * scoped to the countries their account covers.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canSeeAllCountries, hasPermission } from '@/lib/rbac'
import type { OperationCountry, UserRole } from '@prisma/client'
import { DA_COUNTRIES, type DaCountry } from './shared'

export interface DaStaff {
  userId: string
  name: string
  role: UserRole
  countries: DaCountry[]
}

export async function requireDaStaff(): Promise<DaStaff | { error: string; status: number }> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 }
  const role = session.user.role as UserRole
  if (!hasPermission(role, 'assignment:create')) return { error: 'Forbidden', status: 403 }

  const userCountry = (session.user.country ?? 'ALL') as OperationCountry
  let countries: DaCountry[]
  if (canSeeAllCountries(role, userCountry) || userCountry === 'ALL' || !userCountry) countries = [...DA_COUNTRIES]
  else if (userCountry === 'SINGAPORE_MALAYSIA') countries = ['SINGAPORE', 'MALAYSIA']
  else countries = DA_COUNTRIES.filter(c => c === userCountry)

  return {
    userId: session.user.id as string,
    name: (session.user.name as string) || (session.user.email as string) || 'Staff',
    role,
    countries: countries.length ? countries : [...DA_COUNTRIES],
  }
}
