/**
 * Excel → Agenda auto-update.
 *
 * Every 15 minutes (a setting; ships OFF), for each Vietnam chart that was
 * BUILT FROM THE EXCEL with Excel MC Generate (it has a `vn_mc_import:<REF>`
 * baseline) and is not paused, upcoming and not cancelled:
 *
 *   1. read the "(VN TEAM) Movement Chart" workbook (read-only Graph download);
 *   2. compare the booking's rows with its chart (lib/vn-mc-import/shared.ts →
 *      autoPlan) and apply only what is safe:
 *        - refresh a field only while the chart still holds what the sheet put
 *          there before (or nothing) — an OPS edit is never overwritten;
 *        - add a movement for a row new in the Excel;
 *        - never delete a movement, never blank a field, never touch a driver
 *          (VN Driver Sync owns drivers), never send a WhatsApp;
 *   3. write every change to the agenda's Booking Logs, and move the baseline on.
 *
 * Writes are in place (UPDATE with the old value in the WHERE — compare-and-set
 * — and INSERT for new rows), inside one transaction per booking, so movement
 * ids, tickets, includes and WhatsApp history are untouched. A chart that
 * changes too much at once is skipped and logged for a person to review.
 */
import type { BookingStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { logBookingEvent, logBookingEventOnce, type LogChange } from '@/lib/booking-logs'
import { movementLabel } from '@/lib/booking-logs-agenda'
import { resolveIsLeisure } from '@/lib/leisure-day'
import {
  autoPlan, FIELD_LABELS, itemFromLine, lineValueKeys,
  type ChartItemLike, type McAutoRunState, type McBaseline,
} from './shared'
import { getMcAutoConfig, getMcAutoState, releaseMcAutoLock, setMcAutoState, takeMcAutoLock, BASELINE_PREFIX } from './config'
import { linesFor, parseBaseline, readSheet, writeBaseline } from './server'

/** More than this in one go looks like a restructured sheet, not an edit — a person decides. */
const MAX_FIELDS_PER_BOOKING = 60
const MAX_CREATES_PER_BOOKING = 20
const ACTOR = { id: null, name: 'Excel auto-update' }
const CLOSED = ['CANCELLED', 'PENDING_CANCELLATION'] as BookingStatus[]

let busy = false

export async function isMcAutoDue(): Promise<boolean> {
  const [config, last] = await Promise.all([getMcAutoConfig(), getMcAutoState()])
  if (config.mode !== 'AUTO') return false
  if (!last?.at) return true
  return Date.now() - Date.parse(last.at) >= config.intervalMin * 60_000 - 5_000
}

type DbItem = {
  id: string; date: Date; location: string; fromPoint: string | null; toPoint: string | null; details: string | null
  mealPlan: string | null; meetingTime: string | null; serviceType: string; sortOrder: number
  isLeisure: boolean | null; isHotelOnly: boolean | null
  assignment: { driverId: string | null; vendorId: string | null; driverName: string | null; driverPhone: string | null } | null
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)

function toChart(i: DbItem): ChartItemLike {
  return {
    id: i.id, date: ymd(i.date), location: i.location ?? '', fromPoint: i.fromPoint ?? '', toPoint: i.toPoint ?? '',
    details: i.details ?? '', mealPlan: i.mealPlan ?? '', meetingTime: i.meetingTime ?? '', timeFrom: '', timeTo: '',
    serviceType: i.serviceType, isLeisure: i.isLeisure === true, isHotelOnly: i.isHotelOnly === true,
    assignment: i.assignment,
  }
}

const clockMin = (t: string | null | undefined) => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : null
}

export interface McAutoBookingResult { bookingRef: string; fields: number; created: number; keptOps: number; skipped?: string }

/**
 * One sweep. `bookingRef` limits it to one booking (the page's "Run now").
 * Returns null when switched off or another run holds the lock.
 */
