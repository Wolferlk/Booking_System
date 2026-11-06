/** OpenAI reply drafts for a group chat. Drafts only: nothing here sends a message. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canManageGroups, getGuestBrief, groupsErrorResponse } from '@/lib/wa-groups/server'
import { suggestReplies } from '@/lib/wa-groups/suggest'
import { chatForAi } from '@/lib/wa-groups/chat'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  const body = await req.json().catch(() => null) as { hint?: string } | null
  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const member = await prisma.waBookingGroupMember.findFirst({ where: { groupId: params.id }, orderBy: { createdAt: 'asc' }, select: { bookingRef: true } })
    if (!member) return buildApiError('Link a booking first', 404)
    const brief = await getGuestBrief(member.bookingRef)
    if (!brief) return buildApiError('Booking not found', 404)
    try {
      return buildApiSuccess(await suggestReplies(brief, await chatForAi(params.id), body?.hint?.trim().slice(0, 200)))
    } catch (err) {
      console.error('[WaGroups] suggest failed:', err instanceof Error ? err.message : err)
      return buildApiError('Suggestions are unavailable right now. You can still type a reply.', 502)
    }
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
