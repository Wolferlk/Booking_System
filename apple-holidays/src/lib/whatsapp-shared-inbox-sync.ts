/**
 * Shared-inbox sync — imports customer REPLIES into this system's own
 * `whatsapp_messages` table.
 *
 * Why: Meta delivers the Operations number's inbound webhook to ONE endpoint,
 * and that endpoint is n8n's (it also carries the voice-call webhooks, which is
 * the only thing we interconnect with n8n for). n8n durably stores every
 * inbound — real text, media, wamid — in `tbl_whatsapp_messages` in the
 * `production_live1` schema ON THE SAME MySQL SERVER as our own database.
 *
 * So instead of relying on n8n to push messages to us, WE read that table and
 * copy the inbound rows we care about into our own store. All WhatsApp
 * handling (inbox, threads, 24h window, queued Tour Confirmations) then runs
 * entirely inside the booking system.
 *
 * The same goes for delivery receipts (✓ / ✓✓ / blue ✓✓). n8n gets Meta's
 * `statuses` for messages WE sent, and files them in
 * `tbl_whatsapp_status_receipts` (its own outbound rows keep theirs on
 * `tbl_whatsapp_messages.send_status`). `syncDeliveryReceipts` reads them back
 * by wamid and walks our rows up the ladder.
 *
 * Fully optional: without WA_SHARED_DB_* env config every function is a no-op,
 * and any query failure degrades to "no new rows" — never throws.
 */

import mysql from 'mysql2/promise'
import { prisma } from '@/lib/prisma'
import { findBookingByPhone, normalisePhone } from '@/lib/whatsapp'
import { applyDeliveryStatuses, type MetaDeliveryStatus } from '@/lib/whatsapp-delivery-status'

// n8n's inbox media proxy — relative media_url paths are served from here.
const DEFAULT_MEDIA_BASE = 'https://travel-parser-live.aahaas.com'

const MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker']

let pool: mysql.Pool | null | undefined

function getPool(): mysql.Pool | null {
  if (pool !== undefined) return pool
  const host = process.env.WA_SHARED_DB_HOST?.trim()
  const user = process.env.WA_SHARED_DB_USER?.trim()
  const password = process.env.WA_SHARED_DB_PASSWORD ?? ''
  if (!host || !user) {
    console.warn('[WA SharedSync] WA_SHARED_DB_* not configured — reply sync disabled')
    pool = null
    return pool
  }
  pool = mysql.createPool({
    host,
    port: Number(process.env.WA_SHARED_DB_PORT ?? 3306),
    user,
    password,
    database: process.env.WA_SHARED_DB_DATABASE?.trim() || 'production_live1',
    connectionLimit: 3,
    // n8n stores every DATETIME in this table as a UTC wall-clock string (see
    // its mysql-pool.js). Without this, mysql2 defaults to interpreting them in
    // the Node process's local timezone, silently shifting created_at by the
    // local offset — which is why inbound message times were showing as raw
    // UTC instead of +5:30. 'Z' makes the round-trip correct on any server.
    timezone: 'Z',
  })
  return pool
}

interface SharedRow {
  wa_id: string
  wa_message_id: string | null
  message_type: string
  body: string | null
  media_url: string | null
  media_caption: string | null
  meta: unknown
  created_at: Date
  display_name: string | null
}

/**
 * Body of the stand-in row the inbound signal writes when it can't find the
 * real message yet. Sync replaces it with the real message when that arrives.
 */
export const INBOUND_PLACEHOLDER_BODY = '[customer replied]'

// How far apart a placeholder and the real message can be and still count as
// the same reply. The signal fires within seconds, so this is generous.
const PLACEHOLDER_MATCH_MS = 10 * 60_000

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseMeta(raw: unknown): Record<string, any> | null {
  if (!raw) return null
  if (typeof raw === 'object') return raw as Record<string, any>
  if (typeof raw !== 'string') return null
  try {
    const v = JSON.parse(raw)
    // MariaDB can hand back JSON that was encoded twice.
    return typeof v === 'string' ? parseMeta(v) : (v && typeof v === 'object' ? v : null)
  } catch { return null }
}

