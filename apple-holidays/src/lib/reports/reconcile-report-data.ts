/**
 * The cross-system reconciliation: four systems asked the same question about
 * the same day, and one line saying whether their answers agree.
 *
 * ## The question
 *
 * A booking confirmed in the Apple System yesterday should, by this morning,
 * exist in four places:
 *
 *   1. **Apple System** — the confirmation itself (status 2). The upstream truth.
 *   2. **OPS** (this system) — the operational booking, imported from it.
 *   3. **Accounts → P&L** — the costing record.
 *   4. **Accounts → invoice** — the client bill.
 *
 * Those four counts must be equal. When they are not, the report says which
 * one is short, names the bookings behind the shortfall, and — because a number
 * with no cause attached generates a reply asking for one — states the likely
 * reason.
 *
 * The same shape is applied to the Aahaas B2C storefront, whose orders are the
 * upstream truth for the consumer channel.
 *
 * ## Two different questions, deliberately not mixed
 *
 * **Coverage** — "is yesterday's confirmation whole *now*?" — ignores when the
 * P&L and invoice were written. A confirmation raised at 23:50 is invoiced the
 * next morning; counting only same-day rows would report a gap that closed
 * before anyone read the mail. Coverage is what "balanced" is decided on.
 *
 * **Output** — "what did accounts produce yesterday, and through which door?"
 * — counts rows by their own creation time and splits them by origin (Apple
 * System API / OneDrive / mailbox / document upload / manual / B2C). It is the
 * activity picture, and it deliberately does *not* have to equal the
 * confirmation count: an invoice raised yesterday for a booking confirmed last
 * week is correct, not a discrepancy.
 *
 * ## Counting rule
 *
 * **One booking counts once.** Amendments produce a P&L row per revision and an
 * invoice per revision, so every figure compared across systems is a distinct
 * *booking* count, never a row count.
 *
 * ## Safety
 *
 * Reads only. The accounts database is reached through the shared read-only
 * client, the storefront through the B2C client that refuses non-SELECT
 * statements, and OPS through Prisma queries that never write. Every upstream
 * is wrapped: a section that cannot be read is marked unavailable and named as
 * such, because a report that fails to render is worse than one with a hole
 * in it that says so.
 */
import { prisma } from '@/lib/prisma'
import { listByCreateDate, type ASBookingListItem } from '@/lib/applesystem'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { B2C_AGENT_NAME } from '@/lib/booking-source'
import { fetchOrdersBookedBetween, isB2cConfigured } from '@/lib/b2c-db'
import {
  emptyByOrigin, fetchAccountsCoverage, fetchAccountsOutput, fetchB2cCoverage,
  ORIGIN_LABEL, ORIGINS, type AccountsOutput, type Origin,
} from './reconcile-accounts-db'
import { buildReportWindow, type ReportPeriod, type ReportWindow } from './report-window'

export { ORIGIN_LABEL, ORIGINS, type Origin }

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** One Apple System confirmation, followed through all four systems. */
export interface ConfirmationLine {
  /** Normalised IS number — the key every system is matched on. Null when upstream has not issued one. */
  ref: string | null
  /** What to print: the IS number, or the quotation number when there is none. */
  label: string
  quotationNo: string
  country: string | null
  createdDate: string
  inOps: boolean
  hasPnl: boolean
  hasInvoice: boolean
  /** True when nothing downstream is missing. */
  whole: boolean
}

export interface AsStatusRow {
  status: string
  label: string
  count: number
}

export interface AsIntake {
  available: boolean
  error: string | null
  /** Every quotation the Apple System created in the window, whatever its status. */
  total: number
  /** Status 2 — a confirmed booking. The number everything else is measured against. */
  confirmed: number
  /** Status 1 — quoted but not confirmed. Nothing downstream is owed for these. */
  unconfirmed: number
  /** Every other status: cancelled and anything the upstream adds later. */
  other: number
  byStatus: AsStatusRow[]
  /** Confirmations upstream has not issued an IS number for — unmatchable anywhere. */
  unnumbered: number
  confirmations: ConfirmationLine[]
}

export interface OpsIntake {
  /** B2B bookings this system created in the window, by its own clock. */
  created: number
  /** Of those, how many answer to one of the window's confirmations. */
  createdFromWindow: number
  /** Bookings cancelled in the window, whenever they were created. */
  cancelled: number
  cancellations: { ref: string; at: string; reason: string | null }[]
  /** Confirmations of the window this system holds a booking for. */
  held: number
  /** The ones it does not. */
  missing: string[]
}

