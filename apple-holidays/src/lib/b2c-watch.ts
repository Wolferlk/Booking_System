/**
 * Aahaas B2C live watch — imports a new store order within minutes instead of
 * waiting for the 00:30 nightly run.
 *
 * Each check sweeps every upcoming order (the same set the B2C page's "Ready to
 * import" tile counts) but drops the ones already in ops with a single bulk
 * lookup first, so a quiet check is one read on the store and one on ops. What
 * is left goes through the normal importer: INSERT-only, an existing ref is never
 * touched, a B2B ref is reported as a conflict, and the store is only ever read.
 *
 * Three callers share {@link runB2cWatch}: the in-process timer
 * (`b2c-watch-scheduler.ts`), the HTTP cron route (`/api/cron/b2c-watch`) for
 * serverless, and the B2C page when it sees an order marked "Will import". The
 * nightly guard (`auto_b2c_import_last_run_date`) is left alone, so the nightly
 * run still happens and still does the lead-name repairs.
 */
import { prisma } from './prisma'
import { isB2cConfigured } from './b2c-db'
import { appendRunLog, getB2cImportSettings, runB2cImport } from './b2c-import'
import type { B2cImportSummary } from './b2c-import'

export const WATCH_ENABLED = 'auto_b2c_watch_enabled'
export const WATCH_MINUTES = 'auto_b2c_watch_minutes'
export const WATCH_LAST_AT = 'auto_b2c_watch_last_at'

const DEFAULT_MINUTES = 5

export interface B2cWatchSettings {
  /** False when either the watch or the whole B2C auto-import is switched off. */
  enabled: boolean
  intervalMinutes: number
}

export async function getB2cWatchSettings(): Promise<B2cWatchSettings> {
  const [importSettings, rows] = await Promise.all([
    getB2cImportSettings(),
    prisma.systemSetting.findMany({ where: { key: { in: [WATCH_ENABLED, WATCH_MINUTES] } } }),
  ])
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, string>
  const minutes = parseInt(map[WATCH_MINUTES] ?? String(DEFAULT_MINUTES), 10)
  return {
    // Opt-out, and the B2C master switch turns it off too.
    enabled: importSettings.enabled && map[WATCH_ENABLED] !== 'false',
    intervalMinutes: Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : DEFAULT_MINUTES,
  }
}

export type B2cWatchOutcome =
  | { ran: true; summary: B2cImportSummary }
  | { ran: false; reason: 'disabled' | 'not-configured' | 'already-running' | 'too-soon' }

/** In-process guard; the unique bookingRef is what stops cross-instance duplicates. */
let running = false
/** Conflicts/failures of the previous check, to log each problem once. */
let lastProblems = ''

export async function runB2cWatch(opts: {
  trigger: 'scheduler' | 'cron-http' | 'manual'
  triggeredBy?: string | null
  /** Ignore the interval since the last check (the timer already waited it out). */
  force?: boolean
}): Promise<B2cWatchOutcome> {
  if (!isB2cConfigured()) return { ran: false, reason: 'not-configured' }
  const settings = await getB2cWatchSettings()
  if (!settings.enabled) return { ran: false, reason: 'disabled' }
  if (running) return { ran: false, reason: 'already-running' }

  if (!opts.force) {
    // Page loads and cron calls can arrive more often than the interval; a
    // floor of one minute keeps the store from being polled on every refresh.
    const last = await prisma.systemSetting.findUnique({ where: { key: WATCH_LAST_AT } })
    const lastMs = last?.value ? Date.parse(last.value) : NaN
    if (Number.isFinite(lastMs) && Date.now() - lastMs < 60_000) return { ran: false, reason: 'too-soon' }
  }

  running = true
  try {
    const at = new Date().toISOString()
    await prisma.systemSetting.upsert({
      where: { key: WATCH_LAST_AT },
      update: { value: at },
      create: { key: WATCH_LAST_AT, value: at },
    })

    const summary = await runB2cImport({
      mode: 'backfill',
      onlyNew: true,
      trigger: 'watch',
      triggeredBy: opts.triggeredBy ?? opts.trigger,
      // Logged below only when it did something, so a check every few minutes
      // does not push the real runs out of the activity feed.
      log: false,
    })

    // An order that keeps failing would otherwise be logged on every check, so
    // a repeat of the same problems is only logged when something was created.
    const problems = JSON.stringify([
      summary.conflicts.map((c) => c.bookingRef),
      summary.failed.map((f) => `${f.orderId}:${f.error}`),
    ])
    const newProblems = problems !== lastProblems && (summary.conflicts.length + summary.failed.length) > 0
    lastProblems = problems
    if (summary.created.length > 0 || newProblems) {
      await appendRunLog(summary)
      console.log(
        `[B2cWatch] ${summary.created.length} created, ${summary.conflicts.length} conflicts, ` +
        `${summary.failed.length} failed` +
        (summary.created.length ? ` — ${summary.created.join(', ')}` : ''),
      )
    }
    return { ran: true, summary }
  } finally {
    running = false
  }
}
