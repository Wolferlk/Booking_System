/**
 * Cron endpoint — polls all configured OneDrive/SharePoint drives for changes.
 *
 * Call this every 5–15 minutes via an external scheduler (Vercel cron, GCP scheduler, etc.)
 * or from the admin page.
 *
 * Secured by ONEDRIVE_POLL_SECRET header (same pattern as the mail webhook).
 */
import { NextRequest, NextResponse } from 'next/server'
import { scanAllDrives, scanTodayAllDrives } from '@/lib/onedrive-monitor'
import { prisma } from '@/lib/prisma'

export const dynamic   = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

function isAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-onedrive-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret && secret === process.env.ONEDRIVE_POLL_SECRET) return true
  // Vercel cron sends Authorization: Bearer {CRON_SECRET}
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized()

  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: 'auto_onedrive_enabled' } })
    if (setting?.value === 'false') {
      return NextResponse.json({ ok: true, skipped: true, message: 'Auto OneDrive processing is disabled in settings' })
    }

    // Pass 1 — delta sync: incremental, only new/changed items since last run
    const deltaResults = await scanAllDrives()

    // Pass 2 — today's folder scan: walks current month folders as a safety net.
    // Files already processed by delta in the last 30 min are skipped (dedup).
    const todayResults = await scanTodayAllDrives()

    // Merge per-drive results
    const results = deltaResults.map(d => {
      const t = todayResults.find(r => r.driveKey === d.driveKey)
      return t ? {
        ...d,
        scanned:         d.scanned         + t.scanned,
        bookingsCreated: d.bookingsCreated  + t.bookingsCreated,
        bookingsUpdated: d.bookingsUpdated  + t.bookingsUpdated,
        pnlsUpdated:     d.pnlsUpdated      + t.pnlsUpdated,
        errors:          d.errors           + t.errors,
        events:          [...d.events,       ...t.events],
      } : d
    })

    const total = results.reduce(
      (acc, r) => ({
        bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
        bookingsUpdated: acc.bookingsUpdated + r.bookingsUpdated,
        pnlsUpdated:     acc.pnlsUpdated     + r.pnlsUpdated,
        errors:          acc.errors          + r.errors,
      }),
      { bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0 },
    )

    return NextResponse.json({ ok: true, results, total, scannedAt: new Date().toISOString() })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[OneDrive cron] fatal error:', msg)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// Allow GET for simple health/cron-ping check with secret query param
export async function GET(req: NextRequest) {
  return POST(req)
}
