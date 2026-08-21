/**
 * The four settlement sheets, drawn with PDFKit.
 *
 * ---- Why a second renderer ----
 *
 * `sl-settlement-docs-pdf.ts` renders these sheets by printing HTML in Chromium.
 * That is the better-looking renderer and stays the one the editor previews and
 * the desk downloads — but it cannot run everywhere. The Sri Lankan ops host is
 * arm64 and `@sparticuz/chromium` ships x64 binaries only, so on that machine
 * there is no browser to print with at all.
 *
 * WhatsApp delivery cannot fall back to "open the print dialog": nobody is
 * standing at the screen when a document is sent to a driver, and Meta needs
 * actual PDF bytes to upload. So the pack is drawn a second way, with PDFKit,
 * which is pure JavaScript and runs anywhere Node does. Same reasoning as
 * `generate-driver-log-pdf.ts`, which solved this for the advance sheet.
 *
 * ---- Same document, different pen ----
 *
 * Both renderers take the same `SettlementDocPack` and print the same blocks in
 * the same order with the same wording, so a driver handed the WhatsApp PDF and
 * a driver handed the printed sheet are holding the same paperwork. This one is
 * plainer — no colour washes behind the name board — because a settlement form
 * is a form, and the parts that matter are the boxes and the totals.
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { ensurePdfkitDataFiles, loadPdfDocumentCtor } from '@/lib/pdfkit-boot'
import { getUpload } from '@/lib/storage'
import {
  DEFAULT_ACCENT, DEFAULT_LOGO, DOC_SLUG, SUB_LOGOS, docDate, isSafeLogoPath, money,
  orientationOf, tourLineTotal, tourTotal, transportTotals,
  type SettlementDocKind, type SettlementDocPack,
} from '@/lib/sl-settlement-docs'

// ── Geometry ─────────────────────────────────────────────────────────────────

const A4_W = 595.28
const A4_H = 841.89
const MARGIN = 28

/**
 * The page currently being drawn on.
 *
 * PDFKit sizes each page as it is added and every sheet here is laid out from
 * the page's own width, so the orientation saved on the pack is applied by
 * setting these when the page is added rather than by threading a size through
 * every table and rule. Set only in `generateSettlementDocsPdf`, which draws
 * one page to completion before adding the next.
 */
let PAGE_W = A4_W
let PAGE_H = A4_H

const INK   = '#111111'
const MUTED = '#555555'
const RULE  = '#111111'
const SOFT  = '#FAFAFA'
const HEAD  = '#F2F2F2'
const TOTAL = '#F7F7F7'

const COMPANY_SITE = 'appleholidaysds.com'
const COMPANY_LINE = '# 148, Aluthmawatha Road, Colombo 15, Telephone No : 0117423700'

/**
 * PDFKit's standard fonts are WinAnsi-encoded and throw on characters outside
 * it — an em dash pasted from Word, a Sinhala name, a curly quote. The sheets
 * carry typed-in text from two databases, so everything is folded to what the
 * font can actually draw rather than risking the render dying mid-document.
 */
function txt(value: unknown): string {
  return String(value ?? '')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '')
    .trim()
}

// ── Marks ────────────────────────────────────────────────────────────────────

const markCache = new Map<string, Buffer | null>()

/**
 * One logo as bytes.
 *
 * The same whitelist the HTML renderer uses, checked again here because this is
 * where a file is actually opened. PDFKit only understands PNG and JPEG, so an
 * SVG — permitted on the board, since Chromium can draw one — is skipped rather
 * than crashing the render; the sheet falls back to the wordmark.
 */
async function readMark(url: string | null | undefined): Promise<Buffer | null> {
  if (!url) return null
  if (markCache.has(url)) return markCache.get(url) ?? null
  if (!isSafeLogoPath(url) || /\.svg$/i.test(url)) { markCache.set(url, null); return null }

  let buf: Buffer | null = null
  try {
    if (url.startsWith('/api/uploads/')) {
      const stored = await getUpload(url.slice('/api/uploads/'.length))
      buf = stored?.buffer ?? null
    } else {
      buf = await readFile(path.join(process.cwd(), 'public', ...url.slice(1).split('/')))
    }
  } catch {
    buf = null
  }
  markCache.set(url, buf)
  return buf
}

