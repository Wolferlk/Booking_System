/**
 * Every operation the File Handler Portal can perform, as callable functions.
 *
 * The portal's own routes under `/api/filehandler/*` remain the UI's entry
 * point; this module is the same behaviour expressed once for the public API so
 * an external application gets identical semantics — identical validation,
 * identical `file_handler_logs` audit rows, identical booking stamping.
 *
 * Everything here takes the acting `FhCaller` so the audit trail always names a
 * real File Handler, even when the request came from a machine client.
 */

import { prisma } from '@/lib/prisma'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { sanitizeCancellationFees, totalCancellationFee } from '@/lib/cancellation-fees'
import { sendCancellationApprovalEmail } from '@/lib/send-cancellation-email'
import { FhApiError } from './fh-http'
import type { FhCaller } from './fh-api-auth'
import { Prisma } from '@prisma/client'
import type { BookingStatus, OperationCountry } from '@prisma/client'

// ── Shape returned to callers ────────────────────────────────────────────────

/**
 * The booking projection the public API returns. A superset of what the portal
 * screen needs: contacts and notes (editable), flights, hotels, passengers, and
 * the cancellation trail.
 */
export const FH_API_BOOKING_SELECT = Prisma.validator<Prisma.BookingSelect>()({
  id: true,
  bookingRef: true,
  isNumber: true,
  cntlNumber: true,
  agent: true,
  agentBookingId: true,
  fileHandler: true,
  status: true,
  version: true,
  operationCountry: true,
  arrivalDate: true,
  departureDate: true,
  paxAdults: true,
  paxChildren: true,
  paxInfants: true,
  quotedTotal: true,
  currency: true,
  agentEmail: true,
  agentPhone: true,
  agentWhatsapp: true,
  contactEmail: true,
  contactPhone: true,
  contactWhatsapp: true,
  importantNotes: true,
  cancelRequestedAt: true,
  cancelPrevStatus: true,
  cancelledAt: true,
  cancelledByName: true,
  cancelledByEmail: true,
  cancellationReason: true,
  cancellationFees: true,
  cancellationFeeTotal: true,
  createdAt: true,
  updatedAt: true,
  passengers: {
    orderBy: [{ isLead: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, type: true, age: true, isLead: true, nationality: true, passport: true },
  },
  flights: {
    orderBy: { date: 'asc' },
    select: {
      id: true, flightNo: true, date: true, fromApt: true, depTime: true,
      toApt: true, arrTime: true, airline: true, notes: true,
    },
  },
  accommodations: {
    orderBy: { checkIn: 'asc' },
    select: {
      id: true, city: true, hotel: true, checkIn: true, checkOut: true,
      address: true, contact: true, nights: true, roomType: true, mealType: true,
    },
  },
})

export type FhBooking = Prisma.BookingGetPayload<{ select: typeof FH_API_BOOKING_SELECT }>

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

export function serializeFlight(f: FhBooking['flights'][number]) {
  return {
    id: f.id,
    flight_no: f.flightNo,
    date: day(f.date),
    from_airport: f.fromApt,
    dep_time: f.depTime,
    to_airport: f.toApt,
    arr_time: f.arrTime,
    airline: f.airline,
    notes: f.notes,
  }
}

export function serializeAccommodation(a: FhBooking['accommodations'][number]) {
  return {
    id: a.id,
    city: a.city,
    hotel: a.hotel,
    check_in: day(a.checkIn),
    check_out: day(a.checkOut),
    nights: a.nights,
    address: a.address,
    contact: a.contact,
    room_type: a.roomType,
    meal_type: a.mealType,
  }
}

/** Full booking as JSON, snake_case — the same convention as the AS public API. */
export function serializeBooking(b: FhBooking) {
  const lead = b.passengers.find((p) => p.isLead) ?? b.passengers[0] ?? null
  return {
    booking_ref: b.bookingRef,
    is_number: b.isNumber,
    cntl_number: b.cntlNumber,
    quotation_no: b.cntlNumber,
    status: b.status,
    version: b.version,
    agent: b.agent,
    agent_booking_id: b.agentBookingId,
    file_handler: b.fileHandler,
    operation_country: b.operationCountry,
    arrival_date: day(b.arrivalDate),
    departure_date: day(b.departureDate),
    pax: { adults: b.paxAdults, children: b.paxChildren, infants: b.paxInfants },
    quoted_total: b.quotedTotal ? Number(b.quotedTotal) : null,
    currency: b.currency,
    lead_passenger: lead?.name ?? null,
    contacts: {
      agent_email: b.agentEmail,
      agent_phone: b.agentPhone,
      agent_whatsapp: b.agentWhatsapp,
      contact_email: b.contactEmail,
      contact_phone: b.contactPhone,
      contact_whatsapp: b.contactWhatsapp,
    },
    important_notes: b.importantNotes,
    passengers: b.passengers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      age: p.age,
      is_lead: p.isLead,
      nationality: p.nationality,
      passport: p.passport,
    })),
    flights: b.flights.map(serializeFlight),
    accommodations: b.accommodations.map(serializeAccommodation),
    cancellation: {
      requested_at: iso(b.cancelRequestedAt),
      previous_status: b.cancelPrevStatus,
      cancelled_at: iso(b.cancelledAt),
      requested_by: b.cancelledByName,
      requested_by_email: b.cancelledByEmail,
      reason: b.cancellationReason,
      fees: (b.cancellationFees as unknown as { note: string; amount: number }[] | null) ?? [],
      fee_total: b.cancellationFeeTotal ? Number(b.cancellationFeeTotal) : null,
      pending_approval: b.status === 'PENDING_CANCELLATION',
    },
    created_at: iso(b.createdAt),
    updated_at: iso(b.updatedAt),
  }
}

