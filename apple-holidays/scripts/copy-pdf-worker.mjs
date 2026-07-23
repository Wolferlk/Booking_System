// Copies the pdf.js worker into public/ so the print pages can load it as a
// static module worker. Bundling it via `new URL(..., import.meta.url)` breaks
// Terser in this Next build ("import.meta cannot be used outside module code"),
// so we serve it as a plain static asset instead.
//
// Runs on postinstall; safe to run repeatedly.

import { createRequire } from 'module'
import { copyFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

try {
  const src = require.resolve('pdfjs-dist/build/pdf.worker.min.mjs')
  const destDir = join(__dirname, '..', 'public')
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, 'pdf.worker.min.js')
  copyFileSync(src, dest)
  console.log(`[copy-pdf-worker] ${src} -> ${dest}`)
} catch (err) {
  // Don't fail install if pdfjs isn't present yet — the print page degrades to
  // the "document follows" note rather than crashing the build.
  console.warn('[copy-pdf-worker] skipped:', err?.message ?? err)
}
