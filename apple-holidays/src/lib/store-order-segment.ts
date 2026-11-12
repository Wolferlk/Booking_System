/**
 * B2B OR B2C, PACKAGE OR FLIGHT — the AahaasFlow board an Aahaas store order sits on.
 *
 * A straight port of AahaasFlow's `flow.segment.js` (n8n-project), so OPS and
 * the Flow board can never disagree about whose an order is:
 *
 *   1. CONFIRMED THROUGH THE CONSOLE — the quotation register holds the order
 *      (`confirmed_order_id`); the confirm panel's `confirmation_type` says
 *      B2B or B2C, and NULL is B2B (the panel's default).
 *   2. PLACED BY A B2B ACCOUNT — `users.user_role` b2b*, `user_type`/`user_platform`
 *      b2b, or paid from the B2B wallet. Any one mark is enough.
 *   3. EVERYTHING ELSE is a direct customer (B2C).
 *
 * Kind: an order whose every live product is a flight (category 6) is a flight
 * order; anything else is a package. An order with no live product at all is
 * reported as cancelled rather than guessed at.
 *
 * ⚠️ If `flow.segment.js` changes its rule, change this file with it.
 * ⚠️ Read-only: every statement goes through `b2cQuery()`, which refuses writes.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { b2cQuery, FLIGHT_CATEGORY_ID } from './b2c-db'

export type StoreSegment = 'b2b' | 'b2c'
export type StoreKind = 'packages' | 'flights'
export type StoreSource = 'confirmation' | 'b2b_portal' | 'direct'

/** The four AahaasFlow boards, plus orders with nothing live left on them. */
export type StoreBoard = 'b2b_packages' | 'b2b_flights' | 'b2c_packages' | 'b2c_flights' | 'cancelled'

export interface StoreOrderSegment {
  segment: StoreSegment
  source: StoreSource
  kind: StoreKind
  /** False when no live product remains — every line cancelled or refunded. */
  live: boolean
  board: StoreBoard
  /**
   * The badge AahaasFlow shows on the order: `tbl_checkout_ids.channel` when it
   * is a known one (app, whatsapp, travel_quote_gpt, b2b_portal…), otherwise
   * how the order came in (`b2b_portal` / `confirmation`), otherwise null.
   * Mirrors OrderCard.jsx `[o.channel, …, o.source].find(k => CHANNEL[k])`.
   */
  channel: string | null
}

/** Every badge AahaasFlow knows (OrderCard.jsx CHANNEL), key → label. */
export const STORE_CHANNEL_LABEL: Record<string, string> = {
  call: 'AI Voice', whatsapp: 'AI WhatsApp', travel_quote_gpt: 'AI Chat', web: 'AI Web', app: 'AI Mobile',
  facebook: 'Facebook', instagram: 'Instagram', b2b_portal: 'B2B portal', confirmation: 'B2B console',
}

/** The badge for one order, exactly as AahaasFlow picks it. */
export function channelOf(rawChannel: string | null | undefined, source: StoreSource): string | null {
  const ch = String(rawChannel ?? '').trim().toLowerCase()
  if (STORE_CHANNEL_LABEL[ch]) return ch
  return source === 'direct' ? null : source
}

/** Who the order belongs to. Pure — mirrors `segmentOf()` in flow.segment.js. */
export function segmentOf(o: {
  inRegister?: boolean
  confirmationType?: string | null
  userRole?: string | null
  userType?: string | null
  userPlatform?: string | null
  payCategory?: string | null
}): { segment: StoreSegment; source: StoreSource } {
  if (o.inRegister) {
    return { segment: String(o.confirmationType ?? '').toLowerCase() === 'b2c' ? 'b2c' : 'b2b', source: 'confirmation' }
  }
  const b2bAccount = /^b2b/i.test(String(o.userRole ?? ''))
    || /^b2b$/i.test(String(o.userType ?? ''))
    || /^b2b$/i.test(String(o.userPlatform ?? ''))
    || /b2b\s*wallet/i.test(String(o.payCategory ?? ''))
  return b2bAccount ? { segment: 'b2b', source: 'b2b_portal' } : { segment: 'b2c', source: 'direct' }
}

