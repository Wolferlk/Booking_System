'use client'

/**
 * Per-booking AI Call Transcripts — every reconfirmation, on-tour and post-tour
 * call for one booking, rendered as an expandable timeline with chat transcripts.
 * DB-backed via GET /api/te/transcripts?ref=<bookingRef>.
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquareText, ChevronDown, RefreshCw, Loader2, Star,
  Calendar, Plane, Users, Phone, Home, ThumbsUp, AlertCircle, Heart, PhoneCall,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  KIND_META, SENTIMENT_META, OUTCOME_LABEL, TranscriptChat, CallRecordingPlayer, fmtDate, triState,
  type TranscriptRecord, type TranscriptStats, type Kind,
} from '@/components/te/transcript-shared'

const FILTERS: { key: Kind | 'all'; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'reconfirm', label: 'Pre-tour' },
  { key: 'on_tour', label: 'On-tour' },
  { key: 'post_tour', label: 'Post-tour' },
]

function FlagChip({ label, value, icon: Icon }: { label: string; value: unknown; icon: React.ElementType }) {
  const s = triState(value)
  if (!s) return null
  const cls = s === 'yes' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : s === 'no' ? 'bg-red-50 text-red-500 border-red-200' : 'bg-slate-50 text-slate-500 border-slate-200'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${cls}`}>
      <Icon className="w-3 h-3" /> {label}: {s === 'yes' ? '✓' : s === 'no' ? '✕' : '?'}
    </span>
  )
}

function Stars({ rating }: { rating: number }) {
  const stars = Math.max(0, Math.min(5, Math.round(rating / 2)))
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={`w-3.5 h-3.5 ${i < stars ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
      ))}
    </span>
  )
}

function CallCard({ rec, onRetry, retryBusy }: { rec: TranscriptRecord; onRetry?: () => void; retryBusy?: boolean }) {
  const [open, setOpen] = useState(false)
  const m = KIND_META[rec.kind]
  const Icon = m.icon
  const sent = rec.sentiment ? SENTIMENT_META[rec.sentiment] : null
  const d = rec.detail

  return (
    <div className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition-shadow hover:shadow-md ${open ? `ring-1 ${m.ring}` : 'border-slate-200'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full px-4 py-3 flex items-center gap-2 flex-wrap text-left hover:bg-slate-50/70">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${m.solid}`}><Icon className="w-4 h-4 text-white" /></span>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${m.chip}`}>{m.short}</span>
        {rec.kind === 'on_tour' && rec.day_no != null && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Day {rec.day_no}</span>}
        {rec.kind === 'post_tour' && rec.rating != null && (
          <span className="inline-flex items-center gap-1"><Stars rating={rec.rating} /><span className="text-[11px] font-black text-amber-500">{rec.rating}/10</span></span>
        )}
        {rec.outcome && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{OUTCOME_LABEL[rec.outcome] ?? rec.outcome}</span>}
        {sent && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sent.cls}`}>{sent.emoji} {sent.label}</span>}
        {rec.transcript_turns > 0 && <span className="text-[10px] font-semibold text-violet-500 bg-violet-50 border border-violet-100 px-2 py-0.5 rounded-full inline-flex items-center gap-1"><MessageSquareText className="w-3 h-3" />{rec.transcript_turns}</span>}
        <span className="ml-auto text-[11px] text-slate-400">{fmtDate(rec.at)}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {!open && rec.summary && <p className="px-4 pb-3 -mt-1 text-xs text-slate-500 italic leading-relaxed line-clamp-2">{rec.summary}</p>}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
              {/* Kind-specific structured detail */}
              {rec.kind === 'reconfirm' && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <FlagChip label="Dates" value={d.dates_ok} icon={Calendar} />
                  <FlagChip label="Flights" value={d.flight_ok} icon={Plane} />
                  <FlagChip label="Pax" value={d.pax_ok} icon={Users} />
                  <FlagChip label="Contact" value={d.contact_ok} icon={Phone} />
                </div>
              )}
              {rec.kind === 'on_tour' && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <FlagChip label="Hotel" value={d.hotel_ok} icon={Home} />
                  <FlagChip label="Meals" value={d.meals_ok} icon={Heart} />
                  <FlagChip label="Driver" value={d.driver_ok} icon={Users} />
                  <FlagChip label="Vehicle" value={d.vehicle_ok} icon={Phone} />
                </div>
              )}
              {rec.kind === 'post_tour' && (
                <div className="flex flex-wrap gap-2 pt-2">
                  {d.reached_home_safely != null && <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${d.reached_home_safely ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-500 border-red-200'}`}><Home className="w-3 h-3" />{d.reached_home_safely ? 'Home safe' : 'Not home'}</span>}
                  {d.would_recommend != null && <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${d.would_recommend ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}><ThumbsUp className="w-3 h-3" />{d.would_recommend ? 'Recommends' : 'Would not'}</span>}
                </div>
              )}

              {/* Highlighted callouts */}
              {typeof d.requested_change === 'string' && d.requested_change && (
                <Callout tone="amber" icon={AlertCircle} title="Requested change — action needed">{d.requested_change}</Callout>
              )}
              {typeof d.special_requests === 'string' && d.special_requests && (
                <Callout tone="violet" icon={Heart} title="Special requests">{d.special_requests}</Callout>
              )}
              {typeof d.issues === 'string' && d.issues && <Callout tone="red" icon={AlertCircle} title="Issues">{d.issues}</Callout>}
              {typeof d.highlights === 'string' && d.highlights && <Callout tone="blue" icon={Star} title="Highlights">{d.highlights}</Callout>}
              {typeof d.best_moment === 'string' && d.best_moment && <Callout tone="emerald" icon={Star} title="Best moment">{d.best_moment}</Callout>}
              {typeof d.improvements === 'string' && d.improvements && <Callout tone="blue" icon={AlertCircle} title="Could improve">{d.improvements}</Callout>}
              {typeof d.comment === 'string' && d.comment && <p className="text-xs text-slate-700 leading-relaxed">&ldquo;{d.comment}&rdquo;</p>}

              {rec.summary && <p className="text-xs text-slate-500 italic leading-relaxed">{rec.summary}</p>}

              {/* Call recording */}
              {rec.conversation_id && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Phone className="w-3 h-3 text-violet-400" /> Recording</p>
                  <CallRecordingPlayer conversationId={rec.conversation_id} />
                </div>
              )}

              {/* Conversation */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageSquareText className="w-3 h-3 text-violet-400" /> Conversation</p>
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3"><TranscriptChat transcript={rec.transcript} /></div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {onRetry && (
                  <button
                    type="button"
                    disabled={retryBusy}
                    onClick={onRetry}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                  >
                    {retryBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                    {rec.kind === 'reconfirm' ? 'Retry reconfirmation call' : rec.kind === 'post_tour' ? 'Retry post-tour call' : 'Call again'}
                  </button>
                )}
                {rec.conversation_id && <p className="ml-auto text-[10px] text-slate-400 font-mono">conversation: {rec.conversation_id}</p>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

const TONE: Record<string, string> = {
  amber: 'bg-amber-50 border-amber-200 text-amber-700', violet: 'bg-violet-50 border-violet-100 text-violet-600',
  red: 'bg-red-50 border-red-100 text-red-500', blue: 'bg-blue-50 border-blue-100 text-blue-500', emerald: 'bg-emerald-50 border-emerald-100 text-emerald-600',
}
function Callout({ tone, icon: Icon, title, children }: { tone: string; icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 border ${TONE[tone]}`}>
      <p className="text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><Icon className="w-3 h-3" /> {title}</p>
      <p className="text-xs text-slate-700 leading-relaxed">{children}</p>
    </div>
  )
}

export default function BookingCallTranscripts({ bookingRef }: { bookingRef: string }) {
  const [records, setRecords] = useState<TranscriptRecord[]>([])
  const [stats, setStats] = useState<TranscriptStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Kind | 'all'>('all')
  const [retryBusy, setRetryBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/te/transcripts?ref=${encodeURIComponent(bookingRef)}&limit=500`)
      const json = await res.json()
      if (json.success) {
        setRecords(json.data.records ?? [])
        setStats(json.data.stats ?? null)
      }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [bookingRef])

  useEffect(() => { load() }, [load])

  // Re-place the call behind a logged record: the record's own schedule row when
  // it has one, else the booking's schedule row of the same phase (reconfirm /
  // post_tour). The dial honours the WhatsApp approval flow — if the customer's
  // call permission lapsed, they get the "Allow calls?" request instead.
  const teProxy = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const url = new URL('/api/te/proxy', location.origin)
    url.searchParams.set('path', path)
    const res = await fetch(url.toString(), {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return res.json()
  }, [])

  const retryCall = useCallback(async (rec: TranscriptRecord) => {
    setRetryBusy(rec.uid)
    try {
      let scheduleId = rec.schedule_id
      if (!scheduleId && (rec.kind === 'reconfirm' || rec.kind === 'post_tour')) {
        const phase = rec.kind
        const detail = await teProxy(`services/${encodeURIComponent(bookingRef)}`)
        const rows: { id: number; phase?: string | null }[] = detail?.schedule ?? detail?.service?.schedule ?? []
        const match = rows.filter(r => r.phase === phase).pop()
        scheduleId = match?.id ?? null
      }
      if (!scheduleId) {
        toast.error('No scheduled call found to retry — check the AI Auto-Call Bot schedule for this booking.')
        return
      }
      const res = await teProxy(`schedule/${scheduleId}/call`, 'POST', { force: true })
      if (res.approval_pending) toast.info(res.message ?? 'WhatsApp call approval pending — the customer must tap Allow first.')
      else if (res.ok === false) toast.error(res.message ?? res.error ?? 'Call could not be placed')
      else toast.success('Call placed — the customer’s phone is ringing.')
    } catch {
      toast.error('Failed to place the call')
    } finally { setRetryBusy(null) }
  }, [bookingRef, teProxy])

  const shown = useMemo(() => filter === 'all' ? records : records.filter(r => r.kind === filter), [records, filter])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-sky-50 flex items-center gap-3 flex-wrap">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center flex-shrink-0"><MessageSquareText className="w-4.5 h-4.5 text-white" /></span>
        <div>
          <h3 className="text-sm font-bold text-slate-800">AI Call Transcripts</h3>
          <p className="text-[11px] text-slate-500">Reconfirmation · on-tour · post-tour conversations for this booking</p>
        </div>
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1.5 px-3 h-8 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Refresh
        </button>
      </div>

      {/* Filter segments with counts */}
      <div className="px-5 pt-4 flex flex-wrap gap-2">
        {FILTERS.map(f => {
          const count = f.key === 'all' ? records.length : (stats?.byKind[f.key] ?? records.filter(r => r.kind === f.key).length)
          const active = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}>
              {f.label} <span className={`ml-1 ${active ? 'text-slate-300' : 'text-slate-400'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      <div className="p-5 space-y-2.5">
        {loading && records.length === 0 ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>
        ) : shown.length === 0 ? (
          <div className="text-center py-10">
            <MessageSquareText className="w-9 h-9 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-500 font-medium">No calls logged for this booking yet</p>
            <p className="text-xs text-slate-400 mt-0.5">Reconfirmation, on-tour and post-tour transcripts will appear here.</p>
          </div>
        ) : (
          shown.map(rec => (
            <CallCard key={rec.uid} rec={rec} retryBusy={retryBusy === rec.uid} onRetry={() => retryCall(rec)} />
          ))
        )}
      </div>
    </div>
  )
}
