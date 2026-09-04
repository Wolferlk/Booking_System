/**
 * Ticket approvals — asking Accounts before buying.
 *
 * Malaysia, Singapore and Vietnam buy attraction tickets through resellers
 * (Cebu, Global Tix, Travel Vago, Be My Guest) or from an agent. The old order
 * was: buy the ticket, then record which portal it went through, and Accounts
 * paid for a purchase already made. The order now is:
 *
 *   1. the ticket is created off the Detailed P&L,
 *   2. the ground team picks the portal it intends to buy through and submits
 *      the ticket here,
 *   3. Accounts approves it on Payable 1.0 and pays that portal,
 *   4. only a `paid` request lets this app offer the Purchase button.
 *
 * The request lives in the ACCOUNTS database, in `ticket_approvals` — one row,
 * both systems, no sync job to drift. This module is the only place that writes
 * it from our side, and it writes only the ground team's half of the row: the
 * request, its urgency, its portal, and (afterwards) the purchase. The decision
 * and the payment columns belong to Accounts and are never touched here, which
 * is what makes "approved" mean something.
 *
 * The same state is mirrored onto `tickets` so the list can filter and colour
 * by it without a cross-database query per row. The shared table stays the
 * truth; the mirror is refreshed from it, never the reverse.
 *
 * @see Accounts: app/Models/TicketApproval.php, app/Services/TicketApprovalService.php
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery, accountsWrite } from './accounts-db'
import { prisma } from './prisma'
import { portalCountriesFor, PORTAL_REQUIRED_COUNTRIES } from './portals'
import { directIssueEnabled } from './ticket-direct-issue'
import type { OperationCountry } from '@prisma/client'

/* ─── States ───────────────────────────────────────────────────────────────── */

export const APPROVAL_STATUSES = {
  pending:   'Waiting for Accounts',
  approved:  'Approved — awaiting payment',
  paid:      'Paid — ready to purchase',
  rejected:  'Sent back by Accounts',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
} as const

export type ApprovalStatus = keyof typeof APPROVAL_STATUSES

/** States where the request is still in play and must not be raised twice. */
const LIVE_STATUSES: ApprovalStatus[] = ['pending', 'approved', 'paid']

/** The only state that releases a purchase. */
export const PURCHASABLE_STATUS: ApprovalStatus = 'paid'

/**
 * Ticket categories that must be approved before they are bought.
 *
 * Attractions and the odd "other" service are what the ground team buys with
 * our money through a portal. Hotels and transport are settled by Accounts
 * directly with the supplier and never went through a portal, so putting them
 * through this queue would be asking permission for a payment nobody here is
 * making.
 */
export const APPROVAL_REQUIRED_CATEGORIES = ['TICKETS', 'ATTRACTION', 'OTHER']

export interface TicketApproval {
  id: number
  ticketId: string
  status: ApprovalStatus
  urgency: 'normal' | 'urgent'
  urgentReason: string | null
  neededBy: string | null
  requestNote: string | null
  portalId: number | null
  portalName: string | null
  portalRef: string | null
  amount: number | null
  currency: string | null
  submittedBy: string | null
  submittedAt: string | null
  submitCount: number
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  paidAmount: number | null
  paidCurrency: string | null
  paidReference: string | null
  paidAt: string | null
  purchasedAt: string | null
  history: ApprovalHistoryEntry[]
}

interface ApprovalRow extends RowDataPacket {
  id: number
  ops_ticket_id: string
  status: string
  urgency: string
  urgent_reason: string | null
  needed_by: Date | string | null
  request_note: string | null
  portal_id: number | null
  portal_name: string | null
  portal_ref: string | null
  amount: string | number | null
  currency: string | null
  submitted_by: string | null
  submitted_at: Date | string | null
  submit_count: number
  decided_by: string | null
  decided_at: Date | string | null
  decision_note: string | null
  paid_amount: string | number | null
  paid_currency: string | null
  paid_reference: string | null
  paid_at: Date | string | null
  purchased_at: Date | string | null
  // JSON on MySQL 8, LONGTEXT on MariaDB — see parseHistory().
  history: unknown
}

