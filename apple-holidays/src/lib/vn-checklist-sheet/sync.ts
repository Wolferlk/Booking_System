/**
 * Checklist VN 2.1v — settings, the SharePoint download, and the sync into
 * `vn_sheet_checklist_*`.
 *
 * READ-ONLY TOWARDS THE WORKBOOK. The file is fetched with `/content` (a plain
 * download); no workbook session is opened and no Graph call here writes to
 * SharePoint. The only writes are to this feature's own four tables.
 *
 * A sync:
 *   1. asks Graph for the file's eTag — if it has not changed since the last
 *      good sync, it stops there (UNCHANGED) without downloading 6 MB;
 *   2. downloads and parses the workbook (./parse.ts);
 *   3. compares each tour's content hash with the stored one and rewrites only
 *      the tours the desk actually changed, recording what changed;
 *   4. marks tours that left the sheet inactive — nothing is ever deleted
 *      except a changed tour's own old lines, which are replaced.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { downloadDriveItem, graphFetch } from '@/lib/graph-client'
import { isMissingTable } from '@/lib/vn-includes/includes'
import { parseChecklistWorkbook, type ParsedLine, type ParsedTour } from './parse'
import {
  DEFAULT_CHECKLIST_SHEET_URL, DEFAULT_SYNC_INTERVAL_HOURS, SHEET_SETTINGS, fmtVnd,
  type SheetSyncInfo,
} from './shared'

export { isMissingTable }

// ── Settings ─────────────────────────────────────────────────────────────────

export interface SheetConfig {
  sheetUrl: string
  tabs: string[]
  enabled: boolean
  intervalHours: number
}

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export async function getSheetConfig(): Promise<SheetConfig> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [SHEET_SETTINGS.url, SHEET_SETTINGS.tabs, SHEET_SETTINGS.enabled, SHEET_SETTINGS.intervalHours] } },
  })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const hours = Number(map.get(SHEET_SETTINGS.intervalHours))
  return {
    sheetUrl: map.get(SHEET_SETTINGS.url)?.trim() || DEFAULT_CHECKLIST_SHEET_URL,
    tabs: (map.get(SHEET_SETTINGS.tabs) ?? '').split(',').map(t => t.trim()).filter(Boolean),
    enabled: map.get(SHEET_SETTINGS.enabled) !== 'false',
    intervalHours: Number.isFinite(hours) && hours >= 0.5 && hours <= 24 ? hours : DEFAULT_SYNC_INTERVAL_HOURS,
  }
}

export async function saveSheetConfig(input: Partial<{ sheetUrl: string; tabs: string; enabled: boolean; intervalHours: number }>): Promise<SheetConfig> {
  const current = await getSheetConfig()
  if (input.sheetUrl !== undefined) {
    const url = input.sheetUrl.trim()
    if (url && !/^https:\/\/[^/]+\.sharepoint\.com\//i.test(url) && !/^https:\/\/1drv\.ms\//i.test(url)) {
      throw new Error('That does not look like a SharePoint / OneDrive share link')
    }
    await setSetting(SHEET_SETTINGS.url, url)
    if ((url || DEFAULT_CHECKLIST_SHEET_URL) !== current.sheetUrl) await setSetting(SHEET_SETTINGS.ref, '')
  }
  if (input.tabs !== undefined) {
    const tabs = input.tabs.split(',').map(t => t.trim()).filter(Boolean)
    if (tabs.some(t => /[\\/?*[\]:]/.test(t))) throw new Error('A tab name cannot contain \\ / ? * [ ] :')
    await setSetting(SHEET_SETTINGS.tabs, tabs.join(', '))
  }
  if (input.enabled !== undefined) await setSetting(SHEET_SETTINGS.enabled, input.enabled ? 'true' : 'false')
  if (input.intervalHours !== undefined) {
    const h = Number(input.intervalHours)
    if (!Number.isFinite(h) || h < 0.5 || h > 24) throw new Error('The interval must be between 0.5 and 24 hours')
    await setSetting(SHEET_SETTINGS.intervalHours, String(h))
  }
  return getSheetConfig()
}

// ── Graph (read only) ────────────────────────────────────────────────────────

export interface SheetFile {
  driveId: string
  itemId: string
  fileName: string
  webUrl: string
  eTag: string | null
  modifiedAt: string | null
  size: number | null
}

function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * The file behind the share link, with its current eTag. Always a fresh Graph
 * call (the eTag is the point), but the ids are cached so a link that stops
 * resolving via /shares still reaches the file it resolved to before.
 */
