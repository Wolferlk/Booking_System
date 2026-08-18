/**
 * Movement-chart agenda PDF, rendered with PDFKit.
 *
 * Deliberately does NOT use Chromium/puppeteer: the serverless host this runs on is
 * arm64, and @sparticuz/chromium ships x64 binaries only, so the HTML route fails at
 * launch with ENOEXEC. PDFKit is pure JS and works on every arch — same approach the
 * booking-confirmation PDF already uses (see generate-booking-pdf.ts).
 */
import { ensurePdfkitDataFiles, loadPdfDocumentCtor, loadLogo } from './pdfkit-boot'
import { readUploadAsBuffer, imageDimensions, fitImage } from './local-upload'
import { withoutRetiredContacts } from './emergency-contacts'
import { SERVICE_TYPE_SHORT_LABELS } from './service-types'
import {
  parseTicketNotes, ticketFacts, ticketCode, ticketFileKind,
  categoryLabel, paxLabel, isPurchasedTicket,
} from './ticket-notes'

// ── Palette (matches generate-booking-pdf.ts) ────────────────────────────────
const HEADER_BG = '#0F172A'
const BRAND     = '#D97706'
const DARK      = '#1E293B'
const MUTED     = '#64748B'
const LINE      = '#E2E8F0'
const GREEN     = '#059669'
const BLUE      = '#2563EB'
const PURPLE    = '#7C3AED'
const RED       = '#DC2626'

const PAGE_W    = 595
const PAGE_H    = 842
const MARGIN    = 40
const CONTENT_W = PAGE_W - MARGIN * 2
const BOTTOM    = PAGE_H - MARGIN

const COUNTRY_LABEL: Record<string, string> = {
  VIETNAM: 'Vietnam', SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore', MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore / Malaysia',
}

const SVC_COLOR: Record<string, string> = {
  PVT_TRANSFER: BLUE, PVT_TOUR: BLUE, PVT_TRANSFER_TICKET: BLUE,
  PVT_TRANSFER_SPA: BLUE, PVT_TRANSFER_SIC_TOUR: BLUE, PVT_TRANSFER_MEAL: BLUE,
  SIC_TRANSFER: GREEN, SIC_TOUR: GREEN,
  OWN_ARRANGEMENT: '#94A3B8',
}
const SVC_LABEL: Record<string, string> = SERVICE_TYPE_SHORT_LABELS

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const parsed = new Date(d)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * PDFKit's standard fonts are WinAnsi-encoded, so a codepoint the encoding lacks
 * renders as garbage (an arrow came out as "I'"). Booking data routinely carries
 * arrows and emoji, so fold the common ones to ASCII and drop whatever is left.
 * WinAnsi is not Latin-1 — it also carries dashes, curly quotes, bullet, € — so
 * those are preserved rather than stripped.
 */
const WINANSI_EXTRAS =
  "\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D" +
  "\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178"

/** Common non-WinAnsi symbols folded to an ASCII lookalike. */
const GLYPH_FALLBACK: Record<string, string> = {
  "\u2192": ">", "\u2190": "<", "\u21D2": "=>", "\u279C": ">", "\u2794": ">",
  "\u25B6": ">", "\u25BA": ">", "\u25AA": "-",
  "\u2032": "'", "\u2033": "\"", "\u2011": "-", "\u2212": "-", "\u2713": "v",
}

const FOLDABLE   = /[\u2192\u2190\u21D2\u279C\u2794\u25B6\u25BA\u25AA\u2032\u2033\u2011\u2212\u2713]/g
const UNSUPPORTED = new RegExp(`[^\\n\\t\\x20-\\xFF${WINANSI_EXTRAS}]`, "g")

export function sanitizeText(value: string): string {
  return value
    .replace(FOLDABLE, ch => GLYPH_FALLBACK[ch] ?? ch)
    // Anything still unmapped (emoji, CJK, box drawing) has no glyph - drop it.
    .replace(UNSUPPORTED, "")
    .replace(/[ \t]{2,}/g, " ")
}

function txt(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return '—'
  return sanitizeText(String(value))
}

function normalizeMealPlan(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '—'
  const MAP: Record<string, string> = {
    B: 'B', L: 'L', D: 'D',
    BL: 'B+L', LB: 'B+L', BD: 'B+D', DB: 'B+D',
    LD: 'L+D', DL: 'L+D',
    BLD: 'B+L+D', BDL: 'B+L+D', LBD: 'B+L+D',
  }
  const upper = raw.trim().toUpperCase().replace(/[\s,/]+/g, '')
  return MAP[upper] ?? raw.trim()
}