const COLUMNS = `id, ops_ticket_id, status, urgency, urgent_reason, needed_by, request_note,
                 portal_id, portal_name, portal_ref, amount, currency,
                 submitted_by, submitted_at, submit_count,
                 decided_by, decided_at, decision_note,
                 paid_amount, paid_currency, paid_reference, paid_at, purchased_at, history`

/** One line of the shared row's audit trail. */
export interface ApprovalHistoryEntry {
  at: string
  by?: string | null
  event: string
  detail?: string | null
}

/**
 * The trail as it stands, whatever the driver handed back.
 *
 * MariaDB stores JSON as LONGTEXT, so this comes back as a string on that
 * server and as a parsed array on MySQL 8 — both are handled rather than one
 * being assumed. A trail that cannot be parsed is treated as empty: losing the
 * history of a request is bad, but refusing to submit it because of a bad old
 * entry is worse.
 */
function parseHistory(value: unknown): ApprovalHistoryEntry[] {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return Array.isArray(parsed) ? (parsed as ApprovalHistoryEntry[]) : []
  } catch {
    return []
  }
}

/**
 * The trail with one entry added, as a string ready to store.
 *
 * Written whole rather than through JSON_ARRAY_APPEND(…, CAST(? AS JSON)):
 * MariaDB has no JSON cast, so that form is a syntax error there. Reading and
 * rewriting the array is a couple of hundred bytes and works on both servers.
 *
 * Bounded at 50 entries — a request that has bounced fifty times has its recent
 * history read, never its first line. The same cap the Accounts side applies.
 */
function withHistory(existing: unknown, entry: ApprovalHistoryEntry): string {
  const trail = parseHistory(existing)
  trail.push(entry)

  return JSON.stringify(trail.slice(-50))
}

