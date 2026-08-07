/**
 * Mailbox collection for the Query Monitor.
 *
 * Read-only Microsoft Graph access to the file-handler inboxes plus their Sent
 * Items (to work out when a query was answered). Deliberately separate from
 * mail-processor.ts: that pipeline creates bookings and consumes AI budget on
 * every message, this one only observes.
 */
import { graphFetch } from '@/lib/graph-client'
import { IGNORED_SENDER_PATTERNS, INTERNAL_DOMAINS } from './constants'

export interface MonitoredMessage {
  graphId:           string
  internetMessageId: string | null
  conversationId:    string | null
  subject:           string
  fromAddress:       string
  fromName:          string
  fromDomain:        string
  receivedAt:        Date
  bodyPreview:       string
  bodyText:          string
  hasAttachments:    boolean
  folder:            string
}

interface GraphMessage {
  id: string
  internetMessageId?: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  sender?: { emailAddress?: { address?: string; name?: string } }
  receivedDateTime?: string
  sentDateTime?: string
  bodyPreview?: string
  body?: { contentType?: string; content?: string }
  hasAttachments?: boolean
}

const SELECT_INBOX =
  'id,internetMessageId,conversationId,subject,from,receivedDateTime,bodyPreview,body,hasAttachments'
const SELECT_SENT =
  'id,internetMessageId,conversationId,subject,sentDateTime,toRecipients'

async function graphPages<T>(url: string, maxItems: number): Promise<T[]> {
  const items: T[] = []
  let next: string | undefined = url
  while (next && items.length < maxItems) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await graphFetch(next)
    items.push(...(page.value ?? []))
    next = page['@odata.nextLink']
  }
  return items.slice(0, maxItems)
}

/** Plain text from an HTML body, keeping line structure so dates stay readable. */
function bodyToText(msg: GraphMessage): string {
  const content = msg.body?.content ?? ''
  if ((msg.body?.contentType ?? 'text') !== 'html') return content

  return content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]\b[^>]*>/gi, ' ')
    .replace(/<\/(?:tr|p|div|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]{2,8};/gi, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at === -1 ? '' : address.slice(at + 1).toLowerCase().trim()
}

/** Automated senders and our own staff are not customer queries. */
export function isIgnorableSender(address: string): boolean {
  const lower = address.toLowerCase()
  if (!lower.includes('@')) return true
  if (IGNORED_SENDER_PATTERNS.some(p => lower.includes(p))) return true
  return INTERNAL_DOMAINS.includes(domainOf(lower))
}

/**
 * Inbox messages received since `since`. External senders only — the sweep is
 * about inbound agent queries, so internal chatter is dropped at the source
 * rather than filling the entries table.
 */
export async function fetchInboxSince(
  mailboxEmail: string, since: Date, limit = 200,
): Promise<MonitoredMessage[]> {
  const base   = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}`
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)
  const url    = `${base}/mailFolders/inbox/messages`
             + `?$top=${Math.min(limit, 100)}&$orderby=receivedDateTime desc`
             + `&$select=${SELECT_INBOX}&$filter=${filter}`

  const messages = await graphPages<GraphMessage>(url, limit)

  return messages
    .map<MonitoredMessage>(msg => {
      const from = msg.from?.emailAddress ?? msg.sender?.emailAddress ?? {}
      const address = (from.address ?? '').toLowerCase().trim()
      const bodyText = bodyToText(msg)
      return {
        graphId:           msg.id,
        internetMessageId: msg.internetMessageId ?? null,
        conversationId:    msg.conversationId ?? null,
        subject:           (msg.subject ?? '(no subject)').trim(),
        fromAddress:       address,
        fromName:          (from.name ?? '').trim(),
        fromDomain:        domainOf(address),
        receivedAt:        new Date(msg.receivedDateTime ?? Date.now()),
        bodyPreview:       (msg.bodyPreview ?? '').trim(),
        bodyText,
        hasAttachments:    msg.hasAttachments ?? false,
        folder:            'Inbox',
      }
    })
    .filter(m => m.fromAddress && !isIgnorableSender(m.fromAddress))
}

/**
 * conversationId → first outbound reply, from the mailbox's Sent Items in the
 * window. One call per mailbox instead of one per query.
 */
export async function fetchSentConversationMap(
  mailboxEmail: string, since: Date, limit = 300,
): Promise<Map<string, Date>> {
  const base   = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}`
  const filter = encodeURIComponent(`sentDateTime ge ${since.toISOString()}`)
  const url    = `${base}/mailFolders/sentitems/messages`
             + `?$top=${Math.min(limit, 100)}&$orderby=sentDateTime desc`
             + `&$select=${SELECT_SENT}&$filter=${filter}`

  const map = new Map<string, Date>()
  let messages: GraphMessage[] = []
  try {
    messages = await graphPages<GraphMessage>(url, limit)
  } catch {
    return map // no Sent Items access → everything simply stays PENDING
  }

  for (const msg of messages) {
    const conversationId = msg.conversationId
    if (!conversationId || !msg.sentDateTime) continue
    const sentAt = new Date(msg.sentDateTime)
    const existing = map.get(conversationId)
    if (!existing || sentAt < existing) map.set(conversationId, sentAt)
  }
  return map
}

/**
 * Targeted lookup for an older thread that has fallen outside the bulk window —
 * used when chasing replies to queries that are still unanswered days later.
 */
export async function findReplyForConversation(
  mailboxEmail: string, conversationId: string, after: Date,
): Promise<Date | null> {
  const base   = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}`
  const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`)
  const url    = `${base}/mailFolders/sentitems/messages`
             + `?$top=5&$orderby=sentDateTime asc&$select=${SELECT_SENT}&$filter=${filter}`

  try {
    const page = await graphFetch<{ value: GraphMessage[] }>(url)
    for (const msg of page.value ?? []) {
      if (!msg.sentDateTime) continue
      const sentAt = new Date(msg.sentDateTime)
      if (sentAt >= after) return sentAt
    }
  } catch { /* treated as "no reply found" */ }
  return null
}

/** Cheap reachability probe, so the UI can show a red mailbox before a sweep. */
export async function testMailboxAccess(
  mailboxEmail: string,
): Promise<{ ok: boolean; error?: string; lastMessageAt?: Date }> {
  try {
    const res = await graphFetch<{ value: { receivedDateTime?: string }[] }>(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}`
      + '/mailFolders/inbox/messages?$top=1&$select=receivedDateTime',
    )
    const latest = res.value?.[0]?.receivedDateTime
    return { ok: true, lastMessageAt: latest ? new Date(latest) : undefined }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    const friendly = raw.includes('ErrorInvalidUser')
      ? 'Not a mailbox in the tenant (Graph: ErrorInvalidUser) — check the address or licence the shared mailbox'
      : raw.slice(0, 300)
    return { ok: false, error: friendly }
  }
}