export async function resolveSheetFile(url: string): Promise<SheetFile> {
  type Item = {
    id: string; name: string; webUrl: string; eTag?: string; cTag?: string; size?: number
    lastModifiedDateTime?: string; parentReference?: { driveId?: string }
  }
  const select = '$select=id,name,webUrl,eTag,cTag,size,lastModifiedDateTime,parentReference'
  let item: Item
  try {
    item = await graphFetch<Item>(`/shares/${encodeShareUrl(url)}/driveItem?${select}`)
  } catch (err) {
    const cached = await prisma.systemSetting.findUnique({ where: { key: SHEET_SETTINGS.ref } })
    const ref = cached?.value ? (JSON.parse(cached.value) as { driveId?: string; itemId?: string; forUrl?: string }) : null
    if (!ref?.driveId || !ref.itemId || ref.forUrl !== url) throw err
    item = await graphFetch<Item>(`/drives/${ref.driveId}/items/${ref.itemId}?${select}`)
    item.parentReference = { driveId: ref.driveId }
  }
  const driveId = item.parentReference?.driveId
  if (!driveId) throw new Error('The link did not resolve to a file — is it a share link to the workbook itself?')
  await setSetting(SHEET_SETTINGS.ref, JSON.stringify({ driveId, itemId: item.id, forUrl: url }))
  return {
    driveId, itemId: item.id, fileName: item.name, webUrl: item.webUrl,
    // cTag moves on content changes only; eTag also moves on renames/metadata.
    eTag: item.cTag ?? item.eTag ?? null,
    modifiedAt: item.lastModifiedDateTime ?? null,
    size: item.size ?? null,
  }
}

/** The workbook's bytes, exactly as they are on SharePoint. */
export async function downloadSheet(): Promise<{ file: SheetFile; buffer: Buffer }> {
  const config = await getSheetConfig()
  const file = await resolveSheetFile(config.sheetUrl)
  const buffer = await downloadDriveItem(file.driveId, file.itemId)
  return { file, buffer }
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export type SyncTrigger = 'CRON' | 'MANUAL' | 'STALE' | 'SETTINGS'

/** A RUNNING row older than this is a run that died (a Lambda frozen mid-sync). */
const STALE_LOCK_MS = 15 * 60_000

let inflight: Promise<SheetSyncInfo | null> | null = null

/**
 * Run one sync. Returns null when another run already holds the lock.
 * `force` re-reads the file even when its eTag has not moved.
 */
export function runSheetSync(opts: { trigger: SyncTrigger; force?: boolean; triggeredBy?: string | null }): Promise<SheetSyncInfo | null> {
  inflight ??= doSync(opts).finally(() => { inflight = null })
  return inflight
}

export const isSyncInFlight = () => inflight !== null

async function doSync(opts: { trigger: SyncTrigger; force?: boolean; triggeredBy?: string | null }): Promise<SheetSyncInfo | null> {
  // Cross-instance lock: another server may be mid-sync.
  const running = await prisma.vnSheetSync.findFirst({
    where: { status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_LOCK_MS) } },
    select: { id: true },
  })
  if (running) return null

  const started = Date.now()
  const run = await prisma.vnSheetSync.create({
    data: { trigger: opts.trigger, status: 'RUNNING', triggeredBy: opts.triggeredBy ?? null },
  })

  const finish = async (data: Prisma.VnSheetSyncUpdateInput) => {
    const row = await prisma.vnSheetSync.update({
      where: { id: run.id },
      data: { ...data, finishedAt: new Date(), durationMs: Date.now() - started },
    })
    return toSyncInfo(row)
  }

  try {
    const config = await getSheetConfig()
    const file = await resolveSheetFile(config.sheetUrl)
    const fileInfo = {
      fileName: file.fileName, fileETag: file.eTag, fileSize: file.size,
      fileModifiedAt: file.modifiedAt ? new Date(file.modifiedAt) : null,
    }

    // Settings changes (link, tabs) sync with force, so the eTag alone decides here.
    if (!opts.force && file.eTag) {
      const lastGood = await prisma.vnSheetSync.findFirst({
        where: { status: { in: ['SUCCESS', 'UNCHANGED'] }, id: { not: run.id } },
        orderBy: { startedAt: 'desc' },
        select: { fileETag: true, tabs: true, tours: true, lines: true },
      })
      if (lastGood && lastGood.fileETag === file.eTag) {
        return await finish({
          ...fileInfo, status: 'UNCHANGED', tabs: lastGood.tabs,
          tours: lastGood.tours, lines: lastGood.lines,
        })
      }
    }

    const buffer = await downloadDriveItem(file.driveId, file.itemId)
    const parsed = parseChecklistWorkbook(buffer, config.tabs)
    const result = await applyParsed(parsed.tours, run.id)

    return await finish({
      ...fileInfo,
      status: 'SUCCESS',
      tabs: parsed.tabs.join(', ').slice(0, 500),
      tours: parsed.tours.length,
      lines: parsed.lineCount,
      added: result.added,
      changed: result.changed,
      removed: result.removed,
      warnings: parsed.warnings.length ? parsed.warnings.join('\n').slice(0, 8000) : null,
    })
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 4000)
    console.error('[ChecklistVN 2.1] sync failed:', message)
    return await finish({ status: 'FAILED', error: message }).catch(() => null)
  }
}

