/**
 * Preview a report without sending it.
 *
 * `?format=html` returns the exact email body for the in-page iframe;
 * `?format=csv` / `?format=xlsx` return the attachment the send would carry;
 * the default returns the structured data
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
// A preview is a live read of four systems, the slowest of which (the Apple
// System) routinely takes ~15s on its own. The platform default cuts that off
// mid-flight and returns a gateway page instead of JSON.
export const maxDuration = 60

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
 *
 * The cap has to be a slice the Apple System can actually answer inside, which
 * the original 8s was not: a day's quotation list takes ~15s even paged
 * concurrently, so every preview reported the upstream as unreachable while it
 * was merely slow. One attempt of 20s is the budget now: long enough for a
 * normal (slow) daily answer, and short enough that when the Apple System is
 * down the preview still comes back — with parity taken from the reconciler's
 * last run and marked as such — well inside {@link maxDuration} and the proxy's
 * own timeout. A week the upstream cannot list in 20s is shown the same way.
 */
const PREVIEW_AS_BUDGET_MS = Number(process.env.REPORT_PREVIEW_AS_BUDGET_MS || 20_000)
const PREVIEW_AS_TIMEOUT_MS = Number(process.env.REPORT_PREVIEW_AS_TIMEOUT_MS || 20_000)

/**
 * One build per report, not one per request.
 *
 * The drawer opens with two requests at once — the JSON for its stat strip and
 * `format=html` for the iframe — and the download buttons add a third. Each
 * used to build the whole report from scratch: two concurrent Apple System
 * reads (which slows the upstream down for both), two AI paragraphs, two
 * workbooks. Sharing the in-flight build halves all of that, and keeping it for
 * a few minutes makes stepping back to a week already viewed instant.
 *
 * Keyed on the full query minus `format`, so a different date, schedule or
 * draft setting always rebuilds. A failed build is dropped at once so a retry
 * really retries.
 */
const PREVIEW_CACHE_MS = 3 * 60_000
const previewCache = new Map<string, { at: number; built: Promise<Awaited<ReturnType<typeof buildReport>>> }>()

function previewKey(params: URLSearchParams): string {
  const copy = new URLSearchParams(params)
  copy.delete('format')
  copy.sort()
  return copy.toString()
}

function cachedBuild(key: string, build: () => ReturnType<typeof buildReport>): ReturnType<typeof buildReport> {
  const now = Date.now()
  previewCache.forEach((entry, k) => { if (now - entry.at > PREVIEW_CACHE_MS) previewCache.delete(k) })

  const hit = previewCache.get(key)
  if (hit) return hit.built

  const built = build()
  previewCache.set(key, { at: now, built })
  built.catch(() => previewCache.delete(key))
  return built
}

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

    const built = await cachedBuild(previewKey(req.nextUrl.searchParams), () => withAsDeadline(
      { budgetMs: PREVIEW_AS_BUDGET_MS, timeoutMs: PREVIEW_AS_TIMEOUT_MS },
      () => buildReport(shape, { testSend: true, anchorDate: date }),
    ))
    const format = req.nextUrl.searchParams.get('format')

    if (format === 'html') {
      return new Response(built.html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    }

    // The weekly and monthly reviews attach a workbook rather than a CSV, so
    // the drawer's download button asks for this instead. Falls through to the
    // CSV when a report shape has no workbook — a daily one never does.
    if (format === 'xlsx' && built.workbook) {
      const { fromDate, toDate } = built.window
      return new Response(new Uint8Array(built.workbook.buffer), {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${built.csvName}-${fromDate}-to-${toDate}.xlsx"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (format === 'csv' || format === 'xlsx') {
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
    // The uncapped booking lists exist for the CSV attachment only; sending
    // them to the drawer as well would double a month's payload for rows the
    // page never renders.
    const data = 'created' in built.data
      ? (() => {
          const { allBookings: _all, allOutside: _outside, ...created } = built.data.created
          // The periodic analytics carry their own uncapped row lists for the
          // workbook — a month's cancellations and every tour that operated.
          // The drawer renders none of them, so they are dropped here for the
          // same reason the booking lists are.
          const insights = built.data.insights
            ? {
                ...built.data.insights,
                cancellations: { ...built.data.insights.cancellations, lines: [] },
                delivery: { ...built.data.insights.delivery, lines: [] },
              }
            : null
          return { ...built.data, created, insights }
        })()
      : built.data
    return buildApiSuccess({ reportType: shape.reportType, subject: built.subject, data })
  } catch (err) {
    if (err instanceof ScheduleValidationError) return buildApiError(err.message)
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Reports] preview failed:', msg)
    return buildApiError(`Could not build the preview: ${msg}`, 500)
  }
}
