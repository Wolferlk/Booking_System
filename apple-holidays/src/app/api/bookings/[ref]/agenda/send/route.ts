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

function buildAgendaHtml(
  ref: string,
  booking: {
    agent?: string | null
    fileHandler?: string | null
    arrivalDate?: string | null
    departureDate?: string | null
    paxAdults?: number | null
    paxChildren?: number | null
    bookingRef?: string
    isNumber?: string | null
    agentBookingId?: string | null
    operationCountry?: string | null
    tourDestination?: string | null
    contactPhone?: string | null
    contactWhatsapp?: string | null
    contactEmail?: string | null
    packageIncludes?: string | null
    packageExcludes?: string | null
    exclusions?: string | null
    tips?: string | null
    terms?: string | null
    passengers?: {
      name: string
      isLead?: boolean
      type?: string | null
      mealPreference?: string | null
      contact?: string | null
    }[]
    flights?: {
      flightNo: string
      date: string
      fromApt: string
      depTime?: string | null
      toApt: string
      arrTime?: string | null
      airline?: string | null
    }[]
    accommodations?: {
      hotel: string
      city: string
      checkIn: string
      checkOut: string
      nights: number
      roomType?: string | null
      mealType?: string | null
    }[]
    emergencyContacts?: { name: string; phone?: string | null; role?: string | null }[]
  },
  items: {
    date: string
    location?: string | null
    fromPoint?: string | null
    toPoint?: string | null
    details?: string | null
    mealPlan?: string | null
    meetingTime?: string | null
    timeFrom?: string | null
    timeTo?: string | null
    serviceType?: string | null
    assignment?: {
      driverId?: string | null
      vendorId?: string | null
      vendorName?: string | null
      driverName?: string | null
      driverPhone?: string | null
      vehicleType?: string | null
      vehiclePlate?: string | null
      vendor?: { name: string; phone?: string | null } | null
      driver?: {
        id: string
        name: string
        phone?: string | null
        vehicle?: { type?: string | null; plateNo?: string | null } | null
      } | null
    } | null
  }[],
  showDrivers: boolean,
): string {
  const SVC_LABEL: Record<string, string> = {
    PVT_TRANSFER: 'Private Transfer',
    SIC_TRANSFER: 'SIC Transfer',
    OWN_ARRANGEMENT: 'Own Arrangement',
  }
  const SVC_COLOR: Record<string, string> = {
    PVT_TRANSFER: '#2563eb',
    SIC_TRANSFER: '#16a34a',
    OWN_ARRANGEMENT: '#94a3b8',
  }

  const lead = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const totalPax = (booking.paxAdults ?? 0) + (booking.paxChildren ?? 0)
  const destination = booking.tourDestination?.trim() || booking.operationCountry?.trim() || '—'

  const rows = items.map((item, idx) => {
    const a   = item.assignment
    const svc = item.serviceType ?? 'OWN_ARRANGEMENT'
    const clr = SVC_COLOR[svc] ?? '#94a3b8'
    const displayVendorName = a?.vendorName ?? a?.vendor?.name ?? null
    const displayVendorPhone = a?.vendor?.phone ?? null
    const displayDriverName = a?.driverName ?? a?.driver?.name ?? null
    const displayDriverPhone = a?.driverPhone ?? a?.driver?.phone ?? null
    const displayVehicleType = a?.vehicleType ?? a?.driver?.vehicle?.type ?? null
    const displayVehiclePlate = a?.vehiclePlate ?? a?.driver?.vehicle?.plateNo ?? null

    // For SIC: show join-window (timeFrom – timeTo). For others: show meetingTime.
    let meetCell = '—'
    if (svc === 'SIC_TRANSFER' && (item.timeFrom || item.timeTo)) {
      const tf = item.timeFrom ?? ''
      const tt = item.timeTo   ?? ''
      meetCell = tf && tt ? `${tf} – ${tt}` : tf || tt
    } else if (item.meetingTime) {
      meetCell = String(item.meetingTime)
    }

    const driverCell = showDrivers
      ? `<td style="padding:5px 6px;font-size:8px;color:#374151;border-bottom:1px solid #e2e8f0;">${
          a?.vendorId || displayVendorName
            ? `<b style="color:#7c3aed">${esc(displayVendorName)}</b>${displayVendorPhone ? `<br/>${esc(displayVendorPhone)}` : ''}${displayDriverName ? `<br/>${esc(displayDriverName)}${displayDriverPhone ? ' · ' + esc(displayDriverPhone) : ''}` : ''}${displayVehiclePlate ? `<br/><span style="font-family:monospace;color:#64748b">${esc(displayVehicleType)} ${esc(displayVehiclePlate)}</span>` : ''}`
            : displayDriverName
              ? `<b style="color:#1d4ed8">${esc(displayDriverName)}</b>${displayDriverPhone ? `<br/>${esc(displayDriverPhone)}` : ''}${displayVehiclePlate ? `<br/><span style="font-family:monospace;color:#64748b">${esc(displayVehicleType)} ${esc(displayVehiclePlate)}</span>` : ''}`
              : `<span style="color:#cbd5e1;font-style:italic">Not assigned</span>`
        }</td>`
      : ''

    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#f8fafc'}">
      <td style="padding:5px 6px;font-size:8.5px;font-weight:700;color:#374151;white-space:nowrap;border-bottom:1px solid #e2e8f0">${fmtDate(item.date)}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${esc(item.location)}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${esc(item.fromPoint)}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${esc(item.toPoint)}</td>
      <td style="padding:5px 6px;font-size:8.5px;color:#374151;border-bottom:1px solid #e2e8f0">${esc(item.mealPlan)}</td>
      <td style="padding:5px 6px;font-size:8.5px;font-weight:${meetCell !== '—' ? '700' : '400'};color:${meetCell !== '—' ? '#059669' : '#94a3b8'};border-bottom:1px solid #e2e8f0">${esc(meetCell)}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #e2e8f0">
        ${svc === 'OWN_ARRANGEMENT' ? '' : `<span style="display:inline-block;padding:2px 5px;border-radius:3px;font-size:7.5px;font-weight:700;color:${clr};background:${clr}18;border:1px solid ${clr}35">${SVC_LABEL[svc] ?? svc}</span>`}
      </td>
      <td style="padding:5px 6px;font-size:8px;color:#374151;line-height:1.4;border-bottom:1px solid #e2e8f0">${esc(item.details)}</td>
      ${driverCell}
    </tr>`
  }).join('')

  const thStyle = 'padding:5px 7px;text-align:left;font-size:8px;font-weight:700;color:#f1f5f9;text-transform:uppercase;letter-spacing:0.4px;background:#0f172a;'

  const driverTh = showDrivers
    ? `<th style="${thStyle}width:18%">Driver / Vehicle</th>`
    : ''

  const bookingSummaryHtml = `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
    <div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Agent</p><p style="font-size:9px;color:#0f172a;font-weight:700;margin-top:1px">${esc(booking.agent)}</p></div>
    <div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">File Handler</p><p style="font-size:9px;color:#0f172a;font-weight:700;margin-top:1px">${esc(booking.fileHandler)}</p></div>
    <div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Destination</p><p style="font-size:9px;color:#0f172a;font-weight:700;margin-top:1px">${esc(destination)}</p></div>
    <div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Lead Passenger</p><p style="font-size:9px;color:#0f172a;font-weight:700;margin-top:1px">${esc(lead?.name)}</p></div>
  </div>`

  const contactsHtml = (booking.contactPhone || booking.contactWhatsapp || booking.contactEmail)
    ? `<div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;border:1px solid #e2e8f0;border-radius:6px;padding:8px 10px">
        ${booking.contactPhone ? `<div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer Phone</p><p style="font-size:9px;color:#0f172a;margin-top:1px">${esc(booking.contactPhone)}</p></div>` : ''}
        ${booking.contactWhatsapp ? `<div><p style="font-size:7.5px;color:#16a34a;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer WhatsApp</p><p style="font-size:9px;color:#0f172a;margin-top:1px">${esc(booking.contactWhatsapp)}</p></div>` : ''}
        ${booking.contactEmail ? `<div><p style="font-size:7.5px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Customer Email</p><p style="font-size:9px;color:#2563eb;margin-top:1px">${esc(booking.contactEmail)}</p></div>` : ''}
      </div>`
    : ''

  const emergencyContacts = booking.emergencyContacts ?? []
  const emergencyContactsHtml = emergencyContacts.length > 0
    ? `<div style="margin-top:10px">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#fff7f7;border-top:2px solid #dc2626;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">🚨 Emergency Contacts</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:#fff7f7;border:1px solid #fee2e2;border-top:none;border-radius:0 0 5px 5px">
          ${emergencyContacts.map(ec => `<div style="background:#fff;border:1px solid #fecaca;border-radius:5px;padding:5px 10px;min-width:140px">
            <p style="font-size:9px;font-weight:700;color:#991b1b">${esc(ec.name)}</p>
            <p style="font-size:8.5px;color:#374151;margin-top:1px">${esc(ec.phone)}</p>
            ${ec.role ? `<p style="font-size:7.5px;color:#94a3b8;margin-top:1px">${esc(ec.role)}</p>` : ''}
          </div>`).join('')}
        </div>
      </div>`
    : ''

  const flights = booking.flights ?? []
  const flightsHtml = flights.length > 0
    ? `<div style="margin-top:14px">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #2563eb;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">✈️ Flights (${flights.length})</div>
        <table>
          <thead>
            <tr>
              <th style="${thStyle}">Flight No.</th>
              <th style="${thStyle}">Date</th>
              <th style="${thStyle}">From</th>
              <th style="${thStyle}">Dep.</th>
              <th style="${thStyle}">To</th>
              <th style="${thStyle}">Arr.</th>
              <th style="${thStyle}">Airline</th>
            </tr>
          </thead>
          <tbody>
            ${flights.map(f => `<tr>
              <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#1d4ed8;border-bottom:1px solid #f1f5f9">${esc(f.flightNo)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap">${fmtDate(f.date)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(f.fromApt)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#059669;border-bottom:1px solid #f1f5f9">${esc(f.depTime)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(f.toApt)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#dc2626;border-bottom:1px solid #f1f5f9">${esc(f.arrTime)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(f.airline)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : ''

  const accommodations = booking.accommodations ?? []
  const accommodationsHtml = accommodations.length > 0
    ? `<div style="margin-top:14px">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #0891b2;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">🏨 Accommodation (${accommodations.length})</div>
        <table>
          <thead>
            <tr>
              <th style="${thStyle}">Hotel</th>
              <th style="${thStyle}">City</th>
              <th style="${thStyle}">Check-in</th>
              <th style="${thStyle}">Check-out</th>
              <th style="${thStyle}">Nights</th>
              <th style="${thStyle}">Room Type</th>
              <th style="${thStyle}">Meal Plan</th>
            </tr>
          </thead>
          <tbody>
            ${accommodations.map(a => `<tr>
              <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#0f172a;border-bottom:1px solid #f1f5f9">${esc(a.hotel)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.city)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap">${fmtDate(a.checkIn)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9;white-space:nowrap">${fmtDate(a.checkOut)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9;text-align:center">${esc(a.nights)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.roomType)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(a.mealType)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : ''

  // ── Passengers table (without passport/nationality) ──
  const passengers = booking.passengers ?? []
  const passengersHtml = passengers.length > 0
    ? `<div style="margin-top:14px">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #d97706;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">👥 Passengers (${passengers.length})</div>
        <table>
          <thead>
            <tr>
              <th style="${thStyle}">Name</th>
              <th style="${thStyle}">Type</th>
              <th style="${thStyle}">Contact</th>
              <th style="${thStyle}">Meal Preference</th>
            </tr>
          </thead>
          <tbody>
            ${passengers.map((p, i) => `<tr style="background:${p.isLead ? '#fefce8' : i % 2 === 0 ? '#fff' : '#f8fafc'}">
              <td style="padding:5px 7px;font-size:8.5px;font-weight:700;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.name)}${p.isLead ? ' <span style="font-size:7px;font-weight:700;color:#d97706;background:#fef3c7;padding:1px 4px;border-radius:3px">LEAD</span>' : ''}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.type ?? 'ADULT')}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${esc(p.contact)}</td>
              <td style="padding:5px 7px;font-size:8.5px;color:#374151;border-bottom:1px solid #f1f5f9">${p.mealPreference && p.mealPreference.trim() !== '' ? `<span style="display:inline-block;font-size:7.5px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #a7f3d0;padding:1px 5px;border-radius:3px">${esc(p.mealPreference)}</span>` : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
    : ''

  // ── Emergency contacts ──
  const emergencyHtml = emergencyContacts.length > 0
    ? `<div style="margin-top:14px">
        <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #dc2626;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">🚨 Emergency Contacts</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;background:#fff7f7;border:1px solid #fee2e2;border-top:none;border-radius:0 0 5px 5px">
          ${emergencyContacts.map(ec => `<div style="background:#fff;border:1px solid #fecaca;border-radius:5px;padding:5px 10px;min-width:140px">
            <p style="font-size:9px;font-weight:700;color:#991b1b">${ec.name}</p>
            <p style="font-size:8.5px;color:#374151;margin-top:1px">${ec.phone ?? '—'}</p>
            ${ec.role ? `<p style="font-size:7.5px;color:#94a3b8;margin-top:1px">${ec.role}</p>` : ''}
          </div>`).join('')}
        </div>
      </div>`
    : ''

  // ── Package Includes / Excludes / Exclusions / Tips ──
  function proseSection(icon: string, title: string, content: string | null | undefined, borderColor: string): string {
    if (!content || !content.trim()) return ''
    return `<div style="margin-top:14px">
      <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid ${borderColor};border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">${icon} ${title}</div>
      <div style="padding:8px 12px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 5px 5px;font-size:8.5px;color:#374151;line-height:1.7;white-space:pre-wrap">${esc(content)}</div>
    </div>`
  }

  const packageIncludesHtml  = proseSection('✅', 'Package Includes',  booking.packageIncludes,  '#16a34a')
  const packageExcludesHtml  = proseSection('❌', 'Package Excludes',  booking.packageExcludes,  '#dc2626')
  const exclusionsHtml       = proseSection('⛔', 'Exclusions',        booking.exclusions,        '#f97316')
  const tipsHtml             = proseSection('💡', 'Tips',              booking.tips,              '#eab308')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;color:#1e293b;background:#fff;font-size:10px}
  table{width:100%;border-collapse:collapse}
</style>
</head>
<body style="padding:20px 22px">
  <!-- HEADER -->
  <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #d97706;padding-bottom:10px;margin-bottom:14px">
    <div>
      <p style="font-weight:800;font-size:14px;color:#0f172a">Apple Holidays</p>
      <p style="font-size:9px;color:#64748b">Movement Chart &amp; Booking Summary</p>
    </div>
    <div style="text-align:right">
      <p style="font-weight:800;font-size:15px;font-family:monospace;color:#d97706">${esc(ref)}</p>
      ${booking.isNumber ? `<p style="font-size:8.5px;color:#2563eb;font-family:monospace;font-weight:700;margin-top:2px">IS: ${esc(booking.isNumber)}</p>` : ''}
      ${booking.agent ? `<p style="font-size:9px;color:#64748b;margin-top:2px">${esc(booking.agent)}</p>` : ''}
      <p style="font-size:8px;color:#94a3b8;margin-top:2px">${fmtDate(booking.arrivalDate)} – ${fmtDate(booking.departureDate)} · ${totalPax} pax</p>
      ${!showDrivers ? '<p style="font-size:8px;color:#94a3b8;font-style:italic">Driver info hidden</p>' : ''}
    </div>
  </div>

  ${bookingSummaryHtml}
  ${contactsHtml}
  ${emergencyContactsHtml}

  ${passengersHtml}
  ${flightsHtml}
  ${accommodationsHtml}

  <!-- MOVEMENT CHART TABLE -->
  <div style="margin-top:14px">
    <div style="font-size:9px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;background:#f1f5f9;border-top:2px solid #0f172a;border-bottom:1px solid #e2e8f0;border-radius:5px 5px 0 0">
      🗓️ Movement Chart${showDrivers ? ' (with driver allocation)' : ''}
    </div>
    <table>
      <thead>
        <tr>
          <th style="${thStyle}width:9%">Date</th>
          <th style="${thStyle}width:9%">Location</th>
          <th style="${thStyle}width:${showDrivers ? '11%' : '16%'}">From</th>
          <th style="${thStyle}width:${showDrivers ? '11%' : '16%'}">To / Activity</th>
          <th style="${thStyle}width:7%">Meal</th>
          <th style="${thStyle}width:8%">Meet / Window</th>
          <th style="${thStyle}width:10%">Service</th>
          <th style="${thStyle}width:${showDrivers ? '17%' : '26%'}">Details</th>
          ${driverTh}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  ${emergencyHtml}
  ${packageIncludesHtml}
  ${packageExcludesHtml}
  ${exclusionsHtml}
  ${tipsHtml}

  <!-- FOOTER -->
  <div style="margin-top:18px;border-top:1px solid #e2e8f0;padding-top:7px;display:flex;justify-content:space-between">
    <p style="font-size:7.5px;color:#94a3b8">Apple Holidays &middot; Confidential</p>
    <p style="font-size:7.5px;color:#94a3b8">${esc(ref)}</p>
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

  // ── Generate PDF ──────────────────────────────────────────────────────────
  const html = buildAgendaHtml(
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
    const proxyRes = await fetch(WHATSAPP_PROXY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: normPhone, message: waMessage, fileUrl, filename }),
    })
    const proxyJson = await proxyRes.json() as { success?: boolean }
    if (!proxyJson.success && !proxyRes.ok) {
      return buildApiError('WhatsApp send failed', 500)
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

    return buildApiSuccess({ sent: true, via: 'email' })
  }

  return buildApiError('Invalid mode', 400)
}
