/**
 * Preview a report without sending it.
 *
 * `?format=html` returns the exact email body for the in-page iframe;
 * `?format=csv` returns the attachment; the default returns the structured data
 * so the dashboard can render its own summary. All three come from one
 * `buildReport()` call, so the preview cannot drift from what gets mailed.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { buildReport } from '@/lib/reports/report-runner'
import { getSchedule, normalizeSchedule, ScheduleValidationError } from '@/lib/reports/report-schedules'
import { DEFAULT_REPORT_TZ, REPORT_PERIODS, type ReportPeriod } from '@/lib/reports/report-window'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * Resolve the report shape to preview: an existing schedule by id, or an
 * ad-hoc one from query params (how the "what would a monthly report look
 * like?" button works before anything is saved).
 */
async function resolveShape(params: URLSearchParams) {
  const id = params.get('scheduleId')
  if (id) {
    const saved = await getSchedule(id)
    if (!saved) throw new ScheduleValidationError('Schedule not found.')
    return saved
  }

  const period = (params.get('period') ?? 'DAILY').toUpperCase() as ReportPeriod
  if (!REPORT_PERIODS.includes(period)) throw new ScheduleValidationError('Unknown report period.')

  const countries = (params.get('countries') ?? '').split(',').map(c => c.trim()).filter(Boolean)

  // `to` is required by the validator but irrelevant to a preview.
  return normalizeSchedule({
    name: 'Preview',
    period,
    timezone: params.get('timezone') || DEFAULT_REPORT_TZ,
    countries,
    to: ['preview@example.com'],
    maxRows: Number(params.get('maxRows') ?? '30'),
    aiSummary: params.get('aiSummary') === 'true',
  })
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session || !ADMIN_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  try {
    const shape = await resolveShape(req.nextUrl.searchParams)
    const built = await buildReport(shape, { testSend: true })
    const format = req.nextUrl.searchParams.get('format')

    if (format === 'html') {
      return new Response(built.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    if (format === 'csv') {
      const { fromDate, toDate } = built.data.window
      return new Response(built.csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="ops-report-${fromDate}-to-${toDate}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    return buildApiSuccess({ subject: built.subject, data: built.data })
  } catch (err) {
    if (err instanceof ScheduleValidationError) return buildApiError(err.message)
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reports] preview failed:', msg)
    return buildApiError(`Could not build the preview: ${msg}`, 500)
  }
}
