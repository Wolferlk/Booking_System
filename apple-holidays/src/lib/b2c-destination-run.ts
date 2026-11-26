/**
 * "Detect destination" for a B2C booking already in ops.
 *
 *   detect(ref)  → reads the store order live, asks the AI (b2c-destination-ai.ts),
 *                  and returns the proposal next to what the booking holds now.
 *                  Nothing on the booking is written; the proposal is parked for
 *                  30 minutes so "Apply" writes exactly what the user saw.
 *   apply(ref)   → writes the parked proposal: country, destination, and the city
 *                  of each hotel the plan places (unless hotels are locked), saves
 *                  the plan for placement / agenda, and logs who did it.
 *
 * The store is only read. Writes go to the OPS booking, by a staff action.
 */
import { prisma } from './prisma'
import {
  fetchFlightBookings, fetchOrderProducts, fetchOrderTransportLegs, isB2cConfigured,
} from './b2c-db'
import { parseFlightBooking } from './b2c-flight'
import { resolveLiveOrderId } from './b2c-order-chain'
import { isB2cOriginBooking } from './b2c-booking-sync'
import { loadChildGuard } from './data-protection-server'
import {
  buildDestinationEvidence, describePlan, resolveDestinationWithAI, saveDestination,
  type DestinationOutcome, type DestinationPlan,
} from './b2c-destination-ai'

export class B2cDestinationError extends Error {
  constructor(message: string, public status = 422) { super(message) }
}

const PROPOSAL_PREFIX = 'b2c_destination_proposal:'
const PROPOSAL_TTL_MS = 30 * 60_000

export interface HotelCityChange { accommodationId: string; hotel: string; checkIn: string; from: string; to: string }

export interface DestinationProposal {
  bookingRef: string
  orderId: number
  ok: boolean
  reason: string | null
  plan: DestinationPlan | null
  summary: string | null
  current: { operationCountry: string | null; tourDestination: string | null }
  hotelChanges: HotelCityChange[]
  hotelsLocked: boolean
  at: string
}

const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '')
const day = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

async function loadBooking(bookingRef: string) {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef },
    select: {
      id: true, bookingRef: true, isNumber: true, agent: true, status: true,
      arrivalDate: true, departureDate: true, operationCountry: true, tourDestination: true,
      accommodations: { select: { id: true, hotel: true, city: true, checkIn: true } },
    },
  })
  if (!booking) throw new B2cDestinationError('Booking not found', 404)
  if (!(await isB2cOriginBooking(booking.id, booking.agent))) {
    throw new B2cDestinationError('Destination detection is for Aahaas B2C bookings only.', 409)
  }
  return booking
}

