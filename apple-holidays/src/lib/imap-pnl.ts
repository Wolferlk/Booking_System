import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser'
import { detectEmailType, type ProcessedEmail, type EmailAttachment } from './mail-processor'

const HOST = process.env.IMAP_HOST ?? 'outlook.office365.com'
const PORT = Number(process.env.IMAP_PORT ?? '993')

// ── Mailbox 1: accounts.receivable@aahaas.com ────────────────────────────────
const RECEIVER_USER = process.env.IMAP_USERNAME ?? ''
const RECEIVER_PASS = process.env.IMAP_PASSWORD ?? ''

// ── Mailbox 2: accounts.payable@aahaas.com ───────────────────────────────────
const PAYABLE_USER  = process.env.IMAP2_USERNAME ?? ''
const PAYABLE_PASS  = process.env.IMAP2_PASSWORD ?? ''

// Module-level attachment caches — lives for the lifetime of the server process
const attachmentCacheReceiver = new Map<string, EmailAttachment[]>()
const attachmentCachePayable  = new Map<string, EmailAttachment[]>()

export const IMAP_PNL_USER  = RECEIVER_USER  // backward-compat alias
export const IMAP_PNL2_USER = PAYABLE_USER

function cacheFor(user: string) {
  return user === PAYABLE_USER ? attachmentCachePayable : attachmentCacheReceiver
}

function makeGraphId(uid: number, user: string): string {
  const tag = user === PAYABLE_USER ? 'imap2' : 'imap'
  return `${tag}_${uid}`
}

export function isImapGraphId(graphId: string): boolean {
  return graphId.startsWith('imap_') || graphId.startsWith('imap2_')
}

function makeClient(user: string, pass: string): ImapFlow {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: PORT === 993,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  })
}

function parsedToEmail(uid: number, parsed: ParsedMail, user: string): ProcessedEmail {
  const subject  = parsed.subject ?? ''
  const bodyText = parsed.text ?? ''
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : bodyText
  const graphId  = makeGraphId(uid, user)

  const from  = (parsed.from as AddressObject | undefined)
  const toObj = (parsed.to as AddressObject | AddressObject[] | undefined)
  const toAddrs: string[] = Array.isArray(toObj)
    ? toObj.flatMap(a => a.value.map(r => r.address ?? '')).filter(Boolean)
    : (toObj?.value ?? []).map(r => r.address ?? '').filter(Boolean)

  return {
    uid,
    graphId,
    subject,
    from:           from?.value[0]?.address ?? '',
    fromName:       from?.value[0]?.name ?? '',
    to:             toAddrs,
    cc:             [],
    date:           (parsed.date ?? new Date()).toISOString(),
    type:           detectEmailType(subject, bodyText),
    rawBody:        bodyText.slice(0, 30_000),
    bodyHtml:       bodyHtml.slice(0, 100_000),
    folder:         'Inbox',
    isRead:         false,
    hasAttachments: (parsed.attachments?.length ?? 0) > 0,
    importance:     'normal',
    conversationId: '',
    parsed:         null,
  }
}

function parsedToAttachments(parsed: ParsedMail): EmailAttachment[] {
  return (parsed.attachments ?? []).map(att => ({
    name:        att.filename ?? 'attachment',
    contentType: att.contentType ?? 'application/octet-stream',
    size:        att.size,
    buffer:      Buffer.from(att.content),
  }))
}

// ── Core fetch function (shared by both mailboxes) ───────────────────────────

async function fetchImapEmailsForMailbox(
  user: string,
  pass: string,
  limit = 50,
): Promise<ProcessedEmail[]> {
  if (!user || !pass) return []

  const cache  = cacheFor(user)
  const client = makeClient(user, pass)
  const emails: ProcessedEmail[] = []

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const total = (client.mailbox as { exists?: number } | null)?.exists ?? 0
      if (total === 0) return []

      const start = Math.max(1, total - limit + 1)

      for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, source: true })) {
        if (!msg.source) continue
        try {
          const parsed = await (simpleParser(msg.source) as Promise<ParsedMail>)
          const email  = parsedToEmail(msg.uid, parsed, user)

          if (parsed.attachments?.length) {
            cache.set(email.graphId, parsedToAttachments(parsed))
          }

          if (msg.flags) {
            email.isRead = msg.flags.has('\\Seen')
          }

          emails.push(email)
        } catch {
          // Skip unparseable messages
        }
      }
    } finally {
      lock.release()
    }
  } catch {
    return []
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  return emails.reverse().slice(0, limit)
}

// ── Core attachment fetch (shared) ───────────────────────────────────────────

async function fetchImapAttachmentsForMailbox(
  graphId: string,
  user: string,
  pass: string,
): Promise<EmailAttachment[]> {
  const cache = cacheFor(user)
  const cached = cache.get(graphId)
  if (cached) return cached

  const uidMatch = graphId.match(/^imap2?_(\d+)$/)
  if (!uidMatch || !user || !pass) return []

  const uid    = parseInt(uidMatch[1], 10)
  const client = makeClient(user, pass)
  const results: EmailAttachment[] = []

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')

    try {
      const msg = await client.fetchOne(uid.toString(), { source: true }, { uid: true })
      const src = msg && (msg as unknown as { source?: Buffer }).source
      if (src) {
        const parsed = await (simpleParser(src) as Promise<ParsedMail>)
        results.push(...parsedToAttachments(parsed))
      }
    } finally {
      lock.release()
    }
  } catch {
    // Return empty on failure
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  cache.set(graphId, results)
  return results
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch emails from accounts.receivable@aahaas.com via IMAP */
export async function fetchImapPnlEmails(limit = 50): Promise<ProcessedEmail[]> {
  return fetchImapEmailsForMailbox(RECEIVER_USER, RECEIVER_PASS, limit)
}

/** Fetch emails from accounts.payable@aahaas.com via IMAP */
export async function fetchImapPayableEmails(limit = 50): Promise<ProcessedEmail[]> {
  return fetchImapEmailsForMailbox(PAYABLE_USER, PAYABLE_PASS, limit)
}

/** Fetch attachments — routes to the correct mailbox based on graphId prefix */
export async function fetchImapAttachments(graphId: string): Promise<EmailAttachment[]> {
  if (graphId.startsWith('imap2_')) {
    return fetchImapAttachmentsForMailbox(graphId, PAYABLE_USER, PAYABLE_PASS)
  }
  return fetchImapAttachmentsForMailbox(graphId, RECEIVER_USER, RECEIVER_PASS)
}
