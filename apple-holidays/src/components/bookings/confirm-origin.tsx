'use client'

/**
 * NEW vs RE-CONFIRMED badges for the All Bookings list.
 *
 * The data comes from `/api/bookings/confirm-origin` (see
 * `src/lib/as-confirm-origin.ts`), which reads each quote's revision trail from
 * the AppleSystem API. The list renders first; badges appear when that answer
 * arrives, and a row with no answer simply shows no badge.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, RotateCcw, Loader2 } from 'lucide-react'
import type { ConfirmOrigin } from '@/lib/as-confirm-origin'

const TZ = 'Asia/Colombo'
/** Matches the server's window: only files OPS created this recently are asked about. */
const WINDOW_DAYS = 7

export type ConfirmOriginMap = Record<string, ConfirmOrigin>
export type ConfirmOriginFilter = 'NEW' | 'RECONFIRMED' | null

function colomboDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function fmtDay(day: string | null, withYear = true): string {
  if (!day) return '—'
  const d = new Date(`${day}T12:00:00Z`)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })
}

function humanGap(days: number | null): string {
  if (days == null) return ''
  if (days < 1) return 'same day'
  if (days === 1) return '1 day'
  if (days < 60) return `${days} days`
  const months = Math.round(days / 30.4)
  return `${days} days (~${months} mo)`
}

// ── Data hook ────────────────────────────────────────────────────────────────

interface RowLike { bookingRef: string; createdAt: string; agent: string | null }

/**
 * Asks the server about the recent, IS-numbered rows on the current page.
 * The key is the sorted ref list, so paging back to a page already asked about
 * reuses the answer instead of asking AppleSystem again.
 */
export function useConfirmOrigins(rows: RowLike[]): { origins: ConfirmOriginMap; loading: boolean } {
  const [origins, setOrigins] = useState<ConfirmOriginMap>({})
  const [loading, setLoading] = useState(false)
  const asked = useRef(new Set<string>())

  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000
  const wanted = rows
    .filter(r => /^(VN|IS|SG|MY)\d+$/i.test(r.bookingRef) && Date.parse(r.createdAt) >= cutoff)
    .map(r => r.bookingRef.toUpperCase())
  const key = Array.from(new Set(wanted)).sort().join(',')

  useEffect(() => {
    const todo = key ? key.split(',').filter(r => !asked.current.has(r)) : []
    if (!todo.length) return
    todo.forEach(r => asked.current.add(r))
    let alive = true
    setLoading(true)
    fetch(`/api/bookings/confirm-origin?refs=${encodeURIComponent(todo.join(','))}`)
      .then(r => r.json())
      .then(json => {
        if (alive && json?.success) setOrigins(prev => ({ ...prev, ...(json.data?.origins ?? {}) }))
      })
      .catch(() => { todo.forEach(r => asked.current.delete(r)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [key])

  return { origins, loading }
}

// ── Timeline popover ─────────────────────────────────────────────────────────

const LETTER_STYLE: Record<string, { dot: string; label: string }> = {
  R: { dot: 'bg-slate-300 ring-slate-100', label: 'Quote revision' },
  C: { dot: 'bg-emerald-500 ring-emerald-100', label: 'Confirmed' },
  X: { dot: 'bg-red-500 ring-red-100', label: 'Cancelled' },
}

function Timeline({ o }: { o: ConfirmOrigin }) {
  // Long quote histories: keep every C and X, and only the first and last R.
  const revs = o.revisions
  const keep = revs.filter((r, i) => r.letter !== 'R' || i === 0 || i === revs.length - 1)
  const hidden = revs.length - keep.length
  const firstCAt = o.firstConfirmedAt
  return (
    <div className="w-72">
      <p className="text-[11px] font-semibold text-slate-800">
        Apple quote <span className="font-mono">#{o.quoteNo ?? '—'}</span>
      </p>
      <p className="text-[10px] text-slate-500 mb-2">
        {o.revisions.length} revision{o.revisions.length === 1 ? '' : 's'} · confirmed {o.confirmCount}×
        {hidden > 0 && ` · ${hidden} quote edit${hidden === 1 ? '' : 's'} folded`}
      </p>
      <ol className="relative ml-1.5 border-l border-slate-200 space-y-1.5">
        {keep.map((r, i) => {
          const s = LETTER_STYLE[r.letter]
          const isFirstC = r.at === firstCAt
          const isImported = r.at === o.importedConfirmAt
          return (
            <li key={`${r.at}-${i}`} className="pl-3 relative">
              <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 ${s.dot}`} />
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-[11px] ${r.letter === 'R' ? 'text-slate-500' : 'font-semibold text-slate-800'}`}>
                  {s.label}
                  {isFirstC && <span className="ml-1 text-[9px] font-bold uppercase text-emerald-700">first</span>}
                  {isImported && !isFirstC && <span className="ml-1 text-[9px] font-bold uppercase text-indigo-700">imported</span>}
                </span>
                <span className="text-[10px] font-mono text-slate-500 whitespace-nowrap">{fmtDay(r.day)} {fmtTime(r.at)}</span>
              </div>
            </li>
          )
        })}
        <li className="pl-3 relative">
          <span className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ring-2 bg-brand-500 ring-brand-100" />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold text-brand-700">OPS file created</span>
            <span className="text-[10px] font-mono text-slate-500">{fmtDay(o.opsCreatedDay)}</span>
          </div>
        </li>
      </ol>
      <p className="mt-2 pt-2 border-t border-slate-100 text-[10px] leading-snug text-slate-500">
        {o.kind === 'NEW'
          ? 'First time this quote was ever confirmed, so this is a new sale.'
          : `First confirmed ${humanGap(o.gapDays)} before OPS created this file. It came in as a re-confirmation, not a new sale.`}
        {o.cancelledBetween && ' It was cancelled in between and confirmed again.'}
      </p>
    </div>
  )
}

/** Hover / focus popover, drawn in a portal so the table's scroll box cannot clip it. */
function HoverCard({ children, card }: { children: React.ReactNode; card: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null)
  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const up = r.bottom + 260 > window.innerHeight
    setPos({ x: Math.min(r.left, window.innerWidth - 310), y: up ? r.top - 8 : r.bottom + 8, up })
  }
  return (
    <span ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} tabIndex={0} className="outline-none">
      {children}
      {pos && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[200] rounded-xl border border-slate-200 bg-white p-3 shadow-xl pointer-events-none"
          style={{ left: Math.max(8, pos.x), top: pos.y, transform: pos.up ? 'translateY(-100%)' : undefined }}
        >
          {card}
        </div>,
        document.body,
      )}
    </span>
  )
}

