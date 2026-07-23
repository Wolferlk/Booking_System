import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { startAsImport, type ImportDateField } from '@/lib/as-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Create-date windows are for catching up on confirmations, so they stay tight. */
const MAX_SPAN_DAYS_CREATE = 92
/** Arrival windows cover whole seasons ahead, so they get a wider cap. */
const MAX_SPAN_DAYS_ARRIVAL = 366

/**
 * POST /api/as-bookings-v2/bulk-import
 * Body: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', dateField?: 'create' | 'arrival' }
 *
 * Kicks a manual range import of status-2 confirmations in the background and
 * returns a jobId to poll via /api/as-bookings-v2/import-jobs/:id. The window
 * filters on the quotation create date by default, or on the tour arrival date
 * when `dateField` is `'arrival'`.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  let body: { from?: string; to?: string; dateField?: string }
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body', 400)
  }

  const from = String(body.from ?? '').trim()
  const to = String(body.to ?? '').trim()
  const dateField: ImportDateField = body.dateField === 'arrival' ? 'arrival' : 'create'
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return buildApiError('from and to must be YYYY-MM-DD dates', 400)
  }
  if (from > to) {
    return buildApiError('"from" date must be on or before "to" date', 400)
  }

  const maxSpan = dateField === 'arrival' ? MAX_SPAN_DAYS_ARRIVAL : MAX_SPAN_DAYS_CREATE
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
  if (spanDays > maxSpan) {
    return buildApiError(`Date range too large — keep it within ${maxSpan} days.`, 400)
  }

  try {
    const jobId = await startAsImport({
      fromDate: from,
      toDate: to,
      dateField,
      mode: 'manual',
      triggeredById: session.user.id,
    })
    return buildApiSuccess({ jobId }, 'Import started')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start import'
    return buildApiError(msg, 500)
  }
}
