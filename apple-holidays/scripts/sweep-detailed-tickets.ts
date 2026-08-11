/**
 * Detailed P&L — ticket-tag collision sweep.
 *
 * Every ticket the costing sheet creates is identified by a tag in its notes,
 * and a re-sync matches on that tag. Two lines sharing a tag would therefore
 * collapse into one ticket and lose a real charge, so the tags must be unique
 * within a booking. This checks that across the live P&Ls (SELECT only, no
 * writes anywhere).
 *
 *   npx tsx --env-file=.env scripts/sweep-detailed-tickets.ts [limit]
 */
import { accountsQuery } from '../src/lib/accounts-db'
import { fetchCatalogues } from '../src/lib/detailed-pnl/db'
import { buildDetailPayload, extractKeyOrder } from '../src/lib/detailed-pnl/derive'
import { renderDetailed } from '../src/lib/detailed-pnl/render'
import { ticketSpecsFromDetailed } from '../src/lib/detailed-pnl/tickets'
import type { RowDataPacket } from 'mysql2/promise'

interface Row extends RowDataPacket { id: number; is_number: string | null; as_payload: string; country_code: string | null }

async function main() {
  const limit = Math.min(Math.max(1, parseInt(process.argv[2] ?? '400', 10)), 5000)
  const catalogues = await fetchCatalogues()

  const rows = await accountsQuery<Row>(
    `SELECT id, is_number, country_code, as_payload FROM pnl_records
      WHERE deleted_at IS NULL AND source = 'apple_system_api' AND as_payload IS NOT NULL
      ORDER BY id DESC LIMIT ${limit}`)

  let checked = 0, totalTickets = 0, zeroTicketSheets = 0
  const collisions: Array<{ id: number; is: string; keys: string[] }> = []
  const mismatched: Array<{ id: number; is: string; diff: number }> = []
  const byCategory: Record<string, number> = {}

  for (const r of rows) {
    let payload
    try { payload = JSON.parse(r.as_payload) } catch { continue }

    const record = {
      id: r.id, is_number: r.is_number, tour_ref: null, invoice_number: null,
      agent_name: null, country_code: r.country_code, currency: null, total_pax: null,
      as_quotation_no: null, as_reference_id: null, as_revision: null,
      status: null, pnl_approval_status: null, payload, rawPayload: r.as_payload,
    }
    const built = buildDetailPayload(record, catalogues, extractKeyOrder(r.as_payload))
    if (!built) continue

    const detail = renderDetailed(built)
    const specs = ticketSpecsFromDetailed(detail)
    checked++
    totalTickets += specs.length
    if (!specs.length) zeroTicketSheets++
    for (const s of specs) byCategory[s.category] = (byCategory[s.category] ?? 0) + 1

    const seen = new Set<string>(), dupes: string[] = []
    for (const s of specs) {
      if (seen.has(s.key)) dupes.push(s.key)
      seen.add(s.key)
    }
    if (dupes.length) collisions.push({ id: r.id, is: r.is_number ?? '—', keys: dupes })

    // The tickets should carry the same money the sheet's sections do.
    const t = detail.totals
    const sections = t.hotels + t.products + t.transfers + t.transport + t.meals + t.others
    const ticketSum = specs.reduce((a, s) => a + s.totalCost, 0)
    if (Math.abs(sections - ticketSum) > 0.02) {
      mismatched.push({ id: r.id, is: r.is_number ?? '—', diff: sections - ticketSum })
    }
  }

  console.log(`\nchecked ${checked} sheets · ${totalTickets} tickets`)
  console.log(`  sheets producing no tickets   ${zeroTicketSheets}`)
  console.log(`  by category                   ${JSON.stringify(byCategory)}`)
  console.log(`  tag collisions                ${collisions.length}`)
  for (const c of collisions.slice(0, 10)) console.log(`    ${c.id} ${c.is}: ${c.keys.join(', ')}`)

  console.log(`\n  sheets where tickets ≠ sections: ${mismatched.length}`)
  mismatched.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  for (const m of mismatched.slice(0, 10)) {
    console.log(`    ${String(m.id).padStart(6)} ${m.is.padEnd(12)} diff ${m.diff.toFixed(2)}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
