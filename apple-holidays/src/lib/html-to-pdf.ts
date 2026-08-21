import path from 'path'
import { mkdir, writeFile, open, rm, access } from 'fs/promises'
import { constants as fsConstants } from 'fs'

const PDF_DIR = path.join(process.cwd(), 'public', 'uploads', 'booking-pdfs')

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

/** ELF e_machine values, mapped from Node's process.arch names. */
const ELF_MACHINE: Record<string, number> = {
  x64: 0x3e, // EM_X86_64
  arm64: 0xb7, // EM_AARCH64
  ia32: 0x03, // EM_386
}

type ElfCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'not-elf' | 'wrong-arch'; detail: string }

/**
 * Chromium launch failures surface as unreadable shell noise: a non-ELF file gives
 * "ELF : not found" style output, and — worse — a *valid* ELF built for the wrong
 * CPU is rejected by the kernel with ENOEXEC, so the shell tries to interpret the
 * binary as a script and prints the exact same thing. Inspect the header ourselves
 * so the two cases are distinguishable.
 */
async function checkElf(executablePath: string): Promise<ElfCheck> {
  let header: Buffer
  try {
    const handle = await open(executablePath, 'r')
    try {
      header = Buffer.alloc(20)
      await handle.read(header, 0, 20, 0)
    } finally {
      await handle.close()
    }
  } catch (err) {
    return { ok: false, reason: 'missing', detail: (err as Error).message }
  }

  if (!header.subarray(0, 4).equals(ELF_MAGIC)) {
    return { ok: false, reason: 'not-elf', detail: 'file does not start with the ELF magic' }
  }

  // e_machine is a 16-bit field at offset 0x12; endianness is declared at EI_DATA (0x05).
  const littleEndian = header[5] === 1
  const machine = littleEndian ? header.readUInt16LE(0x12) : header.readUInt16BE(0x12)
  const expected = ELF_MACHINE[process.arch]

  if (expected !== undefined && machine !== expected) {
    const names: Record<number, string> = { 0x3e: 'x86-64', 0xb7: 'arm64', 0x03: 'i386' }
    return {
      ok: false,
      reason: 'wrong-arch',
      detail: `binary targets ${names[machine] ?? `e_machine 0x${machine.toString(16)}`} but this host is ${process.arch}`,
    }
  }

  return { ok: true }
}

/**
 * Distro Chromium, in preference order. On Ubuntu 20.04+ `/usr/bin/chromium-browser`
 * is a snap shim — a shell script, not an ELF — so the header check filters it out
 * for us rather than us having to special-case it by path.
 */
const SYSTEM_CHROMIUM_PATHS = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/snap/bin/chromium',
]

async function findSystemChromium(): Promise<string | null> {
  for (const candidate of SYSTEM_CHROMIUM_PATHS) {
    try {
      await access(candidate, fsConstants.X_OK)
    } catch {
      continue
    }
    if ((await checkElf(candidate)).ok) return candidate
  }
  return null
}

/**
 * No Chromium on this host.
 *
 * Thrown where the failure is the *environment* rather than the document: an
 * arm64 server with only the x64 payload, a payload that never shipped, a
 * corrupt extract. Callers that have a second way to produce the file — handing
 * the print-ready HTML to the user's own browser, say — catch this and take it,
 * instead of showing an operator a message about ELF headers.
 */
export class PdfEngineUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfEngineUnavailableError'
  }
}

export async function launchBrowser() {
  // 1. Explicit Chrome path via env var (admin override — takes priority everywhere)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    const { default: puppeteerCore } = await import('puppeteer-core')
    return puppeteerCore.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    })
  }

  if (process.platform === 'linux') {
    const { default: puppeteerCore } = await import('puppeteer-core')

    // 2. A real system Chromium, when the host has one. Preferred on plain VMs, and
    //    the only option on arm64 — the @sparticuz/chromium npm package ships x64
    //    binaries only, which the kernel rejects with ENOEXEC on Graviton hosts.
    const systemChromium = await findSystemChromium()
    if (systemChromium) {
      return puppeteerCore.launch({
        executablePath: systemChromium,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      })
    }

    // 3. Serverless (Lambda/Amplify): @sparticuz/chromium is self-contained and needs
    //    no system packages, but only works on x64.
    const { default: chromium } = await import('@sparticuz/chromium')
    const executablePath = await chromium.executablePath()
    const check = await checkElf(executablePath)

    if (!check.ok) {
      if (check.reason === 'missing') {
        throw new PdfEngineUnavailableError(
          `Chromium binary missing at ${executablePath}. The @sparticuz/chromium payload ` +
            `was not deployed with the server bundle. Original error: ${check.detail}`
        )
      }

      if (check.reason === 'wrong-arch') {
        throw new PdfEngineUnavailableError(
          `Chromium at ${executablePath} cannot run on this host — ${check.detail}. ` +
            `The @sparticuz/chromium npm package bundles x64 binaries only. On arm64 hosts, ` +
            `install a distro Chromium (apt-get install -y chromium) or set ` +
            `PUPPETEER_EXECUTABLE_PATH to an arm64 Chrome build.`
        )
      }

      await rm(executablePath, { force: true }).catch(() => {})
      throw new PdfEngineUnavailableError(
        `Chromium at ${executablePath} is not an ELF executable — ${check.detail}. The extract ` +
          `was corrupt or incomplete (check that @sparticuz/chromium is listed in ` +
          `serverComponentsExternalPackages, and that the runtime has enough free /tmp space). ` +
          `The bad file has been removed; retry to force a clean extract.`
      )
    }

    return puppeteerCore.launch({
      args: chromium.args,
      defaultViewport: null,
      executablePath,
      headless: true,
    })
  }

  // 4. Local dev (macOS/Windows): use puppeteer's bundled Chrome
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

    // Local archive copy only — every caller uses the returned buffer, so a failure
    // here must not fail the send. Serverless runtimes mount everything outside /tmp
    // read-only, which would otherwise throw EROFS after the PDF rendered fine.
    try {
      await mkdir(PDF_DIR, { recursive: true })
      await writeFile(path.join(PDF_DIR, filename), pdfBuffer)
    } catch (err) {
      console.warn(`[html-to-pdf] could not archive ${filename} to disk:`, (err as Error).message)
    }

    return pdfBuffer
  } finally {
    await browser.close()
  }
}

export function bookingPdfPath(ref: string): string {
  return path.join(PDF_DIR, `${ref}-confirmation.pdf`)
}