export interface AccountsIntake {
  available: boolean
  error: string | null
  /** Rows accounts created in the window, split by origin. The activity picture. */
  output: AccountsOutput
  /** Confirmations of the window that carry a live P&L / invoice, whenever written. */
  withPnl: number
  withInvoice: number
  missingPnl: string[]
  missingInvoice: string[]
  /** Confirmations whose only P&L or invoice is a cancelled one — explained, not short. */
  pnlCancelled: number
  invoiceCancelled: number
}

/** Four numbers that must match, and the arithmetic that says whether they do. */
export interface ParityCheck {
  label: string
  expected: number
  ops: number
  pnls: number
  invoices: number
  opsShort: number
  pnlShort: number
  invoiceShort: number
  balanced: boolean
  /** True when a source could not be read, so "balanced" cannot be claimed. */
  unchecked: boolean
  verdict: string
}

export interface B2bSection {
  as: AsIntake
  ops: OpsIntake
  accounts: AccountsIntake
  check: ParityCheck
}

export interface B2cOrderReconLine {
  orderId: number
  bookedDate: string | null
  serviceDate: string | null
  inOps: boolean
  hasPnl: boolean
  hasInvoice: boolean
  whole: boolean
}

export interface B2cSection {
  available: boolean
  error: string | null
  /** Orders the storefront took in the window. The upstream truth for this channel. */
  orders: number
  /** OPS bookings answering those orders. */
  opsHeld: number
  /** B2C bookings OPS created in the window, by its own clock. */
  opsCreated: number
  missingInOps: number[]
  withPnl: number
  withInvoice: number
  missingPnl: number[]
  missingInvoice: number[]
  /** Every order, in booking order. The renderer caps what it prints. */
  lines: B2cOrderReconLine[]
  check: ParityCheck
}

/** A named, code-derived cause. Written before any AI is asked for an opinion. */
export interface Finding {
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  /** The references the finding is about, capped for the mail. */
  refs: string[]
}

export interface ReconcileReportData {
  window: ReportWindow
  generatedAt: string
  b2b: B2bSection
  b2c: B2cSection
  findings: Finding[]
  /** True when every channel that could be read balances. */
  balanced: boolean
  headline: string
  /** Filled in by the runner when the AI explanation is switched on. */
  narrative: string | null
}

export interface CollectReconcileOptions {
  period: ReportPeriod
  timezone: string
  now?: Date
  anchorDate?: string | null
  /** Cap on the per-section detail tables. */
  maxRows?: number
}

const DEFAULT_MAX_ROWS = 40

/** Statuses the Apple System is known to use. Anything else is printed as-is. */
const AS_STATUS_LABEL: Record<string, string> = {
  '1': 'Quoted — not confirmed',
  '2': 'Confirmed',
  '3': 'Cancelled',
  '4': 'Cancelled',
}

