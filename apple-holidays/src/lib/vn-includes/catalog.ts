/**
 * The Vietnam product sheet, cached in `vn_include_products`, and everything
 * that reads or writes it: the sync from SharePoint, the picker's search, the
 * "suggest from this activity" matcher, and operator-added products — which are
 * also appended to the workbook's Manual Products tab so the desk sees them.
 *
 * Writes to the workbook are confined to that one tab. The product tab the desk
 * maintains is only ever read.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { graphFetch } from '@/lib/graph-client'
import {
  DEFAULT_MANUAL_TAB, DEFAULT_PRODUCT_SHEET_URL, VN_INCLUDE_SETTINGS,
  cleanProductName, productKeyFor, searchForm,
  type CatalogMeta, type IncludeProduct,
} from './shared'
import {
  parseTab, rankSearch, rankSuggestions, toEntry,
  type CatalogEntry, type Cell, type ParsedRow,
} from './match'

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export interface IncludeSheetConfig {
  sheetUrl: string
  sheetTab: string
  manualTab: string
}

export async function getSheetConfig(): Promise<IncludeSheetConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [VN_INCLUDE_SETTINGS.sheetUrl, VN_INCLUDE_SETTINGS.sheetTab, VN_INCLUDE_SETTINGS.manualTab] } },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))
  return {
    sheetUrl:  map.get(VN_INCLUDE_SETTINGS.sheetUrl)?.trim()  || DEFAULT_PRODUCT_SHEET_URL,
    sheetTab:  map.get(VN_INCLUDE_SETTINGS.sheetTab)?.trim()  || '',
    manualTab: map.get(VN_INCLUDE_SETTINGS.manualTab)?.trim() || DEFAULT_MANUAL_TAB,
  }
}

export async function saveSheetConfig(input: Partial<IncludeSheetConfig>): Promise<IncludeSheetConfig> {
  const current = await getSheetConfig()
  if (input.sheetUrl !== undefined) {
    const url = input.sheetUrl.trim()
    if (url && !/^https:\/\/[^/]+\.sharepoint\.com\//i.test(url) && !/^https:\/\/1drv\.ms\//i.test(url)) {
      throw new Error('That does not look like a SharePoint / OneDrive share link')
    }
    await setSetting(VN_INCLUDE_SETTINGS.sheetUrl, url)
    // A new link is a new file — forget the ids resolved for the old one.
    if (url !== current.sheetUrl) await setSetting(VN_INCLUDE_SETTINGS.sheetRef, '')
  }
  if (input.sheetTab  !== undefined) await setSetting(VN_INCLUDE_SETTINGS.sheetTab,  input.sheetTab.trim())
  if (input.manualTab !== undefined) {
    const tab = input.manualTab.trim()
    if (tab && /[\\/?*[\]:]/.test(tab)) throw new Error('A tab name cannot contain \\ / ? * [ ] :')
    await setSetting(VN_INCLUDE_SETTINGS.manualTab, tab)
  }
  return getSheetConfig()
}

export async function getCatalogMeta(): Promise<CatalogMeta | null> {
  const raw = await getSetting(VN_INCLUDE_SETTINGS.meta)
  if (!raw) return null
  try { return JSON.parse(raw) as CatalogMeta } catch { return null }
}

// ── Graph ────────────────────────────────────────────────────────────────────

interface SheetRef { driveId: string; itemId: string; fileName: string; webUrl: string; forUrl: string }

function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

async function resolveSheet(url: string, force = false): Promise<SheetRef> {
  if (!force) {
    const cached = await getSetting(VN_INCLUDE_SETTINGS.sheetRef)
    if (cached) {
      try {
        const ref = JSON.parse(cached) as SheetRef
        if (ref.driveId && ref.itemId && ref.forUrl === url) return ref
      } catch { /* resolve again */ }
    }
  }
  const item = await graphFetch<{ id: string; name: string; webUrl: string; parentReference?: { driveId?: string } }>(
    `/shares/${encodeShareUrl(url)}/driveItem?$select=id,name,webUrl,parentReference`,
  )
  const driveId = item.parentReference?.driveId
  if (!driveId) throw new Error('The link did not resolve to a file — is it a share link to the workbook itself?')
  const ref: SheetRef = { driveId, itemId: item.id, fileName: item.name, webUrl: item.webUrl, forUrl: url }
  await setSetting(VN_INCLUDE_SETTINGS.sheetRef, JSON.stringify(ref))
  return ref
}

