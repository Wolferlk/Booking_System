/**
 * OneDrive / SharePoint folder monitor.
 *
 * Scans configured drives using Microsoft Graph delta API for new/changed
 * booking folders. When a TC.docx appears it creates/updates a booking;
 * when a PNL xlsx appears it updates the PNL line items.
 *
 * Drive layout expected:
 *   Vietnam  : VN OPERATION / {Year} / {Month} / [{DD Month} /] {BookingRef} - {Name} / files
 *   Sri Lanka: SL Share Drive_ / {Year} / {Month} / {BookingRef} - {Name} / files
 */

import { prisma } from '@/lib/prisma'
import {
  getUserDriveId,
  getSharePointDriveId,
  getDriveItemsDelta,
  downloadDriveItem,
  listFolderChildren,
  listItemChildren,
  searchDriveItems,
  type DriveItem,
} from '@/lib/graph-client'
import { extractTextFromDocx } from '@/lib/parsers/docx-parser'
import { parsePNLXlsx } from '@/lib/parsers/xlsx-parser'
import { extractBookingFromEmail } from '@/lib/mail-processor'
import { classifyPNLCategories, extractPNLFromText } from '@/lib/openai'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string; numpages: number }>
import { detectCountryFromRef, detectCountryFromPath } from '@/lib/country-detection'
import { logActivity, ACTION } from '@/lib/activity'
import { upsertAgenda } from '@/lib/incoming-mail-automation'
import type { OperationCountry } from '@prisma/client'

// ── Drive config ──────────────────────────────────────────────────────────────

export interface DriveConfig {
  key:     string       // VN | SL | SG | MY
  label:   string
  country: OperationCountry
  type:    'personal' | 'sharepoint'
  // personal
  userUpn?:    string
  rootFolder?: string
  // sharepoint
  siteHost?: string
  sitePath?: string
  library?:  string
  rootFolder_sp?: string
}

export const DRIVE_CONFIGS: DriveConfig[] = [
  {
    key:        'VN',
    label:      'Vietnam (VN OPERATION)',
    country:    'VIETNAM',
    type:       'personal',
    userUpn:    process.env.ONEDRIVE_VN_USER ?? 'pradeep.Reservation@aahaas.com',
    rootFolder: process.env.ONEDRIVE_VN_ROOT ?? 'VN OPERATION',
  },
  {
    key:           'SL',
    label:         'Sri Lanka (SL Share Drive)',
    country:       'SRILANKA',
    type:          'sharepoint',
    siteHost:      process.env.ONEDRIVE_SL_SITE_HOST  ?? 'aahaas.sharepoint.com',
    sitePath:      process.env.ONEDRIVE_SL_SITE_PATH  ?? '/sites/BookingExperienceB2B2',
    rootFolder_sp: process.env.ONEDRIVE_SL_ROOT ?? 'SL Share Drive_',
  },
  {
    key:        'MY',
    label:      'Malaysia',
    country:    'MALAYSIA',
    type:       'personal',
    userUpn:    process.env.ONEDRIVE_MY_USER ?? 'geetha.lakshmi@aahaas.com',
    // Singapore & Malaysia share one OneDrive — scope each to its own sub-folder so
    // browsing/scanning is country-specific (same approach as VN's 'VN OPERATION').
    rootFolder: process.env.ONEDRIVE_MY_ROOT ?? 'Reservation/Malaysia Drive',
  },
  {
    key:        'SG',
    label:      'Singapore',
    country:    'SINGAPORE',
    type:       'personal',
    userUpn:    process.env.ONEDRIVE_SG_USER ?? 'geetha.lakshmi@aahaas.com',
    rootFolder: process.env.ONEDRIVE_SG_ROOT ?? 'Reservation/Singapore Drive',
  },
]

export interface DriveAccessResult {
  driveKey: string
  label: string
  rootPath: string
  ok: boolean
  driveId?: string
  folderCount?: number
  sampleFolders?: string[]
  error?: string
}

// ── Booking-ref detection ─────────────────────────────────────────────────────

// Match booking folders: prefix + 3+ digits + optional dash/space/end-of-string
// This handles both "VN19018 - Haji" AND bare refs like "VN10000"
const BOOKING_FOLDER_RE = /^(VN|IS|SG|MY|AH)\s*\d{3,}([-\s]|$)/i

function extractRefFromFolderName(name: string): string | null {
  const m = name.match(/^([A-Z]{2,3}\d{3,})/i)
  if (m) return m[1].toUpperCase().replace(/\s+/g, '')
  return null
}

function isBookingFolder(item: DriveItem): boolean {
  return !!(item.folder && BOOKING_FOLDER_RE.test(item.name))
}

function isTCFile(name: string): boolean {
  const n = name.trim()
  // VN format: exactly "TC.docx" or "TC.pdf"
  if (/^TC\.(docx?|pdf)$/i.test(n)) return true
  // SL/other format: file with "confirm" in the name (handles typos like "Confirmaiton")
  if (/confirm/i.test(n) && /\.(docx?|pdf)$/i.test(n)) return true
  // SL format: file named exactly as the booking ref e.g. "IS48231.docx"
  if (/^(IS|VN|SG|MY|AH)\d+\.(docx?|pdf)$/i.test(n)) return true
  return false
}

function isPNLFile(name: string): boolean {
  const n = name.toLowerCase().trim()
  // Skip images, media, and archives — these are never costing documents
  if (/\.(jpe?g|png|gif|bmp|webp|mp[34]|mov|avi|mkv|zip|rar|7z|tar)$/i.test(n)) return false
  // Match PNL / costing-sheet naming patterns:
  if (/\bpnl\b/.test(n))                         return true  // "PNL", "VN19342 PNL.xlsx"
  if (/p\s*&\s*l\b/.test(n))                     return true  // "P&L", "P & L"
  if (/\bp\s+and\s+l\b/.test(n))                 return true  // "P and L"
  if (/profit.{0,5}loss/i.test(n))               return true  // "Profit Loss", "Profit & Loss"
  if (/profit\s*statement/i.test(n))             return true  // "Profit Statement"
  if (/\bcosting\b/i.test(n))                    return true  // "Costing", "Costing Sheet"
  if (/cost[_\s-]*sheet/i.test(n))               return true  // "Cost Sheet", "Cost-Sheet"
  return false
}

