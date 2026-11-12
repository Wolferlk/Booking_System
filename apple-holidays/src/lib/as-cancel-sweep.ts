/**
 * AppleSystem **cancellation check** — once a day, and on demand for any range.
 *
 * The Live Watch (`as-watch.ts`) already spots status-3 quotations on every tick,
 * but only inside its short rolling window and only acts when its own switch is
 * on. This module is the dependable daily pass the desk asked for:
 *
 *   • **Daily** — at the configured hour (Asia/Colombo), list every quotation
 *     *created* in the last N days (default 2) that AppleSystem now shows at
 *     status 3, and send each booking we hold for one of them to accounts as
 *     "requested to cancel" (PENDING_CANCELLATION).
 *   • **Range** — a person picks a from/to window (by create date or arrival
 *     date) and either previews what would happen or runs it for real.
 *
 * Both paths go through {@link sweepCancellations}, so every guard is shared:
 *   – a booking is never cancelled, only *requested* — accounts decide;
 *   – only bookings imported from AppleSystem are touched;
 *   – a tour already on the ground waits for a person;
 *   – AppleSystem is asked a second time per booking, and a quotation that was
 *     replaced by a confirmed one (an amendment) is left alone;
 *   – a request accounts declined is never raised again.
 *
 * Storage is `system_settings` (KV) only. **No schema change, no migration.**
 */
import { prisma } from '@/lib/prisma'
import { listBookings, listByCreateDate, withAsRetryBudget } from '@/lib/applesystem'
import { getAutomationUserId } from '@/lib/as-booking-import'
import {
  AS_CANCELLED_STATUSES,
  sweepCancellations,
  type CancelSweepDetail,
  type CancelSweepSummary,
} from '@/lib/as-watch-cancel'

// ── Keys ──────────────────────────────────────────────────────────────────────

const CONFIG_KEY   = 'as_cancel_daily_config'
const LAST_DAY_KEY = 'as_cancel_daily_last_date'
const LOG_KEY      = 'as_cancel_sweep_log'
const LOCK_KEY     = 'as_cancel_sweep_lock'

const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

/** A run still "running" after this long is presumed dead and its lock broken. */
const STALE_LOCK_MS = 12 * 60 * 1000
/** Retry budget for the AppleSystem calls inside one run. */
const RETRY_BUDGET_MS = 4 * 60 * 1000
/** Widest range a person may check in one go — upstream paging is capped. */
export const MAX_RANGE_DAYS = 92
const MAX_LOG = 20
const MAX_LOG_BYTES = 40_000
/** Per-run detail rows kept in the log (the full list is returned to the caller). */
const MAX_DETAILS_IN_LOG = 40

// ── Settings ──────────────────────────────────────────────────────────────────

export interface CancelDailyConfig {
  /** Run the daily check at all. */
  enabled: boolean
  /** Hour of day (0–23, Asia/Colombo) from which the daily check is due. */
  hour: number
  /** How many days of quotations to look back on, by create date (today included). */
  lookbackDays: number
  /** true = send for accounts approval; false = list on the Live Watch page only. */
  autoRequest: boolean
}

export const DEFAULT_DAILY: CancelDailyConfig = {
  enabled: true,
  hour: 7,
  lookbackDays: 2,
  autoRequest: true,
}

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === 'number' ? n : parseInt(String(n ?? ''), 10)
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : fallback
}

function normaliseConfig(raw: Partial<CancelDailyConfig> | null | undefined): CancelDailyConfig {
  return {
    enabled:      typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_DAILY.enabled,
    hour:         clampInt(raw?.hour, 0, 23, DEFAULT_DAILY.hour),
    lookbackDays: clampInt(raw?.lookbackDays, 1, 14, DEFAULT_DAILY.lookbackDays),
    autoRequest:  typeof raw?.autoRequest === 'boolean' ? raw.autoRequest : DEFAULT_DAILY.autoRequest,
  }
}

export async function getDailyConfig(): Promise<CancelDailyConfig> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: CONFIG_KEY } })
    return normaliseConfig(row?.value ? JSON.parse(row.value) : null)
  } catch {
    return { ...DEFAULT_DAILY }
  }
}

export async function saveDailyConfig(patch: Partial<CancelDailyConfig>): Promise<CancelDailyConfig> {
  const next = normaliseConfig({ ...(await getDailyConfig()), ...patch })
  const value = JSON.stringify(next)
  await prisma.systemSetting.upsert({
    where: { key: CONFIG_KEY }, update: { value }, create: { key: CONFIG_KEY, value },
  })
  return next
}

// ── Dates ─────────────────────────────────────────────────────────────────────

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function hourInTz(): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false })
    .formatToParts(new Date()).find((p) => p.type === 'hour')?.value
  return Number(h ?? '0') % 24
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Whole days from `from` to `to`, inclusive. */
function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/** The create-date window the daily check covers: the last N days up to today. */
export function dailyWindow(lookbackDays: number): { from: string; to: string } {
  const to = todayInTz()
  return { from: shiftDays(to, -(Math.max(1, lookbackDays) - 1)), to }
}

