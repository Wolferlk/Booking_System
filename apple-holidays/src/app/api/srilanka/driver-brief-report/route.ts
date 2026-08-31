/**
 * D-3 → D-1 driver brief readiness, for the allocation board's own panel.
 *
 * `GET`  builds the report live. Defaults to Sri Lanka because that is the board
 *        that hosts it; `?country=ALL` widens it for a supervisor reading across
 *        operations.
 * `POST` mails the same report immediately, bypassing the once-a-day guard —
 *        the "send it to me now" button, restricted to the roles that own the
 *        board rather than everyone who can read it.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { buildBriefReadinessReport, runDriverBriefReport } from '@/lib/driver-brief-report'
import type { OperationCountry, UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SEND_ROLES: UserRole[] = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

function countryOf(req: NextRequest): OperationCountry | null {
  const raw = req.nextUrl.searchParams.get('country')
  if (raw === 'ALL') return null
  return (raw as OperationCountry) || ('SRILANKA' as OperationCountry)
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, 'booking:read')) return buildApiError('Forbidden', 403)

  const report = await buildBriefReadinessReport({ country: countryOf(req) })
  return buildApiSuccess(report)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!SEND_ROLES.includes(session.user.role as UserRole)) return buildApiError('Forbidden', 403)

  const result = await runDriverBriefReport({ country: countryOf(req), force: true })
  if (!result.sent) return buildApiError(result.reason ?? 'Report was not sent', 400)
  return buildApiSuccess(result, `Report sent to ${result.to?.join(', ')}`)
}
