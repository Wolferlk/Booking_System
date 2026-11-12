/**
 * VN Driver Sync — server side.
 *
 * Every 15 minutes (a setting):
 *   1. download the "(VN TEAM) Movement Chart" workbook from OneDrive via Microsoft Graph (./sheet.ts) — READ only;
 *   2. for every upcoming Vietnam booking, match its sheet rows to its system
 *      movements (./match.ts: rules, then OpenAI for the unsure ones);
 *   3. write the sheet's Vendors text onto the movement as its driver:
 *        driverName  = the full text ("Go Air - Driver's manager in Hanoi: +848… / +843… - Dương / Thảo Goair")
 *        driverPhone = the numbers only ("+84899802839 / +84368933597")
 *      Guests are only ever shown the numbers (src/lib/guest-driver.ts).
 *
 * What "safe" means, enforced in code:
 *   - Only `assignments.driverName / driverPhone` are written (and `waSentAt`
 *     cleared so a changed driver is briefed again). Never driverId, the
 *     vehicle vendor, the rate, the guide or the tour vendor.
 *   - Only when the movement has no driver at all, or still holds the exact
 *     text this sync wrote. A driver from the directory, a vehicle vendor, or
 *     a name someone typed is KEPT. Every write is compare-and-set.
 *   - Only HIGH-confidence matches are written on their own; the rest wait
 *     ("To review"). Mode SUGGEST writes nothing.
 *   - A sheet text without a phone number is never written.
 *   - A movement marked "No driver needed" is only suggested.
 *   - Only today and later. Every write keeps what was there before and can
 *     be undone, per movement or per run. At most MAX_WRITES_PER_RUN per run.
 */
import { Prisma, type VnDriverSyncLink, type VnDriverSyncRun } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isMissingTable } from '@/lib/vn-includes/includes'
import { fold } from '@/lib/vn-vendor-sync/match'
import { serviceTypeShortLabel } from '@/lib/service-types'
import { parse12h } from '@/lib/clock-time'
import { extractPhones } from '@/lib/guest-driver'
import { readMovementSheet, serviceAccount, SheetAccessError, type SheetRow } from './sheet'
import { matchBooking, type AiCacheEntry, type Movement, type Pick as MatchPick } from './match'
import {
  DEFAULT_DAYS_AHEAD, DEFAULT_INTERVAL_MIN, DEFAULT_SHEET_URL, DRIVER_SYNC_SETTINGS, isMicrosoftLink, sheetIdOf, sheetUrlOf,
  type DriverSyncConfig, type DriverSyncEventInfo, type DriverSyncLinkInfo, type DriverSyncMode, type DriverSyncOverview,
  type DriverSyncRunInfo, type EventAction, type LinkStatus, type SheetState, type UnmatchedRow,
} from './shared'

export { isMissingTable }

const MAX_WRITES_PER_RUN = 400
const AI_CALLS_PER_RUN = 40
const STALE_LOCK_MS = 10 * 60_000
const CLOSED_STATUSES = ['CANCELLED', 'PENDING_CANCELLATION'] as const
const NOT_DRIVEN = new Set(['ACCOMMODATION', 'FLIGHT'])

// ── Settings ─────────────────────────────────────────────────────────────────

async function setSetting(key: string, value: string): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
}

export async function getDriverSyncConfig(): Promise<DriverSyncConfig> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: Object.values(DRIVER_SYNC_SETTINGS) } } })
  const map = new Map(rows.map(r => [r.key, r.value]))
  const mode = String(map.get(DRIVER_SYNC_SETTINGS.mode) ?? 'AUTO').toUpperCase()
  const interval = Number(map.get(DRIVER_SYNC_SETTINGS.intervalMin))
  const days = Number(map.get(DRIVER_SYNC_SETTINGS.daysAhead))
  return {
    mode: (['AUTO', 'SUGGEST', 'OFF'].includes(mode) ? mode : 'AUTO') as DriverSyncMode,
    intervalMin: Number.isFinite(interval) && interval >= 5 && interval <= 240 ? interval : DEFAULT_INTERVAL_MIN,
    daysAhead: Number.isFinite(days) && days >= 1 && days <= 400 ? days : DEFAULT_DAYS_AHEAD,
    useAi: map.get(DRIVER_SYNC_SETTINGS.useAi) !== 'false',
    fillTime: map.get(DRIVER_SYNC_SETTINGS.fillTime) !== 'false',
    fillContact: map.get(DRIVER_SYNC_SETTINGS.fillContact) !== 'false',
    sheet: map.get(DRIVER_SYNC_SETTINGS.sheet) || DEFAULT_SHEET_URL,
  }
}

export async function saveDriverSyncConfig(input: Partial<DriverSyncConfig>): Promise<DriverSyncConfig> {
  if (input.mode !== undefined) {
    if (!['AUTO', 'SUGGEST', 'OFF'].includes(input.mode)) throw new Error('Mode must be AUTO, SUGGEST or OFF')
    await setSetting(DRIVER_SYNC_SETTINGS.mode, input.mode)
  }
  if (input.intervalMin !== undefined) {
    const v = Number(input.intervalMin)
    if (!Number.isFinite(v) || v < 5 || v > 240) throw new Error('The interval must be between 5 and 240 minutes')
    await setSetting(DRIVER_SYNC_SETTINGS.intervalMin, String(Math.round(v)))
  }
  if (input.daysAhead !== undefined) {
    const v = Number(input.daysAhead)
    if (!Number.isFinite(v) || v < 1 || v > 400) throw new Error('Days ahead must be between 1 and 400')
    await setSetting(DRIVER_SYNC_SETTINGS.daysAhead, String(Math.round(v)))
  }
  if (input.useAi !== undefined) await setSetting(DRIVER_SYNC_SETTINGS.useAi, input.useAi ? 'true' : 'false')
  if (input.fillTime !== undefined) await setSetting(DRIVER_SYNC_SETTINGS.fillTime, input.fillTime ? 'true' : 'false')
  if (input.fillContact !== undefined) await setSetting(DRIVER_SYNC_SETTINGS.fillContact, input.fillContact ? 'true' : 'false')
  if (input.sheet !== undefined) {
    const link = String(input.sheet ?? '').trim()
    if (isMicrosoftLink(link)) {
      const current = (await getDriverSyncConfig()).sheet
      await setSetting(DRIVER_SYNC_SETTINGS.sheet, link)
      if (link !== current) await setSetting(DRIVER_SYNC_SETTINGS.sheetRef, '')
    } else {
      const id = sheetIdOf(link)
      if (!id) throw new Error('Paste the OneDrive / SharePoint share link to the Excel file (https://aahaas-my.sharepoint.com/…)')
      await setSetting(DRIVER_SYNC_SETTINGS.sheet, sheetUrlOf(id))
    }
  }
  return getDriverSyncConfig()
}

async function getSheetState(): Promise<SheetState | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: DRIVER_SYNC_SETTINGS.sheetState } })
  try { return row?.value ? JSON.parse(row.value) as SheetState : null } catch { return null }
}

// ── Small helpers ────────────────────────────────────────────────────────────

