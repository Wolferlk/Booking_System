/**
 * The three things AppleSystem can do to an ops booking over the public API:
 * CREATE it from a quotation, UPDATE it when the quotation is revised, and
 * CANCEL it when the quotation is cancelled.
 *
 * The route handlers are thin — all of the resolution, mapping, persistence and
 * audit logic lives here so the dedicated endpoints and the unified
 * `/quotation/sync` dispatcher behave identically.
 */

import { prisma } from '@/lib/prisma'
import { getCancellationDeadline } from '@/lib/utils'
import { getQuoteTemplate } from '@/lib/applesystem'
import { mapQuoteToBooking, normalizeIsNumber, type MappedBookingInput } from '@/lib/as-booking-map'
import { importMappedBooking, getAutomationUserId } from '@/lib/as-booking-import'
import { detectCountryFromRef, isInCountryScope, type OperationCountry } from '@/lib/country-detection'
import { sanitizeCancellationFees, totalCancellationFee, type CancellationFeeLine } from '@/lib/cancellation-fees'
import { sendCancellationEmail } from '@/lib/send-cancellation-email'
import { CANCELLABLE_STATES } from '@/lib/state-machine'
import { Prisma, type BookingStatus } from '@prisma/client'
import type { AuthedCaller } from './as-api-auth'

/** Thrown for anything the caller can fix by changing the request. */
export class AsApiError extends Error {
  constructor(message: string, public status = 400, public code = 'BAD_REQUEST') {
    super(message)
    this.name = 'AsApiError'
  }
}

// ── Identification ───────────────────────────────────────────────────────────

/**
 * How AppleSystem points at a booking. Any one of these is enough:
 *   `is_number`     — the IS number (this is our `bookingRef`)
 *   `quotation_no`  — the AS quotation reference (stored as `cntlNumber`)
 *   `booking_ref`   — an explicit ops reference, same thing as the IS number
 */
export interface QuotationIdentifier {
  is_number?: string | null
  quotation_no?: string | null
  booking_ref?: string | null
  reference_id?: string | null
}

export function readIdentifier(body: Record<string, unknown>): QuotationIdentifier {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
    return null
  }
  return {
    // Accept both snake_case and the camelCase AS sometimes emits.
    is_number: pick('is_number', 'isNumber', 'IS_number', 'is_no'),
    quotation_no: pick('quotation_no', 'quotationNo', 'quotation_ref', 'quotationRef', 'ref_number', 'refNumber'),
    booking_ref: pick('booking_ref', 'bookingRef'),
    reference_id: pick('reference_id', 'referenceId'),
  }
}

export function describeIdentifier(id: QuotationIdentifier): string {
  const parts = [
    id.is_number && `IS ${id.is_number}`,
    id.quotation_no && `quotation ${id.quotation_no}`,
    id.booking_ref && `ref ${id.booking_ref}`,
  ].filter(Boolean)
  return parts.join(' / ') || 'unidentified quotation'
}

const BOOKING_SUMMARY_SELECT = {
  id: true,
  bookingRef: true,
  isNumber: true,
  cntlNumber: true,
  status: true,
  version: true,
  agent: true,
  fileHandler: true,
  arrivalDate: true,
  departureDate: true,
  paxAdults: true,
  paxChildren: true,
  paxInfants: true,
  quotedTotal: true,
  currency: true,
  operationCountry: true,
  cancelledAt: true,
  cancellationReason: true,
  cancellationFeeTotal: true,
  updatedAt: true,
} as const

export type BookingSummary = Prisma.BookingGetPayload<{ select: typeof BOOKING_SUMMARY_SELECT }>

