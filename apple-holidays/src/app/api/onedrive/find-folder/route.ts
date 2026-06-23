import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { resolveDriveByKey, DRIVE_CONFIGS } from '@/lib/onedrive-monitor'
import { listFolderChildren } from '@/lib/graph-client'
import type { DriveItem } from '@/lib/graph-client'

export const dynamic = 'force-dynamic'

// ─── Month name helpers ───────────────────────────────────────────────────────

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december']
const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

function monthVariants(monthIndex: number, num: number): string[] {
  const full  = MONTH_NAMES[monthIndex]
  const short = MONTH_SHORT[monthIndex]
  const pad   = String(num + 1).padStart(2, '0')
  return [
    full,                          // june
    short,                         // jun
    `${pad} ${full}`,              // 06 june
    `${pad} ${short}`,             // 06 jun
    `${pad}-${full}`,              // 06-june
    String(pad),                   // 06
  ]
}

function dayVariants(day: number, monthIndex: number): string[] {
  const full  = MONTH_NAMES[monthIndex]
  const short = MONTH_SHORT[monthIndex]
  return [
    String(day).padStart(2, '0'),            // 22
    String(day),                             // 22 (no pad)
    `${day} ${full}`,                        // 22 june
    `${day} ${short}`,                       // 22 jun
    `${String(day).padStart(2,'0')} ${full}`,// 22 june (padded)
    `${String(day).padStart(2,'0')} ${short}`,
  ]
}

function folderMatchesVariants(folderName: string, variants: string[]): boolean {
  const n = folderName.toLowerCase().trim()
  return variants.some(v => n === v.toLowerCase())
}

// ─── Fuzzy booking ref matcher ────────────────────────────────────────────────

/**
 * Returns a score 0-3 (higher = better match) for a folder name against booking identifiers.
 * 0 = no match, 1 = numeric ref found inside name, 2 = IS number / ref prefix, 3 = exact match
 */
function scoreFolder(folderName: string, identifiers: string[]): number {
  const n = folderName.toLowerCase().replace(/[\s\-_]/g, '')
  for (const id of identifiers) {
    if (!id) continue
    const idn = id.toLowerCase().replace(/[\s\-_]/g, '')
    if (n === idn) return 3
    if (n.startsWith(idn) || idn.startsWith(n)) return 2
    // Pure numeric part
    const numPart = idn.replace(/[^0-9]/g, '')
    if (numPart.length >= 4 && n.includes(numPart)) return 1
  }
  return 0
}

// ─── Path builder ─────────────────────────────────────────────────────────────

function buildCandidatePaths(
  rootFolder: string | undefined,
  year: number,
  monthIdx: number,
  day: number,
): string[] {
  const root = rootFolder ? `${rootFolder}/` : ''
  const months = monthVariants(monthIdx, monthIdx)
  const days   = dayVariants(day, monthIdx)
  const paths: string[] = []

  for (const m of months) {
    // 3-level: root/year/month/day
    for (const d of days) {
      paths.push(`${root}${year}/${m}/${d}`)
    }
    // 2-level: root/year/month (SL-style — no day subfolder)
    paths.push(`${root}${year}/${m}`)
  }
  return paths
}

// ─── Core search ─────────────────────────────────────────────────────────────

interface FolderMatch {
  name:     string
  webUrl:   string
  driveKey: string
  path:     string
  score:    number
}

async function tryPath(
  driveId:     string,
  driveKey:    string,
  folderPath:  string,
  identifiers: string[],
): Promise<{ match: FolderMatch | null; candidates: FolderMatch[]; navigatedPath: string }> {
  let children: DriveItem[]
  try {
    children = await listFolderChildren(driveId, folderPath)
  } catch {
    return { match: null, candidates: [], navigatedPath: folderPath }
  }

  const scored = children
    .filter(c => c.folder)
    .map(c => ({
      name:     c.name,
      webUrl:   c.webUrl,
      driveKey,
      path:     folderPath,
      score:    scoreFolder(c.name, identifiers),
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)

  return {
    match:         scored[0] ?? null,
    candidates:    scored,
    navigatedPath: folderPath,
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/onedrive/find-folder
 *   ?isNumber=MY23139
 *   &bookingRef=469182
 *   &agentBookingId=xxx
 *   &arrivalDate=2026-06-22
 *   &driveKey=MY          (optional: force a specific drive)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const sp           = req.nextUrl.searchParams
  const isNumber     = sp.get('isNumber')?.trim() ?? ''
  const bookingRef   = sp.get('bookingRef')?.trim() ?? ''
  const agentId      = sp.get('agentBookingId')?.trim() ?? ''
  const arrivalDate  = sp.get('arrivalDate')?.trim()
  const forcedKey    = sp.get('driveKey')?.toUpperCase()

  if (!arrivalDate) return buildApiError('arrivalDate is required', 400)

  const date      = new Date(arrivalDate)
  const year      = date.getFullYear()
  const monthIdx  = date.getMonth()  // 0-based
  const day       = date.getDate()

  const identifiers = [isNumber, bookingRef, agentId].filter(Boolean)

  // Determine which drives to check
  const drivesToCheck: string[] = forcedKey
    ? [forcedKey]
    : inferDriveKeys(isNumber)

  for (const driveKey of drivesToCheck) {
    const resolved = await resolveDriveByKey(driveKey)
    if (!resolved) continue

    const rootFolder = resolved.cfg.type === 'personal'
      ? (resolved.cfg.rootFolder ?? undefined)
      : (resolved.cfg.rootFolder_sp ?? undefined)

    const candidatePaths = buildCandidatePaths(rootFolder, year, monthIdx, day)

    for (const candidatePath of candidatePaths) {
      const { match, candidates, navigatedPath } = await tryPath(
        resolved.driveId, driveKey, candidatePath, identifiers,
      )
      if (match) {
        return buildApiSuccess({
          match,
          candidates,
          navigatedPath,
          driveKey,
        })
      }
    }
  }

  return buildApiSuccess({ match: null, candidates: [], navigatedPath: null, driveKey: drivesToCheck[0] ?? null })
}

/** Infer which OneDrive to search based on the IS number prefix. */
function inferDriveKeys(isNumber: string): string[] {
  const prefix = isNumber.replace(/\d+.*$/, '').toUpperCase()
  if (prefix === 'VN') return ['VN']
  if (prefix === 'IS') return ['SL']
  if (prefix === 'MY') return ['MY']
  if (prefix === 'SG') return ['SG']
  // Unknown — check all drives
  return DRIVE_CONFIGS.map(c => c.key)
}