function vnToday(): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return new Date(`${s}T00:00:00Z`)
}
const iso = (d: Date) => d.toISOString().slice(0, 10)
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : null)
const keyPart = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60)
const squash = (s: string | null | undefined) => fold(s).replace(/[^a-z0-9]+/g, '')
const digitsOf = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '')

type Item = {
  id: string; date: Date; location: string | null; fromPoint: string | null; toPoint: string | null; details: string | null
  mealPlan: string | null; meetingTime: string | null; serviceType: string | null; isLeisure: boolean | null; isHotelOnly: boolean | null
  assignment: { driverId: string | null; vendorId: string | null; driverName: string | null; driverPhone: string | null } | null
}

/** Stable across chart saves (which re-create item ids): date + route. Same idea as VN Vendor Sync. */
function movementKeyOf(item: Pick<Item, 'date' | 'fromPoint' | 'toPoint' | 'location'>): string {
  return `${iso(item.date)}|${keyPart(item.fromPoint)}>${keyPart(item.toPoint) || keyPart(item.location)}`.slice(0, 240)
}

function labelOf(item: Item): string {
  const route = [item.fromPoint, item.toPoint].filter(Boolean).join(' → ') || item.location || ''
  return clip([iso(item.date), serviceTypeShortLabel(item.serviceType), item.meetingTime, route].filter(Boolean).join(' · '), 480) ?? ''
}

/** What the sheet would put on the movement. */
function targetOf(row: { driverText?: string | null; text?: string | null; phones: string[] }): { name: string | null; phone: string | null } {
  const name = clip((row.driverText ?? row.text)?.replace(/\s*\n\s*/g, ' · ') ?? null, 191)
  const phone = row.phones.length ? clip(row.phones.join(' / '), 191) : null
  return { name, phone }
}

/** The movement already says what the sheet says (same text, or every sheet number already on it). */
function alreadySays(cur: { name: string | null; phone: string | null }, t: { name: string | null; phone: string | null }): boolean {
  if (!cur.name || !t.name) return false
  if (squash(cur.name) === squash(t.name)) return true
  const have = digitsOf(`${cur.name} ${cur.phone ?? ''}`)
  const want = (t.phone ?? '').split(' / ').map(digitsOf).filter(d => d.length >= 9)
  return want.length > 0 && want.every(d => have.includes(d.slice(-9)))
}

/** Write the driver on one movement, compare-and-set. `expected` = the driverName we read (null = empty). */
async function writeDriver(agendaItemId: string, expected: string | null, t: { name: string; phone: string | null }): Promise<boolean> {
  const data = { driverName: t.name, driverPhone: t.phone, waSentAt: null }
  const where: Prisma.AssignmentWhereInput = expected === null
    ? { agendaItemId, driverId: null, vendorId: null, OR: [{ driverName: null }, { driverName: '' }] }
    : { agendaItemId, driverId: null, driverName: expected }
  const res = await prisma.assignment.updateMany({ where, data })
  if (res.count > 0) return true
  if (expected !== null) return false
  const exists = await prisma.assignment.findUnique({ where: { agendaItemId }, select: { id: true } })
  if (exists) return false
  try {
    await prisma.assignment.create({ data: { agendaItemId, driverName: t.name, driverPhone: t.phone } })
    return true
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2025'].includes(err.code)) return false
    throw err
  }
}

/** After an undo: drop an assignment row the sync created that now holds nothing. */
async function dropIfEmpty(agendaItemId: string): Promise<void> {
  await prisma.assignment.deleteMany({
    where: {
      agendaItemId,
      driverId: null, vendorId: null, vendorName: null, driverName: null, driverPhone: null,
      vehicleType: null, vehiclePlate: null, notes: null, driverRate: null,
      guideId: null, guideName: null, guidePhone: null,
      tourVendorId: null, tourVendorName: null, tourVendorPhone: null,
    },
  })
}

// ── The run ──────────────────────────────────────────────────────────────────

export type DriverSyncTrigger = 'CRON' | 'MANUAL' | 'STALE'

export interface RunResult extends DriverSyncRunInfo { changes: { bookingRef: string; label: string; action: EventAction; to: string | null }[] }

const inflight = new Map<string, Promise<RunResult | null>>()
export const isDriverSyncRunning = (scope = 'ALL') => inflight.has(scope)

export function runDriverSync(opts: { trigger: DriverSyncTrigger; bookingRef?: string | null; triggeredBy?: string | null }): Promise<RunResult | null> {
  const scope = opts.bookingRef?.trim().toUpperCase() || 'ALL'
  const existing = inflight.get(scope)
  if (existing) return existing
  const p = doRun({ ...opts, scope }).finally(() => inflight.delete(scope))
  inflight.set(scope, p)
  return p
}

function toRunInfo(r: VnDriverSyncRun): DriverSyncRunInfo {
  return {
    id: r.id, trigger: r.trigger, scope: r.scope, mode: r.mode, status: r.status as DriverSyncRunInfo['status'],
    startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, durationMs: r.durationMs,
    sheetNote: r.sheetNote, sheetRows: r.sheetRows, bookings: r.bookings, movements: r.movements, matched: r.matched,
    applied: r.applied, updated: r.updated, suggested: r.suggested, keptManual: r.keptManual, inSync: r.inSync,
    noNumber: r.noNumber, noMatch: r.noMatch, aiCalls: r.aiCalls,
    error: r.error, triggeredBy: r.triggeredBy, undoneAt: r.undoneAt?.toISOString() ?? null, undoneBy: r.undoneBy,
  }
}

type Counted = 'applied' | 'updated' | 'suggested' | 'keptManual' | 'inSync' | 'noNumber' | 'noMatch'

