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
import { dateInTz, isValidDate } from '@/lib/reports/report-window'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  // `date` sends a chosen past period ("week 3") instead of the latest one.
  // `from`/`until` (sales report only) send a free date range instead — not
  // `to`, which is already the test recipient.
  let body: { id?: string; mode?: 'live' | 'test'; to?: string[] | string; date?: string | null; from?: string | null; until?: string | null }
  try {
    body = await req.json() as typeof body
  } catch {
    return buildApiError('Invalid JSON body')
  }

  if (!body.id) return buildApiError('Schedule id is required')

  const schedule = await getSchedule(body.id)
  if (!schedule) return buildApiError('Schedule not found', 404)

  const isTest = body.mode !== 'live'

  const date = body.date?.trim() || null
  if (date && !isValidDate(date)) return buildApiError('Report date must be a valid yyyy-mm-dd date.')
  if (date && date >= dateInTz(new Date(), schedule.timezone)) {
    return buildApiError('That period has not finished yet — pick one that has.')
  }

  const from = body.from?.trim() || null
  const until = body.until?.trim() || null
  if ((from || until) && schedule.reportType !== 'SALES') {
    return buildApiError('A date range can only be sent on a sales report.')
  }
  for (const v of [from, until]) {
    if (v && !isValidDate(v)) return buildApiError('Range dates must be valid yyyy-mm-dd dates.')
  }
  const start = from ?? until
  if (start && start > dateInTz(new Date(), schedule.timezone)) {
    return buildApiError('A report range cannot start in the future.')
  }
  const range = start ? { fromDate: start, toDate: until ?? start } : null

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
    anchorDate: date,
    range,
  })

  if (outcome.status === 'error') {
    return buildApiError(outcome.error ?? 'The report could not be sent.', 500)
  }

  const where = isTest ? overrideTo!.join(', ') : `${outcome.recipients} recipient(s)`
  return buildApiSuccess(outcome, `Report sent to ${where}`)
}
