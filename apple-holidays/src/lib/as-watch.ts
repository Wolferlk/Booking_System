/**
 * AppleSystem **Live Confirmation Watch** — continuous near-realtime importer.
 *
 * The daily 06:00 job (`as-import.ts`) imports *yesterday's* confirmations, so a
 * quotation confirmed at 09:00 only reaches the ops system the next morning.
 * This watcher closes that gap: every N minutes it asks AppleSystem for the
 * status-2 confirmations created in a short rolling window and imports whatever
 * is not here yet — typically within minutes of the confirmation happening.
 *
 * It reuses the *exact* same idempotent pipeline as every other import path:
 *
 *   listByCreateDate → getQuoteTemplate → mapQuoteToBooking → importMappedBooking
 *
 * so it can never duplicate or modify an existing booking — `importMappedBooking`
 * short-circuits on a known `bookingRef` and returns it untouched.
 *
 * ── Why a *rolling* window rather than "since last check" ─────────────────────
 * The upstream filter is the quotation's **create date**, not its confirm time.
 * A quote created Monday and confirmed Thursday never appears in a "created
 * today" query, which is exactly how the daily job loses late confirmations.
 * Re-sweeping the last `lookbackDays` days on every tick picks those up the next
 * time the watcher runs, at no extra cost (see the pre-filter below).
 *
 * ── Why re-sweeping is cheap ─────────────────────────────────────────────────
 * A naive re-sweep would call the expensive `getQuoteTemplate` endpoint once per
 * confirmation in the window, every single tick. Instead we normalise each list
 * row's `is_number` into its would-be `bookingRef` and ask our own DB, in one
 * query, which of those already exist — then fetch templates for the remainder
 * only. A quiet tick therefore costs exactly **one** AppleSystem list call and
 * one indexed local SELECT, so a 5-minute interval is entirely affordable.
 *
 * ── The mirror question ──────────────────────────────────────────────────────
 * The same list call also answers *what has AppleSystem cancelled?* — the rows
 * come back in one request, so asking costs nothing extra. Those are handed to
 * `as-watch-cancel.ts`, which never cancels anything: it puts the booking in
 * front of the accounts desk for approval. See that module for the argument.
 *
 * ── Storage ──────────────────────────────────────────────────────────────────
 * Settings, the last-check marker and the check log all live in `system_settings`
 * (KV), matching `as-import.ts`. **No schema change, no migration** — deliberate,
 * because the live DB carries drift and must not be `prisma db push`-ed.
 */

import { prisma } from '@/lib/prisma'
import {
  listByCreateDate,
  getQuoteTemplate,
  withAsRetryBudget,
  resolveCountryName,
  type ASBookingListItem,
} from '@/lib/applesystem'
import { mapQuoteToBooking, normalizeIsNumber, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId } from '@/lib/as-booking-import'
import { detectCountryFromRef } from '@/lib/country-detection'
import { getCancellationDeadline } from '@/lib/utils'
import { raiseAsImportAlert } from '@/lib/as-import-alerts'
import {
  sweepCancellations,
  emptyCancelSummary,
  getCancelActionEnabled,
  listCancelEntries,
  AS_CANCELLED_STATUSES,
  type CancelSweepSummary,
  type CancelEntry,
} from '@/lib/as-watch-cancel'
import {
  recordCreated,
  recordFailure,
  clearFailure,
  markNotified,
  listFailed,
  getImportLedger,
  REASON_LABEL,
  type ImportLedger,
} from '@/lib/as-import-ledger'

// ── Settings / state keys (system_settings) ───────────────────────────────────
export const WATCH_ENABLED   = 'as_watch_enabled'
export const WATCH_INTERVAL  = 'as_watch_interval_minutes'
export const WATCH_LOOKBACK  = 'as_watch_lookback_days'
export const WATCH_LAST_AT   = 'as_watch_last_check_at'
export const WATCH_LOCK      = 'as_watch_lock'
const        WATCH_LOG       = 'as_watch_log'

