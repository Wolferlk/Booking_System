import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { startAsImport } from '@/lib/as-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
function yesterdayInTz(): string {
  const d = new Date(`${todayInTz()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * POST /api/as-bookings-v2/auto-import/run — "Run yesterday now".
 * Manually triggers the same import the 6 AM job does (yesterday's status-2
 * confirmations), in the background. Returns a jobId to poll.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  const role = session.user.role
  if (role === 'CLIENT' || !hasPermission(role, 'booking:create')) {
    return buildApiError('Forbidden', 403)
  }

  const yesterday = yesterdayInTz()
  try {
    const jobId = await startAsImport({
      fromCreateDate: yesterday,
      toCreateDate: yesterday,
      mode: 'auto',
      triggeredById: session.user.id,
    })
    return buildApiSuccess({ jobId, createDate: yesterday }, 'Import started')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to start import'
    return buildApiError(msg, 500)
  }
}