/** Packages or flights, from the live products' category ids. Pure — mirrors `kindOf()`. */
export function kindOf(categoryIds: Array<number | string>): { kind: StoreKind; live: boolean } {
  const ids = categoryIds.map(Number).filter(n => Number.isFinite(n) && n > 0)
  if (!ids.length) return { kind: 'packages', live: false }
  return { kind: ids.every(n => n === FLIGHT_CATEGORY_ID) ? 'flights' : 'packages', live: true }
}

export function boardOf(segment: StoreSegment, kind: StoreKind, live: boolean): StoreBoard {
  if (!live) return 'cancelled'
  return `${segment}_${kind}` as StoreBoard
}

interface RegisterRow extends RowDataPacket { order_id: number; ctype: string | null }
interface AccountRow extends RowDataPacket {
  order_id: number; pay_category: string | null; channel: string | null
  user_role: string | null; user_type: string | null; user_platform: string | null
}
interface CatsRow extends RowDataPacket { order_id: number; cats: string | null }

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',')

/**
 * Segment, kind and board for many orders — the same three reads Flow makes.
 *
 * Unlike Flow, a failed read is thrown, not swallowed: a report that quietly
 * filed every order under B2C would be exactly the wrong number this exists to fix.
 */
export async function readStoreOrderSegments(orderIds: number[]): Promise<Map<number, StoreOrderSegment>> {
  const out = new Map<number, StoreOrderSegment>()
  const ids = Array.from(new Set(orderIds.map(Number).filter(n => Number.isInteger(n) && n > 0)))

  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    const [register, accounts, cats] = await Promise.all([
      b2cQuery<RegisterRow>(
        `SELECT q.confirmed_order_id AS order_id, MAX(s.confirmation_type) AS ctype
           FROM tbl_future_travel_quotation q
           LEFT JOIN tbl_future_travel_quote_state s ON s.portfolio_id = q.portfolio_id
          WHERE q.confirmed_order_id IN (${marks(chunk.length)})
          GROUP BY q.confirmed_order_id`,
        chunk,
      ),
      b2cQuery<AccountRow>(
        `SELECT o.id AS order_id, o.pay_category, o.channel, u.user_role, u.user_type, u.user_platform
           FROM tbl_checkout_ids o LEFT JOIN users u ON u.id = o.user_id
          WHERE o.id IN (${marks(chunk.length)})`,
        chunk,
      ),
      b2cQuery<CatsRow>(
        `SELECT checkout_id AS order_id, GROUP_CONCAT(main_category_id) AS cats
           FROM tbl_checkouts
          WHERE checkout_id IN (${marks(chunk.length)}) AND deleted_at IS NULL
            AND COALESCE(status, '') NOT IN ('Cancel', 'Cancelled', 'Refunded')
          GROUP BY checkout_id`,
        chunk,
      ),
    ])
    const reg = new Map(register.map(r => [Number(r.order_id), r]))
    const acc = new Map(accounts.map(r => [Number(r.order_id), r]))
    const cat = new Map(cats.map(r => [Number(r.order_id), String(r.cats ?? '').split(',')]))

    for (const id of chunk) {
      const r = reg.get(id)
      const a = acc.get(id)
      const { segment, source } = segmentOf({
        inRegister: Boolean(r),
        confirmationType: r?.ctype ?? null,
        userRole: a?.user_role, userType: a?.user_type, userPlatform: a?.user_platform, payCategory: a?.pay_category,
      })
      const { kind, live } = kindOf(cat.get(id) ?? [])
      out.set(id, { segment, source, kind, live, board: boardOf(segment, kind, live), channel: channelOf(a?.channel, source) })
    }
  }
  return out
}
