/**
 * Aahaas B2C order versions, as OPS bookings see them.
 *
 * A booking's versions come two ways, and a booking can hold both:
 *
 *   SAME ORDER (b2c-same-order, the way from now on): one order id, versions in
 *   `tbl_checkout_versions`. One booking, nothing ever replaced.
 *
 *   NEW ORDER (b2c-order-chain, amended before that mode):
 *     15726  version 1  ← replaced
 *     15833  version 2  ← live
 *
 * A version with no booking of its own is CARRIED by the active booking:
 * Update Booking reads it onto that booking (`heldBy`).
 *
 * Before the importer understood versions, a new order was imported as a
 * booking of its own, so ops can hold BOTH 15726 and 15833 for one customer
 * booking. This module links them:
 *
 *   • ACTIVE      — the booking holding the live version. When the live
 *                   order has a booking of its own, that one. Otherwise the
 *                   chain's original booking (the importer applies amendments
 *                   to it), else the newest version that has a booking.
 *   • SUPERSEDED  — every other booking of the chain. Read-only in spirit:
 *                   shown blurred, kept out of the default list, pointing at
 *                   the active booking.
 *
 * Links are cached as SystemSetting rows `b2c_version_link:{bookingRef}` (no
 * schema change on the live ops DB) so the bookings list never has to reach
 * the store. They are refreshed from the store by the import / live watch,
 * and whenever a booking page is opened. Read-only against the store.
 */
import type mysql from 'mysql2/promise'
import { prisma } from './prisma'
import { b2cQuery } from './b2c-db'
import { isB2cBooking } from './booking-source'
import { fetchRecentAmendmentIds, liveFromRows } from './b2c-order-chain'
import { WRITTEN_STATUSES, fetchRecentStoreVersions, fetchStoreVersions, type B2cStoreVersion } from './b2c-same-order'

export const B2C_VERSION_LINK_PREFIX = 'b2c_version_link:'

export interface B2cVersionEntry {
  orderId: number
  version: number
  /** The OPS booking holding this order, or null when it was never imported on its own. */
  ref: string | null
  /** This order is the store's current version. */
  live: boolean
  storeStatus: string | null
  placedAt: string | null
  /** The booking this version is on: its own, else the active booking that carries it. */
  heldBy?: string | null
  /** A version of the same order, not an order of its own. */
  sameOrder?: boolean
  /** The store's own summary of the version. */
  reason?: string | null
}

export type B2cVersionState = 'active' | 'superseded'

export interface B2cVersionLink {
  ref: string
  chainId: number
  state: B2cVersionState
  /** The newest store version this booking holds or carries. */
  version: number
  /** The booking to work on. Equal to `ref` when this one is active. */
  activeRef: string | null
  liveOrderId: number | null
  /** Oldest first. */
  versions: B2cVersionEntry[]
  checkedAt: string
}

interface ChainRow extends mysql.RowDataPacket {
  id: number
  original_order_id: number | null
  previous_order_id: number | null
  order_version: number | null
  checkout_status: string | null
  checkout_date: string | Date | null
}

const COLUMNS = 'id, original_order_id, previous_order_id, order_version, checkout_status, checkout_date'

function cleanIds(list: (number | string)[]): number[] {
  return Array.from(new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
}

function stamp(v: string | Date | null | undefined): string | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 19).replace('T', ' ')
  return String(v)
}

function chainIdOf(r: Partial<ChainRow>): number {
  const original = Number(r.original_order_id ?? 0)
  return original > 0 ? original : Number(r.id)
}

/**
 * Pure: the links for every OPS booking of every chain among `rows`.
 * `opsRefs` = B2C booking refs that exist in ops. Chains of one order are skipped.
 */
