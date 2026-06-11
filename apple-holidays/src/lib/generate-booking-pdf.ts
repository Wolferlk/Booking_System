// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit')

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateBookingPdf(booking: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const doc = new PDFDocument({ margin: 50, size: 'A4' })

    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const BRAND  = '#D97706'  // amber-600
    const DARK   = '#1E293B'  // slate-800
    const MUTED  = '#64748B'  // slate-500
    const LIGHT  = '#F8FAFC'  // slate-50
    const LINE   = '#E2E8F0'  // slate-200

    function sectionHeader(title: string) {
      doc.moveDown(0.5)
      doc.rect(50, doc.y, 495, 20).fill(BRAND)
      doc.fillColor('white').fontSize(10).font('Helvetica-Bold')
         .text(title.toUpperCase(), 58, doc.y - 17)
      doc.fillColor(DARK).moveDown(0.8)
    }

    function row(label: string, value: string, yOffset = 0) {
      const y = doc.y + yOffset
      doc.fontSize(9).font('Helvetica-Bold').fillColor(MUTED).text(label, 55, y, { width: 130 })
      doc.fontSize(9).font('Helvetica').fillColor(DARK).text(value || '—', 190, y, { width: 355 })
      doc.moveDown(0.5)
    }

    function divider() {
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(LINE).lineWidth(0.5).stroke()
      doc.moveDown(0.3)
    }

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 80).fill(DARK)
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
       .text('Apple Holidays', 50, 20)
    doc.fontSize(9).font('Helvetica').fillColor('#94A3B8')
       .text('MMT Vietnam · Tour Confirmation', 50, 48)
    doc.fillColor(BRAND).fontSize(18).font('Helvetica-Bold')
       .text(booking.bookingRef, 430, 25, { align: 'right', width: 115 })
    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
       .text(booking.status?.replace(/_/g, ' '), 430, 48, { align: 'right', width: 115 })
    doc.y = 100

    // ── Booking Summary ───────────────────────────────────────────────────────
    sectionHeader('Booking Summary')
    row('Agent / Operator', booking.agent ?? '')
    row('File Handler',     booking.fileHandler ?? '')
    row('Agent Booking ID', booking.agentBookingId ?? '')
    row('Arrival',          fmt(booking.arrivalDate))
    row('Departure',        fmt(booking.departureDate))
    row('Pax',              `${booking.paxAdults ?? 0} Adults, ${booking.paxChildren ?? 0} Children`)
    row('Total',            booking.quotedTotal ? `${booking.currency ?? 'USD'} ${Number(booking.quotedTotal).toLocaleString()}` : '—')

    // ── Passengers ────────────────────────────────────────────────────────────
    if ((booking.passengers ?? []).length > 0) {
      sectionHeader('Passengers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      booking.passengers.forEach((p: any, i: number) => {
        const label = `${i + 1}. ${p.isLead ? '(Lead) ' : ''}${p.name}`
        doc.fontSize(9).font(p.isLead ? 'Helvetica-Bold' : 'Helvetica').fillColor(DARK)
           .text(label, 55, doc.y, { continued: true })
        doc.fillColor(MUTED).text(`  ${p.type ?? ''}`, { align: 'right', width: 440 })
        doc.moveDown(0.4)
      })
    }

    // ── Flights ───────────────────────────────────────────────────────────────
    if ((booking.flights ?? []).length > 0) {
      sectionHeader('Flights')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      booking.flights.forEach((f: any) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
           .text(`${f.flightNo}`, 55, doc.y, { continued: true, width: 80 })
        doc.font('Helvetica').fillColor(DARK)
           .text(`  ${f.fromApt} ${f.depTime ?? ''}  →  ${f.toApt} ${f.arrTime ?? ''}`, { continued: true, width: 280 })
        doc.fillColor(MUTED).text(fmt(f.date), { align: 'right', width: 130 })
        doc.moveDown(0.4)
      })
    }

    // ── Accommodation ─────────────────────────────────────────────────────────
    if ((booking.accommodations ?? []).length > 0) {
      sectionHeader('Accommodation')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      booking.accommodations.forEach((a: any) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(DARK)
           .text(a.hotel, 55, doc.y, { width: 300 })
        doc.font('Helvetica').fillColor(MUTED)
           .text(`${a.city}  ·  ${fmt(a.checkIn)} → ${fmt(a.checkOut)}  ·  ${a.nights ?? ''} night${a.nights !== 1 ? 's' : ''}${a.roomType ? `  ·  ${a.roomType}` : ''}`, 55, doc.y, { width: 490 })
        doc.moveDown(0.5)
      })
    }

    // ── Emergency Contacts ────────────────────────────────────────────────────
    if ((booking.emergencyContacts ?? []).length > 0) {
      sectionHeader('Emergency Contacts')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      booking.emergencyContacts.forEach((ec: any) => {
        row(ec.role ?? 'Contact', `${ec.name}${ec.phone ? '  ·  ' + ec.phone : ''}`)
      })
    }

    // ── Tour Movement Chart ────────────────────────────────────────────────────
    const items = booking.tourAgenda?.items ?? []
    if (items.length > 0) {
      sectionHeader('Tour Movement Chart')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items.forEach((item: any) => {
        if (doc.y > 700) doc.addPage()
        doc.fontSize(8).font('Helvetica-Bold').fillColor(BRAND)
           .text(fmt(item.date), 55, doc.y, { width: 80 })
        doc.font('Helvetica-Bold').fillColor(DARK)
           .text(item.location ?? '', 140, doc.y - doc.currentLineHeight(), { width: 200 })
        if (item.serviceType && item.serviceType !== 'OWN_ARRANGEMENT') {
          doc.fillColor(MUTED).fontSize(7)
             .text(item.serviceType.replace(/_/g, ' '), 345, doc.y - doc.currentLineHeight(), { width: 100 })
        }
        if (item.meetingTime) {
          doc.fillColor(MUTED).fontSize(7)
             .text(`Meet: ${item.meetingTime}`, 450, doc.y - doc.currentLineHeight(), { width: 90, align: 'right' })
        }
        if (item.details) {
          doc.moveDown(0.2)
          doc.fontSize(8).font('Helvetica').fillColor(MUTED)
             .text(item.details, 140, doc.y, { width: 405 })
        }
        if (item.mealPlan) {
          doc.fontSize(7).fillColor('#059669').text(`Meals: ${item.mealPlan}`, 140, doc.y, { width: 200 })
        }
        divider()
      })
    }

    // ── Terms & Conditions ─────────────────────────────────────────────────────
    if (booking.terms) {
      if (doc.y > 600) doc.addPage()
      sectionHeader('Terms & Conditions')
      doc.fontSize(8).font('Helvetica').fillColor(MUTED)
         .text(booking.terms, 55, doc.y, { width: 490, lineGap: 2 })
      doc.moveDown()
    }

    if (booking.exclusions) {
      sectionHeader('Exclusions')
      doc.fontSize(8).font('Helvetica').fillColor(MUTED)
         .text(booking.exclusions, 55, doc.y, { width: 490, lineGap: 2 })
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const pages = doc.bufferedPageRange()
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i)
      doc.fontSize(7).fillColor(MUTED)
         .text(
           `Apple Holidays · MMT Vietnam · ${booking.bookingRef} · Page ${i + 1} of ${pages.count} · Generated ${new Date().toLocaleString('en-GB')}`,
           50, 820, { width: 495, align: 'center' },
         )
    }

    doc.end()
  })
}
