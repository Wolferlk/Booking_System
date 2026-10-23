'use client'

/**
 * Feedback board — every AI call (pre-tour reconfirmation, on-tour check-in,
 * post-tour feedback) sorted into Bad / Warning / Good so ops works the bad
 * ones first. Lives as the "Feedback" tab inside the AI Call Bot (dark theme).
 *
 * The verdict comes from GET /api/te/transcripts (see lib/te/feedback-class.ts):
 * the voice service's own end-of-call verdict when it gave one, rules otherwise.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, RefreshCw, Loader2, X, ExternalLink, BellRing, Inbox } from 'lucide-react'
import {
  KIND_META, fmtDateTime, type TranscriptRecord, type TranscriptStats, type Kind,
} from '@/components/te/transcript-shared'
import { TranscriptDetail } from '@/components/te/transcripts-explorer'
import { FEEDBACK_CLASSES, FEEDBACK_CLASS_META, type FeedbackClass } from '@/lib/te/feedback-class'

const KIND_FILTERS: { key: Kind | 'all'; label: string }[] = [
  { key: 'all', label: 'All calls' },
  { key: 'reconfirm', label: 'Pre-tour' },
  { key: 'on_tour', label: 'On-tour' },
  { key: 'post_tour', label: 'Post-tour' },
]

const COLUMN_HINT: Record<Exclude<FeedbackClass, 'none'>, string> = {
  bad: 'Unhappy customer or something went wrong — act now',
  warning: 'Needs a check or an action — not a complaint yet',
  good: 'Happy customer, nothing to do',
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

function FeedbackCard({ rec, onOpen }: { rec: TranscriptRecord; onOpen: () => void }) {
  const k = KIND_META[rec.kind]
  const Icon = k.icon
  const openAlerts = rec.alerts.filter(a => a.status === 'open').length
  return (
    <button onClick={onOpen} className="w-full text-left px-3.5 py-3 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/70 transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${k.solid}`}><Icon className="w-3.5 h-3.5 text-white" /></span>
        <span className="font-mono text-xs font-bold text-slate-100">{rec.booking_ref}</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${k.chip}`}>{k.short}{rec.kind === 'on_tour' && rec.day_no != null ? ` · D${rec.day_no}` : ''}</span>
        {rec.kind === 'post_tour' && rec.rating != null && <span className="text-[10px] font-black text-amber-400">{rec.rating}/10</span>}
        {openAlerts > 0 && (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[9px] font-bold text-red-300 bg-red-500/15 border border-red-500/30 px-1.5 py-0.5 rounded-full" title="Open alerts on this call">
            <BellRing className="w-2.5 h-2.5" />{openAlerts}
          </span>
        )}
      </div>
      <p className="text-xs font-semibold text-slate-200 leading-snug line-clamp-2">{rec.feedback_reason}</p>
      {rec.summary && <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-snug">{rec.summary}</p>}
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[10px] text-slate-500 truncate">{rec.lead_name || rec.customer_name || '—'}</span>
        <span className="ml-auto text-[9px] text-slate-600 flex-shrink-0">{fmtDateTime(rec.at)}</span>
      </div>
    </button>
  )
}

export default function FeedbackBoard() {
  const [records, setRecords] = useState<TranscriptRecord[]>([])
  const [stats, setStats] = useState<TranscriptStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<Kind | 'all'>('all')
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)))
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [query, setQuery] = useState('')
  // Mobile shows one column at a time; desktop shows all three side by side.
  const [focus, setFocus] = useState<Exclude<FeedbackClass, 'none'>>('bad')
  const [selected, setSelected] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams({ limit: '1000' })
      if (kind !== 'all') sp.set('kind', kind)
      if (from) sp.set('from', from)
      if (to) sp.set('to', to)
      if (query.trim()) sp.set('q', query.trim())
      const res = await fetch(`/api/te/transcripts?${sp.toString()}`)
      const json = await res.json()
      if (json.success) { setRecords(json.data.records ?? []); setStats(json.data.stats ?? null) }
    } catch { /* keep the last good data on screen */ } finally { setLoading(false) }
  }, [kind, from, to, query])

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(load, query ? 350 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [load, query])

  const byClass = useMemo(() => {
    const out: Record<FeedbackClass, TranscriptRecord[]> = { bad: [], warning: [], good: [], none: [] }
    for (const r of records) out[r.feedback_class]?.push(r)
    return out
  }, [records])
  const selectedRec = useMemo(() => records.find(r => r.uid === selected) ?? null, [records, selected])
  const counts = stats?.classBreakdown

  return (
    <div className="space-y-4">
      {/* Bucket counts — tap to focus a column on mobile */}
      <div className="grid grid-cols-3 gap-3">
        {FEEDBACK_CLASSES.map(c => {
          const m = FEEDBACK_CLASS_META[c]
          return (
            <button key={c} onClick={() => setFocus(c)}
              className={`rounded-2xl border px-4 py-3 text-left transition-colors ${focus === c ? 'border-slate-600 bg-slate-800/80' : 'border-slate-800 bg-slate-900/60 hover:bg-slate-800/50'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${m.solid}`} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{m.label}</span>
              </div>
              <p className="text-2xl font-black text-slate-100 leading-none">{counts?.[c] ?? byClass[c].length}</p>
              <p className="text-[10px] text-slate-500 mt-1 hidden sm:block">{COLUMN_HINT[c]}</p>
            </button>
          )
        })}
      </div>
      {(counts?.none ?? 0) > 0 && (
        <p className="text-[11px] text-slate-500">{counts!.none} call{counts!.none === 1 ? '' : 's'} in this range never reached the customer and are left out.</p>
      )}

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search booking ref, summary, issue…"
            className="w-full h-10 pl-9 pr-8 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-violet-500" />
          {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>}
        </div>
        <div className="flex gap-1 rounded-xl bg-slate-900 border border-slate-700 p-1 overflow-x-auto">
          {KIND_FILTERS.map(f => (
            <button key={f.key} onClick={() => setKind(f.key)} className={`px-3 h-8 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${kind === f.key ? 'bg-violet-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>{f.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} aria-label="From"
            className="h-10 px-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-violet-500 [color-scheme:dark]" />
          <span className="text-slate-600 text-xs">to</span>
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} aria-label="To"
            className="h-10 px-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-violet-500 [color-scheme:dark]" />
        </div>
        <button onClick={load} disabled={loading} aria-label="Refresh" className="h-10 px-3 rounded-xl bg-slate-900 border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50 flex items-center gap-1.5">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {/* Three columns */}
      {loading && records.length === 0 ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-violet-400 animate-spin" /></div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          {FEEDBACK_CLASSES.map(c => {
            const m = FEEDBACK_CLASS_META[c]
            const list = byClass[c]
            return (
              <section key={c} className={`rounded-2xl border border-slate-800 bg-slate-950/40 ${focus === c ? '' : 'hidden lg:block'}`}>
                <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${m.darkChip}`}>{m.emoji} {m.label}</span>
                  <span className="text-xs text-slate-500">{list.length}</span>
                </header>
                <div className="p-3 space-y-2 lg:max-h-[65vh] lg:overflow-y-auto">
                  {list.length === 0 ? (
                    <div className="py-10 text-center">
                      <Inbox className="w-7 h-7 text-slate-700 mx-auto mb-1.5" />
                      <p className="text-xs text-slate-500">No {m.label.toLowerCase()} feedback in this range</p>
                    </div>
                  ) : list.map(rec => <FeedbackCard key={rec.uid} rec={rec} onOpen={() => setSelected(rec.uid)} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Call detail */}
      <AnimatePresence>
        {selectedRec && (
          <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 flex justify-end" onClick={() => setSelected(null)}>
            <motion.div initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.15 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-2xl h-full bg-slate-900 border-l border-slate-800 flex flex-col">
              <div className="flex items-center justify-end gap-2 px-4 py-2 border-b border-slate-800">
                <Link href={`/dashboard/bookings/${encodeURIComponent(selectedRec.booking_ref)}`} target="_blank"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-violet-300 hover:text-violet-200">
                  Open booking <ExternalLink className="w-3 h-3" />
                </Link>
                <button onClick={() => setSelected(null)} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 min-h-0">
                <TranscriptDetail rec={selectedRec} onClose={() => setSelected(null)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
