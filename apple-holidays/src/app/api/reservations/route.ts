/**
 * GET  /api/reservations  — list reservations (scoped, filtered, paged)
 * POST /api/reservations  — open a reservation on a booking
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import { listReservations, type ReservationStatusValue } from '@/lib/reservations'
import { createReservation, ReservationError } from '@/lib/reservations-write'

export async function GET(req: NextRequest) {
  const g = await guardReservation('reservation:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const status = p.get('status')?.split(',').filter(Boolean) as ReservationStatusValue[] | undefined

  const { rows, total } = await listReservations({
    countries: g.session.countries,
    status: status?.length ? status : undefined,
    bookingRef: p.get('bookingRef') ?? undefined,
    hotelProfileId: p.get('hotelProfileId') ?? undefined,
    assignedToEmail: p.get('mine') === '1' ? g.session.actor.email ?? undefined : undefined,
    search: p.get('q') ?? undefined,
    from: p.get('from') ? new Date(p.get('from')!) : undefined,
    to: p.get('to') ? new Date(p.get('to')!) : undefined,
    take: Math.min(Number(p.get('take') ?? 100), 300),
    skip: Number(p.get('skip') ?? 0),
  })

  return buildApiSuccess({ rows, total })
}

export async function POST(req: NextRequest) {
  const g = await guardReservation('reservation:create')
  if (!g.ok) return g.response

  try {
    const body = await req.json()
    if (!body.bookingRef || !body.hotelName || !body.checkIn || !body.checkOut) {
      return buildApiError('bookingRef, hotelName, checkIn and checkOut are required', 422)
    }
    if (!(await assertBookingInScope(String(body.bookingRef), g.session))) {
      return buildApiError('Booking is outside your country scope', 403)
    }

    const row = await createReservation(
      {
        ...body,
        checkIn: new Date(body.checkIn),
        checkOut: new Date(body.checkOut),
      },
      g.session.actor,
    )
    return buildApiSuccess(row, 201)
  } catch (e) {
    if (e instanceof ReservationError) return buildApiError(e.message, e.status)
    return buildApiError(e instanceof Error ? e.message : 'Failed to create reservation', 500)
  }
}
