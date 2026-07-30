/**
 * Run the Aahaas B2C import from the command line.
 *
 *   npx tsx scripts/b2c-run-import.ts            # preview, writes NOTHING
 *   npx tsx scripts/b2c-run-import.ts --commit   # actually insert the bookings
 *
 * Preview is the default on purpose: committing requires the explicit `--commit`
 * flag, so this can never write by accident.
 *
 * What a commit does: INSERTS new bookings (plus their itinerary and P&L) for
 * upcoming Aahaas orders. It never updates or deletes an existing booking — a ref
 * already present is skipped, and a ref held by a non-B2C booking is reported as a
 * conflict. The Aahaas store itself is only ever read.
 *
 * The same operation is available to staff in the UI at /dashboard/b2c.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv(): void {
  let raw: string
  try { raw = readFileSync(join(process.cwd(), '.env'), 'utf8') } catch { return }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}

async function main() {
  loadEnv()
  const commit = process.argv.includes('--commit')
  const { runB2cImport } = await import('../src/lib/b2c-import')
  const { prisma } = await import('../src/lib/prisma')

  console.log(commit ? '=== COMMIT: inserting bookings ===' : '=== PREVIEW: nothing will be written ===')

  const summary = await runB2cImport({
    mode: 'backfill',
    dryRun: !commit,
    trigger: 'manual',
    triggeredBy: 'cli',
  })

  console.log(`\ncandidates       ${summary.candidates}`)
  console.log(`created          ${summary.created.length}${summary.created.length ? '  ' + summary.created.join(', ') : ''}`)
  console.log(`already present  ${summary.alreadyImported.length}${summary.alreadyImported.length ? '  ' + summary.alreadyImported.join(', ') : ''}`)
  console.log(`conflicts        ${summary.conflicts.length}`)
  for (const c of summary.conflicts) console.log(`   ${c.bookingRef}: ${c.reason}`)
  console.log(`skipped          ${summary.skipped.length}`)
  for (const s of summary.skipped) console.log(`   ${s.orderId}: ${s.reason} — ${s.detail}`)
  console.log(`failed           ${summary.failed.length}`)
  for (const f of summary.failed) console.log(`   ${f.orderId}: ${f.error}`)

  // Post-state, so the effect on the ops DB is visible rather than implied.
  const { bookingSourceWhere } = await import('../src/lib/booking-source')
  const [total, b2c] = await Promise.all([
    prisma.booking.count(),
    prisma.booking.count({ where: bookingSourceWhere('B2C')! }),
  ])
  console.log(`\nops bookings now: total ${total} | B2C ${b2c}`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Failed:', err instanceof Error ? err.message : err)
  const { prisma } = await import('../src/lib/prisma')
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