function statusLabel(status: string): string {
  return AS_STATUS_LABEL[status] ?? `Status ${status || '—'}`
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ─── 1. Apple System: what was raised upstream ────────────────────────────────

/**
 * Every quotation the Apple System created in the window, bucketed by status.
 *
 * Asked without a status filter and split here rather than in three separate
 * calls: one list is one round trip, and three lists taken seconds apart can
 * disagree with each other if somebody confirms a quote in between.
 */
async function collectAs(window: ReportWindow): Promise<AsIntake> {
  const empty: AsIntake = {
    available: false, error: null, total: 0, confirmed: 0, unconfirmed: 0, other: 0,
    byStatus: [], unnumbered: 0, confirmations: [],
  }

  let items: ASBookingListItem[]
  try {
    ({ items } = await listByCreateDate({
      fromCreateDate: window.fromDate,
      toCreateDate: window.toDate,
    }))
  } catch (err) {
    console.error('[reconcile] Apple System read failed:', errMessage(err))
    return { ...empty, error: errMessage(err) }
  }

  const counts = new Map<string, number>()
  const confirmations: ConfirmationLine[] = []
  let unnumbered = 0

  for (const item of items) {
    const status = String(item.status ?? '').trim()
    counts.set(status, (counts.get(status) ?? 0) + 1)
    if (status !== '2') continue

    const raw = normalizeIsNumber(String(item.is_number ?? ''))
    const ref = !raw || raw === 'NA' ? null : raw
    if (!ref) unnumbered++

    const created = (typeof item.created_at === 'string' ? item.created_at : item.created_at?.date)?.slice(0, 10)

    confirmations.push({
      ref,
      label: ref ?? `Quotation ${item.quotation_no}`,
      quotationNo: String(item.quotation_no ?? ''),
      country: item.country ?? null,
      createdDate: created && /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : window.toDate,
      // Filled in once the other three systems have been asked.
      inOps: false, hasPnl: false, hasInvoice: false, whole: false,
    })
  }

  const confirmed = counts.get('2') ?? 0
  const unconfirmed = counts.get('1') ?? 0

  return {
    available: true,
    error: null,
    total: items.length,
    confirmed,
    unconfirmed,
    other: items.length - confirmed - unconfirmed,
    byStatus: Array.from(counts.entries())
      .map(([status, count]) => ({ status, label: statusLabel(status), count }))
      .sort((a, b) => a.status.localeCompare(b.status)),
    unnumbered,
    confirmations,
  }
}

// ─── 2. OPS: what this system holds ───────────────────────────────────────────

async function collectOps(window: ReportWindow, refs: string[], maxRows: number): Promise<OpsIntake> {
  const notB2c = { OR: [{ agent: { not: B2C_AGENT_NAME } }, { agent: null }] }

  const cancelledWhere = { cancelledAt: { gte: window.start, lt: window.end }, ...notB2c }

  const [created, cancelled, cancelledRows, heldRows] = await Promise.all([
    prisma.booking.count({
      where: { createdAt: { gte: window.start, lt: window.end }, ...notB2c },
    }),
    prisma.booking.count({ where: cancelledWhere }),
    prisma.booking.findMany({
      where: cancelledWhere,
      select: { bookingRef: true, cancelledAt: true, cancellationReason: true },
      orderBy: { cancelledAt: 'desc' },
      take: Math.max(maxRows, 25),
    }),
    refs.length
      ? prisma.booking.findMany({
          where: { bookingRef: { in: refs } },
          select: { bookingRef: true, createdAt: true },
        })
      : Promise.resolve([] as { bookingRef: string; createdAt: Date }[]),
  ])

  const held = new Map(heldRows.map(b => [b.bookingRef, b.createdAt]))

  return {
    created,
    createdFromWindow: heldRows.filter(b => b.createdAt >= window.start && b.createdAt < window.end).length,
    cancelled,
    cancellations: cancelledRows.map(b => ({
      ref: b.bookingRef,
      at: b.cancelledAt?.toISOString() ?? '',
      reason: b.cancellationReason,
    })),
    held: held.size,
    missing: refs.filter(r => !held.has(r)),
  }
}

// ─── 3. Accounts: P&Ls and invoices ───────────────────────────────────────────

async function collectAccounts(window: ReportWindow, refs: string[]): Promise<AccountsIntake> {
  const emptyOutput: AccountsOutput = {
    pnls: { rows: 0, bookings: 0, byOrigin: emptyByOrigin(), bookingsByOrigin: emptyByOrigin() },
    invoices: { rows: 0, bookings: 0, byOrigin: emptyByOrigin(), bookingsByOrigin: emptyByOrigin() },
    invoiceRevisions: 0,
    cancellationInvoices: 0,
  }

  try {
    const [output, coverage] = await Promise.all([
      fetchAccountsOutput(window.start, window.end),
      fetchAccountsCoverage(refs),
    ])

    return {
      available: true,
      error: null,
      output,
      withPnl: refs.filter(r => coverage.withPnl.has(r)).length,
      withInvoice: refs.filter(r => coverage.withInvoice.has(r)).length,
      missingPnl: refs.filter(r => !coverage.withPnl.has(r)),
      missingInvoice: refs.filter(r => !coverage.withInvoice.has(r)),
      pnlCancelled: refs.filter(r => coverage.pnlCancelled.has(r)).length,
      invoiceCancelled: refs.filter(r => coverage.invoiceCancelled.has(r)).length,
    }
  } catch (err) {
    console.error('[reconcile] accounts read failed:', errMessage(err))
    return {
      available: false, error: errMessage(err), output: emptyOutput,
      withPnl: 0, withInvoice: 0, missingPnl: [], missingInvoice: [],
      pnlCancelled: 0, invoiceCancelled: 0,
    }
  }
}

// ─── 4. B2C: the storefront channel ───────────────────────────────────────────

async function collectB2c(window: ReportWindow): Promise<B2cSection> {
  const blank = (error: string | null): B2cSection => ({
    available: false, error, orders: 0, opsHeld: 0, opsCreated: 0,
    missingInOps: [], withPnl: 0, withInvoice: 0, missingPnl: [], missingInvoice: [],
    lines: [],
    check: {
      label: 'Aahaas B2C', expected: 0, ops: 0, pnls: 0, invoices: 0,
      opsShort: 0, pnlShort: 0, invoiceShort: 0,
      balanced: false, unchecked: true,
      verdict: error ? `Aahaas B2C: not checked — ${error}` : 'Aahaas B2C: not checked.',
    },
  })

  if (!isB2cConfigured()) return blank('the B2C database connection is not configured')

  try {
    const orders = await fetchOrdersBookedBetween({ from: window.fromDate, to: window.toDate })
    const ids = orders.map(o => Number(o.order_id)).filter(n => Number.isInteger(n) && n > 0)

    // OPS files a B2C order under the bare order id — see b2c-booking-map.
    const [opsRows, opsCreated, coverage] = await Promise.all([
      ids.length
        ? prisma.booking.findMany({
            where: { agent: B2C_AGENT_NAME, bookingRef: { in: ids.map(String) } },
            select: { bookingRef: true },
          })
        : Promise.resolve([] as { bookingRef: string }[]),
      prisma.booking.count({
        where: { agent: B2C_AGENT_NAME, createdAt: { gte: window.start, lt: window.end } },
      }),
      fetchB2cCoverage(ids),
    ])

    const inOps = new Set(opsRows.map(b => Number(b.bookingRef)))

    const lines: B2cOrderReconLine[] = orders.map(o => {
      const id = Number(o.order_id)
      const hasPnl = coverage.withPnl.has(id)
      const hasInvoice = coverage.withInvoice.has(id)
      return {
        orderId: id,
        bookedDate: o.bookedDate,
        serviceDate: o.serviceDate,
        inOps: inOps.has(id),
        hasPnl,
        hasInvoice,
        whole: hasPnl && hasInvoice,
      }
    })

    const withPnl = lines.filter(l => l.hasPnl).length
    const withInvoice = lines.filter(l => l.hasInvoice).length

    return {
      available: true,
      error: null,
      orders: ids.length,
      opsHeld: inOps.size,
      opsCreated,
      missingInOps: ids.filter(id => !inOps.has(id)),
      withPnl,
      withInvoice,
      missingPnl: lines.filter(l => !l.hasPnl).map(l => l.orderId),
      missingInvoice: lines.filter(l => !l.hasInvoice).map(l => l.orderId),
      lines,
      check: buildCheck('Aahaas B2C', {
        expected: ids.length,
        // OPS only imports storefront orders that still have a service date
        // ahead of them, so a gap here is expected behaviour rather than a
        // failure — it is reported, never counted against the verdict.
        ops: null,
        opsHeld: inOps.size,
        pnls: withPnl,
        invoices: withInvoice,
        unchecked: false,
      }),
    }
  } catch (err) {
    console.error('[reconcile] B2C read failed:', errMessage(err))
    return blank(errMessage(err))
  }
}

// ─── The count check ──────────────────────────────────────────────────────────

/**
 * Turn the counts into the sentence somebody actually reads.
 *
 * Deliberately blunt. "51 confirmations · 51 bookings · 51 P&Ls · 51 invoices —
 * balanced" is the only good outcome; anything else leads with the number that
 * is missing, because that is the one somebody has to act on.
 */
function buildCheck(
  label: string,
  input: {
    expected: number
    /** null = this channel is not expected to file an OPS booking for every row. */
    ops: number | null
    opsHeld: number
    pnls: number
    invoices: number
    unchecked: boolean
  },
): ParityCheck {
  const opsShort = input.ops === null ? 0 : Math.max(0, input.expected - input.ops)
  const pnlShort = Math.max(0, input.expected - input.pnls)
  const invoiceShort = Math.max(0, input.expected - input.invoices)
  const short = opsShort + pnlShort + invoiceShort

  const check: ParityCheck = {
    label,
    expected: input.expected,
    ops: input.opsHeld,
    pnls: input.pnls,
    invoices: input.invoices,
    opsShort,
    pnlShort,
    invoiceShort,
    balanced: short === 0 && !input.unchecked,
    unchecked: input.unchecked,
    verdict: '',
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  if (input.unchecked) {
    check.verdict = `${label}: not checked — one of the systems could not be read.`
    return check
  }

  if (input.expected === 0) {
    check.verdict = `${label}: nothing raised upstream in this window.`
    check.balanced = true
    return check
  }

  if (short === 0) {
    check.verdict = `${label}: ${plural(input.expected, 'booking')} · ${plural(input.pnls, 'P&L')} · ${plural(input.invoices, 'invoice')} — balanced.`
    return check
  }

  const missing: string[] = []
  if (opsShort > 0) missing.push(plural(opsShort, 'OPS booking'))
  if (pnlShort > 0) missing.push(plural(pnlShort, 'P&L'))
  if (invoiceShort > 0) missing.push(plural(invoiceShort, 'invoice'))

  check.verdict = `${label}: ${plural(input.expected, 'booking')} upstream, missing ${missing.join(' and ')}.`
  return check
}

// ─── Why the numbers disagree ─────────────────────────────────────────────────

/** How many references a finding names before it stops listing them. */
const FINDING_REFS = 15

/**
 * Name the causes the data can prove, before anything is handed to a model.
 *
 * The AI explanation is written *from* these, never instead of them: a cause
 * derived from the rows is a fact, and the mail has to carry the facts whether
 * or not the model was reachable.
 */
function deriveFindings(b2b: B2bSection, b2c: B2cSection): Finding[] {
  const out: Finding[] = []
  const cap = (refs: string[]) => refs.slice(0, FINDING_REFS)

  if (!b2b.as.available) {
    out.push({
      severity: 'critical',
      title: 'The Apple System could not be read',
      detail: `Nothing in the B2B section can be verified against upstream: ${b2b.as.error}. The counts below are what the other systems hold, not what they should hold.`,
      refs: [],
    })
  }

  if (!b2b.accounts.available) {
    out.push({
      severity: 'critical',
      title: 'The accounts database could not be read',
      detail: `P&L and invoice figures are unavailable for this window: ${b2b.accounts.error}.`,
      refs: [],
    })
  }

  if (b2b.as.unnumbered > 0) {
    out.push({
      severity: 'warning',
      title: `${b2b.as.unnumbered} confirmation${b2b.as.unnumbered === 1 ? ' has' : 's have'} no IS number upstream`,
      detail: 'Nothing downstream can match a confirmation without an IS number — it cannot be imported into OPS, and it cannot be invoiced. Assign the IS number in the Apple System and the rest follows on the next sweep.',
      refs: cap(b2b.as.confirmations.filter(c => !c.ref).map(c => c.label)),
    })
  }

  if (b2b.ops.missing.length) {
    out.push({
      severity: 'critical',
      title: `${b2b.ops.missing.length} confirmation${b2b.ops.missing.length === 1 ? '' : 's'} never reached the booking system`,
      detail: 'The Apple System confirmed these and OPS holds no booking for them. Usual causes: the confirmation was raised after the last import sweep, the import failed on a mapping error, or the quotation carries a reference OPS could not resolve. Live Watch and the daily 06:00 import both re-sweep, so a same-day gap often closes on its own; an older one does not.',
      refs: cap(b2b.ops.missing),
    })
  }

  // A booking with a P&L but no invoice is a different failure from one with
  // neither, and points at a different step, so the two are never merged.
  const pnlSet = new Set(b2b.accounts.missingPnl)
  const invoicedNotCosted = b2b.accounts.missingPnl.filter(r => !b2b.accounts.missingInvoice.includes(r))
  const costedNotInvoiced = b2b.accounts.missingInvoice.filter(r => !pnlSet.has(r))
  const neither = b2b.accounts.missingInvoice.filter(r => pnlSet.has(r))

  if (neither.length) {
    out.push({
      severity: 'critical',
      title: `${neither.length} confirmation${neither.length === 1 ? ' has' : 's have'} neither a P&L nor an invoice`,
      detail: 'Accounts has not picked these bookings up at all. The Apple System P&L sync runs nightly and the confirmation-invoice step runs off it, so a booking missing both is normally one the sync has not reached yet — or one whose IS number differs between the two systems.',
      refs: cap(neither),
    })
  }

  if (costedNotInvoiced.length) {
    out.push({
      severity: 'warning',
      title: `${costedNotInvoiced.length} booking${costedNotInvoiced.length === 1 ? ' is' : 's are'} costed but not invoiced`,
      detail: 'The P&L exists, so accounts has the booking; only the invoice was never generated. This is the AS Confirmations step, not the sync — generating the invoice from the confirmation closes it.',
      refs: cap(costedNotInvoiced),
    })
  }

  if (invoicedNotCosted.length) {
    out.push({
      severity: 'warning',
      title: `${invoicedNotCosted.length} booking${invoicedNotCosted.length === 1 ? ' is' : 's are'} invoiced with no P&L`,
      detail: 'The client has been billed but there is no costing record, so the day\'s profit is understated by these bookings. Normally an Apple System P&L sync that failed for the booking while the invoice was raised by hand.',
      refs: cap(invoicedNotCosted),
    })
  }

  if (b2b.accounts.pnlCancelled > 0 || b2b.accounts.invoiceCancelled > 0) {
    out.push({
      severity: 'info',
      title: 'Some bookings are covered only by cancelled records',
      detail: `${b2b.accounts.pnlCancelled} P&L${b2b.accounts.pnlCancelled === 1 ? '' : 's'} and ${b2b.accounts.invoiceCancelled} invoice${b2b.accounts.invoiceCancelled === 1 ? '' : 's'} against this window's confirmations are cancelled records. They are counted as missing above, which is correct if the booking is live and expected if it is not.`,
      refs: [],
    })
  }

  if (b2c.available && b2c.missingInOps.length) {
    out.push({
      severity: 'info',
      title: `${b2c.missingInOps.length} storefront order${b2c.missingInOps.length === 1 ? '' : 's'} not in the booking system`,
      detail: 'The B2C importer only files orders whose service date is still ahead, so an order booked for a past or same-day service is expected to be absent here. This is reported for completeness and does not count against the B2C verdict.',
      refs: cap(b2c.missingInOps.map(String)),
    })
  }

  if (b2c.available && b2c.missingPnl.length) {
    out.push({
      severity: 'critical',
      title: `${b2c.missingPnl.length} storefront order${b2c.missingPnl.length === 1 ? ' has' : 's have'} no stored P&L`,
      detail: 'The storefront recomputes its P&L on every request and stores nothing, so the row in accounts is the only durable record an order will ever have. An order the sweep missed is permanently absent from the day\'s P&L until it is swept again.',
      refs: cap(b2c.missingPnl.map(String)),
    })
  }

  if (b2c.available && b2c.missingInvoice.length) {
    out.push({
      severity: 'warning',
      title: `${b2c.missingInvoice.length} storefront order${b2c.missingInvoice.length === 1 ? ' is' : 's are'} uninvoiced`,
      detail: 'An order that settled to zero after refunds is correctly uninvoiced; any other uninvoiced order is a gap in the day\'s billing.',
      refs: cap(b2c.missingInvoice.map(String)),
    })
  }

  return out
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function collectReconcileData(opts: CollectReconcileOptions): Promise<ReconcileReportData> {
  const now = opts.now ?? new Date()
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const window = buildReportWindow(opts.period, opts.timezone, now, opts.anchorDate)

  // The Apple System first: its confirmations are the key list every other
  // lookup is scoped to, so there is nothing to ask the others until it answers.
  const [as, b2c] = await Promise.all([
    collectAs(window),
    collectB2c(window),
  ])

  const refs = Array.from(new Set(as.confirmations.map(c => c.ref).filter((r): r is string => !!r)))

  const [ops, accounts] = await Promise.all([
    collectOps(window, refs, maxRows),
    collectAccounts(window, refs),
  ])

  // Stitch each confirmation back together, so the detail table can show one
  // row per booking with a tick or a cross under each system.
  const inOps = new Set(refs.filter(r => !ops.missing.includes(r)))
  const noPnl = new Set(accounts.missingPnl)
  const noInvoice = new Set(accounts.missingInvoice)

  for (const line of as.confirmations) {
    line.inOps = !!line.ref && inOps.has(line.ref)
    line.hasPnl = !!line.ref && accounts.available && !noPnl.has(line.ref)
    line.hasInvoice = !!line.ref && accounts.available && !noInvoice.has(line.ref)
    line.whole = line.inOps && line.hasPnl && line.hasInvoice
  }

  const check = buildCheck('Apple System B2B', {
    expected: as.confirmed,
    ops: ops.held,
    opsHeld: ops.held,
    pnls: accounts.withPnl,
    invoices: accounts.withInvoice,
    unchecked: !as.available || !accounts.available,
  })

  const b2b: B2bSection = { as, ops, accounts, check }
  const findings = deriveFindings(b2b, b2c)

  const balanced = check.balanced && (b2c.check.balanced || !b2c.available)
  const headline = [check.verdict, b2c.check.verdict].filter(Boolean).join(' ')

  return {
    window,
    generatedAt: now.toISOString(),
    b2b,
    b2c,
    findings,
    balanced,
    headline,
    narrative: null,
  }
}
