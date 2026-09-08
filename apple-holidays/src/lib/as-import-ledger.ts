/**
 * AppleSystem import ledger — what actually got created, and what keeps failing.
 *
 * Every import path (live watch, reconciliation, the daily job) runs the same
 * pipeline and, until now, recorded only *counts*: a check said "2 failed, will
 * retry" and that was the end of it. Two things followed from that, both of
 * which this module exists to fix:
 *
 *   1. **Nobody could see which bookings.** The Live Watch page showed a tally
 *      with no way to learn the quotation numbers or the reason, so a permanent
 *      failure looked exactly like a transient one.
 *
 *   2. **The same failure alerted forever.** The alert signature was the date
 *      window, so a quotation that can never import — one AppleSystem has issued
 *      no IS number for, say — re-raised an alert and re-mailed IT on every
 *      sweep, for as long as it stayed in the window. Acknowledging the alert
 *      made it *worse*: `raiseAsImportAlert` only deduplicates against an
 *      unacknowledged alert, so the next tick started a fresh one.
 *
 * The ledger keys failures on the **quotation number plus a stable reason code**
 * rather than on time or date window. A quotation is announced once per distinct
 * reason; every later occurrence just bumps `attempts` and `lastAt`. Retrying
 * stays as noisy as it needs to be in the log and as quiet as it should be in
 * everyone's inbox.
 *
 * Both halves live in `system_settings` (KV) — no schema change, no migration,
 * matching `as-watch.ts` and `as-reconcile.ts`. The live database carries drift
 * and must not be `prisma db push`-ed.
 */

import { prisma } from '@/lib/prisma'

// ── Keys ──────────────────────────────────────────────────────────────────────

const CREATED_KEY = 'as_import_ledger_created'
const FAILED_KEY  = 'as_import_ledger_failed'

/** Retention. Both logs are read whole on every watch tick, so keep them small. */
const MAX_CREATED = 60
const MAX_FAILED  = 60

/**
 * `system_settings.value` is MySQL TEXT (65,535 bytes) and an overrun *throws* —
 * which is exactly how the sibling `as_import_jobs` log once disabled the
 * importer outright. Both budgets sit far below the ceiling and the serializers
 * shed the oldest entries rather than ever attempting a write that cannot fit.
 */
const MAX_BYTES = 40_000

/** Cap on a stored upstream message, so one verbose error cannot dominate. */
const MAX_MESSAGE = 300

// ── Shapes ────────────────────────────────────────────────────────────────────

/** Which import path produced the entry. */
export type LedgerSource = 'watch' | 'reconcile' | 'import'

/**
 * Stable grouping key for a failure.
 *
 * Derived from the failure message rather than stored by each call site, so all
 * three import paths classify the same underlying problem identically — that is
 * what lets "already reported" hold across them.
 */
export type FailureReason =
  | 'no-is-number'
  | 'no-country'
  | 'no-itinerary'
  | 'missing-ids'
  | 'upstream'
  | 'other'

export interface CreatedEntry {
  /** Local booking ref, e.g. "MY40060". */
  ref: string
  bookingId: string
  quotationNo: string
  country: string | null
  /** ISO instant the booking was created here. */
  at: string
  source: LedgerSource
  arrivalDate: string | null
  guestName: string | null
}

export interface FailedEntry {
  quotationNo: string
  /** Predicted booking ref, when the payload carried enough to derive one. */
  ref: string | null
  country: string | null
  reason: FailureReason
  /** Latest human-readable message for this quotation + reason. */
  message: string
  firstAt: string
  lastAt: string
  /** How many times this has now failed the same way. */
  attempts: number
  source: LedgerSource
  /** ISO instant an alert/email went out for it — null while never announced. */
  notifiedAt: string | null
  /** Set when a person dismissed it from the Live Watch page. */
  dismissedAt: string | null
  dismissedBy: string | null
}

// ── KV plumbing ───────────────────────────────────────────────────────────────

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key } })
    if (!row?.value) return fallback
    const parsed = JSON.parse(row.value)
    return Array.isArray(parsed) ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

/** Serialize newest-first within the byte budget, dropping the oldest to fit. */
function serialize(list: unknown[], max: number): string {
  const out = list.slice(0, max)
  while (out.length > 1 && Buffer.byteLength(JSON.stringify(out), 'utf8') > MAX_BYTES) {
    out.pop()
  }
  return JSON.stringify(out)
}