// ── Apply ────────────────────────────────────────────────────────────────────

const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null)
const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v))

function tourData(t: ParsedTour) {
  const paid = t.lines.filter(l => ['ACT_PAID', 'TINA_PAID', 'INDIA_PAID', 'OTHER_PAID'].includes(l.paidBucket)).length
  const check = t.lines.filter(l => l.paidBucket === 'CHECK').length
  return {
    tourCode: t.tourCode.slice(0, 191),
    refKey: t.refKey.slice(0, 500),
    primaryRef: t.primaryRef,
    agent: t.agent,
    agentRef: t.agentRef,
    pax: t.pax,
    monthLabel: t.monthLabel,
    arrivalDate: d(t.arrivalDate),
    departureDate: d(t.departureDate),
    days: t.days,
    itinerary: t.itinerary,
    quotedUsd: t.quotedUsd,
    revenueUsd: t.revenueUsd,
    totalVnd: t.totalVnd,
    totalEstimateVnd: t.totalEstimateVnd,
    pnlIncurredVnd: t.pnlIncurredVnd,
    profitMargin: t.profitMargin !== null && Math.abs(t.profitMargin) < 1e5 ? t.profitMargin : null,
    exchangeRate: t.exchangeRate,
    lineCount: t.lines.length,
    linesTotalVnd: t.lines.reduce((s, l) => s + (l.totalEstimateVnd ?? 0), 0),
    paidLineCount: paid,
    checkLineCount: check,
    openLineCount: t.lines.length - paid - check,
    sheetTab: t.sheetTab,
    sheetRow: t.sheetRow,
    contentHash: t.contentHash,
  }
}

const lineData = (tourCode: string, l: ParsedLine): Prisma.VnSheetLineCreateManyInput => ({
  tourCode: tourCode.slice(0, 191),
  position: l.position,
  sheetTab: l.sheetTab,
  sheetRow: l.sheetRow,
  details: l.details,
  vendor: l.vendor,
  code: l.code,
  dates: l.dates,
  qcStatus: l.qcStatus,
  unitPrice: l.unitPrice,
  quan1: l.quan1,
  quan2: l.quan2,
  totalEstimateVnd: l.totalEstimateVnd,
  paidRaw: l.paidRaw,
  paidBucket: l.paidBucket,
  incurred: l.incurred,
  note: l.note,
})

async function insertLines(rows: Prisma.VnSheetLineCreateManyInput[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.vnSheetLine.createMany({ data: rows.slice(i, i + 1000) })
  }
}

