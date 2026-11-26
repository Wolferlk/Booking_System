/**
 * MC Excel Feed — settings and memory, all in `system_settings` (no migration).
 *
 *   mc_xl_feed_config         FeedConfig JSON (ships with automatic sync OFF)
 *   mc_xl_feed_state          last run summary + progress of a running sync
 *   mc_xl_feed_runs           the last 20 runs
 *   mc_xl_feed_lock           ISO time a sync started ('' when free)
 *   mc_xl_feed_sheet_ref      the share link resolved to drive / item ids
 *   mc_xl_feed_rows:<REF>     line ids on the sheet (or deleted from it by the desk) for a booking
 *   mc_xl_feed_alias:<REF>    sheet line id → the id a chart save moved it to
 */
import { prisma } from '@/lib/prisma'
import {
  DEFAULT_FEED_CONFIG, FEED_COUNTRIES, FEED_SETTINGS,
  type FeedConfig, type FeedCountry, type FeedRun,
} from './shared'

async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

// ── Config ───────────────────────────────────────────────────────────────────

export async function getFeedConfig(): Promise<FeedConfig> {
  const saved = parse<Partial<FeedConfig>>(await getSetting(FEED_SETTINGS.config)) ?? {}
  return normaliseConfig({ ...DEFAULT_FEED_CONFIG, ...saved })
}

function normaliseConfig(c: FeedConfig): FeedConfig {
  const valid = new Set(FEED_COUNTRIES.map(x => x.value))
  const countries = (Array.isArray(c.countries) ? c.countries : []).filter((x): x is FeedCountry => valid.has(x as FeedCountry))
  const interval = Number(c.intervalMin)
  return {
    sheetUrl: String(c.sheetUrl ?? '').trim(),
    tabName: String(c.tabName ?? '').trim().slice(0, 31) || DEFAULT_FEED_CONFIG.tabName,
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(c.startDate)) ? String(c.startDate) : DEFAULT_FEED_CONFIG.startDate,
    countries: countries.length ? countries : DEFAULT_FEED_CONFIG.countries,
    enabled: c.enabled === true,
    intervalMin: Number.isFinite(interval) ? Math.min(240, Math.max(5, Math.round(interval))) : DEFAULT_FEED_CONFIG.intervalMin,
    placement: c.placement === 'append' ? 'append' : 'sorted',
    greyInactive: c.greyInactive !== false,
  }
}

export async function saveFeedConfig(input: Partial<FeedConfig>): Promise<FeedConfig> {
  const current = await getFeedConfig()
  const next = normaliseConfig({ ...current, ...input })
  if (next.sheetUrl && !/^https:\/\/[a-z0-9-]+(-my)?\.sharepoint\.com\//i.test(next.sheetUrl) && !/^https:\/\/(1drv\.ms|onedrive\.live\.com)\//i.test(next.sheetUrl)) {
    throw new Error('Paste the OneDrive / SharePoint share link to the Excel file (https://aahaas-my.sharepoint.com/…)')
  }
  if (/[\\/?*[\]:]/.test(next.tabName)) throw new Error('A tab name cannot contain \\ / ? * [ ] :')
  await setSetting(FEED_SETTINGS.config, JSON.stringify(next))
  // A different link is a different file — forget the resolved ids.
  if (next.sheetUrl !== current.sheetUrl) await setSetting(FEED_SETTINGS.sheetRef, '')
  return next
}

// ── State / runs ─────────────────────────────────────────────────────────────

export interface FeedState {
  lastRun: FeedRun | null
  lastSuccessAt: string | null
  progress: { runId: string; phase: string; done: number; total: number; at: string } | null
}

export async function getFeedState(): Promise<FeedState> {
  return parse<FeedState>(await getSetting(FEED_SETTINGS.state)) ?? { lastRun: null, lastSuccessAt: null, progress: null }
}

export async function setFeedProgress(progress: FeedState['progress']): Promise<void> {
  const s = await getFeedState()
  await setSetting(FEED_SETTINGS.state, JSON.stringify({ ...s, progress })).catch(() => undefined)
}

export async function getFeedRuns(): Promise<FeedRun[]> {
  return parse<FeedRun[]>(await getSetting(FEED_SETTINGS.runs)) ?? []
}

export async function recordFeedRun(run: FeedRun): Promise<void> {
  const runs = (await getFeedRuns()).filter(r => r.id !== run.id)
  runs.unshift({ ...run, warnings: run.warnings.slice(0, 6).map(w => w.slice(0, 300)), error: run.error?.slice(0, 600) ?? null })
  await setSetting(FEED_SETTINGS.runs, JSON.stringify(runs.slice(0, 20))).catch(() => undefined)
  if (run.trigger === 'PREVIEW') return
  const s = await getFeedState()
  await setSetting(FEED_SETTINGS.state, JSON.stringify({
    lastRun: run,
    lastSuccessAt: run.status === 'SUCCESS' || run.status === 'NO_CHANGE' ? run.finishedAt : s.lastSuccessAt,
    progress: null,
  } satisfies FeedState)).catch(() => undefined)
}

/** Due when switched on, linked, and the interval has passed since the last run started. */
export async function isFeedDue(): Promise<boolean> {
  const config = await getFeedConfig()
  if (!config.enabled || !config.sheetUrl) return false
  const s = await getFeedState()
  if (!s.lastRun?.at) return true
  return Date.now() - Date.parse(s.lastRun.at) >= config.intervalMin * 60_000 - 5_000
}

// ── Lock ─────────────────────────────────────────────────────────────────────

/** A first fill of ~5,000 rows takes a few minutes; a lock older than this is a crashed run. */
const STALE_LOCK_MS = 20 * 60_000

