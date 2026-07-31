'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { formatDate, formatCurrency } from '@/lib/utils'

interface Booking {
  id: string
  bookingRef: string
  agent: string | null
  agentBookingId: string | null
  fileHandler: string | null
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: string
  currency: string
  createdAt: string
  isNumber: string | null
  cntlNumber: string | null
  operationCountry: string | null
  passengers: { name: string; isLead: boolean }[]
  _count: { changeRequests: number }
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft', SUBMITTED: 'Submitted', IN_REVIEW: 'In Review',
  CONFIRMED: 'Confirmed', IN_PROGRESS: 'In Progress', OPERATIONS_READY: 'Ops Ready',
  COMPLETED: 'Completed', CANCELLED: 'Cancelled',
}

const COUNTRY_LABEL: Record<string, string> = {
  VIETNAM: 'Vietnam', SRILANKA: 'Sri Lanka', SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia', SINGAPORE_MALAYSIA: 'SG & MY',
}

function PrintContent() {
  const sp = useSearchParams()
  const mode = sp.get('mode') ?? 'full'  // 'full' | 'numbers'

  const [bookings, setBookings] = useState<Booking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    const passthrough = ['search', 'refSearch', 'contentSearch', 'status', 'dateFilter', 'dateField',
      'dateFrom', 'dateTo', 'sortBy', 'sortDir', 'country']
    passthrough.forEach(k => { const v = sp.get(k); if (v) params.set(k, v) })
    params.set('limit', '500')
    params.set('page', '1')

    fetch(`/api/bookings?${params}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setBookings(json.data.bookings)
          setTotal(json.data.total)
        } else {
          setError('Failed to load bookings')
        }
      })
      .catch(() => setError('Network error'))
      .finally(() => {
        setLoading(false)
        setTimeout(() => window.print(), 1200)
      })
  }, [sp])

  const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  const activeFilters: string[] = []
  if (sp.get('search'))        activeFilters.push(`Name/Ref: "${sp.get('search')}"`)
  if (sp.get('refSearch'))     activeFilters.push(`Ref/IS: "${sp.get('refSearch')}"`)
  if (sp.get('contentSearch')) activeFilters.push(`Content: "${sp.get('contentSearch')}"`)
  if (sp.get('status'))        activeFilters.push(`Status: ${STATUS_LABEL[sp.get('status')!] ?? sp.get('status')}`)
  if (sp.get('dateFilter'))    activeFilters.push(`Period: ${sp.get('dateFilter')?.replace('_', ' ')}`)
  if (sp.get('dateFrom') || sp.get('dateTo')) {
    activeFilters.push(`Created: ${sp.get('dateFrom') ?? '…'} → ${sp.get('dateTo') ?? '…'}`)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen text-slate-400 text-sm">
      Loading bookings…
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">{error}</div>
  )

  return (
    <>
      <style>{`@media print { .bookings-print-controls { display: none !important; } }`}</style>
      <div className="bookings-print-controls fixed top-4 right-4 z-50 flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-slate-700"
        >
          Print / Save as PDF
        </button>
      </div>
      <div className="p-8 text-[11px] font-sans text-slate-900 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-slate-800">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Apple Holidays" width={40} height={40} className="object-contain" />
          <div>
            <p className="text-lg font-bold text-slate-900 leading-none">Apple Holidays MMT</p>
            <p className="text-xs text-slate-500 mt-0.5">Bookings Report — {mode === 'numbers' ? 'Reference Numbers Only' : 'Full Details'}</p>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>Generated: {now}</p>
          <p className="font-semibold text-slate-700">{total} booking{total !== 1 ? 's' : ''} found</p>
          {bookings.length < total && (
            <p className="text-amber-600">Showing first {bookings.length}</p>
          )}
        </div>
      </div>

      {/* Active filters */}
      {activeFilters.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mr-1">Filters:</span>
          {activeFilters.map((f, i) => (
            <span key={i} className="px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">{f}</span>
          ))}
        </div>
      )}

      {/* NUMBERS-ONLY mode */}
      {mode === 'numbers' && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#1e293b', color: 'white' }}>
              <th style={th}>#</th>
              <th style={th}>Booking Ref</th>
              <th style={th}>IS / VN Number</th>
              <th style={th}>Agent Booking ID</th>
              <th style={th}>CNTL Number</th>
              <th style={th}>Country</th>
              <th style={th}>Lead Passenger</th>
              <th style={th}>Agent</th>
              <th style={th}>Arrival</th>
              <th style={th}>Departure</th>
              <th style={th}>Pax</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, idx) => {
              const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
              return (
                <tr key={b.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={td}>{idx + 1}</td>
                  <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace' }}>{b.bookingRef}</td>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#2563eb' }}>{b.isNumber ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace', color: '#7c3aed' }}>{b.agentBookingId ?? '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{b.cntlNumber ?? '—'}</td>
                  <td style={td}>{b.operationCountry ? (COUNTRY_LABEL[b.operationCountry] ?? b.operationCountry) : '—'}</td>
                  <td style={td}>{lead?.name ?? '—'}</td>
                  <td style={{ ...td, color: '#64748b' }}>{b.agent ?? '—'}</td>
                  <td style={td}>{formatDate(b.arrivalDate)}</td>
                  <td style={td}>{formatDate(b.departureDate)}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{b.paxAdults + b.paxChildren}</td>
                  <td style={td}>
                    <span style={{
                      padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: STATUS_BG[b.status] ?? '#f1f5f9',
                      color: STATUS_FG[b.status] ?? '#475569',
                    }}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* FULL DETAILS mode */}
      {mode === 'full' && bookings.map((b, idx) => {
        const lead = b.passengers.find(p => p.isLead) ?? b.passengers[0]
        return (
          <div key={b.id} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '1px solid #e2e8f0', pageBreakInside: 'avoid' }}>
            {/* Row header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 800, fontSize: 13, fontFamily: 'monospace', color: '#0f172a' }}>
                  {idx + 1}. {b.bookingRef}
                </span>
                {b.isNumber && (
                  <span style={{ padding: '1px 6px', background: '#dbeafe', color: '#1d4ed8', borderRadius: 4, fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                    IS: {b.isNumber}
                  </span>
                )}
                {b.agentBookingId && (
                  <span style={{ padding: '1px 6px', background: '#ede9fe', color: '#6d28d9', borderRadius: 4, fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                    ID: {b.agentBookingId}
                  </span>
                )}
                {b.cntlNumber && (
                  <span style={{ padding: '1px 6px', background: '#f0fdf4', color: '#15803d', borderRadius: 4, fontSize: 10, fontWeight: 600, fontFamily: 'monospace' }}>
                    CNTL: {b.cntlNumber}
                  </span>
                )}
                {b.operationCountry && COUNTRY_LABEL[b.operationCountry] && (
                  <span style={{ padding: '1px 6px', background: '#f1f5f9', color: '#475569', borderRadius: 4, fontSize: 10 }}>
                    {COUNTRY_LABEL[b.operationCountry]}
                  </span>
                )}
              </div>
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                background: STATUS_BG[b.status] ?? '#f1f5f9',
                color: STATUS_FG[b.status] ?? '#475569',
              }}>
                {STATUS_LABEL[b.status] ?? b.status}
              </span>
            </div>

            {/* Details grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px 16px' }}>
              <InfoCell label="Lead Passenger" value={lead?.name ?? '—'} />
              <InfoCell label="Agent" value={b.agent ?? '—'} />
              <InfoCell label="File Handler" value={b.fileHandler ?? '—'} />
              <InfoCell label="Pax" value={`${b.paxAdults} Adults${b.paxChildren > 0 ? ` + ${b.paxChildren} Children` : ''}`} />
              <InfoCell label="Arrival" value={formatDate(b.arrivalDate)} />
              <InfoCell label="Departure" value={formatDate(b.departureDate)} />
              <InfoCell label="Quoted Total" value={`${b.currency} ${formatCurrency(b.quotedTotal)}`} />
              <InfoCell label="Created" value={new Date(b.createdAt).toLocaleDateString('en-GB')} />
            </div>

            {/* All passengers */}
            {b.passengers.length > 1 && (
              <div style={{ marginTop: 4 }}>
                <span style={{ fontWeight: 700, color: '#64748b', fontSize: 10 }}>Passengers: </span>
                <span style={{ color: '#334155' }}>
                  {b.passengers.map(p => p.name + (p.isLead ? ' (Lead)' : '')).join(' · ')}
                </span>
              </div>
            )}
          </div>
        )
      })}

      {bookings.length === 0 && (
        <p style={{ textAlign: 'center', color: '#94a3b8', padding: '40px 0' }}>No bookings match the current filters.</p>
      )}

      {/* Footer */}
      <div style={{ marginTop: 20, paddingTop: 8, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 10 }}>
        <span>Apple Holidays MMT — Confidential</span>
        <span>{now}</span>
      </div>
      </div>
    </>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}: </span>
      <span style={{ color: '#1e293b' }}>{value}</span>
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', fontWeight: 700, fontSize: 10, borderRight: '1px solid #334155',
}
const td: React.CSSProperties = {
  padding: '5px 8px', borderBottom: '1px solid #e2e8f0', borderRight: '1px solid #f1f5f9', verticalAlign: 'top',
}

const STATUS_BG: Record<string, string> = {
  DRAFT: '#f8fafc', SUBMITTED: '#eff6ff', IN_REVIEW: '#fefce8', CONFIRMED: '#f0fdf4',
  IN_PROGRESS: '#f0f9ff', OPERATIONS_READY: '#faf5ff', COMPLETED: '#f0fdf4', CANCELLED: '#fef2f2',
}
const STATUS_FG: Record<string, string> = {
  DRAFT: '#64748b', SUBMITTED: '#2563eb', IN_REVIEW: '#ca8a04', CONFIRMED: '#16a34a',
  IN_PROGRESS: '#0284c7', OPERATIONS_READY: '#7c3aed', COMPLETED: '#15803d', CANCELLED: '#dc2626',
}

export default function PrintBookingsListPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen text-slate-400 text-sm">Loading…</div>}>
      <PrintContent />
    </Suspense>
  )
}
