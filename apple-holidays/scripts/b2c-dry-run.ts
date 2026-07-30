/**
 * Aahaas B2C import — DRY RUN.
 *
 * Exercises the real `b2c-db` + `b2c-booking-map` modules against the live Aahaas
 * store and prints exactly what an import WOULD create. It writes nothing to
 * either database, so it is safe to run against production at any time.
 *
 *   npx tsx scripts/b2c-dry-run.ts
 *
 * Checks performed:
 *   1. the read-only guard actually rejects writes and stacked statements
 *   2. which upcoming travel orders map cleanly, and which are skipped and why
 *   3. that every generated P&L line reproduces the true B2C cost when evaluated
 *      through the ops formula — the one thing a mapping bug would silently break
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertReadOnly,
  fetchFlightBookings,
  fetchOrderCustomers,
  fetchOrderHeaders,
  fetchOrderProducts,
  isB2cConfigured,
} from '../src/lib/b2c-db'
import { parseFlightBooking } from '../src/lib/b2c-flight'
import { mapB2cOrder } from '../src/lib/b2c-booking-map'
import type { MappedB2cBooking } from '../src/lib/b2c-booking-map'
import type { B2cOrderProduct } from '../src/lib/b2c-db'

/**
 * Minimal .env loader — `dotenv` is not a direct dependency of this project, and
 * a standalone script should not need one just to read six connection variables.
 * Existing process env always wins so `DB_HOST=… npx tsx …` still overrides.
 */
