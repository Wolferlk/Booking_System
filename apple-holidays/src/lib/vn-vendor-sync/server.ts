/**
 * VN Vendor Sync — server side.
 *
 * Every 15 minutes (a setting):
 *   1. refresh the Excel mirror (Checklist VN 2.1v). That is one Graph call
 *      when the file has not changed — the 8 MB download only happens when the
 *      desk actually edited it. The workbook is READ, never written;
 *   2. for every upcoming Vietnam movement, match it to its tour's sheet lines
 *      (./match.ts) and resolve the sheet's vendor name against the Tour Vendor
 *      directory (then the transport-vendor directory, for a phone number);
 *   3. write the Tour Vendor onto the movement — only when that is safe.
 *
 * What "safe" means here, and is enforced in code, not by convention:
 *   - Only `assignments.tourVendorId / tourVendorName / tourVendorPhone` are
 *     ever written. Driver, vehicle vendor, rate, guide: never.
 *   - Only HIGH-confidence matches are written on their own; MEDIUM ones wait
 *     for a person ("To review"). Mode SUGGEST writes nothing at all.
 *   - A movement that already names a different vendor someone typed is left
 *     alone (KEPT_MANUAL). The sync only replaces a vendor it wrote itself.
 *   - Every write is compare-and-set against the value it read, so a person
 *     saving the chart in the same second wins.
 *   - Only today and later. Past movements are history.
 *   - Every write records what was there before, and can be undone — one
 *     movement at a time or a whole run.
 *   - At most MAX_WRITES_PER_RUN writes per run; the rest become suggestions.
 */
import { Prisma, type VnVendorSyncEvent, type VnVendorSyncLink, type VnVendorSyncRun } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isMissingTable } from '@/lib/vn-includes/includes'
import { runSheetSync, getSheetConfig as getSheetMirrorConfig } from '@/lib/vn-checklist-sheet/sync'
import {
  buildIdf, matchBooking, fold,
  type DirectoryEntry, type MatchLine, type MatchMovement, type MovementDecision,
} from './match'
import {
  DEFAULT_DAYS_AHEAD, DEFAULT_INTERVAL_MIN, VENDOR_SYNC_SETTINGS, sameVendorName,
  CHANGE_ACTIONS,
  type AlsoCandidate, type BookingVendorSyncPayload, type CompareRow, type DirectoryHit, type EventAction, type LinkStatus, type RunSummary,
  type VendorSyncConfig, type VendorSyncEventInfo, type VendorSyncLinkInfo, type VendorSyncMode,
  type VendorSyncRunInfo,
} from './shared'
import { loadVendorDirectory, resolveVendorName, type VendorDirectory } from './registry'

export { isMissingTable }

const MAX_WRITES_PER_RUN = 400
/** A RUNNING row older than this is a run that died (a Lambda frozen mid-run). */
const STALE_LOCK_MS = 10 * 60_000
/** "Fetch now" does not re-read the Excel if it was read this recently. */
const SHEET_FRESH_MANUAL_MS = 60_000
const CLOSED_STATUSES = ['CANCELLED', 'PENDING_CANCELLATION'] as const

/**
 * A vendor can still be required when the row does not need one of our
 * drivers.  In particular, the agenda represents "No Driver Needed" as both
 * `isLeisure` and `isHotelOnly` being true; filtering those flags out here
 * silently loses the Excel transfer for that row.
 *
 * Only rows that cannot carry a tour/transport vendor are excluded.  All
 * transfer and tour service types remain eligible, including vendor-covered
 * rows with the no-driver flags set.
 */
function isVendorSyncItem(item: { serviceType: string | null }): boolean {
  const type = String(item.serviceType ?? '').trim().toUpperCase()
  if (type === 'ACCOMMODATION' || type === 'OWN_ARRANGEMENT' || type === 'FLIGHT') return false
  return true
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export async function getVendorSyncConfig(): Promise<VendorSyncConfig> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(VENDOR_SYNC_SETTINGS) } } })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const mode = String(map.get(VENDOR_SYNC_SETTINGS.mode) ?? 'AUTO').toUpperCase()
  const interval = Number(map.get(VENDOR_SYNC_SETTINGS.intervalMin))
  const days = Number(map.get(VENDOR_SYNC_SETTINGS.daysAhead))
  return {
    mode: (['AUTO', 'SUGGEST', 'OFF'].includes(mode) ? mode : 'AUTO') as VendorSyncMode,
    intervalMin: Number.isFinite(interval) && interval >= 5 && interval <= 240 ? interval : DEFAULT_INTERVAL_MIN,
    daysAhead: Number.isFinite(days) && days >= 1 && days <= 400 ? days : DEFAULT_DAYS_AHEAD,
  }
}

export async function saveVendorSyncConfig(input: Partial<VendorSyncConfig>): Promise<VendorSyncConfig> {
  if (input.mode !== undefined) {
    if (!['AUTO', 'SUGGEST', 'OFF'].includes(input.mode)) throw new Error('Mode must be AUTO, SUGGEST or OFF')
    await setSetting(VENDOR_SYNC_SETTINGS.mode, input.mode)
  }
  if (input.intervalMin !== undefined) {
    const v = Number(input.intervalMin)
    if (!Number.isFinite(v) || v < 5 || v > 240) throw new Error('The interval must be between 5 and 240 minutes')
    await setSetting(VENDOR_SYNC_SETTINGS.intervalMin, String(Math.round(v)))
  }
  if (input.daysAhead !== undefined) {
    const v = Number(input.daysAhead)
    if (!Number.isFinite(v) || v < 1 || v > 400) throw new Error('Days ahead must be between 1 and 400')
    await setSetting(VENDOR_SYNC_SETTINGS.daysAhead, String(Math.round(v)))
  }
  return getVendorSyncConfig()
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** Today in Vietnam, as the UTC midnight movement dates are stored at. */
function vnToday(): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(`${s}T00:00:00Z`)
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const keyPart = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null)

/** Stable across chart saves (which re-create item ids): date + route. */
export function movementKeyOf(item: { date: Date; fromPoint: string | null; toPoint: string | null; location: string | null }): string {
  return `${iso(item.date)}|${keyPart(item.fromPoint)}>${keyPart(item.toPoint) || keyPart(item.location)}`.slice(0, 240)
}

const labelOf = (item: { date: Date; fromPoint: string | null; toPoint: string | null; location: string | null }) =>
  clip(`${iso(item.date)} · ${[item.fromPoint, item.toPoint].filter(Boolean).join(' → ') || item.location || ''}`, 480)

