/**
 * AppleSystem **confirmation reconciliation** — the parity guarantee.
 *
 * The importers that came before this one are all *push* shaped: something
 * happens upstream, and a job hopes to be looking at the right window when it
 * does. The daily 06:00 job imports yesterday's confirmations; the Live Watch
 * sweeps a rolling create-date window every few minutes and creates whatever is
 * new. Both create bookings, neither ever *checks its own work* — so a
 * confirmation the upstream list returned while AppleSystem was half-down, or a
 * quote whose template call failed once, simply stays missing, and nothing in
 * the system knows the two sides disagree.
 *
 * This module is the *pull* shape. Every 15 minutes it asks one question and
 * answers it completely:
 *
 *   > For every quotation AppleSystem created in the last N days, is this
 *   > system holding exactly what AppleSystem holds — no fewer, no staler, and
 *   > nothing it has since withdrawn?
 *
 * and it repairs each of the three ways that can be false:
 *
 *   1. **Missing**   — status 2 upstream, absent here → import it (same
 *      idempotent pipeline as every other path, so a race can never duplicate).
 *   2. **Stale**     — here, but the upstream row has changed since we last
 *      looked → refresh its *content* in place via `syncBookingFromAs`, which
 *      never touches workflow state, tickets, drivers, P&L or the timeline.
 *   3. **Withdrawn** — here (so it *was* status 2 when we imported it) but the
 *      upstream row is no longer status 2 → cancel it, under the guards below.
 *
 * Every run writes a per-create-date ledger so the daily operations report can
 * state the two numbers side by side — AppleSystem confirmed N, this system
 * holds N — and say so plainly when they differ.
 *
 * ── One list call per run ─────────────────────────────────────────────────────
 * The window is listed **once, unfiltered by status**, and partitioned locally.
 * That single call yields both the confirmed set (for 1 and 2) and the
 * not-confirmed set (for 3); asking twice would double the upstream load for
 * information we already have. Per-quotation template calls are then made only
 * for the rows that actually need one — a quiet tick costs one upstream list
 * call and two indexed local queries.
 *
 * ── How "stale" is decided, without trusting a timezone ───────────────────────
 * Upstream timestamps arrive as bare `"YYYY-MM-DD HH:mm:ss"` with no offset, so
 * comparing them to our own instants would silently bake in whatever the server
 * clock's zone happens to be. Instead each row gets a **fingerprint** — its
 * status, its raw `updated_at` string and its three amendment counters — and a
 * ref is stale exactly when its fingerprint differs from the one recorded on the
 * previous run. Timezone-free, and it detects an amendment rather than guessing
 * at one. The first sighting of a ref only records a baseline; a booking is
 * never re-synced merely for being new to the reconciler.
 *
 * Alongside that, a booking holding **no itinerary and no accommodation** is
 * treated as incomplete and refreshed once regardless of fingerprint — that is
 * the shape a half-failed import leaves behind, and it is the literal case of
 * "the booking is here but is not fully updated".
 *
 * ── Guards on the cancellation path ───────────────────────────────────────────
 * Withdrawing a booking is the only destructive thing here, so it is the most
 * heavily fenced:
 *
 *   • **Two strikes.** A ref must be seen off status 2 on two separate runs at
 *     least {@link MIN_DRIFT_AGE_MS} apart. A single blip mid-edit upstream
 *     cancels nothing.
 *   • **Never a live tour.** A booking whose arrival has already come is
 *     flagged and alerted, never auto-cancelled — operations may be running it.
 *   • **Never over a person.** A booking already cancelled, already pending
 *     cancellation, completed, or carrying a human cancellation request is left
 *     exactly as it is.
 *   • **Nothing is deleted.** The booking, its passengers, hotels, itinerary and
 *     history all remain; `cancelPrevStatus` records what it was, so the change
 *     is one field away from being undone.
 *   • A switch (`as_reconcile_autocancel_enabled`) turns the action off and
 *     leaves the detection on — the drift is then reported, not acted upon.
 *
 * ── Storage ───────────────────────────────────────────────────────────────────
 * Settings, the run log, the fingerprint map, the drift markers and the daily
 * ledger all live in `system_settings` (KV). **No schema change, no migration** —
 * deliberate, because the live DB carries drift and must never be pushed to.
 */

import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  listByCreateDate,
  getQuoteTemplate,
  withAsRetryBudget,
  type ASBookingListItem,
} from '@/lib/applesystem'
import { mapQuoteToBooking, normalizeIsNumber, ASMappingError } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId } from '@/lib/as-booking-import'
import { syncBookingFromAs, getSyncStates, AsSyncError } from '@/lib/as-booking-sync'
import { detectCountryFromRef } from '@/lib/country-detection'
import { getCancellationDeadline } from '@/lib/utils'
import { raiseAsImportAlert } from '@/lib/as-import-alerts'
import { logActivity, ACTION } from '@/lib/activity'

// ── Settings / state keys (system_settings) ───────────────────────────────────

export const RECONCILE_ENABLED     = 'as_reconcile_enabled'
export const RECONCILE_INTERVAL    = 'as_reconcile_interval_minutes'
export const RECONCILE_LOOKBACK    = 'as_reconcile_lookback_days'
export const RECONCILE_REFRESH     = 'as_reconcile_refresh_enabled'
export const RECONCILE_AUTOCANCEL  = 'as_reconcile_autocancel_enabled'
export const RECONCILE_LAST_AT     = 'as_reconcile_last_run_at'
const        RECONCILE_LOCK        = 'as_reconcile_lock'
const        RECONCILE_LOG         = 'as_reconcile_log'
const        RECONCILE_PRINTS      = 'as_reconcile_fingerprints'
const        RECONCILE_DRIFT       = 'as_reconcile_drift'
/** One row per create-date; read by the daily report. */
export const RECONCILE_DAY_PREFIX  = 'as_reconcile_day:'

export const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

/** Name stamped on every booking this module cancels — the report keys off it. */
export const RECONCILE_ACTOR = 'AppleSystem reconciliation'

// ── Bounds and budgets ────────────────────────────────────────────────────────

export const MIN_INTERVAL = 5
export const MAX_INTERVAL = 720
export const MIN_LOOKBACK = 1
export const MAX_LOOKBACK = 30

