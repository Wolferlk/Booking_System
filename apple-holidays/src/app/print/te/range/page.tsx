'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Flight {
  id: string
  flightNo: string
  date: string
  fromApt: string
  depTime: string
  toApt: string
  arrTime: string
  airline: string | null
}

interface Accommodation {
  id: string
  hotel: string
  city: string
  checkIn: string
  checkOut: string
  roomType: string | null
  mealType: string | null
  nights: number
}

interface Passenger {
  id: string
  name: string
  type: string
  isLead: boolean
  passport: string | null
  nationality: string | null
}

interface EmergencyContact {
  id: string
  name: string
  phone: string | null
  role: string | null
}

interface AgendaItem {
  id: string
  date: string
  location: string
  fromPoint: string | null
  toPoint: string | null
  meetingTime: string | null
  serviceType: string
}

interface Booking {
  id: string
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: string
  paxAdults: number
  paxChildren: number
  arrivalDate: string
  departureDate: string
  quotedTotal: number | null
  currency: string
  passengers: Passenger[]
  flights: Flight[]
  accommodations: Accommodation[]
  emergencyContacts: EmergencyContact[]
  tourAgenda?: { items: AgendaItem[] } | null
  contactPhone?: string | null
  contactEmail?: string | null
  agentPhone?: string | null
  agentEmail?: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateShort(d: string | Date): string {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fmtDateRange(from: string, to: string): string {
  const f = new Date(from)
  const t = new Date(to)
  if (from === to) return fmtDate(f)
  return `${fmtDate(f)} — ${fmtDate(t)}`
}

const S: Record<string, React.CSSProperties> = {
  page:       { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11, color: '#1e293b', padding: '24px 28px', maxWidth: 940, margin: '0 auto' },
  headerWrap: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, borderBottom: '3px solid #d97706', paddingBottom: 12 },
  logoName:   { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  logoSub:    { fontSize: 10, color: '#64748b', marginTop: 2 },
  titleRight: { textAlign: 'right' as const },
  reportTitle:{ fontSize: 14, fontWeight: 'bold', color: '#d97706' },
  dateStr:    { fontSize: 12, fontWeight: '600', color: '#0f172a', marginTop: 2 },
  genTime:    { fontSize: 9, color: '#94a3b8', marginTop: 2 },
  summaryBar: { display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' as const },
  summaryItem:{ fontSize: 11, color: '#64748b' },
  card:       { border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 12, pageBreakInside: 'avoid' as const },
  cardHead:   { display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', borderRadius: '6px 6px 0 0' },
  cardBody:   { padding: '8px 12px' },
  twoCol:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 },
  label9:     { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase' as const, letterSpacing: 0.5, color: '#94a3b8', marginBottom: 3 },
  table:      { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10, marginBottom: 6 },
  th:         { backgroundColor: '#f1f5f9', padding: '4px 6px', textAlign: 'left' as const, fontSize: 9, fontWeight: 'bold', color: '#64748b', borderBottom: '1px solid #e2e8f0' },
  td:         { padding: '3px 6px', borderBottom: '1px solid #f8fafc', verticalAlign: 'top' as const },
  footer:     { marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 6, fontSize: 9, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' },
}

// ─── Range Print Content ──────────────────────────────────────────────────────

function RangePrintContent() {
  const params = useSearchParams()
  const from   = params.get('from') ?? new Date().toISOString().slice(0, 10)
  const to     = params.get('to')   ?? from

  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  useEffect(() => {
    const url = from === to
      ? `/api/te/live?mode=range&from=${from}&to=${to}`
      : `/api/te/live?mode=range&from=${from}&to=${to}`
    fetch(url)
      .then(r => r.json())
      .then(json => {
        if (json.success) setBookings(json.data.bookings)
        else setError(json.error ?? 'Failed to load')
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => {
    if (!loading && !error) setTimeout(() => window.print(), 600)
  }, [loading, error])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading report…</div>
  if (error)   return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>Error: {error}</div>

  const totalPax   = bookings.reduce((s, b) => s + b.paxAdults + b.paxChildren, 0)
  const totalFlights = bookings.reduce((s, b) => s + (b.flights?.length ?? 0), 0)

  return (
    <div style={S.page}>

      {/* ── Report header ── */}
      <div style={S.headerWrap}>
        <div>
          <div style={S.logoName}>Apple Holidays</div>
          <div style={S.logoSub}>MMT Vietnam · Tour Operations</div>
        </div>
        <div style={S.titleRight}>
          <div style={S.reportTitle}>BOOKINGS OVERVIEW REPORT</div>
          <div style={S.dateStr}>{fmtDateRange(from, to)}</div>
          <div style={S.genTime}>Generated: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      {/* ── Summary bar ── */}
      <div style={S.summaryBar}>
        {[
          { label: 'Total Bookings', value: bookings.length, color: '#7c3aed' },
          { label: 'Total Pax',      value: totalPax,         color: '#1d4ed8' },
          { label: 'Total Flights',  value: totalFlights,     color: '#4338ca' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 16px', backgroundColor: '#f8fafc' }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#64748b' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Booking cards ── */}
      {bookings.map(b => {
        const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
        const contactPhone = b.contactPhone ?? b.agentPhone
        const contactEmail = b.contactEmail ?? b.agentEmail

        return (
          <div key={b.id} style={S.card}>

            {/* Card header */}
            <div style={S.cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 'bold', fontSize: 14, fontFamily: 'monospace', color: '#d97706' }}>{b.bookingRef}</span>
                <span style={{ fontSize: 9, backgroundColor: '#f1f5f9', color: '#64748b', padding: '1px 7px', borderRadius: 10, fontWeight: 'bold' }}>
                  {b.status.replace(/_/g, ' ')}
                </span>
                {b.agent && <span style={{ fontSize: 10, color: '#64748b' }}>{b.agent}</span>}
              </div>
              <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b' }}>
                <div>{fmtDateShort(b.arrivalDate)} → {fmtDateShort(b.departureDate)}</div>
                <div>{b.paxAdults}A{b.paxChildren > 0 ? ` ${b.paxChildren}C` : ''}{b.fileHandler ? ` · ${b.fileHandler}` : ''}</div>
              </div>
            </div>

            <div style={S.cardBody}>
              <div style={S.twoCol}>

                {/* Left: Passengers + Contacts */}
                <div>
                  <div style={S.label9}>Passengers</div>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Name</th>
                        <th style={S.th}>Type</th>
                        <th style={S.th}>Passport</th>
                        <th style={S.th}>Nationality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.passengers.map(p => (
                        <tr key={p.id}>
                          <td style={S.td}>
                            <span style={{ fontWeight: p.isLead ? 'bold' : 'normal' }}>{p.name}</span>
                            {p.isLead && <span style={{ fontSize: 8, color: '#d97706', marginLeft: 4 }}>★ LEAD</span>}
                          </td>
                          <td style={S.td}>{p.type}</td>
                          <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 9 }}>{p.passport ?? '—'}</td>
                          <td style={S.td}>{p.nationality ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Contact info */}
                  {(contactPhone || contactEmail || b.emergencyContacts.length > 0) && (
                    <div style={{ marginTop: 6 }}>
                      <div style={S.label9}>Contact Information</div>
                      {contactPhone && (
                        <div style={{ fontSize: 10, marginBottom: 2 }}>
                          <span style={{ color: '#94a3b8' }}>Phone: </span>
                          <span style={{ fontWeight: '600', color: '#0891b2' }}>{contactPhone}</span>
                        </div>
                      )}
                      {contactEmail && (
                        <div style={{ fontSize: 10, marginBottom: 4 }}>
                          <span style={{ color: '#94a3b8' }}>Email: </span>
                          <span style={{ color: '#4338ca' }}>{contactEmail}</span>
                        </div>
                      )}
                      {b.emergencyContacts.map(ec => (
                        <div key={ec.id} style={{ fontSize: 10, marginBottom: 2 }}>
                          <span style={{ color: '#94a3b8' }}>{ec.role ?? 'Emergency'}: </span>
                          <strong>{ec.name}</strong>
                          {ec.phone && <span style={{ color: '#0891b2' }}> · {ec.phone}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Flights + Hotels */}
                <div>
                  {/* Flights */}
                  {(b.flights?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={S.label9}>Flights</div>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>Flight</th>
                            <th style={S.th}>Date</th>
                            <th style={S.th}>Route</th>
                            <th style={S.th}>Times</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.flights.map(f => (
                            <tr key={f.id}>
                              <td style={{ ...S.td, fontFamily: 'monospace', fontWeight: 'bold', color: '#4338ca' }}>{f.flightNo}</td>
                              <td style={S.td}>{fmtDateShort(f.date)}</td>
                              <td style={S.td}>{f.fromApt} → {f.toApt}</td>
                              <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 9 }}>{f.depTime} / {f.arrTime}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Accommodations */}
                  {(b.accommodations?.length ?? 0) > 0 && (
                    <div>
                      <div style={S.label9}>Accommodation</div>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>Hotel</th>
                            <th style={S.th}>City</th>
                            <th style={S.th}>Check-in</th>
                            <th style={S.th}>Nights</th>
                            <th style={S.th}>Room</th>
                          </tr>
                        </thead>
                        <tbody>
                          {b.accommodations.map(a => (
                            <tr key={a.id}>
                              <td style={{ ...S.td, fontWeight: '600' }}>{a.hotel}</td>
                              <td style={S.td}>{a.city}</td>
                              <td style={S.td}>{fmtDateShort(a.checkIn)}</td>
                              <td style={S.td}>{a.nights}N</td>
                              <td style={{ ...S.td, fontSize: 9, color: '#64748b' }}>{a.roomType ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Tour agenda (3 items shown) */}
                  {(b.tourAgenda?.items?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={S.label9}>Movement Chart (preview)</div>
                      {(b.tourAgenda?.items ?? []).slice(0, 5).map(item => (
                        <div key={item.id} style={{ display: 'flex', gap: 6, fontSize: 9, padding: '2px 0', color: '#475569' }}>
                          <span style={{ color: '#94a3b8', minWidth: 50 }}>{fmtDateShort(item.date)}</span>
                          <span style={{ fontFamily: 'monospace', color: '#d97706', minWidth: 38 }}>{item.meetingTime ?? '—'}</span>
                          <span>
                            {item.fromPoint && item.toPoint
                              ? `${item.fromPoint} → ${item.toPoint}`
                              : item.location}
                          </span>
                        </div>
                      ))}
                      {(b.tourAgenda?.items?.length ?? 0) > 5 && (
                        <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
                          +{(b.tourAgenda?.items?.length ?? 0) - 5} more items — see full booking
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {bookings.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
          No active bookings for this period.
        </div>
      )}

      {/* ── Footer ── */}
      <div style={S.footer}>
        <span>Apple Holidays · MMT Vietnam · Bookings Overview · {fmtDateRange(from, to)}</span>
        <span>Confidential — Internal Use Only</span>
      </div>

      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 12mm 14mm; size: A4; }
        }
      `}</style>
    </div>
  )
}

export default function RangePrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
      <RangePrintContent />
    </Suspense>
  )
}