function iso(value: Date | string | null): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function num(value: string | number | null): number | null {
  if (value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function toApproval(row: ApprovalRow): TicketApproval {
  return {
    id: Number(row.id),
    ticketId: row.ops_ticket_id,
    status: (row.status as ApprovalStatus) ?? 'pending',
    urgency: row.urgency === 'urgent' ? 'urgent' : 'normal',
    urgentReason: row.urgent_reason,
    neededBy: iso(row.needed_by),
    requestNote: row.request_note,
    portalId: row.portal_id === null ? null : Number(row.portal_id),
    portalName: row.portal_name,
    portalRef: row.portal_ref,
    amount: num(row.amount),
    currency: row.currency,
    submittedBy: row.submitted_by,
    submittedAt: iso(row.submitted_at),
    submitCount: Number(row.submit_count ?? 1),
    decidedBy: row.decided_by,
    decidedAt: iso(row.decided_at),
    decisionNote: row.decision_note,
    paidAmount: num(row.paid_amount),
    paidCurrency: row.paid_currency,
    paidReference: row.paid_reference,
    paidAt: iso(row.paid_at),
    purchasedAt: iso(row.purchased_at),
    history: parseHistory(row.history),
  }
}

/* ─── Does this ticket go through the queue at all? ────────────────────────── */

/**
 * Whether a booking's operation submits tickets for approval before buying.
 *
 * Sri Lanka does not: its driver buys tickets out of the advance he has already
 * been given, so there is no portal to fund and nothing to approve in front of
 * the purchase. That exemption is the same one the portal rules make, and is
 * read from the same list so the two cannot drift apart.
 */
export function approvalRequiredFor(country: OperationCountry | null | undefined): boolean {
  const codes = portalCountriesFor(country)
  return codes.length > 0 && codes.every(c => PORTAL_REQUIRED_COUNTRIES.includes(c))
}

/** Does a ticket of this category need approving? */
export function approvalRequiredForCategory(category: string | null | undefined): boolean {
  return APPROVAL_REQUIRED_CATEGORIES.includes((category ?? '').toUpperCase())
}

/* ─── Reading ──────────────────────────────────────────────────────────────── */

/**
 * The requests behind a set of tickets, keyed by ticket id.
 *
 * A ticket with no row is simply not in the map — never submitted is a state,
 * not a missing record.
 */
export async function approvalsForTickets(ticketIds: string[]): Promise<Map<string, TicketApproval>> {
  const ids = Array.from(new Set(ticketIds.filter(Boolean)))
  if (!ids.length) return new Map()

  const placeholders = ids.map(() => '?').join(', ')
  const rows = await accountsQuery<ApprovalRow>(
    `SELECT ${COLUMNS} FROM ticket_approvals WHERE ops_ticket_id IN (${placeholders})`,
    ids,
  )

  return new Map(rows.map(r => [r.ops_ticket_id, toApproval(r)]))
}

export async function approvalForTicket(ticketId: string): Promise<TicketApproval | null> {
  const found = await approvalsForTickets([ticketId])
  return found.get(ticketId) ?? null
}

/**
 * Bring the tickets' mirrored columns back in step with the shared table.
 *
 * Called wherever tickets are read for a screen, so Accounts' decision shows up
 * without anyone pressing refresh, and so a list can be filtered on the mirror
 * afterwards. One UPDATE per ticket whose state actually moved — a board of
 * settled tickets costs nothing.
 *
 * Never throws: this is a courtesy refresh, and an unreachable Accounts
 * database must not take the tickets page down with it. Callers that need to
 * *act* on the state read the shared table directly (see purchaseBlocker).
 */
export async function syncApprovalMirror(ticketIds: string[]): Promise<Map<string, TicketApproval>> {
  let approvals: Map<string, TicketApproval>

  try {
    approvals = await approvalsForTickets(ticketIds)
  } catch (err) {
    console.warn('[ticket-approvals] mirror refresh skipped:', err instanceof Error ? err.message : err)
    return new Map()
  }

  if (!approvals.size) return approvals

  const current = await prisma.ticket.findMany({
    where: { id: { in: Array.from(approvals.keys()) } },
    select: { id: true, approvalStatus: true, approvalDecidedAt: true, approvalPaidAt: true },
  })

  await Promise.all(current.map(async ticket => {
    const a = approvals.get(ticket.id)
    if (!a) return

    // Only write when something moved. The common case — a board of tickets
    // whose state has not changed since the last load — writes nothing.
    const settled =
      ticket.approvalStatus === a.status &&
      iso(ticket.approvalDecidedAt) === a.decidedAt &&
      iso(ticket.approvalPaidAt) === a.paidAt

    if (settled) return

    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        approvalId:        a.id,
        approvalStatus:    a.status,
        approvalUrgency:   a.urgency,
        approvalReason:    a.urgentReason,
        approvalNeededBy:  a.neededBy ? new Date(a.neededBy) : null,
        submittedBy:       a.submittedBy,
        submittedAt:       a.submittedAt ? new Date(a.submittedAt) : null,
        approvalDecidedBy: a.decidedBy,
        approvalDecidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
        approvalNote:      a.decisionNote,
        approvalPaidAt:    a.paidAt ? new Date(a.paidAt) : null,
        approvalPaidRef:   a.paidReference,
        approvalSyncedAt:  new Date(),
      },
    })
  }))

  return approvals
}

/* ─── Submitting ───────────────────────────────────────────────────────────── */

export interface SubmitInput {
  urgent?: boolean
  urgentReason?: string | null
  neededBy?: string | null
  note?: string | null
}