const DEFAULT_INTERVAL = 15
const DEFAULT_LOOKBACK = 2

/** Ring-buffer log size and its serialized byte budget (`value` is MySQL TEXT). */
const MAX_LOG_ENTRIES = 40
const MAX_LOG_BYTES   = 26_000
/** Refs listed per run in the log / ledger before we fall back to counting. */
const MAX_REFS = 25

/** Content refreshes attempted per run — the rest carry to the next tick. */
const MAX_SYNCS_PER_RUN = 20
/** Missing bookings imported per run, so one bad day cannot stall the loop. */
const MAX_IMPORTS_PER_RUN = 60

/** A run still marked running after this is treated as dead and its lock broken. */
const STALE_LOCK_MS = 14 * 60 * 1000
/** Escalating-retry budget for the AppleSystem calls inside one run. */
const RECONCILE_RETRY_BUDGET_MS = 5 * 60 * 1000

/**
 * How long a ref must have been off status 2 before it is actually cancelled.
 * Sized above one interval so the decision always spans two independent runs.
 */
const MIN_DRIFT_AGE_MS = 20 * 60 * 1000

/** Fingerprint map bounds — it only needs the rolling window plus a little slack. */
const MAX_PRINTS = 2_000
const PRINT_TTL_DAYS = 40
/** Daily ledger rows older than this are pruned. */
const LEDGER_TTL_DAYS = 180

// ── Settings ──────────────────────────────────────────────────────────────────

export interface ReconcileSettings {
  /** Master switch for the automatic 15-minute loop. */
  enabled: boolean
  intervalMinutes: number
  lookbackDays: number
  /** Refresh bookings whose upstream row changed. Detection runs either way. */
  refreshEnabled: boolean
  /** Act on withdrawn confirmations. Off = detect and report only. */
  autoCancelEnabled: boolean
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

function intOr(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

export async function getReconcileSettings(): Promise<ReconcileSettings> {
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: {
        in: [RECONCILE_ENABLED, RECONCILE_INTERVAL, RECONCILE_LOOKBACK, RECONCILE_REFRESH, RECONCILE_AUTOCANCEL],
      },
    },
  })
  const map: Record<string, string> = {}
  rows.forEach((r) => { map[r.key] = r.value })

  return {
    // Ships ON. Unlike the Live Watch, this loop's default action set is
    // read-and-repair-what-is-missing, which is the behaviour the system is
    // supposed to have had all along.
    enabled:           map[RECONCILE_ENABLED]   !== 'false',
    intervalMinutes:   intOr(map[RECONCILE_INTERVAL], DEFAULT_INTERVAL, MIN_INTERVAL, MAX_INTERVAL),
    lookbackDays:      intOr(map[RECONCILE_LOOKBACK], DEFAULT_LOOKBACK, MIN_LOOKBACK, MAX_LOOKBACK),
    refreshEnabled:    map[RECONCILE_REFRESH]   !== 'false',
    autoCancelEnabled: map[RECONCILE_AUTOCANCEL] !== 'false',
  }
}

export async function saveReconcileSettings(s: ReconcileSettings): Promise<ReconcileSettings> {
  const next: ReconcileSettings = {
    enabled:           s.enabled,
    intervalMinutes:   clamp(s.intervalMinutes, MIN_INTERVAL, MAX_INTERVAL),
    lookbackDays:      clamp(s.lookbackDays, MIN_LOOKBACK, MAX_LOOKBACK),
    refreshEnabled:    s.refreshEnabled,
    autoCancelEnabled: s.autoCancelEnabled,
  }
  const pairs: [string, string][] = [
    [RECONCILE_ENABLED,    next.enabled ? 'true' : 'false'],
    [RECONCILE_INTERVAL,   String(next.intervalMinutes)],
    [RECONCILE_LOOKBACK,   String(next.lookbackDays)],
    [RECONCILE_REFRESH,    next.refreshEnabled ? 'true' : 'false'],
    [RECONCILE_AUTOCANCEL, next.autoCancelEnabled ? 'true' : 'false'],
  ]
  await Promise.all(pairs.map(([key, value]) =>
    prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } }),
  ))
  return next
}

// ── KV helpers ────────────────────────────────────────────────────────────────

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } })
    if (!row?.value) return fallback
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await writeRaw(key, JSON.stringify(value))
}

/**
 * Write a bare string. The lock and the last-run marker are read back with
 * `Date.parse`, so they must be stored unquoted — JSON-encoding them would make
 * every subsequent parse return NaN, and a lock that never parses is a lock that
 * never holds.
 */
async function writeRaw(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key }, update: { value }, create: { key, value },
  })
}

// ── Run log ───────────────────────────────────────────────────────────────────

/** One booking the run acted on, for the UI's activity feed. */
export interface ReconcileAction {
  ref: string
  kind: 'created' | 'refreshed' | 'cancelled' | 'flagged' | 'error'
  detail?: string
}

export interface ReconcileRun {
  at: string                   // ISO — when the run started
  trigger: 'auto' | 'manual'
  durationMs: number
  windowFrom: string           // create-date window swept
  windowTo: string

  /** Rows upstream in the window, all statuses. */
  scanned: number
  /** Of those, status 2 — the number this system must match. */
  upstreamConfirmed: number
  /** Confirmed rows already held locally when the run started. */
  presentBefore: number

  /** Confirmed rows found missing, and how that was resolved. */
  missing: number
  created: number
  importErrors: number

  /** Amended upstream, and refreshed in place. */
  stale: number
  refreshed: number
  unchanged: number
  syncErrors: number
  /** Stale rows deferred past this run's cap. */
  refreshBacklog: number

  /** Held here but no longer status 2 upstream. */
  drifted: number
  cancelled: number
  /** Drift seen for the first time — waiting for a second sighting. */
  awaitingSecondSighting: number
  /** Drift on a booking that must not be auto-cancelled; a person decides. */
  flagged: number

  /** True when, after the run, every upstream confirmation is held here. */
  inParity: boolean
  /** Still missing when the run finished (import failed, or past the cap). */
  unresolved: number
  unresolvedRefs: string[]

  actions: ReconcileAction[]
  /** Run-level failure — the window could not be reconciled at all. */
  error?: string
}

