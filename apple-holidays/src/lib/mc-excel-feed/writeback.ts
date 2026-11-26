/**
 * MC Excel Feed — Excel → OPS for the two two-way columns.
 *
 * The only place the feed writes to the OPS database, and only:
 *   agenda_items.meetingTime            for Meeting Time
 *   assignments.driverName / driverPhone for Driver Details (created when the
 *                                        movement has no assignment yet)
 *
 * Every write is compare-and-set against what the planner saw in OPS: if the
 * agenda changed in between (a person edited it, or a chart save recreated the
 * movement), the write is skipped and the next sync re-plans from the new state.
 * Never on a cancelled / cancelling booking, a leisure day or a hotel-only
 * movement for drivers; never sends a WhatsApp; never blanks a value. When the
 * driver's phone changes, the link to a registered driver and the "brief sent"
 * mark are cleared — they described the previous driver. Every change is written
 * to the booking's logs.
 */
import { prisma } from '@/lib/prisma'
import { isAssignLocked } from '@/lib/booking-assign-lock'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { logBookingEvent, type LogChange } from '@/lib/booking-logs'
import { driverKey, driverText } from './shared'
import type { Writeback } from './plan'

export interface WritebackOutcome { applied: Writeback[]; skipped: { wb: Writeback; reason: string }[] }

const clean = (s: string | null | undefined) => String(s ?? '').replace(/\r\n?/g, '\n').trim()
const last9 = (p: string) => p.replace(/\D/g, '').slice(-9)
const ACTOR = { id: null, name: 'MC Excel Feed' }

async function applyOne(wb: Writeback): Promise<string | null> {
  if (wb.field === 'meetingTime') {
    if (!wb.meetingTime.trim()) return 'A blank never clears OPS'
    const where = wb.opsMeetingTime
      ? { id: wb.lineId, meetingTime: wb.opsMeetingTime }
      : { id: wb.lineId, OR: [{ meetingTime: null }, { meetingTime: '' }] }
    const res = await prisma.agendaItem.updateMany({ where, data: { meetingTime: wb.meetingTime } })
    return res.count === 1 ? null : 'The movement changed in OPS since the sheet was read (or the chart was re-saved) — will re-check next sync'
  }

  if (!wb.driver.name && !wb.driver.phone) return 'A blank never clears OPS'
  return prisma.$transaction(async tx => {
    const item = await tx.agendaItem.findUnique({
      where: { id: wb.lineId },
      select: {
        location: true, fromPoint: true, toPoint: true, details: true, serviceType: true, isLeisure: true, isHotelOnly: true,
        assignment: { select: { id: true, driverName: true, driverPhone: true } },
        agenda: { select: { booking: { select: { status: true } } } },
      },
    })
    if (!item) return 'The movement no longer exists (the chart was re-saved) — will re-check next sync'
    if (isAssignLocked(item.agenda.booking.status)) return 'The booking is cancelled or being cancelled — no driver is written'
    if (item.isHotelOnly === true) return 'Hotel-only movement — no driver is written'
    if (resolveIsLeisure(item)) return 'Leisure day — no driver is written'
    const cur = { name: clean(item.assignment?.driverName), phone: clean(item.assignment?.driverPhone) }
    if (driverKey(cur.name, cur.phone) !== driverKey(wb.opsDriver.name, wb.opsDriver.phone)) {
      return 'The driver changed in OPS since the sheet was read — will re-check next sync'
    }
    const phoneChanged = last9(cur.phone) !== last9(wb.driver.phone)
    const data = {
      driverName: wb.driver.name || null,
      driverPhone: wb.driver.phone || null,
      // A new number is a different person: the registered-driver link and the
      // "brief sent" mark belonged to the previous one.
      ...(phoneChanged ? { driverId: null, waSentAt: null } : {}),
    }
    if (item.assignment) {
      const res = await tx.assignment.updateMany({
        where: { id: item.assignment.id, driverName: item.assignment.driverName, driverPhone: item.assignment.driverPhone },
        data,
      })
      return res.count === 1 ? null : 'The driver changed in OPS while writing — will re-check next sync'
    }
    await tx.assignment.create({ data: { agendaItemId: wb.lineId, ...data } })
    return null
  }, { maxWait: 10_000, timeout: 20_000 }).catch((err: unknown) => `Not written: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
}

export async function applyWritebacks(wbs: Writeback[]): Promise<WritebackOutcome> {
  const out: WritebackOutcome = { applied: [], skipped: [] }
  for (const wb of wbs) {
    const reason = await applyOne(wb).catch((err: unknown) => `Not written: ${err instanceof Error ? err.message.slice(0, 160) : 'error'}`)
    if (reason) out.skipped.push({ wb, reason }); else out.applied.push(wb)
  }

  // One log entry per booking, listing every field that came from the Excel.
  const byRef = new Map<string, Writeback[]>()
  for (const wb of out.applied) (byRef.get(wb.bookingRef) ?? byRef.set(wb.bookingRef, []).get(wb.bookingRef)!).push(wb)
  for (const [bookingRef, list] of Array.from(byRef.entries())) {
    const changes: LogChange[] = list.map(wb => wb.field === 'meetingTime'
      ? { field: `Meeting time · ${wb.date} · ${wb.label.slice(0, 60)}`, from: wb.opsMeetingTime || null, to: wb.meetingTime }
      : { field: `Driver · ${wb.date} · ${wb.label.slice(0, 60)}`, from: driverText(wb.opsDriver.name, wb.opsDriver.phone) || null, to: driverText(wb.driver.name, wb.driver.phone) })
    await logBookingEvent({
      bookingRef, section: 'agenda', action: 'excel_feed_update', source: 'system', actor: ACTOR,
      summary: `Updated from the MC Excel: ${list.length} change${list.length === 1 ? '' : 's'} (${Array.from(new Set(list.map(w => w.field === 'meetingTime' ? 'meeting time' : 'driver'))).join(', ')}). No WhatsApp sent.`,
      changes,
    }).catch(() => undefined)
  }
  return out
}
