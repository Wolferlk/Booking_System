/**
 * Configuration for the daily AI call-report email.
 *
 * GET  — current settings, recent runs and the next send time.
 * PUT  — save settings (recipients, time, coverage).
 * POST — send now (`{ test: true, to: [...] }` sends a one-off copy without
 *        consuming the day's slot).
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { reportSenderAddress } from '@/lib/reports/report-mailer'
import { normalizeEmails } from '@/lib/reports/report-schedules'
import {
  CallReportConfigError, checkCallReportDue, COVERAGE_LABEL, getCallReportSchedule,
  listCallReportRuns, nextCallReportRunAt, runCallReport, saveCallReportSchedule,
} from '@/lib/te/call-report-schedule'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Reading the schedule is operational; changing where guest data is mailed is not. */
const READ_ROLES = ['TE_USER', 'GT_TE_USER', 'BT_USER', 'GT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const WRITE_ROLES = ['TE_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function session(roles: string[]) {
  const s = await getServerSession(authOptions)
  if (!s || !roles.includes(s.user.role)) return null
  return s
}

export async function GET() {
  if (!(await session(READ_ROLES))) return buildApiError('Forbidden', 403)

  const now = new Date()
  const [config, runs] = await Promise.all([getCallReportSchedule(), listCallReportRuns()])
  const due = checkCallReportDue(config, now)

  return buildApiSuccess({
    config,
    runs,
    nextRunAt: nextCallReportRunAt(config, now),
    dueNow: due.due,
    dueReason: due.reason,
    coverageLabel: COVERAGE_LABEL[config.coverage],
    sender: reportSenderAddress(),
  })
}

export async function PUT(req: NextRequest) {
  const s = await session(WRITE_ROLES)
  if (!s) return buildApiError('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return buildApiError('Invalid JSON body')
  }

  try {
    const config = await saveCallReportSchedule(body, s.user.email ?? s.user.name ?? null)
    return buildApiSuccess({
      config,
      nextRunAt: nextCallReportRunAt(config),
      coverageLabel: COVERAGE_LABEL[config.coverage],
    }, 'Daily report settings saved')
  } catch (err) {
    if (err instanceof CallReportConfigError) return buildApiError(err.message)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[CallReport] save failed:', message)
    return buildApiError('Could not save the schedule', 500)
  }
}

export async function POST(req: NextRequest) {
  const s = await session(WRITE_ROLES)
  if (!s) return buildApiError('Forbidden', 403)

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // Body is optional — a bare POST means "send the real thing now".
  }

  const test = body.test === true
  const overrideTo = body.to !== undefined ? normalizeEmails(body.to) : []
  if (test && !overrideTo.length) {
    return buildApiError('Enter an address to send the test to.')
  }

  const result = await runCallReport({
    trigger: test ? 'test' : 'manual',
    triggeredBy: s.user.email ?? s.user.name ?? null,
    force: true,
    testSend: test,
    overrideTo,
  })

  if (result.status === 'error') return buildApiError(result.error ?? 'Send failed', 502)
  if (result.status === 'skipped') return buildApiSuccess(result, result.reason ?? 'Nothing to send')

  return buildApiSuccess(
    { status: result.status, recipients: result.recipients, subject: result.subject },
    `Report sent to ${result.recipients} recipient${result.recipients === 1 ? '' : 's'}`,
  )
}
