'use client'

/**
 * Bulk Issue Desk — every open ticket in a date window, grouped by product,
 * matched on GlobalTix / Cebu once, put in a cart, held, then paid with ONE
 * WhatsApp code. Every rule is enforced on the server (src/lib/ticket-portal/bulk.ts
 * and desk.ts); this screen only offers what they allow.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, ArrowRight, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Hand,
  Layers, Loader2, MessageCircle, Minus, PartyPopper, Plus, RefreshCw, Search, ShieldCheck, ShoppingCart, Sparkles,
  Ticket as TicketIcon, Trash2, Trophy, Undo2, Users, Wand2, X, XCircle,
} from 'lucide-react'
import {
  PROVIDER_LABEL, estimateCost, pickQuantities, type Estimate, type PortalOption, type Provider,
} from '@/lib/ticket-portal/shapes'
import { CodeBoxes, Notice, Spinner } from './portal-issue-desk'

/* ── server shapes ──────────────────────────────────────────────────── */

interface LiveBooking {
  id: string
  provider: Provider
  productName: string | null
  optionName: string | null
  tickets: { id: string; name: string; qty: number }[]
  visitDate: string | null
  reference: string | null
  status: string
  amount: number | null
  currency: string | null
  lastError: string | null
}

interface ScanLine {
  ticketId: string
  ticketName: string
  category: string | null
  bookingRef: string
  agent: string | null
  visitDate: string
  pax: { adults: number; children: number }
  customerName: string
  customerMobile: string
  quote: { amount: number | null; currency: string }
  live: LiveBooking | null
  blocked: string | null
}

interface ScanGroup {
  key: string
  name: string
  countries: string[]
  lines: ScanLine[]
  dates: { from: string; to: string }
  pax: { adults: number; children: number }
  quoteTotal: { amount: number; currency: string } | null
  held: number
}

interface ScanResult {
  window: { from: string; to: string }
  tickets: number
  truncated: boolean
  groups: ScanGroup[]
  approvers: string[]
  otpReady: boolean
}

interface Candidate {
  key: string
  provider: Provider
  productId: string
  name: string
  city: string | null
  image: string | null
  confidence: 'high' | 'medium' | 'low'
  why: string | null
  options: PortalOption[]
  optionsError: string | null
}

interface MatchLine {
  ticketId: string
  gate: string | null
  blocked: string | null
  picks: Record<string, { optionId: string; qty: Record<string, number>; estimate: Estimate | null }>
}

interface MatchResult {
  searchedFor: string
  lanes: Record<Provider, { state: 'ok' | 'error' | 'off' | 'none'; error: string | null }>
  candidates: Candidate[]
  lines: MatchLine[]
  ai: { used: boolean; note: string | null }
}

interface SentTo { name: string; phone: string; ok: boolean; error?: string }

/* ── the cart ───────────────────────────────────────────────────────── */

type Phase = 'cart' | 'holding' | 'held' | 'paying' | 'paid' | 'failed' | 'unknown'

interface CartLine {
  ticketId: string
  ticketName: string
  bookingRef: string
  groupKey: string
  groupName: string
  provider: Provider
  productId: string
  productName: string
  image: string | null
  /** Null for a hold made earlier (on the single-ticket desk). */
  option: PortalOption | null
  qty: Record<string, number>
  visitDate: string
  eventTime: string
  answers: Record<string, string>
  customerName: string
  customerMobile: string
  gate: string | null
  pay: boolean
  phase: Phase
  bookingId: string | null
  reference: string | null
  amount: number | null
  currency: string | null
  error: string | null
}

const CART_KEY = 'ops.bulkTicketCart.v1'
const LIVE_STATES = ['reserving', 'reserved', 'confirming', 'unknown', 'confirmed', 'cancelling']

/* ── helpers ────────────────────────────────────────────────────────── */

async function call<T>(url: string, init?: RequestInit): Promise<{ data: T; message?: string }> {
  const res = await fetch(url, init)
  const text = await res.text()
  let json: { success?: boolean; data?: T; error?: string; message?: string } = {}
  try { json = text ? JSON.parse(text) : {} } catch { throw new Error(`The server answered ${res.status}.`) }
  if (!json.success) throw new Error(json.error || `The server answered ${res.status}.`)
  return { data: json.data as T, message: json.message }
}
const post = <T,>(url: string, body: unknown = {}) =>
  call<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const money = (amount: number | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined ? '—' : `${currency ?? ''} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()

/** "MYR 534.00 + SGD 20.00" — never adds across currencies. */
function totals(list: { amount: number | null | undefined; currency: string | null | undefined }[]) {
  const by = new Map<string, number>()
  for (const x of list) if (x.amount !== null && x.amount !== undefined) by.set(x.currency ?? '', (by.get(x.currency ?? '') ?? 0) + x.amount)
  return Array.from(by.entries()).map(([c, a]) => money(a, c)).join(' + ') || '—'
}

const localIso = (d: Date) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10) }
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const rangeLabel = (a: string, b: string) => (a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`)
const paxLabel = (p: { adults: number; children: number }) => `${p.adults} ad${p.children ? ` · ${p.children} ch` : ''}`

function presets() {
  const today = localIso(new Date())
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: 'tomorrow', label: 'Tomorrow', from: addDays(today, 1), to: addDays(today, 1) },
    { id: 'week', label: 'This week', from: today, to: addDays(today, dow === 0 ? 0 : 7 - dow) },
    { id: 'next7', label: 'Next 7 days', from: today, to: addDays(today, 6) },
    { id: 'next14', label: 'Next 14 days', from: today, to: addDays(today, 13) },
  ]
}

/** What a hold needs that this line does not have yet. Empty when it can be held. */
function missingFor(l: CartLine): string[] {
  const out: string[] = []
  if (!l.option) return out
  const e = estimateCost(l.option, l.qty, l.visitDate)
  if (!e) out.push('tickets')
  if (e?.closed) out.push('a date the portal sells')
  if (l.option.date_required && !l.visitDate) out.push('a visit date')
  if (l.option.kind === 'timeslot' && !l.eventTime) out.push('a time slot')
  if (l.customerName.trim().length < 2) out.push('the guest name')
  if (l.provider === 'cebu' && l.customerMobile.replace(/\D/g, '').length < 6) out.push('a contact number')
  for (const q of l.option.questions) if (!q.optional && !l.answers[String(q.id)]?.trim()) out.push(`“${q.question}”`)
  return out
}

const lineAmount = (l: CartLine) =>
  l.amount !== null ? { amount: l.amount, currency: l.currency } : (() => { const e = estimateCost(l.option, l.qty, l.visitDate); return { amount: e?.amount ?? null, currency: e?.currency ?? null } })()

function fromLive(b: LiveBooking): Pick<CartLine, 'phase' | 'bookingId' | 'reference' | 'amount' | 'currency' | 'error'> | null {
  const phase: Phase | null =
    b.status === 'reserved' ? 'held'
      : b.status === 'confirmed' ? 'paid'
        : ['unknown', 'confirming', 'reserving', 'cancelling'].includes(b.status) ? 'unknown'
          : null
  return phase ? { phase, bookingId: b.id, reference: b.reference, amount: b.amount, currency: b.currency, error: b.lastError } : null
}

const LANE_DOT: Record<Provider, string> = { globaltix: 'bg-sky-500', cebu: 'bg-violet-500' }

/* ── root ───────────────────────────────────────────────────────────── */

type Mode = 'build' | 'approve'

