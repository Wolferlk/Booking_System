import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { listJobs } from '@/lib/as-import'

export const dynamic = 'force-dynamic'

/** GET /api/as-bookings-v2/import-jobs — recent import runs (newest first). */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const jobs = await listJobs()
  return buildApiSuccess({ jobs })
}