/**
 * A customer's answer to our "Allow WhatsApp calls?" request
 * (`interactive.type = call_permission_reply`). Older n8n builds keep only
 * `rawType`. Newer ones also keep the reply object, under one of the keys below.
 */
function callPermissionResponse(meta: Record<string, any> | null): string | null {
  const reply =
    meta?.callPermissionReply ??
    meta?.call_permission_reply ??
    meta?.interactive?.call_permission_reply ??
    meta?.raw?.interactive?.call_permission_reply ??
    meta?.unsupported?.raw?.interactive?.call_permission_reply
  const response = typeof reply === 'string' ? reply : reply?.response
  return typeof response === 'string' ? response.toLowerCase() : null
}

const MEDIA_LABEL: Record<string, string> = {
  image:    '📷 Photo',
  video:    '🎬 Video',
  audio:    '🎤 Voice message',
  document: '📄 Document',
  sticker:  '🏷️ Sticker',
}

/**
 * What the inbox should show for an inbound row. When the customer sent text or
 * a caption, that text. Otherwise a short label for what they did, because a
 * call-permission tap, a reaction or a photo with no caption has no text, and
 * these rows used to be dropped and shown as "[customer replied]".
 */
export function describeInbound(row: Pick<SharedRow, 'message_type' | 'body' | 'media_caption' | 'media_url' | 'meta'>): string | null {
  const text = (row.body ?? row.media_caption ?? '').trim()
  if (text) return text

  const meta = parseMeta(row.meta)
  const type = String(row.message_type || meta?.rawType || '').toLowerCase()

  if (MEDIA_TYPES.includes(type)) {
    // The picture/file shows on its own once there is a link; until then, name it.
    if (row.media_url) return null
    const filename = typeof meta?.filename === 'string' ? meta.filename : ''
    return type === 'document' && filename ? `📄 ${filename}` : MEDIA_LABEL[type]
  }

  if (type === 'interactive') {
    const response = callPermissionResponse(meta)
    if (response === 'accept') return '✅ Allowed WhatsApp calls'
    if (response === 'reject') return '❌ Declined WhatsApp calls'
    // With no text on it, an interactive reply is the answer to a call request:
    // every button/list reply carries its title as the body.
    return '📞 Answered the WhatsApp call request'
  }

  if (type === 'button')   return '🔘 Tapped a button'
  if (type === 'reaction') return '👍 Reacted to a message'
  if (type === 'location') return '📍 Shared a location'
  if (type === 'contacts') return '👤 Shared a contact'
  if (type === 'order')    return '🛒 Sent an order'
  if (type === 'system')   return 'ℹ️ WhatsApp account update'
  if (type === 'unsupported') {
    const err = meta?.unsupported?.errors?.[0]
    const why = err?.error_data?.details || err?.title || err?.message
    return `⚠️ WhatsApp did not pass this message on (poll, OTP or other unsupported type)${why ? ` — ${why}` : ''}`
  }
  return type ? `💬 Sent a ${type} message` : '💬 Sent a message'
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function resolveMediaUrl(raw: string | null): string | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const base = (process.env.WA_SHARED_MEDIA_BASE?.trim() || DEFAULT_MEDIA_BASE).replace(/\/+$/, '')
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`
}

/**
 * One customer message is one inbound row with its wamid. Duplicates are
 * possible in older data (see syncInboundForPhones: overlapping syncs used to
 * both import the same reply), so every chat view drops a repeated inbound
 * wamid, keeping the first occurrence in the order given. Outbound rows and
 * rows without a wamid are untouched.
 */
export function dropDuplicateInbound<T extends { direction: string; waMessageId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => {
    if (r.direction !== 'inbound' || !r.waMessageId) return true
    if (seen.has(r.waMessageId)) return false
    seen.add(r.waMessageId)
    return true
  })
}

/**
 * Per-phone lock for the import. The same phone is synced from several places
 * at once — n8n's inbound signal, every open inbox thread (5 s poll), the
 * conversation list (8 s poll), group chats — and the import is "read what we
 * have, then insert the rest". Two overlapping runs both saw the new reply as
 * missing and both inserted it, so the customer's message showed twice
 * (VN40854, 2026-11-26). Runs touching a common phone now go one after the
 * other; the later one finds the row already there.
 *
 * Each run only waits on locks registered before it, so this cannot deadlock.
 */
const phoneLocks = new Map<string, Promise<void>>()

async function withPhoneLocks<T>(phones: string[], work: () => Promise<T>): Promise<T> {
  const earlier = Array.from(new Set(phones.map(p => phoneLocks.get(p)).filter((p): p is Promise<void> => !!p)))
  let release!: () => void
  const mine = new Promise<void>(resolve => { release = resolve })
  for (const p of phones) phoneLocks.set(p, mine)
  try {
    await Promise.all(earlier)
    return await work()
  } finally {
    release()
    for (const p of phones) if (phoneLocks.get(p) === mine) phoneLocks.delete(p)
  }
}

/**
 * Import inbound rows from the shared store for the given phone numbers.
 * Dedupes on wa_message_id against our own table. Returns how many rows were
 * imported (0 when disabled, nothing new, or the shared DB is unreachable).
 */
export async function syncInboundForPhones(
  phones: string[],
  opts: { sinceDays?: number } = {},
): Promise<number> {
  if (!getPool()) return 0
  const targets = Array.from(new Set(phones.map(normalisePhone).filter(Boolean)))
  if (targets.length === 0) return 0
  return withPhoneLocks(targets, () => syncInboundLocked(targets, opts))
}

async function syncInboundLocked(
  targets: string[],
  opts: { sinceDays?: number },
): Promise<number> {
  const db = getPool()
  if (!db) return 0

  const since = new Date(Date.now() - (opts.sinceDays ?? 14) * 86400000)

  try {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT m.wa_id, m.wa_message_id, m.message_type, m.body, m.media_url,
              m.media_caption, m.meta, m.created_at, c.display_name
       FROM tbl_whatsapp_messages m
       LEFT JOIN tbl_whatsapp_conversations c ON c.wa_id = m.wa_id
       WHERE m.direction = 'in'
         AND m.created_at >= ?
         AND m.wa_id IN (${targets.map(() => '?').join(',')})
       ORDER BY m.id ASC
       LIMIT 1000`,
      [since, ...targets],
    )
    const shared = rows as unknown as SharedRow[]
    if (shared.length === 0) return 0

    // Which wamids do we already have? (also covers rows the old signal path
    // never wrote — those simply won't match and get imported now)
    const wamids = shared.map(r => r.wa_message_id).filter((v): v is string => !!v)
    const existing = wamids.length
      ? await prisma.whatsAppMessage.findMany({
          where: { waMessageId: { in: wamids } },
          select: { id: true, waMessageId: true, body: true, mediaUrl: true, mediaType: true },
        })
      : []
    const have = new Set(existing.map(e => e.waMessageId))

    // Media we imported before n8n finished saving the file to S3 has a label and
    // no link. Add the link now that the file is there, and drop the label.
    const sharedByWamid = new Map(shared.filter(r => r.wa_message_id).map(r => [r.wa_message_id!, r]))
    for (const e of existing) {
      const r = e.waMessageId ? sharedByWamid.get(e.waMessageId) : undefined
      if (!r || e.mediaUrl || !r.media_url || !MEDIA_TYPES.includes(r.message_type)) continue
      const label = describeInbound({ ...r, media_url: null })
      await prisma.whatsAppMessage.update({
        where: { id: e.id },
        data:  {
          mediaUrl:  resolveMediaUrl(r.media_url),
          mediaType: e.mediaType ?? r.message_type,
          ...(e.body === label ? { body: describeInbound(r) } : {}),
        },
      })
    }

    // Resolve each phone's booking once, not per message.
    const refByPhone = new Map<string, string>()
    for (const phone of Array.from(new Set(shared.map(r => normalisePhone(r.wa_id))))) {
      const booking = await findBookingByPhone(phone)
      refByPhone.set(phone, booking ? booking.bookingRef : `UNKNOWN:${phone}`)
    }

    // Every inbound is imported, including ones with no text (call-permission
    // answers, captionless photos, reactions). describeInbound() gives each one
    // something to show. Skipping them used to leave the signal's
    // "[customer replied]" stand-in as the only trace of the reply.
    // `have` also takes each wamid as it is queued, so a reply n8n stored twice
    // is still imported once.
    let incoming = shared
      .filter(r => {
        if (!r.wa_message_id || have.has(r.wa_message_id)) return false
        have.add(r.wa_message_id)
        return true
      })
      .map(r => {
        const phone = normalisePhone(r.wa_id)
        const isMedia = MEDIA_TYPES.includes(r.message_type)
        return {
          bookingRef:  refByPhone.get(phone) ?? `UNKNOWN:${phone}`,
          phone,
          direction:   'inbound',
          body:        describeInbound(r),
          waMessageId: r.wa_message_id,
          status:      'received',
          senderName:  r.display_name ?? null,
          mediaUrl:    isMedia ? resolveMediaUrl(r.media_url) : null,
          mediaType:   isMedia ? r.message_type : null,
          read:        false,
          createdAt:   r.created_at,
        }
      })

    if (incoming.length === 0) return 0

    // Last look just before writing. The phone lock covers this server process;
    // this narrows the gap if another process (a second instance, the Meta
    // webhook route) stored one of these replies since the check above.
    const landed = new Set((await prisma.whatsAppMessage.findMany({
      where:  { waMessageId: { in: incoming.map(r => r.waMessageId!) } },
      select: { waMessageId: true },
    })).map(e => e.waMessageId))
    if (landed.size) {
      incoming = incoming.filter(r => !landed.has(r.waMessageId))
      if (incoming.length === 0) return 0
    }

    // Replace "[customer replied]" stand-ins with the message they stood for
    // (nearest in time, same phone) instead of adding a second bubble beside them.
    const placeholders = await prisma.whatsAppMessage.findMany({
      where: {
        phone:       { in: Array.from(new Set(incoming.map(r => r.phone))) },
        direction:   'inbound',
        waMessageId: null,
        body:        INBOUND_PLACEHOLDER_BODY,
        createdAt:   { gte: new Date(since.getTime() - PLACEHOLDER_MATCH_MS) },
      },
      select: { id: true, phone: true, createdAt: true, read: true },
    })
    const unclaimed = new Set(placeholders.map(p => p.id))
    const toCreate: typeof incoming = []
    let replaced = 0
    for (const row of incoming) {
      let best: (typeof placeholders)[number] | null = null
      for (const p of placeholders) {
        if (!unclaimed.has(p.id) || p.phone !== row.phone) continue
        const gap = Math.abs(p.createdAt.getTime() - row.createdAt.getTime())
        if (gap > PLACEHOLDER_MATCH_MS) continue
        if (!best || gap < Math.abs(best.createdAt.getTime() - row.createdAt.getTime())) best = p
      }
      if (!best) { toCreate.push(row); continue }
      unclaimed.delete(best.id)
      // Keep the stand-in's read flag: staff may already have opened the chat.
      await prisma.whatsAppMessage.update({
        where: { id: best.id },
        data:  { ...row, read: best.read },
      })
      replaced++
    }

    if (toCreate.length) await prisma.whatsAppMessage.createMany({ data: toCreate })
    console.log(`[WA SharedSync] imported ${incoming.length} inbound message(s) for ${targets.length} phone(s)` +
      (replaced ? ` (${replaced} replaced a "customer replied" placeholder)` : ''))
    return incoming.length
  } catch (err) {
    console.error('[WA SharedSync] sync failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** Convenience wrapper for a single phone (thread view / inbound signal). */
export function syncInboundForPhone(phone: string, opts: { sinceDays?: number } = {}) {
  return syncInboundForPhones([phone], opts)
}

/**
 * Catch-up sync for every phone we already know about (any row in our own
 * whatsapp_messages). Used by the conversation list so replies appear even
 * when nobody has opened the thread yet. Short window keeps it cheap.
 */
export async function syncInboundRecent(opts: { sinceDays?: number } = {}): Promise<number> {
  if (!getPool()) return 0
  try {
    const known = await prisma.whatsAppMessage.findMany({
      distinct: ['phone'],
      select: { phone: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    })
    return await syncInboundForPhones(known.map(k => k.phone), { sinceDays: opts.sinceDays ?? 3 })
  } catch (err) {
    console.error('[WA SharedSync] recent sync failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/**
 * Which Aahaas business number did these replies arrive on? Every Aahaas number
 * shares n8n's webhook, so the inbox holds replies sent to any of them.
 *
 * - Per message: n8n's `meta.phoneNumberId` on the inbound row (recorded since
 *   the n8n change of 2026-11-12; older rows have none).
 * - Per guest fallback: `tbl_whatsapp_conversations.phone_number_id`, the
 *   number n8n last saw that guest on.
 *
 * A message's number never changes, so wamid answers are cached for the life of
 * the process; the per-guest fallback is cached briefly. Empty maps when the
 * shared DB isn't configured or the query fails — never throws.
 */
const wamidNumberCache = new Map<string, string | null>()
let phoneNumberCache: { at: number; map: Map<string, string | null> } = { at: 0, map: new Map() }
const PHONE_NUMBER_TTL_MS = 60_000

export async function businessNumbersForInbound(
  wamids: string[],
  phones: string[],
): Promise<{ byWamid: Map<string, string | null>; byPhone: Map<string, string | null> }> {
  const byWamid = new Map<string, string | null>()
  const byPhone = new Map<string, string | null>()
  const db = getPool()
  if (!db) return { byWamid, byPhone }

  try {
    const missing = Array.from(new Set(wamids.filter(w => w && !wamidNumberCache.has(w))))
    for (let i = 0; i < missing.length; i += 1000) {
      const chunk = missing.slice(i, i + 1000)
      const [rows] = await db.query<mysql.RowDataPacket[]>(
        `SELECT wa_message_id, JSON_UNQUOTE(JSON_EXTRACT(meta, '$.phoneNumberId')) AS pn
         FROM tbl_whatsapp_messages
         WHERE wa_message_id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      )
      const found = new Map((rows as { wa_message_id: string; pn: string | null }[])
        .map(r => [r.wa_message_id, r.pn && r.pn !== 'null' ? r.pn : null]))
      for (const w of chunk) wamidNumberCache.set(w, found.get(w) ?? null)
    }
    for (const w of wamids) if (w) byWamid.set(w, wamidNumberCache.get(w) ?? null)

    if (Date.now() - phoneNumberCache.at > PHONE_NUMBER_TTL_MS) phoneNumberCache = { at: Date.now(), map: new Map() }
    const cache = phoneNumberCache.map
    const unknownPhones = Array.from(new Set(phones.map(normalisePhone).filter(p => p && !cache.has(p))))
    for (let i = 0; i < unknownPhones.length; i += 1000) {
      const chunk = unknownPhones.slice(i, i + 1000)
      const [rows] = await db.query<mysql.RowDataPacket[]>(
        `SELECT wa_id, phone_number_id FROM tbl_whatsapp_conversations
         WHERE wa_id IN (${chunk.map(() => '?').join(',')})`,
        chunk,
      )
      const found = new Map((rows as { wa_id: string; phone_number_id: string | null }[])
        .map(r => [normalisePhone(r.wa_id), r.phone_number_id || null]))
      for (const p of chunk) cache.set(p, found.get(p) ?? null)
    }
    for (const p of phones) {
      const key = normalisePhone(p)
      if (key) byPhone.set(p, cache.get(key) ?? null)
    }
  } catch (err) {
    console.error('[WA SharedSync] business-number lookup failed:', err instanceof Error ? err.message : err)
  }
  return { byWamid, byPhone }
}

/**
 * Is Meta's 24-hour window open between this person and the number OPS sends
 * from (Aahaas Operations)?
 *
 * Meta keys the window per business number. Every Aahaas number shares n8n's
 * webhook, so our inbox also holds replies the person sent to Aahaas B2C,
 * Supplier, Apple… A plain "any inbound in 24h" check therefore reads a reply
 * to the Supplier line as an open window on Operations, sends free-form, and
 * Meta drops it with 131047 ("Re-engagement message"). This counts only
 * replies that landed on Operations.
 *
 * When the number cannot be determined (shared DB unreachable, no record) the
 * answer is `false`: the approved template always delivers, a free-form
 * message on a closed window never does.
 */
export async function isOpsWindowOpen(phone: string): Promise<boolean> {
  const p = normalisePhone(phone)
  if (!p) return false
  const recent = await prisma.whatsAppMessage.findMany({
    where:   { phone: p, direction: 'inbound', createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    select:  { waMessageId: true },
    take:    50,
  })
  if (recent.length === 0) return false

  const opsId = OPS_PHONE_NUMBER_ID()
  if (!opsId) return true // single-number setup: the old reading is right

  const wamids = recent.map(r => r.waMessageId).filter((w): w is string => !!w)
  const { byWamid, byPhone } = await businessNumbersForInbound(wamids, [p])
  const guestNumber = byPhone.get(p) ?? null
  return recent.some(r => {
    const on = (r.waMessageId && byWamid.get(r.waMessageId)) || guestNumber
    return on === opsId
  })
}

function OPS_PHONE_NUMBER_ID(): string {
  return (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim()
}

// Outbound statuses that can still climb. `read` and `failed` are the last word.
const OPEN_OUTBOUND = ['pending', 'accepted', 'held', 'sent', 'delivered']

interface SharedReceipt {
  wa_message_id: string
  status: string
  error_code: number | null
  error_title: string | null
  status_at: Date | null
}

/**
 * Pull n8n's stored receipts for these wamids and apply them to our chat log
 * and driver-document sends. Returns how many rows moved. Before n8n creates
 * `tbl_whatsapp_status_receipts` the query fails and this quietly returns 0.
 */
export async function syncDeliveryReceipts(wamids: string[]): Promise<number> {
  const db = getPool()
  const ids = Array.from(new Set(wamids.filter(Boolean))).slice(0, 500)
  if (!db || ids.length === 0) return 0

  try {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT wa_message_id, status, error_code, error_title, status_at
       FROM tbl_whatsapp_status_receipts
       WHERE wa_message_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    )
    const receipts = rows as unknown as SharedReceipt[]
    if (receipts.length === 0) return 0

    const statuses: MetaDeliveryStatus[] = receipts.map(r => ({
      id:        r.wa_message_id,
      status:    r.status,
      timestamp: r.status_at ? Math.floor(new Date(r.status_at).getTime() / 1000) : undefined,
      errors:    r.status === 'failed'
        ? [{ code: r.error_code ?? undefined, title: r.error_title ?? undefined }]
        : undefined,
    }))
    const result = await applyDeliveryStatuses(statuses)
    return result.messages + result.documents
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code !== 'ER_NO_SUCH_TABLE') {
      console.error('[WA SharedSync] receipt sync failed:', err instanceof Error ? err.message : err)
    }
    return 0
  }
}

/**
 * Meta's failure codes, in words the desk can act on. A bare red "!" told
 * nobody whether to retry, call the guest or wait — these say which.
 */
const FAILURE_HINTS: Record<number, string> = {
  131049: 'Meta held it back to protect the guest from too many business messages (per-user limit). Retrying will not help; call the guest or wait for them to write.',
  131026: 'This number cannot receive WhatsApp messages (not on WhatsApp, old app version, or it has not accepted the latest terms).',
  131047: 'More than 24 hours since the guest last wrote, so plain text was dropped. Send an approved template instead.',
  131050: 'The guest has stopped business messages from us on WhatsApp.',
  131048: 'Our number is being rate-limited for spam (quality rating). Messages are being held back by Meta.',
  131056: 'Too many messages to this guest in a short time. Wait a few minutes before sending again.',
  130472: "Meta withheld it as part of a WhatsApp experiment on this guest's number. Reach them another way.",
  131042: 'Meta blocked it because the WhatsApp Business account has a payment problem. Templates (anything outside the 24h window) will keep failing until the card / credit line is fixed in Meta Business Manager → Billing. Replies inside the 24h window still go through.',
  131031: 'The WhatsApp business account is locked or restricted by Meta.',
  131053: 'The attachment could not be processed by WhatsApp.',
  131000: 'WhatsApp had an internal error. Try sending again.',
}

/** Meta failure codes where sending the same message again cannot help. */
export const NON_RETRYABLE_FAILURES = new Set([131026, 131049, 131050])

/**
 * Why each failed message failed, by wamid, from n8n's receipts — Meta's code
 * and the reason in plain words. Empty when the shared DB is not configured or
 * the query fails — never throws.
 */
export async function failureDetailsFor(wamids: string[]): Promise<Map<string, { code: number | null; reason: string }>> {
  const out = new Map<string, { code: number | null; reason: string }>()
  const db = getPool()
  const all = Array.from(new Set(wamids.filter(Boolean)))
  if (!db || all.length === 0) return out
  try {
    for (let i = 0; i < all.length; i += 500) {
      const ids = all.slice(i, i + 500)
      const [rows] = await db.query<mysql.RowDataPacket[]>(
        `SELECT wa_message_id, error_code, error_title
         FROM tbl_whatsapp_status_receipts
         WHERE status = 'failed' AND wa_message_id IN (${ids.map(() => '?').join(',')})`,
        ids,
      )
      for (const r of rows as unknown as SharedReceipt[]) {
        const code = r.error_code != null ? Number(r.error_code) : null
        const hint = code != null ? FAILURE_HINTS[code] : undefined
        const meta = [code != null ? `Meta ${code}` : null, r.error_title].filter(Boolean).join(': ')
        out.set(r.wa_message_id, {
          code,
          reason: hint ? `${hint}${meta ? ` (${meta})` : ''}` : meta || 'WhatsApp could not deliver this message.',
        })
      }
    }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code !== 'ER_NO_SUCH_TABLE') {
      console.error('[WA SharedSync] failure reason lookup failed:', err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** Why each failed message failed, by wamid, as a sentence. Never throws. */
export async function failureReasonsFor(wamids: string[]): Promise<Map<string, string>> {
  const details = await failureDetailsFor(wamids.slice(0, 500))
  return new Map(Array.from(details, ([id, d]) => [id, d.reason]))
}

/** Receipts for one thread — every outbound message that can still change ticks. */
export async function syncDeliveryReceiptsForPhone(phone: string, opts: { sinceDays?: number } = {}) {
  if (!getPool()) return 0
  try {
    const open = await prisma.whatsAppMessage.findMany({
      where: {
        phone:       normalisePhone(phone),
        direction:   'outbound',
        waMessageId: { not: null },
        status:      { in: OPEN_OUTBOUND },
        createdAt:   { gte: new Date(Date.now() - (opts.sinceDays ?? 30) * 86400000) },
      },
      select:  { waMessageId: true },
      orderBy: { createdAt: 'desc' },
      take:    300,
    })
    return await syncDeliveryReceipts(open.map(m => m.waMessageId!))
  } catch (err) {
    console.error('[WA SharedSync] thread receipt sync failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** Receipts for recent outbound across every chat — keeps the inbox list's ticks current. */
export async function syncDeliveryReceiptsRecent(opts: { sinceDays?: number } = {}) {
  if (!getPool()) return 0
  try {
    const open = await prisma.whatsAppMessage.findMany({
      where: {
        direction:   'outbound',
        waMessageId: { not: null },
        status:      { in: OPEN_OUTBOUND },
        createdAt:   { gte: new Date(Date.now() - (opts.sinceDays ?? 3) * 86400000) },
      },
      select:  { waMessageId: true },
      orderBy: { createdAt: 'desc' },
      take:    500,
    })
    return await syncDeliveryReceipts(open.map(m => m.waMessageId!))
  } catch (err) {
    console.error('[WA SharedSync] recent receipt sync failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
