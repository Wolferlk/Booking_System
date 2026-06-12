'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Mail, Zap, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Clock, Paperclip, Eye, ChevronUp, FolderOpen, WifiOff, Wifi,
  RefreshCw, ArrowRight, FileText, BarChart3, Users, ClipboardCheck,
  Inbox, Plane, Hotel, MapPin, Phone, FileSpreadsheet, Link2,
  ChevronDown, Info,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ProcessedEmail } from '@/lib/mail-processor'

// ── Types ─────────────────────────────────────────────────────────────────────

type MailboxFilter = 'all' | 'tq' | 'pnl'

interface EmailWithMailbox extends ProcessedEmail {
  mailboxKind: 'TOUR_CONFIRMATION' | 'PNL'
  mailboxUser: string
}

interface MailboxSubStatus {
  user: string
  kind: 'TOUR_CONFIRMATION' | 'PNL'
  active: boolean
  id: string | null
  expiry: string | null
}

interface SubStatus {
  active: boolean
  id: string | null
  expiry: string | null
  url: string
  mailboxes: MailboxSubStatus[]
}

interface ExtractedPassenger { name: string; type: string; isLead: boolean }
interface ExtractedFlight    { flightNo: string; date: string; fromApt: string; depTime?: string; toApt: string; arrTime?: string; airline?: string }
interface ExtractedHotel     { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; roomType?: string; mealType?: string }
interface ExtractedItinerary { dayNo: number; date: string; title: string; description?: string }
interface ExtractedContact   { name: string; phone?: string; role?: string }
interface ExtractedPnlLine   { activity: string; category: string; mmtRate: number; sicRate: number; pvtRatePP: number; adEntrance: number; chEntrance: number; otherRate: number }

interface ExtractedData {
  agent: string | null
  fileHandler: string | null
  agentBookingId: string | null
  arrivalDate: string | null
  departureDate: string | null
  paxAdults: number
  paxChildren: number
  quotedTotal: number | null
  currency: string
  passengers: ExtractedPassenger[]
  flights: ExtractedFlight[]
  accommodations: ExtractedHotel[]
  itineraryItems: ExtractedItinerary[]
  emergencyContacts: ExtractedContact[]
  pnlLines: ExtractedPnlLine[]
}

interface ProcessResult {
  bookingRef: string
  bookingId: string
  isNew: boolean
  pnlLines: number
  agendaItems: number
  status: string
  xlsxUsed?: boolean
  extracted?: ExtractedData
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL = 30_000
const TQ_EMAIL      = 'confirm.booking@aahaas.com'
const PNL_EMAIL     = 'accounts.payable@aahaas.com'

const TYPE_COLOR = { TOUR_CONFIRMATION: 'blue', PNL: 'green', UNKNOWN: 'gray' } as const
const TYPE_LABEL = { TOUR_CONFIRMATION: 'Tour Confirmation', PNL: 'P&L', UNKNOWN: 'Unknown' }

const CAT_COLOR: Record<string, string> = {
  HOTEL:          'bg-blue-100 text-blue-700',
  FLIGHT_TICKETS: 'bg-indigo-100 text-indigo-700',
  CRUISE:         'bg-cyan-100 text-cyan-700',
  TICKETS:        'bg-purple-100 text-purple-700',
  GUIDES:         'bg-orange-100 text-orange-700',
  WATER:          'bg-teal-100 text-teal-700',
  TRANSPORT:      'bg-amber-100 text-amber-700',
  MEALS:          'bg-rose-100 text-rose-700',
  TAX_FEES:       'bg-slate-100 text-slate-600',
  OTHER:          'bg-gray-100 text-gray-600',
}

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}

function usd(n: number) { return n > 0 ? `$${n.toFixed(2)}` : '—' }

// ── Sub-components ────────────────────────────────────────────────────────────

