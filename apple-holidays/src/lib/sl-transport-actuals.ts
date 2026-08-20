/**
 * What the Sri Lankan desk says a booking's transport *actually* cost, and
 * actually owes the driver — and how that gets to the accounts system.
 *
 * ---- The problem ----
 *
 * Every transport figure on the Drive Log is derived: the total comes off the
 * P&L's payable lines, the advance is a configured share of it, and the balance
 * payable is what is left. That is right nine times out of ten and it is what
 * gets paid. It is not always what happened — the tour ran short, the driver did
 * an extra airport run, the package was re-agreed with the operator after the
 * P&L was costed. The people who know that are on this side, on this screen; the
 * people who release the money are on the other. Until now the number travelled
 * by WhatsApp and was retyped into Payable 1.0 from memory.
 *
 * ---- What this module does ----
 *
 * Writes it down in a place both systems can see: one row per booking in
 * `sl_transport_settlement_requests`, holding the two actual figures, the
 * derived figures they are being compared against, and a note. Submitting it
 * flips the row to `pending`; Payable 1.0's Transport settlement window reads
 * the pending row, shows the variance and offers the submitted figure as the
 * amount to pay.
 *
 * ---- What this module very deliberately does NOT do ----
 *
 * It does not pay anything, and it cannot. Recording a rest payment means
 * materialising payable rows, spreading the amount pro rata across the
 * booking's supplier lines, writing `payable_payments` and filing a bank slip —
 * `PayableV1Controller::slTransportPay`, which also refuses outright if the
 * booking's P&L is not approved. None of that happens here and none of it is
 * reimplemented here: this app writes a claim, an accounts user reads it and
 * presses Record settlement, and the row comes back stamped with the batch
 * reference of the payment that answered it.
 *
 * The boundary is enforced twice over: `accountsWrite()` refuses any statement
 * against a table outside its allowlist, and every statement below names its
 * columns by hand — so the decision and payment columns are not merely
 * unwritten, they are unwritable from this side.
 */

import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery, accountsWrite } from './accounts-db'
import { advanceBaseKey, advanceKey } from './accounts-driver-advance-db'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Where a booking's submission stands.
 *
 *   draft      figures saved on the Drive Log; nobody else has seen them.
 *   pending    submitted; waiting for Payable 1.0.
 *   recorded   a settlement was made against it.
 *   rejected   an accounts user sent it back, with a reason.
 *   cancelled  the desk withdrew it before it was acted on.
 */
export type ActualsStatus = 'draft' | 'pending' | 'recorded' | 'rejected' | 'cancelled'

/** The states in which the desk may still change its figures. */
export const EDITABLE_STATUSES: ActualsStatus[] = ['draft', 'rejected', 'cancelled']

/** One booking's actuals, as both systems see them. */
export interface TransportActuals {
  id: number
  bookingId: string
  status: ActualsStatus

  /** What the desk says the whole transport package really cost, in LKR. */
  actualPackageCost: number | null
  /** What the desk says is really owed to the driver after the advance, in LKR. */
  actualBalancePayable: number | null
  note: string | null

  /** The derived figures as they stood when the desk last saved — the comparison it saw. */
  computedTotalCost: number | null
  computedAdvance: number | null
  computedBalancePayable: number | null
  advancePaid: number | null

  savedBy: string | null
  savedAt: string | null
  submittedBy: string | null
  submittedAt: string | null
  submitCount: number

  /** Everything below is written by the accounts system. Never by this app. */
  decidedBy: string | null
  decidedAt: string | null
  decisionNote: string | null
  recordedAmountLkr: number | null
  recordedBatchRef: string | null
  recordedAt: string | null
  recordedBy: string | null
}

/** The figures a save carries, and the context that makes them comparable. */
export interface ActualsInput {
  bookingId: string
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  travelStartDate: string | null
  driverName: string | null
  pnlRecordId: number | null

  actualPackageCost: number | null
  actualBalancePayable: number | null
  note: string | null

  computedTotalCost: number | null
  computedAdvance: number | null
  computedBalancePayable: number | null
  advancePaid: number | null
  rate: number | null
}

// ── Rows ──────────────────────────────────────────────────────────────────────

const COLUMNS = `
  id, ops_booking_id, booking_ref, is_number, cntl_number, status,
  actual_package_cost_lkr, actual_balance_payable_lkr, request_note,
  computed_total_cost_lkr, computed_advance_lkr, computed_balance_payable_lkr, advance_paid_lkr,
  saved_by, saved_at, submitted_by, submitted_at, submit_count,
  decided_by, decided_at, decision_note,
  recorded_amount_lkr, recorded_batch_ref, recorded_at, recorded_by
`

