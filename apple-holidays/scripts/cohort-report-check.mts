/**
 * What the daily OPS report now counts for a date — the AppleSystem cohort as
 * read from the accounts Sync Ledger.
 *
 * Read-only, sends nothing. The full report also needs the OPS database
 * (Prisma), which is not configured for local CLI use; this covers the part
 * that changed.
 *
 *   npx tsx scripts/cohort-report-check.mts 2026-09-01
 */
// tsx does not load .env the way `next` does, so the accounts credentials have
// to be read in before the client is constructed — the same idiom the other
// CLI scripts here use.
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

const { collectAppleCohort } = await import('../src/lib/reports/apple-cohort')

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10)

const cohort = await collectAppleCohort({ fromDate: date, toDate: date })

console.log('date          ', date)
console.log('available     ', cohort.available, cohort.error ?? '')
console.log('confirmations ', cohort.total, '(cancelled', cohort.cancelled + ', expected', cohort.expected + ')')
console.log('swept at      ', cohort.sweptAt ?? 'never')
console.log('held in OPS   ', cohort.entries.filter(e => e.bookingPresent).length)
console.log('with P&L      ', cohort.entries.filter(e => e.pnlPresent).length)
console.log('invoiced      ', cohort.entries.filter(e => e.invoicePresent).length)
console.log('not in OPS    ', cohort.entries.filter(e => !e.bookingPresent && !e.cancelled).map(e => e.ref).join(', ') || 'none')
process.exit(0)