function TQExtraction({ data, agendaItems }: { data: ExtractedData; agendaItems: number }) {
  return (
    <div className="space-y-4 mt-4">
      {/* Booking summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Agent',          value: data.agent ?? '—' },
          { label: 'File Handler',   value: data.fileHandler ?? '—' },
          { label: 'Arrival',        value: fmt(data.arrivalDate) },
          { label: 'Departure',      value: fmt(data.departureDate) },
          { label: 'Adults',         value: String(data.paxAdults) },
          { label: 'Children',       value: String(data.paxChildren) },
          { label: 'Quoted Total',   value: data.quotedTotal ? `${data.currency} ${data.quotedTotal.toLocaleString()}` : '—' },
          { label: 'Agent Ref',      value: data.agentBookingId ?? '—' },
        ].map(item => (
          <div key={item.label} className="bg-slate-50 rounded-lg p-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider">{item.label}</p>
            <p className="text-sm font-semibold text-slate-800 truncate mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Passengers */}
      {data.passengers.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2">
            <Users className="w-3.5 h-3.5 text-blue-500" /> Passengers ({data.passengers.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-semibold">Type</th>
                  <th className="px-3 py-2 text-left font-semibold">Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.passengers.map((p, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-2 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-2">
                      <Badge color={p.type === 'CHILD' ? 'amber' : 'blue'}>{p.type}</Badge>
                    </td>
                    <td className="px-3 py-2">
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
      {data.flights.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2">
            <Plane className="w-3.5 h-3.5 text-indigo-500" /> Flights ({data.flights.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Flight</th>
                  <th className="px-3 py-2 text-left font-semibold">Date</th>
                  <th className="px-3 py-2 text-left font-semibold">Route</th>
                  <th className="px-3 py-2 text-left font-semibold">Times</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.flights.map((f, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-2 font-mono font-bold text-slate-800">{f.flightNo}</td>
                    <td className="px-3 py-2 text-slate-600">{fmt(f.date)}</td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-slate-800">{f.fromApt}</span>
                      <ArrowRight className="w-3 h-3 inline mx-1 text-slate-400" />
                      <span className="font-semibold text-slate-800">{f.toApt}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{f.depTime ?? '—'} → {f.arrTime ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hotels */}
      {data.accommodations.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2">
            <Hotel className="w-3.5 h-3.5 text-purple-500" /> Accommodations ({data.accommodations.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Hotel</th>
                  <th className="px-3 py-2 text-left font-semibold">City</th>
                  <th className="px-3 py-2 text-left font-semibold">Check In → Out</th>
                  <th className="px-3 py-2 text-left font-semibold">Nights</th>
                  <th className="px-3 py-2 text-left font-semibold">Meal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.accommodations.map((a, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-2 font-medium text-slate-800 max-w-[200px] truncate">{a.hotel}</td>
                    <td className="px-3 py-2 text-slate-600">{a.city}</td>
                    <td className="px-3 py-2 text-slate-600">{fmt(a.checkIn)} → {fmt(a.checkOut)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{a.nights}N</td>
                    <td className="px-3 py-2">{a.mealType ? <Badge color="teal">{a.mealType}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Emergency Contacts */}
      {data.emergencyContacts.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2">
            <Phone className="w-3.5 h-3.5 text-red-500" /> Emergency Contacts
          </p>
          <div className="flex flex-wrap gap-2">
            {data.emergencyContacts.map((c, i) => (
              <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs">
                <span className="font-semibold text-slate-800">{c.name}</span>
                {c.role && <span className="text-slate-500 ml-1">({c.role})</span>}
                {c.phone && <span className="text-red-600 ml-2 font-mono">{c.phone}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agenda generated */}
      {agendaItems > 0 && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          <span><strong>{agendaItems} movement chart items</strong> auto-generated from booking itinerary</span>
        </div>
      )}
    </div>
  )
}

function PNLExtraction({
  data, bookingRef, isNew, xlsxUsed,
}: {
  data: ExtractedData
  bookingRef: string
  isNew: boolean
  xlsxUsed: boolean
}) {
  const totalMMT   = data.pnlLines.reduce((s, l) => s + l.mmtRate, 0)
  const totalSIC   = data.pnlLines.reduce((s, l) => s + l.sicRate, 0)
  const totalPVT   = data.pnlLines.reduce((s, l) => s + l.pvtRatePP, 0)

  return (
    <div className="space-y-4 mt-4">
      {/* Link banner */}
      <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${
        isNew ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'
      }`}>
        <Link2 className={`w-4 h-4 flex-shrink-0 ${isNew ? 'text-blue-500' : 'text-green-500'}`} />
        <div>
          <p className={`text-xs font-bold ${isNew ? 'text-blue-800' : 'text-green-800'}`}>
            {isNew ? 'New booking created' : `Linked to booking`}
            {' '}<span className="font-mono">{bookingRef}</span>
          </p>
          <p className={`text-[11px] ${isNew ? 'text-blue-600' : 'text-green-600'}`}>
            {isNew
              ? 'Booking was created from this PNL (TQ not yet received)'
              : 'PNL data merged into the existing booking — both are now linked'}
          </p>
        </div>
      </div>

      {/* Source badge */}
      {xlsxUsed && (
        <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
          <FileSpreadsheet className="w-3.5 h-3.5 flex-shrink-0" />
          <span>PNL line items extracted from <strong>XLSX attachment</strong> — direct cell parsing (no AI guessing)</span>
        </div>
      )}
      {!xlsxUsed && data.pnlLines.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>PNL lines extracted from <strong>email body via GPT-4o</strong>. For best accuracy attach the .xlsx file.</span>
        </div>
      )}

      {/* PNL lines table */}
      {data.pnlLines.length > 0 ? (
        <div>
          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-2">
            <BarChart3 className="w-3.5 h-3.5 text-teal-500" />
            P&L Line Items ({data.pnlLines.length}) — {data.paxAdults}A {data.paxChildren > 0 ? `${data.paxChildren}C` : ''}
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold min-w-[200px]">Activity</th>
                    <th className="px-3 py-2 text-left font-semibold">Category</th>
                    <th className="px-3 py-2 text-right font-semibold">MMT Rate</th>
                    <th className="px-3 py-2 text-right font-semibold">SIC Rate</th>
                    <th className="px-3 py-2 text-right font-semibold">PVT PP</th>
                    <th className="px-3 py-2 text-right font-semibold">AD Entr.</th>
                    <th className="px-3 py-2 text-right font-semibold">CH Entr.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.pnlLines.map((l, i) => (
                    <tr key={i} className="bg-white hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-800">{l.activity}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${CAT_COLOR[l.category] ?? CAT_COLOR.OTHER}`}>
                          {l.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">{usd(l.mmtRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(l.sicRate)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(l.pvtRatePP)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(l.adEntrance)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-500">{usd(l.chEntrance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td className="px-3 py-2 font-bold text-slate-700 text-xs" colSpan={2}>Totals</td>
                    <td className="px-3 py-2 text-right font-bold font-mono text-slate-800">{usd(totalMMT)}</td>
                    <td className="px-3 py-2 text-right font-bold font-mono text-slate-600">{usd(totalSIC)}</td>
                    <td className="px-3 py-2 text-right font-bold font-mono text-slate-600">{usd(totalPVT)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
          No PNL lines extracted. Please ensure the .xlsx file is attached.
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MailInboxPage() {
  const router = useRouter()

  const [emails, setEmails]               = useState<EmailWithMailbox[]>([])
  const [fetching, setFetching]           = useState(true)
  const [polling, setPolling]             = useState(false)
  const [processing, setProcessing]       = useState<string | null>(null)
  const [processingAll, setProcessingAll] = useState(false)
  const [results, setResults]             = useState<Map<string, { success: boolean; data?: ProcessResult; error?: string }>>(new Map())
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [extractedId, setExtractedId]     = useState<string | null>(null)
  const [rawBodyId, setRawBodyId]         = useState<string | null>(null)
  const [limit, setLimit]                 = useState(50)
  const [folder, setFolder]               = useState<'all' | 'inbox'>('all')
  const [mailboxFilter, setMailboxFilter] = useState<MailboxFilter>('all')
  const [subStatus, setSubStatus]         = useState<SubStatus | null>(null)
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null)
  const [newIds, setNewIds]               = useState<Set<string>>(new Set())

  const knownIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/mail/subscribe')
      .then(r => r.json())
      .then(j => { if (j.success) setSubStatus(j.data as SubStatus) })
      .catch(() => {})
  }, [])

  const loadEmails = useCallback(async (silent = false) => {
    if (!silent) setFetching(true)
    else setPolling(true)
    try {
      const res  = await fetch(`/api/mail/fetch?limit=${limit}&folder=${folder}&mailbox=${mailboxFilter}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error as string)
      const loaded = json.data as EmailWithMailbox[]

      const freshIds = loaded.map(e => e.graphId).filter(id => !knownIdsRef.current.has(id))
      if (freshIds.length > 0 && silent) {
        setNewIds(prev => new Set(Array.from(prev).concat(freshIds)))
        toast.success(`${freshIds.length} new email${freshIds.length > 1 ? 's' : ''} arrived`)
      }
      knownIdsRef.current = new Set(loaded.map(e => e.graphId))
      setEmails(loaded)
      setLastRefresh(new Date())

      if (loaded.length > 0) {
        const ck   = await fetch('/api/mail/check-processed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphIds: loaded.map(e => e.graphId) }),
        })
        const ckj  = await ck.json()
        if (ckj.success && Array.isArray(ckj.data)) {
          setResults(prev => {
            const next = new Map(prev)
            for (const { graphId, bookingRef } of ckj.data as { graphId: string; bookingRef: string }[]) {
              if (!next.has(graphId)) {
                next.set(graphId, { success: true, data: { bookingRef, bookingId: '', isNew: false, pnlLines: 0, agendaItems: 0, status: 'existing' } })
              }
            }
            return next
          })
        }
      }
    } catch (err: unknown) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to load emails')
    } finally {
      setFetching(false)
      setPolling(false)
    }
  }, [limit, folder, mailboxFilter])

  useEffect(() => {
    loadEmails(false)
    const id = setInterval(() => loadEmails(true), POLL_INTERVAL)
    return () => clearInterval(id)
  }, [loadEmails])

  async function processEmail(email: EmailWithMailbox) {
    setProcessing(email.graphId)
    setNewIds(prev => { const n = new Set(prev); n.delete(email.graphId); return n })
    try {
      const res  = await fetch('/api/mail/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawBody:     email.rawBody,
          subject:     email.subject,
          emailType:   email.mailboxKind === 'PNL' ? 'PNL' : 'TOUR_CONFIRMATION',
          graphId:     email.graphId,
          mailboxUser: email.mailboxUser,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error as string)
      const data = json.data as ProcessResult
      setResults(m => new Map(m).set(email.graphId, { success: true, data }))
      setExtractedId(email.graphId)   // auto-open extraction panel
      toast.success(json.message as string)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Processing failed'
      setResults(m => new Map(m).set(email.graphId, { success: false, error: msg }))
      toast.error(msg)
    } finally {
      setProcessing(null)
    }
  }

  async function processAll() {
    const eligible = emails.filter(e => e.type !== 'UNKNOWN' && !results.has(e.graphId))
    if (!eligible.length) { toast.info('No eligible emails to process'); return }
    setProcessingAll(true)
    for (const email of eligible) await processEmail(email)
    setProcessingAll(false)
    toast.success('All emails processed')
  }

  const tqEmails       = emails.filter(e => e.mailboxKind === 'TOUR_CONFIRMATION')
  const pnlEmails      = emails.filter(e => e.mailboxKind === 'PNL')
  const processedCount = Array.from(results.values()).filter(r => r.success).length

  const tqSub  = subStatus?.mailboxes?.find(m => m.kind === 'TOUR_CONFIRMATION')
  const pnlSub = subStatus?.mailboxes?.find(m => m.kind === 'PNL')

  const mailboxLabel =
    mailboxFilter === 'tq'  ? `TQ — ${TQ_EMAIL}`  :
    mailboxFilter === 'pnl' ? `PNL — ${PNL_EMAIL}` :
    `${TQ_EMAIL}  +  ${PNL_EMAIL}`

  return (
    <div>
      <Header
        title="Mail Inbox"
        subtitle={mailboxLabel}
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <select value={folder} onChange={e => setFolder(e.target.value as 'all' | 'inbox')}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              <option value="all">All Folders</option>
              <option value="inbox">Inbox Only</option>
            </select>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n} emails</option>)}
            </select>
            {emails.length > 0 && (
              <Button variant="secondary" size="sm" loading={processingAll}
                icon={<Zap className="w-4 h-4" />} onClick={processAll}>
                Process All
              </Button>
            )}
            <button onClick={() => loadEmails(false)} disabled={fetching}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
              <RefreshCw className={`w-4 h-4 ${fetching || polling ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6 max-w-5xl space-y-4">

        {/* ── Process Flow ──────────────────────────────────────────────── */}
        <Card className="p-5 bg-gradient-to-r from-slate-50 to-blue-50/30 border-slate-200">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">
            Automated Processing Pipeline
          </p>
          <div className="flex items-stretch gap-2 flex-wrap">
            {[
              {
                n: 1, bg: 'bg-blue-50 border-blue-200', num: 'bg-blue-500',
                title: 'TQ Email', titleColor: 'text-blue-800',
                body: (<><p className="text-[11px] text-blue-700">Arrives at <span className="font-mono font-semibold">confirm.booking@</span></p><p className="text-[10px] text-blue-500 mt-1.5 flex items-center gap-1"><Mail className="w-3 h-3" /> Webhook · Cron (5 min)</p></>),
              },
              {
                n: 2, bg: 'bg-indigo-50 border-indigo-200', num: 'bg-indigo-500',
                title: 'Extract Booking', titleColor: 'text-indigo-800',
                body: (<><p className="text-[11px] text-indigo-700">GPT-4o extracts: agent, passengers, flights, hotels, itinerary</p><p className="text-[10px] text-indigo-500 mt-1.5 flex items-center gap-1"><Users className="w-3 h-3" /> Status: GT_REVIEW</p></>),
              },
              {
                n: 3, bg: 'bg-teal-50 border-teal-200', num: 'bg-teal-500',
                title: 'PNL Email + XLSX', titleColor: 'text-teal-800',
                body: (<><p className="text-[11px] text-teal-700">Arrives at <span className="font-mono font-semibold">accounts.payable@</span></p><p className="text-[10px] text-teal-500 mt-1.5 flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" /> Linked via booking ref (XLSX row 1)</p></>),
              },
              {
                n: 4, bg: 'bg-green-50 border-green-200', num: 'bg-green-500',
                title: 'Merge PNL Data', titleColor: 'text-green-800',
                body: (<><p className="text-[11px] text-green-700">PNL rates + categories added to existing booking. Tickets auto-created.</p><p className="text-[10px] text-green-500 mt-1.5 flex items-center gap-1"><BarChart3 className="w-3 h-3" /> Costs + Tickets generated</p></>),
              },
              {
                n: 5, bg: 'bg-amber-50 border-amber-200', num: 'bg-amber-500',
                title: 'Ground Review', titleColor: 'text-amber-800',
                body: (<><p className="text-[11px] text-amber-700">Ground team verifies the complete booking with PNL costs attached.</p><p className="text-[10px] text-amber-500 mt-1.5 flex items-center gap-1"><ClipboardCheck className="w-3 h-3" /> GT_REVIEW → GT_VERIFIED</p></>),
              },
            ].map((step, idx, arr) => (
              <div key={step.n} className="flex items-center gap-2">
                <div className={`flex-1 min-w-[140px] max-w-[165px] rounded-xl border p-3 h-full ${step.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-6 h-6 rounded-full ${step.num} text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0`}>{step.n}</div>
                    <span className={`text-xs font-bold leading-tight ${step.titleColor}`}>{step.title}</span>
                  </div>
                  {step.body}
                </div>
                {idx < arr.length - 1 && <ArrowRight className="w-4 h-4 text-slate-300 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </Card>

        {/* ── Mailbox Status Cards ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Travel Quotation Mailbox', email: TQ_EMAIL,  sub: tqSub  },
            { label: 'P&L Mailbox',              email: PNL_EMAIL, sub: pnlSub },
          ].map(({ label, email, sub }) => (
            <Card key={email}
              className={`p-4 border ${sub?.active ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-3">
                {sub?.active
                  ? <Wifi className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                  : <WifiOff className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                }
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-xs font-bold ${sub?.active ? 'text-green-800' : 'text-amber-800'}`}>{label}</span>
                    <Badge color={sub?.active ? 'green' : 'amber'} className="text-[10px]">
                      {sub?.active ? 'Webhook Live' : 'Cron Active'}
                    </Badge>
                  </div>
                  <p className="text-[11px] font-mono text-slate-500 truncate">{email}</p>
                  <p className={`text-[10px] mt-0.5 ${sub?.active ? 'text-green-600' : 'text-amber-600'}`}>
                    {sub?.active
                      ? `Renews ${sub.expiry ? new Date(sub.expiry).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}`
                      : 'Cron polls every 5 min — webhook auto-activates on deploy'}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* ── Mailbox Tabs ───────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {([
            { key: 'all', label: 'All Mailboxes', count: emails.length },
            { key: 'tq',  label: 'Travel Quotation', count: tqEmails.length },
            { key: 'pnl', label: 'P&L',              count: pnlEmails.length },
          ] as { key: MailboxFilter; label: string; count: number }[]).map(tab => (
            <button key={tab.key} onClick={() => setMailboxFilter(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                mailboxFilter === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Inbox className="w-3.5 h-3.5" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
                mailboxFilter === tab.key ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        {emails.length > 0 && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total',      value: emails.length,      color: 'text-slate-700' },
              { label: 'TQ Emails',  value: tqEmails.length,    color: 'text-blue-600'  },
              { label: 'PNL Emails', value: pnlEmails.length,   color: 'text-teal-600'  },
              { label: 'Processed',  value: processedCount,     color: 'text-green-600' },
            ].map(s => (
              <Card key={s.label} className="p-3 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </Card>
            ))}
          </div>
        )}

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {fetching && (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            <span className="text-sm text-slate-500">Connecting to Microsoft Graph…</span>
          </div>
        )}

        {/* ── Email Cards ───────────────────────────────────────────────── */}
        {!fetching && emails.map(email => {
          const result       = results.get(email.graphId)
          const isProcessing = processing === email.graphId
          const isExpanded   = extractedId === email.graphId
          const showRaw      = rawBodyId === email.graphId
          const isNew        = newIds.has(email.graphId)
          const isPnl        = email.mailboxKind === 'PNL'

          return (
            <Card key={email.graphId} className={`overflow-hidden transition-all ${
              isNew           ? 'border-brand-400 ring-1 ring-brand-300' :
              result?.success ? 'border-green-200' :
              result?.error   ? 'border-red-200'   :
              !email.isRead   ? 'border-brand-200 bg-brand-50/30' : ''
            }`}>

              {/* Mailbox strip */}
              <div className={`px-4 py-1.5 flex items-center gap-2 border-b ${
                isPnl ? 'bg-teal-50 border-teal-100' : 'bg-blue-50 border-blue-100'
              }`}>
                <Mail className={`w-3 h-3 ${isPnl ? 'text-teal-500' : 'text-blue-500'}`} />
                <span className={`text-[11px] font-mono font-semibold ${isPnl ? 'text-teal-700' : 'text-blue-700'}`}>
                  {email.mailboxUser}
                </span>
                <Badge color={isPnl ? 'teal' : 'blue'} className="text-[10px]">
                  {isPnl ? 'P&L Mailbox' : 'TQ Mailbox'}
                </Badge>
              </div>

              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <Badge color={TYPE_COLOR[email.type]}>{TYPE_LABEL[email.type]}</Badge>
                      {email.folder && <Badge color="gray"><FolderOpen className="w-3 h-3 mr-1" />{email.folder}</Badge>}
                      {isNew && <Badge color="indigo">New</Badge>}
                      {!isNew && !email.isRead && <Badge color="indigo">Unread</Badge>}
                      {email.hasAttachments && <Badge color="amber"><Paperclip className="w-3 h-3 mr-1" />Attachment</Badge>}
                      {email.importance === 'high' && <Badge color="red">High Priority</Badge>}
                      {result?.success && <Badge color="green"><CheckCircle className="w-3 h-3 mr-1" />Processed</Badge>}
                      {result?.error   && <Badge color="red"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>}
                    </div>

                    <p className={`text-sm truncate ${!email.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {email.subject || '(no subject)'}
                    </p>

                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                      <span className="font-medium text-slate-600">{email.fromName || email.from}</span>
                      {email.fromName && <span>{email.from}</span>}
                      {email.to.length > 0 && <span>→ {email.to.slice(0, 2).join(', ')}{email.to.length > 2 ? ` +${email.to.length - 2}` : ''}</span>}
                      <span className="flex items-center gap-1 ml-auto">
                        <Clock className="w-3 h-3" />
                        {new Date(email.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {/* View raw body */}
                    <button
                      onClick={() => setRawBodyId(showRaw ? null : email.graphId)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                      title="Preview email body"
                    >
                      {showRaw ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    {/* Open booking */}
                    {result?.success && result.data && result.data.bookingRef && (
                      <Button size="sm" variant="secondary"
                        icon={<ExternalLink className="w-3.5 h-3.5" />}
                        onClick={() => router.push(`/dashboard/bookings/${result.data!.bookingRef}`)}>
                        {result.data.bookingRef}
                      </Button>
                    )}

                    {/* Show extracted data toggle */}
                    {result?.success && result.data?.extracted && (
                      <button
                        onClick={() => setExtractedId(isExpanded ? null : email.graphId)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          isExpanded ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-green-50 hover:text-green-700'
                        }`}
                      >
                        {isPnl ? <BarChart3 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                        {isExpanded ? 'Hide Details' : 'View Extracted'}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}

                    {/* Process button */}
                    {!result && email.type !== 'UNKNOWN' && (
                      <Button size="sm" loading={isProcessing}
                        icon={isProcessing ? undefined : <Zap className="w-3.5 h-3.5" />}
                        onClick={() => processEmail(email)} disabled={processingAll}>
                        {isProcessing ? 'Processing…' : 'Process'}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Quick result summary bar */}
                {result?.success && result.data && !isExpanded && (
                  <div className="mt-3 flex items-center gap-4 text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <span className="flex items-center gap-1 font-semibold text-slate-700">
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      {result.data.bookingRef}
                    </span>
                    <span>{result.data.status === 'existing' ? 'Already processed' : result.data.isNew ? 'New booking created' : 'Booking updated'}</span>
                    {result.data.pnlLines > 0 && <span className="text-teal-600 font-medium">{result.data.pnlLines} PNL lines</span>}
                    {result.data.agendaItems > 0 && <span className="text-indigo-600 font-medium">{result.data.agendaItems} agenda items</span>}
                    {result.data.xlsxUsed && <span className="text-green-600 font-medium flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" />XLSX parsed</span>}
                    {result.data.extracted && (
                      <button
                        onClick={() => setExtractedId(email.graphId)}
                        className="ml-auto text-blue-600 hover:underline flex items-center gap-1"
                      >
                        View full extraction <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Raw body preview */}
                {showRaw && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    {email.cc.length > 0 && <p className="text-xs text-slate-400 mb-2">CC: {email.cc.join(', ')}</p>}
                    <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 max-h-52 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-100">
                      {email.rawBody || '(empty body)'}
                    </pre>
                  </div>
                )}

                {/* Extraction preview panel */}
                {isExpanded && result?.success && result.data?.extracted && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        {isPnl
                          ? <><BarChart3 className="w-3.5 h-3.5 text-teal-500" /> P&L Extraction &amp; Merge Result</>
                          : <><FileText className="w-3.5 h-3.5 text-blue-500" /> Booking Extraction Result</>
                        }
                      </p>
                    </div>

                    {isPnl ? (
                      <PNLExtraction
                        data={result.data.extracted}
                        bookingRef={result.data.bookingRef}
                        isNew={result.data.isNew}
                        xlsxUsed={result.data.xlsxUsed ?? false}
                      />
                    ) : (
                      <TQExtraction
                        data={result.data.extracted}
                        agendaItems={result.data.agendaItems}
                      />
                    )}
                  </div>
                )}

                {/* Error */}
                {result?.error && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-red-600 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {result.error}
                  </div>
                )}
              </div>
            </Card>
          )
        })}

        {/* Refresh status */}
        {lastRefresh && (
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400 py-1">
            {polling && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>Updated {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh every 30s</span>
          </div>
        )}

        {/* Empty state */}
        {!fetching && emails.length === 0 && (
          <Card className="p-12 text-center">
            <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No emails found</p>
            <p className="text-slate-400 text-sm mt-1">
              {mailboxFilter === 'tq'  ? `Checking ${TQ_EMAIL}…`  :
               mailboxFilter === 'pnl' ? `Checking ${PNL_EMAIL}…` :
               'Checking both mailboxes…'}
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
