/**
 * The trip panel beside a WhatsApp chat — the shape it reads, and the pure code
 * that builds it from a booking row. The client imports types only from here.
 *
 * Nothing financial belongs in this shape: `driverRate`, ticket costs and the
 * quoted total are never selected by the route, and the panel sits on a screen
 * staff keep open all day. The route is /api/whatsapp/booking-context.
 */
import { detectLeisureDay } from '@/lib/leisure-day'
import { NOTE_FIELD_LABELS, PACKAGE_NOTE_FIELDS } from '@/lib/booking-field-edits'
import { customerEmailForDisplay } from '@/lib/booking-source'
import { serviceTypeShortLabel } from '@/lib/service-types'
import { range12h, to12h } from '@/lib/clock-time'
import type { BookingStatus, OperationCountry } from '@prisma/client'

export type ChatRole = 'GUEST' | 'AGENT' | 'FILED'

/** One booking this number belongs to — the panel's booking switcher. */
export interface LinkedBooking {
  bookingRef: string
  isNumber: string | null
  leadName: string | null
  status: BookingStatus
  operationCountry: OperationCountry | null
  arrivalDate: string
  departureDate: string
  chatRole: ChatRole
}

export interface TripPassenger {
  id: string; name: string; type: string; age: number | null; isLead: boolean
  nationality: string | null; contact: string | null; mealPreference: string | null
}
export interface TripFlight {
  id: string; flightNo: string; airline: string | null; date: string
  fromApt: string; toApt: string; depTime: string; arrTime: string; notes: string | null
}
export interface TripStay {
  id: string; city: string; hotel: string; checkIn: string; checkOut: string; nights: number
  roomType: string | null; mealType: string | null; address: string | null; contact: string | null
  ownArrangement: boolean; current: boolean
}
export interface TripItineraryDay {
  id: string; dayNo: number; date: string; title: string
  description: string | null; inclusions: string | null; exclusions: string | null
}
export interface TripMovement {
  id: string; time: string; from: string | null; to: string | null; location: string
  details: string | null; meal: string | null; service: string
  leisure: boolean; needsCover: boolean
  driver: { name: string | null; phone: string | null; vehicle: string | null } | null
  guide: string | null; vendor: string | null
}
export interface TripAgendaDay { date: string; items: TripMovement[] }

export type TripPersonKind = 'DRIVER' | 'GUIDE' | 'VENDOR'
export interface TripPerson {
  key: string; kind: TripPersonKind; name: string; phone: string | null
  company: string | null; vehicles: string[]; dates: string[]; onToday: boolean
}
export interface TripTicket {
  id: string; label: string; qty: number; supplier: string | null; reference: string | null
  status: string; fileUrl: string | null; fileName: string | null; fileType: string | null
  date: string | null; location: string | null
}
export interface TripNote { key: string; label: string; text: string }

export interface TripContext {
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  dealName: string | null
  status: BookingStatus
  operationCountry: OperationCountry | null
  destination: string | null
  leadName: string | null
  agent: string | null
  fileHandler: string | null
  language: string | null
  specialOccasions: string | null
  chauffeurContact: string | null
  hotelOnly: boolean
  arrivalDate: string
  departureDate: string
  /** Today where the trip is happening, so "Today" is right for the guest, not the desk. */
  today: string
  phase: 'upcoming' | 'on-tour' | 'ended'
  daysToGo: number
  tripDay: number
  tripDays: number
  nights: number
  pax: { adults: number; children: number; infants: number }
  guestContact: { email: string | null; phone: string | null; whatsapp: string | null }
  agentContact: { email: string | null; phone: string | null; whatsapp: string | null }
  passengers: TripPassenger[]
  flights: TripFlight[]
  stays: TripStay[]
  itinerary: TripItineraryDay[]
  agenda: TripAgendaDay[]
  people: TripPerson[]
  tickets: TripTicket[]
  notes: TripNote[]
  coverage: { covered: number; total: number }
  portal: { url: string; welcomeSentAt: string | null; reminderSentAt: string | null }
  /** Mirrors the role checks on the routes these features call. */
  can: { sendPortal: boolean; viewCalls: boolean }
}

export interface TripContextResponse {
  linked: LinkedBooking[]
  trip: TripContext | null
  /** A booking exists for this chat but sits outside the viewer's country. */
  restricted: boolean
}

