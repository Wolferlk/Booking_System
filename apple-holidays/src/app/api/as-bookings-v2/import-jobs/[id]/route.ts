import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { getJob } from '@/lib/as-import'

export const dynamic = 'force-dynamic'

/** GET /api/as-bookings-v2/import-jobs/:id — one import run (polled for progress). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const job = await getJob(params.id)
  if (!job) return buildApiError('Import job not found', 404)
  return buildApiSuccess({ job })
}
