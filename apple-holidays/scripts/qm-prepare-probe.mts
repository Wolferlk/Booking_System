/**
 * Read-only probe of what "Prepare workbook" actually does, up to the point it
 * fails. No cell is written and no worksheet is created — every call here is a
 * GET. Run it when the Prepare button answers 502 and the reason is only in the
 * response body.
 *
 *   DB_DATABASE=apple_booking_system npx tsx scripts/qm-prepare-probe.mts
 */
import nextEnv from '@next/env'

nextEnv.loadEnvConfig(process.cwd())
// `.env` names DB_DATABASE twice; the booking database is named explicitly.
process.env.DB_DATABASE = process.env.QM_TARGET_DB?.trim() || 'apple_booking_system'

import { getConfig } from '../src/lib/query-monitor/config'
import {
  EXCLUDED_LAYOUT, QUERY_LAYOUT, findLastDataRow, headerExtension, needsRealign,
  resolveSheetRef, type SheetLayout,
} from '../src/lib/query-monitor/sheet'
import { getAdoptedHeader } from '../src/lib/query-monitor/header-map'
import { graphFetch } from '../src/lib/graph-client'

const line = (s = '') => console.log(s)

async function main() {
  const cfg = await getConfig()
  line(`DB              ${process.env.DB_DATABASE}`)
  line(`query tab       "${cfg.sheetName}"`)
  line(`other-mail tab  "${cfg.excludedSheetName}"`)
  line(`mirror tab      "${cfg.manualSheetName}" (${cfg.manualMirrorEnabled ? 'on' : 'OFF'})`)
  line(`backup          ${cfg.backupEnabled ? 'on' : 'off'}`)
  line()

  for (const target of ['primary', ...(cfg.backupEnabled ? ['backup'] as const : [])] as const) {
    line(`── ${target} ──────────────────────────────`)
    let ref
    try {
      ref = await resolveSheetRef(true, target)
      line(`resolved        ${ref.fileName}`)
      line(`  driveId       ${ref.driveId}`)
      line(`  itemId        ${ref.itemId}`)
    } catch (err) {
      line(`RESOLVE FAILED  ${err instanceof Error ? err.message : String(err)}`)
      line()
      continue
    }

    try {
      const sheets = await graphFetch<{ value: { name: string }[] }>(
        `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
      )
      line(`worksheets      ${sheets.value.map(w => `"${w.name}"`).join(', ')}`)
      const has = (n: string) => sheets.value.some(w => w.name.toLowerCase() === n.toLowerCase())
      line(`  query tab     ${has(cfg.sheetName) ? 'present' : 'MISSING'}`)
      line(`  other-mail    ${has(cfg.excludedSheetName) ? 'present' : 'MISSING'}`)
      if (target === 'primary') {
        line(`  mirror tab    ${has(cfg.manualSheetName) ? 'present' : 'missing — Prepare would create it'}`)
      }
    } catch (err) {
      line(`WORKSHEETS FAILED  ${err instanceof Error ? err.message : String(err)}`)
    }

    // Exactly what ensureWorksheet decides for each tab, without letting it act
    // on any of it. This is where Prepare's 502 has to be coming from.
    for (const [tab, layout] of [
      [cfg.sheetName,         QUERY_LAYOUT],
      [cfg.excludedSheetName, EXCLUDED_LAYOUT],
      // The mirror carries the query layout — it is the same sheet, differing
      // only in who is allowed to write to it afterwards.
      ...(target === 'primary' && cfg.manualMirrorEnabled
        ? [[cfg.manualSheetName, QUERY_LAYOUT]] as [string, SheetLayout][]
        : []),
    ] as [string, SheetLayout][]) {
      line(`  · "${tab}"`)
      try {
        const adopted = await getAdoptedHeader(ref.itemId, tab)
        line(`      adopted map ${adopted ? 'YES — writes go through a saved mapping' : 'no'}`)

        const addr = `${layout.firstColumn}1:${layout.lastColumn}1`
        const row1 = await graphFetch<{ text?: string[][]; values: unknown[][] }>(
          `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/${encodeURIComponent(tab)}`
          + `/range(address='${encodeURIComponent(addr)}')?$select=text,values`,
        )
        const cells = (row1.text?.[0] ?? []).map(h => String(h ?? '').trim())
        const matches = layout.header.every((e, i) => (cells[i] ?? '').toLowerCase() === e.toLowerCase())
        const lastRow = await findLastDataRow(ref, tab, null, layout)

        line(`      last data row ${lastRow}`)
        line(`      header matches ${matches ? 'yes' : 'NO'}`)
        if (!matches) {
          line(`      realign wanted ${needsRealign(cells) ? 'YES — Prepare would MOVE columns on this live tab' : 'no'}`)
          line(`      extend from    ${headerExtension(cells, layout) ?? 'not an older header of ours'}`)
          line(`      row 1 reads    ${cells.map(c => c || '·').join(' | ')}`)
        }
      } catch (err) {
        line(`      TAB PROBE FAILED  ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    line()
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