const workbook = (ref: SheetRef) => `/drives/${ref.driveId}/items/${ref.itemId}/workbook`
const worksheet = (ref: SheetRef, tab: string) => `${workbook(ref)}/worksheets('${encodeURIComponent(tab.replace(/'/g, "''"))}')`

async function listTabs(ref: SheetRef): Promise<string[]> {
  const res = await graphFetch<{ value: { name: string; position: number }[] }>(
    `${workbook(ref)}/worksheets?$select=name,position`,
  )
  return res.value.sort((a, b) => a.position - b.position).map(w => w.name)
}

async function readUsed(ref: SheetRef, tab: string): Promise<{ values: Cell[][]; firstRow: number }> {
  const res = await graphFetch<{ address: string; values: Cell[][] }>(
    `${worksheet(ref, tab)}/usedRange(valuesOnly=true)?$select=address,values`,
  )
  // "'Tab'!A1:D1603" → 1. A tab whose data starts lower still maps rows right.
  const start = /!\$?[A-Z]+\$?(\d+)/.exec(res.address ?? '')
  return { values: res.values ?? [], firstRow: start ? Number(start[1]) : 1 }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

let syncing: Promise<CatalogMeta> | null = null

/**
 * Read the product sheet into `vn_include_products`.
 *
 * Never deletes: a SHEET product the sheet no longer carries is marked inactive,
 * so it drops out of search while every include already pointing at it keeps
 * reading. Operator-added (MANUAL) products are left alone, except that one the
 * Manual Products tab now carries is marked as having reached the sheet.
 */
export function syncCatalog(): Promise<CatalogMeta> {
  // One sync at a time — two clicks, or a click racing the first-use sync,
  // would otherwise both insert the same new rows.
  syncing ??= runSync().finally(() => { syncing = null })
  return syncing
}

async function runSync(): Promise<CatalogMeta> {
  const config = await getSheetConfig()
  const base: CatalogMeta = {
    syncedAt: new Date().toISOString(), fileName: null, webUrl: null, tab: null,
    rows: 0, added: 0, updated: 0, retired: 0, manualRows: 0, pendingManual: 0, error: null,
  }

  try {
    const ref = await resolveSheet(config.sheetUrl)
    base.fileName = ref.fileName
    base.webUrl = ref.webUrl

    const tabs = await listTabs(ref)
    const manualTab = tabs.find(t => t.toLowerCase() === config.manualTab.toLowerCase()) ?? null

    // The product tab: the one named in Settings, else the first tab whose
    // header has a code column and a product column (the desk's file opens on
    // "Code-Payment Breakdown"; "Code Summary" has no product column).
    let productTab: string | null = null
    let parsed: ParsedRow[] = []
    const candidates = config.sheetTab ? [config.sheetTab] : tabs.filter(t => t !== manualTab)
    for (const tab of candidates) {
      if (!tabs.includes(tab)) throw new Error(`The workbook has no tab named "${tab}"`)
      const { values, firstRow } = await readUsed(ref, tab)
      const rows = parseTab(values, firstRow)
      if (rows.length) { productTab = tab; parsed = rows; break }
    }
    if (!productTab) {
      throw new Error('No tab in the workbook has a "Code" column next to a product / "Payment / Details" column')
    }
    base.tab = productTab
    base.rows = parsed.length

    const manualParsed = manualTab ? parseTab((await readUsed(ref, manualTab)).values, 1) : []
    base.manualRows = manualParsed.length

    const existing = await prisma.vnIncludeProduct.findMany({
      select: {
        id: true, productKey: true, source: true, code: true, name: true, usageCount: true,
        minPriceVnd: true, isActive: true, sheetRow: true, sheetTab: true, syncStatus: true,
      },
    })
    const byKey = new Map(existing.map(p => [p.productKey, p]))

    const creates: Prisma.VnIncludeProductCreateManyInput[] = []
    const seen = new Set<string>()

    const consider = (row: ParsedRow, tab: string, source: 'SHEET' | 'MANUAL') => {
      if (seen.has(row.productKey)) return
      seen.add(row.productKey)
      const have = byKey.get(row.productKey)
      if (!have) {
        creates.push({
          productKey: row.productKey, code: row.code, name: row.name, rawName: row.rawName,
          searchText: searchForm(`${row.code} ${row.name}`), usageCount: row.usageCount,
          minPriceVnd: row.minPriceVnd, source, sheetTab: tab, sheetRow: row.sheetRow, isActive: true,
          syncStatus: source === 'MANUAL' ? 'SYNCED' : null,
          syncedAt: source === 'MANUAL' ? new Date() : null,
        })
        return 'create'
      }
      return have
    }

    const updates: { id: string; data: Record<string, unknown> }[] = []

    for (const row of parsed) {
      const have = consider(row, productTab, 'SHEET')
      if (!have || have === 'create') continue
      const price = have.minPriceVnd === null ? null : Number(have.minPriceVnd)
      const changed = have.usageCount !== row.usageCount || price !== row.minPriceVnd
        || !have.isActive || have.sheetRow !== row.sheetRow || have.sheetTab !== productTab
        || have.name !== row.name || have.code !== row.code
      if (changed) {
        updates.push({
          id: have.id,
          data: {
            code: row.code, name: row.name, rawName: row.rawName,
            searchText: searchForm(`${row.code} ${row.name}`),
            usageCount: row.usageCount, minPriceVnd: row.minPriceVnd,
            sheetTab: productTab, sheetRow: row.sheetRow, isActive: true,
          },
        })
      }
    }

    for (const row of manualParsed) {
      const have = consider(row, manualTab!, 'MANUAL')
      if (!have || have === 'create') continue
      // Already on the Manual Products tab: whatever the local status said, it
      // has reached the sheet.
      if (have.source === 'MANUAL' && have.syncStatus !== 'SYNCED') {
        updates.push({ id: have.id, data: { syncStatus: 'SYNCED', syncError: null, syncedAt: new Date() } })
      }
    }

    const retire = existing
      .filter(p => p.source === 'SHEET' && p.isActive && !seen.has(p.productKey))
      .map(p => p.id)

    for (let i = 0; i < creates.length; i += 500) {
      await prisma.vnIncludeProduct.createMany({ data: creates.slice(i, i + 500), skipDuplicates: true })
    }
    for (const u of updates) {
      await prisma.vnIncludeProduct.update({ where: { id: u.id }, data: u.data })
    }
    if (retire.length) {
      await prisma.vnIncludeProduct.updateMany({ where: { id: { in: retire } }, data: { isActive: false } })
    }

    base.added = creates.length
    base.updated = updates.length
    base.retired = retire.length

    // Anything typed in while the sheet was unreachable goes up now.
    const pushed = await pushPendingManual()
    base.pendingManual = pushed.stillPending
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err)
    base.pendingManual = await prisma.vnIncludeProduct.count({
      where: { source: 'MANUAL', syncStatus: { in: ['PENDING', 'FAILED'] } },
    }).catch(() => 0)
  }

  invalidateCache()
  await setSetting(VN_INCLUDE_SETTINGS.meta, JSON.stringify(base))
  if (base.error) throw Object.assign(new Error(base.error), { meta: base })
  return base
}

