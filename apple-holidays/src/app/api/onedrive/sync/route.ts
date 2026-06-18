import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  scanAllDrives,
  scanDrive,
  scanDriveByDateRange,
  scanBookingRefInDrive,
  DRIVE_CONFIGS,
  type ScanResult,
} from '@/lib/onedrive-monitor'

export const dynamic    = 'force-dynamic'
export const maxDuration = 300

interface SyncBody {
  /** Run delta scan on a single drive. */
  driveKey?:  string
  /** Run delta scan on these drives (empty = all). */
  driveKeys?: string[]
  /** Date-range scan: ISO date strings */
  dateFrom?:  string
  dateTo?:    string
  /** Targeted booking-ref scan. */
  bookingRef?: string
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }

  const body = await req.json().catch(() => ({})) as SyncBody

  // ── 1. Targeted booking-ref scan ──────────────────────────────────────────
  if (body.bookingRef) {
    const ref   = body.bookingRef.trim().toUpperCase()
    const keys  = body.driveKeys?.length ? body.driveKeys : body.driveKey ? [body.driveKey] : DRIVE_CONFIGS.map(d => d.key)
    const cfgs  = DRIVE_CONFIGS.filter(d => keys.includes(d.key))
    if (!cfgs.length) return buildApiError('No matching drives for bookingRef scan', 400)

    const results: ScanResult[] = []
    for (const cfg of cfgs) {
      const r = await scanBookingRefInDrive(cfg, ref)
      results.push(r)
    }
    const found = results.some(r => r.bookingsCreated + r.bookingsUpdated + r.pnlsUpdated > 0)
    return buildApiSuccess(
      { results, bookingRef: ref },
      found ? `Processed ${ref}` : `Folder for ${ref} not found in selected drives`,
    )
  }

  // ── 2. Date-range scan ────────────────────────────────────────────────────
  if (body.dateFrom && body.dateTo) {
    const from  = new Date(body.dateFrom)
    const to    = new Date(body.dateTo)
    if (isNaN(from.getTime()) || isNaN(to.getTime())) return buildApiError('Invalid date range', 400)
    if (from > to) return buildApiError('dateFrom must be before dateTo', 400)

    const keys  = body.driveKeys?.length ? body.driveKeys : body.driveKey ? [body.driveKey] : DRIVE_CONFIGS.map(d => d.key)
    const cfgs  = DRIVE_CONFIGS.filter(d => keys.includes(d.key))
    if (!cfgs.length) return buildApiError('No matching drives', 400)

    const results: ScanResult[] = []
    for (const cfg of cfgs) {
      const r = await scanDriveByDateRange(cfg, from, to)
      results.push(r)
    }
    const total = sumResults(results)
    return buildApiSuccess({ results, total }, `Date-range scan complete`)
  }

  // ── 3. Delta scan (default) ───────────────────────────────────────────────
  const keys = body.driveKeys?.length ? body.driveKeys : body.driveKey ? [body.driveKey] : null

  if (keys) {
    const cfgs = DRIVE_CONFIGS.filter(d => keys.includes(d.key))
    if (!cfgs.length) return buildApiError('No matching drives', 400)
    const results: ScanResult[] = []
    for (const cfg of cfgs) {
      results.push(await scanDrive(cfg))
    }
    return buildApiSuccess({ results, total: sumResults(results) }, 'Delta scan complete')
  }

  const results = await scanAllDrives()
  return buildApiSuccess({ results, total: sumResults(results) }, 'All drives scanned')
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session.user.role)) {
    return buildApiError('Forbidden', 403)
  }
  return buildApiSuccess({ drives: DRIVE_CONFIGS.map(d => ({ key: d.key, label: d.label, country: d.country })) })
}

function sumResults(results: ScanResult[]) {
  return results.reduce(
    (acc, r) => ({
      bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
      bookingsUpdated: acc.bookingsUpdated + r.bookingsUpdated,
      pnlsUpdated:     acc.pnlsUpdated     + r.pnlsUpdated,
      errors:          acc.errors          + r.errors,
    }),
    { bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0 },
  )
}
