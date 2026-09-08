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

/**
 * What the driver is being settled for.
 *
 * The workbook has carried this as a free-typed word for years and the three
 * values below are every one it has ever held. Kept closed so the register can
 * group and total by it; anything unrecognised is stored as null rather than
 * invented, because a mis-typed cost type silently in the wrong subtotal is
 * worse than an empty cell.
 */
export type SettlementCostType = 'transport' | 'transport_entrance' | 'transfer'

export const COST_TYPES: SettlementCostType[] = ['transport', 'transport_entrance', 'transfer']

export const COST_TYPE_LABEL: Record<SettlementCostType, string> = {
  transport:          'Transport',
  transport_entrance: 'Transport + Entrance',
  transfer:           'Transfer',
}

/** The stored value for a cost type, or null when it is not one we know. */
export function toCostType(value: string | null | undefined): SettlementCostType | null {
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s+]+/g, '_')
  return (COST_TYPES as string[]).includes(v) ? (v as SettlementCostType) : null
}

/**
 * A bulk number, normalised.
 *
 * Upper-cased and stripped of everything but letters, digits and a dash, so
 * "503", " 503 " and "503 " are one bulk rather than three. Empty means the
 * booking is not in a bulk, which is a normal state and not an error.
 */
export function toBulkNo(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return v === '' ? null : v.slice(0, 32)
}

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

  /**
   * The settlement register's own three columns.
   *
   * A bulk is a payment run: the desk gathers a batch of finished tours under
   * one number ("503") and hands the whole batch to accounts as a unit, exactly
   * as the settlement workbook has always been kept. `costType` says what the
   * driver is being paid for — the package alone, the package with entrance
   * tickets, or a single transfer — and `budgetedCost` is the figure the tour
   * was costed at, which is what the excess/(shortage) column is measured
   * against. All three are the desk's, and all three are optional: a booking
   * settled one-off carries none of them.
   */
  bulkNo: string | null
  costType: SettlementCostType | null
  budgetedCost: number | null
  remarks: string | null

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

  /** The register's columns. Undefined leaves whatever is already stored alone. */
  bulkNo?: string | null
  costType?: SettlementCostType | null
  budgetedCost?: number | null
  remarks?: string | null

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
  bulk_no, cost_type, budgeted_cost_lkr, settlement_remark,
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
  bulk_no: string | null
  cost_type: string | null
  budgeted_cost_lkr: string | null
  settlement_remark: string | null
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

    bulkNo:       r.bulk_no,
    costType:     toCostType(r.cost_type),
    budgetedCost: num(r.budgeted_cost_lkr),
    remarks:      r.settlement_remark,

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
 * The register columns a save is actually changing.
 *
 * Built from the keys *present* on the input rather than from their values, so
 * the Drive Log — which knows nothing about bulks or cost types and sends
 * neither — can go on saving a booking's figures without blanking the register
 * entries somebody else made on the same row. An explicit `null` still clears
 * the column; that is how a booking is taken out of a bulk.
 */