/** `tourVendorName` is trimmed for comparing; `raw` is the exact DB value the compare-and-set must match. */
type Current = { tourVendorId: string | null; tourVendorName: string | null; tourVendorPhone: string | null; raw: string | null }
type Target = { id: string | null; name: string; phone: string | null; source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR' | 'NONE' }

const emptyName = (s: string | null | undefined) => !s || !s.trim()

/**
 * Write the tour vendor onto one movement, compare-and-set. `expected` is the
 * name the movement held when we read it (null = empty). Returns false when
 * someone changed it in between, or the movement no longer exists.
 */
async function writeTourVendor(agendaItemId: string, expected: string | null, target: { id: string | null; name: string | null; phone: string | null }): Promise<boolean> {
  const data = { tourVendorId: target.id, tourVendorName: target.name, tourVendorPhone: target.phone }
  const where: Prisma.AssignmentWhereInput = expected === null
    ? { agendaItemId, OR: [{ tourVendorName: null }, { tourVendorName: '' }] }
    : { agendaItemId, tourVendorName: expected }
  const res = await prisma.assignment.updateMany({ where, data })
  if (res.count > 0) return true
  if (expected !== null) return false
  // No assignment row yet: create one that holds only the tour vendor.
  const exists = await prisma.assignment.findUnique({ where: { agendaItemId }, select: { id: true } })
  if (exists) return false
  try {
    await prisma.assignment.create({ data: { agendaItemId, ...data } })
    return true
  } catch (err) {
    // P2002: someone created it a moment ago. P2003: the movement was deleted by a chart save.
    if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2025'].includes(err.code)) return false
    throw err
  }
}

/** After an undo: drop an assignment row the sync created that now holds nothing at all. */
async function dropIfEmpty(agendaItemId: string): Promise<void> {
  await prisma.assignment.deleteMany({
    where: {
      agendaItemId,
      driverId: null, vendorId: null, vendorName: null, driverName: null, driverPhone: null,
      vehicleType: null, vehiclePlate: null, notes: null, driverRate: null, waSentAt: null,
      guideId: null, guideName: null, guidePhone: null,
      tourVendorId: null, tourVendorName: null, tourVendorPhone: null,
    },
  })
}

async function loadDirectory(): Promise<DirectoryEntry[]> {
  return (await loadVendorDirectory()).entries
}

/** Excel name → directory vendor. A spelling linked in the Vendor Register wins over fuzzy matching. */
function resolveTarget(sheetVendor: string, directory: VendorDirectory): Target & { note: string | null } {
  const m = resolveVendorName(sheetVendor, directory)
  if (!m) return { id: null, name: sheetVendor.trim(), phone: null, source: 'NONE', note: 'Not in the Vendor Register — name only' }
  if (m.ambiguous) return { id: null, name: sheetVendor.trim(), phone: null, source: 'NONE', note: `"${sheetVendor}" fits more than one registered vendor — name only` }
  return {
    // Only a Tour Vendor id can go in tourVendorId; a transport vendor lends its name and phone.
    id: m.entry.source === 'TOUR_VENDOR' ? m.entry.id : null,
    name: m.entry.name,
    phone: m.entry.phone,
    source: m.entry.source,
    note: m.entry.source === 'VEHICLE_VENDOR' ? `Phone from the transport vendor "${m.entry.name}"` : null,
  }
}

// ── Sheet refresh ────────────────────────────────────────────────────────────

async function refreshSheet(trigger: 'CRON' | 'MANUAL' | 'STALE', triggeredBy: string | null): Promise<{ status: string; note: string | null; at: Date | null }> {
  try {
    const cfg = await getSheetMirrorConfig()
    const last = await prisma.vnSheetSync.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true, status: true, finishedAt: true } })
    if (!cfg.enabled && trigger !== 'MANUAL') return { status: 'SKIPPED', note: 'The Excel mirror is switched off in Settings — used the last copy', at: last?.finishedAt ?? null }
    const fresh = trigger === 'MANUAL' ? SHEET_FRESH_MANUAL_MS : 10 * 60_000
    if (last && last.status !== 'FAILED' && last.status !== 'RUNNING' && Date.now() - last.startedAt.getTime() < fresh) {
      return { status: 'SKIPPED', note: `Excel read ${Math.round((Date.now() - last.startedAt.getTime()) / 60_000)} min ago — reused`, at: last.finishedAt ?? last.startedAt }
    }
    const res = await runSheetSync({ trigger: trigger === 'MANUAL' ? 'MANUAL' : 'CRON', triggeredBy })
    if (!res) return { status: 'BUSY', note: 'Another Excel read was in progress — used the last copy', at: last?.finishedAt ?? null }
    const note = res.status === 'FAILED'
      ? `Excel read failed (${clip(res.error, 200)}) — used the last good copy`
      : res.status === 'UNCHANGED' ? 'Excel unchanged since the last read'
        : `Excel read: ${res.added} new, ${res.changed} changed, ${res.removed} removed tour(s)`
    return { status: res.status, note, at: new Date() }
  } catch (err) {
    if (isMissingTable(err)) return { status: 'FAILED', note: 'Checklist VN 2.1v tables are missing — run apply-vn-checklist-sheet.sh', at: null }
    return { status: 'FAILED', note: clip(err instanceof Error ? err.message : String(err), 300), at: null }
  }
}

// ── The run ──────────────────────────────────────────────────────────────────

export type VendorSyncTrigger = 'CRON' | 'MANUAL' | 'STALE'

const inflight = new Map<string, Promise<RunSummary | null>>()
export const isVendorSyncRunning = (scope = 'ALL') => inflight.has(scope)

/**
 * One run. `bookingRef` limits it to one booking ("Fetch now" on a booking).
 * Returns null when a run for the same scope is already going.
 */
/**
 * RETIRED 2026-11-12 — the desk does not want movement vendors filled from the
 * Excel checklist. Movements now get their DRIVER from the VN team's Movement
 * Chart (src/lib/vn-driver-sync). Nothing here runs any more: no sweep, no
 * "Fetch now", no stale kick. The code and tables are kept only so past runs
 * stay readable and could be undone.
 */
export const VENDOR_SYNC_RETIRED = true

export function runVendorSync(opts: { trigger: VendorSyncTrigger; bookingRef?: string | null; triggeredBy?: string | null; refreshSheet?: boolean }): Promise<RunSummary | null> {
  if (VENDOR_SYNC_RETIRED) return Promise.resolve(null)
  const scope = opts.bookingRef?.trim().toUpperCase() || 'ALL'
  const existing = inflight.get(scope)
  if (existing) return existing
  const p = doRun({ ...opts, scope }).finally(() => inflight.delete(scope))
  inflight.set(scope, p)
  return p
}

function toRunInfo(r: VnVendorSyncRun): VendorSyncRunInfo {
  return {
    id: r.id, trigger: r.trigger, scope: r.scope, mode: r.mode, status: r.status as VendorSyncRunInfo['status'],
    startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, durationMs: r.durationMs,
    sheetStatus: r.sheetStatus, sheetNote: r.sheetNote, bookings: r.bookings, movements: r.movements, matched: r.matched,
    applied: r.applied, updated: r.updated, suggested: r.suggested, keptManual: r.keptManual, inSync: r.inSync, noMatch: r.noMatch,
    error: r.error, triggeredBy: r.triggeredBy, undoneAt: r.undoneAt?.toISOString() ?? null, undoneBy: r.undoneBy,
  }
}