export async function takeFeedLock(): Promise<boolean> {
  const held = Date.parse((await getSetting(FEED_SETTINGS.lock)) ?? '')
  if (Number.isFinite(held) && Date.now() - held < STALE_LOCK_MS) return false
  await setSetting(FEED_SETTINGS.lock, new Date().toISOString())
  return true
}

export async function releaseFeedLock(): Promise<void> {
  await setSetting(FEED_SETTINGS.lock, '').catch(() => undefined)
}

export async function feedLockHeldSince(): Promise<string | null> {
  const v = await getSetting(FEED_SETTINGS.lock)
  const t = Date.parse(v ?? '')
  return Number.isFinite(t) && Date.now() - t < STALE_LOCK_MS ? v : null
}

// ── Sheet ref cache ──────────────────────────────────────────────────────────

export interface CachedSheetRef { driveId: string; itemId: string; fileName: string; webUrl: string; forUrl: string }

export async function getCachedSheetRef(url: string): Promise<CachedSheetRef | null> {
  const ref = parse<CachedSheetRef>(await getSetting(FEED_SETTINGS.sheetRef))
  return ref?.driveId && ref.itemId && ref.forUrl === url ? ref : null
}

export async function cacheSheetRef(ref: CachedSheetRef): Promise<void> {
  await setSetting(FEED_SETTINGS.sheetRef, JSON.stringify(ref)).catch(() => undefined)
}

/** Item ids of workbooks other features READ — the feed must never write into one of them. */
export async function protectedWorkbookIds(): Promise<Map<string, string>> {
  const keys: [string, string][] = [
    ['vn_driver_sync_sheet_ref', 'the VN Movement Chart (Driver Sync / Excel MC Generate)'],
  ]
  const out = new Map<string, string>()
  for (const [key, label] of keys) {
    const v = parse<{ itemId?: string }>(await getSetting(key))
    if (v?.itemId) out.set(v.itemId, label)
  }
  return out
}

// ── Per-booking memory ───────────────────────────────────────────────────────

async function readPrefixed(prefix: string): Promise<Map<string, string>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, value: true } })
  return new Map(rows.map(r => [r.key.slice(prefix.length), r.value]))
}

/**
 * The memory belongs to one workbook tab (`${itemId}|${tab}`): pointing the
 * feed at another file or tab must start clean, or every movement would read
 * as "deleted by the desk" and the new sheet would never be filled.
 */
export const sheetKeyOf = (itemId: string, tab: string) => `${itemId}|${tab.trim().toLowerCase()}`

interface WrittenValue { s: string; ids: string[] }

export async function readWritten(sheetKey: string): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>()
  for (const [ref, value] of Array.from(await readPrefixed(FEED_SETTINGS.rowsPrefix).then(m => m.entries()))) {
    const v = parse<WrittenValue>(value)
    if (v && v.s === sheetKey && Array.isArray(v.ids)) out.set(ref, new Set(v.ids))
  }
  return out
}

export async function readAliases(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const value of Array.from((await readPrefixed(FEED_SETTINGS.aliasPrefix)).values())) {
    const map = parse<Record<string, string>>(value)
    if (map) for (const [k, v] of Object.entries(map)) if (typeof v === 'string') out.set(k, v)
  }
  return out
}

/** Store the written sets that changed. Only bookings whose set differs are touched. */
export async function saveWritten(sheetKey: string, prev: Map<string, Set<string>>, next: Map<string, string[]>): Promise<number> {
  const changed: [string, string][] = []
  for (const [ref, ids] of Array.from(next.entries())) {
    const sorted = Array.from(new Set(ids)).sort()
    const before = Array.from(prev.get(ref) ?? []).sort()
    // `prev` only holds this sheet's entries, so a booking last written to another sheet counts as changed.
    if (!prev.has(ref) || sorted.join() !== before.join()) {
      changed.push([`${FEED_SETTINGS.rowsPrefix}${ref}`, JSON.stringify({ s: sheetKey, ids: sorted } satisfies WrittenValue)])
    }
  }
  for (let i = 0; i < changed.length; i += 25) {
    await Promise.all(changed.slice(i, i + 25).map(([key, value]) => setSetting(key, value)))
  }
  return changed.length
}

/**
 * Chart save hook: the save recreated this booking's agenda lines under new
 * ids. Remember where each line on the sheet went, so the next sync moves the
 * row (and everything the desk typed on it) to the new id instead of flagging
 * it removed and adding a fresh one.
 *
 * Cheap and non-fatal: a booking the feed never wrote costs one indexed read.
 */
export async function carryMcExcelFeed(bookingRef: string, pairs: [string, string][]): Promise<void> {
  if (!pairs.length) return
  try {
    const ref = bookingRef.trim()
    const rowsKey = `${FEED_SETTINGS.rowsPrefix}${ref}`
    const aliasKey = `${FEED_SETTINGS.aliasPrefix}${ref}`
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [rowsKey, aliasKey] } } })
    const written = new Set(parse<WrittenValue>(rows.find(r => r.key === rowsKey)?.value ?? null)?.ids ?? [])
    if (!written.size) return
    const alias = parse<Record<string, string>>(rows.find(r => r.key === aliasKey)?.value ?? null) ?? {}
    const moved = new Map(pairs)
    const next: Record<string, string> = {}
    // Lines already carried once follow their line to its newest id…
    for (const [sheetId, cur] of Object.entries(alias)) if (written.has(sheetId)) next[sheetId] = moved.get(cur) ?? cur
    // …and lines on the sheet that moved now are added.
    for (const id of Array.from(written)) if (!next[id] && moved.has(id)) next[id] = moved.get(id)!
    await setSetting(aliasKey, JSON.stringify(next))
  } catch (err) {
    console.error('[mc-excel-feed] carry-over failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}
