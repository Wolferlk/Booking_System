/**
 * Aahaas B2C bookings for the report window — counted exactly the way the
 * accounts system's "Daily Invoice Report — Aahaas (B2C)" mail counts them,
 * so the OPS daily mail and that mail agree on the number.
 *
 * ## The accounts rule (ported, rule for rule)
 *
 * `InvoiceReportSource::applyB2cCohort()` + `B2cDayCohort::ensure()`:
 *
 *   • **New** — the storefront orders *placed* in the window
 *     (`tbl_checkout_ids.checkout_date`, not deleted), minus
 *       – agent-portal orders (`users.user_role = 'b2buser'` — they are the
 *         Aahaas B2B Flights report's, `B2cAgentOrderFilter`),
 *       – orders in the Test Bookings register (`AHS<id>`),
 *       – amendment orders (a later version of an earlier booking — the
 *         booking was sold on its original's day, `B2cOrderChain`).
 *     One line per booking, keyed `AHS-<chain id>`.
 *   • **Amended** — an older booking re-issued in the window: an AHS revision
 *     invoice (`AHS-16220R2`, or `is_revision`) raised inside the window for a
 *     booking that is not one of the window's new orders. Cancellations, agent
 *     orders and test bookings are left out. One line per booking, on its
 *     latest revision in the window.
 *
 * The storefront answers "which orders were placed", the accounts invoice
 * ledger answers "which of them are B2C invoices, and what each one is".
 *
 * ## Only bookings with a B2C invoice (user, 2026-11-20)
 *
 * The B2C tile must reflect the B2C invoice mail and nothing else. 19/11/2026
 * read 20 here (18 new + 2 amended) against the mail's 8 (6 + 2): of the 18
 * orders placed, 12 were never invoiced — checkout attempts and payment links
 * never paid, which the storefront files as order headers all the same. So:
 *
 *   • An order placed in the window counts only once the accounts ledger holds
 *     a B2C invoice for it (raised in the window, or late — the mail fetches a
 *     late first invoice too, `fetchForBookings`). The rest are left out and
 *     reported as "not invoiced", never silently dropped.
 *   • Each counted booking is classified by its LATEST document, exactly as
 *     the mail's New / Amended / Cancelled cards are (`movementOf`): a
 *     cancellation document → Cancelled, an AHS revision (AHS-16220R2) →
 *     Amended, otherwise New. Documents raised before the window closed are
 *     preferred; a booking invoiced only afterwards is read off those.
 *
 * ## Safety
 *
 * Read-only on both sides: `b2cQuery` refuses anything but a read, and the
 * accounts client is only ever asked SELECTs here. Never throws — an
 * unreachable database gives `available: false` and the mail says so.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { b2cQuery } from '@/lib/b2c-db'
import { accountsQuery } from '@/lib/accounts-db'
import { fetchOrderChainFacts } from '@/lib/b2c-order-chain'
import { loadTestBookings, testBookingKey } from '@/lib/test-bookings'
import { shiftDate, type ReportWindow } from './report-window'

export interface B2cDayLine {
  kind: 'New' | 'Amended' | 'Cancelled'
  /** The booking — "AHS-16299". */
  bookingRef: string
  /** The document printed: latest invoice for a new order, the revision for an amended one. Null = not invoiced yet. */
  invoiceNumber: string | null
  guest: string | null
  customer: string | null
  currency: string | null
  amount: number | null
  /** When the storefront order was placed (new) — "yyyy-mm-dd hh:mm", storefront clock. */
  placedAt: string | null
  /** When the printed invoice was raised, ISO UTC. */
  raisedAt: string | null
}

export interface B2cDaySection {
  available: boolean
  error?: string
  newCount: number
  amendedCount: number
  /** Bookings whose latest B2C document is a cancellation — the mail's "Cancelled". */
  cancelledCount: number
  /** new + amended + cancelled — the mail's "Total invoices". */
  total: number
  /** Orders placed in the window with no B2C invoice — NOT counted, reported. */
  notInvoiced: number
  /** Left out, so a smaller number is never read as lost data. */
  excluded: { agent: number; test: number; amendmentOrders: number }
  lines: B2cDayLine[]
}

export function emptyB2cDay(error?: string): B2cDaySection {
  return {
    available: false, error, newCount: 0, amendedCount: 0, cancelledCount: 0, total: 0, notInvoiced: 0,
    excluded: { agent: 0, test: 0, amendmentOrders: 0 }, lines: [],
  }
}

interface OrderRow extends RowDataPacket {
  id: number
  checkout_date: string | Date | null
  is_agent: number
}