async function applyParsed(tours: ParsedTour[], syncId: string) {
  const existing = await prisma.vnSheetTour.findMany({
    select: { tourCode: true, contentHash: true, isActive: true, sheetRow: true, sheetTab: true },
  })
  const firstSync = existing.length === 0
  const byCode = new Map(existing.map(t => [t.tourCode, t]))
  const seen = new Set<string>()

  const created: ParsedTour[] = []
  const changed: ParsedTour[] = []
  const moved: { code: string; row: number; tab: string }[] = []

  for (const t of tours) {
    const code = t.tourCode.slice(0, 191)
    if (seen.has(code)) continue
    seen.add(code)
    const have = byCode.get(code)
    if (!have) created.push(t)
    else if (have.contentHash !== t.contentHash || !have.isActive) changed.push(t)
    else if (have.sheetRow !== t.sheetRow || have.sheetTab !== t.sheetTab) moved.push({ code, row: t.sheetRow, tab: t.sheetTab })
  }

  const events: Prisma.VnSheetEventCreateManyInput[] = []

  // New tours.
  for (let i = 0; i < created.length; i += 500) {
    await prisma.vnSheetTour.createMany({ data: created.slice(i, i + 500).map(tourData), skipDuplicates: true })
  }
  await insertLines(created.flatMap(t => t.lines.map(l => lineData(t.tourCode, l))))
  if (!firstSync) {
    for (const t of created) {
      events.push({
        tourCode: t.tourCode.slice(0, 191), syncId, kind: 'ADDED',
        summary: `Added to the sheet with ${t.lines.length} line(s)`,
      })
    }
  }

  // Changed tours: diff against what we stored, then replace.
  for (let i = 0; i < changed.length; i += 200) {
    const batch = changed.slice(i, i + 200)
    const codes = batch.map(t => t.tourCode.slice(0, 191))
    const [oldTours, oldLines] = await Promise.all([
      prisma.vnSheetTour.findMany({ where: { tourCode: { in: codes } } }),
      prisma.vnSheetLine.findMany({ where: { tourCode: { in: codes } }, orderBy: { position: 'asc' } }),
    ])
    const oldTourBy = new Map(oldTours.map(t => [t.tourCode, t]))
    const oldLinesBy = new Map<string, typeof oldLines>()
    for (const l of oldLines) {
      const list = oldLinesBy.get(l.tourCode) ?? []
      list.push(l)
      oldLinesBy.set(l.tourCode, list)
    }

    for (const t of batch) {
      const code = t.tourCode.slice(0, 191)
      const before = oldTourBy.get(code)
      const diff = diffTour(before, oldLinesBy.get(code) ?? [], t)
      const now = new Date()
      await prisma.$transaction([
        prisma.vnSheetTour.update({
          where: { tourCode: code },
          data: { ...tourData(t), isActive: true, removedAt: null, changedAt: now },
        }),
        prisma.vnSheetLine.deleteMany({ where: { tourCode: code } }),
        prisma.vnSheetLine.createMany({ data: t.lines.map(l => lineData(code, l)) }),
      ])
      if (before && !before.isActive) {
        events.push({ tourCode: code, syncId, kind: 'RESTORED', summary: 'Back on the sheet', changes: JSON.stringify(diff.changes) })
      } else if (diff.changes.length) {
        events.push({ tourCode: code, syncId, kind: 'CHANGED', summary: diff.summary, changes: JSON.stringify(diff.changes) })
      }
    }
  }

  // Unchanged tours whose rows moved (rows inserted above them): positions only.
  for (let i = 0; i < moved.length; i += 300) {
    const batch = moved.slice(i, i + 300)
    const rowCase = Prisma.join(batch.map(m => Prisma.sql`WHEN ${m.code} THEN ${m.row}`), ' ')
    const tabCase = Prisma.join(batch.map(m => Prisma.sql`WHEN ${m.code} THEN ${m.tab}`), ' ')
    const codes = Prisma.join(batch.map(m => m.code))
    await prisma.$executeRaw`
      UPDATE vn_sheet_checklist_tours
         SET sheetRow = CASE tourCode ${rowCase} END,
             sheetTab = CASE tourCode ${tabCase} END
       WHERE tourCode IN (${codes})`
  }

  // Tours no longer on the sheet: retired, never deleted.
  const gone = existing.filter(t => t.isActive && !seen.has(t.tourCode)).map(t => t.tourCode)
  for (let i = 0; i < gone.length; i += 500) {
    await prisma.vnSheetTour.updateMany({
      where: { tourCode: { in: gone.slice(i, i + 500) } },
      data: { isActive: false, removedAt: new Date() },
    })
  }
  for (const code of gone) {
    events.push({ tourCode: code, syncId, kind: 'REMOVED', summary: 'No longer on the sheet' })
  }

  for (let i = 0; i < events.length; i += 500) {
    await prisma.vnSheetEvent.createMany({ data: events.slice(i, i + 500) })
  }

  return { added: created.length, changed: changed.length, removed: gone.length }
}

