/**
 * Movement-chart logging: a full chart save, a driver / vendor / guide
 * assignment, and a single movement edit. Never throws.
 */
import { prisma } from '@/lib/prisma'
import { diffFields, logBookingEvent, type LogChange } from '@/lib/booking-logs'

type Actor = { id: string; name: string | null }

interface MovementLike {
  date: Date | string | null
  location?: string | null
  fromPoint?: string | null
  toPoint?: string | null
  serviceType?: string | null
  meetingTime?: string | null
  assignment?: AssignmentLike | null
}
interface AssignmentLike {
  driverName?: string | null
  driverPhone?: string | null
  vendorName?: string | null
  vehicleType?: string | null
  vehiclePlate?: string | null
  guideName?: string | null
  tourVendorName?: string | null
}

const ymd = (d: Date | string | null) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? String(d) : x.toISOString().slice(0, 10)
}
const dayLabel = (d: Date | string | null) => {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function movementLabel(m: MovementLike): string {
  const from = m.fromPoint?.trim(), to = m.toPoint?.trim()
  const route = from && to && from !== to ? `${from} → ${to}` : (to || from || m.location || '').trim()
  return [dayLabel(m.date), route].filter(Boolean).join(' · ').slice(0, 160)
}

const keyOf = (m: MovementLike) => `${ymd(m.date)}|${(m.toPoint || m.location || '').trim().toLowerCase()}|${m.serviceType ?? ''}`

const PEOPLE: [keyof AssignmentLike, string][] = [
  ['driverName', 'Driver'], ['vendorName', 'Driver vendor'], ['guideName', 'Guide'], ['tourVendorName', 'Tour vendor'],
]

function peopleChanges(prev: AssignmentLike | null | undefined, next: AssignmentLike | null | undefined): LogChange[] {
  const out: LogChange[] = []
  for (const [k, label] of PEOPLE) {
    const a = (prev?.[k] ?? '').toString().trim() || null
    const b = (next?.[k] ?? '').toString().trim() || null
    if ((a ?? '') !== (b ?? '')) out.push({ field: label, from: a, to: b })
  }
  const va = [prev?.vehicleType, prev?.vehiclePlate].filter(Boolean).join(' ') || null
  const vb = [next?.vehicleType, next?.vehiclePlate].filter(Boolean).join(' ') || null
  if ((va ?? '') !== (vb ?? '')) out.push({ field: 'Vehicle', from: va, to: vb })
  return out
}

/** Read before a chart save: the movements and who is on them. */
export async function snapshotAgenda(agendaId: string | null | undefined) {
  if (!agendaId) return null
  return prisma.agendaItem.findMany({
    where: { agendaId },
    select: {
      date: true, location: true, fromPoint: true, toPoint: true, serviceType: true,
      assignment: { select: { driverName: true, driverPhone: true, vendorName: true, vehicleType: true, vehiclePlate: true, guideName: true, tourVendorName: true } },
    },
  }).catch(() => null)
}

export async function logAgendaSave(bookingRef: string, before: MovementLike[] | null, after: MovementLike[], actor: Actor) {
  try {
    if (!before || before.length === 0) {
      await logBookingEvent({
        bookingRef, section: 'agenda', action: 'created', actor, source: 'user',
        summary: `Movement chart created — ${after.length} movement${after.length === 1 ? '' : 's'}`,
      })
    } else {
      const oldKeys = new Map(before.map(m => [keyOf(m), m]))
      const newKeys = new Map(after.map(m => [keyOf(m), m]))
      const added = after.filter(m => !oldKeys.has(keyOf(m)))
      const removed = before.filter(m => !newKeys.has(keyOf(m)))
      const changes: LogChange[] = [
        ...added.slice(0, 15).map(m => ({ field: 'Added', from: null, to: movementLabel(m) })),
        ...removed.slice(0, 15).map(m => ({ field: 'Removed', from: movementLabel(m), to: null })),
      ]
      const bits = [added.length && `+${added.length} added`, removed.length && `−${removed.length} removed`].filter(Boolean)
      await logBookingEvent({
        bookingRef, section: 'agenda', action: added.length || removed.length ? 'updated' : 'saved', actor, source: 'user', changes,
        summary: `Movement chart saved — ${after.length} movements${bits.length ? ` (${bits.join(', ')})` : ', no movements added or removed'}`,
      })
    }

    // Who is on each movement that existed before and after.
    const oldByKey = new Map((before ?? []).map(m => [keyOf(m), m]))
    for (const m of after) {
      const prev = oldByKey.get(keyOf(m))
      const ch = peopleChanges(prev?.assignment, m.assignment)
      if (!ch.length || (!prev && !m.assignment)) continue
      if (!prev && ch.every(c => !c.to)) continue
      await logBookingEvent({
        bookingRef, section: 'agenda', actor, source: 'user', changes: ch,
        action: ch.every(c => !c.to) ? 'unassigned' : 'assigned',
        summary: `${ch.map(c => c.field).join(' & ')} ${ch.every(c => !c.to) ? 'removed' : 'set'} · ${movementLabel(m)}`,
      })
    }
  } catch (err) {
    console.warn('[booking-logs] agenda save log failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

export async function logAssignment(bookingRef: string, item: MovementLike, prev: AssignmentLike | null, next: AssignmentLike | null, actor: Actor, note?: string) {
  try {
    const ch = peopleChanges(prev, next)
    if (!ch.length) return
    const cleared = next === null || ch.every(c => !c.to)
    await logBookingEvent({
      bookingRef, section: 'agenda', actor, source: 'user', changes: ch,
      action: cleared ? 'unassigned' : 'assigned',
      summary: `${ch.map(c => c.field).join(' & ')} ${cleared ? 'removed' : prev && ch.some(c => c.from) ? 'changed' : 'assigned'} · ${movementLabel(item)}`,
      reason: note ?? null,
    })
  } catch { /* never block the save */ }
}

const ITEM_FIELDS: Record<string, string> = {
  date: 'Date', location: 'Location', fromPoint: 'From', toPoint: 'To', details: 'Details',
  mealPlan: 'Meal plan', meetingTime: 'Meeting time', serviceType: 'Service type', isLeisure: 'Leisure', isHotelOnly: 'Hotel only',
}

export async function logMovementEdit(bookingRef: string, before: Record<string, unknown>, after: Record<string, unknown>, actor: Actor) {
  try {
    const norm = (r: Record<string, unknown>) => ({ ...r, date: r.date ? ymd(r.date as Date) : r.date })
    const ch = diffFields(norm(before), norm(after), ITEM_FIELDS)
    if (!ch.length) return
    await logBookingEvent({
      bookingRef, section: 'agenda', action: 'updated', actor, source: 'user', changes: ch,
      summary: `Movement edited · ${movementLabel(before as unknown as MovementLike)}`,
    })
  } catch { /* never block the save */ }
}
