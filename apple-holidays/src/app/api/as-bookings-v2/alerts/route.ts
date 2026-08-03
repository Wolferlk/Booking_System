/**
 * Open AppleSystem-import failure alerts, for the dashboard login banner.
 *
 * GET  — every unacknowledged alert (newest first).
 * POST — acknowledge one (`{ id }`) or all of them (`{ all: true }`).
 *
 * Acknowledgement is deliberately global: once any staff member has seen the
 * failure, it stops interrupting the rest of the team's logins.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { listOpenAsImportAlerts, acknowledgeAsImportAlerts } from '@/lib/as-import-alerts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  // Clients never see back-office import health.
  if (session.user.role === 'CLIENT') return buildApiSuccess({ alerts: [] })

  const alerts = await listOpenAsImportAlerts()
  return buildApiSuccess({ alerts })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (session.user.role === 'CLIENT') return buildApiError('Forbidden', 403)

  let body: { id?: string; all?: boolean }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const by = session.user.name || session.user.email || 'Unknown user'
  const acknowledged = await acknowledgeAsImportAlerts(by, body.all ? undefined : body.id)

  return buildApiSuccess({ acknowledged })
}