async function doRun(opts: { trigger: DriverSyncTrigger; scope: string; triggeredBy?: string | null }): Promise<RunResult | null> {
  const config = await getDriverSyncConfig()
  const isAll = opts.scope === 'ALL'
  if (config.mode === 'OFF' && opts.trigger !== 'MANUAL') return null
  if (isAll) {
    const running = await prisma.vnDriverSyncRun.findFirst({
      where: { scope: 'ALL', status: 'RUNNING', startedAt: { gt: new Date(Date.now() - STALE_LOCK_MS) } }, select: { id: true },
    })
    if (running) return null
  }

  // "Sync now" while OFF still shows matches, but writes nothing.
  const mode: DriverSyncMode = config.mode === 'OFF' ? 'SUGGEST' : config.mode
  const started = Date.now()
  const run = await prisma.vnDriverSyncRun.create({
    data: { trigger: opts.trigger, scope: opts.scope, mode, status: 'RUNNING', triggeredBy: opts.triggeredBy ?? null },
  })
  const counts = { sheetRows: 0, bookings: 0, movements: 0, matched: 0, applied: 0, updated: 0, suggested: 0, keptManual: 0, inSync: 0, noNumber: 0, noMatch: 0, aiCalls: 0 }
  const changes: RunResult['changes'] = []
  const unmatched: UnmatchedRow[] = []

  const finish = async (data: Partial<Prisma.VnDriverSyncRunUpdateInput>): Promise<RunResult> => {
    const row = await prisma.vnDriverSyncRun.update({
      where: { id: run.id },
      data: { ...counts, ...data, finishedAt: new Date(), durationMs: Date.now() - started },
    })
    return { ...toRunInfo(row), changes: changes.slice(0, 60) }
  }

  try {
    // 1 — The sheet.
    let sheet: Awaited<ReturnType<typeof readMovementSheet>>
    try {
      sheet = await readMovementSheet(config.sheet)
    } catch (err) {
      const msg = err instanceof SheetAccessError ? err.message : `Could not read the sheet: ${err instanceof Error ? err.message : String(err)}`
      return await finish({ status: 'FAILED', error: clip(msg, 4000), sheetNote: clip(msg, 500) })
    }
    const prevState = await getSheetState()
    await setSetting(DRIVER_SYNC_SETTINGS.sheetState, JSON.stringify({
      at: new Date().toISOString(), hash: sheet.hash, source: sheet.source, rows: sheet.rows.length, tabs: sheet.tabs, title: sheet.title,
    } satisfies SheetState))
    counts.sheetRows = sheet.rows.length
    let sheetNoteExtra = ''
    const sheetNote = [
      `${sheet.rows.length} rows from ${sheet.tabs.length} tab(s)`,
      sheet.source === 'MICROSOFT_GRAPH' ? `OneDrive${sheet.title ? ` "${sheet.title}"` : ''}` : sheet.source === 'SERVICE_ACCOUNT' ? 'Google, service account' : 'Google, shared link',
      prevState?.hash === sheet.hash ? 'unchanged' : prevState ? 'changed since last read' : null,
      ...sheet.warnings,
    ].filter(Boolean).join(' · ')
    if (!sheet.tabs.length) return await finish({ status: 'FAILED', error: sheet.warnings.join(' '), sheetNote: clip(sheetNote, 500) })

    // 2 — Upcoming VN movements.
    const today = vnToday()
    const until = new Date(today.getTime() + config.daysAhead * 86_400_000)
    const lo = iso(new Date(today.getTime() - 86_400_000)), hi = iso(new Date(until.getTime() + 86_400_000))
    const rowsByRef = new Map<string, SheetRow[]>()
    for (const r of sheet.rows) {
      if (r.date && (r.date < lo || r.date > hi)) continue
      for (const ref of r.refs) rowsByRef.set(ref, [...(rowsByRef.get(ref) ?? []), r])
    }
    const bookings = await prisma.booking.findMany({
      where: {
        operationCountry: 'VIETNAM',
        status: { notIn: [...CLOSED_STATUSES] },
        ...(isAll ? {} : { bookingRef: opts.scope }),
        tourAgenda: { items: { some: { date: { gte: today, lte: until } } } },
      },
      select: {
        bookingRef: true, contactWhatsapp: true, contactPhone: true,
        passengers: { select: { name: true, isLead: true }, take: 20 },
        tourAgenda: {
          select: {
            items: {
              where: { date: { gte: today, lte: until } },
              orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
              select: {
                id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true, mealPlan: true, meetingTime: true,
                serviceType: true, isLeisure: true, isHotelOnly: true,
                assignment: { select: { driverId: true, vendorId: true, driverName: true, driverPhone: true } },
              },
            },
          },
        },
      },
      take: isAll ? 3000 : 1,
    })
    counts.bookings = bookings.length

    // Sheet rows for bookings the system does not have (or not upcoming) — tell the desk.
    if (isAll) {
      const known = new Set(bookings.map(b => b.bookingRef.toUpperCase()))
      const todayIso = iso(today)
      for (const [ref, rows] of Array.from(rowsByRef)) {
        if (known.has(ref)) continue
        for (const r of rows) {
          if (!r.phones.length || (r.date && r.date < todayIso)) continue
          unmatched.push(unmatchedOf(ref, r, 'Booking not found as an upcoming Vietnam booking in the system'))
        }
      }
    }

    const refs = bookings.map(b => b.bookingRef)
    const links = refs.length ? await prisma.vnDriverSyncLink.findMany({ where: { bookingRef: { in: refs } } }) : []
    const linkByKey = new Map(links.map(l => [`${l.bookingRef}::${l.movementKey}`, l]))
    const aiByRef = new Map<string, AiCacheEntry>()
    for (const l of links) if (l.aiHash && l.aiJson && !aiByRef.has(l.bookingRef)) aiByRef.set(l.bookingRef, { hash: l.aiHash, json: l.aiJson })

    const budget = { left: AI_CALLS_PER_RUN }
    let writes = 0
    const extra = { times: 0, contacts: 0 }
    const events: Prisma.VnDriverSyncEventCreateManyInput[] = []

    for (const b of bookings) {
      const items = (b.tourAgenda?.items ?? []).filter(i => !NOT_DRIVEN.has(String(i.serviceType ?? '').toUpperCase())) as Item[]
      const sheetRows = rowsByRef.get(b.bookingRef.toUpperCase()) ?? []
      const bookingLinks = links.filter(l => l.bookingRef === b.bookingRef)
      if (!items.length || (!sheetRows.length && !bookingLinks.length)) continue

      const movements: Movement[] = items.map(i => ({
        id: i.id, date: iso(i.date), details: i.details, location: i.location, fromPoint: i.fromPoint, toPoint: i.toPoint,
        meetingTime: i.meetingTime, mealPlan: i.mealPlan, serviceType: i.serviceType,
      }))
      const result = sheetRows.length
        ? await matchBooking({ bookingRef: b.bookingRef, rows: sheetRows, movements, useAi: config.useAi, cached: aiByRef.get(b.bookingRef) ?? null, budget })
        : { picks: new Map<string, MatchPick>(), unmatched: [], aiCalled: false, ai: null }
      if (result.aiCalled) counts.aiCalls++
      for (const u of result.unmatched) if (!u.row.date || u.row.date >= iso(today)) unmatched.push(unmatchedOf(b.bookingRef, u.row, u.why))
      const rowById = new Map(sheetRows.map(r => [r.id, r]))

      // Guest contact: only for a booking with none at all, from rows that matched for sure.
      if (mode === 'AUTO' && config.fillContact && sheetRows.length) {
        const sureRows = Array.from(result.picks.values()).filter(p => p.confidence === 'HIGH').map(p => rowById.get(p.rowId)).filter((r): r is SheetRow => Boolean(r))
        const ev = await fillGuestContact(run.id, b, sureRows)
        if (ev) { extra.contacts++; events.push(ev); changes.push({ bookingRef: b.bookingRef, label: 'Guest contact', action: 'CONTACT_FILLED', to: ev.toValue ?? null }) }
      }

      const keyCount = new Map<string, number>()
      for (const item of items) {
        const base = movementKeyOf(item)
        const n = (keyCount.get(base) ?? 0) + 1
        keyCount.set(base, n)
        const key = n > 1 ? `${base}#${n}` : base
        counts.movements++
        const pick = result.picks.get(item.id) ?? null
        const row = pick ? rowById.get(pick.rowId) ?? null : null
        if (pick && row) counts.matched++
        const outcome = await decide({
          runId: run.id, mode, bookingRef: b.bookingRef, item, key, pick, row, ai: result.ai,
          link: linkByKey.get(`${b.bookingRef}::${key}`) ?? null, canWrite: writes < MAX_WRITES_PER_RUN,
        })
        if (outcome.wrote) writes++
        if (outcome.count) counts[outcome.count]++
        // Meeting time: only onto a movement that has none, only from a sure match.
        if (pick && row && pick.confidence === 'HIGH' && mode === 'AUTO' && config.fillTime && writes < MAX_WRITES_PER_RUN) {
          const ev = await fillMeetingTime(run.id, b.bookingRef, key, item, row)
          if (ev) { writes++; extra.times++; events.push(ev); changes.push({ bookingRef: b.bookingRef, label: ev.movementLabel ?? '', action: 'TIME_FILLED', to: ev.toValue ?? null }) }
        }
        for (const e of outcome.events) {
          events.push(e)
          if (['APPLIED', 'UPDATED', 'SUGGESTED', 'KEPT_MANUAL', 'SHEET_DROPPED'].includes(e.action)) {
            changes.push({ bookingRef: b.bookingRef, label: e.movementLabel ?? '', action: e.action as EventAction, to: e.toValue ?? null })
          }
        }
      }
    }

    for (let i = 0; i < events.length; i += 500) await prisma.vnDriverSyncEvent.createMany({ data: events.slice(i, i + 500) })
    if (extra.times || extra.contacts) {
      sheetNoteExtra = ` · filled ${extra.times} meeting time(s), ${extra.contacts} guest contact(s)`
    }

    unmatched.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.bookingRef.localeCompare(b.bookingRef))
    return await finish({
      status: 'SUCCESS', sheetNote: clip(sheetNote + sheetNoteExtra, 500),
      unmatchedJson: JSON.stringify(unmatched.slice(0, 500)),
      error: writes >= MAX_WRITES_PER_RUN ? `Write limit of ${MAX_WRITES_PER_RUN} reached — the rest were left as suggestions` : null,
    })
  } catch (err) {
    const message = clip(err instanceof Error ? err.message : String(err), 4000)
    console.error('[VN Driver Sync] run failed:', message)
    return await finish({ status: 'FAILED', error: message }).catch(() => null)
  }
}

