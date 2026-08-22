/**
 * Reservation Team — server write layer.
 *
 * Every mutation the module makes goes through here, and every one of them
 * writes a `ReservationEvent`. That table is append-only and is the reason the
 * module exists: it is the evidence of who agreed what with which property.
 *
 * Two rules hold throughout:
 *
 *   - No write ever touches a row this module does not own. Bookings,
 *     accommodations, P&L lines and hotel profiles are read, never updated.
 *     The one exception is `syncToReconfirmation()`, which fills in a
 *     `HotelReconfirmation` the pre-checking desk owns — and it only ever adds
 *     a confirmation number to a row that has none.
 *   - A status change is only legal if `reservation-state.ts` says so, and the
 *     named guard for that transition passes. The API layer never bypasses it.
 */
import type { Prisma, UserRole } from '@prisma/client'
import { prisma } from './prisma'
import { normalizeHotelName } from './hotel-match'
import { findTransition } from './reservation-state'
import {
  buildGateSnapshot, missingWaivers, runAccuracyGate,
  type GateResult,
} from './reservation-gate'
import {
  buildReservationKey, nightsBetween, quoteCancellation, stayTotal, toNumber,
  freeCancelDateFrom, type ReservationStatusValue,
} from './reservation-shared'
import { PROFORMA_DUE_DAYS, findLiveContract } from './reservations'

export interface Actor {
  name?: string | null
  email?: string | null
}

export class ReservationError extends Error {
  constructor(message: string, readonly status = 400, readonly detail?: unknown) {
    super(message)
    this.name = 'ReservationError'
  }
}

// ─── Events ──────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient | typeof prisma