function serializeLog(entries: ReconcileRun[]): string {
  const list = entries.slice(0, MAX_LOG_ENTRIES)
  // Older runs keep their tallies but shed their per-booking detail first: the
  // UI only ever renders actions for the newest few.
  const fits = (l: ReconcileRun[]) => Buffer.byteLength(JSON.stringify(l), 'utf8') <= MAX_LOG_BYTES
  if (fits(list)) return JSON.stringify(list)

  for (const keepFull of [8, 3, 1]) {
    const trimmed = list.map((r, i) => (i < keepFull ? r : { ...r, actions: [], unresolvedRefs: [] }))
    if (fits(trimmed)) return JSON.stringify(trimmed)
  }

  const stripped = list.map((r) => ({ ...r, actions: [], unresolvedRefs: [] }))
  while (stripped.length > 1 && !fits(stripped)) stripped.pop()
  return JSON.stringify(stripped)
}

async function appendRun(run: ReconcileRun): Promise<void> {
  const log = await readJson<ReconcileRun[]>(RECONCILE_LOG, [])
  const list = Array.isArray(log) ? log : []
  list.unshift(run)
  await prisma.systemSetting.upsert({
    where:  { key: RECONCILE_LOG },
    update: { value: serializeLog(list) },
    create: { key: RECONCILE_LOG, value: serializeLog(list) },
  })
}

export async function listRuns(limit = MAX_LOG_ENTRIES): Promise<ReconcileRun[]> {
  const log = await readJson<ReconcileRun[]>(RECONCILE_LOG, [])
  return (Array.isArray(log) ? log : []).slice(0, limit)
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

function todayInTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The inclusive create-date window a run sweeps: the last N days up to today. */
export function reconcileWindow(lookbackDays: number): { from: string; to: string } {
  const to = todayInTz()
  return { from: shiftDate(to, -(Math.max(1, lookbackDays) - 1)), to }
}

/** Every date in an inclusive `yyyy-mm-dd` range. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = shiftDate(d, 1)) out.push(d)
  return out
}

// ── Row helpers ───────────────────────────────────────────────────────────────

/**
 * The `bookingRef` a list row *would* import as — its `is_number` normalised,
 * exactly as `mapQuoteToBooking` does it. Null when upstream has not assigned
 * one yet (`""` or the `"NA"` placeholder), in which case only the template call
 * can tell us the ref.
 */
function refOf(row: ASBookingListItem): string | null {
  const raw = normalizeIsNumber(String(row.is_number ?? ''))
  return !raw || raw === 'NA' ? null : raw
}

function isConfirmed(row: ASBookingListItem): boolean {
  return String(row.status ?? '').trim() === '2'
}

/** The upstream's own create date (`yyyy-mm-dd`), matching the list filter. */
function createDateOf(row: ASBookingListItem, fallback: string): string {
  const node = row.created_at
  const raw = typeof node === 'string' ? node : node?.date
  const date = raw?.slice(0, 10)
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback
}

/**
 * A change-detecting signature for one upstream row.
 *
 * Deliberately built from the *raw* strings the list returns rather than parsed
 * instants: a bare `"2026-08-27 14:03:11"` carries no offset, and interpreting
 * it would make correctness depend on the server's timezone. Equality of the
 * raw text is the honest test of "this row has not moved".
 */
function fingerprintOf(row: ASBookingListItem): string {
  const updated = typeof row.updated_at === 'string' ? row.updated_at : row.updated_at?.date ?? ''
  return [
    String(row.status ?? ''),
    updated,
    row.quotation_update_count_R ?? 0,
    row.quotation_update_count_C ?? 0,
    row.quotation_update_count_X ?? 0,
  ].join('|')
}

// ── Fingerprint map (one KV row, pruned) ──────────────────────────────────────

interface PrintEntry {
  /** The row fingerprint as of the last time this ref was looked at. */
  f: string
  /** When that fingerprint was recorded, ISO. */
  t: string
  /**
   * Set once the completeness repair below has been attempted for this ref.
   *
   * A booking holding no itinerary and no accommodation is refreshed once on the
   * suspicion that its import half-failed. But some bookings genuinely have
   * neither upstream, and `syncBookingFromAs` refuses to apply an empty list —
   * so without this flag the same ref would be re-synced on every single run,
   * forever, for a gap that cannot be closed. One attempt is the right number.
   */
  c?: 1
}
type PrintMap = Record<string, PrintEntry>

async function readPrints(): Promise<PrintMap> {
  const raw = await readJson<PrintMap>(RECONCILE_PRINTS, {})
  return raw && typeof raw === 'object' ? raw : {}
}

/** Drop entries older than the TTL, then the oldest of whatever still overflows. */
function prunePrints(map: PrintMap): PrintMap {
  const cutoff = Date.now() - PRINT_TTL_DAYS * 86_400_000
  let entries = Object.entries(map).filter(([, v]) => {
    const t = Date.parse(v?.t ?? '')
    return Number.isFinite(t) && t >= cutoff
  })
  if (entries.length > MAX_PRINTS) {
    entries.sort((a, b) => Date.parse(b[1].t) - Date.parse(a[1].t))
    entries = entries.slice(0, MAX_PRINTS)
  }
  return Object.fromEntries(entries)
}

// ── Drift markers (one KV row) ────────────────────────────────────────────────

interface DriftEntry {
  /** When this ref was first seen off status 2. */
  firstSeenAt: string
  /** The upstream status it drifted to, for the audit trail. */
  status: string
}
type DriftMap = Record<string, DriftEntry>

async function readDrift(): Promise<DriftMap> {
  const raw = await readJson<DriftMap>(RECONCILE_DRIFT, {})
  return raw && typeof raw === 'object' ? raw : {}
}

// ── Daily ledger ──────────────────────────────────────────────────────────────

/**
 * What one create-date looked like the last time it was reconciled, plus the
 * running totals of everything this module did to it. Read by the daily report,
 * which is why the snapshot and the cumulative counters are kept apart: the
 * report needs "AppleSystem said N, we hold M" *as of now*, and "we created X
 * and cancelled Y getting there" *over the day*.
 */
export interface ReconcileDay {
  date: string
  /** Snapshot, overwritten every run. */
  upstreamConfirmed: number
  systemHeld: number
  missing: number
  missingRefs: string[]
  /** Cumulative across every run that touched this date. */
  createdTotal: number
  refreshedTotal: number
  cancelledTotal: number
  flaggedTotal: number
  errorsTotal: number
  runs: number
  lastRunAt: string
  /** Bookings withdrawn upstream and cancelled here, capped. */
  cancelled: { ref: string; at: string; prevStatus: string; upstreamStatus: string }[]
}

function dayKey(date: string): string { return `${RECONCILE_DAY_PREFIX}${date}` }

function emptyDay(date: string): ReconcileDay {
  return {
    date,
    upstreamConfirmed: 0, systemHeld: 0, missing: 0, missingRefs: [],
    createdTotal: 0, refreshedTotal: 0, cancelledTotal: 0, flaggedTotal: 0, errorsTotal: 0,
    runs: 0, lastRunAt: '', cancelled: [],
  }
}

export async function getReconcileDay(date: string): Promise<ReconcileDay | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: dayKey(date) } })
  if (!row?.value) return null
  try {
    const parsed = JSON.parse(row.value) as ReconcileDay
    return parsed && typeof parsed.date === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** The ledger rows for a date range, in date order. Missing days are omitted. */
export async function getReconcileDays(from: string, to: string): Promise<ReconcileDay[]> {
  const dates = datesInRange(from, to)
  if (!dates.length) return []
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: dates.map(dayKey) } },
  })
  const out: ReconcileDay[] = []
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.value) as ReconcileDay
      if (parsed && typeof parsed.date === 'string') out.push(parsed)
    } catch { /* a corrupt ledger row must not break a report */ }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Ledger rows are small but eternal without this. */