// ── Lock ──────────────────────────────────────────────────────────────────────

async function acquireLock(): Promise<boolean> {
  const now = Date.now()
  const row = await prisma.systemSetting.findUnique({ where: { key: LOCK_KEY } })
  const held = row?.value ? Date.parse(row.value) : NaN
  if (Number.isFinite(held) && now - held < STALE_LOCK_MS) return false
  // Compare-and-set on the value we read, so two callers cannot both win.
  if (row) {
    const res = await prisma.systemSetting.updateMany({
      where: { key: LOCK_KEY, value: row.value },
      data: { value: new Date(now).toISOString() },
    })
    return res.count === 1
  }
  try {
    await prisma.systemSetting.create({ data: { key: LOCK_KEY, value: new Date(now).toISOString() } })
    return true
  } catch {
    return false   // somebody else created it a moment ago
  }
}

async function releaseLock(): Promise<void> {
  await prisma.systemSetting.updateMany({ where: { key: LOCK_KEY }, data: { value: '' } }).catch(() => {})
}

// ── Run log ───────────────────────────────────────────────────────────────────

export type SweepTrigger = 'daily' | 'cron' | 'manual'
export type SweepDateField = 'create' | 'arrival'
export type SweepMode = 'request' | 'detect'

export interface CancelSweepRun {
  at: string
  trigger: SweepTrigger
  mode: SweepMode
  dateField: SweepDateField
  from: string
  to: string
  by: string
  durationMs: number
  summary: CancelSweepSummary
  error?: string
}

async function readLog(): Promise<CancelSweepRun[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: LOG_KEY } })
    const parsed = row?.value ? JSON.parse(row.value) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function appendLog(run: CancelSweepRun): Promise<void> {
  const slim: CancelSweepRun = {
    ...run,
    summary: { ...run.summary, details: run.summary.details?.slice(0, MAX_DETAILS_IN_LOG) },
  }
  const list = [slim, ...(await readLog())].slice(0, MAX_LOG)
  // Oldest runs go first, then detail rows on the oldest kept runs — never the newest.
  while (list.length > 1 && Buffer.byteLength(JSON.stringify(list), 'utf8') > MAX_LOG_BYTES) list.pop()
  const value = JSON.stringify(list)
  await prisma.systemSetting.upsert({
    where: { key: LOG_KEY }, update: { value }, create: { key: LOG_KEY, value },
  })
}

export async function listSweepRuns(limit = MAX_LOG): Promise<CancelSweepRun[]> {
  return (await readLog()).slice(0, limit)
}

// ── The run ───────────────────────────────────────────────────────────────────

export interface RunSweepParams {
  trigger: SweepTrigger
  mode: SweepMode
  dateField: SweepDateField
  from: string
  to: string
  /** The user to attribute status events to; the automation user when absent. */
  actorId?: string
  /** Shown in run history and on the booking ("Detected by …"). */
  actorName?: string
}

export type RunSweepOutcome =
  | { ran: true; run: CancelSweepRun; details: CancelSweepDetail[] }
  | { ran: false; reason: 'already-running' | 'invalid-range'; message: string }

export function validateRange(from: string, to: string): string | null {
  if (!YMD.test(from) || !YMD.test(to)) return 'Pick both dates (yyyy-mm-dd).'
  if (from > to) return '"From" must be on or before "To".'
  const days = spanDays(from, to)
  if (days > MAX_RANGE_DAYS) return `That is ${days} days — check at most ${MAX_RANGE_DAYS} days at a time.`
  return null
}

export async function runCancelSweep(params: RunSweepParams): Promise<RunSweepOutcome> {
  const bad = validateRange(params.from, params.to)
  if (bad) return { ran: false, reason: 'invalid-range', message: bad }

  if (!(await acquireLock())) {
    return { ran: false, reason: 'already-running', message: 'A cancellation check is already running — try again in a minute.' }
  }

  const started = Date.now()
  const via =
    params.trigger === 'manual'
      ? `a range check by ${params.actorName ?? 'a user'} (${params.dateField === 'arrival' ? 'arrival' : 'created'} ${params.from} → ${params.to})`
      : 'the daily AppleSystem cancellation check'

  const run: CancelSweepRun = {
    at: new Date(started).toISOString(),
    trigger: params.trigger,
    mode: params.mode,
    dateField: params.dateField,
    from: params.from,
    to: params.to,
    by: params.actorName ?? 'Automatic',
    durationMs: 0,
    summary: { upstream: 0, matched: 0, requested: 0, awaiting: 0, skipped: 0, failed: 0, refs: [], details: [] },
  }

  try {
    const actorId = params.actorId ?? (await getAutomationUserId())
    await withAsRetryBudget(RETRY_BUDGET_MS, async () => {
      const statuses = [...AS_CANCELLED_STATUSES]
      const { items } = params.dateField === 'arrival'
        ? await listBookings({ fromArrivalDate: params.from, toArrivalDate: params.to, statuses })
        : await listByCreateDate({ fromCreateDate: params.from, toCreateDate: params.to, statuses })

      // The status filter is ours to trust only after checking it: an upstream
      // that ignored it would hand us confirmed rows to "cancel".
      const cancelled = items.filter((it) =>
        (AS_CANCELLED_STATUSES as readonly string[]).includes(String(it.status ?? '')))

      run.summary = await sweepCancellations(cancelled, actorId, {
        action: params.mode === 'request' ? 'request' : 'detect',
        via,
        collectDetails: true,
      })
    })
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err)
    console.error('[AsCancelSweep] run failed:', run.error)
  } finally {
    run.durationMs = Date.now() - started
    await releaseLock()
  }

  const details = run.summary.details ?? []
  await appendLog(run).catch((err) =>
    console.error('[AsCancelSweep] could not write log:', err instanceof Error ? err.message : err))

  if (params.trigger !== 'manual') {
    console.log(
      `[AsCancelSweep] ${params.trigger} ${params.from}→${params.to}: upstream=${run.summary.upstream} ` +
      `matched=${run.summary.matched} requested=${run.summary.requested} superseded=${run.summary.superseded ?? 0} ` +
      `awaiting=${run.summary.awaiting} failed=${run.summary.failed}${run.error ? ` error=${run.error}` : ''}`,
    )
  }

  return { ran: true, run, details }
}