// ── Search ───────────────────────────────────────────────────────────────────

let cache: { at: number; rows: CatalogEntry[] } | null = null
const CACHE_MS = 10 * 60_000

function invalidateCache() { cache = null }

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows

  // First use on an empty table: fill it rather than showing an empty picker.
  // Deliberately not on every miss — a sheet that cannot be reached must not be
  // retried on each keystroke.
  if (!cache) {
    const count = await prisma.vnIncludeProduct.count()
    if (count === 0) await syncCatalog().catch(err => console.error('[vn-includes] first sync failed:', err))
  }

  const rows = await prisma.vnIncludeProduct.findMany({
    where: { isActive: true },
    select: {
      id: true, productKey: true, code: true, name: true, usageCount: true,
      minPriceVnd: true, source: true, syncStatus: true, searchText: true,
    },
  })
  const mapped = rows.map(r => toEntry({
    id: r.id, productKey: r.productKey, code: r.code, name: r.name,
    usageCount: r.usageCount, minPriceVnd: r.minPriceVnd === null ? null : Number(r.minPriceVnd),
    source: r.source === 'MANUAL' ? 'MANUAL' : 'SHEET', syncStatus: r.syncStatus,
  }, r.searchText))
  cache = { at: Date.now(), rows: mapped }
  return mapped
}

