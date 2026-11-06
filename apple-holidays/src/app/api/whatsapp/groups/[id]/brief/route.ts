/** The booking at a glance, for the trip panel beside a group chat. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canViewGroups, getGuestBrief, groupsErrorResponse } from '@/lib/wa-groups/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canViewGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const ref = req.nextUrl.searchParams.get('ref')
  if (!ref) return buildApiError('ref is required')
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const member = await prisma.waBookingGroupMember.findFirst({ where: { groupId: params.id, bookingRef: ref }, select: { id: true } })
    if (!member) return buildApiError('That booking is not in this group', 404)
    const brief = await getGuestBrief(ref)
    return brief ? buildApiSuccess(brief) : buildApiError('Booking not found', 404)
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