function metaClause(input: ActualsInput): { sql: string; params: unknown[] } {
  const sets: string[] = []
  const params: unknown[] = []

  if ('bulkNo' in input) {
    sets.push('bulk_no = ?')
    params.push(toBulkNo(input.bulkNo))
  }
  if ('costType' in input) {
    sets.push('cost_type = ?')
    params.push(toCostType(input.costType))
  }
  if ('budgetedCost' in input) {
    sets.push('budgeted_cost_lkr = ?')
    params.push(money(input.budgetedCost))
  }
  if ('remarks' in input) {
    sets.push('settlement_remark = ?')
    params.push(input.remarks?.trim().slice(0, 500) || null)
  }

  return { sql: sets.length ? `${sets.join(', ')}, ` : '', params }
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

  const meta = metaClause(input)

  if (existing) {
    // Re-saving after a rejection clears the accounts side's answer: leaving
    // last week's "sent back" note on a figure that has since changed is how a
    // desk reads the wrong reason.
    await accountsWrite(
      `UPDATE sl_transport_settlement_requests
          SET booking_ref = ?, is_number = ?, cntl_number = ?, is_key = ?, control_key = ?,
              pnl_record_id = ?, travel_start_date = ?, driver_name = ?,
              actual_package_cost_lkr = ?, actual_balance_payable_lkr = ?, request_note = ?,
              ${meta.sql}computed_total_cost_lkr = ?, computed_advance_lkr = ?,
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
        ...meta.params,
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
          bulk_no, cost_type, budgeted_cost_lkr, settlement_remark,
          computed_total_cost_lkr, computed_advance_lkr,
          computed_balance_payable_lkr, advance_paid_lkr, rate,
          status, saved_by, saved_at, submit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), 0, NOW(), NOW())`,
      [
        input.bookingId, input.bookingRef, input.isNumber, input.cntlNumber,
        keyOf(input.isNumber ?? input.bookingRef), keyOf(input.cntlNumber),
        input.pnlRecordId, input.travelStartDate, input.driverName,
        pkg, balance, note,
        toBulkNo(input.bulkNo), toCostType(input.costType),
        money(input.budgetedCost ?? null), input.remarks?.trim().slice(0, 500) || null,
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

/**
 * Set the register's own columns on a booking, and nothing else.
 *
 * Separate from `saveTransportActuals` on purpose. Putting a finished tour into
 * a bulk, naming what it is being paid for, or writing a remark against it is
 * bookkeeping about a settlement, not an assertion about what it cost — so it
 * must not reset the status to `draft`, must not clear an accounts decision,
 * and is allowed on a row that has already been settled, where the money is
 * closed but the paperwork is still being filed.
 *
 * A booking with no row yet gets one, carrying the identity the accounts side
 * matches on and no figures at all: an entry in a bulk is a perfectly good
 * thing to record before anybody has costed the tour.
 */
export async function applySettlementMeta(
  input: ActualsInput,
  actor: string,
): Promise<TransportActuals> {
  const existing = await fetchTransportActual(input.bookingId)
  const meta = metaClause(input)

  if (!meta.sql) {
    if (existing) return existing
    throw new Error('Nothing to record against this booking.')
  }

  // `metaClause` ends its fragment with a comma so it can sit in front of the
  // save statement's own columns; here it is the whole SET list, so the comma
  // has to come off.
  const sets = meta.sql.replace(/,\s*$/, '')

  if (existing) {
    await accountsWrite(
      `UPDATE sl_transport_settlement_requests
          SET ${sets}, saved_by = ?, saved_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [...meta.params, actor, existing.id],
    )
  } else {
    await accountsWrite(
      `INSERT INTO sl_transport_settlement_requests
         (ops_booking_id, booking_ref, is_number, cntl_number, is_key, control_key,
          pnl_record_id, travel_start_date, driver_name,
          bulk_no, cost_type, budgeted_cost_lkr, settlement_remark,
          status, saved_by, saved_at, submit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NOW(), 0, NOW(), NOW())`,
      [
        input.bookingId, input.bookingRef, input.isNumber, input.cntlNumber,
        keyOf(input.isNumber ?? input.bookingRef), keyOf(input.cntlNumber),
        input.pnlRecordId, input.travelStartDate, input.driverName,
        toBulkNo(input.bulkNo), toCostType(input.costType),
        money(input.budgetedCost ?? null), input.remarks?.trim().slice(0, 500) || null,
        actor,
      ],
    )
  }

  const after = await fetchTransportActual(input.bookingId)
  if (!after) throw new Error('The entry was written but could not be read back.')
  return after
}

/** The normalised key the accounts side matches a row on. */
function keyOf(value: string | null | undefined): string | null {
  return advanceBaseKey(value) || advanceKey(value) || null
}
