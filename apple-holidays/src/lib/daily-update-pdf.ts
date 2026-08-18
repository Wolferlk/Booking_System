/**
 * The Daily Update sheet as a PDF.
 *
 * Rendered by printing the HTML sheet (`daily-update-html.ts`) through headless
 * Chromium rather than drawing a table by hand. That keeps the screen, the HTML
 * download and the PDF as one design, and it is the only way the sheet renders
 * Vietnamese and Sinhala guest names correctly — PDFKit's built-in fonts are
 * Latin-1, so a hand-drawn table had to transliterate names down to ASCII.
 */

import { launchBrowser } from '@/lib/html-to-pdf'
import { buildDailyUpdateHtml, type HtmlOptions } from '@/lib/daily-update-html'
import type { DailyUpdateQuery, DailyUpdateRow } from '@/lib/daily-update'

/** Page furniture Chromium draws outside the document's own margins. */
function footerTemplate(now: Date): string {
  const stamp = now.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return `
    <div style="width:100%;padding:0 8mm;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;
                font-size:7px;color:#94a3b8;display:flex;justify-content:space-between;align-items:center;">
      <span>Apple Holidays MMT · Daily Update Sheet · ${stamp}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`
}

export async function buildDailyUpdatePdf(
  rows: DailyUpdateRow[],
  q: DailyUpdateQuery,
  now = new Date(),
  opts: HtmlOptions = {},
): Promise<Buffer> {
  // `interactive: false` drops the on-screen Print button from the printed copy.
  const html = buildDailyUpdateHtml(rows, q, now, { ...opts, interactive: false })

  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    const raw = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div style="font-size:1px;"> </div>',
      footerTemplate: footerTemplate(now),
      // The masthead is part of the document, so only the footer needs room.
      margin: { top: '6mm', right: '0', bottom: '10mm', left: '0' },
    })

    return Buffer.from(raw)
  } finally {
    await browser.close()
  }
}
