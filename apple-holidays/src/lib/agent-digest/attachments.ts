/**
 * The PDF, Excel and Word copies of a digest. All three are written from one
 * model, built with the same field switches as the email, so they cannot
 * disagree with each other or show a field the design turned off.
 *
 * A ticket pack's copies list the tickets and their status. The ticket files
 * themselves stay behind the link: Graph refuses a mail over about 4 MB.
 */
import {
  AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import { newWorkbook, workbookBuffer } from '@/lib/excel-kit'
import { safe as pdfText } from '@/lib/generate-booking-pdf'
import { ensurePdfkitDataFiles, loadPdfDocumentCtor } from '@/lib/pdfkit-boot'
import { brandGuard, guardDocx, guardPdfText } from '@/lib/customer-branding-server'
import {
  allocationPending, DIGEST_COUNTRY_META, fmtDay, fmtShort, packArrivalText, packIds, packVisible, partyText, paxText,
  ticketFacts, withFreshPending,
  type DigestBooking, type DigestConfig, type DigestFields, type DigestItem, type DigestPayload,
} from './shared'
import { TICKET_STATE_META } from './tickets-config'

export interface DigestFile { name: string; contentType: string; buffer: Buffer }

const MIME = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

// ── The model ────────────────────────────────────────────────────────────────

interface DocLine { title: string; details: string[]; flagged: boolean }
interface DocBooking { title: string; subtitle: string; meta: string[]; lines: DocLine[] }
interface DocSection { title: string; bookings: DocBooking[] }

export interface DocModel {
  fileBase: string
  heading: string
  agent: string
  dateLine: string
  stats: { label: string; value: number }[]
  sections: DocSection[]
  /** The same content as one flat table, for Excel. */
  columns: { label: string; width: number }[]
  rows: string[][]
}

type Column<T> = { label: string; width: number; on: boolean; value: (row: T) => string }

function flatten<T>(cols: Column<T>[], rows: T[]) {
  const live = cols.filter(c => c.on)
  return { columns: live.map(({ label, width }) => ({ label, width })), rows: rows.map(r => live.map(c => c.value(r))) }
}

function bookingIds(b: DigestBooking, f: DigestFields): string {
  return packIds(b, f)
}

const countryLabel = (b: DigestBooking) => (b.country ? DIGEST_COUNTRY_META[b.country].label : '')

function dailyLine(it: DigestItem, f: DigestFields, flagged: boolean): DocLine {
  const route = f.route ? it.route : ''
  const title = [f.time ? it.time : null, route, f.serviceType && it.service ? `(${it.service})` : null, it.isLeisure ? '- leisure' : null].filter(Boolean).join(' ')
  const driver = f.driver ? partyText(it.driver, f.driverPhone) : ''
  const vehicle = f.vehicle ? it.vehicle ?? '' : ''
  const details = [
    driver || vehicle ? `Driver: ${[driver, vehicle].filter(Boolean).join(' · ')}` : '',
    flagged ? 'Driver pending' : '',
    f.driverVendor && partyText(it.driverVendor, f.driverPhone) ? `Driver vendor: ${partyText(it.driverVendor, f.driverPhone)}` : '',
    f.guide && partyText(it.guide, f.guidePhone) ? `Guide: ${partyText(it.guide, f.guidePhone)}` : '',
    f.tourVendor && partyText(it.tourVendor, f.tourVendorPhone) ? `Tour vendor: ${partyText(it.tourVendor, f.tourVendorPhone)}` : '',
    f.movementNote && it.note ? `Note: ${it.note}` : '',
  ].filter(Boolean)
  return { title: title || 'Agenda line', details, flagged }
}

function dailyModel(raw: DigestPayload, c: DigestConfig): Omit<DocModel, 'fileBase' | 'agent'> {
  const p = withFreshPending(raw)
  const f = c.fields
  type Row = { section: string; date: string; b: DigestBooking; it: DigestItem | null }
  const flat: Row[] = []
  const sections = p.blocks.map(blk => ({
    title: `${blk.label} · ${fmtShort(blk.date)} (${blk.bookings.length})`,
    bookings: blk.bookings.map(b => {
      const rows = blk.scope === 'ITEM' && b.items.length ? b.items : [null]
      for (const it of rows) flat.push({ section: blk.label, date: blk.date, b, it })
      const t = b.team
      const lines: DocLine[] = blk.scope === 'ITEM'
        ? b.items.map(it => dailyLine(it, f, f.flagMissing && allocationPending(it)))
        : [
          ...(f.driver ? t.drivers.map(d => `Driver: ${[partyText(d, f.driverPhone), f.vehicle ? d.vehicle : null].filter(Boolean).join(' · ')}`) : []),
          ...(f.driverVendor ? t.driverVendors.map(v => `Driver vendor: ${partyText(v, f.driverPhone)}`) : []),
          ...(f.guide ? t.guides.map(g => `Guide: ${partyText(g, f.guidePhone)}`) : []),
          ...(f.tourVendor ? t.tourVendors.map(v => `Tour vendor: ${partyText(v, f.tourVendorPhone)}`) : []),
        ].map(title => ({ title, details: [], flagged: false }))
      return {
        title: bookingIds(b, f),
        subtitle: [f.leadGuest ? b.lead : null, f.pax ? `${paxText(b)} pax` : null,
          f.dayOfTour && b.dayNo >= 1 && b.dayNo <= b.totalDays ? `Day ${b.dayNo}/${b.totalDays}` : null, countryLabel(b)].filter(Boolean).join(' · '),
        meta: [f.flight && b.flight ? `Flight: ${b.flight}` : '', f.hotel && b.hotel ? `Hotel: ${b.hotel}` : '',
          blk.scope === 'TOUR' ? `${fmtShort(b.arrival)} to ${fmtShort(b.departure)}` : ''].filter(Boolean),
        lines,
      }
    }),
  }))
  const team = (r: Row, pick: (it: DigestItem) => string, whole: () => string) => (r.it ? pick(r.it) : whole())
  const names = (list: { name: string | null }[]) => list.map(x => x.name).filter(Boolean).join(', ')
  const phones = (list: { phone: string | null }[]) => list.map(x => x.phone).filter(Boolean).join(', ')
  const cols: Column<Row>[] = [
    { label: 'Section', width: 22, on: true, value: r => r.section },
    { label: 'Date', width: 11, on: true, value: r => fmtShort(r.date) },
    { label: 'Trip no.', width: 13, on: f.tripNo, value: r => r.b.tripNo },
    { label: 'IS / CNTL', width: 14, on: f.isNumber, value: r => [r.b.isNumber, r.b.cntlNumber].filter(Boolean).join(' / ') },
    { label: 'Lead guest', width: 24, on: f.leadGuest, value: r => r.b.lead ?? '' },
    { label: 'Pax', width: 9, on: f.pax, value: r => paxText(r.b) },
    { label: 'Day', width: 8, on: f.dayOfTour, value: r => (r.b.dayNo >= 1 && r.b.dayNo <= r.b.totalDays ? `${r.b.dayNo}/${r.b.totalDays}` : '') },
    { label: 'Flight', width: 30, on: f.flight, value: r => r.b.flight ?? '' },
    { label: 'Hotel', width: 28, on: f.hotel, value: r => r.b.hotel ?? '' },
    { label: 'Time', width: 9, on: f.time, value: r => r.it?.time ?? '' },
    { label: 'Route', width: 36, on: f.route, value: r => r.it?.route ?? '' },
    { label: 'Service', width: 16, on: f.serviceType, value: r => r.it?.service ?? '' },
    { label: 'Driver', width: 22, on: f.driver, value: r => team(r, it => it.driver?.name ?? (f.flagMissing && allocationPending(it) ? 'Pending' : ''), () => names(r.b.team.drivers)) },
    { label: 'Driver phone', width: 16, on: f.driver && f.driverPhone, value: r => team(r, it => it.driver?.phone ?? '', () => phones(r.b.team.drivers)) },
    { label: 'Vehicle', width: 20, on: f.vehicle, value: r => team(r, it => it.vehicle ?? '', () => r.b.team.drivers.map(d => d.vehicle).filter(Boolean).join(', ')) },
    { label: 'Driver vendor', width: 24, on: f.driverVendor, value: r => team(r, it => partyText(it.driverVendor, f.driverPhone), () => names(r.b.team.driverVendors)) },
    { label: 'Guide', width: 22, on: f.guide, value: r => team(r, it => it.guide?.name ?? '', () => names(r.b.team.guides)) },
    { label: 'Guide phone', width: 16, on: f.guide && f.guidePhone, value: r => team(r, it => it.guide?.phone ?? '', () => phones(r.b.team.guides)) },
    { label: 'Tour vendor', width: 28, on: f.tourVendor, value: r => team(r, it => it.tourVendor?.name ?? '', () => names(r.b.team.tourVendors)) },
    { label: 'Tour vendor phone', width: 18, on: f.tourVendor && f.tourVendorPhone, value: r => team(r, it => it.tourVendor?.phone ?? '', () => phones(r.b.team.tourVendors)) },
    { label: 'Note', width: 30, on: f.movementNote, value: r => r.it?.note ?? '' },
  ]
  return {
    heading: 'Daily operations update',
    dateLine: fmtDay(p.runDate),
    stats: [
      { label: 'Bookings', value: p.totals.bookings }, { label: 'Service lines', value: p.totals.lines },
      ...(f.flagMissing ? [{ label: 'Pending', value: p.totals.missing }] : []),
    ],
    sections, ...flatten(cols, flat),
  }
}

function packModel(p: DigestPayload, c: DigestConfig): Omit<DocModel, 'fileBase' | 'agent'> {
  const f = c.fields
  const s = c.ticketPack.show
  type Row = { section: string; b: DigestBooking; t: NonNullable<DigestBooking['tickets']>[number] | null }
  const flat: Row[] = []
  const sections = p.blocks.map(blk => ({
    title: `${blk.label} (${blk.bookings.length})`,
    bookings: blk.bookings.map(b => {
      const list = packVisible(b, c)
      if (list.length) for (const t of list) flat.push({ section: blk.label, b, t })
      else flat.push({ section: blk.label, b, t: null })
      const all = b.tickets ?? []
      const ready = all.filter(t => t.files.length > 0).length
      return {
        title: bookingIds(b, f),
        subtitle: [f.leadGuest ? b.lead : null, f.pax ? `${paxText(b)} pax` : null, `Arrives ${fmtShort(b.arrival)}`, countryLabel(b),
          all.length ? `${ready} of ${all.length} ready` : null].filter(Boolean).join(' · '),
        meta: [],
        lines: list.length
          ? list.map(t => ({
            title: `${t.name}${t.isNew ? ' (New)' : ''}`,
            details: [
              s.status ? TICKET_STATE_META[t.state].label : '',
              ticketFacts(t, c).join(' · '),
              t.files.length ? `${t.files.length} file${t.files.length === 1 ? '' : 's'} to download from the link` : '',
            ].filter(Boolean),
            flagged: false,
          }))
          : [{ title: 'Tickets are being arranged', details: [], flagged: false }],
      }
    }),
  }))
  const cols: Column<Row>[] = [
    { label: 'Section', width: 20, on: true, value: r => r.section },
    { label: 'Trip no.', width: 13, on: f.tripNo, value: r => r.b.tripNo },
    { label: 'IS / CNTL', width: 14, on: f.isNumber, value: r => [r.b.isNumber, r.b.cntlNumber].filter(Boolean).join(' / ') },
    { label: 'Lead guest', width: 24, on: f.leadGuest, value: r => r.b.lead ?? '' },
    { label: 'Pax', width: 9, on: f.pax, value: r => paxText(r.b) },
    { label: 'Arrival', width: 11, on: true, value: r => fmtShort(r.b.arrival) },
    { label: 'Ticket', width: 34, on: true, value: r => r.t?.name ?? 'Tickets are being arranged' },
    { label: 'Ticket date', width: 11, on: s.ticketDate, value: r => (r.t?.date ? fmtShort(r.t.date) : '') },
    { label: 'Location', width: 22, on: s.location, value: r => r.t?.location ?? '' },
    { label: 'Qty', width: 6, on: s.qty, value: r => (r.t ? String(r.t.qty) : '') },
    { label: 'Reference', width: 18, on: s.reference, value: r => r.t?.reference ?? '' },
    { label: 'Supplier', width: 20, on: s.supplier, value: r => r.t?.supplier ?? '' },
    { label: 'Status', width: 30, on: s.status, value: r => (r.t ? TICKET_STATE_META[r.t.state].label : '') },
    { label: 'Files', width: 7, on: true, value: r => (r.t ? String(r.t.files.length) : '') },
  ]
  return {
    heading: 'Ticket pack',
    dateLine: `Arriving ${packArrivalText(p)}`,
    stats: [
      { label: 'Bookings', value: p.totals.bookings }, { label: 'Tickets', value: p.totals.lines },
      { label: 'Ready to download', value: p.pack?.ready ?? 0 },
    ],
    sections, ...flatten(cols, flat),
  }
}

export function buildDocModel(p: DigestPayload, c: DigestConfig): DocModel {
  const isPack = p.kind === 'TICKETS'
  const agent = p.agentLabel
  const slug = agent.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Agent'
  return {
    ...(isPack ? packModel(p, c) : dailyModel(p, c)),
    agent,
    fileBase: `${slug}-${isPack ? 'Ticket-Pack' : 'Daily-Update'}-${p.runDate}`,
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const TEAL = '#0F766E', DARK = '#0F172A', MID = '#475569', MUTED = '#64748B', LINE = '#E2E8F0', RED = '#B91C1C', SOFT = '#F0FDFA'
const PAGE_W = 595.28, MARGIN = 40, WIDTH = PAGE_W - MARGIN * 2, BOTTOM = 790

export async function digestPdf(m: DocModel, link?: string | null): Promise<Buffer> {
  await ensurePdfkitDataFiles()
  const PDFDocument = (await loadPdfDocumentCtor()) as any
  const brand = await brandGuard('pdf', 'agent')
  const doc = guardPdfText(new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: pdfText(`${m.agent} ${m.heading}`), Author: brand.text('AppleHolidays Operations') } }), brand)
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  const room = (h: number) => { if (doc.y + h > BOTTOM) doc.addPage() }
  const text = (s: string, size: number, color: string, font = 'Helvetica', x = MARGIN, w = WIDTH) =>
    doc.font(font).fontSize(size).fillColor(color).text(pdfText(s), x, doc.y, { width: w })

  doc.rect(0, 0, PAGE_W, 6).fill(TEAL)
  doc.y = 30
  text(m.heading.toUpperCase(), 9, TEAL, 'Helvetica-Bold')
  doc.moveDown(0.2)
  text(m.agent, 22, DARK, 'Helvetica-Bold')
  text(m.dateLine, 11, MID)
  doc.moveDown(0.7)

  const tileY = doc.y
  const tileW = (WIDTH - 8 * (m.stats.length - 1)) / m.stats.length
  m.stats.forEach((s, i) => {
    const x = MARGIN + i * (tileW + 8)
    doc.roundedRect(x, tileY, tileW, 50, 8).fillAndStroke(SOFT, '#CCFBF1')
    doc.font('Helvetica-Bold').fontSize(18).fillColor(DARK).text(String(s.value), x + 12, tileY + 9, { width: tileW - 24 })
    doc.font('Helvetica').fontSize(9).fillColor(MID).text(pdfText(s.label), x + 12, tileY + 31, { width: tileW - 24 })
  })
  doc.y = tileY + 62

  for (const sec of m.sections) {
    room(90)
    doc.moveDown(0.4)
    text(sec.title.toUpperCase(), 10, TEAL, 'Helvetica-Bold')
    doc.moveTo(MARGIN, doc.y + 3).lineTo(MARGIN + WIDTH, doc.y + 3).lineWidth(1.2).stroke('#99F6E4')
    doc.y += 9
    for (const b of sec.bookings) {
      room(58)
      text(b.title, 11.5, DARK, 'Helvetica-Bold')
      if (b.subtitle) text(b.subtitle, 9, MID)
      for (const line of b.meta) text(line, 9, MUTED)
      doc.y += 3
      for (const l of b.lines) {
        room(16 + l.details.length * 12)
        const top = doc.y
        text(l.title, 9.5, DARK, 'Helvetica-Bold', MARGIN + 10, WIDTH - 10)
        for (const d of l.details) text(d, 8.5, d === 'Driver pending' ? RED : MID, 'Helvetica', MARGIN + 10, WIDTH - 10)
        doc.rect(MARGIN + 1, top, 2, doc.y - top).fill(l.flagged ? RED : '#14B8A6')
        doc.y += 4
      }
      doc.moveTo(MARGIN, doc.y + 1).lineTo(MARGIN + WIDTH, doc.y + 1).lineWidth(0.5).stroke(LINE)
      doc.y += 8
    }
  }
  if (link) {
    room(24)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEAL).text('Open the online version', MARGIN, doc.y + 4, { link, underline: true })
  }

  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i)
    // Writing below the bottom margin would make PDFKit add a blank page.
    doc.page.margins.bottom = 0
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`AppleHolidays Operations  ·  Page ${i + 1} of ${range.count}`, MARGIN, 815, { width: WIDTH, align: 'center', lineBreak: false })
  }
  doc.end()
  return done
}