interface InvRow extends RowDataPacket {
  invoice_number: string | null
  base_invoice_number: string | null
  original_invoice_number: string | null
  is_revision: number | null
  is_cancellation: number | null
  revision_number: number | null
  created_at: string | Date
  customer_name: string | null
  guest_name: string | null
  currency: string | null
  grand_total: string | number | null
  total_amount: string | number | null
}

/** "AHS-16220R2" / "AHS16220" / "ahs-16220-CXL" → 16220 (the booking's checkout id). */
function ahsIdOf(row: Pick<InvRow, 'invoice_number' | 'base_invoice_number' | 'original_invoice_number'>): number | null {
  const ref = String(row.base_invoice_number || row.original_invoice_number || row.invoice_number || '')
  const m = ref.toUpperCase().match(/^AHS-?0*(\d+)/)
  return m ? Number(m[1]) : null
}

/** `InvoiceReportService::looksRevised()` — B2C revisions carry no underscore (AHS-16220R2). */
function looksRevised(r: InvRow): boolean {
  const n = String(r.invoice_number ?? '')
  return Boolean(Number(r.is_revision ?? 0)) || /_R\d+/i.test(n) || /^AHS-?\d+R\d+$/i.test(n)
}

/** `InvoiceReportService::revisionNumberOf()`. */
function revisionNumberOf(r: InvRow): number {
  const n = String(r.invoice_number ?? '')
  const u = n.match(/_R(\d+)/gi)
  if (u?.length) return Number(u[u.length - 1].slice(2))
  const b = n.match(/^AHS-?\d+R(\d+)$/i)
  if (b) return Number(b[1])
  return Number(r.revision_number ?? 0) || 0
}

function amountOf(r: InvRow): number | null {
  const v = Number(r.grand_total ?? r.total_amount)
  return Number.isFinite(v) ? v : null
}

function iso(v: string | Date | null | undefined): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

function stamp(v: string | Date | null | undefined): string | null {
  if (v == null) return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 16).replace('T', ' ')
  return String(v).slice(0, 16)
}

/** Accounts stores timestamps in UTC. */
function utcStamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}

/** Excludes the agent-order marker rows (`B2cAgentOrderFilter::excludeAgentInvoices`). */
const NOT_AGENT_SQL = `NOT EXISTS (SELECT 1 FROM b2c_agent_orders ao
      WHERE CONCAT('AHS-', ao.checkout_id) = SUBSTRING_INDEX(UPPER(COALESCE(NULLIF(gi.base_invoice_number, ''),
        gi.original_invoice_number, gi.invoice_number)), 'R', 1))`

const INV_COLUMNS = `gi.invoice_number, gi.base_invoice_number, gi.original_invoice_number, gi.is_revision,
       gi.is_cancellation, gi.revision_number, gi.created_at, gi.customer_name, gi.guest_name,
       gi.currency, gi.grand_total, gi.total_amount`

