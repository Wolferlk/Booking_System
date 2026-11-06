/** One WhatsApp chat group: read, change settings, archive. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  accessibleGroup, archiveGroup, canManageGroups, canViewGroups, getGroupDetail, groupsErrorResponse, updateGroup,
  type GroupPatch,
} from '@/lib/wa-groups/server'
import { settlePendingGroup } from '@/lib/wa-groups/chat'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canViewGroups(session.user.role)) return buildApiError('Forbidden', 403)
  try {
    const group = await accessibleGroup(params.id, session.user.role)
    if (group) await settlePendingGroup(params.id, group.name).catch(() => undefined)
    const detail = await getGroupDetail(params.id, session.user.role)
    return detail ? buildApiSuccess(detail) : buildApiError('Group not found', 404)
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as GroupPatch | null
  if (!body) return buildApiError('Invalid request body')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const problem = await updateGroup(params.id, body)
    return problem ? buildApiError(problem) : buildApiSuccess({ ok: true })
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    await archiveGroup(params.id)
    return buildApiSuccess({ ok: true }, 'Group archived')
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
