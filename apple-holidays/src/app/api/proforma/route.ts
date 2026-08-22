/**
 * GET  /api/proforma        — recently filed proformas (the landing list)
 * POST /api/proforma        — file one against a booking's hotel
 *
 * POST is multipart: the invoice values and the document arrive together,
 * because a proforma with no paper behind it is a number somebody typed. The
 * document is optional only so a correction can be filed while the PDF is
 * being chased — the UI marks such a row as missing its file.
 *
 * Nothing here writes to `accommodations`. A hotel the booking does not list is
 * recorded on the invoice (`hotelAdded`), never added to the booking: what was
 * sold is the Booking desk's record, and an invoice is not an amendment.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import {
  ACCEPTED_UPLOAD, MAX_UPLOAD_BYTES, MEAL_PLANS, storeProformaFile, toProformaRow,
} from '@/lib/proforma'
import { settlementsFor } from '@/lib/accounts-proforma-db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const g = await guardReservation('proforma:read')
  if (!g.ok) return g.response

  const p = req.nextUrl.searchParams
  const take = Math.min(Math.max(Number(p.get('take') ?? 60), 1), 200)
  const status = p.get('status')?.split(',').filter(Boolean)

  const rows = await prisma.proformaInvoice.findMany({
    where: {
      origin: 'BOOKING',
      ...(status?.length ? { status: { in: status as never[] } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
  })

  const invoices = rows.map(toProformaRow)
  const settlements = await settlementsFor(invoices.map(i => i.id))
  for (const inv of invoices) inv.settlement = settlements.get(inv.id) ?? null

  return buildApiSuccess({ invoices, total: invoices.length })
}

/** Read a decimal out of the form, rejecting anything that is not a number. */
function money(form: FormData, field: string): number | null | 'bad' {
  const raw = form.get(field)
  if (raw == null || String(raw).trim() === '') return null
  const n = Number(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n) || n < 0) return 'bad'
  return Math.round(n * 100) / 100
}

function date(form: FormData, field: string): Date | null | 'bad' {
  const raw = form.get(field)
  if (raw == null || String(raw).trim() === '') return null
  const d = new Date(String(raw))
  return Number.isNaN(d.getTime()) ? 'bad' : d
}

export async function POST(req: NextRequest) {
  const g = await guardReservation('proforma:manage')
  if (!g.ok) return g.response

  const form = await req.formData()

  const bookingId = String(form.get('bookingId') ?? '').trim()
  if (!bookingId) return buildApiError('`bookingId` is required', 422)

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true, bookingRef: true, isNumber: true, currency: true,
      accommodations: {
        select: { id: true, hotel: true, city: true, checkIn: true, checkOut: true, nights: true, roomType: true, mealType: true },
      },
    },
  })
  if (!booking) return buildApiError('Booking not found', 404)
  if (!(await assertBookingInScope(booking.bookingRef, g.session))) {
    return buildApiError('That booking is outside your country scope', 403)
  }

  // The stay this invoice is for: an accommodation the booking already lists,
  // or a hotel the user is naming because the booking does not list it.
  const accommodationId = String(form.get('accommodationId') ?? '').trim() || null
  const stay = accommodationId
    ? booking.accommodations.find(a => a.id === accommodationId) ?? null
    : null
  if (accommodationId && !stay) {
    return buildApiError('That hotel is no longer on this booking — file it as an added hotel instead', 422)
  }

  const hotelName = (String(form.get('hotelName') ?? '').trim() || stay?.hotel || '').trim()
  if (!hotelName) return buildApiError('A hotel name is required', 422)

  const invoiceNumber = String(form.get('invoiceNumber') ?? '').trim() || null
  const currency = (String(form.get('currency') ?? '').trim() || booking.currency || 'USD')
    .toUpperCase().slice(0, 3)

  const amount = money(form, 'amount')
  const taxAmount = money(form, 'taxAmount')
  const totalAmount = money(form, 'totalAmount')
  if (amount === 'bad' || taxAmount === 'bad' || totalAmount === 'bad') {
    return buildApiError('Amounts must be positive numbers', 422)
  }
  if (totalAmount == null) return buildApiError('The invoice total is required', 422)

  const invoiceDate = date(form, 'invoiceDate')
  const dueDate = date(form, 'dueDate')
  const checkIn = date(form, 'checkIn')
  const checkOut = date(form, 'checkOut')
  if (invoiceDate === 'bad' || dueDate === 'bad' || checkIn === 'bad' || checkOut === 'bad') {
    return buildApiError('One of the dates could not be read', 422)
  }

  const mealRaw = String(form.get('mealPlan') ?? '').trim().toUpperCase()
  const mealPlan = (MEAL_PLANS as readonly string[]).includes(mealRaw) ? mealRaw : (stay?.mealType ?? null)

  const intOrNull = (field: string, fallback: number | null) => {
    const raw = String(form.get(field) ?? '').trim()
    if (raw === '') return fallback
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 ? n : fallback
  }

  // The file, if one came with it.
  let stored: { fileUrl: string; fileKey: string; fileName: string } | null = null
  const file = form.get('file')
  if (file instanceof File && file.size > 0) {
    if (!ACCEPTED_UPLOAD.test(file.name)) {
      return buildApiError('Upload a PDF or an image of the invoice', 422)
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return buildApiError(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 422)
    }
    stored = await storeProformaFile(booking.bookingRef, file)
  }

  const created = await prisma.proformaInvoice.create({
    data: {
      // Booking identity, written under both references so Accounts can match
      // on whichever one its own records carry.
      bookingId: booking.id,
      bookingRef: booking.bookingRef,
      isNumber: booking.isNumber,
      accommodationId: stay?.id ?? null,
      hotelName,
      city: String(form.get('city') ?? '').trim() || stay?.city || null,
      hotelAdded: !stay,
      origin: 'BOOKING',

      invoiceNumber,
      invoiceDate: invoiceDate ?? null,
      dueDate: dueDate ?? null,
      currency,
      amount: amount ?? totalAmount,
      taxAmount: taxAmount ?? null,
      totalAmount,

      checkIn: checkIn ?? stay?.checkIn ?? null,
      checkOut: checkOut ?? stay?.checkOut ?? null,
      nights: intOrNull('nights', stay?.nights ?? null),
      roomType: String(form.get('roomType') ?? '').trim() || stay?.roomType || null,
      mealPlan,
      roomCount: intOrNull('roomCount', null),

      fileUrl: stored?.fileUrl ?? null,
      fileKey: stored?.fileKey ?? null,
      fileName: stored?.fileName ?? null,

      // RECEIVED, always. This component records what a property sent; whether
      // it is right is a separate act by a person, on the pipeline board.
      status: 'RECEIVED',
      notes: String(form.get('notes') ?? '').trim() || null,
      createdBy: g.session.actor.email ?? null,
    },
  })

  return buildApiSuccess({ invoice: toProformaRow(created) }, 201)
}