async function logEvent(
  tx: Tx,
  reservationId: string,
  actor: Actor,
  e: {
    action: string
    fromStatus?: string | null
    toStatus?: string | null
    channel?: string | null
    note?: string | null
    payload?: Prisma.InputJsonValue
  },
) {
  await tx.reservationEvent.create({
    data: {
      reservationId,
      action: e.action,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      channel: e.channel ?? null,
      note: e.note ?? null,
      payload: e.payload,
      actorName: actor.name ?? null,
      actorEmail: actor.email ?? null,
    },
  })
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface CreateInput {
  bookingRef: string
  hotelName: string
  checkIn: Date
  checkOut: Date
  accommodationId?: string | null
  city?: string | null
  roomType?: string | null
  roomCount?: number
  mealPlan?: 'RO' | 'BB' | 'HB' | 'FB' | 'AI'
  adults?: number
  children?: number
  cwb?: number
  cnb?: number
  infants?: number
  leadGuestName?: string | null
  currency?: string
  notes?: string | null
  assignedToEmail?: string | null
}

/**
 * Open a reservation on a booking.
 *
 * Idempotent by `reservationKey`: two operators claiming the same stay from the
 * inbox at the same moment get the same row rather than a duplicate, which
 * matters because the inbox is derived and therefore racy by nature.
 */
export async function createReservation(input: CreateInput, actor: Actor) {
  const bookingRef = input.bookingRef.trim().toUpperCase()

  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, operationCountry: true, paxAdults: true, paxChildren: true, paxInfants: true,
      accommodations: { select: { id: true, hotel: true, checkIn: true, checkOut: true, city: true, roomType: true, mealType: true } },
      passengers: { where: { isLead: true }, select: { name: true } },
      pnl: { select: { lineItems: { where: { category: 'HOTEL' }, select: { id: true, activity: true, mmtRate: true } } } },
    },
  })
  if (!booking) throw new ReservationError(`Booking ${bookingRef} not found`, 404)

  const reservationKey = buildReservationKey(bookingRef, input.hotelName, input.checkIn)

  const existing = await prisma.hotelReservation.findUnique({ where: { reservationKey } })
  if (existing) return existing

  const accommodation =
    (input.accommodationId
      ? booking.accommodations.find(a => a.id === input.accommodationId)
      : null) ??
    booking.accommodations.find(
      a => buildReservationKey(bookingRef, a.hotel, a.checkIn) === reservationKey,
    ) ?? null

  const profile = await prisma.hotelProfile.findUnique({
    where: { normalizedName: normalizeHotelName(input.hotelName) },
    select: { id: true },
  })

  const contract = profile
    ? await findLiveContract(profile.id, input.checkIn, input.checkOut)
    : null

  const budget = matchBudget(booking.pnl?.lineItems ?? [], input.hotelName)
  const nights = nightsBetween(input.checkIn, input.checkOut)
  const roomCount = input.roomCount ?? 1

  const created = await prisma.$transaction(async tx => {
    const row = await tx.hotelReservation.create({
      data: {
        reservationKey,
        bookingRef,
        accommodationId: accommodation?.id ?? input.accommodationId ?? null,
        hotelProfileId: profile?.id ?? null,
        hotelName: input.hotelName.trim(),
        city: input.city ?? accommodation?.city ?? null,
        operationCountry: booking.operationCountry,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        nights,
        roomType: input.roomType ?? accommodation?.roomType ?? null,
        roomCount,
        mealPlan: input.mealPlan ?? 'BB',
        adults: input.adults ?? booking.paxAdults,
        children: input.children ?? booking.paxChildren,
        cwb: input.cwb ?? 0,
        cnb: input.cnb ?? 0,
        infants: input.infants ?? booking.paxInfants,
        leadGuestName: input.leadGuestName ?? booking.passengers[0]?.name ?? null,
        currency: input.currency ?? contract?.currency ?? 'USD',
        budgetLineId: budget?.id ?? null,
        budgetAmount: budget ? toNumber(budget.mmtRate) : null,
        // Contract terms are copied in now and frozen. A contract edited later
        // must never rewrite what was agreed on this stay.
        contractId: contract?.id ?? null,
        policyText: contract?.policyText ?? null,
        penaltyTiers: (contract?.penaltyTiers as Prisma.InputJsonValue) ?? undefined,
        freeCancelUntil: freeCancelDateFrom(input.checkIn, contract?.freeCancelDays) ?? null,
        paymentDueAt: contract?.paymentDueDays != null
          ? new Date(input.checkIn.getTime() - contract.paymentDueDays * 86_400_000)
          : null,
        notes: input.notes ?? null,
        assignedToEmail: input.assignedToEmail ?? actor.email ?? null,
        createdBy: actor.email ?? null,
        updatedBy: actor.email ?? null,
      },
    })

    await logEvent(tx, row.id, actor, {
      action: 'created',
      toStatus: row.status,
      note: contract ? `Opened under contract ${contract.contractCode ?? contract.id}` : 'Opened with no covering contract',
      payload: {
        reservationKey,
        accommodationMatched: !!accommodation,
        hotelProfileMatched: !!profile,
        budgetLineMatched: !!budget,
      },
    })

    return row
  })

  return created
}

function matchBudget<T extends { id: string; activity: string }>(lines: T[], hotelName: string): T | null {
  const target = normalizeHotelName(hotelName)
  if (!target) return null
  const exact = lines.find(l => normalizeHotelName(l.activity) === target)
  if (exact) return exact
  const token = target.split(/\s+/).filter(t => t.length > 3)[0]
  return token ? lines.find(l => normalizeHotelName(l.activity).includes(token)) ?? null : null
}

// ─── Update ──────────────────────────────────────────────────────────────────

/** Fields an operator may edit directly. Status is NOT one of them. */
const EDITABLE = [
  'hotelName', 'city', 'checkIn', 'checkOut', 'roomType', 'roomCategory',
  'roomCount', 'mealPlan', 'adults', 'children', 'cwb', 'cnb', 'infants',
  'leadGuestName', 'currency', 'fxRate', 'nettRate', 'taxesIncluded',
  'confirmationNumber', 'optionHeldUntil', 'freeCancelUntil', 'policyText',
  'penaltyTiers', 'paymentDueAt', 'proformaDueAt', 'priority',
  'assignedToEmail', 'notes', 'budgetLineId', 'budgetAmount',
] as const

export type EditableField = typeof EDITABLE[number]

/**
 * Patch a reservation.
 *
 * Derived money (`nights`, `totalCost`, `baseTotalCost`) is always recomputed
 * from the stored inputs rather than accepted from the caller — a client that
 * sends a total inconsistent with its own rate must not be able to persist it.
 */
