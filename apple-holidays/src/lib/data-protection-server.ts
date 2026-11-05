/**
 * Database side of data protection — see `data-protection.ts` for the why.
 *
 * Every read here fails SAFE: an unreadable policy is the default policy (all
 * protection on), an unreadable baseline means "keep every existing flight".
 * The worst a failure can do is leave a stale flight for a person to delete;
 * it can never delete one somebody typed in.
 */

import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import {
  DATA_PROTECTION_KEY, DEFAULT_DATA_PROTECTION, bookingLockKey, flightBaselineKey,
  flightFingerprint, flightKey, parseBookingLocks, parseDataProtectionPolicy, planFlightResync,
  type BookingLocks, type ChildGuardReport, type DataProtectionPolicy, type FlightResyncReport,
  type LockSection, type SectionLock,
} from '@/lib/data-protection'

/* ── Policy + locks ─────────────────────────────────────────────────────── */

export async function getDataProtectionPolicy(): Promise<DataProtectionPolicy> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: DATA_PROTECTION_KEY } })
    return parseDataProtectionPolicy(row?.value)
  } catch {
    return { ...DEFAULT_DATA_PROTECTION }
  }
}

/** Locks as stored, whether or not the policy currently honours them. */
export async function readBookingLocks(bookingId: string): Promise<BookingLocks> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: bookingLockKey(bookingId) } })
    return parseBookingLocks(row?.value)
  } catch {
    return {}
  }
}

export async function setSectionLock(bookingId: string, section: LockSection, lock: SectionLock | null) {
  const key = bookingLockKey(bookingId)
  const locks = await readBookingLocks(bookingId)
  if (lock) locks[section] = lock
  else delete locks[section]
  if (Object.keys(locks).length === 0) {
    await prisma.systemSetting.deleteMany({ where: { key } })
  } else {
    const value = JSON.stringify(locks)
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }
  return locks
}

export interface ChildGuard {
  policy: DataProtectionPolicy
  locks: BookingLocks
  isLocked: (s: LockSection) => boolean
}

/** Load once per re-import; pass to `resyncFlights` and check the other sections with `isLocked`. */
export async function loadChildGuard(bookingId: string): Promise<ChildGuard> {
  const policy = await getDataProtectionPolicy()
  const locks = policy.bookingLocks ? await readBookingLocks(bookingId) : {}
  return { policy, locks, isLocked: s => Boolean(locks[s]) }
}

/* ── Flight baseline ────────────────────────────────────────────────────── */

type SnapshotFlight = {
  flightNo?: string; date?: string; fromApt?: string; depTime?: string | null; toApt?: string
  arrTime?: string | null; airline?: string | null; notes?: string | null
}

function snapshotFlights(docSnapshot: string | null | undefined): SnapshotFlight[] {
  try {
    const snap = JSON.parse(docSnapshot ?? '{}') as { flights?: SnapshotFlight[] }
    return Array.isArray(snap.flights) ? snap.flights : []
  } catch {
    return []
  }
}

const asFlight = (f: SnapshotFlight) => ({
  flightNo: String(f.flightNo ?? ''), date: String(f.date ?? ''), fromApt: String(f.fromApt ?? ''),
  depTime: f.depTime ?? '', toApt: String(f.toApt ?? ''), arrTime: f.arrTime ?? '',
  airline: f.airline ?? null, notes: f.notes ?? null,
})

/**
 * Every import from this release on records its baseline row. Snapshots
 * taken since then also contain the hand-entered flights a merge kept, so
 * one of those standing in for a missing row would hand those flights to the
 * next import to delete. Only snapshots from before stand in.
 */
const BASELINE_RECORDED_SINCE = new Date('2026-10-26T00:00:00Z')

/**
 * What the previous import wrote. Recorded on every import from now on; for
 * bookings imported before that, the newest import-sourced version snapshot
 * (taken right after the import) stands in. Null = unknown → keep everything.
 */
async function loadFlightBaseline(bookingId: string): Promise<string[] | null> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: flightBaselineKey(bookingId) } })
    if (row) {
      const parsed = JSON.parse(row.value) as { fps?: unknown }
      if (Array.isArray(parsed.fps)) return parsed.fps.map(String)
    }
    const v = await prisma.bookingVersion.findFirst({
      where:   { bookingId, source: { in: ['onedrive', 'mail'] } },
      orderBy: { versionNo: 'desc' },
      select:  { docSnapshot: true, createdAt: true },
    })
    if (!v?.docSnapshot || v.createdAt >= BASELINE_RECORDED_SINCE) return null
    return snapshotFlights(v.docSnapshot).map(f => flightFingerprint(asFlight(f)))
  } catch {
    return null
  }
}

