/**
 * The Daily Update sheet as a landscape PDF.
 *
 * Split out of the route so the rendering can be exercised without a session.
 * The layout is fixed-width by design: column x-positions are derived once
 * from COLS, so the header band, the body cells and the rules cannot drift
 * apart as columns are tuned.
 */

import { ensurePdfkitDataFiles, loadLogo, loadPdfDocumentCtor } from '@/lib/pdfkit-boot'
import {
  DATE_FIELD_LABELS, summarise, resolveRange, pinsToday,
  type DailyUpdateQuery, type DailyUpdateRow,
} from '@/lib/daily-update'

/**
 * PDFKit ships with the standard 14 PostScript fonts only, which are Latin-1.
 * Guest names routinely carry Vietnamese and Sinhala diacritics, and an
 * unmapped glyph renders as a black box — so transliterate down to ASCII
 * rather than emitting something unreadable.
 */
function ascii(value: unknown): string {
  return String(value ?? '')
    // D-with-stroke has no decomposition, so NFKD leaves it to be stripped —
    // "Dang" is a name, "ang" is not.
    .replace(/Đ/g, 'D').replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
}

const dash = (v: unknown) => ascii(v) || '-'

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      })
    : '-'

/**
 * "19 Aug 26" — the narrow form the table cells use.
 *
 * en-GB's short month renders September as "Sept", so a full
 * "01 Sept 2026 -> 08 Sept 2026" overflows its cell and wraps down onto the
 * line below it. Two-digit years and a clipped month keep every travel window
 * on one line at any date in the year.
 */
const fmtShort = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  const month = d.toLocaleDateString('en-GB', { month: 'short' }).slice(0, 3)
  return `${String(d.getDate()).padStart(2, '0')} ${month} ${String(d.getFullYear()).slice(2)}`
}

