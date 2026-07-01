import { mkdir, copyFile, readdir, readFile } from 'fs/promises'
import path from 'path'

// ── Constants ────────────────────────────────────────────────────────────────
const HEADER_BG = '#0F172A'
const BRAND     = '#D97706'
const DARK      = '#1E293B'
const MUTED     = '#64748B'
const LINE      = '#E2E8F0'
const GREEN     = '#059669'
const PAGE_W    = 595
const MARGIN    = 50
const CONTENT_W = PAGE_W - MARGIN * 2

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── PDFKit boot ──────────────────────────────────────────────────────────────
let pdfkitDataReady: Promise<void> | null = null

async function ensurePdfkitDataFiles() {
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

async function loadPdfDocumentCtor() {
  const mod = await import('pdfkit')
  return (mod as typeof mod & { default?: unknown }).default ?? mod
}

// ── Asset loaders ────────────────────────────────────────────────────────────
async function loadLogo(): Promise<Buffer | null> {
  for (const name of ['aahaslogo.png', 'aahaas.png', 'chat-logo.png']) {
    try {
      return await readFile(path.join(process.cwd(), 'public', 'png', name))
    } catch { continue }
  }
  return null
}

async function resolveTicketImage(fileUrl: string | null | undefined): Promise<Buffer | null> {
  if (!fileUrl) return null
  const rel = fileUrl.startsWith('/') ? fileUrl.slice(1) : fileUrl
  try {
    return await readFile(path.join(process.cwd(), 'public', rel))
  } catch {
    return null
  }
}

// ── Note parser ──────────────────────────────────────────────────────────────
// Ticket notes may be stored as "{json} · Client: ... · PNL Item #...".
// Extract the remarks text from the JSON prefix so raw JSON isn't shown.
function parseTicketNotes(notes: string | null | undefined): string {
  if (!notes) return ''
  const sepIdx = notes.indexOf('} · ')
  if (sepIdx !== -1) {
    const jsonPart = notes.slice(0, sepIdx + 1)
    const suffix   = notes.slice(sepIdx + 4)
    let remarks = ''
    try {
      const parsed = JSON.parse(jsonPart)
      remarks = typeof parsed?.remarks === 'string' ? parsed.remarks : ''
    } catch { remarks = jsonPart }
    return [remarks, suffix].filter(Boolean).join(' · ')
  }
  try {
    const parsed = JSON.parse(notes)
    if (parsed && typeof parsed === 'object' && 'remarks' in parsed) return String(parsed.remarks)
  } catch {}
  return notes
}

// ── Core builder ─────────────────────────────────────────────────────────────
async function buildPdf(booking: any, includeDriversAndTickets: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    void (async () => {
      await ensurePdfkitDataFiles()
      const PDFDocument = await loadPdfDocumentCtor()
      const logo = await loadLogo()

      const chunks: Buffer[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = new (PDFDocument as any)({
        margin: MARGIN,
        size: 'A4',
        bufferPages: true,
        autoFirstPage: true,
      })

      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // ── Helpers ──────────────────────────────────────────────────────────

      function drawPageHeader() {
        doc.rect(0, 0, PAGE_W, 78).fill(HEADER_BG)

        let nameX = 18
        if (logo) {
          try {
            doc.image(logo, 12, 9, { height: 58, fit: [58, 58] })
            nameX = 85
          } catch { /* logo unsupported */ }
        }

        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(17)
          .text('Apple Holidays', nameX, 17, { lineBreak: false })
        doc.fillColor('#CBD5E1').font('Helvetica').fontSize(8)
          .text('Vietnam  ·  Tour Operations', nameX, 40, { lineBreak: false })

        doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(14)
          .text(booking.bookingRef, MARGIN, 17, { width: CONTENT_W, align: 'right', lineBreak: false })
        doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
          .text((booking.status ?? '').replace(/_/g, ' '), MARGIN, 40, { width: CONTENT_W, align: 'right', lineBreak: false })

        doc.rect(0, 78, PAGE_W, 3).fill(BRAND)
        doc.y = 95
      }

      function sectionTitle(title: string) {
        if (doc.y > 730) {
          doc.addPage()
          doc.y = MARGIN
        }
        doc.moveDown(0.5)
        const sy = doc.y
        doc.rect(MARGIN, sy, 4, 20).fill(BRAND)
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
          .text(title.toUpperCase(), MARGIN + 10, sy + 3, { width: CONTENT_W - 10 })
        doc.moveDown(0.3)
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
          .strokeColor(LINE).lineWidth(0.5).stroke()
        doc.moveDown(0.4)
      }

      function infoRow(label: string, value: string | null | undefined) {
        if (value === null || value === undefined || value === '') return
        if (doc.y > 760) { doc.addPage(); doc.y = MARGIN }
        const ry = doc.y
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
          .text(label, MARGIN + 5, ry, { width: 135, lineBreak: false })
        doc.font('Helvetica').fontSize(9).fillColor(DARK)
          .text(String(value), MARGIN + 145, ry, { width: CONTENT_W - 145 })
        doc.moveDown(0.45)
      }

      function divider() {
        if (doc.y > 760) return
        doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y)
          .strokeColor(LINE).lineWidth(0.3).stroke()
        doc.moveDown(0.3)
      }

      // ── Page 1 ────────────────────────────────────────────────────────────
      drawPageHeader()

      // Document title block
      const docTitle = includeDriversAndTickets
        ? 'FULL TOUR DETAILS & VOUCHERS'
        : 'TOUR CONFIRMATION'

      doc.moveDown(0.4)
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(15)
        .text(docTitle, MARGIN, doc.y)
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(
          `${fmt(booking.arrivalDate)} – ${fmt(booking.departureDate)}  ·  `
          + `${booking.paxAdults ?? 0} Adults${booking.paxChildren ? ', ' + booking.paxChildren + ' Children' : ''}`,
          MARGIN, doc.y,
        )
      doc.moveDown(0.4)
      doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(BRAND).lineWidth(1.2).stroke()
      doc.moveDown(0.7)

      // ── 1. Booking Summary ────────────────────────────────────────────────
      sectionTitle('Booking Summary')
      infoRow('Booking Reference', booking.bookingRef)
      infoRow('Status', (booking.status ?? '').replace(/_/g, ' '))
      infoRow('Arrival', fmt(booking.arrivalDate))
      infoRow('Departure', fmt(booking.departureDate))
      infoRow('Passengers', `${booking.paxAdults ?? 0} Adults, ${booking.paxChildren ?? 0} Children`)
      if (booking.agentBookingId) infoRow('Agent Booking ID', booking.agentBookingId)

      // ── 2. Agent / Tour Operator ──────────────────────────────────────────
      sectionTitle('Agent / Tour Operator')
      infoRow('Agent / Operator', booking.agent)
      infoRow('File Handler', booking.fileHandler)
      infoRow('Agent Booking ID', booking.agentBookingId)
      infoRow('Agent Email', booking.agentEmail)
      infoRow('Agent Phone', booking.agentPhone)
      infoRow('Agent WhatsApp', booking.agentWhatsapp)
      if (booking.agentCountry) infoRow('Agent Country', booking.agentCountry)

      // ── 2b. Lead Guest / Tourist Contact ─────────────────────────────────
      if (booking.contactEmail || booking.contactPhone || booking.contactWhatsapp || booking.contactCountry) {
        sectionTitle('Lead Guest / Tourist Contact')
        infoRow('Email', booking.contactEmail)
        infoRow('Phone', booking.contactPhone)
        infoRow('WhatsApp', booking.contactWhatsapp)
        infoRow('Country / Nationality', booking.contactCountry)
        if (booking.contactAddress) infoRow('Address', booking.contactAddress)
      }

      // ── 3. Passenger Details ──────────────────────────────────────────────
      const passengers: any[] = booking.passengers ?? []
      if (passengers.length > 0) {
        sectionTitle('Passenger Details')

        // Table header
        if (doc.y > 760) { doc.addPage(); doc.y = MARGIN }
        const thY = doc.y
        doc.rect(MARGIN, thY, CONTENT_W, 17).fill('#1E293B')
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#94A3B8')
        doc.text('#',         MARGIN + 5,   thY + 4, { width: 18, lineBreak: false })
        doc.text('FULL NAME', MARGIN + 26,  thY + 4, { width: 280, lineBreak: false })
        doc.text('TYPE',      MARGIN + 310, thY + 4, { width: 100, lineBreak: false })
        doc.y = thY + 20

        passengers.forEach((p: any, i: number) => {
          if (doc.y > 755) { doc.addPage(); doc.y = MARGIN }
          const py = doc.y
          if (i % 2 === 0) doc.rect(MARGIN, py, CONTENT_W, 16).fill('#F8FAFC')
          doc.font(p.isLead ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(DARK)
          doc.text(`${i + 1}`, MARGIN + 5, py + 3, { width: 18, lineBreak: false })
          doc.text(`${p.name}${p.isLead ? ' ★' : ''}`, MARGIN + 26, py + 3, { width: 280, lineBreak: false })
          doc.font('Helvetica').fillColor(MUTED).fontSize(8.5)
          doc.text(p.type ?? '', MARGIN + 310, py + 3, { width: 100, lineBreak: false })
          doc.y = py + 17
        })
        doc.moveDown(0.5)
      }

      // ── 3b. Emergency Contacts ────────────────────────────────────────────
      const emergencyContacts: any[] = booking.emergencyContacts ?? []
      if (emergencyContacts.length > 0) {
        sectionTitle('Emergency Contacts')
        emergencyContacts.forEach((ec: any) => {
          if (doc.y > 760) { doc.addPage(); doc.y = MARGIN }
          const ey = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
            .text(ec.name ?? '—', MARGIN + 5, ey, { width: 200, lineBreak: false })
          if (ec.role) {
            doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
              .text(ec.role, MARGIN + 210, ey, { width: 120, lineBreak: false })
          }
          if (ec.phone) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#059669')
              .text(ec.phone, MARGIN + 210, ey, { width: CONTENT_W - 215, align: 'right', lineBreak: false })
          }
          doc.moveDown(0.5)
          divider()
        })
      }

      // ── 4. Accommodation ──────────────────────────────────────────────────
      const accommodations: any[] = booking.accommodations ?? []
      if (accommodations.length > 0) {
        sectionTitle('Accommodation')
        accommodations.forEach((a: any, idx: number) => {
          if (doc.y > 730) { doc.addPage(); doc.y = MARGIN }

          const ay = doc.y
          doc.rect(MARGIN, ay, CONTENT_W, 18).fill('#FFF7ED')
          doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK)
            .text(`${idx + 1}.  ${a.hotel}`, MARGIN + 8, ay + 4, { width: CONTENT_W - 16, lineBreak: false })
          doc.y = ay + 22

          infoRow('City', a.city)
          infoRow('Check-in', fmt(a.checkIn))
          infoRow('Check-out', fmt(a.checkOut))
          infoRow('Nights', a.nights != null ? `${a.nights} night${a.nights !== 1 ? 's' : ''}` : undefined)
          infoRow('Room Type', a.roomType)
          infoRow('Meal Plan', a.mealType)
          if (a.address) infoRow('Address', a.address)
          if (a.contact) infoRow('Contact', a.contact)
          doc.moveDown(0.4)
        })
      }

      // ── 5. Flights ────────────────────────────────────────────────────────
      const flights: any[] = booking.flights ?? []
      if (flights.length > 0) {
        sectionTitle('Flights')
        flights.forEach((f: any) => {
          if (doc.y > 750) { doc.addPage(); doc.y = MARGIN }
          const fy = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(f.flightNo, MARGIN + 5, fy, { width: 70, lineBreak: false })
          doc.font('Helvetica').fillColor(DARK).fontSize(9)
            .text(
              `${f.fromApt}  ${f.depTime ?? ''}  →  ${f.toApt}  ${f.arrTime ?? ''}`,
              MARGIN + 80, fy, { width: 265, lineBreak: false },
            )
          doc.fillColor(MUTED).fontSize(8.5)
            .text(fmt(f.date), MARGIN + 80, fy, { width: CONTENT_W - 80, align: 'right', lineBreak: false })
          doc.moveDown(0.5)
          if (f.airline || f.notes) {
            const note = [f.airline, f.notes].filter(Boolean).join('  ·  ')
            doc.font('Helvetica').fontSize(8).fillColor(MUTED)
              .text(note, MARGIN + 80, doc.y, { width: CONTENT_W - 85 })
            doc.moveDown(0.2)
          }
          divider()
        })
      }

      // ── 6. Itinerary — Day-by-Day Programme ──────────────────────────────
      const itineraryItems: any[] = booking.itineraryItems ?? []
      if (itineraryItems.length > 0) {
        sectionTitle('Itinerary — Day-by-Day Programme')
        itineraryItems.forEach((item: any) => {
          if (doc.y > 720) { doc.addPage(); doc.y = MARGIN }

          const iy = doc.y
          doc.rect(MARGIN, iy, CONTENT_W, 19).fill(DARK)
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(`Day ${item.dayNo}`, MARGIN + 6, iy + 5, { width: 50, lineBreak: false })
          doc.fillColor('#FFFFFF')
            .text(item.title ?? '', MARGIN + 62, iy + 5, { width: CONTENT_W - 130, lineBreak: false })
          doc.fillColor('#94A3B8').font('Helvetica').fontSize(8)
            .text(fmt(item.date), MARGIN + 62, iy + 5, { width: CONTENT_W - 70, align: 'right', lineBreak: false })
          doc.y = iy + 24

          if (item.description) {
            doc.font('Helvetica').fontSize(8.5).fillColor(DARK)
              .text(item.description, MARGIN + 8, doc.y, { width: CONTENT_W - 16, lineGap: 1.5 })
            doc.moveDown(0.3)
          }
          if (item.inclusions) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN)
              .text('✓  Included:', MARGIN + 8, doc.y, { lineBreak: false })
            doc.font('Helvetica').fillColor(DARK)
              .text('  ' + item.inclusions, { continued: false, width: CONTENT_W - 16 })
            doc.moveDown(0.2)
          }
          if (item.exclusions) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#DC2626')
              .text('✗  Excluded:', MARGIN + 8, doc.y, { lineBreak: false })
            doc.font('Helvetica').fillColor(DARK)
              .text('  ' + item.exclusions, { continued: false, width: CONTENT_W - 16 })
            doc.moveDown(0.2)
          }
          doc.moveDown(0.5)
        })
      }

      // ── 7. Tour Agenda — Activity Schedule ───────────────────────────────
      const agendaItems: any[] = booking.tourAgenda?.items ?? []
      if (agendaItems.length > 0) {
        sectionTitle('Tour Agenda — Activity Schedule')
        agendaItems.forEach((item: any) => {
          if (doc.y > 715) { doc.addPage(); doc.y = MARGIN }

          const ay = doc.y
          doc.font('Helvetica-Bold').fontSize(9).fillColor(BRAND)
            .text(fmt(item.date), MARGIN + 5, ay, { width: 90, lineBreak: false })
          doc.fillColor(DARK)
            .text(item.location ?? '', MARGIN + 100, ay, { width: 195, lineBreak: false })

          if (item.serviceType && item.serviceType !== 'OWN_ARRANGEMENT') {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
              .text(item.serviceType.replace(/_/g, ' '), MARGIN + 300, ay, { width: 115, lineBreak: false })
          }
          if (item.meetingTime) {
            doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
              .text(`Meet: ${item.meetingTime}`, MARGIN, ay, { width: CONTENT_W, align: 'right', lineBreak: false })
          }
          doc.moveDown(0.35)

          if (item.details) {
            doc.font('Helvetica').fontSize(8.5).fillColor('#334155')
              .text(item.details, MARGIN + 100, doc.y, { width: CONTENT_W - 105, lineGap: 1.5 })
            doc.moveDown(0.3)
          }
          if (item.mealPlan) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN)
              .text(`Meals: ${item.mealPlan}`, MARGIN + 100, doc.y, { width: CONTENT_W - 105 })
            doc.moveDown(0.2)
          }
          divider()
        })
      }

      // ── 8. Drivers (Full PDF only) ────────────────────────────────────────
      if (includeDriversAndTickets) {
        const assignments = agendaItems
          .filter((item: any) => item.assignment?.driverName || item.assignment?.driver?.name)
          .map((item: any) => ({
            date:         item.date,
            location:     item.location,
            driverName:   item.assignment.driverName ?? item.assignment.driver?.name,
            driverPhone:  item.assignment.driverPhone ?? item.assignment.driver?.phone,
            vehicleType:  item.assignment.vehicleType,
            vehiclePlate: item.assignment.vehiclePlate,
            notes:        item.assignment.notes,
          }))

        if (assignments.length > 0) {
          sectionTitle('Drivers & Vehicle Assignments')
          assignments.forEach((a: any, i: number) => {
            if (doc.y > 750) { doc.addPage(); doc.y = MARGIN }

            const ay = doc.y
            doc.rect(MARGIN, ay, CONTENT_W, 16).fill('#EFF6FF')
            doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
              .text(`Assignment ${i + 1}  ·  ${fmt(a.date)}${a.location ? '  ·  ' + a.location : ''}`,
                MARGIN + 8, ay + 3, { width: CONTENT_W - 16, lineBreak: false })
            doc.y = ay + 20

            infoRow('Driver Name', a.driverName)
            infoRow('Driver Phone', a.driverPhone)
            infoRow('Vehicle Type', a.vehicleType)
            infoRow('Plate Number', a.vehiclePlate)
            if (a.notes) infoRow('Notes', a.notes)
            doc.moveDown(0.3)
            divider()
          })
        }
      }

      // ── 9. Tickets & Vouchers (Full PDF only) ─────────────────────────────
      if (includeDriversAndTickets) {
        const tickets: any[] = (booking.tickets ?? []).filter((t: any) => t.activated === true || t.fileUrl || t.reference)
        if (tickets.length > 0) {
          // First: overview page
          sectionTitle('Tickets & Vouchers Summary')
          tickets.forEach((t: any, i: number) => {
            if (doc.y > 730) { doc.addPage(); doc.y = MARGIN }
            const name = t.type ?? 'Ticket'
            const meta = [t.supplier, t.reference, t.status?.replace(/_/g, ' ')].filter(Boolean).join('  ·  ')
            const startY = doc.y
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
              .text(`${i + 1}.`, MARGIN + 5, startY, { width: 20, lineBreak: false })
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK)
              .text(name, MARGIN + 26, startY, { width: CONTENT_W - 31 })
            if (meta) {
              doc.font('Helvetica').fontSize(8).fillColor(MUTED)
                .text(meta, MARGIN + 26, doc.y, { width: CONTENT_W - 31 })
            }
            doc.moveDown(0.3)
            divider()
          })

          // Then each ticket on its own page
          for (const ticket of tickets) {
            doc.addPage()
            doc.y = MARGIN + 5

            // Ticket page header bar
            doc.rect(MARGIN, doc.y, CONTENT_W, 32).fill(DARK)
            doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
              .text(ticket.type ?? 'Ticket / Voucher', MARGIN + 10, doc.y + 9, { width: CONTENT_W - 20, lineBreak: false })
            doc.y = doc.y + 38

            doc.rect(MARGIN, doc.y, CONTENT_W, 3).fill(BRAND)
            doc.y = doc.y + 10

            infoRow('Supplier', ticket.supplier)
            infoRow('Quantity', String(ticket.qty ?? 1))
            infoRow('Reference No.', ticket.reference)
            infoRow('Status', ticket.status?.replace(/_/g, ' '))
            infoRow('Purchased On', ticket.purchasedAt ? fmt(ticket.purchasedAt) : undefined)
            infoRow('Total Cost',
              ticket.totalCost
                ? `${ticket.currency ?? 'USD'} ${Number(ticket.totalCost).toLocaleString()}`
                : undefined,
            )
            if (ticket.notes) infoRow('Notes', parseTicketNotes(ticket.notes))

            // Receipt / voucher image
            if (ticket.fileUrl) {
              const imgBuf = await resolveTicketImage(ticket.fileUrl)
              doc.moveDown(0.8)
              doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED)
                .text('RECEIPT / VOUCHER IMAGE', MARGIN + 5, doc.y)
              doc.moveDown(0.4)

              if (imgBuf) {
                try {
                  const maxH = 842 - doc.y - 70
                  if (maxH > 40) {
                    doc.image(imgBuf, MARGIN + 5, doc.y, {
                      fit: [CONTENT_W - 10, Math.min(maxH, 520)],
                      align: 'center',
                    })
                  }
                } catch { /* unsupported format */
                  infoRow('Receipt File', ticket.fileName ?? ticket.fileUrl)
                }
              } else {
                infoRow('Receipt File', ticket.fileName ?? ticket.fileUrl)
              }
            }
          }
        }
      }

      // ── 10. Terms & Conditions ─────────────────────────────────────────────
      if (booking.terms) {
        doc.addPage()
        doc.y = MARGIN
        sectionTitle('Terms & Conditions')
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK)
          .text(booking.terms, MARGIN + 5, doc.y, { width: CONTENT_W - 10, lineGap: 2 })
        doc.moveDown()
      }

      // ── 11. Exclusions ────────────────────────────────────────────────────
      if (booking.exclusions) {
        if (!booking.terms) { doc.addPage(); doc.y = MARGIN }
        sectionTitle('Not Included — Exclusions')
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK)
          .text(booking.exclusions, MARGIN + 5, doc.y, { width: CONTENT_W - 10, lineGap: 2 })
      }

      // ── Footer on every page ──────────────────────────────────────────────
      const range = doc.bufferedPageRange()
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i)
        doc.moveTo(MARGIN, 820).lineTo(PAGE_W - MARGIN, 820)
          .strokeColor(LINE).lineWidth(0.5).stroke()
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(
            `Apple Holidays  ·  Vietnam  ·  Ref: ${booking.bookingRef}`
            + `  ·  Page ${i + 1} of ${range.count}`
            + `  ·  ${new Date().toLocaleString('en-GB')}`,
            MARGIN, 824, { width: CONTENT_W, align: 'center' },
          )
      }

      doc.end()
    })().catch(reject)
  })
}

// ── Public exports ───────────────────────────────────────────────────────────

/** PDF 1 – Tour Confirmation (no drivers / tickets) */
export async function generateConfirmationPdf(booking: any): Promise<Buffer> {
  return buildPdf(booking, false)
}

/** PDF 2 – Full Tour Details with Drivers & Vouchers */
export async function generateFullDetailsPdf(booking: any): Promise<Buffer> {
  return buildPdf(booking, true)
}

/** Backwards-compatible alias → generates confirmation PDF */
export async function generateBookingPdf(booking: any): Promise<Buffer> {
  return generateConfirmationPdf(booking)
}
