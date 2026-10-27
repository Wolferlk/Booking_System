/**
 * Data protection — keeping what people fix by hand when a document re-syncs.
 *
 * A Tour Confirmation re-import (OneDrive "Sync", a TC amendment email, a
 * version switch) used to delete every passenger, flight and hotel on the
 * booking and rebuild them from the document. Flights are the painful one:
 * file handlers add them by hand after the TC is out (the TC rarely carries
 * them), so one click on "Sync from OneDrive" — even the one on the PNL page —
 * silently erased their work.
 *
 * Four switches, all ON by default, live in one `system_settings` row
 * (`data_protection_policy`) so they can be turned off without a deploy:
 *
 *   keepManualFlights — a re-import only replaces the flights the PREVIOUS
 *                       import wrote. Anything a person added or edited since
 *                       is left exactly as it is.
 *   bookingLocks      — per-booking padlocks on Flights / Hotels / Passengers.
 *                       A locked section is never rewritten by a re-import or
 *                       a version switch. Hand edits still work.
 *   pnlSyncPnlOnly    — the PNL page's "Sync from OneDrive" reads the PNL file
 *                       only, instead of re-importing the TC as well.
 *   flightRestore     — the Flights card offers to bring back flights that
 *                       older versions of the booking held.
 *
 * Nothing here needs a schema change: the policy, the locks and the "what the
 * last import wrote" baseline are all plain key/value rows. This file is pure
 * (no Prisma) so the settings card and the booking page can import it too;
 * the database side is `data-protection-server.ts`.
 */

/* ── Policy ─────────────────────────────────────────────────────────────── */

export const DATA_PROTECTION_KEY = 'data_protection_policy'

export interface DataProtectionPolicy {
  keepManualFlights: boolean
  bookingLocks: boolean
  pnlSyncPnlOnly: boolean
  flightRestore: boolean
}

export const DEFAULT_DATA_PROTECTION: DataProtectionPolicy = {
  keepManualFlights: true,
  bookingLocks: true,
  pnlSyncPnlOnly: true,
  flightRestore: true,
}

export function parseDataProtectionPolicy(raw?: string | null): DataProtectionPolicy {
  let obj: Record<string, unknown> = {}
  try { obj = raw ? JSON.parse(raw) : {} } catch { obj = {} }
  const pick = (k: keyof DataProtectionPolicy) =>
    typeof obj?.[k] === 'boolean' ? (obj[k] as boolean) : DEFAULT_DATA_PROTECTION[k]
  return {
    keepManualFlights: pick('keepManualFlights'),
    bookingLocks:      pick('bookingLocks'),
    pnlSyncPnlOnly:    pick('pnlSyncPnlOnly'),
    flightRestore:     pick('flightRestore'),
  }
}

/* ── Section locks ──────────────────────────────────────────────────────── */

export type LockSection = 'flights' | 'accommodations' | 'passengers'

export const LOCK_SECTIONS: LockSection[] = ['flights', 'accommodations', 'passengers']

export const LOCK_SECTION_LABELS: Record<LockSection, string> = {
  flights:        'Flights',
  accommodations: 'Hotels',
  passengers:     'Passengers',
}

/**
 * Who may lock / unlock a section — the same desks the booking page already
 * lets edit it (`canEditFlights`, `canEditBooking`, `canEditPassengers`).
 */
const HOTEL_EDITORS = ['GT_USER', 'GT_TE_USER', 'BT_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
export const LOCK_ROLES: Record<LockSection, string[]> = {
  flights:        ['TE_USER', 'GT_TE_USER', 'BT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
  accommodations: HOTEL_EDITORS,
  passengers:     [...HOTEL_EDITORS, 'GT_VN_USER'],
}
/** Restoring flights is a flight edit. */
export const FLIGHT_RESTORE_ROLES = LOCK_ROLES.flights

export interface SectionLock {
  by: string
  at: string
  note?: string | null
}

export type BookingLocks = Partial<Record<LockSection, SectionLock>>

export const bookingLockKey = (bookingId: string) => `booking_lock:${bookingId}`

export function parseBookingLocks(raw?: string | null): BookingLocks {
  let obj: Record<string, unknown> = {}
  try { obj = raw ? JSON.parse(raw) : {} } catch { return {} }
  const out: BookingLocks = {}
  for (const s of LOCK_SECTIONS) {
    const l = obj?.[s] as SectionLock | undefined
    if (l && typeof l === 'object' && typeof l.by === 'string') {
      out[s] = { by: l.by, at: String(l.at ?? ''), note: l.note ?? null }
    }
  }
  return out
}

/* ── Flight identity ────────────────────────────────────────────────────── */

export interface FlightLike {
  id?: string
  flightNo: string
  date: string | Date
  fromApt: string
  depTime?: string | null
  toApt: string
  arrTime?: string | null
  airline?: string | null
  notes?: string | null
}

/** Which flights the last TC import wrote — their fingerprints, one row per booking. */
export const flightBaselineKey = (bookingId: string) => `flight_tc_baseline:${bookingId}`

/** File-handler portal flights carry this note ("Filed by harshini@…"). */
export const FILED_BY_NOTE = /^\s*filed by\b/i

const clean = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, ' ')

/**
 * Calendar day as stored. Always via `Date` so a TC string, a DB DateTime and
 * a JSON snapshot of either all land on the same UTC day.
 */
export function flightDay(d: string | Date | null | undefined): string {
  if (!d) return ''
  const t = d instanceof Date ? d : new Date(d)
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10)
}

