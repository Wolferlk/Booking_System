/**
 * Agenda auto-generate scheduler: a 30-second self-rescheduling tick that runs
 * the sweep in lib/agenda-auto-generate.ts. A new booking's movement chart is
 * built between one and two minutes after the booking is created.
 *
 * The timer re-arms from the END of each run, so a slow AI call can never stack
 * ticks up behind itself (same approach as file-handler-resolve-scheduler.ts).
 * Serverless counterpart: /api/cron/agenda-auto-generate. Both share the same
 * per-booking claim, so running both is harmless.
 */
import { runAgendaAutoGenerateSweep, AUTOGEN_DELAY_SEC, AUTOGEN_WINDOW_HRS } from './agenda-auto-generate'

const TICK_MS = 30_000

let timer: NodeJS.Timeout | null = null
let started = false

function arm(delayMs: number): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { void tick() }, delayMs)
  timer.unref?.()
}

async function tick(): Promise<void> {
  try {
    const r = await runAgendaAutoGenerateSweep('sweep')
    if (r.built || r.failed) {
      console.log(`[AgendaAutoGenScheduler] built ${r.built}, failed ${r.failed}, waiting ${r.skipped}${r.refs.length ? ` — ${r.refs.join(', ')}` : ''}`)
    }
  } catch (err) {
    console.error('[AgendaAutoGenScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    arm(TICK_MS)
  }
}

export function startAgendaAutoGenerateScheduler(): void {
  if (started) return
  started = true
  // First pass shortly after boot, once the server is up.
  arm(45_000)
  console.log(
    `[AgendaAutoGenScheduler] started — every ${TICK_MS / 1000}s, builds charts for bookings ` +
    `${AUTOGEN_DELAY_SEC}s+ old (window ${AUTOGEN_WINDOW_HRS}h); switch: Settings → Auto-Generate Agenda`,
  )
}
