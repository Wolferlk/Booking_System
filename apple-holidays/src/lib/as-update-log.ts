/**
 * AppleSystem **update log** — which bookings were refreshed from AppleSystem,
 * on which day, and which ones are waiting for a person.
 *
 * Two kinds of row, both in `system_settings` (KV), both keyed per booking so
 * concurrent writers can never overwrite each other's entries:
 *
 *   as_upd_log:<YYYY-MM-DD>:<bookingRef>   one per booking per day it changed
 *   as_upd_pending:<bookingRef>            an update found but NOT applied
 *
 * The day log is written by `syncBookingFromAs` itself on every apply that
 * changed something, so it covers every path that refreshes a booking from the
 * API — the daily Upcoming Arrivals check, the pre-arrival sync, the parity
 * reconciler and the manual "Fetch Data from API" button alike. That is what
 * lets the All Bookings list answer "what was updated yesterday?" honestly.
 *
 * Each day row also keeps the **before** value of every field it changed and
 * the previous itinerary / hotel rows, so an automatic update is never a
 * one-way door: what the booking said before is on record next to what it
 * says now.
 *
 * The day key sorts as a string (`as_upd_log:2026-11-24:…`), so "everything
 * from one day" is a primary-key range scan, not a table scan.
 *
 * **No schema change, no migration** — deliberate, the live DB carries drift.
 */

import { prisma } from '@/lib/prisma'
import { SYNC_CONFLICT_PREFIX } from '@/lib/booking-field-edits'

export const UPDATE_LOG_PREFIX = 'as_upd_log:'
export const UPDATE_PENDING_PREFIX = 'as_upd_pending:'

export const TZ = process.env.AUTO_BOOKING_TZ || 'Asia/Colombo'

/** Day rows older than this are pruned by the daily job. */
export const UPDATE_LOG_TTL_DAYS = 120

/** `system_settings.value` is MySQL TEXT (65,535 bytes) — stay well clear. */
const MAX_ROW_BYTES = 48_000
/** Long free text is clipped in the before/after record; the activity log keeps the rest. */
const MAX_TEXT = 400

// ── Dates (scheduler timezone) ───────────────────────────────────────────────

/** A date (YYYY-MM-DD) for an instant, evaluated in the scheduler timezone. */
export function dateInTz(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d)
}

/** `YYYY-MM-DD` shifted by whole days. */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// ── Types ────────────────────────────────────────────────────────────────────

export type UpdateMode = 'manual' | 'prearrival' | 'upcoming'

export interface UpdateFieldRecord {
  field: string
  from: string | null
  to: string | null
}

export interface UpdateRowRecord {
  dayNo?: number
  date?: string
  title?: string
  city?: string
  hotel?: string
  checkIn?: string
  checkOut?: string
  nights?: number
}

export interface UpdateLogEntry {
  bookingRef: string
  /** ISO time of the (latest) update that day. */
  at: string
  by: string
  mode: UpdateMode
  quotationNo: string | null
  revision: number | null
  /** Field / section names that changed (merged across the day). */
  changed: string[]
  /** Before → after of each scalar that changed. */
  fields: UpdateFieldRecord[]
  /** What the itinerary / hotels were before they were replaced. */
  before?: { itinerary?: UpdateRowRecord[]; accommodations?: UpdateRowRecord[] }
  /** How many times the booking was refreshed with changes that day. */
  count: number
}