/** Picker search — see rankSearch in ./match. */
export async function searchProducts(query: string, opts: { code?: string; limit?: number } = {}): Promise<IncludeProduct[]> {
  return rankSearch(await loadCatalog(), query, opts)
}

/** Products that look like the parts of a movement — see rankSuggestions in ./match. */
export async function suggestProducts(activity: string, opts: { limit?: number; minScore?: number } = {}): Promise<IncludeProduct[]> {
  return rankSuggestions(await loadCatalog(), activity, opts)
}

// ── Manual products ──────────────────────────────────────────────────────────

export interface ManualProductInput {
  code: string
  name: string
  priceVnd?: number | null
  bookingRef?: string | null
  userId?: string | null
  userName?: string | null
}

/**
 * A product the sheet does not carry, typed in by the operator.
 *
 * Saved locally first, so the chart can use it straight away whatever
 * SharePoint is doing, then appended to the Manual Products tab. If that push
 * fails the row stays PENDING/FAILED and goes up on the next sync or retry —
 * the operator is told which, rather than left assuming the sheet has it.
 *
 * A product already in the catalogue (same code and name) is returned as it is
 * instead of being added twice.
 */
export async function addManualProduct(input: ManualProductInput): Promise<{ product: IncludeProduct; existing: boolean }> {
  const code = input.code.trim().slice(0, 64)
  const name = cleanProductName(input.name)
  if (!code) throw new Error('Choose a code for the product')
  if (name.length < 3) throw new Error('Type the product name')
  if (name.length > 1000) throw new Error('The product name is too long')
  const price = input.priceVnd === null || input.priceVnd === undefined || Number.isNaN(Number(input.priceVnd))
    ? null : Math.max(0, Number(input.priceVnd))

  const productKey = productKeyFor(code, name)
  const found = await prisma.vnIncludeProduct.findUnique({ where: { productKey } })
  if (found) {
    if (!found.isActive) {
      await prisma.vnIncludeProduct.update({ where: { id: found.id }, data: { isActive: true } })
      invalidateCache()
    }
    return { product: toPublic(found), existing: true }
  }

  const created = await prisma.vnIncludeProduct.create({
    data: {
      productKey, code, name, rawName: input.name, searchText: searchForm(`${code} ${name}`),
      usageCount: 0, minPriceVnd: price, source: 'MANUAL', isActive: true, syncStatus: 'PENDING',
      bookingRef: input.bookingRef ?? null, createdById: input.userId ?? null, createdByName: input.userName ?? null,
    },
  })
  invalidateCache()

  await pushPendingManual([created.id]).catch(() => { /* status is recorded on the row */ })
  const fresh = await prisma.vnIncludeProduct.findUnique({ where: { id: created.id } })
  return { product: toPublic(fresh ?? created), existing: false }
}

function toPublic(r: {
  id: string; productKey: string; code: string; name: string; usageCount: number
  minPriceVnd: unknown; source: string; syncStatus: string | null
}): IncludeProduct {
  return {
    id: r.id, productKey: r.productKey, code: r.code, name: r.name, usageCount: r.usageCount,
    minPriceVnd: r.minPriceVnd === null || r.minPriceVnd === undefined ? null : Number(r.minPriceVnd),
    source: r.source === 'MANUAL' ? 'MANUAL' : 'SHEET', syncStatus: r.syncStatus,
  }
}