/** What a ticket has to look like before it can be sent over. */
export interface SubmittableTicket {
  id: string
  type: string
  category: string | null
  qty: number
  totalCost: unknown
  currency: string
  portalId: number | null
  portalName: string | null
  portalRef: string | null
  booking: {
    id: string
    bookingRef: string | null
    isNumber: string | null
    cntlNumber: string | null
    operationCountry: OperationCountry | null
    clientName?: string | null
    arrivalDate?: Date | null
  }
  agendaDate?: Date | null
}

/**
 * Why this ticket cannot be submitted yet, or null if it can.
 *
 * A ticket with no portal on it is the main one: Accounts is being asked to pay
 * somebody, and "somebody" is not an answer. An urgent request with no reason
 * is the other — urgency is a claim on somebody else's afternoon, and it has to
 * come with what makes it urgent.
 */
export function submitBlocker(ticket: SubmittableTicket, input: SubmitInput): string | null {
  if (!approvalRequiredFor(ticket.booking.operationCountry)) {
    return 'This operation buys tickets out of the driver’s advance — there is nothing to approve here.'
  }

  if (!ticket.portalName) {
    return 'Pick the portal you intend to buy this through and save it first — '
      + 'Accounts approves paying that portal, so the request cannot go without one.'
  }

  if (input.urgent && !String(input.urgentReason ?? '').trim()) {
    return 'Say why it is urgent. Accounts sees this on the emergency alert and decides against it.'
  }

  return null
}

/**
 * Raise (or re-raise) the request for one ticket.
 *
 * Idempotent per ticket by design — the shared table holds one row per ticket,
 * so a re-submission after a rejection re-opens that row with its history
 * intact and its submit count advanced, rather than starting a second thread
 * about the same purchase. A ticket already pending, approved or paid is
 * refused rather than silently re-opened: reversing an answer Accounts has
 * already given is their call, not ours.
 *
 * @throws with a message meant for the ground team to read.
 */
