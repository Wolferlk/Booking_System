/**
 * Checklist VN 2.1v for one booking: its tour block(s) from the desk's Excel,
 * as of the last sync. Reading a stale mirror (older than the interval) starts
 * a background sync, so the next load is fresh even where no timer runs.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { checklistSession } from '@/lib/vn-checklist/access'
import { toursForBooking } from '@/lib/vn-checklist-sheet/read'
import {
  getSheetConfig, isMissingTable, isSyncInFlight, lastGoodSyncAt, lastSync, refreshIfStale,
} from '@/lib/vn-checklist-sheet/sync'
import type { BookingSheetPayload } from '@/lib/vn-checklist-sheet/shared'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { ref: string } }) {
  const auth = await checklistSession(false)
  if ('error' in auth) return buildApiError(auth.error, auth.status)
  const ref = decodeURIComponent(params.ref)

  try {
    const [tours, sync, good, config] = await Promise.all([
      toursForBooking(ref),
      lastSync(),
      lastGoodSyncAt(),
      getSheetConfig(),
    ])
    const refreshing = await refreshIfStale()

    const payload: BookingSheetPayload = {
      installed: true,
      tours,
      lastSync: sync,
      lastSuccessAt: good?.toISOString() ?? null,
      intervalHours: config.intervalHours,
      sheetWebUrl: config.sheetUrl,
      refreshing: refreshing || isSyncInFlight(),
    }
    return buildApiSuccess(payload)
  } catch (err) {
    if (isMissingTable(err)) {
      const payload: BookingSheetPayload = {
        installed: false, tours: [], lastSync: null, lastSuccessAt: null,
        intervalHours: 2, sheetWebUrl: null, refreshing: false,
      }
      return buildApiSuccess(payload)
    }
    return buildApiError(err instanceof Error ? err.message : 'Could not load the checklist', 500)
  }
}
