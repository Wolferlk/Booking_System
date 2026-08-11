/**
 * Detailed P&L — ticket preview.
 *
 * Prints the tickets the costing sheet WOULD create for a booking. Pure
 * computation: reads the Accounts DB (SELECT only) and writes nothing.
 *
 *   npx tsx --env-file=.env scripts/verify-detailed-tickets.ts VN41054 IS48823
 */
import { fetchCatalogues, fetchStoredPnl } from '../src/lib/detailed-pnl/db'
import { buildDetailPayload, extractKeyOrder } from '../src/lib/detailed-pnl/derive'
import { renderDetailed } from '../src/lib/detailed-pnl/render'
import { ticketSpecsFromDetailed } from '../src/lib/detailed-pnl/tickets'

const f = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function run(isNumber: string) {
  const match = await fetchStoredPnl({ isNumber })
  if (!match) { console.log(`\n${isNumber}: no stored P&L`); return }

  const catalogues = await fetchCatalogues()
  const keyOrder = match.record.rawPayload ? extractKeyOrder(match.record.rawPayload) : undefined
  const payload = buildDetailPayload(match.record, catalogues, keyOrder)
  if (!payload) { console.log(`\n${isNumber}: no payload`); return }

  const detail = renderDetailed(payload)
  const specs = ticketSpecsFromDetailed(detail)

  console.log(`\n${'='.repeat(78)}\n${isNumber} — ${specs.length} tickets (${detail.currency})\n${'='.repeat(78)}`)
  let sum = 0
  for (const s of specs) {
    sum += s.totalCost
    console.log(`  ${s.category.padEnd(10)} ${f(s.totalCost).padStart(11)}  qty ${String(s.qty).padStart(3)}  ${s.name.slice(0, 62)}`)
    console.log(`  ${' '.repeat(10)} tag: ${s.key}`)
    if (s.details.length) console.log(`  ${' '.repeat(10)} ${s.details.join(' · ').slice(0, 100)}`)
  }
  console.log(`  ${'-'.repeat(74)}`)
  console.log(`  ticket sum ${f(sum).padStart(14)}   sheet sections ${f(
    detail.totals.hotels + detail.totals.products + detail.totals.transfers
    + detail.totals.transport + detail.totals.meals + detail.totals.others)}`)

  // Keys must be unique, or two costing lines would fight over one ticket.
  const keys = specs.map(s => s.key)
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
  console.log(`  duplicate tags: ${dupes.length ? dupes.join(', ') : 'none'}`)
}

async function main() {
  const targets = process.argv.slice(2)
  for (const t of (targets.length ? targets : ['VN41054', 'IS48823'])) await run(t)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
