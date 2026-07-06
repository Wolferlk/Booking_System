'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Phone, Bot, Loader2, RefreshCw,
  ChevronDown, ChevronUp, Mail, Send, Plus, X, AlertCircle,
  MessageCircle, User, Sparkles, Info, Eye, Wand2,
  CheckCircle2, Star, BarChart2,
} from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'

// ─── Types ─────────────────────────────────────────────────────────────────────
interface FeedbackRecord {
  id: number
  day_no?: number | null
  call_date?: string | null
  created_at: string
  sentiment?: string | null
  highlights?: string | null
  hotel_ok?: string | null
  meals_ok?: string | null
  driver_ok?: string | null
  vehicle_ok?: string | null
  issues?: string | null
  summary?: string | null
  transcript?: TranscriptTurn[] | string | null
}
interface TranscriptTurn { role?: string; speaker?: string; text?: string; message?: string; content?: string }
interface ScheduleRecord { id: number; day_no: number; call_date: string; status: string; attempts: number; day_brief?: string | null }
interface ServiceRecord  { id: number; booking_ref: string; status: string; customer_name?: string | null; call_phone: string }
interface BookingInfo    { agentEmail?: string | null; contactEmail?: string | null; agent?: string | null; arrivalDate?: string | null; departureDate?: string | null }
interface AIFeedbackResult {
  headline: string; opening: string; dayHighlights: string
  issuesSummary: string; closingRemark: string
  overallScore: string; keyThemes: string[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  answered:'bg-emerald-100 text-emerald-700 border-emerald-200', done:'bg-emerald-100 text-emerald-700 border-emerald-200',
  pending: 'bg-orange-50 text-orange-600 border-orange-200',    missed:'bg-red-100 text-red-500 border-red-200',
  failed:  'bg-red-100 text-red-600 border-red-200',            skipped:'bg-slate-100 text-slate-400 border-slate-200',
  active:  'bg-violet-100 text-violet-700 border-violet-200',   completed:'bg-slate-100 text-slate-500 border-slate-200',
  cancelled:'bg-red-100 text-red-600 border-red-200',
}
const SENTIMENT_EMOJI: Record<string, string> = { positive:'😊', happy:'😊', neutral:'😐', negative:'😞' }
const SENTIMENT_COLOR: Record<string, string> = { positive:'text-emerald-600', happy:'text-emerald-600', neutral:'text-slate-500', negative:'text-red-500' }

function sbadge(s: string) {
  return `inline-flex items-center border font-bold rounded-full text-[9px] px-1.5 py-0.5 ${STATUS_BADGE[s] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`
}
function ratingChip(v?: string | null) {
  if (!v) return <span className="text-slate-300 text-xs">—</span>
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${v === 'good' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : v === 'bad' ? 'bg-red-50 text-red-500 border-red-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{v.toUpperCase()}</span>
}
function fmtDate(iso: string) {
  try { return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-GB', { weekday: 'short', day:'2-digit', month:'short' }) } catch { return iso }
}
function normaliseTranscript(raw: FeedbackRecord['transcript']) {
  if (!raw) return []
  if (Array.isArray(raw)) return (raw as TranscriptTurn[]).map(t => {
    const r = (t.role ?? t.speaker ?? '').toLowerCase()
    const text = t.text ?? t.message ?? t.content ?? ''
    if (['ai','agent','bot','assistant'].includes(r)) return { speaker: 'agent' as const, text }
    if (['user','customer','human','passenger','caller'].includes(r)) return { speaker: 'customer' as const, text }
    return { speaker: 'system' as const, text }
  }).filter(l => l.text)
  return String(raw).split('\n').filter(Boolean).map(line => {
    if (/^(agent|bot|ai)\s*:/i.test(line)) return { speaker: 'agent' as const, text: line.replace(/^[^:]+:\s*/i,'') }
    if (/^(customer|user|human)\s*:/i.test(line)) return { speaker: 'customer' as const, text: line.replace(/^[^:]+:\s*/i,'') }
    return { speaker: 'system' as const, text: line }
  })
}

function TranscriptBubbles({ transcript }: { transcript: FeedbackRecord['transcript'] }) {
  const lines = normaliseTranscript(transcript)
  if (!lines.length) return <p className="text-[11px] text-slate-400 italic">No transcript</p>
  return (
    <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1 mt-2">
      {lines.map((l, i) =>
        l.speaker === 'system' ? (
          <p key={i} className="text-[10px] text-slate-400 italic text-center">{l.text}</p>
        ) : l.speaker === 'agent' ? (
          <div key={i} className="flex gap-1.5 items-start">
            <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot className="w-2.5 h-2.5 text-white" /></div>
            <div className="bg-violet-50 border border-violet-100 rounded-xl rounded-tl-sm px-2.5 py-1.5 max-w-[82%]"><p className="text-xs text-slate-700 leading-relaxed">{l.text}</p></div>
          </div>
        ) : (
          <div key={i} className="flex gap-1.5 items-start flex-row-reverse">
            <div className="w-4 h-4 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5"><User className="w-2.5 h-2.5 text-white" /></div>
            <div className="bg-slate-800 rounded-xl rounded-tr-sm px-2.5 py-1.5 max-w-[82%]"><p className="text-xs text-white leading-relaxed">{l.text}</p></div>
          </div>
        )
      )}
    </div>
  )
}

// ─── Main modal ────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
  bookingRef: string
  bookingInfo: { agentEmail?: string | null; contactEmail?: string | null; agent?: string | null; arrivalDate?: string | null; departureDate?: string | null }
  testMode: boolean
  testEmail1: string
  testEmail2: string
}

export default function AICallsFeedbackModal({ open, onClose, bookingRef, bookingInfo, testMode, testEmail1, testEmail2 }: Props) {
  const [loading, setLoading]     = useState(false)
  const [service, setService]     = useState<ServiceRecord | null>(null)
  const [feedback, setFeedback]   = useState<FeedbackRecord[]>([])
  const [schedule, setSchedule]   = useState<ScheduleRecord[]>([])
  const [bookingMeta, setBookingMeta] = useState<BookingInfo>({})
  const [expanded, setExpanded]   = useState<number|null>(null)
  const [view, setView]           = useState<'daytable'|'feedbackonly'>('daytable')

  // AI generation
  const [generating, setGenerating] = useState(false)
  const [aiNarrative, setAiNarrative] = useState<AIFeedbackResult | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // Email send
  const [sendOpen, setSendOpen]   = useState(false)
  const [emailTo, setEmailTo]     = useState('')
  const [ccInput, setCcInput]     = useState('')
  const [ccList, setCcList]       = useState<string[]>([])
  const [sending, setSending]     = useState(false)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ai-feedback-summary`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed')
      const d = json.data as { service: ServiceRecord|null; feedback: FeedbackRecord[]; schedule: ScheduleRecord[]; booking: BookingInfo }
      setService(d.service)
      setFeedback([...d.feedback].sort((a,b) => (a.day_no ?? 0) - (b.day_no ?? 0)))
      setSchedule([...d.schedule].sort((a,b) => a.day_no - b.day_no))
      setBookingMeta(d.booking)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Load failed') }
    finally { setLoading(false) }
  }, [open, bookingRef])

  useEffect(() => { if (open) load() }, [open, load])

  // Pre-fill email when send panel opens
  useEffect(() => {
    if (!sendOpen) return
    const agent   = bookingInfo.agentEmail ?? bookingMeta.agentEmail ?? ''
    const contact = bookingInfo.contactEmail ?? bookingMeta.contactEmail ?? ''
    if (testMode) { setEmailTo(testEmail1); setCcList([testEmail2]) }
    else {
      setEmailTo(agent)
      setCcList(contact && contact !== agent ? [contact] : [])
    }
  }, [sendOpen, testMode, testEmail1, testEmail2, bookingInfo, bookingMeta])

  function addCc() {
    const e = ccInput.trim().toLowerCase()
    if (!e.includes('@')) { toast.error('Enter a valid email'); return }
    if (!ccList.includes(e)) setCcList(c => [...c, e])
    setCcInput('')
  }

  // ── Generate AI narrative ──────────────────────────────────────────────────
  async function generateNarrative() {
    setGenerating(true)
    setPreviewOpen(false)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/ai-feedback-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Generation failed')
      setAiNarrative(json.data.aiNarrative)
      setPreviewHtml(json.data.previewHtml)
      setPreviewOpen(true)
      toast.success('AI narrative generated ✓')
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Generation failed') }
    finally { setGenerating(false) }
  }

  // ── Send email ─────────────────────────────────────────────────────────────
  async function sendSummary() {
    if (!emailTo.trim()) { toast.error('No recipient email'); return }
    setSending(true)
    try {
      const body: Record<string, unknown> = { action: 'send', extraCc: ccList.filter(Boolean) }
      if (testMode)             body.agentEmailOverride = testEmail1
      else if (emailTo !== (bookingMeta.agentEmail ?? bookingInfo.agentEmail ?? ''))
        body.agentEmailOverride = emailTo
      if (aiNarrative)          body.aiNarrative = aiNarrative

      const res  = await fetch(`/api/bookings/${bookingRef}/ai-feedback-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Send failed')
      toast.success('Feedback summary sent to agent ✓')
      setSendOpen(false)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Send failed') }
    finally { setSending(false) }
  }

  // ── Derived stats ──────────────────────────────────────────────────────────
  const answered = schedule.filter(s => s.status === 'answered' || s.status === 'done').length
  const pending  = schedule.filter(s => s.status === 'pending').length
  const missed   = schedule.filter(s => s.status === 'missed' || s.status === 'failed').length
  const sentimentCounts = feedback.reduce<Record<string,number>>((a, f) => { if (f.sentiment) a[f.sentiment] = (a[f.sentiment]??0)+1; return a }, {})
  const topSentiment    = Object.entries(sentimentCounts).sort((a,b) => b[1]-a[1])[0]?.[0]
  const afterDeparture  = (() => { const d = bookingInfo.departureDate ?? bookingMeta.departureDate; return d ? new Date(d) < new Date() : false })()

  if (!open) return null

  return (
    <Modal open={open} onClose={onClose} title="" size="2xl">
      {/* Gradient header */}
      <div className="-mx-6 -mt-4 mb-5 bg-gradient-to-r from-violet-700 via-indigo-600 to-blue-600 px-6 py-5 rounded-t-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                AI Calls &amp; Feedback
                {testMode && <span className="text-[9px] bg-amber-400 text-amber-900 font-bold px-2 py-0.5 rounded-full">TEST MODE</span>}
              </h2>
              <p className="text-[11px] text-violet-200 mt-0.5">
                {bookingRef} · {service ? <span className={`font-semibold ${service.status === 'active' ? 'text-emerald-300' : 'text-slate-300'}`}>{service.status.toUpperCase()}</span> : 'Not registered'}
              </p>
            </div>
          </div>
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-violet-500 animate-spin" /></div>
      ) : !service ? (
        <div className="text-center py-12 space-y-2">
          <Phone className="w-10 h-10 text-slate-200 mx-auto" />
          <p className="text-slate-500 font-medium">No AI call service registered for this booking</p>
          <p className="text-slate-400 text-xs">Go to AI Call Bot → Setup to register this booking for automated calls</p>
        </div>
      ) : (
        <div className="space-y-5">

          {/* ── Stats strip ── */}
          <div className="grid grid-cols-5 gap-2">
            {[
              { label:'Total',    value:schedule.length, color:'text-violet-600',  bg:'bg-violet-50',  border:'border-violet-100' },
              { label:'Answered', value:answered,        color:'text-emerald-600', bg:'bg-emerald-50', border:'border-emerald-100' },
              { label:'Pending',  value:pending,         color:'text-orange-500',  bg:'bg-orange-50',  border:'border-orange-100' },
              { label:'Missed',   value:missed,          color:'text-red-500',     bg:'bg-red-50',     border:'border-red-100' },
              { label:'Feedback', value:feedback.length, color:'text-blue-600',    bg:'bg-blue-50',    border:'border-blue-100' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} border ${s.border} rounded-xl p-3 text-center`}>
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-[9px] text-slate-400 uppercase tracking-wide font-semibold mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* ── Top sentiment ── */}
          {topSentiment && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-50 border border-violet-100 rounded-xl">
              <Sparkles className="w-4 h-4 text-violet-500 flex-shrink-0" />
              <p className="text-sm text-violet-800 font-medium">
                Overall: <strong className={SENTIMENT_COLOR[topSentiment]}>{SENTIMENT_EMOJI[topSentiment]} {topSentiment}</strong>
                <span className="text-slate-400 font-normal text-xs ml-2">
                  {Object.entries(sentimentCounts).map(([k,v]) => `${SENTIMENT_EMOJI[k]??k} ×${v}`).join(' · ')}
                </span>
              </p>
              {afterDeparture && (
                <span className="ml-auto flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg flex-shrink-0">
                  <Info className="w-3 h-3" /> Trip ended
                </span>
              )}
            </div>
          )}

          {/* ── AI Narrative result card ── */}
          {aiNarrative && (
            <div className="bg-gradient-to-br from-violet-50 to-indigo-50 border border-violet-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide flex items-center gap-1 mb-1.5"><Sparkles className="w-3 h-3" /> AI Generated Narrative</p>
                  {aiNarrative.overallScore && <span className="inline-block bg-violet-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full">{aiNarrative.overallScore}</span>}
                </div>
                <button onClick={() => setPreviewOpen(!previewOpen)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold flex-shrink-0 mt-0.5">
                  <Eye className="w-3.5 h-3.5" /> {previewOpen ? 'Hide' : 'View'} Preview
                </button>
              </div>

              {aiNarrative.headline && <h3 className="text-sm font-bold text-indigo-900 leading-snug">{aiNarrative.headline}</h3>}
              {aiNarrative.opening && <p className="text-xs text-slate-600 leading-relaxed">{aiNarrative.opening}</p>}
              {aiNarrative.dayHighlights && (
                <div className="bg-emerald-50 border-l-2 border-emerald-400 rounded-r-xl px-3 py-2">
                  <p className="text-xs text-slate-700 leading-relaxed">{aiNarrative.dayHighlights}</p>
                </div>
              )}
              {aiNarrative.issuesSummary && (
                <div className="bg-red-50 border-l-2 border-red-400 rounded-r-xl px-3 py-2">
                  <p className="text-xs text-red-700 leading-relaxed"><strong>Issues:</strong> {aiNarrative.issuesSummary}</p>
                </div>
              )}
              {aiNarrative.keyThemes?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {aiNarrative.keyThemes.map((t, i) => (
                    <span key={i} className="text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full border border-violet-200">◆ {t}</span>
                  ))}
                </div>
              )}
              {aiNarrative.closingRemark && <p className="text-xs text-slate-500 italic">{aiNarrative.closingRemark}</p>}
            </div>
          )}

          {/* ── HTML preview iframe ── */}
          {previewOpen && previewHtml && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
                <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Email Preview</p>
                <button onClick={() => setPreviewOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
              </div>
              <iframe
                srcDoc={previewHtml}
                className="w-full border-0"
                style={{ height: '380px' }}
                title="Email Preview"
                sandbox="allow-same-origin"
              />
            </div>
          )}

          {/* ── View toggle + table ── */}
          <div className="flex items-center gap-2">
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              {([['daytable','Day-wise Table'], ['feedbackonly','Feedback Cards']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 text-xs font-semibold transition-colors ${view === v ? 'bg-violet-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>{label}</button>
              ))}
            </div>
          </div>

          {/* Day-wise table */}
          {view === 'daytable' && (
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Day','Date','Mood','Ratings','Summary'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                    ))}
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {schedule.map(s => {
                    const fb     = feedback.find(f => f.day_no === s.day_no)
                    const isToday= s.call_date === new Date().toISOString().slice(0,10)
                    const isExp  = expanded === s.id
                    return (
                      <>
                        <tr key={s.id} className={`border-b border-slate-100 last:border-0 transition-colors ${isToday ? 'bg-violet-50/40' : 'hover:bg-slate-50/80'}`}>
                          <td className="px-3 py-3">
                            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold ${isToday ? 'bg-violet-600 text-white' : s.status === 'answered' || s.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{s.day_no}</span>
                          </td>
                          <td className="px-3 py-3">
                            <p className="font-mono text-slate-600 text-[11px]">{fmtDate(s.call_date)}</p>
                            {isToday && <span className="text-[9px] bg-violet-600 text-white px-1 py-0.5 rounded-full font-bold">TODAY</span>}
                            <span className={`mt-0.5 block ${sbadge(s.status)}`}>{s.status.toUpperCase()}</span>
                          </td>
                          <td className="px-3 py-3">
                            {fb?.sentiment
                              ? <span className={`text-sm font-bold ${SENTIMENT_COLOR[fb.sentiment]}`}>{SENTIMENT_EMOJI[fb.sentiment]}</span>
                              : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-3">
                            {fb ? (
                              <div className="flex flex-col gap-0.5">
                                {[['H',fb.hotel_ok],['M',fb.meals_ok],['D',fb.driver_ok],['V',fb.vehicle_ok]].filter(([,v])=>v).map(([k,v])=>(
                                  <div key={k as string} className="flex items-center gap-1">
                                    <span className="text-[9px] text-slate-400 w-3">{k}</span>
                                    {ratingChip(v)}
                                  </div>
                                ))}
                              </div>
                            ) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-3 py-3 max-w-[180px]">
                            {fb?.summary && <p className="text-xs text-slate-600 truncate">{fb.summary}</p>}
                            {fb?.highlights && <p className="text-[10px] text-violet-600 truncate mt-0.5">✨ {fb.highlights}</p>}
                            {fb?.issues && <p className="text-[10px] text-red-500 truncate mt-0.5">⚠️ {fb.issues}</p>}
                          </td>
                          <td className="px-3 py-3">
                            {fb && (
                              <button onClick={() => setExpanded(isExp ? null : s.id)} className="p-1 rounded-lg hover:bg-violet-100 text-slate-300 hover:text-violet-600 transition-colors">
                                {isExp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            )}
                          </td>
                        </tr>
                        {isExp && fb && (
                          <tr key={`${s.id}-exp`}>
                            <td colSpan={6} className="px-4 pb-4 pt-2 bg-violet-50/20">
                              <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-2">
                                  {fb.summary && <div className="bg-white border border-violet-100 rounded-xl px-3 py-2.5"><p className="text-[9px] font-bold text-violet-400 uppercase mb-1">AI Summary</p><p className="text-xs text-slate-700 leading-relaxed">{fb.summary}</p></div>}
                                  {fb.highlights && <p className="text-xs text-slate-600"><strong className="text-violet-600">✨ Highlights:</strong> {fb.highlights}</p>}
                                  {fb.issues && <p className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-lg"><strong>⚠️ Issues:</strong> {fb.issues}</p>}
                                  <div className="grid grid-cols-4 gap-1">
                                    {[['Hotel',fb.hotel_ok],['Meals',fb.meals_ok],['Driver',fb.driver_ok],['Vehicle',fb.vehicle_ok]].map(([label,val])=>(
                                      <div key={label as string} className={`p-1.5 rounded-lg border text-center ${val==='good'?'bg-emerald-50 border-emerald-100':val==='bad'?'bg-red-50 border-red-100':'bg-slate-50 border-slate-100'}`}>
                                        <p className={`text-[10px] font-bold ${val==='good'?'text-emerald-600':val==='bad'?'text-red-500':'text-slate-400'}`}>{val??'—'}</p>
                                        <p className="text-[8px] text-slate-400">{label}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {fb.transcript && (
                                  <div>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1 mb-1.5"><MessageCircle className="w-2.5 h-2.5 text-violet-400" /> Transcript</p>
                                    <div className="bg-white border border-slate-200 rounded-xl p-2.5"><TranscriptBubbles transcript={fb.transcript} /></div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                  {schedule.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-xs italic">No scheduled days</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Feedback cards */}
          {view === 'feedbackonly' && (
            <div className="space-y-2.5">
              {feedback.length === 0 ? (
                <div className="text-center py-10 border border-slate-200 rounded-xl">
                  <BarChart2 className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                  <p className="text-slate-400 text-sm">No feedback recorded yet</p>
                </div>
              ) : feedback.map(fb => (
                <div key={fb.id} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 cursor-pointer" onClick={() => setExpanded(expanded===fb.id ? null : fb.id)}>
                    <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-xs font-bold text-violet-700">{fb.day_no ?? '?'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-600">{fb.call_date ? fmtDate(fb.call_date) : fmtDate(fb.created_at)}</span>
                        {fb.sentiment && <span className={`text-sm ${SENTIMENT_COLOR[fb.sentiment]}`}>{SENTIMENT_EMOJI[fb.sentiment]} <span className="text-[10px] capitalize">{fb.sentiment}</span></span>}
                      </div>
                      {fb.summary && <p className="text-[11px] text-violet-600 italic truncate mt-0.5">{fb.summary}</p>}
                    </div>
                    <div className="flex gap-0.5 flex-shrink-0">
                      {[fb.hotel_ok, fb.meals_ok, fb.driver_ok].filter(Boolean).map((v,i) => (
                        <span key={i} className={`w-2 h-2 rounded-full ${v==='good'?'bg-emerald-400':v==='bad'?'bg-red-400':'bg-slate-300'}`} />
                      ))}
                    </div>
                    {expanded===fb.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                  {expanded===fb.id && (
                    <div className="px-4 pb-4 pt-2.5 space-y-2.5">
                      <div className="grid grid-cols-4 gap-2">
                        {[['🏨 Hotel',fb.hotel_ok],['🍽️ Meals',fb.meals_ok],['🚗 Driver',fb.driver_ok],['🚌 Vehicle',fb.vehicle_ok]].map(([label,val])=>(
                          <div key={label as string} className={`p-2 rounded-xl border text-center ${val==='good'?'bg-emerald-50 border-emerald-200':val==='bad'?'bg-red-50 border-red-200':'bg-slate-50 border-slate-200'}`}>
                            <p className={`text-xs font-bold ${val==='good'?'text-emerald-600':val==='bad'?'text-red-500':'text-slate-400'}`}>{val??'—'}</p>
                            <p className="text-[9px] text-slate-400 mt-0.5">{(label as string).replace(/^[^\s]+\s/,'')}</p>
                          </div>
                        ))}
                      </div>
                      {fb.highlights && <p className="text-xs text-slate-600"><strong className="text-violet-600">✨</strong> {fb.highlights}</p>}
                      {fb.issues && <p className="text-xs text-red-600 bg-red-50 px-2.5 py-1.5 rounded-lg">⚠️ {fb.issues}</p>}
                      {fb.transcript && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 flex items-center gap-1"><MessageCircle className="w-2.5 h-2.5 text-violet-400" /> Transcript</p>
                          <TranscriptBubbles transcript={fb.transcript} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Generate + Send section ── */}
          <div className="border-t border-slate-200 pt-4 space-y-3">

            {/* Generate AI Email button */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={generateNarrative}
                disabled={generating || !feedback.length}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-xs font-semibold hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 transition-all shadow-sm"
              >
                {generating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                  : <><Wand2 className="w-3.5 h-3.5" /> {aiNarrative ? 'Regenerate AI Email' : 'Generate AI Email'}</>
                }
              </button>
              {aiNarrative && (
                <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> AI narrative ready
                </span>
              )}
              {!feedback.length && (
                <span className="text-[11px] text-slate-400 italic">No feedback data to generate from</span>
              )}
            </div>

            {/* Send email panel */}
            {!sendOpen ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500">
                    {bookingInfo.agentEmail
                      ? <>Agent: <strong className="text-slate-700">{bookingInfo.agentEmail}</strong></>
                      : <span className="text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> No agent email — add in booking contacts</span>}
                  </p>
                  {afterDeparture && feedback.length > 0 && !aiNarrative && (
                    <p className="text-[11px] text-violet-600 mt-0.5 flex items-center gap-1">
                      <Star className="w-3 h-3" /> Trip ended — click "Generate AI Email" then send
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSendOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-violet-300 text-violet-700 text-xs font-semibold hover:bg-violet-50 transition-colors"
                >
                  <Mail className="w-3.5 h-3.5" /> Review &amp; Send
                </button>
              </div>
            ) : (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5 text-violet-500" /> Review Before Sending</p>
                  <button onClick={() => setSendOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
                </div>

                {testMode && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> <strong>Test mode</strong> — sends to {testEmail1}, not the real agent
                  </div>
                )}

                {aiNarrative && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-lg text-xs text-violet-700">
                    <Sparkles className="w-3.5 h-3.5 flex-shrink-0" /> AI-written narrative will be included in the email
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">To (Agent)</label>
                  <input className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                    value={emailTo} onChange={e => setEmailTo(e.target.value)} disabled={testMode} placeholder="agent@example.com" />
                  {!testMode && !emailTo && <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> No agent email</p>}
                </div>

                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">CC</label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {ccList.map(e => (
                      <span key={e} className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 text-[10px] px-2 py-0.5 rounded-full font-medium">
                        {e}{!testMode && <button onClick={() => setCcList(c => c.filter(x=>x!==e))} className="hover:text-red-500"><X className="w-2.5 h-2.5" /></button>}
                      </span>
                    ))}
                    {!ccList.length && <span className="text-[10px] text-slate-400 italic">No CC</span>}
                  </div>
                  {!testMode && (
                    <div className="flex gap-2">
                      <input className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                        placeholder="Add CC email…" value={ccInput} onChange={e => setCcInput(e.target.value)} onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); addCc() } }} />
                      <button onClick={addCc} className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold"><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">Global CC addresses (Settings → AI Feedback CC) are added server-side</p>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-600 space-y-1">
                  <p><strong>Subject:</strong> AI Call Experience Report — {bookingRef} · Apple Holidays</p>
                  <p><strong>Includes:</strong> {aiNarrative ? 'AI narrative · ' : ''}Day-by-day call log · Ratings · Sentiment · Transcripts</p>
                  <p className="text-[10px] text-slate-400">{feedback.length} feedback record{feedback.length!==1?'s':''} · {schedule.length} scheduled call{schedule.length!==1?'s':''}</p>
                </div>

                <button onClick={sendSummary} disabled={sending || (!testMode && !emailTo)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm">
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send Feedback Summary to Agent</>}
                </button>
              </div>
            )}
          </div>

        </div>
      )}
    </Modal>
  )
}