async function doRun(opts: { trigger: VendorSyncTrigger; scope: string; triggeredBy?: string | null; refreshSheet?: boolean }): Promise<RunSummary | null> {
  const config = await getVendorSyncConfig()
  const isAll = opts.scope === 'ALL'
  if (config.mode === 'OFF' && opts.trigger !== 'MANUAL') return null

  // Cross-instance lock for the 15-minute sweep.
  if (isAll) {
    const running = await prisma.vnVendorSyncRun.findFirst({
      where: { scope: 'ALL', status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_LOCK_MS) } },
      select: { id: true },
    })
    if (running) return null
  }

  // A "Fetch now" while the mode is OFF still shows matches, but writes nothing.
  const mode: VendorSyncMode = config.mode === 'OFF' ? 'SUGGEST' : config.mode
  const started = Date.now()
  const run = await prisma.vnVendorSyncRun.create({
    data: { trigger: opts.trigger, scope: opts.scope, mode, status: 'RUNNING', triggeredBy: opts.triggeredBy ?? null },
  })
  const counts = { bookings: 0, movements: 0, matched: 0, applied: 0, updated: 0, suggested: 0, keptManual: 0, inSync: 0, noMatch: 0 }
  const changes: RunSummary['changes'] = []

  const finish = async (data: Partial<Prisma.VnVendorSyncRunUpdateInput>): Promise<RunSummary> => {
    const row = await prisma.vnVendorSyncRun.update({
      where: { id: run.id },
      data: { ...counts, ...data, finishedAt: new Date(), durationMs: Date.now() - started },
    })
    return { ...toRunInfo(row), changes: changes.slice(0, 60) }
  }

  try {
    // 1 — Excel.
    let sheetStatus: string | null = null
    let sheetNote: string | null = null
    if (opts.refreshSheet !== false) {
      const s = await refreshSheet(opts.trigger, opts.triggeredBy ?? null)
      sheetStatus = s.status
      sheetNote = s.note
    } else {
      sheetStatus = 'SKIPPED'
      sheetNote = 'Used the stored copy of the Excel'
    }

    // 2 — Movements that can still change: today onwards, inside the window.
    const today = vnToday()
    const until = new Date(today.getTime() + config.daysAhead * 86_400_000)
    const bookings = await prisma.booking.findMany({
      where: {
        operationCountry: 'VIETNAM',
        status: { notIn: [...CLOSED_STATUSES] },
        ...(isAll ? {} : { bookingRef: opts.scope }),
        tourAgenda: { items: { some: { date: { gte: today, lte: until } } } },
      },
      select: {
        bookingRef: true,
        accommodations: { select: { hotel: true, city: true } },
        tourAgenda: {
          select: {
            items: {
              where: { date: { gte: today, lte: until } },
              orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
              select: {
                id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true, serviceType: true,
                isLeisure: true, isHotelOnly: true,
                assignment: { select: { tourVendorId: true, tourVendorName: true, tourVendorPhone: true } },
              },
            },
          },
        },
      },
      take: isAll ? 2000 : 1,
    })
    counts.bookings = bookings.length

    // 3 — The sheet's upcoming tours (IDF is built over all of them, so word
    // weights do not depend on which booking is being looked at).
    const tours = await prisma.vnSheetTour.findMany({
      where: { isActive: true, OR: [{ departureDate: null }, { departureDate: { gte: new Date(today.getTime() - 14 * 86_400_000) } }] },
      select: { tourCode: true, refKey: true, primaryRef: true },
    })
    const lines = tours.length
      ? await prisma.vnSheetLine.findMany({
        where: { tourCode: { in: tours.map(t => t.tourCode) } },
        select: { id: true, tourCode: true, sheetRow: true, details: true, vendor: true, code: true, dates: true },
        orderBy: [{ tourCode: 'asc' }, { position: 'asc' }],
      })
      : []
    const idf = buildIdf(lines.map(l => l.details))
    const linesByTour = new Map<string, MatchLine[]>()
    for (const l of lines) {
      const list = linesByTour.get(l.tourCode) ?? []
      list.push(l)
      linesByTour.set(l.tourCode, list)
    }
    const toursByRef = new Map<string, string[]>()
    for (const t of tours) {
      const refs = new Set([...(t.refKey || '').split(',').filter(Boolean), ...(t.primaryRef ? [t.primaryRef] : [])])
      for (const r of Array.from(refs)) toursByRef.set(r, [...(toursByRef.get(r) ?? []), t.tourCode])
    }

    const directory = await loadVendorDirectory()
    const refs = bookings.map(b => b.bookingRef)
    const links = refs.length ? await prisma.vnVendorSyncLink.findMany({ where: { bookingRef: { in: refs } } }) : []
    const linkByKey = new Map(links.map(l => [`${l.bookingRef}::${l.movementKey}`, l]))

    let writes = 0
    const events: Prisma.VnVendorSyncEventCreateManyInput[] = []

    for (const b of bookings) {
      const codes = toursByRef.get(b.bookingRef) ?? []
      const bookingLines = codes.flatMap(c => linesByTour.get(c) ?? [])
      const items = (b.tourAgenda?.items ?? []).filter(isVendorSyncItem)
      if (!items.length) continue

      // Movement keys, made unique within the booking.
      const keyCount = new Map<string, number>()
      const keyed = items.map(i => {
        const base = movementKeyOf(i)
        const n = (keyCount.get(base) ?? 0) + 1
        keyCount.set(base, n)
        return { item: i, key: n > 1 ? `${base}#${n}` : base }
      })

      const movements: MatchMovement[] = items.map(i => ({
        id: i.id, date: iso(i.date), location: i.location, fromPoint: i.fromPoint, toPoint: i.toPoint,
        details: i.details, serviceType: i.serviceType,
      }))
      const decisions = bookingLines.length ? matchBooking(movements, bookingLines, idf, b.accommodations) : []
      const decisionById = new Map(decisions.map(d => [d.movementId, d]))

      for (const { item, key } of keyed) {
        counts.movements++
        const decision = decisionById.get(item.id) ?? null
        const link = linkByKey.get(`${b.bookingRef}::${key}`) ?? null
        const current: Current = {
          tourVendorId: item.assignment?.tourVendorId ?? null,
          tourVendorName: item.assignment?.tourVendorName?.trim() || null,
          tourVendorPhone: item.assignment?.tourVendorPhone ?? null,
          raw: item.assignment?.tourVendorName ?? null,
        }
        const outcome = await decide({
          runId: run.id, mode, bookingRef: b.bookingRef, item, key, decision, link, current, directory,
          canWrite: writes < MAX_WRITES_PER_RUN, actor: opts.triggeredBy ?? null,
        })
        if (outcome.wrote) writes++
        if (outcome.count) counts[outcome.count]++
        if (decision?.best) counts.matched++
        for (const e of outcome.events) {
          events.push(e)
          if (['APPLIED', 'UPDATED', 'SUGGESTED', 'KEPT_MANUAL', 'SHEET_DROPPED'].includes(e.action)) {
            changes.push({ bookingRef: b.bookingRef, label: e.movementLabel ?? '', action: e.action as EventAction, to: e.toValue ?? null })
          }
        }
      }
    }

    for (let i = 0; i < events.length; i += 500) {
      await prisma.vnVendorSyncEvent.createMany({ data: events.slice(i, i + 500) })
    }

    return await finish({
      status: 'SUCCESS', sheetStatus, sheetNote: clip(sheetNote, 500),
      error: writes >= MAX_WRITES_PER_RUN ? `Write limit of ${MAX_WRITES_PER_RUN} reached — the rest were left as suggestions` : null,
    })
  } catch (err) {
    const message = clip(err instanceof Error ? err.message : String(err), 4000)
    console.error('[VN Vendor Sync] run failed:', message)
    return await finish({ status: 'FAILED', error: message }).catch(() => null as unknown as RunSummary)
  }
}