export async function detectB2cDestination(bookingRef: string): Promise<DestinationProposal> {
  if (!isB2cConfigured()) throw new B2cDestinationError('The Aahaas store database is not configured on this server.', 503)
  const booking = await loadBooking(bookingRef)
  const base = Number(/^\d+$/.test(booking.bookingRef) ? booking.bookingRef : booking.isNumber)
  if (!Number.isInteger(base) || base <= 0) throw new B2cDestinationError(`Cannot tell which store order ${bookingRef} came from.`)
  const { liveOrderId: orderId } = await resolveLiveOrderId(base)

  const [products, legs, flightRows] = await Promise.all([
    fetchOrderProducts([orderId]),
    fetchOrderTransportLegs([orderId]).catch(() => []),
    fetchFlightBookings([orderId]).catch(() => []),
  ])
  const evidence = buildDestinationEvidence({
    orderId,
    arrival: day(booking.arrivalDate),
    departure: day(booking.departureDate),
    products,
    transportLegs: legs,
    flights: flightRows.map((r) => parseFlightBooking(r)),
  })
  const outcome: DestinationOutcome = await resolveDestinationWithAI(evidence, { bookingRef })

  // Which saved hotels the plan would re-city: matched to their store line by
  // name + check-in date, the same key placement uses to avoid duplicates.
  const hotelChanges: HotelCityChange[] = []
  if (outcome.ok) {
    const hotelLines = evidence.lines.filter((l) => l.kind === 'hotel')
    for (const a of booking.accommodations) {
      const line = hotelLines.find((l) => key(l.name) === key(a.hotel) && l.date === day(a.checkIn))
        ?? hotelLines.find((l) => key(l.name) === key(a.hotel))
      const to = line ? outcome.plan.lineCities.find((c) => c.ref === line.ref)?.city : null
      if (to && key(to) !== key(a.city ?? '')) {
        hotelChanges.push({ accommodationId: a.id, hotel: a.hotel, checkIn: day(a.checkIn), from: a.city ?? '', to })
      }
    }
  }

  const proposal: DestinationProposal = {
    bookingRef,
    orderId,
    ok: outcome.ok,
    reason: outcome.ok ? null : outcome.reason,
    plan: outcome.ok ? outcome.plan : null,
    summary: outcome.ok ? describePlan(outcome.plan) : null,
    current: { operationCountry: booking.operationCountry ?? null, tourDestination: booking.tourDestination ?? null },
    hotelChanges,
    hotelsLocked: (await loadChildGuard(booking.id)).isLocked('accommodations'),
    at: new Date().toISOString(),
  }
  if (outcome.ok) {
    const k = `${PROPOSAL_PREFIX}${bookingRef}`
    const value = JSON.stringify(proposal)
    await prisma.systemSetting.upsert({ where: { key: k }, update: { value }, create: { key: k, value } })
  }
  return proposal
}

export async function applyB2cDestination(bookingRef: string, actor: { id: string; name: string }): Promise<{
  operationCountry: string | null; tourDestination: string | null; hotelsUpdated: number; hotelsLocked: boolean
}> {
  const k = `${PROPOSAL_PREFIX}${bookingRef}`
  const row = await prisma.systemSetting.findUnique({ where: { key: k } })
  const proposal = row?.value ? (JSON.parse(row.value) as DestinationProposal) : null
  if (!proposal?.ok || !proposal.plan) throw new B2cDestinationError('Run "Detect destination" first — there is nothing to apply.', 409)
  if (Date.now() - Date.parse(proposal.at) > PROPOSAL_TTL_MS) {
    throw new B2cDestinationError('That detection is older than 30 minutes. Run it again before applying.', 409)
  }

  const booking = await loadBooking(bookingRef)
  if (booking.status === 'CANCELLED') throw new B2cDestinationError('This booking is cancelled — nothing was changed.', 409)
  const plan = proposal.plan
  const hotelsLocked = (await loadChildGuard(booking.id)).isLocked('accommodations')
  // Only hotels whose city is still what the user saw in the preview.
  const changes = hotelsLocked ? [] : proposal.hotelChanges.filter((c) =>
    booking.accommodations.some((a) => a.id === c.accommodationId && (a.city ?? '') === c.from))

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { operationCountry: plan.operationCountry, tourDestination: plan.tourDestination },
    })
    for (const c of changes) {
      await tx.accommodation.update({ where: { id: c.accommodationId }, data: { city: c.to.slice(0, 191) } })
    }
    await tx.activityLog.create({
      data: {
        userId: actor.id,
        action: 'B2C_DESTINATION_APPLIED',
        entityType: 'Booking',
        entityId: booking.id,
        details: JSON.stringify({
          bookingRef,
          by: actor.name,
          from: proposal.current,
          to: { operationCountry: plan.operationCountry, tourDestination: plan.tourDestination },
          hotels: changes.map((c) => `${c.hotel}: ${c.from || '—'} → ${c.to}`),
          confidence: plan.confidence,
          reasoning: plan.reasoning,
        }),
      },
    })
  })

  await saveDestination(bookingRef, { ok: true, plan, evidence: { orderId: proposal.orderId, arrival: null, departure: null, lines: [], flights: [], countryVotes: {} } })
  await prisma.systemSetting.delete({ where: { key: k } }).catch(() => { /* already gone */ })
  return { operationCountry: plan.operationCountry, tourDestination: plan.tourDestination, hotelsUpdated: changes.length, hotelsLocked }
}