interface ActualsRow extends RowDataPacket {
  id: number
  ops_booking_id: string
  booking_ref: string | null
  is_number: string | null
  cntl_number: string | null
  status: string
  actual_package_cost_lkr: string | null
  actual_balance_payable_lkr: string | null
  request_note: string | null
  computed_total_cost_lkr: string | null
  computed_advance_lkr: string | null
  computed_balance_payable_lkr: string | null
  advance_paid_lkr: string | null
  saved_by: string | null
  saved_at: string | Date | null
  submitted_by: string | null
  submitted_at: string | Date | null
  submit_count: number
  decided_by: string | null
  decided_at: string | Date | null
  decision_note: string | null
  recorded_amount_lkr: string | null
  recorded_batch_ref: string | null
  recorded_at: string | Date | null
  recorded_by: string | null
}

/** MySQL hands DECIMAL back as a string; a money figure must not become NaN. */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function iso(v: string | Date | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  return String(v)
}

function toActuals(r: ActualsRow): TransportActuals {
  return {
    id: r.id,
    bookingId: r.ops_booking_id,
    status: (r.status as ActualsStatus) ?? 'draft',

    actualPackageCost:    num(r.actual_package_cost_lkr),
    actualBalancePayable: num(r.actual_balance_payable_lkr),
    note: r.request_note,

    computedTotalCost:      num(r.computed_total_cost_lkr),
    computedAdvance:        num(r.computed_advance_lkr),
    computedBalancePayable: num(r.computed_balance_payable_lkr),
    advancePaid:            num(r.advance_paid_lkr),

    savedBy: r.saved_by,
    savedAt: iso(r.saved_at),
    submittedBy: r.submitted_by,
    submittedAt: iso(r.submitted_at),
    submitCount: r.submit_count ?? 0,

    decidedBy: r.decided_by,
    decidedAt: iso(r.decided_at),
    decisionNote: r.decision_note,
    recordedAmountLkr: num(r.recorded_amount_lkr),
    recordedBatchRef: r.recorded_batch_ref,
    recordedAt: iso(r.recorded_at),
    recordedBy: r.recorded_by,
  }
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Every booking's actuals, keyed by OPS booking id. One query. */
export async function fetchTransportActuals(bookingIds: string[]): Promise<Map<string, TransportActuals>> {
  const out = new Map<string, TransportActuals>()

  const ids = Array.from(new Set(bookingIds.filter(Boolean)))
  if (ids.length === 0) return out

  const placeholders = ids.map(() => '?').join(',')
  const rows = await accountsQuery<ActualsRow>(
    `SELECT ${COLUMNS} FROM sl_transport_settlement_requests WHERE ops_booking_id IN (${placeholders})`,
    ids,
  )

  for (const r of rows) out.set(r.ops_booking_id, toActuals(r))
  return out
}

/** One booking's actuals, or null when the desk has never entered any. */
export async function fetchTransportActual(bookingId: string): Promise<TransportActuals | null> {
  const rows = await accountsQuery<ActualsRow>(
    `SELECT ${COLUMNS} FROM sl_transport_settlement_requests WHERE ops_booking_id = ? LIMIT 1`,
    [bookingId],
  )
  return rows[0] ? toActuals(rows[0]) : null
}

// ── Writes ────────────────────────────────────────────────────────────────────

/** Rupees, rounded to the cent, or null. Refuses anything that is not money. */
function money(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  // A figure above this is a typo — a mis-keyed thousands separator, or a USD
  // amount typed into a rupee box. Refusing it here is kinder than letting it
  // reach a settlement window as a plausible-looking number.
  if (n > 100_000_000) throw new Error('That figure is too large to be a rupee amount.')
  return Math.round(n * 100) / 100
}

/**
 * Save a booking's actual figures without sending them anywhere.
 *
 * Upserts one row per booking: the desk revises its figure across a week, and a
 * pile of superseded rows would only make the accounts side guess which one is
 * current. A booking whose request has already been recorded is refused rather
 * than silently reopened — that is what `reopen` is for.
 */
export async function saveTransportActuals(
  input: ActualsInput,
  actor: string,
): Promise<TransportActuals> {
  const existing = await fetchTransportActual(input.bookingId)

  if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
    throw new Error(
      existing.status === 'pending'
        ? 'This booking is already with the accounts team. Withdraw it before changing the figures.'
        : 'A settlement has already been recorded against this booking, so its figures are closed.',
    )
  }

  const pkg     = money(input.actualPackageCost)
  const balance = money(input.actualBalancePayable)
  const note    = input.note?.trim().slice(0, 1000) || null

  if (existing) {
    // Re-saving after a rejection clears the accounts side's answer: leaving
    // last week's "sent back" note on a figure that has since changed is how a
    // desk reads the wrong reason.
    await accountsWrite(
      `UPDATE sl_transport_settlement_requests
          SET booking_ref = ?, is_number = ?, cntl_number = ?, is_key = ?, control_key = ?,
              pnl_record_id = ?, travel_start_date = ?, driver_name = ?,
              actual_package_cost_lkr = ?, actual_balance_payable_lkr = ?, request_note = ?,
              computed_total_cost_lkr = ?, computed_advance_lkr = ?,
              computed_balance_payable_lkr = ?, advance_paid_lkr = ?, rate = ?,
              status = 'draft',
              saved_by = ?, saved_at = NOW(),
              decided_by = NULL, decided_at = NULL, decision_note = NULL,
              updated_at = NOW()
        WHERE id = ?`,
      [
        input.bookingRef, input.isNumber, input.cntlNumber,
        keyOf(input.isNumber ?? input.bookingRef), keyOf(input.cntlNumber),
        input.pnlRecordId, input.travelStartDate, input.driverName,
        pkg, balance, note,
        input.computedTotalCost, input.computedAdvance,
        input.computedBalancePayable, input.advancePaid, input.rate,
        actor,
        existing.id,
      ],
    )
  } else {
    await accountsWrite(
      `INSERT INTO sl_transport_settlement_requests
         (ops_booking_id, booking_ref, is_number, cntl_number, is_key, control_key,
          pnl_record_id, travel_start_date, driver_name,
          actual_package_cost_lkr, actual_balance_payable_lkr, request_note,
          computed_total_cost_lkr, computed_advance_lkr,
          computed_balance_payable_lkr, advance_paid_lkr, rate,
          status, saved_by, saved_at, submit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), 0, NOW(), NOW())`,
      [
        input.bookingId, input.bookingRef, input.isNumber, input.cntlNumber,
        keyOf(input.isNumber ?? input.bookingRef), keyOf(input.cntlNumber),
        input.pnlRecordId, input.travelStartDate, input.driverName,
        pkg, balance, note,
        input.computedTotalCost, input.computedAdvance,
        input.computedBalancePayable, input.advancePaid, input.rate,
        actor,
      ],
    )
  }

  const saved = await fetchTransportActual(input.bookingId)
  if (!saved) throw new Error('The figures were written but could not be read back.')
  return saved
}