/** What the route selects. Keep costs and rates out of this. */
export interface TripRow {
  bookingRef: string; isNumber: string | null; cntlNumber: string | null; dealName: string | null
  status: BookingStatus; operationCountry: OperationCountry | null; tourDestination: string | null
  agent: string | null; fileHandler: string | null; languagePreference: string | null
  specialOccasions: string | null; chauffeurContact: string | null; hotelOnly: boolean
  arrivalDate: Date; departureDate: Date
  paxAdults: number; paxChildren: number; paxInfants: number
  contactEmail: string | null; contactPhone: string | null; contactWhatsapp: string | null
  agentEmail: string | null; agentPhone: string | null; agentWhatsapp: string | null
  valueAddedServices: string | null; packageIncludes: string | null; packageExcludes: string | null
  terms: string | null; exclusions: string | null; policyNotes: string | null
  importantNotes: string | null; tips: string | null; otherNote: string | null; clientRequest: string | null
  passengers: {
    id: string; name: string; type: string; age: number | null; isLead: boolean
    nationality: string | null; contact: string | null; mealPreference: string | null
  }[]
  flights: {
    id: string; flightNo: string; airline: string | null; date: Date
    fromApt: string; toApt: string; depTime: string; arrTime: string; notes: string | null
  }[]
  accommodations: {
    id: string; city: string; hotel: string; checkIn: Date; checkOut: Date; nights: number
    roomType: string | null; mealType: string | null; address: string | null; contact: string | null
    ownArrangement: boolean
  }[]
  itineraryItems: {
    id: string; dayNo: number; date: Date; title: string
    description: string | null; inclusions: string | null; exclusions: string | null
  }[]
  tourAgenda: {
    items: {
      id: string; date: Date; location: string; fromPoint: string | null; toPoint: string | null
      details: string | null; mealPlan: string | null; meetingTime: string | null; serviceType: string
      timeFrom: string | null; timeTo: string | null; isLeisure: boolean | null; isHotelOnly: boolean | null
      assignment: {
        driverName: string | null; driverPhone: string | null; vehicleType: string | null
        vehiclePlate: string | null; vendorName: string | null; guideName: string | null
        guidePhone: string | null; tourVendorName: string | null; tourVendorPhone: string | null
      } | null
    }[]
  } | null
  tickets: {
    id: string; type: string; category: string | null; qty: number; supplier: string | null
    reference: string | null; status: string; fileUrl: string | null; fileName: string | null
    fileType: string | null; agendaItem: { date: Date; location: string } | null
  }[]
}

export const isoDay = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

const dayNumber = (day: string) => Math.round(new Date(`${day}T00:00:00.000Z`).getTime() / 86_400_000)

const prettify = (s: string) =>
  s.replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())

function movementTime(i: NonNullable<TripRow['tourAgenda']>['items'][number]): string {
  if (i.timeFrom && i.timeTo) return range12h(i.timeFrom, i.timeTo)
  return to12h(i.timeFrom || i.meetingTime || '')
}

/** One card per person across the trip: a driver on six movements is one contact. */
function buildPeople(row: TripRow, today: string): TripPerson[] {
  const byKey = new Map<string, TripPerson>()
  const add = (
    kind: TripPersonKind, name: string | null | undefined, phone: string | null | undefined,
    date: string, extra: { company?: string | null; vehicle?: string | null } = {},
  ) => {
    const label = name?.trim()
    const number = phone?.trim() || null
    if (!label && !number) return
    const key = `${kind}:${number?.replace(/\D/g, '') || label!.toLowerCase()}`
    let person = byKey.get(key)
    if (!person) {
      person = { key, kind, name: label || number!, phone: number, company: null, vehicles: [], dates: [], onToday: false }
      byKey.set(key, person)
    }
    if (extra.company && !person.company) person.company = extra.company
    if (extra.vehicle && !person.vehicles.includes(extra.vehicle)) person.vehicles.push(extra.vehicle)
    if (!person.dates.includes(date)) person.dates.push(date)
    if (date === today) person.onToday = true
  }

  for (const item of row.tourAgenda?.items ?? []) {
    const a = item.assignment
    if (!a) continue
    const date = isoDay(item.date)
    const vehicle = [a.vehicleType, a.vehiclePlate].filter(Boolean).join(' · ') || null
    add('DRIVER', a.driverName, a.driverPhone, date, { company: a.vendorName, vehicle })
    add('GUIDE', a.guideName, a.guidePhone, date)
    add('VENDOR', a.tourVendorName, a.tourVendorPhone, date)
  }

  const rank: Record<TripPersonKind, number> = { DRIVER: 0, GUIDE: 1, VENDOR: 2 }
  return Array.from(byKey.values()).sort((x, y) =>
    Number(y.onToday) - Number(x.onToday) || rank[x.kind] - rank[y.kind] || x.dates[0].localeCompare(y.dates[0]))
}