// ── Types (structurally match the Prisma include used by agenda/send) ────────
export interface AgendaPdfAssignment {
  vendorId?: string | null; vendorName?: string | null
  driverName?: string | null; driverPhone?: string | null
  vehicleType?: string | null; vehiclePlate?: string | null
  vendor?: { name: string; phone?: string | null } | null
  driver?: { name: string; phone?: string | null; vehicle?: { type?: string | null; plateNo?: string | null } | null } | null
}

export interface AgendaPdfItem {
  date: string | Date
  location?: string | null; fromPoint?: string | null; toPoint?: string | null
  details?: string | null; mealPlan?: string | null; meetingTime?: string | null
  timeFrom?: string | null; timeTo?: string | null; serviceType?: string | null
  assignment?: AgendaPdfAssignment | null
}

export interface AgendaPdfBooking {
  bookingRef?: string; isNumber?: string | null; cntlNumber?: string | null; agentBookingId?: string | null
  agent?: string | null; fileHandler?: string | null
  arrivalDate?: string | Date | null; departureDate?: string | Date | null
  paxAdults?: number | null; paxChildren?: number | null; paxInfants?: number | null
  operationCountry?: string | null; tourDestination?: string | null
  contactPhone?: string | null; contactWhatsapp?: string | null; contactEmail?: string | null
  packageIncludes?: string | null; packageExcludes?: string | null
  exclusions?: string | null; tips?: string | null; terms?: string | null
  importantNotes?: string | null; policyNotes?: string | null
  otherNote?: string | null; clientRequest?: string | null; amendmentNote?: string | null
  passengers?: { name: string; isLead?: boolean; type?: string | null; mealPreference?: string | null; contact?: string | null }[]
  flights?: { flightNo: string; date: string | Date; fromApt: string; depTime?: string | null; toApt: string; arrTime?: string | null }[]
  accommodations?: { hotel: string; city: string; checkIn: string | Date; checkOut: string | Date; nights: number; roomType?: string | null; mealType?: string | null }[]
  emergencyContacts?: { name: string; phone?: string | null; role?: string | null }[]
  tickets?: AgendaPdfTicket[]
}

export interface AgendaPdfTicket {
  id: string
  type: string
  qty: number
  status: string
  category?: string | null
  supplier?: string | null
  reference?: string | null
  notes?: string | null
  currency?: string | null
  totalCost?: string | number | null
  costPerUnit?: string | number | null
  purchasedAt?: string | Date | null
  fileUrl?: string | null
  fileName?: string | null
  fileType?: string | null
  driverName?: string | null
  driverPhone?: string | null
  vehicleType?: string | null
  vehicleNumber?: string | null
  pnlLine?: { activity?: string | null; paymentRefNumber?: string | null; category?: string | null } | null
  agendaItem?: { date?: string | Date | null; location?: string | null; toPoint?: string | null } | null
}

interface Column {
  header: string
  width: number
  value: (row: Record<string, unknown>) => string
  color?: string
  bold?: boolean
}