async function pruneLedger(): Promise<void> {
  const cutoff = shiftDate(todayInTz(), -LEDGER_TTL_DAYS)
  await prisma.systemSetting.deleteMany({
    where: { key: { startsWith: RECONCILE_DAY_PREFIX, lt: dayKey(cutoff) } },
  }).catch(() => {})
}

// ── Overlap lock ──────────────────────────────────────────────────────────────

async function acquireLock(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RECONCILE_LOCK } })
  if (row?.value) {
    const startedAt = Date.parse(row.value)
    if (Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS) return false
  }
  await writeRaw(RECONCILE_LOCK, new Date().toISOString())
  return true
}

async function releaseLock(): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: RECONCILE_LOCK }, update: { value: '' }, create: { key: RECONCILE_LOCK, value: '' },
  }).catch(() => {})
}

export async function isReconcileRunning(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: RECONCILE_LOCK } })
  if (!row?.value) return false
  const startedAt = Date.parse(row.value)
  return Number.isFinite(startedAt) && Date.now() - startedAt < STALE_LOCK_MS
}

// ── Local snapshot of everything the window refers to ─────────────────────────

interface LocalBooking {
  id: string
  bookingRef: string
  status: BookingStatus
  arrivalDate: Date
  departureDate: Date
  createdAt: Date
  cancelRequestedAt: Date | null
  itineraryCount: number
  accommodationCount: number
}

async function loadLocal(refs: string[]): Promise<Map<string, LocalBooking>> {
  const out = new Map<string, LocalBooking>()
  if (!refs.length) return out

  const rows = await prisma.booking.findMany({
    where: { bookingRef: { in: refs } },
    select: {
      id: true, bookingRef: true, status: true,
      arrivalDate: true, departureDate: true, createdAt: true, cancelRequestedAt: true,
      _count: { select: { itineraryItems: true, accommodations: true } },
    },
  })

  for (const r of rows) {
    out.set(r.bookingRef, {
      id: r.id,
      bookingRef: r.bookingRef,
      status: r.status,
      arrivalDate: r.arrivalDate,
      departureDate: r.departureDate,
      createdAt: r.createdAt,
      cancelRequestedAt: r.cancelRequestedAt,
      itineraryCount: r._count.itineraryItems,
      accommodationCount: r._count.accommodations,
    })
  }
  return out
}

// ── Statuses that are none of this module's business ──────────────────────────

/**
 * A booking in one of these states is never auto-cancelled: the first three are
 * already closed or already being closed, and `AMENDED` means a person is mid-way
 * through reworking the file.
 */
const CLOSED_STATUSES: BookingStatus[] = ['CANCELLED', 'PENDING_CANCELLATION', 'COMPLETED', 'AMENDED']

/**
 * Did *this* system create this booking from an AppleSystem confirmation?
 *
 * The whole cancellation argument rests on a syllogism — we only ever import at
 * status 2, so a held ref on a non-2 row must have been withdrawn. That holds
 * only for bookings we actually imported. A booking created from a TC email or
 * an OneDrive folder can share an IS number with an upstream quotation that was
 * never confirmed, and cancelling it would withdraw a tour on evidence that
 * never applied to it.
 *
 * `importMappedBooking` writes exactly one StatusEvent on creation, noted
 * "Imported from AppleSystem (quotation …)". Its presence is the proof; its
 * absence means this module keeps its hands off and lets a person decide.
 */
async function wasImportedFromAppleSystem(bookingId: string): Promise<boolean> {
  const event = await prisma.statusEvent.findFirst({
    where: { bookingId, note: { startsWith: 'Imported from AppleSystem' } },
    select: { id: true },
  })
  return event !== null
}

// ── The run ───────────────────────────────────────────────────────────────────

export interface RunReconcileParams {
  trigger: 'auto' | 'manual'
  triggeredById?: string
  /** Bypass the enabled switch (the "Reconcile now" button). Lock still applies. */
  force?: boolean
}

export type RunReconcileOutcome =
  | { ran: true; run: ReconcileRun }
  | { ran: false; reason: 'disabled' | 'already-running' }

function newRun(trigger: 'auto' | 'manual', from: string, to: string): ReconcileRun {
  return {
    at: new Date().toISOString(),
    trigger,
    durationMs: 0,
    windowFrom: from,
    windowTo: to,
    scanned: 0,
    upstreamConfirmed: 0,
    presentBefore: 0,
    missing: 0,
    created: 0,
    importErrors: 0,
    stale: 0,
    refreshed: 0,
    unchanged: 0,
    syncErrors: 0,
    refreshBacklog: 0,
    drifted: 0,
    cancelled: 0,
    awaitingSecondSighting: 0,
    flagged: 0,
    inParity: true,
    unresolved: 0,
    unresolvedRefs: [],
    actions: [],
  }
}

