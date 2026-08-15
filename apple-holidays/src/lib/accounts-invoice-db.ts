/**
 * Reads a booking's client invoice and its payment ledger straight out of the
 * accounts database.
 *
 * Both systems sit on one MySQL instance, so this is a plain SELECT over
 * `generated_invoices` / `invoice_payments` — no HTTP hop, no second service to
 * be up, and no copy of the money kept on the OPS side. Nothing here writes;
 * the accounts system stays the only author of an invoice or a receipt.
 *
 * ---- What the accounts system stores, and what this module must not redo ----
 *
 * `paid_amount`, `balance_amount` and `payment_status` are *maintained* columns:
 * `GeneratedInvoice::recalculatePayments()` rewrites them on every receipt, for
 * every revision sharing the ledger. Re-summing the receipts here would be a
 * second implementation of the same arithmetic — agreeing today, drifting the
 * first time either side changed its rounding tolerance. So the state a badge
 * shows is read from those columns, and the receipt rows are fetched only to
 * *show the workings*, never to recompute the answer.
 *
 * ---- How a booking is matched to an invoice ----
 *
 * Three identities, in descending confidence:
 *
 *   base_invoice_number  the IS number, which is what an invoice is numbered on.
 *                        `IS48858`, `IS48858_R2/R2` and `IS48858R2` all reduce
 *                        to this, so an amended booking still matches.
 *   tour_ref             the booking reference as the invoice recorded it.
 *   the CNTL number      only ever against `tour_ref`, and never against the
 *                        invoice number: a bare control number *is* a valid
 *                        invoice number for some other booking, so matching it
 *                        on the number column would attach a stranger's money.
 *
 * ---- Revisions and the ledger ----
 *
 * A booking runs `IS48858` → `IS48858_R2/R2` → `IS48858_R3/R3`. Every revision
 * shares one `ledger_key` and the receipts hang off that key, so amending an
 * invoice carries the money already banked forward. The current revision is the
 * booking's live statement; the earlier ones are history, and this module
 * returns them in that shape.
 *
 * A cancellation invoice (`IS48858-CXL`) deliberately stands on its *own*
 * ledger — the accounts system keeps it out of the original's recalculation —
 * but it carries the booking's `tour_ref`, so it is picked up here and reported
 * alongside rather than folded in.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from './accounts-db'

// ── Keys ──────────────────────────────────────────────────────────────────────

/**
 * The form a reference is compared in: upper-cased, spaces stripped.
 *
 * Identical to `normaliseRef()` in the Detailed P&L reader, and to the
 * `REPLACE(UPPER(col), ' ', '')` the queries below apply to the stored side —
 * "IS 48858" in accounts still meets "IS48858" in OPS.
 */
export function invoiceKey(value: string | null | undefined): string {
  const key = String(value ?? '').toUpperCase().replace(/\s+/g, '')
  return ['', 'NA', 'NULL', 'NONE'].includes(key) ? '' : key
}

/**
 * The amendment base of a reference: `IS48858_R2/R2` and `VN40130R2` both
 * reduce to their base booking.
 *
 * Mirrors `GeneratedInvoice::parseInvoiceNumber()`. OPS usually holds the clean
 * reference while accounts holds the amended one, but the reduction is applied
 * to both sides so it does not matter which way round it is.
 */
export function invoiceBaseKey(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''

  const underscored = raw.match(/^(.+?)_R(\d{1,3})(?:[/_]R\d{1,3})?$/i)
  if (underscored) return invoiceKey(underscored[1])

  const legacy = raw.match(/^(.+\d)R(\d{1,3})$/i)
  if (legacy) return invoiceKey(legacy[1])

  return invoiceKey(raw)
}

/** What a booking may be looked up by. */
export interface InvoiceLookup {
  /** The OPS booking reference — `IS48858`. Also the key the answer comes back under. */
  reference: string
  /** The IS number, when the booking carries one separately from its ref. */
  isNumber?: string | null
  /** The control number. Matched against `tour_ref` only — see the header. */
  controlNumber?: string | null
}

