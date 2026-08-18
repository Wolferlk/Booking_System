/**
 * One report: read it, or act on it.
 *
 * GET   — the full record, including the evidence dossier and the transcripts.
 *         Transcripts never go in the mail; this is where they are read.
 * POST  — every state change, discriminated by `action`. One route because
 *         they all operate on the same row and share the same guard rails.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireTeUser } from '@/lib/te/experience-report/auth'
import { getReport } from '@/lib/te/experience-report/store'
import {
  addNote, cancelReport, escalate, holdReport, regenerateReport,
  releaseHold, ReportError, sendToAgent,
} from '@/lib/te/experience-report/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Action = 'send' | 'escalate' | 'hold' | 'release' | 'cancel' | 'note' | 'regenerate'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  const report = await getReport(params.id)
  if (!report) return buildApiError('Report not found', 404)
  return buildApiSuccess(report)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const gate = await requireTeUser()
  if ('deny' in gate) return buildApiError(gate.deny === 'unauthorized' ? 'Unauthorized' : 'Forbidden', gate.deny === 'unauthorized' ? 401 : 403)

  let body: {
    action?: Action
    note?: string
    reason?: string
    agentEmailOverride?: string
    extraCc?: string[]
    escalationTo?: string
    overrideHold?: boolean
    skipNarrative?: boolean
  } = {}
  try { body = await req.json() } catch { /* empty body */ }

  const actor = gate.actor.label
  const id = params.id

  try {
    switch (body.action) {
      case 'send': {
        const report = await sendToAgent(id, {
          actor,
          agentEmailOverride: body.agentEmailOverride ?? null,
          extraCc: body.extraCc,
          overrideHold: body.overrideHold,
          note: body.note ?? null,
        })
        return buildApiSuccess(report, `Report sent to ${report.toEmail}.`)
      }

      case 'escalate': {
        const report = await escalate(id, {
          actor,
          note: body.note ?? null,
          toOverride: body.escalationTo ?? null,
        })
        return buildApiSuccess(report, `Escalation sent to ${report.escalationTo}. The agent has not been contacted.`)
      }

      case 'hold':
        return buildApiSuccess(
          await holdReport(id, actor, body.reason ?? ''),
          'Report held. It will not reach the agent.',
        )

      case 'release':
        return buildApiSuccess(
          await releaseHold(id, actor, body.note ?? ''),
          'Hold cleared. The report is back in the review queue.',
        )

      case 'cancel':
        return buildApiSuccess(
          await cancelReport(id, actor, body.reason ?? null),
          'Report cancelled.',
        )

      case 'note':
        return buildApiSuccess(await addNote(id, actor, body.note ?? ''), 'Note added.')

      case 'regenerate':
        return buildApiSuccess(
          await regenerateReport(id, actor, { skipNarrative: body.skipNarrative }),
          'Report rewritten against the latest feedback.',
        )

      default:
        return buildApiError('Unknown action.', 422)
    }
  } catch (err) {
    if (err instanceof ReportError) return buildApiError(err.message, 422)
    return buildApiError(err instanceof Error ? err.message : 'The action failed')
  }
}
