/**
 * PATCH  /api/proforma/:id — correct a filed invoice, or replace its document
 * DELETE /api/proforma/:id — void one
 *
 * An invoice Accounts has already settled is frozen: correcting the figure
 * behind a payment that has gone out would leave the two systems telling
 * different stories about the same money. The fix for that case is a credit
 * note, not an edit.
 *
 * DELETE is a status change to VOID, never a row deletion. A supplier invoice
 * that was filed and then withdrawn is part of the history of the booking.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { guardReservation, assertBookingInScope } from '@/lib/reservation-guard'
import {
  ACCEPTED_UPLOAD, BOOKING_INVOICE_STATUSES, MAX_UPLOAD_BYTES, MEAL_PLANS,
  storeProformaFile, toProformaRow,
} from '@/lib/proforma'
import { settlementsFor } from '@/lib/accounts-proforma-db'

export const dynamic = 'force-dynamic'

/** The invoice, plus whether Accounts has already put money against it. */
async function loadEditable(id: string) {
  const invoice = await prisma.proformaInvoice.findUnique({ where: { id } })
  if (!invoice) return { invoice: null, settled: false as const }

  const settlement = (await settlementsFor([id])).get(id) ?? null
  const settled = settlement != null && (settlement.status === 'paid' || settlement.paidAmount != null)
  return { invoice, settled, settlement }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('proforma:manage')
  if (!g.ok) return g.response

  const { invoice, settled } = await loadEditable(params.id)
  if (!invoice) return buildApiError('Invoice not found', 404)
  if (invoice.bookingRef && !(await assertBookingInScope(invoice.bookingRef, g.session))) {
    return buildApiError('That invoice is outside your country scope', 403)
  }
  if (settled) {
    return buildApiError('Accounts has already paid against this invoice — raise a credit note instead of editing it', 409)
  }

  const isMultipart = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
  const form = isMultipart ? await req.formData() : null
  const body = isMultipart ? null : await req.json().catch(() => ({}))

  const read = (field: string): string | undefined => {
    if (form) {
      const v = form.get(field)
      return v == null ? undefined : String(v)
    }
    const v = (body as Record<string, unknown>)?.[field]
    return v == null ? undefined : String(v)
  }

  const data: Record<string, unknown> = {}

  const text = (field: string, column = field) => {
    const v = read(field)
    if (v === undefined) return
    data[column] = v.trim() === '' ? null : v.trim()
  }
  const decimal = (field: string, column = field) => {
    const v = read(field)
    if (v === undefined) return
    if (v.trim() === '') { data[column] = null; return }
    const n = Number(v.replace(/,/g, ''))
    if (!Number.isFinite(n) || n < 0) throw new RangeError(`${field} must be a positive number`)
    data[column] = Math.round(n * 100) / 100
  }
  const when = (field: string, column = field) => {
    const v = read(field)
    if (v === undefined) return
    if (v.trim() === '') { data[column] = null; return }
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) throw new RangeError(`${field} is not a date`)
    data[column] = d
  }
  const count = (field: string, column = field) => {
    const v = read(field)
    if (v === undefined) return
    if (v.trim() === '') { data[column] = null; return }
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`${field} must be a whole number`)
    data[column] = n
  }

  try {
    text('invoiceNumber'); text('hotelName'); text('city'); text('roomType'); text('notes')
    decimal('amount'); decimal('taxAmount'); decimal('totalAmount')
    when('invoiceDate'); when('dueDate'); when('checkIn'); when('checkOut')
    count('nights'); count('roomCount')
    // The beneficiary account, correctable like every other field on the paper.
    // Each is only written when the form actually sent it, so a client that
    // does not know about these columns cannot blank them.
    text('bankAccountName'); text('bankName'); text('bankBranch')
    text('bankAccountNumber'); text('bankSwift'); text('bankIban'); text('bankAddress')
  } catch (e) {
    return buildApiError(e instanceof Error ? e.message : 'Invalid value', 422)
  }

  const currency = read('currency')
  if (currency !== undefined && currency.trim() !== '') {
    data.currency = currency.trim().toUpperCase().slice(0, 3)
  }

  const bankCurrency = read('bankCurrency')
  if (bankCurrency !== undefined) {
    const up = bankCurrency.trim().toUpperCase().slice(0, 8)
    data.bankCurrency = up === '' ? null : up
  }

  const meal = read('mealPlan')
  if (meal !== undefined) {
    const up = meal.trim().toUpperCase()
    data.mealPlan = (MEAL_PLANS as readonly string[]).includes(up) ? up : null
  }

  const status = read('status')
  if (status !== undefined && status.trim() !== '') {
    const up = status.trim().toUpperCase()
    if (!(BOOKING_INVOICE_STATUSES as readonly string[]).includes(up)) {
      // PAID is refused by name rather than silently ignored: it is a real
      // status, it just is not this system's to set.
      return buildApiError(
        up === 'PAID'
          ? 'Only the Accounts system marks a proforma paid'
          : `Unknown status ${up}`,
        422,
      )
    }
    data.status = up
    if (up === 'REJECTED') {
      const reason = read('rejectReason')?.trim()
      if (!reason) return buildApiError('A reason is required to reject an invoice', 422)
      data.rejectReason = reason
    }
  }

  if (form) {
    const file = form.get('file')
    if (file instanceof File && file.size > 0) {
      if (!ACCEPTED_UPLOAD.test(file.name)) return buildApiError('Upload a PDF or an image of the invoice', 422)
      if (file.size > MAX_UPLOAD_BYTES) {
        return buildApiError(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`, 422)
      }
      // The previous document is left in the bucket on purpose: it is what was
      // filed at the time, and a replaced file is exactly the kind of thing an
      // audit later asks to see.
      const stored = await storeProformaFile(invoice.bookingRef ?? 'UNFILED', file)
      data.fileUrl = stored.fileUrl
      data.fileKey = stored.fileKey
      data.fileName = stored.fileName
    }
  }

  if (Object.keys(data).length === 0) return buildApiError('Nothing to update', 422)

  const updated = await prisma.proformaInvoice.update({
    where: { id: params.id },
    data: { ...data, updatedBy: g.session.actor.email ?? null },
  })

  return buildApiSuccess({ invoice: toProformaRow(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guardReservation('proforma:manage')
  if (!g.ok) return g.response

  const { invoice, settled } = await loadEditable(params.id)
  if (!invoice) return buildApiError('Invoice not found', 404)
  if (invoice.bookingRef && !(await assertBookingInScope(invoice.bookingRef, g.session))) {
    return buildApiError('That invoice is outside your country scope', 403)
  }
  if (settled) {
    return buildApiError('Accounts has already paid against this invoice — it cannot be voided here', 409)
  }

  const reason = req.nextUrl.searchParams.get('reason')?.trim()

  const updated = await prisma.proformaInvoice.update({
    where: { id: params.id },
    data: {
      status: 'VOID',
      rejectReason: reason || 'Voided from the Proforma Invoice screen',
      updatedBy: g.session.actor.email ?? null,
    },
  })

  return buildApiSuccess({ invoice: toProformaRow(updated) })
}
