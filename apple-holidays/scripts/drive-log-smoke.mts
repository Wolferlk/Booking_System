/**
 * Read-only smoke check for the Drive Log.
 *
 * Runs the exact query the screen and both downloads share — Prisma, the
 * driver-advance snapshots and the invoice ledger — then renders the real
 * workbook and the real PDF from those rows. Writes only to the output
 * directory given as argv[2]; touches nothing in either database.
 *
 *   npx tsx scripts/drive-log-smoke.mts /tmp/out
 */
import { writeFile } from 'fs/promises'
import {
  parseDriveLogQuery, driveLogTotals, windowLabel, amount,
} from '../src/lib/sl-drive-log'
import { fetchDriveLogRows } from '../src/lib/sl-drive-log-server'
import { buildDriveLogWorkbook } from '../src/lib/sl-drive-log-xlsx'
import { buildDriveLogPdf } from '../src/lib/sl-drive-log-pdf'

const OUT = process.argv[2] ?? '/tmp'

async function run(label: string, slug: string, qs: string, render = false) {
  const q  = parseDriveLogQuery(new URLSearchParams(qs))
  const t0 = Date.now()
  const res = await fetchDriveLogRows(q)
  const t   = driveLogTotals(res.rows)

  console.log(`\n── ${label} (${Date.now() - t0}ms)`)
  console.log(`   ${windowLabel(q)} · ${res.rows.length} shown of ${res.matched} matched`
    + `${res.truncated ? ' (TRUNCATED)' : ''}`)
  console.log(`   advances ${res.advancesAvailable ? 'ok' : 'UNAVAILABLE'}`
    + ` · invoices ${res.invoicesAvailable ? 'ok' : 'UNAVAILABLE'}`)
  console.log(`   costed ${t.costedRows} · uncosted ${t.uncostedRows} · no-rate ${t.noRateRows}`
    + ` · unallocated ${t.unassigned} · P&L pending ${t.unapproved}`)
  console.log(`   cost ${amount(t.totalCost)} = advance ${amount(t.advance)} + balance ${amount(t.balancePayable)}`)
  console.log(`   paid ${amount(t.paid)} (advance ${amount(t.advancePaid)} + rest ${amount(t.restPaid)})`
    + ` · still owed ${amount(t.profitLoss)}`)
  console.log(`   invoiced USD ${amount(t.invoiceUsd)}`)

  // The identity the whole screen rests on: total = advance + balance payable,
  // and still owed = total − paid. If either drifts, the columns are lying.
  const idA = Math.abs(t.totalCost - (t.advance + t.balancePayable))
  const idB = Math.abs(t.profitLoss - (t.totalCost - t.paid))
  console.log(`   identity check · cost−(adv+bal)=${idA.toFixed(2)} · owed−(cost−paid)=${idB.toFixed(2)}`)

  const sample = res.rows.find(r => r.settlement.state === 'ok')
  if (sample) {
    const s = sample.settlement
    console.log(`   sample ${sample.isNumber ?? sample.bookingRef} · ${sample.driver?.name ?? 'no driver'}`
      + ` · ${s.stage} · cost ${amount(s.totalCost)} adv ${amount(s.advance)}`
      + ` advPaid ${amount(s.advancePaid)} restPaid ${amount(s.restPaid)} owed ${amount(s.profitLoss)}`)
  }

  if (!render) return

  const xlsx = buildDriveLogWorkbook(res.rows, q, new Date(), 'Smoke Check')
  await writeFile(`${OUT}/${slug}.xlsx`, xlsx)
  console.log(`   xlsx ${(xlsx.length / 1024).toFixed(0)} KB → ${OUT}/${slug}.xlsx`)

  const t1 = Date.now()
  const pdf = await buildDriveLogPdf(res.rows, q, new Date(), 'Smoke Check')
  await writeFile(`${OUT}/${slug}.pdf`, pdf)
  console.log(`   pdf  ${(pdf.length / 1024).toFixed(0)} KB in ${Date.now() - t1}ms → ${OUT}/${slug}.pdf`)
}

await run('default — arrivals D+2', 'default', '', true)
await run('next 7 days',            'week',    `from=${new Date().toISOString().slice(0, 10)}&to=${new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10)}`, true)
await run('open items only',        'open',    `from=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}&to=${new Date().toISOString().slice(0, 10)}&openOnly=1`)
await run('empty result',           'empty',   'from=1990-01-01&to=1990-01-02', true)
process.exit(0)