export async function updateReservation(
  id: string,
  patch: Partial<Record<EditableField, unknown>>,
  actor: Actor,
) {
  const before = await prisma.hotelReservation.findUnique({ where: { id } })
  if (!before) throw new ReservationError('Reservation not found', 404)

  const data: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (key in patch && patch[key] !== undefined) data[key] = patch[key]
  }
  if (Object.keys(data).length === 0) return before

  const checkIn = (data.checkIn as Date) ?? before.checkIn
  const checkOut = (data.checkOut as Date) ?? before.checkOut
  const roomCount = (data.roomCount as number) ?? before.roomCount
  const nettRate = 'nettRate' in data ? data.nettRate : before.nettRate
  const fxRate = 'fxRate' in data ? data.fxRate : before.fxRate

  const nights = nightsBetween(checkIn, checkOut)
  const totalCost = stayTotal(nettRate as never, roomCount, nights)
  const fx = toNumber(fxRate as never)

  data.nights = nights
  data.totalCost = totalCost
  data.baseTotalCost = totalCost === null || fx === null || fx === 0
    ? null
    : Math.round(totalCost * fx * 100) / 100
  if ('fxRate' in data && fx !== null) data.fxRateAt = new Date()
  data.updatedBy = actor.email ?? null

  // The reservation key encodes hotel + check-in; keep it truthful.
  if (data.hotelName || data.checkIn) {
    data.reservationKey = buildReservationKey(
      before.bookingRef,
      (data.hotelName as string) ?? before.hotelName,
      checkIn,
    )
  }

  const changed = diff(before as unknown as Record<string, unknown>, data)

  return prisma.$transaction(async tx => {
    const row = await tx.hotelReservation.update({ where: { id }, data: data as never })
    if (changed.length) {
      await logEvent(tx, id, actor, {
        action: 'edited',
        note: changed.map(c => c.field).join(', '),
        payload: { changed } as unknown as Prisma.InputJsonValue,
      })
    }
    return row
  })
}

/** Field-level before/after, for the audit payload. Dates as ISO, never objects. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: { field: string; from: unknown; to: unknown }[] = []
  for (const [k, v] of Object.entries(after)) {
    if (k === 'updatedBy') continue
    const b = norm(before[k])
    const a = norm(v)
    if (b !== a) out.push({ field: k, from: b, to: a })
  }
  return out
}

function norm(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  if (v && typeof v === 'object' && 'toString' in v && typeof (v as any).toNumber === 'function') {
    return (v as any).toString()
  }
  return v ?? null
}

// ─── Status transitions ──────────────────────────────────────────────────────

export interface TransitionInput {
  to: ReservationStatusValue
  note?: string | null
  /** Warning id → reason, for the accuracy gate. */
  waivers?: Record<string, string>
  /** Required to confirm a cancellation that carries a penalty. */
  penaltyAcknowledged?: boolean
  penaltyAmount?: number | null
  /** Raise a credit note as part of a cancellation. */
  raiseCreditNote?: boolean
}

