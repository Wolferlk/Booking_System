'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Phone, PhoneCall, PhoneIncoming, PhoneMissed,
  Calendar, RefreshCw, Plus, Play, Pause,
  SkipForward, Trash2, Edit2, CheckCircle2,
  XCircle, Clock, Mic, ChevronDown, ChevronUp,
  AlertCircle, Loader2, MessageSquare, Volume2, Settings,
  User, Star, MessageCircle, Bot, Info,
  ChevronRight, Hash, BookOpen, Megaphone,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

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
}

interface TEScheduleItem {
  id: number
  service_id: number
  booking_ref: string
  call_date: string
  scheduled_at?: string | null
  day_no: number
  phase?: 'arrival' | 'mid' | 'departure' | null
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

interface TEJob {
  id: number
  name: string
  phone: string
  customer_name: string
  campaign_id?: number | null
  booking_ref?: string | null
  start_at: string
  interval_count?: number | null
  interval_unit?: string | null
  end_at?: string | null
  max_runs?: number | null
  next_run_at?: string | null
  last_run_at?: string | null
  runs: number
  status: 'scheduled' | 'paused' | 'done' | 'cancelled'
  respect_window: boolean
  last_result?: string | null
  conversation_id?: string | null
  context?: Record<string, unknown>
}

interface TECampaign {
  id: number
  name: string
  slug?: string
  approach?: string | null
  collect?: string | null
  first_message?: string | null
  is_active: boolean
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

// ─── Feedback Data View ───────────────────────────────────────────────────────

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  happy:    'bg-emerald-100 text-emerald-700 border-emerald-200',
  neutral:  'bg-amber-50 text-amber-600 border-amber-200',
  negative: 'bg-red-100 text-red-600 border-red-200',
}

function okChip(val: string | null | undefined) {
  if (!val) return null
  const v = val.toLowerCase()
  if (v === 'good' || v === 'yes' || v === 'ok') return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (v === 'bad' || v === 'no') return 'text-red-600 bg-red-50 border-red-200'
  return 'text-slate-500 bg-slate-50 border-slate-200'
}

function FeedbackDataView({ fb }: { fb: TEFeedback }) {
  const ratingItems = [
    { label: 'Hotel', val: fb.hotel_ok },
    { label: 'Meals', val: fb.meals_ok },
    { label: 'Driver', val: fb.driver_ok },
    { label: 'Vehicle', val: fb.vehicle_ok },
  ].filter(i => i.val)

  const hasStructured = !!(fb.highlights || fb.issues || fb.summary || ratingItems.length > 0)
  const hasRaw = fb.raw && Object.keys(fb.raw).length > 0

  if (!hasStructured && !hasRaw) {
    return <p className="text-xs text-slate-400 italic py-2 text-center">No feedback data from this call</p>
  }

  return (
    <div className="space-y-2.5">
      {ratingItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ratingItems.map(({ label, val }) => {
            const cls = okChip(val)
            return cls ? (
              <span key={label} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
                {label}: {val}
              </span>
            ) : null
          })}
        </div>
      )}
      {fb.highlights && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-1 flex items-center gap-1"><Star className="w-2.5 h-2.5" /> Highlights</p>
          <p className="text-xs text-slate-700 leading-relaxed">{fb.highlights}</p>
        </div>
      )}
      {fb.issues && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-bold text-red-500 uppercase tracking-wide mb-1 flex items-center gap-1"><AlertCircle className="w-2.5 h-2.5" /> Issues</p>
          <p className="text-xs text-slate-700 leading-relaxed">{fb.issues}</p>
        </div>
      )}
      {fb.summary && (
        <div className="bg-violet-50 border border-violet-100 rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide mb-1">AI Summary</p>
          <p className="text-xs text-slate-700 leading-relaxed">{fb.summary}</p>
        </div>
      )}
      {!hasStructured && hasRaw && (
        <div className="space-y-1.5">
          {Object.entries(fb.raw!).filter(([, v]) => v != null && v !== '').map(([k, v]) => (
            <div key={k} className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{k.replace(/_/g, ' ')}</p>
              <p className="text-xs text-slate-700">{String(v)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Call History Card ────────────────────────────────────────────────────────

function CallHistoryCard({ fb, scheduleItems }: { fb: TEFeedback; scheduleItems: TEScheduleItem[] }) {
  const [open, setOpen] = useState(false)
  const [activeView, setActiveView] = useState<'data' | 'transcript'>('data')
  const schedule = scheduleItems.find(s => s.id === fb.schedule_id)
  const phaseLabel: Record<string, string> = { arrival: 'Arrival', mid: 'Mid-Trip', departure: 'Departure' }

  const callResult = schedule?.status === 'answered' ? 'answered'
    : schedule?.status === 'missed' ? 'missed'
    : (fb.highlights || fb.hotel_ok) ? 'answered' : 'missed'

  const hasTranscript = !!(fb.transcript && (Array.isArray(fb.transcript) ? fb.transcript.length > 0 : String(fb.transcript).trim()))
  const hasFeedback   = !!(fb.highlights || fb.issues || fb.summary || fb.hotel_ok || fb.meals_ok || fb.driver_ok || fb.vehicle_ok || (fb.raw && Object.keys(fb.raw).length > 0))
  const sentimentStyle = fb.sentiment ? (SENTIMENT_STYLES[fb.sentiment] ?? null) : null

  return (
    <div className={`border rounded-xl overflow-hidden transition-all ${open ? 'border-violet-200 shadow-sm' : 'border-slate-100 hover:border-slate-200'}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left" onClick={() => setOpen(v => !v)}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${callResult === 'answered' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-400'}`}>
          {callResult === 'answered' ? <Phone className="w-3.5 h-3.5" /> : <PhoneMissed className="w-3.5 h-3.5" />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-800">{fb.call_date ? fmtDate(fb.call_date) : fmtDateTime(fb.created_at)}</span>
            {fb.day_no != null && <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded-full">Day {fb.day_no}</span>}
            {schedule?.phase && <span className="text-[9px] text-violet-500 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full font-semibold">{phaseLabel[schedule.phase] ?? schedule.phase}</span>}
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${STATUS_STYLES[callResult] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>{callResult.toUpperCase()}</span>
            {sentimentStyle && <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${sentimentStyle}`}>{fb.sentiment!.toUpperCase()}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
            <span>{fmtDateTime(fb.created_at)}</span>
            {schedule && schedule.attempts > 0 && <span>{schedule.attempts} attempt{schedule.attempts !== 1 ? 's' : ''}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {hasTranscript && <span className="hidden sm:flex text-[9px] text-violet-500 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full font-semibold items-center gap-1"><MessageCircle className="w-2.5 h-2.5" /> transcript</span>}
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {schedule?.day_brief && (
            <div className="px-4 py-2.5 bg-violet-50/60 border-b border-violet-100">
              <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide mb-0.5">Bot Context</p>
              <p className="text-xs text-slate-700 leading-relaxed">{schedule.day_brief}</p>
            </div>
          )}
          {schedule?.error && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-100">
              <p className="text-[10px] font-bold text-red-500 uppercase mb-0.5">Error</p>
              <p className="text-xs text-red-700">{schedule.error}</p>
            </div>
          )}
          {hasFeedback && hasTranscript && (
            <div className="flex border-b border-slate-100 px-4">
              {([['data', '📋 Feedback'], ['transcript', '💬 Conversation']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setActiveView(v)}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${activeView === v ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="px-4 py-3">
            {(!hasTranscript || activeView === 'data') && <FeedbackDataView fb={fb} />}
            {((!hasFeedback && hasTranscript) || activeView === 'transcript') && hasTranscript && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageCircle className="w-3 h-3 text-violet-400" /> Full Conversation</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3"><TranscriptViewer transcript={fb.transcript} /></div>
              </div>
            )}
          </div>
        </div>
      )}
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
  const canCall = item.status === 'pending' || item.status === 'missed'

  return (
    <div className={`flex items-center gap-2 py-3 border-b border-slate-50 last:border-0 group ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${isToday ? 'bg-violet-600 text-white' : (item.status === 'answered' || item.status === 'done') ? 'bg-emerald-100 text-emerald-600' : isPast ? 'bg-slate-100 text-slate-400' : 'bg-slate-50 text-slate-500 border border-slate-200'}`}>
        {item.day_no}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-mono font-semibold ${isToday ? 'text-violet-700' : 'text-slate-700'}`}>{fmtDate(item.call_date)}</span>
          {item.phase && <span className="text-xs">{phaseIcons[item.phase] ?? ''}</span>}
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

// ─── Job Row ─────────────────────────────────────────────────────────────────

function JobRow({ job, campaigns, busy, onRun, onPause, onResume, onCancel, onDelete }: {
  job: TEJob; campaigns: TECampaign[]; busy: boolean
  onRun: () => void; onPause: () => void; onResume: () => void; onCancel: () => void; onDelete: () => void
}) {
  const cadence = job.interval_count && job.interval_unit ? `Every ${job.interval_count} ${job.interval_unit}` : 'One-off'
  const campaign = campaigns.find(c => c.id === job.campaign_id)

  return (
    <div className={`flex items-start gap-3 p-3 rounded-xl border border-slate-100 group hover:border-slate-200 ${busy ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-800 truncate">{job.name}</span>
          <span className={statusBadge(job.status, true)}>{job.status.toUpperCase()}</span>
          <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full font-medium">{cadence}</span>
        </div>
        {campaign && <p className="text-[10px] text-violet-500 mt-0.5 flex items-center gap-1"><Megaphone className="w-2.5 h-2.5" />{campaign.name}</p>}
        <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 flex-wrap">
          <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" />{job.phone}</span>
          <span>{job.runs} run{job.runs !== 1 ? 's' : ''}</span>
          {job.next_run_at && job.status === 'scheduled' && <span className="text-blue-500 flex items-center gap-1"><Clock className="w-2.5 h-2.5" />Next: {fmtDateTime(job.next_run_at)}</span>}
          {job.last_run_at && <span>Last: {fmtDateTime(job.last_run_at)}</span>}
        </div>
        {job.last_result && <p className="text-[10px] text-slate-400 mt-0.5 italic">{job.last_result}</p>}
      </div>
      <div className="flex items-center gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {['scheduled', 'paused'].includes(job.status) && <button onClick={onRun} title="Run now" className="p-1.5 rounded-lg hover:bg-green-50 text-slate-300 hover:text-green-600 transition-colors"><Play className="w-3.5 h-3.5" /></button>}
        {job.status === 'scheduled' && <button onClick={onPause} title="Pause" className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-300 hover:text-amber-500 transition-colors"><Pause className="w-3.5 h-3.5" /></button>}
        {job.status === 'paused' && <button onClick={onResume} title="Resume" className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-300 hover:text-blue-500 transition-colors"><RefreshCw className="w-3.5 h-3.5" /></button>}
        {!['done', 'cancelled'].includes(job.status) && <button onClick={onCancel} title="Cancel" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><XCircle className="w-3.5 h-3.5" /></button>}
        <button onClick={onDelete} title="Delete" className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

type Tab = 'overview' | 'schedule' | 'jobs' | 'quickcall' | 'history'

export default function TravellerExperiencePanel({ bookingRef, booking }: Props) {
  const [tab, setTab]         = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [service, setService] = useState<TEService | null>(null)
  const [config, setConfig]   = useState<TEConfig | null>(null)

  // feedback
  const [feedbackList, setFeedbackList] = useState<TEFeedback[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)

  // jobs + campaigns
  const [jobs, setJobs]               = useState<TEJob[]>([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [campaigns, setCampaigns]     = useState<TECampaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)

  const lead        = booking.passengers?.find(p => p.isLead) ?? booking.passengers?.[0]
  const defaultPhone = (booking.contactWhatsapp ?? booking.contactPhone ?? lead?.contact ?? '') as string
  const leadName    = (lead?.name ?? '') as string

  // ── Intake form ───────────────────────────────────────────────────────────
  const [intakeForm, setIntakeForm] = useState({ phone: defaultPhone, mode: 'agenda' as 'agenda' | 'interval', call_time: '18:00', interval_count: '10', interval_unit: 'minute' as 'minute' | 'hour' | 'day', retry_gap_min: '15' })
  const [intakeLoading, setIntakeLoading] = useState(false)

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
  const [addDayForm, setAddDayForm]     = useState({ call_date: '', brief: '', scheduled_at: '' })
  const [addDayLoading, setAddDayLoading] = useState(false)

  // ── Jobs ──────────────────────────────────────────────────────────────────
  const [newJobOpen, setNewJobOpen] = useState(false)
  const [jobForm, setJobForm]       = useState({ name: '', phone: defaultPhone, customer_name: leadName, campaign_id: '' as string, start_at: 'now', interval_count: '', interval_unit: '' as '' | 'minute' | 'hour' | 'day', max_runs: '', end_at: '', respect_window: false })
  const [jobLoading, setJobLoading] = useState(false)
  const [jobBusy, setJobBusy]       = useState<number | null>(null)

  // ── Campaigns ─────────────────────────────────────────────────────────────
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [campaignForm, setCampaignForm] = useState({ name: '', approach: '', collect: '', first_message: '', is_active: true })
  const [campaignLoading, setCampaignLoading] = useState(false)
  const [editCampaign, setEditCampaign] = useState<TECampaign | null>(null)

  // ── Quick Call ────────────────────────────────────────────────────────────
  const [quickForm, setQuickForm] = useState({ to: defaultPhone, name: leadName, reason: '' })
  const [quickLoading, setQuickLoading] = useState(false)
  const [quickResult, setQuickResult]   = useState<{ ok: boolean; message?: string; note?: string; channel_id?: string } | null>(null)

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

  // ── Load feedback ─────────────────────────────────────────────────────────
  const loadFeedback = useCallback(async () => {
    if (!service?.id) return
    setFeedbackLoading(true)
    try {
      const res = await teProxy('feedback', 'GET', undefined, { serviceId: String(service.id) })
      setFeedbackList(res.feedback ?? res.data ?? [])
    } catch { /* ignore */ } finally { setFeedbackLoading(false) }
  }, [service?.id])

  useEffect(() => { if (tab === 'history' && service?.id) loadFeedback() }, [tab, service?.id, loadFeedback])

  // ── Load jobs + campaigns ─────────────────────────────────────────────────
  const loadJobs = useCallback(async () => {
    setJobsLoading(true)
    try {
      const res = await teProxy('jobs', 'GET', undefined, { limit: '200' })
      const all: TEJob[] = res.jobs ?? res.data ?? []
      setJobs(all.filter(j => j.booking_ref === bookingRef || (j.name ?? '').includes(bookingRef)))
    } catch { /* ignore */ } finally { setJobsLoading(false) }
  }, [bookingRef])

  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    try {
      const res = await teProxy('campaigns')
      setCampaigns(res.campaigns ?? res.data ?? [])
    } catch { /* ignore */ } finally { setCampaignsLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'jobs') { loadJobs(); loadCampaigns() } }, [tab, loadJobs, loadCampaigns])

  // ── Register ──────────────────────────────────────────────────────────────
  async function registerBooking() {
    if (!intakeForm.phone) { toast.error('Phone number is required'); return }
    setIntakeLoading(true)
    try {
      const body: Record<string, unknown> = {
        bookingRef,
        phone: intakeForm.phone.replace(/\D/g, ''),
        schedule: {
          mode: intakeForm.mode,
          call_time: intakeForm.call_time,
          retry_gap_min: Number(intakeForm.retry_gap_min) || 15,
          ...(intakeForm.mode === 'interval' && { interval_count: Number(intakeForm.interval_count) || 10, interval_unit: intakeForm.interval_unit, start_at: 'now' }),
        },
      }
      const res = await teProxy('intake', 'POST', body)
      if (res.ok === false && !res.service) throw new Error(res.message ?? 'Registration failed')
      toast.success(`Registered — ${res.schedule_inserted ?? 0} day${res.schedule_inserted !== 1 ? 's' : ''} scheduled`)
      await loadService()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to register') }
    finally { setIntakeLoading(false) }
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
  async function sendApproval() {
    const phone = (service?.call_phone || intakeForm.phone).replace(/\D/g, '')
    if (!phone) { toast.error('Enter a phone number first'); return }
    setApprovalLoading(true)
    try {
      const res = await teProxy('approval', 'POST', { to: phone, name: leadName || 'Valued Customer' })
      if (res.already_allowed) toast.success('Customer already allowed WhatsApp calls ✓')
      else toast.success(res.message ?? 'Approval request sent — awaiting customer confirmation')
    } catch { toast.error('Failed to send approval request') }
    finally { setApprovalLoading(false) }
  }

  // ── Schedule actions ──────────────────────────────────────────────────────
  async function callNow(id: number) {
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
      const body: Record<string, unknown> = { call_date: addDayForm.call_date }
      if (addDayForm.brief) body.brief = addDayForm.brief
      if (addDayForm.scheduled_at) body.scheduled_at = new Date(addDayForm.scheduled_at).toISOString()
      const res = await teProxy(`services/${bookingRef}/schedule`, 'POST', body)
      if (res.ok === false && !res.schedule) throw new Error(res.message ?? 'Failed')
      toast.success('Day-call added')
      setAddDayOpen(false)
      setAddDayForm({ call_date: '', brief: '', scheduled_at: '' })
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
        setQuickResult({ ok: true, message: res.message, note: res.note, channel_id: res.channel_id })
        toast.success(`Quick call placed to ${phone} — agent has ${bookingRef} itinerary`)
      }
    } catch { toast.error('Quick call failed') } finally { setQuickLoading(false) }
  }

  // ── Jobs ──────────────────────────────────────────────────────────────────
  async function createJob() {
    if (!jobForm.name.trim()) { toast.error('Job name is required'); return }
    if (!jobForm.phone.trim()) { toast.error('Phone number is required'); return }
    setJobLoading(true)
    try {
      const body: Record<string, unknown> = {
        name: jobForm.name.trim(), phone: jobForm.phone.replace(/\D/g, ''),
        customer_name: jobForm.customer_name || leadName || 'Guest',
        booking_ref: bookingRef, start_at: jobForm.start_at || 'now',
        respect_window: jobForm.respect_window,
      }
      if (jobForm.campaign_id) body.campaign_id = Number(jobForm.campaign_id)
      if (jobForm.interval_count && jobForm.interval_unit) { body.interval_count = Number(jobForm.interval_count); body.interval_unit = jobForm.interval_unit }
      if (jobForm.max_runs) body.max_runs = Number(jobForm.max_runs)
      if (jobForm.end_at) body.end_at = new Date(jobForm.end_at).toISOString()
      const res = await teProxy('jobs', 'POST', body)
      if (!res.job) throw new Error(res.message ?? 'Failed')
      toast.success(`Job "${jobForm.name}" created`)
      setNewJobOpen(false)
      setJobForm({ name: '', phone: defaultPhone, customer_name: leadName, campaign_id: '', start_at: 'now', interval_count: '', interval_unit: '', max_runs: '', end_at: '', respect_window: false })
      await loadJobs()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to create job') }
    finally { setJobLoading(false) }
  }

  async function jobAction(id: number, action: 'run' | 'pause' | 'resume' | 'cancel') {
    setJobBusy(id)
    try {
      const res = await teProxy(`jobs/${id}/${action}`, 'POST')
      toast.success(res.message ?? `Job ${action}`)
      await loadJobs()
    } catch { toast.error(`Failed to ${action} job`) } finally { setJobBusy(null) }
  }

  async function deleteJob(id: number) {
    if (!confirm('Delete this job?')) return
    setJobBusy(id)
    try { await teProxy(`jobs/${id}`, 'DELETE'); toast.success('Job deleted'); await loadJobs() }
    catch { toast.error('Failed to delete') } finally { setJobBusy(null) }
  }

  // ── Campaigns ─────────────────────────────────────────────────────────────
  async function saveCampaign() {
    if (!campaignForm.name.trim()) { toast.error('Campaign name is required'); return }
    setCampaignLoading(true)
    try {
      const body = { name: campaignForm.name.trim(), approach: campaignForm.approach || undefined, collect: campaignForm.collect || undefined, first_message: campaignForm.first_message || undefined, is_active: campaignForm.is_active }
      let res: Record<string, unknown>
      if (editCampaign) {
        res = await teProxy(`campaigns/${editCampaign.id}`, 'PATCH', body)
        toast.success('Campaign updated')
      } else {
        res = await teProxy('campaigns', 'POST', body)
        toast.success('Campaign created')
      }
      if (!res.campaign && res.ok === false) throw new Error(String(res.message ?? 'Failed'))
      setCampaignOpen(false)
      setEditCampaign(null)
      setCampaignForm({ name: '', approach: '', collect: '', first_message: '', is_active: true })
      await loadCampaigns()
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Failed to save campaign') }
    finally { setCampaignLoading(false) }
  }

  async function deleteCampaign(id: number) {
    if (!confirm('Delete this campaign?')) return
    try { await teProxy(`campaigns/${id}`, 'DELETE'); toast.success('Campaign deleted'); await loadCampaigns() }
    catch { toast.error('Failed to delete campaign') }
  }

  function openEditCampaign(c: TECampaign) {
    setEditCampaign(c)
    setCampaignForm({ name: c.name, approach: c.approach ?? '', collect: c.collect ?? '', first_message: c.first_message ?? '', is_active: c.is_active })
    setCampaignOpen(true)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const schedule       = service?.schedule ?? []
  const registered     = service !== null
  const allFeedback    = feedbackList.length > 0 ? feedbackList : (service?.feedback ?? [])
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
            <h3 className="text-sm font-bold text-slate-900">AI Auto-Call Bot</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Traveller Experience · {bookingRef}</p>
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
          <button onClick={() => { loadService(true); if (tab === 'jobs') { loadJobs(); loadCampaigns() } if (tab === 'history') loadFeedback() }}
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
          { key: 'overview',  label: 'Setup & Service' },
          { key: 'schedule',  label: 'Schedule', count: schedule.length },
          { key: 'jobs',      label: 'Custom Jobs', count: jobs.length > 0 ? jobs.length : undefined },
          { key: 'quickcall', label: 'Quick Call' },
          { key: 'history',   label: 'Call History', count: allFeedback.length > 0 ? allFeedback.length : undefined },
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
                    <p className="text-xs text-amber-700 leading-relaxed">Register this booking to start automated check-in calls. The AI bot uses the booking's itinerary, hotels, and passenger details to create personalised conversations.</p>
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

                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                  <button onClick={registerBooking} disabled={intakeLoading}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors shadow-sm">
                    {intakeLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Registering…</> : <><PhoneIncoming className="w-4 h-4" /> Register for AI Calls</>}
                  </button>
                  <button onClick={sendApproval} disabled={approvalLoading}
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
                  <div><p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-0.5">Call Phone</p><p className="text-sm font-mono font-bold text-slate-800">{service!.call_phone || '—'}</p></div>
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
                  <button onClick={sendApproval} disabled={approvalLoading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-60 transition-colors">
                    {approvalLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><MessageSquare className="w-3.5 h-3.5" /> WhatsApp Approval</>}
                  </button>
                </div>
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
                    <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-violet-500" /> Add Day Call</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="form-label">Date *</label><input type="date" className="form-input" value={addDayForm.call_date} onChange={e => setAddDayForm(f => ({ ...f, call_date: e.target.value }))} /></div>
                      <div><label className="form-label">Exact Time (optional)</label><input type="datetime-local" className="form-input" value={addDayForm.scheduled_at} onChange={e => setAddDayForm(f => ({ ...f, scheduled_at: e.target.value }))} /></div>
                      <div className="col-span-2"><label className="form-label">Brief</label><input className="form-input" placeholder="e.g. Extra check-in after arrival" value={addDayForm.brief} onChange={e => setAddDayForm(f => ({ ...f, brief: e.target.value }))} /></div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addDayCall} disabled={addDayLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                        {addDayLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Adding…</> : <><Plus className="w-3.5 h-3.5" /> Add</>}
                      </button>
                      <button onClick={() => { setAddDayOpen(false); setAddDayForm({ call_date: '', brief: '', scheduled_at: '' }) }} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

        // ══════════════════════════════════════════════════════════════════
        // TAB 3 — CUSTOM JOBS + CAMPAIGNS
        // ══════════════════════════════════════════════════════════════════
        ) : tab === 'jobs' ? (
          <div className="space-y-5">
            {/* ── Campaigns section ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5 text-violet-500" /> Campaigns <span className="text-[10px] font-normal text-slate-400">(reusable call scripts)</span></p>
                {!campaignOpen && <button onClick={() => { setEditCampaign(null); setCampaignForm({ name: '', approach: '', collect: '', first_message: '', is_active: true }); setCampaignOpen(true) }} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold"><Plus className="w-3 h-3" /> New</button>}
              </div>

              {campaignOpen && (
                <div className="p-4 bg-violet-50 border border-violet-200 rounded-xl space-y-3 mb-3">
                  <p className="text-xs font-bold text-violet-800">{editCampaign ? `Edit: ${editCampaign.name}` : 'New Campaign'}</p>
                  <div><label className="form-label">Name *</label><input className="form-input" value={campaignForm.name} onChange={e => setCampaignForm(f => ({ ...f, name: e.target.value }))} /></div>
                  <div><label className="form-label">Approach <span className="text-slate-400 font-normal">(how the agent should open + steer)</span></label><textarea className="form-input min-h-[60px] resize-none" value={campaignForm.approach} onChange={e => setCampaignForm(f => ({ ...f, approach: e.target.value }))} /></div>
                  <div><label className="form-label">Collect <span className="text-slate-400 font-normal">(what data to gather)</span></label><textarea className="form-input min-h-[50px] resize-none" placeholder="Rating out of 10; best moment; anything to improve" value={campaignForm.collect} onChange={e => setCampaignForm(f => ({ ...f, collect: e.target.value }))} /></div>
                  <div><label className="form-label">First Message <span className="text-slate-400 font-normal">(opening line)</span></label><input className="form-input" placeholder="Hi! This is Apple Holidays calling…" value={campaignForm.first_message} onChange={e => setCampaignForm(f => ({ ...f, first_message: e.target.value }))} /></div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="w-3.5 h-3.5 rounded accent-violet-600" checked={campaignForm.is_active} onChange={e => setCampaignForm(f => ({ ...f, is_active: e.target.checked }))} /><span className="text-xs text-slate-700">Active</span></label>
                  <div className="flex gap-2">
                    <button onClick={saveCampaign} disabled={campaignLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                      {campaignLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : editCampaign ? 'Update Campaign' : 'Create Campaign'}
                    </button>
                    <button onClick={() => { setCampaignOpen(false); setEditCampaign(null) }} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                  </div>
                </div>
              )}

              {campaignsLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400" /> Loading campaigns…</div>
              ) : campaigns.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-2">No campaigns yet — create one to guide the agent's approach on calls</p>
              ) : (
                <div className="space-y-1.5">
                  {campaigns.map(c => (
                    <div key={c.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 group hover:border-slate-200">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">{c.name}</span>
                          {!c.is_active && <span className="text-[9px] text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded-full">inactive</span>}
                        </div>
                        {c.approach && <p className="text-[10px] text-slate-400 truncate mt-0.5">{c.approach}</p>}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditCampaign(c)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-300 hover:text-slate-600 transition-colors"><Edit2 className="w-3 h-3" /></button>
                        <button onClick={() => deleteCampaign(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-slate-200 hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><PhoneCall className="w-3.5 h-3.5 text-violet-500" /> Call Jobs</p>
                {!newJobOpen && <button onClick={() => setNewJobOpen(true)} className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-semibold"><Plus className="w-3 h-3" /> New Job</button>}
              </div>

              {newJobOpen && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 mb-3">
                  <p className="text-xs font-bold text-slate-800">New Call Job</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2"><label className="form-label">Job Name *</label><input className="form-input" placeholder="e.g. Post-arrival follow-up" value={jobForm.name} onChange={e => setJobForm(f => ({ ...f, name: e.target.value }))} /></div>
                    <div><label className="form-label">Phone *</label><input className="form-input font-mono" placeholder="94771234567" value={jobForm.phone} onChange={e => setJobForm(f => ({ ...f, phone: e.target.value }))} /></div>
                    <div><label className="form-label">Customer Name</label><input className="form-input" value={jobForm.customer_name} onChange={e => setJobForm(f => ({ ...f, customer_name: e.target.value }))} /></div>
                    <div className="col-span-2">
                      <label className="form-label">Campaign <span className="text-slate-400 font-normal">(optional — guides agent approach)</span></label>
                      <select className="form-select" value={jobForm.campaign_id} onChange={e => setJobForm(f => ({ ...f, campaign_id: e.target.value }))}>
                        <option value="">— no campaign (generic call) —</option>
                        {campaigns.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div><label className="form-label">Start At</label><input className="form-input" placeholder="now  or  ISO datetime" value={jobForm.start_at} onChange={e => setJobForm(f => ({ ...f, start_at: e.target.value }))} /></div>
                    <div><label className="form-label">Max Runs <span className="text-slate-400 font-normal">(blank = unlimited)</span></label><input type="number" className="form-input" placeholder="e.g. 3" min="1" value={jobForm.max_runs} onChange={e => setJobForm(f => ({ ...f, max_runs: e.target.value }))} /></div>
                    <div><label className="form-label">End At <span className="text-slate-400 font-normal">(optional stop time)</span></label><input type="datetime-local" className="form-input" value={jobForm.end_at} onChange={e => setJobForm(f => ({ ...f, end_at: e.target.value }))} /></div>
                    <div className="col-span-2"><label className="form-label">Repeat Interval <span className="text-slate-400 font-normal">(blank = one-off)</span></label>
                      <div className="flex gap-2">
                        <input type="number" className="form-input w-28" placeholder="5" min="1" value={jobForm.interval_count} onChange={e => setJobForm(f => ({ ...f, interval_count: e.target.value }))} />
                        <select className="form-select flex-1" value={jobForm.interval_unit} onChange={e => setJobForm(f => ({ ...f, interval_unit: e.target.value as '' | 'minute' | 'hour' | 'day' }))}>
                          <option value="">— one-off call —</option><option value="minute">Minutes</option><option value="hour">Hours</option><option value="day">Days</option>
                        </select>
                      </div>
                    </div>
                    <div className="col-span-2"><label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" className="w-3.5 h-3.5 rounded accent-violet-600" checked={jobForm.respect_window} onChange={e => setJobForm(f => ({ ...f, respect_window: e.target.checked }))} /><span className="text-xs text-slate-700">Respect call window (only dial within allowed hours)</span></label></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={createJob} disabled={jobLoading} className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-60 transition-colors">
                      {jobLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</> : <><PhoneCall className="w-3.5 h-3.5" /> Create Job</>}
                    </button>
                    <button onClick={() => setNewJobOpen(false)} className="px-4 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors">Cancel</button>
                  </div>
                </div>
              )}

              {jobsLoading ? (
                <div className="flex items-center justify-center py-8 gap-2"><Loader2 className="w-4 h-4 text-violet-400 animate-spin" /><span className="text-xs text-slate-400">Loading jobs…</span></div>
              ) : jobs.length === 0 ? (
                <div className="py-8 text-center"><PhoneCall className="w-9 h-9 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400 font-medium">No custom jobs for this booking</p><p className="text-xs text-slate-300 mt-1">Create targeted one-off or recurring calls outside the trip schedule</p></div>
              ) : (
                <div className="space-y-2">
                  {jobs.map(job => (
                    <JobRow key={job.id} job={job} campaigns={campaigns} busy={jobBusy === job.id}
                      onRun={() => jobAction(job.id, 'run')} onPause={() => jobAction(job.id, 'pause')}
                      onResume={() => jobAction(job.id, 'resume')} onCancel={() => jobAction(job.id, 'cancel')}
                      onDelete={() => deleteJob(job.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>

        // ══════════════════════════════════════════════════════════════════
        // TAB 4 — QUICK CALL
        // ══════════════════════════════════════════════════════════════════
        ) : tab === 'quickcall' ? (
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
                onClick={sendApproval}
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
                <strong>Note:</strong> Quick calls are ephemeral — no feedback or transcript is saved. For AI-captured feedback and persistent call history, use the Call Schedule or Custom Jobs tabs.
              </p>
            </div>
          </div>

        // ══════════════════════════════════════════════════════════════════
        // TAB 5 — CALL HISTORY
        // ══════════════════════════════════════════════════════════════════
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500 flex items-center gap-1.5"><Hash className="w-3 h-3" />{allFeedback.length} call{allFeedback.length !== 1 ? 's' : ''} recorded</p>
              {service?.id && (
                <button onClick={loadFeedback} disabled={feedbackLoading} className="flex items-center gap-1 text-xs text-violet-500 hover:text-violet-700 transition-colors">
                  {feedbackLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</> : <><RefreshCw className="w-3 h-3" /> Refresh</>}
                </button>
              )}
            </div>

            {!registered ? (
              <div className="py-10 text-center"><Mic className="w-10 h-10 text-slate-200 mx-auto mb-3" /><p className="text-sm text-slate-400 font-medium">No calls yet</p></div>
            ) : feedbackLoading ? (
              <div className="flex items-center justify-center py-10 gap-2"><Loader2 className="w-4 h-4 text-violet-400 animate-spin" /><span className="text-xs text-slate-400">Loading call history…</span></div>
            ) : allFeedback.length === 0 ? (
              <div className="py-10 text-center">
                <Mic className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">No call history yet</p>
                <p className="text-xs text-slate-300 mt-1">Transcripts and AI-captured feedback appear here after each completed call</p>
                {pendingCalls > 0 && <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-violet-500"><ChevronRight className="w-3.5 h-3.5" />{pendingCalls} call{pendingCalls !== 1 ? 's' : ''} scheduled</div>}
              </div>
            ) : (
              <div className="space-y-2">
                {[...allFeedback].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(fb => (
                  <CallHistoryCard key={fb.id} fb={fb} scheduleItems={schedule} />
                ))}
              </div>
            )}
          </div>
        )
        )}
      </CardBody>
    </Card>
  )
}