/**
 * Send the saved figures to the accounts team.
 *
 * Refuses without an actual balance payable: that is the only figure Payable
 * 1.0 acts on, and a request carrying nothing for it would sit in the settlement
 * window saying nothing. The package cost alone is a perfectly good thing to
 * save — it just is not something to ask anyone to do.
 */
export async function submitTransportActuals(
  bookingId: string,
  actor: string,
): Promise<TransportActuals> {
  const existing = await fetchTransportActual(bookingId)
  if (!existing) throw new Error('Save the figures before submitting them.')

  if (existing.status === 'pending') {
    throw new Error('This booking has already been submitted and is waiting on the accounts team.')
  }
  if (existing.status === 'recorded') {
    throw new Error('A settlement has already been recorded against this booking.')
  }
  if (existing.actualBalancePayable === null) {
    throw new Error('Enter the actual balance payable before submitting — that is the figure accounts acts on.')
  }

  await accountsWrite(
    `UPDATE sl_transport_settlement_requests
        SET status = 'pending', submitted_by = ?, submitted_at = NOW(),
            submit_count = submit_count + 1,
            decided_by = NULL, decided_at = NULL, decision_note = NULL,
            updated_at = NOW()
      WHERE id = ? AND status IN ('draft', 'rejected', 'cancelled')`,
    [actor, existing.id],
  )

  const after = await fetchTransportActual(bookingId)
  if (!after) throw new Error('The submission was written but could not be read back.')
  return after
}

/**
 * Withdraw a submission the accounts team has not acted on.
 *
 * Guarded on `status = 'pending'` in the statement itself rather than on the
 * row read a moment earlier: a settlement recorded in the intervening seconds
 * must win, and this must then change nothing at all.
 */
export async function withdrawTransportActuals(
  bookingId: string,
  actor: string,
): Promise<TransportActuals> {
  const existing = await fetchTransportActual(bookingId)
  if (!existing) throw new Error('There is nothing to withdraw for this booking.')

  const res = await accountsWrite(
    `UPDATE sl_transport_settlement_requests
        SET status = 'cancelled', saved_by = ?, saved_at = NOW(), updated_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [actor, existing.id],
  )

  if (res.affectedRows === 0) {
    const now = await fetchTransportActual(bookingId)
    throw new Error(
      now?.status === 'recorded'
        ? 'Too late — the accounts team has already settled this booking.'
        : 'That submission is no longer pending.',
    )
  }

  const after = await fetchTransportActual(bookingId)
  if (!after) throw new Error('The withdrawal was written but could not be read back.')
  return after
}

/** The normalised key the accounts side matches a row on. */
function keyOf(value: string | null | undefined): string | null {
  return advanceBaseKey(value) || advanceKey(value) || null
}
