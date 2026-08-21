/**
 * **Pre-arrival auto-sync** — refresh bookings from AppleSystem N days before
 * the guests arrive.
 *
 * A file is imported at confirmation time, then sits for weeks while the agent
 * amends it upstream: dates shift, a hotel changes, pax drop. Ops only finds out
 * when the guest lands. This job closes that gap by re-pulling each booking a
 * configurable number of days before arrival (default 3), so the last thing ops
 * plans against is what AppleSystem currently holds.
 *
 * It runs the exact same {@link syncBookingFromAs} used by the manual "Fetch
 * Data from API" button, which means it inherits every safety rule: workflow
 * state (status, tickets, driver allocation, client confirmation, QC, the
 * operation checklist) is never written, locally-entered fields are never
 * blanked, and an empty upstream response is refused rather than applied.
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Settings, the once-a-day guard, the lock and the run log all live in
 * `system_settings` (KV), matching `as-import.ts` and `as-watch.ts`. **No schema
 * change, no migration** — the live DB carries drift and must not be pushed to.
 */

import { prisma } from '@/lib/prisma'
import { syncBookingFromAs, AsSyncError, type AsSyncResult } from '@/lib/as-booking-sync'
import { getAutomationUserId } from '@/lib/as-booking-import'

// ── Settings / state keys ────────────────────────────────────────────────────
export const PRESYNC_ENABLED   = 'as_presync_enabled'
export const PRESYNC_DAYS      = 'as_presync_days_before'
export const PRESYNC_HOUR      = 'as_presync_hour'
export const PRESYNC_MINUTE    = 'as_presync_minute'
export const PRESYNC_LAST_RUN  = 'as_presync_last_run_date'
export const PRESYNC_LOCK      = 'as_presync_lock'
const        PRESYNC_LOG       = 'as_presync_log'

export const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

/** Bounds for the "days before arrival" knob. */
export const MIN_DAYS = 0
export const MAX_DAYS = 60

const DEFAULT_DAYS   = 3
const DEFAULT_HOUR   = 5
const DEFAULT_MINUTE = 30

/** How many runs the log retains, and its serialized byte budget. */
const MAX_LOG_ENTRIES = 30
/** `system_settings.value` is MySQL TEXT (65,535 bytes) — stay well clear. */
const MAX_LOG_BYTES = 24_000
/** Per-booking detail rows kept in one log entry. */
const MAX_DETAIL_ROWS = 40

/**
 * Safety ceiling on one run. A single day's arrivals is a handful of files; a
 * number far above that means the date filter went wrong, and hammering the
 * upstream API with hundreds of template calls is not an acceptable failure
 * mode. The run stops at the cap and says so in the log.
 */
const MAX_BOOKINGS_PER_RUN = 120

/** Pause between upstream calls so a run cannot burst the AppleSystem API. */
const THROTTLE_MS = 400

/** A run still marked active after this long is treated as dead. */
const STALE_LOCK_MS = 30 * 60 * 1000