/** Keys allowed to match the invoice number (and the tour ref). */
function strongKeys(l: InvoiceLookup): string[] {
  return Array.from(new Set(
    [l.reference, l.isNumber]
      .flatMap(v => [invoiceKey(v), invoiceBaseKey(v)])
      .filter(Boolean),
  ))
}

/**
 * Keys allowed to match the tour ref only.
 *
 * The CNTL number appears in accounts both bare (`485790`) and suffixed
 * (`485790CNTL`), depending on which extractor wrote the row.
 */
function tourOnlyKeys(l: InvoiceLookup): string[] {
  const cntl = invoiceKey(l.controlNumber)
  if (!cntl) return []
  return Array.from(new Set([cntl, `${cntl}CNTL`]))
}

// ── Row shapes ────────────────────────────────────────────────────────────────

/**
 * Everything a statement needs. Deliberately excludes `calculations` (the whole
 * invoice breakdown, a large JSON blob) — the panel shows money movement, not
 * the line items, which the Detailed P&L panel already covers.
 */
const INVOICE_COLUMNS = `
  id, invoice_number, base_invoice_number, revision_seq, is_latest, ledger_key,
  invoice_date, customer_name, guest_name, tour_ref, currency,
  total_amount, handling_fee, grand_total,
  invoice_type, is_cancellation, source_invoice_id, status,
  payment_status, paid_amount, balance_amount,
  exchange_rate_status, fixed_exchange_rate,
  first_payment_at, last_payment_at, payment_remarks,
  created_at, updated_at,
  REPLACE(UPPER(COALESCE(base_invoice_number, invoice_number)), ' ', '') AS base_key,
  REPLACE(UPPER(COALESCE(tour_ref, '')), ' ', '') AS tour_key
`

interface InvoiceRow extends RowDataPacket {
  id: number
  invoice_number: string | null
  base_invoice_number: string | null
  revision_seq: number | null
  is_latest: number | null
  ledger_key: string | null
  invoice_date: string | Date | null
  customer_name: string | null
  guest_name: string | null
  tour_ref: string | null
  currency: string | null
  total_amount: string | null
  handling_fee: string | null
  grand_total: string | null
  invoice_type: string | null
  is_cancellation: number | null
  source_invoice_id: number | null
  status: string | null
  payment_status: string | null
  paid_amount: string | null
  balance_amount: string | null
  exchange_rate_status: string | null
  fixed_exchange_rate: string | null
  first_payment_at: string | Date | null
  last_payment_at: string | Date | null
  payment_remarks: string | null
  created_at: string | Date | null
  updated_at: string | Date | null
  base_key: string | null
  tour_key: string | null
}

interface PaymentRow extends RowDataPacket {
  id: number
  invoice_id: number
  ledger_key: string | null
  sequence: number | null
  payment_date: string | Date | null
  amount: string | null
  currency: string | null
  exchange_rate: string | null
  amount_invoice_ccy: string | null
  mode_label: string | null
  mode_code: string | null
  mode_colour: string | null
  bank_name: string | null
  reference_number: string | null
  attachment_name: string | null
  status: string | null
  remarks: string | null
  recorded_by: string | null
  is_refund: number | null
  created_at: string | Date | null
}

// ── Scalars ───────────────────────────────────────────────────────────────────

/** MySQL hands DECIMAL back as a string; a money figure must not become NaN. */
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function money(v: string | number | null | undefined): number {
  return num(v) ?? 0
}

/**
 * A DATE column as `YYYY-MM-DD`.
 *
 * The shared connection runs with `dateStrings: false` and `timezone: 'Z'`, so
 * a DATE arrives as a Date pinned to UTC midnight — slicing its ISO string is
 * the calendar day that was stored, with no local-timezone shift.
 */
function dayStr(v: string | Date | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  return String(v).slice(0, 10)
}

