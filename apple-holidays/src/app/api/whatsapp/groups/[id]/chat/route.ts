/** A chat group's shared timeline: read it, or post to the group. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canManageGroups, canViewGroups, groupsErrorResponse } from '@/lib/wa-groups/server'
import { postMessage, readTimeline } from '@/lib/wa-groups/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ctx = { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canViewGroups(session.user.role)) return buildApiError('Forbidden', 403)
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    return buildApiSuccess(await readTimeline(params.id, { markRead: true }))
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { body?: string } | null
  const text = body?.body?.trim()
  if (!text) return buildApiError('Type a message first')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const r = await postMessage(params.id, text.slice(0, 4000), session.user.name ?? session.user.email ?? 'Staff')
    return r.error ? buildApiError(r.error) : buildApiSuccess(r)
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