export interface PendingUpdate {
  bookingRef: string
  /** When the check found it. */
  at: string
  /**
   * Why it was not applied:
   *   auto-apply-off  automatic apply is switched off — someone reviews it
   *   large-change    the change looked too big to apply unattended
   *   breaker         too many bookings changed at once upstream; held as a precaution
   */
  reason: 'auto-apply-off' | 'large-change' | 'breaker'
  /** Plain-language reasons for a `large-change` hold. */
  notes?: string[]
  /** What would change. */
  changed: string[]
  fields: UpdateFieldRecord[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clip(v: string | null | undefined): string | null {
  if (v == null) return null
  const s = String(v)
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s
}

function logKey(date: string, bookingRef: string): string {
  return `${UPDATE_LOG_PREFIX}${date}:${bookingRef}`
}

function pendingKey(bookingRef: string): string {
  return `${UPDATE_PENDING_PREFIX}${bookingRef}`
}

function refFromLogKey(key: string): string {
  // as_upd_log:YYYY-MM-DD:<ref>
  return key.slice(UPDATE_LOG_PREFIX.length + 11)
}

function dateFromLogKey(key: string): string {
  return key.slice(UPDATE_LOG_PREFIX.length, UPDATE_LOG_PREFIX.length + 10)
}

function safeParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

/** Serialise, trimming the bulky parts first if the row would not fit in TEXT. */
function fitRow(entry: UpdateLogEntry): string {
  let json = JSON.stringify(entry)
  if (json.length <= MAX_ROW_BYTES) return json
  json = JSON.stringify({ ...entry, before: undefined })
  if (json.length <= MAX_ROW_BYTES) return json
  return JSON.stringify({ ...entry, before: undefined, fields: entry.fields.slice(0, 10).map((f) => ({ field: f.field, from: clip(f.from)?.slice(0, 80) ?? null, to: clip(f.to)?.slice(0, 80) ?? null })) })
}

// ── Day log ──────────────────────────────────────────────────────────────────

export interface RecordUpdateInput {
  bookingRef: string
  by: string
  mode: UpdateMode
  quotationNo: string | null
  revision: number | null
  changed: string[]
  fields: UpdateFieldRecord[]
  before?: UpdateLogEntry['before']
  at?: string
}

/**
 * Record that `bookingRef` was refreshed from AppleSystem with real changes.
 * Several updates on one day merge into that day's row, keeping the *first*
 * "before" value of every field — the state the day started from.
 *
 * Never throws: a failed log write must not fail a sync that already succeeded.
 */
export async function recordAsUpdate(input: RecordUpdateInput): Promise<void> {
  if (input.changed.length === 0) return
  try {
    const at = input.at ?? new Date().toISOString()
    const key = logKey(dateInTz(new Date(at)), input.bookingRef)
    const existing = safeParse<UpdateLogEntry>(
      (await prisma.systemSetting.findUnique({ where: { key } }))?.value,
    )

    const fields = new Map<string, UpdateFieldRecord>()
    for (const f of existing?.fields ?? []) fields.set(f.field, f)
    for (const f of input.fields) {
      const prev = fields.get(f.field)
      fields.set(f.field, { field: f.field, from: prev ? prev.from : clip(f.from), to: clip(f.to) })
    }

    const entry: UpdateLogEntry = {
      bookingRef: input.bookingRef,
      at,
      by: input.by,
      mode: input.mode,
      quotationNo: input.quotationNo,
      revision: input.revision,
      changed: Array.from(new Set([...(existing?.changed ?? []), ...input.changed])),
      fields: Array.from(fields.values()),
      before: {
        itinerary: existing?.before?.itinerary ?? input.before?.itinerary,
        accommodations: existing?.before?.accommodations ?? input.before?.accommodations,
      },
      count: (existing?.count ?? 0) + 1,
    }
    const value = fitRow(entry)
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  } catch (err) {
    console.error('[as-update-log] record failed:', err instanceof Error ? err.message : err)
  }
}

/** Refs updated (with changes) between two dates inclusive, in the scheduler timezone. */
export async function refsUpdatedBetween(fromDate: string, toDate: string): Promise<string[]> {
  const [from, to] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate]
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: {
        gte: `${UPDATE_LOG_PREFIX}${from}:`,
        lt: `${UPDATE_LOG_PREFIX}${shiftDay(to, 1)}:`,
      },
    },
    select: { key: true },
    take: 20_000,
  })
  return Array.from(new Set(rows.map((r) => refFromLogKey(r.key))))
}

/** Every day row for a date range (newest first) — for the settings panel. */
export async function listUpdatesBetween(fromDate: string, toDate: string, take = 500): Promise<UpdateLogEntry[]> {
  const rows = await prisma.systemSetting.findMany({
    where: {
      key: {
        gte: `${UPDATE_LOG_PREFIX}${fromDate}:`,
        lt: `${UPDATE_LOG_PREFIX}${shiftDay(toDate, 1)}:`,
      },
    },
    select: { value: true },
    take,
  })
  return rows
    .map((r) => safeParse<UpdateLogEntry>(r.value))
    .filter((e): e is UpdateLogEntry => !!e)
    .sort((a, b) => b.at.localeCompare(a.at))
}

export interface LatestUpdate {
  date: string
  at: string
  by: string
  mode: UpdateMode
  changed: string[]
}

/**
 * The most recent update of each booking within the last `days` days — used to
 * decorate the rows on one page of the bookings list. Bounded by the page
 * (refs × days exact keys), never a scan.
 */
