'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import {
  SERVICE_TYPE_SHORT_LABELS, isPrivateTransferType, isSicType,
  type ServiceTypeValue,
} from '@/lib/service-types'
import { to12h } from '@/lib/clock-time'

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceType = ServiceTypeValue

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
  /** Free / at-leisure day — no driver is allocated for this movement. */
  isLeisure:      boolean
  /** Hotel only — accommodation or own transport, so likewise no driver. */
  isHotelOnly:    boolean
  vendor:         string | null
  driverName:     string | null
  guideName:       string | null
  guidePhone:      string | null
  tourVendorName:  string | null
  tourVendorPhone: string | null
  driverPhotoUrl: string | null
  vehicleType:    string | null
  vehiclePlate:   string | null
  agent:          string | null
  bookingStatus:  string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = SERVICE_TYPE_SHORT_LABELS

function rowMatchesDeep(row: MCRow, q: string): boolean {
  return [
    row.location, row.fromPoint, row.toPoint, row.details,
    row.mealPlan, row.meetingTime, row.vendor, row.driverName,
    row.guideName, row.tourVendorName,
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

  // A cancelled file is printed — the driver reading this chart must see the
  // tour is off, not find the row missing — but it is left out of every total,
  // which describes the work actually being run. Matches the on-screen MC
  // Report in `dashboard/mc-report/page.tsx`.
  const isCancelled = (r: MCRow) =>
    r.bookingStatus === 'CANCELLED' || r.bookingStatus === 'PENDING_CANCELLATION'
  const liveRows      = rows.filter(r => !isCancelled(r))
  const cancelledCount = rows.length - liveRows.length

  const totalAdults   = liveRows.reduce((s, r) => s + r.paxAdults, 0)
  const totalChildren = liveRows.reduce((s, r) => s + r.paxChildren, 0)
  const pvtCount      = liveRows.filter(r => isPrivateTransferType(r.serviceType)).length
  const sicCount      = liveRows.filter(r => isSicType(r.serviceType)).length
  const ownCount      = liveRows.filter(r => r.serviceType === 'OWN_ARRANGEMENT').length
  const leisureCount  = liveRows.filter(r => r.isLeisure).length
  const hotelOnlyCount = liveRows.filter(r => r.isHotelOnly).length
  // The printout is width-bound, so the partner column only takes space on the
  // days that actually have a guide or tour vendor on the ground.
  const showPartners = rows.some(r => r.guideName || r.tourVendorName)

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
          { label: 'Leisure',         value: leisureCount,   bg: '#fffbeb', fg: '#b45309' },
          { label: 'Hotel Only',      value: hotelOnlyCount, bg: '#fdf2f8', fg: '#be185d' },
          // Printed only when there is one, so a clean chart stays clean.
          ...(cancelledCount > 0
            ? [{ label: 'Cancelled', value: cancelledCount, bg: '#fff1f2', fg: '#9f1239' }]
            : []),
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
              <th style={th}>Agent</th>
              <th style={th}>Location</th>
              <th style={{ ...th, textAlign: 'center' }}>Pax</th>
              <th style={th}>From</th>
              <th style={th}>To</th>
              <th style={{ ...th, maxWidth: 200 }}>Details</th>
              <th style={th}>Meal</th>
              <th style={th}>Meet Time</th>
              <th style={th}>Service</th>
              {showPartners && <th style={th}>Guide / Tour Vendor</th>}
              <th style={th}>Driver / Vendor</th>
              <th style={th}>Vehicle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isEven = idx % 2 === 0
              return (
                <tr key={row.id} style={{
                  background: isCancelled(row) ? '#fff1f2' : isEven ? '#ffffff' : '#f8fafc',
                  color: isCancelled(row) ? '#9f1239' : undefined,
                  pageBreakInside: 'avoid',
                }}>
                  <td style={{ ...td, color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>

                  <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {formatDate(row.date)}
                  </td>

                  <td style={{ ...td, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                    <span style={{
                      fontWeight: 700,
                      color: isCancelled(row) ? '#9f1239' : '#0f172a',
                      textDecoration: isCancelled(row) ? 'line-through' : undefined,
                    }}>
                      {q ? <HighlightText text={row.vnCode} query={deepSearch} /> : row.vnCode}
                    </span>
                    {isCancelled(row) && (
                      <div style={{
                        fontSize: 8, fontWeight: 800, letterSpacing: 0.4, marginTop: 1,
                        color: '#9f1239', textTransform: 'uppercase',
                      }}>
                        {row.bookingStatus === 'PENDING_CANCELLATION' ? 'Cancelling' : 'Cancelled'}
                      </div>
                    )}
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

                  <td style={{ ...td, color: '#475569', maxWidth: 110 }}>
                    {row.agent
                      ? (q && row.agent.toLowerCase().includes(q)
                          ? <HighlightText text={row.agent} query={deepSearch} />
                          : row.agent)
                      : <span style={{ color: '#cbd5e1' }}>—</span>}
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
                    {to12h(row.meetingTime) || <span style={{ color: '#cbd5e1' }}>—</span>}
                  </td>

                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <span style={{
                      padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                      background: SVC_BG[row.serviceType] ?? '#f1f5f9',
                      color: SVC_FG[row.serviceType] ?? '#475569',
                    }}>
                      {SERVICE_LABELS[row.serviceType] ?? row.serviceType}
                    </span>
                    {row.isLeisure && (
                      <span style={{
                        display: 'block', marginTop: 2, padding: '1px 5px', borderRadius: 3,
                        fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#b45309',
                      }}>
                        Leisure Day
                      </span>
                    )}
                    {row.isHotelOnly && (
                      <span style={{
                        display: 'block', marginTop: 2, padding: '1px 5px', borderRadius: 3,
                        fontSize: 9, fontWeight: 700, background: '#fce7f3', color: '#be185d',
                      }}>
                        Hotel Only
                      </span>
                    )}
                  </td>

                  {showPartners && (
                    <td style={{ ...td, color: '#475569', maxWidth: 110 }}>
                      {row.guideName && (
                        <div>
                          <span style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Guide </span>
                          {q && row.guideName.toLowerCase().includes(q)
                            ? <HighlightText text={row.guideName} query={deepSearch} />
                            : row.guideName}
                          {row.guidePhone && (
                            <div style={{ fontSize: 9, color: '#64748b' }}>{row.guidePhone}</div>
                          )}
                        </div>
                      )}
                      {row.tourVendorName && (
                        <div style={{ marginTop: row.guideName ? 3 : 0 }}>
                          <span style={{ fontSize: 8, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vendor </span>
                          {q && row.tourVendorName.toLowerCase().includes(q)
                            ? <HighlightText text={row.tourVendorName} query={deepSearch} />
                            : row.tourVendorName}
                          {row.tourVendorPhone && (
                            <div style={{ fontSize: 9, color: '#64748b' }}>{row.tourVendorPhone}</div>
                          )}
                        </div>
                      )}
                      {!row.guideName && !row.tourVendorName && <span style={{ color: '#cbd5e1' }}>—</span>}
                    </td>
                  )}

                  <td style={{ ...td, color: '#475569', maxWidth: 120 }}>
                    {row.isLeisure || row.isHotelOnly ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
                        color: row.isHotelOnly ? '#be185d' : '#b45309',
                      }}>
                        No driver needed
                      </span>
                    ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                      {row.driverPhotoUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.driverPhotoUrl} alt={row.driverName ?? 'Driver'}
                          style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }} />
                      )}
                      <div>
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
                      </div>
                    </div>
                    )}
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
  PVT_TRANSFER: '#dcfce7', PVT_TOUR: '#dcfce7', PVT_TRANSFER_TICKET: '#f3e8ff',
  PVT_TRANSFER_SPA: '#ccfbf1', PVT_TRANSFER_SIC_TOUR: '#ccfbf1', PVT_TRANSFER_MEAL: '#ffedd5',
  SIC_TRANSFER: '#dbeafe', SIC_TOUR: '#dbeafe', MEAL_COUPON: '#ffedd5',
  INTERNAL_TOUR: '#f3e8ff', ACCOMMODATION: '#fef3c7', OWN_ARRANGEMENT: '#f1f5f9',
}
const SVC_FG: Record<string, string> = {
  PVT_TRANSFER: '#166534', PVT_TOUR: '#166534', PVT_TRANSFER_TICKET: '#6b21a8',
  PVT_TRANSFER_SPA: '#115e59', PVT_TRANSFER_SIC_TOUR: '#115e59', PVT_TRANSFER_MEAL: '#9a3412',
  SIC_TRANSFER: '#1e40af', SIC_TOUR: '#1e40af', MEAL_COUPON: '#9a3412',
  INTERNAL_TOUR: '#6b21a8', ACCOMMODATION: '#92400e', OWN_ARRANGEMENT: '#475569',
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
