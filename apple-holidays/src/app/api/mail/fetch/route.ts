import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { fetchUnprocessedEmailsForUser, getConfiguredMailboxes } from '@/lib/mail-processor'
import { fetchImapPnlEmails, IMAP_PNL_USER } from '@/lib/imap-pnl'

const IMAP_PNL_KIND = 'PNL' as const

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['BT_USER', 'SUPER_ADMIN'].includes(session.user.role)) return buildApiError('Forbidden', 403)

  const limit   = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '50'), 500)
  const folder  = (req.nextUrl.searchParams.get('folder') ?? 'all') as 'inbox' | 'all'
  const mailbox = req.nextUrl.searchParams.get('mailbox') ?? 'all'  // 'tq' | 'pnl' | 'all'

  try {
    const configured = getConfiguredMailboxes()

    if (mailbox === 'pnl') {
      // IMAP is the sole PNL source
      const emails = await fetchImapPnlEmails(limit)
      return buildApiSuccess(emails.map(e => ({ ...e, mailboxKind: IMAP_PNL_KIND, mailboxUser: IMAP_PNL_USER })))
    }

    if (mailbox === 'tq') {
      const target = configured.find(mb => mb.kind === 'TOUR_CONFIRMATION')
      if (!target) return buildApiError(`TQ mailbox not configured`, 400)
      const emails = await fetchUnprocessedEmailsForUser(target.user, limit, folder)
      return buildApiSuccess(emails.map(e => ({ ...e, mailboxKind: target.kind, mailboxUser: target.user })))
    }

    // 'all' — fetch TQ from Graph + PNL from IMAP, merge most-recent-first
    const [graphResults, imapEmails] = await Promise.all([
      Promise.all(
        configured
          .filter(mb => mb.kind === 'TOUR_CONFIRMATION')
          .map(mb => fetchUnprocessedEmailsForUser(mb.user, limit, folder)
            .then(emails => emails.map(e => ({ ...e, mailboxKind: mb.kind, mailboxUser: mb.user })))
            .catch(() => [] as never[])
          )
      ),
      fetchImapPnlEmails(limit).catch(() => []),
    ])

    const merged = [
      ...graphResults.flat(),
      ...imapEmails.map(e => ({ ...e, mailboxKind: IMAP_PNL_KIND, mailboxUser: IMAP_PNL_USER })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, limit)

    return buildApiSuccess(merged)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Mail fetch error:', message)
    return buildApiError(message, 500)
  }
}
