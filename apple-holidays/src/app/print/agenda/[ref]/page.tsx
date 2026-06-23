'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Passenger {
  id: string
  name: string
  type?: string | null
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
  serviceType: string
  assignment?: {
    vendorId?: string | null
    vendorName?: string | null
    driverName?: string | null
    driverPhone?: string | null
    vehicleType?: string | null
    vehiclePlate?: string | null
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
  agentBookingId?: string | null
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

  return (
    <>
      <style>{`
        @page { size: A4; margin: 12mm 11mm; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        table { border-collapse: collapse; width: 100%; }
        @media print { .no-print { display: none !important; } }
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
            <p style={{ fontSize: 8.5, color: '#64748b', marginTop: 1 }}>  Movement Chart &amp; Booking Summary</p>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontWeight: 800, fontSize: 18, fontFamily: 'monospace', color: '#d97706' }}>{ref}</p>
          {booking.isNumber && (
            <p style={{ fontSize: 8.5, color: '#2563eb', fontFamily: 'monospace', fontWeight: 700, marginTop: 2 }}> : {booking.isNumber}</p>
          )}
          {booking.agentBookingId && (
            <p style={{ fontSize: 8, color: '#7c3aed', fontFamily: 'monospace', marginTop: 1 }}>Ref: {booking.agentBookingId}</p>
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
          { label: 'Destination',           value: booking.tourDestination ?? '—' },
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
          <div style={S.sectionTitle}>👥 Passengers ({booking.passengers.length})</div>
          <table>
            <thead>
              <tr>
                {['Name', 'Type', 'Meal Preference'].map(h => (
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
          MOVEMENT CHART (AGENDA)
      ══════════════════════════════════════════════════════ */}
      {items.length > 0 && (
        <div style={{ marginBottom: 2 }}>
          <div style={{ ...S.sectionTitle, borderTop: '2px solid #0f172a' }}>
            🗓️ Movement Chart — {items.length} item{items.length !== 1 ? 's' : ''}
            {showDrivers ? ' (with driver allocation)' : ' (driver info hidden)'}
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ ...S.th, width: '9%' }}>Date</th>
                <th style={{ ...S.th, width: '9%' }}>Location</th>
                <th style={{ ...S.th, width: showDrivers ? '11%' : '16%' }}>From</th>
                <th style={{ ...S.th, width: showDrivers ? '11%' : '16%' }}>To</th>
                <th style={{ ...S.th, width: '7%' }}>Meal</th>
                <th style={{ ...S.th, width: '6%' }}>Meet</th>
                <th style={{ ...S.th, width: '9%' }}>Service</th>
                <th style={{ ...S.th, width: showDrivers ? '17%' : '26%' }}>Details / Timings</th>
                {showDrivers && <th style={{ ...S.th, width: '18%' }}>Driver / Vehicle</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => {
                const a   = item.assignment
                const svc = item.serviceType
                const clr = SVC_COLOR[svc] ?? '#94a3b8'
                return (
                  <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...S.td, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 8.5 }}>
                      {formatDate(item.date)}
                    </td>
                    <td style={{ ...S.td, fontSize: 8.5 }}>{item.location || '—'}</td>
                    <td style={{ ...S.td, fontSize: 8.5 }}>
                      {item.fromPoint || '—'}
                    </td>
                    <td style={{ ...S.td, fontSize: 8.5 }}>
                      {item.toPoint || '—'}
                    </td>
                    <td style={{ ...S.td, fontSize: 8 }}>{item.mealPlan || '—'}</td>
                    <td style={{ ...S.td, fontSize: 8.5, fontWeight: item.meetingTime ? 700 : 400, color: item.meetingTime ? '#059669' : '#94a3b8' }}>
                      {item.meetingTime || '—'}
                    </td>
                    <td style={S.td}>
                      {svc === 'OWN_ARRANGEMENT' ? null : (
                        <span style={{
                          display: 'inline-block', padding: '2px 5px', borderRadius: 3,
                          fontSize: 7.5, fontWeight: 700, color: clr,
                          background: `${clr}18`, border: `1px solid ${clr}38`,
                        }}>
                          {SVC_LABEL[svc] ?? svc}
                        </span>
                      )}
                    </td>
                    <td style={{ ...S.td, fontSize: 8, lineHeight: 1.45 }}>
                      {item.details || '—'}
                    </td>
                    {showDrivers && (
                      <td style={{ ...S.td, fontSize: 8 }}>
                        {a?.vendorId ? (
                          <>
                            <p style={{ fontWeight: 700, color: '#7c3aed' }}>{a.vendorName}</p>
                            {a.driverName && <p style={{ marginTop: 1 }}>{a.driverName}{a.driverPhone ? ` · ${a.driverPhone}` : ''}</p>}
                            {a.vehiclePlate && <p style={{ fontFamily: 'monospace', color: '#64748b', marginTop: 1 }}>{a.vehicleType} {a.vehiclePlate}</p>}
                          </>
                        ) : a?.driverName ? (
                          <>
                            <p style={{ fontWeight: 700, color: '#1d4ed8' }}>{a.driverName}</p>
                            {a.driverPhone && <p style={{ color: '#64748b', marginTop: 1 }}>{a.driverPhone}</p>}
                            {a.vehiclePlate && <p style={{ fontFamily: 'monospace', color: '#64748b', marginTop: 1 }}>{a.vehicleType} {a.vehiclePlate}</p>}
                          </>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Not assigned</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          EMERGENCY CONTACTS — shown at the bottom of the sheet
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