// ── One movement ─────────────────────────────────────────────────────────────

type Counted = 'applied' | 'updated' | 'suggested' | 'keptManual' | 'inSync' | 'noMatch'

async function decide(p: {
  runId: string
  mode: VendorSyncMode
  bookingRef: string
  item: { id: string; date: Date; location: string | null; fromPoint: string | null; toPoint: string | null }
  key: string
  decision: MovementDecision | null
  link: VnVendorSyncLink | null
  current: Current
  directory: VendorDirectory
  canWrite: boolean
  actor: string | null
}): Promise<{ wrote: boolean; count: Counted | null; events: Prisma.VnVendorSyncEventCreateManyInput[] }> {
  const { decision, link, current } = p
  const label = labelOf(p.item)
  const events: Prisma.VnVendorSyncEventCreateManyInput[] = []
  const ev = (action: EventAction, extra: Partial<Prisma.VnVendorSyncEventCreateManyInput> = {}) =>
    events.push({ runId: p.runId, bookingRef: p.bookingRef, movementKey: p.key, movementLabel: label, action, actor: p.actor, ...extra })
  const best = decision?.best ?? null
  const now = new Date()

  // Line + match facts shared by every status below.
  const facts = best ? {
    tourCode: best.tourCode, sheetRow: best.sheetRow, lineDetails: clip(best.details, 4000), lineCode: clip(best.code, 64),
    sheetVendor: clip(best.vendor, 191), score: best.score, confidence: best.confidence, reason: clip(best.why, 500),
    alsoJson: decision?.also.length
      ? JSON.stringify(decision.also.map((a): AlsoCandidate => ({ vendor: a.vendor, details: clip(a.details, 200) ?? '', code: a.code, score: a.score })))
      : null,
  } : {}
  const base = {
    agendaItemId: p.item.id, movementDate: new Date(`${iso(p.item.date)}T00:00:00Z`), movementLabel: label,
    movementKind: decision?.kind ?? null, lastRunId: p.runId, lastSeenAt: now,
  }

  const save = async (status: LinkStatus, data: Partial<Prisma.VnVendorSyncLinkUncheckedCreateInput> = {}) => {
    const row = { ...base, ...facts, ...data, status }
    await prisma.vnVendorSyncLink.upsert({
      where: { bookingRef_movementKey: { bookingRef: p.bookingRef, movementKey: p.key } },
      create: { bookingRef: p.bookingRef, movementKey: p.key, ...row },
      update: row,
    })
  }

  // ── Nothing on the sheet for this movement.
  if (!best) {
    if (!link) return { wrote: false, count: 'noMatch', events }
    if (link.status === 'APPLIED' && link.appliedName && sameVendorName(current.tourVendorName, link.appliedName)) {
      // We filled it, and the sheet no longer says so. Do not clear it — flag it.
      await save('STALE', { note: 'The Excel no longer names a vendor for this movement — left as it is' })
      ev('SHEET_DROPPED', { fromValue: link.appliedName, detail: 'The Excel no longer names a vendor for this movement; nothing was removed' })
      return { wrote: false, count: 'noMatch', events }
    }
    if (link.status === 'SUGGESTED') {
      await prisma.vnVendorSyncLink.delete({ where: { id: link.id } }).catch(() => undefined)
    } else if (link.status !== 'STALE' && link.status !== 'IGNORED') {
      await prisma.vnVendorSyncLink.update({ where: { id: link.id }, data: { ...base, lastSeenAt: now } }).catch(() => undefined)
    }
    return { wrote: false, count: 'noMatch', events }
  }

  const target = resolveTarget(best.vendor, p.directory)
  const directoryData = {
    directorySource: target.source, vendorId: target.id, vendorName: clip(target.name, 191), vendorPhone: clip(target.phone, 64),
  }

  // ── Ignored: stays ignored, unless the sheet now names someone else.
  if (link?.status === 'IGNORED') {
    if (link.sheetVendor && !sameVendorName(link.sheetVendor, best.vendor)) {
      await save('SUGGESTED', { ...directoryData, note: `Was ignored; the Excel changed ${link.sheetVendor} → ${best.vendor}` })
      ev('SUGGESTED', { fromValue: link.sheetVendor, toValue: clip(target.name, 191), score: best.score, detail: 'The Excel changed the vendor of an ignored movement' })
      return { wrote: false, count: 'suggested', events }
    }
    await prisma.vnVendorSyncLink.update({ where: { id: link.id }, data: { lastRunId: p.runId, lastSeenAt: now, agendaItemId: p.item.id } })
    return { wrote: false, count: null, events }
  }

  const ours = Boolean(link?.appliedName) && sameVendorName(current.tourVendorName, link?.appliedName)

  // ── Already right.
  if (current.tourVendorName && (sameVendorName(current.tourVendorName, target.name) || sameVendorName(current.tourVendorName, best.vendor))) {
    // The sync's own value, now resolvable in the directory: fill the id / phone in.
    let wrote = false
    if (ours && p.mode === 'AUTO' && p.canWrite && (current.tourVendorId !== target.id || (!current.tourVendorPhone && target.phone))) {
      wrote = await writeTourVendor(p.item.id, current.raw, { id: target.id, name: target.name, phone: target.phone ?? current.tourVendorPhone })
      if (wrote) ev('UPDATED', { fromValue: current.tourVendorName, toValue: clip(target.name, 191), score: best.score, detail: 'Linked to the vendor directory' })
    } else if (!ours && p.mode === 'AUTO' && p.canWrite && target.phone && !/\d{6,}/.test((current.tourVendorPhone ?? '').replace(/[^\d]/g, ''))) {
      // The right vendor, set by hand, without a number: add the register's number. The name stays as typed.
      const res = await prisma.assignment.updateMany({
        where: { agendaItemId: p.item.id, tourVendorName: current.raw, tourVendorPhone: current.tourVendorPhone },
        data: { tourVendorPhone: target.phone, ...(current.tourVendorId || !target.id ? {} : { tourVendorId: target.id }) },
      })
      wrote = res.count > 0
      if (wrote) ev('UPDATED', { fromValue: current.tourVendorName, toValue: current.tourVendorName, score: best.score, detail: `Number ${target.phone} added from the Vendor Register` })
    }
    await save(ours ? 'APPLIED' : 'IN_SYNC', { ...directoryData, note: target.note })
    return { wrote, count: 'inSync', events }
  }

  // ── Someone typed a different vendor. Theirs wins.
  if (current.tourVendorName && !ours) {
    const changed = link?.status !== 'KEPT_MANUAL' || !sameVendorName(link?.sheetVendor, best.vendor)
    await save('KEPT_MANUAL', { ...directoryData, note: `Movement has "${current.tourVendorName}" set by hand; the Excel says "${best.vendor}"` })
    if (changed) ev('KEPT_MANUAL', { fromValue: clip(current.tourVendorName, 191), toValue: clip(best.vendor, 191), score: best.score, detail: 'Different vendor set by hand — left alone' })
    return { wrote: false, count: 'keptManual', events }
  }

  // ── Empty, or still holding the vendor this sync wrote earlier.
  const mayWrite = p.mode === 'AUTO' && best.confidence === 'HIGH' && p.canWrite
  if (mayWrite) {
    const wrote = await writeTourVendor(p.item.id, current.tourVendorName ? current.raw : null, target)
    if (wrote) {
      const action: EventAction = current.tourVendorName ? 'UPDATED' : 'APPLIED'
      await save('APPLIED', {
        ...directoryData, note: target.note,
        appliedName: clip(target.name, 191), appliedId: target.id, appliedPhone: clip(target.phone, 64),
        // Keep the value from before the FIRST write — that is what undo restores.
        prevName: link?.appliedName ? link.prevName : current.tourVendorName,
        prevId: link?.appliedName ? link.prevId : current.tourVendorId,
        prevPhone: link?.appliedName ? link.prevPhone : current.tourVendorPhone,
        appliedAt: new Date(), appliedBy: p.actor ? `${p.actor} (Fetch now)` : 'Auto sync', appliedRunId: p.runId,
      })
      ev(action, {
        fromValue: clip(current.tourVendorName, 191), toValue: clip(target.name, 191), score: best.score,
        detail: clip(`${best.code ?? 'Line'} "${best.details}" · ${best.why}${target.note ? ` · ${target.note}` : ''}`, 500),
      })
      return { wrote: true, count: action === 'UPDATED' ? 'updated' : 'applied', events }
    }
    // Lost the race to a person — read it again next run.
    return { wrote: false, count: null, events }
  }

  const reason = p.mode !== 'AUTO' ? 'Suggest-only mode' : !p.canWrite ? 'Write limit reached this run' : 'Medium confidence — needs a person'
  const isNew = link?.status !== 'SUGGESTED' || !sameVendorName(link?.sheetVendor, best.vendor)
  await save('SUGGESTED', { ...directoryData, note: target.note ? `${reason} · ${target.note}` : reason })
  if (isNew) ev('SUGGESTED', { fromValue: clip(current.tourVendorName, 191), toValue: clip(target.name, 191), score: best.score, detail: clip(`${reason} · "${best.details}" · ${best.why}`, 500) })
  return { wrote: false, count: 'suggested', events }
}

