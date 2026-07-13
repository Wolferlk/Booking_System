'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Phone, PhoneCall, PhoneIncoming, PhoneMissed,
  Calendar, RefreshCw, Plus,
  SkipForward, Trash2, Edit2, CheckCircle2,
  XCircle, Clock, ChevronDown, ChevronUp,
  AlertCircle, Loader2, MessageSquare, Volume2, Settings,
  User, Star, MessageCircle, Bot, Info, BookOpen,
  Plane, Home, ThumbsUp, ClipboardCheck, Users, Award, Heart,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { CallRecordingPlayer } from '@/components/te/transcript-shared'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TEConfig {
  configured: boolean
  outbound_configured: boolean
  call_window: { start: number; end: number }
  default_call_time: string
  max_retries: number
  retry_gap_min: number
  retry_until_answered: boolean
  retry_window_days: number
}

interface TEService {
  id: number
  booking_ref: string
  status: 'active' | 'completed' | 'cancelled'
  customer_name?: string | null
  call_phone: string
  call_time: string
  schedule_mode: 'agenda' | 'interval'
  interval_count?: number | null
  interval_unit?: string | null
  interval_start_at?: string | null
  retry_gap_min: number
  schedule?: TEScheduleItem[]
  feedback?: TEFeedback[]
  // Reconfirmation + post-tour plan settings (API-Update-Reconfirmation&Post)
  reconfirm_enabled?: boolean | null
  reconfirm_days_before?: number | null
  reconfirm_call_time?: string | null
  post_tour_enabled?: boolean | null
  post_tour_days_after?: number | null
  post_tour_call_time?: string | null
  reconfirmations?: TEReconfirmation[]
  post_tour?: TEPostTour[]
}

type TriState = 'yes' | 'no' | 'unsure' | boolean | null | undefined

interface TEReconfirmation {
  id: number
  service_id: number
  schedule_id?: number | null
  booking_ref: string
  conversation_id?: string | null
  dates_ok?: TriState
  flight_ok?: TriState
  pax_ok?: TriState
  contact_ok?: TriState
  requested_change?: string | null
  special_requests?: string | null
  notes?: string | null
  outcome?: string | null
  sentiment?: string | null
  summary?: string | null
  transcript?: TranscriptTurn[] | string | null
  at?: string | null
}

interface TEPostTour {
  id: number
  service_id: number
  schedule_id?: number | null
  booking_ref: string
  conversation_id?: string | null
  rating?: number | null
  stars?: number | null
  reached_home_safely?: boolean | null
  would_recommend?: boolean | null
  best_moment?: string | null
  improvements?: string | null
  comment?: string | null
  outcome?: string | null
  sentiment?: string | null
  summary?: string | null
  transcript?: TranscriptTurn[] | string | null
  at?: string | null
}

interface TEScheduleItem {
  id: number
  service_id: number
  booking_ref: string
  call_date: string
  scheduled_at?: string | null
  day_no: number
  phase?: 'arrival' | 'mid' | 'departure' | 'reconfirm' | 'post_tour' | null
  day_brief?: string | null
  status: 'pending' | 'answered' | 'missed' | 'skipped' | 'done' | 'failed'
  attempts: number
  last_attempt_at?: string | null
  next_attempt_at?: string | null
  channel_id?: string | null
  conversation_id?: string | null
  error?: string | null
}

interface TEFeedback {
  id: number
  schedule_id?: number | null
  service_id: number
  booking_ref: string
  day_no?: number | null
  call_date?: string | null
  created_at: string
  sentiment?: 'positive' | 'neutral' | 'negative' | 'happy' | null
  highlights?: string | null
  hotel_ok?: string | null
  meals_ok?: string | null
  driver_ok?: string | null
  vehicle_ok?: string | null
  issues?: string | null
  summary?: string | null
  conversation_id?: string | null
  transcript?: TranscriptTurn[] | string | null
  raw?: Record<string, unknown> | null
}

interface TranscriptTurn {
  role?: string
  speaker?: string
  text?: string
  message?: string
  content?: string
}

