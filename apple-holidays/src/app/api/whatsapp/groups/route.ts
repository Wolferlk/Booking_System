/** WhatsApp chat groups: list, and create one for a booking. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { archiveGroup, attachBooking, canManageGroups, canViewGroups, createGroup, findGroupForBooking, groupsErrorResponse, listGroups } from '@/lib/wa-groups/server'
import { isGroupColor } from '@/lib/wa-groups/shared'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canViewGroups(session.user.role)) return buildApiError('Forbidden', 403)
  try {
    return buildApiSuccess(await listGroups(session.user.role))
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { name?: string; color?: string; ref?: string } | null
  const name = body?.name?.trim()
  if (!name || !body?.ref) return buildApiError('A group needs a name and a booking')
  try {
    // One booking, one chat: asking again opens the group it already has.
    const existing = await findGroupForBooking(body.ref)
    if (existing) return buildApiSuccess({ id: existing, existing: true }, 'This booking already has a group')
    const actor = session.user.name ?? session.user.email ?? 'Staff'
    const group = await createGroup(name, isGroupColor(body.color) ? body.color : 'emerald', actor)
    const problem = await attachBooking(group.id, body.ref, session.user.role)
    if (problem) {
      await archiveGroup(group.id)
      return buildApiError(problem)
    }
    return buildApiSuccess({ id: group.id }, 'Group created')
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