export default function BulkIssueDesk({ onClose, onChanged, countryFilter }: { onClose: () => void; onChanged: () => void; countryFilter?: string | null }) {
  const windows = useMemo(presets, [])
  const [win, setWin] = useState({ id: 'next7', from: windows[3].from, to: windows[3].to })
  const [q, setQ] = useState('')
  const [includeAll, setIncludeAll] = useState(false)
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [matches, setMatches] = useState<Record<string, MatchResult>>({})
  const [cart, setCart] = useState<CartLine[]>(() => {
    try { const raw = window.localStorage.getItem(CART_KEY); return raw ? (JSON.parse(raw) as CartLine[]) : [] } catch { return [] }
  })
  const [mode, setMode] = useState<Mode>('build')
  const [cartOpen, setCartOpen] = useState(false)
  const [smart, setSmart] = useState<{ done: number; of: number; added: number } | null>(null)

  useEffect(() => { try { window.localStorage.setItem(CART_KEY, JSON.stringify(cart)) } catch { /* convenience only */ } }, [cart])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const runScan = useCallback(async (w = win, search = q, all = includeAll) => {
    setScanning(true); setScanError(null)
    try {
      const p = new URLSearchParams({ from: w.from, to: w.to })
      if (search.trim()) p.set('q', search.trim())
      if (countryFilter) p.set('country', countryFilter)
      if (all) p.set('all', '1')
      const { data } = await call<ScanResult>(`/api/tickets/bulk-issue/scan?${p}`)
      setScan(data)
      setGroupKey(k => (k && data.groups.some(g => g.key === k) ? k : data.groups[0]?.key ?? null))
    } catch (e) { setScanError(e instanceof Error ? e.message : 'The tickets could not be read.') }
    finally { setScanning(false) }
  }, [win, q, includeAll, countryFilter])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { runScan() }, [])

  const patch = useCallback((ticketId: string, p: Partial<CartLine>) => setCart(c => c.map(l => (l.ticketId === ticketId ? { ...l, ...p } : l))), [])

  /** Read a line's truth from the desk and settle it. */
  const syncLine = useCallback(async (l: CartLine) => {
    try {
      const { data } = await call<{ bookings: LiveBooking[] }>(`/api/tickets/${l.ticketId}/portal`)
      const b = (l.bookingId && data.bookings.find(x => x.id === l.bookingId)) || data.bookings.find(x => LIVE_STATES.includes(x.status))
      const live = b ? fromLive(b) : null
      if (live) patch(l.ticketId, live)
      else if (b && ['released', 'cancelled'].includes(b.status)) patch(l.ticketId, { phase: l.option ? 'cart' : 'failed', bookingId: null, reference: null, amount: null, currency: null, error: l.option ? null : `The hold was ${b.status}.` })
      else if (['holding', 'paying'].includes(l.phase)) patch(l.ticketId, { phase: l.bookingId ? 'held' : 'cart' })
    } catch { /* leave it; the screen says what it last knew */ }
  }, [patch])

  // A cart restored from an earlier visit is checked against the portals' records.
  const synced = useRef(false)
  useEffect(() => {
    if (synced.current) return
    synced.current = true
    cart.filter(l => l.phase !== 'cart' && l.phase !== 'paid').forEach(l => { syncLine(l) })
  }, [cart, syncLine])

  const loadMatch = useCallback(async (g: ScanGroup, opts: { q?: string; fresh?: boolean } = {}) => {
    const ids = g.lines.filter(l => !l.blocked).map(l => l.ticketId)
    if (!ids.length) throw new Error('Every ticket in this group is blocked.')
    const { data } = await post<MatchResult>('/api/tickets/bulk-issue/match', { ticketIds: ids, q: opts.q, fresh: opts.fresh })
    setMatches(m => ({ ...m, [g.key]: data }))
    return data
  }, [])

  const addLines = useCallback((lines: CartLine[]) => {
    setCart(c => {
      const have = new Set(c.map(l => l.ticketId))
      return [...c, ...lines.filter(l => !have.has(l.ticketId))]
    })
  }, [])

  /** Smart fill: match every group and add the strongest, cheapest pick. The person still reviews and holds. */
  async function smartFill() {
    if (!scan) return
    const groups = scan.groups.filter(g => g.lines.some(l => !l.blocked && !l.live && !cart.some(c => c.ticketId === l.ticketId)))
    setSmart({ done: 0, of: groups.length, added: 0 })
    let added = 0
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]
      try {
        const m = matches[g.key] ?? await loadMatch(g)
        const strong = m.candidates.filter(c => c.confidence === 'high' && !c.optionsError)
        const best = bestCandidate(strong, m, g, {})
        if (best) {
          const lines = buildLines(g, m, best, {}, null).filter(l => !missingFor(l).some(x => x.startsWith('a date') || x === 'tickets'))
          added += lines.length
          addLines(lines)
        }
      } catch { /* a group that cannot be matched is left for the person */ }
      setSmart({ done: i + 1, of: groups.length, added })
    }
    toast.success(added ? `Added ${added} ticket${added === 1 ? '' : 's'} to the cart. Review them before holding.` : 'No strong matches to add. Pick them by hand.')
    setSmart(null)
    if (added) setCartOpen(true)
  }

  const group = scan?.groups.find(g => g.key === groupKey) ?? null
  const inCart = cart.length
  const heldCount = cart.filter(l => l.phase === 'held').length

  const steps = ['Find', 'Match', 'Cart', 'Hold', 'Approve', 'Issued']
  const step = mode === 'approve' ? (cart.some(l => l.phase === 'paid') && !cart.some(l => l.phase === 'held' && l.pay) ? 5 : 4)
    : heldCount ? 3 : inCart ? 2 : group ? 1 : 0

  const panel = (
    <div className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label="Bulk Issue Desk">
      <div className="flex w-full max-w-[1500px] flex-col overflow-hidden bg-slate-50 shadow-2xl sm:rounded-2xl">
        <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-slate-200 bg-white px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm"><Layers className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ticket Issue Desk · Bulk</p>
            <h2 className="truncate text-base font-bold text-slate-900">Buy a week of tickets in one go</h2>
          </div>
          <ol className="order-last hidden w-full items-center gap-1 lg:order-none lg:flex lg:w-auto">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-1">
                <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${i < step ? 'bg-emerald-50 text-emerald-700' : i === step ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  {i < step ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}{s}
                </span>
                {i < steps.length - 1 && <span className="h-px w-2 bg-slate-200" />}
              </li>
            ))}
          </ol>
          <button onClick={() => { setMode('build'); setCartOpen(o => !o) }} className="relative btn btn-secondary btn-sm xl:hidden" aria-label="Cart">
            <ShoppingCart className="h-4 w-4" /> Cart
            {inCart > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{inCart}</span>}
          </button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* left — window and groups */}
          <aside className={`flex w-full flex-col border-r border-slate-200 bg-white md:w-80 md:flex-shrink-0 ${mode === 'approve' || cartOpen ? 'hidden md:flex' : group ? 'hidden md:flex' : 'flex'}`}>
            <div className="space-y-3 border-b border-slate-100 p-4">
              <div className="flex flex-wrap gap-1.5">
                {windows.map(w => (
                  <button key={w.id} onClick={() => { const n = { id: w.id, from: w.from, to: w.to }; setWin(n); runScan(n) }}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${win.id === w.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{w.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">From</span>
                  <input type="date" value={win.from} onChange={e => setWin(w => ({ ...w, id: 'custom', from: e.target.value }))} className="form-input py-1 text-xs" /></label>
                <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">To</span>
                  <input type="date" value={win.to} onChange={e => setWin(w => ({ ...w, id: 'custom', to: e.target.value }))} className="form-input py-1 text-xs" /></label>
              </div>
              <form onSubmit={e => { e.preventDefault(); runScan() }} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. Bird Park" className="form-input w-full py-1.5 pl-8 text-sm" />
                </div>
                <button type="submit" disabled={scanning} className="btn btn-primary btn-sm">{scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarRange className="h-3.5 w-3.5" />} Scan</button>
              </form>
              <label className="flex items-center gap-2 text-[11px] text-slate-500">
                <input type="checkbox" className="accent-slate-900" checked={includeAll} onChange={e => { setIncludeAll(e.target.checked); runScan(win, q, e.target.checked) }} />
                Include hotels, transfers, guides and flights
              </label>
            </div>

            {scan && (
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                <span><b className="text-slate-900">{scan.tickets}</b> open · <b className="text-slate-900">{scan.groups.length}</b> products</span>
                <button onClick={smartFill} disabled={!!smart || !scan.groups.length} title="Match every product and add strong matches at the best price. You review before anything is held."
                  className="ml-auto inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-1 font-semibold text-white shadow-sm disabled:opacity-60">
                  {smart ? <><Loader2 className="h-3 w-3 animate-spin" /> {smart.done}/{smart.of}</> : <><Wand2 className="h-3 w-3" /> Smart fill</>}
                </button>
              </div>
            )}
            {scan?.truncated && <p className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800">Showing the first 600 tickets. Narrow the window or search.</p>}

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
              {scanError && <Notice tone="red">{scanError}</Notice>}
              {!scan && scanning && <Spinner label="Finding open tickets…" />}
              {scan && !scan.groups.length && <p className="p-6 text-center text-sm text-slate-400">No open tickets in this window.</p>}
              {scan?.groups.map(g => {
                const carted = g.lines.filter(l => cart.some(c => c.ticketId === l.ticketId)).length
                const blocked = g.lines.filter(l => l.blocked).length
                return (
                  <button key={g.key} onClick={() => { setGroupKey(g.key); setMode('build'); setCartOpen(false) }}
                    className={`group block w-full rounded-xl border p-3 text-left transition ${groupKey === g.key ? 'border-slate-900 bg-slate-900 text-white shadow-md' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}>
                    <div className="flex items-start gap-2">
                      <p className={`line-clamp-2 flex-1 text-[13px] font-semibold leading-snug ${groupKey === g.key ? 'text-white' : 'text-slate-900'}`}>{g.name}</p>
                      <span className={`flex-shrink-0 rounded-lg px-2 py-0.5 text-xs font-bold tabular-nums ${groupKey === g.key ? 'bg-white/15 text-white' : 'bg-amber-100 text-amber-800'}`}>×{g.lines.length}</span>
                    </div>
                    <div className={`mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] ${groupKey === g.key ? 'text-slate-300' : 'text-slate-500'}`}>
                      <span>{rangeLabel(g.dates.from, g.dates.to)}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{paxLabel(g.pax)}</span>
                      <span>{g.countries.join('/')}</span>
                    </div>
                    {(carted > 0 || g.held > 0 || blocked > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {carted > 0 && <Chip tone="amber" inverted={groupKey === g.key}>{carted} in cart</Chip>}
                        {g.held > 0 && <Chip tone="sky" inverted={groupKey === g.key}>{g.held} held</Chip>}
                        {blocked > 0 && <Chip tone="red" inverted={groupKey === g.key}>{blocked} blocked</Chip>}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </aside>

          {/* centre — match workspace, or approval */}
          <main className={`min-w-0 flex-1 overflow-y-auto ${cartOpen && mode === 'build' ? 'hidden xl:block' : ''} ${!group && mode === 'build' ? 'hidden md:block' : ''}`}>
            {mode === 'approve' ? (
              <ApprovePanel cart={cart} patch={patch} syncLine={syncLine} scan={scan} onBack={() => setMode('build')} onChanged={onChanged} />
            ) : group ? (
              <GroupWorkspace key={group.key} group={group} match={matches[group.key] ?? null} loadMatch={loadMatch} cart={cart} addLines={addLines}
                onBack={() => setGroupKey(null)} onAdded={() => setCartOpen(true)} />
            ) : (
              <EmptyState scanning={scanning} />
            )}
          </main>

          {/* right — cart */}
          <aside className={`w-full flex-col border-l border-slate-200 bg-white xl:flex xl:w-[380px] xl:flex-shrink-0 ${cartOpen && mode === 'build' ? 'flex' : 'hidden'}`}>
            <CartPanel cart={cart} setCart={setCart} patch={patch} syncLine={syncLine} onApprove={() => { setMode('approve'); setCartOpen(false) }} onChanged={onChanged} approveOpen={mode === 'approve'} />
          </aside>
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(panel, document.body)
}

/* ── small parts ────────────────────────────────────────────────────── */

function Chip({ tone, children, inverted }: { tone: 'amber' | 'sky' | 'red' | 'green' | 'slate' | 'violet'; children: React.ReactNode; inverted?: boolean }) {
  const cls = inverted ? 'bg-white/15 text-white' : {
    amber: 'bg-amber-50 text-amber-700 ring-amber-200', sky: 'bg-sky-50 text-sky-700 ring-sky-200', red: 'bg-red-50 text-red-700 ring-red-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200', slate: 'bg-slate-100 text-slate-600 ring-slate-200', violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ring-transparent ${cls}`}>{children}</span>
}

function EmptyState({ scanning }: { scanning: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"><Layers className="h-6 w-6 text-slate-400" /></span>
      <p className="text-sm font-semibold text-slate-700">{scanning ? 'Finding open tickets…' : 'Pick a product on the left'}</p>
      <p className="max-w-sm text-xs text-slate-500">Every open ticket in the window is grouped by product, so all of the week’s KL Bird Park tickets are matched, priced and bought together.</p>
    </div>
  )
}

const PHASE_CHIP: Record<Phase, { tone: 'amber' | 'sky' | 'red' | 'green' | 'slate' | 'violet'; label: string }> = {
  cart: { tone: 'slate', label: 'In cart' },
  holding: { tone: 'sky', label: 'Holding…' },
  held: { tone: 'sky', label: 'Held' },
  paying: { tone: 'violet', label: 'Paying…' },
  paid: { tone: 'green', label: 'Issued' },
  failed: { tone: 'red', label: 'Failed' },
  unknown: { tone: 'amber', label: 'Check status' },
}

/* ── picking a candidate for a group ───────────────────────────────── */

interface Edit { visit?: string; qty?: Record<string, number> }

function planFor(c: Candidate, m: MatchResult, l: ScanLine, edit: Edit | undefined, optionId: string | null) {
  const pick = m.lines.find(x => x.ticketId === l.ticketId)?.picks[c.key]
  const oid = optionId ?? pick?.optionId ?? null
  const option = c.options.find(o => o.id === oid) ?? null
  const qty = edit?.qty ?? (pick && pick.optionId === oid ? pick.qty : pickQuantities(option, l.pax))
  const visit = edit?.visit ?? l.visitDate
  return { option, qty, visit, estimate: estimateCost(option, qty, visit) }
}

function bestCandidate(cands: Candidate[], m: MatchResult, g: ScanGroup, edits: Record<string, Edit>): Candidate | null {
  const lines = g.lines.filter(l => !l.blocked && !l.live)
  let best: { c: Candidate; total: number; cur: string | null } | null = null
  for (const c of cands) {
    const plans = lines.map(l => planFor(c, m, l, edits[l.ticketId], null).estimate)
    if (!plans.length || plans.some(e => !e || e.closed)) continue
    const cur = plans[0]!.currency
    if (plans.some(e => e!.currency !== cur)) continue
    const total = plans.reduce((a, e) => a + e!.amount, 0)
    if (best && best.cur !== cur) return null // different currencies: let the person choose
    if (!best || total < best.total) best = { c, total, cur }
  }
  return best?.c ?? null
}

function buildLines(g: ScanGroup, m: MatchResult, c: Candidate, edits: Record<string, Edit>, optionId: string | null, only?: Set<string>): CartLine[] {
  return g.lines
    .filter(l => !l.blocked && !l.live && (!only || only.has(l.ticketId)))
    .map(l => {
      const p = planFor(c, m, l, edits[l.ticketId], optionId)
      return { l, p, ml: m.lines.find(x => x.ticketId === l.ticketId) }
    })
    .filter(x => x.p.option && !x.ml?.blocked)
    .map(({ l, p, ml }): CartLine => ({
      ticketId: l.ticketId, ticketName: l.ticketName, bookingRef: l.bookingRef, groupKey: g.key, groupName: g.name,
      provider: c.provider, productId: c.productId, productName: c.name, image: c.image,
      option: p.option, qty: p.qty, visitDate: p.visit, eventTime: '', answers: {},
      customerName: l.customerName, customerMobile: l.customerMobile, gate: ml?.gate ?? null, pay: !ml?.gate,
      phase: 'cart', bookingId: null, reference: null, amount: null, currency: null, error: null,
    }))
}

function GroupWorkspace({ group: g, match, loadMatch, cart, addLines, onBack, onAdded }: {
  group: ScanGroup
  match: MatchResult | null
  loadMatch: (g: ScanGroup, o?: { q?: string; fresh?: boolean }) => Promise<MatchResult>
  cart: CartLine[]
  addLines: (l: CartLine[]) => void
  onBack: () => void
  onAdded: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [choice, setChoice] = useState<string | null>(null)
  const [optionId, setOptionId] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const run = useCallback(async (o: { q?: string; fresh?: boolean } = {}) => {
    setBusy(true); setError(null)
    try { await loadMatch(g, o) } catch (e) { setError(e instanceof Error ? e.message : 'The portals could not be read.') }
    finally { setBusy(false) }
  }, [g, loadMatch])
  useEffect(() => { if (!match) run() }, [match, run])

  const usable = useMemo(() => (match?.candidates ?? []).filter(c => !c.optionsError && c.options.length), [match])
  const best = useMemo(() => (match ? bestCandidate(usable.filter(c => c.confidence !== 'low'), match, g, edits) : null), [usable, match, g, edits])

  // Default to the best value, and tick everything that can be bought.
  useEffect(() => {
    if (!match || (choice && usable.some(c => c.key === choice))) return
    const pick = best ?? usable[0] ?? null
    if (pick && pick.key !== choice) setChoice(pick.key)
  }, [match, best, usable, choice])

  const cand = usable.find(c => c.key === choice) ?? null
  const inCart = useMemo(() => new Set(cart.map(c => c.ticketId)), [cart])

  const rows = useMemo(() => g.lines.map(l => {
    const ml = match?.lines.find(x => x.ticketId === l.ticketId)
    const plan = cand && match ? planFor(cand, match, l, edits[l.ticketId], optionId) : null
    const why = l.blocked ?? ml?.blocked ?? (l.live ? null : inCart.has(l.ticketId) ? null : !plan?.option ? 'No ticket option on this product' : !plan.estimate ? 'No price' : plan.estimate.closed ? 'Not sold on this date' : null)
    const addable = !l.live && !inCart.has(l.ticketId) && !l.blocked && !ml?.blocked && Boolean(plan?.estimate && !plan.estimate.closed)
    return { l, ml, plan, why, addable }
  }), [g, match, cand, edits, optionId, inCart])

  useEffect(() => {
    setChecked(new Set(rows.filter(r => r.addable).map(r => r.l.ticketId)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, optionId, match])

  const picked = rows.filter(r => r.addable && checked.has(r.l.ticketId))
  const pickedTotal = totals(picked.map(r => ({ amount: r.plan?.estimate?.amount, currency: r.plan?.estimate?.currency })))

  const candTotal = (c: Candidate) => {
    if (!match) return null
    const es = g.lines.filter(l => !l.blocked && !l.live).map(l => planFor(c, match, l, edits[l.ticketId], c.key === choice ? optionId : null).estimate)
    const ok = es.filter((e): e is Estimate => Boolean(e && !e.closed))
    return { text: totals(ok), priced: ok.length, of: es.length, from: ok.some(e => e.from) }
  }

  function add() {
    if (!cand || !match) return
    const lines = buildLines(g, match, cand, edits, optionId, new Set(picked.map(r => r.l.ticketId)))
    addLines(lines)
    toast.success(`${lines.length} ticket${lines.length === 1 ? '' : 's'} added to the cart`)
    onAdded()
  }

  function addHeld() {
    const lines: CartLine[] = g.lines.filter(l => l.live && !inCart.has(l.ticketId)).flatMap(l => {
      const live = fromLive(l.live!)
      if (!live) return []
      return [{
        ticketId: l.ticketId, ticketName: l.ticketName, bookingRef: l.bookingRef, groupKey: g.key, groupName: g.name,
        provider: l.live!.provider, productId: '', productName: l.live!.productName ?? l.ticketName, image: null, option: null,
        qty: Object.fromEntries(l.live!.tickets.map(t => [t.id, t.qty])), visitDate: l.live!.visitDate ?? l.visitDate, eventTime: '', answers: {},
        customerName: l.customerName, customerMobile: l.customerMobile, gate: null, pay: true, ...live,
      }]
    })
    addLines(lines)
    toast.success(`${lines.length} earlier hold${lines.length === 1 ? '' : 's'} added to the cart`)
    onAdded()
  }

  const setQty = (l: ScanLine, ticketTypeId: string, n: number, base: Record<string, number>) =>
    setEdits(e => ({ ...e, [l.ticketId]: { ...e[l.ticketId], qty: { ...base, [ticketTypeId]: Math.max(0, Math.min(40, n)) } } }))

  const heldHere = g.lines.filter(l => l.live && !inCart.has(l.ticketId)).length

  return (
    <div className="flex min-h-full flex-col">
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={onBack} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 md:hidden" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold leading-tight text-slate-900">{g.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {g.lines.length} ticket{g.lines.length === 1 ? '' : 's'} · {rangeLabel(g.dates.from, g.dates.to)} · {paxLabel(g.pax)}
              {g.quoteTotal && <> · quoted {money(g.quoteTotal.amount, g.quoteTotal.currency)}</>}
            </p>
          </div>
          <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); setChoice(null); setOptionId(null); run({ q: q.trim() || undefined }) }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search both portals…" className="form-input w-52 py-1.5 pl-8 text-sm" />
            </div>
            <button type="button" onClick={() => run({ q: q.trim() || undefined, fresh: true })} disabled={busy} className="btn btn-secondary btn-sm" title="Read prices again">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </form>
        </div>

        {heldHere > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm text-sky-800">
            <Hand className="h-4 w-4" /><span className="flex-1">{heldHere} ticket{heldHere === 1 ? ' is' : 's are'} already held from earlier.</span>
            <button onClick={addHeld} className="rounded-lg bg-white px-3 py-1 text-xs font-bold text-sky-800 ring-1 ring-sky-300 hover:bg-sky-100">Add to cart to pay</button>
          </div>
        )}

        {error && <Notice tone="red">{error}</Notice>}
        {busy && !match && <Spinner label="Matching on GlobalTix and Cebu…" />}
        {match?.ai.note && <p className="text-xs text-amber-700">{match.ai.note}</p>}
        {match && (['globaltix', 'cebu'] as Provider[]).filter(p => match.lanes[p].state === 'error').map(p => (
          <Notice key={p} tone="red"><b>{PROVIDER_LABEL[p]} could not be read.</b> {match.lanes[p].error} This does not mean it has no tickets.</Notice>
        ))}

        {match && (
          <>
            {best && cand?.key === best.key && (
              <div className="flex items-center gap-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white">
                <Trophy className="h-4 w-4 text-amber-300" />
                <span className="flex-1">Best value for the whole group is <b>{PROVIDER_LABEL[best.provider]}</b> · {candTotal(best)?.text}</span>
              </div>
            )}

            {match.candidates.length === 0 ? (
              <Notice tone="amber">No product on GlobalTix or Cebu matches “{match.searchedFor}”. Try another name in the search box.</Notice>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                {match.candidates.map(c => {
                  const t = candTotal(c)
                  const on = choice === c.key
                  const usableC = !c.optionsError && c.options.length > 0
                  return (
                    <button key={c.key} disabled={!usableC} onClick={() => { setChoice(c.key); setOptionId(null); setEdits({}) }}
                      className={`relative flex gap-3 rounded-xl border bg-white p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${on ? 'border-slate-900 ring-2 ring-slate-900/10' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
                      {best?.key === c.key && <span className="absolute -top-2 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Best value</span>}
                      {c.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.image} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
                      ) : <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100"><TicketIcon className="h-5 w-5 text-slate-400" /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${LANE_DOT[c.provider]}`} />{PROVIDER_LABEL[c.provider]}
                          <span className={`ml-auto ${c.confidence === 'high' ? 'text-emerald-600' : c.confidence === 'medium' ? 'text-slate-500' : 'text-amber-600'}`}>{c.confidence === 'high' ? 'Strong' : c.confidence === 'medium' ? 'Likely' : 'Weak — check'}</span></p>
                        <p className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">{c.name}</p>
                        {usableC && t
                          ? <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{t.from ? 'from ' : ''}{t.text}<span className="ml-1 text-[11px] font-medium text-slate-400">{t.priced}/{t.of} priced</span></p>
                          : <p className="mt-1 text-[11px] text-slate-400">{c.optionsError ?? 'No tickets listed'}</p>}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {cand && (
              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <input type="checkbox" className="accent-slate-900"
                      checked={rows.some(r => r.addable) && rows.filter(r => r.addable).every(r => checked.has(r.l.ticketId))}
                      onChange={e => setChecked(e.target.checked ? new Set(rows.filter(r => r.addable).map(r => r.l.ticketId)) : new Set())} />
                    Select all
                  </label>
                  {cand.options.length > 1 && (
                    <select className="form-input ml-auto w-auto max-w-xs py-1 text-xs" value={optionId ?? ''} onChange={e => { setOptionId(e.target.value || null); setEdits({}) }}>
                      <option value="">Option per ticket (auto)</option>
                      {cand.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  )}
                </div>
                <ul className="divide-y divide-slate-100">
                  {rows.map(({ l, ml, plan, why, addable }) => (
                    <li key={l.ticketId} className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center ${!addable ? 'bg-slate-50/60' : ''}`}>
                      <input type="checkbox" className="mt-1 accent-slate-900 md:mt-0" disabled={!addable} checked={addable && checked.has(l.ticketId)}
                        onChange={e => setChecked(s => { const n = new Set(s); if (e.target.checked) n.add(l.ticketId); else n.delete(l.ticketId); return n })} />
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="font-mono text-xs font-semibold text-amber-700">{l.bookingRef}</span>
                          <span className="truncate text-xs text-slate-500">{l.customerName || l.agent || ''}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          <input type="date" value={plan?.visit ?? l.visitDate} disabled={!!l.live || inCart.has(l.ticketId)}
                            onChange={e => setEdits(x => ({ ...x, [l.ticketId]: { ...x[l.ticketId], visit: e.target.value } }))}
                            className="rounded border border-slate-200 px-1 py-0.5 text-[11px] disabled:border-transparent disabled:bg-transparent" />
                          <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{paxLabel(l.pax)}</span>
                        </p>
                      </div>
                      <div className="col-start-2 flex flex-wrap gap-1.5 md:col-start-auto">
                        {plan?.option && !l.live && !inCart.has(l.ticketId) && plan.option.tickets.map(t => (
                          <span key={t.id} className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 text-[11px]">
                            <span className="max-w-[110px] truncate px-1.5 text-slate-600" title={t.name}>{t.name}</span>
                            <button type="button" aria-label="Fewer" onClick={() => setQty(l, t.id, (plan.qty[t.id] ?? 0) - 1, plan.qty)} className="px-1 text-slate-400 hover:bg-slate-50"><Minus className="h-3 w-3" /></button>
                            <span className="w-5 text-center font-bold tabular-nums">{plan.qty[t.id] ?? 0}</span>
                            <button type="button" aria-label="More" onClick={() => setQty(l, t.id, (plan.qty[t.id] ?? 0) + 1, plan.qty)} className="px-1 text-slate-400 hover:bg-slate-50"><Plus className="h-3 w-3" /></button>
                          </span>
                        ))}
                        {l.live && <Chip tone="sky">Held · {l.live.reference ?? '…'} · {money(l.live.amount, l.live.currency)}</Chip>}
                        {!l.live && inCart.has(l.ticketId) && <Chip tone="amber"><ShoppingCart className="h-3 w-3" /> In cart</Chip>}
                        {ml?.gate && !l.live && <Chip tone="amber" >Hold only — {ml.gate}</Chip>}
                        {why && <Chip tone="red">{why}</Chip>}
                      </div>
                      <div className="col-start-2 text-left md:col-start-auto md:text-right">
                        <p className="text-sm font-bold tabular-nums text-slate-900">{plan?.estimate && !l.live ? `${plan.estimate.from ? 'from ' : ''}${money(plan.estimate.amount, plan.estimate.currency)}` : ''}</p>
                        {l.quote.amount !== null && <p className="text-[11px] tabular-nums text-slate-400">quote {money(l.quote.amount, l.quote.currency)}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      {cand && (
        <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0 flex-1 text-sm">
            <b className="tabular-nums text-slate-900">{picked.length ? pickedTotal : '—'}</b>
            <span className="text-slate-500"> · {picked.length} ticket{picked.length === 1 ? '' : 's'} on {PROVIDER_LABEL[cand.provider]} · nothing is held or charged yet</span>
          </div>
          <button onClick={add} disabled={!picked.length} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            <ShoppingCart className="h-4 w-4" /> Add {picked.length || ''} to cart <ArrowRight className="h-4 w-4" />
          </button>
        </footer>
      )}
    </div>
  )
}

/* ── cart ───────────────────────────────────────────────────────────── */

function CartPanel({ cart, setCart, patch, syncLine, onApprove, onChanged, approveOpen }: {
  cart: CartLine[]
  setCart: React.Dispatch<React.SetStateAction<CartLine[]>>
  patch: (id: string, p: Partial<CartLine>) => void
  syncLine: (l: CartLine) => Promise<void>
  onApprove: () => void
  onChanged: () => void
  approveOpen: boolean
}) {
  const [holding, setHolding] = useState<{ done: number; of: number } | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const toHold = cart.filter(l => l.phase === 'cart' || (l.phase === 'failed' && l.option && !l.bookingId))
  const ready = toHold.filter(l => !missingFor(l).length)
  const needs = toHold.length - ready.length
  const payable = cart.filter(l => l.phase === 'held' && l.pay)
  const unknown = cart.filter(l => l.phase === 'unknown')

  async function holdAll() {
    const queue = [...ready]
    setHolding({ done: 0, of: queue.length })
    let done = 0, ok = 0
    const worker = async () => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        patch(l.ticketId, { phase: 'holding', error: null })
        try {
          const { data } = await post<LiveBooking>(`/api/tickets/${l.ticketId}/portal/hold`, {
            provider: l.provider, productId: l.productId, productName: l.productName, optionId: l.option?.id, qty: l.qty,
            visitDate: l.visitDate, eventTime: l.eventTime, answers: l.answers, customerName: l.customerName, customerMobile: l.customerMobile, alsoCovers: [],
          })
          patch(l.ticketId, { phase: 'held', bookingId: data.id, reference: data.reference, amount: data.amount, currency: data.currency, error: null })
          ok++
        } catch (e) {
          patch(l.ticketId, { phase: 'failed', error: e instanceof Error ? e.message : 'The hold failed' })
        }
        setHolding({ done: ++done, of: ready.length })
      }
    }
    await Promise.all([worker(), worker(), worker()])
    setHolding(null)
    onChanged()
    if (ok === ready.length) toast.success(`All ${ok} held. Nothing has been charged yet.`)
    else toast.warning(`${ok} of ${ready.length} held. Check the failed lines.`)
  }

  async function release(l: CartLine) {
    if (!l.bookingId) return
    try {
      await post(`/api/tickets/${l.ticketId}/portal/bookings/${l.bookingId}/release`)
      patch(l.ticketId, { phase: l.option ? 'cart' : 'failed', bookingId: null, reference: null, amount: null, currency: null, error: l.option ? null : 'Released.' })
      toast.success('Hold released')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The release failed') }
  }

  const remove = (id: string) => setCart(c => c.filter(l => l.ticketId !== id))
  const groups = useMemo(() => {
    const m = new Map<string, CartLine[]>()
    for (const l of cart) m.set(l.groupName, [...(m.get(l.groupName) ?? []), l])
    return Array.from(m.entries())
  }, [cart])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <ShoppingCart className="h-4 w-4 text-slate-500" />
        <h3 className="flex-1 text-sm font-bold text-slate-900">Cart <span className="font-medium text-slate-400">· {cart.length}</span></h3>
        {cart.some(l => l.phase === 'paid') && <button onClick={() => setCart(c => c.filter(l => l.phase !== 'paid'))} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">Clear issued</button>}
        {cart.some(l => l.phase !== 'cart' && l.phase !== 'paid') && <button onClick={() => cart.forEach(l => { if (l.phase !== 'cart' && l.phase !== 'paid') syncLine(l) })} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" title="Check every line with the portals"><RefreshCw className="h-3.5 w-3.5" /></button>}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!cart.length && (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 ring-1 ring-slate-200"><ShoppingCart className="h-5 w-5 text-slate-300" /></span>
            <p className="text-sm font-semibold text-slate-600">The cart is empty</p>
            <p className="text-xs text-slate-400">Pick a product, tick its tickets, and add them here. Or try Smart fill.</p>
          </div>
        )}
        {groups.map(([name, lines]) => (
          <div key={name} className="overflow-hidden rounded-xl border border-slate-200">
            <p className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600"><span className="truncate">{name}</span><span className="ml-auto tabular-nums text-slate-400">{lines.length}</span></p>
            <ul className="divide-y divide-dashed divide-slate-200">
              {lines.map(l => {
                const need = l.phase === 'cart' ? missingFor(l) : []
                const amt = lineAmount(l)
                const chip = PHASE_CHIP[l.phase]
                const expanded = open === l.ticketId
                return (
                  <li key={l.ticketId} className="bg-white">
                    <div className="flex items-start gap-2 px-3 py-2.5">
                      <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${LANE_DOT[l.provider]}`} title={PROVIDER_LABEL[l.provider]} />
                      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : l.ticketId)}>
                        <p className="flex items-center gap-1.5 text-xs">
                          <span className="font-mono font-semibold text-amber-700">{l.bookingRef}</span>
                          <span className="text-slate-400">{dayLabel(l.visitDate)}</span>
                          {expanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {l.option ? l.option.tickets.filter(t => l.qty[t.id]).map(t => `${l.qty[t.id]}× ${t.name}`).join(', ') : Object.values(l.qty).reduce((a, n) => a + n, 0) + ' tickets'}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Chip tone={chip.tone}>{l.phase === 'holding' || l.phase === 'paying' ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}{chip.label}{l.reference ? ` · ${l.reference}` : ''}</Chip>
                          {need.length > 0 && <Chip tone="amber">Needs {need[0]}{need.length > 1 ? ` +${need.length - 1}` : ''}</Chip>}
                          {l.phase === 'held' && l.gate && <Chip tone="amber">Waiting on Accounts</Chip>}
                        </div>
                      </button>
                      <div className="text-right">
                        <p className="text-xs font-bold tabular-nums text-slate-900">{money(amt.amount, amt.currency)}</p>
                        {l.phase === 'held' && (
                          <label className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500" title="Include in the one-code payment">
                            <input type="checkbox" className="accent-emerald-600" checked={l.pay} onChange={e => patch(l.ticketId, { pay: e.target.checked })} /> pay
                          </label>
                        )}
                      </div>
                    </div>
                    {l.error && <p className="mx-3 mb-2 rounded-md bg-red-50 px-2 py-1 text-[11px] text-red-700">{l.error}</p>}
                    {expanded && <LineEditor line={l} patch={patch} onRemove={() => remove(l.ticketId)} onRelease={() => release(l)} onCheck={() => syncLine(l)} />}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
          {unknown.length > 0 && <Notice tone="amber">{unknown.length} line{unknown.length === 1 ? '' : 's'} waiting on the portal. Open it and press Check status before paying again.</Notice>}
          {toHold.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{toHold.length} to hold{needs > 0 && <span className="text-amber-700"> · {needs} need details</span>}</span>
                <b className="tabular-nums text-slate-900">{totals(toHold.map(lineAmount))}</b>
              </div>
              {holding && <Progress done={holding.done} of={holding.of} tone="sky" />}
              <button onClick={holdAll} disabled={!ready.length || !!holding} className="btn btn-secondary w-full justify-center border-slate-900 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
                {holding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />} Hold {ready.length} ticket{ready.length === 1 ? '' : 's'} · free
              </button>
            </>
          )}
          {payable.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{payable.length} held, ready to pay</span>
                <b className="tabular-nums text-slate-900">{totals(payable.map(lineAmount))}</b>
              </div>
              <button onClick={onApprove} disabled={approveOpen} className="btn btn-primary w-full justify-center text-base disabled:opacity-60">
                <ShieldCheck className="h-4 w-4" /> Approve &amp; pay all · one code
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Progress({ done, of, tone }: { done: number; of: number; tone: 'sky' | 'emerald' }) {
  const pct = of ? Math.round((done / of) * 100) : 0
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className={`h-full rounded-full transition-all duration-500 ${tone === 'sky' ? 'bg-sky-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-1 text-right text-[10px] tabular-nums text-slate-500">{done} / {of}</p>
    </div>
  )
}

function LineEditor({ line: l, patch, onRemove, onRelease, onCheck }: { line: CartLine; patch: (id: string, p: Partial<CartLine>) => void; onRemove: () => void; onRelease: () => void; onCheck: () => void }) {
  const editable = l.phase === 'cart' || (l.phase === 'failed' && !l.bookingId)
  const [slots, setSlots] = useState<string[] | null>(null)
  const [confirmRelease, setConfirmRelease] = useState(false)
  const opt = l.option

  useEffect(() => {
    setSlots(null)
    if (!editable || opt?.kind !== 'timeslot' || !l.visitDate || !opt.tickets[0]) return
    let gone = false
    call<string[]>(`/api/tickets/${l.ticketId}/portal/slots?ticketTypeId=${opt.tickets[0].id}&date=${l.visitDate}`)
      .then(r => { if (!gone) setSlots(r.data) }).catch(() => { if (!gone) setSlots([]) })
    return () => { gone = true }
  }, [editable, opt, l.visitDate, l.ticketId])

  const e = estimateCost(opt, l.qty, l.visitDate)
  return (
    <div className="space-y-2 border-t border-slate-100 bg-slate-50/70 px-3 py-3 text-xs">
      <p className="font-semibold text-slate-700">{l.productName}{opt && opt.name !== l.productName ? <span className="font-normal text-slate-500"> · {opt.name}</span> : null}</p>
      {editable && opt && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Visit date</span>
              <input type="date" value={l.visitDate} onChange={x => patch(l.ticketId, { visitDate: x.target.value, eventTime: '' })} className="form-input py-1 text-xs" /></label>
            {opt.kind === 'timeslot' && (
              <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Time slot</span>
                <select className="form-input py-1 text-xs" value={l.eventTime} disabled={!slots?.length} onChange={x => patch(l.ticketId, { eventTime: x.target.value })}>
                  <option value="">{slots === null ? 'Reading…' : slots.length ? 'Choose' : 'None open'}</option>
                  {slots?.map(s => <option key={s} value={s}>{s.slice(0, 5)}</option>)}
                </select></label>
            )}
          </div>
          {opt.tickets.map(t => (
            <div key={t.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-slate-600">{t.name}</span>
              <span className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 bg-white">
                <button type="button" aria-label="Fewer" onClick={() => patch(l.ticketId, { qty: { ...l.qty, [t.id]: Math.max(0, (l.qty[t.id] ?? 0) - 1) } })} className="px-1.5 text-slate-400"><Minus className="h-3 w-3" /></button>
                <span className="w-5 text-center font-bold tabular-nums">{l.qty[t.id] ?? 0}</span>
                <button type="button" aria-label="More" onClick={() => patch(l.ticketId, { qty: { ...l.qty, [t.id]: Math.min(40, (l.qty[t.id] ?? 0) + 1) } })} className="px-1.5 text-slate-400"><Plus className="h-3 w-3" /></button>
              </span>
            </div>
          ))}
          {e?.closed && <p className="text-amber-700">Not sold on this date — pick another.</p>}
          <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Name on the booking</span>
            <input className="form-input py-1 text-xs" value={l.customerName} onChange={x => patch(l.ticketId, { customerName: x.target.value })} /></label>
          {l.provider === 'cebu' && (
            <label className="block"><span className="mb-0.5 block text-[10px] font-semibold uppercase text-slate-400">Contact number</span>
              <input className="form-input py-1 text-xs" value={l.customerMobile} onChange={x => patch(l.ticketId, { customerMobile: x.target.value })} /></label>
          )}
          {opt.questions.map(qq => (
            <label key={String(qq.id)} className="block"><span className="mb-0.5 block text-[10px] font-semibold text-slate-500">{qq.question}{qq.optional ? ' (optional)' : ''}</span>
              {qq.options.length ? (
                <select className="form-input py-1 text-xs" value={l.answers[String(qq.id)] ?? ''} onChange={x => patch(l.ticketId, { answers: { ...l.answers, [String(qq.id)]: x.target.value } })}>
                  <option value="">Choose…</option>
                  {qq.options.map(o => <option key={o.key} value={o.key}>{o.value}</option>)}
                </select>
              ) : <input className="form-input py-1 text-xs" value={l.answers[String(qq.id)] ?? ''} onChange={x => patch(l.ticketId, { answers: { ...l.answers, [String(qq.id)]: x.target.value } })} />}
            </label>
          ))}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {(l.phase === 'held' || l.phase === 'unknown') && <button onClick={onCheck} className="btn btn-secondary btn-sm"><RefreshCw className="h-3 w-3" /> Check status</button>}
        {l.phase === 'held' && (confirmRelease
          ? <span className="ml-auto flex items-center gap-1.5 text-slate-600">Let it go? <button onClick={onRelease} className="btn btn-sm bg-red-600 text-white">Release</button><button onClick={() => setConfirmRelease(false)} className="btn btn-secondary btn-sm">Keep</button></span>
          : <button onClick={() => setConfirmRelease(true)} className="btn btn-secondary btn-sm ml-auto"><Undo2 className="h-3 w-3" /> Release hold</button>)}
        {(editable || l.phase === 'paid' || (l.phase === 'failed' && !l.bookingId)) && <button onClick={onRemove} className="btn btn-sm ml-auto border border-slate-200 bg-white text-slate-500 hover:text-red-600"><Trash2 className="h-3 w-3" /> Remove</button>}
      </div>
    </div>
  )
}

/* ── one code, then pay every line ─────────────────────────────────── */

function ApprovePanel({ cart, patch, syncLine, scan, onBack, onChanged }: {
  cart: CartLine[]
  patch: (id: string, p: Partial<CartLine>) => void
  syncLine: (l: CartLine) => Promise<void>
  scan: ScanResult | null
  onBack: () => void
  onChanged: () => void
}) {
  // The cart the code is bound to is fixed when the code is sent.
  const [locked, setLocked] = useState<CartLine[] | null>(null)
  const lines = locked ?? cart.filter(l => l.phase === 'held' && l.pay)
  const live = (id: string) => cart.find(l => l.ticketId === id) ?? null
  const items = lines.map(l => ({ ticketId: l.ticketId, bookingId: l.bookingId! }))

  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<{ expiresAt: number; resendAt: number; sentTo: SentTo[]; total: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState<{ done: number; of: number } | null>(null)
  const [finished, setFinished] = useState(false)
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  async function send() {
    setSending(true); setError(null); setCode('')
    const fixed = cart.filter(l => l.phase === 'held' && l.pay)
    try {
      const { data } = await post<{ expiresAt: string; sentTo: SentTo[]; resendAfter: number; total: string }>('/api/tickets/bulk-issue/send-code', {
        items: fixed.map(l => ({ ticketId: l.ticketId, bookingId: l.bookingId })),
      })
      setLocked(fixed)
      setSent({ expiresAt: new Date(data.expiresAt).getTime(), resendAt: Date.now() + data.resendAfter * 1000, sentTo: data.sentTo, total: data.total })
    } catch (e) { setError(e instanceof Error ? e.message : 'The code could not be sent.') }
    finally { setSending(false) }
  }

  async function approveAndPay() {
    setError(null)
    try {
      await post('/api/tickets/bulk-issue/approve', { items, code })
    } catch (e) { setError(e instanceof Error ? e.message : 'The code was not accepted.'); setCode(''); return }

    const queue = [...lines]
    let done = 0
    setPaying({ done: 0, of: queue.length })
    // Two at a time: quick, and gentle on the portals.
    const worker = async () => {
      for (let l = queue.shift(); l; l = queue.shift()) {
        patch(l.ticketId, { phase: 'paying', error: null })
        try {
          const { data } = await post<LiveBooking>('/api/tickets/bulk-issue/pay', { items, ticketId: l.ticketId, bookingId: l.bookingId })
          const s = fromLive(data)
          patch(l.ticketId, s ?? { phase: 'paid' })
        } catch (e) {
          patch(l.ticketId, { error: e instanceof Error ? e.message : 'The payment failed' })
          await syncLine({ ...l, phase: 'paying' })
        }
        setPaying({ done: ++done, of: lines.length })
      }
    }
    await Promise.all([worker(), worker()])
    setPaying(null)
    setFinished(true)
    onChanged()
  }

  const left = sent ? Math.max(0, Math.floor((sent.expiresAt - now) / 1000)) : 0
  const wait = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0
  const results = lines.map(l => live(l.ticketId) ?? l)
  const paid = results.filter(l => l.phase === 'paid')
  const trouble = results.filter(l => l.phase !== 'paid')

  if (!lines.length && !finished) {
    return (
      <div className="mx-auto max-w-xl space-y-4 p-6">
        <button onClick={onBack} className="btn btn-secondary btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> Back</button>
        <Notice tone="blue">Nothing is held and ticked to pay yet. Hold the cart first.</Notice>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5 sm:p-8">
      {!paying && <button onClick={onBack} className="btn btn-secondary btn-sm"><ArrowLeft className="h-3.5 w-3.5" /> Back to the cart</button>}

      {finished ? (
        <div className={`overflow-hidden rounded-2xl text-white shadow-lg ${trouble.length ? 'bg-gradient-to-br from-slate-800 to-slate-900' : 'bg-gradient-to-br from-emerald-500 to-teal-600'}`}>
          <div className="flex items-center gap-4 p-6">
            {trouble.length ? <AlertTriangle className="h-10 w-10 text-amber-300" /> : <PartyPopper className="h-10 w-10" />}
            <div>
              <p className="text-2xl font-bold">{paid.length} of {lines.length} issued</p>
              <p className="text-sm text-white/80">{totals(paid.map(lineAmount))} paid{trouble.length ? ` · ${trouble.length} need${trouble.length === 1 ? 's' : ''} attention below` : ' · tickets, codes and receipts are saved on each ticket'}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white shadow-lg">
          <div className="flex flex-wrap items-end gap-4 p-6">
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">One approval · one payment run</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{sent?.total ?? totals(lines.map(lineAmount))}</p>
              <p className="mt-1 text-sm text-slate-300">{lines.length} ticket{lines.length === 1 ? '' : 's'} across {new Set(lines.map(l => l.bookingRef)).size} booking{new Set(lines.map(l => l.bookingRef)).size === 1 ? '' : 's'} · {(['globaltix', 'cebu'] as Provider[]).map(p => ({ p, n: lines.filter(l => l.provider === p).length })).filter(x => x.n).map(x => `${PROVIDER_LABEL[x.p]} ×${x.n}`).join(' · ')}</p>
            </div>
            <ShieldCheck className="h-12 w-12 text-emerald-400/80" />
          </div>
        </div>
      )}

      {!finished && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          {!scan?.otpReady ? (
            <Notice tone="amber">No approver WhatsApp numbers are set. Add them under Settings → Ticket Issue Desk.</Notice>
          ) : !sent ? (
            <div className="text-center">
              <MessageCircle className="mx-auto h-8 w-8 text-emerald-500" />
              <p className="mt-2 text-sm text-slate-600">One 6-digit code goes to {scan.approvers.join(', ')} on WhatsApp with the cart’s total. It only works for exactly these holds at exactly these amounts.</p>
              <button onClick={send} disabled={sending} className="btn btn-primary mt-4">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Send one code on WhatsApp
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap justify-center gap-1.5">
                {sent.sentTo.map(s => <span key={s.phone} title={s.error} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{s.ok ? '✓' : '✕'} {s.name} {s.phone}</span>)}
              </div>
              <CodeBoxes value={code} onChange={setCode} disabled={!!paying || left === 0} />
              <p className="text-center text-xs tabular-nums text-slate-500">
                {left > 0 ? <>Code expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</> : <span className="font-semibold text-red-600">The code has expired.</span>}
                {' · '}
                <button onClick={send} disabled={wait > 0 || sending || !!paying} className="font-semibold text-slate-700 underline disabled:no-underline disabled:opacity-50">{wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}</button>
              </p>
              {paying && <Progress done={paying.done} of={paying.of} tone="emerald" />}
              <button onClick={approveAndPay} disabled={code.replace(/\s/g, '').length !== 6 || !!paying || left === 0} className="btn w-full justify-center bg-emerald-600 py-3 text-base text-white hover:bg-emerald-700 disabled:opacity-50">
                {paying ? <><Loader2 className="h-4 w-4 animate-spin" /> Paying {paying.done + 1 > paying.of ? paying.of : paying.done + 1} of {paying.of}…</> : <><ShieldCheck className="h-4 w-4" /> Approve &amp; pay {sent.total}</>}
              </button>
            </div>
          )}
          {error && <div className="mt-4"><Notice tone="red">{error}</Notice></div>}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <ul className="divide-y divide-slate-100">
          {results.map(l => (
            <li key={l.ticketId} className="flex items-center gap-3 px-4 py-2.5">
              {l.phase === 'paid' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                : l.phase === 'paying' ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-violet-600" />
                  : l.phase === 'held' && !l.error ? <CircleDashed className="h-4 w-4 flex-shrink-0 text-slate-300" />
                    : l.phase === 'unknown' ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
                      : <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs"><span className="font-mono font-semibold text-amber-700">{l.bookingRef}</span> <span className="text-slate-600">{l.productName}</span></p>
                <p className="text-[11px] text-slate-400">{dayLabel(l.visitDate)} · {PROVIDER_LABEL[l.provider]}{l.reference ? ` · ${l.reference}` : ''}</p>
                {l.error && l.phase !== 'paid' && <p className="text-[11px] text-red-600">{l.error}</p>}
              </div>
              <span className="text-xs font-bold tabular-nums text-slate-900">{money(lineAmount(l).amount, lineAmount(l).currency)}</span>
              {l.phase === 'unknown' && <button onClick={() => syncLine(l)} className="btn btn-secondary btn-sm"><RefreshCw className="h-3 w-3" /> Check</button>}
            </li>
          ))}
        </ul>
      </div>

      {finished && (
        <div className="flex flex-wrap gap-2">
          <button onClick={onBack} className="btn btn-secondary"><ArrowLeft className="h-4 w-4" /> Back to the cart</button>
          {trouble.some(l => l.phase === 'held') && (
            <button onClick={() => { setLocked(null); setSent(null); setFinished(false); setCode('') }} className="btn btn-primary"><Sparkles className="h-4 w-4" /> Pay the rest with a new code</button>
          )}
        </div>
      )}
      <p className="text-center text-[11px] text-slate-400">Each hold is paid once, on its own portal, and saved on its ticket with the portal’s codes and a purchase record. A portal that does not answer leaves its line locked until Check status reads the portal’s own record.</p>
    </div>
  )
}
