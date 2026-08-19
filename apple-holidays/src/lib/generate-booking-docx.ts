/**
 * Word (.docx) twins of the customer-facing booking PDFs.
 *
 * Mirrors `generate-booking-pdf.ts` section for section, so the desk can send
 * either format from the booking "Send via WhatsApp" / email modal:
 *   • generateConfirmationDocx  → Send 1 · Tour Confirmation (no drivers/tickets)
 *   • generateFullDetailsDocx   → Send 2 · Full Details + Drivers & Vouchers
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle,
  ShadingType, TableLayoutType, VerticalAlign, ImageRun, PageBreak,
} from 'docx'
import {
  readLocalUploadAsBuffer, readUploadAsBuffer, getDocxImageType,
  imageDimensions, fitImage,
} from './local-upload'
import { withoutRetiredContacts } from './emergency-contacts'
import { serviceTypeShortLabel } from './service-types'

// ── Colours (same palette as the PDF) ────────────────────────────────────────
const CLR = {
  amber:  'D97706',
  dark:   '0F172A',
  slate:  '1E293B',
  mid:    '334155',
  muted:  '64748B',
  green:  '059669',
  red:    'DC2626',
  white:  'FFFFFF',
  rowAlt: 'F8FAFC',
  hotel:  'FFF7ED',
  driver: 'EFF6FF',
  line:   'E2E8F0',
}

type Photo = { buffer: Buffer; type: 'jpg' | 'png' | 'gif' | 'bmp' }

function fmt(d: string | Date | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

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
  } catch { /* plain text */ }
  return notes
}

// ── Building blocks ──────────────────────────────────────────────────────────

function sectionTitle(title: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 21, color: CLR.dark, font: 'Arial' })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
    spacing: { before: 220, after: 90 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: CLR.amber } },
  })
}

/** Label → value line; skipped entirely when the value is blank (matches infoRow). */
function infoRow(label: string, value: string | null | undefined): Paragraph[] {
  if (value === null || value === undefined || value === '') return []
  return [new Paragraph({
    children: [
      new TextRun({ text: `${label}:  `, bold: true, size: 17, color: CLR.muted, font: 'Arial' }),
      new TextRun({ text: String(value), size: 18, color: CLR.slate, font: 'Arial' }),
    ],
    spacing: { after: 40 },
  })]
}

function hCell(text: string): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 16, color: CLR.white, font: 'Arial' })],
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.slate },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
  })
}

function dCell(text: string, opts?: { bold?: boolean; color?: string; shade?: string }): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: text || '—',
        bold: opts?.bold,
        color: opts?.color ?? CLR.slate,
        size: 17,
        font: 'Arial',
      })],
    })],
    shading: opts?.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 55, bottom: 55, left: 80, right: 80 },
  })
}

/** Coloured bar used as a sub-heading inside a section (hotel name, day, ticket). */
function bar(text: string, fill: string, color = CLR.dark, size = 19): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size, color, font: 'Arial' })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill },
    spacing: { before: 120, after: 60 },
  })
}

function body(text: string, opts?: { color?: string; italic?: boolean; size?: number }): Paragraph[] {
  return String(text).split(/\r?\n/).filter(l => l.trim()).map(line => new Paragraph({
    children: [new TextRun({
      text: line.trim(),
      size: opts?.size ?? 17,
      color: opts?.color ?? CLR.slate,
      italics: opts?.italic,
      font: 'Arial',
    })],
    spacing: { after: 40 },
  }))
}

// ── Core builder ─────────────────────────────────────────────────────────────

