'use client'

/**
 * Ticket Issue Desk — compare GlobalTix, Cebu and Manual for one ticket, hold it,
 * approve with a WhatsApp code, and issue. Every rule is enforced on the server
 * (src/lib/ticket-portal/desk.ts); this screen only offers what it allows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ExternalLink, Hand, Loader2, MessageCircle, PenLine, RefreshCw,
  Search, ShieldCheck, Sparkles, Ticket as TicketIcon, Trophy, Undo2, X,
} from 'lucide-react'
import {
  PROVIDER_LABEL, estimateCost, type Estimate, type PortalOption, type PortalRecord, type Provider,
} from '@/lib/ticket-portal/shapes'

interface Candidate {
  key: string
  provider: Provider
  productId: string
  name: string
  city: string | null
  image: string | null
  confidence: 'high' | 'medium' | 'low'
  why: string | null
  covers: { id: string; name: string }[]
  options: PortalOption[]
  optionsError: string | null
  pick: { optionId: string; qty: Record<string, number> } | null
  estimate: Estimate | null
}

interface Lane { state: 'ok' | 'error' | 'off' | 'none'; error: string | null; searched: number; candidates: Candidate[] }

interface Plan {
  name: string
  searchedFor: string
  visitDate: string
  pax: { adults: number; children: number }
  customerName: string
  customerMobile: string
  quote: { amount: number | null; currency: string }
  lanes: Record<Provider, Lane>
  ai: { used: boolean; note: string | null }
}

interface Booking {
  id: string
  provider: Provider
  productName: string | null
  optionName: string | null
  tickets: { id: string; name: string; qty: number; nett?: number | null }[]
  alsoCovers: string[]
  visitDate: string | null
  eventTime: string | null
  customerName: string | null
  reference: string | null
  status: string
  amount: number | null
  currency: string | null
  lastError: string | null
  details: PortalRecord | null
  confirmedByName: string | null
  canCancelHere: boolean
}

interface DeskState {
  blocked: string | null
  gate: string | null
  otpReady: boolean
  approvers: string[]
  ticket: { id: string; name: string; status: string; currency: string; totalCost: number | null }
  bookings: Booking[]
}

interface SentTo { name: string; phone: string; ok: boolean; error?: string }

const money = (amount: number | null | undefined, currency?: string | null) =>
  amount === null || amount === undefined ? '—' : `${currency ?? ''} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim()

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

const STEPS = ['Compare', 'Hold', 'WhatsApp code', 'Issued']
const LIVE_STATES = ['reserving', 'reserved', 'confirming', 'unknown', 'confirmed', 'cancelling']

export default function PortalIssueDesk({ ticketId, ticketName, onClose, onChanged, onManual }: {
  ticketId: string
  ticketName: string
  onClose: () => void
  onChanged: () => void
  onManual: () => void
}) {
  const base = `/api/tickets/${ticketId}/portal`
  const [state, setState] = useState<DeskState | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    try { setState((await call<DeskState>(base)).data); setStateError(null) }
    catch (e) { setStateError(e instanceof Error ? e.message : 'The desk could not be opened.') }
  }, [base])
  useEffect(() => { loadState() }, [loadState])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])

  const live = state?.bookings.find(b => LIVE_STATES.includes(b.status)) ?? null
  const step = !live ? 0 : live.status === 'confirmed' || live.status === 'cancelling' ? 3 : 2

  const refresh = () => { loadState(); onChanged() }

  const panel = (
    <div className="fixed inset-0 z-[9999] flex items-stretch justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label={`Issue ${ticketName}`}>
      <div className="flex w-full max-w-6xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:rounded-2xl">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Ticket Issue Desk</p>
            <h2 className="truncate text-base font-bold text-slate-900">{ticketName}</h2>
          </div>
          <ol className="order-last flex w-full items-center gap-1.5 md:order-none md:w-auto">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  i < step ? 'bg-emerald-50 text-emerald-700' : i === step ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
                }`}>
                  {i < step ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
                  <span className="hidden md:inline">{s}</span>
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-3 bg-slate-200" />}
              </li>
            ))}
          </ol>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {stateError && <div className="p-5"><Notice tone="red">{stateError}</Notice></div>}
          {!state && !stateError && <Spinner label="Opening the desk…" />}
          {state && (state.blocked
            ? <div className="p-5"><Notice tone="amber">{state.blocked}</Notice></div>
            : live
              ? <LiveBooking base={base} booking={live} state={state} quote={state.ticket} onChanged={refresh} />
              : <Compare base={base} state={state} onManual={onManual} onHeld={refresh} />)}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(panel, document.body)
}

/* ── shared bits ────────────────────────────────────────────────────── */