// ── Actions from the panel ───────────────────────────────────────────────────

async function resolveItemId(link: VnVendorSyncLink): Promise<string | null> {
  if (link.agendaItemId) {
    const exists = await prisma.agendaItem.findUnique({ where: { id: link.agendaItemId }, select: { id: true } })
    if (exists) return exists.id
  }
  // The chart was saved since; find the movement by its key again.
  const items = await prisma.agendaItem.findMany({
    where: { agenda: { booking: { bookingRef: link.bookingRef } }, ...(link.movementDate ? { date: link.movementDate } : {}) },
    select: { id: true, date: true, fromPoint: true, toPoint: true, location: true },
  })
  const baseKey = link.movementKey.replace(/#\d+$/, '')
  return items.find(i => movementKeyOf(i) === baseKey)?.id ?? null
}

export async function applyLink(linkId: string, actor: string): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link) return { ok: false, message: 'That suggestion is gone — fetch again' }
  if (!link.vendorName) return { ok: false, message: 'Nothing to apply' }
  const itemId = await resolveItemId(link)
  if (!itemId) return { ok: false, message: 'The movement was changed or removed — fetch again' }
  const a = await prisma.assignment.findUnique({ where: { agendaItemId: itemId }, select: { tourVendorId: true, tourVendorName: true, tourVendorPhone: true } })
  const curName = a?.tourVendorName?.trim() || null
  const ours = Boolean(link.appliedName) && sameVendorName(curName, link.appliedName)
  if (curName && !ours && link.status !== 'KEPT_MANUAL') return { ok: false, message: `The movement already has "${curName}"` }
  // On a KEPT_MANUAL row, "Use Excel" is an explicit person's choice to replace theirs.
  const wrote = await writeTourVendor(itemId, curName ? (a?.tourVendorName ?? null) : null, { id: link.vendorId, name: link.vendorName, phone: link.vendorPhone })
  if (!wrote) return { ok: false, message: 'Someone changed this movement a moment ago — fetch again' }
  await prisma.vnVendorSyncLink.update({
    where: { id: link.id },
    data: {
      status: 'APPLIED', agendaItemId: itemId, note: null,
      appliedName: link.vendorName, appliedId: link.vendorId, appliedPhone: link.vendorPhone,
      prevName: link.appliedName ? link.prevName : curName, prevId: link.appliedName ? link.prevId : (a?.tourVendorId ?? null),
      prevPhone: link.appliedName ? link.prevPhone : (a?.tourVendorPhone ?? null),
      appliedAt: new Date(), appliedBy: actor, appliedRunId: null,
    },
  })
  await prisma.vnVendorSyncEvent.create({
    data: {
      bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: curName ? 'UPDATED' : 'APPLIED',
      fromValue: curName, toValue: link.vendorName, score: link.score, actor, detail: clip(`Applied by hand · "${link.lineDetails ?? ''}"`, 500),
    },
  })
  return { ok: true, message: `${link.vendorName} applied` }
}

/** Put back what was there before the sync's first write, then leave the movement alone. */
export async function undoLink(linkId: string, actor: string, runId: string | null = null): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link?.appliedName) return { ok: false, message: 'Nothing the sync wrote here' }
  const itemId = await resolveItemId(link)
  if (itemId) {
    const a = await prisma.assignment.findUnique({ where: { agendaItemId: itemId }, select: { tourVendorName: true } })
    if (a && !sameVendorName(a.tourVendorName, link.appliedName)) {
      return { ok: false, message: `The movement now has "${a.tourVendorName ?? 'nothing'}" — not the sync's value, so it was left alone` }
    }
    if (a) {
      await writeTourVendor(itemId, a.tourVendorName, { id: link.prevId, name: link.prevName, phone: link.prevPhone })
      if (!link.prevName) await dropIfEmpty(itemId)
    }
  }
  await prisma.vnVendorSyncLink.update({
    where: { id: link.id },
    data: { status: 'IGNORED', note: `Undone by ${actor} — the sync leaves this movement alone until resumed`, appliedName: null, appliedId: null, appliedPhone: null, appliedRunId: null },
  })
  await prisma.vnVendorSyncEvent.create({
    data: { runId, bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'UNDONE', fromValue: link.appliedName, toValue: link.prevName, actor },
  })
  return { ok: true, message: `Put back ${link.prevName ? `"${link.prevName}"` : 'an empty tour vendor'}` }
}

export async function undoRun(runId: string, actor: string): Promise<{ ok: boolean; message: string; undone: number; skipped: number }> {
  const run = await prisma.vnVendorSyncRun.findUnique({ where: { id: runId } })
  if (!run) return { ok: false, message: 'Run not found', undone: 0, skipped: 0 }
  const links = await prisma.vnVendorSyncLink.findMany({ where: { appliedRunId: runId, status: 'APPLIED' }, select: { id: true } })
  let undone = 0, skipped = 0
  for (const l of links) {
    const r = await undoLink(l.id, actor, runId)
    if (r.ok) undone++
    else skipped++
  }
  await prisma.vnVendorSyncRun.update({ where: { id: runId }, data: { undoneAt: new Date(), undoneBy: actor } })
  return { ok: true, message: `Undid ${undone} movement(s)${skipped ? `, ${skipped} had been changed since and were left alone` : ''}`, undone, skipped }
}

