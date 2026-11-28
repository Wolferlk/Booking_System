/**
 * Watches every flight write and queues the booking for the late-flight
 * meeting-time fill (lib/agenda-flight-time-sync.ts).
 *
 * Flights are written from about ten places: the booking edit and full-edit
 * routes, Apple System sync and data protection, B2C placement, amendments
 * (booking-versions), the file-handler flight routes, the public FH API and
 * OPS-AI. Rather than remember all of them, and every one added later, this
 * one Prisma middleware sees them all.
 *
 * It only *reads* the write it observes and queues a debounced job; it never
 * changes the query, its result or its error. Anything it cannot work out
 * (a filtered updateMany) is left to the 5-minute sweep.
 *
 * Deliberately no import of ./prisma (this module is imported BY prisma.ts) and
 * no static import of the sync module: the queue is loaded on first use.
 * Off switch: AGENDA_FLIGHT_TIME_SYNC=off.
 */
import type { PrismaClient } from '@prisma/client'

type Params = {
  model?: string
  action: string
  args?: Record<string, unknown> | undefined
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The queue keys a write touches: "b:<bookingId>" or "f:<flightId>". */
export function flightWriteKeys(params: Params, result: unknown): string[] {
  const args = (params.args ?? {}) as Record<string, any>
  const res = (result ?? {}) as Record<string, any>
  const keys = new Set<string>()
  const addBooking = (id: unknown) => { const s = str(id); if (s) keys.add(`b:${s}`) }

  if (params.model === 'Flight') {
    switch (params.action) {
      case 'create':
        addBooking(args.data?.bookingId ?? args.data?.booking?.connect?.id ?? res.bookingId)
        break
      case 'createMany':
      case 'createManyAndReturn': {
        const data = Array.isArray(args.data) ? args.data : [args.data]
        for (const d of data) addBooking(d?.bookingId)
        break
      }
      case 'update':
      case 'upsert':
        if (str(res.bookingId)) addBooking(res.bookingId)
        else if (str(args.where?.id)) keys.add(`f:${args.where.id}`)
        break
      case 'updateMany':
        addBooking(args.where?.bookingId)
        break
      // delete / deleteMany: a removed flight cannot time a blank row, and the
      // replace pattern (deleteMany + createMany) is caught by the create.
    }
  } else if (params.model === 'Booking' && args.data?.flights
    && (params.action === 'create' || params.action === 'update' || params.action === 'upsert')) {
    addBooking(res.id)
  }
  return Array.from(keys)
}

const g = globalThis as unknown as { __agendaFlightTimeHookOn?: WeakSet<object> }

export function installFlightWriteHook(client: PrismaClient): void {
  if (process.env.AGENDA_FLIGHT_TIME_SYNC === 'off') return
  const installed = (g.__agendaFlightTimeHookOn ??= new WeakSet())
  if (installed.has(client)) return
  installed.add(client)

  client.$use(async (params, next) => {
    const result = await next(params)
    try {
      if (params.model === 'Flight' || params.model === 'Booking') {
        const keys = flightWriteKeys(params as Params, result)
        if (keys.length) {
          void import('./agenda-flight-time-sync')
            .then(m => { for (const k of keys) m.queueAgendaFlightTimeSync(k, 'flight-write') })
            .catch(() => undefined)
        }
      }
    } catch { /* observing only — never affects the write */ }
    return result
  })
}
