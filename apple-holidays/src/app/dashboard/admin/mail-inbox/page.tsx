'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Mail, CheckCircle, AlertCircle, Loader2, ExternalLink,
  Clock, Paperclip, FolderOpen, WifiOff, Wifi,
  RefreshCw, ArrowRight, FileText, BarChart3, Users,
  ClipboardCheck, Inbox, Plane, Hotel, Phone,
  FileSpreadsheet, Link2, ChevronDown, ChevronUp,
  Eye, Info, Zap, CalendarClock, Merge, HourglassIcon,
  Search, X,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Database } from 'lucide-react'
import type { ProcessedEmail } from '@/lib/mail-processor'
import DbMailboxView from './db-mailbox-view'

// ── Types ─────────────────────────────────────────────────────────────────────

type MailboxFilter = 'all' | 'tq' | 'pnl'

interface EmailWithMailbox extends ProcessedEmail {
  mailboxKind: 'TOUR_CONFIRMATION' | 'PNL'
  mailboxUser: string
}

interface MailboxSubStatus {
  user: string; kind: 'TOUR_CONFIRMATION' | 'PNL'
  active: boolean; id: string | null; expiry: string | null; source?: string
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
  bookingCreatedAt?: string | null
  processedAt?: string | null
}

interface PnlStatus { hasPNL: boolean; lineCount: number; checking: boolean }
interface MailSettings {
  lessCreditMode: boolean
  recentMailWindowMinutes: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL    = 30_000
const TQ_EMAIL         = 'confirm.booking@aahaas.com'
const PNL_EMAIL        = 'accounts.payable@aahaas.com'

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
function fmtTs(d?: string | null) {
  if (!d) return null
  try {
    return new Date(d).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return null }
}
function usd(n: number) { return n > 0 ? `$${n.toFixed(2)}` : '—' }

function mailboxLabel(user: string) {
  if (user === TQ_EMAIL)  return { label: 'TQ',   color: 'bg-blue-100 text-blue-700 border-blue-200' }
  if (user === PNL_EMAIL) return { label: 'PNL',  color: 'bg-teal-100 text-teal-700 border-teal-200' }
  return                         { label: user.split('@')[0], color: 'bg-slate-100 text-slate-600 border-slate-200' }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PnlPill({ status, waitingTourNo }: { status: PnlStatus | undefined; waitingTourNo?: string }) {
  if (status?.hasPNL) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">
        <CheckCircle className="w-2.5 h-2.5" /> PNL Added · {status.lineCount} lines
      </span>
    )
  }
  if (waitingTourNo) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-100 text-orange-700">
        <Clock className="w-2.5 h-2.5" /> PNL Waiting — Tour No {waitingTourNo}
      </span>
    )
  }
  if (!status || status.checking) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
        <Loader2 className="w-2.5 h-2.5 animate-spin" /> Checking PNL…
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

  const [mainView, setMainView]           = useState<'live' | 'db'>('live')
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
  const [searchQuery, setSearchQuery]     = useState('')
  const [pnlStatusMap, setPnlStatusMap]   = useState<Map<string, PnlStatus>>(new Map())
  const [autoProcessingIds, setAutoProcessingIds] = useState<Set<string>>(new Set())
  const [mailSettings, setMailSettings]   = useState<MailSettings | null>(null)
  const [inboxSynced, setInboxSynced]     = useState(false)
  const [savingLessCreditMode, setSavingLessCreditMode] = useState(false)

  // Refs for queue management (avoid stale closures)
  const resultsRef         = useRef(results)
  const emailsRef          = useRef(emails)
  const pnlStatusMapRef    = useRef(pnlStatusMap)

  useEffect(() => { resultsRef.current   = results      }, [results])
  useEffect(() => { emailsRef.current    = emails       }, [emails])
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

  // processOneRef allows the callback to schedule sibling-email retries without
  // a circular useCallback dependency (PNL_WAITING → retry after TQ processed).
  const processOneRef = useRef<(email: EmailWithMailbox) => void>(null as unknown as (email: EmailWithMailbox) => void)

  const processOne = useCallback(async (email: EmailWithMailbox) => {
    setAutoProcessingIds(prev => new Set(Array.from(prev).concat([email.graphId])))
    const isPnlEmail = email.mailboxKind === 'PNL'
    try {
      const res  = await fetch('/api/mail/process', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawBody:     email.rawBody,
          subject:     email.subject,
          emailType:   isPnlEmail ? 'PNL' : 'TOUR_CONFIRMATION',
          graphId:     email.graphId,
          mailboxUser: email.mailboxUser,
          bodyHtml:    email.bodyHtml,
          date:        email.date,
          folder:      email.folder,
          from:        email.from,
          fromName:    email.fromName,
          to:          email.to,
          cc:          email.cc,
          isRead:      email.isRead,
          hasAttachments: email.hasAttachments,
          importance:  email.importance,
          conversationId: email.conversationId,
          uid:         email.uid,
        }),
      })
      const json = await res.json()
      if (json.success) {
        const data = json.data as ProcessResult
        setResults(m => new Map(m).set(email.graphId, { success: true, data }))

        if (data.status === 'PNL_WAITING') {
          // PNL arrived before its TQ — backend will retry automatically via cron
          toast.info(
            `Tour No #${data.bookingRef} received — backend will link when TQ arrives`,
            { duration: 5000 },
          )
        } else if (isPnlEmail) {
          // PNL successfully linked to an existing booking
          setPnlStatusMap(prev => new Map(prev).set(data.bookingRef, {
            hasPNL: data.pnlLines > 0, lineCount: data.pnlLines, checking: false,
          }))
          if (data.pnlLines > 0) {
            toast.success(`PNL added to ${data.bookingRef} — ${data.pnlLines} lines`, { duration: 4000 })
          }
        } else {
          // TQ processed — check PNL status then retry any waiting PNLs shown in this view
          checkBookingPnl(data.bookingRef)
          const numericRef = data.bookingRef.replace(/[^0-9]/g, '')
          if (numericRef.length >= 4) {
            const waitingPnls = emailsRef.current.filter(e => {
              const r = resultsRef.current.get(e.graphId)
              return r?.success &&
                     r.data?.status === 'PNL_WAITING' &&
                     (r.data.bookingRef ?? '').replace(/[^0-9]/g, '') === numericRef
            })
            for (const pnlEmail of waitingPnls) {
              setResults(m => { const n = new Map(m); n.delete(pnlEmail.graphId); return n })
              // Fire-and-forget: retry the waiting PNL now that its TQ booking exists
              setTimeout(() => processOneRef.current(pnlEmail), 500)
            }
            if (waitingPnls.length > 0) {
              toast.info(
                `Linking ${waitingPnls.length} waiting PNL(s) to ${data.bookingRef}…`,
                { duration: 3000 },
              )
            }
          }
        }
      } else {
        setResults(m => new Map(m).set(email.graphId, { success: false, error: json.error as string }))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Processing failed'
      setResults(m => new Map(m).set(email.graphId, { success: false, error: msg }))
    } finally {
      setAutoProcessingIds(prev => { const n = new Set(prev); n.delete(email.graphId); return n })
    }
  }, [checkBookingPnl])

  // Keep ref in sync so PNL retry closure always calls the latest version
  useEffect(() => { processOneRef.current = processOne }, [processOne])

  // ── Load emails ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/mail/subscribe')
      .then(r => r.json())
      .then(j => { if (j.success) setSubStatus(j.data as SubStatus) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/mail/settings')
      .then(r => r.json())
      .then(j => {
        if (j.success && j.data) setMailSettings(j.data as MailSettings)
      })
      .catch(() => {})
  }, [])

  const toggleLessCreditMode = useCallback(async () => {
    if (!mailSettings) return
    setSavingLessCreditMode(true)
    try {
      const res = await fetch('/api/mail/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessCreditMode: !mailSettings.lessCreditMode }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error as string)
      setMailSettings(json.data as MailSettings)
      toast.success('Mail mode updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update mail mode')
    } finally {
      setSavingLessCreditMode(false)
    }
  }, [mailSettings])

  const loadEmails = useCallback(async (silent = false) => {
    if (!silent) setFetching(true)
    else setPolling(true)
    setInboxSynced(false)
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
          const alreadyProcessed = ckj.data as { graphId: string; bookingRef: string; processedAt: string | null; bookingCreatedAt?: string | null }[]

          setResults(prev => {
            const next = new Map(prev)
            for (const { graphId, bookingRef, processedAt, bookingCreatedAt } of alreadyProcessed) {
              if (!next.has(graphId)) {
                next.set(graphId, { success: true, data: { bookingRef, bookingId: '', isNew: false, pnlLines: 0, agendaItems: 0, status: 'existing', processedAt, bookingCreatedAt } })
              }
              // No auto-queue: backend processes all emails automatically
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
      setInboxSynced(true)
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

  const tqEmails       = emails.filter(e => e.mailboxKind === 'TOUR_CONFIRMATION' && e.type !== 'PNL')
  const pnlEmails      = emails.filter(e => e.mailboxKind === 'PNL' || e.type === 'PNL')
  const processedCount = Array.from(results.values()).filter(r => r.success && r.data?.status !== 'PNL_WAITING').length
  const waitingCount   = Array.from(results.values()).filter(r => r.success && r.data?.status === 'PNL_WAITING').length
  const autoCount      = autoProcessingIds.size
  const lessCreditMode = mailSettings?.lessCreditMode ?? false

  // Search filter — applied on top of the mailbox tab filter
  const displayEmails = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return emails
    return emails.filter(email => {
      if (email.subject.toLowerCase().includes(q)) return true
      if (email.from.toLowerCase().includes(q)) return true
      if (email.fromName.toLowerCase().includes(q)) return true
      const ref = results.get(email.graphId)?.data?.bookingRef ?? ''
      if (ref.toLowerCase().includes(q)) return true
      // also match Tour No format: "#469083" → search "469083"
      const numericRef = ref.replace(/[^0-9]/g, '')
      if (numericRef && numericRef.includes(q.replace(/[^0-9]/g, ''))) return true
      return false
    })
  }, [emails, searchQuery, results])

  // Merged = TQ bookings that also have a PNL attached
  const mergedCount = useMemo(() => {
    return Array.from(results.entries()).filter(([graphId, r]) => {
      if (!r.success || !r.data?.bookingRef) return false
      const email = emails.find(e => e.graphId === graphId)
      if (email?.mailboxKind !== 'TOUR_CONFIRMATION') return false
      const pnlSt = pnlStatusMap.get(r.data.bookingRef)
      return pnlSt?.hasPNL === true
    }).length
  }, [results, emails, pnlStatusMap])

  // TQ bookings waiting for PNL (processed TQ, no PNL yet)
  const waitingForPnlCount = useMemo(() => {
    return Array.from(results.entries()).filter(([graphId, r]) => {
      if (!r.success || !r.data?.bookingRef) return false
      const email = emails.find(e => e.graphId === graphId)
      if (email?.mailboxKind !== 'TOUR_CONFIRMATION') return false
      const pnlSt = pnlStatusMap.get(r.data.bookingRef)
      return !pnlSt?.hasPNL
    }).length
  }, [results, emails, pnlStatusMap])

  // Map: TQ numeric ref → PNL Tour No display string ("#469083")
  const waitingPnlMap = useMemo(() => {
    const map = new Map<string, string>()
    Array.from(results.values()).forEach(result => {
      if (result.success && result.data?.status === 'PNL_WAITING' && result.data.bookingRef) {
        const num = result.data.bookingRef.replace(/[^0-9]/g, '')
        if (num.length >= 4) map.set(num, `#${num}`)
      }
    })
    return map
  }, [results])

  // Map: bookingRef numeric → { mailboxUser, processedAt } for PNL emails
  const pnlLinkMap = useMemo(() => {
    const map = new Map<string, { mailboxUser: string; processedAt: string | null | undefined; pnlLines: number }>()
    Array.from(results.entries()).forEach(([graphId, r]) => {
      if (!r.success || !r.data?.bookingRef) return
      const email = emails.find(e => e.graphId === graphId)
      if (!email || email.mailboxKind !== 'PNL') return
      const num = r.data.bookingRef.replace(/[^0-9]/g, '')
      if (num.length >= 4) {
        map.set(num, { mailboxUser: email.mailboxUser, processedAt: r.data.processedAt, pnlLines: r.data.pnlLines })
      }
    })
    return map
  }, [results, emails])

  const tqSub  = subStatus?.mailboxes?.find(m => m.kind === 'TOUR_CONFIRMATION')
  const pnlSub = subStatus?.mailboxes?.find(m => m.kind === 'PNL')

  return (
    <div>
      <Header
        title="Mail Inbox"
        subtitle={
          mailboxFilter === 'tq'  ? `TQ — ${TQ_EMAIL}` :
          mailboxFilter === 'pnl' ? `PNL — ${PNL_EMAIL}` :
          `${TQ_EMAIL}  +  ${PNL_EMAIL}`
        }
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            {lessCreditMode && (
              <Badge color="amber" className="text-[10px]">
                Less Credit Mode · backend processes recent mail only
              </Badge>
            )}
            <Button
              size="sm"
              variant={lessCreditMode ? 'outline' : 'secondary'}
              loading={savingLessCreditMode}
              onClick={toggleLessCreditMode}
            >
              {lessCreditMode ? 'Less Credit On' : 'Less Credit Off'}
            </Button>
            <select value={folder} onChange={e => setFolder(e.target.value as 'all' | 'inbox')}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              <option value="all">All Folders</option>
              <option value="inbox">Inbox Only</option>
            </select>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))}
              className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700">
              {[20, 50, 100, 200,1000,10000,100000].map(n => <option key={n} value={n}>{n} emails</option>)}
            </select>
            <button onClick={() => loadEmails(false)} disabled={fetching}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
              <RefreshCw className={`w-4 h-4 ${fetching || polling ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      />

      <div className="p-6  space-y-4">

        {/* ── View switcher ─────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          <button
            onClick={() => setMainView('live')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              mainView === 'live' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Mail className="w-4 h-4" />
            Live Processing
          </button>
          <button
            onClick={() => setMainView('db')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              mainView === 'db' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Database className="w-4 h-4" />
            DB Mailbox Store
          </button>
        </div>

        {/* ── DB Mailbox view ───────────────────────────────────────────── */}
        {mainView === 'db' && <DbMailboxView />}

        {/* ── Live view (existing content) ──────────────────────────────── */}
        {mainView === 'live' && <>

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
          {([
            {
              label: 'Travel Quotation',
              email: TQ_EMAIL,
              active: tqSub?.active ?? false,
              badge: tqSub?.active ? 'Webhook Live' : 'Cron 5min',
              color: tqSub?.active ? 'tq-live' : 'tq-cron',
            },
            {
              label: 'P&L — Payable',
              email: PNL_EMAIL,
              active: pnlSub?.active ?? true,
              badge: pnlSub?.active ? 'Webhook Live' : 'Graph Poll · 30s',
              color: 'pnl',
            },
          ] as { label: string; email: string; active: boolean; badge: string; color: string }[]).map(({ label, email, active, badge }) => (
            <Card key={email} className={`p-3 border ${active ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2.5">
                {active
                  ? <Wifi className="w-3.5 h-3.5 text-green-500 flex-shrink-0 animate-pulse" />
                  : <WifiOff className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-bold ${active ? 'text-green-800' : 'text-amber-800'}`}>{label}</span>
                    <Badge color={active ? 'green' : 'amber'} className="text-[9px]">{badge}</Badge>
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

        {/* ── Search ────────────────────────────────────────────────────── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search subject, sender, Tour Ref or Tour No…"
            className="w-full pl-9 pr-9 py-2.5 text-sm border border-slate-200 rounded-xl bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-all"
          />
          {searchQuery && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-400">
                {displayEmails.length} / {emails.length}
              </span>
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* ── Live Stats ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {/* Total */}
          <Card className="sm:col-span-1 p-3 text-center">
            <p className="text-2xl font-bold text-slate-700">{emails.length}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-0.5">Total Emails</p>
          </Card>
          {/* TQ */}
          <Card className="sm:col-span-1 p-3 text-center border-blue-200 bg-blue-50/40">
            <p className="text-2xl font-bold text-blue-600">{tqEmails.length}</p>
            <p className="text-[10px] text-blue-400 uppercase tracking-wider mt-0.5">TQ Received</p>
          </Card>
          {/* PNL */}
          <Card className="sm:col-span-1 p-3 text-center border-teal-200 bg-teal-50/40">
            <p className="text-2xl font-bold text-teal-600">{pnlEmails.length}</p>
            <p className="text-[10px] text-teal-400 uppercase tracking-wider mt-0.5">PNL Received</p>
          </Card>
          {/* Merged */}
          <Card className="sm:col-span-1 p-3 text-center border-green-200 bg-green-50/40">
            <div className="flex items-center justify-center gap-1">
              <Merge className="w-4 h-4 text-green-500" />
              <p className="text-2xl font-bold text-green-600">{mergedCount}</p>
            </div>
            <p className="text-[10px] text-green-500 uppercase tracking-wider mt-0.5">TQ + PNL Merged</p>
          </Card>
          {/* Waiting PNL */}
          <Card className={`sm:col-span-1 p-3 text-center ${waitingForPnlCount > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
            <div className="flex items-center justify-center gap-1">
              {waitingForPnlCount > 0 && <HourglassIcon className="w-4 h-4 text-amber-400 animate-pulse" />}
              <p className={`text-2xl font-bold ${waitingForPnlCount > 0 ? 'text-amber-500' : 'text-slate-400'}`}>{waitingForPnlCount}</p>
            </div>
            <p className={`text-[10px] uppercase tracking-wider mt-0.5 ${waitingForPnlCount > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
              Waiting PNL
            </p>
          </Card>
          {/* Waiting TQ */}
          <Card className={`sm:col-span-1 p-3 text-center ${waitingCount > 0 ? 'border-orange-200 bg-orange-50/40' : 'border-slate-200'}`}>
            <div className="flex items-center justify-center gap-1">
              {waitingCount > 0 && <Clock className="w-4 h-4 text-orange-400 animate-pulse" />}
              {autoCount > 0
                ? <span className="flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin text-amber-500" /><span className="text-2xl font-bold text-amber-500">{autoCount}</span></span>
                : <p className={`text-2xl font-bold ${waitingCount > 0 ? 'text-orange-500' : 'text-slate-400'}`}>{waitingCount}</p>
              }
            </div>
            <p className={`text-[10px] uppercase tracking-wider mt-0.5 ${autoCount > 0 ? 'text-amber-400' : waitingCount > 0 ? 'text-orange-400' : 'text-slate-400'}`}>
              {autoCount > 0 ? 'Processing…' : 'Waiting TQ'}
            </p>
          </Card>
        </div>

        {/* ── Loading ───────────────────────────────────────────────────── */}
        {fetching && (
          <div className="flex items-center justify-center py-12 gap-3">
            <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
            <span className="text-sm text-slate-500">Connecting to Microsoft Graph…</span>
          </div>
        )}

        {/* ── Email Cards ───────────────────────────────────────────────── */}
        {!fetching && displayEmails.map(email => {
          const result       = results.get(email.graphId)
          const isAutoProc   = autoProcessingIds.has(email.graphId)
          const isExpanded   = expandedId === email.graphId
          const showRaw      = rawBodyId === email.graphId
          const isPnl        = email.mailboxKind === 'PNL'
          const bookingRef   = result?.data?.bookingRef
          const isWaiting    = result?.success && result.data?.status === 'PNL_WAITING'
          // For TQ cards: numeric part of booking ref used to look up waiting PNL
          const numericRef   = !isPnl && bookingRef ? bookingRef.replace(/[^0-9]/g, '') : ''
          const waitingTourNo = !isPnl && numericRef ? waitingPnlMap.get(numericRef) : undefined
          const pnlSt        = !isPnl && bookingRef ? pnlStatusMap.get(bookingRef) : undefined
          // Display Tour No for PNL cards: "#469083"
          const pnlTourNo    = isPnl && bookingRef ? `#${bookingRef.replace(/[^0-9]/g, '')}` : undefined

          return (
            <Card key={email.graphId} className={`overflow-hidden transition-all ${
              isAutoProc   ? 'border-amber-300 ring-1 ring-amber-200'  :
              isWaiting    ? 'border-orange-300 bg-orange-50/20'        :
              result?.success ? 'border-green-200 bg-green-50/20'      :
              result?.error   ? 'border-red-200'                        :
              !email.isRead   ? 'border-blue-200 bg-blue-50/20'         : ''
            }`}>

              {/* Mailbox strip */}
              <div className={`px-4 py-1.5 flex items-center gap-2 border-b ${
                isWaiting ? 'bg-orange-50 border-orange-100' :
                isPnl ? 'bg-teal-50 border-teal-100' : 'bg-blue-50 border-blue-100'
              }`}>
                <Mail className={`w-3 h-3 ${isWaiting ? 'text-orange-500' : isPnl ? 'text-teal-500' : 'text-blue-500'}`} />
                <span className={`text-[10px] font-mono font-semibold ${isWaiting ? 'text-orange-700' : isPnl ? 'text-teal-700' : 'text-blue-700'}`}>
                  {email.mailboxUser}
                </span>
                <Badge color={isWaiting ? 'amber' : isPnl ? 'teal' : 'blue'} className="text-[9px]">
                  {isWaiting ? 'Awaiting TQ' : isPnl ? 'P&L Mailbox' : 'TQ Mailbox'}
                </Badge>
                {isPnl && pnlTourNo && !isWaiting && (
                  <span className="text-[10px] font-mono text-teal-600 font-semibold">Tour No: {pnlTourNo}</span>
                )}
                {isWaiting && result?.data?.bookingRef && (
                  <span className="text-[10px] font-mono text-orange-700 font-semibold">
                    Tour No: #{result.data.bookingRef}
                  </span>
                )}
                {isAutoProc && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-600 font-semibold">
                    <Loader2 className="w-3 h-3 animate-spin" /> Auto-processing…
                  </span>
                )}
                {result?.success && !isAutoProc && !isWaiting && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-green-600 font-semibold">
                    <CheckCircle className="w-3 h-3" /> Processed
                  </span>
                )}
                {isWaiting && !isAutoProc && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-orange-600 font-semibold">
                    <Clock className="w-3 h-3" /> Waiting for TQ
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
                    {!result?.success && !isAutoProc && (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<Zap className="w-3.5 h-3.5" />}
                        onClick={() => processOne(email)}
                      >
                        Process now
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRawBodyId(showRaw ? null : email.graphId)}
                    >
                      {showRaw ? 'Hide mail' : 'Read mail'}
                    </Button>
                    {result?.success && bookingRef && !isWaiting && (
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

                {/* ── PNL Waiting banner ──────────────────────────────── */}
                {isWaiting && !isAutoProc && result?.data?.bookingRef && (
                  <div className="mt-3 rounded-lg bg-orange-50 border border-orange-200 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Clock className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-orange-800">PNL Received — Waiting for Travel Quotation</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 bg-orange-100 border border-orange-300 rounded px-2 py-0.5 text-[10px] font-mono font-bold text-orange-800">
                            <BarChart3 className="w-2.5 h-2.5" />
                            Tour No: #{result.data.bookingRef}
                          </span>
                          <ArrowRight className="w-3 h-3 text-orange-400 flex-shrink-0" />
                          <span className="inline-flex items-center gap-1 bg-slate-100 border border-slate-300 rounded px-2 py-0.5 text-[10px] font-mono text-slate-500">
                            <Mail className="w-2.5 h-2.5" />
                            Tour Ref: {result.data.bookingRef}CNTL / VN{result.data.bookingRef} (expected)
                          </span>
                        </div>
                        <p className="text-[10px] text-orange-600 mt-1.5">
                          Will auto-link when the matching Travel Quotation is processed.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Result summary row (non-waiting) ────────────────── */}
                {result?.success && bookingRef && !isAutoProc && !isWaiting && (
                  <div className={`mt-3 flex items-center gap-3 flex-wrap text-xs pt-3 border-t ${isPnl ? 'border-teal-100' : 'border-blue-100'}`}>

                    {/* PNL: show Tour No → Tour Ref linkage */}
                    {isPnl && pnlTourNo && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 rounded px-2 py-0.5 text-[10px] font-mono font-bold text-teal-700">
                          <BarChart3 className="w-2.5 h-2.5" />
                          Tour No: {pnlTourNo}
                        </span>
                        <Link2 className="w-3 h-3 text-slate-400" />
                        <button
                          onClick={() => router.push(`/dashboard/bookings/${bookingRef}`)}
                          className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-[10px] font-mono font-bold text-blue-700 hover:bg-blue-100 transition-colors"
                        >
                          <FileText className="w-2.5 h-2.5" />
                          Tour Ref: {bookingRef}
                          <ExternalLink className="w-2.5 h-2.5 text-blue-400" />
                        </button>
                      </div>
                    )}

                    {/* TQ: show Tour Ref prominently */}
                    {!isPnl && (
                      <button
                        onClick={() => router.push(`/dashboard/bookings/${bookingRef}`)}
                        className="flex items-center gap-1.5 font-bold text-slate-800 hover:text-brand-600 transition-colors"
                      >
                        <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                        Tour Ref: {bookingRef}
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </button>
                    )}

                    {/* TQ-specific extra info */}
                    {!isPnl && result.data?.status !== 'existing' && (
                      <>
                        <span className="text-slate-400">|</span>
                        <span className="text-slate-500">{result.data?.isNew ? 'New booking' : 'Updated'}</span>
                        {(result.data?.agendaItems ?? 0) > 0 && (
                          <span className="text-indigo-600 font-medium">{result.data!.agendaItems} agenda items</span>
                        )}
                      </>
                    )}

                    {/* PNL line count */}
                    {isPnl && (
                      <>
                        <span className="text-slate-400">|</span>
                        {(result.data?.pnlLines ?? 0) > 0
                          ? <span className="text-teal-600 font-medium flex items-center gap-1"><BarChart3 className="w-3 h-3" />{result.data!.pnlLines} lines added</span>
                          : <span className="text-slate-500">PNL merged</span>
                        }
                        {result.data?.xlsxUsed && (
                          <span className="text-green-600 font-medium flex items-center gap-1"><FileSpreadsheet className="w-3 h-3" />XLSX</span>
                        )}
                      </>
                    )}

                    {/* PNL pill — TQ cards only, shows Added / Waiting / Pending */}
                    {!isPnl && <PnlPill status={pnlSt} waitingTourNo={waitingTourNo} />}

                    {/* View extraction details */}
                    {result.data?.extracted && (
                      <button onClick={() => setExpandedId(email.graphId)}
                        className="ml-auto text-blue-600 hover:underline flex items-center gap-1">
                        View extraction <ChevronDown className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* ── Timestamp timeline ──────────────────────────────── */}
                {result?.success && bookingRef && !isAutoProc && !isWaiting && (() => {
                  const pnlLink = !isPnl && numericRef ? pnlLinkMap.get(numericRef) : null
                  const mbInfo  = mailboxLabel(email.mailboxUser)
                  const tsTQ    = fmtTs(email.date)
                  const tsBook  = fmtTs(result.data?.bookingCreatedAt)
                  const tsDone  = fmtTs(result.data?.processedAt)
                  const tsPNL   = isPnl ? fmtTs(email.date) : fmtTs(pnlLink?.processedAt)
                  return (
                    <div className="mt-3 pt-2 border-t border-slate-100">
                      {/* Which mailbox */}
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold ${mbInfo.color}`}>
                          <Mail className="w-2.5 h-2.5" />{mbInfo.label}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400">{email.mailboxUser}</span>
                        {/* TQ card: show which PNL mailbox linked */}
                        {!isPnl && pnlLink && (
                          <>
                            <ArrowRight className="w-3 h-3 text-slate-300" />
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[9px] font-bold ${mailboxLabel(pnlLink.mailboxUser).color}`}>
                              <BarChart3 className="w-2.5 h-2.5" />{mailboxLabel(pnlLink.mailboxUser).label}
                            </span>
                            <span className="text-[9px] font-mono text-slate-400">{pnlLink.mailboxUser}</span>
                            {pnlLink.pnlLines > 0 && (
                              <span className="text-[9px] font-semibold text-teal-600">{pnlLink.pnlLines} lines</span>
                            )}
                          </>
                        )}
                      </div>
                      {/* Timeline dots */}
                      <div className="flex items-start gap-0 overflow-x-auto pb-1">
                        {([
                          { icon: <Mail className="w-3 h-3" />,          label: isPnl ? 'PNL Received' : 'TQ Received',  ts: isPnl ? tsPNL : tsTQ,   dot: 'bg-blue-500'  },
                          { icon: <CalendarClock className="w-3 h-3" />, label: 'Booking Created',                        ts: tsBook,                   dot: 'bg-indigo-500' },
                          ...(!isPnl ? [{ icon: <BarChart3 className="w-3 h-3" />, label: 'PNL Added',    ts: tsPNL,  dot: 'bg-teal-500'  }] : []),
                          { icon: <CheckCircle className="w-3 h-3" />,   label: isPnl ? 'PNL Merged' : 'Processed',       ts: tsDone,                   dot: 'bg-green-500' },
                        ] as { icon: React.ReactNode; label: string; ts: string | null; dot: string }[])
                          .map((step, idx, arr) => (
                            <div key={idx} className="flex items-center flex-shrink-0">
                              <div className="flex flex-col items-center gap-0.5 min-w-[80px]">
                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white ${step.ts ? step.dot : 'bg-slate-200'}`}>
                                  {step.ts ? step.icon : <Clock className="w-3 h-3 text-slate-400" />}
                                </div>
                                <p className="text-[9px] font-semibold text-slate-500 text-center leading-tight mt-0.5">{step.label}</p>
                                <p className="text-[8px] text-slate-400 text-center leading-tight">{step.ts ?? '—'}</p>
                              </div>
                              {idx < arr.length - 1 && (
                                <div className={`h-0.5 w-6 flex-shrink-0 mb-4 ${step.ts ? 'bg-slate-300' : 'bg-slate-100'}`} />
                              )}
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )
                })()}

                {/* Auto-processing placeholder */}
                {isAutoProc && (
                  <div className="mt-3 pt-3 border-t border-amber-100 flex items-center gap-2 text-xs text-amber-700">
                    <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                    {isPnl ? 'Matching PNL to Travel Quotation via Tour No…' : 'Extracting booking data via GPT-4o and saving to database…'}
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
        {!fetching && displayEmails.length === 0 && (
          <Card className="p-12 text-center">
            {searchQuery ? (
              <>
                <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No results for &ldquo;{searchQuery}&rdquo;</p>
                <p className="text-slate-400 text-sm mt-1">Try a different subject, sender name, or Tour Ref</p>
                <button onClick={() => setSearchQuery('')} className="mt-3 text-xs text-blue-500 hover:text-blue-700 font-medium">
                  Clear search
                </button>
              </>
            ) : (
              <>
                <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No emails found</p>
                <p className="text-slate-400 text-sm mt-1">
                  {mailboxFilter === 'tq'  ? `Checking ${TQ_EMAIL}…` :
                   mailboxFilter === 'pnl' ? `Checking ${PNL_EMAIL}…` : 'Checking all mailboxes…'}
                </p>
              </>
            )}
          </Card>
        )}

        </> /* end live view */}

      </div>
    </div>
  )
}
