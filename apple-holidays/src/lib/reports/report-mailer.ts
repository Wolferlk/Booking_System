/**
 * Graph sender for auto-reports.
 *
 * Separate from `send-mail.ts` because reports need things booking mail never
 * does: many `to` recipients, a real CC list (the point of the feature), BCC,
 * a reply-to override and multiple attachments. Rather than widen the shared
 * booking mailer — used on the confirmation path — this owns its own message
 * builder against the same Graph credentials.
 */
import { getGraphToken } from '@/lib/mail-processor'

const SENDER_EMAIL = process.env.REPORT_SENDER_EMAIL
  || process.env.Outlookmail_USERNAME
  || 'confirm.booking@aahaas.com'

export interface ReportAttachment {
  name: string
  contentType: string
  content: string | Buffer
}

export interface SendReportMailOptions {
  to: string[]
  cc?: string[]
  bcc?: string[]
  replyTo?: string | null
  subject: string
  html: string
  attachments?: ReportAttachment[]
}

export interface SendReportMailResult {
  recipients: number
  sender: string
}

/** Graph rejects the whole message if any address is malformed, so filter hard. */
function addresses(list: string[] | undefined, exclude: Set<string>): { emailAddress: { address: string } }[] {
  const out: { emailAddress: { address: string } }[] = []
  for (const raw of list ?? []) {
    const addr = raw?.trim().toLowerCase()
    if (!addr || !addr.includes('@') || exclude.has(addr)) continue
    exclude.add(addr)
    out.push({ emailAddress: { address: addr } })
  }
  return out
}

export async function sendReportMail(opts: SendReportMailOptions): Promise<SendReportMailResult> {
  const seen = new Set<string>()
  const toRecipients = addresses(opts.to, seen)
  if (!toRecipients.length) throw new Error('sendReportMail: no valid "to" recipients')

  const ccRecipients = addresses(opts.cc, seen)
  const bccRecipients = addresses(opts.bcc, seen)

  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: { contentType: 'HTML', content: opts.html },
    toRecipients,
    ...(ccRecipients.length ? { ccRecipients } : {}),
    ...(bccRecipients.length ? { bccRecipients } : {}),
    ...(opts.replyTo ? { replyTo: [{ emailAddress: { address: opts.replyTo } }] } : {}),
  }

  if (opts.attachments?.length) {
    message.attachments = opts.attachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.name,
      contentType: a.contentType,
      contentBytes: Buffer.from(a.content).toString('base64'),
    }))
  }

  const token = await getGraphToken()
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail ${res.status}: ${err.slice(0, 400)}`)
  }

  return {
    recipients: toRecipients.length + ccRecipients.length + bccRecipients.length,
    sender: SENDER_EMAIL,
  }
}

export function reportSenderAddress(): string {
  return SENDER_EMAIL
}
