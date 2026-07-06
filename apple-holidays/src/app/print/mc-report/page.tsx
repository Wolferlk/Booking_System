'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = 'PVT_TRANSFER' | 'SIC_TRANSFER' | 'OWN_ARRANGEMENT'

type MCRow = {
  id:             string
  date:           string
  vnCode:         string
  isNumber:       string | null
  agentBookingId: string | null
  location:       string
  paxAdults:      number
  paxChildren:    number
  fromPoint:      string | null
  toPoint:        string | null
  details:        string | null
  mealPlan:       string | null
  meetingTime:    string | null
  serviceType:    ServiceType
  vendor:         string | null
  driverName:     string | null
  vehicleType:    string | null
  vehiclePlate:   string | null
  agent:          string | null
  bookingStatus:  string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  PVT_TRANSFER:    'Private',
  SIC_TRANSFER:    'SIC',
  OWN_ARRANGEMENT: 'Own Arr.',
}

function rowMatchesDeep(row: MCRow, q: string): boolean {
  return [
    row.location, row.fromPoint, row.toPoint, row.details,
    row.mealPlan, row.meetingTime, row.vendor, row.driverName,
    row.vehicleType, row.vehiclePlate, row.agent,
    row.vnCode, row.isNumber, row.agentBookingId,
  ].some(v => v?.toLowerCase().includes(q))
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Simple inline highlight using a span with yellow background
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: '#fef08a', fontWeight: 700, borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  )
}

// ─── Print Content ────────────────────────────────────────────────────────────

