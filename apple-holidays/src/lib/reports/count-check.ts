/**
 * The count check — the one paragraph both daily emails must agree on.
 *
 * ## Why this exists
 *
 * Two systems mail a daily report to the same inboxes every morning. The
 * accounts system leads with "41 bookings · 41 P&Ls · 41 invoices — balanced"
 * and this system led with "42 new bookings". Both figures were individually
 * defensible and the reader had no way to reconcile them, which is exactly the
 * failure the Sync Ledger was built to end: a day once went out as 51 bookings,
 * 64 P&Ls and 87 invoices with nothing able to say which was right.
 *
 * So the two mails now quote the *same numbers from the same rows*. The
 * accounts system computes its count check from `sync_ledger_entries`
 * (`SyncParityService`); this module reads those same rows over the read-only
 * accounts connection and applies the same arithmetic, field for field:
 *
 *   • one booking counts once — invoice and P&L revisions are not counted again;
 *   • a booking cancelled upstream is not owed a live P&L or invoice;
 *   • a B2C order that settles to zero after refunds is correctly uninvoiced;
 *   • a window nobody swept reads "not checked", never "balanced" — zero
 *     against zero balances perfectly, and that is the one way a check could
 *     quietly certify a day it never looked at.
 *
 * Anything left over is a real shortfall and is named as one.
 *
 * ## The fourth leg
 *
 * The accounts mail prints three columns (upstream · P&Ls · invoices) and folds
 * the OPS booking leg into its "short" total, because on that side a missing
 * OPS booking is somebody else's job. Here it is *this* system's job, so the
 * OPS column is printed in full and put next to the number this report has
 * always led with — "bookings created yesterday" — with the difference between
 * the two explained rather than left for the reader:
 *
 *   • **matched** — created here, confirmed upstream in the same window;
 *   • **entered here later** — confirmed in the window, filed here on a later
 *     day (the booking is not missing, it arrived after midnight);
 *   • **earlier confirmations** — created here in the window against a
 *     confirmation raised on an earlier day, which is why this system's intake
 *     count can legitimately exceed the day's confirmation count;
 *   • **missing** — confirmed upstream, nothing here. The only one to act on.
 *
 * ## Document activity
 *
 * The count check answers "is the day whole?". It does not answer "how much did
 * accounts issue?" — an invoice raised yesterday against a booking confirmed
 * last week is correct, not a discrepancy, which is why the accounts mail's
 * headline (50 invoices: 6 new, 44 amended) is a larger number than the day's
 * 41 confirmations. Both are carried, side by side, with that sentence attached,
 * so neither can be mistaken for the other again.
 *
 * ## Safety
 *
 * Every statement here is a SELECT, on the shared read-only accounts client and
 * on Prisma. This module derives; it never writes, and it never throws — an
 * accounts database that cannot be reached produces a section marked
 * unavailable, because a report that fails to render is worse than one with a
 * named hole in it.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from '@/lib/accounts-db'
import { prisma } from '@/lib/prisma'
import { bookingSourceOf } from '@/lib/booking-source'
import type { ReportWindow } from './report-window'

/**
 * The ledger's own key rule, mirrored: `SyncLedgerService::keyFor()` strips
 * *every* non-alphanumeric, so "VN-40499", "vn 40499" and "VN40499" are one
 * booking. This system's `normalizeIsNumber()` only strips whitespace, which
 * would leave a hyphenated ref unmatched against the very ledger row it belongs
 * to — so the comparison is made on the ledger's spelling, not on ours.
 */