// ── Booking lookup ───────────────────────────────────────────────────────────

/**
 * Resolve a booking from anything the caller might hold: booking ref, IS number
 * or CNTL number. Space-insensitive — "IS 40475" and "IS40475" are the same
 * booking, exactly as in the portal search box.
 */
export async function resolveBooking(ref: string): Promise<FhBooking | null> {
  const raw = ref.trim()
  if (!raw) return null
  const terms = Array.from(new Set([raw, normalizeIsNumber(raw)].filter(Boolean)))

  const exact = await prisma.booking.findFirst({
    where: {
      OR: terms.flatMap((t) => [{ bookingRef: t }, { isNumber: t }, { cntlNumber: t }]),
    },
    orderBy: { createdAt: 'desc' },
    select: FH_API_BOOKING_SELECT,
  })
  return exact
}

export async function requireBooking(ref: string): Promise<FhBooking> {
  const booking = await resolveBooking(ref)
  if (!booking) {
    throw new FhApiError(
      `No booking matches "${ref}" — try /bookings/import to pull it from AppleSystem`,
      404,
      'BOOKING_NOT_FOUND',
    )
  }
  return booking
}

/** Re-read a booking after a write so the caller always gets the current state. */
export async function reloadBooking(id: string): Promise<FhBooking> {
  const booking = await prisma.booking.findUnique({ where: { id }, select: FH_API_BOOKING_SELECT })
  if (!booking) throw new FhApiError('Booking disappeared while updating it', 500, 'INTERNAL_ERROR')
  return booking
}

/** Fuzzy search — the portal's "type a ref and hit enter" behaviour. */
export async function searchBookings(q: string, limit = 10): Promise<FhBooking[]> {
  const raw = q.trim()
  if (!raw) throw new FhApiError('Enter a booking ref, IS number, or CNTL number', 422, 'QUERY_REQUIRED')
  const terms = Array.from(new Set([raw, normalizeIsNumber(raw)].filter(Boolean)))

  return prisma.booking.findMany({
    where: {
      OR: terms.flatMap((t) => [
        { bookingRef: { equals: t } },
        { isNumber: { equals: t } },
        { cntlNumber: { equals: t } },
        { bookingRef: { contains: t } },
        { isNumber: { contains: t } },
        { cntlNumber: { contains: t } },
      ]),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 50),
    select: FH_API_BOOKING_SELECT,
  })
}