// ── Daily trigger ─────────────────────────────────────────────────────────────

export interface DailyStatus {
  config: CancelDailyConfig
  lastRunDate: string | null
  /** The window the next daily run will cover, for the page to show. */
  nextWindow: { from: string; to: string }
  due: boolean
}

export async function getDailyStatus(): Promise<DailyStatus> {
  const [config, last] = await Promise.all([
    getDailyConfig(),
    prisma.systemSetting.findUnique({ where: { key: LAST_DAY_KEY } }).catch(() => null),
  ])
  const today = todayInTz()
  const lastRunDate = last?.value || null
  return {
    config,
    lastRunDate,
    nextWindow: dailyWindow(config.lookbackDays),
    due: config.enabled && lastRunDate !== today && hourInTz() >= config.hour,
  }
}

/**
 * Run today's check if it is due: switched on, past the configured hour, and
 * not already run today. Safe to call as often as you like — the in-process
 * ticker calls it hourly and an external cron may call it on top; the date
 * stamp is written *before* the run so two callers cannot both start it.
 */
export async function runDailyIfDue(
  trigger: 'daily' | 'cron' = 'daily',
  force = false,
): Promise<{ ran: boolean; reason?: string; run?: CancelSweepRun }> {
  const status = await getDailyStatus()
  if (!force) {
    if (!status.config.enabled) return { ran: false, reason: 'disabled' }
    if (!status.due) return { ran: false, reason: status.lastRunDate === todayInTz() ? 'already-ran-today' : 'before-hour' }
  }

  const today = todayInTz()
  // Claim today: only the caller whose write flips the stamp goes on.
  const prev = status.lastRunDate
  if (!force) {
    if (prev === null) {
      try {
        await prisma.systemSetting.create({ data: { key: LAST_DAY_KEY, value: today } })
      } catch {
        return { ran: false, reason: 'already-ran-today' }
      }
    } else {
      const claimed = await prisma.systemSetting.updateMany({
        where: { key: LAST_DAY_KEY, value: prev },
        data: { value: today },
      })
      if (claimed.count !== 1) return { ran: false, reason: 'already-ran-today' }
    }
  }

  const { from, to } = status.nextWindow
  const outcome = await runCancelSweep({
    trigger,
    mode: status.config.autoRequest ? 'request' : 'detect',
    dateField: 'create',
    from,
    to,
  })

  if (!outcome.ran) {
    // Lock held by a manual run — give the day back so the next tick retries.
    if (!force) {
      await prisma.systemSetting.updateMany({ where: { key: LAST_DAY_KEY, value: today }, data: { value: prev ?? '' } })
        .catch(() => {})
    }
    return { ran: false, reason: outcome.reason }
  }
  // AppleSystem unreachable: also give the day back, so a later tick tries again.
  if (outcome.run.error && !force) {
    await prisma.systemSetting.updateMany({ where: { key: LAST_DAY_KEY, value: today }, data: { value: prev ?? '' } })
      .catch(() => {})
  }
  return { ran: true, run: outcome.run }
}

// ── In-process ticker ─────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Started once at boot on a long-lived server. Checks every 20 minutes whether
 * today's run is due — which also gives boot catch-up for free. On Amplify,
 * where no process survives, `/api/cron/as-cancel-sweep` does the same job.
 */
export function startCancelSweepScheduler(): void {
  if (timer) return
  const tick = () => {
    void runDailyIfDue('daily').catch((err) =>
      console.error('[AsCancelSweep] tick error:', err instanceof Error ? err.message : err))
  }
  setTimeout(tick, 2 * 60_000).unref?.()
  timer = setInterval(tick, 20 * 60_000)
  timer.unref?.()
  console.log('[AsCancelSweep] daily cancellation check scheduler started')
}
