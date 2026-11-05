/**
 * Aahaas B2C order versions — "an amendment is a version of the SAME order".
 *
 * The booking API's `ORDER_VERSION_MODE=same_order` keeps one order id for the
 * life of a booking (DevelopmemtsCludeMds/order-versions-same-order.md):
 *
 *   tbl_checkout_ids            one header, always the current totals
 *   tbl_checkout_versions       one row per version, with its status
 *   tbl_checkout_line_changes   what each version did to each line
 *   tbl_checkouts               taken-off lines stay, `removed_in_version` set
 *
 * This replaces b2c-order-chain's "an amendment is a new order" for everything
 * amended from now on. Chains that already exist are never rewritten, and keep
 * reading through b2c-order-chain.
 *
 * ⚠️ THE ORDER ID NEVER MOVES, so nothing here can be detected the way a chain
 * is: `order_version` on the header and these tables are the only signal.
 *
 * ⚠️ NOT EVERY VERSION IS READY TO READ. Lines reach `checkouts_more_data` from
 * a dashboard_backend cron about a minute after the amendment. Reading before
 * that, a rebooked line looks removed and its replacement is not there yet. See
 * {@link versionReadiness}.
 *
 * Read-only (b2cQuery's guard). Tolerant of a store without the tables: every
 * reader answers "no versions", which is the behaviour before this mode.
 */
import type mysql from 'mysql2/promise'
import { b2cQuery } from './b2c-db'

export interface B2cStoreVersion {
  orderId: number
  version: number
  /** 'writing' | 'failed' | 'pending_costs' | 'complete' */
  status: string
  lane: string | null
  confirmationNo: string | null
  reason: string | null
  createdAt: string | null
  /** Minutes since the store wrote it, on the store's own clock. */
  ageMinutes: number
}

export interface B2cLineChange {
  version: number
  checkoutLineId: number
  /** 'added' | 'removed' | 'repriced' | 'rebooked' */
  changeType: string
  replacesLineId: number | null
  replacedByLineId: number | null
  productName: string | null
  currency: string | null
  oldTotal: number | null
  newTotal: number | null
  supplierHeld: boolean
}

/** A version the store finished writing: the header and lines stand on it. */
export const WRITTEN_STATUSES = ['pending_costs', 'complete']

/** How long the cost cron may reasonably take before a person may go ahead anyway. */
export const COSTS_STALE_MINUTES = 15

/**
 *   ready    costs are in: safe to read, automatically or by hand
 *   costing  the cron is still filling lines: wait (about a minute)
 *   stale    still no costs well past the cron's cycle: never automatic, but a
 *            person may go ahead, warned, or the booking could never be updated
 *   blocked  the store never finished this version ('writing' / 'failed'): the
 *            doc says a person must look, because suppliers may hold new lines
 */
export type VersionReadiness = 'ready' | 'costing' | 'stale' | 'blocked'

export function versionReadiness(v: Pick<B2cStoreVersion, 'status' | 'ageMinutes'>, pendingRefreshes: number): VersionReadiness {
  if (!WRITTEN_STATUSES.includes(v.status)) return 'blocked'
  if (v.status === 'complete' && pendingRefreshes === 0) return 'ready'
  return v.ageMinutes >= COSTS_STALE_MINUTES ? 'stale' : 'costing'
}

/** Which order line an old P&L line now answers to: new `tbl_checkouts.id` → the id it replaced. */
export function rebookPairs(changes: Pick<B2cLineChange, 'checkoutLineId' | 'replacesLineId' | 'replacedByLineId'>[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const c of changes) {
    if (c.replacesLineId) out.set(c.checkoutLineId, c.replacesLineId)
    if (c.replacedByLineId) out.set(c.replacedByLineId, c.checkoutLineId)
  }
  return out
}

/** Walks a line back through its rebookings (V3 replaced V2 replaced V1) to one `has` accepts. */
export function findAncestorLine(lineId: number, pairs: Map<number, number>, has: (id: number) => boolean): number | null {
  const seen = new Set<number>()
  let id: number | undefined = lineId
  while (id !== undefined && !seen.has(id)) {
    if (has(id)) return id
    seen.add(id)
    id = pairs.get(id)
  }
  return null
}

