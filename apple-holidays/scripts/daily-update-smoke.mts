/**
 * Read-only smoke check for the Daily Update sheet.
 *
 * Runs the exact query the screen and both downloads share, then renders the
 * real workbook and the real PDF from those rows. Writes only to the output
 * directory given as argv[2]; touches nothing in the database.
 */
import { writeFile } from 'fs/promises'
import {
  parseDailyUpdateQuery, fetchDailyUpdateRows, sortDailyUpdateRows,
  summarise, resolveRange,
} from '../src/lib/daily-update'
import { buildDailyUpdateWorkbook } from '../src/lib/daily-update-xlsx'
import { buildDailyUpdatePdf } from '../src/lib/daily-update-pdf'

const OUT = process.argv[2] ?? '/tmp'
const scope = { role: 'ULTRA_SUPER_ADMIN' as const, country: 'ALL' }

async function run(label: string, slug: string, qs: string, render = false) {
  const q = parseDailyUpdateQuery(new URLSearchParams(qs))
  const t0 = Date.now()
  const rows = sortDailyUpdateRows(await fetchDailyUpdateRows(q, scope, render ? 800 : 1500), q)
  const { start, end } = resolveRange(q)
  console.log(`\n── ${label} (${Date.now() - t0}ms)`)
  console.log(`   window ${start.toDateString()} → ${end.toDateString()}`)
  console.log(`   ${JSON.stringify(summarise(rows))}`)

  if (!render) return
  const xlsx = buildDailyUpdateWorkbook(rows, q)
  await writeFile(`${OUT}/${slug}.xlsx`, xlsx)
  console.log(`   xlsx ${(xlsx.length / 1024).toFixed(0)} KB → ${OUT}/${slug}.xlsx`)

  const t1 = Date.now()
  const pdf = await buildDailyUpdatePdf(rows, q)
  await writeFile(`${OUT}/${slug}.pdf`, pdf)
  console.log(`   pdf  ${(pdf.length / 1024).toFixed(0)} KB in ${Date.now() - t1}ms → ${OUT}/${slug}.pdf`)
}

await run('default — 10 day arrivals + today', 'default', '', true)
await run('created date, 7 days',              'created', 'dateField=createdAt&days=7', true)
await run('departure, 30 days, no today pin',  'departure', 'dateField=departureDate&days=30&includeToday=0', true)
await run('single agent',                      'agent', 'agent=Make My Trip&days=30')
await run('empty result',                      'empty', 'days=0&agent=__no_such_agent__', true)
process.exit(0)
