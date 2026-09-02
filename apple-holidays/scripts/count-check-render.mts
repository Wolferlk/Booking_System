/**
 * Render check for the daily report's count check.
 *
 * Builds the block for a chosen business day and writes it out as a standalone
 * page, so the numbers can be lined up against the accounts system's mail for
 * the same day before either goes to anybody.
 *
 *   npx tsx scripts/count-check-render.mts [yyyy-mm-dd] [outDir]
 *
 * **Read-only.** It SELECTs from the accounts database over the shared
 * read-only client and SELECTs the day's bookings from the OPS database. It
 * writes to neither, and it sends no mail. When the OPS database is not
 * reachable (as it is not from a laptop — Vercel holds that URL) the intake
 * reconciliation degrades to "unavailable" and the rest of the block still
 * renders, which is the behaviour this script is here to prove.
 */
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { collectCountCheck } from '../src/lib/reports/count-check'
import { renderCountCheckBlock } from '../src/lib/reports/report-html'
import { STYLE_BLOCK } from '../src/lib/reports/email-kit'
import { buildReportWindow, DEFAULT_REPORT_TZ } from '../src/lib/reports/report-window'

const arg = process.argv[2]
const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(arg ?? '') ? arg : undefined
const outDir = path.resolve(process.argv[3] ?? '.render-check/count-check')

async function main() {
  const window = buildReportWindow('DAILY', DEFAULT_REPORT_TZ, new Date(), anchorDate)
  console.log(`Window: ${window.label}  (${window.fromDate} → ${window.toDate}, ${window.timezone})`)

  const cc = await collectCountCheck(window)

  if (!cc.available) {
    console.log('unavailable:', cc.error)
  } else {
    console.log('swept at :', cc.sweptAt ?? 'never')
    console.log('headline :', cc.headline)
    for (const t of cc.channels) {
      console.log(`  ${t.label.padEnd(20)} upstream ${String(t.upstream).padStart(4)} · OPS ${String(t.bookings).padStart(4)} · P&L ${String(t.pnls).padStart(4)} · inv ${String(t.invoices).padStart(4)} · short ${t.pnlShort + t.invoiceShort + t.bookingShort}  (${t.status})`)
    }
    console.log('  overall :', `upstream ${cc.overall.upstream} · OPS ${cc.overall.bookings} · P&L ${cc.overall.pnls} · inv ${cc.overall.invoices}`)
    console.log('  intake  :', cc.intake ? JSON.stringify(cc.intake) : 'unavailable (OPS database not reachable)')
    console.log('  activity:', cc.activity ? JSON.stringify(cc.activity) : 'unavailable')
  }

  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `count-check-${window.fromDate}.html`)
  await writeFile(file, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Count check — ${window.fromDate}</title><style>${STYLE_BLOCK}</style></head>
<body style="margin:0;padding:22px 12px;background:#eef2f6;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;margin:0 auto;">
${renderCountCheckBlock(cc)}
</table></body></html>`, 'utf8')

  console.log(`\nWritten: ${file}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1) })
