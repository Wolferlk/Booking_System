import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getConfiguredMailboxes } from '@/lib/mail-processor'
import { listCachedMailboxEmails, syncMailboxEmailsToDb } from '@/lib/mail-cache'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '50'), 500)
  const folder  = (req.nextUrl.searchParams.get('folder') ?? 'all') as 'inbox' | 'all'
  const mailbox = (req.nextUrl.searchParams.get('mailbox') ?? 'all') as 'tq' | 'pnl' | 'all'

  try {
    const configured = getConfiguredMailboxes()
    const syncTargets = mailbox === 'all'
      ? configured
      : configured.filter(mb => mailbox === 'pnl' ? mb.kind === 'PNL' : mb.kind === 'TOUR_CONFIRMATION')

    if (!syncTargets.length) {
      return buildApiError(
        mailbox === 'pnl' ? 'PNL mailbox not configured' : 'TQ mailbox not configured',
        400,
      )
    }

    await Promise.all(syncTargets.map(mb => syncMailboxEmailsToDb({
      mailboxUser: mb.user,
      mailboxKind: mb.kind,
      limit,
      folder,
    }).catch(() => 0)))

    const cached = await listCachedMailboxEmails({
      mailbox,
      folder,
      limit,
    })
    return buildApiSuccess(cached)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Mail fetch error:', message)
    return buildApiError(message, 500)
  }
}
