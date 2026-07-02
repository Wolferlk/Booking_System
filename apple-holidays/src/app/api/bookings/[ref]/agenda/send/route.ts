/**
 * POST /api/bookings/[ref]/agenda/send
 *
 * Generates the movement-chart agenda as a PDF and:
 *   mode = 'download' → returns the PDF as binary
 *   mode = 'whatsapp' → sends via WhatsApp (Meta API / proxy)
 *   mode = 'email'    → sends via Microsoft Graph email
 *
 * Body:
 *   { mode, showDrivers, to, message, subject }
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { htmlToPdf } from '@/lib/html-to-pdf'
import { sendMailViaGraph } from '@/lib/send-mail'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

export const dynamic    = 'force-dynamic'
export const maxDuration = 120

const META_API_VERSION = process.env.WHATSAPP_API_VERSION?.trim() || 'v20.0'
const WHATSAPP_PROXY   = 'https://travel-parser-live.aahaas.com/v1/notify/whatsapp'

function safeFilePart(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildAgendaFileName(booking: {
  bookingRef?: string
  isNumber?: string | null
  passengers?: { name: string; isLead?: boolean }[]
}): string {
  const leadPassenger = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const parts = [
    booking.isNumber?.trim() || null,
    booking.bookingRef?.trim() || null,
    leadPassenger?.name ?? null,
  ].map(safeFilePart).filter(Boolean)

  return `${parts.join('_') || 'agenda'}.pdf`
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function esc(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Full-detail HTML builder (matches /print/agenda/[ref]?drivers=true) ───────

const COUNTRY_LABEL: Record<string, string> = {
  VIETNAM: 'Vietnam', SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore', MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore / Malaysia',
}

function normalizeMealPlan(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '—'
  const MAP: Record<string, string> = {
    'B': 'B', 'L': 'L', 'D': 'D',
    'BL': 'B+L', 'LB': 'B+L', 'BD': 'B+D', 'DB': 'B+D',
    'LD': 'L+D', 'DL': 'L+D',
    'BLD': 'B+L+D', 'BDL': 'B+L+D', 'LBD': 'B+L+D',
  }
  const upper = raw.trim().toUpperCase().replace(/[\s,/]+/g, '')
  return MAP[upper] ?? raw.trim()
}

function noteBlockHtml(icon: string, label: string, content: string | null | undefined, accentColor: string, bgColor: string): string {
  if (!content?.trim()) return ''
  const lines = content.trim().split('\n').filter(l => l.trim())
  const rowsHtml = lines.map(line => {
    const t = line.trim()
    const isBullet = /^[-•*▪►]/.test(t)
    const isNum = /^\d+[\.\)]/.test(t)
    const clean = isBullet ? t.replace(/^[-•*▪►]\s*/, '') : isNum ? t.replace(/^\d+[\.\)]\s*/, '') : t
    const num = isNum ? (t.match(/^(\d+)/)?.[1] ?? '') : ''
    const bullet = isBullet ? '✓' : isNum ? num : ''
    return `<div style="display:flex;gap:5px;margin-bottom:2px;align-items:flex-start">
      <span style="flex-shrink:0;width:14px;height:14px;background:${bullet ? `${accentColor}20` : 'transparent'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:7px;font-weight:700;color:${accentColor};margin-top:1px">${esc(bullet)}</span>
      <span>${esc(clean)}</span>
    </div>`
  }).join('')
  return `<div style="border:1px solid ${accentColor}20;border-radius:5px;background:${bgColor};padding:7px 10px;page-break-inside:avoid">
    <p style="font-size:8px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">${icon} ${esc(label)}</p>
    <div style="font-size:8.5px;color:#374151;line-height:1.55">${rowsHtml}</div>
  </div>`
}