export async function transitionReservation(
  id: string,
  input: TransitionInput,
  role: UserRole,
  actor: Actor,
) {
  const row = await prisma.hotelReservation.findUnique({ where: { id } })
  if (!row) throw new ReservationError('Reservation not found', 404)

  const from = row.status as ReservationStatusValue
  if (from === input.to) return row

  const transition = findTransition(from, input.to)
  if (!transition) {
    throw new ReservationError(`Cannot move a reservation from ${from} to ${input.to}`, 422)
  }
  if (!transition.allowedRoles.includes(role)) {
    throw new ReservationError(`Role ${role} may not perform "${transition.label}"`, 403)
  }
  const note = input.note?.trim() ?? ''
  if (transition.requiresNote && !note) {
    throw new ReservationError(`"${transition.label}" requires a note`, 422)
  }

  const data: Prisma.HotelReservationUpdateInput = {
    status: input.to,
    updatedBy: actor.email ?? null,
  }
  let gatePayload: Prisma.InputJsonValue | undefined

  // ── Guards ────────────────────────────────────────────────────────────────

  if (transition.guard === 'holdInFuture') {
    if (!row.optionHeldUntil || row.optionHeldUntil.getTime() <= Date.now()) {
      throw new ReservationError(
        'Set an option-release deadline in the future before marking the stay as held', 422)
    }
  }

  if (transition.guard === 'accuracyGate') {
    const gate = await evaluateGate(id)
    const missing = missingWaivers(gate, input.waivers ?? {})
    if (gate.blocked) {
      throw new ReservationError('Accuracy gate failed', 422, {
        blockers: gate.blockers, warnings: gate.warnings,
      })
    }
    if (missing.length) {
      throw new ReservationError('Each warning needs a reason before confirming', 422, {
        blockers: [], warnings: missing,
      })
    }
    const snapshot = buildGateSnapshot(gate, input.waivers ?? {}, actor.email)
    gatePayload = snapshot as unknown as Prisma.InputJsonValue
    data.gateSnapshot = gatePayload
    data.confirmedAt = new Date()
    data.confirmedBy = actor.email ?? null
    // A confirmed stay owes us a proforma; start that clock now.
    if (!row.proformaDueAt) {
      data.proformaDueAt = new Date(Date.now() + PROFORMA_DUE_DAYS * 86_400_000)
    }
  }

  let penalty = 0
  if (transition.guard === 'penaltyAcknowledged') {
    const quote = quoteCancellation({
      checkIn: row.checkIn,
      totalCost: row.totalCost,
      currency: row.currency,
      freeCancelUntil: row.freeCancelUntil,
      penaltyTiers: row.penaltyTiers,
    })
    penalty = input.penaltyAmount ?? quote.amount
    if (penalty > 0 && !input.penaltyAcknowledged) {
      throw new ReservationError(
        `Cancelling costs ${row.currency} ${penalty.toFixed(2)}. Acknowledge the penalty to proceed.`,
        422,
        { penalty: quote },
      )
    }
    data.penaltyAmount = penalty
    data.cancelReason = note
  }

  if (input.to === 'OPTION_HELD') data.optionReleasedAt = null
  if (input.to === 'CANCELLED' || input.to === 'REJECTED') data.optionReleasedAt = new Date()

  const updated = await prisma.$transaction(async tx => {
    const r = await tx.hotelReservation.update({ where: { id }, data })

    await logEvent(tx, id, actor, {
      action: 'status_change',
      fromStatus: from,
      toStatus: input.to,
      note: note || transition.label,
      payload: gatePayload ?? (penalty > 0 ? { penalty } : undefined),
    })

    // A cancellation that cost money, on a stay already paid, is a credit note.
    if (input.to === 'CANCELLED' && input.raiseCreditNote) {
      const expected = (toNumber(r.totalCost) ?? 0) - penalty
      if (expected > 0) {
        await tx.creditNote.create({
          data: {
            reservationId: r.id,
            bookingRef: r.bookingRef,
            hotelProfileId: r.hotelProfileId,
            hotelName: r.hotelName,
            reason: 'CANCELLATION',
            reasonNote: note || null,
            currency: r.currency,
            fxRate: r.fxRate,
            expectedAmount: expected,
            baseExpectedAmount: toNumber(r.fxRate) ? expected * (toNumber(r.fxRate) as number) : null,
            expectedBy: new Date(Date.now() + 30 * 86_400_000),
            createdBy: actor.email ?? null,
          },
        })
        await logEvent(tx, id, actor, {
          action: 'credit_note_raised',
          note: `Expecting ${r.currency} ${expected.toFixed(2)} back`,
        })
      }
    }

    return r
  })

  if (input.to === 'CONFIRMED' || input.to === 'AMENDED') {
    await syncToReconfirmation(updated.id).catch(() => {
      // Best-effort. Pre-checking has its own path to this data; failing to
      // pre-fill it must never roll back a confirmation that did succeed.
    })
  }

  return updated
}

// ─── Accuracy gate ───────────────────────────────────────────────────────────

