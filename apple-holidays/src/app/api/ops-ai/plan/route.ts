import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { OPS_TOOLS } from '@/lib/ops-ai/registry'
import { buildSystemPrompt, planTurn } from '@/lib/ops-ai/brain'
import { bookingRefFromPath, loadBookingSnapshot, type OpsActor } from '@/lib/ops-ai/context'
import { executeTool, previewAction } from '@/lib/ops-ai/executor'
import { signAction } from '@/lib/ops-ai/signing'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * OPS_AI planning endpoint.
 *
 * Takes a natural-language instruction plus the page the user is on, and returns
 * a reply, any read-only lookups the agent performed, and a set of *proposed*
 * actions. Nothing that mutates data runs here — proposals come back signed and
 * are executed only when the user clicks Run, via /api/ops-ai/execute.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  // The copilot is a staff tool; clients use the read-only portal.
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  if (!process.env.OPENAI_API_KEY) {
    return buildApiError('OPS_AI is not configured — OPENAI_API_KEY is missing.', 503)
  }

  const body = await req.json().catch(() => null)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!message) return buildApiError('Say something for OPS_AI to work on.')
  if (message.length > 4000) return buildApiError('That instruction is too long.')

  const actor: OpsActor = {
    userId:    session.user.id,
    name:      session.user.name ?? 'Operator',
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const pathname   = typeof body?.pathname === 'string' ? body.pathname : undefined
  const bookingRef = (typeof body?.bookingRef === 'string' && body.bookingRef) || bookingRefFromPath(pathname)
  const snapshot   = bookingRef ? await loadBookingSnapshot(bookingRef.toUpperCase(), actor) : null

  const history = Array.isArray(body?.history)
    ? body.history
        .filter((m: unknown): m is { role: string; content: string } =>
          Boolean(m) && typeof (m as { content?: unknown }).content === 'string')
        .map((m: { role: string; content: string }) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content.slice(0, 2000),
        }))
    : []

  let plan
  try {
    plan = await planTurn({
      system:     buildSystemPrompt(actor, snapshot, pathname),
      history,
      message,
      bookingRef: snapshot?.bookingRef ?? bookingRef ?? null,
      isReadTool: (tool: string) => OPS_TOOLS[tool]?.kind === 'READ',
      runRead:    (tool, args) => executeTool(tool, args, actor),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OPS_AI] plan failed:', msg)
    return buildApiError(`OPS_AI could not process that: ${msg}`, 502)
  }

  // Turn each proposal into a signed, previewable action card. Proposals the
  // user's role cannot run are dropped here rather than failing on click.
  const actions = []
  for (const call of plan.proposals) {
    const tool = OPS_TOOLS[call.tool]
    if (!tool) continue
    if (tool.permission?.length && !tool.permission.some(p => hasPermission(role, p))) continue

    actions.push({
      id:       `${Date.now()}-${actions.length}`,
      tool:     tool.name,
      kind:     tool.kind,
      label:    tool.label,
      icon:     tool.icon,
      preview:  await previewAction(tool.name, call.args, actor),
      envelope: signAction(tool.name, call.args, actor.userId),
    })
  }

  return buildApiSuccess({
    reply:      plan.reply,
    actions,
    lookups:    plan.lookups,
    bookingRef: snapshot?.bookingRef ?? null,
  })
}