// ── Audit trail ──────────────────────────────────────────────────────────────

export type FhAction =
  | 'LOGIN'
  | 'FLIGHT_ADDED'
  | 'FLIGHT_UPDATED'
  | 'HOTEL_UPDATED'
  | 'DETAILS_UPDATED'
  | 'CANCEL_REQUESTED'
  | 'AS_IMPORTED'
  | 'PDF_GENERATED'
  | 'PDF_EMAILED'

/**
 * Write the audit row and stamp the handler onto the booking when it has none.
 * `via` is appended to the detail line so ops staff can tell an API change from
 * a portal click.
 */
export async function logFhAction(
  caller: FhCaller,
  booking: Pick<FhBooking, 'id' | 'bookingRef' | 'isNumber' | 'cntlNumber' | 'operationCountry' | 'fileHandler'>,
  action: FhAction,
  details: string,
) {
  const suffix = caller.kind === 'service' ? ` [API · ${caller.name}]` : ' [API]'
  await prisma.fileHandlerLog.create({
    data: {
      fileHandlerId: caller.handler.id,
      fileHandlerName: caller.handler.name,
      action,
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      cntlNumber: booking.cntlNumber,
      operationCountry: booking.operationCountry as OperationCountry | null,
      details: `${details}${suffix}`,
    },
  })
  if (!booking.fileHandler) {
    await prisma.booking.updateMany({
      where: { id: booking.id, OR: [{ fileHandler: null }, { fileHandler: '' }] },
      data: { fileHandler: caller.handler.name },
    })
  }
}

// ── Contact details + notes ──────────────────────────────────────────────────

/** Fields a file handler may edit. Flights and hotels have their own endpoints. */
const EDITABLE: Record<string, string> = {
  agent_email: 'agentEmail',
  agent_phone: 'agentPhone',
  agent_whatsapp: 'agentWhatsapp',
  contact_email: 'contactEmail',
  contact_phone: 'contactPhone',
  contact_whatsapp: 'contactWhatsapp',
  important_notes: 'importantNotes',
  // camelCase spellings accepted too, so a JS caller can send either.
  agentEmail: 'agentEmail',
  agentPhone: 'agentPhone',
  agentWhatsapp: 'agentWhatsapp',
  contactEmail: 'contactEmail',
  contactPhone: 'contactPhone',
  contactWhatsapp: 'contactWhatsapp',
  importantNotes: 'importantNotes',
}

export async function updateBookingDetails(
  caller: FhCaller,
  booking: FhBooking,
  body: Record<string, unknown>,
): Promise<{ booking: FhBooking; changed: string[] }> {
  // Contacts may also arrive nested under `contacts: { ... }`.
  const flat: Record<string, unknown> = { ...body }
  const nested = body.contacts
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) Object.assign(flat, nested)

  const data: Record<string, string | null> = {}
  const changed: string[] = []
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (!(key in flat) || column in data) continue
    const v = flat[key]
    data[column] = typeof v === 'string' && v.trim() ? v.trim() : null
    changed.push(column)
  }
  if (!changed.length) {
    throw new FhApiError(
      'Nothing to update — send at least one of agent_email, agent_phone, agent_whatsapp, contact_email, contact_phone, contact_whatsapp, important_notes',
      422,
      'NOTHING_TO_UPDATE',
    )
  }
  if (!booking.fileHandler) data.fileHandler = caller.handler.name

  await prisma.booking.update({ where: { id: booking.id }, data })
  await logFhAction(caller, booking, 'DETAILS_UPDATED', `Updated ${changed.join(', ')}`)
  return { booking: await reloadBooking(booking.id), changed }
}

