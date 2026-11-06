/** Turn a chat group into a real WhatsApp group, or send its invite link. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canManageGroups, groupsErrorResponse } from '@/lib/wa-groups/server'
import { makeRealGroup, sendInvites } from '@/lib/wa-groups/chat'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { action?: string } | null
  try {
    const group = await accessibleGroup(params.id, session.user.role)
    if (!group) return buildApiError('Group not found', 404)
    if (body?.action === 'invite') {
      const r = await sendInvites(params.id, group.name)
      return r.error ? buildApiError(r.error) : buildApiSuccess(r, `Invite sent to ${r.sent}`)
    }
    const problem = await makeRealGroup(params.id, group.name)
    return problem ? buildApiError(problem) : buildApiSuccess({ ok: true }, 'WhatsApp group created')
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