// ── Badges ───────────────────────────────────────────────────────────────────

/** Chip for the "Booking / Numbers" cell. */
export function ConfirmOriginBadge({ origin }: { origin: ConfirmOrigin | undefined }) {
  if (!origin || origin.kind === 'UNKNOWN') return null
  const today = colomboDay()

  if (origin.kind === 'NEW') {
    const isToday = origin.firstConfirmedDay === today
    return (
      <HoverCard card={<Timeline o={origin} />}>
        <span
          className={`relative inline-flex items-center gap-1 overflow-hidden px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm ${
            isToday ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 bg-[length:200%_100%] animate-confirm-shimmer' : 'bg-emerald-600/90'
          }`}
        >
          <Sparkles className="w-2.5 h-2.5" />
          New{isToday ? ' · today' : ` · ${fmtDay(origin.firstConfirmedDay, false)}`}
        </span>
      </HoverCard>
    )
  }

  return (
    <HoverCard card={<Timeline o={origin} />}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200">
        <RotateCcw className="w-2.5 h-2.5" />
        Re-confirmed
        <span className="font-mono normal-case font-semibold text-indigo-500">· 1st {fmtDay(origin.firstConfirmedDay, false)}</span>
        {origin.cancelledBetween && <span className="normal-case font-semibold text-red-600">· after cancel</span>}
      </span>
    </HoverCard>
  )
}

/**
 * Extra line under the Created column. For a re-confirmation it reads as a
 * two-stop journey: first confirmed in Apple, then the gap, then the OPS line
 * that is already there.
 */
export function ConfirmOriginCreatedNote({ origin }: { origin: ConfirmOrigin | undefined }) {
  if (!origin || origin.kind === 'UNKNOWN' || !origin.firstConfirmedDay) return null
  if (origin.kind === 'NEW') {
    return (
      <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-700 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        Apple confirmed {fmtDay(origin.firstConfirmedDay, false)}, {fmtTime(origin.firstConfirmedAt)}
      </div>
    )
  }
  return (
    <div className="mb-1 text-[10px] leading-tight whitespace-nowrap">
      <div className="flex items-center gap-1 text-indigo-700 font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        Apple 1st confirmed {fmtDay(origin.firstConfirmedDay)}
      </div>
      <div className="ml-[2.5px] pl-2 border-l border-dashed border-indigo-300 text-indigo-400 py-0.5">
        {humanGap(origin.gapDays)} later, OPS created ↓
      </div>
    </div>
  )
}

/** Summary + one-tap filter for the rows on this page. */
export function ConfirmOriginStrip({
  origins, refs, loading, filter, onFilter,
}: {
  origins: ConfirmOriginMap
  refs: string[]
  loading: boolean
  filter: ConfirmOriginFilter
  onFilter: (f: ConfirmOriginFilter) => void
}) {
  const today = colomboDay()
  const mine = refs.map(r => origins[r]).filter(Boolean) as ConfirmOrigin[]
  const newToday = mine.filter(o => o.kind === 'NEW' && o.opsCreatedDay === today).length
  const news = mine.filter(o => o.kind === 'NEW').length
  const re = mine.filter(o => o.kind === 'RECONFIRMED').length
  if (!loading && !news && !re) return null

  const pill = (active: boolean, base: string) =>
    `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
      active ? base : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-slate-100 bg-gradient-to-r from-emerald-50/60 via-white to-indigo-50/60">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Apple system confirmations</span>
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      <button type="button" onClick={() => onFilter(filter === 'NEW' ? null : 'NEW')} className={pill(filter === 'NEW', 'bg-emerald-600 text-white border-emerald-600')}>
        <Sparkles className="w-3 h-3" /> {news} new
        {newToday > 0 && <span className="text-[10px] opacity-80">({newToday} today)</span>}
      </button>
      <button type="button" onClick={() => onFilter(filter === 'RECONFIRMED' ? null : 'RECONFIRMED')} className={pill(filter === 'RECONFIRMED', 'bg-indigo-600 text-white border-indigo-600')}>
        <RotateCcw className="w-3 h-3" /> {re} re-confirmed
      </button>
      {filter && (
        <button type="button" onClick={() => onFilter(null)} className="text-[11px] text-slate-500 hover:text-slate-800 underline">
          show all rows
        </button>
      )}
      <span className="ml-auto text-[10px] text-slate-400">
        On this page, for files OPS created in the last {WINDOW_DAYS} days. Hover a badge to see the quote&apos;s history.
      </span>
    </div>
  )
}