// ── Timezone helpers ─────────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) evaluated in the scheduler timezone. */
export function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** `todayInTz()` shifted by `days`, as YYYY-MM-DD. */
export function dateInTzPlus(days: number): string {
  const d = new Date(`${todayInTz()}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Current { hour, minute } in the scheduler timezone. */
export function nowHourMinuteInTz(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  return {
    hour:   Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? '0'),
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface PreSyncSettings {
  enabled: boolean
  /** How many days before arrival a booking is refreshed. */
  daysBefore: number
  hour: number
  minute: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

function intOr(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

export async function getPreSyncSettings(): Promise<PreSyncSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [PRESYNC_ENABLED, PRESYNC_DAYS, PRESYNC_HOUR, PRESYNC_MINUTE] } },
  })
  const map: Record<string, string> = {}
  rows.forEach((r) => { map[r.key] = r.value })

  return {
    // Ships OFF. This job writes to live bookings on a timer, so switching it on
    // is an explicit decision made in the UI, never a side effect of deploying.
    enabled:    map[PRESYNC_ENABLED] === 'true',
    daysBefore: intOr(map[PRESYNC_DAYS], DEFAULT_DAYS, MIN_DAYS, MAX_DAYS),
    hour:       intOr(map[PRESYNC_HOUR], DEFAULT_HOUR, 0, 23),
    minute:     intOr(map[PRESYNC_MINUTE], DEFAULT_MINUTE, 0, 59),
  }
}

async function putSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function savePreSyncSettings(next: PreSyncSettings): Promise<PreSyncSettings> {
  const clean: PreSyncSettings = {
    enabled:    !!next.enabled,
    daysBefore: clamp(Number(next.daysBefore), MIN_DAYS, MAX_DAYS),
    hour:       clamp(Number(next.hour), 0, 23),
    minute:     clamp(Number(next.minute), 0, 59),
  }
  await Promise.all([
    putSetting(PRESYNC_ENABLED, String(clean.enabled)),
    putSetting(PRESYNC_DAYS,    String(clean.daysBefore)),
    putSetting(PRESYNC_HOUR,    String(clean.hour)),
    putSetting(PRESYNC_MINUTE,  String(clean.minute)),
  ])
  return clean
}

// ── Run log ──────────────────────────────────────────────────────────────────

export interface PreSyncDetail {
  bookingRef: string
  status: 'updated' | 'unchanged' | 'failed'
  /** Field / section names that changed, for an `updated` row. */
  changed?: string[]
  error?: string
}

export interface PreSyncRun {
  at: string
  /** 'auto' = scheduler, 'manual' = "Run now" in the UI. */
  mode: 'auto' | 'manual'
  /** The arrival date this run targeted (YYYY-MM-DD). */
  targetDate: string
  daysBefore: number
  scanned: number
  updated: number
  unchanged: number
  failed: number
  durationMs: number
  capped?: boolean
  details: PreSyncDetail[]
}

export async function getPreSyncLog(): Promise<PreSyncRun[]> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PRESYNC_LOG } })
  if (!row) return []
  try {
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as PreSyncRun[]) : []
  } catch {
    return []
  }
}

async function appendPreSyncLog(run: PreSyncRun): Promise<void> {
  const existing = await getPreSyncLog()
  let next = [run, ...existing].slice(0, MAX_LOG_ENTRIES)

  // Trim oldest-first until the serialized blob fits comfortably inside TEXT.
  // A run with many details is the usual cause, so its rows go before the run.
  while (next.length > 1 && JSON.stringify(next).length > MAX_LOG_BYTES) {
    next = next.slice(0, -1)
  }
  if (JSON.stringify(next).length > MAX_LOG_BYTES) {
    next = [{ ...run, details: run.details.slice(0, 5) }]
  }
  await putSetting(PRESYNC_LOG, JSON.stringify(next))
}

// ── Lock ─────────────────────────────────────────────────────────────────────

/**
 * Claim the run lock. Two schedulers (in-process cron + the HTTP cron route)
 * can both fire, and a double run would issue every upstream call twice.
 */
async function acquireLock(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: PRESYNC_LOCK } })
  if (row?.value) {
    const startedAt = Date.parse(row.value)
    if (Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS) return false
  }
  await putSetting(PRESYNC_LOCK, new Date().toISOString())
  return true
}

async function releaseLock(): Promise<void> {
  await putSetting(PRESYNC_LOCK, '')
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface RunPreSyncOptions {
  mode: 'auto' | 'manual'
  /** Override the computed target arrival date (YYYY-MM-DD). Manual runs only. */
  targetDate?: string
  /** Override the configured lead time for this run only. */
  daysBefore?: number
}

/**
 * Refresh every booking arriving on the target date from AppleSystem.
 *
 * Sequential and throttled on purpose: each booking costs a list call plus a
 * quote-template call upstream, and the point of this job is reliability, not
 * speed. One booking failing never stops the rest — its error is recorded in the
 * run log and the sweep continues.
 *
 * Returns null when another run already holds the lock.
 */
export async function runPreArrivalSync(opts: RunPreSyncOptions): Promise<PreSyncRun | null> {
  if (!(await acquireLock())) {
    console.log('[PreArrivalSync] skipped — another run is in progress')
    return null
  }

  const startedAt = Date.now()
  const settings = await getPreSyncSettings()
  const daysBefore = opts.daysBefore != null
    ? clamp(Number(opts.daysBefore), MIN_DAYS, MAX_DAYS)
    : settings.daysBefore
  const targetDate = opts.targetDate ?? dateInTzPlus(daysBefore)

  const details: PreSyncDetail[] = []
  let updated = 0
  let unchanged = 0
  let failed = 0
  let capped = false

  try {
    // Arrival dates are stored as a date at midnight, so a half-open day range
    // matches exactly one calendar day regardless of any stray time component.
    const from = new Date(`${targetDate}T00:00:00.000Z`)
    const to = new Date(from)
    to.setUTCDate(to.getUTCDate() + 1)

    const bookings = await prisma.booking.findMany({
      where: {
        arrivalDate: { gte: from, lt: to },
        // A cancelled or already-finished file is a closed record — leave it be.
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
      select: { bookingRef: true },
      orderBy: { bookingRef: 'asc' },
      take: MAX_BOOKINGS_PER_RUN + 1,
    })

    const targets = bookings.slice(0, MAX_BOOKINGS_PER_RUN)
    capped = bookings.length > MAX_BOOKINGS_PER_RUN

    // Attribute the writes to the automation user so the activity log is honest
    // about who changed the booking. A missing automation user must not abort
    // the sweep — the sync itself only uses the id for logging.
    let actorId: string | null = null
    try {
      actorId = await getAutomationUserId()
    } catch (err) {
      console.error('[PreArrivalSync] no automation user:', err instanceof Error ? err.message : err)
    }

    console.log(
      `[PreArrivalSync] ${opts.mode} run — ${targets.length} booking(s) arriving ${targetDate} ` +
      `(T−${daysBefore}, tz ${TZ})${capped ? ' [capped]' : ''}`,
    )

    for (const b of targets) {
      try {
        const result: AsSyncResult = await syncBookingFromAs(b.bookingRef, {
          actorId,
          actorName: 'Automatic (pre-arrival)',
          mode: 'prearrival',
        })
        if (result.unchanged) {
          unchanged++
          details.push({ bookingRef: b.bookingRef, status: 'unchanged' })
        } else {
          updated++
          const changed = [
            ...result.fields.map((f) => f.field),
            ...result.sections.filter((s) => !s.skipped).map((s) => s.section),
          ]
          details.push({ bookingRef: b.bookingRef, status: 'updated', changed })
        }
      } catch (err) {
        failed++
        const msg = err instanceof AsSyncError
          ? err.message
          : err instanceof Error ? err.message : 'Sync failed'
        details.push({ bookingRef: b.bookingRef, status: 'failed', error: msg.slice(0, 300) })
        console.error(`[PreArrivalSync] ${b.bookingRef}: ${msg}`)
      }

      if (THROTTLE_MS > 0) await new Promise((r) => setTimeout(r, THROTTLE_MS))
    }

    const run: PreSyncRun = {
      at: new Date().toISOString(),
      mode: opts.mode,
      targetDate,
      daysBefore,
      scanned: targets.length,
      updated,
      unchanged,
      failed,
      durationMs: Date.now() - startedAt,
      ...(capped ? { capped: true } : {}),
      details: details.slice(0, MAX_DETAIL_ROWS),
    }
    await appendPreSyncLog(run)
    console.log(
      `[PreArrivalSync] done — ${updated} updated, ${unchanged} unchanged, ${failed} failed ` +
      `in ${Math.round(run.durationMs / 1000)}s`,
    )
    return run
  } finally {
    await releaseLock().catch(() => {})
  }
}

// ── Status for the settings UI ───────────────────────────────────────────────

export interface PreSyncStatus {
  settings: PreSyncSettings
  timezone: string
  /** The arrival date the next run will target, given the current lead time. */
  nextTargetDate: string
  /** How many live bookings arrive on that date right now. */
  nextTargetCount: number
  lastRunDate: string | null
  running: boolean
  runs: PreSyncRun[]
}

export async function getPreSyncStatus(): Promise<PreSyncStatus> {
  const settings = await getPreSyncSettings()
  const nextTargetDate = dateInTzPlus(settings.daysBefore)

  const from = new Date(`${nextTargetDate}T00:00:00.000Z`)
  const to = new Date(from)
  to.setUTCDate(to.getUTCDate() + 1)

  const [nextTargetCount, lastRunRow, lockRow, runs] = await Promise.all([
    prisma.booking.count({
      where: {
        arrivalDate: { gte: from, lt: to },
        status: { notIn: ['CANCELLED', 'COMPLETED'] },
      },
    }),
    prisma.systemSetting.findUnique({ where: { key: PRESYNC_LAST_RUN } }),
    prisma.systemSetting.findUnique({ where: { key: PRESYNC_LOCK } }),
    getPreSyncLog(),
  ])

  const lockStartedAt = lockRow?.value ? Date.parse(lockRow.value) : NaN
  const running = Number.isFinite(lockStartedAt) && Date.now() - lockStartedAt < STALE_LOCK_MS

  return {
    settings,
    timezone: TZ,
    nextTargetDate,
    nextTargetCount,
    lastRunDate: lastRunRow?.value || null,
    running,
    runs,
  }
}

// ── Once-a-day guard, shared by the in-process scheduler and the cron route ───

/**
 * Run today's sweep unless it has already happened. Marks the day as done
 * *before* starting the work, so a restart mid-run cannot double-fire.
 * Returns true when a run was started.
 */
export async function firePreSyncOnce(reason: string): Promise<boolean> {
  const settings = await getPreSyncSettings()
  if (!settings.enabled) {
    console.log(`[PreArrivalSync] ${reason} — skipped (disabled)`)
    return false
  }

  const today = todayInTz()
  const lastRun = await prisma.systemSetting.findUnique({ where: { key: PRESYNC_LAST_RUN } })
  if (lastRun?.value === today) {
    console.log(`[PreArrivalSync] ${reason} — skipped (already ran ${today})`)
    return false
  }

  await putSetting(PRESYNC_LAST_RUN, today)

  void runPreArrivalSync({ mode: 'auto' }).catch((err) => {
    console.error('[PreArrivalSync] background run error:', err instanceof Error ? err.message : err)
  })
  return true
}