interface Marks {
  house: Buffer | null
  board: Buffer | null
  subs: Buffer[]
}

async function readMarks(pack: SettlementDocPack): Promise<Marks> {
  const [house, board, subs] = await Promise.all([
    readMark('/logo.png'),
    readMark(pack.nameBoard.logoUrl ?? DEFAULT_LOGO),
    Promise.all(SUB_LOGOS.map(readMark)),
  ])
  return { house, board, subs: subs.filter((b): b is Buffer => !!b) }
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

// PDFKit ships no types in this project; the document is driven structurally.
type Doc = any

interface Cell {
  text: string
  /** Share of the row's width. Widths are given per table, not per cell. */
  align?: 'left' | 'right' | 'center'
  bold?: boolean
  fill?: string
  size?: number
}

/**
 * One bordered table row.
 *
 * The forms are grids of ruled boxes — that is what makes them fillable by hand
 * — so every cell is drawn as a rectangle with its text inset, rather than as
 * flowing text with lines under it.
 */
function row(doc: Doc, x: number, y: number, widths: number[], cells: Cell[], h: number): number {
  let cx = x
  cells.forEach((cell, i) => {
    // Never pass PDFKit a width it cannot lay a character out in: given zero or
    // a negative width it retries the line forever and the render never ends,
    // taking the request with it. A column that has been squeezed to nothing is
    // a layout mistake, and it should print narrow rather than hang.
    const w = Math.max(6, widths[i] ?? 0)
    if (cell.fill) doc.rect(cx, y, w, h).fill(cell.fill)
    doc.rect(cx, y, w, h).lineWidth(0.7).strokeColor(RULE).stroke()

    const t = txt(cell.text)
    if (t) {
      doc.fillColor(INK)
        .font(cell.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(cell.size ?? 8)
        .text(t, cx + 4, y + (h - (cell.size ?? 8)) / 2 - 1, {
          width: w - 8,
          align: cell.align ?? 'left',
          lineBreak: false,
          ellipsis: true,
        })
    }
    cx += w
  })
  return y + h
}

/**
 * Column widths that sum to exactly the space available.
 *
 * Hand-written pixel widths drift as soon as one column is retuned, and a set
 * that overshoots leaves the last column negative — which is the one input that
 * makes PDFKit's line breaker loop forever. Weights are scaled instead, so the
 * row fits by construction whatever the page size.
 */
function fit(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  const out = weights.map(w => (w / sum) * total)
  // Give the rounding remainder to the last column so the right edge lands true.
  const drift = total - out.reduce((a, b) => a + b, 0)
  out[out.length - 1] += drift
  return out
}

/** The masthead every settlement form carries. */
function masthead(doc: Doc, marks: Marks, title: string): number {
  const centre = PAGE_W / 2
  let y = MARGIN

  if (marks.house) {
    try {
      doc.image(marks.house, MARGIN, y - 2, { fit: [26, 26] })
    } catch { /* an unreadable mark is not worth failing a settlement sheet for */ }
  }

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(17)
    .text(COMPANY_SITE, MARGIN, y, { width: PAGE_W - MARGIN * 2, align: 'center' })
  y += 20
  doc.fillColor(MUTED).font('Helvetica').fontSize(6.5)
    .text(COMPANY_LINE, MARGIN, y, { width: PAGE_W - MARGIN * 2, align: 'center' })
  y += 14

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5)
    .text(title, MARGIN, y, { width: PAGE_W - MARGIN * 2, align: 'center', characterSpacing: 1 })
  const tw = doc.widthOfString(title, { characterSpacing: 1 })
  y += 13
  doc.moveTo(centre - tw / 2, y).lineTo(centre + tw / 2, y).lineWidth(0.8).strokeColor(INK).stroke()

  return y + 9
}

/** The six-line block that heads each settlement form. */
function headerBlock(doc: Doc, pack: SettlementDocPack, y: number, labels: Record<string, string> = {}): number {
  const h = pack.header
  const W = PAGE_W - MARGIN * 2
  const widths = [110, W - 110]
  const rows: [string, string][] = [
    [labels.tourNo ?? 'Tour No', h.tourNo],
    [labels.arrival ?? 'Arrival Date', docDate(h.arrivalDate)],
    [labels.departure ?? 'Departure Date', docDate(h.departureDate)],
    [labels.pax ?? 'No of Pax', h.pax === null ? '' : String(h.pax)],
    [labels.handler ?? 'Tour Handler', h.tourHandler],
    [labels.driver ?? 'Driver Details', [h.driverName, h.vehiclePlate].filter(Boolean).join(' - ')],
  ]
  let cy = y
  for (const [k, v] of rows) {
    cy = row(doc, MARGIN, cy, widths, [
      { text: k, bold: true, fill: SOFT },
      { text: v },
    ], 16)
  }
  return cy + 8
}

/** The two signature rules every form ends with. */
function signatures(doc: Doc, y: number): void {
  const W = PAGE_W - MARGIN * 2
  const colW = W * 0.42
  const right = MARGIN + W - colW
  doc.dash(1.5, { space: 1.5 }).lineWidth(0.7).strokeColor(INK)
  doc.moveTo(MARGIN, y).lineTo(MARGIN + colW, y).stroke()
  doc.moveTo(right, y).lineTo(right + colW, y).stroke()
  doc.undash()
  doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
    .text('Authorized By Operations Department', MARGIN, y + 4, { width: colW, align: 'center' })
    .text('Guide / Chauffeur', right, y + 4, { width: colW, align: 'center' })
}

/** A typed note, boxed the way the HTML sheet boxes it. */
function noteBlock(doc: Doc, note: string, y: number): number {
  const clean = txt(note)
  if (!clean) return y
  const W = PAGE_W - MARGIN * 2
  const h = doc.font('Helvetica').fontSize(7.5).heightOfString(clean, { width: W - 12 }) + 10
  doc.dash(2, { space: 2 }).rect(MARGIN, y, W, h).lineWidth(0.6).strokeColor('#BBBBBB').stroke().undash()
  doc.fillColor('#333333').font('Helvetica').fontSize(7.5).text(clean, MARGIN + 6, y + 5, { width: W - 12 })
  return y + h + 8
}

// ── Name board ───────────────────────────────────────────────────────────────

/**
 * The arrivals-hall board, landscape.
 *
 * The name is set as large as will fit in two lines, measured rather than
 * guessed: PDFKit can tell us the height of a string at a given size, so the
 * type is stepped down until it fits instead of being estimated from the
 * character count as the CSS sheet has to.
 */
function nameBoardPage(doc: Doc, pack: SettlementDocPack, marks: Marks): void {
  const W = PAGE_W
  const H = PAGE_H
  const nb = pack.nameBoard
  const accent = /^#[0-9a-f]{6}$/i.test(nb.accent) ? nb.accent : DEFAULT_ACCENT
  const inner = W - 100

  // The dressing, kept to what a form printer reproduces cleanly.
  if (nb.theme === 'ribbon') {
    doc.rect(0, 0, W, 52).fill(accent)
    doc.rect(0, H - 16, W, 16).fill(accent)
  } else if (nb.theme === 'frame') {
    doc.rect(26, 26, W - 52, H - 52).lineWidth(2).strokeColor(accent).stroke()
    doc.rect(34, 34, W - 68, H - 68).lineWidth(0.5).strokeColor(accent).stroke()
  } else if (nb.theme !== 'minimal') {
    doc.rect(0, 0, W, 6).fill(accent)
  }

  // Measure the block before drawing it, so the name sits on the optical centre
  // of the sheet rather than wherever the top-down cursor happened to land. A
  // board with a lake of white under the name reads as a mistake at ten metres.
  const name = txt(nb.guestName) || '-'
  const sub = txt(nb.subtitle)
  const footParts = [txt(nb.footnote), nb.showReference ? txt(pack.header.tourNo) : ''].filter(Boolean)
  const logo = marks.board
  const inRibbon = nb.theme === 'ribbon'
  const centred = nb.theme !== 'minimal'
  const left = centred ? 50 : 56

  const logoH = logo && !inRibbon ? 46 + (nb.theme === 'minimal' ? 30 : 24) : 0
  const eyebrowH = nb.theme === 'frame' ? 22 : 0

  let size = 90
  // A share of the sheet rather than a fixed height, so a board turned portrait
  // gives the name the same proportion of the paper it gets in landscape.
  const maxH = Math.round(H * 0.35)
  while (size > 24 && doc.font('Helvetica-Bold').fontSize(size).heightOfString(name, { width: inner }) > maxH) {
    size -= 2
  }
  const nameH = doc.font('Helvetica-Bold').fontSize(size).heightOfString(name, { width: inner })
  const subH  = sub ? doc.font('Helvetica').fontSize(18).heightOfString(sub, { width: inner }) + 12 : 0
  const footH = footParts.length ? 20 : 0
  const blockH = logoH + eyebrowH + nameH + 14 + 3 + 16 + subH + footH

  // Nudged above true centre: the eye reads a centred block as sitting low.
  let y = Math.max(inRibbon ? 74 : 56, (H - blockH) / 2 - 18)

  if (logo && inRibbon) {
    try {
      doc.rect(44, 12, 96, 28).fill('#FFFFFF')
      doc.image(logo, 50, 15, { fit: [84, 22] })
    } catch { /* the band still carries the wordmark */ }
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
      .text(COMPANY_SITE.toUpperCase(), 154, 22, { characterSpacing: 2, lineBreak: false })
  } else if (logo) {
    try {
      doc.image(logo, centred ? (W - 150) / 2 : left, y, { fit: [150, 46], align: 'center' })
      y += logoH
    } catch {
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(15)
        .text(COMPANY_SITE, left, y, { width: inner, align: centred ? 'center' : 'left' })
      y += 34
    }
  } else if (!inRibbon) {
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(15)
      .text(COMPANY_SITE, left, y, { width: inner, align: centred ? 'center' : 'left' })
    y += 34
  }

  if (nb.theme === 'frame') {
    const arrival = docDate(pack.header.arrivalDate)
    doc.fillColor(accent).font('Helvetica-Bold').fontSize(10)
      .text(arrival ? `ARRIVAL - ${arrival}` : 'WELCOME', left, y, {
        width: inner, align: 'center', characterSpacing: 3,
      })
    y += eyebrowH
  }

  doc.fillColor('#0B1020').font('Helvetica-Bold').fontSize(size)
    .text(name, left, y, { width: inner, align: centred ? 'center' : 'left' })
  y += nameH + 14

  const ruleW = 66
  doc.rect(centred ? (W - ruleW) / 2 : left, y, ruleW, 3).fill(accent)
  y += 16

  if (sub) {
    doc.fillColor('#3F4654').font(nb.theme === 'frame' ? 'Helvetica-Oblique' : 'Helvetica').fontSize(18)
      .text(sub, left, y, { width: inner, align: centred ? 'center' : 'left' })
    y += subH
  }

  if (footParts.length) {
    doc.fillColor('#8A8F98').font('Helvetica').fontSize(9)
      .text(footParts.join('    '), left, y, { width: inner, align: centred ? 'center' : 'left' })
  }

  // The house marks along the foot.
  if (nb.showSubLogos && marks.subs.length) {
    const h = 18
    const slot = 92
    const totalW = marks.subs.length * slot
    let mx = centred ? (W - totalW) / 2 : W - totalW - 56
    const my = H - (nb.theme === 'ribbon' ? 52 : 44)
    for (const buf of marks.subs) {
      try {
        doc.image(buf, mx, my, { fit: [slot - 16, h], align: 'center', valign: 'center' })
      } catch { /* skip a mark PDFKit cannot decode */ }
      mx += slot
    }
  }
}

// ── Transport settlement ─────────────────────────────────────────────────────

function transportPage(doc: Doc, pack: SettlementDocPack, marks: Marks): void {
  const t = pack.transport
  const totals = transportTotals(t)
  const W = PAGE_W - MARGIN * 2

  let y = masthead(doc, marks, 'TRANSPORT SETTLEMENT')
  y = headerBlock(doc, pack, y)

  // Vehicle strip.
  const metaW = fit(W, [118, 132, 58, 46, 22, 42, 60, 62])
  y = row(doc, MARGIN, y, metaW, [
    { text: 'Vehicle Type & Per KM Rate', bold: true, fill: SOFT, size: 7 },
    { text: [t.vehicleType, t.perKmRate !== null ? `LKR ${money(t.perKmRate)} / km` : ''].filter(Boolean).join(' - ') },
    { text: 'Max Mileage', bold: true, fill: SOFT, size: 7 },
    { text: t.maxMileage === null ? '' : money(t.maxMileage), align: 'right' },
    { text: 'Km', bold: true, fill: SOFT, size: 7 },
    { text: t.km === null ? '' : money(t.km), align: 'right' },
    { text: 'Package Cost', bold: true, fill: SOFT, size: 7 },
    { text: money(t.packageCost), align: 'right', bold: true },
  ], 17)
  y += 8

  // Itinerary grid, padded out so there is room to write at the counter.
  const gridW = fit(W, [70, 377, 92])
  y = row(doc, MARGIN, y, gridW, [
    { text: 'Date', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Description', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Amount', bold: true, fill: HEAD, align: 'center', size: 7.5 },
  ], 16)

  const lines = t.lines.slice(0, 16)
  for (const l of lines) {
    y = row(doc, MARGIN, y, gridW, [
      { text: docDate(l.date) || l.date },
      { text: l.description.replace(/\n+/g, ' ') },
      { text: money(l.amount), align: 'right' },
    ], 16)
  }
  for (let i = lines.length; i < 16; i++) {
    y = row(doc, MARGIN, y, gridW, [{ text: '' }, { text: '' }, { text: '' }], 16)
  }
  y += 9

  // Totals on the left, bank details on the right.
  const leftW = W * 0.56
  const totalsW = fit(leftW, [142, 80, 80])
  const foot = (label: string, rate: string, value: string, sum = false) => {
    y = row(doc, MARGIN, y, totalsW, [
      { text: label, bold: sum, fill: sum ? SOFT : undefined },
      { text: rate, align: 'right', fill: sum ? SOFT : undefined },
      { text: value, align: 'right', bold: sum, fill: sum ? SOFT : undefined },
    ], 15)
  }
  const totalsTop = y
  foot('Total Mileage x Rs.', t.totals.totalMileageRate === null ? '' : money(t.totals.totalMileageRate), money(t.totals.totalMileageAmount))
  foot('Batta x Rs.', t.totals.battaRate === null ? '' : `${money(t.totals.battaRate)} x ${t.totals.battaCount ?? ''}`, money(t.totals.battaAmount))
  foot('Highway Tickets', '', money(t.totals.highwayTickets))
  foot('Parking Tickets', '', money(t.totals.parkingTickets))
  foot('Total Cost', '', money(totals.totalCost), true)
  foot('Fuel Advance', '', money(t.totals.fuelAdvance))
  foot('Tour Advance', '', money(t.totals.tourAdvance))
  foot('Total Amount', '', money(totals.balance), true)
  const totalsBottom = y

  // Bank block, drawn beside the totals rather than after them.
  const bankX = MARGIN + leftW + 8
  const bankW = [W - leftW - 8]
  let by = totalsTop
  const bank = (label: string, value: string) => {
    by = row(doc, bankX, by, bankW, [{ text: label, bold: true, fill: SOFT, size: 7.5 }], 14)
    by = row(doc, bankX, by, bankW, [{ text: value.replace(/\n+/g, ' ') }], 26)
  }
  bank('Issue the cheque in favour of', t.chequeFavour)
  bank('Bank Details', t.bankDetails)
  bank('ID No', t.idNo)

  y = Math.max(totalsBottom, by) + 8
  y = noteBlock(doc, t.note, y)
  signatures(doc, Math.max(y + 14, PAGE_H - MARGIN - 30))
}

// ── Local visit settlement ───────────────────────────────────────────────────

function localVisitPage(doc: Doc, pack: SettlementDocPack, marks: Marks): void {
  const lv = pack.localVisit
  const W = PAGE_W - MARGIN * 2

  let y = masthead(doc, marks, 'LOCAL VISIT SETTLEMENT')
  y = headerBlock(doc, pack, y, {
    tourNo: 'Tour No', arrival: 'Arrival', departure: 'Departure',
    pax: 'Pax Count', handler: 'Tour Handler', driver: 'Driver / Supplier',
  })

  if (lv.driverRef) {
    y = row(doc, MARGIN, y, [110, W - 110], [
      { text: 'Driver', bold: true, fill: SOFT },
      { text: lv.driverRef },
    ], 16) + 8
  }

  const cols = fit(W, [150, 150, 239])
  y = row(doc, MARGIN, y, cols, [
    { text: 'Stop', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Shop', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Signature / Seal & Date', bold: true, fill: HEAD, align: 'center', size: 7.5 },
  ], 16)

  for (const sec of lv.sections) {
    const shops = sec.shops.length ? sec.shops : [{ id: '', name: '', note: '' }]
    const top = y
    for (const shop of shops) {
      // The stop's name is drawn once, spanning its shops, exactly as the paper
      // form groups them.
      y = row(doc, MARGIN + cols[0], y, [cols[1], cols[2]], [
        { text: shop.name },
        { text: shop.note.replace(/\n+/g, ' ') },
      ], 30)
    }
    doc.rect(MARGIN, top, cols[0], y - top).lineWidth(0.7).strokeColor(RULE).stroke()
    doc.rect(MARGIN + 0.4, top + 0.4, cols[0] - 0.8, y - top - 0.8).fill(SOFT)
    doc.rect(MARGIN, top, cols[0], y - top).lineWidth(0.7).strokeColor(RULE).stroke()
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8)
      .text(txt(sec.title), MARGIN + 5, top + 6, { width: cols[0] - 10 })
  }

  y = noteBlock(doc, lv.note, y + 8)
  signatures(doc, Math.max(y + 14, PAGE_H - MARGIN - 30))
}