function unmatchedOf(bookingRef: string, r: SheetRow, why: string): UnmatchedRow {
  return {
    bookingRef, date: r.date, tab: r.tab, row: r.row, details: clip(r.details, 300), time: r.time, service: r.service,
    text: clip(r.driverText ?? r.text, 300) ?? '', why,
  }
}

// ── Gap filling: meeting time and guest contact ──────────────────────────────
//
// Both only fill what the system does NOT have — an empty meeting time, a
// booking with no guest phone at all — and only from a sure match. Each fill is
// one event (TIME_FILLED / CONTACT_FILLED) holding the value written, which is
// what "Undo" uses to take it back if nobody changed it since.

async function fillMeetingTime(runId: string, bookingRef: string, key: string, item: Item, row: SheetRow): Promise<Prisma.VnDriverSyncEventCreateManyInput | null> {
  if (item.meetingTime?.trim()) return null
  const time = row.time ? parse12h(row.time) : null
  if (!time) return null
  const res = await prisma.agendaItem.updateMany({ where: { id: item.id, OR: [{ meetingTime: null }, { meetingTime: '' }] }, data: { meetingTime: time } })
  if (!res.count) return null
  item.meetingTime = time
  return {
    runId, bookingRef, movementKey: key, movementLabel: labelOf(item), action: 'TIME_FILLED',
    fromValue: null, toValue: time, detail: `Meeting time from the sheet (${row.tab} row ${row.row})`, actor: null,
  }
}

const NAME_STOP = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'master', 'mstr', 'and', 'family', 'pax'])
const nameTokens = (s: string | null | undefined) =>
  fold(s).replace(/[^a-z\s]+/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !NAME_STOP.has(t))