export const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

/** Bounds for the user-configurable interval, in minutes. */
export const MIN_INTERVAL = 2
export const MAX_INTERVAL = 720
/** Bounds for the rolling create-date window, in days. */
export const MIN_LOOKBACK = 1
export const MAX_LOOKBACK = 30

const DEFAULT_INTERVAL = 15
const DEFAULT_LOOKBACK = 3

/** How many checks the log retains, and its serialized byte budget. */
const MAX_LOG_ENTRIES = 40
/** `system_settings.value` is MySQL TEXT (65,535 bytes) — stay well clear. */
const MAX_LOG_BYTES = 24_000
/** Created refs recorded per check (a burst beyond this is summarised by count). */
const MAX_REFS_PER_CHECK = 25

/**
 * A tick that is still marked running after this long is treated as dead and its
 * lock is broken. Sized above the retry budget below so a slow-but-alive run is
 * never cut in half by the next tick.
 */
const STALE_LOCK_MS = 12 * 60 * 1000
/** Escalating-retry budget for the AppleSystem calls inside one tick. */
const WATCH_RETRY_BUDGET_MS = 4 * 60 * 1000

// ── Settings ──────────────────────────────────────────────────────────────────

export interface WatchSettings {
  enabled: boolean
  intervalMinutes: number
  lookbackDays: number
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

function intOr(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

export async function getWatchSettings(): Promise<WatchSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: [WATCH_ENABLED, WATCH_INTERVAL, WATCH_LOOKBACK] } },
  })
  const map: Record<string, string> = {}
  rows.forEach((r) => { map[r.key] = r.value })

  return {
    // Ships OFF: the watcher polls a live upstream on a timer, so switching it on
    // is an explicit decision made in the UI rather than a silent side effect of
    // deploying. (The daily 06:00 import keeps running either way.)
    enabled:         map[WATCH_ENABLED] === 'true',
    intervalMinutes: intOr(map[WATCH_INTERVAL], DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL),
    lookbackDays:    intOr(map[WATCH_LOOKBACK], DEFAULT_LOOKBACK, MIN_LOOKBACK, MAX_LOOKBACK),
  }
}

export async function saveWatchSettings(s: WatchSettings): Promise<WatchSettings> {
  const next: WatchSettings = {
    enabled:         s.enabled,
    intervalMinutes: clamp(s.intervalMinutes, MIN_INTERVAL, MAX_INTERVAL),
    lookbackDays:    clamp(s.lookbackDays, MIN_LOOKBACK, MAX_LOOKBACK),
  }
  const pairs: [string, string][] = [
    [WATCH_ENABLED,  next.enabled ? 'true' : 'false'],
    [WATCH_INTERVAL, String(next.intervalMinutes)],
    [WATCH_LOOKBACK, String(next.lookbackDays)],
  ]
  await Promise.all(pairs.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
  ))
  return next
}

// ── Check log (compact ring buffer in one KV row) ─────────────────────────────

export interface WatchCheck {
  at: string                      // ISO — when the tick started
  trigger: 'auto' | 'manual'
  durationMs: number
  windowFrom: string              // YYYY-MM-DD create-date window actually swept
  windowTo: string
  found: number                   // status-2 rows upstream in the window
  candidates: number              // rows that survived the already-imported filter
  created: number
  errors: number
  refs: string[]                  // refs created by this check (capped)
  error?: string                  // run-level failure (nothing was imported)
  /**
   * Quotation numbers that failed on this check. Kept so a row can name what it
   * could not import instead of only counting it; the full per-quotation detail
   * (reason, attempts, first seen) lives in the import ledger.
   */
  failedQuotations?: string[]
  /**
   * What the same sweep found *withdrawn* upstream. Optional because every check
   * logged before the cancellation watch existed has none, and a missing field
   * must read as "not looked for", not as "nothing found".
   */
  cancel?: CancelSweepSummary
}

