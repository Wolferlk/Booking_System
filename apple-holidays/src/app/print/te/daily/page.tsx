'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgendaItem {
  id: string
  date: string
  location: string
  fromPoint: string | null
  toPoint: string | null
  details: string | null
  mealPlan: string | null
  meetingTime: string | null
  serviceType: 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'
}

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
}

interface Passenger {
  id: string
  name: string
  type: string
  isLead: boolean
}

interface EmergencyContact {
  id: string
  name: string
  phone: string | null
  role: string | null
}

interface DailyBooking {
  id: string
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: string
  paxAdults: number
  paxChildren: number
  arrivalDate: string
  departureDate: string
  passengers: Passenger[]
  emergencyContacts: EmergencyContact[]
  agendaItems: AgendaItem[]
  flights: Flight[]
  checkIns: Accommodation[]
  checkOuts: Accommodation[]
  stayingAt: Accommodation | null
  isArriving: boolean
  isDeparting: boolean
  hasActivity: boolean
}

interface DailySummary {
  totalActive: number
  withActivity: number
  totalFlights: number
  totalAgendaItems: number
  totalCheckIns: number
  totalCheckOuts: number
  totalArrivals: number
  totalDepartures: number
}

interface DayData {
  date: string
  bookings: DailyBooking[]
  summary: DailySummary
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(ymd: string): string {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function fmtDateShort(ymd: string): string {
  return new Date(ymd + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const S: Record<string, React.CSSProperties> = {
  page:       { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 11, color: '#1e293b', padding: '24px 28px', maxWidth: 900, margin: '0 auto' },
  headerWrap: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, borderBottom: '3px solid #d97706', paddingBottom: 12 },
  logoName:   { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  logoSub:    { fontSize: 10, color: '#64748b', marginTop: 2 },
  titleRight: { textAlign: 'right' as const },
  reportTitle:{ fontSize: 14, fontWeight: 'bold', color: '#d97706' },
  dateStr:    { fontSize: 12, fontWeight: '600', color: '#0f172a', marginTop: 2 },
  genTime:    { fontSize: 9, color: '#94a3b8', marginTop: 2 },
  statsGrid:  { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 5, marginBottom: 14 },
  statBox:    { textAlign: 'center' as const, border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 3px', backgroundColor: '#f8fafc' },
  sectionHead:{ fontSize: 11, fontWeight: 'bold', color: '#0f172a', backgroundColor: '#f1f5f9', padding: '5px 8px', borderRadius: 4, marginBottom: 8 },
  card:       { border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10, pageBreakInside: 'avoid' as const },
  cardHead:   { display: 'flex', justifyContent: 'space-between', padding: '7px 10px', borderBottom: '1px solid #e2e8f0', backgroundColor: '#f8fafc', borderRadius: '6px 6px 0 0' },
  cardBody:   { padding: '7px 10px' },
  label9:     { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 3 },
  agendaRow:  { display: 'flex', gap: 6, padding: '3px 0', borderBottom: '1px solid #f1f5f9', fontSize: 10, alignItems: 'flex-start' },
  chip:       { fontSize: 9, padding: '1px 4px', borderRadius: 3, textAlign: 'center' as const, flexShrink: 0 },
  footer:     { marginTop: 20, borderTop: '1px solid #e2e8f0', paddingTop: 6, fontSize: 9, color: '#94a3b8', display: 'flex', justifyContent: 'space-between' },
  dayDivider: { borderBottom: '3px solid #e2e8f0', marginBottom: 14, marginTop: 14, pageBreakBefore: 'always' as const },
  dayHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 12px', marginBottom: 10 },
}

// ─── Booking card (shared between single and range) ───────────────────────────

function BookingCard({ b }: { b: DailyBooking }) {
  const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
  return (
    <div style={S.card}>
      <div style={S.cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', fontSize: 13, fontFamily: 'monospace', color: '#d97706' }}>{b.bookingRef}</span>
          {b.isArriving  && <span style={{ fontSize: 9, backgroundColor: '#16a34a', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>ARRIVING</span>}
          {b.isDeparting && <span style={{ fontSize: 9, backgroundColor: '#dc2626', color: '#fff', padding: '1px 6px', borderRadius: 10 }}>DEPARTING</span>}
          {b.agent && <span style={{ fontSize: 10, color: '#64748b' }}>· {b.agent}</span>}
        </div>
        <div style={{ fontSize: 10, color: '#64748b', textAlign: 'right' }}>
          {b.paxAdults}A{b.paxChildren > 0 ? ` ${b.paxChildren}C` : ''}
          {b.fileHandler && <span style={{ marginLeft: 8 }}>Handler: {b.fileHandler}</span>}
        </div>
      </div>

      <div style={S.cardBody}>
        {/* Lead + contacts */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 7, fontSize: 10, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#94a3b8' }}>Lead: </span><strong>{lead?.name ?? '—'}</strong></span>
          {b.passengers.filter(p => !p.isLead).slice(0, 3).map(p => (
            <span key={p.id} style={{ color: '#64748b' }}>{p.name} <span style={{ fontSize: 9, color: '#94a3b8' }}>({p.type})</span></span>
          ))}
          {b.passengers.length > 4 && <span style={{ color: '#94a3b8' }}>+{b.passengers.length - 4} more</span>}
          {b.emergencyContacts.slice(0, 2).map(ec => (
            <span key={ec.id}>
              <span style={{ color: '#94a3b8' }}>{ec.role ?? 'Contact'}: </span>
              <strong>{ec.name}</strong>
              {ec.phone && <span style={{ color: '#0891b2' }}> {ec.phone}</span>}
            </span>
          ))}
        </div>

        {/* Agenda items */}
        {b.agendaItems.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...S.label9, color: '#7c3aed' }}>Movement Chart</div>
            {b.agendaItems.map(item => (
              <div key={item.id} style={S.agendaRow}>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#d97706', width: 40, flexShrink: 0 }}>
                  {item.meetingTime ?? '—'}
                </span>
                <span style={{
                  ...S.chip, width: 30,
                  backgroundColor: item.serviceType === 'PVT_TRANSFER' ? '#dbeafe' : item.serviceType === 'SIC_TRANSFER' ? '#ffedd5' : '#f1f5f9',
                  color: item.serviceType === 'PVT_TRANSFER' ? '#1d4ed8' : item.serviceType === 'SIC_TRANSFER' ? '#ea580c' : '#64748b',
                }}>
                  {item.serviceType === 'PVT_TRANSFER' ? 'PVT' : item.serviceType === 'SIC_TRANSFER' ? 'SIC' : 'OWN'}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: '600' }}>
                    {item.fromPoint && item.toPoint
                      ? `${item.fromPoint} → ${item.toPoint}`
                      : item.location}
                  </span>
                  {item.mealPlan && (
                    <span style={{ marginLeft: 6, fontSize: 9, color: '#b45309', backgroundColor: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>
                      {item.mealPlan}
                    </span>
                  )}
                  {item.details && (
                    <div style={{ color: '#64748b', fontSize: 9, marginTop: 2, lineHeight: 1.3 }}>{item.details}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Flights */}
        {b.flights.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...S.label9, color: '#4338ca' }}>Flights Today</div>
            {b.flights.map(f => (
              <div key={f.id} style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 10, alignItems: 'center' }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#4338ca', minWidth: 60 }}>{f.flightNo}</span>
                <span style={{ fontWeight: '600' }}>{f.fromApt}</span>
                <span style={{ color: '#94a3b8' }}>{f.depTime}</span>
                <span style={{ color: '#94a3b8' }}>→</span>
                <span style={{ fontWeight: '600' }}>{f.toApt}</span>
                <span style={{ color: '#94a3b8' }}>{f.arrTime}</span>
                {f.airline && <span style={{ color: '#94a3b8', fontSize: 9 }}>({f.airline})</span>}
              </div>
            ))}
          </div>
        )}

        {/* Accommodation chips */}
        {(b.checkIns.length > 0 || b.checkOuts.length > 0 || b.stayingAt) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {b.checkIns.map(a => (
              <div key={a.id} style={{ fontSize: 9, border: '1px solid #6ee7b7', backgroundColor: '#ecfdf5', borderRadius: 4, padding: '2px 7px' }}>
                <span style={{ fontWeight: 'bold', color: '#059669' }}>CHECK-IN </span>
                {a.hotel}, {a.city}{a.roomType ? ` · ${a.roomType}` : ''}
              </div>
            ))}
            {b.checkOuts.map(a => (
              <div key={a.id} style={{ fontSize: 9, border: '1px solid #fca5a5', backgroundColor: '#fff1f2', borderRadius: 4, padding: '2px 7px' }}>
                <span style={{ fontWeight: 'bold', color: '#dc2626' }}>CHECK-OUT </span>
                {a.hotel}, {a.city}
              </div>
            ))}
            {b.stayingAt &&
              !b.checkIns.find(a => a.id === b.stayingAt!.id) &&
              !b.checkOuts.find(a => a.id === b.stayingAt!.id) && (
              <div style={{ fontSize: 9, border: '1px solid #bae6fd', backgroundColor: '#eff6ff', borderRadius: 4, padding: '2px 7px' }}>
                <span style={{ fontWeight: 'bold', color: '#0284c7' }}>STAYING </span>
                {b.stayingAt.hotel}, {b.stayingAt.city}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Day section (range mode) ─────────────────────────────────────────────────

function DaySectionPrint({ day, isFirst }: { day: DayData; isFirst: boolean }) {
  const withActivity = day.bookings.filter(b => b.hasActivity)
  const noActivity   = day.bookings.filter(b => !b.hasActivity)
  const s = day.summary

  return (
    <div style={isFirst ? {} : S.dayDivider}>
      {/* Day header */}
      <div style={S.dayHeader}>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 13, color: '#0f172a' }}>{fmtDate(day.date)}</div>
          <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
            {s.totalActive} active · {s.withActivity} w/ activity
            {s.totalFlights > 0 ? ` · ${s.totalFlights} flights` : ''}
            {s.totalArrivals > 0 ? ` · ${s.totalArrivals} arrivals` : ''}
            {s.totalDepartures > 0 ? ` · ${s.totalDepartures} departures` : ''}
            {s.totalCheckIns > 0 ? ` · ${s.totalCheckIns} check-ins` : ''}
            {s.totalCheckOuts > 0 ? ` · ${s.totalCheckOuts} check-outs` : ''}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {[
            { label: 'Active',   value: s.totalActive,      color: '#7c3aed' },
            { label: 'Flights',  value: s.totalFlights,     color: '#4338ca' },
            { label: 'Arrivals', value: s.totalArrivals,    color: '#0891b2' },
            { label: 'Departs',  value: s.totalDepartures,  color: '#ea580c' },
          ].map(stat => (
            <div key={stat.label} style={{ textAlign: 'center', fontSize: 9 }}>
              <div style={{ fontWeight: 'bold', fontSize: 14, color: stat.color }}>{stat.value}</div>
              <div style={{ color: '#94a3b8' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {day.bookings.length === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#94a3b8', fontSize: 10 }}>
          No active bookings this day
        </div>
      )}

      {withActivity.length > 0 && (
        <>
          <div style={{ ...S.sectionHead, fontSize: 10 }}>
            BOOKINGS WITH ACTIVITY — {withActivity.length}
          </div>
          {withActivity.map(b => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {noActivity.length > 0 && (
        <>
          <div style={{ ...S.sectionHead, color: '#64748b', fontSize: 10, marginTop: 10 }}>
            IN-PROGRESS — NO SCHEDULED ACTIVITY ({noActivity.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
            {noActivity.map(b => {
              const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
              return (
                <div key={b.id} style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', fontSize: 10 }}>
                  <div style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#d97706' }}>{b.bookingRef}</div>
                  <div style={{ color: '#64748b' }}>{lead?.name ?? b.agent ?? '—'} · {b.paxAdults}A{b.paxChildren > 0 ? ` ${b.paxChildren}C` : ''}</div>
                  {b.stayingAt && (
                    <div style={{ color: '#0284c7', fontSize: 9, marginTop: 2 }}>📍 {b.stayingAt.hotel}, {b.stayingAt.city}</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Single-day print content ─────────────────────────────────────────────────

function SingleDayPrint({ date }: { date: string }) {
  const [bookings, setBookings] = useState<DailyBooking[]>([])
  const [summary,  setSummary]  = useState<DailySummary | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  useEffect(() => {
    fetch(`/api/te/daily?date=${date}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) { setBookings(json.data.bookings); setSummary(json.data.summary) }
        else setError(json.error ?? 'Failed to load')
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => {
    if (!loading && !error) setTimeout(() => window.print(), 600)
  }, [loading, error])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading daily operations report…</div>
  if (error)   return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>Error: {error}</div>

  const withActivity = bookings.filter(b => b.hasActivity)
  const noActivity   = bookings.filter(b => !b.hasActivity)

  const STAT_ROWS = summary ? [
    { label: 'Active',      value: summary.totalActive,      color: '#7c3aed' },
    { label: 'w/ Activity', value: summary.withActivity,     color: '#6d28d9' },
    { label: 'Agenda',      value: summary.totalAgendaItems, color: '#1d4ed8' },
    { label: 'Flights',     value: summary.totalFlights,     color: '#4338ca' },
    { label: 'Check-ins',   value: summary.totalCheckIns,    color: '#059669' },
    { label: 'Check-outs',  value: summary.totalCheckOuts,   color: '#dc2626' },
    { label: 'Arrivals',    value: summary.totalArrivals,    color: '#0891b2' },
    { label: 'Departures',  value: summary.totalDepartures,  color: '#ea580c' },
  ] : []

  return (
    <div style={S.page}>
      <div style={S.headerWrap}>
        <div>
          <div style={S.logoName}>Apple Holidays</div>
          <div style={S.logoSub}>MMT Vietnam · Tour Operations</div>
        </div>
        <div style={S.titleRight}>
          <div style={S.reportTitle}>DAILY OPERATIONS REPORT</div>
          <div style={S.dateStr}>{fmtDate(date)}</div>
          <div style={S.genTime}>Generated: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      {summary && (
        <div style={S.statsGrid}>
          {STAT_ROWS.map(s => (
            <div key={s.label} style={S.statBox}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.2, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {withActivity.length > 0 && (
        <>
          <div style={S.sectionHead}>BOOKINGS WITH ACTIVITY — {withActivity.length}</div>
          {withActivity.map(b => <BookingCard key={b.id} b={b} />)}
        </>
      )}

      {noActivity.length > 0 && (
        <>
          <div style={{ ...S.sectionHead, color: '#64748b', marginTop: 14 }}>
            IN-PROGRESS — NO SCHEDULED ACTIVITY ({noActivity.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
            {noActivity.map(b => {
              const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
              return (
                <div key={b.id} style={{ border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', fontSize: 10 }}>
                  <div style={{ fontWeight: 'bold', fontFamily: 'monospace', color: '#d97706' }}>{b.bookingRef}</div>
                  <div style={{ color: '#64748b' }}>{lead?.name ?? b.agent ?? '—'} · {b.paxAdults}A{b.paxChildren > 0 ? ` ${b.paxChildren}C` : ''}</div>
                  {b.stayingAt && (
                    <div style={{ color: '#0284c7', fontSize: 9, marginTop: 2 }}>📍 {b.stayingAt.hotel}, {b.stayingAt.city}</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <div style={S.footer}>
        <span>Apple Holidays · MMT Vietnam · Daily Operations Report · {fmtDate(date)}</span>
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

// ─── Range print content ──────────────────────────────────────────────────────

function RangeDailyPrint({ from, to }: { from: string; to: string }) {
  const [days,    setDays]    = useState<DayData[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch(`/api/te/daily-range?from=${from}&to=${to}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) setDays(json.data.days)
        else setError(json.error ?? 'Failed to load')
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false))
  }, [from, to])

  useEffect(() => {
    if (!loading && !error) setTimeout(() => window.print(), 800)
  }, [loading, error])

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading range operations report…</div>
  if (error)   return <div style={{ padding: 60, textAlign: 'center', color: '#dc2626' }}>Error: {error}</div>

  const totalActive     = days.reduce((s, d) => s + d.summary.withActivity, 0)
  const totalFlights    = days.reduce((s, d) => s + d.summary.totalFlights, 0)
  const totalArrivals   = days.reduce((s, d) => s + d.summary.totalArrivals, 0)
  const totalDepartures = days.reduce((s, d) => s + d.summary.totalDepartures, 0)

  const fromLabel = fmtDateShort(from)
  const toLabel   = fmtDateShort(to)
  const rangeLabel = from === to ? fromLabel : `${fromLabel} — ${toLabel}`

  return (
    <div style={S.page}>
      {/* Report header */}
      <div style={S.headerWrap}>
        <div>
          <div style={S.logoName}>Apple Holidays</div>
          <div style={S.logoSub}>MMT Vietnam · Tour Operations</div>
        </div>
        <div style={S.titleRight}>
          <div style={S.reportTitle}>DAILY OPERATIONS REPORT — RANGE</div>
          <div style={S.dateStr}>{rangeLabel}</div>
          <div style={S.genTime}>Generated: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      {/* Range summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Days',       value: days.length,    color: '#1e293b' },
          { label: 'w/ Activity',value: totalActive,    color: '#7c3aed' },
          { label: 'Flights',    value: totalFlights,   color: '#4338ca' },
          { label: 'Arrivals',   value: totalArrivals,  color: '#0891b2' },
          { label: 'Departures', value: totalDepartures,color: '#ea580c' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 14px', backgroundColor: '#f8fafc' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#64748b' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Day-by-day sections */}
      {days.map((day, i) => (
        <DaySectionPrint key={day.date} day={day} isFirst={i === 0} />
      ))}

      {days.every(d => d.bookings.length === 0) && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
          No active bookings for this period.
        </div>
      )}

      <div style={S.footer}>
        <span>Apple Holidays · MMT Vietnam · Daily Operations Report · {rangeLabel}</span>
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

// ─── Route entry (detects single vs range mode) ───────────────────────────────

function DailyPrintContent() {
  const params = useSearchParams()
  const from   = params.get('from')
  const to     = params.get('to')
  const date   = params.get('date') ?? new Date().toISOString().slice(0, 10)

  if (from && to) return <RangeDailyPrint from={from} to={to} />
  return <SingleDayPrint date={date} />
}

export default function DailyPrintPage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>Loading…</div>}>
      <DailyPrintContent />
    </Suspense>
  )
}