async function fillGuestContact(
  runId: string,
  b: { bookingRef: string; contactWhatsapp: string | null; contactPhone: string | null; passengers: { name: string | null; isLead: boolean | null }[] },
  sureRows: SheetRow[],
): Promise<Prisma.VnDriverSyncEventCreateManyInput | null> {
  if (b.contactWhatsapp?.trim() || b.contactPhone?.trim()) return null      // the system already has a contact
  // The guest cell the booking's rows agree on most.
  const tally = new Map<string, number>()
  for (const r of sureRows) if (r.guest && extractPhones(r.guest).length) tally.set(r.guest, (tally.get(r.guest) ?? 0) + 1)
  const guest = Array.from(tally.entries()).sort((x, y) => y[1] - x[1])[0]?.[0]
  if (!guest) return null
  const phones = extractPhones(guest)
  // Same guest? When the booking has passenger names, the sheet's name must share one.
  const sheetName = nameTokens(guest.replace(/\+?\(?\d[\d\s().\-]{6,}\d/g, ' '))
  const known = b.passengers.flatMap(p => nameTokens(p.name))
  if (known.length && sheetName.length && !sheetName.some(t => known.includes(t))) return null
  const first = phones[0]
  const whatsapp = first.trim().startsWith('+') ? `+${first.replace(/\D/g, '')}` : first.replace(/\D/g, '')
  const phone = clip(phones.join(' / '), 191)
  const res = await prisma.booking.updateMany({
    where: {
      bookingRef: b.bookingRef,
      AND: [{ OR: [{ contactWhatsapp: null }, { contactWhatsapp: '' }] }, { OR: [{ contactPhone: null }, { contactPhone: '' }] }],
    },
    data: { contactWhatsapp: whatsapp, contactPhone: phone },
  })
  if (!res.count) return null
  return {
    runId, bookingRef: b.bookingRef, movementKey: null, movementLabel: 'Guest contact', action: 'CONTACT_FILLED',
    fromValue: null, toValue: clip(`${whatsapp}${phone && phone !== whatsapp ? ` | ${phone}` : ''}`, 191),
    detail: clip(`Guest contact from the sheet: ${guest}`, 500), actor: null,
  }
}

/** Take back a meeting time / guest contact fill, if the value is still exactly what the sync wrote. */
async function undoFill(e: { bookingRef: string; movementKey: string | null; action: string; toValue: string | null }, agendaItemId: string | null): Promise<boolean> {
  if (e.action === 'TIME_FILLED' && agendaItemId && e.toValue) {
    return (await prisma.agendaItem.updateMany({ where: { id: agendaItemId, meetingTime: e.toValue }, data: { meetingTime: null } })).count > 0
  }
  if (e.action === 'CONTACT_FILLED' && e.toValue) {
    const [wa, ph] = e.toValue.split(' | ')
    return (await prisma.booking.updateMany({
      where: { bookingRef: e.bookingRef, contactWhatsapp: wa, ...(ph ? { contactPhone: ph } : { contactPhone: wa }) },
      data: { contactWhatsapp: null, contactPhone: null },
    })).count > 0
  }
  return false
}

// ── One movement ─────────────────────────────────────────────────────────────

async function decide(p: {
  runId: string
  mode: DriverSyncMode
  bookingRef: string
  item: Item
  key: string
  pick: MatchPick | null
  row: SheetRow | null
  ai: AiCacheEntry | null
  link: VnDriverSyncLink | null
  canWrite: boolean
}): Promise<{ wrote: boolean; count: Counted | null; events: Prisma.VnDriverSyncEventCreateManyInput[] }> {
  const { pick, row, link, item } = p
  const label = labelOf(item)
  const events: Prisma.VnDriverSyncEventCreateManyInput[] = []
  const ev = (action: EventAction, extra: Partial<Prisma.VnDriverSyncEventCreateManyInput> = {}) =>
    events.push({ runId: p.runId, bookingRef: p.bookingRef, movementKey: p.key, movementLabel: label, action, actor: null, ...extra })
  const now = new Date()
  const a = item.assignment
  const cur = { name: a?.driverName?.trim() || null, phone: a?.driverPhone?.trim() || null, raw: a?.driverName ?? null }
  const before = { name: a?.driverName ?? null, phone: a?.driverPhone ?? null }   // snapshot for undo, taken before any write
  const fromDirectory = Boolean(a?.driverId || a?.vendorId)
  const ours = Boolean(link?.appliedName) && !fromDirectory && cur.raw === link!.appliedName

  const base: Partial<Prisma.VnDriverSyncLinkUncheckedCreateInput> = {
    agendaItemId: item.id, movementDate: new Date(`${iso(item.date)}T00:00:00Z`), movementLabel: label,
    movementText: clip(item.details, 2000), lastRunId: p.runId, lastSeenAt: now,
    aiHash: p.ai?.hash ?? link?.aiHash ?? null, aiJson: p.ai?.json ?? link?.aiJson ?? null,
  }
  const facts: Partial<Prisma.VnDriverSyncLinkUncheckedCreateInput> = row && pick ? {
    sheetTab: clip(row.tab, 191), sheetRow: row.row, sheetDate: row.date ? new Date(`${row.date}T00:00:00Z`) : null,
    sheetDetails: clip([row.route, row.details].filter(Boolean).join(' ¶ '), 4000), sheetTime: clip(row.time, 32), sheetService: clip(row.service, 191),
    sheetText: clip(row.driverText ?? row.text, 4000), phones: row.phones.length ? clip(row.phones.join(' / '), 191) : null,
    score: pick.score, confidence: pick.confidence, method: pick.method, reason: clip(pick.reason, 500),
  } : {}

  const save = async (status: LinkStatus, data: Partial<Prisma.VnDriverSyncLinkUncheckedCreateInput> = {}) => {
    const rowData = { ...base, ...facts, ...data, status }
    // Skip the write when nothing a person would see changed (6 000+ movements every 15 minutes).
    if (link && link.status === status && link.agendaItemId === item.id && link.sheetText === (rowData.sheetText ?? link.sheetText)
      && link.note === (rowData.note ?? null) && Number(link.score ?? -1) === Number(rowData.score ?? link.score ?? -1)
      && link.aiHash === (rowData.aiHash ?? null) && data.appliedName === undefined) return
    await prisma.vnDriverSyncLink.upsert({
      where: { bookingRef_movementKey: { bookingRef: p.bookingRef, movementKey: p.key } },
      create: { bookingRef: p.bookingRef, movementKey: p.key, ...rowData },
      update: rowData,
    })
  }

  // ── No sheet row for this movement.
  if (!pick || !row) {
    if (!link) return { wrote: false, count: null, events }
    if (ours && link.status !== 'STALE') {
      await save('STALE', { note: 'The sheet no longer has this movement — the driver was left as it is' })
      ev('SHEET_DROPPED', { fromValue: clip(link.appliedName, 191), detail: 'No sheet row matches this movement any more; nothing was removed' })
      return { wrote: false, count: 'noMatch', events }
    }
    if (link.status === 'IGNORED' || link.status === 'STALE') return { wrote: false, count: null, events }
    await prisma.vnDriverSyncLink.delete({ where: { id: link.id } }).catch(() => undefined)
    return { wrote: false, count: 'noMatch', events }
  }

  const t = targetOf(row)
  const sheetChanged = Boolean(link?.sheetText) && squash(link!.sheetText) !== squash(row.driverText ?? row.text)

  // ── Ignored stays ignored unless the sheet now says something else.
  if (link?.status === 'IGNORED') {
    if (!sheetChanged) { await save('IGNORED', { note: link.note }); return { wrote: false, count: null, events } }
    await save('SUGGESTED', { note: `Was ignored; the sheet changed to "${clip(t.name, 120)}"` })
    ev('SUGGESTED', { fromValue: clip(link.sheetText, 191), toValue: t.name, score: pick.score, detail: 'The sheet changed an ignored movement' })
    return { wrote: false, count: 'suggested', events }
  }

  // ── Already says it.
  if (cur.name && alreadySays(cur, t)) {
    await save(ours ? 'APPLIED' : 'IN_SYNC', { note: fromDirectory ? 'Set from the driver directory — same contact as the sheet' : null })
    return { wrote: false, count: 'inSync', events }
  }

  // ── The sheet names someone but gives no number: nothing a guest could use.
  if (!t.phone || !t.name) {
    if (ours) {
      await save('STALE', { note: 'The sheet now has no phone number for this movement — the earlier driver was left' })
      if (link?.status !== 'STALE') ev('SHEET_DROPPED', { fromValue: clip(link?.appliedName, 191), toValue: t.name, detail: 'Sheet text has no number now; nothing was changed' })
      return { wrote: false, count: 'noNumber', events }
    }
    await save('NO_NUMBER', { note: t.name ? 'No phone number in the sheet text — not assigned' : 'Vendors cell is empty' })
    return { wrote: false, count: 'noNumber', events }
  }

  // ── Someone else's driver. Theirs wins.
  if ((cur.name || fromDirectory) && !ours) {
    const changed = link?.status !== 'KEPT_MANUAL' || sheetChanged
    await save('KEPT_MANUAL', { note: fromDirectory ? 'A driver / vehicle vendor from the directory is assigned' : `Assigned by hand: ${clip(cur.name, 150)}` })
    if (changed) ev('KEPT_MANUAL', { fromValue: clip(cur.name, 191), toValue: t.name, score: pick.score, detail: 'A different driver is already on the movement — not replaced' })
    return { wrote: false, count: 'keptManual', events }
  }

  // ── Empty, or still ours with an older sheet text: write when sure.
  const noDriverNeeded = item.isLeisure === true && item.isHotelOnly === true
  const sure = pick.confidence === 'HIGH' && p.mode === 'AUTO' && !noDriverNeeded
  if (sure && p.canWrite) {
    const ok = await writeDriver(item.id, ours ? cur.raw : null, { name: t.name, phone: t.phone })
    if (ok) {
      await save('APPLIED', {
        appliedName: t.name, appliedPhone: t.phone, appliedAt: now, appliedBy: 'Auto sync', appliedRunId: p.runId,
        ...(ours ? {} : { prevName: clip(before.name, 191), prevPhone: clip(before.phone, 191) }),
        note: pick.method === 'AI' ? 'Matched with AI help' : null,
      })
      ev(ours ? 'UPDATED' : 'APPLIED', { fromValue: clip(cur.name, 191), toValue: t.name, score: pick.score, detail: clip(`${t.phone} · ${pick.reason}`, 500) })
      return { wrote: true, count: ours ? 'updated' : 'applied', events }
    }
    await save('SUGGESTED', { note: 'The movement changed while syncing — check and apply' })
    return { wrote: false, count: 'suggested', events }
  }

  const why = noDriverNeeded ? 'The movement is marked "No driver needed"'
    : p.mode !== 'AUTO' ? 'Suggest mode — nothing is written automatically'
      : !p.canWrite ? 'Write limit for this run reached'
        : 'Not sure enough to write on its own'
  const isNew = link?.status !== 'SUGGESTED' || sheetChanged
  await save('SUGGESTED', { note: why })
  if (isNew) ev('SUGGESTED', { fromValue: clip(cur.name, 191), toValue: t.name, score: pick.score, detail: clip(`${why} · ${pick.reason}`, 500) })
  return { wrote: false, count: 'suggested', events }
}

// ── Actions from the page ────────────────────────────────────────────────────

async function currentOf(agendaItemId: string | null) {
  if (!agendaItemId) return null
  return prisma.assignment.findUnique({ where: { agendaItemId }, select: { driverId: true, vendorId: true, driverName: true, driverPhone: true } })
}

/** Write the sheet's driver on a "To review" / "Kept yours" movement, by a person. */
export async function applyLink(linkId: string, actor: string): Promise<string> {
  const link = await prisma.vnDriverSyncLink.findUnique({ where: { id: linkId } })
  if (!link || !link.agendaItemId) throw new Error('That movement is gone — sync again')
  if (link.movementDate && link.movementDate < vnToday()) throw new Error('This movement is in the past')
  const t = targetOf({ text: link.sheetText, phones: (link.phones ?? '').split(' / ').filter(Boolean) })
  if (!t.name || !t.phone) throw new Error('The sheet gives no phone number for this movement — add one in the sheet first')
  const cur = await currentOf(link.agendaItemId)
  if (cur?.driverId || cur?.vendorId) throw new Error('A driver from the directory is assigned — change it in Assign Driver instead')
  const ok = await writeDriver(link.agendaItemId, cur?.driverName?.trim() ? cur.driverName : null, { name: t.name, phone: t.phone })
  if (!ok) throw new Error('The movement changed a moment ago — reload and try again')
  const ours = Boolean(link.appliedName) && cur?.driverName === link.appliedName
  await prisma.vnDriverSyncLink.update({
    where: { id: link.id },
    data: {
      status: 'APPLIED', appliedName: t.name, appliedPhone: t.phone, appliedAt: new Date(), appliedBy: actor, appliedRunId: null,
      ...(ours ? {} : { prevName: clip(cur?.driverName ?? null, 191), prevPhone: clip(cur?.driverPhone ?? null, 191) }),
      note: `Applied by ${actor}`,
    },
  })
  await prisma.vnDriverSyncEvent.create({
    data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'APPROVED', fromValue: clip(cur?.driverName ?? null, 191), toValue: t.name, score: link.score, detail: t.phone, actor },
  })
  return `Driver set: ${t.phone}`
}

