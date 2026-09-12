/**
 * The day in two passes — the split all three daily mails now lead with.
 *
 * ## Why this exists
 *
 * The accounts system stopped describing a day as "74 bookings · 8 new · 66
 * amended". A movement count answers a question nobody works from: the desk
 * works a day as *this period's own files* first, and then as *the back
 * catalogue somebody re-opened*. Both accounts mails (invoice and P&L) are now
 * written around exactly those two populations, and their workbooks open on
 * the two matching sheets.
 *
 * This mail lands in the same inbox minutes later. It therefore has to lead
 * with the same two numbers, or the morning starts with three reports and two
 * versions of one day — the failure the Sync Ledger and `count-check.ts` were
 * built to end.
 *
 * ## What it is
 *
 * `ActivityTabs::todayBusiness()` / `::oldAmendments()` (accounts side),
 * re-implemented against the read-only accounts connection, rule for rule:
 *
 *   • a **booking's age** is the date of the first document on its ledger
 *     chain — the confirmation that opened it — not the date of the document
 *     in front of you. The invoice ledger is the only place in either system
 *     that holds every revision, which is why the split is read here and not
 *     from the P&L board (which keeps only a booking's current revision) or
 *     from OPS (which keeps no revision chain at all);
 *   • **Today new & updated** — a booking whose chain opened inside the window
 *     and was not cancelled. One line per booking, on its latest document;
 *   • **Old amendments** — a revision raised inside the window against a
 *     booking whose chain opened before it. One line per revision raised: a
 *     booking re-issued twice in the window is two documents and two lines;
 *   • **Apple System count** — the confirmations the day actually raised, which
 *     is the figure the other two are checked against. It comes from this
 *     report's own cohort, not from here.
 *
 * B2C is excluded throughout: these are the AHDS (B2B) figures the accounts
 * B2B mails print.
 *
 * ## Safety
 *
 * Two SELECTs on the shared read-only accounts client. It derives, never
 * writes, and never throws — an unreachable accounts database produces
 * `available: false` and the mail renders with the tiles marked unavailable,
 * because a report that fails to send is worse than one with a named hole.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from '@/lib/accounts-db'
import { dateInTz, type ReportWindow } from './report-window'

/**
 * `BookingKey::for()` — strip every non-alphanumeric, upper-case what is left.
 * "VN 40499", "vn-40499" and "VN40499" are one booking.
 */
export function bookingKey(reference: string | null | undefined): string {
  const key = String(reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key === '' || key === 'NA' || key === 'NULL' ? '' : key
}

/** Accounts stores every timestamp in UTC (`config/app.php` timezone is UTC). */
function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}

/** Mirrors `GeneratedInvoice::scopeExcludingTourRefNumbered()`. */
const NOT_TOUR_REF_SQL = `NOT (COALESCE(gi.base_invoice_number, gi.invoice_number) REGEXP '^[0-9]+$'
      AND COALESCE(gi.tour_ref, '') = CONCAT(COALESCE(gi.base_invoice_number, gi.invoice_number), 'CNTL'))`

/** `InvoiceReportService::brandOf()` — AHS numbers and the standing B2C agent. */
const IS_B2C_SQL = `(UPPER(TRIM(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number, ''))) LIKE 'AHS%'
      OR TRIM(COALESCE(gi.customer_name, '')) = 'Aahaas B2C')`

interface DocRow extends RowDataPacket {
  id: number
  invoice_number: string | null
  base_invoice_number: string | null
  ledger_key: string | null
  revision_seq: number | null
  revision_number: number | null
  is_revision: number | null
  is_cancellation: number | null
  created_at: string | Date
  customer_name: string | null
  guest_name: string | null
  currency: string | null
  grand_total: string | number | null
  total_amount: string | number | null
  b2c?: number
}

/** One line of either table, as the mail and the workbook print it. */
export interface SplitLine {
  /** The booking, as both systems spell it after `bookingKey()`. */
  key: string
  ref: string
  invoiceNumber: string
  /** 'New' — raised and left as it stands; 'Updated' — re-issued in the window. */
  type: 'New' | 'Updated'
  agent: string
  guest: string
  currency: string
  amount: number
  /** The day the booking's chain opened, ISO date; null when it cannot be dated. */
  firstOn: string | null
  /** Days between that and this document. */
  ageDays: number | null
  /** Revisions the booking carries to date. */
  revisions: number
  raisedAt: string
}

