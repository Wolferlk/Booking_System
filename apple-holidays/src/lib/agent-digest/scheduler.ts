/**
 * Agent Daily Digest — in-process node-cron, ticking every 5 minutes. Each
 * rule is checked against its own timezone and send time inside
 * `runScheduledDigests()`; one automatic attempt per rule per day.
 *
 * Nothing is sent unless a rule's `autoSend` switch is on (default OFF).
 * `/api/cron/agent-digest` is the serverless twin (Amplify has no long-lived
 * process, so an external hit every 5–15 minutes is needed there).
 */
import * as cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { runScheduledDigests } from './server'

let task: ScheduledTask | null = null

async function tick(reason: string) {
  try {
    const results = await runScheduledDigests()
    for (const r of results) {
      console.log(`[AgentDigest] ${reason} — ${r.ruleName} ${r.runDate}: sent ${r.sent}, failed ${r.failed}, skipped ${r.skipped}${r.reason ? ` (${r.reason})` : ''}`)
    }
  } catch (err) {
    console.error('[AgentDigest] scheduler tick error:', err instanceof Error ? err.message : err)
  }
}

export async function startAgentDigestScheduler(): Promise<void> {
  if (task) return
  task = cron.schedule('*/5 * * * *', () => { void tick('5-min tick') })
  console.log('[AgentDigest] daily agent digest scheduler armed (every 5 min, per-rule local time)')
  await tick('boot catch-up')
}