export function linksFromRows(
  rows: Partial<ChainRow>[],
  opsRefs: Set<string>,
  now = new Date(),
  storeVersions: Map<number, B2cStoreVersion[]> = new Map(),
): B2cVersionLink[] {
  const chains = new Map<number, Partial<ChainRow>[]>()
  for (const r of rows) {
    const c = chainIdOf(r)
    const list = chains.get(c) ?? []
    if (!list.some((x) => Number(x.id) === Number(r.id))) list.push(r)
    chains.set(c, list)
  }

  const out: B2cVersionLink[] = []
  chains.forEach((list, chainId) => {
    // Only versions the store finished: a 'writing' or 'failed' row changed nothing here.
    const writtenOf = (id: number) => (storeVersions.get(id) ?? []).filter((v) => WRITTEN_STATUSES.includes(v.status))
    if (list.length < 2 && !list.some((r) => writtenOf(Number(r.id)).length > 1)) return
    const liveOrderId = liveFromRows(list, chainId)
    const versions: B2cVersionEntry[] = list
      .flatMap((r): B2cVersionEntry[] => {
        const id = Number(r.id)
        const v = Number(r.order_version ?? 0)
        const ref = opsRefs.has(String(id)) ? String(id) : null
        const written = writtenOf(id)
        if (written.length > 0) {
          return written.map((sv, i) => ({
            orderId: id,
            version: sv.version,
            ref,
            live: id === liveOrderId && i === written.length - 1,
            storeStatus: r.checkout_status ?? null,
            placedAt: sv.createdAt,
            sameOrder: true,
            reason: sv.reason,
          }))
        }
        return [{
          orderId: id,
          version: Math.max(1, v || (id === chainId ? 1 : 2)),
          ref,
          live: id === liveOrderId,
          storeStatus: r.checkout_status ?? null,
          placedAt: stamp(r.checkout_date),
        }]
      })
      .sort((a, b) => a.version - b.version || a.orderId - b.orderId)

    const withBooking = versions.filter((v) => v.ref)
    if (withBooking.length === 0) return

    const liveEntry = versions.find((v) => v.live)
    const activeRef =
      liveEntry?.ref ??
      (opsRefs.has(String(chainId)) ? String(chainId) : null) ??
      withBooking[withBooking.length - 1].ref

    for (const v of versions) v.heldBy = v.ref ?? activeRef

    for (const ref of Array.from(new Set(withBooking.map((v) => v.ref!)))) {
      out.push({
        ref,
        chainId,
        state: ref === activeRef ? 'active' : 'superseded',
        version: Math.max(...versions.filter((v) => v.heldBy === ref).map((v) => v.version)),
        activeRef,
        liveOrderId,
        versions,
        checkedAt: now.toISOString(),
      })
    }
  })
  return out
}

/** Every store order of the chains these orders belong to (two reads). */
async function readChains(orderIds: number[]): Promise<ChainRow[]> {
  const list = cleanIds(orderIds)
  if (list.length === 0) return []
  const inList = list.join(',')   // integers only
  const first = await b2cQuery<ChainRow>(
    `SELECT ${COLUMNS} FROM tbl_checkout_ids
      WHERE deleted_at IS NULL
        AND (id IN (${inList}) OR original_order_id IN (${inList}) OR previous_order_id IN (${inList}))`,
  )
  const chainIds = cleanIds(first.map(chainIdOf))
  if (chainIds.length === 0) return first
  const inChains = chainIds.join(',')
  return b2cQuery<ChainRow>(
    `SELECT ${COLUMNS} FROM tbl_checkout_ids
      WHERE deleted_at IS NULL AND (id IN (${inChains}) OR original_order_id IN (${inChains}))`,
  )
}

/**
 * Re-read these orders' chains from the store and store the links of every ops
 * booking in them. Returns the fresh links (by ref). Throws when the store is
 * unreachable — callers that only decorate should catch.
 */