// ── Tour settlement ──────────────────────────────────────────────────────────

function tourPage(doc: Doc, pack: SettlementDocPack, marks: Marks): void {
  const to = pack.tour
  const W = PAGE_W - MARGIN * 2

  let y = masthead(doc, marks, 'TOUR SETTLEMENT')

  const hdr: [string, string][] = [
    ['Tour No', pack.header.tourNo],
    ['Guide Name', to.guideName],
    ['Chauffeur Name', to.chauffeurName],
    ['Tour Handler', pack.header.tourHandler],
  ]
  for (const [k, v] of hdr) {
    y = row(doc, MARGIN, y, [110, W - 110], [{ text: k, bold: true, fill: SOFT }, { text: v }], 16)
  }
  y += 8

  const cols = fit(W, [269, 110, 60, 100])
  y = row(doc, MARGIN, y, cols, [
    { text: 'Entrance Tickets', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Per Person Rate', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Count', bold: true, fill: HEAD, align: 'center', size: 7.5 },
    { text: 'Total Cost', bold: true, fill: HEAD, align: 'center', size: 7.5 },
  ], 16)

  const lines = to.lines.slice(0, 18)
  for (const l of lines) {
    y = row(doc, MARGIN, y, cols, [
      { text: l.name },
      { text: money(l.perPersonRate), align: 'right' },
      { text: l.count === null ? '' : String(l.count), align: 'center' },
      { text: money(tourLineTotal(l)), align: 'right' },
    ], 16)
  }
  for (let i = lines.length; i < 18; i++) {
    y = row(doc, MARGIN, y, cols, [{ text: '' }, { text: '' }, { text: '' }, { text: '' }], 16)
  }

  y = row(doc, MARGIN, y, [cols[0] + cols[1] + cols[2], cols[3]], [
    { text: 'Total Tour Cost', bold: true, fill: TOTAL, align: 'right' },
    { text: money(tourTotal(to)), bold: true, fill: TOTAL, align: 'right' },
  ], 18)

  y = noteBlock(doc, to.note, y + 8)
  signatures(doc, Math.max(y + 14, PAGE_H - MARGIN - 30))
}

