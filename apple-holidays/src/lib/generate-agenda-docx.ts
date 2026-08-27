/**
 * Builds the Movement Chart agenda as a Word (.docx) document.
 *
 * Lives in lib/ rather than in the route because the same document is also
 * attached to WhatsApp / e-mail sends from `agenda/send` when the desk picks
 * the Word format.
 */
import { prisma } from '@/lib/prisma'
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, TableLayoutType, VerticalAlign, ImageRun,
} from 'docx'
import {
  readLocalUploadAsBuffer, readUploadAsBuffer, getDocxImageType,
  imageDimensions, fitImage,
} from '@/lib/local-upload'
import {
  PURCHASED_TICKET_STATUSES, parseTicketNotes, ticketFacts, ticketCode,
  ticketFileKind, categoryIcon, categoryLabel, paxLabel,
} from '@/lib/ticket-notes'
import { resolveIsLeisure } from '@/lib/leisure-day'
import { resolveIsHotelOnly } from '@/lib/driver-requirement'
import { withoutRetiredContacts } from '@/lib/emergency-contacts'
import { SERVICE_TYPE_LABELS } from '@/lib/service-types'
import { range12h, to12h } from '@/lib/clock-time'
import { flightLine, linkFlight, transferDescription, type LinkableFlight } from '@/lib/agenda-flight-link'

const MEAL_ABBREV: Record<string, string> = {
  'B': 'Breakfast', 'L': 'Lunch', 'D': 'Dinner',
  'BL': 'Breakfast, Lunch',   'LB': 'Breakfast, Lunch',
  'BD': 'Breakfast, Dinner',  'DB': 'Breakfast, Dinner',
  'LD': 'Lunch, Dinner',      'DL': 'Lunch, Dinner',
  'BLD': 'Breakfast, Lunch, Dinner', 'BDL': 'Breakfast, Lunch, Dinner',
  'LBD': 'Breakfast, Lunch, Dinner',
}
function normalizeMealPlan(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '—'
  const upper = raw.trim().toUpperCase().replace(/[\s,/]+/g, '')
  return MEAL_ABBREV[upper] ?? raw.trim()
}

function formatDate(raw: string | Date | null | undefined): string {
  if (!raw) return '—'
  const d = typeof raw === 'string' ? new Date(raw) : raw
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const SVC_LABEL: Record<string, string> = SERVICE_TYPE_LABELS

// ── Colour constants ──────────────────────────────────────────────────────────
const CLR = {
  amber:   'D97706',
  dark:    '0F172A',
  mid:     '334155',
  muted:   '94A3B8',
  blue:    '2563EB',
  green:   '059669',
  red:     'DC2626',
  violet:  '7C3AED',
  white:   'FFFFFF',
  rowAlt:  'F8FAFC',
  rowHead: '334155',
  sectionBg: 'F1F5F9',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 16, color: CLR.white, font: 'Arial' })],
    })],
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.rowHead },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    ...(width ? { width: { size: width, type: WidthType.DXA } } : {}),
  })
}

function dCell(text: string, opts?: { bold?: boolean; color?: string; italic?: boolean; shade?: string }): TableCell {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({
        text: text || '—',
        bold: opts?.bold,
        italics: opts?.italic,
        color: opts?.color ?? CLR.dark,
        size: 17,
        font: 'Arial',
      })],
    })],
    shading: opts?.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 55, bottom: 55, left: 80, right: 80 },
  })
}

// Driver/vehicle cell — same look as dCell, plus a small driver photo when available.
function driverCell(
  text: string,
  opts?: {
    italic?: boolean; color?: string; shade?: string
    photo?: { buffer: Buffer; type: 'jpg' | 'png' | 'gif' | 'bmp' } | null
  },
): TableCell {
  const paragraphs: Paragraph[] = []
  if (opts?.photo) {
    paragraphs.push(new Paragraph({
      children: [new ImageRun({ data: opts.photo.buffer, transformation: { width: 26, height: 26 }, type: opts.photo.type })],
      spacing: { after: 20 },
    }))
  }
  paragraphs.push(new Paragraph({
    children: [new TextRun({
      text: text || '—',
      italics: opts?.italic,
      color: opts?.color ?? CLR.dark,
      size: 17,
      font: 'Arial',
    })],
  }))
  return new TableCell({
    children: paragraphs,
    shading: opts?.shade ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 55, bottom: 55, left: 80, right: 80 },
  })
}

