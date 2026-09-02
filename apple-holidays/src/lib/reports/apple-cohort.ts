/**
 * The bookings AppleSystem confirmed in a window — the population all three
 * daily mails now report on.
 *
 * ## Why this exists
 *
 * Three mails go out every morning about the same day. This one counted the
 * bookings *this system* filed that day; the accounts invoice mail counted the
 * documents it raised; the accounts P&L mail counted the rows whose extract
 * date fell in the window. On 01/09/2026 that was 42, 50 and 42 for a day on
 * which AppleSystem had confirmed 38. Every figure was defensible, no two
 * agreed, and the reader had no way to reconcile them — the exact failure the
 * Sync Ledger was built to end.
 *
 * So all three now report one set: the confirmations AppleSystem created inside
 * the window. That set is read from `sync_ledger_entries` over the read-only
 * accounts connection — the same rows `SyncParityService` and `count-check.ts`
 * already count, so this mail's headline and its own count-check block cannot
 * disagree, and cannot disagree with the accounts mails either.
 *
 * What this system filed in the window against an *earlier* confirmation is not
 * lost: it comes back as `outside`, which the mail prints as a clearly
 * uncounted appendix and the CSV as its own block.
 *
 * Safety: one SELECT, on the shared read-only accounts client. Never throws — an
 * unreachable accounts database produces an unavailable cohort and the caller
 * falls back to counting its own intake, exactly as it did before.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { accountsQuery } from '@/lib/accounts-db'
import type { ReportWindow } from './report-window'

/**
 * The ledger's own key rule, mirrored from `SyncLedgerService::keyFor()` (and
 * from `count-check.ts`, which mirrors it for the same reason): strip every
 * non-alphanumeric, so "VN-40499", "vn 40499" and "VN40499" are one booking.
 */
export function cohortKey(reference: string | null | undefined): string {
  const key = String(reference ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key === 'NA' ? '' : key
}

/** One confirmation in the window, as the ledger currently holds it. */
export interface CohortEntry {
  key: string
  /** How the reference reads to a person — "VN 41054". */
  ref: string
  cancelled: boolean
  bookingPresent: boolean
  pnlPresent: boolean
  invoicePresent: boolean
}

export interface AppleCohort {
  /** False when the accounts ledger could not be read. */
  available: boolean
  error: string | null
  /** Normalised keys of every confirmation AppleSystem raised in the window. */
  keys: Set<string>
  entries: CohortEntry[]
  /** Confirmations raised, cancellations included. */
  total: number
  /** `total - cancelled` — what the day is entitled to expect downstream. */
  expected: number
  cancelled: number
  /** ISO instant of the last sweep covering these dates; null = never swept. */
  sweptAt: string | null
}

interface CohortRow extends RowDataPacket {
  is_key: string
  is_number: string | null
  booking_ref: string | null
  as_cancelled: number
  booking_present: number
  pnl_present: number
  invoice_present: number
  last_checked_at: string | Date | null
}

const UNAVAILABLE: AppleCohort = {
  available: false, error: null, keys: new Set(), entries: [],
  total: 0, expected: 0, cancelled: 0, sweptAt: null,
}

/**
 * The window's AppleSystem confirmations, B2B only.
 *
 * B2C is deliberately excluded: the storefront files its own order and never
 * produces an OPS booking, so including it would compare two populations and
 * manufacture a gap that does not exist.
 */
export async function collectAppleCohort(
  window: Pick<ReportWindow, 'fromDate' | 'toDate'>,
): Promise<AppleCohort> {
  let rows: CohortRow[]

  try {
    rows = await accountsQuery<CohortRow>(
      `SELECT is_key, is_number, booking_ref, as_cancelled,
              booking_present, pnl_present, invoice_present, last_checked_at
         FROM sync_ledger_entries
        WHERE channel = 'as'
          AND as_created_date BETWEEN ? AND ?
          AND superseded_by IS NULL`,
      [window.fromDate, window.toDate],
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[report] apple cohort: accounts ledger read failed:', message)
    return { ...UNAVAILABLE, error: `The accounts database could not be read (${message}).` }
  }

  const entries: CohortEntry[] = []
  const keys = new Set<string>()
  let cancelled = 0
  let sweptAt: number | null = null

  for (const row of rows) {
    const key = cohortKey(row.is_key)
    if (!key || keys.has(key)) continue

    keys.add(key)
    if (row.as_cancelled) cancelled++

    const at = row.last_checked_at ? new Date(row.last_checked_at).getTime() : null
    if (at !== null && Number.isFinite(at) && (sweptAt === null || at > sweptAt)) sweptAt = at

    entries.push({
      key,
      ref: String(row.booking_ref || row.is_number || row.is_key || '').trim() || key,
      cancelled: Boolean(row.as_cancelled),
      bookingPresent: Boolean(row.booking_present),
      pnlPresent: Boolean(row.pnl_present),
      invoicePresent: Boolean(row.invoice_present),
    })
  }

  return {
    available: true,
    error: null,
    keys,
    entries,
    total: keys.size,
    expected: Math.max(0, keys.size - cancelled),
    cancelled,
    sweptAt: sweptAt === null ? null : new Date(sweptAt).toISOString(),
  }
}
