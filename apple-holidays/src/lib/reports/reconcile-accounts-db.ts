/**
 * What the accounts system produced, read straight out of its database.
 *
 * Both systems sit on one MySQL host, so the reconciliation report asks
 * accounts the same questions it would ask itself — no HTTP hop, no second
 * service to be up, and no copy of the numbers kept on the OPS side. Every
 * statement here is a SELECT: this module is a reader and the accounts system
 * stays the only author of a P&L or an invoice.
 *
 * ---- How a row's origin is decided ----
 *
 * A P&L says so itself: `pnl_records.source` is written by whichever importer
 * created the row (`apple_system_api`, `onedrive`, `manual_upload`, `b2c`, or
 * the `email` default).
 *
 * An invoice has no such column, because every invoice is generated from an
 * `incoming_emails` row — a real mailbox message for an emailed confirmation,
 * and a *stand-in* row for everything else. Those stand-ins carry a prefixed
 * `message_id`, which is exactly the discriminator accounts itself uses (see
 * `ConfirmationInvoiceService::sourceOf()`):
 *
 *   AS-CONF-…    raised from the Apple System API
 *   B2C-ORD-…    raised from an Aahaas storefront order
 *   DOC-CONF-…   raised from an uploaded confirmation document
 *   ONEDRIVE…    raised from a OneDrive/SharePoint folder drop
 *   anything     a real confirmation email in the mailbox
 *
 * Deriving the origin here rather than storing one keeps this report reading
 * the same fact the accounts UI shows, instead of a second opinion about it.
 *
 * ---- Counting rule ----
 *
 * **One booking counts once.** An amended booking has one P&L row per revision
 * and one invoice per revision, so a raw row count answers a different question
 * from the confirmation count it is being compared with — which is how a day
 * once got reported as 51 bookings, 64 P&Ls and 87 invoices. Every figure that
 * is compared against another system is therefore a COUNT(DISTINCT base key):
 * `is_number` for a P&L, `base_invoice_number` for an invoice.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from '@/lib/accounts-db'

/** How a P&L or an invoice came to exist. Ordered as the report prints them. */
export const ORIGINS = ['apple_system_api', 'email', 'onedrive', 'document', 'manual_upload', 'b2c', 'unknown'] as const
export type Origin = (typeof ORIGINS)[number]

export const ORIGIN_LABEL: Record<Origin, string> = {
  apple_system_api: 'Apple System API',
  email: 'Confirmation email',
  onedrive: 'OneDrive',
  document: 'Document upload',
  manual_upload: 'Manual upload',
  b2c: 'Aahaas B2C',
  unknown: 'Unattributed',
}

/** The SQL that turns an invoice's stand-in email into an origin. */
const INVOICE_ORIGIN_SQL = `
  CASE
    WHEN e.message_id LIKE 'AS-CONF-%'   THEN 'apple_system_api'
    WHEN e.message_id LIKE 'B2C-ORD-%'   THEN 'b2c'
    WHEN e.message_id LIKE 'DOC-CONF-%'  THEN 'document'
    WHEN e.message_id LIKE 'ONEDRIVE%'   THEN 'onedrive'
    WHEN e.message_id IS NULL OR e.message_id = '' THEN 'unknown'
    ELSE 'email'
  END`

/** The compact upper-case form both systems agree on: "MY 40062" → "MY40062". */
const NORMALISE = (col: string) => `REPLACE(REPLACE(UPPER(COALESCE(${col}, '')), ' ', ''), CHAR(9), '')`

function toOrigin(raw: unknown): Origin {
  const key = String(raw ?? '').trim().toLowerCase()
  return (ORIGINS as readonly string[]).includes(key) ? (key as Origin) : 'unknown'
}

/** Accounts stores every timestamp in UTC (config/app.php `timezone` is UTC). */
function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}

/** Empty per-origin tally, so the renderer never has to test for a missing key. */
export function emptyByOrigin(): Record<Origin, number> {
  return Object.fromEntries(ORIGINS.map(o => [o, 0])) as Record<Origin, number>
}

// ─── What accounts produced in the window ─────────────────────────────────────

export interface OriginTally {
  /** Rows written — revisions included. */
  rows: number
  /** Distinct bookings behind those rows. The figure that is compared. */
  bookings: number
  byOrigin: Record<Origin, number>
  /** Distinct bookings per origin. */
  bookingsByOrigin: Record<Origin, number>
}

