'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Database, Mail, CheckCircle, AlertCircle, Clock, Loader2,
  ChevronDown, ChevronUp, RefreshCw, FileText, Users, Plane,
  Hotel, Phone, BarChart3, ExternalLink, Paperclip, Search, X,
  Inbox, ArrowRight, User, AtSign,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter  = 'ALL' | 'RECEIVED' | 'PROCESSED' | 'WAITING' | 'ERROR'
type MailboxFilter = 'all' | 'tq' | 'pnl'

interface DbEmail {
  graphId: string
  mailboxKind: 'TOUR_CONFIRMATION' | 'PNL'
  mailboxUser: string
  subject: string
  from: string
  fromName: string
  date: string
  folder: string
  hasAttachments: boolean
  type: string
  rawBody: string
  bodyHtml: string
  status: string
  bookingRef: string | null
  processedAt: string | null
}

interface BookingDetail {
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  arrivalDate: string | null
  departureDate: string | null
  paxAdults: number
  paxChildren: number
  quotedTotal: number | null
  currency: string
  contactEmail: string | null
  contactPhone: string | null
  contactWhatsapp: string | null
  contactCountry: string | null
  agentEmail: string | null
  agentPhone: string | null
  agentWhatsapp: string | null
  agentCountry: string | null
  passengers: { name: string; type: string; isLead: boolean }[]
  flights: { flightNo: string; date: string; fromApt: string; toApt: string; depTime?: string; arrTime?: string }[]
  accommodations: { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; mealType?: string }[]
  pnl: { lineItems: { activity: string; category: string; mmtRate: number }[] } | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}
function fmtTs(d?: string | null) {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    })
  } catch { return d }
}

const STATUS_STYLES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  RECEIVED:  { label: 'Unprocessed', color: 'bg-amber-100 text-amber-700 border-amber-200',  icon: <Clock className="w-3 h-3" /> },
  PROCESSED: { label: 'Processed',   color: 'bg-green-100 text-green-700 border-green-200',  icon: <CheckCircle className="w-3 h-3" /> },
  WAITING:   { label: 'Waiting TQ',  color: 'bg-orange-100 text-orange-700 border-orange-200', icon: <Clock className="w-3 h-3" /> },
  ERROR:     { label: 'Error',       color: 'bg-red-100 text-red-700 border-red-200',          icon: <AlertCircle className="w-3 h-3" /> },
}

// ── Booking detail panel ──────────────────────────────────────────────────────