export async function ignoreLink(linkId: string, actor: string): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link) return { ok: false, message: 'Not found' }
  await prisma.vnVendorSyncLink.update({ where: { id: link.id }, data: { status: 'IGNORED', note: `Ignored by ${actor}` } })
  await prisma.vnVendorSyncEvent.create({
    data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'IGNORED', toValue: link.sheetVendor, actor },
  })
  return { ok: true, message: 'The sync will leave this movement alone' }
}

export async function resumeLink(linkId: string, actor: string): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link) return { ok: false, message: 'Not found' }
  // Back to a suggestion; the next run decides afresh (and may apply it).
  await prisma.vnVendorSyncLink.update({ where: { id: link.id }, data: { status: 'SUGGESTED', note: `Resumed by ${actor}` } })
  await prisma.vnVendorSyncEvent.create({
    data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'RESTORED', toValue: link.sheetVendor, actor },
  })
  return { ok: true, message: 'Resumed — the sync looks at this movement again' }
}

// ── Reads ────────────────────────────────────────────────────────────────────

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? null : Number(v))

function toEvent(e: VnVendorSyncEvent): VendorSyncEventInfo {
  return {
    id: e.id, runId: e.runId, bookingRef: e.bookingRef, movementLabel: e.movementLabel, action: e.action as EventAction,
    fromValue: e.fromValue, toValue: e.toValue, score: num(e.score), detail: e.detail, actor: e.actor, createdAt: e.createdAt.toISOString(),
  }
}

export async function lastAllRun(): Promise<VendorSyncRunInfo | null> {
  const r = await prisma.vnVendorSyncRun.findFirst({ where: { scope: 'ALL', status: { not: 'SKIPPED' } }, orderBy: { startedAt: 'desc' } })
  return r ? toRunInfo(r) : null
}

/** Is the 15-minute sweep due? (a failure retries after 5 minutes) */
export async function isVendorSyncDue(config?: VendorSyncConfig): Promise<boolean> {
  if (VENDOR_SYNC_RETIRED) return false
  const cfg = config ?? await getVendorSyncConfig()
  if (cfg.mode === 'OFF') return false
  const last = await prisma.vnVendorSyncRun.findFirst({ where: { scope: 'ALL' }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true } })
  if (!last) return true
  if (last.status === 'RUNNING') return Date.now() - last.startedAt.getTime() > STALE_LOCK_MS
  const wait = last.status === 'FAILED' ? 5 * 60_000 : cfg.intervalMin * 60_000
  return Date.now() - last.startedAt.getTime() >= wait - 30_000
}

/**
 * Backstop for hosting without a long-lived process (Amplify): the first
 * reader after the interval starts the sweep. Fire-and-forget.
 */
export async function kickIfDue(): Promise<boolean> {
  try {
    if (isVendorSyncRunning('ALL')) return true
    if (!await isVendorSyncDue()) return false
    void runVendorSync({ trigger: 'STALE' }).catch(() => undefined)
    return true
  } catch (err) {
    if (!isMissingTable(err)) console.error('[VN Vendor Sync] stale check failed:', err)
    return false
  }
}

export async function bookingVendorSync(bookingRef: string, canEdit: boolean): Promise<BookingVendorSyncPayload> {
  const ref = bookingRef.trim().toUpperCase()
  const config = await getVendorSyncConfig()
  const [links, events, lastRun, tours, sheetLast] = await Promise.all([
    prisma.vnVendorSyncLink.findMany({ where: { bookingRef: ref }, orderBy: [{ movementDate: 'asc' }, { movementLabel: 'asc' }] }),
    prisma.vnVendorSyncEvent.findMany({ where: { bookingRef: ref }, orderBy: { createdAt: 'desc' }, take: 60 }),
    lastAllRun(),
    prisma.vnSheetTour.findMany({ where: { OR: [{ primaryRef: ref }, { refKey: { contains: `,${ref},` } }] }, select: { tourCode: true } }),
    prisma.vnSheetSync.findFirst({ where: { status: { in: ['SUCCESS', 'UNCHANGED'] } }, orderBy: { startedAt: 'desc' }, select: { finishedAt: true, startedAt: true } }),
  ])

  // The movements as they are now, so the panel shows the live tour vendor.
  const itemIds = links.map(l => l.agendaItemId).filter((x): x is string => Boolean(x))
  const assignments = itemIds.length
    ? await prisma.assignment.findMany({ where: { agendaItemId: { in: itemIds } }, select: { agendaItemId: true, tourVendorId: true, tourVendorName: true, tourVendorPhone: true } })
    : []
  const existing = itemIds.length ? new Set((await prisma.agendaItem.findMany({ where: { id: { in: itemIds } }, select: { id: true } })).map(i => i.id)) : new Set<string>()
  const aBy = new Map(assignments.map(a => [a.agendaItemId, a]))

  const today = iso(vnToday())
  const out: VendorSyncLinkInfo[] = links
    // Past movements and movements the chart no longer has drop out of view (the log keeps them).
    .filter(l => (!l.movementDate || iso(l.movementDate) >= today) && l.agendaItemId && existing.has(l.agendaItemId))
    .map(l => {
      const a = l.agendaItemId ? aBy.get(l.agendaItemId) : undefined
      let also: AlsoCandidate[] = []
      try { also = l.alsoJson ? JSON.parse(l.alsoJson) : [] } catch { also = [] }
      return {
        id: l.id, movementKey: l.movementKey, agendaItemId: l.agendaItemId,
        movementDate: l.movementDate ? iso(l.movementDate) : null, movementLabel: l.movementLabel, movementKind: l.movementKind,
        tourCode: l.tourCode, sheetRow: l.sheetRow, lineDetails: l.lineDetails, lineCode: l.lineCode, sheetVendor: l.sheetVendor,
        score: num(l.score), confidence: (l.confidence as 'HIGH' | 'MEDIUM' | null) ?? null, reason: l.reason, also,
        directorySource: (l.directorySource as VendorSyncLinkInfo['directorySource']) ?? null,
        vendorName: l.vendorName, vendorPhone: l.vendorPhone, status: l.status as LinkStatus, note: l.note,
        appliedName: l.appliedName, prevName: l.prevName, appliedAt: l.appliedAt?.toISOString() ?? null, appliedBy: l.appliedBy,
        current: a ? { tourVendorId: a.tourVendorId, tourVendorName: a.tourVendorName, tourVendorPhone: a.tourVendorPhone } : null,
      }
    })

  const nextRunAt = lastRun && config.mode !== 'OFF'
    ? new Date(new Date(lastRun.startedAt).getTime() + config.intervalMin * 60_000).toISOString()
    : null

  return {
    installed: true, config, canEdit, onSheet: tours.length > 0, tourCodes: tours.map(t => t.tourCode),
    links: out, events: events.map(toEvent), lastRun,
    sheetSyncedAt: sheetLast ? (sheetLast.finishedAt ?? sheetLast.startedAt).toISOString() : null,
    nextRunAt,
  }
}

