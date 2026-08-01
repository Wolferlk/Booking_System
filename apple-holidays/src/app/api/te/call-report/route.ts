/**
 * The AI voice-call report — JSON for the dashboard, CSV/HTML for downloads.
 *
 * The filters map straight onto `collectCallReport()`; `format` decides whether
 * the caller gets data to render or a file to keep.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  collectCallReport, renderCallReportCsv,
  type CallPhase, type CallReportFilters, type CallReportScope,
} from '@/lib/te/call-report-data'
import { renderCallReportHtml } from '@/lib/te/call-report-html'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED_ROLES = ['TE_USER', 'GT_TE_USER', 'BT_USER', 'GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

const SCOPES: CallReportScope[] = ['day', 'month', 'range', 'assign_day']
const PHASES: CallPhase[] = ['pre_tour', 'on_tour', 'post_tour']

function parseFilters(sp: URLSearchParams): CallReportFilters {
  const scope = SCOPES.includes(sp.get('scope') as CallReportScope)
    ? (sp.get('scope') as CallReportScope)
    : 'day'
  const phaseParam = sp.get('phase')
  return {
    scope,
    date: sp.get('date') ?? undefined,
    month: sp.get('month') ?? undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    timezone: sp.get('tz') ?? undefined,
    search: sp.get('search') ?? undefined,
    onlyUrgent: sp.get('urgent') === '1' || sp.get('urgent') === 'true',
    phase: PHASES.includes(phaseParam as CallPhase) ? (phaseParam as CallPhase) : 'all',
  }
}

/** `AI-Call-Report-2026-08-01.csv` — stable, sortable, safe on every OS. */
function fileStem(from: string, to: string): string {
  return `AI-Call-Report-${from}${to !== from ? `_to_${to}` : ''}`
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!ALLOWED_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  const sp = req.nextUrl.searchParams
  const format = (sp.get('format') ?? 'json').toLowerCase()

  try {
    const data = await collectCallReport(parseFilters(sp))
    const stem = fileStem(data.window.fromDate, data.window.toDate)

    if (format === 'csv') {
      return new NextResponse(renderCallReportCsv(data), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${stem}.csv"`,
        },
      })
    }

    if (format === 'html' || format === 'pdf') {
      // Served inline: the page opens print-ready so the browser can save it as
      // a PDF, which keeps a headless renderer off the Lambda.
      return new NextResponse(renderCallReportHtml(data, { standalone: true, maxRows: 500 }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return buildApiSuccess(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[CallReport] build failed:', message)
    return buildApiError(`Could not build the report: ${message}`, 502)
  }
}