interface Props {
  bookingRef: string
  booking: {
    contactWhatsapp?: string | null
    contactPhone?: string | null
    arrivalDate?: string | null
    departureDate?: string | null
    passengers?: { isLead: boolean; name: string; contact?: string | null }[]
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function teProxy(path: string, method = 'GET', body?: unknown, extra?: Record<string, string>) {
  const url = new URL('/api/te/proxy', location.origin)
  url.searchParams.set('path', path)
  if (extra) for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  const hasBody = body !== undefined && ['POST', 'PATCH', 'PUT'].includes(method)
  return fetch(url.toString(), {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  }).then(r => r.json())
}

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  completed: 'bg-slate-100 text-slate-500 border-slate-200',
  cancelled: 'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-blue-100 text-blue-700 border-blue-200',
  paused:    'bg-amber-100 text-amber-700 border-amber-200',
  answered:  'bg-emerald-100 text-emerald-700 border-emerald-200',
  done:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  missed:    'bg-red-100 text-red-500 border-red-200',
  failed:    'bg-red-100 text-red-600 border-red-200',
  skipped:   'bg-slate-100 text-slate-400 border-slate-200',
  pending:   'bg-orange-50 text-orange-600 border-orange-200',
}

function statusBadge(s: string, sm = false) {
  const cls = STATUS_STYLES[s] ?? 'bg-slate-100 text-slate-500 border-slate-200'
  return `inline-flex items-center gap-0.5 border font-bold rounded-full ${sm ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'} ${cls}`
}

function fmtDate(iso: string) {
  return new Date(iso + (iso.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}
function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

// ─── Transcript Viewer ────────────────────────────────────────────────────────

interface NormLine { speaker: 'agent' | 'customer' | 'system'; text: string }

function normaliseTranscript(raw: TranscriptTurn[] | string | null | undefined): NormLine[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map(turn => {
      const role = (turn.role ?? turn.speaker ?? '').toLowerCase()
      const text = turn.text ?? turn.message ?? turn.content ?? ''
      if (['ai', 'agent', 'bot', 'assistant'].includes(role)) return { speaker: 'agent' as const, text }
      if (['user', 'customer', 'human', 'passenger', 'caller'].includes(role)) return { speaker: 'customer' as const, text }
      return { speaker: 'system' as const, text }
    }).filter(l => l.text)
  }
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return str.split('\n').filter(l => l.trim()).map(line => {
    if (/^(agent|bot|ai|assistant)\s*:/i.test(line)) return { speaker: 'agent' as const, text: line.replace(/^[^:]+:\s*/i, '') }
    if (/^(customer|user|passenger|caller|human)\s*:/i.test(line)) return { speaker: 'customer' as const, text: line.replace(/^[^:]+:\s*/i, '') }
    return { speaker: 'system' as const, text: line }
  })
}

function TranscriptViewer({ transcript }: { transcript: TranscriptTurn[] | string | null | undefined }) {
  const lines = normaliseTranscript(transcript)
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [])
  if (lines.length === 0) return <p className="text-xs text-slate-400 italic px-3 py-2">No transcript recorded</p>
  return (
    <div className="max-h-80 overflow-y-auto space-y-2 px-1 py-2">
      {lines.map((line, i) => (
        <div key={i} className={`flex ${line.speaker === 'customer' ? 'justify-end' : line.speaker === 'system' ? 'justify-center' : 'justify-start'}`}>
          {line.speaker === 'system' ? (
            <span className="text-[10px] text-slate-400 italic">{line.text}</span>
          ) : line.speaker === 'agent' ? (
            <div className="flex items-start gap-2 max-w-[80%]">
              <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0 mt-0.5"><Bot className="w-3 h-3 text-white" /></div>
              <div className="bg-violet-50 border border-violet-100 rounded-2xl rounded-tl-sm px-3 py-2">
                <p className="text-xs text-slate-700 leading-relaxed">{line.text}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 max-w-[80%] flex-row-reverse">
              <div className="w-5 h-5 rounded-full bg-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5"><User className="w-3 h-3 text-white" /></div>
              <div className="bg-slate-800 rounded-2xl rounded-tr-sm px-3 py-2">
                <p className="text-xs text-white leading-relaxed">{line.text}</p>
              </div>
            </div>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ─── Reconfirmation + Post-tour helpers ────────────────────────────────────────

const SENTIMENT_EMOJI: Record<string, string> = { positive: '😊', happy: '😊', neutral: '😐', negative: '😞' }

const OUTCOME_META: Record<string, { label: string; cls: string }> = {
  confirmed:        { label: 'Confirmed',         cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  changes_requested:{ label: 'Changes requested', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  all_good:         { label: 'All good',          cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  minor_note:       { label: 'Minor note',        cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  issue_raised:     { label: 'Issue raised',      cls: 'bg-red-100 text-red-600 border-red-200' },
  not_reached:      { label: 'Not reached',       cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  callback:         { label: 'Callback',          cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  other:            { label: 'Other',             cls: 'bg-slate-100 text-slate-500 border-slate-200' },
}
function outcomeBadge(o?: string | null) {
  const cls = (o && OUTCOME_META[o]?.cls) || 'bg-slate-100 text-slate-500 border-slate-200'
  return `inline-flex items-center gap-1 border font-bold rounded-full text-[9px] px-2 py-0.5 ${cls}`
}

function toStars(rating?: number | null, provided?: number | null): number {
  if (provided != null) return Math.max(0, Math.min(5, provided))
  if (rating == null) return 0
  return Math.max(0, Math.min(5, Math.round(rating / 2)))
}

function triState(v: TriState): 'yes' | 'no' | 'unsure' {
  if (v === true || v === 'yes') return 'yes'
  if (v === false || v === 'no') return 'no'
  return 'unsure'
}
const TRI_META = {
  yes:    { icon: CheckCircle2, cls: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
  no:     { icon: XCircle,      cls: 'text-red-500',     bg: 'bg-red-50 border-red-200' },
  unsure: { icon: AlertCircle,  cls: 'text-slate-400',   bg: 'bg-slate-50 border-slate-200' },
} as const

function StarRating({ value, size = 'w-4 h-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} className={`${size} ${i <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
      ))}
    </span>
  )
}

function FlagChip({ label, value, icon: Icon }: { label: string; value: TriState; icon: React.ElementType }) {
  const m = TRI_META[triState(value)]
  const StatusIcon = m.icon
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${m.bg}`}>
      <Icon className="w-3 h-3 text-slate-400" />
      <span className="text-[10px] font-semibold text-slate-600">{label}</span>
      <StatusIcon className={`w-3 h-3 ml-auto ${m.cls}`} />
    </div>
  )
}

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

// ─── Reconfirmation result card ────────────────────────────────────────────────
function ReconfirmCard({ row, onRetry, retryBusy }: { row: TEReconfirmation; onRetry?: () => void; retryBusy?: boolean }) {
  const [open, setOpen] = useState(false)
  const hasChange = !!(row.requested_change && row.requested_change.trim())
  return (
    <div className="rounded-xl border border-sky-200 bg-white overflow-hidden">
      <div className="px-3 py-2.5 bg-gradient-to-r from-sky-50 to-blue-50 border-b border-sky-100 flex items-center gap-2 flex-wrap">
        <span className="w-6 h-6 rounded-lg bg-sky-500 flex items-center justify-center flex-shrink-0"><ClipboardCheck className="w-3 h-3 text-white" /></span>
        <span className="text-[10px] font-bold text-sky-700 uppercase tracking-wide">Reconfirmation</span>
        {row.outcome && <span className={outcomeBadge(row.outcome)}>{OUTCOME_META[row.outcome]?.label ?? row.outcome}</span>}
        {row.sentiment && <span className="text-sm" title={row.sentiment}>{SENTIMENT_EMOJI[row.sentiment] ?? ''}</span>}
        <span className="ml-auto flex items-center gap-2">
          {row.at && <span className="text-[10px] text-slate-400">{fmtDateTime(row.at)}</span>}
          {onRetry && (
            <button type="button" disabled={retryBusy} onClick={onRetry} title="Place the reconfirmation call again now"
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 transition-colors">
              {retryBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />} Retry call
            </button>
          )}
        </span>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <FlagChip label="Dates"      value={row.dates_ok}   icon={Calendar} />
          <FlagChip label="Flights"    value={row.flight_ok}  icon={Plane} />
          <FlagChip label="Travellers" value={row.pax_ok}     icon={Users} />
          <FlagChip label="Contact"    value={row.contact_ok} icon={Phone} />
        </div>
        {hasChange && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold text-amber-600 uppercase mb-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Requested change — action needed</p>
            <p className="text-xs text-slate-800 leading-relaxed font-medium">{row.requested_change}</p>
          </div>
        )}
        {row.special_requests && (
          <div className="bg-violet-50 border border-violet-100 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold text-violet-500 uppercase mb-1 flex items-center gap-1"><Heart className="w-3 h-3" /> Special requests</p>
            <p className="text-xs text-slate-700 leading-relaxed">{row.special_requests}</p>
          </div>
        )}
        {row.summary && <p className="text-xs text-slate-600 italic leading-relaxed">{row.summary}</p>}
        {row.conversation_id && <CallRecordingPlayer conversationId={row.conversation_id} />}
        {row.transcript && (
          <div>
            <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:text-sky-800">
              <MessageCircle className="w-3 h-3" /> {open ? 'Hide' : 'View'} transcript {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {open && <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg"><TranscriptViewer transcript={row.transcript} /></div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Post-tour result card ─────────────────────────────────────────────────────
function PostTourCard({ row, onRetry, retryBusy }: { row: TEPostTour; onRetry?: () => void; retryBusy?: boolean }) {
  const [open, setOpen] = useState(false)
  const stars = toStars(row.rating, row.stars)
  return (
    <div className="rounded-xl border border-amber-200 bg-white overflow-hidden">
      <div className="px-3 py-2.5 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2 flex-wrap">
        <span className="w-6 h-6 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0"><Award className="w-3 h-3 text-white" /></span>
        <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">Post-tour</span>
        {row.outcome && <span className={outcomeBadge(row.outcome)}>{OUTCOME_META[row.outcome]?.label ?? row.outcome}</span>}
        {row.sentiment && <span className="text-sm" title={row.sentiment}>{SENTIMENT_EMOJI[row.sentiment] ?? ''}</span>}
        <span className="ml-auto flex items-center gap-2">
          {row.at && <span className="text-[10px] text-slate-400">{fmtDateTime(row.at)}</span>}
          {onRetry && (
            <button type="button" disabled={retryBusy} onClick={onRetry} title="Place the post-tour feedback call again now"
              className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 transition-colors">
              {retryBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />} Retry call
            </button>
          )}
        </span>
      </div>
      <div className="p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <StarRating value={stars} />
          {row.rating != null && <span className="text-base font-black text-amber-500">{row.rating}<span className="text-[10px] font-bold text-slate-400">/10</span></span>}
          <div className="flex items-center gap-1.5 ml-auto">
            {row.reached_home_safely != null && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${row.reached_home_safely ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200'}`}>
                <Home className="w-3 h-3" /> {row.reached_home_safely ? 'Home safe' : 'Not home'}
              </span>
            )}
            {row.would_recommend != null && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${row.would_recommend ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                <ThumbsUp className="w-3 h-3" /> {row.would_recommend ? 'Recommends' : 'Would not'}
              </span>
            )}
          </div>
        </div>
        {row.best_moment && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold text-emerald-600 uppercase mb-1 flex items-center gap-1"><Star className="w-3 h-3" /> Best moment</p>
            <p className="text-xs text-slate-700 leading-relaxed">{row.best_moment}</p>
          </div>
        )}
        {row.improvements && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            <p className="text-[10px] font-bold text-blue-500 uppercase mb-1 flex items-center gap-1"><Info className="w-3 h-3" /> Could improve</p>
            <p className="text-xs text-slate-700 leading-relaxed">{row.improvements}</p>
          </div>
        )}
        {row.comment && <p className="text-xs text-slate-700 leading-relaxed">&ldquo;{row.comment}&rdquo;</p>}
        {row.summary && <p className="text-xs text-slate-500 italic leading-relaxed">{row.summary}</p>}
        {row.conversation_id && <CallRecordingPlayer conversationId={row.conversation_id} />}
        {row.transcript && (
          <div>
            <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-[11px] font-semibold text-amber-600 hover:text-amber-800">
              <MessageCircle className="w-3 h-3" /> {open ? 'Hide' : 'View'} transcript {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {open && <div className="mt-2 bg-slate-50 border border-slate-200 rounded-lg"><TranscriptViewer transcript={row.transcript} /></div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Schedule Row ─────────────────────────────────────────────────────────────

function ScheduleRow({ item, busy, onCallNow, onSkip, onDelete, onEdit }: {
  item: TEScheduleItem; busy: boolean
  onCallNow: () => void; onSkip: () => void; onDelete: () => void; onEdit: () => void
}) {
  const phaseIcons: Record<string, string> = { arrival: '✈️', mid: '🌏', departure: '🏠' }
  const statusIcon = {
    answered: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
    done:     <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />,
    missed:   <PhoneMissed className="w-3.5 h-3.5 text-red-400" />,
    failed:   <PhoneMissed className="w-3.5 h-3.5 text-red-400" />,
    skipped:  <SkipForward className="w-3.5 h-3.5 text-slate-400" />,
    pending:  <Clock className="w-3.5 h-3.5 text-orange-400" />,
  }[item.status] ?? <Clock className="w-3.5 h-3.5 text-slate-300" />

  const isPast = new Date(item.call_date + 'T23:59:59') < new Date()
  const isToday = item.call_date === new Date().toISOString().slice(0, 10)
  const isReconfirm = item.phase === 'reconfirm'
  const isPostTour  = item.phase === 'post_tour'
  // Reconfirmation / post-tour calls can always be RE-placed (retry after a bad
  // line, an unanswered attempt, or simply to run the script again) — day
  // check-ins only while still open.
  const canCall = item.status === 'pending' || item.status === 'missed' || isReconfirm || isPostTour

  return (
    <div className={`flex items-center gap-2 py-3 border-b border-slate-50 last:border-0 group ${busy ? 'opacity-40 pointer-events-none' : ''} ${isReconfirm ? 'bg-sky-50/40' : isPostTour ? 'bg-amber-50/30' : ''}`}>
      {isReconfirm ? (
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-sky-500 text-white" title="Reconfirmation call"><ClipboardCheck className="w-3.5 h-3.5" /></div>
      ) : isPostTour ? (
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-amber-500 text-white" title="Post-tour feedback call"><Award className="w-3.5 h-3.5" /></div>
      ) : (
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${isToday ? 'bg-violet-600 text-white' : (item.status === 'answered' || item.status === 'done') ? 'bg-emerald-100 text-emerald-600' : isPast ? 'bg-slate-100 text-slate-400' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
          {item.day_no}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-mono font-semibold ${isToday ? 'text-violet-700' : 'text-slate-700'}`}>{fmtDate(item.call_date)}</span>
          {isReconfirm && <span className="text-[9px] font-bold bg-sky-100 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full">RECONFIRM</span>}
          {isPostTour && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">POST-TOUR</span>}
          {item.phase && !isReconfirm && !isPostTour && <span className="text-xs">{phaseIcons[item.phase] ?? ''}</span>}
          {isToday && <span className="text-[9px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded-full">TODAY</span>}
          <span className={statusBadge(item.status, true)}>{statusIcon}<span className="ml-0.5">{item.status.toUpperCase()}</span></span>
          {item.scheduled_at && <span className="text-[10px] text-blue-500 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{fmtTime(item.scheduled_at)}</span>}
          {item.attempts > 0 && <span className="text-[10px] text-slate-400">{item.attempts} attempt{item.attempts !== 1 ? 's' : ''}</span>}
        </div>
        {item.day_brief && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{item.day_brief}</p>}
        {item.error && <p className="text-[10px] text-red-400 mt-0.5 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" />{item.error}</p>}
        {item.next_attempt_at && item.status === 'pending' && <p className="text-[10px] text-orange-400 mt-0.5 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Next: {fmtDateTime(item.next_attempt_at)}</p>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {canCall && (
          <>
            <button onClick={onCallNow} title="Call now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors"><PhoneCall className="w-3.5 h-3.5" /></button>
            <button onClick={onSkip} title="Skip" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-300 hover:text-slate-500 transition-colors"><SkipForward className="w-3.5 h-3.5" /></button>
          </>
        )}
        <button onClick={onEdit} title="Edit" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-300 hover:text-slate-500 transition-colors"><Edit2 className="w-3 h-3" /></button>
        <button onClick={onDelete} title="Remove" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
      </div>
      {busy && <Loader2 className="w-3.5 h-3.5 text-violet-400 animate-spin flex-shrink-0" />}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

// Three tabs only — setup+results, the call schedule, and a quick call. The old
// "Recurring Jobs" and "Calls & Feedback" tabs were noise on a booking page:
// jobs live in the global AI Call Bot dashboard, and every conversation (with
// recording + transcript) is in the "AI Call Transcripts" card right below.
type Tab = 'overview' | 'schedule' | 'quickcall'

export default function TravellerExperiencePanel({ bookingRef, booking }: Props) {
  const [tab, setTab]         = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [service, setService] = useState<TEService | null>(null)
  const [config, setConfig]   = useState<TEConfig | null>(null)

  const lead        = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const defaultPhone = (booking.contactWhatsapp ?? booking.contactPhone ?? lead?.contact ?? '') as string
  const leadName    = (lead?.name ?? '') as string

  // ── Intake form ───────────────────────────────────────────────────────────
  const [intakeForm, setIntakeForm] = useState({ phone: defaultPhone, mode: 'agenda' as 'agenda' | 'interval', call_time: '18:00', interval_count: '10', interval_unit: 'minute' as 'minute' | 'hour' | 'day', retry_gap_min: '15' })
  const [intakeLoading, setIntakeLoading] = useState(false)

  // ── Reconfirmation + Post-tour opt-in ─────────────────────────────────────
  const [reconfirmPlan, setReconfirmPlan] = useState({ enabled: true, days_before: '5', call_time: '' })
  const [postTourPlan, setPostTourPlan]   = useState({ enabled: true, days_after: '3', call_time: '' })
  const [planBusy, setPlanBusy]           = useState<'reconfirm' | 'post_tour' | null>(null)

  // ── Edit service form ─────────────────────────────────────────────────────
  const [editOpen, setEditOpen]       = useState(false)
  const [editForm, setEditForm]       = useState({ phone: defaultPhone, call_time: '18:00', mode: 'agenda' as 'agenda' | 'interval', interval_count: '10', interval_unit: 'minute' as 'minute' | 'hour' | 'day', retry_gap_min: '15' })
  const [editLoading, setEditLoading] = useState(false)

  // ── Schedule ──────────────────────────────────────────────────────────────
  const [scheduleBusy, setScheduleBusy] = useState<number | null>(null)
  const [editItem, setEditItem]         = useState<TEScheduleItem | null>(null)
  const [editItemForm, setEditItemForm] = useState({ call_date: '', day_brief: '', scheduled_at: '', status: '' })
  const [editItemLoading, setEditItemLoading] = useState(false)
  const [addDayOpen, setAddDayOpen]     = useState(false)
  const [addDayForm, setAddDayForm]     = useState({ call_date: '', brief: '', scheduled_at: '', day_no: '' })
  const [addDayLoading, setAddDayLoading] = useState(false)

  // ── Quick Call ────────────────────────────────────────────────────────────
  const [quickForm, setQuickForm] = useState({ to: defaultPhone, name: leadName, reason: '' })
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickResult, setQuickResult]   = useState<{ ok: boolean; message?: string; note?: string; channel_id?: string; booking_ref?: string; references_itinerary?: boolean } | null>(null)

  // ── Approval ──────────────────────────────────────────────────────────────
  const [approvalLoading, setApprovalLoading] = useState(false)

  // ── Load service + config ─────────────────────────────────────────────────
  const loadService = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [svcRes, cfgRes] = await Promise.allSettled([teProxy(`services/${bookingRef}`), teProxy('config')])
      if (svcRes.status === 'fulfilled') {
        const d = svcRes.value
        setService(d?.service ?? d?.data ?? null)
      }
      if (cfgRes.status === 'fulfilled') setConfig(cfgRes.value ?? null)
    } finally { setLoading(false) }
  }, [bookingRef])

  useEffect(() => { loadService() }, [loadService])

  // ── Live call-permission state — the source of truth for "can we call?" ────
  // Read from Meta via the TE API so the panel SHOWS whether the customer has
  // allowed WhatsApp calls, instead of every dial guessing and failing.
  const [perm, setPerm] = useState<{ checked: boolean; allowed: boolean | null; message?: string; can_request?: boolean } | null>(null)
  const [permLoading, setPermLoading] = useState(false)
  const permPhone = (service?.call_phone || intakeForm.phone || '').replace(/\D/g, '')
  const loadPermission = useCallback(async (phone: string) => {
    if (!phone) { setPerm(null); return }
    setPermLoading(true)
    try {
      const res = await teProxy('approval', 'GET', undefined, { to: phone })
      setPerm({ checked: Boolean(res.checked), allowed: res.allowed ?? null, message: res.message, can_request: res.can_request })
    } catch { setPerm(null) } finally { setPermLoading(false) }
  }, [])
  useEffect(() => { if (permPhone) loadPermission(permPhone) }, [permPhone, loadPermission])

  // ── Register ──────────────────────────────────────────────────────────────
  async function registerBooking() {
    if (!intakeForm.phone) { toast.error('Phone number is required'); return }
    setIntakeLoading(true)
    try {
      const scheduleBody: Record<string, unknown> = {
        mode: intakeForm.mode,
        call_time: intakeForm.call_time,
        retry_gap_min: Number(intakeForm.retry_gap_min) || 15,
        ...(intakeForm.mode === 'interval' && { interval_count: Number(intakeForm.interval_count) || 10, interval_unit: intakeForm.interval_unit, start_at: 'now' }),
      }
      scheduleBody.reconfirm = reconfirmPlan.enabled
        ? { enabled: true, days_before: Number(reconfirmPlan.days_before) || 5, ...(reconfirmPlan.call_time && { call_time: reconfirmPlan.call_time }) }
        : { enabled: false }
      scheduleBody.post_tour = postTourPlan.enabled
        ? { enabled: true, days_after: Number(postTourPlan.days_after) || 3, ...(postTourPlan.call_time && { call_time: postTourPlan.call_time }) }
        : { enabled: false }
      const body: Record<string, unknown> = { bookingRef, phone: intakeForm.phone.replace(/\D/g, ''), schedule: scheduleBody }
      const res = await teProxy('intake', 'POST', body)
      if (res.ok === false && !res.service) throw new Error(res.message ?? 'Registration failed')
      toast.success(`Registered — ${res.schedule_inserted ?? 0} day${res.schedule_inserted !== 1 ? 's' : ''} scheduled`)
      await loadService()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to register') }
    finally { setIntakeLoading(false) }
  }

  // ── Enable/disable a reconfirm / post-tour plan on the registered service ──
  async function updatePlan(kind: 'reconfirm' | 'post_tour', patch: Record<string, unknown>) {
    setPlanBusy(kind)
    try {
      const res = await teProxy(`services/${bookingRef}`, 'PATCH', { [kind]: patch })
      if (res.error) throw new Error(res.error)
      toast.success('Plan updated')
      await loadService(true)
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setPlanBusy(null) }
  }

  // ── Edit service ──────────────────────────────────────────────────────────
  function openEdit() {
    if (!service) return
    setEditForm({ phone: service.call_phone ?? '', call_time: service.call_time ?? '18:00', mode: service.schedule_mode ?? 'agenda', interval_count: String(service.interval_count ?? 10), interval_unit: (service.interval_unit ?? 'minute') as 'minute' | 'hour' | 'day', retry_gap_min: String(service.retry_gap_min ?? 15) })
    setEditOpen(true)
  }

  async function saveEdit() {
    setEditLoading(true)
    try {
      const body: Record<string, unknown> = { call_time: editForm.call_time, mode: editForm.mode, retry_gap_min: Number(editForm.retry_gap_min) }
      if (editForm.phone) body.phone = editForm.phone.replace(/\D/g, '')
      if (editForm.mode === 'interval') { body.interval_count = Number(editForm.interval_count); body.interval_unit = editForm.interval_unit; body.start_at = 'now' }
      const res = await teProxy(`services/${bookingRef}`, 'PATCH', body)
      if (!res.service && res.ok === false) throw new Error(res.message ?? 'Update failed')
      toast.success('Settings updated')
      setEditOpen(false)
      await loadService()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update') }
    finally { setEditLoading(false) }
  }

  async function updateStatus(status: 'active' | 'completed' | 'cancelled') {
    try {
      const res = await teProxy(`services/${bookingRef}/status`, 'PATCH', { status })
      if (res.error) throw new Error(res.error)
      toast.success(`Service ${status}`)
      await loadService()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to update status') }
  }

  // ── Approval ──────────────────────────────────────────────────────────────
  async function sendApproval(overridePhone?: string) {
    const phone = (overridePhone ?? service?.call_phone ?? intakeForm.phone).replace(/\D/g, '')
    if (!phone) { toast.error('Enter a phone number first'); return }
    setApprovalLoading(true)
    try {
      const res = await teProxy('approval', 'POST', { to: phone, name: leadName || 'Valued Customer' })
      if (res.already_allowed) toast.success('Customer already allowed WhatsApp calls ✓')
      else toast.success(res.message ?? 'Approval request sent — awaiting customer confirmation')
      await loadPermission(phone)
    } catch { toast.error('Failed to send approval request') }
    finally { setApprovalLoading(false) }
  }

  // The live "can we call them?" chip — one glance answers what used to be a
  // guessing game. Reads Meta's real permission state via the TE API.
  function permChip() {
    if (!permPhone) return null
    if (permLoading) {
      return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border bg-slate-50 text-slate-500 border-slate-200"><Loader2 className="w-3 h-3 animate-spin" /> Checking call permission…</span>
    }
    if (perm?.allowed === true) {
      return <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3" /> Customer allows calls</span>
    }
    if (perm?.allowed === false) {
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border bg-amber-50 text-amber-700 border-amber-200" title={perm?.message}>
          <AlertCircle className="w-3 h-3" /> Not allowed yet — {perm?.can_request === false ? 'awaiting their Allow tap' : 'send the approval request'}
        </span>
      )
    }
    return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border bg-slate-50 text-slate-400 border-slate-200" title={perm?.message}>Permission state unknown</span>
  }

  // ── Schedule actions ──────────────────────────────────────────────────────
  async function callNow(id: number) {
    const sortedSched = [...(service?.schedule ?? [])].sort((a, b) => a.day_no - b.day_no)
    const item        = sortedSched.find(s => s.id === id)
    const isSpecial   = item?.phase === 'reconfirm' || item?.phase === 'post_tour'
    const firstPending = sortedSched.find(s => s.status === 'pending' && s.phase !== 'reconfirm' && s.phase !== 'post_tour')
    // The out-of-order warning is about DAY check-ins — a reconfirmation or
    // post-tour retry is never "out of sequence".
    if (item && !isSpecial && firstPending && firstPending.id !== item.id) {
      const ok = confirm(
        `⚠️ Out-of-order call\n\nDay ${firstPending.day_no} (${firstPending.call_date}) is still pending.\nCall Day ${item.day_no} out of sequence anyway?`
      )
      if (!ok) return
    }
    setScheduleBusy(id)
    try {
      const res = await teProxy(`schedule/${id}/call`, 'POST', { force: true })
      if (res.approval_pending) toast.info(res.message ?? 'WhatsApp approval pending')
      else if (res.ok === false) toast.info(res.message ?? 'Call could not be placed')
      else toast.success(res.message ?? 'Call placed')
      await loadService()
    } catch { toast.error('Call failed') } finally { setScheduleBusy(null) }
  }

  async function skipDay(id: number) {
    setScheduleBusy(id)
    try { await teProxy(`schedule/${id}/skip`, 'POST'); toast.success('Day skipped'); await loadService() }
    catch { toast.error('Failed to skip') } finally { setScheduleBusy(null) }
  }

  async function deleteScheduleItem(id: number) {
    if (!confirm('Remove this day-call from the schedule?')) return
    setScheduleBusy(id)
    try { await teProxy(`schedule/${id}`, 'DELETE'); toast.success('Removed'); await loadService() }
    catch { toast.error('Failed to remove') } finally { setScheduleBusy(null) }
  }

  function openEditItem(item: TEScheduleItem) {
    setEditItem(item)
    setEditItemForm({ call_date: item.call_date, day_brief: item.day_brief ?? '', scheduled_at: item.scheduled_at ? new Date(item.scheduled_at).toISOString().slice(0, 16) : '', status: '' })
  }

  async function saveEditItem() {
    if (!editItem) return
    setEditItemLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (editItemForm.call_date !== editItem.call_date) body.call_date = editItemForm.call_date
      if (editItemForm.day_brief !== (editItem.day_brief ?? '')) body.day_brief = editItemForm.day_brief
      if (editItemForm.scheduled_at) body.scheduled_at = new Date(editItemForm.scheduled_at).toISOString()
      if (editItemForm.status) body.status = editItemForm.status
      if (Object.keys(body).length === 0) { setEditItem(null); return }
      await teProxy(`schedule/${editItem.id}`, 'PATCH', body)
      toast.success('Updated')
      setEditItem(null)
      await loadService()
    } catch { toast.error('Failed to update') } finally { setEditItemLoading(false) }
  }

  async function addDayCall() {
    if (!addDayForm.call_date) { toast.error('Select a date'); return }
    setAddDayLoading(true)
    try {
      // Compute day_no from existing schedule if not supplied
      const nextDayNo = addDayForm.day_no
        ? Number(addDayForm.day_no)
        : (schedule.length > 0 ? Math.max(...schedule.map(s => s.day_no)) + 1 : 1)
      const body: Record<string, unknown> = {
        call_date: addDayForm.call_date,
        day_no: nextDayNo,
      }
      if (addDayForm.brief) body.brief = addDayForm.brief
      if (addDayForm.scheduled_at) body.scheduled_at = new Date(addDayForm.scheduled_at).toISOString()
      const res = await teProxy(`services/${bookingRef}/schedule`, 'POST', body)
      if (res.error) throw new Error(res.error)
      if (res.ok === false) throw new Error(res.message ?? 'Failed to add day call')
      toast.success('Day-call added')
      setAddDayOpen(false)
      setAddDayForm({ call_date: '', brief: '', scheduled_at: '', day_no: '' })
      await loadService()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to add') }
    finally { setAddDayLoading(false) }
  }

  // ── Quick Call ────────────────────────────────────────────────────────────
  async function placeQuickCall() {
    const phone = quickForm.to.replace(/\D/g, '')
    if (!phone) { toast.error('Phone number is required'); return }

    // bookingRef is ALWAYS sent — it is the VN/IS number of the current booking page.
    // This gives the AI agent the full trip itinerary, hotels, flights, passengers.
    const body: Record<string, unknown> = {
      to:          phone,
      name:        quickForm.name.trim() || undefined,
      bookingRef:  bookingRef,           // VN19662 / IS48375 — always the current booking
      booking_ref: bookingRef,           // alias also accepted by the API
    }
    if (quickForm.reason.trim()) body.reason = quickForm.reason.trim()

    setQuickLoading(true)
    setQuickResult(null)
    try {
      const res = await teProxy('quick-call', 'POST', body)
      if (res.approval_pending) {
        setQuickResult({ ok: false, message: res.message ?? 'WhatsApp approval pending — customer must tap Allow first', note: res.note })
        toast.info('Approval sent — customer must tap Allow first')
      } else if (res.ok === false) {
        setQuickResult({ ok: false, message: res.message })
        toast.info(res.message ?? 'Call could not connect')
      } else {
        setQuickResult({ ok: true, message: res.message, note: res.note, channel_id: res.channel_id, booking_ref: res.booking_ref, references_itinerary: res.references_itinerary })
        toast.success(res.references_itinerary ? `Quick call placed — agent has ${bookingRef} itinerary` : 'Quick call placed')
      }
    } catch { toast.error('Quick call failed') } finally { setQuickLoading(false) }
  }

  // Place (or re-place) the booking's reconfirmation / post-tour call right now,
  // from wherever the user is looking at its result — resolves the matching
  // schedule row and dials it with force.
  const [specialBusy, setSpecialBusy] = useState<'reconfirm' | 'post_tour' | null>(null)
  async function retrySpecial(phase: 'reconfirm' | 'post_tour') {
    const rows = (service?.schedule ?? []).filter(s => s.phase === phase)
    const row = rows[rows.length - 1]
    if (!row) {
      toast.error(`No ${phase === 'reconfirm' ? 'reconfirmation' : 'post-tour'} call is scheduled — enable it in the plan settings first.`)
      return
    }
    setSpecialBusy(phase)
    try { await callNow(row.id) } finally { setSpecialBusy(null) }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const schedule = [...(service?.schedule ?? [])].sort((a, b) => a.day_no - b.day_no)
  const registered     = service !== null
  const allFeedback    = service?.feedback ?? []
  const pendingCalls   = schedule.filter(s => s.status === 'pending').length
  const completedCalls = schedule.filter(s => s.status === 'answered' || s.status === 'done').length
  const missedCalls    = schedule.filter(s => s.status === 'missed' || s.status === 'failed').length
  const todayCall      = schedule.find(s => s.call_date === new Date().toISOString().slice(0, 10))

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Card className="overflow-hidden">

      {/* ── Header ── */}
      <CardHeader className="bg-gradient-to-r from-violet-50 via-purple-50 to-indigo-50 border-b border-violet-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Volume2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">AI Voice Calls — Setup &amp; Control</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Schedule, place and retry the AI calls for {bookingRef} · conversations &amp; recordings are in “AI Call Transcripts” below</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {todayCall && todayCall.status === 'pending' && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-100 border border-violet-200 px-2 py-1 rounded-full animate-pulse">
              <Phone className="w-2.5 h-2.5" /> Call due today
            </span>
          )}
          {loading
            ? <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
            : registered
              ? <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${STATUS_STYLES[service!.status]}`}>{service!.status.toUpperCase()}</span>
              : <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-400 border border-slate-200">NOT REGISTERED</span>
          }
          <button onClick={() => { loadService(true); if (permPhone) loadPermission(permPhone) }}
            className="p-1.5 rounded-lg hover:bg-violet-100 text-violet-400 transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </CardHeader>

      {/* ── Stats strip ── */}
      {!loading && registered && (
        <div className="flex items-center divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/50">
          {[
            { label: 'Pending',  value: pendingCalls,   color: 'text-orange-500' },
            { label: 'Answered', value: completedCalls, color: 'text-emerald-500' },
            { label: 'Missed',   value: missedCalls,    color: 'text-red-400' },
            { label: 'Feedback', value: allFeedback.length, color: 'text-violet-500' },
          ].map(s => (
            <div key={s.label} className="flex-1 text-center py-2 px-3">
              <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[9px] text-slate-400 font-medium uppercase tracking-wide">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex border-b border-slate-100 bg-white overflow-x-auto">
        {([
          { key: 'overview',  label: 'Setup & Results' },
          { key: 'schedule',  label: 'Call Schedule', count: schedule.length },
          { key: 'quickcall', label: 'Quick Call' },
        ] as { key: Tab; label: string; count?: number }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${tab === t.key ? 'border-violet-500 text-violet-700 bg-violet-50/30' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`ml-1.5 text-[9px] px-1 py-0.5 rounded-full font-bold ${tab === t.key ? 'bg-violet-200 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <CardBody className="py-5">
        {loading ? (
          <div className="flex items-center justify-center py-14 gap-3">
            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            <span className="text-sm text-slate-400">Connecting to AI call system…</span>
          </div>
        ) : (

        // ══════════════════════════════════════════════════════════════════
        // TAB 1 — SETUP & SERVICE
        // ══════════════════════════════════════════════════════════════════
        tab === 'overview' ? (
          <div className="space-y-5">
            {!registered ? (
              <>
                <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-amber-800 mb-0.5">Not registered for AI calls</p>
                    <p className="text-xs text-amber-700 leading-relaxed">Register this booking to start automated check-in calls. The AI bot uses the booking&apos;s itinerary, hotels, and passenger details to create personalised conversations.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="form-label">Customer Phone *</label>
                    <div className="flex gap-2">
                      <input className="form-input flex-1 font-mono" placeholder="94771234567" value={intakeForm.phone} onChange={e => setIntakeForm(f => ({ ...f, phone: e.target.value }))} />
                      {leadName && <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 font-medium flex-shrink-0"><User className="w-3.5 h-3.5 text-slate-400" />{leadName.split(' ')[0]}</div>}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">International format without + (e.g. 94 = Sri Lanka · 91 = India)</p>
                  </div>

                  <div>
                    <label className="form-label">Schedule Mode</label>
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      {([
                        { key: 'agenda',   icon: '📅', title: 'Agenda', desc: 'One call per trip day at the set time. Retries if unanswered.' },
                        { key: 'interval', icon: '⏱', title: 'Interval', desc: 'Calls every N min/hours/days from start until answered.' },
                      ] as const).map(m => (
                        <button key={m.key} type="button" onClick={() => setIntakeForm(f => ({ ...f, mode: m.key }))}
                          className={`p-3 rounded-xl border-2 text-left transition-all ${intakeForm.mode === m.key ? 'border-violet-400 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <p className={`text-xs font-bold flex items-center gap-1.5 ${intakeForm.mode === m.key ? 'text-violet-700' : 'text-slate-600'}`}><span>{m.icon}</span> {m.title}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{m.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {intakeForm.mode === 'agenda' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="form-label">Daily Call Time (local)</label><input type="time" className="form-input" value={intakeForm.call_time} onChange={e => setIntakeForm(f => ({ ...f, call_time: e.target.value }))} /><p className="text-[10px] text-slate-400 mt-1">Default 18:00 = 6 PM</p></div>
                      <div><label className="form-label">Retry gap if unanswered (min)</label><input type="number" className="form-input" min="5" max="120" value={intakeForm.retry_gap_min} onChange={e => setIntakeForm(f => ({ ...f, retry_gap_min: e.target.value }))} /></div>
                    </div>
                  ) : (
                    <div><label className="form-label">Call every</label>
                      <div className="flex gap-2 mt-1">
                        <input type="number" className="form-input w-24" placeholder="10" min="1" value={intakeForm.interval_count} onChange={e => setIntakeForm(f => ({ ...f, interval_count: e.target.value }))} />
                        <select className="form-select flex-1" value={intakeForm.interval_unit} onChange={e => setIntakeForm(f => ({ ...f, interval_unit: e.target.value as 'minute' | 'hour' | 'day' }))}>
                          <option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Reconfirmation + Post-tour opt-in ── */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className={`rounded-xl border-2 p-3 transition-all ${reconfirmPlan.enabled ? 'border-sky-300 bg-gradient-to-br from-sky-50 to-blue-50/60' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${reconfirmPlan.enabled ? 'bg-sky-500 text-white' : 'bg-slate-200 text-slate-400'}`}><ClipboardCheck className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800">Pre-trip Reconfirmation</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">Reconfirms dates, flights &amp; travellers — captures any change requested.</p>
                      </div>
                      <ToggleSwitch on={reconfirmPlan.enabled} onChange={v => setReconfirmPlan(p => ({ ...p, enabled: v }))} />
                    </div>
                    {reconfirmPlan.enabled && (
                      <div className="grid grid-cols-2 gap-2 mt-2.5">
                        <div><label className="form-label !text-[10px]">Days before arrival</label><input type="number" min="1" max="30" className="form-input h-8 text-xs" value={reconfirmPlan.days_before} onChange={e => setReconfirmPlan(p => ({ ...p, days_before: e.target.value }))} /></div>
                        <div><label className="form-label !text-[10px]">Time <span className="text-slate-400 font-normal">(opt)</span></label><input type="time" className="form-input h-8 text-xs" value={reconfirmPlan.call_time} onChange={e => setReconfirmPlan(p => ({ ...p, call_time: e.target.value }))} /></div>
                      </div>
                    )}
                  </div>
                  <div className={`rounded-xl border-2 p-3 transition-all ${postTourPlan.enabled ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50/60' : 'border-slate-200 bg-slate-50'}`}>
                    <div className="flex items-start gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${postTourPlan.enabled ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-400'}`}><Award className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800">Post-tour Feedback</p>
                        <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">Checks they got home safely &amp; captures a 0–10 trip rating.</p>
                      </div>
                      <ToggleSwitch on={postTourPlan.enabled} onChange={v => setPostTourPlan(p => ({ ...p, enabled: v }))} />
                    </div>
                    {postTourPlan.enabled && (
                      <div className="grid grid-cols-2 gap-2 mt-2.5">
                        <div><label className="form-label !text-[10px]">Days after departure</label><input type="number" min="1" max="30" className="form-input h-8 text-xs" value={postTourPlan.days_after} onChange={e => setPostTourPlan(p => ({ ...p, days_after: e.target.value }))} /></div>
                        <div><label className="form-label !text-[10px]">Time <span className="text-slate-400 font-normal">(opt)</span></label><input type="time" className="form-input h-8 text-xs" value={postTourPlan.call_time} onChange={e => setPostTourPlan(p => ({ ...p, call_time: e.target.value }))} /></div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                  {permChip()}
                  <button onClick={registerBooking} disabled={intakeLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors shadow-sm">
                    {intakeLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</> : <><PhoneIncoming className="w-4 h-4" /> Register for AI Calls</>}
                  </button>
                  <button onClick={() => sendApproval()} disabled={approvalLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><MessageSquare className="w-4 h-4" /> WhatsApp Approval</>}
                  </button>
                </div>
              </>
            ) : editOpen ? (
              <div className="space-y-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Settings className="w-3.5 h-3.5 text-slate-500" /> Edit Call Settings</p>
                <div><label className="form-label">Phone Number</label><input className="form-input font-mono" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} /></div>
                <div><label className="form-label">Schedule Mode</label>
                  <select className="form-select" value={editForm.mode} onChange={e => setEditForm(f => ({ ...f, mode: e.target.value as 'agenda' | 'interval' }))}>
                    <option value="agenda">Agenda — one call per trip day</option>
                    <option value="interval">Interval — every N minutes / hours / days</option>
                  </select>
                </div>
                {editForm.mode === 'agenda' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="form-label">Call Time (local)</label><input type="time" className="form-input" value={editForm.call_time} onChange={e => setEditForm(f => ({ ...f, call_time: e.target.value }))} /></div>
                    <div><label className="form-label">Retry gap (min)</label><input type="number" className="form-input" min="5" value={editForm.retry_gap_min} onChange={e => setEditForm(f => ({ ...f, retry_gap_min: e.target.value }))} /></div>
                  </div>
                ) : (
                  <div><label className="form-label">Call every</label>
                    <div className="flex gap-2 mt-1">
                      <input type="number" className="form-input w-24" min="1" value={editForm.interval_count} onChange={e => setEditForm(f => ({ ...f, interval_count: e.target.value }))} />
                      <select className="form-select flex-1" value={editForm.interval_unit} onChange={e => setEditForm(f => ({ ...f, interval_unit: e.target.value as 'minute' | 'hour' | 'day' }))}>
                        <option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option>
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <button onClick={saveEdit} disabled={editLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                    {editLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditOpen(false)} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Call Phone</p>
                    <p className="text-sm font-mono font-bold text-slate-800">{service!.call_phone || '—'}</p>
                    <div className="mt-1">{permChip()}</div>
                  </div>
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Mode</p><p className="text-sm font-semibold text-slate-800 capitalize">{service!.schedule_mode}</p></div>
                  {service!.schedule_mode === 'agenda' ? (
                    <>
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Call Time</p><p className="text-sm font-bold text-slate-800">{service!.call_time || '18:00'}</p></div>
                      <div><p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Retry Gap</p><p className="text-sm font-bold text-slate-800">{service!.retry_gap_min ?? '—'} min</p></div>
                    </>
                  ) : (
                    <div className="col-span-2"><p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Interval</p><p className="text-sm font-bold text-slate-800">Every {service!.interval_count} {service!.interval_unit}</p></div>
                  )}
                </div>

                {config && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400 py-2 border-y border-slate-50">
                    <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Window: {config.call_window?.start}:00–{config.call_window?.end}:00 local</span>
                    <span>Max retries: {config.max_retries}</span>
                    <span>Retry gap: {config.retry_gap_min} min</span>
                    {config.retry_until_answered && <span className="text-violet-500">✓ Retries until answered</span>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button onClick={openEdit} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"><Settings className="w-3.5 h-3.5" /> Edit Settings</button>
                  {service!.status === 'active' ? (
                    <>
                      <button onClick={() => updateStatus('completed')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-600 text-xs font-semibold hover:bg-emerald-100 transition-colors border border-emerald-100"><CheckCircle2 className="w-3.5 h-3.5" /> Mark Completed</button>
                      <button onClick={() => updateStatus('cancelled')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors border border-red-100"><XCircle className="w-3.5 h-3.5" /> Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => updateStatus('active')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 text-violet-600 text-xs font-semibold hover:bg-violet-100 transition-colors border border-violet-100"><RefreshCw className="w-3.5 h-3.5" /> Reactivate</button>
                  )}
                  <button onClick={() => sendApproval()} disabled={approvalLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><MessageSquare className="w-3.5 h-3.5" /> WhatsApp Approval</>}
                  </button>
                </div>

                {/* ── Reconfirmation + Post-tour plan controls ── */}
                <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
                  <div className={`rounded-xl border p-3 ${service!.reconfirm_enabled ? 'border-sky-200 bg-sky-50/60' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <ClipboardCheck className={`w-4 h-4 ${service!.reconfirm_enabled ? 'text-sky-500' : 'text-slate-300'}`} />
                      <span className="text-xs font-bold text-slate-700">Reconfirmation</span>
                      {service!.reconfirm_enabled && service!.reconfirm_days_before != null && (
                        <span className="text-[10px] text-sky-600 font-semibold">−{service!.reconfirm_days_before}d{service!.reconfirm_call_time ? ` · ${service!.reconfirm_call_time}` : ''}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1.5">
                        {service!.reconfirm_enabled && schedule.some(s => s.phase === 'reconfirm') && (
                          <button type="button" disabled={specialBusy === 'reconfirm'} onClick={() => retrySpecial('reconfirm')} title="Place the reconfirmation call now"
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-60 transition-colors">
                            {specialBusy === 'reconfirm' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />} Call now
                          </button>
                        )}
                        {planBusy === 'reconfirm'
                          ? <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                          : <ToggleSwitch on={!!service!.reconfirm_enabled} onChange={v => updatePlan('reconfirm', { enabled: v, days_before: service!.reconfirm_days_before ?? 5 })} />}
                      </span>
                    </div>
                  </div>
                  <div className={`rounded-xl border p-3 ${service!.post_tour_enabled ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
                    <div className="flex items-center gap-2">
                      <Award className={`w-4 h-4 ${service!.post_tour_enabled ? 'text-amber-500' : 'text-slate-300'}`} />
                      <span className="text-xs font-bold text-slate-700">Post-tour Feedback</span>
                      {service!.post_tour_enabled && service!.post_tour_days_after != null && (
                        <span className="text-[10px] text-amber-600 font-semibold">+{service!.post_tour_days_after}d{service!.post_tour_call_time ? ` · ${service!.post_tour_call_time}` : ''}</span>
                      )}
                      <span className="ml-auto flex items-center gap-1.5">
                        {service!.post_tour_enabled && schedule.some(s => s.phase === 'post_tour') && (
                          <button type="button" disabled={specialBusy === 'post_tour'} onClick={() => retrySpecial('post_tour')} title="Place the post-tour feedback call now"
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-60 transition-colors">
                            {specialBusy === 'post_tour' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />} Call now
                          </button>
                        )}
                        {planBusy === 'post_tour'
                          ? <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                          : <ToggleSwitch on={!!service!.post_tour_enabled} onChange={v => updatePlan('post_tour', { enabled: v, days_after: service!.post_tour_days_after ?? 3 })} />}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ── Captured reconfirmation + post-tour results ── */}
                {((service!.reconfirmations?.length ?? 0) > 0 || (service!.post_tour?.length ?? 0) > 0) && (
                  <div className="space-y-2.5 pt-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" /> Captured on calls</p>
                    {(service!.reconfirmations ?? []).map(r => (
                      <ReconfirmCard key={`rc-${r.id}`} row={r} retryBusy={specialBusy === 'reconfirm'} onRetry={() => retrySpecial('reconfirm')} />
                    ))}
                    {(service!.post_tour ?? []).map(p => (
                      <PostTourCard key={`pt-${p.id}`} row={p} retryBusy={specialBusy === 'post_tour'} onRetry={() => retrySpecial('post_tour')} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

        // ══════════════════════════════════════════════════════════════════
        // TAB 2 — CALL SCHEDULE
        // ══════════════════════════════════════════════════════════════════
        ) : tab === 'schedule' ? (
          <div className="space-y-4">
            {!registered ? (
              <div className="py-10 text-center"><Calendar className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-sm text-slate-400 font-medium">Register the booking first</p></div>
            ) : (
              <>
                {editItem && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-3">
                    <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5"><Edit2 className="w-3.5 h-3.5" /> Edit Day {editItem.day_no}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="form-label">Date</label><input type="date" className="form-input" value={editItemForm.call_date} onChange={e => setEditItemForm(f => ({ ...f, call_date: e.target.value }))} /></div>
                      <div><label className="form-label">Exact Call Time</label><input type="datetime-local" className="form-input" value={editItemForm.scheduled_at} onChange={e => setEditItemForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
                      <div className="col-span-2"><label className="form-label">Day Brief (bot context)</label><input className="form-input" placeholder="e.g. Kandy — Temple of the Tooth" value={editItemForm.day_brief} onChange={e => setEditItemForm(f => ({ ...f, day_brief: e.target.value }))} /><p className="text-[10px] text-slate-400 mt-1">The AI bot uses this for personalised conversation</p></div>
                      {(editItem.status === 'skipped' || editItem.status === 'missed' || editItem.status === 'failed') && (
                        <div><label className="form-label">Status</label>
                          <select className="form-select" value={editItemForm.status} onChange={e => setEditItemForm(f => ({ ...f, status: e.target.value }))}>
                            <option value="">— keep current ({editItem.status}) —</option>
                            <option value="pending">Re-enable (pending)</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEditItem} disabled={editItemLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-60 transition-colors">
                        {editItemLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : 'Save'}
                      </button>
                      <button onClick={() => setEditItem(null)} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}

                {schedule.length === 0 ? (
                  <div className="py-8 text-center"><Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">No schedule items</p></div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {schedule.map(item => (
                      <ScheduleRow key={item.id} item={item} busy={scheduleBusy === item.id}
                        onCallNow={() => callNow(item.id)} onSkip={() => skipDay(item.id)}
                        onDelete={() => deleteScheduleItem(item.id)} onEdit={() => openEditItem(item)} />
                    ))}
                  </div>
                )}

                {!addDayOpen ? (
                  <button onClick={() => setAddDayOpen(true)} className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 font-semibold transition-colors mt-2">
                    <Plus className="w-3.5 h-3.5" /> Add Extra Day Call
                  </button>
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-violet-500" /> Add Extra Day Call</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="form-label">Date *</label><input type="date" className="form-input" value={addDayForm.call_date} onChange={e => setAddDayForm(f => ({ ...f, call_date: e.target.value }))} /></div>
                      <div>
                        <label className="form-label">Day No. <span className="font-normal text-slate-400">(auto if blank)</span></label>
                        <input type="number" min="1" className="form-input" placeholder={String(schedule.length > 0 ? Math.max(...schedule.map(s => s.day_no)) + 1 : 1)} value={addDayForm.day_no} onChange={e => setAddDayForm(f => ({ ...f, day_no: e.target.value }))} />
                      </div>
                      <div><label className="form-label">Exact Call Time (optional)</label><input type="datetime-local" className="form-input" value={addDayForm.scheduled_at} onChange={e => setAddDayForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
                      <div><label className="form-label">Brief (bot context)</label><input className="form-input" placeholder="e.g. Extra check-in after arrival" value={addDayForm.brief} onChange={e => setAddDayForm(f => ({ ...f, brief: e.target.value }))} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addDayCall} disabled={addDayLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                        {addDayLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : <><Plus className="w-3.5 h-3.5" /> Add</>}
                      </button>
                      <button onClick={() => { setAddDayOpen(false); setAddDayForm({ call_date: '', brief: '', scheduled_at: '', day_no: '' }) }} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        // ══════════════════════════════════════════════════════════════════
        // TAB 3 — QUICK CALL
        // ══════════════════════════════════════════════════════════════════
        ) : (
          <div className="space-y-5">

            {/* ── Parameters being sent — always visible ── */}
            <div className="rounded-xl border border-violet-200 bg-violet-50 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-100 bg-violet-100/60">
                <BookOpen className="w-3.5 h-3.5 text-violet-600" />
                <p className="text-xs font-bold text-violet-800">Parameters sent to TE API — <code className="font-mono text-violet-700">POST /quick-call</code></p>
              </div>
              <div className="px-4 py-3 space-y-1.5 text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-28">bookingRef</span>
                  <span className="font-bold text-violet-700 bg-white border border-violet-200 px-2 py-0.5 rounded-lg">{bookingRef}</span>
                  <span className="text-[10px] text-violet-500 font-sans">← always the current booking (VN/IS number)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-28">to</span>
                  <span className="text-slate-700">{quickForm.to.replace(/\D/g, '') || <span className="text-red-400">required</span>}</span>
                  <span className="text-[10px] text-slate-400 font-sans">← phone to dial</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-28">name</span>
                  <span className="text-slate-700">{quickForm.name || '—'}</span>
                  <span className="text-[10px] text-slate-400 font-sans">← agent greets them by this</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 w-28">reason</span>
                  <span className="text-slate-700 truncate max-w-xs">{quickForm.reason.trim() || '— (general check-in)'}</span>
                </div>
              </div>
              <div className="px-4 py-2 border-t border-violet-100 bg-violet-100/40">
                <p className="text-[10px] text-violet-600 leading-relaxed">
                  The AI agent reads <strong>{bookingRef}</strong> from the portal DB and gets: customer name, arrival/departure dates, day-by-day itinerary, hotels, flights, and passenger list — before dialling.
                </p>
              </div>
            </div>

            {/* ── Form fields ── */}
            <div className="space-y-4">
              <div>
                <label className="form-label">Phone to Dial *</label>
                <input
                  className="form-input font-mono"
                  placeholder="94771234567  (country code, no +)"
                  value={quickForm.to}
                  onChange={e => setQuickForm(f => ({ ...f, to: e.target.value }))}
                />
                <p className="text-[10px] text-slate-400 mt-1">International format without + (94 = Sri Lanka · 91 = India)</p>
                {quickForm.to.replace(/\D/g, '') === permPhone && <div className="mt-1.5">{permChip()}</div>}
              </div>

              <div>
                <label className="form-label">Customer Name <span className="text-slate-400 font-normal">(agent greets them by this)</span></label>
                <input
                  className="form-input"
                  value={quickForm.name}
                  onChange={e => setQuickForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="form-label">
                  Reason for Call
                  <span className="text-slate-400 font-normal ml-1">(optional — agent opens around this)</span>
                </label>
                <textarea
                  className="form-input min-h-[70px] resize-none"
                  placeholder="e.g. Confirm their airport pickup moved to 6:00 AM and check they're happy with it."
                  value={quickForm.reason}
                  onChange={e => setQuickForm(f => ({ ...f, reason: e.target.value }))}
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Leave blank for a general trip check-in. The agent always has the full {bookingRef} itinerary regardless.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={placeQuickCall}
                disabled={quickLoading || !quickForm.to.replace(/\D/g, '')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {quickLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Dialling…</>
                  : <><PhoneCall className="w-4 h-4" /> Place Quick Call</>}
              </button>
              <button
                onClick={() => sendApproval(quickForm.to)}
                disabled={approvalLoading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60 transition-colors"
              >
                {approvalLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                  : <><MessageSquare className="w-4 h-4 text-green-600" /> WhatsApp Approval</>}
              </button>
            </div>

            {quickResult && (
              <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${quickResult.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                {quickResult.ok
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  : <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                <div>
                  {quickResult.message && (
                    <p className={`text-xs font-semibold ${quickResult.ok ? 'text-emerald-800' : 'text-amber-800'}`}>{quickResult.message}</p>
                  )}
                  {quickResult.references_itinerary && (
                    <p className="text-[11px] text-emerald-700 mt-1 font-semibold">✓ Agent has the full {quickResult.booking_ref ?? bookingRef} itinerary</p>
                  )}
                  {quickResult.note && (
                    <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{quickResult.note}</p>
                  )}
                  {quickResult.channel_id && (
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">channel_id: {quickResult.channel_id}</p>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              <p className="text-[10px] text-slate-400 leading-relaxed">
                <strong>Note:</strong> Quick calls are logged like every other call — the conversation, recording and any captured feedback appear in the &ldquo;AI Call Transcripts&rdquo; card below a few minutes after the call ends.
              </p>
            </div>
          </div>

        )
        )}
      </CardBody>
    </Card>
  )
}
