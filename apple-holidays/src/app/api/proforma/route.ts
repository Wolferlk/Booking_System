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

/**
 * The bank block the form carries back from the extraction pass.
 *
 * Sent as flat form fields rather than JSON so a clerk's correction to any one
 * of them travels the same way every other corrected field does — what is
 * stored is what was on screen when they pressed File, not what the model
 * originally said. The model's own answer is kept whole in `aiExtract`, so the
 * two readings can always be compared.
 */
function bankFields(form: FormData) {
  const s = (field: string, max: number) => {
    const v = String(form.get(field) ?? '').trim()
    return v ? v.slice(0, max) : null
  }

  return {
    bankAccountName: s('bankAccountName', 255),
    bankName: s('bankName', 255),
    bankBranch: s('bankBranch', 255),
    bankAccountNumber: s('bankAccountNumber', 128),
    bankSwift: s('bankSwift', 32),
    bankIban: s('bankIban', 64),
    bankCurrency: s('bankCurrency', 8)?.toUpperCase() ?? null,
    bankAddress: s('bankAddress', 500),
  }
}

/**
 * The raw extraction payload, if the form is carrying one.
 *
 * Parsed defensively and dropped on any doubt: this column is an audit trail,
 * and a malformed one must not stop an invoice being filed.
 */
function aiExtract(form: FormData): { aiExtract: object; aiExtractedAt: Date } | null {
  const raw = String(form.get('aiExtract') ?? '').trim()
  if (!raw || raw.length > 20_000) return null

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return { aiExtract: parsed as object, aiExtractedAt: new Date() }
  } catch {
    return null
  }
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
  // The total is NOT required. The document is the record; a figure nobody could
  // read off it — a scan with no text layer, a total the property left off the
  // proforma — must not stop the paper being filed. It stays null until someone
  // types it, and the board shows an em dash where the money would be.

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

  // The document, and it is the one thing this route insists on: an invoice row
  // with no paper behind it is a claim nobody in Accounts can check.
  let stored: { fileUrl: string; fileKey: string; fileName: string } | null = null
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return buildApiError('Attach the proforma document — a PDF or a photograph of it', 422)
  }
  if (!ACCEPTED_UPLOAD.test(file.name)) {
    return buildApiError('Upload a PDF or an image of the invoice', 422)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return buildApiError(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 422)
  }
  stored = await storeProformaFile(booking.bookingRef, file)

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

      // The beneficiary account printed on the invoice, as read off the
      // document and confirmed by the clerk. Recorded so Accounts does not have
      // to read the same PDF a second time by eye — the step that produces
      // wrong-account transfers. Nothing pays from these columns.
      ...bankFields(form),
      ...(aiExtract(form) ?? {}),

      // RECEIVED, always. This component records what a property sent; whether
      // it is right is a separate act by a person, on the pipeline board.
      status: 'RECEIVED',
      notes: String(form.get('notes') ?? '').trim() || null,
      createdBy: g.session.actor.email ?? null,
    },
  })

  return buildApiSuccess({ invoice: toProformaRow(created) }, 201)
}
