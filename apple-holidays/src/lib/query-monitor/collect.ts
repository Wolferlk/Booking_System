/**
 * Mailbox collection for the Query Monitor.
 *
 * Read-only Microsoft Graph access to the file-handler inboxes plus their Sent
 * Items (to work out when a query was answered). Deliberately separate from
 * mail-processor.ts: that pipeline creates bookings and consumes AI budget on
 * every message, this one only observes.
 */
import { graphFetch } from '@/lib/graph-client'
import { ALIAS_MAILBOX_NOTE, IGNORED_SENDER_PATTERNS, INTERNAL_DOMAINS } from './constants'

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
  /**
   * Every address on the TO and CC lines, lower-cased. This is how a
   * distribution group with no mailbox of its own — availcheck@ — is counted:
   * the mail is read out of a member's inbox and the group is recognised here.
   */
  recipients:        string[]
  /**
   * Null on the mail the query pipeline works with. Otherwise why this message
   * is not an inbound agent query: INTERNAL (our own tenant) or AUTOMATED
   * (noreply addresses, mailer daemons, tenant notifications).
   *
   * Such mail used to be dropped inside `fetchInboxSince` and never seen again.
   * It is carried out instead so the raw mail log can record it — the "All
   * Mails" tab is the one place in this system where *everything* that landed in
   * a monitored inbox has to appear. Callers that want queries only filter on
   * this being null, which is exactly what the sweep does.
   */
  skipReason:        SkipReason | null
}

/** Why a message is not an inbound agent query. See `MonitoredMessage.skipReason`. */
export type SkipReason = 'INTERNAL' | 'AUTOMATED'

interface GraphRecipient { emailAddress?: { address?: string; name?: string } }

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
  toRecipients?: GraphRecipient[]
  ccRecipients?: GraphRecipient[]
}

const SELECT_INBOX =
  'id,internetMessageId,conversationId,subject,from,receivedDateTime,bodyPreview,body,'
  + 'hasAttachments,toRecipients,ccRecipients'
// `bodyPreview` is on the sent select and `body` is not, deliberately. The
// thread summary needs to know what an answer said, and the preview is the first
// ~255 characters Graph already has indexed — carrying the full body of every
// sent mail in the window instead would multiply the response size for text that
// is quoted thread nine times out of ten.
const SELECT_SENT =
  'id,internetMessageId,conversationId,subject,sentDateTime,bodyPreview,'
  + 'toRecipients,ccRecipients'

/** TO + CC as lower-cased addresses. */
function recipientsOf(msg: GraphMessage): string[] {
  return [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])]
    .map(r => (r.emailAddress?.address ?? '').toLowerCase().trim())
    .filter(Boolean)
    .filter((a, i, all) => all.indexOf(a) === i)
}

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

/**
 * Why this sender is not a customer query, or null if it might be.
 *
 * An address with no `@` in it at all is treated as automated: it is a
 * system-generated envelope rather than a person, and it is the only case here
 * that is about the address being malformed rather than about who owns it.
 */
export function skipReasonFor(address: string): SkipReason | null {
  const lower = address.toLowerCase()
  if (!lower.includes('@')) return 'AUTOMATED'
  if (IGNORED_SENDER_PATTERNS.some(p => lower.includes(p))) return 'AUTOMATED'
  return INTERNAL_DOMAINS.includes(domainOf(lower)) ? 'INTERNAL' : null
}

/** Automated senders and our own staff are not customer queries. */
export function isIgnorableSender(address: string): boolean {
  return skipReasonFor(address) !== null
}

/**
 * Inbox messages received since `since` — **every one of them**, each carrying
 * its own `skipReason`.
 *
 * This used to return external senders only, dropping internal chatter and
 * automated mail here at the source so it never reached the entries table. It
 * still must never reach the entries table, and the sweep still filters on
 * exactly that; but the mail has to be *seen* first, because the raw mail log
 * behind the "All Mails" tab is meant to hold everything that arrived. Dropping
 * it here would mean a second read of every inbox to get it back.
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
        recipients:        recipientsOf(msg),
        skipReason:        skipReasonFor(address),
      }
    })
}

/**
 * One mail out of a handler's Sent Items, with enough of it kept to decide
 * whether it actually answers a given query.
 *
 * `recipients` is the part that matters. A sent mail sharing a query's
 * conversation is not proof the agent was answered — forwarding the thread to a
 * colleague, or replying only to internal staff on it, looks exactly the same
 * from the conversation id alone. Knowing who it went to is what separates "we
 * replied to them" from "we talked about it among ourselves".
 */