export async function listRuns(page = 1, pageSize = 25, hideQuiet = true): Promise<{ runs: VendorSyncRunInfo[]; total: number }> {
  // A booking opened with nothing new to do still logs a run; hide those unless asked.
  const where: Prisma.VnVendorSyncRunWhereInput = hideQuiet
    ? { OR: [{ scope: 'ALL' }, { applied: { gt: 0 } }, { updated: { gt: 0 } }, { suggested: { gt: 0 } }, { keptManual: { gt: 0 } }, { status: 'FAILED' }] }
    : {}
  const [rows, total] = await Promise.all([
    prisma.vnVendorSyncRun.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vnVendorSyncRun.count({ where }),
  ])
  return { runs: rows.map(toRunInfo), total }
}

export async function listEvents(q: { page?: number; pageSize?: number; action?: string | null; ref?: string | null; runId?: string | null }): Promise<{ events: VendorSyncEventInfo[]; total: number }> {
  const where: Prisma.VnVendorSyncEventWhereInput = {
    ...(q.action ? { action: q.action } : {}),
    ...(q.ref ? { bookingRef: { contains: q.ref.trim().toUpperCase() } } : {}),
    ...(q.runId ? { runId: q.runId } : {}),
  }
  const page = Math.max(1, q.page ?? 1), pageSize = Math.min(200, Math.max(10, q.pageSize ?? 50))
  const [rows, total] = await Promise.all([
    prisma.vnVendorSyncEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vnVendorSyncEvent.count({ where }),
  ])
  return { events: rows.map(toEvent), total }
}

export async function linkStatusTotals(): Promise<Record<string, number>> {
  const rows = await prisma.vnVendorSyncLink.groupBy({
    by: ['status'], _count: { _all: true },
    where: { movementDate: { gte: vnToday() } },
  })
  return Object.fromEntries(rows.map(r => [r.status, r._count._all]))
}

// ── Compare board: Excel vs system vs before ─────────────────────────────────

export type CompareView = 'attention' | 'all' | 'applied' | 'manual' | 'review' | 'ignored'