// ── Diff ─────────────────────────────────────────────────────────────────────

type Change = { field: string; from?: string | null; to?: string | null; line?: string }

const lineKey = (details: string, code: string | null) =>
  `${details.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}|${(code ?? '').toLowerCase()}`

const short = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

export function diffTour(
  before: { agent: string | null; pax: number | null; arrivalDate: Date | null; departureDate: Date | null; itinerary: string | null; revenueUsd: Prisma.Decimal | null; totalEstimateVnd: Prisma.Decimal | null; pnlIncurredVnd: Prisma.Decimal | null } | undefined,
  oldLines: { details: string; code: string | null; vendor: string | null; paidRaw: string | null; totalEstimateVnd: Prisma.Decimal | null; unitPrice: Prisma.Decimal | null; quan1: Prisma.Decimal | null }[],
  after: ParsedTour,
): { changes: Change[]; summary: string } {
  const changes: Change[] = []
  if (before) {
    const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null)
    const cmp = (field: string, a: string | number | null, b: string | number | null, show = (v: string | number | null) => (v === null ? null : String(v))) => {
      if ((a ?? null) !== (b ?? null)) changes.push({ field, from: show(a), to: show(b) })
    }
    const money = (v: string | number | null) => (v === null ? null : fmtVnd(Number(v)))
    cmp('Agent', before.agent, after.agent)
    cmp('Pax', before.pax, after.pax)
    cmp('Arrival', iso(before.arrivalDate), after.arrivalDate)
    cmp('Departure', iso(before.departureDate), after.departureDate)
    cmp('Itinerary', before.itinerary, after.itinerary)
    cmp('Revenue USD', n(before.revenueUsd), after.revenueUsd)
    cmp('Total estimate', n(before.totalEstimateVnd), after.totalEstimateVnd, money)
    cmp('PNL incurred', n(before.pnlIncurredVnd), after.pnlIncurredVnd, money)
  }

  const pool = new Map<string, typeof oldLines>()
  for (const l of oldLines) {
    const k = lineKey(l.details, l.code)
    pool.set(k, [...(pool.get(k) ?? []), l])
  }
  let added = 0
  let paid = 0
  for (const l of after.lines) {
    const k = lineKey(l.details, l.code)
    const match = pool.get(k)?.shift()
    const label = short(l.details)
    if (!match) {
      added++
      changes.push({ field: 'Line added', to: `${label}${l.totalEstimateVnd !== null ? ` · ${fmtVnd(l.totalEstimateVnd)}` : ''}`, line: label })
      continue
    }
    if ((match.paidRaw ?? null) !== (l.paidRaw ?? null)) {
      if (l.paidRaw && /paid/i.test(l.paidRaw)) paid++
      changes.push({ field: 'Paid', from: match.paidRaw ?? 'blank', to: l.paidRaw ?? 'blank', line: label })
    }
    if (n(match.totalEstimateVnd) !== l.totalEstimateVnd) {
      changes.push({ field: 'Amount', from: money2(n(match.totalEstimateVnd)), to: money2(l.totalEstimateVnd), line: label })
    }
    if ((match.vendor ?? null) !== (l.vendor ?? null)) {
      changes.push({ field: 'Vendor', from: match.vendor, to: l.vendor, line: label })
    }
  }
  let removed = 0
  for (const rest of Array.from(pool.values())) {
    for (const l of rest) {
      removed++
      changes.push({ field: 'Line removed', from: short(l.details), line: short(l.details) })
    }
  }

  const parts: string[] = []
  if (paid) parts.push(`${paid} line${paid > 1 ? 's' : ''} marked paid`)
  if (added) parts.push(`${added} line${added > 1 ? 's' : ''} added`)
  if (removed) parts.push(`${removed} line${removed > 1 ? 's' : ''} removed`)
  const amountChanges = changes.filter(c => c.field === 'Amount').length
  if (amountChanges) parts.push(`${amountChanges} amount${amountChanges > 1 ? 's' : ''} changed`)
  const headerChanges = changes.filter(c => !c.line)
  for (const c of headerChanges.slice(0, 2)) parts.push(`${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`)
  if (!parts.length && changes.length) parts.push(`${changes.length} change${changes.length > 1 ? 's' : ''}`)
  if (!parts.length) parts.push('Notes or status updated')

  return { changes: changes.slice(0, 60), summary: parts.join(' · ').slice(0, 500) }
}