function sectionHeading(icon: string, label: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${icon}  ${label}`, bold: true, size: 20, color: CLR.dark, font: 'Arial' }),
    ],
    spacing: { before: 240, after: 60 },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.sectionBg },
    border: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: CLR.amber },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
    },
  })
}

function kv(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 17, color: CLR.muted, font: 'Arial' }),
      new TextRun({ text: value || '—', size: 18, color: CLR.dark, font: 'Arial' }),
    ],
    spacing: { after: 40 },
  })
}

function noteBlock(icon: string, label: string, content: string): Paragraph[] {
  if (!content?.trim()) return []
  return [
    new Paragraph({
      children: [new TextRun({ text: `${icon} ${label}`, bold: true, size: 18, color: CLR.amber, font: 'Arial' })],
      spacing: { before: 160, after: 40 },
    }),
    ...content.split('\n').filter(l => l.trim()).map(line => new Paragraph({
      children: [new TextRun({ text: line.trim(), size: 17, color: CLR.mid, font: 'Arial' })],
      spacing: { after: 30 },
    })),
  ]
}

// ── Generator ─────────────────────────────────────────────────────────────────

/**
 * @param ref          booking reference
 * @param showDrivers  when false, the driver column and the ground-transport
 *                     roster are dropped — the customer-facing variant.
 * @throws when the booking does not exist
 */
export async function generateAgendaDocx(ref: string, showDrivers = true): Promise<Buffer> {
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: ref },
    include: {
      passengers:      true,
      flights:         { orderBy: { date: 'asc' } },
      accommodations:  { orderBy: { checkIn: 'asc' } },
      emergencyContacts: true,
      // Drafts never reach a customer document — only tickets actually bought.
      tickets: {
        where: { activated: true, status: { in: [...PURCHASED_TICKET_STATUSES] } },
        include: {
          pnlLine: { select: { activity: true, paymentRefNumber: true, category: true } },
          agendaItem: { select: { date: true, location: true, toPoint: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: {
              assignment: {
                include: {
                  driver: { include: { vehicle: true } },
                  vendor: { select: { id: true, name: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!booking) throw new Error('Booking not found')

  const items   = booking.tourAgenda?.items ?? []
  const lead    = booking.passengers.find(p => p.isLead) ?? booking.passengers[0]
  const totalPax = booking.paxAdults + booking.paxChildren + (booking.paxInfants ?? 0)

  const children: (Paragraph | Table)[] = []

  // ── HEADER ────────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Apple Holidays', bold: true, size: 36, color: CLR.dark, font: 'Arial' }),
        new TextRun({ text: '  —  Movement Chart & Booking Summary', size: 22, color: CLR.muted, font: 'Arial' }),
      ],
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: CLR.amber } },
    }),
  )

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: ref, bold: true, size: 36, color: CLR.amber, font: 'Courier New' }),
        new TextRun({ text: `   ${formatDate(booking.arrivalDate)} — ${formatDate(booking.departureDate)}`, size: 18, color: CLR.muted, font: 'Arial' }),
        new TextRun({ text: `   ${totalPax} pax (${booking.paxAdults} adult${booking.paxAdults !== 1 ? 's' : ''}${booking.paxChildren > 0 ? `, ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}${(booking.paxInfants ?? 0) > 0 ? `, ${booking.paxInfants} infant${(booking.paxInfants ?? 0) !== 1 ? 's' : ''}` : ''})`, size: 18, color: CLR.muted, font: 'Arial' }),
      ],
      spacing: { before: 80, after: 40 },
    }),
  )

  // ── BOOKING SUMMARY STRIP ─────────────────────────────────────────────────
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          children: [
            dCell((booking as any).agent ?? '—', { bold: true }),
            dCell((booking as any).fileHandler ?? '—', { bold: true }),
            dCell((booking as any).tourDestination ?? '—', { bold: true }),
            dCell(lead?.name ?? '—', { bold: true }),
          ],
        }),
        new TableRow({
          children: [
            hCell('Tour Operator / Agent'),
            hCell('File Handler'),
            hCell('Destination'),
            hCell('Lead Passenger'),
          ],
        }),
      ],
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    }),
  )

  children.push(new Paragraph({ text: '', spacing: { after: 100 } }))

  // ── CONTACT INFO ──────────────────────────────────────────────────────────
  const contactPhone    = (booking as any).contactPhone    as string | null
  const contactWhatsapp = (booking as any).contactWhatsapp as string | null
  const contactEmail    = (booking as any).contactEmail    as string | null
  if (contactPhone || contactWhatsapp || contactEmail) {
    children.push(sectionHeading('📞', 'Contact Information'))
    if (contactPhone)    children.push(kv('Customer Phone', contactPhone))
    if (contactWhatsapp) children.push(kv('Customer WhatsApp', contactWhatsapp))
    if (contactEmail)    children.push(kv('Customer Email', contactEmail))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── PASSENGERS ────────────────────────────────────────────────────────────
  if (booking.passengers.length > 0) {
    children.push(sectionHeading('👥', `Passengers — ${booking.paxAdults} adult${booking.paxAdults !== 1 ? 's' : ''}${booking.paxChildren > 0 ? ` · ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}${(booking.paxInfants ?? 0) > 0 ? ` · ${booking.paxInfants} infant${(booking.paxInfants ?? 0) !== 1 ? 's' : ''}` : ''}`))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          children: ['Name', 'Type', 'Contact', 'Meal Preference'].map(h => hCell(h)),
        }),
        ...booking.passengers.map((p, i) => new TableRow({
          children: [
            dCell(p.name + (p.isLead ? ' [LEAD]' : ''), { bold: true, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(p.type ?? 'ADULT', { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(p.contact ?? '—', { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(p.mealPreference ?? '—', { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
          ],
        })),
      ],
    }))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── FLIGHTS ───────────────────────────────────────────────────────────────
  if (booking.flights.length > 0) {
    children.push(sectionHeading('✈️', `Flights — ${booking.flights.length} segment${booking.flights.length !== 1 ? 's' : ''}`))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          children: ['Flight No.', 'Date', 'From', 'Dep.', 'To', 'Arr.'].map(h => hCell(h)),
        }),
        ...booking.flights.map((f, i) => new TableRow({
          children: [
            dCell(f.flightNo,          { bold: true, color: CLR.blue,  shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(formatDate(f.date),  { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(f.fromApt,           { bold: true, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(to12h(f.depTime) || '—', { color: CLR.green, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(f.toApt,             { bold: true, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(to12h(f.arrTime) || '—', { color: CLR.red,   shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
          ],
        })),
      ],
    }))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── ACCOMMODATIONS ────────────────────────────────────────────────────────
  if (booking.accommodations.length > 0) {
    children.push(sectionHeading('🏨', `Accommodation — ${booking.accommodations.length} hotel${booking.accommodations.length !== 1 ? 's' : ''}`))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({
          // Address and hotel phone are their own column: guests show this row
          // to a taxi driver, and a hotel name alone is not an address.
          // Explicit widths (twips, summing to the A4 content width of 10106):
          // eight even columns would have starved the address, which is the one
          // column that carries a full line of text.
          children: ([
            ['Hotel', 1700], ['City', 950], ['Check-in', 950], ['Check-out', 950],
            ['Nights', 550], ['Room', 1100], ['Meal Plan', 950], ['Address & Contact', 2956],
          ] as [string, number][]).map(([h, w]) => hCell(h, w)),
        }),
        ...booking.accommodations.map((a, i) => new TableRow({
          children: [
            dCell(a.hotel,                  { bold: true, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(a.city,                   { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(formatDate(a.checkIn),    { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(formatDate(a.checkOut),   { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(String(a.nights),         { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(a.roomType ?? '—',        { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(a.mealType ?? '—',        { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(
              [a.address?.trim(), a.contact?.trim() ? `Tel: ${a.contact.trim()}` : null]
                .filter(Boolean).join(' · ') || '—',
              { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt },
            ),
          ],
        })),
      ],
    }))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── MOVEMENT CHART ────────────────────────────────────────────────────────
  if (items.length > 0) {
    children.push(sectionHeading('🗓️', `Movement Chart — ${items.length} item${items.length !== 1 ? 's' : ''}`))

    // Pre-fetch driver/vehicle photo buffers (docx image embedding can't happen mid-build, so resolve up front)
    const photoUrls = Array.from(new Set(
      items.flatMap(i => [i.assignment?.driver?.photoUrl, i.assignment?.driver?.vehicle?.photoOutside])
        .filter((u): u is string => Boolean(u)),
    ))
    const driverPhotos = new Map<string, { buffer: Buffer; type: 'jpg' | 'png' | 'gif' | 'bmp' }>()
    await Promise.all(photoUrls.map(async url => {
      const type = getDocxImageType(url)
      if (!type) return
      const buffer = await readLocalUploadAsBuffer(url)
      if (buffer) driverPhotos.set(url, { buffer, type })
    }))

    // Group by date
    const grouped: Record<string, typeof items> = {}
    items.forEach(item => {
      const key = item.date ? new Date(item.date).toISOString().slice(0, 10) : 'unknown'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(item)
    })

    for (const [date, dayItems] of Object.entries(grouped)) {
      // Day header row
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `📅  ${formatDate(date)}`, bold: true, size: 20, color: CLR.white, font: 'Arial' }),
            new TextRun({ text: `   ${dayItems[0]?.location ?? ''}`, size: 18, color: 'CBD5E1', font: 'Arial' }),
          ],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.mid },
          spacing: { before: 120, after: 0 },
        }),
      )

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({
            children: [
              'From', 'To / Activity', 'Meal', 'Meet Time', 'Service',
              ...(showDrivers ? ['Driver / Vehicle'] : []),
            ].map(h => hCell(h)),
          }),
          ...dayItems.map((item, idx) => {
            const a = item.assignment
            const svc = item.serviceType

            const displayVendorName   = a?.vendorName   ?? a?.vendor?.name   ?? null
            const displayDriverName   = a?.driverName   ?? a?.driver?.name   ?? null
            const displayDriverPhone  = a?.driverPhone  ?? a?.driver?.phone  ?? null
            const displayVehicleType  = a?.vehicleType  ?? a?.driver?.vehicle?.type    ?? null
            const displayVehiclePlate = a?.vehiclePlate ?? a?.driver?.vehicle?.plateNo ?? null

            // 12-hour with AM/PM — the stored value is 24-hour, but a guest
            // reading "3:45" on a departure row cannot tell morning from
            // afternoon. See lib/clock-time.ts.
            let meetDisplay = '—'
            if (svc === 'SIC_TRANSFER' && (item.timeFrom || item.timeTo)) {
              meetDisplay = range12h(item.timeFrom, item.timeTo)
            } else if (item.meetingTime) {
              meetDisplay = to12h(item.meetingTime)
            }

            // The flight this row serves, matched live off booking.flights —
            // nothing is stored on the item, so an airline reschedule reaches
            // this document as soon as the flight row is corrected.
            const link = linkFlight(item, booking.flights as LinkableFlight[])

            // Leisure and hotel-only days carry no driver by design — say so
            // rather than printing "Not assigned", which reads as an operational gap.
            const isLeisure   = resolveIsLeisure(item)
            const isHotelOnly = resolveIsHotelOnly(item)
            const noDriver    = isLeisure || isHotelOnly

            let driverText = noDriver ? 'No driver required' : 'Not assigned'
            if (noDriver) {
              // no allocation to render
            } else if (displayVendorName) {
              driverText = displayVendorName
              if (displayDriverName) driverText += ` · ${displayDriverName}`
              if (displayDriverPhone) driverText += ` (${displayDriverPhone})`
              if (displayVehiclePlate) driverText += ` — ${displayVehicleType ?? ''} ${displayVehiclePlate}`.trim()
            } else if (displayDriverName) {
              driverText = displayDriverName
              if (displayDriverPhone) driverText += ` (${displayDriverPhone})`
              if (displayVehiclePlate) driverText += ` — ${displayVehicleType ?? ''} ${displayVehiclePlate}`.trim()
            }

            const shade = idx % 2 === 0 ? CLR.white : CLR.rowAlt
            const driverPhoto = a?.driver?.photoUrl ? driverPhotos.get(a.driver.photoUrl) ?? null : null

            const rows: TableCell[] = [
              dCell(item.fromPoint || '—', { shade }),
              dCell(item.toPoint   || '—', { bold: true, shade }),
              dCell(normalizeMealPlan(item.mealPlan), { shade }),
              dCell(meetDisplay, { bold: meetDisplay !== '—', color: meetDisplay !== '—' ? CLR.green : CLR.muted, shade }),
              dCell(isHotelOnly ? 'Hotel Only' : isLeisure ? 'Leisure Day' : SVC_LABEL[svc] ?? svc, { shade }),
            ]

            if (showDrivers) {
              rows.push(driverCell(driverText, {
                italic: noDriver || driverText === 'Not assigned',
                color: noDriver || driverText === 'Not assigned' ? CLR.muted : undefined,
                shade,
                photo: noDriver ? null : driverPhoto,
              }))
            }

            const rowCells = [new TableRow({ children: rows })]

            // Flight sub-row — the sector and, for a transfer, the pickup rule
            // that follows from its departure time.
            if (link) {
              const transfer = transferDescription(link)
              rowCells.push(new TableRow({
                children: [new TableCell({
                  columnSpan: showDrivers ? 6 : 5,
                  children: [new Paragraph({
                    children: [
                      new TextRun({
                        text: flightLine(link.flight),
                        size: 15, color: CLR.blue, font: 'Arial', bold: true,
                      }),
                      ...(transfer ? [new TextRun({
                        text: `  ${transfer}`,
                        size: 15, color: CLR.mid, font: 'Arial',
                      })] : []),
                    ],
                    spacing: { before: 40, after: 40 },
                  })],
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF2FF' },
                  margins: { top: 60, bottom: 60, left: 120, right: 80 },
                })],
              }))
            }

            // Details sub-row
            if (item.details?.trim()) {
              rowCells.push(new TableRow({
                children: [new TableCell({
                  columnSpan: showDrivers ? 6 : 5,
                  children: [new Paragraph({
                    children: [new TextRun({
                      text: item.details,
                      size: 16,
                      color: CLR.mid,
                      font: 'Arial',
                      italics: true,
                    })],
                    spacing: { before: 40, after: 40 },
                  })],
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' },
                  margins: { top: 60, bottom: 60, left: 120, right: 80 },
                })],
              }))
            }

            return rowCells
          }).flat(),
        ],
      }))
      children.push(new Paragraph({ text: '', spacing: { after: 60 } }))
    }

    // ── GROUND TRANSPORT ROSTER ──────────────────────────────────────────────
    const seenAssignments = new Set<string>()
    const roster = items
      .map(i => i.assignment)
      .filter((a): a is NonNullable<typeof items[number]['assignment']> => {
        if (!a) return false
        const name = a.driverName ?? a.driver?.name
        const vendor = a.vendorName ?? a.vendor?.name
        if (!name && !vendor) return false
        const key = a.driver?.id ?? `${vendor ?? ''}|${name ?? ''}|${a.vehiclePlate ?? ''}`
        if (seenAssignments.has(key)) return false
        seenAssignments.add(key)
        return true
      })

    if (showDrivers && roster.length > 0) {
      children.push(sectionHeading('🚐', 'Ground Transport Roster'))
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({ children: ['Driver', 'Contact', 'Vendor', 'Vehicle', 'Photo'].map(h => hCell(h)) }),
          ...roster.map((a, i) => {
            const shade = i % 2 === 0 ? CLR.white : CLR.rowAlt
            const name         = a.driverName ?? a.driver?.name ?? '—'
            const phone        = a.driverPhone ?? a.driver?.phone ?? '—'
            const vendor       = a.vendorName ?? a.vendor?.name ?? '—'
            const vehicleType  = a.vehicleType ?? a.driver?.vehicle?.type ?? ''
            const vehiclePlate = a.vehiclePlate ?? a.driver?.vehicle?.plateNo ?? ''
            const vehicleText  = [vehicleType, vehiclePlate].filter(Boolean).join(' ') || '—'
            const driverPhoto  = a.driver?.photoUrl ? driverPhotos.get(a.driver.photoUrl) ?? null : null
            const vehiclePhoto = a.driver?.vehicle?.photoOutside ? driverPhotos.get(a.driver.vehicle.photoOutside) ?? null : null

            const photoCellChildren: Paragraph[] = []
            if (driverPhoto) {
              photoCellChildren.push(new Paragraph({
                children: [new ImageRun({ data: driverPhoto.buffer, transformation: { width: 32, height: 32 }, type: driverPhoto.type })],
              }))
            }
            if (vehiclePhoto) {
              photoCellChildren.push(new Paragraph({
                children: [new ImageRun({ data: vehiclePhoto.buffer, transformation: { width: 60, height: 40 }, type: vehiclePhoto.type })],
                spacing: { before: 20 },
              }))
            }
            if (photoCellChildren.length === 0) {
              photoCellChildren.push(new Paragraph({ children: [new TextRun({ text: '—', color: CLR.muted, size: 17, font: 'Arial' })] }))
            }

            return new TableRow({
              children: [
                dCell(name,        { bold: true, shade }),
                dCell(phone,       { shade }),
                dCell(vendor,      { shade }),
                dCell(vehicleText, { shade }),
                new TableCell({
                  children: photoCellChildren,
                  shading: { type: ShadingType.CLEAR, color: 'auto', fill: shade },
                  verticalAlign: VerticalAlign.CENTER,
                  margins: { top: 55, bottom: 55, left: 80, right: 80 },
                }),
              ],
            })
          }),
        ],
      }))
      children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
    }
  }

  // ── PURCHASED TICKETS & VOUCHERS ──────────────────────────────────────────
  const purchasedTickets = booking.tickets ?? []
  if (purchasedTickets.length > 0) {
    children.push(sectionHeading('🎟️', `Purchased Tickets & Vouchers — ${purchasedTickets.length} confirmed`))

    // docx can't embed an image mid-build, so resolve every scan up front.
    const ticketImages = new Map<string, { buffer: Buffer; type: 'jpg' | 'png' | 'gif' | 'bmp'; size: { width: number; height: number } }>()
    await Promise.all(purchasedTickets.map(async t => {
      if (!t.fileUrl || ticketFileKind(t) !== 'image') return
      const type = getDocxImageType(t.fileUrl)
      if (!type) return
      const buffer = await readUploadAsBuffer(t.fileUrl)
      if (!buffer) return
      ticketImages.set(t.id, {
        buffer, type,
        size: fitImage(imageDimensions(buffer), { width: 430, height: 320 }),
      })
    }))

    for (const ticket of purchasedTickets) {
      const category = ticket.category ?? ticket.pnlLine?.category ?? 'OTHER'
      const meta = parseTicketNotes(ticket.notes)
      const facts = ticketFacts(
        { ...ticket, totalCost: ticket.totalCost?.toString() ?? null, costPerUnit: ticket.costPerUnit?.toString() ?? null },
        meta,
        formatDate,
      )
      const image = ticketImages.get(ticket.id)

      const rows: TableRow[] = [
        // Title bar
        new TableRow({
          children: [new TableCell({
            columnSpan: 4,
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: CLR.sectionBg },
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            children: [new Paragraph({
              children: [
                new TextRun({ text: `${categoryIcon(category)}  ${ticket.type}`, bold: true, size: 21, color: CLR.dark, font: 'Arial' }),
                new TextRun({ text: `    ${categoryLabel(category)}`, size: 16, color: CLR.amber, font: 'Arial', bold: true }),
                new TextRun({ text: `    ✓ ${ticket.status === 'PAID' ? 'PAID' : 'PURCHASED'}`, size: 15, color: CLR.green, font: 'Arial', bold: true }),
                new TextRun({ text: `    ${ticketCode(ticket.id)}`, size: 14, color: CLR.muted, font: 'Courier New' }),
              ],
            })],
          })],
        }),
      ]

      if (ticket.reference) {
        rows.push(new TableRow({
          children: [new TableCell({
            columnSpan: 4,
            margins: { top: 70, bottom: 70, left: 100, right: 100 },
            children: [new Paragraph({
              children: [
                new TextRun({ text: 'CONFIRMATION / REFERENCE   ', bold: true, size: 13, color: CLR.muted, font: 'Arial' }),
                new TextRun({ text: ticket.reference, bold: true, size: 26, color: CLR.amber, font: 'Courier New' }),
                new TextRun({
                  text: `    Admits ${paxLabel(meta.pax ?? ticket.qty, meta.paxType) ?? `${ticket.qty} Pax`}`,
                  size: 16, color: CLR.mid, font: 'Arial', bold: true,
                }),
              ],
            })],
          })],
        }))
      }

      // Facts, two label/value pairs per row
      for (let i = 0; i < facts.length; i += 2) {
        const pair = [facts[i], facts[i + 1]]
        rows.push(new TableRow({
          children: pair.flatMap((fact, idx) => fact
            ? [
                dCell(fact.label.toUpperCase(), { bold: true, color: CLR.muted, shade: idx === 0 ? CLR.rowAlt : CLR.white }),
                dCell(fact.value, { bold: true, shade: idx === 0 ? CLR.rowAlt : CLR.white }),
              ]
            : [dCell('', { shade: CLR.white }), dCell('', { shade: CLR.white })]),
        }))
      }

      const remark = [meta.remarks, ...meta.details].filter(Boolean).join(' · ')
      if (remark) {
        rows.push(new TableRow({
          children: [new TableCell({
            columnSpan: 4,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({
              children: [new TextRun({ text: remark, size: 16, color: CLR.mid, font: 'Arial', italics: true })],
            })],
          })],
        }))
      }

      rows.push(new TableRow({
        children: [new TableCell({
          columnSpan: 4,
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: image
            ? [
                new Paragraph({
                  children: [new TextRun({ text: 'SUPPLIER TICKET / RECEIPT', bold: true, size: 13, color: CLR.muted, font: 'Arial' })],
                  spacing: { after: 60 },
                }),
                new Paragraph({
                  children: [new ImageRun({ data: image.buffer, transformation: image.size, type: image.type })],
                  alignment: AlignmentType.CENTER,
                }),
              ]
            : [new Paragraph({
                children: [new TextRun({
                  text: ticketFileKind(ticket) === 'pdf'
                    ? `📄 Supplier ticket attached as PDF${ticket.fileName ? ` — ${ticket.fileName}` : ''}. Present the reference above at the counter.`
                    : '🎫 No supplier scan on file — this voucher, with the reference above, is the ticket. Present it at the counter.',
                  size: 15, color: CLR.muted, font: 'Arial', italics: true,
                })],
              })],
        })],
      }))

      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows,
      }))
      children.push(new Paragraph({ text: '', spacing: { after: 120 } }))
    }
  }

  // ── EMERGENCY CONTACTS ────────────────────────────────────────────────────
  // Resigned staff never reach the guest — see `lib/emergency-contacts.ts`.
  const emergencyContacts = withoutRetiredContacts(booking.emergencyContacts)
  if (emergencyContacts.length > 0) {
    children.push(sectionHeading('🚨', 'Emergency Contacts'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: ['Name', 'Phone', 'Role'].map(h => hCell(h)) }),
        ...emergencyContacts.map((ec, i) => new TableRow({
          children: [
            dCell(ec.name,       { bold: true, color: CLR.red, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(ec.phone ?? '—', { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(ec.role ?? '—',  { shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
          ],
        })),
      ],
    }))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── NOTES & TERMS ─────────────────────────────────────────────────────────
  const b = booking as any
  const hasNotes = !!(b.packageIncludes || b.packageExcludes || b.terms || b.exclusions ||
    b.importantNotes || b.tips || b.clientRequest || b.amendmentNote || b.otherNote || b.policyNotes)

  if (hasNotes) {
    children.push(sectionHeading('📋', 'Package Details & Notes'))
    if (b.amendmentNote)   children.push(...noteBlock('✏️', 'Amendment Note',          b.amendmentNote))
    if (b.clientRequest)   children.push(...noteBlock('💬', 'Client Request',           b.clientRequest))
    if (b.packageIncludes) children.push(...noteBlock('✅', 'Package Includes',         b.packageIncludes))
    if (b.packageExcludes) children.push(...noteBlock('❌', 'Package Excludes',         b.packageExcludes))
    if (b.terms)           children.push(...noteBlock('📋', 'Terms & Conditions',       b.terms))
    if (b.exclusions)      children.push(...noteBlock('⚠️', 'Exclusions',              b.exclusions))
    if (b.importantNotes)  children.push(...noteBlock('⚡', 'Important Notes',          b.importantNotes))
    if (b.tips)            children.push(...noteBlock('💡', 'Tips',                     b.tips))
    if (b.policyNotes)     children.push(...noteBlock('📜', 'Policy Notes',             b.policyNotes))
    if (b.otherNote)       children.push(...noteBlock('📝', 'Other Note',               b.otherNote))
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Apple Holidays Booking System — Confidential', size: 14, color: CLR.muted, font: 'Arial' }),
        new TextRun({ text: `   Printed: ${new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, size: 14, color: CLR.muted, font: 'Arial' }),
      ],
      spacing: { before: 240 },
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' } },
    }),
  )

  // ── BUILD DOCX ────────────────────────────────────────────────────────────
  const doc = new Document({
    creator:  'Apple Holidays Booking System',
    title:    `Movement Chart — ${ref}`,
    subject:  'Booking Agenda',
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