async function saveFlightBaseline(bookingId: string, fps: string[], source: string) {
  const key = flightBaselineKey(bookingId)
  const value = JSON.stringify({ fps, source, at: new Date().toISOString() })
  try {
    await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  } catch (err) {
    // Non-fatal: next import falls back to the version snapshot.
    console.warn(`[data-protection] could not save flight baseline for ${bookingId}:`, err)
  }
}

/* ── Re-import ──────────────────────────────────────────────────────────── */

export interface IncomingFlightRow {
  flightNo: string
  date: Date
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline: string | null
  notes: string | null
}

/**
 * Replace the flights a TC re-import owns, and only those. Called by every
 * pipeline that used to `deleteMany` + `createMany` flights from a document.
 */
export async function resyncFlights(
  bookingId: string,
  incoming: IncomingFlightRow[],
  opts: { guard: ChildGuard; source: string; actorId?: string; bookingRef?: string },
): Promise<FlightResyncReport> {
  const { guard, source } = opts

  if (guard.isLocked('flights')) {
    const n = await prisma.flight.count({ where: { bookingId } })
    const report: FlightResyncReport = { mode: 'locked', kept: n, unchanged: 0, removed: 0, added: 0, skipped: incoming.length, keptFlightNos: [] }
    await logGuard(opts, report, bookingId)
    return report
  }

  if (!guard.policy.keepManualFlights) {
    // Protection switched off: the original behaviour, whole list from the document.
    const [deleted] = await prisma.$transaction([
      prisma.flight.deleteMany({ where: { bookingId } }),
      prisma.flight.createMany({ data: incoming.map(f => ({ ...f, bookingId })) }),
    ])
    await saveFlightBaseline(bookingId, incoming.map(flightFingerprint), source)
    return { mode: 'replaced', kept: 0, unchanged: 0, removed: deleted.count, added: incoming.length, skipped: 0, keptFlightNos: [] }
  }

  const existing = await prisma.flight.findMany({ where: { bookingId }, orderBy: { date: 'asc' } })
  const baseline = await loadFlightBaseline(bookingId)
  const plan = planFlightResync(existing, incoming, baseline)

  const writes = []
  if (plan.remove.length) {
    writes.push(prisma.flight.deleteMany({ where: { bookingId, id: { in: plan.remove.map(f => f.id) } } }))
  }
  if (plan.insert.length) {
    writes.push(prisma.flight.createMany({ data: plan.insert.map(f => ({ ...f, bookingId })) }))
  }
  if (writes.length) await prisma.$transaction(writes)
  await saveFlightBaseline(bookingId, plan.baseline, source)

  const report: FlightResyncReport = {
    mode: 'merged',
    kept: plan.keep.length,
    unchanged: plan.unchanged.length,
    removed: plan.remove.length,
    added: plan.insert.length,
    skipped: plan.skipped.length,
    keptFlightNos: plan.keep.map(f => f.flightNo),
  }
  if (report.kept > 0 || report.skipped > 0) await logGuard(opts, report, bookingId)
  return report
}

async function logGuard(
  opts: { guard: ChildGuard; source: string; actorId?: string; bookingRef?: string },
  report: FlightResyncReport,
  bookingId?: string,
) {
  if (!opts.actorId) return
  await logActivity({
    userId:     opts.actorId,
    action:     'FLIGHTS_PROTECTED',
    entityType: 'Booking',
    entityId:   bookingId,
    details:    { bookingRef: opts.bookingRef, source: opts.source, ...report },
  })
}

export function buildGuardReport(guard: ChildGuard, flights: FlightResyncReport): ChildGuardReport {
  return {
    flights,
    lockedSections: (Object.keys(guard.locks) as LockSection[]).filter(s => guard.isLocked(s)),
  }
}

/**
 * Which current flights the next re-import would keep (hand work) and which it
 * owns (written by the last import) — what the Flights card badges show.
 */