export async function listCompare(q: {
  page?: number; pageSize?: number; view?: CompareView; ref?: string | null; runId?: string | null; vendor?: string | null
}): Promise<{ rows: CompareRow[]; total: number }> {
  const page = Math.max(1, q.page ?? 1), pageSize = Math.min(100, Math.max(10, q.pageSize ?? 30))
  const statusIn: Record<CompareView, LinkStatus[] | null> = {
    attention: ['SUGGESTED', 'KEPT_MANUAL', 'STALE'], all: null, applied: ['APPLIED', 'IN_SYNC'],
    manual: ['KEPT_MANUAL'], review: ['SUGGESTED'], ignored: ['IGNORED'],
  }
  const st = statusIn[q.view ?? 'attention']
  const where: Prisma.VnVendorSyncLinkWhereInput = {
    movementDate: { gte: vnToday() },
    ...(st ? { status: { in: st } } : {}),
    ...(q.ref?.trim() ? { bookingRef: { contains: q.ref.trim().toUpperCase() } } : {}),
    ...(q.runId ? { appliedRunId: q.runId } : {}),
    ...(q.vendor?.trim() ? { OR: [{ sheetVendor: { contains: q.vendor.trim() } }, { vendorName: { contains: q.vendor.trim() } }, { appliedName: { contains: q.vendor.trim() } }] } : {}),
  }
  const [links, total] = await Promise.all([
    prisma.vnVendorSyncLink.findMany({ where, orderBy: [{ movementDate: 'asc' }, { bookingRef: 'asc' }, { movementLabel: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.vnVendorSyncLink.count({ where }),
  ])
  if (!links.length) return { rows: [], total }

  const itemIds = links.map(l => l.agendaItemId).filter((x): x is string => Boolean(x))
  const [assignments, events] = await Promise.all([
    prisma.assignment.findMany({ where: { agendaItemId: { in: itemIds } }, select: { agendaItemId: true, tourVendorId: true, tourVendorName: true, tourVendorPhone: true } }),
    prisma.vnVendorSyncEvent.findMany({
      where: { action: { in: CHANGE_ACTIONS }, OR: links.map(l => ({ bookingRef: l.bookingRef, movementKey: l.movementKey })) },
      // cuid ids grow with time — the tie-breaker for two changes in the same millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  ])
  const aBy = new Map(assignments.map(a => [a.agendaItemId, a]))
  const lastBy = new Map<string, VnVendorSyncEvent>()
  for (const e of events) { const k = `${e.bookingRef}::${e.movementKey}`; if (!lastBy.has(k)) lastBy.set(k, e) }

  const rows: CompareRow[] = links.map(l => {
    const a = l.agendaItemId ? aBy.get(l.agendaItemId) : undefined
    const now = a ? { name: a.tourVendorName?.trim() || null, phone: a.tourVendorPhone, tourVendorId: a.tourVendorId } : { name: null, phone: null, tourVendorId: null }
    const last = lastBy.get(`${l.bookingRef}::${l.movementKey}`) ?? null
    let also: AlsoCandidate[] = []
    try { also = l.alsoJson ? JSON.parse(l.alsoJson) : [] } catch { also = [] }
    const before: CompareRow['before'] = last
      ? { name: last.fromValue, from: 'HISTORY' }
      : l.appliedName ? { name: l.prevName, from: 'SYNC' } : { name: null, from: 'UNKNOWN' }
    const setBy = !now.name ? '—'
      : last && sameVendorName(last.toValue, now.name) ? (last.actor ?? 'Auto sync')
        : l.appliedName && sameVendorName(l.appliedName, now.name) ? (l.appliedBy ?? 'Auto sync')
          : 'By hand (Assign Driver dialog)'
    return {
      linkId: l.id, bookingRef: l.bookingRef, agendaItemId: l.agendaItemId,
      movementDate: l.movementDate ? iso(l.movementDate) : null, movementLabel: l.movementLabel, movementKind: l.movementKind,
      status: l.status as LinkStatus, note: l.note,
      excel: {
        vendor: l.sheetVendor, resolved: l.vendorName, phone: l.vendorPhone,
        source: (l.directorySource as CompareRow['excel']['source']) ?? null,
        line: l.lineDetails, code: l.lineCode, sheetRow: l.sheetRow, tourCode: l.tourCode,
        score: num(l.score), confidence: (l.confidence as 'HIGH' | 'MEDIUM' | null) ?? null, reason: l.reason, also,
      },
      now,
      before,
      same: Boolean(now.name) && (sameVendorName(now.name, l.vendorName) || sameVendorName(now.name, l.sheetVendor)),
      lastChange: last ? { action: last.action as EventAction, actor: last.actor ?? 'Auto sync', at: last.createdAt.toISOString(), from: last.fromValue, to: last.toValue } : null,
      setBy,
      canRevert: Boolean(l.appliedName && sameVendorName(l.appliedName, now.name)) || Boolean(last && (last.toValue ? sameVendorName(now.name, last.toValue) : !now.name) && (last.toValue ?? null) !== (last.fromValue ?? null)),
    }
  })
  return { rows, total }
}

/** Tour vendors and transport vendors in Vietnam whose name contains `q`, for the edit box. */
export async function searchDirectory(q: string): Promise<DirectoryHit[]> {
  const term = q.trim()
  const dir = await loadDirectory()
  const f = (s: string) => fold(s)
  const hits = term ? dir.filter(d => f(d.name).includes(f(term))) : dir
  return hits
    .sort((a, b) => (a.source === b.source ? a.name.localeCompare(b.name) : a.source === 'TOUR_VENDOR' ? -1 : 1))
    .slice(0, 15)
    .map(d => ({ id: d.id, name: d.name, phone: d.phone, source: d.source }))
}

/** Status a movement should carry once a PERSON has decided its value. */
function statusForHumanValue(link: VnVendorSyncLink, name: string | null): LinkStatus {
  if (!name) return 'IGNORED'                       // cleared on purpose: do not refill it
  return sameVendorName(name, link.vendorName) || sameVendorName(name, link.sheetVendor) ? 'IN_SYNC' : 'KEPT_MANUAL'
}

/**
 * A person types the tour vendor on the compare board. Compare-and-set against
 * what their screen showed (`expected`), logged as EDITED, and from then on the
 * sync treats it as a hand-set value (never overwrites it).
 */
export async function setManualVendor(
  linkId: string,
  input: { name: string | null; tourVendorId?: string | null; phone?: string | null; expected?: string | null },
  actor: string,
): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link) return { ok: false, message: 'Not found — refresh' }
  const itemId = await resolveItemId(link)
  if (!itemId) return { ok: false, message: 'The movement was changed or removed — refresh' }
  const a = await prisma.assignment.findUnique({ where: { agendaItemId: itemId }, select: { tourVendorId: true, tourVendorName: true, tourVendorPhone: true } })
  const curRaw = a?.tourVendorName ?? null
  const curName = curRaw?.trim() || null
  if (input.expected !== undefined && (input.expected?.trim() || null) !== curName) {
    return { ok: false, message: `Someone changed it to "${curName ?? 'empty'}" since you loaded the page — refresh` }
  }

  let name = input.name?.trim() || null
  let id: string | null = null
  let phone = input.phone?.trim() || null
  if (input.tourVendorId) {
    const tv = await prisma.tourVendor.findUnique({ where: { id: input.tourVendorId }, select: { id: true, name: true, phone: true, whatsappPhone: true } })
    if (tv) { id = tv.id; name = tv.name; phone = phone ?? (tv.whatsappPhone || tv.phone || null) }
  }
  if (name && name.length > 191) return { ok: false, message: 'That name is too long' }
  if ((name ?? null) === curName && (id ?? null) === (a?.tourVendorId ?? null) && (phone ?? null) === (a?.tourVendorPhone ?? null)) {
    return { ok: true, message: 'Nothing changed' }
  }

  const wrote = curName
    ? await writeTourVendor(itemId, curRaw, { id, name, phone })
    : name ? await writeTourVendor(itemId, null, { id, name, phone }) : true
  if (!wrote) return { ok: false, message: 'Someone changed this movement a moment ago — refresh' }
  if (!name) await dropIfEmpty(itemId)

  await prisma.vnVendorSyncLink.update({
    where: { id: link.id },
    data: {
      agendaItemId: itemId, status: statusForHumanValue(link, name),
      note: `Edited by ${actor}`, appliedName: null, appliedId: null, appliedPhone: null, appliedRunId: null,
    },
  })
  await prisma.vnVendorSyncEvent.create({
    data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'EDITED', fromValue: curName, toValue: name, actor, detail: phone ? `Phone ${phone}` : null },
  })
  return { ok: true, message: name ? `Set to ${name}` : 'Tour vendor cleared' }
}

/**
 * Walk back the LAST change to this movement, whoever made it: a sync write
 * goes back through undoLink (to the value before the sync's first write); a
 * person's edit or revert goes back to the value it replaced.
 */
export async function revertLast(linkId: string, actor: string): Promise<{ ok: boolean; message: string }> {
  const link = await prisma.vnVendorSyncLink.findUnique({ where: { id: linkId } })
  if (!link) return { ok: false, message: 'Not found — refresh' }
  const last = await prisma.vnVendorSyncEvent.findFirst({
    where: { bookingRef: link.bookingRef, movementKey: link.movementKey, action: { in: CHANGE_ACTIONS } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  if ((!last || last.action === 'APPLIED' || last.action === 'UPDATED') && link.appliedName) return undoLink(link.id, actor)
  if (!last) return { ok: false, message: 'No change recorded to revert' }

  const itemId = await resolveItemId(link)
  if (!itemId) return { ok: false, message: 'The movement was changed or removed — refresh' }
  const a = await prisma.assignment.findUnique({ where: { agendaItemId: itemId }, select: { tourVendorName: true } })
  const curRaw = a?.tourVendorName ?? null
  const curName = curRaw?.trim() || null
  const matchesLast = last.toValue ? sameVendorName(curName, last.toValue) : !curName
  if (!matchesLast) return { ok: false, message: `The movement now has "${curName ?? 'nothing'}", not "${last.toValue ?? 'empty'}" — changed elsewhere, left alone` }

  const back = last.fromValue?.trim() || null
  let target: { id: string | null; name: string | null; phone: string | null } = { id: null, name: back, phone: null }
  if (back) {
    const hit = (await loadDirectory()).find(d => sameVendorName(d.name, back) && fold(d.name) === fold(back))
      ?? (await loadDirectory()).find(d => sameVendorName(d.name, back))
    if (hit) target = { id: hit.source === 'TOUR_VENDOR' ? hit.id : null, name: back, phone: hit.phone }
  }
  const wrote = curName ? await writeTourVendor(itemId, curRaw, target) : back ? await writeTourVendor(itemId, null, target) : true
  if (!wrote) return { ok: false, message: 'Someone changed this movement a moment ago — refresh' }
  if (!back) await dropIfEmpty(itemId)

  await prisma.vnVendorSyncLink.update({
    where: { id: link.id },
    data: { agendaItemId: itemId, status: statusForHumanValue(link, back), note: `Reverted by ${actor}`, appliedName: null, appliedId: null, appliedPhone: null, appliedRunId: null },
  })
  await prisma.vnVendorSyncEvent.create({
    data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'REVERTED', fromValue: curName, toValue: back, actor, detail: `Reverted the ${last.action.toLowerCase()} by ${last.actor ?? 'Auto sync'}` },
  })
  return { ok: true, message: `Put back ${back ? `"${back}"` : 'an empty tour vendor'}` }
}

/** "Use Excel" on several rows at once. */
export async function applyMany(linkIds: string[], actor: string): Promise<{ applied: number; failed: { linkId: string; message: string }[] }> {
  let applied = 0
  const failed: { linkId: string; message: string }[] = []
  for (const id of linkIds.slice(0, 100)) {
    const r = await applyLink(id, actor)
    if (r.ok) applied++
    else failed.push({ linkId: id, message: r.message })
  }
  return { applied, failed }
}