/** Put back what was there before the sync wrote — only if nobody changed it since. */
async function undoOne(link: VnDriverSyncLink, actor: string, runId: string | null): Promise<boolean> {
  if (!link.agendaItemId || !link.appliedName) return false
  const res = await prisma.assignment.updateMany({
    where: { agendaItemId: link.agendaItemId, driverId: null, driverName: link.appliedName },
    data: { driverName: link.prevName, driverPhone: link.prevPhone },
  })
  if (!res.count) return false
  await dropIfEmpty(link.agendaItemId)
  await prisma.vnDriverSyncLink.update({
    where: { id: link.id },
    data: { status: 'IGNORED', appliedName: null, appliedPhone: null, appliedAt: null, appliedBy: null, appliedRunId: null, note: `Undone by ${actor} — the sync will leave it alone` },
  })
  await prisma.vnDriverSyncEvent.create({
    data: { runId, bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'UNDONE', fromValue: clip(link.appliedName, 191), toValue: clip(link.prevName, 191), actor },
  })
  return true
}

export async function undoLink(linkId: string, actor: string): Promise<string> {
  const link = await prisma.vnDriverSyncLink.findUnique({ where: { id: linkId } })
  if (!link?.appliedName) throw new Error('The sync has nothing to undo on this movement')
  // The meeting time it filled on this movement goes back too.
  const filled = await prisma.vnDriverSyncEvent.findFirst({ where: { bookingRef: link.bookingRef, movementKey: link.movementKey, action: 'TIME_FILLED' }, orderBy: { createdAt: 'desc' } })
  if (filled) await undoFill(filled, link.agendaItemId)
  if (!await undoOne(link, actor, null)) throw new Error('Someone changed the driver since — left as it is')
  return link.prevName || link.prevPhone ? `Put back: ${link.prevName ?? link.prevPhone}` : 'Driver cleared'
}

export async function undoRun(runId: string, actor: string): Promise<string> {
  const run = await prisma.vnDriverSyncRun.findUnique({ where: { id: runId } })
  if (!run) throw new Error('Run not found')
  if (run.undoneAt) throw new Error('This run was already undone')
  const links = await prisma.vnDriverSyncLink.findMany({ where: { appliedRunId: runId } })
  let done = 0, kept = 0, fills = 0
  for (const l of links) (await undoOne(l, actor, runId)) ? done++ : kept++
  const fillEvents = await prisma.vnDriverSyncEvent.findMany({ where: { runId, action: { in: ['TIME_FILLED', 'CONTACT_FILLED'] } } })
  for (const e of fillEvents) {
    const link = e.movementKey ? await prisma.vnDriverSyncLink.findUnique({ where: { bookingRef_movementKey: { bookingRef: e.bookingRef, movementKey: e.movementKey } }, select: { agendaItemId: true } }) : null
    if (await undoFill(e, link?.agendaItemId ?? null)) {
      fills++
      await prisma.vnDriverSyncEvent.create({ data: { runId, bookingRef: e.bookingRef, movementKey: e.movementKey, movementLabel: e.movementLabel, action: 'UNDONE', fromValue: e.toValue, toValue: null, detail: e.action === 'TIME_FILLED' ? 'Meeting time cleared' : 'Guest contact cleared', actor } })
    }
  }
  await prisma.vnDriverSyncRun.update({ where: { id: runId }, data: { undoneAt: new Date(), undoneBy: actor } })
  return `${done} driver(s) put back${fills ? ` · ${fills} meeting time / guest contact fill(s) cleared` : ''}${kept ? ` · ${kept} changed by a person since, left alone` : ''}`
}