export async function classifyFlights(bookingId: string) {
  const existing = await prisma.flight.findMany({ where: { bookingId } })
  const baseline = await loadFlightBaseline(bookingId)
  const plan = planFlightResync(existing, [], baseline)
  return {
    manualIds: plan.keep.map(f => f.id),
    importIds: plan.remove.map(f => f.id),
    baselineKnown: baseline !== null,
  }
}

/* ── Restore from history ───────────────────────────────────────────────── */

export interface RestorableFlight {
  fingerprint: string
  flightNo: string
  date: string
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline: string | null
  notes: string | null
  lastSeenVersion: number
  lastSeenAt: string
  lastSeenSource: string | null
  /** A current flight with the same number + day but different details — restoring replaces it. */
  replaces: { id: string; depTime: string; arrTime: string; fromApt: string; toApt: string; notes: string | null } | null
}

const MAX_VERSIONS_SCANNED = 40

/**
 * Flights an older version held that the booking no longer has (or has with
 * different details). `maxVersions` keeps the badge count cheap — snapshots
 * are full-booking JSON.
 */
export async function listRestorableFlights(
  bookingId: string,
  maxVersions = MAX_VERSIONS_SCANNED,
): Promise<RestorableFlight[]> {
  const [current, versions] = await Promise.all([
    prisma.flight.findMany({ where: { bookingId } }),
    prisma.bookingVersion.findMany({
      where:   { bookingId },
      orderBy: { versionNo: 'desc' },
      take:    maxVersions,
      select:  { versionNo: true, createdAt: true, source: true, docSnapshot: true },
    }),
  ])
  const currentFps = new Set(current.map(flightFingerprint))
  const currentByKey = new Map(current.map(f => [flightKey(f), f]))

  const found = new Map<string, RestorableFlight>()
  for (const v of versions) {
    for (const raw of snapshotFlights(v.docSnapshot)) {
      const f = asFlight(raw)
      if (!f.flightNo || !f.date) continue
      const fp = flightFingerprint(f)
      if (currentFps.has(fp) || found.has(fp)) continue
      const same = currentByKey.get(flightKey(f))
      found.set(fp, {
        fingerprint: fp,
        ...f,
        depTime: f.depTime ?? '',
        arrTime: f.arrTime ?? '',
        lastSeenVersion: v.versionNo,
        lastSeenAt: v.createdAt.toISOString(),
        lastSeenSource: v.source,
        replaces: same
          ? { id: same.id, depTime: same.depTime, arrTime: same.arrTime, fromApt: same.fromApt, toApt: same.toApt, notes: same.notes }
          : null,
      })
    }
  }
  return Array.from(found.values()).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Bring chosen flights back. Additive: a missing flight is created; one whose
 * number + day already exists has that row's details put back (the values it
 * replaces are written to the activity log, so even this is reversible).
 */
export async function restoreFlights(
  bookingId: string,
  fingerprints: string[],
  actor: { id: string; bookingRef: string },
) {
  const wanted = new Set(fingerprints)
  const chosen = (await listRestorableFlights(bookingId)).filter(f => wanted.has(f.fingerprint))
  if (chosen.length === 0) return { created: 0, replaced: 0 }

  const usedReplace = new Set<string>()
  const ops = []
  const replacedLog: unknown[] = []
  let created = 0
  for (const f of chosen) {
    const data = {
      flightNo: f.flightNo, date: new Date(f.date), fromApt: f.fromApt, depTime: f.depTime,
      toApt: f.toApt, arrTime: f.arrTime, airline: f.airline, notes: f.notes,
    }
    if (f.replaces && !usedReplace.has(f.replaces.id)) {
      usedReplace.add(f.replaces.id)
      replacedLog.push({ id: f.replaces.id, before: f.replaces, after: data })
      ops.push(prisma.flight.update({ where: { id: f.replaces.id }, data }))
    } else {
      created += 1
      ops.push(prisma.flight.create({ data: { ...data, bookingId } }))
    }
  }
  await prisma.$transaction(ops)

  await logActivity({
    userId:     actor.id,
    action:     'FLIGHTS_RESTORED',
    entityType: 'Booking',
    entityId:   bookingId,
    details:    {
      bookingRef: actor.bookingRef,
      restored: chosen.map(f => ({ flightNo: f.flightNo, date: f.date, fromVersion: f.lastSeenVersion })),
      replaced: replacedLog,
    },
  })
  return { created, replaced: usedReplace.size }
}