export async function submitForApproval(
  ticket: SubmittableTicket,
  actor: string,
  input: SubmitInput = {},
): Promise<TicketApproval> {
  // Direct issuing is on, so Accounts is not watching this queue and has no
  // reason to answer. Refused on the server as well as hidden in the UI: a tab
  // left open from before the switch was flipped is exactly how a request ends
  // up sitting unanswered in somebody's board forever.
  if (await directIssueEnabled()) {
    throw new Error(
      'Direct ticket issuing is switched on — tickets are bought without Accounts approval, '
      + 'so there is nothing to submit. Buy it straight from the Purchase button.',
    )
  }

  const blocker = submitBlocker(ticket, input)
  if (blocker) throw new Error(blocker)

  const existing = await approvalForTicket(ticket.id)

  if (existing && LIVE_STATUSES.includes(existing.status)) {
    throw new Error(
      existing.status === 'pending'
        ? 'This ticket is already with Accounts, waiting for a decision.'
        : `Accounts has already ${existing.status === 'paid' ? 'paid for' : 'approved'} this ticket.`,
    )
  }

  const country = portalCountriesFor(ticket.booking.operationCountry)[0] ?? null
  const urgency = input.urgent ? 'urgent' : 'normal'
  const reason = input.urgent ? String(input.urgentReason ?? '').trim().slice(0, 255) : null
  const neededBy = input.neededBy ? new Date(input.neededBy) : null
  const note = input.note ? String(input.note).trim().slice(0, 2000) : null
  const amount = ticket.totalCost === null || ticket.totalCost === undefined
    ? null
    : Number(ticket.totalCost)
  const travelDate = ticket.agendaDate ?? ticket.booking.arrivalDate ?? null

  // The whole trail, with this submission on the end. Built here rather than in
  // SQL because MariaDB has no JSON cast to append through.
  const history = withHistory(existing?.history, {
    at: new Date().toISOString(),
    by: actor,
    event: existing ? 'resubmitted' : 'submitted',
    detail: reason,
  })

  if (existing) {
    // Re-opening a rejected or withdrawn row. Every decision and payment column
    // is cleared in the same statement: leaving last week's rejection note on a
    // request that is pending again is how a clerk reads the wrong answer.
    await accountsWrite(
      `UPDATE ticket_approvals
          SET status = 'pending', urgency = ?, urgent_reason = ?, needed_by = ?, request_note = ?,
              portal_id = ?, portal_name = ?, portal_ref = ?,
              ticket_name = ?, category = ?, qty = ?, amount = ?, currency = ?,
              travel_date = ?, guest_name = ?,
              submitted_by = ?, submitted_at = NOW(), submit_count = submit_count + 1,
              decided_by = NULL, decided_at = NULL, decision_note = NULL,
              paid_amount = NULL, paid_currency = NULL, paid_reference = NULL,
              paid_method = NULL, paid_by = NULL, paid_at = NULL,
              history = ?,
              updated_at = NOW()
        WHERE id = ?`,
      [
        urgency, reason, neededBy, note,
        ticket.portalId, ticket.portalName, ticket.portalRef,
        ticket.type, ticket.category, ticket.qty, amount, ticket.currency,
        travelDate, ticket.booking.clientName ?? null,
        actor,
        history,
        existing.id,
      ],
    )
  } else {
    await accountsWrite(
      `INSERT INTO ticket_approvals
         (ops_ticket_id, ops_booking_id, booking_ref, is_number, cntl_number, country,
          ticket_name, category, qty, amount, currency, travel_date, guest_name,
          portal_id, portal_name, portal_ref,
          status, urgency, urgent_reason, needed_by, request_note,
          submitted_by, submitted_at, submit_count, history, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               'pending', ?, ?, ?, ?, ?, NOW(), 1, ?, NOW(), NOW())`,
      [
        ticket.id, ticket.booking.id, ticket.booking.bookingRef,
        ticket.booking.isNumber, ticket.booking.cntlNumber, country,
        ticket.type, ticket.category, ticket.qty, amount, ticket.currency,
        travelDate, ticket.booking.clientName ?? null,
        ticket.portalId, ticket.portalName, ticket.portalRef,
        urgency, reason, neededBy, note,
        actor, history,
      ],
    )
  }

  const approval = await approvalForTicket(ticket.id)
  if (!approval) {
    throw new Error('The request was sent but could not be read back. Reload the page before submitting again.')
  }

  await mirror(ticket.id, approval)

  return approval
}

/**
 * Take a request back before Accounts has answered it.
 *
 * Only a pending request can be withdrawn — once it is approved or paid the
 * money has been committed on our behalf, and unwinding that is a conversation,
 * not a button.
 */
