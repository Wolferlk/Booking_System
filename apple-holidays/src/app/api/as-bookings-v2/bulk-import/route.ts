import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { startAsImport } from '@/lib/as-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_SPAN_DAYS = 92

/**
 * POST /api/as-bookings-v2/bulk-import
 * Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 *
 * Kicks a manual range import of status-2 confirmations by *create date* in the
 * background and returns a jobId to poll via /api/as-bookings-v2/import-jobs/:id.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  let body: { from?: string; to?: string }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const from = String(body.from ?? '').trim()
  const to = String(body.to ?? '').trim()
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return buildApiError('from and to must be YYYY-MM-DD dates', 400)
  }
  if (from > to) {
    return buildApiError('"from" date must be on or before "to" date', 400)
  }

  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  if (spanDays > MAX_SPAN_DAYS) {
    return buildApiError(`Date range too large — keep it within ${MAX_SPAN_DAYS} days.`, 400)
  }

  try {
    const jobId = await startAsImport({
      fromCreateDate: from,
      toCreateDate: to,
      mode: 'manual',
      triggeredById: session.user.id,
    })
    return buildApiSuccess({ jobId }, 'Import started')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start import'
    return buildApiError(msg, 500)
  }
}