// ── Drive ID resolution (cached per process lifetime) ────────────────────────

const driveIdCache: Record<string, string> = {}

async function resolveDriveId(cfg: DriveConfig): Promise<string> {
  if (driveIdCache[cfg.key]) return driveIdCache[cfg.key]

  let id: string
  if (cfg.type === 'personal') {
    id = await getUserDriveId(cfg.userUpn!)
  } else {
    id = await getSharePointDriveId(cfg.siteHost!, cfg.sitePath!, cfg.library)
  }
  driveIdCache[cfg.key] = id
  return id
}

/** Resolve the Graph driveId for a drive key (VN, SL, MY, SG). */
export async function resolveDriveByKey(key: string): Promise<{ driveId: string; cfg: DriveConfig } | null> {
  const cfg = DRIVE_CONFIGS.find(c => c.key === key)
  if (!cfg) return null
  const driveId = await resolveDriveId(cfg)
  return { driveId, cfg }
}

export async function testDriveAccess(cfg: DriveConfig): Promise<DriveAccessResult> {
  const rootPath = cfg.type === 'personal' ? cfg.rootFolder ?? '' : cfg.rootFolder_sp ?? ''
  try {
    const driveId = await resolveDriveId(cfg)
    const items = rootPath ? await listFolderChildren(driveId, rootPath) : await listFolderChildren(driveId)
    return {
      driveKey: cfg.key,
      label: cfg.label,
      rootPath: rootPath || '(drive root)',
      ok: true,
      driveId,
      folderCount: items.length,
      sampleFolders: items.slice(0, 5).map(item => item.name),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      driveKey: cfg.key,
      label: cfg.label,
      rootPath: rootPath || '(drive root)',
      ok: false,
      error: msg,
    }
  }
}

// ── Delta token persistence ───────────────────────────────────────────────────

async function loadDeltaToken(driveKey: string): Promise<string | null> {
  const row = await prisma.oneDriveDeltaToken.findUnique({ where: { driveKey } })
  return row?.token ?? null
}

async function saveDeltaToken(driveKey: string, token: string): Promise<void> {
  await prisma.oneDriveDeltaToken.upsert({
    where:  { driveKey },
    create: { driveKey, token },
    update: { token },
  })
}

// ── Main scan ─────────────────────────────────────────────────────────────────

export interface ScanResult {
  driveKey:    string
  label:       string
  scanned:     number
  bookingsCreated: number
  bookingsUpdated: number
  pnlsUpdated:     number
  errors:          number
  events:          { ref: string; type: string; file: string }[]
}