/** A TIMESTAMP as an ISO instant. */
function isoStr(v: string | Date | null | undefined): string | null {
  if (!v) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  return String(v)
}

// ── Public shapes ─────────────────────────────────────────────────────────────

/**
 * What the badge says.
 *
 *   paid       the accounts system has the invoice fully received
 *   partial    some money in, a balance still outstanding
 *   unpaid     an invoice exists and nothing has been received against it
 *   cancelled  the ledger was marked cancelled in accounts
 *   none       accounts has no invoice for this booking (an ordinary state)
 *   unknown    the accounts database could not be read — not a "no"
 */
export type InvoicePaymentState = 'paid' | 'partial' | 'unpaid' | 'cancelled' | 'none' | 'unknown'

/** One line of the money story, enough for a badge or a table cell. */
export interface InvoicePaymentSummary {
  reference: string
  state: InvoicePaymentState
  /** Why there is nothing to show, when `state` is `none` or `unknown`. */
  message?: string

  invoiceId?: number
  /** The current revision's number, e.g. `IS48858_R2/R2`. */
  invoiceNumber?: string | null
  /** The IS number every revision shares. */
  baseNumber?: string | null
  /** 1 for an original, 2+ for an amendment. */
  revision?: number
  /** How many revisions this booking has been through. */
  revisionCount?: number
  invoiceDate?: string | null
  currency?: string

  /** Face value of the current revision — what the payments are measured against. */
  invoiceValue?: number
  paidAmount?: number
  /** Outstanding. Negative when an amendment landed below what was already paid. */
  balanceAmount?: number
  /** Banked above the invoice value — a refund due, not a credit. */
  overpaidAmount?: number
  paidPercent?: number

  paymentCount?: number
  firstPaymentAt?: string | null
  lastPaymentAt?: string | null

  /** Which identity matched, so the panel can say how it found this invoice. */
  matchedBy?: 'invoice_number' | 'tour_ref' | 'control_number'

  /** A cancellation invoice exists for this booking — it stands on its own ledger. */
  cancellation?: {
    invoiceNumber: string | null
    /** The cancellation fee billed. */
    feeAmount: number
    paidAmount: number
    balanceAmount: number
    currency: string
    state: InvoicePaymentState
  } | null
}

/** One receipt, as recorded in accounts. */
export interface InvoiceReceipt {
  id: number
  sequence: number
  /** "1st payment", "2nd payment", … — mirrors `InvoicePayment::sequence_label`. */
  label: string
  paymentDate: string | null
  amount: number
  currency: string
  exchangeRate: number | null
  amountInvoiceCcy: number
  modeLabel: string | null
  modeColour: string | null
  bankName: string | null
  referenceNumber: string | null
  attachmentName: string | null
  status: string
  remarks: string | null
  recordedBy: string | null
  isRefund: boolean
  /** False when the receipt was taken against an earlier revision and carried forward. */
  onCurrentRevision: boolean
  createdAt: string | null
}

/** One revision of the invoice — the current one, or a superseded statement. */
export interface InvoiceRevision {
  id: number
  invoiceNumber: string | null
  revision: number
  isLatest: boolean
  invoiceDate: string | null
  currency: string
  totalAmount: number
  handlingFee: number
  grandTotal: number
  status: string | null
  paymentStatus: string | null
  paidAmount: number
  balanceAmount: number
}

/** The whole statement for one booking. */
export interface InvoiceLedger {
  summary: InvoicePaymentSummary
  /** Newest revision first. */
  revisions: InvoiceRevision[]
  /** Every receipt on the booking's ledger, oldest first. */
  receipts: InvoiceReceipt[]
  customerName: string | null
  guestName: string | null
  tourRef: string | null
  invoiceType: string | null
  /** `not_fixed` until the first receipt locks the rate in, then `fixed`. */
  exchangeRateStatus: string | null
  fixedExchangeRate: number | null
  paymentRemarks: string | null
  /** The cancellation invoice's own revisions and receipts, when there is one. */
  cancellationReceipts: InvoiceReceipt[]
  updatedAt: string | null
}