function act(run: ReconcileRun, action: ReconcileAction): void {
  if (run.actions.length < 200) run.actions.push(action)
}

/**
 * Reconcile the rolling create-date window once, end to end.
 *
 * Never throws: an upstream outage is recorded on the run (`error`) and alerted
 * on if it persists, because a reconciler that can die is a reconciler that
 * silently stops guaranteeing anything.
 */
export async function runAsReconcile(params: RunReconcileParams): Promise<RunReconcileOutcome> {
  const settings = await getReconcileSettings()
  if (!settings.enabled && !params.force) return { ran: false, reason: 'disabled' }
  if (!(await acquireLock())) return { ran: false, reason: 'already-running' }

  const startedAt = Date.now()
  const { from, to } = reconcileWindow(settings.lookbackDays)
  const run = newRun(params.trigger, from, to)

  try {
    await withAsRetryBudget(RECONCILE_RETRY_BUDGET_MS, () =>
      executeRun(run, settings, params.triggeredById),
    )
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err)
    run.inParity = false
    console.error('[AsReconcile] run failed:', run.error)
  } finally {
    run.durationMs = Date.now() - startedAt
    await releaseLock()
  }

  await writeRaw(RECONCILE_LAST_AT, run.at).catch(() => {})
  await appendRun(run).catch((err) => {
    console.error('[AsReconcile] could not write run log:', err instanceof Error ? err.message : err)
  })

  console.log(
    `[AsReconcile] ${params.trigger} ${from}→${to}: upstream=${run.upstreamConfirmed} ` +
    `created=${run.created} refreshed=${run.refreshed} cancelled=${run.cancelled} ` +
    `flagged=${run.flagged} unresolved=${run.unresolved} parity=${run.inParity} (${run.durationMs}ms)`,
  )

  await notifyOnProblem(run)
  return { ran: true, run }
}

async function executeRun(
  run: ReconcileRun,
  settings: ReconcileSettings,
  triggeredById?: string,
): Promise<void> {
  const actorId = triggeredById ?? (await getAutomationUserId())

  // One list call, unfiltered by status — it answers every question below.
  const { items } = await listByCreateDate({
    fromCreateDate: run.windowFrom,
    toCreateDate: run.windowTo,
  })
  run.scanned = items.length

  const confirmed = items.filter(isConfirmed)
  const withdrawn = items.filter((r) => !isConfirmed(r))
  run.upstreamConfirmed = confirmed.length

  // Every ref the window mentions, confirmed or not — one query for all of them.
  const allRefs = Array.from(new Set(
    items.map(refOf).filter((r): r is string => r !== null),
  ))
  const local = await loadLocal(allRefs)

  // ── 1. Missing confirmations ────────────────────────────────────────────────
  const missingRows = confirmed.filter((r) => {
    const ref = refOf(r)
    // A row with no ref yet cannot be matched from the list alone; the template
    // call resolves it, and `importMappedBooking` de-duplicates it safely.
    return ref === null || !local.has(ref)
  })
  run.presentBefore = confirmed.length - missingRows.length
  run.missing = missingRows.length

  const createdRefs = new Set<string>()
  // Anything past the cap is honestly reported as still missing rather than
  // quietly forgotten — the next tick picks it up. So is anything the import
  // tried and failed on, which is the case worth alerting about.
  const stillMissing: ASBookingListItem[] = missingRows.slice(MAX_IMPORTS_PER_RUN)

  for (const row of missingRows.slice(0, MAX_IMPORTS_PER_RUN)) {
    const outcome = await importRow(row, actorId)
    if (outcome.ok) {
      if (outcome.created) {
        run.created++
        act(run, { ref: outcome.ref, kind: 'created', detail: `Imported from quotation ${outcome.quotationNo}` })
      }
      createdRefs.add(outcome.ref)
    } else {
      run.importErrors++
      stillMissing.push(row)
      act(run, { ref: refOf(row) ?? `q${row.quotation_no}`, kind: 'error', detail: outcome.detail })
    }
  }

  // ── 2. Stale content ────────────────────────────────────────────────────────
  const prints = await readPrints()
  const nowIso = new Date().toISOString()

  // Only bookings that were already here are candidates: one just imported is by
  // definition current, and re-syncing it would be a wasted upstream call.
  const presentRows = confirmed.filter((r) => {
    const ref = refOf(r)
    return ref !== null && local.has(ref) && !createdRefs.has(ref)
  })

  const staleRows: { row: ASBookingListItem; ref: string; why: string; once?: boolean }[] = []
  for (const row of presentRows) {
    const ref = refOf(row) as string
    const print = fingerprintOf(row)
    const seen = prints[ref]
    const booking = local.get(ref)!

    if (!seen) {
      // First sighting: record the baseline, don't act on it.
      prints[ref] = { f: print, t: nowIso }
    } else if (seen.f !== print) {
      staleRows.push({ row, ref, why: 'amended upstream' })
    } else if (booking.itineraryCount === 0 && booking.accommodationCount === 0 && !seen.c) {
      // Unchanged upstream, but the local file holds neither an itinerary nor a
      // hotel — the signature of a half-failed import, not of a real booking.
      // Tried exactly once per ref; see `PrintEntry.c`.
      staleRows.push({ row, ref, why: 'no itinerary or accommodation held', once: true })
    }
  }
  run.stale = staleRows.length

  if (settings.refreshEnabled) {
    const syncStates = await getSyncStates(staleRows.map((s) => s.ref))

    for (const { row, ref, why, once } of staleRows.slice(0, MAX_SYNCS_PER_RUN)) {
      const booking = local.get(ref)!
      // A cancelled file is closed; `syncBookingFromAs` refuses it, and asking
      // anyway would just burn an upstream call to collect the refusal.
      if (booking.status === 'CANCELLED') continue

      // Nothing to do if someone already refreshed this ref after the upstream
      // row last moved — a manual sync minutes ago is as good as ours.
      const syncedAt = Date.parse(syncStates[ref]?.at ?? '')
      const printedAt = Date.parse(prints[ref]?.t ?? '')
      if (Number.isFinite(syncedAt) && Number.isFinite(printedAt) && syncedAt > printedAt) {
        prints[ref] = { f: fingerprintOf(row), t: nowIso, ...(once ? { c: 1 as const } : {}) }
        continue
      }

      try {
        const result = await syncBookingFromAs(ref, {
          actorId: null,
          actorName: RECONCILE_ACTOR,
          mode: 'prearrival',
        })
        if (result.unchanged) {
          run.unchanged++
        } else {
          run.refreshed++
          act(run, {
            ref,
            kind: 'refreshed',
            detail: `${why} — ${result.fields.length} field(s), ${result.sections.length} section(s)`,
          })
        }
        // Only a successful refresh advances the fingerprint baseline; a failed
        // one must be retried on the next tick, not marked as handled.
        prints[ref] = { f: fingerprintOf(row), t: nowIso, ...(once ? { c: 1 as const } : {}) }
      } catch (err) {
        run.syncErrors++
        const detail = err instanceof AsSyncError || err instanceof Error ? err.message : String(err)
        act(run, { ref, kind: 'error', detail: `Refresh failed: ${detail}` })
        // The completeness repair is one-shot even when it fails: the usual
        // failure is upstream having nothing to send, which the next run cannot
        // fix either, and retrying it forever would crowd out real work.
        if (once && prints[ref]) prints[ref] = { ...prints[ref], c: 1 }
      }
    }
    run.refreshBacklog = Math.max(0, staleRows.length - MAX_SYNCS_PER_RUN)
  } else {
    run.refreshBacklog = staleRows.length
  }

  await writeJson(RECONCILE_PRINTS, prunePrints(prints)).catch(() => {})

  // ── 3. Withdrawn confirmations ──────────────────────────────────────────────
  const cancelled = await handleWithdrawn(run, settings, withdrawn, confirmed, local, actorId)

  // ── 4. Parity verdict + ledger ──────────────────────────────────────────────
  run.unresolved = stillMissing.length
  run.unresolvedRefs = stillMissing
    .map((r) => refOf(r) ?? `q${r.quotation_no}`)
    .slice(0, MAX_REFS)
  run.inParity = run.unresolved === 0 && !run.error

  await writeLedger(run, confirmed, local, createdRefs, stillMissing, cancelled)
  await pruneLedger()
}

