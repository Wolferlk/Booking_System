import path from 'path'
import { mkdir, writeFile, access } from 'fs/promises'

const PDF_DIR = path.join(process.cwd(), 'public', 'uploads', 'booking-pdfs')

// Known system Chrome/Chromium paths (used when admin installs chromium manually)
const SYSTEM_CHROME_PATHS = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/local/bin/chromium',
  '/snap/bin/chromium',
]

async function findSystemChrome(): Promise<string | undefined> {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  for (const p of SYSTEM_CHROME_PATHS) {
    try { await access(p); return p } catch { /* not found */ }
  }
  return undefined
}

async function launchBrowser() {
  // 1. Explicit system Chrome path (env var or known binary)
  const systemChrome = await findSystemChrome()
  if (systemChrome) {
    const { default: puppeteerCore } = await import('puppeteer-core')
    return puppeteerCore.launch({
      executablePath: systemChrome,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
  }

  // 2. Linux server: use @sparticuz/chromium (self-contained, no system libs needed)
  if (process.platform === 'linux') {
    const { default: chromium } = await import('@sparticuz/chromium')
    const { default: puppeteerCore } = await import('puppeteer-core')
    const executablePath = await chromium.executablePath()
    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: null,
      executablePath,
      headless: true,
    })
  }

  // 3. Local dev (macOS/Windows): use bundled puppeteer Chrome
  const { default: puppeteer } = await import('puppeteer')
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
}

export interface PdfMeta {
  bookingRef: string
  sentAt?: Date
}

export async function htmlToPdf(html: string, filename: string, meta?: PdfMeta): Promise<Buffer> {
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

  const browser = await launchBrowser()

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
