import path from 'path'
import { mkdir, writeFile } from 'fs/promises'

const PDF_DIR = path.join(process.cwd(), 'public', 'uploads', 'booking-pdfs')

/**
 * Renders an HTML string to a PDF using Puppeteer (headless Chrome).
 * Saves the file to public/uploads/booking-pdfs/{filename}.
 * Returns the PDF as a Buffer (for email attachment).
 */
export async function htmlToPdf(html: string, filename: string): Promise<Buffer> {
  const { default: puppeteer } = await import('puppeteer')

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const raw = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
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
