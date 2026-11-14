'use client'

/**
 * Issue workspace — the Tickets list on the left, the Ticket Issue Desk for the
 * selected ticket on the right (GlobalTix · Cebu · Manual, hold, WhatsApp code,
 * issued). One ticket at a time, for one booking at a time, without leaving the list.
 *
 * The desk is PortalIssuePane from portal-issue-desk.tsx, unchanged: every rule
 * stays on the server. The last few tickets opened are kept alive, so stepping
 * back to one does not compare the portals all over again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  AlertCircle, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, CircleDot, ExternalLink, Hand, Keyboard,
  Loader2, Search, Sparkles, Ticket as TicketIcon, Users, X,
} from 'lucide-react'
import { PortalIssuePane, type PaneStage } from './portal-issue-desk'

export interface WorkspaceTicket {
  id: string
  type: string
  qty: number
  totalCost: string | null
  currency: string
  status: string
  activated: boolean
  category: string | null
  reference: string | null
  portalName: string | null
  portalRef: string | null
  approvalStatus: string | null
  booking: { bookingRef: string; arrivalDate: string; agent: string | null } | null
  pnlLine: { paymentStatus: string } | null
  agendaItem: { date: string; location: string } | null
}

interface Mark { provider: string; reference: string | null; status: string; amount: number | null; currency: string | null }

type Tab = 'active' | 'purchased' | 'all'
const TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: 'To issue' },
  { id: 'purchased', label: 'Bought' },
  { id: 'all', label: 'All' },
]
const PAGE = 40
const KEEP_ALIVE = 4

const PROVIDER: Record<string, string> = { globaltix: 'GlobalTix', cebu: 'Cebu' }
const CAT_BAR: Record<string, string> = {
  TICKETS: 'bg-purple-400', CRUISE: 'bg-cyan-400', WATER: 'bg-teal-400', OTHER: 'bg-slate-300', MEALS: 'bg-amber-400',
  HOTEL: 'bg-blue-400', TRANSPORT: 'bg-orange-400', GUIDES: 'bg-green-400', FLIGHT_TICKETS: 'bg-indigo-400',
}

const visitOf = (t: WorkspaceTicket) => (t.agendaItem?.date ?? t.booking?.arrivalDate ?? '').slice(0, 10)
const dayLabel = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'No date')
const money = (v: string | number | null | undefined, c?: string | null) => {
  const n = v === null || v === undefined || v === '' ? null : Number(v)
  return n === null || !Number.isFinite(n) ? '—' : `${c ?? ''} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()
}
const todayIso = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
const daysAway = (iso: string) => (iso ? Math.round((+new Date(`${iso}T00:00:00Z`) - +new Date(`${todayIso()}T00:00:00Z`)) / 86_400_000) : null)

/** What the row says about the desk: live mark first, then what this session saw. */
function markFor(t: WorkspaceTicket, mark: Mark | undefined, stage: PaneStage | undefined) {
  if (stage === 'issued' || mark?.status === 'confirmed') return { tone: 'green' as const, text: `Issued${mark ? ` · ${PROVIDER[mark.provider] ?? mark.provider}` : ''}` }
  if (stage === 'held' || mark?.status === 'reserved') return { tone: 'sky' as const, text: `Held${mark ? ` · ${PROVIDER[mark.provider] ?? mark.provider}` : ''}` }
  if (stage === 'waiting' || (mark && ['unknown', 'confirming', 'reserving', 'cancelling'].includes(mark.status))) return { tone: 'amber' as const, text: 'Check status' }
  if (t.status !== 'DRAFT') return { tone: 'slate' as const, text: t.portalName ? `Bought · ${t.portalName}` : 'Bought' }
  if (!t.activated) return { tone: 'slate' as const, text: 'Activate first' }
  if (stage === 'blocked') return { tone: 'red' as const, text: 'Blocked' }
  return null
}

const TONE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', sky: 'bg-sky-50 text-sky-700 ring-sky-200', amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  slate: 'bg-slate-100 text-slate-500 ring-slate-200', red: 'bg-red-50 text-red-700 ring-red-200',
}