async function buildDocx(booking: any, includeDriversAndTickets: boolean): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []

  // ── Header ────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Apple Holidays', bold: true, size: 36, color: CLR.dark, font: 'Arial' }),
      new TextRun({ text: '   Vietnam · Tour Operations', size: 18, color: CLR.muted, font: 'Arial' }),
    ],
    spacing: { after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: CLR.amber } },
  }))

  children.push(new Paragraph({
    children: [
      new TextRun({ text: booking.bookingRef ?? '', bold: true, size: 32, color: CLR.amber, font: 'Courier New' }),
      new TextRun({ text: `   ${(booking.status ?? '').replace(/_/g, ' ')}`, size: 17, color: CLR.muted, font: 'Arial' }),
    ],
    spacing: { before: 80, after: 40 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({
      text: includeDriversAndTickets ? 'FULL TOUR DETAILS & VOUCHERS' : 'TOUR CONFIRMATION',
      bold: true, size: 30, color: CLR.amber, font: 'Arial',
    })],
    spacing: { before: 120, after: 40 },
  }))

  children.push(new Paragraph({
    children: [new TextRun({
      text: `${fmt(booking.arrivalDate)} – ${fmt(booking.departureDate)}  ·  `
        + `${booking.paxAdults ?? 0} Adults${booking.paxChildren ? `, ${booking.paxChildren} Children` : ''}`,
      size: 18, color: CLR.muted, font: 'Arial',
    })],
    spacing: { after: 80 },
  }))

  // ── 1. Booking Summary ────────────────────────────────────────────────────
  children.push(sectionTitle('Booking Summary'))
  children.push(
    ...infoRow('Booking Reference', booking.bookingRef),
    ...infoRow('Status', (booking.status ?? '').replace(/_/g, ' ')),
    ...infoRow('Arrival', fmt(booking.arrivalDate)),
    ...infoRow('Departure', fmt(booking.departureDate)),
    ...infoRow('Passengers', `${booking.paxAdults ?? 0} Adults, ${booking.paxChildren ?? 0} Children`),
    ...infoRow('Agent Booking ID', booking.agentBookingId),
  )

  // ── 2. Agent / Tour Operator ──────────────────────────────────────────────
  children.push(sectionTitle('Agent / Tour Operator'))
  children.push(
    ...infoRow('Agent / Operator', booking.agent),
    ...infoRow('File Handler', booking.fileHandler),
    ...infoRow('Agent Booking ID', booking.agentBookingId),
    ...infoRow('Agent Email', booking.agentEmail),
    ...infoRow('Agent Phone', booking.agentPhone),
    ...infoRow('Agent WhatsApp', booking.agentWhatsapp),
    ...infoRow('Agent Country', booking.agentCountry),
  )

  // ── 2b. Lead Guest / Tourist Contact ──────────────────────────────────────
  if (booking.contactEmail || booking.contactPhone || booking.contactWhatsapp || booking.contactCountry) {
    children.push(sectionTitle('Lead Guest / Tourist Contact'))
    children.push(
      ...infoRow('Email', booking.contactEmail),
      ...infoRow('Phone', booking.contactPhone),
      ...infoRow('WhatsApp', booking.contactWhatsapp),
      ...infoRow('Country / Nationality', booking.contactCountry),
      ...infoRow('Address', booking.contactAddress),
    )
  }

  // ── 3. Passenger Details ──────────────────────────────────────────────────
  const passengers: any[] = booking.passengers ?? []
  if (passengers.length > 0) {
    children.push(sectionTitle('Passenger Details'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: ['#', 'Full Name', 'Type'].map(h => hCell(h)) }),
        ...passengers.map((p, i) => {
          const shade = i % 2 === 0 ? CLR.white : CLR.rowAlt
          return new TableRow({
            children: [
              dCell(String(i + 1), { shade }),
              dCell(`${p.name}${p.isLead ? ' ★' : ''}`, { bold: Boolean(p.isLead), shade }),
              dCell(p.type ?? '—', { color: CLR.muted, shade }),
            ],
          })
        }),
      ],
    }))
  }

  // ── 3b. Emergency Contacts ────────────────────────────────────────────────
  // Resigned staff never reach the guest — see `lib/emergency-contacts.ts`.
  const emergencyContacts: any[] = withoutRetiredContacts(booking.emergencyContacts ?? [])
  if (emergencyContacts.length > 0) {
    children.push(sectionTitle('Emergency Contacts'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: ['Name', 'Role', 'Phone'].map(h => hCell(h)) }),
        ...emergencyContacts.map((ec, i) => {
          const shade = i % 2 === 0 ? CLR.white : CLR.rowAlt
          return new TableRow({
            children: [
              dCell(ec.name ?? '—', { bold: true, shade }),
              dCell(ec.role ?? '—', { color: CLR.muted, shade }),
              dCell(ec.phone ?? '—', { bold: true, color: CLR.green, shade }),
            ],
          })
        }),
      ],
    }))
  }

  // ── 4. Accommodation ──────────────────────────────────────────────────────
  const accommodations: any[] = booking.accommodations ?? []
  if (accommodations.length > 0) {
    children.push(sectionTitle('Accommodation'))
    accommodations.forEach((a, idx) => {
      children.push(bar(`${idx + 1}.  ${a.hotel}`, CLR.hotel))
      children.push(
        ...infoRow('City', a.city),
        ...infoRow('Check-in', fmt(a.checkIn)),
        ...infoRow('Check-out', fmt(a.checkOut)),
        ...infoRow('Nights', a.nights != null ? `${a.nights} night${a.nights !== 1 ? 's' : ''}` : undefined),
        ...infoRow('Room Type', a.roomType),
        ...infoRow('Meal Plan', a.mealType),
        ...infoRow('Address', a.address),
        ...infoRow('Contact', a.contact),
      )
    })
  }

  // ── 5. Flights ────────────────────────────────────────────────────────────
  const flights: any[] = booking.flights ?? []
  if (flights.length > 0) {
    children.push(sectionTitle('Flights'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: ['Flight', 'Date', 'Route', 'Airline / Notes'].map(h => hCell(h)) }),
        ...flights.map((f, i) => {
          const shade = i % 2 === 0 ? CLR.white : CLR.rowAlt
          return new TableRow({
            children: [
              dCell(f.flightNo ?? '—', { bold: true, color: CLR.amber, shade }),
              dCell(fmt(f.date), { shade }),
              dCell(`${f.fromApt ?? ''} ${f.depTime ?? ''} → ${f.toApt ?? ''} ${f.arrTime ?? ''}`.replace(/\s+/g, ' ').trim(), { shade }),
              dCell([f.airline, f.notes].filter(Boolean).join(' · ') || '—', { color: CLR.muted, shade }),
            ],
          })
        }),
      ],
    }))
  }

  // ── 6. Itinerary — Day-by-Day Programme ───────────────────────────────────
  const itineraryItems: any[] = booking.itineraryItems ?? []
  if (itineraryItems.length > 0) {
    children.push(sectionTitle('Itinerary — Day-by-Day Programme'))
    itineraryItems.forEach(item => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `Day ${item.dayNo}`, bold: true, size: 19, color: CLR.amber, font: 'Arial' }),
          new TextRun({ text: `   ${item.title ?? ''}`, bold: true, size: 19, color: CLR.white, font: 'Arial' }),
          new TextRun({ text: `   ${fmt(item.date)}`, size: 16, color: 'CBD5E1', font: 'Arial' }),
        ],
        shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.slate },
        spacing: { before: 140, after: 60 },
      }))
      if (item.description) children.push(...body(item.description))
      if (item.inclusions) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '✓ Included:  ', bold: true, size: 16, color: CLR.green, font: 'Arial' }),
            new TextRun({ text: item.inclusions, size: 17, color: CLR.slate, font: 'Arial' }),
          ],
          spacing: { after: 40 },
        }))
      }
      if (item.exclusions) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: '✗ Excluded:  ', bold: true, size: 16, color: CLR.red, font: 'Arial' }),
            new TextRun({ text: item.exclusions, size: 17, color: CLR.slate, font: 'Arial' }),
          ],
          spacing: { after: 40 },
        }))
      }
    })
  }

  // ── 7. Tour Agenda — Activity Schedule ────────────────────────────────────
  const agendaItems: any[] = booking.tourAgenda?.items ?? []
  if (agendaItems.length > 0) {
    children.push(sectionTitle('Tour Agenda — Activity Schedule'))
    agendaItems.forEach(item => {
      const svc = item.serviceType && item.serviceType !== 'OWN_ARRANGEMENT'
        ? serviceTypeShortLabel(item.serviceType)
        : ''
      children.push(new Paragraph({
        children: [
          new TextRun({ text: fmt(item.date), bold: true, size: 18, color: CLR.amber, font: 'Arial' }),
          new TextRun({ text: `   ${item.location ?? ''}`, bold: true, size: 18, color: CLR.slate, font: 'Arial' }),
          ...(svc ? [new TextRun({ text: `   ${svc}`, size: 15, color: CLR.muted, font: 'Arial' })] : []),
          ...(item.meetingTime ? [new TextRun({ text: `   Meet: ${item.meetingTime}`, size: 15, color: CLR.muted, font: 'Arial' })] : []),
        ],
        spacing: { before: 100, after: 30 },
      }))
      if (item.details) children.push(...body(item.details, { color: CLR.mid }))
      if (item.mealPlan) {
        children.push(new Paragraph({
          children: [new TextRun({ text: `Meals: ${item.mealPlan}`, bold: true, size: 16, color: CLR.green, font: 'Arial' })],
          spacing: { after: 40 },
        }))
      }
    })
  }

  // ── 8. Drivers (Full document only) ───────────────────────────────────────
  if (includeDriversAndTickets) {
    const assignments = agendaItems
      .filter(item => item.assignment?.driverName || item.assignment?.driver?.name)
      .map(item => ({
        date:            item.date,
        location:        item.location,
        driverName:      item.assignment.driverName ?? item.assignment.driver?.name,
        driverPhone:     item.assignment.driverPhone ?? item.assignment.driver?.phone,
        vehicleType:     item.assignment.vehicleType ?? item.assignment.driver?.vehicle?.type,
        vehiclePlate:    item.assignment.vehiclePlate,
        notes:           item.assignment.notes,
        driverPhotoUrl:  item.assignment.driver?.photoUrl ?? null,
        vehiclePhotoUrl: item.assignment.driver?.vehicle?.photoOutside ?? null,
      }))

    if (assignments.length > 0) {
      // docx can't embed an image mid-build, so resolve every photo up front.
      const photoUrls = Array.from(new Set(
        assignments.flatMap(a => [a.driverPhotoUrl, a.vehiclePhotoUrl]).filter((u): u is string => Boolean(u)),
      ))
      const photos = new Map<string, Photo>()
      await Promise.all(photoUrls.map(async url => {
        const type = getDocxImageType(url)
        if (!type) return
        const buffer = await readLocalUploadAsBuffer(url)
        if (buffer) photos.set(url, { buffer, type })
      }))

      children.push(sectionTitle('Drivers & Vehicle Assignments'))
      assignments.forEach((a, i) => {
        children.push(bar(
          `Assignment ${i + 1}  ·  ${fmt(a.date)}${a.location ? `  ·  ${a.location}` : ''}`,
          CLR.driver,
        ))
        const driverPhoto = a.driverPhotoUrl ? photos.get(a.driverPhotoUrl) : null
        if (driverPhoto) {
          children.push(new Paragraph({
            children: [new ImageRun({ data: driverPhoto.buffer, transformation: { width: 48, height: 48 }, type: driverPhoto.type })],
            spacing: { after: 40 },
          }))
        }
        children.push(
          ...infoRow('Driver Name', a.driverName),
          ...infoRow('Driver Phone', a.driverPhone),
          ...infoRow('Vehicle Type', a.vehicleType),
          ...infoRow('Plate Number', a.vehiclePlate),
          ...infoRow('Notes', a.notes),
        )
        const vehiclePhoto = a.vehiclePhotoUrl ? photos.get(a.vehiclePhotoUrl) : null
        if (vehiclePhoto) {
          children.push(new Paragraph({
            children: [new ImageRun({
              data: vehiclePhoto.buffer,
              transformation: fitImage(imageDimensions(vehiclePhoto.buffer), { width: 150, height: 100 }),
              type: vehiclePhoto.type,
            })],
            spacing: { after: 60 },
          }))
        }
      })
    }
  }

  // ── 9. Tickets & Vouchers (Full document only) ────────────────────────────
  if (includeDriversAndTickets) {
    const tickets: any[] = (booking.tickets ?? []).filter((t: any) => t.activated === true || t.fileUrl || t.reference)
    if (tickets.length > 0) {
      children.push(sectionTitle('Tickets & Vouchers Summary'))
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({ children: ['#', 'Ticket', 'Supplier · Reference · Status'].map(h => hCell(h)) }),
          ...tickets.map((t, i) => {
            const shade = i % 2 === 0 ? CLR.white : CLR.rowAlt
            const meta = [t.supplier, t.reference, t.status?.replace(/_/g, ' ')].filter(Boolean).join('  ·  ')
            return new TableRow({
              children: [
                dCell(String(i + 1), { color: CLR.muted, shade }),
                dCell(t.type ?? 'Ticket', { bold: true, shade }),
                dCell(meta || '—', { color: CLR.muted, shade }),
              ],
            })
          }),
        ],
      }))

      // Receipt scans, resolved up front for the same reason as driver photos.
      const ticketImages = new Map<string, Photo & { size: { width: number; height: number } }>()
      await Promise.all(tickets.map(async t => {
        if (!t.fileUrl) return
        const type = getDocxImageType(t.fileUrl)
        if (!type) return
        const buffer = await readUploadAsBuffer(t.fileUrl)
        if (!buffer) return
        ticketImages.set(t.id, { buffer, type, size: fitImage(imageDimensions(buffer), { width: 430, height: 460 }) })
      }))

      // Then each ticket on its own page, matching the PDF.
      for (const ticket of tickets) {
        children.push(new Paragraph({ children: [new PageBreak()] }))
        children.push(new Paragraph({
          children: [new TextRun({ text: ticket.type ?? 'Ticket / Voucher', bold: true, size: 26, color: CLR.white, font: 'Arial' })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.slate },
          spacing: { after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: CLR.amber } },
        }))
        children.push(
          ...infoRow('Supplier', ticket.supplier),
          ...infoRow('Quantity', String(ticket.qty ?? 1)),
          ...infoRow('Reference No.', ticket.reference),
          ...infoRow('Status', ticket.status?.replace(/_/g, ' ')),
          ...infoRow('Purchased On', ticket.purchasedAt ? fmt(ticket.purchasedAt) : undefined),
          ...infoRow('Total Cost', ticket.totalCost
            ? `${ticket.currency ?? 'USD'} ${Number(ticket.totalCost).toLocaleString()}`
            : undefined),
          ...infoRow('Notes', parseTicketNotes(ticket.notes)),
        )

        if (ticket.fileUrl) {
          children.push(new Paragraph({
            children: [new TextRun({ text: 'RECEIPT / VOUCHER IMAGE', bold: true, size: 17, color: CLR.muted, font: 'Arial' })],
            spacing: { before: 140, after: 60 },
          }))
          const img = ticketImages.get(ticket.id)
          if (img) {
            children.push(new Paragraph({
              children: [new ImageRun({ data: img.buffer, transformation: img.size, type: img.type })],
              alignment: AlignmentType.CENTER,
            }))
          } else {
            // Non-image receipts (PDF scans) can't be embedded — name the file instead.
            children.push(...infoRow('Receipt File', ticket.fileName ?? ticket.fileUrl))
          }
        }
      }
    }
  }

  // ── 10. Terms & Conditions ────────────────────────────────────────────────
  if (booking.terms) {
    children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(sectionTitle('Terms & Conditions'))
    children.push(...body(booking.terms))
  }

  // ── 11. Exclusions ────────────────────────────────────────────────────────
  if (booking.exclusions) {
    if (!booking.terms) children.push(new Paragraph({ children: [new PageBreak()] }))
    children.push(sectionTitle('Not Included — Exclusions'))
    children.push(...body(booking.exclusions))
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Apple Holidays  ·  Vietnam  ·  Ref: ${booking.bookingRef}  ·  ${new Date().toLocaleString('en-GB')}`,
      size: 14, color: CLR.muted, font: 'Arial',
    })],
    alignment: AlignmentType.CENTER,
    spacing: { before: 240 },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: CLR.line } },
  }))

  const doc = new Document({
    creator: 'Apple Holidays Booking System',
    title:   `${includeDriversAndTickets ? 'Full Tour Details' : 'Tour Confirmation'} — ${booking.bookingRef}`,
    subject: 'Booking Confirmation',
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}

// ── Public exports ───────────────────────────────────────────────────────────

/** Word 1 – Tour Confirmation (no drivers / tickets) */
export async function generateConfirmationDocx(booking: any): Promise<Buffer> {
  return buildDocx(booking, false)
}

/** Word 2 – Full Tour Details with Drivers & Vouchers */
export async function generateFullDetailsDocx(booking: any): Promise<Buffer> {
  return buildDocx(booking, true)
}