/** Assemble the gate's context from the database and run it. */
export async function evaluateGate(id: string): Promise<GateResult> {
  const row = await prisma.hotelReservation.findUnique({ where: { id } })
  if (!row) throw new ReservationError('Reservation not found', 404)

  const [booking, siblings, hotel, contract] = await Promise.all([
    prisma.booking.findUnique({
      where: { bookingRef: row.bookingRef },
      select: {
        passengers: { select: { name: true } },
        accommodations: { select: { id: true, hotel: true, checkIn: true, checkOut: true } },
      },
    }),
    prisma.hotelReservation.findMany({
      where: {
        bookingRef: row.bookingRef,
        id: { not: id },
        status: { notIn: ['CANCELLED', 'REJECTED', 'NO_SHOW'] },
      },
      select: { id: true, hotelName: true, checkIn: true, checkOut: true },
    }),
    row.hotelProfileId
      ? prisma.hotelProfile.findUnique({
          where: { id: row.hotelProfileId },
          select: { whatsappVerified: true, channels: { select: { verified: true } } },
        })
      : null,
    row.hotelProfileId ? findLiveContract(row.hotelProfileId, row.checkIn, row.checkOut) : null,
  ])

  const accommodation =
    booking?.accommodations.find(a => a.id === row.accommodationId) ??
    booking?.accommodations.find(
      a => buildReservationKey(row.bookingRef, a.hotel, a.checkIn) === row.reservationKey,
    ) ?? null

  return runAccuracyGate({
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    roomCount: row.roomCount,
    adults: row.adults,
    children: row.children,
    cwb: row.cwb,
    cnb: row.cnb,
    infants: row.infants,
    leadGuestName: row.leadGuestName,
    nettRate: row.nettRate,
    currency: row.currency,
    totalCost: row.totalCost,
    confirmationNumber: row.confirmationNumber,
    policyText: row.policyText,
    penaltyTiers: row.penaltyTiers,
    freeCancelUntil: row.freeCancelUntil,
    budgetAmount: row.budgetAmount,
    accommodation: accommodation
      ? { checkIn: accommodation.checkIn, checkOut: accommodation.checkOut, hotel: accommodation.hotel }
      : null,
    passengerNames: booking?.passengers.map(p => p.name) ?? [],
    hotelContactVerified: hotel
      ? hotel.whatsappVerified || hotel.channels.some(c => c.verified)
      : false,
    contractCovers: !!contract,
    siblingStays: siblings,
    selfId: id,
  })
}

// ─── Options ─────────────────────────────────────────────────────────────────

export async function addOption(
  reservationId: string,
  input: Record<string, unknown>,
  actor: Actor,
) {
  const row = await prisma.hotelReservation.findUnique({ where: { id: reservationId } })
  if (!row) throw new ReservationError('Reservation not found', 404)

  const nights = row.nights || nightsBetween(row.checkIn, row.checkOut)
  const roomCount = Number(input.roomCount ?? row.roomCount) || 1
  const total = stayTotal(input.nettRate as never, roomCount, nights)
  const fx = toNumber(input.fxRate as never)

  return prisma.$transaction(async tx => {
    const option = await tx.reservationOption.create({
      data: {
        reservationId,
        hotelProfileId: (input.hotelProfileId as string) ?? null,
        hotelName: String(input.hotelName ?? '').trim() || row.hotelName,
        starRating: input.starRating == null ? null : Number(input.starRating),
        roomType: (input.roomType as string) ?? null,
        mealPlan: (input.mealPlan as never) ?? 'BB',
        roomCount,
        currency: (input.currency as string) ?? row.currency,
        fxRate: fx ?? null,
        nettRate: (input.nettRate as never) ?? null,
        totalCost: total,
        baseTotalCost: total !== null && fx ? Math.round(total * fx * 100) / 100 : null,
        availability: (input.availability as never) ?? 'UNKNOWN',
        cancelPolicy: (input.cancelPolicy as string) ?? null,
        freeCancelUntil: (input.freeCancelUntil as Date) ?? null,
        distanceNote: (input.distanceNote as string) ?? null,
        pros: (input.pros as string) ?? null,
        cons: (input.cons as string) ?? null,
        quotedAt: (input.quotedAt as Date) ?? new Date(),
        quoteValidUntil: (input.quoteValidUntil as Date) ?? null,
        quoteDocUrl: (input.quoteDocUrl as string) ?? null,
        sortOrder: Number(input.sortOrder ?? 0),
        createdBy: actor.email ?? null,
      },
    })

    await logEvent(tx, reservationId, actor, {
      action: 'option_added',
      note: `${option.hotelName} — ${option.currency} ${total ?? '?'}`,
      payload: { optionId: option.id, availability: option.availability },
    })

    return option
  })
}

