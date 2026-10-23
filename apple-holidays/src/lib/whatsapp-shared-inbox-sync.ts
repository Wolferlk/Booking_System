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
  created_at: Date
  display_name: string | null
}

function resolveMediaUrl(raw: string | null): string | null {
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const base = (process.env.WA_SHARED_MEDIA_BASE?.trim() || DEFAULT_MEDIA_BASE).replace(/\/+$/, '')
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`
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
  const db = getPool()
  if (!db) return 0

  const targets = Array.from(new Set(phones.map(normalisePhone).filter(Boolean)))
  if (targets.length === 0) return 0

  const since = new Date(Date.now() - (opts.sinceDays ?? 14) * 86400000)

  try {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      `SELECT m.wa_id, m.wa_message_id, m.message_type, m.body, m.media_url,
              m.media_caption, m.created_at, c.display_name
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
          select: { waMessageId: true },
        })
      : []
    const have = new Set(existing.map(e => e.waMessageId))

    // Resolve each phone's booking once, not per message.
    const refByPhone = new Map<string, string>()
    for (const phone of Array.from(new Set(shared.map(r => normalisePhone(r.wa_id))))) {
      const booking = await findBookingByPhone(phone)
      refByPhone.set(phone, booking ? booking.bookingRef : `UNKNOWN:${phone}`)
    }

    const toCreate = shared
      .filter(r => r.wa_message_id && !have.has(r.wa_message_id))
      // Skip rows with nothing to show (e.g. "unsupported" reactions/locations
      // with no text and no media) — they'd render as empty bubbles.
      .filter(r => r.body || r.media_caption || (MEDIA_TYPES.includes(r.message_type) && r.media_url))
      .map(r => {
        const phone = normalisePhone(r.wa_id)
        const isMedia = MEDIA_TYPES.includes(r.message_type)
        return {
          bookingRef:  refByPhone.get(phone) ?? `UNKNOWN:${phone}`,
          phone,
          direction:   'inbound',
          body:        r.body ?? r.media_caption ?? null,
          waMessageId: r.wa_message_id,
          status:      'received',
          senderName:  r.display_name ?? null,
          mediaUrl:    isMedia ? resolveMediaUrl(r.media_url) : null,
          mediaType:   isMedia ? r.message_type : null,
          read:        false,
          createdAt:   r.created_at,
        }
      })

    if (toCreate.length === 0) return 0
    await prisma.whatsAppMessage.createMany({ data: toCreate })
    console.log(`[WA SharedSync] imported ${toCreate.length} inbound message(s) for ${targets.length} phone(s)`)
    return toCreate.length
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