export interface ActivitySplitSide {
  count: number
  lines: SplitLine[]
  /** Distinct bookings behind those lines — differs from `count` on the old side. */
  bookings: number
  keys: string[]
}

export interface ActivitySplit {
  available: boolean
  error?: string
  /** Bookings whose chain opened inside the window. One line per booking. */
  today: ActivitySplitSide
  /** Revisions raised in the window against a booking opened before it. */
  old: ActivitySplitSide
  /** Every key in either side, for marking this report's own rows. */
  index: Record<string, 'today' | 'old'>
}

const EMPTY_SIDE: ActivitySplitSide = { count: 0, lines: [], bookings: 0, keys: [] }

export function emptyActivitySplit(error?: string): ActivitySplit {
  return {
    available: false,
    error,
    today: { ...EMPTY_SIDE, lines: [], keys: [] },
    old: { ...EMPTY_SIDE, lines: [], keys: [] },
    index: {},
  }
}

/** `InvoiceReportService::revisionNumberOf()` — the number wins over the column. */
function revisionNumberOf(row: DocRow): number {
  const matches = String(row.invoice_number ?? '').match(/_R(\d+)/gi)
  if (matches?.length) return Number(matches[matches.length - 1].slice(2))
  return Number(row.revision_number ?? 0) || 0
}

/** `InvoiceReportService::sequenceOf()`. */
function sequenceOf(row: DocRow): number {
  return Math.max(1, Number(row.revision_seq ?? 0) || revisionNumberOf(row) || 1)
}

/** `InvoiceReportService::looksRevised()`. */
function looksRevised(row: DocRow): boolean {
  return Boolean(Number(row.is_revision ?? 0)) || /_R\d+/i.test(String(row.invoice_number ?? ''))
}

/** `InvoiceReportService::ledgerKeyOf()` — the chain a document hangs on. */
function chainKeyOf(row: DocRow): string {
  const ledger = String(row.ledger_key ?? '').trim()
  if (ledger) return ledger
  return 'B:' + String(row.base_invoice_number ?? row.invoice_number ?? '').toUpperCase()
}

function at(value: string | Date): Date {
  return value instanceof Date ? value : new Date(String(value).replace(' ', 'T') + 'Z')
}

/** Whole days between two ISO dates — calendar days, not elapsed hours. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z')
  const b = Date.parse(to + 'T00:00:00Z')
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

function money(row: DocRow): number {
  const grand = Number(row.grand_total ?? 0)
  return grand || Number(row.total_amount ?? 0) || 0
}

/**
 * The split for a window.
 *
 * @param window the report's own window — the same instants every other
 *               section of this mail is cut on.
 */
