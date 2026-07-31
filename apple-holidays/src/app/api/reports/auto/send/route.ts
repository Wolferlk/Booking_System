/**
 * Manual send — "Send now" and "Send me a test" from the dashboard.
 *
 * Both force past the once-per-slot guard, because an operator clicking the
 * button has already decided. A test send additionally leaves the schedule's
 * `lastRunKey` untouched, so firing a test at 07:55 does not swallow the real
 * 08:00 send.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { runSchedule } from '@/lib/reports/report-runner'
import { getSchedule, normalizeEmails } from '@/lib/reports/report-schedules'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  let body: { id?: string; mode?: 'live' | 'test'; to?: string[] | string }
  try {
    body = await req.json() as typeof body
  } catch {
    return buildApiError('Invalid JSON body')
  }

  if (!body.id) return buildApiError('Schedule id is required')

  const schedule = await getSchedule(body.id)
  if (!schedule) return buildApiError('Schedule not found', 404)

  const isTest = body.mode !== 'live'

  // A test defaults to the requesting admin, so nobody can accidentally blast
  // the full CC list while trying out a layout change.
  const overrideTo = isTest
    ? normalizeEmails(body.to ?? session.user.email ?? '')
    : undefined

  if (isTest && !overrideTo?.length) {
    return buildApiError('No test recipient — your account has no email address, so pass one explicitly.')
  }

  const outcome = await runSchedule(schedule, {
    trigger: isTest ? 'test' : 'manual',
    triggeredBy: session.user.email ?? session.user.name ?? null,
    force: true,
    testSend: isTest,
    overrideTo,
  })

  if (outcome.status === 'error') {
    return buildApiError(outcome.error ?? 'The report could not be sent.', 500)
  }

  const where = isTest ? overrideTo!.join(', ') : `${outcome.recipients} recipient(s)`
  return buildApiSuccess(outcome, `Report sent to ${where}`)
}
