/**
 * GET  /api/reservations/invoices — the proforma pipeline
 * POST /api/reservations/invoices — register an invoice against a reservation
 *
 * Registering runs the three-way match immediately (invoice ↔ agreed rate ↔
 * P&L hotel budget) and files the result on the row, so the pipeline column an
 * invoice lands in is always explained by numbers a human can see.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import { threeWayMatch } from '@/lib/reservations-write'
import { toNumber } from '@/lib/reservation-shared'

export async function GET(req: NextRequest) {
  const g = await guardReservation('invoice:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const status = p.get('status')?.split(',').filter(Boolean)

  const rows = await prisma.proformaInvoice.findMany({
    where: {
      ...(status?.length ? { status: { in: status as never[] } } : {}),
      ...(p.get('bookingRef') ? { bookingRef: p.get('bookingRef')!.toUpperCase() } : {}),
      // Country scope rides on the parent reservation; invoices with no
      // reservation are visible only to users who see every country.
      ...(g.session.countries
        ? { reservation: { operationCountry: { in: g.session.countries as never[] } } }
        : {}),
    },
    include: { reservation: { select: { id: true, bookingRef: true, hotelName: true, checkIn: true, totalCost: true, currency: true } } },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    take: Math.min(Number(p.get('take') ?? 200), 500),
  })

  return buildApiSuccess({ rows, total: rows.length })
}

export async function POST(req: NextRequest) {
  const g = await guardReservation('invoice:read')
  if (!g.ok) return g.response

  const body = await req.json()
  if (!body.reservationId) return buildApiError('`reservationId` is required', 422)

  const reservation = await prisma.hotelReservation.findUnique({
    where: { id: body.reservationId },
    select: {
      id: true, bookingRef: true, hotelProfileId: true, hotelName: true,
      totalCost: true, budgetAmount: true, currency: true,
    },
  })
  if (!reservation) return buildApiError('Reservation not found', 404)
  if (!(await assertBookingInScope(reservation.bookingRef, g.session))) {
    return buildApiError('Reservation is outside your country scope', 403)
  }

  const total = body.totalAmount == null ? null : Number(body.totalAmount)
  const match = threeWayMatch({
    invoiceTotal: total,
    reservationTotal: toNumber(reservation.totalCost),
    budget: toNumber(reservation.budgetAmount),
  })

  const invoice = await prisma.$transaction(async tx => {
    const created = await tx.proformaInvoice.create({
      data: {
        reservationId: reservation.id,
        bookingRef: reservation.bookingRef,
        hotelProfileId: reservation.hotelProfileId,
        hotelName: reservation.hotelName,
        invoiceNumber: body.invoiceNumber ?? null,
        invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        currency: body.currency ?? reservation.currency,
        fxRate: body.fxRate ?? null,
        amount: body.amount ?? null,
        taxAmount: body.taxAmount ?? null,
        totalAmount: total,
        baseTotalAmount: total !== null && body.fxRate ? total * Number(body.fxRate) : null,
        fileUrl: body.fileUrl ?? null,
        fileName: body.fileName ?? null,
        // A mismatch is never auto-resolved — it goes to a human as DISCREPANCY.
        status: match.matched ? 'UNDER_REVIEW' : 'DISCREPANCY',
        matchResult: match as never,
        variance: match.variance,
        variancePct: match.variancePct,
        notes: body.notes ?? null,
        createdBy: g.session.actor.email ?? null,
      },
    })

    await tx.reservationEvent.create({
      data: {
        reservationId: reservation.id,
        action: 'invoice_linked',
        note: `${created.invoiceNumber ?? 'Proforma'} — ${match.reason}`,
        payload: match as never,
        actorName: g.session.actor.name ?? null,
        actorEmail: g.session.actor.email ?? null,
      },
    })

    return created
  })

  return buildApiSuccess({ invoice, match }, 201)
}
