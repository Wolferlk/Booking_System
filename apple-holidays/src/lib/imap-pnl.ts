import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail, type AddressObject } from 'mailparser'
import type { ProcessedEmail, EmailAttachment } from './mail-processor'

const HOST = process.env.IMAP_HOST ?? 'outlook.office365.com'
const PORT = Number(process.env.IMAP_PORT ?? '993')

// ── Only mailbox: accounts.payable@aahaas.com ────────────────────────────────
const PAYABLE_USER = process.env.IMAP2_USERNAME ?? ''
const PAYABLE_PASS = process.env.IMAP2_PASSWORD ?? ''

const attachmentCache = new Map<string, EmailAttachment[]>()

// IMAP_PNL_USER and IMAP_PNL2_USER both point to payable (backward-compat)
export const IMAP_PNL_USER  = PAYABLE_USER
export const IMAP_PNL2_USER = PAYABLE_USER

// Last connection error — readable by API for diagnostics
export let lastImapError: string | null = null

function makeGraphId(uid: number): string {
  return `imap2_${uid}`
}

export function isImapGraphId(graphId: string): boolean {
  return graphId.startsWith('imap2_')
}

function makeClient(): ImapFlow {
  return new ImapFlow({
    host: HOST,
    port: PORT,
    secure: PORT === 993,
    auth: { user: PAYABLE_USER, pass: PAYABLE_PASS },
    logger: false,
    tls: { rejectUnauthorized: false },
  })
}

function parsedToEmail(uid: number, parsed: ParsedMail): ProcessedEmail {
  const subject  = parsed.subject ?? ''
  const bodyText = parsed.text ?? ''
  const bodyHtml = typeof parsed.html === 'string' ? parsed.html : bodyText
  const graphId  = makeGraphId(uid)

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
    type:           'PNL',
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

// ── Fetch emails from accounts.payable@aahaas.com ───────────────────────────

async function fetchEmails(limit = 50): Promise<ProcessedEmail[]> {
  if (!PAYABLE_USER || !PAYABLE_PASS) {
    lastImapError = 'IMAP2_USERNAME or IMAP2_PASSWORD not set in environment'
    console.error('[IMAP-Payable]', lastImapError)
    return []
  }

  const client = makeClient()
  const emails: ProcessedEmail[] = []

  try {
    await client.connect()
    lastImapError = null  // clear on successful connect

    const lock = await client.getMailboxLock('INBOX')

    try {
      const total = (client.mailbox as { exists?: number } | null)?.exists ?? 0
      console.log(`[IMAP-Payable] Connected to ${PAYABLE_USER}, INBOX has ${total} messages`)

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
  } catch (err: unknown) {
    lastImapError = err instanceof Error ? err.message : String(err)
    console.error('[IMAP-Payable] Connection failed:', lastImapError)
    return []
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  console.log(`[IMAP-Payable] Fetched ${emails.length} emails from ${PAYABLE_USER}`)
  return emails.reverse().slice(0, limit)
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch emails from accounts.payable@aahaas.com via IMAP */
export async function fetchImapPayableEmails(limit = 50): Promise<ProcessedEmail[]> {
  return fetchEmails(limit)
}

/** Backward-compat alias — same as fetchImapPayableEmails */
export async function fetchImapPnlEmails(limit = 50): Promise<ProcessedEmail[]> {
  return fetchEmails(limit)
}

/** Fetch attachments for a payable IMAP email (graphId prefix: imap2_) */
export async function fetchImapAttachments(graphId: string): Promise<EmailAttachment[]> {
  const cached = attachmentCache.get(graphId)
  if (cached) return cached

  const uidMatch = graphId.match(/^imap2_(\d+)$/)
  if (!uidMatch || !PAYABLE_USER || !PAYABLE_PASS) return []

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
  } catch (err: unknown) {
    console.error('[IMAP-Payable] Attachment fetch failed:', err instanceof Error ? err.message : err)
  } finally {
    try { await client.logout() } catch { /* ignore */ }
  }

  attachmentCache.set(graphId, results)
  return results
}

/** Test the IMAP connection and return result — used by diagnostic API */
export async function testImapConnection(): Promise<{ ok: boolean; error: string | null; messageCount: number; user: string }> {
  if (!PAYABLE_USER || !PAYABLE_PASS) {
    return { ok: false, error: 'IMAP2_USERNAME or IMAP2_PASSWORD not set', messageCount: 0, user: PAYABLE_USER }
  }

  const client = makeClient()

  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    const total = (client.mailbox as { exists?: number } | null)?.exists ?? 0
    lock.release()
    await client.logout()
    return { ok: true, error: null, messageCount: total, user: PAYABLE_USER }
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    try { await client.logout() } catch { /* ignore */ }
    return { ok: false, error, messageCount: 0, user: PAYABLE_USER }
  }
}
