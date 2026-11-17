/**
 * Excel MC Generate — server side.
 *
 * READ: the "(VN TEAM) Movement Chart" workbook, through the same reader the
 * VN Driver Sync uses (lib/vn-driver-sync/sheet.ts → Microsoft Graph, download
 * only — the workbook is never opened for editing or written). The sheet link
 * is the Driver Sync setting, so there is one place to change it.
 *
 * WRITE: exactly one thing — the booking's baseline (the fingerprints of the
 * sheet rows a chart was last saved from) in one `system_settings` row keyed
 * `vn_mc_import:<REF>`. No agenda row is ever written here; the chart itself is
 * saved by the page through the ordinary POST /api/bookings/[ref]/agenda.
 */
import { prisma } from '@/lib/prisma'
import { mealPlanFullName, MEAL_PLAN_OPTIONS } from '@/lib/agenda-suggestions'
import { getDriverSyncConfig } from '@/lib/vn-driver-sync/server'
import { readMovementSheet, type SheetRead, type SheetRow } from '@/lib/vn-driver-sync/sheet'
import {
  fingerprint, guessServiceType, lineValueKeys, parseSheetClock,
  type McBaseline, type McSheetLine, type McSheetPayload,
} from './shared'
import { BASELINE_PREFIX, getMcAutoConfig, getMcAutoState, isMcAdmin } from './config'

/** How many sheet values a booking's baseline remembers (newest first). */
const MAX_VALS = 3000

const CACHE_MS = 3 * 60_000
/** "Refresh" still waits this long between real downloads, so a click-happy desk cannot hammer Graph. */
const MIN_REFRESH_MS = 15_000

let cache: { url: string; at: number; read: SheetRead } | null = null
let inFlight: Promise<SheetRead> | null = null

export async function readSheet(force: boolean): Promise<{ read: SheetRead; at: number; fromCache: boolean; url: string }> {
  const { sheet: url } = await getDriverSyncConfig()
  const age = cache && cache.url === url ? Date.now() - cache.at : Infinity
  if (cache && age < (force ? MIN_REFRESH_MS : CACHE_MS)) return { read: cache.read, at: cache.at, fromCache: true, url }
  if (!inFlight) {
    inFlight = readMovementSheet(url)
      .then(read => { cache = { url, at: Date.now(), read }; return read })
      .finally(() => { inFlight = null })
  }
  const read = await inFlight
  return { read, at: cache?.at ?? Date.now(), fromCache: false, url }
}

const clip = (s: string | null | undefined, n: number): string | null => {
  const t = String(s ?? '').trim()
  return t ? t.slice(0, n) : null
}

function mapMeal(raw: string | null): string | null {
  const t = String(raw ?? '').trim()
  if (!t || /^(none|no|nil|n\/?a|-+)$/i.test(t)) return null
  const full = mealPlanFullName(t)
  const opt = MEAL_PLAN_OPTIONS.find(o => o.value.toLowerCase() === full.toLowerCase())
  return opt?.value ?? full
}

export function toLine(r: SheetRow): McSheetLine {
  const clock = parseSheetClock(r.timeRaw ?? r.time)
  const contact = r.driverText ?? r.text
  const phones = r.phones
  const timeRaw = typeof r.timeRaw === 'number' ? (clock.start ?? null) : r.timeRaw
  return {
    key: fingerprint([r.date, r.location, r.from, r.to, r.details, r.meal, String(r.timeRaw ?? r.time ?? ''), r.service, contact]),
    tab: r.tab, row: r.row, date: r.date,
    location: r.location, from: r.from, to: r.to, details: r.details,
    meal: mapMeal(r.meal),
    timeRaw, time: clock.start ?? (/^\d{2}:\d{2}$/.test(r.time ?? '') ? r.time : null), timeEnd: clock.end,
    serviceRaw: r.service,
    serviceType: guessServiceType(r.service, r.serviceCode),
    vendorText: contact,
    // The same shape the VN Driver Sync writes, so the two never fight over it.
    driverName: phones.length ? clip(contact?.replace(/\s*\n\s*/g, ' · '), 191) : null,
    driverPhone: phones.length ? clip(phones.join(' / '), 191) : null,
    guest: r.guest, adults: r.adults, children: r.children,
  }
}


export const baselineKey = (ref: string) => `${BASELINE_PREFIX}${ref.toUpperCase()}`

export function parseBaseline(value: string | null | undefined): McBaseline | null {
  if (!value) return null
  try {
    const b = JSON.parse(value) as McBaseline
    return Array.isArray(b.keys) ? b : null
  } catch { return null }
}

export async function getBaseline(ref: string): Promise<McBaseline | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: baselineKey(ref) } })
  return parseBaseline(row?.value)
}

export async function writeBaseline(ref: string, b: McBaseline): Promise<McBaseline> {
  const value: McBaseline = { ...b, keys: Array.from(new Set(b.keys)), vals: Array.from(new Set(b.vals ?? [])).slice(0, MAX_VALS) }
  const json = JSON.stringify(value)
  await prisma.systemSetting.upsert({
    where: { key: baselineKey(ref) },
    create: { key: baselineKey(ref), value: json },
    update: { value: json },
  })
  return value
}

/** This booking's rows of a sheet read, in chart order. */
export function linesFor(read: SheetRead, ref: string): McSheetLine[] {
  const REF = ref.toUpperCase()
  return read.rows
    .filter(r => r.refs.includes(REF))
    .map(toLine)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999')
      || (a.time ?? '99:99').localeCompare(b.time ?? '99:99')
      || a.tab.localeCompare(b.tab) || a.row - b.row)
}

/**
 * After a chart is saved from the sheet: remember the rows it was built from
 * and every value they carried (merged into what the sheet put there before),
 * which is what lets the auto-update tell stale sheet data from OPS edits.
 */
export async function saveBaseline(ref: string, keys: string[], by: string | null, title: string | null): Promise<McBaseline> {
  const prev = await getBaseline(ref)
  const keySet = new Set(keys)
  let vals: string[] = []
  try {
    const { read } = await readSheet(false)
    vals = linesFor(read, ref).filter(l => keySet.has(l.key)).flatMap(lineValueKeys)
  } catch { /* the history just grows less this time */ }
  return writeBaseline(ref, {
    at: new Date().toISOString(), by, keys, title,
    vals: [...vals, ...(prev?.vals ?? [])],
    autoAt: prev?.autoAt ?? null,
    paused: prev?.paused ?? false,
  })
}

export async function setBaselinePaused(ref: string, paused: boolean): Promise<McBaseline | null> {
  const prev = await getBaseline(ref)
  if (!prev) return null
  return writeBaseline(ref, { ...prev, paused })
}

export async function sheetPayload(ref: string, force: boolean, role?: string | null): Promise<McSheetPayload> {
  const REF = ref.toUpperCase()
  const [{ read, at, fromCache, url }, baseline, config, lastRun] = await Promise.all([
    readSheet(force), getBaseline(REF), getMcAutoConfig(), getMcAutoState(),
  ])
  return {
    bookingRef: REF,
    lines: linesFor(read, REF),
    sheet: { title: read.title, source: read.source, readAt: new Date(at).toISOString(), tabs: read.tabs, fromCache, url },
    warnings: read.warnings,
    // Includes the value history: the review uses it to tell OPS edits from stale sheet data.
    baseline,
    auto: { mode: config.mode, intervalMin: config.intervalMin, lastRun, canAdmin: isMcAdmin(role) },
  }
}