// ── Importing one missing confirmation ────────────────────────────────────────

type ImportOutcome =
  | { ok: true; ref: string; created: boolean; quotationNo: string }
  | { ok: false; detail: string }

async function importRow(row: ASBookingListItem, actorId: string): Promise<ImportOutcome> {
  const quotationNo = String(row.quotation_no ?? '').trim()
  // The template endpoint keys on the row's `id`; its `reference_id` field is
  // just the quotation number and returns an empty "NA" stub when sent here.
  const referenceId = String(row.id ?? row.reference_id ?? '').trim()
  if (!quotationNo || !referenceId) {
    return { ok: false, detail: 'Upstream row carries no quotation/reference id' }
  }

  try {
    const quote = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
    const mapped = mapQuoteToBooking(quote, { fallbackIsNumber: row.is_number })
    const country = mapped.operationCountry ?? detectCountryFromRef(mapped.bookingRef)
    if (!country) return { ok: false, detail: 'Could not determine destination country' }

    const { booking, alreadyExists } = await importMappedBooking(mapped, country, {
      createdById: actorId,
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
    })
    return { ok: true, ref: booking.bookingRef, created: !alreadyExists, quotationNo }
  } catch (err) {
    const detail = err instanceof ASMappingError
      ? `Could not map quotation ${quotationNo}: ${err.message}`
      : err instanceof Error ? err.message : String(err)
    return { ok: false, detail }
  }
}

// ── Withdrawn confirmations ───────────────────────────────────────────────────

/**
 * Act on rows this system holds that upstream no longer calls confirmed.
 *
 * Every booking here was created by one of the import paths, and those only ever
 * create from status 2 — so a held ref sitting on a non-2 row is, by
 * construction, a confirmation AppleSystem has since withdrawn. That is the
 * finding; the guards decide what may be done about it.
 */