export async function runMcAutoUpdate(opts: { trigger: 'CRON' | 'MANUAL'; bookingRef?: string }): Promise<(McAutoRunState & { results: McAutoBookingResult[] }) | null> {
  const config = await getMcAutoConfig()
  if (config.mode !== 'AUTO' && opts.trigger !== 'MANUAL') return null
  if (busy) return null
  busy = true
  const started = Date.now()
  const results: McAutoBookingResult[] = []
  let locked = false
  try {
    locked = await takeMcAutoLock()
    if (!locked) return null

    const rows = await prisma.systemSetting.findMany({
      where: opts.bookingRef
        ? { key: `${BASELINE_PREFIX}${opts.bookingRef.toUpperCase()}` }
        : { key: { startsWith: BASELINE_PREFIX } },
      take: 3000,
    })
    const baselines = new Map<string, McBaseline>()
    for (const r of rows) {
      const b = parseBaseline(r.value)
      if (b && !b.paused) baselines.set(r.key.slice(BASELINE_PREFIX.length).toUpperCase(), b)
    }

    if (baselines.size) {
      const { read } = await readSheet(true)
      const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
      const bookings = await prisma.booking.findMany({
        where: { bookingRef: { in: Array.from(baselines.keys()) }, operationCountry: 'VIETNAM', status: { notIn: CLOSED } },
        select: {
          bookingRef: true, departureDate: true,
          tourAgenda: {
            select: {
              id: true,
              items: {
                orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
                select: {
                  id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true, mealPlan: true,
                  meetingTime: true, serviceType: true, sortOrder: true, isLeisure: true, isHotelOnly: true,
                  assignment: { select: { driverId: true, vendorId: true, driverName: true, driverPhone: true } },
                },
              },
            },
          },
        },
      })
      for (const b of bookings) {
        if (b.departureDate && ymd(b.departureDate) < today) continue
        const baseline = baselines.get(b.bookingRef.toUpperCase())
        if (!baseline || !b.tourAgenda?.items.length) continue
        try {
          results.push(await updateOne(b.bookingRef, b.tourAgenda.id, b.tourAgenda.items as DbItem[], linesFor(read, b.bookingRef), baseline))
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[Excel auto-update] ${b.bookingRef} failed (nothing written for it):`, msg)
          results.push({ bookingRef: b.bookingRef, fields: 0, created: 0, keptOps: 0, skipped: `error: ${msg.slice(0, 200)}` })
        }
      }
    }

    const state: McAutoRunState = {
      at: new Date().toISOString(), status: 'SUCCESS', trigger: opts.trigger,
      bookings: results.length,
      changedBookings: results.filter(r => r.fields || r.created).length,
      fields: results.reduce((s, r) => s + r.fields, 0),
      created: results.reduce((s, r) => s + r.created, 0),
      durationMs: Date.now() - started,
    }
    if (!opts.bookingRef) await setMcAutoState(state)
    return { ...state, results }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const state: McAutoRunState = {
      at: new Date().toISOString(), status: 'FAILED', trigger: opts.trigger, bookings: results.length,
      changedBookings: 0, fields: 0, created: 0, durationMs: Date.now() - started, error: msg.slice(0, 500),
    }
    if (!opts.bookingRef) await setMcAutoState(state)
    console.error('[Excel auto-update] run failed:', msg)
    return { ...state, results }
  } finally {
    if (locked) await releaseMcAutoLock()
    busy = false
  }
}

async function updateOne(
  bookingRef: string, agendaId: string, db: DbItem[], lines: ReturnType<typeof linesFor>, baseline: McBaseline,
): Promise<McAutoBookingResult> {
  const res: McAutoBookingResult = { bookingRef, fields: 0, created: 0, keptOps: 0 }
  if (!lines.length) {
    await logBookingEventOnce({
      bookingRef, section: 'agenda', action: 'excel_auto_skipped', actor: ACTOR, source: 'excel', status: 'skipped',
      summary: 'Excel auto-update: this booking is no longer on the Movement Chart Excel — chart left as it is',
    })
    res.skipped = 'not on sheet'
    return res
  }

  const items = db.map(toChart)
  const plan = autoPlan(items, lines, baseline)
  res.keptOps = plan.keptOps.length

  if (plan.changes.length > MAX_FIELDS_PER_BOOKING || plan.creates.length > MAX_CREATES_PER_BOOKING) {
    await logBookingEventOnce({
      bookingRef, section: 'agenda', action: 'excel_auto_skipped', actor: ACTOR, source: 'excel', status: 'skipped',
      summary: `Excel auto-update held back: ${plan.changes.length} field changes and ${plan.creates.length} new rows at once looks like a restructured sheet — review it with Excel MC Generate`,
    })
    res.skipped = 'too many changes'
    return res
  }

  // ── Apply, in one transaction ──────────────────────────────────────────────
  const applied: LogChange[] = []
  const createdLabels: string[] = []
  if (plan.changes.length || plan.creates.length) {
    await prisma.$transaction(async tx => {
      for (const c of plan.changes) {
        const row = db[c.index]
        const before = (row as unknown as Record<string, string | null>)[c.field]
        const data: Record<string, unknown> = { [c.field]: c.to }
        if (c.field === 'serviceType' && c.to === 'ACCOMMODATION') { data.isHotelOnly = true; data.isLeisure = false }
        // Compare-and-set: only if the movement still holds what was read above.
        const where = { id: row.id, agendaId, [c.field]: before } as Prisma.AgendaItemWhereInput
        const r = await tx.agendaItem.updateMany({ where, data: data as Prisma.AgendaItemUpdateManyMutationInput })
        if (r.count === 1) {
          res.fields++
          applied.push({
            field: `${movementLabel(row)} · ${FIELD_LABELS[c.field]}`,
            from: c.from.length > 140 ? `${c.from.slice(0, 139)}…` : (c.from || null),
            to: c.to.length > 140 ? `${c.to.slice(0, 139)}…` : c.to,
          })
        }
      }

      if (plan.creates.length) {
        // New rows slot into their day by meeting time; the chart's order is rewritten only where it moved.
        type Slot = { id?: string; date: string; time: number | null; sortOrder?: number; line?: (typeof plan.creates)[number] }
        const order: Slot[] = db.map(i => ({ id: i.id, date: ymd(i.date), time: clockMin(i.meetingTime), sortOrder: i.sortOrder }))
        for (const line of plan.creates) {
          const t = clockMin(line.time)
          let at = order.length
          for (let i = 0; i < order.length; i++) {
            if (order[i].date > line.date!) { at = i; break }
            if (order[i].date === line.date && t !== null && order[i].time !== null && order[i].time! > t) { at = i; break }
          }
          order.splice(at, 0, { date: line.date!, time: t, line })
        }
        for (let i = 0; i < order.length; i++) {
          const s = order[i]
          if (s.line) {
            const it = itemFromLine(s.line, f => f)
            const isLeisure = it.isHotelOnly ? false : resolveIsLeisure({ ...it, isLeisure: null })
            await tx.agendaItem.create({
              data: {
                agendaId, date: new Date(`${s.line.date}T00:00:00.000Z`), sortOrder: i,
                location: it.location, fromPoint: it.fromPoint || null, toPoint: it.toPoint || null,
                details: it.details || null, mealPlan: it.mealPlan || null, meetingTime: it.meetingTime || null,
                serviceType: it.serviceType, isLeisure, isHotelOnly: it.isHotelOnly,
              },
            })
            res.created++
            createdLabels.push(movementLabel({ date: s.line.date, fromPoint: it.fromPoint, toPoint: it.toPoint, location: it.location }))
          } else if (s.id && s.sortOrder !== i) {
            await tx.agendaItem.updateMany({ where: { id: s.id, agendaId }, data: { sortOrder: i } })
          }
        }
      }
      if (res.fields || res.created) await tx.tourAgenda.update({ where: { id: agendaId }, data: { updatedAt: new Date() } })
    }, { maxWait: 10_000, timeout: 30_000 })
  }

  // ── Log ────────────────────────────────────────────────────────────────────
  if (res.fields || res.created) {
    const moved = new Set(applied.map(a => a.field.split(' · ').slice(0, -1).join(' · '))).size
    const bits = [
      res.fields && `${res.fields} field${res.fields === 1 ? '' : 's'} on ${moved} movement${moved === 1 ? '' : 's'}`,
      res.created && `+${res.created} new movement${res.created === 1 ? '' : 's'}`,
    ].filter(Boolean)
    await logBookingEvent({
      bookingRef, section: 'agenda', action: 'excel_auto_updated', actor: ACTOR, source: 'excel',
      summary: `Updated automatically from the Movement Chart Excel — ${bits.join(', ')}`,
      changes: [...applied, ...createdLabels.map(l => ({ field: 'Added', from: null, to: l }))].slice(0, 60),
      reason: res.created ? 'New movements get their driver from VN Driver Sync on its next run. No WhatsApp was sent.' : 'No WhatsApp was sent.',
    })
  }
  if (plan.keptOps.length) {
    await logBookingEventOnce({
      bookingRef, section: 'agenda', action: 'excel_auto_kept', actor: ACTOR, source: 'excel', status: 'skipped',
      summary: `Excel changed ${plan.keptOps.length} field(s) that were edited in OPS — the OPS values were kept. Review with Excel MC Generate`,
      changes: plan.keptOps.slice(0, 30).map(k => ({
        field: `${movementLabel(db[k.index])} · ${FIELD_LABELS[k.field]}`,
        from: `OPS: ${k.from}`.slice(0, 160), to: `Excel: ${k.to}`.slice(0, 160),
      })),
    })
  }
  if (plan.notInSheet.length) {
    await logBookingEventOnce({
      bookingRef, section: 'agenda', action: 'excel_auto_kept', actor: ACTOR, source: 'excel', status: 'skipped',
      summary: `${plan.notInSheet.length} movement(s) built from the Excel are no longer in it — not removed automatically. Review with Excel MC Generate`,
      changes: plan.notInSheet.slice(0, 20).map(i => ({ field: 'Not in Excel', from: movementLabel(db[i]), to: null })),
    })
  }

  // ── Move the baseline on (only when something about the sheet changed) ────
  const keys = lines.map(l => l.key)
  const sameKeys = keys.length === baseline.keys.length && keys.every(k => baseline.keys.includes(k))
  if (!sameKeys || res.fields || res.created) {
    await writeBaseline(bookingRef, {
      ...baseline,
      keys,
      vals: [...lines.flatMap(lineValueKeys), ...(baseline.vals ?? [])],
      autoAt: res.fields || res.created ? new Date().toISOString() : baseline.autoAt ?? null,
    })
  }
  return res
}
