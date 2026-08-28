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
import { withAsDeadline } from '@/lib/applesystem'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { buildReport } from '@/lib/reports/report-runner'
import {
  getSchedule, normalizeSchedule, REPORT_TYPES, ScheduleValidationError, type ReportType,
} from '@/lib/reports/report-schedules'
import { DEFAULT_REPORT_TZ, REPORT_PERIODS, dateInTz, isValidDate, type ReportPeriod } from '@/lib/reports/report-window'

export const dynamic = 'force-dynamic'

const ADMIN_ROLES = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/**
 * How long a preview may spend on the Apple System before giving up on it.
 *
 * Both report shapes open with an upstream read, and the client is a browser
 * behind a serverless response limit: when the Apple System stalls, the default
 * retry ladder spends over a minute on it, the platform cuts the response off
 * and the drawer gets a gateway HTML page where it expected JSON. A preview
 * would rather show the section as unavailable — every collector already
 * degrades that way — than show nothing at all, so it caps the upstream at a
 * slice of its own deadline. The scheduled send keeps the patient defaults.
 */
const PREVIEW_AS_BUDGET_MS = Number(process.env.REPORT_PREVIEW_AS_BUDGET_MS || 20_000)
const PREVIEW_AS_TIMEOUT_MS = Number(process.env.REPORT_PREVIEW_AS_TIMEOUT_MS || 8_000)

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

  const reportType = (params.get('reportType') ?? 'OPS').toUpperCase() as ReportType
  if (!REPORT_TYPES.includes(reportType)) throw new ScheduleValidationError('Unknown report type.')

  const countries = (params.get('countries') ?? '').split(',').map(c => c.trim()).filter(Boolean)

  // `to` is required by the validator but irrelevant to a preview.
  return normalizeSchedule({
    name: 'Preview',
    reportType,
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

    // `?date=yyyy-mm-dd` back-dates the preview to the day, week or month that
    // date falls in. Rejected rather than silently ignored: a typo'd date that
    // quietly returned yesterday's numbers is exactly the kind of wrong nobody
    // catches. Future dates are refused too — there is no business to report.
    const date = req.nextUrl.searchParams.get('date')
    if (date && !isValidDate(date)) throw new ScheduleValidationError('Report date must be a valid yyyy-mm-dd date.')
    if (date && date > dateInTz(new Date(), shape.timezone)) {
      throw new ScheduleValidationError('Report date cannot be in the future.')
    }

    const built = await withAsDeadline(
      { budgetMs: PREVIEW_AS_BUDGET_MS, timeoutMs: PREVIEW_AS_TIMEOUT_MS },
      () => buildReport(shape, { testSend: true, anchorDate: date }),
    )
    const format = req.nextUrl.searchParams.get('format')

    if (format === 'html') {
      return new Response(built.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    if (format === 'csv') {
      const { fromDate, toDate } = built.window
      return new Response(built.csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${built.csvName}-${fromDate}-to-${toDate}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // `reportType` is echoed back because the two report shapes share this
    // endpoint: the drawer needs to know which one it is holding before it
    // reads a single field off `data`.
    return buildApiSuccess({ reportType: shape.reportType, subject: built.subject, data: built.data })
  } catch (err) {
    if (err instanceof ScheduleValidationError) return buildApiError(err.message)
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reports] preview failed:', msg)
    return buildApiError(`Could not build the preview: ${msg}`, 500)
  }
}