async function writeJson(key: string, list: unknown[], max: number): Promise<void> {
  const value = serialize(list, max)
  await prisma.systemSetting.upsert({
    where: { key }, update: { value }, create: { key, value },
  })
}

function trim(s: string): string {
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}…` : s
}

// ── Reason classification ─────────────────────────────────────────────────────

/**
 * Map a failure message onto a stable reason code.
 *
 * The point is identity, not prose: "no IS number" must classify the same way
 * whether it arrived as an `ASMappingError` from the watch or as a bare string
 * from the reconciler, or the same booking would be announced once per path.
 */
export function classifyFailure(message: string): FailureReason {
  const m = message.toLowerCase()
  if (m.includes('no is number'))          return 'no-is-number'
  if (m.includes('destination country') ||
      m.includes('determine the country')) return 'no-country'
  if (m.includes('dated itinerary'))       return 'no-itinerary'
  if (m.includes('missing quotation'))     return 'missing-ids'
  if (m.includes('applesystem') ||
      m.includes('timed out') ||
      m.includes('timeout'))               return 'upstream'
  return 'other'
}

/** Short, plain-English label for a reason code — used by the UI and the email. */
export const REASON_LABEL: Record<FailureReason, string> = {
  'no-is-number': 'No IS number in AppleSystem',
  'no-country':   'Destination country could not be determined',
  'no-itinerary': 'No dated itinerary',
  'missing-ids':  'Quotation is missing its identifiers',
  'upstream':     'AppleSystem did not respond',
  'other':        'Could not be imported',
}

/**
 * Whether a reason will resolve itself by retrying.
 *
 * `upstream` is a blip and the next sweep usually fixes it. The rest are data
 * problems in the quotation: retrying forever changes nothing, so the UI says so
 * plainly instead of promising "will retry".
 */
export function isTransient(reason: FailureReason): boolean {
  return reason === 'upstream'
}

// ── Created bookings ──────────────────────────────────────────────────────────

export async function listCreated(limit = MAX_CREATED): Promise<CreatedEntry[]> {
  return (await readJson<CreatedEntry[]>(CREATED_KEY, [])).slice(0, limit)
}

/**
 * Record a booking this import actually created. Idempotent on `ref`: a re-run
 * that somehow reports the same creation twice updates the entry in place rather
 * than listing the booking twice.
 */
export async function recordCreated(entry: Omit<CreatedEntry, 'at'> & { at?: string }): Promise<void> {
  try {
    const list = await readJson<CreatedEntry[]>(CREATED_KEY, [])
    const next: CreatedEntry = { ...entry, at: entry.at ?? new Date().toISOString() }
    const idx = list.findIndex((e) => e.ref === next.ref)
    if (idx !== -1) list.splice(idx, 1)
    list.unshift(next)
    await writeJson(CREATED_KEY, list, MAX_CREATED)
  } catch (err) {
    // The ledger is a reporting aid — it must never fail an import.
    console.error('[AsLedger] recordCreated failed:', err instanceof Error ? err.message : err)
  }
}

// ── Failed imports ────────────────────────────────────────────────────────────

export async function listFailed(limit = MAX_FAILED): Promise<FailedEntry[]> {
  return (await readJson<FailedEntry[]>(FAILED_KEY, [])).slice(0, limit)
}

export interface RecordFailureInput {
  quotationNo: string
  ref?: string | null
  country?: string | null
  message: string
  source: LedgerSource
}

export interface RecordFailureResult {
  entry: FailedEntry
  /**
   * True only the first time a quotation fails for a given reason — i.e. exactly
   * when it is worth telling somebody. Every repeat returns false, which is what
   * keeps the same booking out of the alert log and out of IT's inbox.
   */
  isNew: boolean
}

/**
 * Record one failed quotation and say whether it is newly failing.
 *
 * A quotation that starts failing for a *different* reason is treated as new
 * again — the reason is part of its identity, so a booking that moves from
 * "AppleSystem did not respond" to "no IS number" is announced once more,
 * because that second problem is a genuinely different thing to act on.
 */
export async function recordFailure(input: RecordFailureInput): Promise<RecordFailureResult> {
  const now = new Date().toISOString()
  const reason = classifyFailure(input.message)
  const fresh: FailedEntry = {
    quotationNo: input.quotationNo,
    ref: input.ref ?? null,
    country: input.country ?? null,
    reason,
    message: trim(input.message),
    firstAt: now,
    lastAt: now,
    attempts: 1,
    source: input.source,
    notifiedAt: null,
    dismissedAt: null,
    dismissedBy: null,
  }

  try {
    const list = await readJson<FailedEntry[]>(FAILED_KEY, [])
    const idx = list.findIndex((e) => e.quotationNo === input.quotationNo && e.reason === reason)

    if (idx === -1) {
      list.unshift(fresh)
      await writeJson(FAILED_KEY, list, MAX_FAILED)
      return { entry: fresh, isNew: true }
    }

    const existing = list[idx]
    const updated: FailedEntry = {
      ...existing,
      ref: input.ref ?? existing.ref,
      country: input.country ?? existing.country,
      message: trim(input.message),
      lastAt: now,
      attempts: (existing.attempts ?? 1) + 1,
      source: input.source,
    }
    list[idx] = updated
    // Move the still-failing entry to the top so the panel reads newest-activity
    // first, exactly like the check log above it.
    list.splice(idx, 1)
    list.unshift(updated)
    await writeJson(FAILED_KEY, list, MAX_FAILED)

    // Never re-announce something already announced or already dismissed.
    return { entry: updated, isNew: !updated.notifiedAt && !updated.dismissedAt }
  } catch (err) {
    console.error('[AsLedger] recordFailure failed:', err instanceof Error ? err.message : err)
    // Fail closed on notification: if the ledger cannot be read, do not treat the
    // failure as new, or a broken KV row would restore the alert storm.
    return { entry: fresh, isNew: false }
  }
}

/** Stamp `notifiedAt` on the quotations an alert has just gone out for. */
export async function markNotified(quotationNos: string[]): Promise<void> {
  if (quotationNos.length === 0) return
  try {
    const wanted = new Set(quotationNos)
    const list = await readJson<FailedEntry[]>(FAILED_KEY, [])
    const now = new Date().toISOString()
    let changed = false
    for (const e of list) {
      if (wanted.has(e.quotationNo) && !e.notifiedAt) { e.notifiedAt = now; changed = true }
    }
    if (changed) await writeJson(FAILED_KEY, list, MAX_FAILED)
  } catch (err) {
    console.error('[AsLedger] markNotified failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Drop every open failure for a quotation that has now imported.
 *
 * Without this a booking that failed once and later succeeded would sit in the
 * "could not import" panel forever, and a *genuinely new* failure of the same
 * quotation months later would be silently suppressed as a repeat.
 */
export async function clearFailure(quotationNo: string): Promise<void> {
  try {
    const list = await readJson<FailedEntry[]>(FAILED_KEY, [])
    const next = list.filter((e) => e.quotationNo !== quotationNo)
    if (next.length !== list.length) await writeJson(FAILED_KEY, next, MAX_FAILED)
  } catch (err) {
    console.error('[AsLedger] clearFailure failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Mark a failure as handled by a person, without deleting it.
 *
 * Dismissing keeps the row (so the history of what went wrong survives) but
 * stops it being re-announced. Retries carry on regardless — dismissing is a
 * statement about notifications, not about the import.
 */
export async function dismissFailure(quotationNo: string, by: string): Promise<boolean> {
  try {
    const list = await readJson<FailedEntry[]>(FAILED_KEY, [])
    const now = new Date().toISOString()
    let changed = false
    for (const e of list) {
      if (e.quotationNo === quotationNo && !e.dismissedAt) {
        e.dismissedAt = now
        e.dismissedBy = by
        changed = true
      }
    }
    if (changed) await writeJson(FAILED_KEY, list, MAX_FAILED)
    return changed
  } catch (err) {
    console.error('[AsLedger] dismissFailure failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/** The whole ledger, for the Live Watch panel. */
export interface ImportLedger {
  created: CreatedEntry[]
  failed: FailedEntry[]
}

export async function getImportLedger(createdLimit = 25, failedLimit = 25): Promise<ImportLedger> {
  const [created, failed] = await Promise.all([
    listCreated(createdLimit),
    listFailed(failedLimit),
  ])
  return { created, failed }
}
