/**
 * In-process tick for auto-reports (VM / always-on deployments).
 *
 * Unlike the other schedulers in this codebase, this one cannot bake the send
 * time into a cron expression — the times are user-configured at runtime and
 * change whenever someone edits a schedule. So it ticks every minute and lets
 * `runDueSchedules()` decide, which also gives free catch-up after a restart.
 *
 * On Vercel/Amplify there is no long-lived process; `/api/cron/auto-reports`
 * plays the same role. Both share the `claimRunSlot()` guard, so running both
 * at once is safe.
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { runDueCallReport } from '@/lib/te/call-report-schedule'
import { runDueSchedules } from './report-runner'

let task: ScheduledTask | null = null
let running = false

async function tick(reason: string): Promise<void> {
  // A slow report must not stack ticks on top of itself.
  if (running) return
  running = true
  try {
    // The AI voice-call report shares this tick — same "send time is configured
    // at runtime" shape, and its own slot claim keeps it safe next to the HTTP cron.
    const callReport = await runDueCallReport()
      .catch(err => {
        console.error('[ReportScheduler] AI call report error:', err instanceof Error ? err.message : err)
        return null
      })
    if (callReport) {
      console.log(`[ReportScheduler] ${reason} — AI call report: ${callReport.status}${callReport.reason ? ` (${callReport.reason})` : ''}`)
    }

    const result = await runDueSchedules()
    if (result.fired.length) {
      for (const r of result.fired) {
        console.log(`[ReportScheduler] ${reason} — "${r.scheduleName}": ${r.status}${r.reason ? ` (${r.reason})` : ''}`)
      }
    }
  } catch (err) {
    console.error('[ReportScheduler] tick error:', err instanceof Error ? err.message : err)
  } finally {
    running = false
  }
}

export function startReportScheduler(): void {
  if (task) return // idempotent — instrumentation can run more than once in dev
  try {
    task = cron.schedule('* * * * *', () => { void tick('tick') })
    console.log('[ReportScheduler] started — evaluating auto-report schedules every minute')
    // Boot catch-up: a deploy that lands after the send time still gets the report out.
    void tick('boot catch-up')
  } catch (err) {
    console.error('[ReportScheduler] start error:', err instanceof Error ? err.message : err)
  }
}

export function stopReportScheduler(): void {
  task?.stop()
  task = null
}
