/** Contacts in a chat group: suggestions from the booking, add, remove. */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { accessibleGroup, canManageGroups, groupsErrorResponse, suggestContacts } from '@/lib/wa-groups/server'
import { addParticipant, removeParticipant } from '@/lib/wa-groups/chat'
import { isParticipantRole } from '@/lib/wa-groups/shared'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

async function gate(id: string) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!canManageGroups(session.user.role)) return buildApiError('Forbidden', 403)
  if (!(await accessibleGroup(id, session.user.role))) return buildApiError('Group not found', 404)
  return null
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const denied = await gate(params.id)
    if (denied) return denied
    const member = await prisma.waBookingGroupMember.findFirst({ where: { groupId: params.id }, select: { bookingRef: true } })
    return buildApiSuccess(member ? await suggestContacts(member.bookingRef) : [])
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const body = await req.json().catch(() => null) as { phone?: string; name?: string; role?: string } | null
  if (!body?.phone || !isParticipantRole(body.role)) return buildApiError('A number and a role are required')
  try {
    const denied = await gate(params.id)
    if (denied) return denied
    const problem = await addParticipant(params.id, { phone: body.phone, name: body.name, role: body.role })
    return problem ? buildApiError(problem) : buildApiSuccess({ ok: true })
  } catch (err) {
    return groupsErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return buildApiError('id is required')
  try {
    const denied = await gate(params.id)
    if (denied) return denied
    await removeParticipant(params.id, id)
    return buildApiSuccess({ ok: true })
  } catch (err) {
    return groupsErrorResponse(err)
  }
}