export async function ignoreLink(linkId: string, actor: string): Promise<string> {
  const link = await prisma.vnDriverSyncLink.findUnique({ where: { id: linkId } })
  if (!link) throw new Error('Not found')
  await prisma.vnDriverSyncLink.update({ where: { id: linkId }, data: { status: 'IGNORED', note: `Ignored by ${actor}` } })
  await prisma.vnDriverSyncEvent.create({ data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'IGNORED', toValue: clip(link.sheetText, 191), actor } })
  return 'The sync will leave this movement alone'
}

export async function restoreLink(linkId: string, actor: string): Promise<string> {
  const link = await prisma.vnDriverSyncLink.findUnique({ where: { id: linkId } })
  if (!link) throw new Error('Not found')
  await prisma.vnDriverSyncLink.update({ where: { id: linkId }, data: { status: 'SUGGESTED', note: `Back in review (${actor})` } })
  await prisma.vnDriverSyncEvent.create({ data: { bookingRef: link.bookingRef, movementKey: link.movementKey, movementLabel: link.movementLabel, action: 'RESTORED', actor } })
  return 'Back in review — the next sync looks at it again'
}

// ── Due / backstop ───────────────────────────────────────────────────────────

export async function isDriverSyncDue(config?: DriverSyncConfig): Promise<boolean> {
  const cfg = config ?? await getDriverSyncConfig()
  if (cfg.mode === 'OFF') return false
  const last = await prisma.vnDriverSyncRun.findFirst({ where: { scope: 'ALL' }, orderBy: { startedAt: 'desc' }, select: { status: true, startedAt: true } })
  if (!last) return true
  if (last.status === 'RUNNING') return Date.now() - last.startedAt.getTime() > STALE_LOCK_MS
  const wait = last.status === 'FAILED' ? 5 * 60_000 : cfg.intervalMin * 60_000
  return Date.now() - last.startedAt.getTime() >= wait - 30_000
}

/** For hosting without a long-lived process (Amplify): the first reader after the interval starts the sweep. */
export async function kickIfDue(): Promise<void> {
  try {
    if (isDriverSyncRunning('ALL') || !await isDriverSyncDue()) return
    void runDriverSync({ trigger: 'STALE' }).catch(() => undefined)
  } catch (err) {
    if (!isMissingTable(err)) console.error('[VN Driver Sync] stale check failed:', err)
  }
}

// ── Page data ────────────────────────────────────────────────────────────────