// ── Flights ──────────────────────────────────────────────────────────────────

export interface FlightInput {
  flight_no?: string; flightNo?: string
  date?: string
  from_airport?: string; fromApt?: string; from?: string
  dep_time?: string; depTime?: string
  to_airport?: string; toApt?: string; to?: string
  arr_time?: string; arrTime?: string
  airline?: string
  notes?: string
}

interface FlightData {
  flightNo: string; date: Date; fromApt: string; depTime: string
  toApt: string; arrTime: string; airline: string | null; notes: string | null
}

function parseDate(value: unknown, label: string): Date {
  const d = new Date(String(value))
  if (isNaN(d.getTime())) throw new FhApiError(`${label} is not a valid date (use YYYY-MM-DD)`, 422, 'INVALID_DATE')
  return d
}

/** Validate + normalise one flight payload. Mirrors the portal's rules exactly. */
export function readFlight(raw: unknown): FlightData {
  const f = (raw ?? {}) as FlightInput
  const flightNo = (f.flight_no ?? f.flightNo ?? '').trim()
  const fromApt = (f.from_airport ?? f.fromApt ?? f.from ?? '').trim()
  const toApt = (f.to_airport ?? f.toApt ?? f.to ?? '').trim()

  if (!flightNo) throw new FhApiError('flight_no is required', 422, 'FLIGHT_NO_REQUIRED')
  if (!f.date) throw new FhApiError('date is required', 422, 'FLIGHT_DATE_REQUIRED')
  if (!fromApt) throw new FhApiError('from_airport is required', 422, 'FROM_AIRPORT_REQUIRED')
  if (!toApt) throw new FhApiError('to_airport is required', 422, 'TO_AIRPORT_REQUIRED')

  return {
    flightNo,
    date: parseDate(f.date, 'date'),
    fromApt,
    depTime: (f.dep_time ?? f.depTime ?? '').trim(),
    toApt,
    arrTime: (f.arr_time ?? f.arrTime ?? '').trim(),
    airline: (f.airline ?? '').trim() || null,
    notes: (f.notes ?? '').trim() || null,
  }
}

export async function addFlights(caller: FhCaller, booking: FhBooking, inputs: unknown[]) {
  if (!inputs.length) throw new FhApiError('Send a flight object, or a non-empty "flights" array', 422, 'NO_FLIGHTS')
  const parsed = inputs.map(readFlight)

  const created = []
  for (const data of parsed) {
    created.push(await prisma.flight.create({ data: { bookingId: booking.id, ...data } }))
  }
  await logFhAction(
    caller,
    booking,
    'FLIGHT_ADDED',
    created.length === 1
      ? `Added flight ${created[0].flightNo} (${created[0].fromApt}→${created[0].toApt})`
      : `Added ${created.length} flights: ${created.map((f) => f.flightNo).join(', ')}`,
  )
  return created
}

export async function updateFlight(caller: FhCaller, booking: FhBooking, flightId: string, input: unknown) {
  const existing = await prisma.flight.findFirst({ where: { id: flightId, bookingId: booking.id } })
  if (!existing) throw new FhApiError('Flight not found on this booking', 404, 'FLIGHT_NOT_FOUND')

  const data = readFlight(input)
  const flight = await prisma.flight.update({ where: { id: flightId }, data })
  await logFhAction(caller, booking, 'FLIGHT_UPDATED', `Updated flight ${flight.flightNo} (${flight.fromApt}→${flight.toApt})`)
  return flight
}

export async function deleteFlight(caller: FhCaller, booking: FhBooking, flightId: string) {
  const existing = await prisma.flight.findFirst({ where: { id: flightId, bookingId: booking.id } })
  if (!existing) throw new FhApiError('Flight not found on this booking', 404, 'FLIGHT_NOT_FOUND')

  await prisma.flight.delete({ where: { id: flightId } })
  await logFhAction(caller, booking, 'FLIGHT_UPDATED', `Removed flight ${existing.flightNo}`)
  return existing
}

