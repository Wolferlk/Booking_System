'use client'

/**
 * Transcripts Explorer — global, searchable master-detail browser for every AI
 * call transcript across all bookings. DB-backed via GET /api/te/transcripts.
 * Lives as the "Transcripts" tab inside the AI Call Bot (dark theme).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, RefreshCw, Loader2, MessageSquareText, Star, X, ArrowLeft,
  Calendar, Plane, Users, Phone, Home, ThumbsUp, AlertCircle, Heart,
  Sparkles, TrendingUp, ClipboardCheck,
} from 'lucide-react'
import {
  KIND_META, SENTIMENT_META, OUTCOME_LABEL, TranscriptChat, fmtDateTime, triState,
  type TranscriptRecord, type TranscriptStats, type Kind,
} from '@/components/te/transcript-shared'

const KIND_FILTERS: { key: Kind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'reconfirm', label: 'Pre-tour' },
  { key: 'on_tour', label: 'On-tour' },
  { key: 'post_tour', label: 'Post-tour' },
]

function Flag({ label, value, icon: Icon }: { label: string; value: unknown; icon: React.ElementType }) {
  const s = triState(value)
  if (!s) return null
  const cls = s === 'yes' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : s === 'no' ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-slate-700/40 text-slate-400 border-slate-600/40'
  return <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${cls}`}><Icon className="w-3 h-3" /> {label}: {s === 'yes' ? '✓' : s === 'no' ? '✕' : '?'}</span>
}

function Stars({ rating }: { rating: number }) {
  const n = Math.max(0, Math.min(5, Math.round(rating / 2)))
  return <span className="inline-flex items-center gap-0.5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={`w-3.5 h-3.5 ${i < n ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}`} />)}</span>
}

// ── Analytics strip ─────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, icon: Icon }: { label: string; value: string | number; sub?: string; accent: string; icon: React.ElementType }) {
  return (
    <div className="flex-1 min-w-[130px] rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center ${accent}`}><Icon className="w-3.5 h-3.5 text-white" /></span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <p className="text-2xl font-black text-slate-100 leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

// ── One row in the master list ──────────────────────────────────────────────
function ListRow({ rec, active, onClick }: { rec: TranscriptRecord; active: boolean; onClick: () => void }) {
  const m = KIND_META[rec.kind]
  const Icon = m.icon
  const sent = rec.sentiment ? SENTIMENT_META[rec.sentiment] : null
  return (
    <button onClick={onClick} className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${active ? `bg-slate-800 border-slate-700 ring-1 ${m.ring}` : 'bg-slate-900/40 border-slate-800 hover:bg-slate-800/60'}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${m.solid}`}><Icon className="w-3.5 h-3.5 text-white" /></span>
        <span className="font-mono text-xs font-bold text-slate-100">{rec.booking_ref}</span>
        {rec.kind === 'on_tour' && rec.day_no != null && <span className="text-[9px] font-bold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded-full">D{rec.day_no}</span>}
        {rec.kind === 'post_tour' && rec.rating != null && <span className="text-[10px] font-black text-amber-400">{rec.rating}/10</span>}
        {rec.transcript_turns > 0 && <span className="ml-auto text-[9px] font-bold text-violet-300 bg-violet-500/15 border border-violet-500/20 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"><MessageSquareText className="w-2.5 h-2.5" />{rec.transcript_turns}</span>}
      </div>
      <p className="text-[11px] text-slate-400 line-clamp-2 leading-snug">{rec.summary || <span className="italic text-slate-600">No summary</span>}</p>
      <div className="flex items-center gap-2 mt-1.5">
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${m.chip}`}>{m.short}</span>
        {sent && <span className="text-[10px]" title={sent.label}>{sent.emoji}</span>}
        {rec.customer_name && <span className="text-[10px] text-slate-500 truncate">{rec.customer_name}</span>}
        <span className="ml-auto text-[9px] text-slate-600">{fmtDateTime(rec.at)}</span>
      </div>
    </button>
  )
}

// ── Detail pane ─────────────────────────────────────────────────────────────
function Detail({ rec, onClose }: { rec: TranscriptRecord; onClose: () => void }) {
  const m = KIND_META[rec.kind]
  const Icon = m.icon
  const sent = rec.sentiment ? SENTIMENT_META[rec.sentiment] : null
  const d = rec.detail
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-slate-800 flex items-start gap-3">
        <button onClick={onClose} className="lg:hidden w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-slate-200 flex-shrink-0"><ArrowLeft className="w-4 h-4" /></button>
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${m.solid}`}><Icon className="w-5 h-5 text-white" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-base font-black text-slate-100">{rec.booking_ref}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${m.chip}`}>{m.label}</span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {rec.lead_name || rec.customer_name || '—'}
            {rec.kind === 'on_tour' && rec.day_no != null && ` · Day ${rec.day_no}`}
            {rec.at && ` · ${fmtDateTime(rec.at)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rec.kind === 'post_tour' && rec.rating != null && <span className="inline-flex items-center gap-1"><Stars rating={rec.rating} /><span className="text-xs font-black text-amber-400">{rec.rating}/10</span></span>}
          {sent && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${sent.cls}`}>{sent.emoji} {sent.label}</span>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {rec.outcome && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-300 bg-slate-800 px-2.5 py-1 rounded-full">{OUTCOME_LABEL[rec.outcome] ?? rec.outcome}</span>}

        {/* Structured insight */}
        {rec.kind === 'reconfirm' && (
          <div className="flex flex-wrap gap-1.5"><Flag label="Dates" value={d.dates_ok} icon={Calendar} /><Flag label="Flights" value={d.flight_ok} icon={Plane} /><Flag label="Pax" value={d.pax_ok} icon={Users} /><Flag label="Contact" value={d.contact_ok} icon={Phone} /></div>
        )}
        {rec.kind === 'on_tour' && (
          <div className="flex flex-wrap gap-1.5"><Flag label="Hotel" value={d.hotel_ok} icon={Home} /><Flag label="Meals" value={d.meals_ok} icon={Heart} /><Flag label="Driver" value={d.driver_ok} icon={Users} /><Flag label="Vehicle" value={d.vehicle_ok} icon={Phone} /></div>
        )}
        {rec.kind === 'post_tour' && (
          <div className="flex flex-wrap gap-2">
            {d.reached_home_safely != null && <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${d.reached_home_safely ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-red-500/15 text-red-300 border-red-500/30'}`}><Home className="w-3 h-3" />{d.reached_home_safely ? 'Home safe' : 'Not home'}</span>}
            {d.would_recommend != null && <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border ${d.would_recommend ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-slate-700/40 text-slate-400 border-slate-600/40'}`}><ThumbsUp className="w-3 h-3" />{d.would_recommend ? 'Recommends' : 'Would not'}</span>}
          </div>
        )}

        {typeof d.requested_change === 'string' && d.requested_change && <Callout tone="amber" icon={AlertCircle} title="Requested change">{d.requested_change}</Callout>}
        {typeof d.special_requests === 'string' && d.special_requests && <Callout tone="violet" icon={Heart} title="Special requests">{d.special_requests}</Callout>}
        {typeof d.issues === 'string' && d.issues && <Callout tone="red" icon={AlertCircle} title="Issues">{d.issues}</Callout>}
        {typeof d.highlights === 'string' && d.highlights && <Callout tone="blue" icon={Star} title="Highlights">{d.highlights}</Callout>}
        {typeof d.best_moment === 'string' && d.best_moment && <Callout tone="emerald" icon={Star} title="Best moment">{d.best_moment}</Callout>}
        {typeof d.improvements === 'string' && d.improvements && <Callout tone="blue" icon={AlertCircle} title="Could improve">{d.improvements}</Callout>}
        {typeof d.comment === 'string' && d.comment && <p className="text-sm text-slate-300 leading-relaxed">&ldquo;{d.comment}&rdquo;</p>}
        {rec.summary && <p className="text-xs text-slate-400 italic leading-relaxed border-l-2 border-slate-700 pl-3">{rec.summary}</p>}

        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageSquareText className="w-3 h-3 text-violet-400" /> Full conversation</p>
          <div className="bg-slate-950/50 border border-slate-800 rounded-xl p-3.5"><TranscriptChat transcript={rec.transcript} dark /></div>
        </div>
        {rec.conversation_id && <p className="text-[10px] text-slate-600 font-mono">conversation: {rec.conversation_id}</p>}
      </div>
    </div>
  )
}

const TONE: Record<string, string> = {
  amber: 'bg-amber-500/10 border-amber-500/25 text-amber-300', violet: 'bg-violet-500/10 border-violet-500/25 text-violet-300',
  red: 'bg-red-500/10 border-red-500/25 text-red-300', blue: 'bg-blue-500/10 border-blue-500/25 text-blue-300', emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
}
function Callout({ tone, icon: Icon, title, children }: { tone: string; icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 border ${TONE[tone]}`}>
      <p className="text-[10px] font-bold uppercase mb-1 flex items-center gap-1"><Icon className="w-3 h-3" /> {title}</p>
      <p className="text-xs text-slate-300 leading-relaxed">{children}</p>
    </div>
  )
}

export default function TranscriptsExplorer() {
  const [records, setRecords] = useState<TranscriptRecord[]>([])
  const [stats, setStats] = useState<TranscriptStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [sentiment, setSentiment] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ limit: '400' })
      if (kind !== 'all') sp.set('kind', kind)
      if (sentiment) sp.set('sentiment', sentiment)
      if (query.trim()) sp.set('q', query.trim())
      const res = await fetch(`/api/te/transcripts?${sp.toString()}`)
      const json = await res.json()
      if (json.success) { setRecords(json.data.records ?? []); setStats(json.data.stats ?? null) }
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [kind, sentiment, query])

  // reload on filter change; debounce free-text search
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(load, query ? 350 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [load, query])

  const selectedRec = useMemo(() => records.find(r => r.uid === selected) ?? null, [records, selected])
  const sentiments = useMemo(() => Object.keys(stats?.sentimentBreakdown ?? {}), [stats])

  return (
    <div className="space-y-4">
      {/* Analytics strip */}
      <div className="flex flex-wrap gap-3">
        <StatCard label="Conversations" value={stats?.total ?? 0} sub={`across ${stats?.bookings ?? 0} bookings`} accent="bg-gradient-to-br from-violet-500 to-indigo-500" icon={MessageSquareText} />
        <StatCard label="Pre-tour" value={stats?.byKind.reconfirm ?? 0} accent="bg-sky-500" icon={ClipboardCheck} />
        <StatCard label="On-tour" value={stats?.byKind.on_tour ?? 0} accent="bg-violet-500" icon={Phone} />
        <StatCard label="Post-tour" value={stats?.byKind.post_tour ?? 0} sub={stats?.avgRating != null ? `avg ${stats.avgRating}/10` : undefined} accent="bg-amber-500" icon={Star} />
        <StatCard label="With transcript" value={stats?.withTranscript ?? 0} sub={stats ? `${stats.total - stats.withTranscript} summary-only` : undefined} accent="bg-emerald-500" icon={TrendingUp} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transcripts, summaries, booking refs…"
            className="w-full h-10 pl-9 pr-8 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500" />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>}
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-700 p-1">
          {KIND_FILTERS.map(f => (
            <button key={f.key} onClick={() => setKind(f.key)} className={`px-3 h-8 rounded-lg text-xs font-semibold transition-colors ${kind === f.key ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{f.label}</button>
          ))}
        </div>
        <select value={sentiment} onChange={e => setSentiment(e.target.value)} className="h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-300 focus:outline-none focus:border-violet-500">
          <option value="">All sentiment</option>
          {sentiments.map(s => <option key={s} value={s}>{SENTIMENT_META[s]?.label ?? s}</option>)}
        </select>
        <button onClick={load} disabled={loading} className="h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Master-detail */}
      <div className="grid lg:grid-cols-[minmax(300px,380px)_1fr] gap-4">
        {/* Master list */}
        <div className={`space-y-2 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1 ${selectedRec ? 'hidden lg:block' : ''}`}>
          {loading && records.length === 0 ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>
          ) : records.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center">
              <MessageSquareText className="w-9 h-9 text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-400 font-medium">No transcripts match</p>
              <p className="text-xs text-slate-600 mt-0.5">Try a different search or clear the filters.</p>
            </div>
          ) : (
            records.map(rec => <ListRow key={rec.uid} rec={rec} active={rec.uid === selected} onClick={() => setSelected(rec.uid)} />)
          )}
        </div>

        {/* Detail */}
        <div className={`rounded-2xl border border-slate-800 bg-slate-900/40 min-h-[400px] lg:max-h-[70vh] overflow-hidden ${selectedRec ? '' : 'hidden lg:block'}`}>
          <AnimatePresence mode="wait">
            {selectedRec ? (
              <motion.div key={selectedRec.uid} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                <Detail rec={selectedRec} onClose={() => setSelected(null)} />
              </motion.div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-20 text-center px-6">
                <Sparkles className="w-10 h-10 text-slate-700 mb-3" />
                <p className="text-sm text-slate-400 font-medium">Select a conversation</p>
                <p className="text-xs text-slate-600 mt-1 max-w-xs">Pick any call from the list to read its full AI transcript, sentiment and structured feedback.</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
