/**
 * Turns one booking save (PUT /api/bookings/[ref]) into readable log rows,
 * one per section touched, with from → to values. Read-only apart from the
 * log rows themselves; never throws.
 */
import { prisma } from '@/lib/prisma'
import { diffFields, logBookingEvent, type LogChange, type LogSection } from '@/lib/booking-logs'

const fmtDate = (v: unknown) => {
  if (!v) return ''
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10)
}

export async function snapshotChildren(bookingId: string) {
  const [passengers, flights, accommodations] = await Promise.all([
    prisma.passenger.findMany({ where: { bookingId }, select: { id: true, name: true, type: true, age: true, passport: true, nationality: true, contact: true, isLead: true } }),
    prisma.flight.findMany({ where: { bookingId }, select: { id: true, flightNo: true, date: true, fromApt: true, depTime: true, toApt: true, arrTime: true, airline: true, notes: true } }),
    prisma.accommodation.findMany({ where: { bookingId }, select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, roomType: true, address: true, contact: true, ownArrangement: true } }),
  ])
  return { passengers, flights, accommodations }
}

type Children = Awaited<ReturnType<typeof snapshotChildren>>
type Row = Record<string, unknown>

const CONTACT_FIELDS: Record<string, string> = {
  contactEmail: 'Guest email', contactPhone: 'Guest phone', contactWhatsapp: 'Guest WhatsApp', contactAddress: 'Home address',
  agentEmail: 'Agent email', agentPhone: 'Agent phone', agentWhatsapp: 'Agent WhatsApp', agentAddress: 'Agent address',
}
const OVERVIEW_FIELDS: Record<string, string> = {
  agentBookingId: 'Agent booking ID', cntlNumber: 'CNTL no.', isNumber: 'IS number', agent: 'Agent', fileHandler: 'File handler',
  arrivalDate: 'Arrival', departureDate: 'Departure', paxAdults: 'Adults', paxChildren: 'Children', paxInfants: 'Infants',
  quotedTotal: 'Quoted total', currency: 'Currency', operationCountry: 'Country', amendmentNote: 'Amendment note',
  terms: 'Terms', exclusions: 'Exclusions', policyNotes: 'Policy notes', valueAddedServices: 'Value-added services',
  packageIncludes: 'Package includes', packageExcludes: 'Package excludes', importantNotes: 'Important notes',
  tips: 'Tips', otherNote: 'Other note', clientRequest: 'Client request',
}
const PAX_FIELDS: Record<string, string> = { name: 'Name', type: 'Type', age: 'Age', passport: 'Passport', nationality: 'Nationality', contact: 'Contact', isLead: 'Lead' }
const FLIGHT_FIELDS: Record<string, string> = { flightNo: 'Flight no.', date: 'Date', fromApt: 'From', depTime: 'Departs', toApt: 'To', arrTime: 'Arrives', airline: 'Airline', notes: 'Notes' }
const HOTEL_FIELDS: Record<string, string> = { hotel: 'Hotel', roomType: 'Room type', address: 'Address', contact: 'Contact', ownArrangement: 'Own arrangement' }

const flightLabel = (f: Row) => [f.flightNo, f.fromApt && f.toApt ? `${f.fromApt}→${f.toApt}` : null, fmtDate(f.date)].filter(Boolean).join(' ')
const hotelLabel = (a: Row) => [a.hotel, a.city ? `(${a.city})` : null, a.checkIn ? fmtDate(a.checkIn) : null].filter(Boolean).join(' ')

