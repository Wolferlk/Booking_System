import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { OPS_TOOLS } from '@/lib/ops-ai/registry'
import { executeTool, previewAction } from '@/lib/ops-ai/executor'
import { signAction } from '@/lib/ops-ai/signing'
import type { OpsActor } from '@/lib/ops-ai/context'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Resolves one function call made by the voice (Realtime) agent.
 *
 * This is the seam that keeps voice mode inside the same safety boundary as the
 * typed copilot:
 *   • READ calls run immediately and their data goes back to the model to speak.
 *   • WRITE / NAV calls DO NOT run. They are signed into a confirmation card —
 *     byte-for-byte the same envelope /api/ops-ai/execute expects — and returned
 *     for the panel to render. The model is only told the card was queued.
 *
 * The browser never executes anything from here; it relays READ output back into
 * the audio session and drops WRITE/NAV cards into the message thread.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)
  if (!hasPermission(role, 'booking:read')) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  const toolName = typeof body?.tool === 'string' ? body.tool : ''
  const args = (body?.args && typeof body.args === 'object') ? body.args as Record<string, unknown> : {}

  const tool = OPS_TOOLS[toolName]
  if (!tool) {
    return buildApiSuccess({ kind: 'ERROR', output: `Unknown capability "${toolName}".` })
  }

  const actor: OpsActor = {
    userId:    session.user.id,
    name:      session.user.name ?? 'Operator',
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  // Role gate mirrors the plan route: a capability the operator cannot run is
  // reported back to the model, not silently dropped.
  if (tool.permission?.length && !tool.permission.some(p => hasPermission(role, p))) {
    return buildApiSuccess({
      kind: 'DENIED',
      output: `The operator's role does not permit "${tool.label}".`,
    })
  }

  // READ — safe to run now; the model needs the data to answer aloud.
  if (tool.kind === 'READ') {
    const result = await executeTool(toolName, args, actor)
    return buildApiSuccess({
      kind: 'READ',
      output: JSON.stringify({ ok: result.ok, message: result.message, data: result.data ?? null }).slice(0, 20000),
      lookup: { tool: toolName, args, result: result.data ?? null, message: result.message },
    })
  }

  // WRITE / NAV — never executed here. Sign it into the exact confirmation card
  // the typed copilot produces, so approval flows through the same execute path.
  const action = {
    id:       `${Date.now()}-voice`,
    tool:     tool.name,
    kind:     tool.kind,
    label:    tool.label,
    icon:     tool.icon,
    preview:  await previewAction(tool.name, args, actor),
    envelope: signAction(tool.name, args, actor.userId),
  }

  return buildApiSuccess({
    kind: tool.kind,
    action,
    output: 'Queued as a confirmation card for the operator to approve. Do not repeat this call; tell them it is waiting for their tap.',
  })
}
