import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { executeTool } from '@/lib/ops-ai/executor'
import { verifyAction, type SignedEnvelope } from '@/lib/ops-ai/signing'
import type { OpsActor } from '@/lib/ops-ai/context'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Runs one confirmed OPS_AI action.
 *
 * Two independent gates: the envelope signature proves the action is the exact
 * one this user was shown, and the executor re-derives RBAC and country scope
 * from the live session — a valid signature alone never authorises anything.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const role = session.user.role as UserRole
  if (role === 'CLIENT') return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null)
  const verified = verifyAction(body?.envelope as SignedEnvelope | undefined, session.user.id)
  if (!verified.ok) return buildApiError(verified.reason, 400)

  const actor: OpsActor = {
    userId:    session.user.id,
    name:      session.user.name ?? 'Operator',
    role,
    country:   (session.user as { country?: string }).country,
    countries: (session.user as { countries?: string[] }).countries,
  }

  const result = await executeTool(verified.tool, verified.args, actor)
  if (!result.ok) return buildApiError(result.message, 400)

  return buildApiSuccess(result)
}