export async function logBookingSave(input: {
  bookingRef: string
  before: Row
  beforeChildren: Children | null
  body: Row
  saved: Row
  actor: { id: string; name: string | null }
}): Promise<void> {
  try {
    const { bookingRef, before, body, saved, actor } = input
    const kids = input.beforeChildren
    const events: { section: LogSection; action: string; summary: string; changes?: LogChange[] }[] = []

    // Contact + overview: compare against what was actually stored.
    const contact = diffFields(before, pick(saved, Object.keys(CONTACT_FIELDS), body), CONTACT_FIELDS)
    if (contact.length) events.push({ section: 'contact', action: 'updated', summary: `${contact.map(c => c.field).join(', ')} changed`, changes: contact })

    const overview = diffFields(normDates(before), normDates(pick(saved, Object.keys(OVERVIEW_FIELDS), body)), OVERVIEW_FIELDS)
    if (overview.length) events.push({ section: 'overview', action: 'updated', summary: `${overview.slice(0, 3).map(c => c.field).join(', ')}${overview.length > 3 ? ` +${overview.length - 3}` : ''} changed`, changes: overview })

    // Passengers
    const paxById = new Map((kids?.passengers ?? []).map(p => [p.id, p as Row]))
    for (const id of (body.passengerDeletes as string[] | undefined) ?? []) {
      const p = paxById.get(id)
      events.push({ section: 'passengers', action: 'deleted', summary: `Passenger removed: ${p?.name ?? id}` })
    }
    for (const u of (body.passengerUpdates as Row[] | undefined) ?? []) {
      const p = paxById.get(u.id as string)
      if (!p) continue
      const ch = diffFields(p, u, PAX_FIELDS)
      if (ch.length) events.push({ section: 'passengers', action: 'updated', summary: `Passenger edited: ${p.name}`, changes: ch })
    }
    for (const a of (body.passengerAdds as Row[] | undefined) ?? []) {
      events.push({ section: 'passengers', action: 'created', summary: `Passenger added: ${a.name || 'unnamed'}${a.isLead ? ' (lead)' : ''}` })
    }
    if (Array.isArray(body.passengers)) {
      events.push({ section: 'passengers', action: 'updated', summary: `Passenger list replaced (${(body.passengers as Row[]).length} passengers, was ${kids?.passengers.length ?? '?'})` })
    }

    // Flights
    const flById = new Map((kids?.flights ?? []).map(f => [f.id, f as Row]))
    for (const id of (body.flightDeletes as string[] | undefined) ?? []) {
      const f = flById.get(id)
      events.push({ section: 'flights', action: 'deleted', summary: `Flight removed: ${f ? flightLabel(f) : id}` })
    }
    for (const u of (body.flightUpdates as Row[] | undefined) ?? []) {
      const f = flById.get(u.id as string)
      if (!f) continue
      const ch = diffFields({ ...f, date: fmtDate(f.date) }, { ...u, ...(u.date !== undefined ? { date: fmtDate(u.date) } : {}) }, FLIGHT_FIELDS)
      if (ch.length) events.push({ section: 'flights', action: 'updated', summary: `Flight edited: ${flightLabel(f)}`, changes: ch })
    }
    for (const a of (body.flightAdds as Row[] | undefined) ?? []) {
      events.push({ section: 'flights', action: 'created', summary: `Flight added: ${flightLabel(a)}` })
    }
    if (Array.isArray(body.flights)) {
      events.push({ section: 'flights', action: 'updated', summary: `Flight list replaced (${(body.flights as Row[]).length} flights, was ${kids?.flights.length ?? '?'})` })
    }

    // Accommodation
    const acById = new Map((kids?.accommodations ?? []).map(a => [a.id, a as Row]))
    for (const id of (body.accommodationDeletes as string[] | undefined) ?? []) {
      const a = acById.get(id)
      events.push({ section: 'accommodation', action: 'deleted', summary: `Hotel removed: ${a ? hotelLabel(a) : id}` })
    }
    for (const u of (body.accommodationUpdates as Row[] | undefined) ?? []) {
      const a = acById.get(u.id as string)
      if (!a) continue
      const ch = diffFields(a, u, HOTEL_FIELDS)
      if (ch.length) events.push({ section: 'accommodation', action: 'updated', summary: `Hotel edited: ${hotelLabel(a)}`, changes: ch })
    }
    for (const a of (body.accommodationAdds as Row[] | undefined) ?? []) {
      events.push({ section: 'accommodation', action: 'created', summary: `Hotel added: ${hotelLabel(a)}` })
    }
    if (Array.isArray(body.accommodations)) {
      events.push({ section: 'accommodation', action: 'updated', summary: `Hotel list replaced (${(body.accommodations as Row[]).length} hotels, was ${kids?.accommodations.length ?? '?'})` })
    }

    for (const e of events) await logBookingEvent({ bookingRef, ...e, actor, source: 'user' })
  } catch (err) {
    console.warn('[booking-logs] save diff failed (non-fatal):', err instanceof Error ? err.message : err)
  }
}

/** The saved values for keys the request sent. */
function pick(saved: Row, keys: string[], body: Row): Row {
  const out: Row = {}
  for (const k of keys) if (body[k] !== undefined) out[k] = saved[k]
  return out
}

function normDates(r: Row): Row {
  const out = { ...r }
  for (const k of ['arrivalDate', 'departureDate']) if (k in out && out[k]) out[k] = fmtDate(out[k])
  return out
}
