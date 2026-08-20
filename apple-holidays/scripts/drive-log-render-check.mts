/**
 * Check the Drive Log printout's shape — `npm run drivelog:render`.
 *
 * Every row of the printed Drive Log must span exactly as many columns as its
 * header declares.
 *
 * A colspan that drifts by one does not throw and does not fail a type check —
 * it shears the table sideways from that row down, and is only ever found by
 * printing the thing and looking at it. So the HTML is built and counted.
 *
 * No database, no credentials and no Chromium — it builds the document from
 * fixture rows and counts cells. Cheap enough to run on every change to the
 * table's columns, which is exactly when it is needed.
 */
import { buildDriveLogPdfHtml } from '../src/lib/sl-drive-log-pdf'
import {
  deriveSettlement, deriveEffective, parseDriveLogQuery,
} from '../src/lib/sl-drive-log'

let fail = 0
const check = (label: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) fail++
}

const env = (o: any) => {
  const summary: any = {
    reference: 'X', found: true, state: o.state ?? 'ok', message: o.message ?? null, record_id: 1,
    is_number: 'IS1', control_number: '1CNTL',
    amount_lkr: 30000, computed_lkr: 30000, obligation_lkr: 100000, paid_lkr: 30000,
    outstanding_lkr: 0, rate: 335, rate_available: true, currency: 'USD',
    amount: 90, obligation: 300, stage: 'rest_due', progress: 30, line_count: 3,
    edited: false, payable: true, pnl_approval: 'approved', is_cancelled: false,
    computed_at: new Date().toISOString(),
  }
  return deriveSettlement(summary, null)
}

const mkRow = (i: number, settlement: any, actuals: any = null) => ({
  bookingId: `b${i}`, bookingRef: `IS${i}`, isNumber: `IS${i}`, cntlNumber: `C${i}`,
  clientName: `Guest ${i}`, agent: 'A', fileHandler: 'F',
  arrivalDate: '2026-08-22', departureDate: '2026-08-27', nights: 5, pax: 2,
  status: 'CONFIRMED', hotelOnly: false, daysToArrival: 2,
  driver: { id: 'd', name: 'Driver', phone: '1', photoUrl: null, isActive: true, licenseNo: null,
            vehicle: { id: 'v', type: 'car', plateNo: 'AB-1', brand: null, model: null, capacity: 4 },
            vendorName: null, bank: { name: 'BOC', branch: null, code: null, holder: null, accountNo: '1' },
            source: 'allocation' as const },
  invoice: { state: 'partial' as const, message: null, invoiceNumber: 'I', currency: 'USD',
             amount: 100, paid: 40, balance: 60, paidPercent: 40, revision: 1, revisionCount: 1,
             invoiceDate: null, lastPaymentAt: null },
  settlement, actuals, effective: deriveEffective(settlement, actuals),
})

const actuals = {
  id: 1, bookingId: 'b2', status: 'pending' as const,
  actualPackageCost: 90000, actualBalancePayable: 55000, note: null,
  computedTotalCost: null, computedAdvance: null, computedBalancePayable: null, advancePaid: null,
  savedBy: null, savedAt: null, submittedBy: 'Desk', submittedAt: null, submitCount: 1,
  decidedBy: null, decidedAt: null, decisionNote: null,
  recordedAmountLkr: null, recordedBatchRef: null, recordedAt: null, recordedBy: null,
}

const rows = [
  mkRow(1, env({})),                                        // costed, no actuals
  mkRow(2, env({}), actuals),                               // costed, corrected
  mkRow(3, env({ state: 'no_lines', message: 'not costed' })), // the span row
]

const q = parseDriveLogQuery(new URLSearchParams(''))
const html = buildDriveLogPdfHtml(rows as any, q, new Date(), 'Colspan Check')

/** Column width of one <tr>, counting colspans. */
function width(tr: string): number {
  return [...tr.matchAll(/<t[dh]\b([^>]*)>/g)]
    .reduce((n, m) => n + (Number(/colspan="(\d+)"/.exec(m[1])?.[1]) || 1), 0)
}

// Each <table> is checked against its own header.
const tables = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)].map(m => m[1])
check('the printout has both tables', tables.length === 2, String(tables.length))

for (const [i, table] of tables.entries()) {
  const trs = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[0])
  const head = width(trs[0])
  check(`table ${i + 1}: header declares columns`, head > 0, String(head))
  const bad = trs.map((tr, n) => ({ n, w: width(tr) })).filter(r => r.w !== head)
  check(`table ${i + 1}: every row spans ${head} columns`, bad.length === 0,
    bad.map(b => `row ${b.n} spans ${b.w}`).join('; '))
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`}`)
process.exit(fail === 0 ? 0 : 1)