/** Serialise a booking for the API response (Decimal / Date → JSON-safe). */
export function serializeBooking(b: BookingSummary) {
  return {
    booking_ref: b.bookingRef,
    is_number: b.isNumber,
    quotation_no: b.cntlNumber,
    status: b.status,
    version: b.version,
    agent: b.agent,
    file_handler: b.fileHandler,
    arrival_date: b.arrivalDate?.toISOString().slice(0, 10) ?? null,
    departure_date: b.departureDate?.toISOString().slice(0, 10) ?? null,
    pax: { adults: b.paxAdults, children: b.paxChildren, infants: b.paxInfants },
    quoted_total: b.quotedTotal ? Number(b.quotedTotal) : null,
    currency: b.currency,
    operation_country: b.operationCountry,
    cancelled_at: b.cancelledAt?.toISOString() ?? null,
    cancellation_reason: b.cancellationReason,
    cancellation_fee_total: b.cancellationFeeTotal ? Number(b.cancellationFeeTotal) : null,
    updated_at: b.updatedAt.toISOString(),
  }
}

/**
 * Find the booking an identifier points at. IS number wins when both are given
 * (it is the primary key of our world); the quotation number is the fallback
 * for quotations imported before an IS number was known.
 */
export async function resolveBooking(id: QuotationIdentifier): Promise<BookingSummary | null> {
  const ref = id.is_number || id.booking_ref
  if (ref) {
    const normalized = normalizeIsNumber(ref)
    const byRef = await prisma.booking.findFirst({
      where: { OR: [{ bookingRef: normalized }, { isNumber: normalized }] },
      select: BOOKING_SUMMARY_SELECT,
    })
    if (byRef) return byRef
  }
  if (id.quotation_no) {
    const byQuote = await prisma.booking.findFirst({
      where: { cntlNumber: id.quotation_no },
      orderBy: { createdAt: 'desc' },
      select: BOOKING_SUMMARY_SELECT,
    })
    if (byQuote) return byQuote
  }
  return null
}

