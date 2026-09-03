import { getGraphToken } from '@/lib/mail-processor'

/**
 * Mail Box's sender.
 *
 * The rest of the system posts to Graph's `/sendMail`, which is fire-and-forget:
 * it returns 202 and nothing else. That is fine for a confirmation nobody
 * expects a reply to, and useless here — without a `conversationId` there is no
 * way to recognise the agent's answer when it arrives.
 *
 * So this sends in two steps instead:
 *
 *   1. `POST /users/{sender}/messages`      → creates a draft, returns its
 *                                             `conversationId` + `internetMessageId`
 *   2. `POST /users/{sender}/messages/{id}/send`
 *
 * Both handles are captured from the draft in step 1 because sending moves the
 * message to Sent Items under a *new* message id — the thread keys are the only
 * two identifiers that survive the move, and they are what `sync.ts` filters on.
 */

const SENDER_EMAIL = process.env.Outlookmail_USERNAME ?? 'confirm.booking@aahaas.com'

export function mailboxSenderAddress(): string {
  return SENDER_EMAIL
}

export interface TrackedAttachment {
  name: string
  contentType: string
  buffer: Buffer
}

export interface TrackedSendOptions {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyHtml: string
  attachments?: TrackedAttachment[]
  /** Set on the outgoing message so an agent's client threads the reply to us. */
  replyTo?: string
}

export interface TrackedSendResult {
  conversationId: string | null
  internetMessageId: string | null
  graphMessageId: string | null
  mailboxUser: string
  to: string[]
  cc: string[]
}

const recip = (addr: string) => ({ emailAddress: { address: addr } })

/** Trims, drops blanks and non-addresses, and de-duplicates case-insensitively. */
export function normaliseAddresses(list: (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const addr = raw?.trim()
    if (!addr || !addr.includes('@')) continue
    const key = addr.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(addr)
  }
  return out
}

export async function sendTrackedMail(opts: TrackedSendOptions): Promise<TrackedSendResult> {
  const to  = normaliseAddresses(opts.to)
  if (to.length === 0) throw new Error('At least one "To" recipient is required')

  // A CC that duplicates a To line is noise on the recipient's header and, worse,
  // makes the reply-all look wrong. To wins.
  const toKeys = new Set(to.map(a => a.toLowerCase()))
  const cc  = normaliseAddresses(opts.cc  ?? []).filter(a => !toKeys.has(a.toLowerCase()))
  const ccKeys = new Set(cc.map(a => a.toLowerCase()))
  const bcc = normaliseAddresses(opts.bcc ?? []).filter(a => !toKeys.has(a.toLowerCase()) && !ccKeys.has(a.toLowerCase()))

  const token = await getGraphToken()
  const base  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const draft: Record<string, any> = {
    subject: opts.subject,
    body: { contentType: 'HTML', content: opts.bodyHtml },
    toRecipients: to.map(recip),
    ...(cc.length  ? { ccRecipients:  cc.map(recip) }  : {}),
    ...(bcc.length ? { bccRecipients: bcc.map(recip) } : {}),
    ...(opts.replyTo ? { replyTo: [recip(opts.replyTo)] } : {}),
  }

  if (opts.attachments?.length) {
    draft.attachments = opts.attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name:          att.name,
      contentType:   att.contentType,
      contentBytes:  Buffer.from(att.buffer).toString('base64'),
    }))
  }

  const createRes = await fetch(`${base}/messages`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(draft),
  })

  if (!createRes.ok) {
    const err = await createRes.text()
    throw new Error(`Graph create draft ${createRes.status}: ${err.slice(0, 400)}`)
  }

  const created = await createRes.json() as {
    id?: string
    conversationId?: string
    internetMessageId?: string
  }

  const messageId = created.id
  if (!messageId) throw new Error('Graph accepted the draft but returned no message id')

  const sendRes = await fetch(`${base}/messages/${messageId}/send`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!sendRes.ok) {
    const err = await sendRes.text()
    // Best-effort cleanup: an unsent draft left in the mailbox is confusing
    // clutter, and it is never the thing the operator asked for.
    await fetch(`${base}/messages/${messageId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {})
    throw new Error(`Graph send ${sendRes.status}: ${err.slice(0, 400)}`)
  }

  return {
    conversationId:    created.conversationId    ?? null,
    internetMessageId: created.internetMessageId ?? null,
    graphMessageId:    messageId,
    mailboxUser:       SENDER_EMAIL,
    to,
    cc,
  }
}