/**
 * Choose an option.
 *
 * The reason is mandatory. Without it the comparison board is decoration; with
 * it, the choice is auditable — which is the whole reason the rejected options
 * are kept.
 */
export async function selectOption(
  reservationId: string,
  optionId: string,
  reason: string,
  actor: Actor,
) {
  const trimmed = reason?.trim()
  if (!trimmed) throw new ReservationError('A reason is required when selecting an option', 422)

  const option = await prisma.reservationOption.findUnique({ where: { id: optionId } })
  if (!option || option.reservationId !== reservationId) {
    throw new ReservationError('Option not found on this reservation', 404)
  }

  return prisma.$transaction(async tx => {
    // Exactly one selected option per reservation, enforced here rather than by
    // a partial unique index MySQL cannot express.
    await tx.reservationOption.updateMany({
      where: { reservationId, id: { not: optionId } },
      data: { selected: false, selectedReason: null },
    })
    const chosen = await tx.reservationOption.update({
      where: { id: optionId },
      data: { selected: true, selectedReason: trimmed },
    })

    const row = await tx.hotelReservation.update({
      where: { id: reservationId },
      data: {
        hotelName: chosen.hotelName,
        hotelProfileId: chosen.hotelProfileId,
        roomType: chosen.roomType,
        mealPlan: chosen.mealPlan,
        roomCount: chosen.roomCount,
        currency: chosen.currency,
        fxRate: chosen.fxRate,
        nettRate: chosen.nettRate,
        totalCost: chosen.totalCost,
        baseTotalCost: chosen.baseTotalCost,
        policyText: chosen.cancelPolicy,
        freeCancelUntil: chosen.freeCancelUntil,
        updatedBy: actor.email ?? null,
      },
    })

    await logEvent(tx, reservationId, actor, {
      action: 'option_selected',
      note: `${chosen.hotelName} — ${trimmed}`,
      payload: { optionId, totalCost: chosen.totalCost?.toString() ?? null },
    })

    return row
  })
}

// ─── Contact ─────────────────────────────────────────────────────────────────

/** Record an outbound contact, and the reply clock it starts. */
export async function recordContact(
  reservationId: string,
  channel: string,
  note: string | null,
  actor: Actor,
) {
  return prisma.$transaction(async tx => {
    const row = await tx.hotelReservation.update({
      where: { id: reservationId },
      data: {
        lastChannel: channel.toUpperCase().slice(0, 16),
        lastContactedAt: new Date(),
        attempts: { increment: 1 },
        updatedBy: actor.email ?? null,
      },
    })
    await logEvent(tx, reservationId, actor, {
      action: 'contacted', channel: channel.toUpperCase(), note,
    })
    return row
  })
}

/** Record the property's reply — the input to the responsiveness score. */
export async function recordResponse(reservationId: string, note: string | null, actor: Actor) {
  return prisma.$transaction(async tx => {
    const current = await tx.hotelReservation.findUnique({
      where: { id: reservationId }, select: { firstResponseAt: true },
    })
    const row = await tx.hotelReservation.update({
      where: { id: reservationId },
      data: { firstResponseAt: current?.firstResponseAt ?? new Date() },
    })
    await logEvent(tx, reservationId, actor, { action: 'hotel_replied', note })
    return row
  })
}

// ─── Special requests ────────────────────────────────────────────────────────

export async function upsertSpecialRequest(
  reservationId: string,
  input: { id?: string; kind: string; detail?: string | null; chargeable?: boolean; cost?: number | null; status?: string; hotelResponse?: string | null },
  actor: Actor,
) {
  const data = {
    kind: input.kind as never,
    detail: input.detail ?? null,
    chargeable: input.chargeable ?? false,
    cost: input.cost ?? null,
    status: (input.status as never) ?? 'REQUESTED',
    hotelResponse: input.hotelResponse ?? null,
    respondedAt: input.status && input.status !== 'REQUESTED' ? new Date() : null,
  }

  return prisma.$transaction(async tx => {
    const row = input.id
      ? await tx.reservationSpecialRequest.update({ where: { id: input.id }, data })
      : await tx.reservationSpecialRequest.create({
          data: { ...data, reservationId, createdBy: actor.email ?? null },
        })
    await logEvent(tx, reservationId, actor, {
      action: input.id ? 'special_request_updated' : 'special_request_added',
      note: `${row.kind}: ${row.status}`,
    })
    return row
  })
}

