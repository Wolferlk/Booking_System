/**
 * Auto-report schedules — list, create, update, and the master switch.
 *
 * Admin-only: a schedule can mail booking volumes, guest names and complaint
 * transcripts to arbitrary external addresses, so creating one is an
 * administrative act, not an operational one.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { DEFAULT_REPORT_TZ } from '@/lib/reports/report-window'
import { reportSenderAddress } from '@/lib/reports/report-mailer'
import { checkDue, describeCadence, nextRunAt } from '@/lib/reports/report-runner'
import {
  deleteSchedule, isAutoReportEnabled, listRuns, listSchedules,
  ScheduleValidationError, setAutoReportEnabled, upsertSchedule,
  type ReportSchedule,
} from '@/lib/reports/report-schedules'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return null
  return session
}

/** Adds the derived, non-persisted fields the UI needs. */
function decorate(s: ReportSchedule, now: Date) {
  const due = checkDue(s, now)
  return {
    ...s,
    cadence: describeCadence(s),
    nextRunAt: nextRunAt(s, now),
    dueNow: due.due,
    dueReason: due.reason,
    recipientCount: s.to.length + s.cc.length + s.bcc.length,
  }
}

export async function GET() {
  if (!(await requireAdmin())) return buildApiError('Forbidden', 403)

  const now = new Date()
  const [schedules, runs, enabled] = await Promise.all([
    listSchedules(),
    listRuns(30),
    isAutoReportEnabled(),
  ])

  const failing = schedules.filter(s => s.lastStatus === 'error').length

  return buildApiSuccess({
    schedules: schedules.map(s => decorate(s, now)),
    runs,
    masterEnabled: enabled,
    sender: reportSenderAddress(),
    defaultTimezone: DEFAULT_REPORT_TZ,
    serverTime: now.toISOString(),
    summary: {
      total: schedules.length,
      enabled: schedules.filter(s => s.enabled).length,
      failing,
      recipients: new Set(schedules.flatMap(s => [...s.to, ...s.cc, ...s.bcc])).size,
    },
  })
}

/** Create or update a schedule. An `id` in the body means update. */
export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return buildApiError('Forbidden', 403)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return buildApiError('Invalid JSON body')
  }

  // The master switch shares this route so the UI has one endpoint to talk to.
  if (body.action === 'setMasterSwitch') {
    await setAutoReportEnabled(body.enabled === true)
    return buildApiSuccess({ masterEnabled: body.enabled === true },
      body.enabled === true ? 'Automatic reports resumed' : 'Automatic reports paused')
  }

  try {
    const saved = await upsertSchedule(body, session.user.email ?? session.user.name ?? null)
    return buildApiSuccess(
      decorate(saved, new Date()),
      body.id ? 'Schedule updated' : 'Schedule created',
    )
  } catch (err) {
    if (err instanceof ScheduleValidationError) return buildApiError(err.message)
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reports] save failed:', msg)
    return buildApiError(`Could not save the schedule: ${msg}`, 500)
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return buildApiError('Forbidden', 403)

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return buildApiError('Schedule id is required')

  const removed = await deleteSchedule(id)
  if (!removed) return buildApiError('Schedule not found', 404)
  return buildApiSuccess({ id }, 'Schedule deleted')
}