async function handleWithdrawn(
  run: ReconcileRun,
  settings: ReconcileSettings,
  withdrawnRows: ASBookingListItem[],
  confirmedRows: ASBookingListItem[],
  local: Map<string, LocalBooking>,
  actorId: string,
): Promise<ReconcileDay['cancelled']> {
  const drift = await readDrift()
  const now = Date.now()
  const nowIso = new Date().toISOString()
  let dirty = false

  // A ref that is confirmed again has recovered — forget it was ever in doubt,
  // so a quote that bounces out of and back into status 2 is never cancelled.
  for (const row of confirmedRows) {
    const ref = refOf(row)
    if (ref && drift[ref]) { delete drift[ref]; dirty = true }
  }

  const cancelledForLedger: ReconcileDay['cancelled'] = []

  for (const row of withdrawnRows) {
    const ref = refOf(row)
    if (!ref) continue
    const booking = local.get(ref)
    // Not held here and not confirmed upstream: nothing was ever imported, and
    // nothing should be. This is the ordinary case for unconfirmed quotations.
    if (!booking) { if (drift[ref]) { delete drift[ref]; dirty = true } ; continue }

    run.drifted++
    const upstreamStatus = String(row.status ?? '?')

    // Already closed, or a person is already handling it.
    if (CLOSED_STATUSES.includes(booking.status) || booking.cancelRequestedAt) {
      if (drift[ref]) { delete drift[ref]; dirty = true }
      continue
    }

    // Strike one: record and wait. Two runs must agree before anything happens.
    const marker = drift[ref]
    if (!marker) {
      drift[ref] = { firstSeenAt: nowIso, status: upstreamStatus }
      dirty = true
      run.awaitingSecondSighting++
      continue
    }
    const firstSeen = Date.parse(marker.firstSeenAt)
    if (!Number.isFinite(firstSeen) || now - firstSeen < MIN_DRIFT_AGE_MS) {
      run.awaitingSecondSighting++
      continue
    }

    // Only a booking this system imported from AppleSystem can be cancelled on
    // AppleSystem's say-so. Anything else reaching this point is a ref collision,
    // and it is reported rather than acted on.
    if (!(await wasImportedFromAppleSystem(booking.id))) {
      run.flagged++
      act(run, {
        ref,
        kind: 'flagged',
        detail: `Upstream status ${upstreamStatus}, but this booking was not imported from AppleSystem — left alone`,
      })
      continue
    }

    // A tour that has already started is not an automation's to withdraw.
    if (booking.arrivalDate.getTime() <= now) {
      run.flagged++
      act(run, {
        ref,
        kind: 'flagged',
        detail: `Upstream status ${upstreamStatus} but the tour has already started — needs a person`,
      })
      await raiseAsImportAlert({
        severity: 'warning',
        title: `${ref} was withdrawn upstream but is already on ground`,
        message:
          `AppleSystem now shows quotation ${row.quotation_no} at status ${upstreamStatus}, but ${ref} ` +
          `arrived ${booking.arrivalDate.toISOString().slice(0, 10)} and is ${booking.status}. ` +
          `It has NOT been cancelled automatically — decide and action it by hand.`,
        signature: `reconcile-onground-drift::${ref}`,
        jobMode: 'auto',
        dateFrom: run.windowFrom,
        dateTo: run.windowTo,
      })
      continue
    }

    if (!settings.autoCancelEnabled) {
      run.flagged++
      act(run, {
        ref,
        kind: 'flagged',
        detail: `Upstream status ${upstreamStatus} — auto-cancel is off, reported only`,
      })
      continue
    }

    try {
      const prevStatus = booking.status
      await cancelWithdrawnBooking(booking, row, upstreamStatus, actorId)
      run.cancelled++
      delete drift[ref]
      dirty = true
      act(run, { ref, kind: 'cancelled', detail: `Upstream status ${upstreamStatus} (was ${prevStatus})` })
      if (cancelledForLedger.length < MAX_REFS) {
        cancelledForLedger.push({ ref, at: nowIso, prevStatus, upstreamStatus })
      }
    } catch (err) {
      run.flagged++
      const detail = err instanceof Error ? err.message : String(err)
      act(run, { ref, kind: 'error', detail: `Cancel failed: ${detail}` })
    }
  }

  if (dirty) await writeJson(RECONCILE_DRIFT, drift).catch(() => {})

  if (run.cancelled > 0) {
    await raiseAsImportAlert({
      severity: 'warning',
      title: `${run.cancelled} booking${run.cancelled === 1 ? '' : 's'} cancelled — withdrawn in AppleSystem`,
      message:
        `${cancelledForLedger.map((c) => `${c.ref} (was ${c.prevStatus})`).join(', ')} ` +
        `${run.cancelled === 1 ? 'is' : 'are'} no longer confirmed upstream and ` +
        `${run.cancelled === 1 ? 'has' : 'have'} been marked cancelled here. Nothing was deleted — ` +
        `each booking records the status it held, so the change can be reversed.`,
      signature: `reconcile-cancelled::${run.windowTo}`,
      jobMode: 'auto',
      dateFrom: run.windowFrom,
      dateTo: run.windowTo,
    })
  }

  return cancelledForLedger
}

/**
 * Mark one booking cancelled on the upstream's say-so.
 *
 * Additive only: the previous status is preserved in `cancelPrevStatus`, the
 * booking and all of its children stay exactly where they are, and the reason
 * names the quotation so the trail back to AppleSystem is on the record.
 */
async function cancelWithdrawnBooking(
  booking: LocalBooking,
  row: ASBookingListItem,
  upstreamStatus: string,
  actorId: string,
): Promise<void> {
  const now = new Date()
  const reason =
    `AppleSystem withdrew this confirmation — quotation ${row.quotation_no ?? '—'} ` +
    `moved from status 2 to status ${upstreamStatus}. Cancelled automatically by the ` +
    `AppleSystem reconciliation on ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.`

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: the guards ran against a snapshot taken at
    // the top of the run, and a person may have touched the booking since.
    const fresh = await tx.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, cancelRequestedAt: true },
    })
    if (!fresh) throw new Error('booking disappeared')
    if (CLOSED_STATUSES.includes(fresh.status) || fresh.cancelRequestedAt) {
      throw new Error(`no longer eligible (status ${fresh.status})`)
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelPrevStatus: fresh.status,
        cancelledAt: now,
        cancelledByName: RECONCILE_ACTOR,
        cancellationReason: reason,
        cancelDecidedAt: now,
        cancelDecidedByName: RECONCILE_ACTOR,
      },
    })

    await tx.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: fresh.status,
        toState: 'CANCELLED',
        actorId,
        note: reason,
      },
    })
  })

  await logActivity({
    userId: actorId,
    action: ACTION.STATUS_CHANGED,
    entityType: 'Booking',
    entityId: booking.id,
    details: {
      op: 'as_reconcile_cancel',
      bookingRef: booking.bookingRef,
      quotationNo: row.quotation_no ?? null,
      upstreamStatus,
      previousStatus: booking.status,
    },
  }).catch(() => { /* the StatusEvent is the record of note; the log is a bonus */ })
}

// ── Ledger write ──────────────────────────────────────────────────────────────

/**
 * Fold this run's findings into the per-create-date ledger.
 *
 * Bucketed by the upstream row's own create date rather than by the window, so a
 * run sweeping two days updates both correctly and the daily report can read a
 * single day's parity without recomputing anything.
 */
