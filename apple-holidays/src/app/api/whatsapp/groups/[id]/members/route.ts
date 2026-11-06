/** Link a chat group to its one booking, for groups made before bookings were required. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, attachBooking, canManageGroups, findGroupForBooking, groupsErrorResponse } from '@/lib/wa-groups/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { ref?: string } | null
  if (!body?.ref) return buildApiError('Pick a booking')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    if (await findGroupForBooking(body.ref)) return buildApiError('That booking already has a group')
    const problem = await attachBooking(params.id, body.ref, session.user.role)
    return problem ? buildApiError(problem) : buildApiSuccess({ ok: true }, 'Booking linked')
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
