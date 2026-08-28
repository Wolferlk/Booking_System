/**
 * AppleSystem reconciliation scheduler — pure Node backend.
 *
 * Drives {@link runAsReconcile} every N minutes (15 by default) from the
 * always-on Node process, started once at boot from `instrumentation.ts` →
 * `cron-scheduler`. Nobody has to have the app open.
 *
 * Shaped as a self-rescheduling `setTimeout` chain rather than node-cron for the
 * same reason as the Live Watch: the period is an interval the user picks
 * freely, and a cron step expression can only express "every N" for values that
 * divide 60 — a 20- or 45-minute setting would silently fire at the wrong times.
 * Re-reading the settings on every tick also means a changed interval takes
 * effect on the following tick without a restart.
 *
 * The delay is measured from the *end* of the previous run, so a slow
 * reconciliation delays the next one instead of stacking up behind it. The KV
 * lock inside `runAsReconcile` is the real overlap guard — this is just polite.
 */
import { getReconcileSettings, runAsReconcile } from './as-reconcile'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
/** Bumped on every (re)schedule so a timer armed by a superseded call is ignored. */
let generation = 0

/**
 * First run happens a couple of minutes after boot. Deliberately later than the
 * Live Watch's 90 s: on a cold start both would otherwise reach for the same
 * upstream window at once, and the watch getting there first means the
 * reconciler has less to do.
 */
const BOOT_DELAY_MS = 150_000
/** Fallback delay when the settings read itself fails — retry, don't die. */
const ERROR_RETRY_MS = 5 * 60 * 1000

function arm(delayMs: number, gen: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick(gen) }, delayMs)
  // Never let the reconciler hold the process open on its own.
  timer.unref?.()
}

async function tick(gen: number): Promise<void> {
  if (gen !== generation) return   // superseded by a reschedule

  let nextMs = ERROR_RETRY_MS
  try {
    const settings = await getReconcileSettings()
    nextMs = settings.intervalMinutes * 60_000

    if (settings.enabled) {
      const outcome = await runAsReconcile({ trigger: 'auto' })
      if (!outcome.ran && outcome.reason === 'already-running') {
        console.log('[AsReconcileScheduler] skipped — previous run still going')
      }
    }
  } catch (err) {
    console.error('[AsReconcileScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    if (gen === generation) arm(nextMs, gen)
  }
}

/**
 * Re-arm the loop from current settings — called when the interval or the
 * enabled switch changes in the UI so the change takes effect now rather than
 * after the pending delay expires.
 */
export async function rescheduleAsReconcile(): Promise<void> {
  if (!started) return
  const gen = ++generation
  try {
    const settings = await getReconcileSettings()
    arm(settings.intervalMinutes * 60_000, gen)
    console.log(
      `[AsReconcileScheduler] re-armed — every ${settings.intervalMinutes} min, enabled=${settings.enabled}`,
    )
  } catch (err) {
    console.error('[AsReconcileScheduler] reschedule failed:', err instanceof Error ? err.message : err)
    arm(ERROR_RETRY_MS, gen)
  }
}

/** Called once at server boot. */
export async function startAsReconcileScheduler(): Promise<void> {
  if (started) return
  started = true
  const gen = ++generation

  try {
    const settings = await getReconcileSettings()
    console.log(
      `[AsReconcileScheduler] started — every ${settings.intervalMinutes} min, ` +
      `lookback ${settings.lookbackDays}d, enabled=${settings.enabled}, ` +
      `refresh=${settings.refreshEnabled}, auto-cancel=${settings.autoCancelEnabled}`,
    )
  } catch (err) {
    console.error('[AsReconcileScheduler] start read failed:', err instanceof Error ? err.message : err)
  }

  arm(BOOT_DELAY_MS, gen)
}
