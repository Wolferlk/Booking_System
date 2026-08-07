/**
 * Trip readiness — the operational checklist a booking must clear before the
 * guest lands.
 *
 * Four questions, asked in the order ops asks them:
 *   1. Has the **client confirmed**?   status has reached `GT_VERIFIED`
 *      ("Client Confirmed" in STATUS_LABELS) or anything after it.
 *   2. Are **drivers allocated**?      every serviced agenda row has an
 *      assignment with a driver on it.
 *   3. Are **tickets issued**?         every activated ticket is PURCHASED or PAID.
 *   4. What **QC stage** is it at?     QC1 / QC2 reached, from the booking status.
 *
 * The first three mirror the checks `BookingQCPanel` shows on a booking page, so
 * the daily mail and the screen tell the same story. Three deliberate
 * differences, all of which make the mail less wrong:
 *   - a booking past QC still counts as client-confirmed (the panel's status
 *     list stops at COMPLETED and misses the QC1/QC2/MSG_SENT rungs);
 *   - a vendor counts as an allocated driver, as does Sri Lanka's booking-level
 *     chauffeur allocation, which is not stored per agenda row;
 *   - part-done is its own state rather than a flat fail.
 *
 * Nothing here writes, and the panel is untouched — changing what an operator
 * sees mid-booking is a separate decision from what the report counts.
 *
 * Deliberately pure and Prisma-free — the input is structural, so both a server
 * report query and a client component can feed it.
 */
import type { BookingStatus } from '@prisma/client'
import { getCurrentStep } from '@/lib/state-machine'

/**
 * `PARTIAL` matters as much as the other three: a tour with three of five
 * drivers booked is a different conversation from one with none, and collapsing
 * the two would paint the whole report red every morning.
 */
export type ReadinessState = 'DONE' | 'PARTIAL' | 'PENDING' | 'NA'

export interface ReadinessCheck {
  state: ReadinessState
  /** Short cell text for a table — "4/4", "2 of 5", "None". */
  short: string
  /** Sentence-length explanation for a panel or tooltip. */
  detail: string
  /** How many of the things this check counts are done, and how many exist. */
  done: number
  required: number
}

export type QcStage = 'NONE' | 'QC1' | 'QC2'

export interface BookingReadiness {
  client: ReadinessCheck
  driver: ReadinessCheck
  tickets: ReadinessCheck
  qc: ReadinessCheck & { stage: QcStage }
  /** True when nothing is outstanding — the booking can be left alone. */
  ready: boolean
  /** Names of the checks still pending, for a one-line "what's missing". */
  outstanding: string[]
}

// ─── Input shape ──────────────────────────────────────────────────────────────

export interface ReadinessAgendaItem {
  serviceType?: string | null
  isLeisure?: boolean | null
  assignment?: { driverId?: string | null; vendorId?: string | null } | null
}

export interface ReadinessTicket {
  activated?: boolean | null
  status?: string | null
}

export interface ReadinessBooking {
  status: string
  qcPassedAt?: Date | string | null
  tourAgenda?: { items?: ReadinessAgendaItem[] | null } | null
  /** Sri Lanka allocates one driver per booking rather than per agenda row. */
  slDriverAllocation?: { driverId?: string | null; vendorId?: string | null } | null
  tickets?: ReadinessTicket[] | null
}

// ─── Rules ────────────────────────────────────────────────────────────────────

/**
 * The status at which the client is considered to have confirmed. Every later
 * step in `LIFECYCLE_STEPS` implies it, so this is a step comparison rather than
 * a hand-maintained list of statuses — a booking sitting at QC1_PASS has
 * obviously been confirmed by the client.
 */
const CLIENT_CONFIRMED_FROM: BookingStatus = 'GT_VERIFIED'

/** Statuses outside the forward lifecycle — step 0, so they need naming explicitly. */
const OFF_LIFECYCLE = new Set<string>(['CANCELLED', 'PENDING_CANCELLATION', 'AMENDED', 'CHANGE_REQUESTED'])

function stepOf(status: string): number {
  return getCurrentStep(status as BookingStatus)
}

/** Has the booking reached `target` on the lifecycle ladder? */
function hasReached(status: string, target: BookingStatus): boolean {
  if (OFF_LIFECYCLE.has(status)) return false
  const step = stepOf(status)
  return step > 0 && step >= getCurrentStep(target)
}

/**
 * Does this agenda row need a driver?
 *
 * `OWN_ARRANGEMENT` rows are the guest's own time — no vehicle is booked for
 * them — which is the same rule the QC panel uses. An explicit leisure flag says
 * the same thing and is honoured too.
 */
function needsDriver(item: ReadinessAgendaItem): boolean {
  if (item.isLeisure === true) return false
  return String(item.serviceType ?? '') !== 'OWN_ARRANGEMENT'
}

function isAllocated(item: ReadinessAgendaItem): boolean {
  return !!(item.assignment?.driverId || item.assignment?.vendorId)
}

// ─── Checks ───────────────────────────────────────────────────────────────────