function cleanIds(list: (number | string)[]): number[] {
  return Array.from(new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

let tablesSeen: { at: number; present: boolean } | null = null

/** The store carries the version tables. A positive answer is kept longer: tables do not vanish. */
async function versionTablesReady(): Promise<boolean> {
  const ttl = tablesSeen?.present ? 30 * 60_000 : 5 * 60_000
  if (tablesSeen && Date.now() - tablesSeen.at < ttl) return tablesSeen.present
  const rows = await b2cQuery<mysql.RowDataPacket & { n: number }>(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN ('tbl_checkout_versions', 'tbl_checkout_line_changes', 'checkouts_more_data_refresh')`,
  )
  tablesSeen = { at: Date.now(), present: Number(rows[0]?.n ?? 0) === 3 }
  return tablesSeen.present
}

interface VersionRow extends mysql.RowDataPacket {
  checkout_id: number
  version: number
  status: string
  lane: string | null
  confirmation_no: string | null
  reason: string | null
  created_stamp: string | null
  age_minutes: number | null
}

// The stamp is formatted by the store: a Date would shift across midnight on a UTC server.
const VERSION_COLUMNS = `v.checkout_id, v.version, v.status, v.lane, v.confirmation_no, v.reason,
       DATE_FORMAT(v.created_at, '%Y-%m-%d %H:%i:%s') AS created_stamp,
       TIMESTAMPDIFF(MINUTE, v.created_at, NOW()) AS age_minutes`

function toVersion(r: VersionRow): B2cStoreVersion {
  return {
    orderId: Number(r.checkout_id),
    version: Number(r.version),
    status: String(r.status),
    lane: r.lane ?? null,
    confirmationNo: r.confirmation_no ?? null,
    reason: r.reason ?? null,
    createdAt: r.created_stamp ?? null,
    ageMinutes: Number(r.age_minutes ?? 0),
  }
}

/** Every version of these orders, oldest first. Never throws: unreadable means no versions. */
export async function fetchStoreVersions(orderIds: (number | string)[]): Promise<Map<number, B2cStoreVersion[]>> {
  const out = new Map<number, B2cStoreVersion[]>()
  const list = cleanIds(orderIds)
  if (list.length === 0) return out
  try {
    if (!(await versionTablesReady())) return out
    const rows = await b2cQuery<VersionRow>(
      `SELECT ${VERSION_COLUMNS}
         FROM tbl_checkout_versions v
        WHERE v.checkout_id IN (${list.join(',')})
        ORDER BY v.checkout_id, v.version`,
    )
    for (const r of rows) {
      const v = toVersion(r)
      out.set(v.orderId, [...(out.get(v.orderId) ?? []), v])
    }
  } catch (err) {
    console.warn('[b2c-same-order] versions unreadable:', err instanceof Error ? err.message : err)
  }
  return out
}

/**
 * Each order's newest version, for orders amended since `sinceDate` ('YYYY-MM-DD').
 * An order's first version is written as a baseline at its first amendment, so
 * version 1 alone is never an amendment.
 */
export async function fetchRecentStoreVersions(sinceDate: string, limit = 300): Promise<B2cStoreVersion[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) return []
  const lim = Math.max(1, Math.min(Number(limit) || 300, 1000))
  try {
    if (!(await versionTablesReady())) return []
    const rows = await b2cQuery<VersionRow>(
      `SELECT ${VERSION_COLUMNS}
         FROM tbl_checkout_versions v
         JOIN (SELECT checkout_id, MAX(version) AS version
                 FROM tbl_checkout_versions
                GROUP BY checkout_id) last
           ON last.checkout_id = v.checkout_id AND last.version = v.version
        WHERE v.version > 1 AND v.created_at >= ?
        ORDER BY v.id ASC
        LIMIT ${lim}`,
      [sinceDate],
    )
    return rows.map(toVersion)
  } catch (err) {
    console.warn('[b2c-same-order] recent versions unreadable:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Repriced lines whose cost row the cron has not rebuilt yet. Given-up requests (5 tries) do not count: they will not finish. */
export async function pendingCostRefreshes(orderId: number): Promise<number> {
  if (!Number.isInteger(orderId) || orderId <= 0) return 0
  try {
    if (!(await versionTablesReady())) return 0
    const rows = await b2cQuery<mysql.RowDataPacket & { n: number }>(
      `SELECT COUNT(*) AS n FROM checkouts_more_data_refresh
        WHERE order_id = ${orderId} AND done_at IS NULL AND attempts < 5`,
    )
    return Number(rows[0]?.n ?? 0)
  } catch (err) {
    console.warn('[b2c-same-order] refresh queue unreadable:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** What each version did to each line, oldest first. Never throws. */
export async function fetchLineChanges(orderId: number): Promise<B2cLineChange[]> {
  if (!Number.isInteger(orderId) || orderId <= 0) return []
  try {
    if (!(await versionTablesReady())) return []
    const rows = await b2cQuery<mysql.RowDataPacket>(
      `SELECT version, checkout_line_id, change_type, replaces_line_id, replaced_by_line_id,
              product_name, currency, old_total, new_total, supplier_held
         FROM tbl_checkout_line_changes
        WHERE checkout_id = ${orderId}
        ORDER BY version, id`,
    )
    return rows.map((r) => ({
      version: Number(r.version),
      checkoutLineId: Number(r.checkout_line_id),
      changeType: String(r.change_type),
      replacesLineId: num(r.replaces_line_id),
      replacedByLineId: num(r.replaced_by_line_id),
      productName: r.product_name ?? null,
      currency: r.currency ?? null,
      oldTotal: num(r.old_total),
      newTotal: num(r.new_total),
      supplierHeld: Boolean(Number(r.supplier_held ?? 0)),
    }))
  } catch (err) {
    console.warn('[b2c-same-order] line changes unreadable:', err instanceof Error ? err.message : err)
    return []
  }
}
