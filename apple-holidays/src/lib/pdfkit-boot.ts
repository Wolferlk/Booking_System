import { mkdir, copyFile, readdir, readFile } from 'fs/promises'
import path from 'path'

/**
 * PDFKit resolves its bundled .afm metric files relative to the emitted chunk, which
 * Next's bundler moves. Copy them next to the vendor chunk once per process so the
 * standard Helvetica fonts resolve at runtime.
 */
let pdfkitDataReady: Promise<void> | null = null

export async function ensurePdfkitDataFiles(): Promise<void> {
  if (pdfkitDataReady) return pdfkitDataReady
  pdfkitDataReady = (async () => {
    const sourceDir = path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'data')
    const targetDir = path.join(process.cwd(), '.next', 'server', 'vendor-chunks', 'data')
    await mkdir(targetDir, { recursive: true })
    const files = await readdir(sourceDir)
    await Promise.all(
      files
        .filter(file => file.toLowerCase().endsWith('.afm'))
        .map(file => copyFile(path.join(sourceDir, file), path.join(targetDir, file)).catch(() => {})),
    )
  })()
  return pdfkitDataReady
}

export async function loadPdfDocumentCtor() {
  const mod = await import('pdfkit')
  return (mod as typeof mod & { default?: unknown }).default ?? mod
}

export async function loadLogo(): Promise<Buffer | null> {
  for (const name of ['apple-logo.png', 'aahaslogo.png', 'chat-logo.png']) {
    try {
      return await readFile(path.join(process.cwd(), 'public', 'png', name))
    } catch { continue }
  }
  return null
}