export interface AccountsOutput {
  pnls: OriginTally
  invoices: OriginTally
  /** Invoices in the window that are revisions of an earlier invoice. */
  invoiceRevisions: number
  /** Cancellation invoices — they bill a fee, not a trip. */
  cancellationInvoices: number
}

function emptyTally(): OriginTally {
  return { rows: 0, bookings: 0, byOrigin: emptyByOrigin(), bookingsByOrigin: emptyByOrigin() }
}

interface OriginRow extends RowDataPacket { origin: string; rows: number; bookings: number }

/**
 * Everything accounts *created* between two instants, split by where it came
 * from. This is the activity question — "what did the system produce
 * yesterday?" — and is deliberately separate from the coverage question below.
 */
export async function fetchAccountsOutput(start: Date, end: Date): Promise<AccountsOutput> {
  const from = utcStamp(start)
  const to = utcStamp(end)

  const [pnlRows, invRows, invExtras] = await Promise.all([
    accountsQuery<OriginRow>(
      `SELECT LOWER(COALESCE(NULLIF(TRIM(source), ''), 'email'))          AS origin,
              COUNT(*)                                                    AS \`rows\`,
              COUNT(DISTINCT ${NORMALISE('is_number')})                   AS bookings
         FROM pnl_records
        WHERE deleted_at IS NULL
          AND created_at >= ? AND created_at < ?
        GROUP BY origin`,
      [from, to],
    ),
    accountsQuery<OriginRow>(
      `SELECT ${INVOICE_ORIGIN_SQL}                                       AS origin,
              COUNT(*)                                                    AS \`rows\`,
              COUNT(DISTINCT ${NORMALISE("COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number)")}) AS bookings
         FROM generated_invoices gi
         LEFT JOIN incoming_emails e ON e.id = gi.email_id
        WHERE gi.deleted_at IS NULL
          AND gi.created_at >= ? AND gi.created_at < ?
        GROUP BY origin`,
      [from, to],
    ),
    accountsQuery<RowDataPacket & { revisions: number; cancellations: number }>(
      `SELECT SUM(CASE WHEN COALESCE(revision_number, 1) > 1 THEN 1 ELSE 0 END) AS revisions,
              SUM(CASE WHEN is_cancellation = 1 THEN 1 ELSE 0 END)              AS cancellations
         FROM generated_invoices
        WHERE deleted_at IS NULL
          AND created_at >= ? AND created_at < ?`,
      [from, to],
    ),
  ])

  const fold = (rows: OriginRow[]): OriginTally => {
    const t = emptyTally()
    for (const r of rows) {
      const origin = toOrigin(r.origin)
      const count = Number(r.rows) || 0
      const bookings = Number(r.bookings) || 0
      t.rows += count
      t.bookings += bookings
      t.byOrigin[origin] += count
      t.bookingsByOrigin[origin] += bookings
    }
    return t
  }

  return {
    pnls: fold(pnlRows),
    invoices: fold(invRows),
    invoiceRevisions: Number(invExtras[0]?.revisions ?? 0),
    cancellationInvoices: Number(invExtras[0]?.cancellations ?? 0),
  }
}

// ─── Does accounts hold this booking? ─────────────────────────────────────────

export interface AccountsCoverage {
  /** Normalised IS keys that carry at least one live (not cancelled) P&L. */
  withPnl: Set<string>
  /** Normalised IS keys that carry at least one live invoice. */
  withInvoice: Set<string>
  /** Keys whose only P&L rows are marked cancelled — reported, not counted short. */
  pnlCancelled: Set<string>
  /** Keys whose only invoice is a cancellation invoice. */
  invoiceCancelled: Set<string>
}

interface KeyRow extends RowDataPacket { k: string; live: number; dead: number }

/**
 * For a set of IS numbers, which ones does accounts hold a P&L and an invoice
 * for — *whenever* those were created.
 *
 * The window is deliberately not applied here. A confirmation raised at 23:50
 * is invoiced the next morning, and counting only same-day rows would report a
 * gap that closed before anyone read the mail. The question this answers is
 * "is the booking whole now?", which is the one worth acting on.
 *
 * Matched on the base key both sides reduce to, so `IS48858`, `IS 48858` and
 * the `IS48858_R2/R2` revision all answer for the same booking.
 */
