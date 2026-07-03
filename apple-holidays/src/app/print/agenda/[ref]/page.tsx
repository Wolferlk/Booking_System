'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { countryLabel } from '@/lib/country-detection'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Passenger {
  id: string
  name: string
  type?: string | null
  age?: number | null
  passport?: string | null
  nationality?: string | null
  contact?: string | null
  isLead?: boolean
  mealPreference?: string | null
}

interface Flight {
  id: string
  flightNo: string
  date: string
  fromApt: string
  depTime?: string | null
  toApt: string
  arrTime?: string | null
  airline?: string | null
}

interface Accommodation {
  id: string
  hotel: string
  city: string
  checkIn: string
  checkOut: string
  nights: number
  roomType?: string | null
  mealType?: string | null
}

interface EmergencyContact {
  id: string
  name: string
  phone?: string | null
  role?: string | null
}

interface AgendaItem {
  id?: string
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  mealPlan: string
  meetingTime: string
  timeFrom?: string | null
  timeTo?: string | null
  serviceType: string
  assignment?: {
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
}

interface BookingInfo {
  bookingRef: string
  agent?: string | null
  fileHandler?: string | null
  paxAdults: number
  paxChildren: number
  arrivalDate: string
  departureDate: string
  tourDestination?: string | null
  operationCountry?: string | null
  agentBookingId?: string | null
  cntlNumber?: string | null
  isNumber?: string | null
  contactPhone?: string | null
  contactWhatsapp?: string | null
  contactEmail?: string | null
  agentPhone?: string | null
  agentEmail?: string | null
  passengers: Passenger[]
  flights: Flight[]
  accommodations: Accommodation[]
  emergencyContacts: EmergencyContact[]
  // notes & terms
  terms?: string | null
  exclusions?: string | null
  policyNotes?: string | null
  packageIncludes?: string | null
  packageExcludes?: string | null
  importantNotes?: string | null
  tips?: string | null
  otherNote?: string | null
  clientRequest?: string | null
  amendmentNote?: string | null
  valueAddedServices?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const SVC_LABEL: Record<string, string> = {
  PVT_TRANSFER:    'Private Transfer',
  SIC_TRANSFER:    'SIC Transfer',
  OWN_ARRANGEMENT: 'Own Arrangement',
}
const SVC_COLOR: Record<string, string> = {
  PVT_TRANSFER:    '#2563eb',
  SIC_TRANSFER:    '#059669',
  OWN_ARRANGEMENT: '#94a3b8',
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const S = {
  sectionTitle: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
    fontSize: 9,
    fontWeight: 700,
    color: '#0f172a',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.6,
    padding: '5px 10px',
    background: '#f1f5f9',
    borderBottom: '1px solid #e2e8f0',
    borderTop: '2px solid #d97706',
    borderRadius: '5px 5px 0 0',
    marginTop: 14,
  },
  th: {
    padding: '4px 7px',
    textAlign: 'left' as const,
    fontSize: 7.5,
    fontWeight: 700,
    color: '#f8fafc',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    background: '#334155',
  },
  td: {
    padding: '5px 7px',
    fontSize: 8.5,
    color: '#374151',
    borderBottom: '1px solid #f1f5f9',
  },
}

// ── Note Block Component ──────────────────────────────────────────────────────

function NoteBlock({
  icon, label, content, accentColor = '#d97706', bgColor = '#fffbeb',
}: {
  icon: string; label: string; content: string
  accentColor?: string; bgColor?: string
}) {
  if (!content || !content.trim()) return null
  const lines = content.split('\n').filter(l => l.trim())
  return (
    <div style={{
      border: `1px solid ${accentColor}40`,
      borderLeft: `3px solid ${accentColor}`,
      borderRadius: 5,
      background: bgColor,
      padding: '7px 10px',
      pageBreakInside: 'avoid' as const,
    }}>
      <p style={{
        fontSize: 8, fontWeight: 700, color: accentColor,
        textTransform: 'uppercase' as const, letterSpacing: 0.5,
        marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span>{icon}</span> {label}
      </p>
      <div style={{ fontSize: 8.5, color: '#374151', lineHeight: 1.55 }}>
        {lines.map((line, i) => {
          const trimmed = line.trim()
          const isBullet = /^[-•*▪►]/.test(trimmed)
          const isNumbered = /^\d+[\.\)]/.test(trimmed)
          const cleanText = isBullet ? trimmed.replace(/^[-•*▪►]\s*/, '') : isNumbered ? trimmed.replace(/^\d+[\.\)]\s*/, '') : trimmed
          const num = isNumbered ? trimmed.match(/^(\d+)/)?.[1] : null
          return (
            <div key={i} style={{
              display: 'flex', gap: 5, marginBottom: 2,
              alignItems: 'flex-start',
            }}>
              <span style={{
                flexShrink: 0, width: 14, height: 14,
                background: (isBullet || isNumbered) ? `${accentColor}20` : 'transparent',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 700, color: accentColor, marginTop: 1,
              }}>
                {isBullet ? '✓' : isNumbered ? num : ''}
              </span>
              <span>{cleanText}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PrintAgendaPage() {
  const { ref }      = useParams<{ ref: string }>()
  const searchParams = useSearchParams()
  const showDrivers  = searchParams.get('drivers') !== 'false'

  const [items,   setItems]   = useState<AgendaItem[]>([])
  const [booking, setBooking] = useState<BookingInfo | null>(null)
  const [ready,   setReady]   = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/bookings/${ref}/agenda`).then(r => r.json()),
      fetch(`/api/bookings/${ref}`).then(r => r.json()),
    ]).then(([agendaJson, bookingJson]) => {
      if (agendaJson.success) {
        setItems((agendaJson.data?.items ?? []).map((i: AgendaItem) => ({
          ...i,
          date: (i.date as string)?.slice(0, 10) ?? '',
        })))
      }
      if (bookingJson.success) setBooking(bookingJson.data)
      setReady(true)
    })
  }, [ref])

  useEffect(() => {
    if (!booking) return
    const safe = (value: string | null | undefined) => String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[<>:"/\\|?* -]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')

    const lead = booking.passengers.find(p => p.isLead) ?? booking.passengers[0]
    const title = [booking.isNumber ?? '', booking.bookingRef, lead?.name ?? '']
      .map(safe)
      .filter(Boolean)
      .join('_') || 'Agenda'

    document.title = title
  }, [booking])

  useEffect(() => {
    if (ready) setTimeout(() => window.print(), 600)
  }, [ready])

  if (!ready || !booking) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
        <p style={{ color: '#64748b', fontSize: 13 }}>Preparing document…</p>
      </div>
    )
  }

  const lead      = booking.passengers.find(p => p.isLead) ?? booking.passengers[0]
  const totalPax  = booking.paxAdults + booking.paxChildren

  // Check if any notes/terms sections have content
  const hasNotes = !!(
    booking.packageIncludes || booking.packageExcludes || booking.terms ||
    booking.exclusions || booking.importantNotes || booking.tips ||
    booking.clientRequest || booking.amendmentNote || booking.otherNote || booking.policyNotes
  )

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm 11mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table { border-collapse: collapse; width: 100%; }
        @media print { .no-print { display: none !important; } }
        .agenda-card { page-break-inside: avoid; }
        .notes-section { page-break-inside: avoid; }
      `}</style>

      {/* ══════════════════════════════════════════════════════
          HEADER
      ══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        borderBottom: '3px solid #d97706', paddingBottom: 10, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 48, height: 48, position: 'relative', flexShrink: 0 }}>
            <Image src="/png/aahaslogo.png" alt="Logo" fill sizes="48px" style={{ objectFit: 'contain' }} />
          </div>
          <div>
            <p style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Apple Holidays</p>
            <p style={{ fontSize: 8.5, color: '#64748b', marginTop: 1 }}>Movement Chart &amp; Booking Summary</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontWeight: 800, fontSize: 18, fontFamily: 'monospace', color: '#d97706' }}>{ref}</p>
          {booking.isNumber && (
            <p style={{ fontSize: 8.5, color: '#2563eb', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}>IS: {booking.isNumber}</p>
          )}
          {booking.cntlNumber && (
            <p style={{ fontSize: 8, color: '#7c3aed', fontFamily: 'monospace', fontWeight: 700, marginTop: 1 }}>CNTL: {booking.cntlNumber}</p>
          )}
          {booking.agentBookingId && (
            <p style={{ fontSize: 8, color: '#64748b', fontFamily: 'monospace', marginTop: 1 }}>Ref: {booking.agentBookingId}</p>
          )}
          <p style={{ fontSize: 8, color: '#64748b', marginTop: 3 }}>
            {formatDate(booking.arrivalDate)} — {formatDate(booking.departureDate)}
          </p>
          <p style={{ fontSize: 8, color: '#64748b', marginTop: 1 }}>
            {totalPax} pax ({booking.paxAdults} adult{booking.paxAdults !== 1 ? 's' : ''}
            {booking.paxChildren > 0 ? `, ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''})
          </p>
          {!showDrivers && (
            <p style={{ fontSize: 7.5, color: '#94a3b8', fontStyle: 'italic', marginTop: 2 }}>Driver info hidden</p>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          BOOKING SUMMARY STRIP
      ══════════════════════════════════════════════════════ */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
        marginBottom: 14, background: '#f8fafc', borderRadius: 6,
        border: '1px solid #e2e8f0', padding: '8px 10px',
      }}>
        {[
          { label: 'Tour Operator / Agent', value: booking.agent ?? '—' },
          { label: 'File Handler',          value: booking.fileHandler ?? '—' },
          { label: 'Destination',           value: booking.tourDestination?.trim() || (booking.operationCountry ? countryLabel(booking.operationCountry as never) : '—') },
          { label: 'Lead Passenger',        value: lead?.name ?? '—' },
        ].map(({ label, value }) => (
          <div key={label}>
            <p style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
            <p style={{ fontSize: 9.5, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>{value}</p>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          CONTACT INFO
      ══════════════════════════════════════════════════════ */}
      {(booking.contactPhone || booking.contactWhatsapp || booking.contactEmail) && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
          marginBottom: 14, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px',
        }}>
          {booking.contactPhone && (
            <div>
              <p style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer Phone</p>
              <p style={{ fontSize: 9, color: '#0f172a', marginTop: 1 }}>{booking.contactPhone as string}</p>
            </div>
          )}
          {booking.contactWhatsapp && (
            <div>
              <p style={{ fontSize: 7.5, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer WhatsApp</p>
              <p style={{ fontSize: 9, color: '#0f172a', marginTop: 1 }}>{booking.contactWhatsapp as string}</p>
            </div>
          )}
          {booking.contactEmail && (
            <div>
              <p style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer Email</p>
              <p style={{ fontSize: 9, color: '#2563eb', marginTop: 1 }}>{booking.contactEmail as string}</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          PASSENGERS
      ══════════════════════════════════════════════════════ */}
      {booking.passengers.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={S.sectionTitle}>
            <span>👥 Passengers</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, background: '#d97706', padding: '1px 9px', color: '#fff', borderRadius: 10, textTransform: 'none', letterSpacing: 0 }}>
              {booking.paxAdults} adult{booking.paxAdults !== 1 ? 's' : ''}{booking.paxChildren > 0 ? ` · ${booking.paxChildren} child${booking.paxChildren !== 1 ? 'ren' : ''}` : ''}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                {['Name', 'Type', 'Contact', 'Meal Preference'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {booking.passengers.map((p, i) => (
                <tr key={p.id} style={{ background: p.isLead ? '#fefce8' : i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ ...S.td, fontWeight: 700 }}>
                    {p.name}
                    {p.isLead && (
                      <span style={{ marginLeft: 5, fontSize: 7, fontWeight: 700, color: '#d97706', background: '#fef3c7', padding: '1px 4px', borderRadius: 3 }}>LEAD</span>
                    )}
                  </td>
                  <td style={S.td}>{p.type ?? 'ADULT'}</td>
                  <td style={S.td}>{p.contact ?? '—'}</td>
                  <td style={S.td}>
                    {p.mealPreference && p.mealPreference.trim() !== ''
                      ? <span style={{ display: 'inline-block', fontSize: 7.5, fontWeight: 700, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1px 5px', borderRadius: 3 }}>{p.mealPreference}</span>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          FLIGHTS
      ══════════════════════════════════════════════════════ */}
      {booking.flights.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={S.sectionTitle}>✈️ Flights ({booking.flights.length} segment{booking.flights.length !== 1 ? 's' : ''})</div>
          <table>
            <thead>
              <tr>
                {['Flight No.', 'Date', 'From', 'Dep.', 'To', 'Arr.'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {booking.flights.map((f, i) => (
                <tr key={f.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 700, color: '#1d4ed8' }}>{f.flightNo}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{formatDate(f.date)}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{f.fromApt}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#059669' }}>{f.depTime ?? '—'}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{f.toApt}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: '#dc2626' }}>{f.arrTime ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ACCOMMODATIONS
      ══════════════════════════════════════════════════════ */}
      {booking.accommodations.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={S.sectionTitle}>🏨 Accommodation ({booking.accommodations.length} hotel{booking.accommodations.length !== 1 ? 's' : ''})</div>
          <table>
            <thead>
              <tr>
                {['Hotel', 'City', 'Check-in', 'Check-out', 'Nights', 'Room Type', 'Meal Plan'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {booking.accommodations.map((a, i) => (
                <tr key={a.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ ...S.td, fontWeight: 700 }}>{a.hotel}</td>
                  <td style={S.td}>{a.city}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{formatDate(a.checkIn)}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{formatDate(a.checkOut)}</td>
                  <td style={{ ...S.td, fontWeight: 700, textAlign: 'center' }}>{a.nights}</td>
                  <td style={S.td}>{a.roomType ?? '—'}</td>
                  <td style={S.td}>{a.mealType ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          MOVEMENT CHART (AGENDA) — card layout
      ══════════════════════════════════════════════════════ */}
      {items.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={{ ...S.sectionTitle, borderTop: '2px solid #0f172a' }}>
            🗓️ Movement Chart — {items.length} item{items.length !== 1 ? 's' : ''}
            {showDrivers ? ' (with driver allocation)' : ' (driver info hidden)'}
          </div>

          {/* Group items by date */}
          {(() => {
            const grouped: Record<string, AgendaItem[]> = {}
            items.forEach(item => {
              const key = item.date || 'unknown'
              if (!grouped[key]) grouped[key] = []
              grouped[key].push(item)
            })

            return Object.entries(grouped).map(([date, dayItems]) => (
              <div key={date} className="agenda-card" style={{
                marginBottom: 8,
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                overflow: 'hidden',
                pageBreakInside: 'avoid' as const,
              }}>
                {/* Day Header */}
                <div style={{
                  background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                  padding: '5px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <div style={{
                    background: '#d97706',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 9,
                    fontWeight: 800,
                    color: '#fff',
                    whiteSpace: 'nowrap' as const,
                  }}>
                    {formatDate(date)}
                  </div>
                  <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 600 }}>
                    {dayItems[0]?.location || ''}
                  </div>
                </div>

                {/* Day Items */}
                {dayItems.map((item, idx) => {
                  const a   = item.assignment
                  const svc = item.serviceType
                  const clr = SVC_COLOR[svc] ?? '#94a3b8'
                  const displayVendorName   = a?.vendorName   ?? a?.vendor?.name   ?? null
                  const displayVendorPhone  = a?.vendor?.phone ?? null
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

                  const hasDetails = item.details && item.details.trim()

                  return (
                    <div key={idx} style={{
                      borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none',
                      background: idx % 2 === 0 ? '#ffffff' : '#f8fafc',
                    }}>
                      {/* Info Row */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: showDrivers
                          ? '1fr 1fr 50px 80px 90px 110px'
                          : '1fr 1fr 50px 80px 90px',
                        gap: 0,
                        alignItems: 'stretch',
                        minHeight: 28,
                      }}>
                        {/* From → To */}
                        <div style={{
                          padding: '5px 8px',
                          borderRight: '1px solid #f1f5f9',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          justifyContent: 'center',
                        }}>
                          <div style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>From</div>
                          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>{item.fromPoint || '—'}</div>
                        </div>
                        <div style={{
                          padding: '5px 8px',
                          borderRight: '1px solid #f1f5f9',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          justifyContent: 'center',
                        }}>
                          <div style={{ fontSize: 7.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>To / Activity</div>
                          <div style={{ fontSize: 8.5, fontWeight: 700, color: '#0f172a', marginTop: 1 }}>{item.toPoint || '—'}</div>
                        </div>

                        {/* Meal */}
                        <div style={{
                          padding: '5px 6px',
                          borderRight: '1px solid #f1f5f9',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                          <div style={{ fontSize: 7, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>Meal</div>
                          {normalizeMealPlan(item.mealPlan) !== '—' ? (
                            <div style={{
                              marginTop: 2, fontSize: 7, fontWeight: 700,
                              color: '#047857', background: '#ecfdf5',
                              border: '1px solid #a7f3d0', borderRadius: 3,
                              padding: '1px 3px', textAlign: 'center' as const,
                            }}>
                              {normalizeMealPlan(item.mealPlan).split(', ').map(m => m[0]).join('+')}
                            </div>
                          ) : (
                            <div style={{ fontSize: 7.5, color: '#cbd5e1' }}>—</div>
                          )}
                        </div>

                        {/* Meet Time */}
                        <div style={{
                          padding: '5px 6px',
                          borderRight: '1px solid #f1f5f9',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                          <div style={{ fontSize: 7, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3 }}>Meet</div>
                          <div style={{
                            marginTop: 2, fontSize: 8,
                            fontWeight: meetDisplay !== '—' ? 800 : 400,
                            color: meetDisplay !== '—' ? '#059669' : '#cbd5e1',
                          }}>
                            {meetDisplay}
                          </div>
                        </div>

                        {/* Service Type */}
                        <div style={{
                          padding: '5px 6px',
                          borderRight: showDrivers ? '1px solid #f1f5f9' : 'none',
                          display: 'flex',
                          flexDirection: 'column' as const,
                          justifyContent: 'center',
                          alignItems: 'center',
                        }}>
                          <div style={{ fontSize: 7, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 2 }}>Service</div>
                          {svc === 'OWN_ARRANGEMENT' ? (
                            <span style={{ fontSize: 7, color: '#94a3b8', fontStyle: 'italic' }}>Own Arr.</span>
                          ) : (
                            <span style={{
                              display: 'inline-block', padding: '2px 5px', borderRadius: 3,
                              fontSize: 7, fontWeight: 700, color: clr,
                              background: `${clr}18`, border: `1px solid ${clr}38`,
                              textAlign: 'center' as const,
                            }}>
                              {svc === 'PVT_TRANSFER' ? 'Private' : svc === 'SIC_TRANSFER' ? 'SIC' : SVC_LABEL[svc] ?? svc}
                            </span>
                          )}
                        </div>

                        {/* Driver / Vehicle */}
                        {showDrivers && (
                          <div style={{
                            padding: '5px 7px',
                            display: 'flex',
                            flexDirection: 'column' as const,
                            justifyContent: 'center',
                          }}>
                            {a?.vendorId || displayVendorName ? (
                              <>
                                <p style={{ fontWeight: 700, color: '#7c3aed', fontSize: 8 }}>{displayVendorName ?? '—'}</p>
                                {displayVendorPhone && <p style={{ marginTop: 1, color: '#64748b', fontSize: 7.5 }}>{displayVendorPhone}</p>}
                                {displayDriverName && <p style={{ marginTop: 1, fontSize: 7.5 }}>{displayDriverName}{displayDriverPhone ? ` · ${displayDriverPhone}` : ''}</p>}
                                {displayVehiclePlate && <p style={{ fontFamily: 'monospace', color: '#64748b', marginTop: 1, fontSize: 7.5 }}>{displayVehicleType} {displayVehiclePlate}</p>}
                              </>
                            ) : displayDriverName ? (
                              <>
                                <p style={{ fontWeight: 700, color: '#1d4ed8', fontSize: 8 }}>{displayDriverName}</p>
                                {displayDriverPhone && <p style={{ color: '#64748b', marginTop: 1, fontSize: 7.5 }}>{displayDriverPhone}</p>}
                                {displayVehiclePlate && <p style={{ fontFamily: 'monospace', color: '#64748b', marginTop: 1, fontSize: 7.5 }}>{displayVehicleType} {displayVehiclePlate}</p>}
                              </>
                            ) : (
                              <span style={{ color: '#cbd5e1', fontStyle: 'italic', fontSize: 7.5 }}>Not assigned</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Description Block — full width, clearly separated */}
                      {hasDetails && (
                        <div style={{
                          borderTop: '1px dashed #e2e8f0',
                          background: idx % 2 === 0 ? '#f8fafc' : '#f1f5f9',
                          padding: '6px 10px 7px 10px',
                          display: 'flex',
                          gap: 6,
                        }}>
                          <div style={{
                            flexShrink: 0,
                            width: 2,
                            background: clr,
                            borderRadius: 2,
                            opacity: 0.5,
                          }} />
                          <p style={{
                            fontSize: 8,
                            color: '#374151',
                            lineHeight: 1.65,
                            whiteSpace: 'pre-wrap' as const,
                          }}>
                            {item.details}
                          </p>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          EMERGENCY CONTACTS
      ══════════════════════════════════════════════════════ */}
      {booking.emergencyContacts.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={{ ...S.sectionTitle, borderTop: '2px solid #dc2626' }}>🚨 Emergency Contacts</div>
          <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6, padding: '8px 10px', background: '#fff7f7', border: '1px solid #fee2e2', borderTop: 'none', borderRadius: '0 0 5px 5px' }}>
            {booking.emergencyContacts.map(ec => (
              <div key={ec.id} style={{ background: '#fff', border: '1px solid #fecaca', borderRadius: 5, padding: '5px 10px', minWidth: 140 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: '#991b1b' }}>{ec.name}</p>
                <p style={{ fontSize: 8.5, color: '#374151', marginTop: 1 }}>{ec.phone ?? '—'}</p>
                {ec.role && <p style={{ fontSize: 7.5, color: '#94a3b8', marginTop: 1 }}>{ec.role}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          NOTES & TERMS SECTIONS
      ══════════════════════════════════════════════════════ */}
      {hasNotes && (
        <div style={{ marginTop: 16 }}>
          {/* Section Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            paddingBottom: 6,
            borderBottom: '2px solid #e2e8f0',
          }}>
            <div style={{
              width: 3, height: 18, background: '#d97706', borderRadius: 2,
            }} />
            <p style={{
              fontSize: 10, fontWeight: 800, color: '#0f172a',
              textTransform: 'uppercase' as const, letterSpacing: 0.8,
            }}>
              Package Details &amp; Notes
            </p>
          </div>

          {/* Amendment Note — highlighted at top if present */}
          {booking.amendmentNote && (
            <div style={{
              marginBottom: 8,
              border: '1px solid #fbbf2440',
              borderLeft: '4px solid #d97706',
              borderRadius: 5,
              background: '#fffbeb',
              padding: '7px 10px',
              pageBreakInside: 'avoid' as const,
            }}>
              <p style={{
                fontSize: 8, fontWeight: 700, color: '#b45309',
                textTransform: 'uppercase' as const, letterSpacing: 0.5,
                marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                ✏️ Amendment Note
              </p>
              <p style={{ fontSize: 8.5, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                {booking.amendmentNote}
              </p>
            </div>
          )}

          {/* Client Request — highlighted */}
          {booking.clientRequest && (
            <div style={{
              marginBottom: 8,
              border: '1px solid #3b82f640',
              borderLeft: '4px solid #2563eb',
              borderRadius: 5,
              background: '#eff6ff',
              padding: '7px 10px',
              pageBreakInside: 'avoid' as const,
            }}>
              <p style={{
                fontSize: 8, fontWeight: 700, color: '#1d4ed8',
                textTransform: 'uppercase' as const, letterSpacing: 0.5,
                marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4,
              }}>
                💬 Client Request
              </p>
              <p style={{ fontSize: 8.5, color: '#374151', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const }}>
                {booking.clientRequest}
              </p>
            </div>
          )}

          {/* Package Includes & Excludes — side by side */}
          {(booking.packageIncludes || booking.packageExcludes) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: booking.packageIncludes && booking.packageExcludes ? '1fr 1fr' : '1fr',
              gap: 8,
              marginBottom: 8,
              pageBreakInside: 'avoid' as const,
            }}>
              {booking.packageIncludes && (
                <NoteBlock
                  icon="✅"
                  label="Above Package Includes"
                  content={booking.packageIncludes}
                  accentColor="#16a34a"
                  bgColor="#f0fdf4"
                />
              )}
              {booking.packageExcludes && (
                <NoteBlock
                  icon="❌"
                  label="The Above Package Excludes"
                  content={booking.packageExcludes}
                  accentColor="#dc2626"
                  bgColor="#fef2f2"
                />
              )}
            </div>
          )}

          {/* Terms & Conditions and Exclusions — side by side */}
          {(booking.terms || booking.exclusions) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: booking.terms && booking.exclusions ? '1fr 1fr' : '1fr',
              gap: 8,
              marginBottom: 8,
              pageBreakInside: 'avoid' as const,
            }}>
              {booking.terms && (
                <NoteBlock
                  icon="📋"
                  label="Terms &amp; Conditions"
                  content={booking.terms}
                  accentColor="#7c3aed"
                  bgColor="#faf5ff"
                />
              )}
              {booking.exclusions && (
                <NoteBlock
                  icon="⚠️"
                  label="Exclusions"
                  content={booking.exclusions}
                  accentColor="#ea580c"
                  bgColor="#fff7ed"
                />
              )}
            </div>
          )}

          {/* Important Notes */}
          {booking.importantNotes && (
            <div style={{ marginBottom: 8 }}>
              <NoteBlock
                icon="⚡"
                label="Important Notes"
                content={booking.importantNotes}
                accentColor="#dc2626"
                bgColor="#fef2f2"
              />
            </div>
          )}

          {/* Tips */}
          {booking.tips && (
            <div style={{ marginBottom: 8 }}>
              <NoteBlock
                icon="💡"
                label="Tips"
                content={booking.tips}
                accentColor="#0891b2"
                bgColor="#ecfeff"
              />
            </div>
          )}

          {/* Policy Notes */}
          {booking.policyNotes && (
            <div style={{ marginBottom: 8 }}>
              <NoteBlock
                icon="📜"
                label="Policy Notes"
                content={booking.policyNotes}
                accentColor="#7c3aed"
                bgColor="#faf5ff"
              />
            </div>
          )}

          {/* Other Note */}
          {booking.otherNote && (
            <div style={{ marginBottom: 8 }}>
              <NoteBlock
                icon="📝"
                label="Other Note"
                content={booking.otherNote}
                accentColor="#64748b"
                bgColor="#f8fafc"
              />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════════════════ */}
      <div style={{
        marginTop: 18, borderTop: '1px solid #e2e8f0', paddingTop: 8,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <p style={{ fontSize: 7.5, color: '#94a3b8' }}>Apple Holidays Booking System — Confidential</p>
        <p style={{ fontSize: 7.5, color: '#94a3b8' }}>
          Printed: {new Date().toLocaleString('en-GB', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </>
  )
}
