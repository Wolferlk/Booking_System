/**
 * Cron endpoint — VN Vendor Sync (Excel checklist → movement Tour Vendor).
 *
 * RETIRED 2026-11-12: the desk does not want tour vendors filled from the
 * Excel checklist. Movements now get their DRIVER from the VN team's Movement
 * Chart — /api/cron/vn-driver-sync. This route stays so an external pinger
 * that still calls it gets a clear answer instead of a 404, and runs nothing.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const retired = () => NextResponse.json({ ok: true, skipped: 'VN Vendor Sync is retired — point the pinger at /api/cron/vn-driver-sync' })

export const GET = retired
export const POST = retired