function ledgerKey(reference: string | null | undefined): string {
  const key = String(reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key === 'NA' ? '' : key
}

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** The channels the Sync Ledger keeps, with the labels the accounts mail prints. */
export const COUNT_CHECK_CHANNELS = {
  as: 'Apple System (B2B)',
  b2c: 'Aahaas B2C',
} as const

export type CountCheckChannel = keyof typeof COUNT_CHECK_CHANNELS

export type CountCheckStatus = 'balanced' | 'short' | 'unchecked'

/** One channel's four counts and the verdict they add up to. */
export interface CountCheckTally {
  channel: CountCheckChannel | 'all'
  label: string
  /** Confirmations (or storefront orders) raised upstream in the window. */
  upstream: number
  /** Of those, how many this system holds as a booking. */
  bookings: number
  /** How many carry a P&L in accounts. */
  pnls: number
  /** How many carry an invoice in accounts. */
  invoices: number
  /** Withdrawn upstream — not owed a live P&L or invoice. */
  cancelled: number
  /** B2C orders settling to zero after refunds — correctly uninvoiced. */
  notBillable: number
  /** `upstream - cancelled`: what the day is entitled to expect. */
  expected: number
  /** `expected - notBillable`: the same, for invoices. */
  expectedInvoices: number
  pnlShort: number
  invoiceShort: number
  /** Always 0 for B2C — the storefront files its own order, OPS never does. */
  bookingShort: number
  balanced: boolean
  status: CountCheckStatus
  /** The sentence the accounts mail prints, word for word. */
  verdict: string
  /** When the sweep last covered these rows — `null` means never. */
  checkedAt: string | null
}

/** What accounts *issued* in the window, as opposed to what the day was owed. */
export interface AccountsActivity {
  /** Distinct bookings billed in the window — the accounts mail's headline. */
  invoiceBookings: number
  /** Of those, first-time bills. */
  invoicesNew: number
  /** Of those, re-issues of a booking already billed. */
  invoicesAmended: number
  /** Of those, cancellation documents. */
  invoicesCancelled: number
  /** Invoice documents actually written, revisions included. */
  invoiceDocuments: number
  /** Distinct bookings a P&L was written for. */
  pnlBookings: number
  pnlDocuments: number
  /** Same again for the AHDS book only, which the accounts mail reports alone. */
  ahds: {
    invoiceBookings: number
    invoicesNew: number
    invoicesAmended: number
    invoicesCancelled: number
  }
}

/** Why this system's intake count and the day's confirmation count differ. */
export interface IntakeReconciliation {
  /** B2B bookings this system created in the window, by its own clock. */
  opsCreated: number
  /** Of those, answering a confirmation raised in the same window. */
  matched: number
  /** Created here in the window against a confirmation raised earlier. */
  earlierConfirmations: number
  /** Confirmed in the window, filed here on a later day. Present, not missing. */
  enteredLater: number
  /** Confirmed in the window, nothing here at all. The number to act on. */
  missing: number
  /** The references behind `missing`, so the count is actionable. */
  missingRefs: string[]
}

export interface CountCheckSection {
  /** False when the accounts database could not be read. */
  available: boolean
  /** Why it is unavailable, when it is. */
  error: string | null
  /** ISO instant the ledger last swept these dates; null = never swept. */
  sweptAt: string | null
  /** True only when every channel balances *and* the window was swept. */
  balanced: boolean
  /** Channels the sweep has never covered — a verdict on them would be a lie. */
  unchecked: string[]
  /** The one-line verdict, identical to the accounts mail's. */
  headline: string
  channels: CountCheckTally[]
  overall: CountCheckTally
  activity: AccountsActivity | null
  intake: IntakeReconciliation | null
}

// ─── Ledger rows ──────────────────────────────────────────────────────────────

interface LedgerRow extends RowDataPacket {
  channel: string
  is_key: string
  booking_ref: string | null
  as_cancelled: number
  as_amount: string | number | null
  booking_present: number
  pnl_present: number
  invoice_present: number
  muted_at: string | null
  last_checked_at: string | Date | null
}

function emptyTally(channel: CountCheckTally['channel'], label: string): CountCheckTally {
  return {
    channel, label,
    upstream: 0, bookings: 0, pnls: 0, invoices: 0,
    cancelled: 0, notBillable: 0,
    expected: 0, expectedInvoices: 0,
    pnlShort: 0, invoiceShort: 0, bookingShort: 0,
    balanced: true, status: 'balanced', verdict: '', checkedAt: null,
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Turn the counts into the sentence a person reads — the same wording as
 * `SyncParityService::finalise()`, so the two mails cannot phrase the same
 * verdict two different ways.
 */
function finalise(t: CountCheckTally): CountCheckTally {
  const short = t.pnlShort + t.invoiceShort + t.bookingShort

  t.balanced = short === 0
  t.status = short === 0 ? 'balanced' : 'short'

  // No rows *and* no sweep is "we did not look", not "there was nothing". The
  // counts alone cannot tell those apart, which is why the sweep stamp decides.
  if (t.upstream === 0) {
    const checked = t.checkedAt !== null
    t.status = checked ? 'balanced' : 'unchecked'
    t.balanced = checked
    t.verdict = checked
      ? `${t.label}: nothing raised in this window.`
      : `${t.label}: not checked in this window — no sweep has covered these dates.`
    return t
  }

  if (t.balanced) {
    t.verdict = `${t.label}: ${plural(t.upstream, 'booking')} · ${plural(t.pnls, 'P&L')} · ${plural(t.invoices, 'invoice')} — balanced.`
    return t
  }

  const missing: string[] = []
  if (t.pnlShort > 0) missing.push(plural(t.pnlShort, 'P&L'))
  if (t.invoiceShort > 0) missing.push(plural(t.invoiceShort, 'invoice'))
  if (t.bookingShort > 0) missing.push(plural(t.bookingShort, 'OPS booking'))

  t.verdict = `${t.label}: ${plural(t.upstream, 'booking')} upstream, missing ${missing.join(' and ')}.`
  return t
}

/** Fold one channel's ledger rows into its tally. */
function tally(rows: LedgerRow[], channel: CountCheckChannel): CountCheckTally {
  const t = emptyTally(channel, COUNT_CHECK_CHANNELS[channel])
  let checked: number | null = null

  for (const row of rows) {
    t.upstream++

    const at = row.last_checked_at ? new Date(row.last_checked_at).getTime() : null
    if (at !== null && Number.isFinite(at) && (checked === null || at > checked)) checked = at

    if (row.as_cancelled) t.cancelled++

    // The one legitimate reason for a booking to exist with no invoice:
    // recorded, so the shortfall below is a real shortfall and not a known
    // exception.
    if (channel === 'b2c' && !row.as_cancelled && Number(row.as_amount ?? 0) <= 0) t.notBillable++

    if (row.booking_present) t.bookings++
    if (row.pnl_present) t.pnls++
    if (row.invoice_present) t.invoices++
  }

  t.expected = Math.max(0, t.upstream - t.cancelled)
  t.expectedInvoices = Math.max(0, t.expected - t.notBillable)
  t.pnlShort = Math.max(0, t.expected - t.pnls)
  t.invoiceShort = Math.max(0, t.expectedInvoices - t.invoices)
  // OPS never files a storefront order, so no B2C booking is ever owed there.
  t.bookingShort = channel === 'b2c' ? 0 : Math.max(0, t.expected - t.bookings)
  t.checkedAt = checked === null ? null : new Date(checked).toISOString()

  return finalise(t)
}

// ─── Accounts document activity ───────────────────────────────────────────────

/** Accounts stores every timestamp in UTC (`config/app.php` timezone is UTC). */
function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}

/** The compact upper-case form both systems agree on: "MY 40062" → "MY40062". */
const KEY_SQL = `REPLACE(REPLACE(UPPER(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number, '')), ' ', ''), CHAR(9), '')`

/**
 * Rows the accounts reports never count: a control-number document whose whole
 * "invoice number" is the tour reference. Mirrors
 * `GeneratedInvoice::scopeExcludingTourRefNumbered()`.
 */
const NOT_TOUR_REF_SQL = `NOT (COALESCE(gi.base_invoice_number, gi.invoice_number) REGEXP '^[0-9]+$'
      AND COALESCE(gi.tour_ref, '') = CONCAT(COALESCE(gi.base_invoice_number, gi.invoice_number), 'CNTL'))`

/** `InvoiceReportService::looksRevised()` — the column, or the `_Rn` suffix. */
const REVISED_SQL = `(COALESCE(gi.is_revision, 0) = 1 OR gi.invoice_number REGEXP '_R[0-9]+')`

/** `InvoiceReportService::brandOf()` — AHS numbers and the standing B2C agent. */
const IS_B2C_SQL = `(UPPER(TRIM(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number, ''))) LIKE 'AHS%'
      OR TRIM(COALESCE(gi.customer_name, '')) = 'Aahaas B2C')`

interface ActivityRow extends RowDataPacket {
  k: string
  b2c: number
  cancelled: number
  amended: number
  documents: number
}

interface PnlRow extends RowDataPacket { documents: number; bookings: number }

/**
 * What accounts issued in the window, counted the way its own report counts it:
 * one row per booking (the report collapses revisions to the latest document),
 * classified by what that document did — raised, amended or voided.
 */
async function fetchActivity(window: ReportWindow): Promise<AccountsActivity> {
  const from = utcStamp(window.start)
  const to = utcStamp(window.end)

  const [invoiceRows, pnlRows] = await Promise.all([
    accountsQuery<ActivityRow>(
      `SELECT ${KEY_SQL}                                    AS k,
              MAX(${IS_B2C_SQL})                            AS b2c,
              MAX(COALESCE(gi.is_cancellation, 0))          AS cancelled,
              MAX(${REVISED_SQL})                           AS amended,
              COUNT(*)                                      AS documents
         FROM generated_invoices gi
        WHERE gi.deleted_at IS NULL
          AND gi.created_at >= ? AND gi.created_at < ?
          AND ${NOT_TOUR_REF_SQL}
        GROUP BY k`,
      [from, to],
    ),
    accountsQuery<PnlRow>(
      `SELECT COUNT(*) AS documents,
              COUNT(DISTINCT REPLACE(REPLACE(UPPER(COALESCE(is_number, '')), ' ', ''), CHAR(9), '')) AS bookings
         FROM pnl_records
        WHERE deleted_at IS NULL
          AND created_at >= ? AND created_at < ?`,
      [from, to],
    ),
  ])

  const out: AccountsActivity = {
    invoiceBookings: 0, invoicesNew: 0, invoicesAmended: 0, invoicesCancelled: 0,
    invoiceDocuments: 0,
    pnlBookings: Number(pnlRows[0]?.bookings ?? 0),
    pnlDocuments: Number(pnlRows[0]?.documents ?? 0),
    ahds: { invoiceBookings: 0, invoicesNew: 0, invoicesAmended: 0, invoicesCancelled: 0 },
  }

  for (const r of invoiceRows) {
    // A key that is empty on both number columns is not a billable document.
    if (!String(r.k ?? '').trim()) continue

    const movement = Number(r.cancelled) ? 'cancelled' : Number(r.amended) ? 'amended' : 'new'
    out.invoiceBookings++
    out.invoiceDocuments += Number(r.documents) || 0
    if (movement === 'cancelled') out.invoicesCancelled++
    else if (movement === 'amended') out.invoicesAmended++
    else out.invoicesNew++

    if (!Number(r.b2c)) {
      out.ahds.invoiceBookings++
      if (movement === 'cancelled') out.ahds.invoicesCancelled++
      else if (movement === 'amended') out.ahds.invoicesAmended++
      else out.ahds.invoicesNew++
    }
  }

  return out
}

// ─── Intake reconciliation ────────────────────────────────────────────────────

/**
 * Line up this system's own intake count against the day's confirmations, and
 * account for every booking on either side of the difference.
 *
 * B2C is excluded on the OPS side: the storefront files its own order and never
 * produces an OPS booking, so counting them here would compare two different
 * populations and manufacture a gap that does not exist.
 */
async function reconcileIntake(window: ReportWindow, rows: LedgerRow[]): Promise<IntakeReconciliation> {
  const asRows = rows.filter(r => r.channel === 'as')

  const confirmedKeys = new Set(asRows.map(r => ledgerKey(r.is_key)).filter(Boolean))

  const created = await prisma.booking.findMany({
    where: { createdAt: { gte: window.start, lt: window.end } },
    select: { bookingRef: true, agent: true },
  })

  // Filtered in memory, not in SQL: `agent` is nullable, and `NOT agent = 'x'`
  // is NULL — never true — for a booking with no agent on it, which would drop
  // exactly the unattributed bookings this reconciliation exists to surface.
  const createdKeys = created
    .filter(b => bookingSourceOf(b.agent) !== 'B2C')
    .map(b => ledgerKey(b.bookingRef))
    .filter(Boolean)

  let matched = 0
  for (const k of createdKeys) if (confirmedKeys.has(k)) matched++

  // Present here but filed after midnight — the ledger already knows the OPS
  // booking exists, it simply was not created inside the window.
  const heldHere = asRows.filter(r => r.booking_present).length
  const enteredLater = Math.max(0, heldHere - matched)

  const missingRefs = asRows
    .filter(r => !r.booking_present && !r.as_cancelled)
    .map(r => String(r.booking_ref || r.is_key || '').trim())
    .filter(Boolean)

  return {
    opsCreated: createdKeys.length,
    matched,
    earlierConfirmations: Math.max(0, createdKeys.length - matched),
    enteredLater,
    missing: missingRefs.length,
    missingRefs: missingRefs.slice(0, 40),
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const UNAVAILABLE: CountCheckSection = {
  available: false, error: null, sweptAt: null, balanced: false, unchecked: [],
  headline: '', channels: [], overall: emptyTally('all', 'All channels'),
  activity: null, intake: null,
}

/**
 * The count check for a report window. Never throws.
 */
export async function collectCountCheck(window: ReportWindow): Promise<CountCheckSection> {
  let rows: LedgerRow[]

  try {
    rows = await accountsQuery<LedgerRow>(
      `SELECT channel, is_key, booking_ref, as_cancelled, as_amount,
              booking_present, pnl_present, invoice_present, muted_at, last_checked_at
         FROM sync_ledger_entries
        WHERE as_created_date BETWEEN ? AND ?
          AND superseded_by IS NULL`,
      [window.fromDate, window.toDate],
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[report] count check: accounts ledger read failed:', message)
    return { ...UNAVAILABLE, error: `The accounts database could not be read (${message}).` }
  }

  const channels = (Object.keys(COUNT_CHECK_CHANNELS) as CountCheckChannel[])
    .map(ch => tally(rows.filter(r => r.channel === ch), ch))

  const overall = emptyTally('all', 'All channels')
  const unchecked: string[] = []
  for (const t of channels) {
    if (t.status === 'unchecked') unchecked.push(t.label)
    overall.upstream += t.upstream
    overall.bookings += t.bookings
    overall.pnls += t.pnls
    overall.invoices += t.invoices
    overall.cancelled += t.cancelled
    overall.notBillable += t.notBillable
    overall.expected += t.expected
    overall.expectedInvoices += t.expectedInvoices
    overall.pnlShort += t.pnlShort
    overall.invoiceShort += t.invoiceShort
    overall.bookingShort += t.bookingShort
    if (t.checkedAt && (!overall.checkedAt || t.checkedAt > overall.checkedAt)) overall.checkedAt = t.checkedAt
  }
  finalise(overall)

  // A channel nobody swept contributes zeroes, and zero upstream against zero
  // invoices adds up perfectly — so an unchecked channel makes the whole verdict
  // "partly checked" rather than "balanced".
  if (unchecked.length) {
    overall.status = 'unchecked'
    overall.balanced = false
    overall.verdict = `${overall.verdict.replace(/\.$/, '')}. Not checked in this window: ${unchecked.join(', ')}.`
  }

  // The activity and intake reads are extras: a failure in either leaves the
  // verdict above standing rather than taking the section down with it.
  const [activity, intake] = await Promise.all([
    fetchActivity(window).catch(err => {
      console.error('[report] count check: accounts activity read failed:', err instanceof Error ? err.message : err)
      return null
    }),
    reconcileIntake(window, rows).catch(err => {
      console.error('[report] count check: intake reconciliation failed:', err instanceof Error ? err.message : err)
      return null
    }),
  ])

  return {
    available: true,
    error: null,
    sweptAt: overall.checkedAt,
    balanced: overall.balanced && overall.checkedAt !== null,
    unchecked,
    headline: overall.verdict,
    channels,
    overall,
    activity,
    intake,
  }
}