// ── Excel ────────────────────────────────────────────────────────────────────

export async function digestExcel(m: DocModel, link?: string | null): Promise<Buffer> {
  const wb = newWorkbook(`${m.agent} ${m.heading}`)
  const ws = wb.addWorksheet(m.heading.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] })
  ws.columns = m.columns.map(c => ({ width: c.width }))
  ws.getCell('A1').value = `${m.agent} · ${m.heading}`
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0F172A' } }
  ws.getCell('A2').value = [m.dateLine, ...m.stats.map(s => `${s.label}: ${s.value}`)].join('   |   ')
  ws.getCell('A2').font = { color: { argb: 'FF475569' } }
  if (link) {
    ws.getCell('A3').value = { text: 'Open the online version', hyperlink: link }
    ws.getCell('A3').font = { color: { argb: 'FF0F766E' }, underline: true }
  }
  const head = ws.getRow(4)
  head.values = m.columns.map(c => c.label)
  head.font = { bold: true, color: { argb: 'FF0F172A' } }
  head.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  for (const r of m.rows) {
    const row = ws.addRow(r)
    row.alignment = { vertical: 'top', wrapText: true }
  }
  if (m.columns.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: m.columns.length } }
  return Buffer.from(await workbookBuffer(wb))
}

// ── Word ─────────────────────────────────────────────────────────────────────

