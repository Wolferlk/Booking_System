'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Mail, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Clock, Paperclip, FolderOpen, WifiOff, Wifi,
  RefreshCw, ArrowRight, FileText, BarChart3, Users,
  ClipboardCheck, Inbox, Plane, Hotel, Phone,
  FileSpreadsheet, Link2, ChevronDown, ChevronUp,
  Eye, Info, Zap,
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
  user: string; kind: 'TOUR_CONFIRMATION' | 'PNL'
  active: boolean; id: string | null; expiry: string | null
}

interface SubStatus {
  active: boolean; id: string | null; expiry: string | null
  url: string; mailboxes: MailboxSubStatus[]
}

interface ExtractedPassenger { name: string; type: string; isLead: boolean }
interface ExtractedFlight    { flightNo: string; date: string; fromApt: string; depTime?: string; toApt: string; arrTime?: string }
interface ExtractedHotel     { hotel: string; city: string; checkIn: string; checkOut: string; nights: number; mealType?: string }
interface ExtractedContact   { name: string; phone?: string; role?: string }
interface ExtractedPnlLine   {
  activity: string; category: string
  mmtRate: number; sicRate: number; pvtRatePP: number
  adEntrance: number; chEntrance: number; otherRate: number
}

interface ExtractedData {
  agent: string | null; fileHandler: string | null; agentBookingId: string | null
  arrivalDate: string | null; departureDate: string | null
  paxAdults: number; paxChildren: number
  quotedTotal: number | null; currency: string
  passengers: ExtractedPassenger[]; flights: ExtractedFlight[]
  accommodations: ExtractedHotel[]; emergencyContacts: ExtractedContact[]
  pnlLines: ExtractedPnlLine[]
}

interface ProcessResult {
  bookingRef: string; bookingId: string
  isNew: boolean; pnlLines: number; agendaItems: number
  status: string; xlsxUsed?: boolean; extracted?: ExtractedData
}

interface PnlStatus { hasPNL: boolean; lineCount: number; checking: boolean }

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL   = 30_000
const PROCESS_DELAY   = 1500   // ms between auto-processes
const TQ_EMAIL        = 'confirm.booking@aahaas.com'
const PNL_EMAIL       = 'accounts.payable@aahaas.com'

const CAT_COLOR: Record<string, string> = {
  HOTEL: 'bg-blue-100 text-blue-700', FLIGHT_TICKETS: 'bg-indigo-100 text-indigo-700',
  CRUISE: 'bg-cyan-100 text-cyan-700', TICKETS: 'bg-purple-100 text-purple-700',
  GUIDES: 'bg-orange-100 text-orange-700', WATER: 'bg-teal-100 text-teal-700',
  TRANSPORT: 'bg-amber-100 text-amber-700', MEALS: 'bg-rose-100 text-rose-700',
  TAX_FEES: 'bg-slate-100 text-slate-600', OTHER: 'bg-gray-100 text-gray-600',
}

function fmt(d?: string | null) {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return d }
}
function usd(n: number) { return n > 0 ? `$${n.toFixed(2)}` : '—' }

// ── Sub-components ────────────────────────────────────────────────────────────

function PnlPill({ status }: { status: PnlStatus | undefined }) {
  if (!status || status.checking) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking PNL…
      </span>
    )
  }
  if (status.hasPNL) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
        <CheckCircle className="w-2.5 h-2.5" /> PNL Added · {status.lineCount} lines
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 animate-pulse">
      <Clock className="w-2.5 h-2.5" /> PNL Pending
    </span>
  )
}