/** Movement filters on the VN Driver Sync page — every one optional. */
export interface DriverSyncFilters {
  /** Which date the range applies to: the movement's own day, or the booking's arrival day. */
  dateBy?: 'movement' | 'arrival' | null
  /** Inclusive YYYY-MM-DD bounds. With no `from`, past movements stay hidden. */
  from?: string | null
  to?: string | null
  /** Free text over ref, system movement and sheet row. */
  q?: string | null
  conf?: 'HIGH' | 'MEDIUM' | 'NONE' | null
  method?: 'RULES' | 'AI' | null
  /** Driver on the movement right now. */
  driver?: 'has' | 'none' | null
  /** The sheet row carries a phone number. */
  phones?: 'yes' | 'no' | null
  /** 0–100. */
  minScore?: number | null
  sort?: 'date' | 'scoreDesc' | 'scoreAsc' | 'ref' | null
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const asDay = (s: string | null | undefined) => (s && DAY_RE.test(s) ? new Date(`${s}T00:00:00Z`) : null)

export async function driverSyncOverview(q: {
  canEdit: boolean; isAdmin: boolean; status?: string | null; ref?: string | null; page?: number; runId?: string | null
} & DriverSyncFilters): Promise<DriverSyncOverview> {
  const config = await getDriverSyncConfig()
  const sa = serviceAccount()
  const access = { kind: isMicrosoftLink(config.sheet) ? 'MICROSOFT' as const : 'GOOGLE' as const, serviceAccount: sa?.email ?? null, sheetUrl: config.sheet }
  const empty = { installed: false, canEdit: q.canEdit, isAdmin: q.isAdmin, config, access, sheet: null, totals: {}, runs: [], links: [], linkTotal: 0, events: [], unmatched: [], dayCounts: [] }
  try {
    const today = vnToday()
    const ref = q.ref?.trim().toUpperCase() || null
    const page = Math.max(1, q.page ?? 1)
    const dateBy = q.dateBy === 'arrival' ? 'arrival' : 'movement'
    const from = asDay(q.from)
    const to = asDay(q.to)
    const text = q.q?.trim() || null

    // Arrival-day filter → the bookings arriving in that window.
    let arrivalRefs: string[] | null = null
    if (dateBy === 'arrival' && (from || to)) {
      const bookings = await prisma.booking.findMany({
        where: { arrivalDate: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 86_400_000) } : {}) } },
        select: { bookingRef: true },
      })
      arrivalRefs = bookings.map(b => b.bookingRef)
    }

    // The date window on its own, so the quick-day chips can swap it for theirs.
    const dateClauses: Prisma.VnDriverSyncLinkWhereInput[] =
      dateBy === 'movement' && (from || to)
        ? [{ movementDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }]
        : arrivalRefs
          ? [{ bookingRef: { in: arrivalRefs } }, ...(from ? [] : [{ movementDate: { gte: today } }])]
          : [{ movementDate: { gte: today } }]
    // Every other filter except status.
    const rest: Prisma.VnDriverSyncLinkWhereInput[] = [
      ...(ref ? [{ bookingRef: { contains: ref } }] : []),
      ...(q.runId ? [{ appliedRunId: q.runId }] : []),
      ...(text ? [{ OR: [
        { bookingRef: { contains: text } }, { movementText: { contains: text } }, { movementLabel: { contains: text } },
        { sheetText: { contains: text } }, { sheetDetails: { contains: text } }, { phones: { contains: text } },
      ] }] : []),
      ...(q.conf === 'NONE' ? [{ confidence: null }] : q.conf ? [{ confidence: q.conf }] : []),
      ...(q.method ? [{ method: q.method }] : []),
      ...(q.phones === 'yes' ? [{ phones: { not: null } }, { NOT: { phones: '' } }] : q.phones === 'no' ? [{ OR: [{ phones: null }, { phones: '' }] }] : []),
      ...(q.minScore && q.minScore > 0 ? [{ score: { gte: q.minScore / 100 } }] : []),
    ]

    // Driver on the movement now — resolved against the live assignments, over every date the page can show.
    if (q.driver === 'has' || q.driver === 'none') {
      const earliest = from && from < today ? from : today
      const cand = await prisma.vnDriverSyncLink.findMany({ where: { AND: [...rest, { movementDate: { gte: earliest } }] }, select: { id: true, agendaItemId: true } })
      const itemIds = cand.map(c => c.agendaItemId).filter((x): x is string => Boolean(x))
      const withDriver = new Set(itemIds.length
        ? (await prisma.assignment.findMany({
          where: { agendaItemId: { in: itemIds }, OR: [{ driverId: { not: null } }, { vendorId: { not: null } }, { AND: [{ driverName: { not: null } }, { NOT: { driverName: '' } }] }] },
          select: { agendaItemId: true },
        })).map(a => a.agendaItemId)
        : [])
      rest.push({ id: { in: cand.filter(c => (c.agendaItemId ? withDriver.has(c.agendaItemId) : false) === (q.driver === 'has')).map(c => c.id) } })
    }
    const base = [...dateClauses, ...rest]

    const where: Prisma.VnDriverSyncLinkWhereInput = { AND: [...base, ...(q.status ? [{ status: q.status }] : [])] }
    const orderBy: Prisma.VnDriverSyncLinkOrderByWithRelationInput[] =
      q.sort === 'scoreDesc' ? [{ score: 'desc' }, { movementDate: 'asc' }]
        : q.sort === 'scoreAsc' ? [{ score: 'asc' }, { movementDate: 'asc' }]
          : q.sort === 'ref' ? [{ bookingRef: 'asc' }, { movementDate: 'asc' }, { movementLabel: 'asc' }]
            : [{ movementDate: 'asc' }, { bookingRef: 'asc' }, { movementLabel: 'asc' }]

    // Quick-day chips: the next 7 days (VN), counted on the chosen date with every other filter but the range.
    const week = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * 86_400_000))
    const weekEnd = new Date(today.getTime() + 7 * 86_400_000)
    const chipBase = rest
    const dayCountsP = (async () => {
      const statusWhere = q.status ? [{ status: q.status }] : []
      if (dateBy === 'movement') {
        const g = await prisma.vnDriverSyncLink.groupBy({
          by: ['movementDate'], where: { AND: [...chipBase, ...statusWhere, { movementDate: { gte: today, lt: weekEnd } }] }, _count: { _all: true },
        })
        const m = new Map(g.map(x => [x.movementDate ? iso(x.movementDate) : '', x._count._all]))
        return week.map(d => ({ date: iso(d), count: m.get(iso(d)) ?? 0 }))
      }
      const arriving = await prisma.booking.findMany({ where: { arrivalDate: { gte: today, lt: weekEnd } }, select: { bookingRef: true, arrivalDate: true } })
      const dayOf = new Map(arriving.map(b => [b.bookingRef, iso(b.arrivalDate)]))
      const g = arriving.length
        ? await prisma.vnDriverSyncLink.groupBy({ by: ['bookingRef'], where: { AND: [...chipBase, ...statusWhere, { bookingRef: { in: Array.from(dayOf.keys()) } }] }, _count: { _all: true } })
        : []
      const m = new Map<string, number>()
      for (const x of g) { const d = dayOf.get(x.bookingRef); if (d) m.set(d, (m.get(d) ?? 0) + x._count._all) }
      return week.map(d => ({ date: iso(d), count: m.get(iso(d)) ?? 0 }))
    })()

    const [runs, links, linkTotal, grouped, events, sheet, dayCounts] = await Promise.all([
      prisma.vnDriverSyncRun.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }),
      prisma.vnDriverSyncLink.findMany({ where, orderBy, skip: (page - 1) * 50, take: 50 }),
      prisma.vnDriverSyncLink.count({ where }),
      // Status chips follow every other filter, so the counts match what clicking them shows.
      prisma.vnDriverSyncLink.groupBy({ by: ['status'], where: { AND: base }, _count: { _all: true } }),
      prisma.vnDriverSyncEvent.findMany({ where: { ...(ref ? { bookingRef: { contains: ref } } : {}), ...(q.runId ? { runId: q.runId } : {}) }, orderBy: { createdAt: 'desc' }, take: 40 }),
      getSheetState(),
      dayCountsP,
    ])
    const arrivals = links.length
      ? await prisma.booking.findMany({ where: { bookingRef: { in: Array.from(new Set(links.map(l => l.bookingRef))) } }, select: { bookingRef: true, arrivalDate: true, departureDate: true } })
      : []
    const tripOf = new Map(arrivals.map(b => [b.bookingRef, { arrival: iso(b.arrivalDate), departure: iso(b.departureDate) }]))
    const items = links.length
      ? await prisma.assignment.findMany({
        where: { agendaItemId: { in: links.map(l => l.agendaItemId).filter((x): x is string => Boolean(x)) } },
        select: { agendaItemId: true, driverId: true, vendorId: true, driverName: true, driverPhone: true, driver: { select: { name: true, phone: true } } },
      })
      : []
    const byItem = new Map(items.map(i => [i.agendaItemId, i]))
    const lastAll = runs.find(r => r.scope === 'ALL' && r.status === 'SUCCESS')
    let unmatched: UnmatchedRow[] = []
    try { unmatched = lastAll?.unmatchedJson ? JSON.parse(lastAll.unmatchedJson) : [] } catch { unmatched = [] }
    if (ref) unmatched = unmatched.filter(u => u.bookingRef.includes(ref))

    return {
      installed: true, canEdit: q.canEdit, isAdmin: q.isAdmin, config, access, sheet,
      totals: Object.fromEntries(grouped.map(g => [g.status, g._count._all])),
      runs: runs.map(toRunInfo),
      linkTotal,
      dayCounts,
      links: links.map((l): DriverSyncLinkInfo => {
        const a = l.agendaItemId ? byItem.get(l.agendaItemId) : undefined
        return {
          id: l.id, bookingRef: l.bookingRef, agendaItemId: l.agendaItemId,
          arrivalDate: tripOf.get(l.bookingRef)?.arrival ?? null, departureDate: tripOf.get(l.bookingRef)?.departure ?? null,
          movementDate: l.movementDate ? iso(l.movementDate) : null, movementLabel: l.movementLabel, movementText: l.movementText,
          sheet: { tab: l.sheetTab, row: l.sheetRow, date: l.sheetDate ? iso(l.sheetDate) : null, details: l.sheetDetails, time: l.sheetTime, service: l.sheetService, text: l.sheetText },
          phones: l.phones, score: l.score === null ? null : Number(l.score),
          confidence: (l.confidence as 'HIGH' | 'MEDIUM' | null) ?? null, method: (l.method as 'RULES' | 'AI' | null) ?? null,
          reason: l.reason, status: l.status as LinkStatus, note: l.note,
          now: {
            driverName: a?.driverName ?? a?.driver?.name ?? null,
            driverPhone: a?.driverPhone ?? a?.driver?.phone ?? null,
            fromDirectory: Boolean(a?.driverId || a?.vendorId),
          },
          appliedAt: l.appliedAt?.toISOString() ?? null, appliedBy: l.appliedBy, prevName: l.prevName, updatedAt: l.updatedAt.toISOString(),
        }
      }),
      events: events.map((e): DriverSyncEventInfo => ({
        id: e.id, runId: e.runId, bookingRef: e.bookingRef, movementLabel: e.movementLabel, action: e.action as EventAction,
        fromValue: e.fromValue, toValue: e.toValue, score: e.score === null ? null : Number(e.score), detail: e.detail, actor: e.actor,
        createdAt: e.createdAt.toISOString(),
      })),
      unmatched: unmatched.slice(0, 200),
    }
  } catch (err) {
    if (isMissingTable(err)) return empty
    throw err
  }
}
