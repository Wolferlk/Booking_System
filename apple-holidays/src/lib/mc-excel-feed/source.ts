/**
 * MC Excel Feed — what OPS says: one FeedRow per agenda line of every booking
 * in scope, in the order the sheet should read (arrival date, booking, movement
 * date, chart order). Read-only.
 */
import type { OperationCountry, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AS_EXTRAS_PREFIX } from '@/lib/as-booking-extras'
import { B2C_IMPORT_NOTE_PREFIX, isB2cOrigin } from '@/lib/booking-source'
import { mealPlanFullName } from '@/lib/agenda-suggestions'
import { serviceTypeLabel } from '@/lib/service-types'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { isAssignLocked } from '@/lib/booking-assign-lock'
import { STATUS, type FeedConfig, type FeedCountry, type FeedRow } from './shared'

const COUNTRY_WHERE: Record<FeedCountry, { values: string[]; prefixes: string[] }> = {
  VIETNAM: { values: ['VIETNAM'], prefixes: ['VN'] },
  SRILANKA: { values: ['SRILANKA'], prefixes: ['IS'] },
  SINGAPORE_MALAYSIA: { values: ['SINGAPORE_MALAYSIA', 'SINGAPORE', 'MALAYSIA'], prefixes: ['SG', 'MY'] },
}

/** Bookings in scope: arrival on/after the start date, in one of the countries (or no country but a matching ref). */
export function feedWhere(config: Pick<FeedConfig, 'startDate' | 'countries'>): Prisma.BookingWhereInput {
  const countries = config.countries.length ? config.countries : (['VIETNAM'] as FeedCountry[])
  const values = countries.flatMap(c => COUNTRY_WHERE[c].values)
  const prefixes = countries.flatMap(c => COUNTRY_WHERE[c].prefixes)
  return {
    arrivalDate: { gte: new Date(`${config.startDate}T00:00:00.000Z`) },
    OR: [
      { operationCountry: { in: values as OperationCountry[] } },
      {
        operationCountry: null,
        OR: prefixes.flatMap(p => [{ bookingRef: { startsWith: p } }, { isNumber: { startsWith: p } }]),
      },
    ],
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const clean = (s: string | null | undefined) => String(s ?? '').replace(/\r\n?/g, '\n').trim()

async function agentIds(refs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < refs.length; i += 400) {
    const keys = refs.slice(i, i + 400).map(r => `${AS_EXTRAS_PREFIX}${r}`)
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } })
    for (const row of rows) {
      try {
        const v = JSON.parse(row.value) as { agentId?: string | null }
        if (v.agentId) out.set(row.key.slice(AS_EXTRAS_PREFIX.length), String(v.agentId).trim())
      } catch { /* a malformed blob is just no agent id */ }
    }
  }
  return out
}

export interface FeedLoad {
  rows: FeedRow[]
  bookings: number
  bookingsWithoutAgenda: number
}