export function buildTripContext(
  row: TripRow,
  input: {
    today: string
    portal: TripContext['portal']
    can: TripContext['can']
  },
): TripContext {
  const { today } = input
  const arrival = isoDay(row.arrivalDate)
  const departure = isoDay(row.departureDate)
  const tripDays = dayNumber(departure) - dayNumber(arrival) + 1
  const phase = today < arrival ? 'upcoming' : today > departure ? 'ended' : 'on-tour'

  const agendaDays = new Map<string, TripMovement[]>()
  let covered = 0
  let total = 0
  for (const i of row.tourAgenda?.items ?? []) {
    const a = i.assignment
    const leisure = i.isLeisure ?? detectLeisureDay(i)
    const needsCover = !leisure && !i.isHotelOnly
    const hasCover = Boolean(a?.driverName || a?.vendorName || a?.tourVendorName)
    if (needsCover) { total += 1; if (hasCover) covered += 1 }
    const day = isoDay(i.date)
    const list = agendaDays.get(day) ?? []
    list.push({
      id: i.id,
      time: movementTime(i),
      from: i.fromPoint,
      to: i.toPoint,
      location: i.location,
      details: i.details,
      meal: i.mealPlan,
      service: serviceTypeShortLabel(i.serviceType),
      leisure,
      needsCover: needsCover && !hasCover,
      driver: a && (a.driverName || a.driverPhone)
        ? {
            name: a.driverName,
            phone: a.driverPhone,
            vehicle: [a.vehicleType, a.vehiclePlate].filter(Boolean).join(' · ') || null,
          }
        : null,
      guide: a?.guideName ?? null,
      vendor: a?.tourVendorName ?? a?.vendorName ?? null,
    })
    agendaDays.set(day, list)
  }

  const lead = row.passengers.find(p => p.isLead) ?? row.passengers[0]

  return {
    bookingRef: row.bookingRef,
    isNumber: row.isNumber,
    cntlNumber: row.cntlNumber,
    dealName: row.dealName,
    status: row.status,
    operationCountry: row.operationCountry,
    destination: row.tourDestination,
    leadName: lead?.name ?? null,
    agent: row.agent,
    fileHandler: row.fileHandler,
    language: row.languagePreference,
    specialOccasions: row.specialOccasions,
    chauffeurContact: row.chauffeurContact,
    hotelOnly: row.hotelOnly,
    arrivalDate: arrival,
    departureDate: departure,
    today,
    phase,
    daysToGo: phase === 'upcoming' ? dayNumber(arrival) - dayNumber(today) : 0,
    tripDay: phase === 'on-tour' ? dayNumber(today) - dayNumber(arrival) + 1 : 0,
    tripDays,
    nights: Math.max(0, tripDays - 1),
    pax: { adults: row.paxAdults, children: row.paxChildren, infants: row.paxInfants },
    guestContact: {
      email: customerEmailForDisplay(row.agent, row.contactEmail),
      phone: row.contactPhone,
      whatsapp: row.contactWhatsapp,
    },
    agentContact: { email: row.agentEmail, phone: row.agentPhone, whatsapp: row.agentWhatsapp },
    passengers: [...row.passengers].sort((a, b) => Number(b.isLead) - Number(a.isLead)),
    flights: row.flights.map(f => ({ ...f, date: isoDay(f.date) })),
    stays: row.accommodations.map(s => {
      const checkIn = isoDay(s.checkIn)
      const checkOut = isoDay(s.checkOut)
      return { ...s, checkIn, checkOut, current: today >= checkIn && today < checkOut }
    }),
    itinerary: row.itineraryItems.map(d => ({ ...d, date: isoDay(d.date) })),
    agenda: Array.from(agendaDays, ([date, items]) => ({ date, items })),
    people: buildPeople(row, today),
    tickets: row.tickets.map(t => ({
      id: t.id,
      label: t.category ? prettify(t.category) : prettify(t.type),
      qty: t.qty,
      supplier: t.supplier,
      reference: t.reference,
      status: t.status,
      fileUrl: t.fileUrl,
      fileName: t.fileName,
      fileType: t.fileType,
      date: t.agendaItem ? isoDay(t.agendaItem.date) : null,
      location: t.agendaItem?.location ?? null,
    })),
    notes: PACKAGE_NOTE_FIELDS.flatMap(key => {
      const text = row[key]?.trim()
      return text ? [{ key, label: NOTE_FIELD_LABELS[key], text }] : []
    }),
    coverage: { covered, total },
    portal: input.portal,
    can: input.can,
  }
}
