/**
 * One booking's complete feedback dossier.
 *
 *   GET /api/feedbacks/dossier?ref=IS48375              → JSON for the screen
 *   GET /api/feedbacks/dossier?ref=IS48375&format=html  → print-ready PDF page
 *
 * The HTML form is served inline and opens with the print dialog already
 * queued, so the browser renders the PDF. Same trade as the AI call report:
 * no headless Chromium on the Lambda.
 *
 * Read-only. GET only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { collectFeedbackDossier, normaliseRef } from '@/lib/feedbacks/collect'
import { renderDossierHtml } from '@/lib/feedbacks/html'
import { resolveViewer } from '../scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const scope = await resolveViewer(sp.get('country'))
  if (!scope.ok) return buildApiError(scope.error, scope.status)

  const ref = normaliseRef(sp.get('ref') ?? '')
  if (!ref) return buildApiError('A booking reference is required.', 400)

  const format = (sp.get('format') ?? 'json').toLowerCase()
  const includeTranscripts = sp.get('transcripts') !== '0'

  try {
    const dossier = await collectFeedbackDossier(ref, {
      countries: scope.viewer.countries,
      includeTranscripts,
    })

    if (!dossier) {
      // Deliberately the same answer whether the booking does not exist or sits
      // outside the viewer's country — a scoped user learns nothing either way.
      return buildApiError(`No booking you can view matches ${ref}.`, 404)
    }

    if (format === 'html' || format === 'pdf') {
      return new NextResponse(
        renderDossierHtml(dossier, { autoPrint: true, includeTranscripts, generatedBy: scope.viewer.name }),
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
      )
    }

    return buildApiSuccess(dossier)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[Feedbacks] dossier failed:', message)
    return buildApiError(`Could not build the dossier: ${message}`, 500)
  }
}