async function writeLedger(
  run: ReconcileRun,
  confirmed: ASBookingListItem[],
  local: Map<string, LocalBooking>,
  createdRefs: Set<string>,
  stillMissing: ASBookingListItem[],
  cancelled: ReconcileDay['cancelled'],
): Promise<void> {
  const missingIds = new Set(stillMissing.map((r) => String(r.id ?? r.quotation_no)))
  const buckets = new Map<string, { confirmed: number; held: number; missingRefs: string[] }>()

  for (const row of confirmed) {
    const date = createDateOf(row, run.windowTo)
    const b = buckets.get(date) ?? { confirmed: 0, held: 0, missingRefs: [] }
    b.confirmed++
    const ref = refOf(row)
    const isMissing = missingIds.has(String(row.id ?? row.quotation_no))
    if (!isMissing && (createdRefs.has(ref ?? '') || (ref && local.has(ref)))) {
      b.held++
    } else if (isMissing && b.missingRefs.length < MAX_REFS) {
      b.missingRefs.push(ref ?? `q${row.quotation_no}`)
    }
    buckets.set(date, b)
  }

  // Every date in the window gets a row even when upstream had nothing that day:
  // "AppleSystem confirmed 0, we hold 0" is a real, reportable answer, and its
  // absence would read as "never checked".
  for (const date of datesInRange(run.windowFrom, run.windowTo)) {
    if (!buckets.has(date)) buckets.set(date, { confirmed: 0, held: 0, missingRefs: [] })
  }

  for (const [date, b] of Array.from(buckets.entries())) {
    const prev = (await getReconcileDay(date)) ?? emptyDay(date)

    // The snapshot (`upstreamConfirmed` / `systemHeld` / `missing`) is exact per
    // date, because it is counted from the rows themselves. The cumulative
    // action counters are not attributable that precisely — a run sweeping two
    // days reports one `created` figure for both — so they are credited to the
    // window's last day, and every other day carries its snapshot alone. That
    // keeps the report's headline parity numbers exact and its "what did the
    // automation do" numbers honest about their granularity.
    const isTail = date === run.windowTo
    const mine = (n: number) => (isTail ? n : 0)

    const next: ReconcileDay = {
      date,
      upstreamConfirmed: b.confirmed,
      systemHeld: b.held,
      missing: Math.max(0, b.confirmed - b.held),
      missingRefs: b.missingRefs,
      createdTotal:   prev.createdTotal   + mine(run.created),
      refreshedTotal: prev.refreshedTotal + mine(run.refreshed),
      cancelledTotal: prev.cancelledTotal + mine(run.cancelled),
      flaggedTotal:   prev.flaggedTotal   + mine(run.flagged),
      errorsTotal:    prev.errorsTotal    + mine(run.importErrors + run.syncErrors),
      runs: prev.runs + 1,
      lastRunAt: run.at,
      cancelled: [...prev.cancelled, ...(isTail ? cancelled : [])].slice(-MAX_REFS),
    }

    await writeJson(dayKey(date), next).catch((err) => {
      console.error(`[AsReconcile] ledger write failed for ${date}:`, err instanceof Error ? err.message : err)
    })
  }
}

// ── Alerting ──────────────────────────────────────────────────────────────────

/**
 * Alert on a *sustained* failure, and on any parity gap the run could not close.
 *
 * A single failed tick against a blipping upstream is noise — the next one
 * usually recovers. A confirmation that is still missing after a run tried to
 * import it is not noise: that is precisely the condition this module exists to
 * make impossible, and nobody should learn about it from a log line.
 */
async function notifyOnProblem(run: ReconcileRun): Promise<void> {
  if (run.error) {
    const recent = (await listRuns(3)).filter((r) => r.error)
    if (recent.length < 3) return
    await raiseAsImportAlert({
      severity: 'error',
      title: 'AppleSystem reconciliation is failing',
      message:
        `The last 3 reconciliation runs could not reach AppleSystem — latest error: ${run.error}. ` +
        `Confirmations created ${run.windowFrom} → ${run.windowTo} are not being verified; ` +
        `no booking has been changed.`,
      signature: 'reconcile-run-failed',
      jobMode: 'auto',
      dateFrom: run.windowFrom,
      dateTo: run.windowTo,
      totalFound: run.upstreamConfirmed,
      totalCreated: run.created,
      totalErrors: run.importErrors + run.syncErrors,
    })
    return
  }

  if (run.unresolved > 0) {
    await raiseAsImportAlert({
      severity: 'error',
      title: `${run.unresolved} AppleSystem confirmation${run.unresolved === 1 ? '' : 's'} still missing after reconciliation`,
      message:
        `AppleSystem shows ${run.upstreamConfirmed} confirmation(s) created ${run.windowFrom} → ${run.windowTo}; ` +
        `${run.unresolved} could not be imported: ${run.unresolvedRefs.join(', ') || '—'}. ` +
        `The next run retries them automatically — if this repeats, the quotations need looking at by hand.`,
      // One alert per window per dedup period, not one per tick.
      signature: `reconcile-unresolved::${run.windowFrom}::${run.windowTo}`,
      jobMode: 'auto',
      dateFrom: run.windowFrom,
      dateTo: run.windowTo,
      totalFound: run.upstreamConfirmed,
      totalCreated: run.created,
      totalErrors: run.importErrors + run.syncErrors,
    })
  }
}

// ── Status for the UI ─────────────────────────────────────────────────────────

export interface ReconcileStatus {
  settings: ReconcileSettings
  timezone: string
  running: boolean
  lastRunAt: string | null
  /** ISO instant of the next automatic run, or null when the loop is off. */
  nextRunAt: string | null
  window: { from: string; to: string }
  lastRun: ReconcileRun | null
  runs: ReconcileRun[]
  /** Today's ledger row — the number the daily report will carry. */
  today: ReconcileDay | null
  /** The window's ledger rows, oldest first. */
  days: ReconcileDay[]
  totals: { runs: number; created: number; refreshed: number; cancelled: number; errors: number }
}

export async function getReconcileStatus(logLimit = 12): Promise<ReconcileStatus> {
  const settings = await getReconcileSettings()
  const window = reconcileWindow(settings.lookbackDays)

  const [lastAtRow, runs, running, days] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: RECONCILE_LAST_AT } }),
    listRuns(),
    isReconcileRunning(),
    getReconcileDays(window.from, window.to),
  ])

  const lastRunAt = lastAtRow?.value || null
  const nextRunAt = settings.enabled && lastRunAt
    ? new Date(Date.parse(lastRunAt) + settings.intervalMinutes * 60_000).toISOString()
    : null

  return {
    settings,
    timezone: TZ,
    running,
    lastRunAt,
    nextRunAt,
    window,
    lastRun: runs[0] ?? null,
    runs: runs.slice(0, logLimit),
    today: days.find((d) => d.date === window.to) ?? null,
    days,
    totals: {
      runs: runs.length,
      created:   runs.reduce((n, r) => n + r.created, 0),
      refreshed: runs.reduce((n, r) => n + r.refreshed, 0),
      cancelled: runs.reduce((n, r) => n + r.cancelled, 0),
      errors:    runs.reduce((n, r) => n + r.importErrors + r.syncErrors + (r.error ? 1 : 0), 0),
    },
  }
}
