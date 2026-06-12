import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchUnprocessedEmailsForUser, getConfiguredMailboxes } from '@/lib/mail-processor'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const limit    = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '50'), 500)
  const folder   = (req.nextUrl.searchParams.get('folder') ?? 'all') as 'inbox' | 'all'
  const mailbox  = req.nextUrl.searchParams.get('mailbox') ?? 'all'  // 'tq' | 'pnl' | 'all'

  try {
    const configured = getConfiguredMailboxes()

    if (mailbox === 'all') {
      // Fetch from all configured mailboxes and merge, most recent first
      const results = await Promise.all(
        configured.map(mb => fetchUnprocessedEmailsForUser(mb.user, limit, folder)
          .then(emails => emails.map(e => ({ ...e, mailboxKind: mb.kind, mailboxUser: mb.user })))
          .catch(() => [])
        )
      )
      const merged = results.flat().sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ).slice(0, limit)
      return buildApiSuccess(merged)
    }

    const target = mailbox === 'pnl'
      ? configured.find(mb => mb.kind === 'PNL')
      : configured.find(mb => mb.kind === 'TOUR_CONFIRMATION')

    if (!target) return buildApiError(`Mailbox '${mailbox}' not configured`, 400)

    const emails = await fetchUnprocessedEmailsForUser(target.user, limit, folder)
    return buildApiSuccess(emails.map(e => ({ ...e, mailboxKind: target.kind, mailboxUser: target.user })))
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Mail fetch error:', message)
    return buildApiError(message, 500)
  }
}
