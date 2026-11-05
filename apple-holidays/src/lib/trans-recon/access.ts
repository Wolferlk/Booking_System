import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError } from '@/lib/utils'
import { allowedCountries, isMissingTable, ReconError, type Actor } from './server'
import { NOT_INSTALLED, canEditRecon, canViewRecon, type ReconCountry } from './shared'

export interface ReconSession { role: string; actor: Actor; allowed: ReconCountry[]; canEdit: boolean }

/** Session + role + country scope for every Trans-Reconsultation route. */
export async function reconSession(need: 'view' | 'edit'): Promise<ReconSession | Response> {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = String(session.user.role)
  if (!canViewRecon(role)) return buildApiError('Forbidden', 403)
  if (need === 'edit' && !canEditRecon(role)) return buildApiError('Your role can view this sheet but not change it', 403)
  const u = session.user as { id?: string; name?: string | null; email?: string | null; country?: string }
  return {
    role,
    actor: { id: u.id ?? null, name: u.name || u.email || null },
    allowed: allowedCountries(role, u.country),
    canEdit: canEditRecon(role),
  }
}

/** One place that turns a thrown error into the JSON the page reads. */
export function reconFailure(err: unknown, where: string) {
  if (isMissingTable(err)) return buildApiError(NOT_INSTALLED, 503)
  if (err instanceof ReconError) return buildApiError(err.message, err.status)
  console.error(`[trans-recon] ${where}:`, err)
  return buildApiError(err instanceof Error ? err.message : 'Something went wrong', 500)
}