function PrintContent() {
  const sp = useSearchParams()

  const dateFrom    = sp.get('dateFrom') ?? ''
  const dateTo      = sp.get('dateTo')   ?? ''
  const search      = sp.get('search')   ?? ''
  const deepSearch  = sp.get('deepSearch') ?? ''
  const serviceType = sp.get('serviceType') ?? ''
  const country     = sp.get('country')  ?? ''

  const [rows, setRows]       = useState<MCRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (dateFrom)    params.set('dateFrom',    dateFrom)
    if (dateTo)      params.set('dateTo',      dateTo)
    if (search)      params.set('search',      search)
    if (serviceType) params.set('serviceType', serviceType)
    if (country)     params.set('country',     country)

    fetch(`/api/mc-report?${params}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          let data: MCRow[] = json.data
          // Apply deep search client-side
          if (deepSearch.trim()) {
            const q = deepSearch.trim().toLowerCase()
            data = data.filter(row => rowMatchesDeep(row, q))
          }
          setRows(data)
        } else {
          setError('Failed to load MC Report data')
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => {
        setLoading(false)
        setTimeout(() => window.print(), 800)
      })
  }, [sp]) // eslint-disable-line react-hooks/exhaustive-deps

  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const q = deepSearch.trim().toLowerCase()

  const totalAdults   = rows.reduce((s, r) => s + r.paxAdults, 0)
  const totalChildren = rows.reduce((s, r) => s + r.paxChildren, 0)
  const pvtCount      = rows.filter(r => r.serviceType === 'PVT_TRANSFER').length
  const sicCount      = rows.filter(r => r.serviceType === 'SIC_TRANSFER').length
  const ownCount      = rows.filter(r => r.serviceType === 'OWN_ARRANGEMENT').length

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#94a3b8', fontSize: 14 }}>
      Loading movement data…
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#dc2626', fontSize: 14 }}>
      {error}
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#0f172a', maxWidth: 1300, margin: '0 auto' }}>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Image src="/logo.png" alt="Apple Holidays" width={40} height={40} style={{ objectFit: 'contain' }} />
          <div>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0, lineHeight: 1 }}>Apple Holidays MMT</p>
            <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>Movement Coordination (MC) Report</p>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10, color: '#64748b' }}>
          <p style={{ margin: 0 }}>Generated: {now}</p>
          <p style={{ margin: '2px 0 0', fontWeight: 700, color: '#1e293b', fontSize: 12 }}>
            {rows.length} movement{rows.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* ── Active filters ────────────────────────────────────────────────── */}
      {(dateFrom || dateTo || search || deepSearch || serviceType || country) && (
        <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: 4 }}>
            Filters:
          </span>
          {(dateFrom || dateTo) && (
            <span style={filterPill}>
              Dates: {dateFrom || '—'} → {dateTo || '—'}
            </span>
          )}
          {search      && <span style={filterPill}>Tour Ref: &quot;{search}&quot;</span>}
          {deepSearch  && <span style={{ ...filterPill, background: '#ede9fe', color: '#5b21b6', border: '1px solid #c4b5fd' }}>Deep: &quot;{deepSearch}&quot;</span>}
          {serviceType && <span style={filterPill}>Service: {SERVICE_LABELS[serviceType] ?? serviceType}</span>}
          {country     && <span style={filterPill}>Country: {country}</span>}
        </div>
      )}

      {/* ── Stats summary ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Movements', value: rows.length,    bg: '#f8fafc', fg: '#1e293b' },
          { label: 'Adults',          value: totalAdults,    bg: '#eff6ff', fg: '#1d4ed8' },
          { label: 'Children',        value: totalChildren,  bg: '#f5f3ff', fg: '#6d28d9' },
          { label: 'Private',         value: pvtCount,       bg: '#f0fdf4', fg: '#15803d' },
          { label: 'SIC',             value: sicCount,       bg: '#fff7ed', fg: '#c2410c' },
          { label: 'Own Arr.',        value: ownCount,       bg: '#f1f5f9', fg: '#475569' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 70 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: s.fg, lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: 9, color: '#94a3b8', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {rows.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0', fontSize: 13 }}>
          {deepSearch ? `No movements contain "${deepSearch}"` : 'No movements found for the selected filters.'}
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr style={{ background: '#1e293b', color: 'white' }}>
              <th style={th}>#</th>
              <th style={th}>Date</th>
              <th style={th}>Tour Ref</th>
              <th style={th}>Location</th>
              <th style={{ ...th, textAlign: 'center' }}>Pax</th>
              <th style={th}>From</th>
              <th style={th}>To</th>
              <th style={{ ...th, maxWidth: 200 }}>Details</th>
              <th style={th}>Meal</th>
              <th style={th}>Meet Time</th>
              <th style={th}>Service</th>
              <th style={th}>Vendor / Driver</th>
              <th style={th}>Vehicle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isEven = idx % 2 === 0
              return (
                <tr key={row.id} style={{ background: isEven ? '#ffffff' : '#f8fafc', pageBreakInside: 'avoid' }}>
                  <td style={{ ...td, color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>

                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {formatDate(row.date)}
                  </td>

                  <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>
                      {q ? <HighlightText text={row.vnCode} query={deepSearch} /> : row.vnCode}
                    </span>
                    {row.isNumber && (
                      <div style={{ fontSize: 9, color: '#2563eb', marginTop: 1 }}>
                        IS: {q ? <HighlightText text={row.isNumber} query={deepSearch} /> : row.isNumber}
                      </div>
                    )}
                    {row.agentBookingId && (
                      <div style={{ fontSize: 9, color: '#7c3aed', marginTop: 1 }}>
                        {q ? <HighlightText text={row.agentBookingId} query={deepSearch} /> : row.agentBookingId}
                      </div>
                    )}
                  </td>

                  <td style={{ ...td, fontWeight: 600 }}>
                    {q && row.location.toLowerCase().includes(q)
                      ? <HighlightText text={row.location} query={deepSearch} />
                      : row.location}
                  </td>

                  <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <span style={{ fontWeight: 700, color: '#1d4ed8' }}>{row.paxAdults}</span>
                    {row.paxChildren > 0 && (
                      <span style={{ color: '#6d28d9' }}>+{row.paxChildren}C</span>
                    )}
                  </td>

                  <td style={{ ...td, color: '#475569', maxWidth: 100 }}>
                    {row.fromPoint
                      ? (q && row.fromPoint.toLowerCase().includes(q)
                          ? <HighlightText text={row.fromPoint} query={deepSearch} />
                          : row.fromPoint)
                      : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, color: '#475569', maxWidth: 100 }}>
                    {row.toPoint
                      ? (q && row.toPoint.toLowerCase().includes(q)
                          ? <HighlightText text={row.toPoint} query={deepSearch} />
                          : row.toPoint)
                      : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, color: '#475569', maxWidth: 200, wordBreak: 'break-word' }}>
                    {row.details
                      ? (q && row.details.toLowerCase().includes(q)
                          ? <HighlightText text={row.details} query={deepSearch} />
                          : row.details)
                      : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {row.mealPlan ? (
                      <span style={{ padding: '1px 5px', borderRadius: 3, fontWeight: 700, fontSize: 9, background: MEAL_BG[row.mealPlan.toUpperCase()] ?? '#f1f5f9', color: MEAL_FG[row.mealPlan.toUpperCase()] ?? '#475569' }}>
                        {row.mealPlan}
                      </span>
                    ) : <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {row.meetingTime ?? <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: SVC_BG[row.serviceType] ?? '#f1f5f9',
                      color: SVC_FG[row.serviceType] ?? '#475569',
                    }}>
                      {SERVICE_LABELS[row.serviceType] ?? row.serviceType}
                    </span>
                  </td>

                  <td style={{ ...td, color: '#475569', maxWidth: 120 }}>
                    {row.vendor
                      ? (q && row.vendor.toLowerCase().includes(q)
                          ? <HighlightText text={row.vendor} query={deepSearch} />
                          : row.vendor)
                      : null}
                    {row.driverName && (
                      <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>
                        {q && row.driverName.toLowerCase().includes(q)
                          ? <HighlightText text={row.driverName} query={deepSearch} />
                          : row.driverName}
                      </div>
                    )}
                    {!row.vendor && !row.driverName && <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, color: '#475569', maxWidth: 100, fontSize: 9 }}>
                    {row.vehicleType && (
                      <div>
                        {q && row.vehicleType.toLowerCase().includes(q)
                          ? <HighlightText text={row.vehicleType} query={deepSearch} />
                          : row.vehicleType}
                      </div>
                    )}
                    {row.vehiclePlate && (
                      <div style={{ fontFamily: 'monospace', color: '#1e293b', fontWeight: 600 }}>
                        {q && row.vehiclePlate.toLowerCase().includes(q)
                          ? <HighlightText text={row.vehiclePlate} query={deepSearch} />
                          : row.vehiclePlate}
                      </div>
                    )}
                    {!row.vehicleType && !row.vehiclePlate && <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 20, paddingTop: 8, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 9 }}>
        <span>Apple Holidays MMT — MC Report — Confidential</span>
        <span>{now}</span>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  padding: '6px 7px', textAlign: 'left', fontWeight: 700, fontSize: 9,
  borderRight: '1px solid #334155', whiteSpace: 'nowrap',
}

const td: React.CSSProperties = {
  padding: '5px 7px', borderBottom: '1px solid #e2e8f0', verticalAlign: 'top',
}

const filterPill: React.CSSProperties = {
  padding: '2px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0',
  borderRadius: 4, fontSize: 10, color: '#475569',
}

const MEAL_BG: Record<string, string> = {
  BB: '#fef9c3', HB: '#ffedd5', FB: '#ffe4e6', AI: '#f3e8ff', RO: '#f1f5f9',
}
const MEAL_FG: Record<string, string> = {
  BB: '#854d0e', HB: '#9a3412', FB: '#9f1239', AI: '#581c87', RO: '#475569',
}

const SVC_BG: Record<string, string> = {
  PVT_TRANSFER: '#dcfce7', SIC_TRANSFER: '#dbeafe', OWN_ARRANGEMENT: '#f1f5f9',
}
const SVC_FG: Record<string, string> = {
  PVT_TRANSFER: '#166534', SIC_TRANSFER: '#1e40af', OWN_ARRANGEMENT: '#475569',
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function PrintMCReportPage() {
  return (
    <Suspense fallback={
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#94a3b8', fontSize: 14 }}>
        Loading…
      </div>
    }>
      <PrintContent />
    </Suspense>
  )
}