export async function collectB2cDay(w: ReportWindow): Promise<B2cDaySection> {
  try {
    const tests = await loadTestBookings()
    const isTest = (id: number) => tests.marks.has(testBookingKey(`AHS${id}`))

    // ── New: the storefront's orders placed in the window ─────────────────
    // The date range (not DATE()) so the read can use an index; the same set.
    const orders = await b2cQuery<OrderRow>(
      `SELECT c.id, c.checkout_date,
              CASE WHEN u.user_role = 'b2buser' THEN 1 ELSE 0 END AS is_agent
         FROM tbl_checkout_ids c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.deleted_at IS NULL
          AND c.checkout_date >= ? AND c.checkout_date < ?
        ORDER BY c.id`,
      [`${w.fromDate} 00:00:00`, `${shiftDate(w.toDate, 1)} 00:00:00`],
    )
    const agent = orders.filter(o => Number(o.is_agent) === 1)
    const notAgent = orders.filter(o => Number(o.is_agent) !== 1)
    const test = notAgent.filter(o => isTest(Number(o.id)))
    const candidates = notAgent.filter(o => !isTest(Number(o.id)))
    const facts = await fetchOrderChainFacts(candidates.map(o => Number(o.id)))
    const amendmentOrders = candidates.filter(o => facts.get(Number(o.id))?.isAmendment)
    const fresh = candidates.filter(o => !facts.get(Number(o.id))?.isAmendment)
    const newIds = new Set(fresh.map(o => Number(o.id)))

    // ── Their invoices, whenever raised (an order invoiced after midnight
    //    still counts for the day it was placed) ───────────────────────────
    const newDocs = newIds.size
      ? await accountsQuery<InvRow>(
          `SELECT ${INV_COLUMNS} FROM generated_invoices gi
            WHERE SUBSTRING_INDEX(UPPER(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number)), 'R', 1)
                  IN (${Array.from(newIds).map(id => `'AHS-${id}'`).join(',')})
            ORDER BY gi.created_at`,
        )
      : []
    // Each placed order's documents. Those raised before the window closed
    // are what the mail read; a booking invoiced only afterwards (the mail's
    // late fetch) is read off its later documents instead.
    const windowEnd = w.end.getTime()
    const docsOf = new Map<number, InvRow[]>()
    for (const r of newDocs) {
      const id = ahsIdOf(r)
      if (!id) continue
      docsOf.set(id, [...(docsOf.get(id) ?? []), r])
    }

    // The booking's standing document and what the mail calls it: a
    // cancellation outranks every revision; otherwise the latest revision
    // (then the latest raised) — Amended if it is a revision, New if not.
    const classify = (docs: InvRow[]): { doc: InvRow; kind: B2cDayLine['kind'] } => {
      const before = docs.filter(r => {
        const at = iso(r.created_at)
        return at !== null && new Date(at).getTime() < windowEnd
      })
      const pool = before.length ? before : docs
      const cxl = pool.filter(r => Number(r.is_cancellation ?? 0))
      if (cxl.length) return { doc: cxl[cxl.length - 1], kind: 'Cancelled' }
      const latest = pool.reduce((a, b) =>
        revisionNumberOf(b) > revisionNumberOf(a)
        || (revisionNumberOf(b) === revisionNumberOf(a) && String(b.created_at) >= String(a.created_at)) ? b : a)
      return { doc: latest, kind: looksRevised(latest) ? 'Amended' : 'New' }
    }

    // Only orders with a B2C invoice are the mail's; the rest are reported.
    const invoiced = fresh.filter(o => docsOf.has(Number(o.id)))
    const notInvoiced = fresh.length - invoiced.length
    const placedLines = invoiced.map(o => {
      const id = Number(o.id)
      const { doc, kind } = classify(docsOf.get(id) ?? [])
      return { o, id, doc, kind }
    })

    // ── Amended: older bookings re-issued in the window ───────────────────
    const windowDocs = await accountsQuery<InvRow>(
      `SELECT ${INV_COLUMNS} FROM generated_invoices gi
        WHERE gi.created_at >= ? AND gi.created_at < ?
          AND UPPER(COALESCE(NULLIF(gi.base_invoice_number, ''), gi.invoice_number, '')) LIKE 'AHS%'
          AND COALESCE(gi.is_cancellation, 0) = 0
          AND ${NOT_AGENT_SQL}
        ORDER BY gi.created_at`,
      [utcStamp(w.start), utcStamp(w.end)],
    )
    const amended = new Map<number, InvRow>()
    for (const r of windowDocs) {
      const id = ahsIdOf(r)
      if (!id || newIds.has(id) || isTest(id) || !looksRevised(r)) continue
      const cur = amended.get(id)
      if (!cur || revisionNumberOf(r) > revisionNumberOf(cur)
        || (revisionNumberOf(r) === revisionNumberOf(cur) && String(r.created_at) > String(cur.created_at))) {
        amended.set(id, r)
      }
    }

    const lines: B2cDayLine[] = [
      ...placedLines.map(({ o, id, doc, kind }) => ({
        kind,
        bookingRef: `AHS-${id}`,
        invoiceNumber: doc.invoice_number ?? null,
        guest: doc.guest_name ?? null,
        customer: doc.customer_name ?? null,
        currency: doc.currency ?? null,
        amount: amountOf(doc),
        placedAt: stamp(o.checkout_date),
        raisedAt: iso(doc.created_at),
      })),
      ...Array.from(amended.entries()).map(([id, doc]) => ({
        kind: 'Amended' as const,
        bookingRef: `AHS-${id}`,
        invoiceNumber: doc.invoice_number,
        guest: doc.guest_name,
        customer: doc.customer_name,
        currency: doc.currency,
        amount: amountOf(doc),
        placedAt: null,
        raisedAt: iso(doc.created_at),
      })),
    ]

    const count = (k: B2cDayLine['kind']) => lines.filter(l => l.kind === k).length

    return {
      available: true,
      newCount: count('New'),
      // Same-day revisions of the window's own orders, plus older bookings re-issued in it.
      amendedCount: count('Amended'),
      cancelledCount: count('Cancelled'),
      total: lines.length,
      notInvoiced,
      excluded: { agent: agent.length, test: test.length, amendmentOrders: amendmentOrders.length },
      lines,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[Reports] B2C day unavailable:', message)
    return emptyB2cDay(message)
  }
}