// ── The document ─────────────────────────────────────────────────────────────

/** "IS48776-settlement-documents.pdf" — the name the driver sees in WhatsApp. */
export function settlementDocsFilename(pack: SettlementDocPack, kinds: SettlementDocKind[]): string {
  const stem = (pack.header.tourNo || pack.bookingRef).replace(/[^A-Za-z0-9_-]+/g, '-')
  const tail = kinds.length === 1 ? DOC_SLUG[kinds[0]] : 'settlement-documents'
  return `${stem}-${tail}.pdf`
}

/**
 * The pack as a PDF, without a browser.
 *
 * The name board is a landscape page and the three forms are portrait pages by
 * default, and any of them can be saved turned round — all in one file, since
 * PDFKit sizes each page as it is added. `PAGE_W`/`PAGE_H` are set alongside
 * the page so the sheet is drawn to the paper it is on.
 */
export async function generateSettlementDocsPdf(
  pack: SettlementDocPack,
  kinds: SettlementDocKind[],
): Promise<{ buffer: Buffer; filename: string }> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()
  const marks = await readMarks(pack)

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new (PDFDocument as any)({ size: 'A4', margin: MARGIN, autoFirstPage: false })
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.info.Title = `Settlement documents - ${pack.header.tourNo || pack.bookingRef}`

    for (const kind of kinds) {
      const layout = orientationOf(pack, kind)
      const landscape = layout === 'landscape'
      PAGE_W = landscape ? A4_H : A4_W
      PAGE_H = landscape ? A4_W : A4_H

      if (kind === 'name_board') {
        doc.addPage({ size: 'A4', layout, margin: 0 })
        nameBoardPage(doc, pack, marks)
        continue
      }
      doc.addPage({ size: 'A4', layout, margin: MARGIN })
      if (kind === 'transport')   transportPage(doc, pack, marks)
      if (kind === 'local_visit') localVisitPage(doc, pack, marks)
      if (kind === 'tour')        tourPage(doc, pack, marks)
    }

    doc.end()
  })

  return { buffer, filename: settlementDocsFilename(pack, kinds) }
}

/**
 * A one-page sample, for Meta's template review.
 *
 * A DOCUMENT-header template cannot be submitted without an example attachment.
 * It is deliberately not a real booking's paperwork: the sample is stored on
 * Meta's side and reviewed by people outside the company.
 */
export async function sampleSettlementDocsPdf(): Promise<Buffer> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new (PDFDocument as any)({ size: 'A4', margin: MARGIN })
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18)
      .text('Tour Documents - sample', MARGIN, 90, { width: A4_W - MARGIN * 2, align: 'center' })
    doc.fillColor(MUTED).font('Helvetica').fontSize(11)
      .text(
        'Sample document. The live attachment carries the name board for the arrivals hall and the ' +
        'transport, local visit and tour settlement sheets for one booking.',
        MARGIN, 128, { width: A4_W - MARGIN * 2, align: 'center' },
      )
    doc.end()
  })
}
