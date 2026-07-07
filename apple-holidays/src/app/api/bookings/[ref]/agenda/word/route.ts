import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError } from '@/lib/utils'
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle,
  ShadingType, TableLayoutType, VerticalAlign,
} from 'docx'

export const dynamic = 'force-dynamic'

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

const SVC_LABEL: Record<string, string> = {
  PVT_TRANSFER:    'Private Transfer',
  SIC_TRANSFER:    'SIC Transfer',
  OWN_ARRANGEMENT: 'Own Arrangement',
  INTERNAL_TOUR:   'Ticket Only',
}

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

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      passengers:      true,
      flights:         { orderBy: { date: 'asc' } },
      accommodations:  { orderBy: { checkIn: 'asc' } },
      emergencyContacts: true,
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

  if (!booking) return buildApiError('Booking not found', 404)

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
        new TextRun({ text: params.ref, bold: true, size: 36, color: CLR.amber, font: 'Courier New' }),
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
            dCell(f.depTime ?? '—',    { color: CLR.green, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(f.toApt,             { bold: true, shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
            dCell(f.arrTime ?? '—',    { color: CLR.red,   shade: i % 2 === 0 ? CLR.white : CLR.rowAlt }),
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
          children: ['Hotel', 'City', 'Check-in', 'Check-out', 'Nights', 'Room', 'Meal Plan'].map(h => hCell(h)),
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
          ],
        })),
      ],
    }))
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
  }

  // ── MOVEMENT CHART ────────────────────────────────────────────────────────
  if (items.length > 0) {
    children.push(sectionHeading('🗓️', `Movement Chart — ${items.length} item${items.length !== 1 ? 's' : ''}`))

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
            children: ['From', 'To / Activity', 'Meal', 'Meet Time', 'Service', 'Driver / Vehicle'].map(h => hCell(h)),
          }),
          ...dayItems.map((item, idx) => {
            const a = item.assignment
            const svc = item.serviceType

            const displayVendorName   = a?.vendorName   ?? a?.vendor?.name   ?? null
            const displayDriverName   = a?.driverName   ?? a?.driver?.name   ?? null
            const displayDriverPhone  = a?.driverPhone  ?? a?.driver?.phone  ?? null
            const displayVehicleType  = a?.vehicleType  ?? a?.driver?.vehicle?.type    ?? null
            const displayVehiclePlate = a?.vehiclePlate ?? a?.driver?.vehicle?.plateNo ?? null

            let meetDisplay = '—'
            if (svc === 'SIC_TRANSFER' && (item.timeFrom || item.timeTo)) {
              meetDisplay = [item.timeFrom, item.timeTo].filter(Boolean).join(' – ')
            } else if (item.meetingTime) {
              meetDisplay = item.meetingTime
            }

            let driverText = 'Not assigned'
            if (displayVendorName) {
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

            const rows: TableCell[] = [
              dCell(item.fromPoint || '—', { shade }),
              dCell(item.toPoint   || '—', { bold: true, shade }),
              dCell(normalizeMealPlan(item.mealPlan), { shade }),
              dCell(meetDisplay, { bold: meetDisplay !== '—', color: meetDisplay !== '—' ? CLR.green : CLR.muted, shade }),
              dCell(SVC_LABEL[svc] ?? svc, { shade }),
              dCell(driverText, { italic: driverText === 'Not assigned', color: driverText === 'Not assigned' ? CLR.muted : undefined, shade }),
            ]

            const rowCells = [new TableRow({ children: rows })]

            // Details sub-row
            if (item.details?.trim()) {
              rowCells.push(new TableRow({
                children: [new TableCell({
                  columnSpan: 6,
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
  }

  // ── EMERGENCY CONTACTS ────────────────────────────────────────────────────
  if (booking.emergencyContacts.length > 0) {
    children.push(sectionHeading('🚨', 'Emergency Contacts'))
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: ['Name', 'Phone', 'Role'].map(h => hCell(h)) }),
        ...booking.emergencyContacts.map((ec, i) => new TableRow({
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
    title:    `Movement Chart — ${params.ref}`,
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

  const buffer = await Packer.toBuffer(doc)

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${params.ref}.docx"`,
      'Content-Length':      String(buffer.byteLength),
    },
  })
}
