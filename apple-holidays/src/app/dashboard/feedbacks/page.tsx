'use client'

/**
 * Feedbacks — everything a guest ever told us, per booking and in bulk.
 *
 * Two tabs, one data model:
 *
 *   • **Explorer** — search a booking, read its complete dossier: AI call
 *     responses (reconfirmation, on-ground, post-tour) with transcripts, the
 *     guest feedback form, complaints raised on calls, desk-saved notes, the
 *     contact log and the experience reports that followed. Download it as a
 *     PDF.
 *
 *   • **Bulk report** — paste a list of booking references (an IS-number column
 *     straight out of a spreadsheet works), get one report across all of them:
 *     totals, distribution, what needs attention, then every booking in full.
 *     Download as PDF or CSV.
 *
 * The page reads and never writes. Every endpoint it calls is a GET or a POST
 * that only queries — nothing here can change a booking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, ClipboardList,
  FileSpreadsheet, FileText, Filter, Layers, Loader2, MessageSquare,
  Printer, RefreshCw, Search, Sparkles, Trash2, TrendingDown, Users, X,
} from 'lucide-react'
import { toast } from 'sonner'
import Header from '@/components/layout/header'
import DossierView, {
  BAND_STYLE, BandPill, Card, DossierHeader, Empty, Pill, ScoreRing, StackBar,
  fmtDate, fmtDateTime,
} from '@/components/feedbacks/dossier-view'
import type { BatchReport, FeedbackDossier, HealthBand } from '@/lib/feedbacks/types'

// ─── Search result shape (mirrors /api/feedbacks/search) ──────────────────────

interface SearchHit {
  bookingRef: string
  isNumber: string | null
  clientName: string | null
  agent: string | null
  status: string
  operationCountry: string | null
  tourDestination: string | null
  arrivalDate: string
  departureDate: string
  pax: number
  signals: {
    calls: number
    onGroundCalls: number
    reconfirmCalls: number
    postTourCalls: number
    form: boolean
    deskNote: boolean
    contactLogs: number
    complaints: number
    openComplaints: number
    highComplaints: number
  }
  hasFeedback: boolean
}

type Tab = 'explorer' | 'bulk'

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body?.success === false) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body.data as T
}

/**
 * Opens a generated document in a new tab.
 *
 * The window is opened *before* the fetch on purpose: a popup opened after an
 * await is attributed to the network callback rather than the click, and every
 * browser blocks it.
 */
