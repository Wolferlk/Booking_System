/**
 * A document page → a downloaded PDF, made in the browser.
 *
 * The OPS server on Amplify has no headless Chromium, so a server-made PDF
 * fails there ("PDF engine is not available on this server"). This draws the
 * document the way AahaasFlow does (`Docs.jsx` documentToPdf): each A4 sheet
 * to a canvas, one A4 page each; a sheet taller than A4 breaks between blocks
 * or table rows, never through a line of text. The libraries load only when
 * somebody downloads.
 *
 * ⚠️ AN IMAGE OF THE PAGE, NOT TEXT — exactly as it looks on screen.
 * Client-only: import it from components, never from a route.
 */

/** What counts as one A4 sheet — Flow's documents use `.sheet`, the OPS invoice `.page`. */
const SHEET_SELECTOR = '.sheet, .page'
/** Screen-only chrome inside a document (its own Print bar). */
const CHROME_SELECTOR = '.bar, .noprint'

/** Remove a document's own Print bar — it needs script, and the sandbox has none. */
export function stripDocumentChrome(html: string): string {
  return html
    .replace(/<div class="bar noprint">[\s\S]*?<\/div>/, '')
    .replace(/<div class="bar">[\s\S]*?<\/div>/, '')
}

/** Draw the document inside `frame` (same-origin, already loaded) into a PDF and save it. */
export async function frameToPdf(frame: HTMLIFrameElement, filename: string): Promise<void> {
  const page = frame.contentDocument
  if (!page?.body) throw new Error('The document is not ready yet.')
  page.querySelectorAll<HTMLElement>(CHROME_SELECTOR).forEach((el) => { el.style.display = 'none' })
  await waitForImages(page)

  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const sheets = Array.from(page.querySelectorAll<HTMLElement>(SHEET_SELECTOR))
    .filter((el) => !el.parentElement?.closest(SHEET_SELECTOR))
  if (!sheets.length) sheets.push(page.body)

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const W = 210
  const H = 297
  const CONT_TOP = 12 // mm of white above a continued page
  let first = true

  for (const sheet of sheets) {
    // The canvas belongs to the document's own frame, so it draws with the
    // document's fonts — made here, it would measure one font and draw another.
    const box = sheet.getBoundingClientRect()
    const own = page.createElement('canvas')
    own.width = Math.floor(Math.ceil(box.width) * 2)
    own.height = Math.floor(Math.ceil(box.height) * 2)
    // Laid out at the FRAME's size: by default html2canvas clones the page at
    // the outer window's width, so rows re-wrap and no longer match the breaks.
    const canvas = await html2canvas(sheet, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, canvas: own,
      windowWidth: page.documentElement.clientWidth,
      windowHeight: page.documentElement.scrollHeight,
      // The copy html2canvas draws can come up in quirks mode, where tables
      // drop the inherited font size — rows grow and the PDF loses its last ones.
      onclone: (doc: Document) => {
        const style = doc.createElement('style')
        style.textContent = 'table{font-size:inherit;font-weight:inherit;font-style:inherit;font-variant:inherit}'
        doc.head.appendChild(style)
      },
    })
    const k = canvas.width / sheet.offsetWidth // canvas px per CSS px
    const mm = W / sheet.offsetWidth           // mm per CSS px

    // Where a page may end: the bottom of a block or a table row — never just
    // under a heading, which would leave it alone at the foot of a page.
    // Measured after drawing: html2canvas scrolls the frame while it works.
    const top0 = sheet.getBoundingClientRect().top
    const cuts = Array.from(new Set(
      Array.from(sheet.querySelectorAll<HTMLElement>(':scope > *, tr, section, .party, .vx-night'))
        .filter((el) => !/^H[1-6]$/.test(el.tagName))
        .map((el) => Math.round(el.getBoundingClientRect().bottom - top0)),
    )).sort((a, b) => a - b)
    const total = Math.min(sheet.offsetHeight, cuts.length ? cuts[cuts.length - 1] + 4 : sheet.offsetHeight)

    for (let start = 0, n = 0; start < total - 1; n += 1) {
      const offset = n === 0 ? 0 : CONT_TOP
      let end = start + (H - offset - (n === 0 ? 0 : 8)) / mm
      if (end >= total) end = total
      else {
        const fits = cuts.filter((c) => c > start + 40 && c <= end)
        if (fits.length) end = fits[fits.length - 1]
      }
      const slice = document.createElement('canvas')
      slice.width = canvas.width
      slice.height = Math.max(1, Math.round((end - start) * k))
      slice.getContext('2d')!.drawImage(canvas, 0, Math.round(start * k), canvas.width, slice.height, 0, 0, canvas.width, slice.height)
      if (!first) pdf.addPage()
      first = false
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, offset, W, (end - start) * mm)
      start = end
    }
  }
  pdf.save(filename)
}

/**
 * Save a document's HTML as a PDF without showing it: it is laid out in a
 * hidden A4-wide frame (sandboxed — no script runs), drawn, and removed.
 */
export async function htmlToPdfDownload(html: string, filename: string): Promise<void> {
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  // On screen size-wise (so it lays out like A4) but out of sight.
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '840px', height: '1200px', border: '0' })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The document took too long to lay out.')), 20_000)
      frame.onload = () => { clearTimeout(timer); resolve() }
      frame.srcdoc = stripDocumentChrome(html)
      document.body.appendChild(frame)
    })
    await frameToPdf(frame, filename)
  } finally {
    frame.remove()
  }
}

/** Photos are inlined by Flow, but a web font or a remote logo may still be loading. */
async function waitForImages(page: Document): Promise<void> {
  const pending = Array.from(page.images).filter((img) => !img.complete)
  await Promise.race([
    Promise.all(pending.map((img) => new Promise((r) => { img.onload = r; img.onerror = r }))),
    new Promise((r) => setTimeout(r, 6_000)),
  ])
  await Promise.race([(page as Document & { fonts?: FontFaceSet }).fonts?.ready, new Promise((r) => setTimeout(r, 3_000))])
}
