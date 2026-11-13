'use client'

/**
 * A small icon-only "History" button for a booking section. Click → a drawer
 * slides in from the right with that section's log: what was created, edited,
 * deleted or assigned, when, and by whom — and, for daily messages, why a send
 * failed.
 *
 *   <SectionLogsButton bookingRef="VN42869" section="flights" />
 */
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { History, X, RefreshCw, Search, ExternalLink, Loader2, AlertTriangle, Inbox } from 'lucide-react'
import type { LogEntry, LogSection } from '@/lib/booking-logs'
import { LogTimeline, SECTION_TEXT } from './log-timeline'

export default function SectionLogsButton({ bookingRef, section, label, className = '' }: {
  bookingRef: string
  /** Omit for every section of the booking. */
  section?: LogSection
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const title = label ?? (section ? SECTION_TEXT[section] : 'All booking activity')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`${title} — history`} aria-label={`${title} history`}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600 ${className}`}>
        <History className="h-3.5 w-3.5" />
      </button>
      {open && <LogsDrawer bookingRef={bookingRef} section={section} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}

function LogsDrawer({ bookingRef, section, title, onClose }: { bookingRef: string; section?: LogSection; title: string; onClose: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [failedOnly, setFailedOnly] = useState(false)
  const [shown, setShown] = useState(false)

  const url = useCallback((before?: string | null) => {
    const p = new URLSearchParams()
    if (section) p.set('section', section)
    if (q.trim()) p.set('q', q.trim())
    if (failedOnly) p.set('failed', '1')
    if (before) p.set('before', before)
    return `/api/bookings/${encodeURIComponent(bookingRef)}/logs?${p}`
  }, [bookingRef, section, q, failedOnly])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await fetch(url())
      const j = await r.json()
      if (!j.success) throw new Error(j.error ?? 'Could not load the log')
      setEntries(j.data.entries); setNext(j.data.nextBefore)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the log') } finally { setLoading(false) }
  }, [url])

  const loadMore = async () => {
    if (!next) return
    setMore(true)
    try {
      const j = await (await fetch(url(next))).json()
      if (j.success) { setEntries(cur => [...cur, ...j.data.entries]); setNext(j.data.nextBefore) }
    } finally { setMore(false) }
  }

  // Search as you type, a beat after the last key.
  useEffect(() => { const t = setTimeout(() => { void load() }, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])

  useEffect(() => {
    requestAnimationFrame(() => setShown(true))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const failures = entries.filter(e => e.tone === 'fail').length

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label={`${title} history`}>
      <div className={`absolute inset-0 bg-slate-900/30 backdrop-blur-[2px] transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <aside className={`absolute inset-y-0 right-0 flex w-full max-w-[460px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="relative overflow-hidden border-b border-slate-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50/60 px-4 pb-3 pt-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-md shadow-indigo-500/25">
              <History className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-indigo-500">History · {bookingRef}</p>
              <h3 className="truncate text-[15px] font-semibold text-slate-900">{title}</h3>
            </div>
            <button type="button" onClick={() => void load()} title="Refresh"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} title="Close (Esc)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, field, value…"
                className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-[12.5px] placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
            <button type="button" onClick={() => setFailedOnly(v => !v)}
              className={`inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[11.5px] font-semibold transition ${
                failedOnly ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-500 hover:text-slate-700'}`}>
              <AlertTriangle className="h-3.5 w-3.5" /> Failed
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && entries.length === 0 ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <span className="h-6 w-6 animate-pulse rounded-full bg-slate-100" />
                  <span className="h-16 flex-1 animate-pulse rounded-xl bg-slate-50" />
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300"><Inbox className="h-6 w-6" /></span>
              <p className="text-[13px] font-medium text-slate-600">{q || failedOnly ? 'Nothing matches' : 'No history yet'}</p>
              <p className="max-w-[260px] text-[11.5px] text-slate-400">Changes made from now on are recorded here with who made them and when.</p>
            </div>
          ) : (
            <>
              {failures > 0 && !failedOnly && (
                <button type="button" onClick={() => setFailedOnly(true)}
                  className="mb-3 flex w-full items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-[12px] text-rose-700 hover:bg-rose-100">
                  <AlertTriangle className="h-4 w-4" /> {failures} failed {failures === 1 ? 'entry' : 'entries'} — show only these
                </button>
              )}
              <LogTimeline entries={entries} showSection={!section} />
              {next && (
                <button type="button" onClick={loadMore} disabled={more}
                  className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                  {more && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Load older
                </button>
              )}
            </>
          )}
        </div>

        <div className="border-t border-slate-100 px-4 py-2.5">
          <Link href={`/dashboard/logs?ref=${encodeURIComponent(bookingRef)}${section ? `&section=${section}` : ''}`}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 hover:text-indigo-800">
            <ExternalLink className="h-3.5 w-3.5" /> Open in Logs page
          </Link>
        </div>
      </aside>
    </div>,
    document.body,
  )
}