export function Spinner({ label }: { label: string }) {
  return <div className="flex items-center justify-center gap-2 py-20 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> {label}</div>
}

export function Notice({ tone, children }: { tone: 'red' | 'amber' | 'blue' | 'green'; children: React.ReactNode }) {
  const cls = { red: 'border-red-200 bg-red-50 text-red-700', amber: 'border-amber-200 bg-amber-50 text-amber-800', blue: 'border-blue-200 bg-blue-50 text-blue-700', green: 'border-emerald-200 bg-emerald-50 text-emerald-700' }[tone]
  return <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${cls}`}><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /><div className="min-w-0">{children}</div></div>
}

const LANE_STYLE: Record<Provider, { dot: string }> = { globaltix: { dot: 'bg-sky-500' }, cebu: { dot: 'bg-violet-500' } }

/* ── step 1: compare ────────────────────────────────────────────────── */

type Picks = Record<string, { optionId: string; qty: Record<string, number> }>

function Compare({ base, state, onManual, onHeld }: { base: string; state: DeskState; onManual: () => void; onHeld: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [picks, setPicks] = useState<Picks>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [visit, setVisit] = useState('')
  const [manualCost, setManualCost] = useState('')
  const [form, setForm] = useState({ name: '', mobile: '', time: '', answers: {} as Record<string, string>, also: [] as string[] })
  const [holding, setHolding] = useState(false)
  const [slots, setSlots] = useState<string[] | null>(null)

  const load = useCallback(async (opts: { fresh?: boolean; search?: string } = {}) => {
    setBusy(true); setError(null)
    try {
      const url = new URLSearchParams()
      if (opts.fresh) url.set('fresh', '1')
      if (opts.search) url.set('q', opts.search)
      const { data } = await call<Plan>(`${base}/compare?${url}`)
      setPlan(data)
      setVisit(v => v || data.visitDate)
      setManualCost(m => m || (data.quote.amount ? String(data.quote.amount) : ''))
      setForm(f => ({ ...f, name: f.name || data.customerName, mobile: f.mobile || data.customerMobile }))
      const next: Picks = {}
      for (const lane of Object.values(data.lanes)) for (const c of lane.candidates) if (c.pick) next[c.key] = c.pick
      setPicks(next)
      setSelected(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'The portals could not be compared.') }
    finally { setBusy(false) }
  }, [base])
  useEffect(() => { load() }, [load])

  const all = useMemo(() => (plan ? [...plan.lanes.globaltix.candidates, ...plan.lanes.cebu.candidates] : []), [plan])
  const estimateOf = useCallback((c: Candidate) => {
    const pick = picks[c.key]
    return pick ? estimateCost(c.options.find(o => o.id === pick.optionId), pick.qty, visit) : null
  }, [picks, visit])

  // Lowest only among likely matches and open dates, and never across currencies.
  const ranking = useMemo(() => {
    const priced = all
      .filter(c => c.confidence !== 'low')
      .map(c => ({ key: c.key, e: estimateOf(c) }))
      .filter((x): x is { key: string; e: Estimate } => Boolean(x.e && !x.e.closed))
    const cur = priced[0]?.e.currency ?? null
    const mixed = priced.some(x => x.e.currency !== cur)
    const same = mixed ? [] : [...priced].sort((a, b) => a.e.amount - b.e.amount)
    const manual = Number(manualCost)
    const manualPriced = manual > 0 && plan?.quote.currency === cur
    const best = same[0] ?? null
    const manualWins = Boolean(best && manualPriced && manual < best.e.amount)
    return { best: manualWins ? null : best, manualWins, runnerUp: same[1] ?? null, mixed, cur }
  }, [all, estimateOf, manualCost, plan])

  const sel = all.find(c => c.key === selected) ?? null
  const selPick = sel ? picks[sel.key] : null
  const selOption = sel?.options.find(o => o.id === selPick?.optionId) ?? null
  const selEstimate = sel ? estimateOf(sel) : null

  useEffect(() => {
    setSlots(null)
    if (selOption?.kind !== 'timeslot' || !visit || !selOption.tickets[0]) return
    let gone = false
    call<string[]>(`${base}/slots?ticketTypeId=${selOption.tickets[0].id}&date=${visit}`)
      .then(r => { if (!gone) setSlots(r.data) })
      .catch(() => { if (!gone) setSlots([]) })
    return () => { gone = true }
  }, [base, selOption, visit])

  const openDates = useMemo(() => {
    if (!selOption || !selEstimate?.closed) return []
    const picked = selOption.tickets.filter(t => selPick?.qty[t.id])
    const shared = (picked[0]?.dates ?? []).filter(d => picked.every(t => t.prices?.[d] !== undefined) && d >= new Date().toISOString().slice(0, 10))
    return shared.sort((a, b) => Math.abs(+new Date(a) - +new Date(visit)) - Math.abs(+new Date(b) - +new Date(visit))).slice(0, 5).sort()
  }, [selOption, selEstimate, selPick, visit])

  const missing: string[] = []
  if (sel) {
    if (!selEstimate) missing.push('tickets')
    if (selEstimate?.closed) missing.push('a date this portal sells')
    if (selOption?.date_required && !visit) missing.push('a visit date')
    if (selOption?.kind === 'timeslot' && !form.time) missing.push('a time slot')
    if (form.name.trim().length < 2) missing.push('the guest name')
    if (sel.provider === 'cebu' && form.mobile.replace(/\D/g, '').length < 6) missing.push('a contact number')
    for (const q2 of selOption?.questions ?? []) if (!q2.optional && !form.answers[String(q2.id)]?.trim()) missing.push(`an answer to “${q2.question}”`)
  }

  async function holdIt() {
    if (!sel || !selPick) return
    setHolding(true)
    try {
      const { message } = await post(`${base}/hold`, {
        provider: sel.provider, productId: sel.productId, productName: sel.name, optionId: selPick.optionId, qty: selPick.qty,
        visitDate: visit, eventTime: form.time, answers: form.answers, customerName: form.name, customerMobile: form.mobile, alsoCovers: form.also,
      })
      toast.success(message ?? 'Held')
      onHeld()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The hold failed') }
    finally { setHolding(false) }
  }

  const setQty = (ticketId: string, value: number) => {
    if (!sel) return
    setPicks(p => ({ ...p, [sel.key]: { ...p[sel.key], qty: { ...p[sel.key].qty, [ticketId]: Math.max(0, Math.min(40, value)) } } }))
  }

  if (busy && !plan) return <Spinner label="Reading GlobalTix and Cebu…" />
  if (error && !plan) return <div className="space-y-3 p-5"><Notice tone="red">{error}</Notice><button onClick={() => load()} className="btn btn-secondary btn-sm">Try again</button></div>
  if (!plan) return null

  const best = ranking.best ? all.find(c => c.key === ranking.best!.key) : null
  const saving = ranking.best && plan.quote.amount && plan.quote.currency === ranking.cur ? plan.quote.amount - ranking.best.e.amount : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 p-5">
        {state.gate && <Notice tone="amber"><b>You can hold this now, but not pay yet:</b> {state.gate}</Notice>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Visit date</span>
            <input type="date" value={visit} onChange={e => setVisit(e.target.value)} className="form-input py-1.5 text-sm" />
          </label>
          <div className="pb-1.5 text-sm text-slate-600">
            <b className="text-slate-900">{plan.pax.adults}</b> adult{plan.pax.adults === 1 ? '' : 's'}{plan.pax.children > 0 && <> · <b className="text-slate-900">{plan.pax.children}</b> child{plan.pax.children === 1 ? '' : 'ren'}</>}
            {plan.quote.amount ? <span className="text-slate-400"> · quote cost {money(plan.quote.amount, plan.quote.currency)}</span> : null}
          </div>
          <form className="ml-auto flex items-center gap-2" onSubmit={e => { e.preventDefault(); load({ search: q.trim() }) }}>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search both portals…" className="form-input w-56 py-1.5 pl-8 text-sm" />
            </div>
            <button type="button" onClick={() => load({ fresh: true, search: q.trim() })} disabled={busy} className="btn btn-secondary btn-sm" title="Read prices again">
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </form>
        </div>

        {plan.ai.note && <p className="text-xs text-amber-700">{plan.ai.note}</p>}

        {(best || ranking.manualWins) && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white">
            <Trophy className="h-5 w-5 text-amber-300" />
            <div className="min-w-0 flex-1 text-sm">
              {ranking.manualWins
                ? <>Manual is the lowest at <b>{money(Number(manualCost), plan.quote.currency)}</b>.</>
                : <>Lowest is <b>{money(ranking.best!.e.amount, ranking.best!.e.currency)}</b> on <b>{PROVIDER_LABEL[best!.provider]}</b>
                    {ranking.runnerUp && <span className="text-slate-300"> · {money(ranking.runnerUp.e.amount - ranking.best!.e.amount, ranking.cur)} under the next option</span>}
                    {saving !== null && saving > 0 && <span className="text-emerald-300"> · saves {money(saving, ranking.cur)} on the quote</span>}
                    {saving !== null && saving < 0 && <span className="text-amber-300"> · {money(-saving, ranking.cur)} over the quote</span>}</>}
            </div>
            {best && <button onClick={() => setSelected(best.key)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100">Use this</button>}
          </div>
        )}
        {ranking.mixed && <Notice tone="blue">These prices are in different currencies, so the desk will not name a lowest. Compare them by hand.</Notice>}

        <div className="grid gap-3 lg:grid-cols-3">
          {(['globaltix', 'cebu'] as Provider[]).map(p => (
            <section key={p} className="rounded-xl border border-slate-200 bg-white">
              <h3 className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-sm font-bold text-slate-900">
                <span className={`h-2 w-2 rounded-full ${LANE_STYLE[p].dot}`} />{PROVIDER_LABEL[p]}
                <span className="ml-auto text-[11px] font-medium text-slate-400">{plan.lanes[p].candidates.length ? `${plan.lanes[p].candidates.length} match${plan.lanes[p].candidates.length === 1 ? '' : 'es'}` : ''}</span>
              </h3>
              <div className="space-y-2 p-2.5">
                {plan.lanes[p].state === 'error' && (
                  <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
                    <p className="font-semibold">{PROVIDER_LABEL[p]} could not be read</p>
                    <p className="mt-0.5 break-words">{plan.lanes[p].error}</p>
                    <p className="mt-1 text-red-500">This does not mean it has no tickets.</p>
                  </div>
                )}
                {plan.lanes[p].state === 'off' && <p className="p-3 text-center text-xs text-slate-400">Switched off in Settings</p>}
                {plan.lanes[p].state === 'none' && <p className="p-3 text-center text-xs text-slate-400">No match for “{plan.searchedFor}”. Try the search box.</p>}
                {plan.lanes[p].candidates.map(c => {
                  const e = estimateOf(c)
                  const isBest = ranking.best?.key === c.key
                  return (
                    <button key={c.key} onClick={() => setSelected(c.key)} disabled={!c.pick}
                      className={`relative block w-full rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selected === c.key ? 'border-slate-900 ring-1 ring-slate-900' : isBest ? 'border-emerald-400 bg-emerald-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
                      {isBest && <span className="absolute -top-2 right-2 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Lowest</span>}
                      <div className="flex gap-2.5">
                        {c.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.image} alt="" className="h-11 w-11 flex-shrink-0 rounded-md object-cover" />
                        ) : <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-slate-100"><TicketIcon className="h-4 w-4 text-slate-400" /></span>}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900">{c.name}</p>
                          <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{e ? `${e.from ? 'from ' : ''}${money(e.amount, e.currency)}` : <span className="text-xs font-medium text-slate-400">{c.optionsError ?? 'No price'}</span>}</p>
                          {e?.closed && <p className="text-[11px] font-semibold text-amber-600">Not sold on this date</p>}
                          <p className={`mt-0.5 text-[11px] ${c.confidence === 'high' ? 'text-emerald-600' : c.confidence === 'medium' ? 'text-slate-500' : 'text-amber-600'}`}>{c.confidence === 'high' ? 'Strong match' : c.confidence === 'medium' ? 'Likely match' : 'Weak match — check it'}</p>
                          {c.covers.length > 0 && <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-violet-700"><Sparkles className="h-3 w-3" /> Also covers {c.covers.map(x => x.name).join(', ')}</p>}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}

          <section className={`rounded-xl border bg-white ${ranking.manualWins ? 'border-emerald-400' : 'border-slate-200'}`}>
            <h3 className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-sm font-bold text-slate-900">
              <span className="h-2 w-2 rounded-full bg-amber-500" />Manual
              {ranking.manualWins && <span className="ml-auto rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Lowest</span>}
            </h3>
            <div className="space-y-2.5 p-3.5">
              <p className="text-xs text-slate-500">Bought at the gate, from an agent, or on another portal. You record it with a receipt, as today.</p>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expected cost ({plan.quote.currency})</span>
                <input type="number" min="0" step="0.01" value={manualCost} onChange={e => setManualCost(e.target.value)} className="form-input py-1.5 text-sm tabular-nums" />
              </label>
              <button onClick={onManual} className="btn btn-secondary btn-sm w-full justify-center"><PenLine className="h-3.5 w-3.5" /> Buy manually</button>
            </div>
          </section>
        </div>

        {sel && selPick && (
          <section className="rounded-xl border border-slate-900 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${LANE_STYLE[sel.provider].dot}`} />
              <h3 className="min-w-0 flex-1 text-sm font-bold text-slate-900">{sel.name}</h3>
              <span className="text-xs font-semibold text-slate-500">{PROVIDER_LABEL[sel.provider]} · #{sel.productId}</span>
            </div>
            {sel.why && <p className="mt-1 text-xs text-slate-500">{sel.why}</p>}

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                {sel.options.length > 1 && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Ticket option</span>
                    <select className="form-input py-1.5 text-sm" value={selPick.optionId} onChange={e => setPicks(p => ({ ...p, [sel.key]: { optionId: e.target.value, qty: {} } }))}>
                      {sel.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </label>
                )}
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {selOption?.tickets.map(t => {
                    const unit = t.prices ? t.prices[visit] ?? null : t.nett ?? null
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-800">{t.name}</p>
                          <p className="text-[11px] tabular-nums text-slate-500">{unit !== null ? money(unit, t.currency) : t.prices ? 'Not sold this date' : 'No price'}</p>
                        </div>
                        <div className="flex items-center overflow-hidden rounded-md border border-slate-200">
                          <button type="button" aria-label="Fewer" onClick={() => setQty(t.id, (selPick.qty[t.id] ?? 0) - 1)} className="px-2 py-0.5 text-slate-500 hover:bg-slate-50">−</button>
                          <span className="w-8 text-center text-sm font-semibold tabular-nums">{selPick.qty[t.id] ?? 0}</span>
                          <button type="button" aria-label="More" onClick={() => setQty(t.id, (selPick.qty[t.id] ?? 0) + 1)} className="px-2 py-0.5 text-slate-500 hover:bg-slate-50">+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {openDates.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                    Not sold on {visit}. Nearest open dates:
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {openDates.map(d => <button key={d} onClick={() => setVisit(d)} className="rounded-md bg-white px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100">{d}</button>)}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name on the booking</span>
                  <input className="form-input py-1.5 text-sm" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </label>
                {sel.provider === 'cebu' && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Contact number</span>
                    <input className="form-input py-1.5 text-sm" value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} />
                  </label>
                )}
                {selOption?.kind === 'timeslot' && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Time slot</span>
                    <select className="form-input py-1.5 text-sm" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} disabled={!slots?.length}>
                      <option value="">{slots === null ? 'Reading…' : slots.length ? 'Choose a time' : 'No times open'}</option>
                      {slots?.map(s => <option key={s} value={s}>{s.slice(0, 5)}</option>)}
                    </select>
                  </label>
                )}
                {selOption?.questions.map(q2 => (
                  <label key={String(q2.id)} className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-600">{q2.question}{q2.optional ? ' (optional)' : ''}</span>
                    {q2.options.length ? (
                      <select className="form-input py-1.5 text-sm" value={form.answers[String(q2.id)] ?? ''} onChange={e => setForm(f => ({ ...f, answers: { ...f.answers, [String(q2.id)]: e.target.value } }))}>
                        <option value="">Choose…</option>
                        {q2.options.map(o => <option key={o.key} value={o.key}>{o.value}</option>)}
                      </select>
                    ) : <input className="form-input py-1.5 text-sm" value={form.answers[String(q2.id)] ?? ''} onChange={e => setForm(f => ({ ...f, answers: { ...f.answers, [String(q2.id)]: e.target.value } }))} />}
                  </label>
                ))}
                {sel.covers.length > 0 && (
                  <fieldset className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
                    <legend className="px-1 text-[11px] font-semibold text-violet-700">Combo: mark these as bought too</legend>
                    {sel.covers.map(x => (
                      <label key={x.id} className="flex items-center gap-2 py-0.5 text-xs text-violet-900">
                        <input type="checkbox" className="accent-violet-600" checked={form.also.includes(x.id)} onChange={e => setForm(f => ({ ...f, also: e.target.checked ? [...f.also, x.id] : f.also.filter(i => i !== x.id) }))} />
                        {x.name}
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-5 py-3">
        <div className="min-w-0 flex-1 text-sm">
          {sel
            ? <><b className="tabular-nums text-slate-900">{selEstimate ? money(selEstimate.amount, selEstimate.currency) : '—'}</b> <span className="text-slate-500">on {PROVIDER_LABEL[sel.provider]} · nothing is charged until the WhatsApp code</span>
                {missing.length > 0 && <p className="text-xs text-amber-700">Still needed: {missing.join(', ')}</p>}</>
            : <span className="text-slate-500">Pick a ticket from GlobalTix or Cebu, or buy manually.</span>}
        </div>
        <button onClick={holdIt} disabled={!sel || missing.length > 0 || holding} className="btn btn-primary disabled:cursor-not-allowed disabled:opacity-50">
          {holding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />} Hold ticket <ArrowRight className="h-4 w-4" />
        </button>
      </footer>
    </div>
  )
}

/* ── after the hold ─────────────────────────────────────────────────── */

export function CodeBoxes({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const put = (i: number, raw: string) => {
    const digits = raw.replace(/\D/g, '')
    if (digits.length > 1) { const v = digits.slice(0, 6); onChange(v); refs.current[Math.min(v.length, 5)]?.focus(); return }
    const arr = value.padEnd(6, ' ').split('')
    arr[i] = digits || ' '
    onChange(arr.join('').trimEnd())
    if (digits && i < 5) refs.current[i + 1]?.focus()
  }
  return (
    <div className="flex justify-center gap-2" role="group" aria-label="6-digit WhatsApp code">
      {Array.from({ length: 6 }, (_, i) => (
        <input key={i} ref={el => { refs.current[i] = el }} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} disabled={disabled} aria-label={`Digit ${i + 1}`}
          value={value[i]?.trim() ?? ''} onChange={e => put(i, e.target.value)} onKeyDown={e => { if (e.key === 'Backspace' && !value[i]?.trim() && i > 0) refs.current[i - 1]?.focus() }}
          className="h-14 w-11 rounded-xl border border-slate-300 bg-white text-center text-2xl font-bold tabular-nums text-slate-900 outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:opacity-50" />
      ))}
    </div>
  )
}

function CodeStep({ base, booking, purpose, approvers, otpReady, onDone, actionLabel }: {
  base: string; booking: Booking; purpose: 'CONFIRM' | 'CANCEL'; approvers: string[]; otpReady: boolean; onDone: (message?: string) => void; actionLabel: string
}) {
  const url = `${base}/bookings/${booking.id}`
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [working, setWorking] = useState(false)
  const [sent, setSent] = useState<{ expiresAt: number; resendAt: number; sentTo: SentTo[] } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])

  async function send() {
    setSending(true); setError(null); setCode('')
    try {
      const { data } = await post<{ expiresAt: string; sentTo: SentTo[]; resendAfter: number }>(`${url}/send-code`, { purpose })
      setSent({ expiresAt: new Date(data.expiresAt).getTime(), resendAt: Date.now() + data.resendAfter * 1000, sentTo: data.sentTo })
    } catch (e) { setError(e instanceof Error ? e.message : 'The code could not be sent.') }
    finally { setSending(false) }
  }
  async function submit() {
    setWorking(true); setError(null)
    try {
      const { message } = await post(`${url}/${purpose === 'CONFIRM' ? 'confirm' : 'cancel'}`, { code })
      onDone(message)
    } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); setCode(''); onDone() }
    finally { setWorking(false) }
  }

  const left = sent ? Math.max(0, Math.floor((sent.expiresAt - now) / 1000)) : 0
  const wait = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0

  if (!otpReady) return <Notice tone="amber">No approver WhatsApp numbers are set. Add them under Settings → Ticket Issue Desk.</Notice>

  return (
    <div className="space-y-4">
      {!sent ? (
        <div className="text-center">
          <p className="text-sm text-slate-600">A 6-digit code goes to {approvers.join(', ')} on WhatsApp.</p>
          <button onClick={send} disabled={sending} className="btn btn-primary mt-3">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} Send code on WhatsApp
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap justify-center gap-1.5">
            {sent.sentTo.map(s => (
              <span key={s.phone} title={s.error} className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{s.ok ? '✓' : '✕'} {s.name} {s.phone}</span>
            ))}
          </div>
          <CodeBoxes value={code} onChange={setCode} disabled={working || left === 0} />
          <p className="text-center text-xs tabular-nums text-slate-500">
            {left > 0 ? <>Code expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</> : <span className="font-semibold text-red-600">The code has expired.</span>}
            {' · '}
            <button onClick={send} disabled={wait > 0 || sending} className="font-semibold text-slate-700 underline disabled:no-underline disabled:opacity-50">{wait > 0 ? `Resend in ${wait}s` : 'Send a new code'}</button>
          </p>
          <button onClick={submit} disabled={code.replace(/\s/g, '').length !== 6 || working || left === 0} className={`btn w-full justify-center text-white disabled:opacity-50 ${purpose === 'CONFIRM' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
            {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {actionLabel}
          </button>
          <p className="text-center text-[11px] text-slate-400">If it does not arrive, check the WhatsApp number’s Meta billing and template status.</p>
        </>
      )}
      {error && <Notice tone="red">{error}</Notice>}
    </div>
  )
}

function LiveBooking({ base, booking: b, state, quote, onChanged }: { base: string; booking: Booking; state: DeskState; quote: DeskState['ticket']; onChanged: () => void }) {
  const url = `${base}/bookings/${b.id}`
  const [busy, setBusy] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [confirmRelease, setConfirmRelease] = useState(false)

  async function act(action: 'release' | 'check') {
    setBusy(action)
    try {
      const { message } = await post(`${url}/${action}`)
      toast.success(message ?? 'Status updated from the portal')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'That did not work') }
    finally { setBusy(null) }
  }

  const onCodeDone = (message?: string) => { if (message) toast.success(message); onChanged() }
  const portal = PROVIDER_LABEL[b.provider]
  const estimated = b.tickets.reduce((a, t) => a + (t.nett ?? 0) * t.qty, 0)
  const drift = b.amount !== null && estimated > 0 && Math.abs(b.amount - estimated) >= 0.01
  const saved = quote.totalCost && quote.currency === b.currency && b.amount !== null ? quote.totalCost - b.amount : null
  const uncertain = ['unknown', 'confirming', 'cancelling'].includes(b.status)

  const CheckBtn = (
    <button onClick={() => act('check')} disabled={busy !== null} className="btn btn-secondary btn-sm">
      {busy === 'check' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Check status
    </button>
  )

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-5">
      {b.lastError && <Notice tone={uncertain ? 'amber' : 'red'}>{b.lastError}</Notice>}
      {uncertain && (
        <Notice tone="amber"><b>Don’t pay or cancel again yet.</b> {portal} hasn’t given a clear answer, so this booking is locked. Check status reads {portal}’s own record and settles it.</Notice>
      )}

      {/* The ticket stub */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className={`flex items-center gap-3 px-5 py-3 text-white ${b.status === 'confirmed' ? 'bg-emerald-600' : 'bg-slate-900'}`}>
          {b.status === 'confirmed' ? <CheckCircle2 className="h-5 w-5" /> : <TicketIcon className="h-5 w-5" />}
          <p className="flex-1 text-sm font-bold">{b.status === 'confirmed' ? `Issued on ${portal}` : uncertain ? `Waiting on ${portal}` : `Held on ${portal}, not paid`}</p>
          <span className="font-mono text-sm">{b.reference ?? '…'}</span>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
          <div className="min-w-0 space-y-1 text-sm">
            <p className="font-semibold text-slate-900">{b.productName}</p>
            {b.optionName && <p className="text-xs text-slate-500">{b.optionName}</p>}
            <p className="text-xs text-slate-500">{[b.visitDate, b.eventTime?.slice(11, 16), b.customerName].filter(Boolean).join(' · ')}</p>
            <ul className="pt-1 text-xs text-slate-600">{b.tickets.map(t => <li key={t.id}>{t.qty} × {t.name}</li>)}</ul>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{b.status === 'confirmed' ? 'Paid' : 'To pay'}</p>
            <p className="text-2xl font-bold tabular-nums text-slate-900">{money(b.amount, b.currency)}</p>
            {saved !== null && saved > 0 && <p className="text-xs font-semibold text-emerald-600">{money(saved, b.currency)} under quote</p>}
            {saved !== null && saved < 0 && <p className="text-xs font-semibold text-amber-600">{money(-saved, b.currency)} over quote</p>}
            {drift && b.status === 'reserved' && <p className="text-xs font-semibold text-amber-600">Differs from the listed price ({money(estimated, b.currency)})</p>}
          </div>
        </div>
      </div>

      {b.status === 'reserved' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-3 flex items-center justify-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Approve with WhatsApp code</h3>
          {state.gate
            ? <Notice tone="amber">{state.gate}</Notice>
            : <CodeStep base={base} booking={b} purpose="CONFIRM" approvers={state.approvers} otpReady={state.otpReady} onDone={onCodeDone} actionLabel={`Pay ${money(b.amount, b.currency)} and issue`} />}
        </div>
      )}

      {b.status === 'confirmed' && (
        <>
          {b.details?.codes?.some(c => c.code || c.qr) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-2 text-sm font-bold text-slate-900">Ticket codes</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {b.details.codes.map((c, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg bg-slate-50 p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {c.qr && <img src={c.qr} alt="" className="h-14 w-14 rounded bg-white" />}
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-semibold text-slate-800">{c.name}</p>
                      <p className="break-all font-mono text-slate-600">{c.code}</p>
                      {c.redeem_until && <p className="text-slate-400">Use by {c.redeem_until.slice(0, 10)}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {b.details?.e_ticket_url && <a href={b.details.e_ticket_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm"><ExternalLink className="h-3.5 w-3.5" /> E-ticket</a>}
            {b.details?.links?.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm"><ExternalLink className="h-3.5 w-3.5" /> {l.label}</a>)}
            {CheckBtn}
            {b.canCancelHere && !cancelling && <button onClick={() => setCancelling(true)} className="btn btn-sm ml-auto border border-red-200 bg-white text-red-600 hover:bg-red-50"><Undo2 className="h-3.5 w-3.5" /> Cancel ticket</button>}
          </div>
          {!b.canCancelHere && <Notice tone="blue">To cancel a paid Cebu order, cancel it on Cebu, then press Check status. This ticket is put back automatically.</Notice>}
          {cancelling && (
            <div className="rounded-2xl border border-red-200 bg-white p-5">
              <h3 className="mb-1 text-center text-sm font-bold text-red-700">Cancel this ticket on {portal}</h3>
              <p className="mb-3 text-center text-xs text-slate-500">Non-refundable tickets may be refused. An approver’s code is needed.</p>
              <CodeStep base={base} booking={b} purpose="CANCEL" approvers={state.approvers} otpReady={state.otpReady} onDone={onCodeDone} actionLabel="Cancel ticket" />
            </div>
          )}
        </>
      )}

      {b.status === 'reserved' && (
        <div className="flex flex-wrap items-center gap-2">
          {CheckBtn}
          {confirmRelease ? (
            <span className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              Let this hold go?
              <button onClick={() => act('release')} disabled={busy !== null} className="btn btn-sm bg-red-600 text-white">{busy === 'release' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Yes, release'}</button>
              <button onClick={() => setConfirmRelease(false)} className="btn btn-secondary btn-sm">Keep</button>
            </span>
          ) : <button onClick={() => setConfirmRelease(true)} className="btn btn-secondary btn-sm ml-auto"><Undo2 className="h-3.5 w-3.5" /> Release and choose another</button>}
        </div>
      )}
      {uncertain && <div className="flex justify-center">{CheckBtn}</div>}
    </div>
  )
}