export async function fetchAccountsCoverage(keys: string[]): Promise<AccountsCoverage> {
  const empty: AccountsCoverage = {
    withPnl: new Set(), withInvoice: new Set(),
    pnlCancelled: new Set(), invoiceCancelled: new Set(),
  }
  const wanted = Array.from(new Set(keys.map(k => k.trim().toUpperCase()).filter(Boolean)))
  if (!wanted.length) return empty

  // Chunked so a busy month cannot build an IN list the server refuses.
  for (const chunk of chunks(wanted, 400)) {
    const holes = chunk.map(() => '?').join(',')

    const [pnlRows, invRows] = await Promise.all([
      accountsQuery<KeyRow>(
        `SELECT ${NORMALISE('is_number')} AS k,
                SUM(CASE WHEN COALESCE(is_cancelled, 0) = 0 THEN 1 ELSE 0 END) AS live,
                SUM(CASE WHEN COALESCE(is_cancelled, 0) = 1 THEN 1 ELSE 0 END) AS dead
           FROM pnl_records
          WHERE deleted_at IS NULL
            AND ${NORMALISE('is_number')} IN (${holes})
          GROUP BY k`,
        chunk,
      ),
      accountsQuery<KeyRow>(
        `SELECT ${NORMALISE("COALESCE(NULLIF(base_invoice_number, ''), invoice_number)")} AS k,
                SUM(CASE WHEN COALESCE(is_cancellation, 0) = 0 THEN 1 ELSE 0 END) AS live,
                SUM(CASE WHEN COALESCE(is_cancellation, 0) = 1 THEN 1 ELSE 0 END) AS dead
           FROM generated_invoices
          WHERE deleted_at IS NULL
            AND ${NORMALISE("COALESCE(NULLIF(base_invoice_number, ''), invoice_number)")} IN (${holes})
          GROUP BY k`,
        chunk,
      ),
    ])

    for (const r of pnlRows) {
      if (Number(r.live) > 0) empty.withPnl.add(r.k)
      else if (Number(r.dead) > 0) empty.pnlCancelled.add(r.k)
    }
    for (const r of invRows) {
      if (Number(r.live) > 0) empty.withInvoice.add(r.k)
      else if (Number(r.dead) > 0) empty.invoiceCancelled.add(r.k)
    }
  }

  return empty
}

// ─── The B2C half ─────────────────────────────────────────────────────────────

export interface B2cAccountsCoverage {
  /** Storefront order ids that carry a stored B2C P&L. */
  withPnl: Set<number>
  /** Storefront order ids that carry a raised invoice. */
  withInvoice: Set<number>
}

/**
 * The same coverage question for storefront orders.
 *
 * B2C rows are keyed on the checkout id, not an IS number: the P&L carries it
 * in `control_number` (`source = 'b2c'`) and the invoice reaches it through the
 * `B2C-ORD-<id>` stand-in email — the two keys `B2cPnlSyncService` and
 * `B2cInvoiceService` write.
 */
export async function fetchB2cCoverage(orderIds: number[]): Promise<B2cAccountsCoverage> {
  const out: B2cAccountsCoverage = { withPnl: new Set(), withInvoice: new Set() }
  const ids = Array.from(new Set(orderIds.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0)))
  if (!ids.length) return out

  for (const chunk of chunks(ids, 400)) {
    const holes = chunk.map(() => '?').join(',')
    const asStrings = chunk.map(String)

    const [pnlRows, invRows] = await Promise.all([
      accountsQuery<RowDataPacket & { k: string }>(
        `SELECT DISTINCT TRIM(control_number) AS k
           FROM pnl_records
          WHERE deleted_at IS NULL
            AND source = 'b2c'
            AND COALESCE(is_cancelled, 0) = 0
            AND TRIM(control_number) IN (${holes})`,
        asStrings,
      ),
      accountsQuery<RowDataPacket & { k: string }>(
        `SELECT DISTINCT SUBSTRING(e.message_id, 9) AS k
           FROM generated_invoices gi
           JOIN incoming_emails e ON e.id = gi.email_id
          WHERE gi.deleted_at IS NULL
            AND COALESCE(gi.is_cancellation, 0) = 0
            AND e.message_id LIKE 'B2C-ORD-%'
            AND SUBSTRING(e.message_id, 9) IN (${holes})`,
        asStrings,
      ),
    ])

    for (const r of pnlRows) out.withPnl.add(Number(r.k))
    for (const r of invRows) out.withInvoice.add(Number(r.k))
  }

  return out
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