function clientCheck(b: ReadinessBooking): ReadinessCheck {
  const confirmed = hasReached(b.status, CLIENT_CONFIRMED_FROM)
  return {
    state: confirmed ? 'DONE' : 'PENDING',
    short: confirmed ? 'Confirmed' : 'Not confirmed',
    detail: confirmed
      ? 'Client has confirmed the booking'
      : 'Awaiting client confirmation — status has not reached Client Confirmed',
    done: confirmed ? 1 : 0,
    required: 1,
  }
}

function driverCheck(b: ReadinessBooking): ReadinessCheck {
  // Sri Lanka books one chauffeur for the whole tour, recorded on the booking
  // rather than on each movement. When that allocation exists the tour has its
  // driver, whatever the per-row assignments say.
  if (b.slDriverAllocation?.driverId || b.slDriverAllocation?.vendorId) {
    return {
      state: 'DONE', short: 'Allocated', detail: 'Chauffeur allocated for the whole tour',
      done: 1, required: 1,
    }
  }

  const items = b.tourAgenda?.items ?? []
  if (!items.length) {
    return {
      state: 'PENDING', short: 'No agenda',
      detail: 'No movement chart has been built yet, so no driver can be allocated',
      done: 0, required: 0,
    }
  }

  const serviced = items.filter(needsDriver)
  if (!serviced.length) {
    return {
      state: 'NA', short: '—', detail: 'No transfers in the agenda — nothing to allocate',
      done: 0, required: 0,
    }
  }

  const allocated = serviced.filter(isAllocated).length
  return {
    state: allocated === serviced.length ? 'DONE' : allocated > 0 ? 'PARTIAL' : 'PENDING',
    short: `${allocated}/${serviced.length}`,
    detail: allocated === serviced.length
      ? `All ${serviced.length} transfer(s) have a driver`
      : `${serviced.length - allocated} of ${serviced.length} transfers still need a driver`,
    done: allocated,
    required: serviced.length,
  }
}

function ticketsCheck(b: ReadinessBooking): ReadinessCheck {
  const active = (b.tickets ?? []).filter(t => t.activated !== false)
  if (!active.length) {
    // Same rule the QC panel uses: a booking with no tickets on it has nothing
    // to purchase. Plenty of tours are pure transfers, so flagging every one of
    // them red would drown the bookings that do have unissued tickets.
    return {
      state: hasReached(b.status, 'TICKETS_ISSUED') ? 'DONE' : 'NA',
      short: hasReached(b.status, 'TICKETS_ISSUED') ? 'Issued' : 'None',
      detail: 'No tickets have been added to this booking',
      done: 0, required: 0,
    }
  }

  const issued = active.filter(t => t.status === 'PURCHASED' || t.status === 'PAID').length
  return {
    state: issued === active.length ? 'DONE' : issued > 0 ? 'PARTIAL' : 'PENDING',
    short: `${issued}/${active.length}`,
    detail: issued === active.length
      ? `All ${active.length} ticket(s) purchased`
      : `${active.length - issued} of ${active.length} tickets still in draft`,
    done: issued,
    required: active.length,
  }
}

function qcCheck(b: ReadinessBooking): ReadinessCheck & { stage: QcStage } {
  const stage: QcStage = hasReached(b.status, 'QC2_PASS') ? 'QC2'
    : hasReached(b.status, 'QC1_PASS') ? 'QC1'
      : 'NONE'
  const passedAt = b.qcPassedAt ? new Date(b.qcPassedAt) : null
  const when = passedAt && !isNaN(passedAt.getTime())
    ? ` on ${passedAt.toISOString().slice(0, 10)}`
    : ''

  if (stage === 'NONE') {
    return {
      stage, state: 'PENDING', short: 'Not passed',
      detail: 'Neither QC1 nor QC2 has been signed off',
      done: 0, required: 2,
    }
  }
  return {
    stage,
    state: stage === 'QC2' ? 'DONE' : 'PARTIAL',
    short: stage === 'QC2' ? 'QC2 pass' : 'QC1 pass',
    detail: stage === 'QC2'
      ? `Both QC rounds passed${when}`
      : `QC1 passed${when} — QC2 still outstanding`,
    done: stage === 'QC2' ? 2 : 1,
    required: 2,
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function computeReadiness(b: ReadinessBooking): BookingReadiness {
  const client = clientCheck(b)
  const driver = driverCheck(b)
  const tickets = ticketsCheck(b)
  const qc = qcCheck(b)

  // Outstanding means "not finished": half-allocated counts, N/A does not.
  const open = (c: ReadinessCheck) => c.state === 'PENDING' || c.state === 'PARTIAL'
  const outstanding = [
    open(client) ? 'client confirmation' : null,
    open(driver) ? 'driver allocation' : null,
    open(tickets) ? 'tickets' : null,
    open(qc) ? 'QC' : null,
  ].filter((x): x is string => x !== null)

  return { client, driver, tickets, qc, ready: outstanding.length === 0, outstanding }
}
