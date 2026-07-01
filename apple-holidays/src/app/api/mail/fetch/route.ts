import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getConfiguredMailboxes } from '@/lib/mail-processor'
import { listCachedMailboxEmails, syncMailboxEmailsToDb } from '@/lib/mail-cache'
import { getMailboxEnabledFlags } from '@/lib/mail-mode'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const sp       = req.nextUrl.searchParams
  const limit    = Math.min(Number(sp.get('limit') ?? '50'), 10000)
  const offset   = Math.max(Number(sp.get('offset') ?? '0'), 0)
  const folder   = (sp.get('folder') ?? 'all') as 'inbox' | 'all'
  const mailbox  = (sp.get('mailbox') ?? 'all') as 'tq' | 'pnl' | 'all'
  const dateFrom = sp.get('dateFrom') || null   // YYYY-MM-DD
  const dateTo   = sp.get('dateTo')   || null   // YYYY-MM-DD

  try {
    const [configured, flags] = await Promise.all([
      Promise.resolve(getConfiguredMailboxes()),
      getMailboxEnabledFlags(),
    ])

    // Filter which mailboxes are enabled for syncing
    const allTargets = mailbox === 'all'
      ? configured
      : configured.filter(mb => mailbox === 'pnl' ? mb.kind === 'PNL' : mb.kind === 'TOUR_CONFIRMATION')

    const syncTargets = allTargets.filter(mb => {
      if (mb.kind === 'TOUR_CONFIRMATION' && !flags.tqEnabled)  return false
      if (mb.kind === 'PNL'              && !flags.pnlEnabled) return false
      return true
    })

    if (!allTargets.length) {
      return buildApiError(
        mailbox === 'pnl' ? 'PNL mailbox not configured' : 'TQ mailbox not configured',
        400,
      )
    }

    // Only sync enabled mailboxes
    await Promise.all(syncTargets.map(mb => syncMailboxEmailsToDb({
      mailboxUser: mb.user,
      mailboxKind: mb.kind,
      limit: Math.min(limit, 200),
      folder,
    }).catch(() => 0)))

    const cached = await listCachedMailboxEmails({
      mailbox,
      folder,
      limit,
      offset,
      dateFrom,
      dateTo,
    })

    return buildApiSuccess(cached)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Mail fetch error:', message)
    return buildApiError(message, 500)
  }
}
