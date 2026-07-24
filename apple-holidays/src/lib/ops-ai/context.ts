import { prisma } from '@/lib/prisma'
import { canSeeAllCountries } from '@/lib/rbac'
import { isInCountryScope, userCountryScope } from '@/lib/country-detection'
import type { UserRole } from '@prisma/client'

/**
 * Everything the agent knows about who is asking and what they are looking at.
 * Built fresh on every request from the session — never from the client.
 */
export interface OpsActor {
  userId:    string
  name:      string
  role:      UserRole
  country?:  string
  countries?: string[]
}

export interface PageContext {
  pathname?:   string
  bookingRef?: string
}

/** Booking refs look like IS23492 / VN40123 / SG1234 / MY1234. */
const REF_IN_PATH = /\/(?:bookings|driver-log|portal|trip)\/([A-Z]{2}[A-Z0-9-]{2,})/i

export function bookingRefFromPath(pathname: string | undefined | null): string | undefined {
  if (!pathname) return undefined
  const m = pathname.match(REF_IN_PATH)
  return m ? m[1].toUpperCase() : undefined
}

/**
 * Prisma `where` fragment restricting a query to the bookings this actor may
 * see. Returns `null` when the actor sees everything.
 */
export function countryWhere(actor: OpsActor): Record<string, unknown> | null {
  if (canSeeAllCountries(actor.role, actor.country as never)) return null
  const scope = userCountryScope(actor.country, actor.countries)
  return scope ? { operationCountry: { in: scope } } : null
}

export function actorMaySee(actor: OpsActor, operationCountry: string | null | undefined): boolean {
  if (canSeeAllCountries(actor.role, actor.country as never)) return true
  if (!actor.country || actor.country === 'ALL') return true
  return isInCountryScope(operationCountry, actor.country)
}

function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function clip(s: string | null | undefined, n = 220): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/**
 * A compact, ID-carrying snapshot of one booking. This is what makes the agent
 * able to say "edit agenda item X" — it has seen the real primary keys.
 */
export async function loadBookingSnapshot(bookingRef: string, actor: OpsActor) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    include: {
      passengers:     { orderBy: { isLead: 'desc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      flights:        { orderBy: { date: 'asc' } },
      tourAgenda: {
        include: { items: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }], include: { assignment: true } } },
      },
    },
  })
  if (!booking) return null
  if (!actorMaySee(actor, booking.operationCountry)) return null

  const arrival = booking.arrivalDate
  const dayNoOf = (d: Date) =>
    Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
                Date.UTC(arrival.getUTCFullYear(), arrival.getUTCMonth(), arrival.getUTCDate())) / 86400000) + 1

  return {
    bookingRef:       booking.bookingRef,
    status:           booking.status,
    operationCountry: booking.operationCountry,
    isNumber:         booking.isNumber,
    agentBookingId:   booking.agentBookingId,
    cntlNumber:       booking.cntlNumber,
    agent:            booking.agent,
    fileHandler:      booking.fileHandler,
    dealName:         booking.dealName,
    tourDestination:  booking.tourDestination,
    arrivalDate:      ymd(booking.arrivalDate),
    departureDate:    ymd(booking.departureDate),
    tourDays:         dayNoOf(booking.departureDate),
    pax: { adults: booking.paxAdults, children: booking.paxChildren, infants: booking.paxInfants },
    quotedTotal:      booking.quotedTotal ? Number(booking.quotedTotal) : null,
    currency:         booking.currency,
    languagePreference: booking.languagePreference,
    specialOccasions: clip(booking.specialOccasions),
    clientRequest:    clip(booking.clientRequest),
    contact: {
      agentEmail:   booking.agentEmail,   agentPhone:   booking.agentPhone,   agentWhatsapp:   booking.agentWhatsapp,
      contactEmail: booking.contactEmail, contactPhone: booking.contactPhone, contactWhatsapp: booking.contactWhatsapp,
    },
    passengers: booking.passengers.map(p => ({
      id: p.id, name: p.name, type: p.type, isLead: p.isLead, age: p.age, nationality: p.nationality,
    })),
    accommodations: booking.accommodations.map(a => ({
      accommodationId: a.id, city: a.city, hotel: a.hotel,
      checkIn: ymd(a.checkIn), checkOut: ymd(a.checkOut),
      nights: a.nights, roomType: a.roomType, mealType: a.mealType,
    })),
    flights: booking.flights.map(f => ({ id: f.id, date: ymd(f.date) })),
    agenda: (booking.tourAgenda?.items ?? []).map(i => ({
      agendaItemId: i.id,
      dayNumber:    dayNoOf(i.date),
      date:         ymd(i.date),
      location:     clip(i.location, 120),
      fromPoint:    i.fromPoint,
      toPoint:      i.toPoint,
      timeFrom:     i.timeFrom,
      timeTo:       i.timeTo,
      mealPlan:     i.mealPlan,
      serviceType:  i.serviceType,
      details:      clip(i.details, 160),
      driver:       i.assignment?.driverName ?? null,
      vehicle:      i.assignment?.vehiclePlate ?? null,
    })),
    hasAgenda: Boolean(booking.tourAgenda),
  }
}

export type BookingSnapshot = NonNullable<Awaited<ReturnType<typeof loadBookingSnapshot>>>
