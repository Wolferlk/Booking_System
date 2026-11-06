/** Add bookings to a WhatsApp group, or take one out. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, addMembers, canManageGroups, groupsErrorResponse, removeMember } from '@/lib/wa-groups/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { refs?: unknown } | null
  const refs = Array.isArray(body?.refs) ? body.refs.filter((r): r is string => typeof r === 'string').slice(0, 100) : []
  if (refs.length === 0) return buildApiError('Pick at least one booking')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const actor = session.user.name ?? session.user.email ?? 'Staff'
    const r = await addMembers(params.id, refs, session.user.role, actor)
    return r.error ? buildApiError(r.error) : buildApiSuccess(r, `${r.added} added`)
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return buildApiError('ref is required')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    await removeMember(params.id, ref)
    return buildApiSuccess({ ok: true })
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