function BookingPanel({ detail, isPnl }: { detail: BookingDetail; isPnl: boolean }) {
  return (
    <div className="space-y-3">
      {/* Core booking info */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Agent',        value: detail.agent ?? '—' },
          { label: 'File Handler', value: detail.fileHandler ?? '—' },
          { label: 'Arrival',      value: fmtDate(detail.arrivalDate) },
          { label: 'Departure',    value: fmtDate(detail.departureDate) },
          { label: 'Adults',       value: String(detail.paxAdults) },
          { label: 'Children',     value: String(detail.paxChildren) },
          { label: 'Quoted Total', value: detail.quotedTotal ? `${detail.currency} ${detail.quotedTotal.toLocaleString()}` : '—' },
        ].map(item => (
          <div key={item.label} className="bg-slate-50 rounded-lg p-2">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">{item.label}</p>
            <p className="text-xs font-semibold text-slate-800 truncate mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Contact info — Tourist */}
      {(detail.contactEmail || detail.contactPhone || detail.contactWhatsapp) && (
        <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
          <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1 mb-2">
            <User className="w-3 h-3" /> Tourist / Client Contact
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            {detail.contactPhone && (
              <span className="flex items-center gap-1 font-mono text-slate-700">
                <Phone className="w-3 h-3 text-blue-400" /> {detail.contactPhone}
              </span>
            )}
            {detail.contactWhatsapp && detail.contactWhatsapp !== detail.contactPhone && (
              <span className="flex items-center gap-1 font-mono text-slate-700">
                <Phone className="w-3 h-3 text-green-400" /> WA: {detail.contactWhatsapp}
              </span>
            )}
            {detail.contactEmail && (
              <span className="flex items-center gap-1 text-slate-700">
                <AtSign className="w-3 h-3 text-blue-400" /> {detail.contactEmail}
              </span>
            )}
            {detail.contactCountry && (
              <span className="text-slate-500">{detail.contactCountry}</span>
            )}
          </div>
        </div>
      )}

      {/* Contact info — Agent */}
      {(detail.agentEmail || detail.agentPhone) && (
        <div className="rounded-lg border border-teal-100 bg-teal-50/50 p-3">
          <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider flex items-center gap-1 mb-2">
            <Users className="w-3 h-3" /> Agent Contact
          </p>
          <div className="flex flex-wrap gap-3 text-xs">
            {detail.agentPhone && (
              <span className="flex items-center gap-1 font-mono text-slate-700">
                <Phone className="w-3 h-3 text-teal-400" /> {detail.agentPhone}
              </span>
            )}
            {detail.agentWhatsapp && detail.agentWhatsapp !== detail.agentPhone && (
              <span className="flex items-center gap-1 font-mono text-slate-700">
                <Phone className="w-3 h-3 text-green-400" /> WA: {detail.agentWhatsapp}
              </span>
            )}
            {detail.agentEmail && (
              <span className="flex items-center gap-1 text-slate-700">
                <AtSign className="w-3 h-3 text-teal-400" /> {detail.agentEmail}
              </span>
            )}
            {detail.agentCountry && (
              <span className="text-slate-500">{detail.agentCountry}</span>
            )}
          </div>
        </div>
      )}

      {/* Passengers */}
      {detail.passengers.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Users className="w-3 h-3 text-blue-500" /> Passengers ({detail.passengers.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-1.5 text-left">Name</th>
                  <th className="px-3 py-1.5 text-left">Type</th>
                  <th className="px-3 py-1.5 text-left">Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.passengers.map((p, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-1.5">
                      <Badge color={p.type === 'CHILD' ? 'amber' : 'blue'}>{p.type}</Badge>
                    </td>
                    <td className="px-3 py-1.5">
                      {p.isLead && <Badge color="green">Lead</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Flights */}
      {detail.flights.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Plane className="w-3 h-3 text-indigo-500" /> Flights
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-1.5 text-left">Flight</th>
                  <th className="px-3 py-1.5 text-left">Date</th>
                  <th className="px-3 py-1.5 text-left">Route</th>
                  <th className="px-3 py-1.5 text-left">Times</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.flights.map((f, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{f.flightNo}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(f.date)}</td>
                    <td className="px-3 py-1.5">
                      <span className="font-semibold">{f.fromApt}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1 text-slate-400" />
                      <span className="font-semibold">{f.toApt}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{f.depTime ?? '—'} → {f.arrTime ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hotels */}
      {detail.accommodations.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Hotel className="w-3 h-3 text-purple-500" /> Hotels
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-1.5 text-left">Hotel</th>
                  <th className="px-3 py-1.5 text-left">City</th>
                  <th className="px-3 py-1.5 text-left">Check In → Out</th>
                  <th className="px-3 py-1.5 text-center">N</th>
                  <th className="px-3 py-1.5 text-center">Meal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.accommodations.map((a, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[160px] truncate">{a.hotel}</td>
                    <td className="px-3 py-1.5 text-slate-600">{a.city}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(a.checkIn)} → {fmtDate(a.checkOut)}</td>
                    <td className="px-3 py-1.5 text-center font-semibold">{a.nights}</td>
                    <td className="px-3 py-1.5 text-center">{a.mealType ? <Badge color="teal">{a.mealType}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PNL summary */}
      {isPnl && detail.pnl && detail.pnl.lineItems.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <BarChart3 className="w-3 h-3 text-teal-500" /> P&L Lines ({detail.pnl.lineItems.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-1.5 text-left">Activity</th>
                  <th className="px-3 py-1.5 text-left">Category</th>
                  <th className="px-3 py-1.5 text-right"> Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.pnl.lineItems.slice(0, 10).map((l, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[200px] truncate">{l.activity}</td>
                    <td className="px-3 py-1.5 text-slate-500 text-[10px]">{l.category}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-slate-700">{l.mmtRate > 0 ? `$${l.mmtRate.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
                {detail.pnl.lineItems.length > 10 && (
                  <tr className="bg-slate-50">
                    <td colSpan={3} className="px-3 py-1.5 text-center text-[10px] text-slate-400">
                      +{detail.pnl.lineItems.length - 10} more lines
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Raw body panel ────────────────────────────────────────────────────────────

function RawBodyPanel({ body }: { body: string }) {
  const [showFull, setShowFull] = useState(false)
  const preview = body.slice(0, 800)
  const isTruncated = body.length > 800
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
        <FileText className="w-3 h-3" /> Saved Email Body (DB Cache)
      </p>
      <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 max-h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-100 font-mono">
        {showFull ? body : preview}
        {!showFull && isTruncated && (
          <span className="text-slate-400">…</span>
        )}
      </pre>
      {isTruncated && (
        <button
          onClick={() => setShowFull(v => !v)}
          className="text-[10px] text-blue-500 hover:text-blue-700 font-medium"
        >
          {showFull ? 'Show less' : `Show full body (${body.length.toLocaleString()} chars)`}
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DbMailboxView() {
  const router = useRouter()

  const [emails, setEmails]               = useState<DbEmail[]>([])
  const [loading, setLoading]             = useState(true)
  const [mailbox, setMailbox]             = useState<MailboxFilter>('all')
  const [statusFilter, setStatusFilter]   = useState<StatusFilter>('ALL')
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [searchQuery, setSearchQuery]     = useState('')
  const [bookingCache, setBookingCache]   = useState<Map<string, BookingDetail | null>>(new Map())
  const [loadingBooking, setLoadingBooking] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/mail/fetch?limit=200&folder=all&mailbox=${mailbox}`)
      const json = await res.json()
      if (json.success) setEmails(json.data as DbEmail[])
    } finally {
      setLoading(false)
    }
  }, [mailbox])

  useEffect(() => { load() }, [load])

  const fetchBooking = useCallback(async (ref: string) => {
    if (bookingCache.has(ref)) return
    setLoadingBooking(prev => new Set(prev).add(ref))
    try {
      const res  = await fetch(`/api/bookings/${ref}`)
      const json = await res.json()
      setBookingCache(prev => new Map(prev).set(ref, json.success ? json.data as BookingDetail : null))
    } catch {
      setBookingCache(prev => new Map(prev).set(ref, null))
    } finally {
      setLoadingBooking(prev => { const n = new Set(prev); n.delete(ref); return n })
    }
  }, [bookingCache])

  const handleExpand = useCallback((email: DbEmail) => {
    const id = email.graphId
    setExpandedId(prev => prev === id ? null : id)
    if (email.status === 'PROCESSED' && email.bookingRef && !bookingCache.has(email.bookingRef)) {
      fetchBooking(email.bookingRef)
    }
  }, [bookingCache, fetchBooking])

  // Counts
  const counts = useMemo(() => ({
    total:     emails.length,
    received:  emails.filter(e => e.status === 'RECEIVED').length,
    processed: emails.filter(e => e.status === 'PROCESSED').length,
    waiting:   emails.filter(e => e.status === 'WAITING').length,
    error:     emails.filter(e => e.status === 'ERROR').length,
  }), [emails])

  // Filtered list
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return emails.filter(e => {
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false
      if (!q) return true
      return (
        e.subject.toLowerCase().includes(q) ||
        e.from.toLowerCase().includes(q) ||
        e.fromName.toLowerCase().includes(q) ||
        (e.bookingRef ?? '').toLowerCase().includes(q)
      )
    })
  }, [emails, statusFilter, searchQuery])

  return (
    <div className="space-y-4">

      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-indigo-500" />
          <span className="text-sm font-bold text-slate-700">Database Mail Cache</span>
          <span className="text-xs text-slate-400">— emails stored in DB from both mailboxes</span>
        </div>
        <button
          onClick={() => load()}
          disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Mailbox tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {([
          { key: 'all', label: 'All Mailboxes' },
          { key: 'tq',  label: 'TQ — confirm.booking' },
          { key: 'pnl', label: 'PNL — accounts.payable' },
        ] as { key: MailboxFilter; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setMailbox(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
              mailbox === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { key: 'ALL',      label: 'Total',       count: counts.total,     color: 'text-slate-700',  bg: '' },
          { key: 'RECEIVED', label: 'Unprocessed',  count: counts.received,  color: 'text-amber-600',  bg: 'bg-amber-50 border-amber-200' },
          { key: 'PROCESSED',label: 'Processed',    count: counts.processed, color: 'text-green-600',  bg: 'bg-green-50 border-green-200' },
          { key: 'WAITING',  label: 'Waiting TQ',  count: counts.waiting,   color: 'text-orange-500', bg: 'bg-orange-50 border-orange-200' },
          { key: 'ERROR',    label: 'Errors',       count: counts.error,     color: 'text-red-500',    bg: 'bg-red-50 border-red-200' },
        ].map(stat => (
          <button
            key={stat.key}
            onClick={() => setStatusFilter(stat.key as StatusFilter)}
            className={`rounded-xl border p-3 text-center transition-all ${stat.bg || 'border-slate-200'} ${
              statusFilter === stat.key ? 'ring-2 ring-indigo-300 ring-offset-1' : 'hover:opacity-80'
            }`}
          >
            <p className={`text-xl font-bold ${stat.color}`}>{stat.count}</p>
            <p className={`text-[10px] uppercase tracking-wider mt-0.5 ${stat.color}`}>{stat.label}</p>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search subject, sender, booking ref…"
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
        />
        {searchQuery && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <span className="text-[10px] font-semibold text-slate-400">{filtered.length}/{emails.length}</span>
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
          <span className="text-sm text-slate-500">Loading DB mail cache…</span>
        </div>
      )}

      {/* Email list */}
      {!loading && filtered.map(email => {
        const isPnl      = email.mailboxKind === 'PNL'
        const isExpanded = expandedId === email.graphId
        const st         = STATUS_STYLES[email.status] ?? STATUS_STYLES.RECEIVED
        const booking    = email.bookingRef ? bookingCache.get(email.bookingRef) : undefined
        const isLoadingB = email.bookingRef ? loadingBooking.has(email.bookingRef) : false

        return (
          <Card
            key={email.graphId}
            className={`overflow-hidden transition-all ${
              email.status === 'RECEIVED'  ? 'border-amber-200'  :
              email.status === 'PROCESSED' ? 'border-green-200 bg-green-50/10' :
              email.status === 'ERROR'     ? 'border-red-200'    :
              email.status === 'WAITING'   ? 'border-orange-200' : ''
            }`}
          >
            {/* Mailbox strip */}
            <div className={`px-4 py-1.5 border-b flex items-center gap-2 ${
              isPnl ? 'bg-teal-50 border-teal-100' : 'bg-blue-50 border-blue-100'
            }`}>
              <Mail className={`w-3 h-3 ${isPnl ? 'text-teal-500' : 'text-blue-500'}`} />
              <span className={`text-[10px] font-mono font-semibold ${isPnl ? 'text-teal-700' : 'text-blue-700'}`}>
                {email.mailboxUser}
              </span>
              <Badge color={isPnl ? 'teal' : 'blue'} className="text-[9px]">
                {isPnl ? 'PNL' : 'TQ'}
              </Badge>
              {/* Status badge */}
              <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.color}`}>
                {st.icon} {st.label}
              </span>
            </div>

            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {email.hasAttachments && (
                      <Badge color="amber"><Paperclip className="w-3 h-3 mr-1" />Attachment</Badge>
                    )}
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded font-mono">
                      {email.folder}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 truncate">{email.subject || '(no subject)'}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                    <span className="font-medium text-slate-600">{email.fromName || email.from}</span>
                    {email.fromName && <span className="text-slate-400">{email.from}</span>}
                    <span className="ml-auto flex items-center gap-1 text-slate-400 flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {fmtTs(email.date)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {email.status === 'PROCESSED' && email.bookingRef && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<ExternalLink className="w-3.5 h-3.5" />}
                      onClick={() => router.push(`/dashboard/bookings/${email.bookingRef}`)}
                    >
                      {email.bookingRef}
                    </Button>
                  )}
                  <button
                    onClick={() => handleExpand(email)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      isExpanded ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    {email.status === 'PROCESSED' ? 'Structured Data' : 'Raw Body'}
                  </button>
                </div>
              </div>

              {/* Timestamps */}
              <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                <span>Received: <strong className="text-slate-600">{fmtTs(email.date)}</strong></span>
                {email.processedAt && (
                  <span>Processed: <strong className="text-green-600">{fmtTs(email.processedAt)}</strong></span>
                )}
                {email.bookingRef && (
                  <span className="font-mono text-slate-500">Ref: <strong>{email.bookingRef}</strong></span>
                )}
              </div>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  {email.status === 'PROCESSED' && email.bookingRef ? (
                    isLoadingB ? (
                      <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                        Loading structured booking data…
                      </div>
                    ) : booking ? (
                      <BookingPanel detail={booking} isPnl={isPnl} />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-slate-400 py-3">
                        <AlertCircle className="w-4 h-4 text-red-400" />
                        Booking <strong>{email.bookingRef}</strong> not found in database.
                      </div>
                    )
                  ) : (
                    <RawBodyPanel body={email.rawBody || '(empty body)'} />
                  )}
                </div>
              )}
            </div>
          </Card>
        )
      })}

      {!loading && filtered.length === 0 && (
        <Card className="p-12 text-center">
          <Database className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">
            {searchQuery ? `No results for "${searchQuery}"` : 'No emails in DB cache'}
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {statusFilter !== 'ALL' ? `No ${STATUS_STYLES[statusFilter]?.label ?? statusFilter} emails` : 'Emails will appear here once received'}
          </p>
        </Card>
      )}
    </div>
  )
}