const para = (text: string, o: { size?: number; bold?: boolean; color?: string; after?: number; before?: number } = {}) =>
  new Paragraph({
    spacing: { after: o.after ?? 40, before: o.before ?? 0 },
    children: [new TextRun({ text, size: o.size ?? 20, bold: o.bold, color: o.color ?? '334155', font: 'Calibri' })],
  })

function wordLines(lines: DocLine[]): Table {
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: lines.map(l => new TableRow({
      cantSplit: true,
      children: [new TableCell({
        margins: { top: 50, bottom: 50, left: 100, right: 100 },
        children: [
          para(l.title, { bold: true, color: '0F172A', after: 20 }),
          ...l.details.map(d => para(d, { size: 18, after: 10, color: d === 'Driver pending' ? 'B91C1C' : '475569' })),
        ],
      })],
    })),
  })
}

export async function digestWord(m: DocModel, link?: string | null): Promise<Buffer> {
  const stat = (s: { label: string; value: number }) => new TableCell({
    shading: { type: ShadingType.CLEAR, fill: 'F0FDFA', color: 'auto' },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [para(String(s.value), { size: 32, bold: true, color: '0F172A', after: 0 }), para(s.label, { size: 18, after: 0 })],
  })
  const children: (Paragraph | Table)[] = [
    para(m.heading.toUpperCase(), { size: 18, bold: true, color: '0F766E', after: 20 }),
    para(m.agent, { size: 40, bold: true, color: '0F172A', after: 20 }),
    para(m.dateLine, { size: 22, color: '475569', after: 160 }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: m.stats.map(stat) })] }),
  ]
  for (const sec of m.sections) {
    children.push(para(sec.title.toUpperCase(), { size: 22, bold: true, color: '0F766E', before: 280, after: 100 }))
    for (const b of sec.bookings) {
      children.push(para(b.title, { size: 24, bold: true, color: '0F172A', before: 160, after: 10 }))
      if (b.subtitle) children.push(para(b.subtitle, { size: 18, after: 10 }))
      for (const line of b.meta) children.push(para(line, { size: 18, color: '64748B', after: 10 }))
      if (b.lines.length) children.push(wordLines(b.lines))
    }
  }
  if (link) children.push(para(`Online version: ${link}`, { size: 18, color: '0F766E', before: 240 }))
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 }, children: [new TextRun({ text: 'AppleHolidays Operations', size: 16, color: '64748B' })] }))
  const doc = new Document({ sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }] })
  return guardDocx(await Packer.toBuffer(doc), await brandGuard('word', 'agent'))
}