const MANUAL_HEADER = ['Code', 'Payment / Details', 'Count', 'Lowest / Minimum', 'Added By', 'Added On', 'Booking']

/**
 * Append MANUAL products that have not reached the workbook yet.
 *
 * Only ever touches the Manual Products tab (creating it, with a header, the
 * first time). Rows are written below the last used row of that tab, so
 * anything the desk typed there by hand is never overwritten.
 */
export async function pushPendingManual(ids?: string[]): Promise<{ pushed: number; stillPending: number; error: string | null }> {
  const pending = await prisma.vnIncludeProduct.findMany({
    where: {
      source: 'MANUAL',
      syncStatus: { in: ['PENDING', 'FAILED'] },
      ...(ids ? { id: { in: ids } } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!pending.length) return { pushed: 0, stillPending: 0, error: null }

  try {
    const config = await getSheetConfig()
    const ref = await resolveSheet(config.sheetUrl)
    const tab = config.manualTab

    const tabs = await listTabs(ref)
    let existingTab = tabs.find(t => t.toLowerCase() === tab.toLowerCase()) ?? null
    if (!existingTab) {
      await graphFetch(`${workbook(ref)}/worksheets/add`, { method: 'POST', body: JSON.stringify({ name: tab }) })
      await graphFetch(`${worksheet(ref, tab)}/range(address='A1:G1')`, {
        method: 'PATCH', body: JSON.stringify({ values: [MANUAL_HEADER] }),
      })
      await graphFetch(`${worksheet(ref, tab)}/range(address='A1:G1')/format/font`, {
        method: 'PATCH', body: JSON.stringify({ bold: true }),
      }).catch(() => { /* cosmetic */ })
      existingTab = tab
    }

    const used = await graphFetch<{ address: string }>(
      `${worksheet(ref, existingTab)}/usedRange(valuesOnly=true)?$select=address`,
    )
    const end = /:\$?[A-Z]+\$?(\d+)$/.exec(used.address ?? '') ?? /!\$?[A-Z]+\$?(\d+)$/.exec(used.address ?? '')
    const lastRow = end ? Number(end[1]) : 1
    const startRow = Math.max(2, lastRow + 1)
    const endRow = startRow + pending.length - 1

    const values = pending.map(p => [
      p.code,
      p.name,
      1,
      p.minPriceVnd === null ? '' : Number(p.minPriceVnd),
      p.createdByName ?? '',
      p.createdAt.toISOString().slice(0, 10),
      p.bookingRef ?? '',
    ])
    await graphFetch(`${worksheet(ref, existingTab)}/range(address='A${startRow}:G${endRow}')`, {
      method: 'PATCH', body: JSON.stringify({ values }),
    })

    const now = new Date()
    await prisma.$transaction(pending.map((p, i) => prisma.vnIncludeProduct.update({
      where: { id: p.id },
      data: { syncStatus: 'SYNCED', syncError: null, syncedAt: now, sheetTab: existingTab, sheetRow: startRow + i },
    })))
    invalidateCache()
    return { pushed: pending.length, stillPending: 0, error: null }
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 2000)
    await prisma.vnIncludeProduct.updateMany({
      where: { id: { in: pending.map(p => p.id) } },
      data: { syncStatus: 'FAILED', syncError: msg },
    })
    invalidateCache()
    console.error('[vn-includes] Manual Products push failed:', msg)
    return { pushed: 0, stillPending: pending.length, error: msg }
  }
}

/** Manual products for the Settings card: newest first. */
export async function listManualProducts(limit = 50) {
  return prisma.vnIncludeProduct.findMany({
    where: { source: 'MANUAL' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true, code: true, name: true, minPriceVnd: true, syncStatus: true, syncError: true,
      syncedAt: true, bookingRef: true, createdByName: true, createdAt: true, sheetRow: true,
    },
  })
}
