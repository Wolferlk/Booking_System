/**
 * The bulk feedback report — many booking refs in, one detailed report out.
 *
 *   POST { refs, format }   → json | html | csv   (the path the UI uses)
 *   GET  ?refs=A,B&format=  → same, for a shareable link
 *
 * POST exists because the bulk tab is fed by a paste that can run to hundreds
 * of references — well past what a URL will carry — and because the printed
 * report is opened from a blob on the client rather than a navigation.
 *
 * Read-only: nothing in this route or anything it calls writes to the database.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { collectFeedbackBatch, parseRefList } from '@/lib/feedbacks/collect'
import { renderBatchCsv, renderBatchHtml } from '@/lib/feedbacks/html'
import { resolveViewer } from '../scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * A ceiling, not a guess: each ref pulls rows from eight tables and the printed
 * report renders every one of them. Past this the request stops being a report
 * and starts being an export, and it should be paged instead.
 */
const MAX_REFS = 300

interface Body {
  refs?: string | string[]
  format?: string
  transcripts?: boolean
  country?: string | null
}

async function build(req: NextRequest, body: Body) {
  const scope = await resolveViewer(body.country ?? null)
  if (!scope.ok) return buildApiError(scope.error, scope.status)

  const raw = Array.isArray(body.refs) ? body.refs.join('\n') : (body.refs ?? '')
  const refs = parseRefList(raw)

  if (!refs.length) return buildApiError('Paste at least one booking reference.', 400)
  if (refs.length > MAX_REFS) {
    return buildApiError(`That is ${refs.length} references — this report handles up to ${MAX_REFS} at a time. Split the list and run it twice.`, 400)
  }

  const format = (body.format ?? 'json').toLowerCase()
  // Transcripts roughly triple the payload, so they are opt-in for a batch.
  const includeTranscripts = body.transcripts === true

  try {
    const report = await collectFeedbackBatch(refs, {
      countries: scope.viewer.countries,
      includeTranscripts,
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const stem = `Feedback-Report-${report.totals.found}-bookings-${stamp}`

    if (format === 'csv') {
      return new NextResponse(renderBatchCsv(report), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${stem}.csv"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    if (format === 'html' || format === 'pdf') {
      return new NextResponse(
        renderBatchHtml(report, { autoPrint: true, includeTranscripts, generatedBy: scope.viewer.name }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      )
    }

    return buildApiSuccess(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Feedbacks] batch report failed:', message)
    return buildApiError(`Could not build the report: ${message}`, 500)
  }
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return buildApiError('Expected a JSON body.', 400)
  }
  return build(req, body)
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  return build(req, {
    refs: sp.get('refs') ?? '',
    format: sp.get('format') ?? 'json',
    transcripts: sp.get('transcripts') === '1',
    country: sp.get('country'),
  })
}
