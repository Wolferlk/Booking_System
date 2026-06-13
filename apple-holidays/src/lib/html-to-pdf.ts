import path from 'path'
import { mkdir, writeFile } from 'fs/promises'

const PDF_DIR = path.join(process.cwd(), 'public', 'uploads', 'booking-pdfs')

export interface PdfMeta {
  bookingRef: string
  sentAt?: Date
}

/**
 * Renders an HTML string to a PDF using Puppeteer (headless Chrome).
 * Adds a running page header on every page (Apple Holidays, booking ref, sent date, page numbers).
 * Saves to public/uploads/booking-pdfs/{filename} and returns the Buffer.
 */
export async function htmlToPdf(html: string, filename: string, meta?: PdfMeta): Promise<Buffer> {
  const { default: puppeteer } = await import('puppeteer')

  const sentStr = (meta?.sentAt ?? new Date()).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const headerTemplate = `
    <div style="
      width:100%; padding:6px 42px; box-sizing:border-box;
      display:flex; justify-content:space-between; align-items:center;
      border-bottom:1px solid #e2e8f0;
      font-family:Arial,Helvetica,sans-serif;
    ">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:10px;font-weight:800;color:#1e293b;">Apple Holidays</span>
        <span style="font-size:9px;color:#94a3b8;">· MMT Vietnam</span>
      </div>
      ${meta?.bookingRef ? `<span style="font-size:11px;font-weight:700;font-family:monospace;color:#d97706;">${meta.bookingRef}</span>` : ''}
      <div style="text-align:right;">
        <div style="font-size:8px;color:#94a3b8;">Sent: ${sentStr}</div>
        <div style="font-size:8px;color:#cbd5e1;">
          Page <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>
      </div>
    </div>`

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })

    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate: '<div style="font-size:1px;"> </div>',
      margin: { top: '52px', right: '0', bottom: '20px', left: '0' },
    })

    const pdfBuffer = Buffer.from(raw)

    await mkdir(PDF_DIR, { recursive: true })
    await writeFile(path.join(PDF_DIR, filename), pdfBuffer)

    return pdfBuffer
  } finally {
    await browser.close()
  }
}

export function bookingPdfPath(ref: string): string {
  return path.join(PDF_DIR, `${ref}-confirmation.pdf`)
}
