import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser'
import { detectEmailType, type ProcessedEmail, type EmailAttachment } from './mail-processor'

const HOST = process.env.IMAP_HOST ?? 'outlook.office365.com'
const PORT = Number(process.env.IMAP_PORT ?? '993')
const USER = process.env.IMAP_USERNAME ?? ''
const PASS = process.env.IMAP_PASSWORD ?? ''

// Module-level attachment cache — lives for the lifetime of the server process
const attachmentCache = new Map<string, EmailAttachment[]>()

export const IMAP_PNL_USER = USER

export function isImapGraphId(graphId: string): boolean {
  return graphId.startsWith('imap_')
}

function makeGraphId(uid: number): string {
  return `imap_${uid}`
}

function makeClient(): ImapFlow {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: PORT === 993,
    auth: { user: USER, pass: PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  })
}

function parsedToEmail(uid: number, parsed: ParsedMail): ProcessedEmail {
  const subject  = parsed.subject ?? ''
  const bodyText = parsed.text ?? ''
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : bodyText
  const graphId  = makeGraphId(uid)

  const from = (parsed.from as AddressObject | undefined)
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

export async function fetchImapPnlEmails(limit = 50): Promise<ProcessedEmail[]> {
  if (!USER || !PASS) return []

  const client = makeClient()
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
          const email  = parsedToEmail(msg.uid, parsed)

          if (parsed.attachments?.length) {
            attachmentCache.set(email.graphId, parsedToAttachments(parsed))
          }

          // Mark read state from flags if available
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
    // Return empty on connection failure
    return []
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  return emails.reverse().slice(0, limit)
}

export async function fetchImapAttachments(graphId: string): Promise<EmailAttachment[]> {
  const cached = attachmentCache.get(graphId)
  if (cached) return cached

  const uidMatch = graphId.match(/^imap_(\d+)$/)
  if (!uidMatch || !USER || !PASS) return []

  const uid    = parseInt(uidMatch[1], 10)
  const client = makeClient()
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

  attachmentCache.set(graphId, results)
  return results
}