export async function withdrawApproval(ticketId: string, actor: string): Promise<TicketApproval> {
  const existing = await approvalForTicket(ticketId)

  if (!existing) throw new Error('This ticket has not been submitted to Accounts.')

  if (existing.status !== 'pending') {
    throw new Error(
      existing.status === 'paid'
        ? 'Accounts has already paid for this ticket — talk to them before changing anything.'
        : `This request is already ${existing.status}; it cannot be withdrawn.`,
    )
  }

  await accountsWrite(
    `UPDATE ticket_approvals
        SET status = 'withdrawn', history = ?, updated_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [
      withHistory(existing.history, { at: new Date().toISOString(), by: actor, event: 'withdrawn' }),
      existing.id,
    ],
  )

  const approval = await approvalForTicket(ticketId)
  if (approval) await mirror(ticketId, approval)

  return approval ?? { ...existing, status: 'withdrawn' }
}

/* ─── The purchase gate ────────────────────────────────────────────────────── */

/**
 * Why this ticket may not be bought yet, or null if it may.
 *
 * Read live from the shared table rather than from the mirror on purpose: this
 * is the guard that stands between the ground team and spending money, and it
 * must not act on a copy that could be a page-load out of date. An unreachable
 * Accounts database blocks the purchase rather than allowing it — the whole
 * point of the gate is that "we could not check" is not permission.
 */
export async function purchaseBlocker(
  country: OperationCountry | null | undefined,
  ticket: { id: string; category: string | null },
): Promise<string | null> {
  if (!approvalRequiredFor(country) || !approvalRequiredForCategory(ticket.category)) {
    return null
  }

  // The switch that takes Accounts out of the loop. Read live, like the rest of
  // this gate, so that turning it back off shuts the gate on the very next
  // click rather than on the next deploy.
  if (await directIssueEnabled()) return null

  let approval: TicketApproval | null

  try {
    approval = await approvalForTicket(ticket.id)
  } catch (err) {
    console.warn('[ticket-approvals] purchase gate could not reach Accounts:', err instanceof Error ? err.message : err)

    return 'The Accounts system cannot be reached, so this ticket’s approval cannot be checked. '
      + 'Try again in a moment rather than buying it unapproved.'
  }

  if (!approval || approval.status === 'withdrawn' || approval.status === 'cancelled') {
    return 'Submit this ticket to Accounts for approval before buying it. '
      + 'Pick the portal, send it over, and purchase once they have paid for it.'
  }

  switch (approval.status) {
    case 'pending':
      return 'Accounts has not answered this request yet. It was sent '
        + `${approval.submittedAt ? new Date(approval.submittedAt).toLocaleString() : 'recently'}`
        + ' — mark it urgent if the guest travels sooner than they know.'

    case 'approved':
      return 'Accounts has approved this ticket but has not paid the portal yet. '
        + 'Wait for the payment before buying it.'

    case 'rejected':
      return `Accounts sent this back: ${approval.decisionNote || 'no reason given'}. `
        + 'Fix what they asked for and submit it again.'

    case 'paid':
      return null

    default:
      return 'This request is in a state this app does not recognise. Ask Accounts to look at it.'
  }
}

/**
 * Tell the shared row the ticket was finally bought.
 *
 * Closes the loop for Accounts: a paid approval that never turned into a
 * purchase is money out with nothing to show for it, and this is what makes the
 * difference visible from their side without querying our database.
 *
 * Never throws — the purchase itself has already been recorded here, and a
 * stamp that did not land must not fail it.
 */
export async function markApprovalPurchased(ticketId: string, reference: string | null): Promise<void> {
  try {
    await accountsWrite(
      `UPDATE ticket_approvals
          SET purchased_at = NOW(), purchase_reference = ?, updated_at = NOW()
        WHERE ops_ticket_id = ? AND purchased_at IS NULL`,
      [reference, ticketId],
    )
  } catch (err) {
    console.warn('[ticket-approvals] purchase stamp failed:', err instanceof Error ? err.message : err)
  }
}

/* ─── Internals ────────────────────────────────────────────────────────────── */

/** Copy one request's state onto its ticket. Best-effort, like the bulk sync. */
async function mirror(ticketId: string, a: TicketApproval): Promise<void> {
  try {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        approvalId:        a.id,
        approvalStatus:    a.status,
        approvalUrgency:   a.urgency,
        approvalReason:    a.urgentReason,
        approvalNeededBy:  a.neededBy ? new Date(a.neededBy) : null,
        submittedBy:       a.submittedBy,
        submittedAt:       a.submittedAt ? new Date(a.submittedAt) : null,
        approvalDecidedBy: a.decidedBy,
        approvalDecidedAt: a.decidedAt ? new Date(a.decidedAt) : null,
        approvalNote:      a.decisionNote,
        approvalPaidAt:    a.paidAt ? new Date(a.paidAt) : null,
        approvalPaidRef:   a.paidReference,
        approvalSyncedAt:  new Date(),
      },
    })
  } catch (err) {
    console.warn('[ticket-approvals] mirror write failed:', err instanceof Error ? err.message : err)
  }
}