export interface SentMessage {
  graphId:           string
  internetMessageId: string | null
  conversationId:    string | null
  subject:           string
  sentAt:            Date
  recipients:        string[]
  /** First few lines of what was actually written — feeds the thread summary. */
  bodyPreview:       string
}

/**
 * A mailbox's Sent Items over the window, indexed the two ways replies are
 * looked up: by conversation, and by normalised subject for the mail Graph gives
 * no conversation id for. One call per mailbox instead of one per query.
 */
export interface SentIndex {
  mailboxId:      string
  mailboxEmail:   string
  handlerName:    string
  byConversation: Map<string, SentMessage[]>
  bySubject:      Map<string, SentMessage[]>
  /** Set when Sent Items could not be read at all — reported, never fatal. */
  error?:         string
}

function toSentMessage(msg: GraphMessage): SentMessage | null {
  if (!msg.sentDateTime) return null
  return {
    graphId:           msg.id,
    internetMessageId: msg.internetMessageId ?? null,
    conversationId:    msg.conversationId ?? null,
    subject:           (msg.subject ?? '').trim(),
    sentAt:            new Date(msg.sentDateTime),
    recipients:        recipientsOf(msg),
    bodyPreview:       (msg.bodyPreview ?? '').trim(),
  }
}

/**
 * Build the index. `subjectKey` is supplied by the caller (thread.ts owns
 * subject normalisation) so collection stays free of thread rules.
 */
export async function fetchSentIndex(
  mailbox: { id: string; email: string; displayName: string },
  since: Date,
  subjectKey: (subject: string) => string,
  limit = 300,
): Promise<SentIndex> {
  const base   = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox.email)}`
  const filter = encodeURIComponent(`sentDateTime ge ${since.toISOString()}`)
  const url    = `${base}/mailFolders/sentitems/messages`
             + `?$top=${Math.min(limit, 100)}&$orderby=sentDateTime desc`
             + `&$select=${SELECT_SENT}&$filter=${filter}`

  const index: SentIndex = {
    mailboxId:      mailbox.id,
    mailboxEmail:   mailbox.email,
    handlerName:    mailbox.displayName,
    byConversation: new Map(),
    bySubject:      new Map(),
  }

  let messages: GraphMessage[] = []
  try {
    messages = await graphPages<GraphMessage>(url, limit)
  } catch (err) {
    // No Sent Items access → this mailbox simply contributes no replies, and
    // every query it owns stays PENDING rather than the sweep failing.
    index.error = err instanceof Error ? err.message.slice(0, 300) : 'Sent Items unreadable'
    return index
  }

  const push = (map: Map<string, SentMessage[]>, key: string, msg: SentMessage) => {
    const list = map.get(key)
    if (list) list.push(msg)
    else map.set(key, [msg])
  }

  for (const raw of messages) {
    const msg = toSentMessage(raw)
    if (!msg) continue
    if (msg.conversationId) push(index.byConversation, msg.conversationId, msg)
    const key = subjectKey(msg.subject)
    if (key) push(index.bySubject, key, msg)
  }
  return index
}

/**
 * Targeted lookup for an older thread that has fallen outside the bulk window —
 * used when chasing replies to queries that are still unanswered days later.
 * Returns every sent mail on the conversation so the caller can apply the same
 * "was it addressed back to the person who asked" test as the bulk path.
 */
export async function findSentInConversation(
  mailboxEmail: string, conversationId: string, after: Date,
): Promise<SentMessage[]> {
  const base   = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailboxEmail)}`
  const filter = encodeURIComponent(`conversationId eq '${conversationId.replace(/'/g, "''")}'`)
  const url    = `${base}/mailFolders/sentitems/messages`
             + `?$top=10&$orderby=sentDateTime asc&$select=${SELECT_SENT}&$filter=${filter}`

  try {
    const page = await graphFetch<{ value: GraphMessage[] }>(url)
    return (page.value ?? [])
      .map(toSentMessage)
      .filter((m): m is SentMessage => m !== null && m.sentAt >= after)
  } catch {
    return [] // treated as "no reply found"
  }
}

/**
 * Cheap reachability probe, so the UI can show a red mailbox before a sweep.
 *
 * An ALIAS address has nothing to probe: it is a distribution group, Graph has
 * no mailbox for it, and a 404 here would be reported as a fault when it is the
 * entire premise. It passes with the explanation instead.
 */
export async function testMailboxAccess(
  mailboxEmail: string, kind: 'USER' | 'ALIAS' = 'USER',
): Promise<{ ok: boolean; error?: string; note?: string; lastMessageAt?: Date }> {
  if (kind === 'ALIAS') {
    return { ok: true, note: ALIAS_MAILBOX_NOTE }
  }

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