export async function latestUpdatesFor(bookingRefs: string[], days = 7): Promise<Map<string, LatestUpdate>> {
  const out = new Map<string, LatestUpdate>()
  if (bookingRefs.length === 0) return out
  const today = dateInTz()
  const keys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = shiftDay(today, -i)
    for (const ref of bookingRefs) keys.push(logKey(d, ref))
  }
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } })
  for (const r of rows) {
    const e = safeParse<UpdateLogEntry>(r.value)
    if (!e) continue
    const ref = refFromLogKey(r.key)
    const prev = out.get(ref)
    if (!prev || e.at > prev.at) {
      out.set(ref, { date: dateFromLogKey(r.key), at: e.at, by: e.by, mode: e.mode, changed: e.changed })
    }
  }
  return out
}

/** Drop day rows older than the TTL. Only ever touches this module's own keys. */
export async function pruneUpdateLog(): Promise<number> {
  const cutoff = shiftDay(dateInTz(), -UPDATE_LOG_TTL_DAYS)
  const res = await prisma.systemSetting.deleteMany({
    where: {
      AND: [
        { key: { startsWith: UPDATE_LOG_PREFIX } },
        { key: { lt: `${UPDATE_LOG_PREFIX}${cutoff}:` } },
      ],
    },
  })
  return res.count
}

// ── Pending (found, not applied) ─────────────────────────────────────────────

export async function setPendingUpdate(p: PendingUpdate): Promise<void> {
  const value = JSON.stringify({
    ...p,
    fields: p.fields.slice(0, 30).map((f) => ({ field: f.field, from: clip(f.from), to: clip(f.to) })),
  })
  await prisma.systemSetting.upsert({
    where: { key: pendingKey(p.bookingRef) },
    update: { value },
    create: { key: pendingKey(p.bookingRef), value },
  })
}

/** Remove one booking's pending marker (by exact primary key). Never throws. */
export async function clearPendingUpdate(bookingRef: string): Promise<void> {
  try {
    await prisma.systemSetting.deleteMany({ where: { key: pendingKey(bookingRef) } })
  } catch (err) {
    console.error('[as-update-log] clear pending failed:', err instanceof Error ? err.message : err)
  }
}

export async function getPendingUpdates(bookingRefs?: string[]): Promise<Map<string, PendingUpdate>> {
  const where = bookingRefs
    ? { key: { in: bookingRefs.map(pendingKey) } }
    : { key: { startsWith: UPDATE_PENDING_PREFIX } }
  const rows = await prisma.systemSetting.findMany({ where, select: { key: true, value: true }, take: 5_000 })
  const out = new Map<string, PendingUpdate>()
  for (const r of rows) {
    const p = safeParse<PendingUpdate>(r.value)
    if (p) out.set(r.key.slice(UPDATE_PENDING_PREFIX.length), p)
  }
  return out
}

/**
 * Every booking that needs a person: an update found but held back, or a
 * hand-edited field AppleSystem disagrees with (parked by any sync, waiting for
 * Replace / Skip on the booking page).
 */
export async function refsNeedingReview(): Promise<string[]> {
  const [pending, conflicts] = await Promise.all([
    prisma.systemSetting.findMany({ where: { key: { startsWith: UPDATE_PENDING_PREFIX } }, select: { key: true }, take: 5_000 }),
    prisma.systemSetting.findMany({ where: { key: { startsWith: SYNC_CONFLICT_PREFIX } }, select: { key: true, value: true }, take: 5_000 }),
  ])
  const refs = new Set<string>()
  for (const r of pending) refs.add(r.key.slice(UPDATE_PENDING_PREFIX.length))
  for (const r of conflicts) {
    // A cleared conflict row may be left holding an empty value — only count real ones.
    if (r.value && r.value !== 'null') refs.add(r.key.slice(SYNC_CONFLICT_PREFIX.length))
  }
  return Array.from(refs)
}

/** Refs (of the given set) with parked hand-edit conflicts. */
export async function refsWithConflicts(bookingRefs: string[]): Promise<Set<string>> {
  if (bookingRefs.length === 0) return new Set()
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: bookingRefs.map((r) => `${SYNC_CONFLICT_PREFIX}${r}`) } },
    select: { key: true, value: true },
  })
  return new Set(
    rows.filter((r) => r.value && r.value !== 'null').map((r) => r.key.slice(SYNC_CONFLICT_PREFIX.length)),
  )
}