/** "18 Aug 26 08:04" — the audit column's form. */
const fmtShortTime = (iso: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${fmtShort(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function whenLabel(days: number): string {
  if (days === 0) return 'TODAY'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days}d`
  if (days === -1) return 'landed 1d ago'
  return `landed ${Math.abs(days)}d ago`
}

/** Urgency colouring — the whole point of the sheet is that today shouts. */
function whenTone(days: number): string {
  if (days < 0) return '#0891b2'   // on the ground
  if (days === 0) return '#dc2626' // arriving today
  if (days <= 2) return '#ea580c'
  if (days <= 5) return '#ca8a04'
  return '#475569'
}

function contactLine(phone: string | null, whatsapp: string | null, email: string | null): string[] {
  const lines: string[] = []
  const p = ascii(phone)
  const w = ascii(whatsapp)
  const e = ascii(email)
  if (p) lines.push(p)
  if (w && w !== p) lines.push(`WA ${w}`)
  if (e) lines.push(e)
  return lines.length ? lines : ['-']
}

// Landscape A4, laid out once so header, body and dividers cannot drift apart.
const PAGE_W = 841.89
const MARGIN = 28
const TABLE_W = PAGE_W - MARGIN * 2   // 785.89

const COLS = [
  { key: 'idx',       label: '#',              w: 18 },
  { key: 'ref',       label: 'BOOKING REF',    w: 72 },
  { key: 'is',        label: 'IS NUMBER',      w: 56 },
  { key: 'cntl',      label: 'CNTL NUMBER',    w: 58 },
  { key: 'travel',    label: 'TRAVEL DATES',   w: 92 },
  { key: 'when',      label: 'WHEN',           w: 54 },
  { key: 'guest',     label: 'GUEST NAME',     w: 104 },
  { key: 'guestC',    label: 'GUEST CONTACT',  w: 92 },
  { key: 'agent',     label: 'AGENT',          w: 88 },
  { key: 'agentC',    label: 'AGENT CONTACT',  w: 88 },
  { key: 'audit',     label: 'CREATED / UPD.', w: 63 },
] as const

const COL_X: number[] = (() => {
  const xs: number[] = []
  let x = MARGIN
  for (const c of COLS) { xs.push(x); x += c.w }
  return xs
})()

const PAGE_BOTTOM = 560

export async function buildDailyUpdatePdf(
  rows: DailyUpdateRow[],
  q: DailyUpdateQuery,
  now = new Date(),
): Promise<Buffer> {
  const stats = summarise(rows)
  const { start, end } = resolveRange(q, now)

  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()
  const logoBuffer = await loadLogo()

  const chunks: Buffer[] = []
  const doc = new (PDFDocument as never as new (o: unknown) => never)({
    size: 'A4', layout: 'landscape', margin: MARGIN, bufferPages: true,
  }) as never as PDFKitDoc
  doc.on('data', (c: Buffer) => chunks.push(c))

  // The masthead repeats on every page, and `doc.image(buffer, …)` re-embeds
  // the bytes each time it is called — with a ~1 MB logo that turned a 30-page
  // sheet into a 26 MB download. `openImage` embeds the object once and every
  // page then references it.
  const logo = logoBuffer
    ? (() => { try { return doc.openImage(logoBuffer) } catch { return null } })()
    : null

  let y = 0

  /** The masthead + KPI strip. Repeated on every page so a loose sheet stands alone. */
  const drawHeader = () => {
    // Brand band.
    doc.rect(0, 0, PAGE_W, 62).fill('#0f172a')
    doc.rect(0, 62, PAGE_W, 3).fill('#f59e0b')

    if (logo) {
      try { doc.image(logo, MARGIN, 12, { fit: [38, 38] }) } catch { /* logo is optional */ }
    }
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
      .text('DAILY UPDATE SHEET', MARGIN + (logo ? 48 : 0), 15)
    doc.font('Helvetica').fontSize(8).fillColor('#cbd5e1')
      .text(
        `${DATE_FIELD_LABELS[q.dateField]} · ${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}`
        + (pinsToday(q) ? ' · plus everything created today' : ''),
        MARGIN + (logo ? 48 : 0), 36,
        { width: 380 },
      )

    // KPI strip, right-aligned against the band.
    const kpis: [string, string | number, string][] = [
      ['BOOKINGS',      stats.total,         '#ffffff'],
      ['NEW TODAY',     stats.createdToday,  '#4ade80'],
      ['ARRIVING TODAY',stats.arrivingToday, '#f87171'],
      ['PAX',           stats.totalPax,      '#ffffff'],
      ['MISSING IDs',   stats.missingIds,    stats.missingIds > 0 ? '#fbbf24' : '#94a3b8'],
    ]
    let kx = PAGE_W - MARGIN - kpis.length * 92
    for (const [label, value, colour] of kpis) {
      doc.font('Helvetica-Bold').fontSize(15).fillColor(colour)
        .text(String(value), kx, 14, { width: 88, align: 'right' })
      doc.font('Helvetica').fontSize(6.5).fillColor('#94a3b8')
        .text(label, kx, 34, { width: 88, align: 'right', characterSpacing: 0.6 })
      kx += 92
    }

    doc.font('Helvetica').fontSize(6.5).fillColor('#64748b')
      .text(
        `Generated ${fmtDateTime(now.toISOString())} · Agent: ${dash(q.agent) === '-' ? 'All' : ascii(q.agent)}`
        + ` · Country: ${q.country || 'as permitted'} · Cancelled ${q.includeCancelled ? 'included' : 'excluded'}`,
        MARGIN, 72, { width: TABLE_W },
      )

    y = 86
    drawColumnHeader()
  }

  const drawColumnHeader = () => {
    doc.rect(MARGIN, y, TABLE_W, 17).fill('#e2e8f0')
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#334155')
    COLS.forEach((c, i) => {
      doc.text(c.label, COL_X[i] + 4, y + 5.5, { width: c.w - 8, lineBreak: false, characterSpacing: 0.4 })
    })
    y += 17
  }

  /** A coloured section rule — "CREATED TODAY", then the travel window. */
  const drawSection = (title: string, colour: string) => {
    if (y + 40 > PAGE_BOTTOM) { doc.addPage(); drawHeader() }
    y += 6
    doc.rect(MARGIN, y, TABLE_W, 15).fill(colour)
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff')
      .text(title.toUpperCase(), MARGIN + 6, y + 4.5, { characterSpacing: 0.8, lineBreak: false })
    y += 15
  }

  const ROW_H = 30

  const drawRow = (r: DailyUpdateRow, index: number) => {
    if (y + ROW_H > PAGE_BOTTOM) { doc.addPage(); drawHeader() }

    // Zebra banding, with today's intake and cancellations tinted instead.
    const bg = r.cancelled ? '#fef2f2' : r.createdToday ? '#f0fdf4' : index % 2 === 0 ? '#ffffff' : '#f8fafc'
    doc.rect(MARGIN, y, TABLE_W, ROW_H).fill(bg)

    // Left accent bar — urgency at a glance, before any text is read.
    doc.rect(MARGIN, y, 2.5, ROW_H).fill(r.cancelled ? '#dc2626' : whenTone(r.daysToArrival))

    // Three baselines. Everything is drawn with lineBreak: false against an
    // explicit width, so a long value clips at its column edge rather than
    // wrapping down over the line beneath it.
    const l1 = y + 4
    const l2 = y + 14
    const l3 = y + 22

    /**
     * One clipped line of text in a column.
     *
     * `lineBreak: false` is not reliably honoured here — long guest names were
     * still wrapping and landing on top of the line below — so the string is
     * measured against the column and truncated before it is ever drawn. That
     * makes overflow impossible rather than merely discouraged.
     */
    const cell = (col: number, text: string, baseline: number, opts: {
      font?: string; size?: number; colour?: string
    } = {}) => {
      const avail = COLS[col].w - 8
      doc.font(opts.font ?? 'Helvetica').fontSize(opts.size ?? 6).fillColor(opts.colour ?? '#334155')

      let out = text
      if (doc.widthOfString(out) > avail) {
        while (out.length > 1 && doc.widthOfString(`${out}..`) > avail) out = out.slice(0, -1)
        out = `${out.trimEnd()}..`
      }
      doc.text(out, COL_X[col] + 4, baseline, { width: avail, lineBreak: false })
    }

    cell(0, String(index + 1), l1 + 3, { size: 6.5, colour: '#94a3b8' })

    // Booking ref, then the badge that says why this row is on the sheet.
    cell(1, dash(r.bookingRef), l1, {
      font: 'Helvetica-Bold', size: 7.5, colour: r.cancelled ? '#991b1b' : '#0f172a',
    })
    const badge = r.cancelled ? 'CANCELLED' : r.createdToday ? 'NEW TODAY' : r.amended ? 'AMENDED' : ''
    if (badge) {
      cell(1, badge, l2, {
        font: 'Helvetica-Bold', size: 5.5,
        colour: r.cancelled ? '#dc2626' : r.createdToday ? '#16a34a' : '#7c3aed',
      })
    }
    cell(1, ascii(r.status).replace(/_/g, ' '), l3, { size: 5.5, colour: '#94a3b8' })

    // A blank IS or CNTL is the sheet's main action item, so it is called out
    // in amber rather than left as an empty cell somebody skims past.
    const idCell = (value: string | null, col: number) => {
      if (value) cell(col, ascii(value), l1 + 3, { font: 'Helvetica-Bold', size: 7, colour: '#1e293b' })
      else       cell(col, 'missing',    l1 + 3, { font: 'Helvetica-Oblique', size: 6.5, colour: '#d97706' })
    }
    idCell(r.isNumber, 2)
    idCell(r.cntlNumber, 3)
    if (r.agentBookingId) cell(3, ascii(r.agentBookingId), l3, { size: 5, colour: '#cbd5e1' })

    // Travel window.
    cell(4, `${fmtShort(r.arrivalDate)}  ->  ${fmtShort(r.departureDate)}`, l1, {
      font: 'Helvetica-Bold', size: 7, colour: '#0f172a',
    })
    cell(4, `${r.nights}N  ·  ${r.totalPax} pax`, l2, { size: 5.5, colour: '#64748b' })
    cell(4, `${r.paxAdults}A / ${r.paxChildren}C / ${r.paxInfants}I`, l3, { size: 5.5, colour: '#94a3b8' })

    cell(5, whenLabel(r.daysToArrival), l1 + 3, {
      font: 'Helvetica-Bold', size: 6.5, colour: whenTone(r.daysToArrival),
    })
    if (r.hotelOnly) cell(5, 'Hotel only', l3, { size: 5.5, colour: '#0284c7' })

    // Guest.
    cell(6, dash(r.guestName), l1, { font: 'Helvetica-Bold', size: 7, colour: '#0f172a' })
    cell(6, dash(r.operationCountry).replace('_', ' & '), l2, { size: 5.5, colour: '#64748b' })
    cell(6, `Handler: ${dash(r.fileHandler)}`, l3, { size: 5.5, colour: '#94a3b8' })

    contactLine(r.guestPhone, r.guestWhatsapp, r.guestEmail)
      .slice(0, 3)
      .forEach((line, i) => cell(7, line, [l1, l2, l3][i], { size: 5.5 }))

    // Agent.
    cell(8, dash(r.agent), l1, { font: 'Helvetica-Bold', size: 7, colour: '#0f172a' })

    contactLine(r.agentPhone, r.agentWhatsapp, r.agentEmail)
      .slice(0, 3)
      .forEach((line, i) => cell(9, line, [l1, l2, l3][i], { size: 5.5 }))

    // Audit trail — created, then last updated.
    cell(10, 'CREATED', y + 3, { font: 'Helvetica-Bold', size: 4.5, colour: '#cbd5e1' })
    cell(10, fmtShortTime(r.createdAt), y + 9, { size: 5.5, colour: '#64748b' })
    cell(10, 'UPDATED', y + 17, { font: 'Helvetica-Bold', size: 4.5, colour: '#cbd5e1' })
    cell(10, fmtShortTime(r.updatedAt), y + 23, { size: 5.5, colour: r.amended ? '#7c3aed' : '#94a3b8' })

    y += ROW_H
    doc.moveTo(MARGIN, y).lineTo(MARGIN + TABLE_W, y).lineWidth(0.4).strokeColor('#e2e8f0').stroke()
  }

  drawHeader()

  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#64748b')
      .text('No bookings match the current filters.', MARGIN, y + 24, { width: TABLE_W, align: 'center' })
  } else {
    const todays = rows.filter(r => r.createdToday)
    const rest   = rows.filter(r => !r.createdToday)

    if (pinsToday(q) && todays.length > 0) {
      drawSection(`Booked today — ${todays.length} new file${todays.length === 1 ? '' : 's'}`, '#16a34a')
      todays.forEach(drawRow)
    }
    if (rest.length > 0) {
      if (pinsToday(q) && todays.length > 0) {
        drawSection(`${DATE_FIELD_LABELS[q.dateField]} — ${fmtDate(start.toISOString())} to ${fmtDate(end.toISOString())}`, '#0f172a')
      }
      rest.forEach(drawRow)
    }
  }

  // Footer on every buffered page — page numbers only exist once all pages do.
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    doc.rect(0, 570, PAGE_W, 25).fill('#f1f5f9')
    doc.font('Helvetica').fontSize(6.5).fillColor('#64748b')
      .text('Apple Holidays MMT — internal operations sheet. Contains guest contact data; do not forward outside the company.', MARGIN, 578, { width: 520, lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#334155')
      .text(`Page ${i - range.start + 1} of ${range.count}`, PAGE_W - MARGIN - 120, 578, { width: 120, align: 'right', lineBreak: false })
  }

  const done = new Promise<void>((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject) })
  doc.end()
  await done

  return Buffer.concat(chunks)
}

/** The slice of PDFKit's document surface this builder uses. */
type PDFKitDoc = {
  on(event: string, cb: (arg: never) => void): void
  rect(x: number, y: number, w: number, h: number): { fill(colour: string): void }
  image(src: unknown, x: number, y: number, opts: unknown): void
  openImage(src: Buffer): unknown
  fillColor(c: string): PDFKitDoc
  font(f: string): PDFKitDoc
  fontSize(s: number): PDFKitDoc
  text(t: string, x?: number, y?: number, opts?: unknown): PDFKitDoc
  widthOfString(t: string): number
  moveTo(x: number, y: number): PDFKitDoc
  lineTo(x: number, y: number): PDFKitDoc
  lineWidth(w: number): PDFKitDoc
  strokeColor(c: string): PDFKitDoc
  stroke(): PDFKitDoc
  addPage(): void
  bufferedPageRange(): { start: number; count: number }
  switchToPage(n: number): void
  end(): void
}
