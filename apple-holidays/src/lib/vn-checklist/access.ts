import { getServerSession, type Session } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { userCountryScope } from '@/lib/country-detection'
import { canEditChecklist, canViewChecklist } from './shared'

type Result = { session: Session } | { error: string; status: number }

/**
 * The session, if it may use the Vietnam checklist: a checklist role, and a
 * country scope that includes Vietnam. `edit` additionally needs an edit role.
 */
export async function checklistSession(edit = false): Promise<Result> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: 'Unauthorized', status: 401 }
  const role = session.user.role as string
  if (!(edit ? canEditChecklist(role) : canViewChecklist(role))) return { error: 'Forbidden', status: 403 }
  const scope = userCountryScope(session.user.country, session.user.countries ?? null)
  if (scope && !scope.includes('VIETNAM')) return { error: 'The checklist is for the Vietnam team', status: 403 }
  return { session }
}
