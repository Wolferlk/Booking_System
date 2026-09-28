import { getGraphToken } from '@/lib/mail-processor'
import { matchAgentForBooking, agentAddresses } from '@/lib/mailbox/resolve'

const SENDER_EMAIL = process.env.Outlookmail_USERNAME ?? 'confirm.booking@aahaas.com'
/**
 * Where an automated booking mail goes when no agent address can be found: the
 * team's own confirmation inbox, so the mail (and its PDF) is still delivered to
 * someone who can forward it, instead of the send throwing and vanishing into a
 * fire-and-forget log line.
 */
export const FALLBACK_AGENT_EMAIL = 'confirm.booking@aahaas.com'

interface MailAttachment {
  name: string
  contentType: string
  buffer: Buffer
}

interface SendMailOptions {
  to: string
  cc?: string[]
  subject: string
  bodyHtml: string
  attachment?: MailAttachment
}

export async function sendMailViaGraph(opts: SendMailOptions): Promise<void> {
  const to = opts.to?.trim()
  if (!to) throw new Error('sendMailViaGraph: recipient "to" is empty')

  const cleanCc = (opts.cc ?? []).map(a => a?.trim()).filter((a): a is string => !!a && a.includes('@') && a !== to)

  const token = await getGraphToken()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const message: Record<string, any> = {
    subject: opts.subject,
    body: {
      contentType: 'HTML',
      content: opts.bodyHtml,
    },
    toRecipients: [
      {
        emailAddress: { address: to },
      },
    ],
    ...(cleanCc.length > 0
      ? { ccRecipients: cleanCc.map(addr => ({ emailAddress: { address: addr } })) }
      : {}),
  }

  if (opts.attachment) {
    message.attachments = [
      {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: opts.attachment.name,
        contentType: opts.attachment.contentType,
        contentBytes: Buffer.from(opts.attachment.buffer).toString('base64'),
      },
    ]
  }

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER_EMAIL)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Graph sendMail ${res.status}: ${err.slice(0, 400)}`)
  }
}

const isAddress = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/**
 * Who an automated booking mail (Client Confirmed / Operations Ready) goes to.
 *
 * `Booking.agentEmail` is often blank — an empty string rather than null — so a
 * plain `??` fallback never fired and Graph was handed an empty "to". The ladder:
 *  1. the booking's own agentEmail, when it is a real address;
 *  2. the Mail Box agent directory, but only on a certain match (known email,
 *     exact name or alias) — a partial name hit is a guess, and a guess must not
 *     receive another operator's booking;
 *  3. the internal confirmation inbox.
 * Directory CCs ride along whenever the directory matched.
 */
export async function resolveAgentRecipients(booking: {
  bookingRef?: string
  agent?: string | null
  agentEmail?: string | null
}): Promise<{ to: string; cc: string[]; source: 'booking' | 'directory' | 'fallback' }> {
  const own = isAddress(booking.agentEmail) ? booking.agentEmail.trim() : null

  let directory: { to: string[]; cc: string[] } = { to: [], cc: [] }
  try {
    const match = await matchAgentForBooking({ agent: booking.agent, agentEmail: own })
    if (match.agent && match.reason !== 'partial') directory = agentAddresses(match.agent)
  } catch (err) {
    // The directory is a nice-to-have here; its absence must not block the mail.
    console.warn('[email] Agent directory lookup failed:', err)
  }

  if (own) return { to: own, cc: directory.cc, source: 'booking' }
  if (directory.to[0]) {
    return { to: directory.to[0], cc: [...directory.to.slice(1), ...directory.cc], source: 'directory' }
  }

  console.warn(
    `[email] No agent email for ${booking.bookingRef ?? 'booking'} (agent: ${booking.agent ?? '—'}) — sending to ${FALLBACK_AGENT_EMAIL}`,
  )
  return { to: FALLBACK_AGENT_EMAIL, cc: [], source: 'fallback' }
}

export function buildAgentConfirmationEmail(booking: {
  bookingRef: string
  agent?: string | null
  fileHandler?: string | null
  arrivalDate?: string | Date | null
  departureDate?: string | Date | null
  paxAdults?: number | null
  paxChildren?: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quotedTotal?: any
  currency?: string | null
}): string {
  const fmt = (d: string | Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const total = booking.quotedTotal
    ? `${booking.currency ?? 'USD'} ${Number(booking.quotedTotal).toLocaleString()}`
    : '—'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking Confirmation — ${booking.bookingRef}</title>
  <style>
    body { margin: 0; padding: 0; background: #f8fafc; font-family: Arial, Helvetica, sans-serif; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    .header { background: #1E293B; padding: 28px 32px; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 800; }
    .header p { margin: 4px 0 0; color: #94A3B8; font-size: 12px; }
    .ref-badge { display: inline-block; background: #D97706; color: #fff; font-weight: 700; font-size: 16px; padding: 4px 14px; border-radius: 4px; margin-top: 10px; letter-spacing: 1px; font-family: monospace; }
    .body { padding: 28px 32px; }
    .status-banner { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 12px 16px; margin-bottom: 22px; }
    .status-banner p { margin: 0; color: #166534; font-size: 14px; font-weight: 600; }
    .status-banner small { color: #15803d; font-size: 12px; font-weight: 400; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; padding: 6px 10px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
    td { font-size: 13px; color: #1e293b; padding: 8px 10px; border-bottom: 1px solid #f1f5f9; }
    td.label { font-weight: 600; color: #475569; width: 40%; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 32px; text-align: center; }
    .footer p { margin: 0; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Apple Holidays</h1>
      <p>MMT Vietnam &mdash; Booking Confirmation</p>
      <div class="ref-badge">${booking.bookingRef}</div>
    </div>
    <div class="body">
      <div class="status-banner">
        <p>&#10003; Client Confirmed</p>
        <small>This booking has been confirmed by the Travel Experience team. Please find the full booking details attached as a PDF.</small>
      </div>

      <table>
        <tr><th colspan="2">Booking Details</th></tr>
        <tr><td class="label">Agent / Operator</td><td>${booking.agent ?? '—'}</td></tr>
        <tr><td class="label">File Handler</td><td>${booking.fileHandler ?? '—'}</td></tr>
        <tr><td class="label">Arrival</td><td>${fmt(booking.arrivalDate)}</td></tr>
        <tr><td class="label">Departure</td><td>${fmt(booking.departureDate)}</td></tr>
        <tr><td class="label">Passengers</td><td>${booking.paxAdults ?? 0} Adults${(booking.paxChildren ?? 0) > 0 ? `, ${booking.paxChildren} Children` : ''}</td></tr>
      </table>

      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 16px;">
        The attached PDF contains the complete itinerary, accommodation details, and tour programme for this booking.
        Please review and get in touch if you have any queries.
      </p>
      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0;">
        Thank you for booking with Apple Holidays.
      </p>
    </div>
    <div class="footer">
      <p>Apple Holidays &middot; MMT Vietnam &middot; confirm.booking@aahaas.com</p>
      <p style="margin-top:4px;">This email was sent automatically when the booking status changed to <em>Client Confirmed</em>.</p>
    </div>
  </div>
</body>
</html>
`
}