export default function TicketIssueWorkspace({ initial, baseParams, onClose, onChanged, onManual }: {
  initial: WorkspaceTicket
  /** The Tickets page's filters (country, categories, dates …) as a query string. */
  baseParams: string
  onClose: () => void
  onChanged: () => void
  onManual: (t: WorkspaceTicket) => void
}) {
  const [tab, setTab] = useState<Tab>(initial.status === 'DRAFT' && initial.activated ? 'active' : 'all')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [list, setList] = useState<WorkspaceTicket[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [marks, setMarks] = useState<Record<string, Mark>>({})
  const [stages, setStages] = useState<Record<string, PaneStage>>({})
  const [selectedId, setSelectedId] = useState(initial.id)
  const [known, setKnown] = useState<Record<string, WorkspaceTicket>>({ [initial.id]: initial })
  const [alive, setAlive] = useState<string[]>([initial.id])
  const [mobilePane, setMobilePane] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const id = setTimeout(() => setDebounced(q.trim()), 300); return () => clearTimeout(id) }, [q])

  const params = useCallback((p: number) => {
    const s = new URLSearchParams(baseParams)
    s.delete('page'); s.delete('pageSize'); s.delete('stats'); s.delete('status'); s.delete('q')
    if (tab !== 'all') s.set('status', tab)
    if (debounced) s.set('q', debounced)
    if (!s.get('sort') || tab === 'active') s.set('sort', 'arrival_asc')
    s.set('page', String(p)); s.set('pageSize', String(PAGE))
    return s
  }, [baseParams, tab, debounced])

  const loadMarks = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    try {
      const res = await fetch(`/api/tickets/portal-status?ids=${ids.join(',')}`)
      const json = await res.json()
      if (json.success) setMarks(m => ({ ...m, ...(json.data.byTicket as Record<string, Mark>) }))
    } catch { /* the marks are a convenience; the desk reads the truth itself */ }
  }, [])

  const load = useCallback(async (p = 1) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/tickets?${params(p)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not load tickets')
      const rows = json.data as WorkspaceTicket[]
      setList(l => (p === 1 ? rows : [...l, ...rows.filter(r => !l.some(x => x.id === r.id))]))
      setTotal(json.meta?.total ?? rows.length)
      setPage(p)
      setKnown(k => ({ ...k, ...Object.fromEntries(rows.map(r => [r.id, r])) }))
      loadMarks(rows.map(r => r.id))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load tickets') }
    finally { setLoading(false) }
  }, [params, loadMarks])
  useEffect(() => { load(1) }, [load])

  const select = useCallback((t: WorkspaceTicket) => {
    setSelectedId(t.id)
    setKnown(k => ({ ...k, [t.id]: t }))
    setAlive(a => [t.id, ...a.filter(x => x !== t.id)].slice(0, KEEP_ALIVE))
    setMobilePane(true)
  }, [])

  const selected = known[selectedId] ?? initial
  const index = list.findIndex(t => t.id === selectedId)
  const step = useCallback((dir: 1 | -1) => {
    const next = list[(index < 0 ? (dir === 1 ? -1 : list.length) : index) + dir]
    if (next) select(next)
  }, [list, index, select])

  // Keep the chosen row in view while stepping with the keyboard.
  useEffect(() => {
    listRef.current?.querySelector(`[data-ticket="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      if (e.key === 'Escape') { onClose(); return }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); step(1) }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); step(-1) }
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose, step])

  const setStage = useCallback((id: string, s: PaneStage) => setStages(m => (m[id] === s ? m : { ...m, [id]: s })), [])
  const changed = useCallback((id: string) => { onChanged(); loadMarks([id]) }, [onChanged, loadMarks])

  // Rows under a date heading — the day the guest uses the ticket.
  const days = useMemo(() => {
    const out: { day: string; rows: WorkspaceTicket[] }[] = []
    for (const t of list) {
      const d = visitOf(t)
      const last = out[out.length - 1]
      if (last?.day === d) last.rows.push(t)
      else out.push({ day: d, rows: [t] })
    }
    return out
  }, [list])

  const sum = useMemo(() => {
    const held = list.filter(t => marks[t.id]?.status === 'reserved' || stages[t.id] === 'held').length
    const issued = list.filter(t => marks[t.id]?.status === 'confirmed' || stages[t.id] === 'issued').length
    return { held, issued }
  }, [list, marks, stages])

  const panel = (
    <div className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label="Issue tickets">
      <div className="flex w-full max-w-[1500px] overflow-hidden bg-slate-50 shadow-2xl sm:rounded-2xl">

        {/* ── left: the ticket list ── */}
        <aside className={`w-full flex-col border-r border-slate-200 bg-white md:flex md:w-[360px] md:flex-shrink-0 ${mobilePane ? 'hidden' : 'flex'}`}>
          <div className="space-y-3 border-b border-slate-100 p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 text-white shadow-sm"><Sparkles className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Issue from portal</p>
                <p className="text-sm font-bold text-slate-900">{total.toLocaleString()} ticket{total === 1 ? '' : 's'}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 md:hidden" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex rounded-lg bg-slate-100 p-0.5">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex-1 rounded-md px-2 py-1 text-xs font-semibold transition ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{t.label}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ticket, booking ref, agent…" className="form-input w-full py-1.5 pl-8 text-sm" />
              {loading && <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />}
            </div>
            {(sum.held > 0 || sum.issued > 0) && (
              <div className="flex gap-1.5 text-[11px]">
                {sum.held > 0 && <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${TONE.sky}`}>{sum.held} held</span>}
                {sum.issued > 0 && <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ${TONE.green}`}>{sum.issued} issued</span>}
              </div>
            )}
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
            {error && <p className="m-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            {!loading && !list.length && !error && <p className="p-8 text-center text-sm text-slate-400">No tickets here.</p>}
            {days.map(({ day, rows }) => {
              const away = daysAway(day)
              return (
                <section key={day || 'none'}>
                  <h4 className="sticky top-0 z-10 flex items-center gap-2 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 text-[11px] font-bold text-slate-500 backdrop-blur">
                    <CalendarDays className="h-3 w-3" />{dayLabel(day)}
                    {away !== null && away >= 0 && away <= 7 && (
                      <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] ${away <= 2 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`}</span>
                    )}
                    {away !== null && away < 0 && <span className="ml-auto text-[10px] font-medium text-slate-400">past</span>}
                  </h4>
                  {rows.map(t => {
                    const on = t.id === selectedId
                    const m = markFor(t, marks[t.id], stages[t.id])
                    return (
                      <button key={t.id} data-ticket={t.id} onClick={() => select(t)}
                        className={`relative flex w-full gap-3 border-b border-slate-100 py-2.5 pl-4 pr-3 text-left transition ${on ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'}`}>
                        <span className={`absolute inset-y-2 left-1.5 w-1 rounded-full ${CAT_BAR[t.category ?? 'OTHER'] ?? 'bg-slate-300'}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`line-clamp-2 text-[13px] font-semibold leading-snug ${on ? 'text-white' : 'text-slate-900'}`}>{t.type}</p>
                          <p className={`mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] ${on ? 'text-slate-300' : 'text-slate-500'}`}>
                            <span className={`font-mono font-semibold ${on ? 'text-amber-300' : 'text-amber-700'}`}>{t.booking?.bookingRef}</span>
                            {t.booking?.agent && <span className="truncate">{t.booking.agent}</span>}
                          </p>
                          {m && <span className={`mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${on ? 'bg-white/15 text-white ring-white/20' : TONE[m.tone]}`}>{m.text}</span>}
                        </div>
                        <div className="flex-shrink-0 text-right">
                          <p className={`text-xs font-bold tabular-nums ${on ? 'text-white' : 'text-slate-900'}`}>{money(t.totalCost, t.currency)}</p>
                          <p className={`text-[10px] ${on ? 'text-slate-400' : 'text-slate-400'}`}>qty {t.qty}</p>
                        </div>
                      </button>
                    )
                  })}
                </section>
              )
            })}
            {list.length < total && (
              <div className="p-3">
                <button onClick={() => load(page + 1)} disabled={loading} className="btn btn-secondary btn-sm w-full justify-center">
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Load more · {total - list.length} left
                </button>
              </div>
            )}
          </div>
          <p className="hidden items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400 md:flex">
            <Keyboard className="h-3 w-3" /> ↑ ↓ to move through tickets · Esc to close
          </p>
        </aside>

        {/* ── right: the desk for the chosen ticket ── */}
        <main className={`min-w-0 flex-1 flex-col md:flex ${mobilePane ? 'flex' : 'hidden'}`}>
          <TicketContext t={selected} mark={marks[selected.id]} index={index} count={list.length}
            onPrev={() => step(-1)} onNext={() => step(1)} onBack={() => setMobilePane(false)} onClose={onClose} />
          <div className="relative min-h-0 flex-1">
            {alive.map(id => {
              const t = known[id]
              if (!t) return null
              return (
                <div key={id} className={`absolute inset-0 flex-col ${id === selectedId ? 'flex' : 'hidden'}`}>
                  <PortalIssuePane ticketId={id} ticketName={t.type} eyebrow="GlobalTix · Cebu · Manual"
                    onChanged={() => changed(id)} onManual={() => onManual(t)} onStage={s => setStage(id, s)} />
                </div>
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(panel, document.body)
}

/** The strip above the desk: what this ticket is, for whom, and when. */
function TicketContext({ t, mark, index, count, onPrev, onNext, onBack, onClose }: {
  t: WorkspaceTicket; mark: Mark | undefined; index: number; count: number
  onPrev: () => void; onNext: () => void; onBack: () => void; onClose: () => void
}) {
  const visit = visitOf(t)
  const away = daysAway(visit)
  const payOk = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-2.5 text-white">
      <button onClick={onBack} className="rounded-lg p-1 text-slate-300 hover:bg-white/10 md:hidden" aria-label="Back to the list"><ArrowLeft className="h-5 w-5" /></button>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {t.booking && (
          <Link href={`/dashboard/bookings/${t.booking.bookingRef}/tickets`} target="_blank" className="inline-flex items-center gap-1 font-mono font-bold text-amber-300 hover:underline">
            {t.booking.bookingRef}<ExternalLink className="h-3 w-3" />
          </Link>
        )}
        <span className="inline-flex items-center gap-1 text-slate-300"><CalendarDays className="h-3.5 w-3.5" />{dayLabel(visit)}
          {away !== null && away >= 0 && away <= 7 && <b className={away <= 2 ? 'text-red-300' : 'text-amber-300'}>· {away === 0 ? 'today' : away === 1 ? 'tomorrow' : `in ${away} days`}</b>}
        </span>
        {t.booking?.agent && <span className="inline-flex items-center gap-1 text-slate-300"><Users className="h-3.5 w-3.5" />{t.booking.agent}</span>}
        <span className="inline-flex items-center gap-1 text-slate-300"><TicketIcon className="h-3.5 w-3.5" />qty {t.qty} · quote <b className="text-white">{money(t.totalCost, t.currency)}</b></span>
        {t.pnlLine && (
          <span className={`inline-flex items-center gap-1 ${payOk ? 'text-emerald-300' : 'text-amber-300'}`}>
            {payOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}P&amp;L {t.pnlLine.paymentStatus.toLowerCase()}
          </span>
        )}
        {mark?.status === 'reserved' && <span className="inline-flex items-center gap-1 text-sky-300"><Hand className="h-3.5 w-3.5" />held {mark.reference}</span>}
        {t.status !== 'DRAFT' && !mark && <span className="inline-flex items-center gap-1 text-slate-300"><CircleDot className="h-3.5 w-3.5" />already bought{t.portalName ? ` on ${t.portalName}` : ''}{t.reference ? ` · ${t.reference}` : ''}</span>}
      </div>
      <div className="flex items-center gap-1">
        {count > 0 && <span className="mr-1 text-[11px] tabular-nums text-slate-400">{index >= 0 ? index + 1 : '–'} / {count}</span>}
        <button onClick={onPrev} disabled={index <= 0} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30" aria-label="Previous ticket" title="Previous (↑)"><ChevronUp className="h-4 w-4" /></button>
        <button onClick={onNext} disabled={index >= count - 1} className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30" aria-label="Next ticket" title="Next (↓)"><ChevronDown className="h-4 w-4" /></button>
        <button onClick={onClose} className="ml-1 rounded-lg p-1.5 text-slate-300 hover:bg-white/10" aria-label="Close"><X className="h-5 w-5" /></button>
      </div>
    </div>
  )
}