/** Same flight, regardless of times or notes: number + day. */
export function flightKey(f: FlightLike): string {
  return `${clean(f.flightNo).replace(/\s+/g, '')}|${flightDay(f.date)}`
}

/** Every visible field — any hand edit changes it. */
export function flightFingerprint(f: FlightLike): string {
  return [
    flightKey(f), clean(f.fromApt), clean(f.depTime), clean(f.toApt),
    clean(f.arrTime), clean(f.airline), clean(f.notes),
  ].join('|')
}

/* ── Re-sync planning ───────────────────────────────────────────────────── */

export interface FlightResyncPlan<E extends FlightLike, I extends FlightLike> {
  /** Added or edited by a person since the last import — left untouched. */
  keep: E[]
  /** Written by the last import and still identical in the new one — left in place. */
  unchanged: E[]
  /** Written by the last import, dropped or changed by the new one. */
  remove: E[]
  /** New import flights to write. */
  insert: I[]
  /** New import flights skipped because a kept flight already has that number + day. */
  skipped: I[]
  /** Fingerprints the import owns after this run — the next run's baseline. */
  baseline: string[]
}

/**
 * Decide what a TC re-import may touch.
 *
 * `baseline` is the fingerprint list the previous import wrote. With no
 * baseline (never recorded, unreadable) every existing flight counts as hand
 * work and is kept — the import can only add flights, never take any away.
 */
export function planFlightResync<E extends FlightLike, I extends FlightLike>(
  existing: E[],
  incoming: I[],
  baseline: string[] | null,
): FlightResyncPlan<E, I> {
  // Multiset, so two identical TC rows only vouch for two existing rows.
  const owned = new Map<string, number>()
  for (const fp of baseline ?? []) owned.set(fp, (owned.get(fp) ?? 0) + 1)

  const keep: E[] = []
  const fromImport: E[] = []
  for (const f of existing) {
    const fp = flightFingerprint(f)
    const n = owned.get(fp) ?? 0
    if (baseline && n > 0 && !FILED_BY_NOTE.test(f.notes ?? '')) {
      owned.set(fp, n - 1)
      fromImport.push(f)
    } else {
      keep.push(f)
    }
  }

  const keptKeys = new Set(keep.map(flightKey))
  const reusable = new Map<string, E[]>()
  for (const f of fromImport) {
    const fp = flightFingerprint(f)
    reusable.set(fp, [...(reusable.get(fp) ?? []), f])
  }

  const unchanged: E[] = []
  const insert: I[] = []
  const skipped: I[] = []
  const baselineOut: string[] = []
  for (const f of incoming) {
    if (keptKeys.has(flightKey(f))) { skipped.push(f); continue }
    const fp = flightFingerprint(f)
    const same = reusable.get(fp)
    if (same?.length) unchanged.push(same.shift()!)
    else insert.push(f)
    baselineOut.push(fp)
  }

  const stayed = new Set(unchanged)
  const remove = fromImport.filter(f => !stayed.has(f))

  return { keep, unchanged, remove, insert, skipped, baseline: baselineOut }
}

/* ── What happened, for logs and toasts ─────────────────────────────────── */

export interface FlightResyncReport {
  mode: 'merged' | 'replaced' | 'locked'
  kept: number
  unchanged: number
  removed: number
  added: number
  skipped: number
  /** Kept flights by number, so a toast can name them. */
  keptFlightNos: string[]
}

export interface ChildGuardReport {
  flights: FlightResyncReport
  lockedSections: LockSection[]
}

/** One line for a toast: null when nothing worth mentioning was protected. */
export function describeGuardReport(r: ChildGuardReport | null | undefined): string | null {
  if (!r) return null
  const parts: string[] = []
  if (r.flights.mode === 'locked') parts.push('flights locked — left as they were')
  else if (r.flights.kept > 0) {
    parts.push(`kept ${r.flights.kept} hand-entered flight${r.flights.kept === 1 ? '' : 's'} (${r.flights.keptFlightNos.slice(0, 4).join(', ')}${r.flights.keptFlightNos.length > 4 ? '…' : ''})`)
  }
  const other = r.lockedSections.filter(s => s !== 'flights').map(s => LOCK_SECTION_LABELS[s].toLowerCase())
  if (other.length) parts.push(`${other.join(' & ')} locked — left as they were`)
  return parts.length ? `Protected: ${parts.join(' · ')}` : null
}
