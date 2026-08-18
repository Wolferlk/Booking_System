/**
 * The report list, and building a new one.
 *
 * GET  — the history: every report ever prepared, sent, held or cancelled.
 * POST — build a report for one booking. Building never sends; it grades the
 *        trip and parks the result for a person (or the sweep) to act on. A
 *        trip with no call and no feedback form is parked as `pending` rather
 *        than refused — the evidence is still worth having on screen.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireTeUser } from '@/lib/te/experience-report/auth'
import { listReports, getSettings } from '@/lib/te/experience-report/store'
import { buildReport, ReportError } from '@/lib/te/experience-report/run'
import type { ReportStatus } from '@/lib/te/experience-report/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  const q = req.nextUrl.searchParams

  try {
    const [result, settings] = await Promise.all([
      listReports({
        status: (q.get('status') as ReportStatus | 'all' | null) ?? 'all',
        riskLevel: q.get('risk') ?? 'all',
        search: q.get('search') ?? undefined,
        from: q.get('from') ?? undefined,
        to: q.get('to') ?? undefined,
        limit: q.get('limit') ? Number(q.get('limit')) : undefined,
        offset: q.get('offset') ? Number(q.get('offset')) : undefined,
      }),
      getSettings(),
    ])
    return buildApiSuccess({ ...result, settings })
  } catch (err) {
    return buildApiError(err instanceof Error ? err.message : 'Could not load reports')
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  let body: { bookingRef?: string; skipNarrative?: boolean; draftOnly?: boolean } = {}
  try { body = await req.json() } catch { /* empty body */ }

  const bookingRef = body.bookingRef?.trim().toUpperCase()
  if (!bookingRef) return buildApiError('A booking reference is required.', 422)

  try {
    const report = await buildReport({
      bookingRef,
      actor: gate.actor.label,
      trigger: 'manual',
      skipNarrative: body.skipNarrative,
      // A person building by hand always reviews before sending; the sweep is
      // the only caller allowed to go straight out.
      draftOnly: body.draftOnly ?? true,
    })
    return buildApiSuccess(
      report,
      report.status === 'held'
        ? 'Report built and held — this trip had a bad experience.'
        : report.status === 'pending'
        ? 'No call and no feedback form for this trip, so nothing was written. Add your own summary and it will be built from that.'
        : 'Report built and ready to review.',
    )
  } catch (err) {
    if (err instanceof ReportError) return buildApiError(err.message, 422)
    return buildApiError(err instanceof Error ? err.message : 'Could not build the report')
  }
}