async function readLog(): Promise<WatchCheck[]> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: WATCH_LOG } })
    if (!row?.value) return []
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as WatchCheck[]) : []
  } catch {
    return []
  }
}

/** Serialize newest-first, dropping the oldest entries until it fits the budget. */
function serializeLog(entries: WatchCheck[]): string {
  const list = entries.slice(0, MAX_LOG_ENTRIES)
  while (list.length > 1 && Buffer.byteLength(JSON.stringify(list), 'utf8') > MAX_LOG_BYTES) {
    list.pop()
  }
  return JSON.stringify(list)
}

async function appendCheck(check: WatchCheck): Promise<void> {
  const log = await readLog()
  log.unshift(check)
  const value = serializeLog(log)
  await prisma.systemSetting.upsert({
    where: { key: WATCH_LOG }, update: { value }, create: { key: WATCH_LOG, value },
  })
}

export async function listChecks(limit = MAX_LOG_ENTRIES): Promise<WatchCheck[]> {
  return (await readLog()).slice(0, limit)
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** The inclusive create-date window the watcher sweeps: the last N days up to today. */
export function watchWindow(lookbackDays: number): { from: string; to: string } {
  const to = todayInTz()
  const d = new Date(`${to}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - (Math.max(1, lookbackDays) - 1))
  return { from: d.toISOString().slice(0, 10), to }
}

// ── Overlap lock ──────────────────────────────────────────────────────────────

/**
 * Claim the watcher lock. Returns false when another tick is genuinely still
 * running, true when the lock was free or had gone stale.
 *
 * Two ticks importing the same window concurrently would still be *safe* —
 * `importMappedBooking` is idempotent — but they would double the upstream load
 * for no benefit, so overlapping runs are simply skipped.
 */
async function acquireLock(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: WATCH_LOCK } })
  if (row?.value) {
    const startedAt = Date.parse(row.value)
    if (Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS) return false
  }
  const value = new Date().toISOString()
  await prisma.systemSetting.upsert({
    where: { key: WATCH_LOCK }, update: { value }, create: { key: WATCH_LOCK, value },
  })
  return true
}

async function releaseLock(): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: WATCH_LOCK }, update: { value: '' }, create: { key: WATCH_LOCK, value: '' },
  }).catch(() => {})
}

export async function isWatchRunning(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: WATCH_LOCK } })
  if (!row?.value) return false
  const startedAt = Date.parse(row.value)
  return Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS
}

// ── The pre-filter that makes frequent polling affordable ─────────────────────

/**
 * Split the upstream rows into those we already hold and those worth fetching.
 *
 * A row's `bookingRef` is its `is_number` with spaces stripped and upper-cased
 * (`"MY 40060"` → `"MY40060"`) — the same normalisation `mapQuoteToBooking`
 * applies — so the ref can be predicted from the *list* response, before the
 * costly per-quotation template call.
 *
 * Rows whose `is_number` is missing or the upstream placeholder `"NA"` cannot be
 * predicted; they are always treated as candidates and resolved by fetching the
 * template, where `importMappedBooking` still de-duplicates them safely.
 */
async function selectCandidates(items: ASBookingListItem[]): Promise<ASBookingListItem[]> {
  const refOf = (it: ASBookingListItem): string | null => {
    const raw = normalizeIsNumber(String(it.is_number ?? ''))
    return !raw || raw === 'NA' ? null : raw
  }

  const predictable = items.filter((it) => refOf(it) !== null)
  if (predictable.length === 0) return items

  const refs = Array.from(new Set(predictable.map((it) => refOf(it) as string)))
  const existing = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: { bookingRef: true },
  })
  const have = new Set(existing.map((b) => b.bookingRef))

  return items.filter((it) => {
    const ref = refOf(it)
    return ref === null || !have.has(ref)
  })
}

// ── The watcher tick ──────────────────────────────────────────────────────────

export interface RunWatchParams {
  trigger: 'auto' | 'manual'
  triggeredById?: string
}

export type RunWatchOutcome =
  | { ran: true; check: WatchCheck }
  | { ran: false; reason: 'disabled' | 'already-running' }

/**
 * Run one watch cycle to completion.
 *
 * `force` (used by the "Fetch now" button) bypasses only the *enabled* check —
 * a manual fetch must work even while the automatic watch is switched off. The
 * overlap lock is always respected.
 */
export async function runAsWatch(
  params: RunWatchParams & { force?: boolean },
): Promise<RunWatchOutcome> {
  const settings = await getWatchSettings()
  if (!settings.enabled && !params.force) return { ran: false, reason: 'disabled' }

  if (!(await acquireLock())) return { ran: false, reason: 'already-running' }

  const startedAt = new Date()
  const { from, to } = watchWindow(settings.lookbackDays)

  const check: WatchCheck = {
    at: startedAt.toISOString(),
    trigger: params.trigger,
    durationMs: 0,
    windowFrom: from,
    windowTo: to,
    found: 0,
    candidates: 0,
    created: 0,
    errors: 0,
    refs: [],
    failedQuotations: [],
  }

  /** Quotations failing for the first time on this tick — the only ones worth an alert. */
  const newlyFailed: string[] = []

  try {
    const triggeredById = params.triggeredById ?? (await getAutomationUserId())

    await withAsRetryBudget(WATCH_RETRY_BUDGET_MS, async () => {
      // One call, both questions. Asking for the confirmed and the cancelled
      // statuses together costs the same single request as asking for status 2
      // alone did, and the two populations are partitioned here rather than by
      // a second sweep that could see a different moment upstream.
      const { items } = await listByCreateDate({
        fromCreateDate: from,
        toCreateDate: to,
        statuses: ['2', ...AS_CANCELLED_STATUSES],
      })

      const confirmed = items.filter((it) => String(it.status ?? '') === '2')
      const cancelled = items.filter((it) =>
        (AS_CANCELLED_STATUSES as readonly string[]).includes(String(it.status ?? '')))

      check.found = confirmed.length

      const candidates = await selectCandidates(confirmed)
      check.candidates = candidates.length

      for (const it of candidates) {
        const quotationNo = String(it.quotation_no ?? '').trim()
        // The template endpoint keys on the row's `id`; its `reference_id` field
        // is just the quotation number and returns an empty "NA" stub here.
        const referenceId = String(it.id ?? it.reference_id ?? '').trim()

        /** Record one failure against the ledger and this check, uniformly. */
        const fail = async (message: string, ref: string | null = null) => {
          check.errors++
          check.failedQuotations?.push(quotationNo || '—')
          console.error(`[AsWatch] q${quotationNo} failed:`, message)
          if (!quotationNo) return
          const { isNew } = await recordFailure({
            quotationNo,
            ref,
            country: resolveCountryName(it),
            message,
            source: 'watch',
          })
          if (isNew) newlyFailed.push(quotationNo)
        }

        if (!quotationNo || !referenceId) {
          await fail('Missing quotation/reference id on the AppleSystem list row')
          continue
        }

        try {
          const quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
          const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: it.is_number })
          const country = mapped.operationCountry ?? detectCountryFromRef(mapped.bookingRef)
          if (!country) {
            await fail('Could not determine the destination country from the IS number.', mapped.bookingRef)
            continue
          }

          const { booking, alreadyExists } = await importMappedBooking(mapped, country, {
            createdById: triggeredById,
            cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
          })
          // Whether it was created now or already present, this quotation is no
          // longer a problem — drop any open failure so a future one is heard.
          await clearFailure(quotationNo)
          if (alreadyExists) continue

          check.created++
          if (check.refs.length < MAX_REFS_PER_CHECK) check.refs.push(booking.bookingRef)
          await recordCreated({
            ref: booking.bookingRef,
            bookingId: booking.id,
            quotationNo,
            country,
            source: 'watch',
            arrivalDate: mapped.arrivalDate ?? null,
            guestName: mapped.passengers[0]?.name ?? null,
          })
        } catch (err) {
          const msg = err instanceof ASMappingError || err instanceof Error ? err.message : String(err)
          await fail(msg)
        }
      }

      // Withdrawals last: an import that failed must not cost the tick its
      // cancellations, and a cancellation must not pre-empt an import — a
      // quotation confirmed and cancelled in the same window is imported first
      // so the file exists to be withdrawn.
      try {
        check.cancel = await sweepCancellations(cancelled, triggeredById)
      } catch (err) {
        // The watch's first duty is importing. A cancellation sweep that cannot
        // read its own ledger is reported and retried, never allowed to fail the
        // tick that has just imported bookings successfully.
        console.error('[AsWatch] cancellation sweep failed:', err instanceof Error ? err.message : err)
        check.cancel = { ...emptyCancelSummary(), upstream: cancelled.length }
      }
    })
  } catch (err) {
    check.error = err instanceof Error ? err.message : String(err)
    console.error('[AsWatch] check failed:', check.error)
  } finally {
    check.durationMs = Date.now() - startedAt.getTime()
    await releaseLock()
  }

  await prisma.systemSetting.upsert({
    where:  { key: WATCH_LAST_AT },
    update: { value: check.at },
    create: { key: WATCH_LAST_AT, value: check.at },
  }).catch(() => {})

  await appendCheck(check).catch((err) => {
    console.error('[AsWatch] could not write check log:', err instanceof Error ? err.message : err)
  })

  if (check.created || check.errors || check.error || check.cancel?.requested) {
    console.log(
      `[AsWatch] ${params.trigger} ${from}→${to}: found=${check.found} new=${check.candidates} ` +
      `created=${check.created} errors=${check.errors} ` +
      `cancelled=${check.cancel?.matched ?? 0}/${check.cancel?.requested ?? 0} (${check.durationMs}ms)`,
    )
  }

  await notifyOnFailure(check, newlyFailed)
  return { ran: true, check }
}

/**
 * Alert only on a *sustained*, and *unreported*, problem.
 *
 * The watcher runs many times an hour against an upstream that occasionally
 * blips, so alerting on a single failed tick would be pure noise — the next tick
 * usually recovers on its own. Three consecutive failures is a real outage, and
 * the dedup signature keeps it to one alert per outage rather than one per tick.
 *
 * Per-booking failures are governed by the import ledger rather than by time:
 * `newlyFailed` holds only the quotations that had never failed this way before,
 * so a quotation AppleSystem will never let us import — no IS number, say — is
 * announced exactly once instead of on every sweep for as long as it sits in the
 * rolling window. It keeps being retried, and keeps being listed on the Live
 * Watch page; it just stops mailing anyone about it.
 */
async function notifyOnFailure(check: WatchCheck, newlyFailed: string[]): Promise<void> {
  if (!check.error && check.errors === 0) return

  if (check.error) {
    const recent = (await readLog()).slice(0, 3)
    if (recent.length < 3 || !recent.every((c) => c.error)) return
    await raiseAsImportAlert({
      severity: 'error',
      title: 'Live confirmation watch is failing',
      message:
        `The last 3 checks could not reach AppleSystem — latest error: ${check.error}. ` +
        `New confirmations are not being imported in realtime; the daily 06:00 import is unaffected.`,
      signature: 'watch-run-failed',
      jobMode: 'auto',
      dateFrom: check.windowFrom,
      dateTo: check.windowTo,
      totalFound: check.found,
      totalCreated: check.created,
      totalErrors: check.errors,
    })
    return
  }

  // Everything that failed here has already been reported (or dismissed). Retries
  // continue; nobody needs telling again.
  if (newlyFailed.length === 0) {
    console.log(
      `[AsWatch] ${check.errors} failed, all previously reported — alert and email suppressed`,
    )
    return
  }

  const failed = await listFailed()
  const detail = newlyFailed
    .map((q) => {
      const e = failed.find((f) => f.quotationNo === q)
      return e ? `q${q} — ${REASON_LABEL[e.reason]}` : `q${q}`
    })
    .join(' · ')

  await raiseAsImportAlert({
    severity: 'warning',
    title: `Live watch could not import ${newlyFailed.length} new confirmation${newlyFailed.length === 1 ? '' : 's'}`,
    message:
      `${detail}. ` +
      `Swept create dates ${check.windowFrom} → ${check.windowTo}; ${check.created} created, ` +
      `${check.errors} failed in total (the rest were already reported). ` +
      `Open the Live Watch page for the full list — you will not be emailed about these again.`,
    // Identity is the set of newly-failing quotations, so a different booking
    // failing later still gets through while a repeat of these never does.
    signature: `watch-items-failed::${[...newlyFailed].sort().join(',')}`,
    jobMode: 'auto',
    dateFrom: check.windowFrom,
    dateTo: check.windowTo,
    totalFound: check.found,
    totalCreated: check.created,
    totalErrors: check.errors,
  })

  await markNotified(newlyFailed)
}

// ── Status for the UI ─────────────────────────────────────────────────────────

export interface WatchStatus {
  settings: WatchSettings
  timezone: string
  running: boolean
  lastCheckAt: string | null
  /** ISO instant of the next automatic check, or null when the watch is off. */
  nextCheckAt: string | null
  window: { from: string; to: string }
  lastCheck: WatchCheck | null
  checks: WatchCheck[]
  /** Rolled-up totals across the retained log — the "since" is `checks[last].at`. */
  totals: { checks: number; created: number; errors: number }
  /**
   * Which bookings were actually created, and which quotations could not be —
   * one row per booking rather than a count repeated on every check.
   */
  ledger: ImportLedger
  /**
   * The cancellation side of the same sweep: what AppleSystem has withdrawn,
   * and where each one has got to. `actionEnabled` is the gate on acting — when
   * it is off every detection waits in the list for a person.
   */
  cancellations: { actionEnabled: boolean; entries: CancelEntry[] }
}

export async function getWatchStatus(logLimit = 12): Promise<WatchStatus> {
  const [settings, lastAtRow, log, running, ledger, cancelActionEnabled, cancelEntries] =
    await Promise.all([
      getWatchSettings(),
      prisma.systemSetting.findUnique({ where: { key: WATCH_LAST_AT } }),
      readLog(),
      isWatchRunning(),
      getImportLedger(),
      getCancelActionEnabled(),
      listCancelEntries(25),
    ])

  const lastCheckAt = lastAtRow?.value || null
  const nextCheckAt = settings.enabled && lastCheckAt
    ? new Date(Date.parse(lastCheckAt) + settings.intervalMinutes * 60_000).toISOString()
    : null

  return {
    settings,
    timezone: TZ,
    running,
    lastCheckAt,
    nextCheckAt,
    window: watchWindow(settings.lookbackDays),
    lastCheck: log[0] ?? null,
    checks: log.slice(0, logLimit),
    totals: {
      checks:  log.length,
      created: log.reduce((n, c) => n + c.created, 0),
      // Count *distinct* problem quotations, not one per retry: the old sum
      // grew by two on every sweep for the same two stuck bookings, which is
      // how "Problems: 80" came to mean "2 bookings, 40 checks".
      errors:  ledger.failed.filter((f) => !f.dismissedAt).length
               + log.filter((c) => c.error).length,
    },
    ledger,
    cancellations: { actionEnabled: cancelActionEnabled, entries: cancelEntries },
  }
}