export function buildOperationsReadyEmail(booking: {
  bookingRef: string
  agent?: string | null
  fileHandler?: string | null
  arrivalDate?: string | Date | null
  departureDate?: string | Date | null
  paxAdults?: number | null
  paxChildren?: number | null
  currency?: string | null
}): string {
  const fmt = (d: string | Date | null | undefined) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Operations Ready — ${booking.bookingRef}</title>
  <style>
    body { margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif; }
    .wrapper { max-width:600px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1); }
    .header { background:#1E293B;padding:28px 32px; }
    .header h1 { margin:0;color:#fff;font-size:22px;font-weight:800; }
    .header p { margin:4px 0 0;color:#94A3B8;font-size:12px; }
    .ref-badge { display:inline-block;background:#D97706;color:#fff;font-weight:700;font-size:16px;padding:4px 14px;border-radius:4px;margin-top:10px;letter-spacing:1px;font-family:monospace; }
    .body { padding:28px 32px; }
    .status-banner { background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:12px 16px;margin-bottom:22px; }
    .status-banner p { margin:0;color:#1e40af;font-size:14px;font-weight:600; }
    .status-banner small { color:#1d4ed8;font-size:12px;font-weight:400; }
    table { width:100%;border-collapse:collapse;margin-bottom:20px; }
    th { text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;color:#64748b;padding:6px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0; }
    td { font-size:13px;color:#1e293b;padding:8px 10px;border-bottom:1px solid #f1f5f9; }
    td.label { font-weight:600;color:#475569;width:40%; }
    .footer { background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 32px;text-align:center; }
    .footer p { margin:0;font-size:11px;color:#94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>Apple Holidays</h1>
      <p>MMT Vietnam &mdash; Operations Ready</p>
      <div class="ref-badge">${booking.bookingRef}</div>
    </div>
    <div class="body">
      <div class="status-banner">
        <p>&#9654; Operations Ready</p>
        <small>Drivers have been allocated. The full booking package including ticket &amp; driver details is attached as a PDF.</small>
      </div>
      <table>
        <tr><th colspan="2">Booking Details</th></tr>
        <tr><td class="label">Agent / Operator</td><td>${booking.agent ?? '—'}</td></tr>
        <tr><td class="label">File Handler</td><td>${booking.fileHandler ?? '—'}</td></tr>
        <tr><td class="label">Arrival</td><td>${fmt(booking.arrivalDate)}</td></tr>
        <tr><td class="label">Departure</td><td>${fmt(booking.departureDate)}</td></tr>
        <tr><td class="label">Passengers</td><td>${booking.paxAdults ?? 0} Adults${(booking.paxChildren ?? 0) > 0 ? `, ${booking.paxChildren} Children` : ''}</td></tr>
        <tr><td class="label">Currency</td><td>${booking.currency ?? '—'}</td></tr>
      </table>
      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 16px;">
        The attached PDF contains the complete tour package including itinerary, accommodation, ticket &amp; voucher details, and driver assignments.
      </p>
      <p style="font-size:13px;color:#475569;line-height:1.6;margin:0;">
        Thank you for choosing Apple Holidays.
      </p>
    </div>
    <div class="footer">
      <p>Apple Holidays &middot; MMT Vietnam &middot; confirm.booking@aahaas.com</p>
      <p style="margin-top:4px;">Sent automatically when booking status changed to <em>Operations Ready</em>.</p>
    </div>
  </div>
</body>
</html>
`
}
