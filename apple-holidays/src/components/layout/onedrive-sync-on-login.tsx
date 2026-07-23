'use client'

/**
 * Fires a background OneDrive poll once per browser session — immediately
 * after any user logs in and reaches the dashboard.
 *
 * Uses sessionStorage so it runs exactly once per tab/session (not on every
 * page navigation). The concurrency lock in runOneDrivePoll() ensures that
 * if multiple tabs open at the same time only one actual scan runs.
 */
import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { ONEDRIVE_AUTO_POLL_HARD_DISABLED } from '@/lib/automation-switches'

const STORAGE_KEY = 'od_poll_on_login_done'

export default function OneDriveSyncOnLogin() {
  const { status } = useSession()

  useEffect(() => {
    // Auto-poll is hard-disabled in code — never fire the login trigger.
    if (ONEDRIVE_AUTO_POLL_HARD_DISABLED) return
    if (status !== 'authenticated') return

    // Only fire once per browser session
    if (typeof window !== 'undefined' && sessionStorage.getItem(STORAGE_KEY)) return

    sessionStorage.setItem(STORAGE_KEY, '1')

    // Fire-and-forget — do not await, do not block rendering
    fetch('/api/onedrive/poll-status', { method: 'POST' })
      .then(r => r.json())
      .then(json => {
        if (json?.data?.queued) {
          console.log('[OneDrive] Login-triggered poll started in background')
        }
      })
      .catch(() => { /* ignore — poll will run on next cron cycle anyway */ })
  }, [status])

  return null
}