/** Same as `resolveBooking` but throws a 404 the routes can return directly. */
export async function requireBooking(id: QuotationIdentifier): Promise<BookingSummary> {
  if (!id.is_number && !id.quotation_no && !id.booking_ref) {
    throw new AsApiError(
      'Provide at least one identifier: is_number, quotation_no or booking_ref',
      422,
      'IDENTIFIER_REQUIRED',
    )
  }
  const booking = await resolveBooking(id)
  if (!booking) {
    throw new AsApiError(`No booking found for ${describeIdentifier(id)}`, 404, 'BOOKING_NOT_FOUND')
  }
  return booking
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function writeAudit(
  actorId: string,
  caller: AuthedCaller,
  action: string,
  booking: { id: string; bookingRef: string } | null,
  details: Record<string, unknown>,
) {
  try {
    await prisma.activityLog.create({
      data: {
        userId: actorId,
        action: `AS_API_${action}`,
        entityType: 'Booking',
        entityId: booking?.id ?? null,
        details: JSON.stringify({ caller: caller.username, via: caller.via, ...details }).slice(0, 4000),
      },
    })
  } catch (err) {
    // Never let the audit trail fail the operation.
    console.error('[as-public-api] audit log failed:', err)
  }
}

// ── Fetch + map an AppleSystem quotation ─────────────────────────────────────

async function pullQuotation(
  quotationNo: string,
  referenceId: string,
  fallbackIsNumber: string | null,
): Promise<{ mapped: MappedBookingInput; raw: Record<string, unknown> }> {
  let raw: Record<string, unknown>
  try {
    raw = (await getQuoteTemplate(quotationNo, referenceId)) as unknown as Record<string, unknown>
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to load the quotation from AppleSystem'
    throw new AsApiError(msg, 502, 'UPSTREAM_UNAVAILABLE')
  }
  try {
    return { mapped: mapQuoteToBooking(raw, { fallbackIsNumber }), raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not map the AppleSystem quotation'
    throw new AsApiError(msg, 422, 'QUOTATION_NOT_MAPPABLE')
  }
}

function resolveCountry(mapped: MappedBookingInput): OperationCountry {
  const country = mapped.operationCountry ?? detectCountryFromRef(mapped.bookingRef)
  if (!country) {
    throw new AsApiError(
      `Could not determine the destination country from IS number ${mapped.bookingRef}`,
      422,
      'COUNTRY_UNRESOLVED',
    )
  }
  return country
}

// ── CREATE ───────────────────────────────────────────────────────────────────

export interface CreateInput extends QuotationIdentifier {
  /** AppleSystem list-row id for the quotation. Required to pull the template. */
  reference_id?: string | null
}

/**
 * Import an AppleSystem quotation as a new ops booking. Idempotent: a second
 * call for the same IS number returns the existing booking with
 * `already_exists: true` rather than duplicating it.
 */
export async function createQuotationBooking(input: CreateInput, caller: AuthedCaller) {
  const quotationNo = input.quotation_no?.trim()
  const referenceId = input.reference_id?.trim()
  if (!quotationNo || !referenceId) {
    throw new AsApiError('quotation_no and reference_id are both required to create a booking', 422, 'IDENTIFIER_REQUIRED')
  }

  const { mapped, raw } = await pullQuotation(quotationNo, referenceId, input.is_number ?? null)
  const operationCountry = resolveCountry(mapped)
  const actorId = await getAutomationUserId()

  const { booking, alreadyExists } = await importMappedBooking(mapped, operationCountry, {
    createdById: actorId,
    cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
  })

  if (!alreadyExists) {
    // Keep the source payload so an amendment can be diffed against it later.
    await prisma.bookingVersion
      .create({
        data: {
          bookingId: booking.id,
          versionNo: 1,
          source: 'APPLESYSTEM_API',
          docSnapshot: JSON.stringify(raw).slice(0, 4_000_000),
          amendmentNote: `Created via AppleSystem API by ${caller.name}`,
          createdById: actorId,
        },
      })
      .catch((err) => console.error('[as-public-api] version snapshot failed:', err))
  }

  await writeAudit(actorId, caller, 'CREATE', booking, {
    quotation_no: quotationNo,
    reference_id: referenceId,
    already_exists: alreadyExists,
  })

  const full = await prisma.booking.findUnique({ where: { id: booking.id }, select: BOOKING_SUMMARY_SELECT })
  return {
    action: 'CREATE' as const,
    already_exists: alreadyExists,
    booking: full ? serializeBooking(full) : null,
    message: alreadyExists
      ? `Booking ${booking.bookingRef} already exists — nothing was changed.`
      : `Booking ${booking.bookingRef} created from quotation ${quotationNo}.`,
  }
}

// ── UPDATE ───────────────────────────────────────────────────────────────────

/** Statuses whose itinerary/hotels/pax may still be replaced wholesale. */
const EARLY_STATES: BookingStatus[] = ['DRAFT', 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED', 'GT_VERIFIED']

export interface UpdateInput extends QuotationIdentifier {
  /** Free-text note recorded on the amendment. */
  amendment_note?: string | null
  /**
   * Replace passengers / hotels / itinerary from the refreshed quotation even
   * when the booking has moved past the early stages. Off by default so a
   * revision cannot silently wipe operational detail on a live tour.
   */
  force_replace_details?: boolean
  /** Direct field overrides, applied when no AS template is pulled. */
  fields?: Record<string, unknown>
  /** Create the booking when the identifier matches nothing. Default false. */
  create_if_missing?: boolean
}

/**
 * Apply a revised quotation to an existing booking.
 *
 * With `quotation_no` + `reference_id` the fresh template is pulled from
 * AppleSystem and used as the source of truth. Without them, the caller's
 * `fields` object is applied directly — handy for a small correction that does
 * not warrant a full re-pull.
 */
export async function updateQuotationBooking(input: UpdateInput, caller: AuthedCaller) {
  const existing = await resolveBooking(input)

  if (!existing) {
    if (input.create_if_missing) {
      const created = await createQuotationBooking(input, caller)
      return { ...created, action: 'UPDATE' as const, created_instead: true }
    }
    throw new AsApiError(
      `No booking found for ${describeIdentifier(input)}. Send create_if_missing: true to import it instead.`,
      404,
      'BOOKING_NOT_FOUND',
    )
  }

  if (existing.status === 'CANCELLED') {
    throw new AsApiError(
      `Booking ${existing.bookingRef} is cancelled and can no longer be updated`,
      409,
      'BOOKING_CANCELLED',
    )
  }
  if (existing.status === 'COMPLETED') {
    throw new AsApiError(`Booking ${existing.bookingRef} is completed and can no longer be updated`, 409, 'BOOKING_COMPLETED')
  }

  const actorId = await getAutomationUserId()
  const quotationNo = input.quotation_no?.trim() || existing.cntlNumber || ''
  const referenceId = input.reference_id?.trim() || ''

  const data: Prisma.BookingUpdateInput = {}
  const changed: string[] = []
  let detailsReplaced = false
  let rawSnapshot: string | null = null

  if (quotationNo && referenceId) {
    // ── Source-of-truth path: re-pull the template from AppleSystem.
    const { mapped, raw } = await pullQuotation(quotationNo, referenceId, existing.isNumber)
    rawSnapshot = JSON.stringify(raw).slice(0, 4_000_000)

    if (normalizeIsNumber(mapped.bookingRef) !== normalizeIsNumber(existing.bookingRef)) {
      throw new AsApiError(
        `Quotation ${quotationNo} belongs to IS ${mapped.bookingRef}, not ${existing.bookingRef}`,
        409,
        'IDENTIFIER_MISMATCH',
      )
    }

    const country = resolveCountry(mapped)
    if (existing.operationCountry && !isInCountryScope(country, existing.operationCountry)) {
      throw new AsApiError(
        `The revised quotation is for ${country} but booking ${existing.bookingRef} operates in ${existing.operationCountry}`,
        409,
        'COUNTRY_MISMATCH',
      )
    }

    Object.assign(data, {
      cntlNumber: mapped.cntlNumber ?? existing.cntlNumber,
      agent: mapped.agent ?? existing.agent,
      fileHandler: mapped.fileHandler ?? existing.fileHandler,
      arrivalDate: new Date(mapped.arrivalDate),
      departureDate: new Date(mapped.departureDate),
      paxAdults: mapped.paxAdults,
      paxChildren: mapped.paxChildren,
      quotedTotal: mapped.quotedTotal,
      currency: mapped.currency,
      terms: mapped.terms,
      packageIncludes: mapped.packageIncludes,
      packageExcludes: mapped.packageExcludes,
      valueAddedServices: mapped.valueAddedServices,
      cancellationDeadline: getCancellationDeadline(mapped.arrivalDate),
      ...(mapped.contactEmail ? { contactEmail: mapped.contactEmail } : {}),
    })
    changed.push('header', 'dates', 'pax', 'pricing')

    const replaceOk = input.force_replace_details === true || EARLY_STATES.includes(existing.status)
    if (replaceOk) {
      // Child rows are owned by the quotation, so a revision replaces them.
      await prisma.$transaction([
        prisma.passenger.deleteMany({ where: { bookingId: existing.id } }),
        prisma.accommodation.deleteMany({ where: { bookingId: existing.id } }),
        prisma.itineraryItem.deleteMany({ where: { bookingId: existing.id } }),
        prisma.emergencyContact.deleteMany({ where: { bookingId: existing.id } }),
      ])
      Object.assign(data, {
        passengers: {
          create: mapped.passengers.map((p) => ({
            name: p.name,
            type: p.type,
            age: p.age,
            isLead: p.isLead,
            passport: p.passport || null,
            nationality: p.nationality || null,
          })),
        },
        accommodations: {
          create: mapped.accommodations.map((a) => ({
            city: a.city,
            hotel: a.hotel,
            checkIn: new Date(a.checkIn),
            checkOut: new Date(a.checkOut),
            nights: a.nights,
            roomType: a.roomType,
            mealType: a.mealType,
            address: a.address || null,
          })),
        },
        itineraryItems: {
          create: mapped.itineraryItems.map((i) => ({
            dayNo: i.dayNo,
            date: new Date(i.date),
            title: i.title,
            description: i.description || null,
          })),
        },
        emergencyContacts: {
          create: mapped.emergencyContacts.map((e) => ({
            name: e.name,
            phone: e.phone || null,
            role: e.role || null,
          })),
        },
      })
      detailsReplaced = true
      changed.push('passengers', 'accommodations', 'itinerary')
    }
  } else {
    // ── Patch path: apply only the fields the caller sent.
    const f = input.fields ?? {}
    const setDate = (key: 'arrivalDate' | 'departureDate', value: unknown) => {
      const d = new Date(String(value))
      if (isNaN(d.getTime())) throw new AsApiError(`${key} is not a valid date`, 422, 'INVALID_FIELD')
      ;(data as Record<string, unknown>)[key] = d
      changed.push(key)
    }
    const setInt = (key: 'paxAdults' | 'paxChildren' | 'paxInfants', value: unknown) => {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) throw new AsApiError(`${key} must be a positive number`, 422, 'INVALID_FIELD')
      ;(data as Record<string, unknown>)[key] = Math.round(n)
      changed.push(key)
    }
    const setText = (key: string, value: unknown) => {
      ;(data as Record<string, unknown>)[key] = value === null ? null : String(value)
      changed.push(key)
    }

    if (f.arrival_date !== undefined) setDate('arrivalDate', f.arrival_date)
    if (f.departure_date !== undefined) setDate('departureDate', f.departure_date)
    if (f.pax_adults !== undefined) setInt('paxAdults', f.pax_adults)
    if (f.pax_children !== undefined) setInt('paxChildren', f.pax_children)
    if (f.pax_infants !== undefined) setInt('paxInfants', f.pax_infants)
    if (f.quoted_total !== undefined) {
      const n = Number(f.quoted_total)
      if (!Number.isFinite(n) || n < 0) throw new AsApiError('quoted_total must be a positive number', 422, 'INVALID_FIELD')
      data.quotedTotal = n
      changed.push('quotedTotal')
    }
    if (f.currency !== undefined) setText('currency', String(f.currency).toUpperCase().slice(0, 8))
    if (f.agent !== undefined) setText('agent', f.agent)
    if (f.file_handler !== undefined) setText('fileHandler', f.file_handler)
    if (f.contact_email !== undefined) setText('contactEmail', f.contact_email)
    if (f.contact_phone !== undefined) setText('contactPhone', f.contact_phone)
    if (f.package_includes !== undefined) setText('packageIncludes', f.package_includes)
    if (f.package_excludes !== undefined) setText('packageExcludes', f.package_excludes)
    if (f.important_notes !== undefined) setText('importantNotes', f.important_notes)
    if (f.quotation_no !== undefined) setText('cntlNumber', f.quotation_no)

    if (changed.length === 0) {
      throw new AsApiError(
        'Nothing to update — send quotation_no + reference_id to re-pull from AppleSystem, or a non-empty fields object',
        422,
        'NOTHING_TO_UPDATE',
      )
    }
  }

  const note = input.amendment_note?.trim() || `Quotation revised in AppleSystem by ${caller.name}`
  const nextVersion = existing.version + 1
  data.version = nextVersion
  data.amendmentNote = note

  const updated = await prisma.booking.update({
    where: { id: existing.id },
    data,
    select: BOOKING_SUMMARY_SELECT,
  })

  await Promise.all([
    prisma.bookingVersion
      .create({
        data: {
          bookingId: existing.id,
          versionNo: nextVersion,
          source: 'APPLESYSTEM_API',
          docSnapshot: rawSnapshot,
          amendmentNote: note,
          createdById: actorId,
        },
      })
      .catch((err) => console.error('[as-public-api] version snapshot failed:', err)),
    prisma.statusEvent.create({
      data: {
        bookingId: existing.id,
        fromState: existing.status,
        toState: existing.status,
        actorId,
        note: `AppleSystem API update (v${nextVersion}) — ${note}${detailsReplaced ? ' [itinerary/hotels/passengers replaced]' : ''}`,
      },
    }),
  ])

  await writeAudit(actorId, caller, 'UPDATE', existing, {
    quotation_no: quotationNo || null,
    changed,
    details_replaced: detailsReplaced,
    version: nextVersion,
  })

  return {
    action: 'UPDATE' as const,
    booking: serializeBooking(updated),
    changed_fields: changed,
    details_replaced: detailsReplaced,
    version: nextVersion,
    message:
      `Booking ${updated.bookingRef} updated to version ${nextVersion}.` +
      (!detailsReplaced && quotationNo && referenceId
        ? ` Itinerary, hotels and passengers were left untouched because the booking is already at ${existing.status} — resend with force_replace_details: true to overwrite them.`
        : ''),
  }
}

// ── CANCEL ───────────────────────────────────────────────────────────────────

export interface CancelInput extends QuotationIdentifier {
  reason?: string | null
  /** Either a single number, or itemised lines: [{ note, amount }]. Optional. */
  cancellation_fee?: number | string | null
  cancellation_fees?: unknown
  currency?: string | null
  /** Skip the customer/ops cancellation email. Default false. */
  suppress_email?: boolean
  /** Who asked for it on the AS side — recorded on the booking. */
  cancelled_by?: string | null
  cancelled_by_email?: string | null
}

/**
 * Cancel the booking behind a quotation, straight to `CANCELLED`.
 *
 * This deliberately bypasses the internal PENDING_CANCELLATION → accounts
 * approval loop: the cancellation already happened in AppleSystem, which is the
 * commercial source of truth, so ops is being told, not asked. The accounts
 * trail is still filled in (marked as auto-approved) so the cancellation
 * reports read the same as a manual one.
 */
export async function cancelQuotationBooking(input: CancelInput, caller: AuthedCaller) {
  const booking = await requireBooking(input)
  const actorId = await getAutomationUserId()

  // Fees: accept a flat amount, itemised lines, or nothing at all.
  let feeLines: CancellationFeeLine[] = sanitizeCancellationFees(input.cancellation_fees)
  if (!feeLines.length && input.cancellation_fee !== undefined && input.cancellation_fee !== null && input.cancellation_fee !== '') {
    const amount = Number(input.cancellation_fee)
    if (!Number.isFinite(amount) || amount < 0) {
      throw new AsApiError('cancellation_fee must be a positive number', 422, 'INVALID_FEE')
    }
    if (amount > 0) feeLines = [{ note: 'Cancellation fee (AppleSystem)', amount: Math.round(amount * 100) / 100 }]
  }
  const feeTotal = totalCancellationFee(feeLines)
  const reason = input.reason?.trim() || 'Quotation cancelled in AppleSystem'
  const cancelledByName = input.cancelled_by?.trim() || caller.name
  const cancelledByEmail = input.cancelled_by_email?.trim() || ''

  // Already cancelled → idempotent no-op, so an AS retry is always safe.
  if (booking.status === 'CANCELLED') {
    await writeAudit(actorId, caller, 'CANCEL_NOOP', booking, { reason, already_cancelled: true })
    const current = await prisma.booking.findUnique({ where: { id: booking.id }, select: BOOKING_SUMMARY_SELECT })
    return {
      action: 'CANCEL' as const,
      already_cancelled: true,
      booking: current ? serializeBooking(current) : null,
      cancellation_fee_total: current?.cancellationFeeTotal ? Number(current.cancellationFeeTotal) : 0,
      email_sent: false,
      message: `Booking ${booking.bookingRef} was already cancelled — nothing was changed.`,
    }
  }

  const previousStatus = booking.status
  const cancellable = CANCELLABLE_STATES.includes(previousStatus) || previousStatus === 'PENDING_CANCELLATION'
  if (!cancellable) {
    throw new AsApiError(
      `Booking ${booking.bookingRef} is in ${previousStatus} and cannot be cancelled`,
      409,
      'NOT_CANCELLABLE',
    )
  }

  const now = new Date()
  const [updated] = await prisma.$transaction([
    prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelPrevStatus: previousStatus === 'PENDING_CANCELLATION' ? undefined : previousStatus,
        cancelRequestedAt: now,
        cancelledAt: now,
        cancelledById: actorId,
        cancelledByName,
        cancelledByEmail,
        cancellationReason: reason,
        cancellationFees: feeLines as unknown as Prisma.InputJsonValue,
        cancellationFeeTotal: feeTotal,
        // Auto-approved: AppleSystem already made the commercial decision.
        cancelDecidedAt: now,
        cancelDecidedByName: 'AppleSystem (automatic)',
        cancelDecidedByEmail: cancelledByEmail,
        cancelDecisionNote: `Cancelled automatically via the AppleSystem API by ${caller.name}`,
        ...(input.currency ? { currency: String(input.currency).toUpperCase().slice(0, 8) } : {}),
      },
      select: BOOKING_SUMMARY_SELECT,
    }),
    prisma.statusEvent.create({
      data: {
        bookingId: booking.id,
        fromState: previousStatus,
        toState: 'CANCELLED',
        actorId,
        note:
          `Cancelled automatically from AppleSystem (${describeIdentifier(input)}). Reason: ${reason}` +
          (feeTotal > 0 ? ` — cancellation fee ${booking.currency} ${feeTotal.toFixed(2)}` : ' — no cancellation fee'),
      },
    }),
  ])

  // Notification is best-effort: a mail failure must never leave the booking
  // half-cancelled, so it comes back as a flag on the response instead.
  let emailSent = false
  if (!input.suppress_email) {
    try {
      const lead = await prisma.passenger.findFirst({
        where: { bookingId: booking.id, isLead: true },
        select: { name: true },
      })
      await sendCancellationEmail({
        bookingRef: updated.bookingRef,
        isNumber: updated.isNumber,
        agent: updated.agent,
        agentBookingId: null,
        fileHandler: updated.fileHandler,
        leadPassenger: lead?.name ?? null,
        arrivalDate: updated.arrivalDate,
        departureDate: updated.departureDate,
        paxAdults: updated.paxAdults,
        paxChildren: updated.paxChildren,
        paxInfants: updated.paxInfants,
        quotedTotal: updated.quotedTotal ? updated.quotedTotal.toString() : null,
        currency: updated.currency,
        operationCountry: updated.operationCountry,
        previousStatus,
        cancelledByName,
        cancelledByEmail,
        reason,
        cancelledAt: now,
        approvedByName: 'AppleSystem (automatic)',
        approvedByEmail: cancelledByEmail,
        approvedAt: now,
        approvalNote: feeTotal > 0 ? `Cancellation fee: ${updated.currency} ${feeTotal.toFixed(2)}` : 'No cancellation fee',
      })
      emailSent = true
      await prisma.booking.update({ where: { id: booking.id }, data: { cancelMailSentAt: new Date() } })
    } catch (err) {
      console.error(`[as-public-api] cancellation email failed for ${updated.bookingRef}:`, err)
    }
  }

  await writeAudit(actorId, caller, 'CANCEL', booking, {
    previous_status: previousStatus,
    reason,
    fee_total: feeTotal,
    email_sent: emailSent,
  })

  return {
    action: 'CANCEL' as const,
    already_cancelled: false,
    booking: serializeBooking(updated),
    previous_status: previousStatus,
    cancellation_fee_total: feeTotal,
    cancellation_fees: feeLines,
    email_sent: emailSent,
    message:
      `Booking ${updated.bookingRef} has been cancelled automatically.` +
      (feeTotal > 0 ? ` Cancellation fee ${updated.currency} ${feeTotal.toFixed(2)} recorded.` : '') +
      (!emailSent && !input.suppress_email ? ' The cancellation notice email could not be sent.' : ''),
  }
}
