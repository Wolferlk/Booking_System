/**
 * Cron endpoint — polls all configured OneDrive/SharePoint drives for changes.
 *
 * Call this every 5–15 minutes via an external scheduler (Vercel cron, GCP scheduler, etc.)
 * or from the admin page.
 *
 * Secured by ONEDRIVE_POLL_SECRET header (same pattern as the mail webhook).
 */
import { NextRequest, NextResponse } from 'next/server'
import { scanAllDrives } from '@/lib/onedrive-monitor'

export const dynamic   = 'force-dynamic'
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-onedrive-secret') ?? req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.ONEDRIVE_POLL_SECRET) return unauthorized()

  try {
    const results = await scanAllDrives()
    const total = results.reduce(
      (acc, r) => ({
        bookingsCreated: acc.bookingsCreated + r.bookingsCreated,
        bookingsUpdated: acc.bookingsUpdated + r.bookingsUpdated,
        pnlsUpdated:     acc.pnlsUpdated     + r.pnlsUpdated,
        errors:          acc.errors          + r.errors,
      }),
      { bookingsCreated: 0, bookingsUpdated: 0, pnlsUpdated: 0, errors: 0 },
    )

    return NextResponse.json({ ok: true, results, total })
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
