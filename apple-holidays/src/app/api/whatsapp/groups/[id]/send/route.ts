/**
 * Send one message kind to one booking in a group, or preview it. The browser
 * walks the group one booking at a time, so a run of PDFs never outlasts a call.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canManageGroups, groupsErrorResponse, previewGroupMessage, sendFromDesk } from '@/lib/wa-groups/server'
import { isGroupKind } from '@/lib/wa-groups/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => null) as
    { ref?: string; kind?: string; date?: string; note?: string; resend?: boolean; preview?: boolean } | null
  const { ref, kind, date } = body ?? {}
  if (!ref || !isGroupKind(kind)) return buildApiError('ref and a valid kind are required')
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return buildApiError('A valid date is required')
  if (kind === 'daily' && !date) return buildApiError('Pick a day for the daily plan')
  const note = body?.note?.trim().slice(0, 300) || undefined

  try {
    if (!(await accessibleGroup(params.id, session.user.role))) return buildApiError('Group not found', 404)
    const member = await prisma.waBookingGroupMember.findFirst({ where: { groupId: params.id, bookingRef: ref }, select: { id: true } })
    if (!member) return buildApiError('That booking is not in this group', 404)

    if (body?.preview) return buildApiSuccess(await previewGroupMessage(ref, kind, date, note))

    const actor = session.user.name ?? session.user.email ?? 'Staff'
    return buildApiSuccess(await sendFromDesk({ groupId: params.id, ref, kind, date, note, resend: Boolean(body?.resend), actor }))
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
