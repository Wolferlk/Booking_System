/** Shared request handling for the Ticket Issue Desk routes. */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'
import { DeskError, type DeskUser } from './desk'
import { OtpError } from './otp'

export const TABLES_NOT_READY = 'The Ticket Issue Desk tables are not on this database yet — run prisma/sql/apply-ticket-portal-issue.sh.'

export function isTableMissing(err: unknown) {
  const e = err as { code?: string; message?: string }
  return e?.code === 'P2021' || /doesn't exist|1146/.test(e?.message ?? '')
}

export async function deskRoute(permission: 'ticket:read' | 'ticket:purchase', work: (user: DeskUser) => Promise<{ data: unknown; message?: string }>) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return buildApiError('Unauthorized', 401)
  if (!hasPermission(session.user.role as UserRole, permission)) return buildApiError('Forbidden', 403)
  try {
    const { data, message } = await work(session.user as DeskUser)
    return buildApiSuccess(data, message)
  } catch (err) {
    if (err instanceof DeskError || err instanceof OtpError) return buildApiError(err.message, err.status)
    if (isTableMissing(err)) return buildApiError(TABLES_NOT_READY, 503)
    console.error('[ticket-portal] request failed', err)
    return buildApiError(err instanceof Error ? err.message.split('\n').pop()?.trim() || 'Something went wrong' : 'Something went wrong', 500)
  }
}
