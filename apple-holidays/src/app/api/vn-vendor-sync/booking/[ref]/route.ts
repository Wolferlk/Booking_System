/**
 * VN Vendor Sync for one booking.
 *
 * GET  — what the sync matched for each movement, and the booking's log. A
 *        booking not looked at within the interval gets a quick match first
 *        (stored Excel copy, no download), and an overdue 15-minute sweep is
 *        started in the background.
 * POST — "Fetch now": read the Excel again (one Graph call if unchanged), then
 *        match and apply for this booking only.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { vendorSyncSession } from '@/lib/vn-vendor-sync/access'
import {
  bookingVendorSync, getVendorSyncConfig, isMissingTable, kickIfDue, runVendorSync,
} from '@/lib/vn-vendor-sync/server'
import { DEFAULT_DAYS_AHEAD, DEFAULT_INTERVAL_MIN, type BookingVendorSyncPayload } from '@/lib/vn-vendor-sync/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const notInstalled = (canEdit: boolean): BookingVendorSyncPayload => ({
  installed: false, canEdit, onSheet: false, tourCodes: [], links: [], events: [], lastRun: null,
  sheetSyncedAt: null, nextRunAt: null,
  config: { mode: 'AUTO', intervalMin: DEFAULT_INTERVAL_MIN, daysAhead: DEFAULT_DAYS_AHEAD },
})

async function isVietnamBooking(ref: string): Promise<boolean> {
  const b = await prisma.booking.findUnique({ where: { bookingRef: ref }, select: { operationCountry: true } })
  return b?.operationCountry === 'VIETNAM'
}

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await vendorSyncSession('read')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const ref = decodeURIComponent(params.ref).trim().toUpperCase()
  try {
    if (!await isVietnamBooking(ref)) return buildApiError('VN Vendor Sync is for Vietnam bookings', 400)
    const config = await getVendorSyncConfig()
    if (config.mode !== 'OFF') {
      const freshest = await prisma.vnVendorSyncLink.findFirst({ where: { bookingRef: ref }, orderBy: { lastSeenAt: 'desc' }, select: { lastSeenAt: true } })
      if (!freshest || Date.now() - freshest.lastSeenAt.getTime() > config.intervalMin * 60_000) {
        await runVendorSync({ trigger: 'STALE', bookingRef: ref, refreshSheet: false })
      }
      void kickIfDue()
    }
    return buildApiSuccess(await bookingVendorSync(ref, auth.canEdit))
  } catch (err) {
    if (isMissingTable(err)) return buildApiSuccess(notInstalled(auth.canEdit))
    return buildApiError(err instanceof Error ? err.message : 'Could not load the vendor sync', 500)
  }
}

export async function POST(_req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await vendorSyncSession('edit')
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const ref = decodeURIComponent(params.ref).trim().toUpperCase()
  try {
    if (!await isVietnamBooking(ref)) return buildApiError('VN Vendor Sync is for Vietnam bookings', 400)
    const run = await runVendorSync({ trigger: 'MANUAL', bookingRef: ref, triggeredBy: auth.actor })
    const data = await bookingVendorSync(ref, auth.canEdit)
    return buildApiSuccess({ run, ...data })
  } catch (err) {
    if (isMissingTable(err)) return buildApiError('VN Vendor Sync is not set up on this database yet — run prisma/sql/apply-vn-vendor-sync.sh', 503)
    return buildApiError(err instanceof Error ? err.message : 'Fetch failed', 500)
  }
}
