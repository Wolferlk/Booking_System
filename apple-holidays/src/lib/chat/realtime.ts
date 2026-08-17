/**
 * The OPS half of the chat push channel.
 *
 * Two jobs, both small:
 *   mintTicket()  — a signed, short-lived identity the browser presents to the
 *                   hub, so the hub never has to know about NextAuth sessions.
 *   publish()     — one fire-and-forget POST telling the hub what just happened
 *                   and who should hear about it.
 *
 * The Accounts counterpart is app/Services/Chat/ChatRealtime.php and signs
 * identically — one secret, one ticket format, one event vocabulary, because the
 * hub serves both apps and cannot tell them apart.
 *
 * DISABLED BY DEFAULT. With CHAT_REALTIME_URL unset, every function here is a
 * no-op and the clients keep polling exactly as before, so deploying this code
 * changes nothing until the hub is actually running.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import { chatQuery } from './db'
import type { RowDataPacket } from 'mysql2'
import type { Identity } from './service'

/** Where the browser connects. Public URL, e.g. https://accounts.aahaas.com/realtime */
const PUBLIC_URL = (process.env.CHAT_REALTIME_URL ?? '').replace(/\/+$/, '')

/**
 * Where THIS server publishes. Usually the same host; kept separate so the app
 * can reach the hub directly (localhost, or an internal address) while browsers
 * go through the public one.
 */
const INTERNAL_URL = (process.env.CHAT_REALTIME_INTERNAL_URL ?? PUBLIC_URL).replace(/\/+$/, '')

const SECRET = (process.env.CHAT_REALTIME_SECRET ?? '').trim()

/** How long a stream ticket is good for. The client re-tickets before it lapses. */
const TICKET_TTL_SECONDS = Number(process.env.CHAT_REALTIME_TICKET_TTL ?? 3600)

/** A publish must never hold up the reply to the person who sent the message. */
const PUBLISH_TIMEOUT_MS = 1500

export function realtimeEnabled(): boolean {
  return Boolean(PUBLIC_URL && SECRET.length >= 24)
}

/* ── tickets ───────────────────────────────────────────────────────────────── */

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function sign(payload: string): string {
  return b64url(createHmac('sha256', SECRET).update(payload).digest())
}

export interface LiveTicket { url: string; ticket: string; expires_at: string; renew_in_seconds: number }

/**
 * A ticket for one identity, valid for an hour.
 *
 * The identity is taken from the server session by the caller — nothing the
 * browser sends is trusted here — so a ticket is proof of "the app says this is
 * who you are", and the hub needs nothing else.
 */
export function mintTicket(me: Identity): LiveTicket | null {
  if (!realtimeEnabled()) return null

  const expiry = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS
  const payload = b64url(JSON.stringify({ s: me.system, r: String(me.ref), e: expiry }))

  return {
    url: `${PUBLIC_URL}/events`,
    ticket: `${payload}.${sign(payload)}`,
    expires_at: new Date(expiry * 1000).toISOString(),
    // Reconnect with a fresh ticket a little before the old one lapses.
    renew_in_seconds: Math.max(60, TICKET_TTL_SECONDS - 120),
  }
}

/** Used by the routes that accept a ticket back from the browser (typing, presence). */
export function verifyTicket(ticket: string): Identity | null {
  if (!realtimeEnabled()) return null

  const [payload, signature] = String(ticket || '').split('.')
  if (!payload || !signature) return null

  const expected = sign(payload)
  const a = Buffer.from(signature), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    if (!claims?.s || claims.r === undefined) return null
    if (!Number.isFinite(claims.e) || claims.e * 1000 < Date.now()) return null
    return { system: String(claims.s), ref: String(claims.r) }
  } catch {
    return null
  }
}

/* ── publishing ────────────────────────────────────────────────────────────── */

export type LiveEvent =
  | 'message'      // a new message id exists in a thread
  | 'touch'        // an edit, delete or reaction — same ids, changed content
  | 'read'         // someone's read marker moved
  | 'typing'       // ephemeral, never stored
  | 'conversation' // a thread was created, renamed, or gained/lost members

interface Envelope { to: string[]; event: LiveEvent; data: Record<string, unknown> }

/**
 * Everyone who should hear about a conversation — its current participants.
 *
 * One indexed read. Cheap enough to do per message, and it keeps the hub free of
 * any knowledge of the schema: it is told the addressees, it does not work them
 * out.
 */
export async function recipientsOf(conversationId: number): Promise<string[]> {
  const rows = await chatQuery<RowDataPacket & { system: string; user_ref: string }>(
    'SELECT `system`, `user_ref` FROM `chat_participants` WHERE `conversation_id` = ? AND `left_at` IS NULL',
    [conversationId],
  )
  return rows.map(r => `${r.system}:${r.user_ref}`)
}

/**
 * Send one or more events to the hub.
 *
 * Never throws and never blocks the caller's own work: chat that has been
 * written is chat that happened, whether or not the notification got out. If it
 * does not, the clients' safety reconcile still finds the message — a few
 * seconds later instead of immediately.
 */
export async function publish(envelopes: Envelope | Envelope[]): Promise<void> {
  if (!realtimeEnabled()) return

  const list = (Array.isArray(envelopes) ? envelopes : [envelopes]).filter(e => e.to.length > 0)
  if (!list.length) return

  const raw = JSON.stringify(list.length === 1 ? list[0] : list)
  const signature = createHmac('sha256', SECRET).update(raw).digest('hex')

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS)

    const res = await fetch(`${INTERNAL_URL}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-chat-signature': `sha256=${signature}` },
      body: raw,
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)

    if (!res.ok) console.warn(`[chat] realtime publish refused (${res.status})`)
  } catch (err) {
    console.warn('[chat] realtime publish failed; clients will catch up on their next reconcile.', (err as Error)?.message)
  }
}

/**
 * The common case: a message landed in a thread.
 *
 * `last_id` is the whole point — the receiving client compares it with the newest
 * id it holds and reads the gap, which is the same reconciliation the poll used
 * to drive. Bodies are not pushed: the client reads them over its own
 * authenticated route, so the hub never holds message content beyond a preview.
 */
export async function publishMessage(
  conversationId: number,
  message: { id: number | null; kind: string; sender: { key: string; name: string }; body: string | null },
): Promise<void> {
  if (!realtimeEnabled() || !message.id) return

  const to = await recipientsOf(conversationId)
  await publish({
    to,
    event: 'message',
    data: {
      conversation_id: conversationId,
      last_id: message.id,
      kind: message.kind,
      from: message.sender.key,
      from_name: message.sender.name,
      preview: (message.body ?? '').slice(0, 120),
      at: new Date().toISOString(),
    },
  })
}

/** An edit, a delete or a reaction: the ids did not change, the content did. */
export async function publishTouch(conversationId: number, messageId: number): Promise<void> {
  if (!realtimeEnabled()) return
  const to = await recipientsOf(conversationId)
  await publish({
    to,
    event: 'touch',
    data: { conversation_id: conversationId, message_id: messageId, at: new Date().toISOString() },
  })
}

/** A new or changed thread, so the other side's list updates without a poll. */
export async function publishConversation(conversationId: number, reason: string): Promise<void> {
  if (!realtimeEnabled()) return
  const to = await recipientsOf(conversationId)
  await publish({
    to,
    event: 'conversation',
    data: { conversation_id: conversationId, reason, at: new Date().toISOString() },
  })
}
