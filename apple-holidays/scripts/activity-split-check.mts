/**
 * Render check for the daily report's Today new & updated / Old amendments
 * split.
 *
 *   npx tsx scripts/activity-split-check.mts [yyyy-mm-dd]
 *
 * **Read-only.** Two SELECTs on the accounts database over the shared
 * read-only client. It writes nothing and sends nothing; it exists so the two
 * counts can be lined up against the accounts mails for the same day before
 * anything goes out.
 */
// tsx does not load .env the way `next` does, so the accounts credentials have
// to be read in before the client is constructed — the same idiom the other
// CLI scripts here use.
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

const { collectActivitySplit } = await import('../src/lib/reports/activity-split')
const { buildReportWindow, DEFAULT_REPORT_TZ } = await import('../src/lib/reports/report-window')

const arg = process.argv[2]
const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? '') ? arg : undefined

async function main() {
  const window = buildReportWindow('DAILY', DEFAULT_REPORT_TZ, new Date(), anchorDate)
  console.log(`Window: ${window.label}  (${window.fromDate} → ${window.toDate}, ${window.timezone})`)

  const split = await collectActivitySplit(window)

  if (!split.available) {
    console.log('unavailable:', split.error)
    return
  }

  console.log(`Today new & updated : ${split.today.count}  (${split.today.bookings} bookings)`)
  console.log(`Old amendments      : ${split.old.count}  (${split.old.bookings} bookings)`)
  console.log('\nfirst 5 today:')
  for (const l of split.today.lines.slice(0, 5)) console.log(' ', l.type.padEnd(8), l.ref.padEnd(12), l.currency, l.amount, 'first', l.firstOn)
  console.log('\nfirst 5 old:')
  for (const l of split.old.lines.slice(0, 5)) console.log(' ', l.ref.padEnd(12), 'age', String(l.ageDays).padStart(3), 'revs', l.revisions, l.currency, l.amount)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
