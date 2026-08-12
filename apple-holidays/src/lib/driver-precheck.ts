/**
 * Driver Pre-checking — the read model behind the Drivers tab.
 *
 * The hotel side of Pre-checking asks "is the room confirmed?". This side asks
 * the two questions that actually strand a guest at the airport: **is a driver
 * assigned to every movement, and is the daily WhatsApp briefing reaching
 * them?**
 *
 * No new tables. Everything is derived from data the system already keeps:
 *
 *  - `agenda_items` + `assignments` — the movements and who is driving them
 *  - `assignments.waSentAt`         — stamped only by the daily briefing cron
 *    (`/api/cron/driver-notify`), so it is an unambiguous "today's briefing
 *    went out at X" marker per movement
 *  - `whatsapp_messages`            — the body that was actually delivered
 *  - `drivers`                      — the master list a movement can link to
 *
 * Server-only: importing this pulls in Prisma and the WhatsApp layer. The
 * shapes the UI renders live in `driver-precheck-shared.ts`.
 */
import { prisma } from './prisma'
import { formatDriverMovementMessage, normalisePhone } from './whatsapp'
import { resolveIsLeisure } from './leisure-day'
import { SETTING_DRIVER_ASSIGN } from './driver-assignment-whatsapp'
import {
  summarizeDriverDays,
  type BriefingState,
  type DriverPrecheckDay,
  type DriverPrecheckMessage,
  type DriverPrecheckView,
} from './driver-precheck-shared'

export * from './driver-precheck-shared'

const DAY_MS = 86_400_000

/**
 * Window either side of `waSentAt` in which a logged message is taken to be
 * that briefing. The cron writes the log row and the stamp in one
 * `Promise.all`, so they land within milliseconds; a minute is generous.
 */
const MATCH_WINDOW_MS = 60_000

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS)
}

/**
 * Classify one movement's briefing.
 *
 * `waSentAt` is the source of truth for "sent" because it is the cron's own
 * stamp. The remaining states are pure calendar arithmetic against the
 * movement date — a driver-less movement two weeks out is not a problem yet,
 * the same movement yesterday is.
 */
export function classifyBriefing(opts: {
  date: Date
  driverNotRequired: boolean
  hasDriver: boolean
  hasPhone: boolean
  waSentAt: Date | null
  now?: Date
}): BriefingState {
  const now = opts.now ?? new Date()

  if (opts.driverNotRequired) return 'NOT_REQUIRED'
  if (!opts.hasDriver) return 'NO_DRIVER'

  // A briefing that already went out stays "sent" even if the number was later
  // cleared — the driver has the message regardless.
  if (opts.waSentAt) return 'SENT'
  if (!opts.hasPhone) return 'NO_PHONE'

  const delta = daysBetween(now, opts.date)
  if (delta > 0) return 'SCHEDULED'
  if (delta === 0) return 'PENDING'
  return 'MISSED'
}

/**
 * Build the Drivers view for one booking.
 *
 * Reads only — nothing here writes, so opening the tab can never disturb an
 * assignment or re-trigger a send.
 */