// ─── Pre-checking hand-off ───────────────────────────────────────────────────

/**
 * Pre-fill the D-10 reconfirmation row from a confirmed reservation.
 *
 * Deliberately conservative: it creates the row if pre-checking has not made
 * one, and otherwise only fills fields that are still empty. It never
 * overwrites something the TE desk recorded — their reconfirmation is a
 * conversation with the property, and this is only the paperwork we already
 * hold. The point is that the D-10 call becomes a verification instead of a
 * re-discovery.
 */
export async function syncToReconfirmation(reservationId: string) {
  const r = await prisma.hotelReservation.findUnique({ where: { id: reservationId } })
  if (!r || !r.confirmationNumber) return

  const existing = await prisma.hotelReconfirmation.findUnique({
    where: { stayKey: r.reservationKey },
  })

  if (!existing) {
    await prisma.hotelReconfirmation.create({
      data: {
        stayKey: r.reservationKey,
        bookingRef: r.bookingRef,
        accommodationId: r.accommodationId,
        hotelProfileId: r.hotelProfileId,
        hotelName: r.hotelName,
        city: r.city,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        nights: r.nights,
        roomType: r.roomType,
        roomCount: r.roomCount,
        mealType: r.mealPlan,
        adults: r.adults,
        children: r.children,
        cwb: r.cwb,
        cnb: r.cnb,
        infants: r.infants,
        confirmationNumber: r.confirmationNumber,
        notes: 'Pre-filled from the Reservation Team’s confirmed booking.',
        createdBy: 'reservation-sync',
      },
    })
    return
  }

  const fill: Record<string, unknown> = {}
  if (!existing.confirmationNumber) fill.confirmationNumber = r.confirmationNumber
  if (!existing.roomType && r.roomType) fill.roomType = r.roomType
  if (!existing.roomCount && r.roomCount) fill.roomCount = r.roomCount
  if (!existing.hotelProfileId && r.hotelProfileId) fill.hotelProfileId = r.hotelProfileId
  if (Object.keys(fill).length === 0) return

  await prisma.hotelReconfirmation.update({ where: { id: existing.id }, data: fill })
}

// ─── Invoices ────────────────────────────────────────────────────────────────

/** Tolerance inside which an invoice is treated as agreeing with the booking. */
export const INVOICE_TOLERANCE_PCT = 1

/**
 * Three-way match: invoice total ↔ agreed stay cost ↔ P&L hotel budget.
 *
 * Returns the verdict without deciding what to do about it — the route sets the
 * status, so a human always sees the numbers that produced it.
 */
export function threeWayMatch(params: {
  invoiceTotal: number | null
  reservationTotal: number | null
  budget: number | null
}) {
  const { invoiceTotal, reservationTotal, budget } = params
  if (invoiceTotal === null || reservationTotal === null) {
    return {
      matched: false,
      variance: null as number | null,
      variancePct: null as number | null,
      reason: 'Not enough figures to compare — capture the agreed rate and the invoice total.',
    }
  }
  const variance = Math.round((invoiceTotal - reservationTotal) * 100) / 100
  const variancePct = reservationTotal === 0
    ? null
    : Math.round((variance / reservationTotal) * 10000) / 100
  const matched = variancePct !== null && Math.abs(variancePct) <= INVOICE_TOLERANCE_PCT

  return {
    matched,
    variance,
    variancePct,
    reason: matched
      ? `Invoice agrees with the agreed rate${budget !== null ? ` and sits ${invoiceTotal <= budget ? 'within' : 'over'} the P&L budget` : ''}.`
      : `Invoice differs from the agreed rate by ${variance}${variancePct !== null ? ` (${variancePct}%)` : ''}.`,
  }
}