function TQExtraction({ data, agendaItems }: { data: ExtractedData; agendaItems: number }) {
  return (
    <div className="space-y-3 mt-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Agent',        value: data.agent ?? '—' },
          { label: 'File Handler', value: data.fileHandler ?? '—' },
          { label: 'Arrival',      value: fmt(data.arrivalDate) },
          { label: 'Departure',    value: fmt(data.departureDate) },
          { label: 'Adults',       value: String(data.paxAdults) },
          { label: 'Children',     value: String(data.paxChildren) },
          { label: 'Quoted Total', value: data.quotedTotal ? `${data.currency} ${data.quotedTotal.toLocaleString()}` : '—' },
          { label: 'Agent Ref',    value: data.agentBookingId ?? '—' },
        ].map(item => (
          <div key={item.label} className="bg-slate-50 rounded-lg p-2">
            <p className="text-[9px] text-slate-400 uppercase tracking-wider">{item.label}</p>
            <p className="text-xs font-semibold text-slate-800 truncate mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {data.passengers.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Users className="w-3 h-3 text-blue-500" /> Passengers ({data.passengers.length})
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr><th className="px-3 py-1.5 text-left">Name</th><th className="px-3 py-1.5 text-left">Type</th><th className="px-3 py-1.5 text-left">Lead</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.passengers.map((p, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-medium text-slate-800">{p.name}</td>
                    <td className="px-3 py-1.5"><Badge color={p.type === 'CHILD' ? 'amber' : 'blue'}>{p.type}</Badge></td>
                    <td className="px-3 py-1.5">{p.isLead && <Badge color="green">Lead</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.flights.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Plane className="w-3 h-3 text-indigo-500" /> Flights
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr><th className="px-3 py-1.5 text-left">Flight</th><th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-left">Route</th><th className="px-3 py-1.5 text-left">Times</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.flights.map((f, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-mono font-bold text-slate-800">{f.flightNo}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmt(f.date)}</td>
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

      {data.accommodations.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <Hotel className="w-3 h-3 text-purple-500" /> Hotels
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                <tr><th className="px-3 py-1.5 text-left">Hotel</th><th className="px-3 py-1.5 text-left">City</th><th className="px-3 py-1.5 text-left">Check In → Out</th><th className="px-3 py-1.5">N</th><th className="px-3 py-1.5">Meal</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.accommodations.map((a, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-3 py-1.5 font-medium text-slate-800 max-w-[180px] truncate">{a.hotel}</td>
                    <td className="px-3 py-1.5 text-slate-600">{a.city}</td>
                    <td className="px-3 py-1.5 text-slate-600">{fmt(a.checkIn)} → {fmt(a.checkOut)}</td>
                    <td className="px-3 py-1.5 font-semibold text-center">{a.nights}</td>
                    <td className="px-3 py-1.5">{a.mealType ? <Badge color="teal">{a.mealType}</Badge> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.emergencyContacts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {data.emergencyContacts.map((c, i) => (
            <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2">
              <Phone className="w-3 h-3 text-red-400" />
              <span className="font-semibold text-slate-800">{c.name}</span>
              {c.role && <span className="text-slate-500">({c.role})</span>}
              {c.phone && <span className="text-red-600 font-mono">{c.phone}</span>}
            </div>
          ))}
        </div>
      )}

      {agendaItems > 0 && (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <ClipboardCheck className="w-3.5 h-3.5 flex-shrink-0" />
          <span><strong>{agendaItems} movement chart items</strong> auto-generated</span>
        </div>
      )}
    </div>
  )
}

function PNLExtraction({ data, bookingRef, isNew, xlsxUsed }: {
  data: ExtractedData; bookingRef: string; isNew: boolean; xlsxUsed: boolean
}) {
  const totalMMT = data.pnlLines.reduce((s, l) => s + l.mmtRate, 0)
  const totalSIC = data.pnlLines.reduce((s, l) => s + l.sicRate, 0)
  const totalPVT = data.pnlLines.reduce((s, l) => s + l.pvtRatePP, 0)

  return (
    <div className="space-y-3 mt-3">
      <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border text-xs ${
        isNew ? 'bg-blue-50 border-blue-200' : 'bg-green-50 border-green-200'
      }`}>
        <Link2 className={`w-3.5 h-3.5 flex-shrink-0 ${isNew ? 'text-blue-500' : 'text-green-500'}`} />
        <div>
          <p className={`font-bold ${isNew ? 'text-blue-800' : 'text-green-800'}`}>
            {isNew ? 'New booking created' : 'PNL merged into booking'}
            {' '}<span className="font-mono">{bookingRef}</span>
          </p>
          <p className={`text-[11px] mt-0.5 ${isNew ? 'text-blue-600' : 'text-green-600'}`}>
            {isNew ? 'Booking stub created from PNL — TQ not yet received' : 'Cost data linked — booking is now complete'}
          </p>
        </div>
      </div>

      {xlsxUsed
        ? <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
            <FileSpreadsheet className="w-3.5 h-3.5 flex-shrink-0" />
            XLSX attachment parsed — <strong>direct cell extraction</strong>, no AI required
          </div>
        : <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0" />
            Extracted from email body via GPT-4o. Attach .xlsx for precise rates.
          </div>
      }

      {data.pnlLines.length > 0 ? (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mb-1.5">
            <BarChart3 className="w-3 h-3 text-teal-500" />
            {data.pnlLines.length} Line Items — {data.paxAdults}A{data.paxChildren > 0 ? ` ${data.paxChildren}C` : ''}
          </p>
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="px-3 py-1.5 text-left min-w-[180px]">Activity</th>
                    <th className="px-3 py-1.5 text-left">Category</th>
                    <th className="px-3 py-1.5 text-right">MMT</th>
                    <th className="px-3 py-1.5 text-right">SIC</th>
                    <th className="px-3 py-1.5 text-right">PVT PP</th>
                    <th className="px-3 py-1.5 text-right">AD Ent.</th>
                    <th className="px-3 py-1.5 text-right">CH Ent.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.pnlLines.map((l, i) => (
                    <tr key={i} className="bg-white hover:bg-slate-50">
                      <td className="px-3 py-1.5 font-medium text-slate-800">{l.activity}</td>
                      <td className="px-3 py-1.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold ${CAT_COLOR[l.category] ?? CAT_COLOR.OTHER}`}>{l.category}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-700">{usd(l.mmtRate)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{usd(l.sicRate)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{usd(l.pvtRatePP)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{usd(l.adEntrance)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-slate-500">{usd(l.chEntrance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-3 py-1.5 font-bold text-slate-700 text-xs" colSpan={2}>Totals</td>
                    <td className="px-3 py-1.5 text-right font-bold font-mono text-slate-800">{usd(totalMMT)}</td>
                    <td className="px-3 py-1.5 text-right font-bold font-mono text-slate-600">{usd(totalSIC)}</td>
                    <td className="px-3 py-1.5 text-right font-bold font-mono text-slate-600">{usd(totalPVT)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-5 text-slate-400 text-sm border border-dashed border-slate-200 rounded-lg">
          <FileText className="w-7 h-7 mx-auto mb-1 opacity-40" />
          No PNL lines found. Ensure the .xlsx file is attached.
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
  const [results, setResults]             = useState<Map<string, { success: boolean; data?: ProcessResult; error?: string }>>(new Map())
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [rawBodyId, setRawBodyId]         = useState<string | null>(null)
  const [limit, setLimit]                 = useState(50)
  const [folder, setFolder]               = useState<'all' | 'inbox'>('all')
  const [mailboxFilter, setMailboxFilter] = useState<MailboxFilter>('all')
  const [subStatus, setSubStatus]         = useState<SubStatus | null>(null)
  const [lastRefresh, setLastRefresh]     = useState<Date | null>(null)
  const [pnlStatusMap, setPnlStatusMap]   = useState<Map<string, PnlStatus>>(new Map())
  const [autoProcessingIds, setAutoProcessingIds] = useState<Set<string>>(new Set())

  // Refs for queue management (avoid stale closures)
  const resultsRef         = useRef(results)
  const autoQueuedRef      = useRef<Set<string>>(new Set())
  const autoRunningRef     = useRef(false)
  const autoQueueRef       = useRef<EmailWithMailbox[]>([])
  const pnlStatusMapRef    = useRef(pnlStatusMap)

  useEffect(() => { resultsRef.current = results }, [results])
  useEffect(() => { pnlStatusMapRef.current = pnlStatusMap }, [pnlStatusMap])

  // ── PNL status check ─────────────────────────────────────────────────────

  const checkBookingPnl = useCallback(async (bookingRef: string) => {
    setPnlStatusMap(prev => new Map(prev).set(bookingRef, { hasPNL: false, lineCount: 0, checking: true }))
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}`)
      const json = await res.json()
      if (json.success) {
        const pnl = json.data?.pnl
        setPnlStatusMap(prev => new Map(prev).set(bookingRef, {
          hasPNL:    !!pnl,
          lineCount: Array.isArray(pnl?.lineItems) ? (pnl.lineItems as unknown[]).length : 0,
          checking:  false,
        }))
      } else {
        setPnlStatusMap(prev => new Map(prev).set(bookingRef, { hasPNL: false, lineCount: 0, checking: false }))
      }
    } catch {
      setPnlStatusMap(prev => new Map(prev).set(bookingRef, { hasPNL: false, lineCount: 0, checking: false }))
    }
  }, [])

  // ── Auto-process queue ───────────────────────────────────────────────────

  const processOne = useCallback(async (email: EmailWithMailbox) => {
    setAutoProcessingIds(prev => new Set(Array.from(prev).concat([email.graphId])))
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
      if (json.success) {
        const data = json.data as ProcessResult
        setResults(m => new Map(m).set(email.graphId, { success: true, data }))
        // Check / refresh PNL status
        if (email.mailboxKind === 'TOUR_CONFIRMATION') {
          checkBookingPnl(data.bookingRef)
        } else {
          // PNL email processed — refresh PNL status on the linked TQ booking
          setPnlStatusMap(prev => new Map(prev).set(data.bookingRef, {
            hasPNL: data.pnlLines > 0, lineCount: data.pnlLines, checking: false,
          }))
          if (data.pnlLines > 0) {
            toast.success(`PNL added to booking ${data.bookingRef} — ${data.pnlLines} lines`, { duration: 4000 })
          }
        }
      } else {
        setResults(m => new Map(m).set(email.graphId, { success: false, error: json.error as string }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Auto-process failed'
      setResults(m => new Map(m).set(email.graphId, { success: false, error: msg }))
    } finally {
      setAutoProcessingIds(prev => { const n = new Set(prev); n.delete(email.graphId); return n })
    }
  }, [checkBookingPnl])

  const drainQueue = useCallback(async () => {
    if (autoRunningRef.current) return
    autoRunningRef.current = true
    while (autoQueueRef.current.length > 0) {
      const email = autoQueueRef.current.shift()!
      await processOne(email)
      if (autoQueueRef.current.length > 0) {
        await new Promise(r => setTimeout(r, PROCESS_DELAY))
      }
    }
    autoRunningRef.current = false
  }, [processOne])

  // Trigger auto-process when emails change
  useEffect(() => {
    const toProcess = emails.filter(e =>
      !resultsRef.current.has(e.graphId) &&
      e.type !== 'UNKNOWN' &&
      !autoQueuedRef.current.has(e.graphId),
    )
    if (!toProcess.length) return
    toProcess.forEach(e => autoQueuedRef.current.add(e.graphId))
    autoQueueRef.current.push(...toProcess)
    drainQueue()
  }, [emails, drainQueue])

  // ── Load emails ──────────────────────────────────────────────────────────

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
      setEmails(loaded)
      setLastRefresh(new Date())

      if (loaded.length > 0) {
        const ck  = await fetch('/api/mail/check-processed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graphIds: loaded.map(e => e.graphId) }),
        })
        const ckj = await ck.json()
        if (ckj.success && Array.isArray(ckj.data)) {
          const alreadyProcessed = ckj.data as { graphId: string; bookingRef: string }[]

          setResults(prev => {
            const next = new Map(prev)
            for (const { graphId, bookingRef } of alreadyProcessed) {
              if (!next.has(graphId)) {
                next.set(graphId, { success: true, data: { bookingRef, bookingId: '', isNew: false, pnlLines: 0, agendaItems: 0, status: 'existing' } })
              }
              // Mark as queued so auto-process skips them
              autoQueuedRef.current.add(graphId)
            }
            return next
          })

          // Check PNL status for already-processed TQ bookings
          for (const { graphId, bookingRef } of alreadyProcessed) {
            const email = loaded.find(e => e.graphId === graphId)
            if (email?.mailboxKind === 'TOUR_CONFIRMATION' && bookingRef && !pnlStatusMapRef.current.has(bookingRef)) {
              checkBookingPnl(bookingRef)
            }
          }
        }
      }
    } catch (err: unknown) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Failed to load emails')
    } finally {
      setFetching(false)
      setPolling(false)
    }
  }, [limit, folder, mailboxFilter, checkBookingPnl])

  useEffect(() => {
    loadEmails(false)
    const id = setInterval(() => loadEmails(true), POLL_INTERVAL)
    return () => clearInterval(id)
  }, [loadEmails])

  // Also re-check PNL when a PNL email result appears for the first time
  useEffect(() => {
    results.forEach((result, graphId) => {
      if (!result.success || !result.data) return
      const email = emails.find(e => e.graphId === graphId)
      if (email?.mailboxKind !== 'PNL') return
      const ref = result.data.bookingRef
      if (!ref) return
      // Re-check the TQ booking's PNL status whenever PNL result changes
      const current = pnlStatusMapRef.current.get(ref)
      if (!current?.checking && result.data.pnlLines > 0 && !current?.hasPNL) {
        checkBookingPnl(ref)
      }
    })
  }, [results, emails, checkBookingPnl])

  // ── Derived state ────────────────────────────────────────────────────────

  const tqEmails       = emails.filter(e => e.mailboxKind === 'TOUR_CONFIRMATION')
  const pnlEmails      = emails.filter(e => e.mailboxKind === 'PNL')
  const processedCount = Array.from(results.values()).filter(r => r.success).length
  const autoCount      = autoProcessingIds.size

  const tqSub  = subStatus?.mailboxes?.find(m => m.kind === 'TOUR_CONFIRMATION')
  const pnlSub = subStatus?.mailboxes?.find(m => m.kind === 'PNL')

  return (
    <div>
      <Header
        title="Mail Inbox"
        subtitle={
          mailboxFilter === 'tq'  ? `TQ — ${TQ_EMAIL}`  :
          mailboxFilter === 'pnl' ? `PNL — ${PNL_EMAIL}` :
          `${TQ_EMAIL}  +  ${PNL_EMAIL}`
        }
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <select value={folder} onChange={e => setFolder(e.target.value as 'all' | 'inbox')}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              <option value="all">All Folders</option>
              <option value="inbox">Inbox Only</option>
            </select>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n} emails</option>)}
            </select>
            <button onClick={() => loadEmails(false)} disabled={fetching}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
              <RefreshCw className={`w-4 h-4 ${fetching || polling ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6 max-w-5xl space-y-4">

        {/* ── Pipeline ──────────────────────────────────────────────────── */}
        <Card className="p-4 bg-gradient-to-r from-slate-50 to-blue-50/30">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Automated Pipeline</p>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {[
              { bg: 'bg-blue-100 border-blue-300 text-blue-800',    icon: <Mail className="w-3 h-3" />,           label: 'TQ Email arrives' },
              { bg: 'bg-indigo-100 border-indigo-300 text-indigo-800', icon: <Zap className="w-3 h-3" />,         label: 'Booking created' },
              { bg: 'bg-teal-100 border-teal-300 text-teal-800',    icon: <FileSpreadsheet className="w-3 h-3" />, label: 'PNL Email + XLSX' },
              { bg: 'bg-green-100 border-green-300 text-green-800', icon: <BarChart3 className="w-3 h-3" />,       label: 'PNL merged' },
              { bg: 'bg-amber-100 border-amber-300 text-amber-800', icon: <ClipboardCheck className="w-3 h-3" />, label: 'Ground Review' },
            ].map((s, i, a) => (
              <div key={i} className="flex items-center gap-2">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-semibold ${s.bg}`}>
                  {s.icon}{s.label}
                </span>
                {i < a.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </Card>

        {/* ── Mailbox Status ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Travel Quotation', email: TQ_EMAIL, sub: tqSub },
            { label: 'P&L Mailbox',      email: PNL_EMAIL, sub: pnlSub },
          ].map(({ label, email, sub }) => (
            <Card key={email} className={`p-3 border ${sub?.active ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2.5">
                {sub?.active ? <Wifi className="w-3.5 h-3.5 text-green-500 flex-shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${sub?.active ? 'text-green-800' : 'text-amber-800'}`}>{label}</span>
                    <Badge color={sub?.active ? 'green' : 'amber'} className="text-[9px]">{sub?.active ? 'Webhook Live' : 'Cron 5min'}</Badge>
                  </div>
                  <p className="text-[10px] font-mono text-slate-500 truncate">{email}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {([
            { key: 'all', label: 'All',                 count: emails.length    },
            { key: 'tq',  label: 'Travel Quotation',    count: tqEmails.length  },
            { key: 'pnl', label: 'P&L',                 count: pnlEmails.length },
          ] as { key: MailboxFilter; label: string; count: number }[]).map(tab => (
            <button key={tab.key} onClick={() => setMailboxFilter(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                mailboxFilter === tab.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              <Inbox className="w-3.5 h-3.5" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${mailboxFilter === tab.key ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-500'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Stats ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total',                value: emails.length,      color: 'text-slate-700' },
            { label: 'TQ Emails',            value: tqEmails.length,    color: 'text-blue-600'  },
            { label: 'PNL Emails',           value: pnlEmails.length,   color: 'text-teal-600'  },
            { label: autoCount > 0 ? `Processing (${autoCount})` : 'Processed',
              value: autoCount > 0 ? autoCount : processedCount,
              color: autoCount > 0 ? 'text-amber-500' : 'text-green-600' },
          ].map(s => (
            <Card key={s.label} className="p-3 text-center">
              <p className={`text-2xl font-bold ${s.color}`}>
                {autoCount > 0 && s.label.startsWith('Processing')
                  ? <span className="flex items-center justify-center gap-1"><Loader2 className="w-5 h-5 animate-spin" />{s.value}</span>
                  : s.value
                }
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            </Card>
          ))}
        </div>

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
          const isAutoProc   = autoProcessingIds.has(email.graphId)
          const isExpanded   = expandedId === email.graphId
          const showRaw      = rawBodyId === email.graphId
          const isPnl        = email.mailboxKind === 'PNL'
          const bookingRef   = result?.data?.bookingRef
          const pnlSt        = !isPnl && bookingRef ? pnlStatusMap.get(bookingRef) : undefined

          return (
            <Card key={email.graphId} className={`overflow-hidden transition-all ${
              isAutoProc        ? 'border-amber-300 ring-1 ring-amber-200' :
              result?.success   ? 'border-green-200 bg-green-50/20'        :
              result?.error     ? 'border-red-200'                          :
              !email.isRead     ? 'border-blue-200 bg-blue-50/20'           : ''
            }`}>

              {/* Mailbox strip */}
              <div className={`px-4 py-1.5 flex items-center gap-2 border-b ${isPnl ? 'bg-teal-50 border-teal-100' : 'bg-blue-50 border-blue-100'}`}>
                <Mail className={`w-3 h-3 ${isPnl ? 'text-teal-500' : 'text-blue-500'}`} />
                <span className={`text-[10px] font-mono font-semibold ${isPnl ? 'text-teal-700' : 'text-blue-700'}`}>{email.mailboxUser}</span>
                <Badge color={isPnl ? 'teal' : 'blue'} className="text-[9px]">{isPnl ? 'P&L Mailbox' : 'TQ Mailbox'}</Badge>
                {isAutoProc && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                    <Loader2 className="w-3 h-3 animate-spin" /> Auto-processing…
                  </span>
                )}
                {result?.success && !isAutoProc && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-green-600 font-semibold">
                    <CheckCircle className="w-3 h-3" /> Processed
                  </span>
                )}
              </div>

              <div className="p-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {email.folder && <Badge color="gray"><FolderOpen className="w-3 h-3 mr-1" />{email.folder}</Badge>}
                      {!email.isRead && <Badge color="indigo">Unread</Badge>}
                      {email.hasAttachments && <Badge color="amber"><Paperclip className="w-3 h-3 mr-1" />Attachment</Badge>}
                      {result?.error && <Badge color="red"><AlertCircle className="w-3 h-3 mr-1" />Error</Badge>}
                    </div>
                    <p className={`text-sm truncate ${!email.isRead ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                      {email.subject || '(no subject)'}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                      <span className="font-medium text-slate-600">{email.fromName || email.from}</span>
                      {email.fromName && <span>{email.from}</span>}
                      {email.to.length > 0 && <span>→ {email.to.slice(0, 2).join(', ')}{email.to.length > 2 ? ` +${email.to.length - 2}` : ''}</span>}
                      <span className="flex items-center gap-1 ml-auto flex-shrink-0">
                        <Clock className="w-3 h-3" />
                        {new Date(email.date).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => setRawBodyId(showRaw ? null : email.graphId)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="Preview body">
                      {showRaw ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    {result?.success && bookingRef && (
                      <Button size="sm" variant="secondary" icon={<ExternalLink className="w-3.5 h-3.5" />}
                        onClick={() => router.push(`/dashboard/bookings/${bookingRef}`)}>
                        {bookingRef}
                      </Button>
                    )}
                    {result?.success && result.data?.extracted && (
                      <button onClick={() => setExpandedId(isExpanded ? null : email.graphId)}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          isExpanded ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        {isPnl ? <BarChart3 className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                        {isExpanded ? 'Hide' : 'Details'}
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Result summary row */}
                {result?.success && bookingRef && !isAutoProc && (
                  <div className={`mt-3 flex items-center gap-3 flex-wrap text-xs pt-3 border-t ${isPnl ? 'border-teal-100' : 'border-blue-100'}`}>
                    {/* Booking link */}
                    <button
                      onClick={() => router.push(`/dashboard/bookings/${bookingRef}`)}
                      className="flex items-center gap-1.5 font-bold text-slate-800 hover:text-brand-600 transition-colors"
                    >
                      <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                      {bookingRef}
                      <ExternalLink className="w-3 h-3 text-slate-400" />
                    </button>

                    {/* TQ-specific info */}
                    {!isPnl && result.data?.status !== 'existing' && (
                      <>
                        <span className="text-slate-400">|</span>
                        <span className="text-slate-500">{result.data?.isNew ? 'New booking' : 'Updated'}</span>
                        {(result.data?.agendaItems ?? 0) > 0 && (
                          <span className="text-indigo-600 font-medium">{result.data!.agendaItems} agenda items</span>
                        )}
                      </>
                    )}

                    {/* PNL-specific info */}
                    {isPnl && (
                      <>
                        <span className="text-slate-400">|</span>
                        {(result.data?.pnlLines ?? 0) > 0
                          ? <span className="text-teal-600 font-medium flex items-center gap-1"><BarChart3 className="w-3 h-3" />{result.data!.pnlLines} lines added</span>
                          : <span className="text-slate-500">PNL processed</span>
                        }
                        {result.data?.xlsxUsed && (
                          <span className="text-green-600 font-medium flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" />XLSX</span>
                        )}
                      </>
                    )}

                    {/* PNL Pending/Added pill (TQ emails only) */}
                    {!isPnl && <PnlPill status={pnlSt} />}

                    {/* View details link */}
                    {result.data?.extracted && (
                      <button onClick={() => setExpandedId(email.graphId)}
                        className="ml-auto text-blue-600 hover:underline flex items-center gap-1">
                        View extraction <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Auto-processing placeholder */}
                {isAutoProc && (
                  <div className="mt-3 pt-3 border-t border-amber-100 flex items-center gap-2 text-xs text-amber-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    Extracting booking data via GPT-4o and saving to database…
                  </div>
                )}

                {/* Raw body */}
                {showRaw && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <pre className="text-[11px] text-slate-600 bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed border border-slate-100">
                      {email.rawBody || '(empty body)'}
                    </pre>
                  </div>
                )}

                {/* Extraction detail panel */}
                {isExpanded && result?.success && result.data?.extracted && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    {isPnl ? (
                      <PNLExtraction data={result.data.extracted} bookingRef={result.data.bookingRef}
                        isNew={result.data.isNew} xlsxUsed={result.data.xlsxUsed ?? false} />
                    ) : (
                      <TQExtraction data={result.data.extracted} agendaItems={result.data.agendaItems} />
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

        {/* Footer timestamp */}
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
              {mailboxFilter === 'tq' ? `Checking ${TQ_EMAIL}…` :
               mailboxFilter === 'pnl' ? `Checking ${PNL_EMAIL}…` : 'Checking both mailboxes…'}
            </p>
          </Card>
        )}
      </div>
    </div>
  )
}
