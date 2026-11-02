/**
 * Aahaas B2C order versions — "an amendment is a new order".
 *
 * Since 2026-10-23 the storefront raises an amendment of a confirmed order as
 * a NEW `tbl_checkout_ids` row, stamps the chain on it and cancels the previous
 * version by header status only (its lines stay live):
 *
 *   15726  original NULL   previous NULL   version 1   checkout_status 'Cancelled'
 *   15833  original 15726  previous 15726  version 2   (live)
 *
 * ⚠️ A CHAIN IS ONE BOOKING, filed under its ORIGINAL order id — the same rule
 * the n8n gateway (order-versions.js `chainIdOf`) and the Accounts System
 * (B2cOrderChain, invoice AHS-15726R2) use. So OPS booking "15726" stays the
 * booking; order 15833 is what its Update Booking now reads from.
 *
 * Superseded = another order names this one as `previous_order_id`. The header
 * status alone is never used — a real cancellation sets the same 'Cancelled'.
 *
 * Read-only (b2cQuery's guard). Tolerant of a store without the columns: every
 * order is then its own chain at version 1 — the behaviour before versions.
 */
import type mysql from 'mysql2/promise'
import { b2cQuery } from './b2c-db'

export interface B2cOrderFact {
  id: number
  /** The booking: the original order's id, or the order's own. */
  chainId: number
  version: number
  previousOrderId: number | null
  /** The order that replaced this one, or null while it stands. */
  supersededBy: number | null
  isAmendment: boolean
  checkoutStatus: string | null
  checkoutDate: string | null
}

interface ChainRow extends mysql.RowDataPacket {
  id: number
  original_order_id: number | null
  previous_order_id: number | null
  order_version: number | null
  checkout_status: string | null
  checkout_date: string | Date | null
}

function standalone(id: number): B2cOrderFact {
  return { id, chainId: id, version: 1, previousOrderId: null, supersededBy: null, isAmendment: false, checkoutStatus: null, checkoutDate: null }
}

function ids(list: number[]): number[] {
  return Array.from(new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
}

function stamp(v: string | Date | null): string | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19).replace('T', ' ')
  return String(v)
}

/** The decision over plain rows (the asked orders and their successors). */
export function factsFromRows(rows: Partial<ChainRow>[], asked: number[]): Map<number, B2cOrderFact> {
  const byId = new Map<number, Partial<ChainRow>>()
  const successor = new Map<number, number>()
  for (const r of rows) {
    const id = Number(r.id)
    byId.set(id, r)
    const prev = Number(r.previous_order_id ?? 0)
    if (prev > 0 && prev !== id) successor.set(prev, Math.max(successor.get(prev) ?? 0, id))
  }

  const out = new Map<number, B2cOrderFact>()
  for (const id of asked) {
    const r = byId.get(id)
    if (!r) { out.set(id, standalone(id)); continue }
    const original = Number(r.original_order_id ?? 0)
    const prev = Number(r.previous_order_id ?? 0)
    const chainId = original > 0 ? original : id
    const v = Number(r.order_version ?? 0)
    out.set(id, {
      id,
      chainId,
      version: Math.max(1, v || (chainId === id ? 1 : 2)),
      previousOrderId: prev > 0 && prev !== id ? prev : null,
      supersededBy: successor.get(id) ?? null,
      isAmendment: chainId !== id,
      checkoutStatus: r.checkout_status ?? null,
      checkoutDate: stamp(r.checkout_date ?? null),
    })
  }
  return out
}

/** The live version among one chain's rows: not replaced, highest version, newest id. */
export function liveFromRows(rows: Partial<ChainRow>[], chainId: number): number | null {
  const facts = factsFromRows(rows, rows.map((r) => Number(r.id)))
  let live: B2cOrderFact | null = null
  facts.forEach((f) => {
    if (f.chainId !== chainId || f.supersededBy !== null) return
    if (!live || f.version > live.version || (f.version === live.version && f.id > live.id)) live = f
  })
  return (live as B2cOrderFact | null)?.id ?? null
}

const COLUMNS = 'id, original_order_id, previous_order_id, order_version, checkout_status, checkout_date'

/**
 * Version facts for these orders and any order that replaced one of them, in
 * one read. Never throws: a store without the columns answers "standalone".
 */
export async function fetchOrderChainFacts(orderIds: number[]): Promise<Map<number, B2cOrderFact>> {
  const list = ids(orderIds)
  if (list.length === 0) return new Map()
  const inList = list.join(',')   // integers only — sanitised above
  try {
    const rows = await b2cQuery<ChainRow>(
      `SELECT ${COLUMNS} FROM tbl_checkout_ids
        WHERE deleted_at IS NULL AND (id IN (${inList}) OR previous_order_id IN (${inList}))`,
    )
    return factsFromRows(rows, list)
  } catch (err) {
    console.warn('[b2c-order-chain] version columns unreadable — every order is its own booking:', err instanceof Error ? err.message : err)
    return new Map(list.map((id) => [id, standalone(id)]))
  }
}

/** The chain's current order — the newest version nothing replaced. The id itself when unknown. */
export async function resolveLiveOrderId(orderId: number): Promise<{ liveOrderId: number; chainId: number; fact: B2cOrderFact }> {
  const facts = await fetchOrderChainFacts([orderId])
  const asked = facts.get(orderId) ?? standalone(orderId)
  const chainId = asked.chainId
  try {
    const rows = await b2cQuery<ChainRow>(
      `SELECT ${COLUMNS} FROM tbl_checkout_ids
        WHERE deleted_at IS NULL AND (id = ${Number(chainId)} OR original_order_id = ${Number(chainId)})`,
    )
    const live = liveFromRows(rows, chainId) ?? orderId
    const fact = factsFromRows(rows, [live]).get(live) ?? asked
    return { liveOrderId: live, chainId, fact }
  } catch {
    return { liveOrderId: orderId, chainId, fact: asked }
  }
}

/** Is `amendedAt` on a later office day than `originAt`? Store stamps are local wall-clock time. */
export function isLaterDay(originAt: string | null, amendedAt: string | null): boolean {
  if (!originAt || !amendedAt) return false
  const day = (s: string) => s.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}/.test(originAt) && /^\d{4}-\d{2}-\d{2}/.test(amendedAt) && day(amendedAt) > day(originAt)
}

// ── Amendment notices (SystemSetting KV — no schema change on the live ops DB) ──

export const B2C_AMENDMENT_PREFIX = 'b2c_amendment:'

export interface B2cAmendmentNotice {
  bookingRef: string          // the booking (chain id)
  orderId: number             // the amendment order
  previousOrderId: number | null
  version: number
  amendedAt: string | null
  originAt: string | null
  /** The original was sold on an earlier day — the only kind that is shown as a notice. */
  isOld: boolean
  /** The amendment was imported as a booking of its own before versions were understood. */
  duplicateRef: string | null
  detectedAt: string
  appliedAt?: string | null
  appliedVersion?: number | null
  acknowledgedBy?: string | null
  acknowledgedAt?: string | null
}
