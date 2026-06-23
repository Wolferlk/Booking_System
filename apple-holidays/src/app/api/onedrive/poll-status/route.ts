/**
 * GET /api/onedrive/poll-status
 *
 * Returns the current state of the background OneDrive poll job:
 *   - whether a scan is currently running
 *   - when the last successful poll completed
 *   - what it found (bookings created/updated, PNLs, errors)
 *
 * Used by the admin OneDrive page to show a live "last synced" indicator.
 */
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { getOneDrivePollStatus } from '@/lib/onedrive-monitor'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { pollRunning, lastPollAt, lastPollResult } = getOneDrivePollStatus()

  // Fall back to DB-persisted timestamp if the in-process state was lost (e.g. server restarted)
  let persistedAt: string | null = null
  let persistedError: string | null = null
  try {
    const [pollRow, errRow] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'onedrive_last_poll' } }),
      prisma.systemSetting.findUnique({ where: { key: 'onedrive_poll_last_error' } }),
    ])
    persistedAt    = pollRow?.value ?? null
    persistedError = errRow?.value  ?? null
  } catch { /* DB unavailable */ }

  return buildApiSuccess({
    running:       pollRunning,
    lastPollAt:    lastPollAt?.toISOString() ?? persistedAt ?? null,
    lastPollResult: lastPollResult ?? null,
    lastError:     persistedError,
  })
}

/** POST: trigger an immediate poll without waiting for the next interval */
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const { pollRunning } = getOneDrivePollStatus()
  if (pollRunning) {
    return buildApiSuccess({ queued: false, message: 'A poll is already running' })
  }

  // Fire and forget — don't await, return immediately
  import('@/lib/onedrive-monitor').then(({ runOneDrivePoll }) => {
    runOneDrivePoll().catch(err => console.error('[OneDrive] Forced poll error:', err))
  })

  return buildApiSuccess({ queued: true, message: 'Poll started in background' })
}
