import { getServerSession, type Session } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { hasPermission } from '@/lib/rbac'
import { userCountryScope } from '@/lib/country-detection'

type Result = { session: Session; canEdit: boolean; isAdmin: boolean; actor: string } | { error: string; status: number }

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * Who may use VN Vendor Sync: anyone who can read movement charts, scoped to
 * Vietnam. Fetching, applying and undoing need `agenda:edit` — the same right
 * the Assign Driver dialog needs. `need: 'admin'` is for the global settings.
 */
export async function vendorSyncSession(need: 'read' | 'edit' | 'admin' = 'read'): Promise<Result> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 }
  const role = session.user.role as UserRole
  if (!hasPermission(role, 'agenda:read')) return { error: 'Forbidden', status: 403 }
  const scope = userCountryScope(session.user.country, session.user.countries ?? null)
  if (scope && !scope.includes('VIETNAM')) return { error: 'VN Vendor Sync is for the Vietnam team', status: 403 }
  const canEdit = hasPermission(role, 'agenda:edit')
  const isAdmin = ADMIN_ROLES.includes(role)
  if (need === 'edit' && !canEdit) return { error: 'You need movement-chart edit rights for this', status: 403 }
  if (need === 'admin' && !isAdmin) return { error: 'Only admins can change the sync settings', status: 403 }
  return { session, canEdit, isAdmin, actor: session.user.name ?? session.user.email ?? 'Someone' }
}
