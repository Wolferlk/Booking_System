/**
 * Create the hand-editable mirror tab in the live workbook, by hand.
 *
 * Normally the sweep does this. This exists for the gap where the feature is
 * written but not yet deployed, and the team wants the tab in front of them.
 *
 * It is additive and nothing else: one new worksheet with our header on row 1.
 * No existing tab is read past its name, no cell outside the new tab is touched,
 * and if the tab is already there it stops without writing. Reversible by
 * right-clicking the tab in Excel and deleting it.
 *
 *   DB_DATABASE=apple_booking_system npx tsx scripts/qm-create-mirror-tab.mts
 *   …add --commit to actually write; without it this is a dry run.
 */
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())

import { getConfig } from '../src/lib/query-monitor/config'
import {
  QUERY_LAYOUT, closeSession, ensureWorksheet, openSession, resolveSheetRef,
} from '../src/lib/query-monitor/sheet'
import { graphFetch } from '../src/lib/graph-client'

const COMMIT = process.argv.includes('--commit')

async function main() {
  const cfg = await getConfig()
  const tab = cfg.manualSheetName

  console.log(`\nworkbook   resolving…`)
  const ref = await resolveSheetRef(true, 'primary')
  console.log(`workbook   ${ref.fileName}`)
  console.log(`tab        "${tab}"`)
  console.log(`columns    ${QUERY_LAYOUT.header.length} (A–${QUERY_LAYOUT.lastColumn})\n`)

  const sheets = await graphFetch<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
  )
  if (sheets.value.some(w => w.name.toLowerCase() === tab.toLowerCase())) {
    console.log('Already there — nothing to do.\n')
    return
  }

  if (!COMMIT) {
    console.log('DRY RUN. Would add one new worksheet and write its header row.')
    console.log('Re-run with --commit to do it.\n')
    return
  }

  const sessionId = await openSession(ref)
  try {
    const r = await ensureWorksheet(ref, tab, QUERY_LAYOUT, sessionId)
    console.log(`created ${r.created}   header written ${r.headerWritten}   mismatch ${r.headerMismatch}`)
  } finally {
    await closeSession(ref, sessionId)
  }

  const after = await graphFetch<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
  )
  console.log(`\nworksheets now: ${after.value.map(w => `"${w.name}"`).join(', ')}\n`)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