// ── What a send uses ─────────────────────────────────────────────────────────

/** The digest's PDF, for WhatsApp. */
export async function digestPdfFile(p: DigestPayload, c: DigestConfig, link?: string | null): Promise<DigestFile> {
  const m = buildDocModel(p, c)
  return { name: `${m.fileBase}.pdf`, contentType: MIME.pdf, buffer: await digestPdf(m, link) }
}

/**
 * The files chosen for email. A file that cannot be built is left out and
 * named in `failed`: the digest itself still has to go.
 */
export async function digestMailFiles(p: DigestPayload, c: DigestConfig, link?: string | null): Promise<{ files: DigestFile[]; failed: string[] }> {
  const m = buildDocModel(p, c)
  const jobs: [boolean, string, string, string, (d: DocModel, l?: string | null) => Promise<Buffer>][] = [
    [c.attachments.pdf, 'PDF', 'pdf', MIME.pdf, digestPdf],
    [c.attachments.excel, 'Excel', 'xlsx', MIME.excel, digestExcel],
    [c.attachments.word, 'Word', 'docx', MIME.word, digestWord],
  ]
  const files: DigestFile[] = []
  const failed: string[] = []
  for (const [on, label, ext, contentType, write] of jobs) {
    if (!on) continue
    try {
      files.push({ name: `${m.fileBase}.${ext}`, contentType, buffer: await write(m, link) })
    } catch (err) {
      console.error(`[AgentDigest] ${label} attachment failed:`, err instanceof Error ? err.message : err)
      failed.push(label)
    }
  }
  return { files, failed }
}

/** The example PDF Meta reviews a document template against. No real booking in it. */
export async function sampleDigestPdf(isPack: boolean): Promise<Buffer> {
  return digestPdf({
    fileBase: 'sample', heading: isPack ? 'Ticket pack' : 'Daily operations update', agent: 'Sample Agent', dateLine: 'Sample document',
    stats: [{ label: 'Bookings', value: 1 }, { label: isPack ? 'Tickets' : 'Service lines', value: 1 }],
    sections: [{
      title: 'Sample',
      bookings: [{ title: 'VN00000', subtitle: 'Sample guest · 2A pax', meta: [], lines: [{ title: isPack ? 'Sample ticket' : '09:00 Hotel to airport', details: [isPack ? 'Ready to download' : 'Driver: Sample driver'], flagged: false }] }],
    }],
    columns: [], rows: [],
  })
}
