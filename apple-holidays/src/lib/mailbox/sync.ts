import { prisma } from '@/lib/prisma'
import { getGraphToken } from '@/lib/mail-processor'
import { mailboxSenderAddress } from './send'

/**
 * Pulls a thread's replies back out of the sending mailbox.
 *
 * Graph's `conversationId` is the join. Every message the agent sends back —
 * and every copy of ours that lands in Sent Items — carries the same value, so
 * one `$filter` over the whole mailbox reconstructs the conversation without
 * needing a webhook, a subscription, or a second polling job.
 *
 * Idempotent by construction: rows are keyed on the Graph message id, so
 * re-syncing a thread inserts only what is genuinely new. That means the UI can
 * call this freely — on opening a thread, on a refresh click, on a cron tick —
 * and never risk duplicating an agent's reply.
 */

interface GraphThreadMessage {
  id: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  toRecipients?: { emailAddress?: { address?: string } }[]
  ccRecipients?: { emailAddress?: { address?: string } }[]
  receivedDateTime?: string
  sentDateTime?: string
  internetMessageId?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  hasAttachments?: boolean
  isRead?: boolean
  isDraft?: boolean
}

const SELECT = [
  'id', 'subject', 'from', 'toRecipients', 'ccRecipients', 'receivedDateTime',
  'sentDateTime', 'internetMessageId', 'body', 'bodyPreview', 'hasAttachments',
  'isRead', 'isDraft',
].join(',')

/** Very small HTML → text reduction, only good enough for search and previews. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const addrs = (list?: { emailAddress?: { address?: string } }[]) =>
  (list ?? []).map(r => r.emailAddress?.address ?? '').filter(Boolean).join(', ')

export interface SyncResult {
  newMessages: number
  replyCount: number
  skipped?: string
}

export async function syncThreadReplies(threadId: string): Promise<SyncResult> {
  const thread = await prisma.mailThread.findUnique({ where: { id: threadId } })
  if (!thread) throw new Error('Thread not found')
  if (!thread.conversationId) return { newMessages: 0, replyCount: thread.replyCount, skipped: 'no conversation id' }

  const mailboxUser = thread.mailboxUser || mailboxSenderAddress()
  const token = await getGraphToken()

  // conversationId is base64-ish and may contain characters that break an OData
  // string literal; the only one that actually matters is the single quote,
  // which OData escapes by doubling.
  const literal = thread.conversationId.replace(/'/g, "''")
  const url =
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxUser)}/messages` +
    `?$filter=${encodeURIComponent(`conversationId eq '${literal}'`)}` +
    `&$select=${SELECT}&$top=50&$orderby=receivedDateTime asc`

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Graph conversation fetch ${res.status}: ${(await res.text()).slice(0, 300)}`)

  const page = await res.json() as { value?: GraphThreadMessage[] }
  const messages = (page.value ?? []).filter(m => !m.isDraft)

  const known = new Set(
    (await prisma.mailThreadMessage.findMany({
      where: { threadId }, select: { graphId: true },
    })).map(r => r.graphId).filter((v): v is string => !!v),
  )

  const senderKey = mailboxUser.toLowerCase()
  let inserted = 0

  for (const msg of messages) {
    if (!msg.id || known.has(msg.id)) continue

    const from = msg.from?.emailAddress?.address ?? ''
    const direction = from.toLowerCase() === senderKey ? 'OUT' : 'IN'

    // Our own outbound copy is already recorded at send time with the body we
    // composed; adopting the Sent Items duplicate would show it twice.
    if (direction === 'OUT') continue

    const html = msg.body?.contentType?.toLowerCase() === 'html' ? (msg.body?.content ?? '') : ''
    const text = html ? htmlToText(html) : (msg.body?.content ?? msg.bodyPreview ?? '')

    try {
      await prisma.mailThreadMessage.create({
        data: {
          threadId,
          direction:         'IN',
          graphId:           msg.id,
          internetMessageId: msg.internetMessageId?.slice(0, 190) ?? null,
          fromAddress:       from.slice(0, 320),
          fromName:          (msg.from?.emailAddress?.name ?? '').slice(0, 190),
          toAddresses:       addrs(msg.toRecipients),
          ccAddresses:       addrs(msg.ccRecipients),
          subject:           msg.subject ?? '(no subject)',
          bodyHtml:          html.slice(0, 400_000),
          bodyText:          text.slice(0, 100_000),
          hasAttachments:    msg.hasAttachments ?? false,
          isRead:            false,
          sentAt:            new Date(msg.receivedDateTime ?? msg.sentDateTime ?? Date.now()),
        },
      })
      inserted++
    } catch {
      // A unique-constraint clash means a concurrent sync already took it.
    }
  }

  const [replyCount, unread, latest] = await Promise.all([
    prisma.mailThreadMessage.count({ where: { threadId, direction: 'IN' } }),
    prisma.mailThreadMessage.count({ where: { threadId, direction: 'IN', isRead: false } }),
    prisma.mailThreadMessage.findFirst({ where: { threadId }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } }),
  ])

  await prisma.mailThread.update({
    where: { id: threadId },
    data: {
      replyCount,
      unreadReplies: unread,
      lastMessageAt: latest?.sentAt ?? thread.lastMessageAt,
      lastSyncedAt:  new Date(),
      // A failed send stays failed — a reply cannot arrive on a mail that never left.
      status: thread.status === 'FAILED' ? 'FAILED' : replyCount > 0 ? 'REPLIED' : 'SENT',
    },
  })

  return { newMessages: inserted, replyCount }
}

/**
 * Refreshes the threads most likely to have moved: recently active, and not
 * already synced in the last minute. Used by the "sync all" button on the
 * Mail Box outbox so a desk can pull every open conversation in one action.
 */
export async function syncRecentThreads(limit = 25): Promise<{ threads: number; newMessages: number }> {
  const cutoff = new Date(Date.now() - 60_000)
  const threads = await prisma.mailThread.findMany({
    where: {
      status: { not: 'FAILED' },
      conversationId: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    orderBy: { lastMessageAt: 'desc' },
    take: limit,
    select: { id: true },
  })

  let newMessages = 0
  for (const t of threads) {
    try {
      const r = await syncThreadReplies(t.id)
      newMessages += r.newMessages
    } catch {
      // One unreachable thread must not abort the sweep.
    }
  }
  return { threads: threads.length, newMessages }
}
