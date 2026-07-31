import PDFDocument from 'pdfkit'
import { readFileSync } from 'fs'
import path from 'path'
import type { FhPdfBooking } from './filehandler-booking-html'

/**
 * Server-side "Booking Update" PDF, rendered with PDFKit — pure Node, no headless
 * browser. This runs reliably on Amplify Lambda where puppeteer/@sparticuz/chromium
 * was 502-ing (cold-start /tmp extract + ~1GB memory). Layout mirrors the portal:
 * status banner, key tiles, contacts & notes, hotels, flights, and a footer with
 * the generation timestamp.
 */

const BRAND = '#0f9d76'
const INK = '#0f172a'
const MUTED = '#94a3b8'
const BORDER = '#e2e8f0'
const PANEL = '#f8fafc'

const FLAG: Record<string, string> = {
  SRILANKA: 'Sri Lanka', VIETNAM: 'Vietnam', SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia', SINGAPORE_MALAYSIA: 'Singapore / Malaysia', ALL: 'All',
}

let LOGO: Buffer | null | undefined
function logo(): Buffer | null {
  if (LOGO !== undefined) return LOGO
  try {
    LOGO = readFileSync(path.join(process.cwd(), 'public', 'png', 'apple-logo.png'))
  } catch {
    LOGO = null
  }
  return LOGO
}

