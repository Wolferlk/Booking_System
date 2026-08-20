/**
 * GET /api/srilanka/drive-log — the Drive Log's rows.
 *
 * Read-only, in both databases. Gated on `pnl:read` rather than `booking:read`:
 * every column on this screen is money, so the roles that may not see a P&L may
 * not see this either.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { parseDriveLogQuery, driveLogTotals } from '@/lib/sl-drive-log'
import { fetchDriveLogRows } from '@/lib/sl-drive-log-server'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
// The accounts reads are MySQL over TLS and the payloads are parsed here.
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'pnl:read')) return buildApiError('Forbidden', 403)

  const q = parseDriveLogQuery(req.nextUrl.searchParams)

  try {
    const result = await fetchDriveLogRows(q)
    return buildApiSuccess({
      ...result,
      query: q,
      totals: driveLogTotals(result.rows),
    })
  } catch (err) {
    console.error('[srilanka/drive-log]', err)
    return buildApiError('Failed to load the drive log', 500)
  }
}