export async function loadFeed(config: Pick<FeedConfig, 'startDate' | 'countries'>): Promise<FeedLoad> {
  const bookings = await prisma.booking.findMany({
    where: feedWhere(config),
    orderBy: [{ arrivalDate: 'asc' }, { bookingRef: 'asc' }],
    select: {
      bookingRef: true, isNumber: true, cntlNumber: true, agent: true, status: true, arrivalDate: true,
      paxAdults: true, paxChildren: true, paxInfants: true, contactPhone: true, contactWhatsapp: true,
      passengers: { select: { name: true, contact: true }, orderBy: [{ isLead: 'desc' }, { id: 'asc' }], take: 1 },
      statusEvents: { where: { note: { startsWith: B2C_IMPORT_NOTE_PREFIX } }, select: { note: true }, take: 1 },
      tourAgenda: {
        select: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            select: {
              id: true, date: true, location: true, fromPoint: true, toPoint: true, details: true,
              mealPlan: true, serviceType: true, sortOrder: true, isLeisure: true, isHotelOnly: true,
              meetingTime: true,
              assignment: { select: { driverName: true, driverPhone: true } },
            },
          },
        },
      },
    },
  })

  const ids = await agentIds(bookings.map(b => b.bookingRef))
  const rows: FeedRow[] = []
  let withoutAgenda = 0

  for (const b of bookings) {
    const items = b.tourAgenda?.items ?? []
    if (!items.length) { withoutAgenda++; continue }
    const b2c = isB2cOrigin({ agent: b.agent, statusNotes: b.statusEvents.map(e => e.note) })
    const shownRef = /^(VN|IS|SG|MY)\d/i.test(b.isNumber ?? '') ? b.isNumber!.trim().toUpperCase() : b.bookingRef
    const children: number | string = b.paxInfants > 0
      ? `${b.paxChildren} + ${b.paxInfants} Infant${b.paxInfants === 1 ? '' : 's'}`
      : b.paxChildren
    const cancelled = b.status === 'CANCELLED'
    const guestContact = clean(b.passengers[0]?.contact) || clean(b.contactPhone) || clean(b.contactWhatsapp)
    const locked = isAssignLocked(b.status)
    // Items come back by (date, sortOrder); the chart's own order within a day is sortOrder.
    for (const it of items) {
      const leisure = it.isHotelOnly !== true && resolveIsLeisure({ ...it, isLeisure: it.isLeisure })
      const status = cancelled ? STATUS.cancelled
        : b.status === 'PENDING_CANCELLATION' ? STATUS.cancelRequested
        : it.isHotelOnly === true ? STATUS.hotelOnly
        : leisure ? STATUS.leisure
        : STATUS.active
      const driverLock = locked ? 'The booking is cancelled or being cancelled'
        : it.isHotelOnly === true ? 'Hotel-only movement'
        : leisure ? 'Leisure day'
        : null
      rows.push({
        lineId: it.id,
        bookingRef: b.bookingRef,
        arrival: ymd(b.arrivalDate),
        channel: b2c ? 'B2C' : 'B2B',
        ref: shownRef,
        cntl: clean(b.cntlNumber),
        date: ymd(it.date),
        guest: clean(b.passengers[0]?.name),
        guestContact,
        meetingTime: clean(it.meetingTime),
        driverName: clean(it.assignment?.driverName),
        driverPhone: clean(it.assignment?.driverPhone),
        driverLock,
        adults: b.paxAdults,
        children,
        location: clean(it.location),
        from: clean(it.fromPoint),
        to: clean(it.toPoint),
        description: clean(it.details),
        meal: it.mealPlan ? mealPlanFullName(it.mealPlan) : '',
        serviceType: serviceTypeLabel(it.serviceType),
        agentId: ids.get(b.bookingRef) ?? '',
        agentName: clean(b.agent),
        status,
        noInsert: cancelled,
        sortOrder: it.sortOrder,
      })
    }
  }
  return { rows, bookings: bookings.length, bookingsWithoutAgenda: withoutAgenda }
}

/** Values seen in OPS for the dropdown lists (locations beyond the built-in list, typed service types…). */
export async function usedListValues(config: Pick<FeedConfig, 'startDate' | 'countries'>): Promise<{ locations: string[]; serviceTypes: string[]; mealPlans: string[] }> {
  const items = await prisma.agendaItem.findMany({
    where: { agenda: { booking: feedWhere(config) } },
    select: { location: true, serviceType: true, mealPlan: true },
    distinct: ['location', 'serviceType', 'mealPlan'],
    take: 5000,
  })
  const uniq = (xs: string[]) => Array.from(new Set(xs.map(x => x.trim()).filter(x => x && x.length <= 120))).sort((a, b) => a.localeCompare(b))
  return {
    locations: uniq(items.map(i => i.location ?? '')),
    serviceTypes: uniq(items.map(i => serviceTypeLabel(i.serviceType))),
    mealPlans: uniq(items.map(i => (i.mealPlan ? mealPlanFullName(i.mealPlan) : ''))),
  }
}
