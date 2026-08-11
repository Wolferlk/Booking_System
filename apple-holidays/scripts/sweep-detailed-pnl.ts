/**
 * Detailed P&L — robustness sweep.
 *
 * Builds the costing sheet for every stored P&L (SELECT only) and reports:
 *   - any booking the port throws on;
 *   - how the six section totals reconcile against the API's own
 *     cost_without_markup.total, which is what they must sum to.
 *
 * A handful of bookings legitimately carry a residue the sections cannot
 * explain (the API's markup and rounding live outside them); the point of the
 * sweep is that nothing CRASHES and that the gap stays the profit figure rather
 * than drifting arbitrarily.
 *
 *   npx tsx --env-file=.env scripts/sweep-detailed-pnl.ts [limit]
 */
import { accountsQuery } from '../src/lib/accounts-db'
import { fetchCatalogues } from '../src/lib/detailed-pnl/db'
import { buildDetailPayload, extractKeyOrder } from '../src/lib/detailed-pnl/derive'
import { renderDetailed } from '../src/lib/detailed-pnl/render'
import type { RowDataPacket } from 'mysql2/promise'

interface Row extends RowDataPacket {
  id: number; is_number: string | null; country_code: string | null
  as_quotation_no: string | null; as_reference_id: string | null
  as_revision: number | null; as_payload: string | null
  tour_ref: string | null; invoice_number: string | null
  agent_name: string | null; currency: string | null
  total_pax: number | null; status: string | null; pnl_approval_status: string | null
}

async function main() {
  const limit = Math.min(Math.max(1, parseInt(process.argv[2] ?? '400', 10)), 5000)
  const catalogues = await fetchCatalogues()

  const rows = await accountsQuery<Row>(
    `SELECT id, is_number, tour_ref, invoice_number, agent_name, country_code, currency,
            total_pax, as_quotation_no, as_reference_id, as_revision, status,
            pnl_approval_status, as_payload
       FROM pnl_records
      WHERE deleted_at IS NULL AND source = 'apple_system_api' AND as_payload IS NOT NULL
      ORDER BY id DESC
      LIMIT ${limit}`,
  )

  let ok = 0, noPayload = 0
  const failures: Array<{ id: number; is: string; err: string }> = []
  const gaps: Array<{ id: number; is: string; gap: number; profit: number }> = []
  const byCountry: Record<string, number> = {}
  let emptySheets = 0

  for (const r of rows) {
    const record = {
      id: r.id, is_number: r.is_number, tour_ref: r.tour_ref, invoice_number: r.invoice_number,
      agent_name: r.agent_name, country_code: r.country_code, currency: r.currency,
      total_pax: r.total_pax, as_quotation_no: r.as_quotation_no,
      as_reference_id: r.as_reference_id == null ? null : String(r.as_reference_id),
      as_revision: r.as_revision, status: r.status, pnl_approval_status: r.pnl_approval_status,
      payload: null as never, rawPayload: r.as_payload,
    }
    try {
      record.payload = JSON.parse(r.as_payload!) as never
    } catch {
      noPayload++; continue
    }

    try {
      const keyOrder = extractKeyOrder(r.as_payload!)
      const payload = buildDetailPayload(record, catalogues, keyOrder)
      if (!payload) { noPayload++; continue }

      const d = renderDetailed(payload)
      const t = d.totals
      ok++
      byCountry[r.country_code ?? '??'] = (byCountry[r.country_code ?? '??'] ?? 0) + 1

      const sections = t.hotels + t.products + t.transfers + t.transport + t.meals + t.others
      // The sections cost the tour; cost.total adds the markup. The gap should
      // therefore BE the profit — anything else is unexplained.
      const gap = t.grand - sections - t.profit
      if (Math.abs(gap) > 0.02) gaps.push({ id: r.id, is: r.is_number ?? '—', gap, profit: t.profit })

      const lines = d.tables.stays.length + d.tables.products.length + d.tables.transfers.length
        + d.tables.transport.length + d.tables.meals.length + d.tables.others.length
      if (lines === 0) emptySheets++
    } catch (e) {
      failures.push({ id: r.id, is: r.is_number ?? '—', err: e instanceof Error ? e.message : String(e) })
    }
  }

  console.log(`\nscanned ${rows.length} stored P&Ls`)
  console.log(`  rendered ok      ${ok}`)
  console.log(`  no usable payload ${noPayload}`)
  console.log(`  threw            ${failures.length}`)
  console.log(`  empty sheets     ${emptySheets}`)
  console.log(`  by country       ${JSON.stringify(byCountry)}`)

  if (failures.length) {
    console.log('\nFAILURES')
    for (const f of failures.slice(0, 25)) console.log(`  ${f.id} ${f.is}: ${f.err}`)
  }

  console.log(`\nsections + profit ≠ cost.total on ${gaps.length} of ${ok}`)
  gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
  for (const g of gaps.slice(0, 15)) {
    console.log(`  ${String(g.id).padStart(6)} ${g.is.padEnd(12)} gap ${g.gap.toFixed(2).padStart(12)}  profit ${g.profit.toFixed(2)}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