export async function buildDriverPrecheck(bookingRef: string): Promise<DriverPrecheckView | null> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      bookingRef: true, isNumber: true, operationCountry: true,
      arrivalDate: true, departureDate: true,
      paxAdults: true, paxChildren: true,
      passengers: { where: { isLead: true }, select: { name: true }, take: 1 },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true,
              details: true, meetingTime: true, serviceType: true,
              isLeisure: true, isHotelOnly: true,
              assignment: {
                select: {
                  id: true, driverId: true, driverName: true, driverPhone: true,
                  vehicleType: true, vehiclePlate: true, driverRate: true,
                  rateCurrency: true, vendorName: true, notes: true, waSentAt: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!booking) return null

  const leadGuest = booking.passengers[0]?.name ?? null
  const items = booking.tourAgenda?.items ?? []

  // ── Master driver records for every linked driver, in one query.
  const driverIds = Array.from(new Set(
    items.map(i => i.assignment?.driverId).filter((v): v is string => !!v),
  ))
  const masters = driverIds.length === 0 ? [] : await prisma.driver.findMany({
    where: { id: { in: driverIds } },
    select: { id: true, phone: true, isActive: true },
  })
  const masterById = new Map(masters.map(m => [m.id, m]))

  // ── Every outbound driver message on this booking, in one query.
  const logs = await prisma.whatsAppMessage.findMany({
    where: { bookingRef, direction: 'outbound', senderName: { startsWith: '[DRIVER' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, body: true, createdAt: true, status: true, phone: true },
  })

  const usedLogIds = new Set<string>()
  const now = new Date()

  const days: DriverPrecheckDay[] = items.map((item, idx) => {
    const a = item.assignment
    const phone = a?.driverPhone?.trim() || null
    const master = a?.driverId ? masterById.get(a.driverId) : undefined

    // A leisure or hotel-only day needs no driver. `isLeisure` is nullable on
    // rows saved before the column existed, so fall back to text detection.
    const leisure = resolveIsLeisure({
      isLeisure: item.isLeisure,
      location: item.location,
      details: item.details,
      serviceType: item.serviceType,
    })
    const driverNotRequired = leisure || item.isHotelOnly === true

    // Pair the movement with the message the cron logged alongside its stamp.
    let sentMessage: DriverPrecheckMessage | null = null
    if (a?.waSentAt && phone) {
      const target = a.waSentAt.getTime()
      const want = normalisePhone(phone)
      const hit = logs.find(m =>
        !usedLogIds.has(m.id) &&
        normalisePhone(m.phone) === want &&
        Math.abs(m.createdAt.getTime() - target) <= MATCH_WINDOW_MS,
      )
      if (hit) {
        usedLogIds.add(hit.id)
        sentMessage = {
          id: hit.id, body: hit.body ?? '', sentAt: hit.createdAt.toISOString(),
          status: hit.status, phone: hit.phone,
        }
      }
    }

    return {
      agendaItemId: item.id,
      dayNo: idx + 1,
      date: item.date.toISOString(),
      location: item.location,
      fromPoint: item.fromPoint,
      toPoint: item.toPoint,
      details: item.details,
      meetingTime: item.meetingTime,
      serviceType: item.serviceType,
      driverNotRequired,

      driver: {
        assignmentId: a?.id ?? null,
        driverId: a?.driverId ?? null,
        name: a?.driverName ?? null,
        phone,
        vehicleType: a?.vehicleType ?? null,
        vehiclePlate: a?.vehiclePlate ?? null,
        rate: a?.driverRate == null ? null : Number(a.driverRate),
        rateCurrency: a?.rateCurrency ?? null,
        vendorName: a?.vendorName ?? null,
        notes: a?.notes ?? null,
        // Linked to a driver row that has been deactivated or deleted.
        registeredInactive: !!a?.driverId && (!master || !master.isActive),
        masterPhone: master && phone && normalisePhone(master.phone) !== normalisePhone(phone)
          ? master.phone
          : null,
      },

      briefing: classifyBriefing({
        date: item.date,
        driverNotRequired,
        hasDriver: !!a?.driverName,
        hasPhone: !!phone,
        waSentAt: a?.waSentAt ?? null,
        now,
      }),
      sentAt: a?.waSentAt?.toISOString() ?? null,
      sentMessage,

      // Rendered from current data, so "View" shows what *will* go out on a day
      // that has not sent yet — and, on a sent day with no matching log row,
      // still shows the shape of the message.
      previewMessage: formatDriverMovementMessage({
        driverName: a?.driverName || 'Driver',
        bookingRef: booking.bookingRef,
        date: item.date,
        location: item.location,
        fromPoint: item.fromPoint,
        toPoint: item.toPoint,
        details: item.details,
        meetingTime: item.meetingTime,
        paxAdults: booking.paxAdults,
        paxChildren: booking.paxChildren,
        leadPassenger: leadGuest,
        vehicleType: a?.vehicleType ?? null,
        vehiclePlate: a?.vehiclePlate ?? null,
        driverRate: a?.driverRate == null ? null : Number(a.driverRate),
        rateCurrency: a?.rateCurrency ?? null,
      }),
      daysAway: daysBetween(now, item.date),
    }
  })

  // Anything left over is assignment / cancellation / advance-sheet traffic.
  const otherMessages: DriverPrecheckMessage[] = logs
    .filter(m => !usedLogIds.has(m.id))
    .slice(0, 50)
    .map(m => ({
      id: m.id, body: m.body ?? '', sentAt: m.createdAt.toISOString(),
      status: m.status, phone: m.phone,
    }))

  const toggle = await prisma.systemSetting.findUnique({ where: { key: SETTING_DRIVER_ASSIGN } })

  return {
    bookingRef: booking.bookingRef,
    isNumber: booking.isNumber,
    leadGuest,
    operationCountry: booking.operationCountry,
    arrivalDate: booking.arrivalDate.toISOString(),
    departureDate: booking.departureDate.toISOString(),
    hasAgenda: items.length > 0,
    // Absent row means ON — same convention as the rest of the automation.
    autoBriefingEnabled: toggle?.value !== 'false',
    days,
    stats: summarizeDriverDays(days),
    otherMessages,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Registered drivers offered by the picker, with double-booking warnings.
 *
 * A driver already committed to another booking over the same dates is the
 * single most expensive mistake this screen can prevent, so the clash is
 * surfaced on the option itself rather than discovered on the day.
 */
export async function searchAssignableDrivers(opts: {
  query?: string | null
  country?: string | null
  from?: Date | null
  to?: Date | null
  excludeBookingRef?: string | null
  limit?: number
}) {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 25)), 100)
  const q = opts.query?.trim()

  const drivers = await prisma.driver.findMany({
    where: {
      isActive: true,
      ...(opts.country ? { OR: [{ country: opts.country as never }, { country: null }] } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { phone: { contains: q } }] } : {}),
    },
    select: {
      id: true, name: true, phone: true, isActive: true, country: true,
      vehicle: { select: { type: true, plateNo: true } },
      vendorOwner: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
    take: limit,
  })
  if (drivers.length === 0) return []

  // Existing commitments for these drivers inside the tour window.
  const clashRows = (opts.from && opts.to)
    ? await prisma.assignment.findMany({
        where: {
          driverId: { in: drivers.map(d => d.id) },
          agendaItem: {
            date: { gte: opts.from, lte: opts.to },
            ...(opts.excludeBookingRef
              ? { agenda: { booking: { bookingRef: { not: opts.excludeBookingRef } } } }
              : {}),
          },
        },
        select: {
          driverId: true,
          agendaItem: {
            select: {
              date: true, location: true,
              agenda: { select: { booking: { select: { bookingRef: true } } } },
            },
          },
        },
      })
    : []

  const clashesByDriver = new Map<string, Array<{ bookingRef: string; date: string; location: string }>>()
  for (const r of clashRows) {
    if (!r.driverId) continue
    const list = clashesByDriver.get(r.driverId) ?? []
    list.push({
      bookingRef: r.agendaItem.agenda.booking.bookingRef,
      date: r.agendaItem.date.toISOString(),
      location: r.agendaItem.location,
    })
    clashesByDriver.set(r.driverId, list)
  }

  return drivers.map(d => ({
    id: d.id,
    name: d.name,
    phone: d.phone,
    isActive: d.isActive,
    country: d.country,
    vehicleType: d.vehicle?.type ?? null,
    vehiclePlate: d.vehicle?.plateNo ?? null,
    vendorName: d.vendorOwner?.name ?? null,
    clashes: (clashesByDriver.get(d.id) ?? []).slice(0, 5),
  }))
}