const fmtDate = (s: string | Date): string => {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
const fmtDateTime = (d: Date): string =>
  d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function statusMeta(status: string): { label: string; bg: string; bd: string; fg: string } {
  switch (status) {
    case 'CANCELLED':
      return { label: 'Cancelled', bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' }
    case 'PENDING_CANCELLATION':
      return { label: 'Pending Cancellation Approval', bg: '#fffbeb', bd: '#fde68a', fg: '#b45309' }
    default:
      return {
        label: status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        bg: '#ecfdf5', bd: '#a7f3d0', fg: '#047857',
      }
  }
}

export async function generateFhBookingPdf(b: FhPdfBooking, opts?: { generatedBy?: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const M = 40
  const W = doc.page.width
  const CW = W - M * 2
  const BOTTOM = doc.page.height - M
  let y = M

  const now = new Date()
  const st = statusMeta(b.status)

  // Advance to a new page when the next block wouldn't fit.
  const ensure = (h: number) => { if (y + h > BOTTOM - 24) { doc.addPage(); y = M } }

  // ── Header ────────────────────────────────────────────────────────────────
  const lg = logo()
  let brandX = M
  if (lg) {
    try { doc.image(lg, M, y, { fit: [46, 46] }); brandX = M + 58 } catch { /* bad image → skip */ }
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text('Apple Holidays', brandX, y + 4)
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('OPERATIONS', brandX, y + 26, { characterSpacing: 1.2 })

  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9)
    .text('BOOKING UPDATE', M, y + 4, { width: CW, align: 'right', characterSpacing: 1.5 })
  doc.fillColor(INK).font('Courier-Bold').fontSize(20)
    .text(b.bookingRef, M, y + 18, { width: CW, align: 'right' })

  y += 52
  doc.rect(M, y, CW, 3).fill(BRAND)
  y += 14

  // ── Sub-line: lead passenger + generated stamp ──────────────────────────────
  const lead = b.passengers[0]?.name ?? '—'
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(lead, M, y, { width: CW * 0.55, ellipsis: true, lineBreak: false })
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text(`Generated ${fmtDateTime(now)}${opts?.generatedBy ? ` · by ${opts.generatedBy}` : ''}`,
      M + CW * 0.45, y + 2, { width: CW * 0.55, align: 'right' })
  y += 24

  // ── Status banner ───────────────────────────────────────────────────────────
  const isCancel = b.status === 'PENDING_CANCELLATION' || b.status === 'CANCELLED'
  const reason = isCancel
    ? `Requested by ${b.cancelledByName ?? '—'}${b.cancellationReason ? ` · Reason: ${b.cancellationReason}` : ''}`
    : ''
  const bannerH = reason ? 42 : 30
  ensure(bannerH + 8)
  doc.roundedRect(M, y, CW, bannerH, 8).fillAndStroke(st.bg, st.bd)
  doc.circle(M + 16, y + 15, 4).fill(st.fg)
  doc.fillColor(st.fg).font('Helvetica-Bold').fontSize(11.5).text(st.label, M + 28, y + 8)
  if (reason) doc.font('Helvetica').fontSize(8.5).fillColor(st.fg).text(reason, M + 28, y + 24, { width: CW - 40 })
  y += bannerH + 16

  // ── Key tiles ─────────────────────────────────────────────────────────────
  const TILE_H = 44, GAP = 10, TW = (CW - GAP * 3) / 4
  const tile = (col: number, top: number, label: string, value: string, brand = false) => {
    const x = M + col * (TW + GAP)
    doc.roundedRect(x, top, TW, TILE_H, 8).fillAndStroke(PANEL, BORDER)
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(7).text(label.toUpperCase(), x + 9, top + 9, { width: TW - 18, characterSpacing: 0.5 })
    doc.fillColor(brand ? BRAND : INK).font('Helvetica-Bold').fontSize(11).text(value, x + 9, top + 22, { width: TW - 18, ellipsis: true, lineBreak: false })
  }
  const pax = [
    `${b.paxAdults} adult${b.paxAdults === 1 ? '' : 's'}`,
    b.paxChildren ? `${b.paxChildren} child${b.paxChildren === 1 ? '' : 'ren'}` : '',
    b.paxInfants ? `${b.paxInfants} infant${b.paxInfants === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ')

  ensure(TILE_H * 2 + GAP + 8)
  tile(0, y, 'IS Number', b.isNumber ?? '—')
  tile(1, y, 'CNTL', b.cntlNumber ?? '—')
  tile(2, y, 'Agent', b.agent ?? '—')
  tile(3, y, 'File Handler', b.fileHandler ?? '—', true)
  y += TILE_H + GAP
  tile(0, y, 'Arrival', fmtDate(b.arrivalDate))
  tile(1, y, 'Departure', fmtDate(b.departureDate))
  tile(2, y, 'Passengers', pax || '—')
  tile(3, y, 'Country', FLAG[b.operationCountry ?? ''] ?? '—')
  y += TILE_H + 20

  // ── Section heading ─────────────────────────────────────────────────────────
  const heading = (text: string) => {
    ensure(28)
    doc.rect(M, y, 4, 13).fill(BRAND)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(text.toUpperCase(), M + 10, y + 1, { characterSpacing: 0.5 })
    y += 22
  }

  // ── Contacts & Notes ─────────────────────────────────────────────────────────
  heading('Contacts & Notes')
  const colW = (CW - GAP) / 2
  const contactBox = (x: number, title: string, email: string | null, phone: string | null, wa: string | null) => {
    const rows = [['Email', email], ['Phone', phone], ['WhatsApp', wa]].filter(([, v]) => v) as [string, string][]
    const h = 30 + Math.max(rows.length, 1) * 14
    doc.roundedRect(x, y, colW, h, 8).stroke(BORDER)
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), x + 11, y + 10, { characterSpacing: 0.5 })
    let ry = y + 26
    if (rows.length === 0) {
      doc.fillColor('#cbd5e1').font('Helvetica-Oblique').fontSize(9).text('No contact info recorded.', x + 11, ry)
    } else {
      for (const [k, v] of rows) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(k, x + 11, ry, { width: 58, lineBreak: false })
        doc.fillColor(INK).font('Helvetica').fontSize(9).text(v, x + 62, ry, { width: colW - 74, ellipsis: true, lineBreak: false })
        ry += 14
      }
    }
    return h
  }
  const h1 = contactBox(M, 'Agent', b.agentEmail, b.agentPhone, b.agentWhatsapp)
  const h2 = contactBox(M + colW + GAP, 'Guest / Tourist', b.contactEmail, b.contactPhone, b.contactWhatsapp)
  y += Math.max(h1, h2) + 10

  // Important notes box
  const noteText = b.importantNotes?.trim() || 'No notes recorded.'
  const noteH = 24 + doc.font('Helvetica').fontSize(9).heightOfString(noteText, { width: CW - 24 })
  ensure(noteH + 8)
  doc.roundedRect(M, y, CW, noteH, 8).fillAndStroke('#fffbeb', '#fde68a')
  doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(8).text('IMPORTANT NOTES', M + 12, y + 9, { characterSpacing: 0.5 })
  doc.fillColor(b.importantNotes ? '#78350f' : MUTED).font(b.importantNotes ? 'Helvetica' : 'Helvetica-Oblique').fontSize(9)
    .text(noteText, M + 12, y + 22, { width: CW - 24 })
  y += noteH + 18

  // ── Hotel Details ─────────────────────────────────────────────────────────────
  heading('Hotel Details')
  if (b.accommodations.length === 0) {
    emptyBlock('No hotels recorded.')
  } else {
    for (const hh of b.accommodations) {
      const metaText = [
        `${fmtDate(hh.checkIn)} -> ${fmtDate(hh.checkOut)} · ${hh.nights} night${hh.nights === 1 ? '' : 's'}`,
        hh.roomType ? `Room: ${hh.roomType}` : '',
        hh.mealType ? `Meal: ${hh.mealType}` : '',
      ].filter(Boolean).join('    ')
      const subText = [hh.address, hh.contact].filter(Boolean).join(' · ')
      const metaH = doc.font('Helvetica').fontSize(9).heightOfString(metaText, { width: CW - 24 })
      const subH = subText ? doc.font('Helvetica').fontSize(8).heightOfString(subText, { width: CW - 24 }) + 4 : 0
      const cardH = 30 + metaH + subH
      ensure(cardH + 10)
      doc.roundedRect(M, y, CW, cardH, 8).fillAndStroke('#ffffff', BORDER)
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(hh.hotel, M + 12, y + 10, { width: CW * 0.62, ellipsis: true, lineBreak: false })
      tagRight(hh.city)
      doc.fillColor('#475569').font('Helvetica').fontSize(9).text(metaText, M + 12, y + 28, { width: CW - 24 })
      if (subText) doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(subText, M + 12, y + 28 + metaH + 2, { width: CW - 24 })
      y += cardH + 9
    }
  }
  y += 8

  // ── Flight Details ─────────────────────────────────────────────────────────────
  heading('Flight Details')
  if (b.flights.length === 0) {
    emptyBlock('No flights recorded.')
  } else {
    for (const f of b.flights) {
      const hasNotes = !!f.notes?.trim()
      const cardH = hasNotes ? 78 : 64
      ensure(cardH + 10)
      doc.roundedRect(M, y, CW, cardH, 8).fillAndStroke('#ffffff', BORDER)
      // header: flightNo + airline · date tag right
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(f.flightNo || 'Flight', M + 12, y + 10, { continued: !!f.airline, lineBreak: false })
      if (f.airline) doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`   ${f.airline}`, { lineBreak: false })
      tagRight(fmtDate(f.date))
      // leg
      const legY = y + 30
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(f.fromApt || '—', M + 12, legY, { lineBreak: false })
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(f.depTime || '—', M + 12, legY + 16, { lineBreak: false })
      const toX = M + CW - 90
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(f.toApt || '—', toX, legY, { width: 78, align: 'right', lineBreak: false })
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(f.arrTime || '—', toX, legY + 16, { width: 78, align: 'right', lineBreak: false })
      // dashed connector
      doc.save().dash(3, { space: 2 }).strokeColor(BRAND).lineWidth(1)
        .moveTo(M + 70, legY + 8).lineTo(toX - 14, legY + 8).stroke().undash().restore()
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text('>', (M + 70 + toX - 14) / 2 - 3, legY + 3, { lineBreak: false })
      if (hasNotes) doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(f.notes!, M + 12, y + 60, { width: CW - 24, ellipsis: true, lineBreak: false })
      y += cardH + 9
    }
  }

  // helpers that need doc/y closure
  function emptyBlock(text: string) {
    ensure(38)
    doc.save().dash(2, { space: 2 }).roundedRect(M, y, CW, 30, 8).stroke('#cbd5e1').undash().restore()
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(text, M, y + 10, { width: CW, align: 'center' })
    y += 38
  }
  function tagRight(text: string) {
    const tw = doc.font('Helvetica-Bold').fontSize(9).widthOfString(text) + 16
    const tx = M + CW - tw - 12
    doc.roundedRect(tx, y + 9, tw, 16, 5).fill('#f1f5f9')
    doc.fillColor('#475569').font('Helvetica-Bold').fontSize(9).text(text, tx, y + 13, { width: tw, align: 'center', lineBreak: false })
  }

  // ── Footer on every page ─────────────────────────────────────────────────────
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    const fy = doc.page.height - 30
    doc.strokeColor(BORDER).lineWidth(0.5).moveTo(M, fy - 6).lineTo(W - M, fy - 6).stroke()
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text('Apple Holidays MMT · Booking Update', M, fy, { lineBreak: false })
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(`${b.bookingRef}${b.cntlNumber ? ` · CNTL ${b.cntlNumber}` : ''}  ·  Page ${i + 1} of ${range.count}`,
        M, fy, { width: CW, align: 'right', lineBreak: false })
  }

  doc.end()
  return done
}
