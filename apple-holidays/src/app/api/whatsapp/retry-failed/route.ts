/**
 * WhatsApp inbox — "Retry today's failed".
 *   GET  ?since=<ISO>  → what failed since then, why, and which can be retried
 *   POST { since }     → resend the next batch of retryable ones
 * `since` is the desk's local midnight, worked out in the browser.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { WHATSAPP_STAFF_ROLES } from '@/lib/whatsapp'
import { listFailedSince, retryFailedSince } from '@/lib/whatsapp-failed-retry'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function parseSince(raw: string | null | undefined): Date | null {
  const d = raw ? new Date(raw) : null
  if (!d || Number.isNaN(d.getTime())) return null
  // "Today" — never further back than two days, whatever the browser sends.
  return d.getTime() < Date.now() - 2 * 86400000 ? null : d
}

async function staff() {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }
  if (!(WHATSAPP_STAFF_ROLES as readonly string[]).includes(session.user.role as UserRole)) {
    return { error: buildApiError('Forbidden', 403) }
  }
  return { session }
}

export async function GET(req: NextRequest) {
  const auth = await staff()
  if ('error' in auth) return auth.error
  const { session } = auth
  const since = parseSince(req.nextUrl.searchParams.get('since'))
  if (!since) return buildApiError('since must be a recent ISO date')
  return buildApiSuccess(await listFailedSince(since, session.user.role))
}

export async function POST(req: NextRequest) {
  const auth = await staff()
  if ('error' in auth) return auth.error
  const { session } = auth
  const body = await req.json().catch(() => ({})) as { since?: string }
  const since = parseSince(body.since)
  if (!since) return buildApiError('since must be a recent ISO date')

  const out = await retryFailedSince(since, session.user.role, session.user.name ?? session.user.email ?? 'Staff')
  return buildApiSuccess(out, `Resent ${out.retried}${out.failed.length ? `, ${out.failed.length} could not be sent` : ''}`)
}