async function openPrintable(fetcher: () => Promise<Response>, onError: (msg: string) => void) {
  const win = window.open('', '_blank')
  if (!win) {
    onError('Your browser blocked the new tab. Allow pop-ups for this site and try again.')
    return
  }
  win.document.write('<!doctype html><title>Building report…</title><body style="font:14px -apple-system,sans-serif;padding:40px;color:#475569">Building the report — this can take a moment for a large batch…</body>')

  try {
    const res = await fetcher()
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body?.error ?? `Request failed (${res.status})`)
    }
    const html = await res.text()
    win.document.open()
    win.document.write(html)
    win.document.close()
  } catch (err) {
    win.close()
    onError(err instanceof Error ? err.message : String(err))
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ─── Explorer tab ─────────────────────────────────────────────────────────────

function SignalDots({ s }: { s: SearchHit['signals'] }) {
  const dots: [string, boolean, string][] = [
    ['Reconfirmation call', s.reconfirmCalls > 0, 'bg-sky-500'],
    ['On-ground call', s.onGroundCalls > 0, 'bg-violet-500'],
    ['Post-tour call', s.postTourCalls > 0, 'bg-orange-500'],
    ['Feedback form', s.form, 'bg-emerald-500'],
    ['Desk note', s.deskNote, 'bg-blue-500'],
  ]
  return (
    <div className="flex items-center gap-1">
      {dots.map(([label, on, cls]) => (
        <span key={label} title={`${label}: ${on ? 'yes' : 'none'}`}
          className={`w-1.5 h-1.5 rounded-full ${on ? cls : 'bg-slate-200'}`} />
      ))}
    </div>
  )
}

function ResultRow({ hit, active, onPick }: { hit: SearchHit; active: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${
        active ? 'bg-violet-50' : 'hover:bg-slate-50'
      }`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs font-black text-slate-900">{hit.bookingRef}</span>
        {hit.signals.openComplaints > 0 && (
          <Pill cls="bg-red-100 text-red-700">{hit.signals.openComplaints} open</Pill>
        )}
        {!hit.hasFeedback && <Pill cls="bg-slate-100 text-slate-400">No feedback</Pill>}
        <SignalDots s={hit.signals} />
      </div>
      <p className="text-xs font-semibold text-slate-700 mt-0.5 truncate">{hit.clientName ?? '—'}</p>
      <p className="text-[10px] text-slate-400 truncate">
        {fmtDate(hit.arrivalDate)} → {fmtDate(hit.departureDate)} · {hit.pax} pax
        {hit.agent && ` · ${hit.agent}`}
      </p>
    </button>
  )
}

function ExplorerTab() {
  const [query, setQuery] = useState('')
  const [onlyWithFeedback, setOnlyWithFeedback] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [dossier, setDossier] = useState<FeedbackDossier | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(true)

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(async (q: string, withFeedback: boolean) => {
    setSearching(true)
    try {
      const params = new URLSearchParams({ q, limit: '40' })
      if (withFeedback) params.set('withFeedback', '1')
      const data = await getJson<{ results: SearchHit[] }>(`/api/feedbacks/search?${params}`)
      setHits(data.results)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
      setHits([])
    } finally {
      setSearching(false)
    }
  }, [])

  // Seeded with the most recent trips so the page is useful before anyone types.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void search(query.trim(), onlyWithFeedback) }, query ? 320 : 0)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query, onlyWithFeedback, search])

  const load = useCallback(async (ref: string) => {
    setSelected(ref)
    setLoading(true)
    setError(null)
    setListOpen(false)
    try {
      setDossier(await getJson<FeedbackDossier>(`/api/feedbacks/dossier?ref=${encodeURIComponent(ref)}`))
    } catch (err) {
      setDossier(null)
      setError(err instanceof Error ? err.message : 'Could not load the dossier')
    } finally {
      setLoading(false)
    }
  }, [])

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr] items-start">
      {/* Search panel */}
      <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden lg:sticky lg:top-24 ${listOpen ? '' : 'hidden lg:block'}`}>
        <div className="p-4 border-b border-slate-100 space-y-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-300 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              className="form-input pl-8 w-full"
              placeholder="IS48375 · guest · agent · destination"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              checked={onlyWithFeedback} onChange={e => setOnlyWithFeedback(e.target.checked)} />
            <span className="text-[11px] font-semibold text-slate-600">Only bookings that left feedback</span>
          </label>
        </div>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
          {searching && (
            <div className="px-4 py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </div>
          )}
          {!searching && hits.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              {query ? `Nothing matches “${query}”.` : 'No bookings in your scope yet.'}
            </div>
          )}
          {!searching && hits.map(h => (
            <ResultRow key={h.bookingRef} hit={h} active={h.bookingRef === selected} onPick={() => void load(h.bookingRef)} />
          ))}
        </div>

        {!searching && hits.length > 0 && (
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400">
            {hits.length} booking{hits.length === 1 ? '' : 's'} · newest arrivals first
          </div>
        )}
      </div>

      {/* Dossier */}
      <div className="space-y-4 min-w-0">
        {!listOpen && (
          <button onClick={() => setListOpen(true)}
            className="lg:hidden inline-flex items-center gap-1.5 text-xs font-semibold text-violet-600">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to search
          </button>
        )}

        {!selected && (
          <div className="bg-white rounded-2xl border border-slate-200 px-6 py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto">
              <MessageSquare className="w-7 h-7 text-violet-600" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-4">Pick a booking to open its dossier</h3>
            <p className="text-xs text-slate-500 mt-1.5 max-w-md mx-auto">
              Every AI call response, the guest&rsquo;s feedback form, complaints raised on calls, desk notes,
              contact history and the experience reports that followed — assembled in one page and
              downloadable as a PDF.
            </p>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl border border-slate-200 px-6 py-16 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto" />
            <p className="text-xs text-slate-500 mt-3">Assembling {selected}&rsquo;s feedback…</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-white rounded-2xl border border-red-200 px-6 py-10 text-center">
            <AlertTriangle className="w-6 h-6 text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-700 mt-2">{error}</p>
            <button onClick={() => selected && void load(selected)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-violet-600">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        )}

        {dossier && !loading && (
          <>
            <DossierHeader d={dossier} actions={
              <>
                <a href={`/api/feedbacks/dossier?ref=${encodeURIComponent(dossier.facts.bookingRef)}&format=html`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white text-slate-900 text-xs font-bold hover:bg-slate-100 transition-colors">
                  <Printer className="w-3.5 h-3.5" /> Download PDF
                </a>
                <a href={`/api/feedbacks/dossier?ref=${encodeURIComponent(dossier.facts.bookingRef)}&format=html&transcripts=0`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/15 border border-white/25 text-white text-xs font-bold hover:bg-white/25 transition-colors">
                  <FileText className="w-3.5 h-3.5" /> PDF without transcripts
                </a>
                <a href={`/dashboard/bookings/${encodeURIComponent(dossier.facts.bookingRef)}`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white/15 border border-white/25 text-white text-xs font-bold hover:bg-white/25 transition-colors">
                  <ClipboardList className="w-3.5 h-3.5" /> Open booking
                </a>
                <button onClick={() => void load(dossier.facts.bookingRef)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/80 text-xs font-bold hover:text-white transition-colors ml-auto">
                  <RefreshCw className="w-3.5 h-3.5" /> Refresh
                </button>
              </>
            } />
            <DossierView d={dossier} />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bulk tab ─────────────────────────────────────────────────────────────────

function BatchKpis({ r }: { r: BatchReport }) {
  const t = r.totals
  const tiles = [
    { label: 'Bookings', value: t.found, note: `${t.requested} requested${t.missing.length ? `, ${t.missing.length} not found` : ''}`, cls: 'text-violet-600' },
    { label: 'With feedback', value: t.withAnyFeedback, note: `${t.withNoFeedback} silent`, cls: t.withAnyFeedback ? 'text-emerald-600' : 'text-slate-400' },
    { label: 'Calls logged', value: t.calls.logged, note: `${t.calls.completed}/${t.calls.scheduled} scheduled done`, cls: 'text-sky-600' },
    { label: 'Open complaints', value: t.complaints.open, note: `${t.complaints.total} total · ${t.complaints.high} high`, cls: t.complaints.open ? 'text-red-600' : 'text-slate-400' },
    { label: 'Feedback forms', value: t.forms, note: `${t.deskNotes} desk notes`, cls: t.forms ? 'text-emerald-600' : 'text-slate-400' },
    { label: 'Post-tour avg', value: t.npsAverage == null ? '—' : `${t.npsAverage}/10`, note: `${t.promoters} promoters · ${t.detractors} detractors`, cls: t.npsAverage == null ? 'text-slate-400' : t.npsAverage >= 8 ? 'text-emerald-600' : 'text-amber-600' },
    { label: 'Would recommend', value: t.recommendYes, note: `${t.recommendNo} would not`, cls: t.recommendYes ? 'text-emerald-600' : 'text-slate-400' },
    { label: 'At risk', value: t.band.at_risk, note: `${t.band.watch} to watch · ${t.band.excellent} excellent`, cls: t.band.at_risk ? 'text-red-600' : 'text-emerald-600' },
  ]
  return (
    <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-4">
      {tiles.map(t2 => (
        <div key={t2.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">{t2.label}</p>
          <p className={`text-2xl font-black leading-tight mt-0.5 ${t2.cls}`}>{t2.value}</p>
          <p className="text-[10px] text-slate-400 leading-tight">{t2.note}</p>
        </div>
      ))}
    </div>
  )
}

function Distribution({ r }: { r: BatchReport }) {
  const t = r.totals
  const rows: { label: string; parts: { value: number; color: string; label: string }[]; legend: React.ReactNode }[] = [
    {
      label: 'Sentiment',
      parts: [
        { value: t.sentiment.positive, color: 'bg-emerald-500', label: 'positive' },
        { value: t.sentiment.neutral, color: 'bg-sky-500', label: 'neutral' },
        { value: t.sentiment.negative, color: 'bg-red-500', label: 'negative' },
        { value: t.sentiment.unknown, color: 'bg-slate-200', label: 'unread' },
      ],
      legend: <>
        <Pill cls="bg-emerald-100 text-emerald-700">{t.sentiment.positive} positive</Pill>
        <Pill cls="bg-sky-100 text-sky-700">{t.sentiment.neutral} neutral</Pill>
        <Pill cls="bg-red-100 text-red-700">{t.sentiment.negative} negative</Pill>
      </>,
    },
    {
      label: 'Call mix',
      parts: [
        { value: t.byKind.reconfirm, color: 'bg-sky-500', label: 'reconfirmation' },
        { value: t.byKind.on_ground, color: 'bg-violet-500', label: 'on-ground' },
        { value: t.byKind.post_tour, color: 'bg-orange-500', label: 'post-tour' },
      ],
      legend: <>
        <Pill cls="bg-sky-100 text-sky-700">{t.byKind.reconfirm} reconfirm</Pill>
        <Pill cls="bg-violet-100 text-violet-700">{t.byKind.on_ground} on-ground</Pill>
        <Pill cls="bg-orange-100 text-orange-700">{t.byKind.post_tour} post-tour</Pill>
      </>,
    },
    {
      label: 'Health',
      parts: [
        { value: t.band.excellent, color: 'bg-emerald-500', label: 'excellent' },
        { value: t.band.good, color: 'bg-sky-500', label: 'good' },
        { value: t.band.watch, color: 'bg-amber-500', label: 'watch' },
        { value: t.band.at_risk, color: 'bg-red-500', label: 'at risk' },
        { value: t.band.unknown, color: 'bg-slate-200', label: 'no data' },
      ],
      legend: <>
        <Pill cls="bg-emerald-100 text-emerald-700">{t.band.excellent} excellent</Pill>
        <Pill cls="bg-amber-100 text-amber-700">{t.band.watch} watch</Pill>
        <Pill cls="bg-red-100 text-red-700">{t.band.at_risk} at risk</Pill>
      </>,
    },
  ]

  return (
    <div className="space-y-4">
      {rows.map(row => (
        <div key={row.label}>
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{row.label}</span>
            <span className="flex gap-1.5 flex-wrap ml-auto">{row.legend}</span>
          </div>
          <StackBar parts={row.parts} height={10} />
        </div>
      ))}

      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Channel reach</p>
        <div className="flex flex-wrap gap-1.5">
          <Pill cls="bg-sky-100 text-sky-700">Reconfirmation {t.coverage.reconfirmCall}/{t.found}</Pill>
          <Pill cls="bg-violet-100 text-violet-700">On-ground {t.coverage.onGroundCall}/{t.found}</Pill>
          <Pill cls="bg-orange-100 text-orange-700">Post-tour {t.coverage.postTourCall}/{t.found}</Pill>
          <Pill cls="bg-emerald-100 text-emerald-700">Form {t.coverage.guestForm}/{t.found}</Pill>
          <Pill cls="bg-slate-100 text-slate-600">Desk note {t.coverage.deskNote}/{t.found}</Pill>
        </div>
      </div>
    </div>
  )
}

function BookingAccordion({ d, index }: { d: FeedbackDossier; index: number }) {
  const [open, setOpen] = useState(false)
  const b = BAND_STYLE[d.score.band]

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left flex-wrap">
        <span className="text-[10px] font-bold text-slate-300 w-6 flex-shrink-0">{index + 1}</span>
        <span className="font-mono text-sm font-black text-slate-900">{d.facts.bookingRef}</span>
        <span className="text-xs text-slate-600 truncate max-w-[180px]">{d.facts.clientName ?? '—'}</span>
        <span className="text-[10px] text-slate-400 hidden sm:inline">{fmtDate(d.facts.arrivalDate)}</span>

        <span className="flex items-center gap-1.5 ml-auto flex-wrap">
          <Pill cls="bg-slate-100 text-slate-600">{d.stats.callsLogged} calls</Pill>
          {d.coverage.guestForm && <Pill cls="bg-emerald-100 text-emerald-700">Form</Pill>}
          {d.stats.complaintsTotal > 0 && (
            <Pill cls={d.stats.complaintsOpen ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}>
              {d.stats.complaintsOpen}/{d.stats.complaintsTotal} open
            </Pill>
          )}
          {d.score.value != null && <span className={`text-lg font-black ${b.text}`}>{d.score.value}</span>}
          <BandPill band={d.score.band} />
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 bg-slate-50/50">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <a href={`/api/feedbacks/dossier?ref=${encodeURIComponent(d.facts.bookingRef)}&format=html`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-bold hover:bg-slate-700 transition-colors">
              <Printer className="w-3 h-3" /> This booking as PDF
            </a>
            <a href={`/dashboard/bookings/${encodeURIComponent(d.facts.bookingRef)}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[11px] font-bold hover:bg-slate-100 transition-colors">
              <ClipboardList className="w-3 h-3" /> Open booking
            </a>
          </div>
          <DossierView d={d} compact />
        </div>
      )}
    </div>
  )
}

const SAMPLE_HINT = 'IS48375\nIS48376, IS48380\nVN10233'

function BulkTab() {
  const [raw, setRaw] = useState('')
  const [transcripts, setTranscripts] = useState(false)
  const [report, setReport] = useState<BatchReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null)

  const refs = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const part of raw.split(/[\s,;|\n\r\t]+/)) {
      const r = part.trim().toUpperCase()
      if (!r || seen.has(r)) continue
      seen.add(r)
      out.push(r)
    }
    return out
  }, [raw])

  const post = useCallback((format: string) =>
    fetch('/api/feedbacks/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refs, format, transcripts }),
    }), [refs, transcripts])

  const generate = useCallback(async () => {
    if (!refs.length) return toast.error('Paste at least one booking reference.')
    setLoading(true)
    try {
      const res = await post('json')
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.success === false) throw new Error(body?.error ?? `Request failed (${res.status})`)
      const data = body.data as BatchReport
      setReport(data)
      for (const w of data.warnings) toast.warning(w)
      toast.success(`Report built for ${data.totals.found} booking${data.totals.found === 1 ? '' : 's'}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the report')
    } finally {
      setLoading(false)
    }
  }, [refs, post])

  const downloadPdf = useCallback(async () => {
    if (!refs.length) return toast.error('Paste at least one booking reference.')
    setBusy('pdf')
    await openPrintable(() => post('html'), msg => toast.error(msg))
    setBusy(null)
  }, [refs, post])

  const downloadCsv = useCallback(async () => {
    if (!refs.length) return toast.error('Paste at least one booking reference.')
    setBusy('csv')
    try {
      const res = await post('csv')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `Request failed (${res.status})`)
      }
      downloadBlob(await res.blob(), `Feedback-Report-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the CSV')
    } finally {
      setBusy(null)
    }
  }, [refs, post])

  return (
    <div className="space-y-4">
      {/* Input */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
            <Layers className="w-4 h-4 text-violet-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-slate-900">Booking references</h3>
            <p className="text-xs text-slate-500">
              Paste IS numbers or booking refs — one per line, or comma separated. A spreadsheet column pastes straight in.
            </p>
          </div>
          {refs.length > 0 && (
            <button onClick={() => { setRaw(''); setReport(null) }}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400 hover:text-red-600 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        <div className="p-5 space-y-3">
          <textarea
            className="form-input w-full font-mono text-xs min-h-[130px] resize-y"
            placeholder={SAMPLE_HINT}
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />

          <div className="flex items-center gap-3 flex-wrap">
            <span className={`text-xs font-bold ${refs.length > 300 ? 'text-red-600' : 'text-slate-600'}`}>
              {refs.length} reference{refs.length === 1 ? '' : 's'}
              {refs.length > 300 && ' — over the 300 limit, split the list'}
            </span>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={transcripts} onChange={e => setTranscripts(e.target.checked)} />
              <span className="text-[11px] font-semibold text-slate-600">Include full call transcripts (slower, much larger PDF)</span>
            </label>

            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <button onClick={() => void generate()} disabled={loading || !refs.length}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Generate report
              </button>
              <button onClick={() => void downloadPdf()} disabled={busy !== null || !refs.length}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-40 transition-colors">
                {busy === 'pdf' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                Download PDF
              </button>
              <button onClick={() => void downloadCsv()} disabled={busy !== null || !refs.length}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 disabled:opacity-40 transition-colors">
                {busy === 'csv' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
                CSV
              </button>
            </div>
          </div>

          {refs.length > 0 && (
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
              {refs.slice(0, 120).map(r => (
                <span key={r} className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600">{r}</span>
              ))}
              {refs.length > 120 && <span className="text-[10px] text-slate-400 self-center">+{refs.length - 120} more</span>}
            </div>
          )}
        </div>
      </div>

      {!report && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto">
            <Layers className="w-7 h-7 text-violet-600" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mt-4">One report across every booking you paste</h3>
          <p className="text-xs text-slate-500 mt-1.5 max-w-lg mx-auto">
            AI call responses, reconfirmation calls, on-ground calls, feedback forms, complaints and desk notes —
            totalled, ranked by what needs attention, then listed booking by booking in full. Download the whole
            thing as a PDF or pull the numbers into a spreadsheet.
          </p>
        </div>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-slate-200 px-6 py-16 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto" />
          <p className="text-xs text-slate-500 mt-3">Reading {refs.length} booking{refs.length === 1 ? '' : 's'} across every feedback channel…</p>
        </div>
      )}

      {report && !loading && (
        <>
          {/* Summary banner */}
          <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-violet-900 via-violet-700 to-fuchsia-600 text-white px-5 py-5 flex items-center gap-5 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/70">Bulk feedback report</p>
              <h2 className="text-2xl font-black tracking-tight mt-0.5">
                {report.totals.found} booking{report.totals.found === 1 ? '' : 's'}
              </h2>
              <p className="text-xs text-white/80 mt-1">
                {report.totals.calls.logged} calls · {report.totals.forms} forms · {report.totals.complaints.open} open complaints
                {report.totals.missing.length > 0 && ` · ${report.totals.missing.length} not found`}
              </p>
              <p className="text-[10px] text-white/60 mt-1.5">Generated {fmtDateTime(report.generatedAt)}</p>
            </div>
            <div className="bg-white/95 rounded-2xl px-5 py-3 text-center flex-shrink-0">
              <ScoreRing
                value={report.totals.avgScore}
                band={(report.totals.avgScore == null ? 'unknown'
                  : report.totals.avgScore >= 85 ? 'excellent'
                  : report.totals.avgScore >= 70 ? 'good'
                  : report.totals.avgScore >= 50 ? 'watch' : 'at_risk') as HealthBand}
                size={90}
              />
              <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500 mt-1">Batch average</p>
            </div>
          </div>

          <BatchKpis r={report} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card icon={Filter} accent="violet" title="Distribution" subtitle="How the batch splits across sentiment, call type and health">
              <div className="p-5"><Distribution r={report} /></div>
            </Card>

            <Card icon={AlertTriangle} accent="red" title="Complaint categories"
              subtitle={`${report.totals.complaints.total} raised across the batch`}>
              <div className="p-5">
                {report.totals.topComplaintCategories.length ? (
                  <div className="space-y-2.5">
                    {report.totals.topComplaintCategories.map(c => (
                      <div key={c.category} className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-slate-700 w-32 flex-shrink-0 truncate">{c.category}</span>
                        <div className="flex-1 min-w-0">
                          <StackBar parts={[
                            { value: c.count, color: 'bg-red-500' },
                            { value: Math.max(0, report.totals.complaints.total - c.count), color: 'bg-slate-100' },
                          ]} />
                        </div>
                        <span className="text-xs font-black text-slate-900 w-6 text-right">{c.count}</span>
                        <span className={`text-[10px] font-bold w-14 text-right ${c.open ? 'text-red-600' : 'text-emerald-600'}`}>
                          {c.open} open
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <Empty>No complaint was raised on any booking in this batch.</Empty>}
              </div>
            </Card>
          </div>

          <Card icon={TrendingDown} accent="amber" title="Needs attention"
            subtitle={`${report.totals.attention.length} booking${report.totals.attention.length === 1 ? '' : 's'} scoring below good or carrying an open complaint`}>
            <div className="p-5">
              {report.totals.attention.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[9px] font-bold text-slate-400 uppercase tracking-wide border-b border-slate-200">
                        <th className="text-left pb-2 pr-3">Booking</th>
                        <th className="text-left pb-2 pr-3">Guest</th>
                        <th className="text-left pb-2 pr-3">Score</th>
                        <th className="text-left pb-2">Why</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.totals.attention.map(a => (
                        <tr key={a.bookingRef} className="border-b border-slate-50">
                          <td className="py-2 pr-3 font-mono font-bold text-slate-900">{a.bookingRef}</td>
                          <td className="py-2 pr-3 text-slate-600 truncate max-w-[160px]">{a.clientName ?? '—'}</td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <span className="font-black text-slate-900 mr-1.5">{a.score ?? '—'}</span>
                            <BandPill band={a.band} />
                          </td>
                          <td className="py-2 text-slate-600">{a.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-6">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
                  <p className="text-xs text-slate-500 mt-2">Nothing in this batch needs attention — no low scores and no open complaints.</p>
                </div>
              )}
            </div>
          </Card>

          {report.totals.missing.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {report.totals.missing.length} reference{report.totals.missing.length === 1 ? '' : 's'} did not match a booking you can see
              </p>
              <p className="font-mono text-[11px] text-amber-700 mt-1.5 break-all">{report.totals.missing.join(' · ')}</p>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 px-1 pb-2">
              <Users className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-900">Every booking in detail</h3>
              <span className="text-xs text-slate-400">— click any row to expand</span>
            </div>
            <div className="space-y-2">
              {report.dossiers.map((d, i) => (
                <BookingAccordion key={d.facts.bookingRef} d={d} index={i} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeedbacksPage() {
  const [tab, setTab] = useState<Tab>('explorer')

  const tabs: { key: Tab; label: string; icon: React.ElementType; hint: string }[] = [
    { key: 'explorer', label: 'Booking explorer', icon: Search, hint: 'One booking, everything it told us' },
    { key: 'bulk', label: 'Bulk report', icon: Layers, hint: 'Many refs, one detailed report' },
  ]

  return (
    <div className="min-h-screen bg-slate-50">
      <Header
        title="Feedbacks"
        subtitle="AI call responses, feedback forms, reconfirmation and on-ground calls, complaints — per booking and in bulk"
      />

      <div className="px-4 sm:px-8 py-5 space-y-4">
        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1.5 inline-flex gap-1.5 flex-wrap">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                tab === t.key ? 'bg-violet-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              <t.icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
              <span className={`hidden sm:inline font-semibold ${tab === t.key ? 'text-white/70' : 'text-slate-400'}`}>
                — {t.hint}
              </span>
            </button>
          ))}
        </div>

        {tab === 'explorer' ? <ExplorerTab /> : <BulkTab />}
      </div>
    </div>
  )
}