function buildFullAgendaHtml(
  ref: string,
  booking: {
    agent?: string | null; fileHandler?: string | null
    arrivalDate?: string | null; departureDate?: string | null
    paxAdults?: number | null; paxChildren?: number | null
    bookingRef?: string; isNumber?: string | null; cntlNumber?: string | null; agentBookingId?: string | null
    operationCountry?: string | null; tourDestination?: string | null
    contactPhone?: string | null; contactWhatsapp?: string | null; contactEmail?: string | null
    packageIncludes?: string | null; packageExcludes?: string | null
    exclusions?: string | null; tips?: string | null; terms?: string | null
    importantNotes?: string | null; policyNotes?: string | null
    otherNote?: string | null; clientRequest?: string | null; amendmentNote?: string | null
    passengers?: { name: string; isLead?: boolean; type?: string | null; mealPreference?: string | null; contact?: string | null }[]
    flights?: { flightNo: string; date: string; fromApt: string; depTime?: string | null; toApt: string; arrTime?: string | null; airline?: string | null }[]
    accommodations?: { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string | null; mealType?: string | null }[]
    emergencyContacts?: { name: string; phone?: string | null; role?: string | null }[]
  },
  items: {
    date: string; location?: string | null; fromPoint?: string | null; toPoint?: string | null
    details?: string | null; mealPlan?: string | null; meetingTime?: string | null
    timeFrom?: string | null; timeTo?: string | null; serviceType?: string | null
    assignment?: {
      vendorId?: string | null; vendorName?: string | null; driverName?: string | null
      driverPhone?: string | null; vehicleType?: string | null; vehiclePlate?: string | null
      vendor?: { name: string; phone?: string | null } | null
      driver?: { id: string; name: string; phone?: string | null; vehicle?: { type?: string | null; plateNo?: string | null } | null } | null
    } | null
  }[],
  showDrivers: boolean,
): string {
  const SVC_COLOR: Record<string, string> = {
    PVT_TRANSFER: '#2563eb', SIC_TRANSFER: '#059669', OWN_ARRANGEMENT: '#94a3b8',
  }
  const SVC_LABEL: Record<string, string> = {
    PVT_TRANSFER: 'Private', SIC_TRANSFER: 'SIC', OWN_ARRANGEMENT: 'Own Arr.',
  }

  const lead = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const totalPax = (booking.paxAdults ?? 0) + (booking.paxChildren ?? 0)
  const destination = booking.tourDestination?.trim() || (booking.operationCountry ? (COUNTRY_LABEL[booking.operationCountry] ?? booking.operationCountry) : '—')

  // Group items by date
  const grouped: Record<string, typeof items> = {}
  items.forEach(item => {
    const key = (item.date ?? 'unknown').slice(0, 10)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  })

  const agendaCards = Object.entries(grouped).map(([date, dayItems]) => {
    const itemsHtml = dayItems.map((item, idx) => {
      const a = item.assignment
      const svc = item.serviceType ?? 'OWN_ARRANGEMENT'
      const clr = SVC_COLOR[svc] ?? '#94a3b8'

      const displayVendorName  = a?.vendorName  ?? a?.vendor?.name  ?? null
      const displayVendorPhone = a?.vendor?.phone ?? null
      const displayDriverName  = a?.driverName  ?? a?.driver?.name  ?? null
      const displayDriverPhone = a?.driverPhone ?? a?.driver?.phone ?? null
      const displayVehicleType = a?.vehicleType ?? a?.driver?.vehicle?.type    ?? null
      const displayVehiclePlate= a?.vehiclePlate?? a?.driver?.vehicle?.plateNo ?? null

      let meetDisplay = '—'
      if (svc === 'SIC_TRANSFER' && (item.timeFrom || item.timeTo)) {
        meetDisplay = [item.timeFrom, item.timeTo].filter(Boolean).join(' – ')
      } else if (item.meetingTime) {
        meetDisplay = String(item.meetingTime)
      }

      const meal = normalizeMealPlan(item.mealPlan)

      const driverCell = showDrivers ? `<div style="padding:5px 7px;display:flex;flex-direction:column;justify-content:center">
        ${(a?.vendorId || displayVendorName)
          ? `<p style="font-weight:700;color:#7c3aed;font-size:8px">${esc(displayVendorName)}</p>
             ${displayVendorPhone ? `<p style="margin-top:1px;color:#64748b;font-size:7.5px">${esc(displayVendorPhone)}</p>` : ''}
             ${displayDriverName ? `<p style="margin-top:1px;font-size:7.5px">${esc(displayDriverName)}${displayDriverPhone ? ' · ' + esc(displayDriverPhone) : ''}</p>` : ''}
             ${displayVehiclePlate ? `<p style="font-family:monospace;color:#64748b;margin-top:1px;font-size:7.5px">${esc(displayVehicleType)} ${esc(displayVehiclePlate)}</p>` : ''}`
          : displayDriverName
          ? `<p style="font-weight:700;color:#1d4ed8;font-size:8px">${esc(displayDriverName)}</p>
             ${displayDriverPhone ? `<p style="color:#64748b;margin-top:1px;font-size:7.5px">${esc(displayDriverPhone)}</p>` : ''}
             ${displayVehiclePlate ? `<p style="font-family:monospace;color:#64748b;margin-top:1px;font-size:7.5px">${esc(displayVehicleType)} ${esc(displayVehiclePlate)}</p>` : ''}`
          : `<span style="color:#cbd5e1;font-style:italic;font-size:7.5px">Not assigned</span>`
        }
      </div>` : ''

      const gridCols = showDrivers ? '1fr 1fr 50px 80px 90px 110px' : '1fr 1fr 50px 80px 90px'

      return `<div style="border-top:${idx > 0 ? '1px solid #f1f5f9' : 'none'};background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}">
        <div style="display:grid;grid-template-columns:${gridCols};align-items:stretch;min-height:28px">
          <div style="padding:5px 8px;border-right:1px solid #f1f5f9;display:flex;flex-direction:column;justify-content:center">
            <div style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">From</div>
            <div style="font-size:8.5px;font-weight:700;color:#0f172a;margin-top:1px">${esc(item.fromPoint)}</div>
          </div>
          <div style="padding:5px 8px;border-right:1px solid #f1f5f9;display:flex;flex-direction:column;justify-content:center">
            <div style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">To / Activity</div>
            <div style="font-size:8.5px;font-weight:700;color:#0f172a;margin-top:1px">${esc(item.toPoint)}</div>
          </div>
          <div style="padding:5px 6px;border-right:1px solid #f1f5f9;display:flex;flex-direction:column;justify-content:center;align-items:center">
            <div style="font-size:7px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Meal</div>
            ${meal !== '—'
              ? `<div style="margin-top:2px;font-size:7px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:3px;padding:1px 3px;text-align:center">${esc(meal)}</div>`
              : `<div style="font-size:7.5px;color:#cbd5e1">—</div>`}
          </div>
          <div style="padding:5px 6px;border-right:1px solid #f1f5f9;display:flex;flex-direction:column;justify-content:center;align-items:center">
            <div style="font-size:7px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Meet</div>
            <div style="margin-top:2px;font-size:8px;font-weight:${meetDisplay !== '—' ? '800' : '400'};color:${meetDisplay !== '—' ? '#059669' : '#cbd5e1'}">${esc(meetDisplay)}</div>
          </div>
          <div style="padding:5px 6px;${showDrivers ? 'border-right:1px solid #f1f5f9;' : ''}display:flex;flex-direction:column;justify-content:center;align-items:center">
            <div style="font-size:7px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px">Service</div>
            ${svc === 'OWN_ARRANGEMENT'
              ? `<span style="font-size:7px;color:#94a3b8;font-style:italic">Own Arr.</span>`
              : `<span style="display:inline-block;padding:2px 5px;border-radius:3px;font-size:7px;font-weight:700;color:${clr};background:${clr}18;border:1px solid ${clr}38;text-align:center">${esc(SVC_LABEL[svc] ?? svc)}</span>`
            }
          </div>
          ${driverCell}
        </div>
        ${item.details?.trim() ? `<div style="border-top:1px dashed #e2e8f0;background:${idx % 2 === 0 ? '#f8fafc' : '#f1f5f9'};padding:6px 10px 7px;display:flex;gap:6px">
          <div style="flex-shrink:0;width:2px;background:${clr};border-radius:2px;opacity:0.5"></div>
          <p style="font-size:8px;color:#374151;line-height:1.65;white-space:pre-wrap">${esc(item.details)}</p>
        </div>` : ''}
      </div>`
    }).join('')

    const location = dayItems[0]?.location || ''
    return `<div style="margin-bottom:8px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;page-break-inside:avoid">
      <div style="background:linear-gradient(135deg,#1e293b 0%,#334155 100%);padding:5px 10px;display:flex;align-items:center;gap:8px">
        <div style="background:#d97706;border-radius:4px;padding:2px 8px;font-size:9px;font-weight:800;color:#fff;white-space:nowrap">${esc(fmtDate(date))}</div>
        ${location ? `<div style="font-size:8.5px;color:#94a3b8;font-weight:600">${esc(location)}</div>` : ''}
      </div>
      ${itemsHtml}
    </div>`
  }).join('')

  const passengers = booking.passengers ?? []
  const passengersHtml = passengers.length > 0 ? `<div style="margin-bottom:2px">
    <div style="display:flex;align-items:center;gap:6px;font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;padding:5px 10px;background:#f1f5f9;border-bottom:1px solid #e2e8f0;border-top:2px solid #d97706;border-radius:5px 5px 0 0;margin-top:14px">
      <span>👥 Passengers</span>
      <span style="font-size:9.5px;font-weight:800;background:#d97706;padding:1px 9px;color:#fff;border-radius:10px;text-transform:none;letter-spacing:0">${booking.paxAdults} adult${(booking.paxAdults ?? 0) !== 1 ? 's' : ''}${(booking.paxChildren ?? 0) > 0 ? ` · ${booking.paxChildren} child${(booking.paxChildren ?? 0) !== 1 ? 'ren' : ''}` : ''}</span>
    </div>
    <table>
      <thead><tr>${['Name','Type','Contact','Meal Preference'].map(h => `<th style="padding:4px 7px;text-align:left;font-size:7.5px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.4px;background:#334155">${h}</th>`).join('')}</tr></thead>
      <tbody>${passengers.map((p, i) => `<tr style="background:${p.isLead ? '#fefce8' : i % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.name)}${p.isLead ? ' <span style="font-size:7px;font-weight:700;color:#d97706;background:#fef3c7;padding:1px 4px;border-radius:3px">LEAD</span>' : ''}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.type ?? 'ADULT')}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.contact)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${p.mealPreference?.trim() ? `<span style="display:inline-block;font-size:7.5px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:1px 5px;border-radius:3px">${esc(p.mealPreference)}</span>` : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : ''

  const flights = booking.flights ?? []
  const flightsHtml = flights.length > 0 ? `<div style="margin-bottom:2px">
    <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #d97706;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0;margin-top:14px">✈️ Flights (${flights.length} segment${flights.length !== 1 ? 's' : ''})</div>
    <table>
      <thead><tr>${['Flight No.','Date','From','Dep.','To','Arr.'].map(h => `<th style="padding:4px 7px;text-align:left;font-size:7.5px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.4px;background:#334155">${h}</th>`).join('')}</tr></thead>
      <tbody>${flights.map((f, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#1d4ed8;font-family:monospace;border-bottom:1px solid #f1f5f9">${esc(f.flightNo)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;white-space:nowrap;border-bottom:1px solid #f1f5f9">${fmtDate(f.date)}</td>
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#374151;border-bottom:1px solid #f1f5f9">${esc(f.fromApt)}</td>
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#059669;border-bottom:1px solid #f1f5f9">${esc(f.depTime)}</td>
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#374151;border-bottom:1px solid #f1f5f9">${esc(f.toApt)}</td>
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#dc2626;border-bottom:1px solid #f1f5f9">${esc(f.arrTime)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : ''

  const accommodations = booking.accommodations ?? []
  const accommodationsHtml = accommodations.length > 0 ? `<div style="margin-bottom:2px">
    <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #d97706;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0;margin-top:14px">🏨 Accommodation (${accommodations.length} hotel${accommodations.length !== 1 ? 's' : ''})</div>
    <table>
      <thead><tr>${['Hotel','City','Check-in','Check-out','Nights','Room Type','Meal Plan'].map(h => `<th style="padding:4px 7px;text-align:left;font-size:7.5px;font-weight:700;color:#f8fafc;text-transform:uppercase;letter-spacing:0.4px;background:#334155">${h}</th>`).join('')}</tr></thead>
      <tbody>${accommodations.map((a, i) => `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'}">
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9">${esc(a.hotel)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.city)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;white-space:nowrap;border-bottom:1px solid #f1f5f9">${fmtDate(a.checkIn)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;white-space:nowrap;border-bottom:1px solid #f1f5f9">${fmtDate(a.checkOut)}</td>
        <td style="padding:5px 7px;font-size:8.5px;font-weight:700;text-align:center;border-bottom:1px solid #f1f5f9">${esc(a.nights)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.roomType)}</td>
        <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.mealType)}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>` : ''

  const emergencyContacts = booking.emergencyContacts ?? []
  const emergencyHtml = emergencyContacts.length > 0 ? `<div style="margin-bottom:2px">
    <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #dc2626;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0;margin-top:14px">🚨 Emergency Contacts</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:#fff7f7;border:1px solid #fee2e2;border-top:none;border-radius:0 0 5px 5px">
      ${emergencyContacts.map(ec => `<div style="background:#fff;border:1px solid #fecaca;border-radius:5px;padding:5px 10px;min-width:140px">
        <p style="font-size:9px;font-weight:700;color:#991b1b">${esc(ec.name)}</p>
        <p style="font-size:8.5px;color:#374151;margin-top:1px">${esc(ec.phone)}</p>
        ${ec.role ? `<p style="font-size:7.5px;color:#94a3b8;margin-top:1px">${esc(ec.role)}</p>` : ''}
      </div>`).join('')}
    </div>
  </div>` : ''

  const hasNotes = !!(booking.packageIncludes || booking.packageExcludes || booking.terms ||
    booking.exclusions || booking.importantNotes || booking.tips ||
    booking.clientRequest || booking.amendmentNote || booking.otherNote || booking.policyNotes)

  const notesHtml = hasNotes ? `<div style="margin-top:16px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid #e2e8f0">
      <div style="width:3px;height:18px;background:#d97706;border-radius:2px"></div>
      <p style="font-size:10px;font-weight:800;color:#0f172a;text-transform:uppercase;letter-spacing:0.8px">Package Details &amp; Notes</p>
    </div>
    ${booking.amendmentNote ? `<div style="margin-bottom:8px;border:1px solid #fbbf2440;border-left:4px solid #d97706;border-radius:5px;background:#fffbeb;padding:7px 10px;page-break-inside:avoid">
      <p style="font-size:8px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">✏️ Amendment Note</p>
      <p style="font-size:8.5px;color:#374151;line-height:1.55;white-space:pre-wrap">${esc(booking.amendmentNote)}</p>
    </div>` : ''}
    ${booking.clientRequest ? `<div style="margin-bottom:8px;border:1px solid #3b82f640;border-left:4px solid #2563eb;border-radius:5px;background:#eff6ff;padding:7px 10px;page-break-inside:avoid">
      <p style="font-size:8px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">💬 Client Request</p>
      <p style="font-size:8.5px;color:#374151;line-height:1.55;white-space:pre-wrap">${esc(booking.clientRequest)}</p>
    </div>` : ''}
    ${(booking.packageIncludes || booking.packageExcludes) ? `<div style="display:grid;grid-template-columns:${booking.packageIncludes && booking.packageExcludes ? '1fr 1fr' : '1fr'};gap:8px;margin-bottom:8px;page-break-inside:avoid">
      ${noteBlockHtml('✅', 'Above Package Includes', booking.packageIncludes, '#16a34a', '#f0fdf4')}
      ${noteBlockHtml('❌', 'The Above Package Excludes', booking.packageExcludes, '#dc2626', '#fef2f2')}
    </div>` : ''}
    ${(booking.terms || booking.exclusions) ? `<div style="display:grid;grid-template-columns:${booking.terms && booking.exclusions ? '1fr 1fr' : '1fr'};gap:8px;margin-bottom:8px;page-break-inside:avoid">
      ${noteBlockHtml('📋', 'Terms & Conditions', booking.terms, '#7c3aed', '#faf5ff')}
      ${noteBlockHtml('⚠️', 'Exclusions', booking.exclusions, '#ea580c', '#fff7ed')}
    </div>` : ''}
    ${booking.importantNotes ? `<div style="margin-bottom:8px">${noteBlockHtml('⚡', 'Important Notes', booking.importantNotes, '#dc2626', '#fef2f2')}</div>` : ''}
    ${booking.tips ? `<div style="margin-bottom:8px">${noteBlockHtml('💡', 'Tips', booking.tips, '#0891b2', '#ecfeff')}</div>` : ''}
    ${booking.policyNotes ? `<div style="margin-bottom:8px">${noteBlockHtml('📜', 'Policy Notes', booking.policyNotes, '#7c3aed', '#faf5ff')}</div>` : ''}
    ${booking.otherNote ? `<div style="margin-bottom:8px">${noteBlockHtml('📝', 'Other Note', booking.otherNote, '#64748b', '#f8fafc')}</div>` : ''}
  </div>` : ''

  const printedAt = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page{size:A4;margin:12mm 11mm}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  table{border-collapse:collapse;width:100%}
</style>
</head>
<body>
  <!-- HEADER -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #d97706;padding-bottom:10px;margin-bottom:14px">
    <div>
      <p style="font-weight:800;font-size:15px;color:#0f172a">Apple Holidays</p>
      <p style="font-size:8.5px;color:#64748b;margin-top:1px">Movement Chart &amp; Booking Summary</p>
    </div>
    <div style="text-align:right">
      <p style="font-weight:800;font-size:18px;font-family:monospace;color:#d97706">${esc(ref)}</p>
      ${booking.isNumber ? `<p style="font-size:8.5px;color:#2563eb;font-family:monospace;font-weight:700;margin-top:2px">IS: ${esc(booking.isNumber)}</p>` : ''}
      ${booking.cntlNumber ? `<p style="font-size:8px;color:#7c3aed;font-family:monospace;font-weight:700;margin-top:1px">CNTL: ${esc(booking.cntlNumber)}</p>` : ''}
      ${booking.agentBookingId ? `<p style="font-size:8px;color:#64748b;font-family:monospace;margin-top:1px">Ref: ${esc(booking.agentBookingId)}</p>` : ''}
      <p style="font-size:8px;color:#64748b;margin-top:3px">${fmtDate(booking.arrivalDate)} — ${fmtDate(booking.departureDate)}</p>
      <p style="font-size:8px;color:#64748b;margin-top:1px">${totalPax} pax (${booking.paxAdults ?? 0} adult${(booking.paxAdults ?? 0) !== 1 ? 's' : ''}${(booking.paxChildren ?? 0) > 0 ? `, ${booking.paxChildren} child${(booking.paxChildren ?? 0) !== 1 ? 'ren' : ''}` : ''})</p>
      ${!showDrivers ? '<p style="font-size:7.5px;color:#94a3b8;font-style:italic;margin-top:2px">Driver info hidden</p>' : ''}
    </div>
  </div>

  <!-- BOOKING SUMMARY STRIP -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;padding:8px 10px">
    ${[
      { label: 'Tour Operator / Agent', value: booking.agent ?? '—' },
      { label: 'File Handler',          value: booking.fileHandler ?? '—' },
      { label: 'Destination',           value: destination },
      { label: 'Lead Passenger',        value: lead?.name ?? '—' },
    ].map(({ label, value }) => `<div>
      <p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">${label}</p>
      <p style="font-size:9.5px;font-weight:700;color:#0f172a;margin-top:1px">${esc(value)}</p>
    </div>`).join('')}
  </div>

  <!-- CONTACT INFO -->
  ${(booking.contactPhone || booking.contactWhatsapp || booking.contactEmail) ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
    ${booking.contactPhone ? `<div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer Phone</p><p style="font-size:9px;color:#0f172a;margin-top:1px">${esc(booking.contactPhone)}</p></div>` : ''}
    ${booking.contactWhatsapp ? `<div><p style="font-size:7.5px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer WhatsApp</p><p style="font-size:9px;color:#0f172a;margin-top:1px">${esc(booking.contactWhatsapp)}</p></div>` : ''}
    ${booking.contactEmail ? `<div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer Email</p><p style="font-size:9px;color:#2563eb;margin-top:1px">${esc(booking.contactEmail)}</p></div>` : ''}
  </div>` : ''}

  ${passengersHtml}
  ${flightsHtml}
  ${accommodationsHtml}

  <!-- MOVEMENT CHART -->
  ${items.length > 0 ? `<div style="margin-bottom:2px">
    <div style="display:flex;align-items:center;gap:6px;font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.6px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #0f172a;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0;margin-top:14px">
      🗓️ Movement Chart — ${items.length} item${items.length !== 1 ? 's' : ''}${showDrivers ? ' (with driver allocation)' : ' (driver info hidden)'}
    </div>
    ${agendaCards}
  </div>` : ''}

  ${emergencyHtml}
  ${notesHtml}

  <!-- FOOTER -->
  <div style="margin-top:18px;border-top:1px solid #e2e8f0;padding-top:8px;display:flex;justify-content:space-between;align-items:center">
    <p style="font-size:7.5px;color:#94a3b8">Apple Holidays Booking System — Confidential</p>
    <p style="font-size:7.5px;color:#94a3b8">Printed: ${printedAt}</p>
  </div>
</body>
</html>`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { ref: string } },
) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)

  const body = await req.json() as {
    mode:        'download' | 'whatsapp' | 'email'
    showDrivers?: boolean
    to?:         string
    message?:    string
    subject?:    string
  }

  const { mode, showDrivers = true, to, message, subject } = body

  // ── Load agenda data ──────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { bookingRef: params.ref },
    include: {
      flights: { orderBy: { date: 'asc' } },
      accommodations: { orderBy: { checkIn: 'asc' } },
      passengers: { orderBy: [{ isLead: 'desc' }, { name: 'asc' }] },
      emergencyContacts: true,
      tourAgenda: {
        include: {
          items: {
            orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }],
            include: {
              assignment: {
                include: {
                  driver: {
                    include: {
                      vehicle: true,
                    },
                  },
                  vendor: {
                    select: {
                      id: true,
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!booking) return buildApiError('Booking not found', 404)

  const agendaItems = (booking.tourAgenda as { items: unknown[] } | null)?.items ?? []

  // ── Generate PDF (full-detail layout matching "Download with all details") ──
  const html = buildFullAgendaHtml(
    params.ref,
    booking as never,
    agendaItems as never,
    showDrivers,
  )

  const driverTag  = showDrivers ? 'WithDrivers' : 'NoDrivers'
  const filename   = buildAgendaFileName(booking as never)

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await htmlToPdf(html, filename, { bookingRef: params.ref })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return buildApiError(`PDF generation failed: ${msg}`, 500)
  }

  // ── Download ──────────────────────────────────────────────────────────────
  if (mode === 'download') {
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdfBuffer.length),
      },
    })
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (mode === 'whatsapp') {
    if (!to) return buildApiError('Phone number required', 400)
    const normPhone = to.replace(/\D/g, '')

    // Save PDF to public dir for URL-based delivery
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'whatsapp')
    await mkdir(uploadDir, { recursive: true })
    await writeFile(path.join(uploadDir, `${driverTag}-${filename}`), pdfBuffer)

    const baseUrl = (
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      process.env.APP_URL?.trim() ||
      req.nextUrl.origin
    ).replace(/\/+$/, '')
    const fileUrl = `${baseUrl}/uploads/whatsapp/${encodeURIComponent(`${driverTag}-${filename}`)}`

    const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
    const waMessage     = message ?? `📋 Movement Chart — ${params.ref}\n\nPlease find the attached agenda PDF for your reference.`

    // Try Meta API first
    if (accessToken && phoneNumberId) {
      const baseWaUrl = `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}`
      const headers   = { Authorization: `Bearer ${accessToken}` }

      // Send text
      await fetch(`${baseWaUrl}/messages`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normPhone,
          type: 'text',
          text: { body: waMessage },
        }),
      })

      // Upload PDF and send document
      const mediaForm = new FormData()
      mediaForm.append('messaging_product', 'whatsapp')
      const pdfBlob = new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' })
      mediaForm.append('file', pdfBlob, filename)
      const uploadRes  = await fetch(`${baseWaUrl}/media`, { method: 'POST', headers, body: mediaForm })
      const uploadJson = await uploadRes.json() as { id?: string }

      if (uploadJson.id) {
        await fetch(`${baseWaUrl}/messages`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: normPhone,
            type: 'document',
            document: { id: uploadJson.id, filename, caption: `Agenda — ${params.ref}` },
          }),
        })
      }

      return buildApiSuccess({ sent: true, via: 'meta' })
    }

    // Fallback: proxy
    try {
      const proxyRes = await fetch(WHATSAPP_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: normPhone, message: waMessage, fileUrl, filename }),
      })
      let proxyJson: { success?: boolean } = {}
      try { proxyJson = await proxyRes.json() as { success?: boolean } } catch { /* non-JSON body */ }
      if (!proxyJson.success && !proxyRes.ok) {
        return buildApiError(`WhatsApp proxy failed (${proxyRes.status})`, 500)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`WhatsApp send failed: ${msg}`, 500)
    }

    return buildApiSuccess({ sent: true, via: 'proxy' })
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  if (mode === 'email') {
    if (!to) return buildApiError('Email address required', 400)

    const emailSubject = subject ?? `Movement Chart — ${params.ref}`
    const bodyHtml = `
      <div style="font-family:Arial,sans-serif;color:#1e293b;max-width:600px">
        <div style="background:#0f172a;padding:16px 20px;border-radius:8px 8px 0 0">
          <h2 style="color:#f1f5f9;margin:0;font-size:16px">Movement Chart</h2>
          <p style="color:#d97706;margin:4px 0 0;font-family:monospace;font-size:14px">${params.ref}</p>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;padding:20px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 12px">${message ?? 'Please find the movement chart (agenda) for this booking in the attached PDF.'}</p>
          <p style="color:#64748b;font-size:12px;margin:0">
            ${showDrivers ? 'This PDF includes driver allocation details.' : 'This PDF does not include driver information.'}
          </p>
        </div>
      </div>`

    try {
      await sendMailViaGraph({
        to: to,
        subject: emailSubject,
        bodyHtml,
        attachment: {
          name:        filename,
          contentType: 'application/pdf',
          buffer:      pdfBuffer,
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return buildApiError(`Email send failed: ${msg}`, 500)
    }

    return buildApiSuccess({ sent: true, via: 'email' })
  }

  return buildApiError('Invalid mode', 400)
}
