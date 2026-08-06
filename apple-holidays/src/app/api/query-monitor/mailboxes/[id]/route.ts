/** Query Monitor — update, remove, or connection-test one mailbox. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { testMailboxAccess } from '@/lib/query-monitor/collect'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const mailbox = await prisma.queryMonitorMailbox.findUnique({ where: { id: params.id } })
  if (!mailbox) return buildApiError('Mailbox not found', 404)

  const body = await req.json() as {
    email?: string; displayName?: string; isActive?: boolean; sortOrder?: number
    /** Verify the address with Graph before saving — used by the "Test" button. */
    test?: boolean
  }

  if (body.test) {
    const result = await testMailboxAccess(body.email?.trim().toLowerCase() || mailbox.email)
    await prisma.queryMonitorMailbox.update({
      where: { id: mailbox.id },
      data:  { lastError: result.ok ? null : (result.error ?? 'Unknown Graph error'),
               ...(result.lastMessageAt ? { lastMessageAt: result.lastMessageAt } : {}) },
    })
    return result.ok
      ? buildApiSuccess({ ok: true, lastMessageAt: result.lastMessageAt ?? null }, 'Mailbox reachable')
      : buildApiError(result.error ?? 'Mailbox unreachable', 400)
  }

  const email = body.email?.trim().toLowerCase()
  if (email !== undefined && !email.includes('@')) return buildApiError('A valid mailbox address is required')

  if (email && email !== mailbox.email) {
    const clash = await prisma.queryMonitorMailbox.findUnique({ where: { email } })
    if (clash) return buildApiError('Another monitored mailbox already uses that address', 409)
  }

  const updated = await prisma.queryMonitorMailbox.update({
    where: { id: mailbox.id },
    data: {
      ...(email !== undefined ? { email } : {}),
      ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
      ...(body.isActive    !== undefined ? { isActive: body.isActive } : {}),
      ...(body.sortOrder   !== undefined ? { sortOrder: body.sortOrder } : {}),
      // A corrected address deserves a clean slate on the error banner.
      ...(email && email !== mailbox.email ? { lastError: null } : {}),
    },
  })

  return buildApiSuccess({ mailbox: updated }, 'Mailbox updated')
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const mailbox = await prisma.queryMonitorMailbox.findUnique({ where: { id: params.id } })
  if (!mailbox) return buildApiError('Mailbox not found', 404)

  // Matches cascade; the entries themselves stay, so history and sheet rows keep
  // making sense after a handler leaves the team.
  await prisma.queryMonitorMailbox.delete({ where: { id: mailbox.id } })
  return buildApiSuccess(null, 'Mailbox removed — past entries are kept')
}