export async function generateAgendaPdf(
  ref: string,
  booking: AgendaPdfBooking,
  items: AgendaPdfItem[],
  showDrivers: boolean,
): Promise<Buffer> {
  await ensurePdfkitDataFiles()
  const PDFDocument = await loadPdfDocumentCtor()
  const logo = await loadLogo()

  // Only tickets actually bought go on a customer document; drafts stay internal.
  const purchasedTickets = (booking.tickets ?? []).filter(t => isPurchasedTicket(t.status))

  // PDFKit can't fetch mid-render, so resolve every ticket scan first. It also
  // decodes PNG and JPEG only — other formats fall back to the drawn ticket.
  const ticketImages = new Map<string, { buffer: Buffer; width: number; height: number }>()
  await Promise.all(purchasedTickets.map(async ticket => {
    if (ticketFileKind(ticket) !== 'image') return
    if (!/\.(jpe?g|png)(\?|$)/i.test(ticket.fileUrl ?? '')) return
    const buffer = await readUploadAsBuffer(ticket.fileUrl)
    if (!buffer) return
    const size = fitImage(imageDimensions(buffer), { width: CONTENT_W - 30, height: 300 })
    ticketImages.set(ticket.id, { buffer, ...size })
  }))

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = new (PDFDocument as any)({
      margin: MARGIN, size: 'A4', bufferPages: true, autoFirstPage: true,
    })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── Layout helpers ─────────────────────────────────────────────────────
    /** Start a new page when `needed` points don't fit below the cursor. */
    function ensureSpace(needed: number) {
      if (doc.y + needed > BOTTOM) {
        doc.addPage()
        doc.y = MARGIN
      }
    }

    function drawHeader() {
      doc.rect(0, 0, PAGE_W, 74).fill(HEADER_BG)

      let nameX = 16
      if (logo) {
        try {
          doc.image(logo, 12, 9, { height: 54, fit: [54, 54] })
          nameX = 78
        } catch { /* unsupported logo format — text header still renders */ }
      }

      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(16)
        .text('Apple Holidays', nameX, 15, { lineBreak: false })
      doc.fillColor('#CBD5E1').font('Helvetica').fontSize(8)
        .text('Movement Chart & Booking Summary', nameX, 36, { lineBreak: false })
      if (!showDrivers) {
        doc.fillColor('#94A3B8').font('Helvetica-Oblique').fontSize(7)
          .text('Driver info hidden', nameX, 50, { lineBreak: false })
      }

      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(15)
        .text(ref, MARGIN, 14, { width: CONTENT_W, align: 'right', lineBreak: false })

      const idBits = [
        booking.isNumber ? `IS: ${booking.isNumber}` : null,
        booking.cntlNumber ? `CNTL: ${booking.cntlNumber}` : null,
        booking.agentBookingId ? `Ref: ${booking.agentBookingId}` : null,
      ].filter(Boolean).join('  ·  ')

      let hy = 33
      if (idBits) {
        doc.fillColor('#CBD5E1').font('Helvetica').fontSize(7.5)
          .text(idBits, MARGIN, hy, { width: CONTENT_W, align: 'right', lineBreak: false })
        hy += 11
      }

      const totalPax = (booking.paxAdults ?? 0) + (booking.paxChildren ?? 0) + (booking.paxInfants ?? 0)
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7.5)
        .text(
          `${fmtDate(booking.arrivalDate)} — ${fmtDate(booking.departureDate)}  ·  ${totalPax} pax`,
          MARGIN, hy, { width: CONTENT_W, align: 'right', lineBreak: false },
        )

      doc.rect(0, 74, PAGE_W, 3).fill(BRAND)
      doc.y = 90
    }

    function sectionTitle(title: string) {
      ensureSpace(40)
      doc.moveDown(0.5)
      const sy = doc.y
      doc.rect(MARGIN, sy, 4, 18).fill(BRAND)
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
        .text(title.toUpperCase(), MARGIN + 10, sy + 3, { width: CONTENT_W - 10 })
      doc.moveDown(0.3)
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
        .strokeColor(LINE).lineWidth(0.5).stroke()
      doc.moveDown(0.4)
    }

    /** Simple striped table. Row height adapts to the tallest wrapped cell. */
    function table(columns: Column[], rows: Record<string, unknown>[]) {
      const drawHeaderRow = () => {
        const hy = doc.y
        doc.rect(MARGIN, hy, CONTENT_W, 14).fill('#334155')
        let x = MARGIN
        columns.forEach(col => {
          doc.fillColor('#F8FAFC').font('Helvetica-Bold').fontSize(7)
            .text(col.header.toUpperCase(), x + 4, hy + 4, { width: col.width - 8, lineBreak: false })
          x += col.width
        })
        doc.y = hy + 14
      }

      ensureSpace(30)
      drawHeaderRow()

      rows.forEach((row, i) => {
        const cells = columns.map(col => col.value(row))
        const rowH = Math.max(
          14,
          ...cells.map((cell, ci) =>
            doc.font('Helvetica').fontSize(8).heightOfString(cell, { width: columns[ci].width - 8 }) + 6),
        )

        if (doc.y + rowH > BOTTOM) {
          doc.addPage()
          doc.y = MARGIN
          drawHeaderRow()
        }

        const ry = doc.y
        if (i % 2 === 1) doc.rect(MARGIN, ry, CONTENT_W, rowH).fill('#F8FAFC')

        let x = MARGIN
        columns.forEach((col, ci) => {
          doc.fillColor(col.color ?? DARK)
            .font(col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8)
            .text(cells[ci], x + 4, ry + 3, { width: col.width - 8 })
          x += col.width
        })

        doc.y = ry + rowH
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
          .strokeColor('#F1F5F9').lineWidth(0.5).stroke()
      })

      doc.moveDown(0.5)
    }

    /** Bullet/numbered note block with a coloured left rule. */
    function noteBlock(label: string, content: string | null | undefined, accent: string) {
      if (!content?.trim()) return
      const lines = content.trim().split('\n').map(l => l.trim()).filter(Boolean)

      ensureSpace(34)
      doc.moveDown(0.3)
      const startY = doc.y
      doc.fillColor(accent).font('Helvetica-Bold').fontSize(8)
        .text(label.toUpperCase(), MARGIN + 10, startY, { width: CONTENT_W - 14 })
      doc.moveDown(0.2)

      lines.forEach(line => {
        const clean = sanitizeText(line)
          .replace(/^[-•*▪►]\s*/, '')
          .replace(/^\d+[.)]\s*/, '')
        const bullet = /^\d+[.)]/.test(line) ? line.match(/^(\d+)/)![1] + '.' : '•'
        ensureSpace(14)
        const ly = doc.y
        doc.fillColor(accent).font('Helvetica-Bold').fontSize(8)
          .text(bullet, MARGIN + 10, ly, { width: 12, lineBreak: false })
        doc.fillColor('#374151').font('Helvetica').fontSize(8.5)
          .text(clean, MARGIN + 24, ly, { width: CONTENT_W - 30, lineGap: 1.5 })
        doc.moveDown(0.15)
      })

      // Left accent rule spanning the block (skipped when it wrapped onto a new page)
      if (doc.y > startY) {
        doc.rect(MARGIN, startY, 3, doc.y - startY).fill(accent)
      }
      doc.moveDown(0.4)
    }

    // ── Page 1 ─────────────────────────────────────────────────────────────
    drawHeader()

    // Summary strip — 4 labelled cells across the content width
    const lead = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
    const destination = booking.tourDestination?.trim()
      || (booking.operationCountry ? COUNTRY_LABEL[booking.operationCountry] ?? booking.operationCountry : '—')

    const summaryCells = [
      { label: 'Tour Operator / Agent', value: txt(booking.agent) },
      { label: 'File Handler',          value: txt(booking.fileHandler) },
      { label: 'Destination',           value: destination },
      { label: 'Lead Passenger',        value: txt(lead?.name) },
    ]
    const stripY = doc.y
    doc.rect(MARGIN, stripY, CONTENT_W, 34).fill('#F8FAFC')
      .rect(MARGIN, stripY, CONTENT_W, 34).strokeColor(LINE).lineWidth(0.5).stroke()
    const cellW = CONTENT_W / summaryCells.length
    summaryCells.forEach((cell, i) => {
      const cx = MARGIN + i * cellW
      doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
        .text(cell.label.toUpperCase(), cx + 6, stripY + 6, { width: cellW - 10, lineBreak: false })
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(9)
        .text(cell.value, cx + 6, stripY + 17, { width: cellW - 10, lineBreak: false, ellipsis: true })
    })
    doc.y = stripY + 42

    // Customer contact
    const contactBits = [
      booking.contactPhone ? `Phone: ${booking.contactPhone}` : null,
      booking.contactWhatsapp ? `WhatsApp: ${booking.contactWhatsapp}` : null,
      booking.contactEmail ? `Email: ${booking.contactEmail}` : null,
    ].filter(Boolean)
    if (contactBits.length > 0) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(contactBits.join('    ·    '), MARGIN, doc.y, { width: CONTENT_W })
      doc.moveDown(0.6)
    }

    // ── Passengers ─────────────────────────────────────────────────────────
    const passengers = booking.passengers ?? []
    if (passengers.length > 0) {
      const paxSummary = `${booking.paxAdults ?? 0} adult${(booking.paxAdults ?? 0) !== 1 ? 's' : ''}`
        + ((booking.paxChildren ?? 0) > 0 ? ` · ${booking.paxChildren} child${(booking.paxChildren ?? 0) !== 1 ? 'ren' : ''}` : '')
        + ((booking.paxInfants ?? 0) > 0 ? ` · ${booking.paxInfants} infant${(booking.paxInfants ?? 0) !== 1 ? 's' : ''}` : '')
      sectionTitle(`Passengers  (${paxSummary})`)
      table(
        [
          { header: 'Name',            width: 170, bold: true, value: r => txt(r.name) + (r.isLead ? '  (LEAD)' : '') },
          { header: 'Type',            width: 70,  value: r => txt(r.type ?? 'ADULT') },
          { header: 'Contact',         width: 140, value: r => txt(r.contact) },
          { header: 'Meal Preference', width: CONTENT_W - 380, value: r => txt(r.mealPreference) },
        ],
        passengers as unknown as Record<string, unknown>[],
      )
    }

    // ── Flights ────────────────────────────────────────────────────────────
    const flights = booking.flights ?? []
    if (flights.length > 0) {
      sectionTitle(`Flights  (${flights.length} segment${flights.length !== 1 ? 's' : ''})`)
      table(
        [
          { header: 'Flight No.', width: 80,  bold: true, color: BLUE,  value: r => txt(r.flightNo) },
          { header: 'Date',       width: 95,  value: r => fmtDate(r.date as string) },
          { header: 'From',       width: 90,  bold: true, value: r => txt(r.fromApt) },
          { header: 'Dep.',       width: 60,  bold: true, color: GREEN, value: r => txt(r.depTime) },
          { header: 'To',         width: 90,  bold: true, value: r => txt(r.toApt) },
          { header: 'Arr.',       width: CONTENT_W - 415, bold: true, color: RED, value: r => txt(r.arrTime) },
        ],
        flights as unknown as Record<string, unknown>[],
      )
    }

    // ── Accommodation ──────────────────────────────────────────────────────
    const accommodations = booking.accommodations ?? []
    if (accommodations.length > 0) {
      sectionTitle(`Accommodation  (${accommodations.length} hotel${accommodations.length !== 1 ? 's' : ''})`)
      table(
        [
          { header: 'Hotel',     width: 130, bold: true, value: r => txt(r.hotel) },
          { header: 'City',      width: 75,  value: r => txt(r.city) },
          { header: 'Check-in',  width: 72,  value: r => fmtDate(r.checkIn as string) },
          { header: 'Check-out', width: 72,  value: r => fmtDate(r.checkOut as string) },
          { header: 'Nts',       width: 26,  bold: true, value: r => txt(r.nights) },
          { header: 'Room Type', width: 80,  value: r => txt(r.roomType) },
          { header: 'Meal',      width: CONTENT_W - 455, value: r => txt(r.mealType) },
        ],
        accommodations as unknown as Record<string, unknown>[],
      )
    }

    // ── Movement chart ─────────────────────────────────────────────────────
    if (items.length > 0) {
      sectionTitle(
        `Movement Chart — ${items.length} item${items.length !== 1 ? 's' : ''}`
        + (showDrivers ? ' (with driver allocation)' : ' (driver info hidden)'),
      )

      // Group by calendar day, preserving the incoming (already sorted) order
      const grouped = new Map<string, AgendaPdfItem[]>()
      items.forEach(item => {
        const key = item.date
          ? String(item.date instanceof Date ? item.date.toISOString() : item.date).slice(0, 10)
          : 'unknown'
        const bucket = grouped.get(key)
        if (bucket) bucket.push(item)
        else grouped.set(key, [item])
      })

      grouped.forEach((dayItems, date) => {
        ensureSpace(50)

        // Day banner
        const by = doc.y
        doc.rect(MARGIN, by, CONTENT_W, 16).fill(HEADER_BG)
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
          .text(fmtDate(date), MARGIN + 8, by + 4, { width: 130, lineBreak: false })
        const rawDayLocation = dayItems.find(it => it.location)?.location
        const dayLocation = rawDayLocation ? sanitizeText(rawDayLocation) : null
        if (dayLocation) {
          doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
            .text(dayLocation, MARGIN + 140, by + 4.5, { width: CONTENT_W - 148, lineBreak: false, ellipsis: true })
        }
        doc.y = by + 16

        dayItems.forEach((item, idx) => {
          const svc = item.serviceType ?? 'OWN_ARRANGEMENT'
          const clr = SVC_COLOR[svc] ?? '#94A3B8'
          const a   = item.assignment

          const meal = normalizeMealPlan(item.mealPlan)
          let meet = '—'
          if (svc === 'SIC_TRANSFER' && (item.timeFrom || item.timeTo)) {
            meet = [item.timeFrom, item.timeTo].filter(Boolean).join(' – ')
          } else if (item.meetingTime) {
            meet = String(item.meetingTime)
          }

          // Driver / vendor allocation, flattened to one short line
          let driverLine = ''
          if (showDrivers) {
            const vendorName  = a?.vendorName ?? a?.vendor?.name ?? null
            const vendorPhone = a?.vendor?.phone ?? null
            const driverName  = a?.driverName ?? a?.driver?.name ?? null
            const driverPhone = a?.driverPhone ?? a?.driver?.phone ?? null
            const vehType     = a?.vehicleType ?? a?.driver?.vehicle?.type ?? null
            const vehPlate    = a?.vehiclePlate ?? a?.driver?.vehicle?.plateNo ?? null

            const parts = [
              vendorName ? `${vendorName}${vendorPhone ? ` (${vendorPhone})` : ''}` : null,
              driverName ? `${driverName}${driverPhone ? ` · ${driverPhone}` : ''}` : null,
              vehPlate ? `${vehType ? vehType + ' ' : ''}${vehPlate}` : null,
            ].filter(Boolean)
            driverLine = parts.length > 0 ? sanitizeText(parts.join('  ·  ')) : 'Not assigned'
          }

          // Measure before drawing so a row never straddles a page break
          const fromToH = Math.max(
            doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(txt(item.fromPoint), { width: 150 }),
            doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(txt(item.toPoint), { width: 150 }),
          )
          const details  = item.details?.trim() ? sanitizeText(item.details.trim()) : ''
          const detailsH = details
            ? doc.font('Helvetica').fontSize(8).heightOfString(details, { width: CONTENT_W - 20, lineGap: 1.5 }) + 8
            : 0
          const driverH = driverLine
            ? doc.font('Helvetica').fontSize(7.5).heightOfString(driverLine, { width: CONTENT_W - 62 }) + 4
            : 0
          const rowH = 14 + fromToH + detailsH + driverH

          ensureSpace(rowH + 4)
          const ry = doc.y
          if (idx % 2 === 1) doc.rect(MARGIN, ry, CONTENT_W, rowH).fill('#F8FAFC')
          doc.rect(MARGIN, ry, 2.5, rowH).fill(clr)

          // From / To
          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
            .text('FROM', MARGIN + 8, ry + 4, { width: 150, lineBreak: false })
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
            .text(txt(item.fromPoint), MARGIN + 8, ry + 12, { width: 150 })

          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
            .text('TO / ACTIVITY', MARGIN + 168, ry + 4, { width: 150, lineBreak: false })
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
            .text(txt(item.toPoint), MARGIN + 168, ry + 12, { width: 150 })

          // Meal / Meet / Service
          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
            .text('MEAL', MARGIN + 328, ry + 4, { width: 45, lineBreak: false })
          doc.fillColor(meal !== '—' ? GREEN : '#CBD5E1').font('Helvetica-Bold').fontSize(8)
            .text(meal, MARGIN + 328, ry + 12, { width: 45, lineBreak: false })

          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
            .text('MEET', MARGIN + 378, ry + 4, { width: 60, lineBreak: false })
          doc.fillColor(meet !== '—' ? GREEN : '#CBD5E1').font('Helvetica-Bold').fontSize(8)
            .text(meet, MARGIN + 378, ry + 12, { width: 60, lineBreak: false })

          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
            .text('SERVICE', MARGIN + 443, ry + 4, { width: 70, lineBreak: false })
          doc.fillColor(clr).font('Helvetica-Bold').fontSize(8)
            .text(SVC_LABEL[svc] ?? svc.replace(/_/g, ' '), MARGIN + 443, ry + 12, { width: 70, lineBreak: false })

          let cursor = ry + 12 + fromToH + 2

          if (driverLine) {
            doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6.5)
              .text('DRIVER', MARGIN + 8, cursor, { width: 45, lineBreak: false })
            doc.fillColor(driverLine === 'Not assigned' ? '#CBD5E1' : PURPLE)
              .font(driverLine === 'Not assigned' ? 'Helvetica-Oblique' : 'Helvetica-Bold').fontSize(7.5)
              .text(driverLine, MARGIN + 54, cursor, { width: CONTENT_W - 62 })
            cursor += driverH
          }

          if (detailsH > 0) {
            doc.fillColor('#374151').font('Helvetica').fontSize(8)
              .text(details, MARGIN + 10, cursor + 2, { width: CONTENT_W - 20, lineGap: 1.5 })
          }

          doc.y = ry + rowH
          doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
            .strokeColor('#F1F5F9').lineWidth(0.5).stroke()
        })

        doc.moveDown(0.5)
      })
    }

    // ── Purchased tickets & vouchers ───────────────────────────────────────
    if (purchasedTickets.length > 0) {
      sectionTitle(`Purchased Tickets & Vouchers — ${purchasedTickets.length} confirmed`)

      const CAT_COLOR: Record<string, string> = {
        HOTEL: BLUE, TICKETS: PURPLE, CRUISE: '#0891B2', WATER: '#0284C7',
        GUIDES: '#16A34A', FLIGHT_TICKETS: RED, TRANSPORT: '#EA580C',
        MEALS: BRAND, OTHER: MUTED,
      }

      purchasedTickets.forEach(ticket => {
        const category = ticket.category ?? ticket.pnlLine?.category ?? 'OTHER'
        const clr      = CAT_COLOR[category] ?? MUTED
        const meta     = parseTicketNotes(ticket.notes)
        const facts    = ticketFacts(ticket, meta, d => fmtDate(d))
        const image    = ticketImages.get(ticket.id)
        const remark   = sanitizeText([meta.remarks, ...meta.details].filter(Boolean).join('  ·  '))

        const COLS     = 3
        const colW     = (CONTENT_W - 20) / COLS
        const factRows = Math.ceil(facts.length / COLS)

        const refH     = ticket.reference ? 28 : 0
        const factsH   = factRows * 22
        const remarkH  = remark
          ? doc.font('Helvetica-Oblique').fontSize(7.5).heightOfString(remark, { width: CONTENT_W - 20 }) + 6
          : 0
        const mediaH   = image ? image.height + 20 : 22
        const cardH    = 24 + refH + factsH + remarkH + mediaH + 8

        ensureSpace(cardH + 8)
        const cy = doc.y

        // Card shell
        doc.rect(MARGIN, cy, CONTENT_W, cardH).fill('#FFFFFF')
        doc.rect(MARGIN, cy, CONTENT_W, cardH).strokeColor(LINE).lineWidth(0.6).stroke()
        doc.rect(MARGIN, cy, 3, cardH).fill(clr)

        // Header band
        doc.fillOpacity(0.08).rect(MARGIN + 3, cy, CONTENT_W - 3, 24).fill(clr).fillOpacity(1)
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10)
          .text(txt(ticket.type), MARGIN + 10, cy + 5, { width: CONTENT_W - 200, lineBreak: false, ellipsis: true })
        doc.fillColor(clr).font('Helvetica-Bold').fontSize(6.5)
          .text(categoryLabel(category).toUpperCase(), MARGIN + 10, cy + 16, { width: 200, lineBreak: false })
        doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(7)
          .text(`${ticket.status === 'PAID' ? 'PAID' : 'PURCHASED'}`, MARGIN, cy + 6,
            { width: CONTENT_W - 10, align: 'right', lineBreak: false })
        doc.fillColor('#94A3B8').font('Helvetica').fontSize(6.5)
          .text(ticketCode(ticket.id), MARGIN, cy + 16, { width: CONTENT_W - 10, align: 'right', lineBreak: false })

        let cursor = cy + 24

        // Reference — the part a guest actually needs at the counter
        if (ticket.reference) {
          doc.fillOpacity(0.06).rect(MARGIN + 10, cursor + 3, CONTENT_W - 20, 22).fill(clr).fillOpacity(1)
          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6)
            .text('CONFIRMATION / REFERENCE', MARGIN + 16, cursor + 6, { width: 160, lineBreak: false })
          doc.fillColor(clr).font('Helvetica-Bold').fontSize(12)
            .text(txt(ticket.reference), MARGIN + 16, cursor + 13, { width: CONTENT_W - 160, lineBreak: false })
          const admits = paxLabel(meta.pax ?? ticket.qty, meta.paxType)
          if (admits) {
            doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8)
              .text(`Admits ${admits}`, MARGIN, cursor + 11, { width: CONTENT_W - 16, align: 'right', lineBreak: false })
          }
          cursor += refH
        }

        // Fact grid
        facts.forEach((fact, i) => {
          const fx = MARGIN + 10 + (i % COLS) * colW
          const fy = cursor + Math.floor(i / COLS) * 22 + 2
          doc.fillColor('#94A3B8').font('Helvetica-Bold').fontSize(6)
            .text(fact.label.toUpperCase(), fx, fy, { width: colW - 8, lineBreak: false })
          doc.fillColor(DARK).font('Helvetica-Bold').fontSize(8.5)
            .text(sanitizeText(fact.value), fx, fy + 8, { width: colW - 8, lineBreak: false, ellipsis: true })
        })
        cursor += factsH

        if (remarkH > 0) {
          doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5)
            .text(remark, MARGIN + 10, cursor + 2, { width: CONTENT_W - 20 })
          cursor += remarkH
        }

        // Supplier scan, or a line explaining that this card *is* the ticket
        if (image) {
          const ix = MARGIN + (CONTENT_W - image.width) / 2
          try {
            doc.image(image.buffer, ix, cursor + 8, { width: image.width, height: image.height })
            doc.rect(ix, cursor + 8, image.width, image.height).strokeColor(LINE).lineWidth(0.5).stroke()
          } catch { /* undecodable scan — the drawn card still stands alone */ }
        } else {
          const isPdfFile = ticketFileKind(ticket) === 'pdf'
          doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(7.5)
            .text(
              isPdfFile
                ? `Supplier ticket attached as PDF${ticket.fileName ? ` (${sanitizeText(ticket.fileName)})` : ''} — present the reference above at the counter.`
                : 'No supplier scan on file — this voucher, with the reference above, is your ticket.',
              MARGIN + 10, cursor + 6, { width: CONTENT_W - 20, lineBreak: false, ellipsis: true },
            )
        }

        doc.y = cy + cardH + 8
      })
    }

    // ── Emergency contacts ─────────────────────────────────────────────────
    // Resigned staff are filtered out of the guest-facing PDF — the booking's
    // own rows still carry them. See `lib/emergency-contacts.ts`.
    const emergencyContacts = withoutRetiredContacts(booking.emergencyContacts ?? [])
    if (emergencyContacts.length > 0) {
      sectionTitle('Emergency Contacts')
      emergencyContacts.forEach(ec => {
        ensureSpace(16)
        const ey = doc.y
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(8.5)
          .text(txt(ec.name), MARGIN + 6, ey, { width: 160, lineBreak: false })
        doc.fillColor(DARK).font('Helvetica').fontSize(8.5)
          .text(txt(ec.phone), MARGIN + 172, ey, { width: 130, lineBreak: false })
        if (ec.role) {
          doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
            .text(txt(ec.role), MARGIN + 308, ey + 0.5, { width: CONTENT_W - 314, lineBreak: false })
        }
        doc.y = ey + 13
      })
      doc.moveDown(0.4)
    }

    // ── Package details & notes ────────────────────────────────────────────
    const hasNotes = !!(booking.packageIncludes || booking.packageExcludes || booking.terms
      || booking.exclusions || booking.importantNotes || booking.tips
      || booking.clientRequest || booking.amendmentNote || booking.otherNote || booking.policyNotes)

    if (hasNotes) {
      sectionTitle('Package Details & Notes')
      noteBlock('Amendment Note',              booking.amendmentNote,  BRAND)
      noteBlock('Client Request',              booking.clientRequest,  BLUE)
      noteBlock('Above Package Includes',      booking.packageIncludes, '#16A34A')
      noteBlock('The Above Package Excludes',  booking.packageExcludes, RED)
      noteBlock('Terms & Conditions',          booking.terms,          PURPLE)
      noteBlock('Exclusions',                  booking.exclusions,     '#EA580C')
      noteBlock('Important Notes',             booking.importantNotes, RED)
      noteBlock('Tips',                        booking.tips,           '#0891B2')
      noteBlock('Policy Notes',                booking.policyNotes,    PURPLE)
      noteBlock('Other Note',                  booking.otherNote,      MUTED)
    }

    // ── Footer on every page ───────────────────────────────────────────────
    const printedAt = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      const fy = PAGE_H - 28
      doc.moveTo(MARGIN, fy - 6).lineTo(PAGE_W - MARGIN, fy - 6)
        .strokeColor(LINE).lineWidth(0.5).stroke()
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
        .text(`Apple Holidays Booking System — Confidential  ·  ${ref}`, MARGIN, fy, { width: CONTENT_W / 2, lineBreak: false })
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(7)
        .text(`Printed: ${printedAt}   ·   Page ${i - range.start + 1} of ${range.count}`,
          MARGIN, fy, { width: CONTENT_W, align: 'right', lineBreak: false })
    }

    doc.end()
  })
}