const money2 = (v: number | null) => (v === null ? null : fmtVnd(v))

// ── Status ───────────────────────────────────────────────────────────────────

export function toSyncInfo(r: {
  id: string; trigger: string; status: string; startedAt: Date; finishedAt: Date | null; durationMs: number | null
  fileName: string | null; fileModifiedAt: Date | null; tabs: string | null; tours: number; lines: number
  added: number; changed: number; removed: number; warnings: string | null; error: string | null; triggeredBy: string | null
}): SheetSyncInfo {
  return {
    id: r.id, trigger: r.trigger, status: r.status as SheetSyncInfo['status'],
    startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null,
    durationMs: r.durationMs, fileName: r.fileName, fileModifiedAt: r.fileModifiedAt?.toISOString() ?? null,
    tabs: r.tabs, tours: r.tours, lines: r.lines, added: r.added, changed: r.changed, removed: r.removed,
    warnings: r.warnings, error: r.error, triggeredBy: r.triggeredBy,
  }
}

export async function lastSync(): Promise<SheetSyncInfo | null> {
  const row = await prisma.vnSheetSync.findFirst({ orderBy: { startedAt: 'desc' } })
  return row ? toSyncInfo(row) : null
}

/** When the mirror last matched the file (a SUCCESS or an UNCHANGED check). */
export async function lastGoodSyncAt(): Promise<Date | null> {
  const row = await prisma.vnSheetSync.findFirst({
    where: { status: { in: ['SUCCESS', 'UNCHANGED'] } },
    orderBy: { startedAt: 'desc' },
    select: { finishedAt: true, startedAt: true },
  })
  return row ? (row.finishedAt ?? row.startedAt) : null
}

/**
 * Is a sync due? Every `intervalHours` after the last attempt; after a failure,
 * 15 minutes, so a SharePoint blip does not leave the mirror 2 hours stale.
 */
export async function isSyncDue(config?: SheetConfig): Promise<boolean> {
  const cfg = config ?? await getSheetConfig()
  if (!cfg.enabled) return false
  const last = await prisma.vnSheetSync.findFirst({
    orderBy: { startedAt: 'desc' },
    select: { status: true, startedAt: true },
  })
  if (!last) return true
  if (last.status === 'RUNNING') return Date.now() - last.startedAt.getTime() > STALE_LOCK_MS
  const wait = last.status === 'FAILED' ? 15 * 60_000 : cfg.intervalHours * 3_600_000
  return Date.now() - last.startedAt.getTime() >= wait
}

/**
 * Fire-and-forget refresh when someone reads a stale mirror. This is what keeps
 * the 2-hour promise on hosting where the in-process timer does not survive
 * (Amplify / Lambda): the first reader after the interval triggers the sync.
 */
export async function refreshIfStale(): Promise<boolean> {
  try {
    if (isSyncInFlight() || !await isSyncDue()) return isSyncInFlight()
    void runSheetSync({ trigger: 'STALE' }).catch(() => { /* recorded on the run row */ })
    return true
  } catch (err) {
    if (!isMissingTable(err)) console.error('[ChecklistVN 2.1] stale check failed:', err)
    return false
  }
}