export async function refreshVersionLinks(orderIds: (number | string)[]): Promise<Map<string, B2cVersionLink>> {
  const rows = await readChains(cleanIds(orderIds))
  const allIds = cleanIds(rows.map((r) => r.id))
  if (allIds.length === 0) return new Map()

  const bookings = await prisma.booking.findMany({
    where: { bookingRef: { in: allIds.map(String) } },
    select: { bookingRef: true, agent: true },
  })
  // A numeric ref shared with an agent booking is never linked from the store.
  const opsRefs = new Set(bookings.filter((b) => isB2cBooking(b.agent)).map((b) => b.bookingRef))
  const links = linksFromRows(rows, opsRefs, new Date(), await fetchStoreVersions(allIds))

  for (const l of links) {
    const key = B2C_VERSION_LINK_PREFIX + l.ref
    const value = JSON.stringify(l)
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  return new Map(links.map((l) => [l.ref, l]))
}

function parse(value: string | null | undefined): B2cVersionLink | null {
  try {
    const v = JSON.parse(value ?? '')
    return v && typeof v === 'object' && v.ref && Array.isArray(v.versions) ? (v as B2cVersionLink) : null
  } catch {
    return null
  }
}

/** Cached links for these refs (no store read). */
export async function getVersionLinks(refs: string[]): Promise<Map<string, B2cVersionLink>> {
  const list = Array.from(new Set(refs.filter(Boolean)))
  if (list.length === 0) return new Map()
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: list.map((r) => B2C_VERSION_LINK_PREFIX + r) } } })
  const out = new Map<string, B2cVersionLink>()
  for (const r of rows) {
    const l = parse(r.value)
    if (l) out.set(l.ref, l)
  }
  return out
}

/** Every cached link — a small set (one row per booking of an amended chain). */
export async function listVersionLinks(): Promise<B2cVersionLink[]> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: B2C_VERSION_LINK_PREFIX } } })
  return rows.map((r) => parse(r.value)).filter((l): l is B2cVersionLink => l !== null)
}

/**
 * The bookings list's view: which refs are replaced (hidden by default), and,
 * for a search term, every ops booking of any chain the term names — so
 * searching 15726 also brings back the active 15833, and the other way round.
 */
export async function versionListContext(search: string | null): Promise<{ supersededRefs: string[]; chainRefsForSearch: string[] }> {
  const links = await listVersionLinks().catch(() => [] as B2cVersionLink[])
  const supersededRefs = links.filter((l) => l.state === 'superseded').map((l) => l.ref)
  const term = (search ?? '').replace(/\s+/g, '').trim()
  const chainRefsForSearch = new Set<string>()
  if (term.length >= 3) {
    for (const l of links) {
      const names = [String(l.chainId), ...l.versions.map((v) => String(v.orderId))]
      if (names.some((n) => n.includes(term))) {
        l.versions.forEach((v) => v.ref && chainRefsForSearch.add(v.ref))
        if (l.activeRef) chainRefsForSearch.add(l.activeRef)
      }
    }
  }
  return { supersededRefs, chainRefsForSearch: Array.from(chainRefsForSearch) }
}

const SYNCED_AT_KEY = 'b2c_version_links_synced_at'
const SYNC_EVERY_MS = 10 * 60_000

/**
 * Link every amendment placed in the last `days` days. At most once per
 * SYNC_EVERY_MS unless `force`. Never throws.
 */
export async function syncRecentVersionLinks(days = 30, force = false): Promise<number> {
  try {
    if (!force) {
      const last = await prisma.systemSetting.findUnique({ where: { key: SYNCED_AT_KEY } })
      if (last && Date.now() - new Date(last.value).getTime() < SYNC_EVERY_MS) return 0
    }
    const at = new Date().toISOString()
    await prisma.systemSetting.upsert({ where: { key: SYNCED_AT_KEY }, update: { value: at }, create: { key: SYNCED_AT_KEY, value: at } })
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
    const [chainIds, sameOrder] = await Promise.all([fetchRecentAmendmentIds(since, 1000), fetchRecentStoreVersions(since, 1000)])
    const ids = cleanIds([...chainIds, ...sameOrder.map((v) => v.orderId)])
    if (ids.length === 0) return 0
    const links = await refreshVersionLinks(ids)
    return links.size
  } catch (err) {
    console.warn('[b2c-version-links] sync skipped:', err instanceof Error ? err.message : err)
    return 0
  }
}