// ── Grouping ──────────────────────────────────────────────────────────────────

/** Rows sharing one `ledger_key` — one booking's invoice and all its revisions. */
interface Ledger {
  key: string
  rows: InvoiceRow[]
  /** The live statement: the flagged latest, else the highest revision. */
  current: InvoiceRow
  isCancellation: boolean
}

/**
 * Group rows into ledgers, newest revision first inside each.
 *
 * `is_latest` is maintained by the accounts model, but a row is picked by
 * revision order when the flag is missing or ambiguous — the flag is a cache of
 * this ordering, and a statement must never be chosen by a stale boolean.
 */
function toLedgers(rows: InvoiceRow[]): Ledger[] {
  const groups = new Map<string, InvoiceRow[]>()

  for (const row of rows) {
    // A row written before ledger keys existed still has an identity: its own base.
    const key = row.ledger_key || `B:${row.base_key ?? row.id}`
    const list = groups.get(key)
    if (list) list.push(row)
    else groups.set(key, [row])
  }

  return Array.from(groups.entries()).map(([key, list]) => {
    const sorted = [...list].sort(
      (a, b) => (Number(b.revision_seq ?? 1) - Number(a.revision_seq ?? 1)) || (b.id - a.id),
    )
    const current = sorted.find(r => Number(r.is_latest) === 1) ?? sorted[0]

    return {
      key,
      rows: sorted,
      current,
      isCancellation: sorted.some(r => Number(r.is_cancellation) === 1),
    }
  })
}

/** Which of a booking's ledgers is its actual invoice, and which is the cancellation. */
function splitLedgers(ledgers: Ledger[]): { primary: Ledger | null; cancellation: Ledger | null } {
  const cancellation = ledgers.find(l => l.isCancellation) ?? null
  const primary = ledgers.find(l => !l.isCancellation) ?? null
  return { primary, cancellation }
}

/**
 * The state a ledger is in.
 *
 * Read from `payment_status` — the column accounts maintains — with the amounts
 * used only to resolve the one case that column cannot express: a status still
 * saying `pending` on a row whose payments have not been recalculated yet.
 */
function stateOf(row: InvoiceRow): InvoicePaymentState {
  if (row.payment_status === 'cancelled') return 'cancelled'

  const paid  = money(row.paid_amount)
  const value = money(row.grand_total) || money(row.total_amount)

  switch (row.payment_status) {
    case 'fully_received': return 'paid'
    case 'part_received':  return 'partial'
    default:
      if (paid <= 0) return 'unpaid'
      // 0.5 absorbs the same rounding drift the accounts recalculation allows.
      return paid >= value - 0.5 ? 'paid' : 'partial'
  }
}

