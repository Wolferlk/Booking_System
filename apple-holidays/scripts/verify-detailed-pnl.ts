/**
 * Detailed P&L — port verification.
 *
 * Reads real bookings out of the Accounts database (SELECT only) and prints the
 * costing sheet's section totals and line items, so they can be checked against
 * the same booking's Detailed P&L modal in the Accounts app. Nothing is written
 * anywhere.
 *
 *   npx tsx scripts/verify-detailed-pnl.ts VN41054 IS48832
 */
import { fetchCatalogues, fetchStoredPnl } from '../src/lib/detailed-pnl/db'
import { buildDetailPayload, extractKeyOrder } from '../src/lib/detailed-pnl/derive'
import { renderDetailed } from '../src/lib/detailed-pnl/render'

const f = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function run(isNumber: string) {
  console.log(`\n${'='.repeat(78)}\n${isNumber}\n${'='.repeat(78)}`)

  const match = await fetchStoredPnl({ isNumber })
  if (!match) { console.log('  no stored P&L'); return }

  const { record } = match
  const catalogues = await fetchCatalogues()
  const keyOrder = record.rawPayload ? extractKeyOrder(record.rawPayload) : undefined
  const payload = buildDetailPayload(record, catalogues, keyOrder)
  if (!payload) { console.log('  record has no Apple System payload'); return }

  const d = renderDetailed(payload)
  const t = d.totals

  console.log(`  record ${record.id} · rev ${record.as_revision} · ${record.country_code} · ${d.currency}`)
  console.log(`  catalogues: attraction=${Object.keys(catalogues.attraction).length}`
    + ` city_tour=${Object.keys(catalogues.city_tour).length}`
    + ` excursion=${Object.keys(catalogues.excursion).length}`
    + ` vehicle=${Object.keys(catalogues.vehicle).length}`)

  console.log('\n  SECTION TOTALS')
  for (const [k, v] of Object.entries({
    Hotels: t.hotels, Attraction: t.products, 'Tour Transfers': t.transfers,
    Transport: t.transport, Meals: t.meals, Others: t.others,
  })) console.log(`    ${k.padEnd(16)} ${f(v).padStart(12)}`)
  console.log(`    ${'—'.repeat(28)}`)
  console.log(`    ${'Total Tour Cost'.padEnd(16)} ${f(t.grand).padStart(12)}`)
  console.log(`    ${'Without Markup'.padEnd(16)} ${f(t.cost).padStart(12)}`)
  console.log(`    ${'Profit'.padEnd(16)} ${f(t.profit).padStart(12)}  (${t.margin.toFixed(1)}%)`)

  const show = (title: string, rows: Array<{ label: string; total: number; extra?: string }>) => {
    if (!rows.length) return
    console.log(`\n  ${title}`)
    let s = 0
    for (const r of rows) {
      s += r.total
      console.log(`    ${f(r.total).padStart(11)}  ${r.label}${r.extra ? `  [${r.extra}]` : ''}`)
    }
    console.log(`    ${f(s).padStart(11)}  = line sum`)
  }

  show('HOTELS', d.tables.stays.map(h => ({ label: `${h.name} (${h.nights}N)`, total: h.total })))
  show('ATTRACTION', d.tables.products.map(p => ({
    label: p.name, total: p.total, extra: [p.day && `Day ${p.day}`, p.city].filter(Boolean).join(' · '),
  })))
  show('TOUR TRANSFERS', d.tables.transfers.map(p => ({
    label: p.name, total: p.total, extra: [p.day && `Day ${p.day}`, p.city].filter(Boolean).join(' · '),
  })))
  show('TRANSPORT', d.tables.transport.map(t2 => ({
    label: t2.desc, total: t2.total, extra: t2.info ? 'info — excluded' : t2.sub,
  })))
  show('MEALS', d.tables.meals.map(m => ({ label: `Day ${m.day}`, total: m.total })))
  show('MEAL EXTRAS', d.tables.mealExtras.map(m => ({ label: m.label, total: m.total })))
  show('OTHERS', d.tables.others.map(o => ({ label: o.desc, total: o.total, extra: o.sub })))

  // The sheet must reconcile: the API's own grand total against the sections.
  const sectionSum = t.hotels + t.products + t.transfers + t.transport + t.meals + t.others
  console.log(`\n  RECONCILIATION`)
  console.log(`    sections sum      ${f(sectionSum).padStart(12)}`)
  console.log(`    API cost.total    ${f(t.grand).padStart(12)}`)
  console.log(`    difference        ${f(t.grand - sectionSum).padStart(12)}  (markup / rounding)`)

  console.log(`\n  HTML: ${d.html.length} chars, ${(d.html.match(/<tr/g) || []).length} rows`)
}

async function main() {
  const args = process.argv.slice(2)
  const targets = args.length ? args : ['VN41054', 'IS48832']
  for (const t of targets) {
    try { await run(t) } catch (e) { console.error(`  FAILED ${t}:`, e) }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
