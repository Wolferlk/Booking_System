/**
 * File-handler resolution scheduler — pure Node backend.
 *
 * Bookings from the 30 Sundays feed land with the placeholder handler
 * "30sundays Aahaas"; the quotation tool fills in the real name a few minutes
 * later. So rather than a per-booking timer (which would not survive a restart
 * or a Lambda freeze), this ticks every few minutes and picks up every booking
 * that is now at least AUTO_RESOLVE_DELAY_MINUTES old — a booking created while
 * the process was down is simply caught by the next tick.
 *
 * The serverless counterpart is /api/cron/file-handler-resolve; both call the
 * same sweep, and the sweep is idempotent (it only ever touches rows that still
 * hold the placeholder), so running both is harmless.
 */
import { runFileHandlerAutoSweep, AUTO_RESOLVE_DELAY_MINUTES } from './file-handler-resolve'

/** How often the sweep runs. Small enough that the 10-minute promise holds. */
const TICK_MS = 5 * 60 * 1000

let timer: NodeJS.Timeout | null = null

export function startFileHandlerResolveScheduler(): void {
  if (timer) return   // idempotent

  // First pass a minute after boot, so startup is not competing with it.
  setTimeout(() => { void runFileHandlerAutoSweep('boot pass') }, 60_000)
  timer = setInterval(() => { void runFileHandlerAutoSweep('scheduled tick') }, TICK_MS)

  console.log(
    `[FileHandlerResolveScheduler] started — every ${TICK_MS / 60_000} min, ` +
    `bookings older than ${AUTO_RESOLVE_DELAY_MINUTES} min`,
  )
}