export async function scanDrive(cfg: DriveConfig): Promise<ScanResult> {
  const t0 = Date.now()
  console.log(`\n━━━ [OneDrive][SCAN] ${cfg.key} ▸ ${cfg.label} ━━━`)

  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  // ── Resolve drive ID ────────────────────────────────────────────────────────
  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
    console.log(`  📁 Drive ID resolved: ${driveId.slice(0, 20)}…`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ❌ [${cfg.key}] Drive ID resolution failed: ${msg}`)
    result.errors += 1
    return result
  }

  // ── Load delta token ────────────────────────────────────────────────────────
  const rootPath   = cfg.type === 'personal' ? cfg.rootFolder : cfg.rootFolder_sp
  const deltaToken = await loadDeltaToken(cfg.key)
  console.log(`  🔑 Delta token: ${deltaToken ? `found (${deltaToken.slice(0, 40)}…)` : 'none (full scan)'}`)
  console.log(`  📂 Root path: ${rootPath ?? '(drive root)'}`)

  // ── Fetch delta items ───────────────────────────────────────────────────────
  let items: DriveItem[]
  let newToken: string
  try {
    const r = await getDriveItemsDelta(driveId, rootPath, deltaToken)
    items    = r.items
    newToken = r.deltaToken
    console.log(`  📦 Delta returned ${items.length} items (${items.filter(i => i.folder).length} folders, ${items.filter(i => i.file).length} files)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`  ❌ [${cfg.key}] Delta fetch failed: ${msg}`)
    result.errors += 1
    return result
  }

  result.scanned = items.length

  // ── Save new delta token ────────────────────────────────────────────────────
  if (newToken) {
    await saveDeltaToken(cfg.key, newToken)
    console.log(`  💾 Delta token saved (${newToken.slice(0, 40)}…)`)
  } else {
    console.warn(`  ⚠️  [${cfg.key}] No delta token returned — next scan will do a full scan`)
  }

  if (items.length === 0) {
    console.log(`  ✅ [${cfg.key}] No changes since last scan\n`)
    return result
  }

  // ── Group items ─────────────────────────────────────────────────────────────
  const filesByParent: Record<string, DriveItem[]> = {}
  const bookingFolders: Record<string, DriveItem> = {}

  for (const item of items) {
    if (item.folder) {
      if (isBookingFolder(item)) {
        bookingFolders[item.id] = item
        console.log(`  📁 Booking folder in delta: "${item.name}"`)
      }
    } else if (item.file) {
      const parentId = item.parentReference?.id ?? ''
      if (!filesByParent[parentId]) filesByParent[parentId] = []
      filesByParent[parentId].push(item)
    }
  }

  // ── Pass 1: process folders that appeared in this delta ─────────────────────
  for (const [folderId, folder] of Object.entries(bookingFolders)) {
    const bookingRef = extractRefFromFolderName(folder.name)
    if (!bookingRef) {
      console.log(`  ⏭  Skipping folder (no ref extracted): "${folder.name}"`)
      continue
    }
    const files = filesByParent[folderId] ?? []
    console.log(`\n  🔖 [${bookingRef}] Folder: "${folder.name}" · ${files.length} file(s) in delta`)
    await processBookingFolderFromDelta(driveId, folder, bookingRef, files, cfg, result)
  }

  // ── Pass 2: orphaned files — files added to an EXISTING folder not in this delta ──
  // This is the common case: folder already existed, staff uploads a new TC/PNL.
  // The folder itself doesn't appear again in delta, only the new files do.
  for (const [parentId, files] of Object.entries(filesByParent)) {
    if (bookingFolders[parentId]) continue // already handled in pass 1

    // Extract booking ref from the parent path segment
    const sampleFile    = files[0]
    const rawPath       = sampleFile?.parentReference?.path ?? ''
    // Graph path: "/drives/{id}/root:/VN OPERATION/2026/June/VN19018 - Haji"
    const afterRoot     = rawPath.split('root:/').pop() ?? ''
    const parentName    = decodeURIComponent(afterRoot.split('/').pop() ?? '')

    if (!BOOKING_FOLDER_RE.test(parentName)) continue

    const bookingRef = extractRefFromFolderName(parentName)
    if (!bookingRef) continue

    const hasActionable = files.some(f => isTCFile(f.name) || isPNLFile(f.name))
    if (!hasActionable) {
      // Log non-actionable files quietly
      for (const f of files) {
        console.log(`  📄 [${bookingRef}] File (no action): "${f.name}"`)
        if (!f.name.toLowerCase().includes('agenda')) {
          await upsertOneDriveEvent({
            driveType: cfg.key, itemId: f.id, itemName: f.name,
            itemPath: buildPath(f), webUrl: f.webUrl,
            eventType: 'FILE_DETECTED', bookingRef, status: 'PROCESSED',
          })
        }
      }
      continue
    }

    console.log(`\n  🔖 [${bookingRef}] Orphaned files (folder not in delta) · ${files.length} file(s)`)
    const existing   = await prisma.booking.findUnique({ where: { bookingRef }, select: { onedriveFolderUrl: true } })
    const folderUrl  = existing?.onedriveFolderUrl ?? undefined

    await processTCAndPNL(driveId, files, bookingRef, cfg, result, folderUrl)
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n  📊 [${cfg.key}] Done in ${elapsed}s — created:${result.bookingsCreated} updated:${result.bookingsUpdated} pnls:${result.pnlsUpdated} errors:${result.errors}\n`)

  return result
}

// ── Shared helper: process TC + PNL from a file list ─────────────────────────

async function processTCAndPNL(
  driveId:    string,
  files:      DriveItem[],
  bookingRef: string,
  cfg:        DriveConfig,
  result:     ScanResult,
  folderUrl?: string,
): Promise<void> {
  // If "new files only" mode is on, skip folders that already have a processed TC event
  const newFilesOnlySetting = await prisma.systemSetting.findUnique({ where: { key: 'onedrive_new_files_only' } })
  if (newFilesOnlySetting?.value === 'true') {
    const alreadyProcessed = await prisma.oneDriveEvent.findFirst({
      where: { bookingRef, eventType: 'TC_PROCESSED', status: 'PROCESSED' },
      select: { id: true },
    })
    if (alreadyProcessed) {
      console.log(`    ⏭  [${bookingRef}] Skipping (already processed + new-files-only mode is ON)`)
      return
    }
  }

  const tcFile  = files.find(f => isTCFile(f.name))
  const pnlFile = files.find(f => isPNLFile(f.name) && !f.name.toLowerCase().includes('agenda'))

  if (tcFile) {
    console.log(`    📄 TC  file: "${tcFile.name}"`)
    try {
      const r = await processTCFile(driveId, tcFile, bookingRef, cfg.country, folderUrl)

      // Verify the booking actually exists in DB before marking as TC_PROCESSED.
      // processTCFile returns { isNew: false } for PDF TCs without creating a booking,
      // which would otherwise show "Created" on the Drive Bookings page with no booking behind it.
      const bookingExists = await prisma.booking.findUnique({ where: { bookingRef }, select: { id: true } })

      if (bookingExists) {
        if (r.isNew) { result.bookingsCreated += 1; console.log(`    ✅ Booking CREATED: ${bookingRef}`) }
        else          { result.bookingsUpdated += 1; console.log(`    ✅ Booking UPDATED: ${bookingRef}`) }
        result.events.push({ ref: bookingRef, type: 'TC', file: tcFile.name })
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'TC_PROCESSED', bookingRef, status: 'PROCESSED',
        })
      } else {
        // TC was detected but no booking was created (e.g. PDF with no text, or no dates extracted)
        console.warn(`    ⚠️  TC file processed but booking ${bookingRef} not found in DB — marking as SKIPPED`)
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'SKIPPED', bookingRef, status: 'SKIPPED',
          errorMessage: 'TC file detected but booking could not be created (PDF without extractable text, or missing dates)',
        })
      }
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ❌ TC error [${bookingRef}]: ${msg}`)
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
        itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
        eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
      })
    }
  }

  if (pnlFile) {
    console.log(`    📊 PNL file: "${pnlFile.name}"`)
    try {
      const lines = await processPNLFile(driveId, pnlFile, bookingRef)
      result.pnlsUpdated += 1
      result.events.push({ ref: bookingRef, type: 'PNL', file: pnlFile.name })
      console.log(`    ✅ PNL UPDATED: ${bookingRef} (${lines} lines)`)
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
        itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
        eventType: 'PNL_PROCESSED', bookingRef, status: 'PROCESSED',
        rawData: JSON.stringify({ linesProcessed: lines }),
      })
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ❌ PNL error [${bookingRef}]: ${msg}`)
      await upsertOneDriveEvent({
        driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
        itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
        eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
      })
    }
  }

  // Log other files
  for (const f of files) {
    if (f === tcFile || f === pnlFile) continue
    if (f.name.toLowerCase().includes('agenda')) continue
    console.log(`    📎 Other file: "${f.name}"`)
    await upsertOneDriveEvent({
      driveType: cfg.key, itemId: f.id, itemName: f.name,
      itemPath: buildPath(f), webUrl: f.webUrl,
      eventType: 'FILE_DETECTED', bookingRef, status: 'PROCESSED',
    })
  }
}

async function processBookingFolderFromDelta(
  driveId:    string,
  folder:     DriveItem,
  bookingRef: string,
  files:      DriveItem[],
  cfg:        DriveConfig,
  result:     ScanResult,
): Promise<void> {
  const folderWebUrl = folder.webUrl

  await upsertOneDriveEvent({
    driveType: cfg.key, itemId: folder.id, itemName: folder.name,
    itemPath: buildPath(folder), webUrl: folderWebUrl,
    eventType: 'FOLDER_DETECTED', bookingRef, status: 'PROCESSED',
  })

  if (folderWebUrl) {
    await prisma.booking.updateMany({ where: { bookingRef }, data: { onedriveFolderUrl: folderWebUrl } })
    console.log(`    🔗 Folder URL saved to booking`)
  }

  await processTCAndPNL(driveId, files, bookingRef, cfg, result, folderWebUrl ?? undefined)
}

// ── Background poll runner (used by cron-scheduler) ──────────────────────────

let pollRunning = false
let lastPollAt: Date | null = null
let lastPollResult: { bookingsCreated: number; bookingsUpdated: number; pnlsUpdated: number; errors: number } | null = null

export function getOneDrivePollStatus() {
  return { pollRunning, lastPollAt, lastPollResult }
}

/**
 * Run one full poll cycle: delta scan + today's folder scan.
 * Guarded by a concurrency lock — won't start if already running.
 * Called by cron-scheduler.ts every few minutes on self-hosted servers.
 */
export async function runOneDrivePoll(): Promise<void> {
  if (pollRunning) {
    console.log('[OneDrive] Poll skipped — previous run still in progress')
    return
  }
  pollRunning = true
  const t0 = Date.now()
  console.log('\n╔══ [OneDrive][AUTO-POLL] Starting ══╗')
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'auto_onedrive_enabled' } })
    if (setting?.value !== 'true') {
      console.log('[OneDrive] Auto-poll disabled in settings — enable in Settings → AI Token Controls')
      return
    }

    const deltaResults = await scanAllDrives()
    const todayResults = await scanTodayAllDrives()

    // Merge
    const total = [...deltaResults, ...todayResults].reduce(
      (acc, r) => ({
        bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
        bookingsUpdated: acc.bookingsUpdated + r.bookingsUpdated,
        pnlsUpdated:     acc.pnlsUpdated     + r.pnlsUpdated,
        errors:          acc.errors          + r.errors,
      }),
      { bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0 },
    )

    lastPollAt     = new Date()
    lastPollResult = total
    const elapsed  = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`╚══ [OneDrive][AUTO-POLL] Done in ${elapsed}s — created:${total.bookingsCreated} updated:${total.bookingsUpdated} pnls:${total.pnlsUpdated} errors:${total.errors} ══╝\n`)

    // Persist timestamp for admin page status
    await prisma.systemSetting.upsert({
      where:  { key: 'onedrive_last_poll' },
      update: { value: lastPollAt.toISOString() },
      create: { key: 'onedrive_last_poll', value: lastPollAt.toISOString() },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OneDrive][AUTO-POLL] Fatal error:', msg)
    await prisma.systemSetting.upsert({
      where:  { key: 'onedrive_poll_last_error' },
      update: { value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
      create: { key: 'onedrive_poll_last_error', value: `${new Date().toISOString()} | ${msg.slice(0, 500)}` },
    }).catch(() => {})
  } finally {
    pollRunning = false
  }
}

/** Scan all configured drives and return combined results. */
export async function scanAllDrives(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  for (const cfg of DRIVE_CONFIGS) {
    try {
      const r = await scanDrive(cfg)
      results.push(r)
    } catch (err) {
      console.error(`[OneDrive] scanAllDrives error for ${cfg.key}:`, err)
      results.push({
        driveKey: cfg.key, label: cfg.label,
        scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0,
        errors: 1, events: [],
      })
    }
  }
  return results
}

/**
 * Scan only today's month folder across all drives, skipping files already
 * processed in the last 30 minutes (so delta + today-scan don't double-process).
 */
export async function scanTodayAllDrives(): Promise<ScanResult[]> {
  const today   = new Date()
  const results: ScanResult[] = []
  console.log(`\n═══ [OneDrive][TODAY-SCAN] ${today.toISOString().slice(0, 10)} ═══`)
  for (const cfg of DRIVE_CONFIGS) {
    try {
      const r = await scanDriveByDateRange(cfg, today, today, 30)
      results.push(r)
    } catch (err) {
      console.error(`[OneDrive][TODAY-SCAN] ${cfg.key} error:`, err)
      results.push({
        driveKey: cfg.key, label: cfg.label,
        scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0,
        errors: 1, events: [],
      })
    }
  }
  return results
}

// ── TC processing ─────────────────────────────────────────────────────────────

async function processTCFile(
  driveId:     string,
  item:        DriveItem,
  bookingRef:  string,
  country:     OperationCountry,
  folderUrl?:  string,
): Promise<{ isNew: boolean }> {
  console.log(`[OneDrive] Processing TC: ${item.name} → ${bookingRef}`)

  if (/\.pdf$/i.test(item.name)) {
    // PDF TC files can't be parsed without a PDF text extractor — just ensure folder URL is stored
    const existing = await prisma.booking.findUnique({ where: { bookingRef } })
    if (existing && folderUrl) {
      await prisma.booking.update({ where: { bookingRef }, data: { onedriveFolderUrl: folderUrl } })
    }
    console.log(`[OneDrive] ${bookingRef}: TC is PDF — skipped text extraction`)
    return { isNew: false }
  }

  const buffer = await downloadDriveItem(driveId, item.id)
  const text   = await extractTextFromDocx(buffer)

  const extracted = await extractBookingFromEmail(text, 'TOUR_CONFIRMATION')

  // Override booking ref with the folder name ref (more reliable)
  if (bookingRef) extracted.bookingRef = bookingRef

  if (!extracted.arrivalDate || !extracted.departureDate) {
    // Try to get dates from the booking if it already exists
    const existing = await prisma.booking.findUnique({ where: { bookingRef } })
    if (!existing) throw new Error(`TC file for ${bookingRef} has no arrival/departure dates`)
    // Update without dates if booking already exists
    await prisma.booking.update({
      where: { bookingRef },
      data: {
        onedriveFolderUrl: folderUrl ?? undefined,
        ...(extracted.agent && { agent: extracted.agent }),
        ...(extracted.isNumber && { isNumber: extracted.isNumber }),
        ...(extracted.dealName && { dealName: extracted.dealName }),
        ...(extracted.tourDestination && { tourDestination: extracted.tourDestination }),
      },
    })
    return { isNew: false }
  }

  const createdById = await getAutomationUserId()
  const existing    = await prisma.booking.findUnique({ where: { bookingRef } })
  const isNew       = !existing

  // Singapore & Malaysia share one physical OneDrive; the SG/MY sub-folder (in the
  // folder URL) plus the booking-ref prefix tell them apart. Fall back to the
  // drive config country only if neither signal is present.
  const detectedCountry =
    detectCountryFromRef(bookingRef) ?? detectCountryFromPath(folderUrl) ?? country

  const commonData = {
    agentBookingId:    extracted.agentBookingId    ?? undefined,
    agent:             extracted.agent             ?? 'Unknown Agent',
    fileHandler:       extracted.fileHandler       ?? undefined,
    arrivalDate:       new Date(extracted.arrivalDate),
    departureDate:     new Date(extracted.departureDate),
    paxAdults:         extracted.paxAdults,
    paxChildren:       extracted.paxChildren,
    quotedTotal:       extracted.quotedTotal       ?? 0,
    currency:          extracted.currency          ?? 'USD',
    terms:             extracted.terms             ?? undefined,
    exclusions:        extracted.exclusions        ?? undefined,
    agentEmail:        extracted.agentEmail        ?? undefined,
    agentPhone:        extracted.agentPhone        ?? undefined,
    agentWhatsapp:     extracted.agentWhatsapp     ?? undefined,
    agentCountry:      extracted.agentCountry      ?? undefined,
    agentAddress:      extracted.agentAddress      ?? undefined,
    contactEmail:      extracted.contactEmail      ?? undefined,
    contactPhone:      extracted.contactPhone      ?? undefined,
    contactWhatsapp:   extracted.contactWhatsapp   ?? undefined,
    contactCountry:    extracted.contactCountry    ?? undefined,
    contactAddress:    extracted.contactAddress    ?? undefined,
    operationCountry:  detectedCountry,
    isNumber:          extracted.isNumber          ?? undefined,
    dealName:          extracted.dealName          ?? undefined,
    tourDestination:   extracted.tourDestination   ?? undefined,
    chauffeurContact:  extracted.chauffeurContact  ?? undefined,
    languagePreference: extracted.languagePreference ?? undefined,
    specialOccasions:  extracted.specialOccasions  ?? undefined,
    checkedBy:         extracted.checkedBy         ?? undefined,
    reconfirmBy:       extracted.reconfirmBy       ?? undefined,
    sourceDocName:     item.name,
    sourceDocUrl:      item.webUrl                 ?? undefined,
    onedriveFolderUrl: folderUrl                   ?? undefined,
    status:            'GT_REVIEW' as const,
  }

  let booking: { id: string }
  if (isNew) {
    booking = await prisma.booking.create({
      data: { ...commonData, bookingRef, createdById },
    })
  } else {
    booking = await prisma.booking.update({
      where: { bookingRef },
      data:  commonData,
    })
  }

  // Replace passengers / flights / hotels / itinerary
  await replaceBookingChildren(booking.id, extracted)

  // Generate agenda (skip if one already exists)
  const agendaItems = await upsertAgenda(booking.id, bookingRef, extracted, !isNew)

  await logActivity({
    userId: createdById,
    action: isNew ? ACTION.BOOKING_CREATED : ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'onedrive', file: item.name, bookingRef, agendaItems },
  })

  console.log(`[OneDrive] ${bookingRef}: ${isNew ? 'CREATED' : 'UPDATED'} (${agendaItems} agenda items)`)
  return { isNew }
}

// ── PNL processing ────────────────────────────────────────────────────────────

type ParsedPNL = Awaited<ReturnType<typeof parsePNLXlsx>>

async function aiParsePNLText(text: string, bookingRef: string): Promise<ParsedPNL> {
  const aiResult = await extractPNLFromText(text, bookingRef)
  const rawLines = Array.isArray(aiResult.lineItems)
    ? (aiResult.lineItems as Record<string, unknown>[])
    : []
  return {
    bookingRef,
    paxAdults:   typeof aiResult.paxAdults   === 'number' ? aiResult.paxAdults   : 0,
    paxChildren: typeof aiResult.paxChildren === 'number' ? aiResult.paxChildren : 0,
    lineItems: rawLines
      .map(l => ({
        activity:   String(l.activity   ?? ''),
        category:   String(l.category   ?? 'OTHER'),
        mmtRate:    Number(l.mmtRate    ?? 0),
        sicRate:    Number(l.sicRate    ?? 0),
        pvtRatePP:  Number(l.pvtRatePP  ?? 0),
        adEntrance: Number(l.adEntrance ?? 0),
        chEntrance: Number(l.chEntrance ?? 0),
        otherRate:  Number(l.otherRate  ?? 0),
      }))
      .filter(l => l.activity && (l.mmtRate || l.sicRate || l.pvtRatePP || l.adEntrance || l.otherRate)),
  }
}

async function processPNLFile(
  driveId:    string,
  item:       DriveItem,
  bookingRef: string,
): Promise<number> {
  console.log(`[OneDrive] Processing PNL: ${item.name} → ${bookingRef}`)

  const buffer = await downloadDriveItem(driveId, item.id)

  // Check if AI PNL extraction is enabled (default: true)
  const pnlExtractSetting = await prisma.systemSetting.findUnique({ where: { key: 'ai_pnl_auto_extract' } })
  const pnlAIExtractEnabled = pnlExtractSetting?.value !== 'false'

  let parsed: Awaited<ReturnType<typeof parsePNLXlsx>>

  if (/\.pdf$/i.test(item.name)) {
    if (!pnlAIExtractEnabled) {
      console.log(`[OneDrive] ${bookingRef}: AI PNL extraction disabled — skipping PDF PNL`)
      return 0
    }
    console.log(`[OneDrive] ${bookingRef}: PNL is PDF — extracting text then AI`)
    const pdfData = await pdfParse(buffer)
    const text    = pdfData.text
    if (!text || text.trim().length < 20) {
      console.warn(`[OneDrive] ${bookingRef}: PDF PNL has no extractable text (scanned image?)`)
      return 0
    }
    parsed = await aiParsePNLText(text, bookingRef)
    console.log(`[OneDrive] ${bookingRef}: PDF PNL → ${parsed.lineItems.length} lines via AI`)

  } else if (/\.docx?$/i.test(item.name)) {
    if (!pnlAIExtractEnabled) {
      console.log(`[OneDrive] ${bookingRef}: AI PNL extraction disabled — skipping Word PNL`)
      return 0
    }
    console.log(`[OneDrive] ${bookingRef}: PNL is Word doc — extracting text then AI`)
    const text = await extractTextFromDocx(buffer)
    if (!text || text.trim().length < 20) {
      console.warn(`[OneDrive] ${bookingRef}: Word PNL has no extractable text`)
      return 0
    }
    parsed = await aiParsePNLText(text, bookingRef)
    console.log(`[OneDrive] ${bookingRef}: Word PNL → ${parsed.lineItems.length} lines via AI`)

  } else {
    // Excel / CSV / other: try structured parser, fall back gracefully
    try {
      parsed = parsePNLXlsx(buffer)
      console.log(`[OneDrive] ${bookingRef}: Excel/CSV PNL → ${parsed.lineItems.length} lines`)
    } catch {
      console.warn(`[OneDrive] ${bookingRef}: "${item.name}" is not xlsx-parseable — stored as document reference only`)
      return 0
    }
  }

  // Find existing booking — try exact ref, then numeric suffix fallback
  let booking = await prisma.booking.findUnique({ where: { bookingRef } })
  if (!booking) {
    const numeric = bookingRef.replace(/[^0-9]/g, '')
    if (numeric.length >= 4) {
      booking = await prisma.booking.findFirst({
        where: { bookingRef: { endsWith: numeric } },
        orderBy: { createdAt: 'desc' },
      }) ?? null
    }
  }
  if (!booking) {
    throw new Error(`No booking found for PNL ref "${bookingRef}"`)
  }

  let lines = parsed.lineItems.map(l => ({ ...l }))
  const paxAdults   = parsed.paxAdults   || booking.paxAdults
  const paxChildren = parsed.paxChildren || booking.paxChildren

  // AI category classification (respects ai_pnl_auto_classify setting)
  if (lines.length > 0 && process.env.OPENAI_API_KEY) {
    const classifySetting = await prisma.systemSetting.findUnique({ where: { key: 'ai_pnl_auto_classify' } })
    if (classifySetting?.value !== 'false') {
      try {
        const cats = await classifyPNLCategories(lines.map(l => l.activity))
        lines = lines.map((l, i) => ({ ...l, category: cats[i] ?? l.category }))
      } catch { /* keep existing categories */ }
    } else {
      console.log(`[OneDrive] ${bookingRef}: AI PNL classify disabled — keeping keyword categories`)
    }
  }

  let pnl = await prisma.pNL.findUnique({ where: { bookingId: booking.id } })
  if (!pnl) {
    pnl = await prisma.pNL.create({ data: { bookingId: booking.id, paxAdults, paxChildren } })
  } else {
    pnl = await prisma.pNL.update({ where: { id: pnl.id }, data: { paxAdults, paxChildren } })
  }

  await prisma.pNLLineItem.deleteMany({ where: { pnlId: pnl.id } })

  const TICKETABLE = new Set(['HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES', 'FLIGHT_TICKETS'])
  const createdLines: { id: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const created = await prisma.pNLLineItem.create({
      data: {
        pnlId:      pnl.id,
        activity:   line.activity,
        category:   line.category as never,
        mmtRate:    line.mmtRate,
        sicRate:    line.sicRate,
        pvtRatePP:  line.pvtRatePP,
        adEntrance: line.adEntrance,
        chEntrance: line.chEntrance,
        otherRate:  line.otherRate,
        sortOrder:  i,
      },
    })
    createdLines.push(created)

    if (TICKETABLE.has(line.category)) {
      await prisma.ticket.create({
        data: {
          bookingId: booking.id,
          pnlLineId: created.id,
          type:      line.activity,
          qty:       paxAdults + paxChildren,
          currency:  booking.currency ?? 'USD',
          status:    'DRAFT',
          activated: false,
        },
      })
    }
  }

  if (booking.status === 'DRAFT') {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'GT_REVIEW' } })
  }

  const createdById = await getAutomationUserId()
  await logActivity({
    userId: createdById,
    action: ACTION.BOOKING_UPDATED,
    entityType: 'Booking',
    entityId:   booking.id,
    details:    { source: 'onedrive', file: item.name, bookingRef, pnlLines: createdLines.length },
  })

  console.log(`[OneDrive] ${bookingRef}: PNL updated — ${createdLines.length} lines`)
  return createdLines.length
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getAutomationUserId(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' }, select: { id: true } })
  if (u) return u.id
  const bt = await prisma.user.findFirst({ where: { role: 'BT_USER' }, select: { id: true } })
  if (bt) return bt.id
  throw new Error('No automation user found (need SUPER_ADMIN or BT_USER)')
}

function buildPath(item: DriveItem): string {
  return item.parentReference?.path
    ? `${item.parentReference.path}/${item.name}`
    : item.name
}

async function replaceBookingChildren(
  bookingId: string,
  extracted: Awaited<ReturnType<typeof extractBookingFromEmail>>,
) {
  await prisma.passenger.deleteMany({ where: { bookingId } })
  await prisma.flight.deleteMany({ where: { bookingId } })
  await prisma.accommodation.deleteMany({ where: { bookingId } })
  await prisma.itineraryItem.deleteMany({ where: { bookingId } })
  await prisma.emergencyContact.deleteMany({ where: { bookingId } })

  if (extracted.passengers.length > 0) {
    await prisma.passenger.createMany({
      data: extracted.passengers.map(p => ({
        bookingId,
        name: p.name,
        type: (p.type === 'CHILD' ? 'CHILD' : 'ADULT') as 'ADULT' | 'CHILD',
        isLead: p.isLead ?? false,
      })),
    })
  }
  if (extracted.flights.length > 0) {
    await prisma.flight.createMany({
      data: extracted.flights.map(f => ({
        bookingId,
        flightNo: f.flightNo,
        date: new Date(f.date),
        fromApt: f.fromApt,
        depTime: f.depTime ?? '',
        toApt: f.toApt,
        arrTime: f.arrTime ?? '',
        airline: f.airline ?? null,
      })),
    })
  }
  if (extracted.accommodations.length > 0) {
    await prisma.accommodation.createMany({
      data: extracted.accommodations.map(a => ({
        bookingId,
        hotel: a.hotel,
        city: a.city,
        checkIn: new Date(a.checkIn),
        checkOut: new Date(a.checkOut),
        nights: a.nights,
        roomType: a.roomType ?? null,
        mealType: a.mealType ?? null,
      })),
    })
  }
  if (extracted.itineraryItems.length > 0) {
    await prisma.itineraryItem.createMany({
      data: extracted.itineraryItems.map(item => ({
        bookingId,
        dayNo: item.dayNo,
        date: new Date(item.date),
        title: item.title,
        description: item.description ?? null,
      })),
    })
  }
}

type OneDriveEventInput = {
  driveType:    string
  itemId:       string
  itemName:     string
  itemPath:     string
  webUrl?:      string | null
  eventType:    'FOLDER_DETECTED' | 'TC_PROCESSED' | 'PNL_PROCESSED' | 'FILE_DETECTED' | 'ERROR' | 'SKIPPED'
  bookingRef?:  string
  status:       'PENDING' | 'PROCESSED' | 'ERROR' | 'SKIPPED'
  errorMessage?: string
  rawData?:      string
}

// Returns true if the file was already successfully processed within `withinMinutes`.
// Used to avoid re-running expensive AI extraction on the same file twice in one cron cycle.
async function wasRecentlyProcessed(itemId: string, withinMinutes: number): Promise<boolean> {
  if (withinMinutes <= 0) return false
  const since = new Date(Date.now() - withinMinutes * 60 * 1000)
  const ev = await prisma.oneDriveEvent.findFirst({
    where: {
      itemId,
      eventType: { in: ['TC_PROCESSED', 'PNL_PROCESSED'] },
      status: 'PROCESSED',
      createdAt: { gte: since },
    },
    select: { id: true },
  })
  return ev !== null
}

async function upsertOneDriveEvent(input: OneDriveEventInput): Promise<void> {
  const existing = await prisma.oneDriveEvent.findFirst({
    where: { itemId: input.itemId, eventType: input.eventType },
  })
  if (existing) {
    await prisma.oneDriveEvent.update({
      where: { id: existing.id },
      data: {
        status:       input.status,
        processedAt:  new Date(),
        errorMessage: input.errorMessage ?? null,
        rawData:      input.rawData      ?? null,
        bookingRef:   input.bookingRef   ?? null,
      },
    })
  } else {
    await prisma.oneDriveEvent.create({
      data: {
        driveType:    input.driveType,
        itemId:       input.itemId,
        itemName:     input.itemName,
        itemPath:     input.itemPath,
        webUrl:       input.webUrl       ?? null,
        eventType:    input.eventType,
        bookingRef:   input.bookingRef   ?? null,
        status:       input.status,
        errorMessage: input.errorMessage ?? null,
        rawData:      input.rawData      ?? null,
        processedAt:  input.status !== 'PENDING' ? new Date() : null,
      },
    })
  }
}

/** Get all OneDrive files linked to a booking ref from the event log. */
export async function getBookingOneDriveFiles(bookingRef: string) {
  const ref = normalizeBookingRef(bookingRef)
  return prisma.oneDriveEvent.findMany({
    where: { bookingRef: ref, status: 'PROCESSED', eventType: { not: 'ERROR' } },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Resolve the drive ID + folder item ID for a booking's OneDrive folder.
 * Looks up the FOLDER_DETECTED OneDriveEvent row, then resolves the drive ID
 * for that drive config so callers can list/download files.
 */
export async function resolveBookingDriveFolder(bookingRef: string): Promise<{
  driveId: string
  folderId: string
  driveKey: string
  folderUrl: string | null
} | null> {
  const event = await prisma.oneDriveEvent.findFirst({
    where:   { bookingRef, eventType: 'FOLDER_DETECTED' },
    orderBy: { createdAt: 'desc' },
  })
  if (!event) return null

  const cfg = DRIVE_CONFIGS.find(c => c.key === event.driveType)
  if (!cfg) return null

  try {
    const driveId = await resolveDriveId(cfg)
    return { driveId, folderId: event.itemId, driveKey: cfg.key, folderUrl: event.webUrl ?? null }
  } catch {
    return null
  }
}

/** Get the OneDrive folder URL stored on the booking. */
export async function getBookingFolderUrl(bookingRef: string): Promise<string | null> {
  const ref = normalizeBookingRef(bookingRef)
  const b = await prisma.booking.findUnique({
    where:  { bookingRef: ref },
    select: { onedriveFolderUrl: true },
  })
  return b?.onedriveFolderUrl ?? null
}

// ── Date-range targeted scan ──────────────────────────────────────────────────

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

/** Derive (year, monthIndex) pairs covered by a date range. */
function monthsInRange(from: Date, to: Date): { year: number; month: number }[] {
  const pairs: { year: number; month: number }[] = []
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  const end = new Date(to.getFullYear(),   to.getMonth(),   1)
  while (cur <= end) {
    pairs.push({ year: cur.getFullYear(), month: cur.getMonth() })
    cur.setMonth(cur.getMonth() + 1)
  }
  return pairs
}

/**
 * Scan a drive for booking folders that fall within a specific date range.
 * Walks Year → Month → [Date subfolder] → BookingFolder directly
 * without relying on delta tokens — useful for re-processing or backfills.
 */
export async function scanDriveByDateRange(
  cfg:          DriveConfig,
  dateFrom:     Date,
  dateTo:       Date,
  dedupMinutes: number = 0,
): Promise<ScanResult> {
  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
  } catch (err) {
    console.error(`[OneDrive] ${cfg.key}: drive ID resolve error:`, err)
    result.errors += 1
    return result
  }

  const rootPath = cfg.type === 'personal' ? (cfg.rootFolder ?? undefined) : (cfg.rootFolder_sp ?? undefined)
  const months   = monthsInRange(dateFrom, dateTo)

  for (const { year, month } of months) {
    const monthName  = MONTH_NAMES[month]
    const monthPath  = rootPath ? `${rootPath}/${year}/${monthName}` : `${year}/${monthName}`

    let monthChildren: DriveItem[]
    try {
      monthChildren = await listFolderChildren(driveId, monthPath)
    } catch {
      console.warn(`[OneDrive] ${cfg.key}: folder not found: ${monthPath}`)
      continue
    }

    // Each child is either a booking folder directly (SL) or a date subfolder (VN)
    for (const child of monthChildren) {
      result.scanned += 1

      if (child.folder && isBookingFolder(child)) {
        // Direct booking folder (SL-style)
        await processBookingFolderDirect(driveId, child, cfg, result, dedupMinutes)
      } else if (child.folder) {
        // Possible date subfolder (e.g. "02 June") — recurse one level
        let dateChildren: DriveItem[]
        try {
          dateChildren = await listFolderChildren(driveId, `${monthPath}/${child.name}`)
        } catch {
          continue
        }
        for (const dc of dateChildren) {
          result.scanned += 1
          if (dc.folder && isBookingFolder(dc)) {
            await processBookingFolderDirect(driveId, dc, cfg, result, dedupMinutes)
          }
        }
      }
    }
  }

  return result
}

/**
 * Search for a specific booking ref in a drive and process its files.
 * Uses Graph search API to locate the folder regardless of Year/Month position.
 */
export async function scanBookingRefInDrive(
  cfg:        DriveConfig,
  bookingRef: string,
): Promise<ScanResult> {
  const result: ScanResult = {
    driveKey: cfg.key, label: cfg.label,
    scanned: 0, bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0,
    events: [],
  }

  let driveId: string
  try {
    driveId = await resolveDriveId(cfg)
  } catch (err) {
    result.errors += 1
    console.error(`[OneDrive] ${cfg.key}: drive resolve error:`, err)
    return result
  }

  let searchResults: DriveItem[]
  try {
    searchResults = await searchDriveItems(driveId, bookingRef)
  } catch (err) {
    result.errors += 1
    console.error(`[OneDrive] ${cfg.key}: search error for ${bookingRef}:`, err)
    return result
  }

  // Find the folder whose name starts with the booking ref
  const folder = searchResults.find(
    i => i.folder && extractRefFromFolderName(i.name) === bookingRef.toUpperCase(),
  )

  if (!folder) {
    console.warn(`[OneDrive] ${cfg.key}: folder not found for ref ${bookingRef}`)
    return result
  }

  result.scanned += 1
  await processBookingFolderDirect(driveId, folder, cfg, result)
  return result
}

// ── Shared booking-folder processor (used by both date-range and ref scan) ────

async function processBookingFolderDirect(
  driveId:      string,
  folder:       DriveItem,
  cfg:          DriveConfig,
  result:       ScanResult,
  dedupMinutes: number = 0,
): Promise<void> {
  const bookingRef = extractRefFromFolderName(folder.name)
  if (!bookingRef) return

  // List files by folder ID — works for both personal OneDrive and SharePoint without path issues
  let files: DriveItem[]
  try {
    files = await listItemChildren(driveId, folder.id)
    console.log(`    📂 Listed ${files.length} file(s) in "${folder.name}" (id: ${folder.id.slice(0, 12)}…)`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`    ❌ Failed to list folder contents for "${folder.name}": ${msg}`)
    files = []
  }

  const folderWebUrl = folder.webUrl
  await upsertOneDriveEvent({
    driveType: cfg.key, itemId: folder.id, itemName: folder.name,
    itemPath: buildPath(folder), webUrl: folderWebUrl,
    eventType: 'FOLDER_DETECTED', bookingRef, status: 'PROCESSED',
  })

  if (folderWebUrl) {
    await prisma.booking.updateMany({ where: { bookingRef }, data: { onedriveFolderUrl: folderWebUrl } })
  }

  const tcFile  = files.find(f => f.file && isTCFile(f.name))
  const pnlFile = files.find(f => f.file && isPNLFile(f.name) && !f.name.toLowerCase().includes('agenda'))

  if (tcFile) {
    if (await wasRecentlyProcessed(tcFile.id, dedupMinutes)) {
      console.log(`    ⏭  TC skipped (processed <${dedupMinutes}m ago): "${tcFile.name}"`)
    } else {
      try {
        const r = await processTCFile(driveId, tcFile, bookingRef, cfg.country, folderWebUrl)
        if (r.isNew) result.bookingsCreated += 1; else result.bookingsUpdated += 1
        result.events.push({ ref: bookingRef, type: 'TC', file: tcFile.name })
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'TC_PROCESSED', bookingRef, status: 'PROCESSED',
        })
      } catch (err) {
        result.errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: tcFile.id, itemName: tcFile.name,
          itemPath: buildPath(tcFile), webUrl: tcFile.webUrl,
          eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
        })
      }
    }
  }

  if (pnlFile) {
    if (await wasRecentlyProcessed(pnlFile.id, dedupMinutes)) {
      console.log(`    ⏭  PNL skipped (processed <${dedupMinutes}m ago): "${pnlFile.name}"`)
    } else {
      try {
        const lines = await processPNLFile(driveId, pnlFile, bookingRef)
        result.pnlsUpdated += 1
        result.events.push({ ref: bookingRef, type: 'PNL', file: pnlFile.name })
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
          itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
          eventType: 'PNL_PROCESSED', bookingRef, status: 'PROCESSED',
          rawData: JSON.stringify({ linesProcessed: lines }),
        })
      } catch (err) {
        result.errors += 1
        const msg = err instanceof Error ? err.message : String(err)
        await upsertOneDriveEvent({
          driveType: cfg.key, itemId: pnlFile.id, itemName: pnlFile.name,
          itemPath: buildPath(pnlFile), webUrl: pnlFile.webUrl,
          eventType: 'ERROR', bookingRef, status: 'ERROR', errorMessage: msg,
        })
      }
    }
  }

  // Other files
  for (const f of files) {
    if (f === tcFile || f === pnlFile || !f.file) continue
    if (f.name.toLowerCase().includes('agenda')) continue
    await upsertOneDriveEvent({
      driveType: cfg.key, itemId: f.id, itemName: f.name,
      itemPath: buildPath(f), webUrl: f.webUrl,
      eventType: 'FILE_DETECTED', bookingRef, status: 'PROCESSED',
    })
  }
}


function normalizeBookingRef(ref: string) {
  return ref.trim().toUpperCase()
}