function summarise(reference: string, ledgers: Ledger[], matchedBy: InvoicePaymentSummary['matchedBy']): InvoicePaymentSummary {
  const { primary, cancellation } = splitLedgers(ledgers)

  // A booking whose only document is a cancellation invoice — the original was
  // never raised, or was raised outside this system. The CXL invoice is then
  // the statement, not a footnote to one.
  const lead = primary ?? cancellation
  if (!lead) {
    return { reference, state: 'none', message: 'No invoice for this booking in the accounts system yet.' }
  }

  const row   = lead.current
  const value = money(row.grand_total) || money(row.total_amount)
  const paid  = money(row.paid_amount)

  /**
   * A booking whose only document is a cancellation invoice reads `cancelled`,
   * whatever that invoice's own payment status says.
   *
   * Accounts marks a zero-fee cancellation `fully_received` — correct on its own
   * terms, there is nothing to collect — but rendering that as a green "Paid"
   * against a cancelled booking would tell the board the exact opposite of what
   * happened. The cancellation block below still shows the fee's real state.
   */
  const state = lead === cancellation ? 'cancelled' : stateOf(row)

  return {
    reference,
    state,
    invoiceId: row.id,
    invoiceNumber: row.invoice_number,
    baseNumber: row.base_invoice_number,
    revision: Number(row.revision_seq ?? 1),
    revisionCount: lead.rows.length,
    invoiceDate: dayStr(row.invoice_date),
    currency: row.currency ?? 'USD',

    invoiceValue: value,
    paidAmount: paid,
    // `balance_amount` is the maintained column; falling back to the
    // subtraction only covers rows written before payment tracking existed.
    balanceAmount: num(row.balance_amount) ?? Number((value - paid).toFixed(2)),
    overpaidAmount: Math.max(0, Number((paid - value).toFixed(2))),
    paidPercent: value > 0 ? Math.min(100, Number(((paid / value) * 100).toFixed(1))) : 0,

    firstPaymentAt: dayStr(row.first_payment_at),
    lastPaymentAt: dayStr(row.last_payment_at),
    matchedBy,

    cancellation: cancellation && primary
      ? {
          invoiceNumber: cancellation.current.invoice_number,
          feeAmount: money(cancellation.current.grand_total),
          paidAmount: money(cancellation.current.paid_amount),
          balanceAmount: num(cancellation.current.balance_amount) ?? 0,
          currency: cancellation.current.currency ?? row.currency ?? 'USD',
          state: stateOf(cancellation.current),
        }
      : null,
  }
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Pick this booking's ledgers out of the fetched rows.
 *
 * Strict order: an invoice numbered on the booking wins outright; only if there
 * is none does a tour-ref match count; the control number is last and is never
 * allowed near the invoice-number column. Mixing them would let a booking claim
 * an invoice that merely quotes its control number.
 */
function matchRows(
  lookup: InvoiceLookup,
  rows: InvoiceRow[],
): { rows: InvoiceRow[]; matchedBy: InvoicePaymentSummary['matchedBy'] } | null {
  const strong = new Set(strongKeys(lookup))
  const tourOnly = new Set(tourOnlyKeys(lookup))

  const byNumber = rows.filter(r => r.base_key && strong.has(r.base_key))
  const byTour   = rows.filter(r => r.tour_key && strong.has(r.tour_key))
  const byCntl   = rows.filter(r => r.tour_key && tourOnly.has(r.tour_key))

  // A cancellation invoice is numbered `IS48858-CXL`, so it is never a
  // number match — it comes in on the tour ref and has to be carried alongside
  // whichever set won, or a cancelled booking would show no cancellation.
  const carryCxl = (won: InvoiceRow[]) => {
    const ids = new Set(won.map(r => r.id))
    const cxl = [...byTour, ...byCntl].filter(r => Number(r.is_cancellation) === 1 && !ids.has(r.id))
    return [...won, ...cxl]
  }

  if (byNumber.length) return { rows: carryCxl(byNumber), matchedBy: 'invoice_number' }
  if (byTour.length)   return { rows: byTour,             matchedBy: 'tour_ref' }
  if (byCntl.length)   return { rows: byCntl,             matchedBy: 'control_number' }

  return null
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** Never build one statement with more placeholders than this. */
const CHUNK = 400

async function fetchInvoiceRows(lookups: InvoiceLookup[]): Promise<InvoiceRow[]> {
  const numberKeys = new Set<string>()
  const tourKeys = new Set<string>()

  for (const l of lookups) {
    for (const k of strongKeys(l)) { numberKeys.add(k); tourKeys.add(k) }
    for (const k of tourOnlyKeys(l)) tourKeys.add(k)
  }

  const numbers = Array.from(numberKeys)
  const tours = Array.from(tourKeys)
  if (numbers.length === 0 && tours.length === 0) return []

  const out: InvoiceRow[] = []
  const seen = new Set<number>()

  // The two key sets are the same length in the common case, so one chunk loop
  // walks both; a set that runs out simply contributes an empty predicate.
  const passes = Math.ceil(Math.max(numbers.length, tours.length) / CHUNK)

  for (let p = 0; p < passes; p++) {
    const numSlice  = numbers.slice(p * CHUNK, (p + 1) * CHUNK)
    const tourSlice = tours.slice(p * CHUNK, (p + 1) * CHUNK)

    const clauses: string[] = []
    const params: string[] = []

    if (numSlice.length) {
      clauses.push(`REPLACE(UPPER(COALESCE(base_invoice_number, invoice_number)), ' ', '') IN (${numSlice.map(() => '?').join(',')})`)
      params.push(...numSlice)
    }
    if (tourSlice.length) {
      clauses.push(`REPLACE(UPPER(COALESCE(tour_ref, '')), ' ', '') IN (${tourSlice.map(() => '?').join(',')})`)
      params.push(...tourSlice)
    }
    if (clauses.length === 0) continue

    const rows = await accountsQuery<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS}
         FROM generated_invoices
        WHERE deleted_at IS NULL
          AND (${clauses.join(' OR ')})`,
      params,
    )

    for (const r of rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
    }
  }

  return out
}

/**
 * One summary per booking, in one round trip.
 *
 * A booking accounts has never invoiced comes back as `none` rather than being
 * dropped: "no invoice raised yet" is information the board should show, where
 * a missing entry renders as a cell that never resolves.
 */
export async function fetchInvoicePaymentSummaries(
  lookups: InvoiceLookup[],
): Promise<Map<string, InvoicePaymentSummary>> {
  const out = new Map<string, InvoicePaymentSummary>()
  if (lookups.length === 0) return out

  const rows = await fetchInvoiceRows(lookups)

  for (const lookup of lookups) {
    const matched = matchRows(lookup, rows)
    out.set(
      lookup.reference,
      matched
        ? summarise(lookup.reference, toLedgers(matched.rows), matched.matchedBy)
        : { reference: lookup.reference, state: 'none', message: 'No invoice for this booking in the accounts system yet.' },
    )
  }

  return out
}

/** Every receipt filed under these ledgers / invoices, oldest first. */
async function fetchReceipts(ledgerKeys: string[], invoiceIds: number[]): Promise<PaymentRow[]> {
  if (ledgerKeys.length === 0 && invoiceIds.length === 0) return []

  const clauses: string[] = []
  const params: (string | number)[] = []

  if (ledgerKeys.length) {
    clauses.push(`p.ledger_key IN (${ledgerKeys.map(() => '?').join(',')})`)
    params.push(...ledgerKeys)
  }
  // Also by invoice id: `ledger_key` was added to receipts after the fact, and
  // a row the backfill never reached would otherwise vanish from the statement.
  if (invoiceIds.length) {
    clauses.push(`p.invoice_id IN (${invoiceIds.map(() => '?').join(',')})`)
    params.push(...invoiceIds)
  }

  return accountsQuery<PaymentRow>(
    `SELECT p.id, p.invoice_id, p.ledger_key, p.sequence, p.payment_date, p.amount,
            p.currency, p.exchange_rate, p.amount_invoice_ccy, p.mode_label,
            p.reference_number, p.attachment_name, p.status, p.remarks,
            p.recorded_by, p.is_refund, p.created_at,
            m.code AS mode_code, m.colour AS mode_colour, m.bank_name AS bank_name
       FROM invoice_payments p
       LEFT JOIN payment_modes m ON m.id = p.payment_mode_id
      WHERE p.deleted_at IS NULL
        AND (${clauses.join(' OR ')})
      ORDER BY p.payment_date ASC, p.sequence ASC, p.id ASC`,
    params,
  )
}

/** "1st payment", "2nd payment", … — mirrors `InvoicePayment::sequence_label`. */
function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

function toReceipt(row: PaymentRow, currentInvoiceId: number | null): InvoiceReceipt {
  const seq = Number(row.sequence ?? 1)
  const refund = Number(row.is_refund) === 1

  return {
    id: row.id,
    sequence: seq,
    label: refund ? 'Refund' : `${ordinal(seq)} payment`,
    paymentDate: dayStr(row.payment_date),
    amount: money(row.amount),
    currency: row.currency ?? 'USD',
    exchangeRate: num(row.exchange_rate),
    amountInvoiceCcy: money(row.amount_invoice_ccy),
    modeLabel: row.mode_label ?? row.mode_code ?? null,
    modeColour: row.mode_colour ?? null,
    bankName: row.bank_name ?? null,
    referenceNumber: row.reference_number ?? null,
    attachmentName: row.attachment_name ?? null,
    status: row.status ?? 'confirmed',
    remarks: row.remarks ?? null,
    recordedBy: row.recorded_by ?? null,
    isRefund: refund,
    onCurrentRevision: currentInvoiceId === null || row.invoice_id === currentInvoiceId,
    createdAt: isoStr(row.created_at),
  }
}

function toRevision(row: InvoiceRow): InvoiceRevision {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    revision: Number(row.revision_seq ?? 1),
    isLatest: Number(row.is_latest) === 1,
    invoiceDate: dayStr(row.invoice_date),
    currency: row.currency ?? 'USD',
    totalAmount: money(row.total_amount),
    handlingFee: money(row.handling_fee),
    grandTotal: money(row.grand_total),
    status: row.status,
    paymentStatus: row.payment_status,
    paidAmount: money(row.paid_amount),
    balanceAmount: num(row.balance_amount) ?? 0,
  }
}

/**
 * The whole statement for one booking — revisions, receipts, cancellation.
 *
 * Returns `null` when accounts has no invoice for the booking; the caller
 * reports that as a state, not as an error.
 */
export async function fetchInvoiceLedger(lookup: InvoiceLookup): Promise<InvoiceLedger | null> {
  const rows = await fetchInvoiceRows([lookup])
  const matched = matchRows(lookup, rows)
  if (!matched) return null

  const ledgers = toLedgers(matched.rows)
  const { primary, cancellation } = splitLedgers(ledgers)
  const lead = primary ?? cancellation
  if (!lead) return null

  const allRows = ledgers.flatMap(l => l.rows)
  const receiptRows = await fetchReceipts(
    Array.from(new Set(allRows.map(r => r.ledger_key).filter((v): v is string => !!v))),
    allRows.map(r => r.id),
  )

  const cancellationIds = new Set(cancellation?.rows.map(r => r.id) ?? [])
  const cancellationKeys = new Set(cancellation?.rows.map(r => r.ledger_key).filter(Boolean) ?? [])
  const isCancellationReceipt = (r: PaymentRow) =>
    Boolean(cancellation) && (cancellationIds.has(r.invoice_id) || (r.ledger_key ? cancellationKeys.has(r.ledger_key) : false))

  const head = lead.current
  const receipts = receiptRows.filter(r => !isCancellationReceipt(r)).map(r => toReceipt(r, head.id))

  return {
    // The receipt count is only knowable once the receipts have been fetched,
    // so the batch summaries leave it unset rather than guessing at it.
    summary: { ...summarise(lookup.reference, ledgers, matched.matchedBy), paymentCount: receipts.length },
    revisions: lead.rows.map(toRevision),
    receipts,
    cancellationReceipts: cancellation
      ? receiptRows.filter(isCancellationReceipt).map(r => toReceipt(r, cancellation.current.id))
      : [],
    customerName: head.customer_name,
    guestName: head.guest_name,
    tourRef: head.tour_ref,
    invoiceType: head.invoice_type,
    exchangeRateStatus: head.exchange_rate_status,
    fixedExchangeRate: num(head.fixed_exchange_rate),
    paymentRemarks: head.payment_remarks,
    updatedAt: isoStr(head.updated_at),
  }
}