// ── Accommodations ───────────────────────────────────────────────────────────

export interface HotelInput {
  city?: string
  hotel?: string
  check_in?: string; checkIn?: string
  check_out?: string; checkOut?: string
  address?: string
  contact?: string
  room_type?: string; roomType?: string
  meal_type?: string; mealType?: string
  nights?: number
}

interface HotelData {
  city: string; hotel: string; checkIn: Date; checkOut: Date; nights: number
  address: string | null; contact: string | null; roomType: string | null; mealType: string | null
}

function nightsBetween(a: Date, b: Date): number {
  const diff = b.getTime() - a.getTime()
  if (!Number.isFinite(diff) || diff <= 0) return 1
  return Math.max(1, Math.round(diff / 86_400_000))
}

export function readHotel(raw: unknown): HotelData {
  const h = (raw ?? {}) as HotelInput
  const hotel = (h.hotel ?? '').trim()
  const city = (h.city ?? '').trim()
  const checkInRaw = h.check_in ?? h.checkIn
  const checkOutRaw = h.check_out ?? h.checkOut

  if (!hotel) throw new FhApiError('hotel is required', 422, 'HOTEL_REQUIRED')
  if (!city) throw new FhApiError('city is required', 422, 'CITY_REQUIRED')
  if (!checkInRaw) throw new FhApiError('check_in is required', 422, 'CHECK_IN_REQUIRED')
  if (!checkOutRaw) throw new FhApiError('check_out is required', 422, 'CHECK_OUT_REQUIRED')

  const checkIn = parseDate(checkInRaw, 'check_in')
  const checkOut = parseDate(checkOutRaw, 'check_out')

  return {
    city,
    hotel,
    checkIn,
    checkOut,
    nights: h.nights && h.nights > 0 ? Math.round(h.nights) : nightsBetween(checkIn, checkOut),
    address: (h.address ?? '').trim() || null,
    contact: (h.contact ?? '').trim() || null,
    roomType: (h.room_type ?? h.roomType ?? '').trim() || null,
    mealType: (h.meal_type ?? h.mealType ?? '').trim() || null,
  }
}

export async function addAccommodations(caller: FhCaller, booking: FhBooking, inputs: unknown[]) {
  if (!inputs.length) throw new FhApiError('Send a hotel object, or a non-empty "accommodations" array', 422, 'NO_HOTELS')
  const parsed = inputs.map(readHotel)

  const created = []
  for (const data of parsed) {
    created.push(await prisma.accommodation.create({ data: { bookingId: booking.id, ...data } }))
  }
  await logFhAction(
    caller,
    booking,
    'HOTEL_UPDATED',
    created.length === 1
      ? `Added hotel ${created[0].hotel} (${created[0].city})`
      : `Added ${created.length} hotels: ${created.map((a) => a.hotel).join(', ')}`,
  )
  return created
}

export async function updateAccommodation(caller: FhCaller, booking: FhBooking, accId: string, input: unknown) {
  const existing = await prisma.accommodation.findFirst({ where: { id: accId, bookingId: booking.id } })
  if (!existing) throw new FhApiError('Hotel not found on this booking', 404, 'HOTEL_NOT_FOUND')

  const acc = await prisma.accommodation.update({ where: { id: accId }, data: readHotel(input) })
  await logFhAction(caller, booking, 'HOTEL_UPDATED', `Updated hotel ${acc.hotel} (${acc.city})`)
  return acc
}

export async function deleteAccommodation(caller: FhCaller, booking: FhBooking, accId: string) {
  const existing = await prisma.accommodation.findFirst({ where: { id: accId, bookingId: booking.id } })
  if (!existing) throw new FhApiError('Hotel not found on this booking', 404, 'HOTEL_NOT_FOUND')

  await prisma.accommodation.delete({ where: { id: accId } })
  await logFhAction(caller, booking, 'HOTEL_UPDATED', `Removed hotel ${existing.hotel}`)
  return existing
}

