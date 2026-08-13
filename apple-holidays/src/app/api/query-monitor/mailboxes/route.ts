/** Query Monitor — file-handler mailbox list and creation. */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { requireAdmin } from '@/lib/query-monitor/auth'
import { listMailboxes } from '@/lib/query-monitor/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const mailboxes = await listMailboxes()
  return buildApiSuccess({ mailboxes })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return buildApiError('Forbidden', 403)

  const body = await req.json() as {
    email?: string; displayName?: string; isActive?: boolean
    mailboxKind?: string; aliasAddresses?: string
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const displayName = (body.displayName ?? '').trim()
  const mailboxKind = body.mailboxKind === 'ALIAS' ? 'ALIAS' : 'USER'
  const aliasList = (body.aliasAddresses ?? '')
    .split(',').map(a => a.trim().toLowerCase()).filter(Boolean)
  if (aliasList.some(a => !a.includes('@'))) {
    return buildApiError('Every extra address must be an email address, comma-separated')
  }

  if (!email.includes('@')) return buildApiError('A valid mailbox address is required')
  if (!displayName)        return buildApiError('Display name is required — it is what appears in the sheet')

  const existing = await prisma.queryMonitorMailbox.findUnique({ where: { email } })
  if (existing) return buildApiError('That mailbox is already monitored', 409)

  const count = await prisma.queryMonitorMailbox.count()
  const mailbox = await prisma.queryMonitorMailbox.create({
    data: {
      email, displayName, mailboxKind,
      aliasAddresses: aliasList.join(', ').slice(0, 500),
      isActive: body.isActive ?? true, sortOrder: count,
    },
  })

  return buildApiSuccess({ mailbox }, 'Mailbox added')
}