export async function collectActivitySplit(window: ReportWindow): Promise<ActivitySplit> {
  try {
    const from = utcStamp(window.start)
    const to = utcStamp(window.end)

    // 1. Every document raised inside the window, AHDS only.
    const raised = (await accountsQuery<DocRow>(
      `SELECT gi.id, gi.invoice_number, gi.base_invoice_number, gi.ledger_key,
              gi.revision_seq, gi.revision_number, gi.is_revision, gi.is_cancellation,
              gi.created_at, gi.customer_name, gi.guest_name, gi.currency,
              gi.grand_total, gi.total_amount,
              ${IS_B2C_SQL} AS b2c
         FROM generated_invoices gi
        WHERE gi.deleted_at IS NULL
          AND gi.created_at >= ? AND gi.created_at < ?
          AND ${NOT_TOUR_REF_SQL}
        ORDER BY gi.id`,
      [from, to],
    )).filter(r => !Number(r.b2c))

    if (raised.length === 0) {
      return { available: true, today: { ...EMPTY_SIDE }, old: { ...EMPTY_SIDE }, index: {} }
    }

    // 2. Every document on those bookings' chains — what dates the booking.
    //    Matched on both columns exactly as `ledgerHistory()` does, because
    //    `ledger_key` is backfilled and older rows carry only the base number.
    const ledgerKeys = Array.from(new Set(raised.map(r => String(r.ledger_key ?? '').trim()).filter(Boolean)))
    const bases = Array.from(new Set(raised.map(r => String(r.base_invoice_number ?? '').trim()).filter(Boolean)))

    const clauses: string[] = []
    const params: unknown[] = []
    if (ledgerKeys.length) { clauses.push(`gi.ledger_key IN (${ledgerKeys.map(() => '?').join(',')})`); params.push(...ledgerKeys) }
    if (bases.length) { clauses.push(`gi.base_invoice_number IN (${bases.map(() => '?').join(',')})`); params.push(...bases) }

    const history = clauses.length
      ? await accountsQuery<DocRow>(
          `SELECT gi.id, gi.invoice_number, gi.base_invoice_number, gi.ledger_key,
                  gi.revision_seq, gi.revision_number, gi.is_revision, gi.is_cancellation,
                  gi.created_at, gi.customer_name, gi.guest_name, gi.currency,
                  gi.grand_total, gi.total_amount
             FROM generated_invoices gi
            WHERE gi.deleted_at IS NULL AND (${clauses.join(' OR ')})`,
          params,
        )
      : []

    // The chains, oldest revision first — the first entry opened the booking.
    const chains = new Map<string, DocRow[]>()
    for (const row of history) {
      const key = chainKeyOf(row)
      const list = chains.get(key)
      if (list) list.push(row)
      else chains.set(key, [row])
    }
    chains.forEach((list: DocRow[]) => {
      list.sort((a, b) => sequenceOf(a) - sequenceOf(b) || Number(a.id) - Number(b.id))
    })

    const todayByBooking = new Map<string, { row: DocRow; line: SplitLine }>()
    const oldLines: SplitLine[] = []

    for (const row of raised) {
      const chain = chains.get(chainKeyOf(row)) ?? [row]
      const origin = chain[0] ?? row
      const originAt = at(origin.created_at)
      const raisedAt = at(row.created_at)

      // Cancellations are neither this period's new business nor an amendment
      // of it — the accounts split drops them from both tables.
      if (Number(row.is_cancellation ?? 0)) continue

      const carried = originAt.getTime() < window.start.getTime()
      const updated = looksRevised(row)

      // Dated the way the accounts mail dates it: in the report's own zone,
      // whole days apart. An instant-to-instant difference reports a booking
      // opened late on one evening and re-issued early on another as a day
      // younger than the two calendars say it is.
      const originDay = Number.isFinite(originAt.getTime()) ? dateInTz(originAt, window.timezone) : null
      const raisedDay = dateInTz(raisedAt, window.timezone)

      const line: SplitLine = {
        key: bookingKey(row.base_invoice_number ?? row.invoice_number),
        ref: String(row.base_invoice_number ?? row.invoice_number ?? '—'),
        invoiceNumber: String(row.invoice_number ?? '—'),
        type: updated ? 'Updated' : 'New',
        agent: String(row.customer_name ?? '').trim() || '—',
        guest: String(row.guest_name ?? '').trim() || '—',
        currency: String(row.currency ?? '').trim() || 'N/A',
        amount: Math.round(money(row) * 100) / 100,
        firstOn: originDay,
        ageDays: originDay ? daysBetween(originDay, raisedDay) : null,
        revisions: chain.length,
        raisedAt: raisedAt.toISOString(),
      }

      if (carried) {
        // One line per revision raised: two files went out, and both were sent
        // to somebody.
        if (updated) oldLines.push(line)
        continue
      }

      // One line per booking, on its latest document in the window.
      const held = todayByBooking.get(line.key || line.ref)
      if (!held || Number(row.id) > Number(held.row.id)) {
        todayByBooking.set(line.key || line.ref, { row, line })
      }
    }

    const todayLines = Array.from(todayByBooking.values())
      .map(v => v.line)
      .sort((a, b) => a.type.localeCompare(b.type) || a.ref.localeCompare(b.ref))

    oldLines.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))

    const side = (lines: SplitLine[]): ActivitySplitSide => {
      const keys = Array.from(new Set(lines.map(l => l.key).filter(Boolean)))
      return { count: lines.length, lines, bookings: keys.length, keys }
    }

    const today = side(todayLines)
    const old = side(oldLines)

    const index: Record<string, 'today' | 'old'> = {}
    for (const key of today.keys) index[key] = 'today'
    for (const key of old.keys) if (!index[key]) index[key] = 'old'

    return { available: true, today, old, index }
  } catch (error) {
    return emptyActivitySplit(error instanceof Error ? error.message : String(error))
  }
}
