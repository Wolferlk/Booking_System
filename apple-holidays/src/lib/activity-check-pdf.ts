/**
 * The Activity Check report as a PDF.
 *
 * Printed from the HTML document rather than drawn by hand, for the reasons set
 * out in `activity-check-html.ts`: one design for the screen, the HTML download
 * and the PDF, and real Unicode for Vietnamese activity names.
 *
 * Landscape by default — the report's whole value is the width of its table,
 * and a user who picked twenty columns has said so explicitly.
 */

import { launchBrowser } from '@/lib/html-to-pdf'
import { buildActivityCheckHtml, type HtmlOptions } from '@/lib/activity-check-html'
import type { ActivityCheckQuery, ActivityRow } from '@/lib/activity-check'
import type { ColumnKey } from '@/lib/activity-check-columns'

function footerTemplate(now: Date, label: string): string {
  const stamp = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `
    <div style="width:100%;padding:0 8mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;
                font-size:7px;color:#94a3b8;display:flex;justify-content:space-between;align-items:center;">
      <span>Apple Holidays MMT · Activity Check${label ? ` · ${label}` : ''} · ${stamp}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`
}

export async function buildActivityCheckPdf(
  rows: ActivityRow[],
  q: ActivityCheckQuery,
  columnKeys: ColumnKey[],
  now = new Date(),
  opts: HtmlOptions & { landscape?: boolean } = {},
): Promise<Buffer> {
  const html = buildActivityCheckHtml(rows, q, columnKeys, now, { ...opts, interactive: false })
  const label = q.terms.join(', ').slice(0, 70)

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    const raw = await page.pdf({
      format: 'A4',
      landscape: opts.landscape ?? true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:1px;"> </div>',
      // The masthead is part of the document, so only the footer needs room.
      footerTemplate: footerTemplate(now, label),
      margin: { top: '6mm', right: '0', bottom: '10mm', left: '0' },
    })

    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
