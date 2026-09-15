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
 *
 * ── Why a self-rescheduling timer rather than setInterval ────────────────────
 * This sweep is one of the jobs that was driving the primary's CPU, so its
 * cadence is now an operator setting (Settings → Database Health) rather than a
 * constant. A setInterval fixes its period when it is armed; re-arming after
 * each run lets a changed interval take effect on the following pass without a
 * restart. Measuring the delay from the *end* of the run also stops a slow
 * sweep from stacking up behind itself, which is the failure mode that turns a
 * heavy query into a pile-up.
 */
import { runFileHandlerAutoSweep, AUTO_RESOLVE_DELAY_MINUTES } from './file-handler-resolve'
import { fileHandlerSweepMs, DEFAULT_SWEEP_MINUTES } from './db-health-settings'

let timer: NodeJS.Timeout | null = null
let started = false

function arm(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick() }, delayMs)
  // Never let the sweep hold the process open on its own.
  timer.unref?.()
}

async function tick(): Promise<void> {
  try {
    await runFileHandlerAutoSweep('scheduled tick')
  } catch (err) {
    console.error('[FileHandlerResolveScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    // Re-read the cadence every pass so a settings change lands next tick.
    arm(await fileHandlerSweepMs().catch(() => DEFAULT_SWEEP_MINUTES * 60_000))
  }
}

export function startFileHandlerResolveScheduler(): void {
  if (started) return   // idempotent
  started = true

  // First pass a minute after boot, so startup is not competing with it.
  setTimeout(() => { void tick() }, 60_000)

  console.log(
    `[FileHandlerResolveScheduler] started — default every ${DEFAULT_SWEEP_MINUTES} min ` +
    `(tunable in Settings → Database Health), bookings older than ${AUTO_RESOLVE_DELAY_MINUTES} min`,
  )
}