function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync(join(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    if (process.env[key] !== undefined) continue
    let value = m[2].trim()
    // Strip a single layer of matching quotes, as dotenv does.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}

async function main() {
  loadEnv()
  console.log('B2C configured:', isB2cConfigured())

  // ── 1. read-only lock ───────────────────────────────────────────────────────
  const mustBlock = [
    'UPDATE tbl_checkout_ids SET paid_amount = 0',
    'SELECT 1; DROP TABLE tbl_customer',
    'DELETE FROM users',
    'ALTER TABLE tbl_lifestyle ADD COLUMN x INT',
  ]
  let guardOk = true
  for (const sql of mustBlock) {
    try {
      assertReadOnly(sql)
      guardOk = false
      console.error('  !! GUARD FAILED to block:', sql)
    } catch {
      console.log('  blocked:', sql.slice(0, 46))
    }
  }
  assertReadOnly('SELECT 1')
  console.log(guardOk ? '  read-only guard OK\n' : '  READ-ONLY GUARD IS BROKEN\n')

  // ── 2. what would be imported ───────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const headers = await fetchOrderHeaders({ upcomingFrom: today, limit: 200 })
  console.log(`Upcoming travel orders found: ${headers.length}`)

  const ids = headers.map((h) => Number(h.order_id))
  const [products, customers, flightRows] = await Promise.all([
    fetchOrderProducts(ids),
    fetchOrderCustomers(ids),
    fetchFlightBookings(ids),
  ])
  console.log(`Product lines: ${products.length} | customers: ${customers.length} | flight bookings: ${flightRows.length}\n`)

  const productsByOrder = group(products, (p) => Number(p.order_id))
  const customerByOrder = new Map(customers.map((c) => [Number(c.order_id), c]))
  const flightsByOrder = group(flightRows.map((r) => parseFlightBooking(r)), (f) => f.orderId)

  const mapped: MappedB2cBooking[] = []
  const skipped: { orderId: number; reason: string; detail: string }[] = []

  for (const header of headers) {
    const id = Number(header.order_id)
    const r = mapB2cOrder({
      header,
      products: productsByOrder.get(id) ?? [],
      customer: customerByOrder.get(id),
      flights: flightsByOrder.get(id) ?? [],
    })
    if (r.ok) mapped.push(r.booking)
    else skipped.push({ orderId: r.orderId, reason: r.reason, detail: r.detail })
  }

  console.log(`=== WOULD IMPORT: ${mapped.length} ===`)
  console.table(mapped.map((b) => ({
    ref: b.bookingRef,
    country: b.operationCountry ?? '(unscoped)',
    via: String(b.source.countryResolvedVia),
    arrival: b.arrivalDate,
    departure: b.departureDate,
    ad: b.paxAdults,
    ch: b.paxChildren,
    paxVia: String(b.source.paxResolvedVia),
    total: b.quotedTotal,
    cur: b.currency,
    lines: b.pnlLines.length,
    dest: (b.tourDestination ?? '—').slice(0, 18),
    customer: (b.leadPassengerName ?? '—').slice(0, 20),
    pay: b.pnlLines[0]?.paymentStatus ?? '—',
  })))

  console.log(`\n=== WOULD SKIP: ${skipped.length} ===`)
  console.table(skipped.map((s) => ({ ...s, detail: s.detail.slice(0, 72) })))

  // ── 3. P&L reconciliation through the ops formula ───────────────────────────
  console.log('\n=== P&L cost reconciliation (ops formula vs source net_cost) ===')
  const rows: { ref: string; activity: string; cat: string; computed: number; actual: number; match: string }[] = []

  for (const b of mapped) {
    const src = productsByOrder.get(Number(b.source.orderId)) ?? []
    b.pnlLines.forEach((l, i) => {
      const pax = b.paxAdults + b.paxChildren
      const computed =
        (l.sicRate + l.pvtRatePP + l.otherRate) * pax +
        l.adEntrance * b.paxAdults +
        l.chEntrance * b.paxChildren
      const actual = Number(src[i]?.net_cost_amount ?? 0)
      // Rate columns are DECIMAL(10,2), so spreading a cost over pax can lose up
      // to half a cent per head. Anything inside that bound is representable
      // exactness; anything beyond it is a genuine mapping bug.
      const bound = 0.005 * pax + 0.001
      const delta = Math.abs(computed - actual)
      rows.push({
        ref: b.bookingRef,
        activity: l.activity.slice(0, 28),
        cat: l.category,
        computed: round2(computed),
        actual: round2(actual),
        match: delta <= bound ? (delta > 0.0001 ? 'OK (rounding)' : 'OK') : 'MISMATCH',
      })
    })
  }
  console.table(rows)

  // ── 4. ops-side sanity: the source filter must work against the live schema ──
  // This is the query that fails if the Prisma schema drifts from the ops DB.
  console.log('\n=== ops DB: source filter (read-only) ===')
  const { prisma } = await import('../src/lib/prisma')
  const { bookingSourceWhere, B2C_AGENT_NAME } = await import('../src/lib/booking-source')
  try {
    const [total, b2c, b2b] = await Promise.all([
      prisma.booking.count(),
      prisma.booking.count({ where: bookingSourceWhere('B2C')! }),
      prisma.booking.count({ where: bookingSourceWhere('B2B')! }),
    ])
    console.log(`  total ${total} | B2C ${b2c} | B2B ${b2b} (marker: agent = "${B2C_AGENT_NAME}")`)
    console.log(total === b2c + b2b ? '  partition is exact — every booking is in exactly one channel.' : '  WARNING: counts do not partition.')
    // Prove the columns the list page selects still resolve.
    await prisma.booking.findMany({ take: 1, select: { bookingRef: true, agent: true, operationCountry: true } })
    console.log('  booking.findMany OK — no schema drift.')
  } finally {
    await prisma.$disconnect()
  }

  const bad = rows.filter((r) => r.match === 'MISMATCH')
  const rounded = rows.filter((r) => r.match === 'OK (rounding)')
  console.log(
    bad.length === 0
      ? `\nAll ${rows.length} P&L lines reconcile` +
        (rounded.length > 0
          ? ` (${rounded.length} within the DECIMAL(10,2) rounding bound of half a cent per pax).`
          : ' exactly.')
      : `\n${bad.length} of ${rows.length} P&L lines DO NOT reconcile — mapping needs fixing.`,
  )
}

function group<T>(rows: T[], key: (r: T) => number): Map<number, T[]> {
  const m = new Map<number, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

main()
  .catch((err) => {
    console.error('Dry run failed:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  // The B2C client opens a fresh connection per query and closes each one, so
  // there is nothing to tear down — but be explicit that we are done.
  .finally(() => { process.exit(process.exitCode ?? 0) })

export type { B2cOrderProduct }