// ── Cancellation ─────────────────────────────────────────────────────────────

/**
 * Request a cancellation. As in the portal, the booking is **not** cancelled
 * here — it moves to `PENDING_CANCELLATION` and the accounts team is emailed to
 * approve it. (The AS quotation API cancels outright; a file handler cannot.)
 */
export async function requestCancellation(
  caller: FhCaller,
  booking: FhBooking,
  input: { reason?: unknown; fees?: unknown },
): Promise<{ booking: FhBooking; fee_total: number; email_sent: boolean }> {
  if (booking.status === 'PENDING_CANCELLATION') {
    throw new FhApiError('This booking is already awaiting accounts approval to cancel', 409, 'ALREADY_PENDING_CANCELLATION')
  }
  if (!CANCELLABLE_STATES.includes(booking.status as BookingStatus)) {
    throw new FhApiError(`Cannot cancel a booking in ${booking.status} state`, 409, 'NOT_CANCELLABLE')
  }

  const reason = String(input.reason ?? '').trim()
  if (!reason) throw new FhApiError('reason is required', 422, 'REASON_REQUIRED')

  // Fees are optional; the total is recomputed here, never trusted from the caller.
  const feeLines = sanitizeCancellationFees(input.fees)
  const feeTotal = totalCancellationFee(feeLines)

  const requestedAt = new Date()
  const previousStatus = booking.status as BookingStatus
  const requesterName = `${caller.handler.name} (File Handler)`

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: 'PENDING_CANCELLATION',
      cancelPrevStatus: previousStatus,
      cancelRequestedAt: requestedAt,
      cancelledAt: null,
      cancelDecidedAt: null,
      cancelDecidedByName: null,
      cancelDecidedByEmail: null,
      cancelDecisionNote: null,
      cancelMailSentAt: null,
      cancelledById: null, // file handlers are not staff Users
      cancelledByName: requesterName,
      cancelledByEmail: caller.handler.email,
      cancellationReason: reason,
      cancellationFees: feeLines as unknown as Prisma.InputJsonValue,
      cancellationFeeTotal: feeTotal,
      ...(booking.fileHandler ? {} : { fileHandler: caller.handler.name }),
    },
  })

  await logFhAction(
    caller,
    booking,
    'CANCEL_REQUESTED',
    `Requested cancellation — awaiting accounts approval. Reason: ${reason}`,
  )

  // Alert the accounts team. A mail failure must not undo the request.
  let emailSent = true
  try {
    const approvers = await prisma.user.findMany({ where: { role: 'AC_USER', isActive: true }, select: { email: true } })
    const appUrl = (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/$/, '')
    await sendCancellationApprovalEmail(
      {
        bookingRef: booking.bookingRef,
        isNumber: booking.isNumber,
        agent: booking.agent,
        agentBookingId: booking.agentBookingId,
        fileHandler: caller.handler.name,
        leadPassenger: booking.passengers.find((p) => p.isLead)?.name ?? null,
        arrivalDate: booking.arrivalDate,
        departureDate: booking.departureDate,
        paxAdults: booking.paxAdults,
        paxChildren: booking.paxChildren,
        paxInfants: booking.paxInfants,
        quotedTotal: booking.quotedTotal ? booking.quotedTotal.toString() : null,
        currency: booking.currency,
        operationCountry: booking.operationCountry,
        previousStatus,
        cancelledByName: requesterName,
        cancelledByEmail: caller.handler.email,
        reason,
        cancelledAt: requestedAt,
      },
      approvers.map((a) => a.email),
      `${appUrl}/dashboard/accounts/cancellations`,
    )
  } catch (err) {
    emailSent = false
    console.error(`[fh-public-api] cancellation approval email failed for ${booking.bookingRef}:`, err)
  }

  return { booking: await reloadBooking(booking.id), fee_total: feeTotal, email_sent: emailSent }
}
