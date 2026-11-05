'use client'

/**
 * Pick the Accounts supplier (Suppliers Manage) a transport movement is paid
 * to — or register it there when it is missing. Used by the MC Report and the
 * Trans-Reconsultation sheet. Search and register go through
 * /api/accounts-suppliers; saving the choice is the caller's job.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Building2, Check, CreditCard, History, Landmark, Loader2, Plus, Search, Sparkles, User, X,
} from 'lucide-react'
import { cn, readApiResponse } from '@/lib/utils'

export type SupplierSource = 'supplier_bank' | 'driver'

export interface PickedSupplier {
  source: SupplierSource
  id: number
  name: string
  country: string | null
}

interface Found extends PickedSupplier {
  businessType: string | null
  phone: string | null
  hasBank: boolean
  score?: number
}

interface SearchData {
  available: boolean
  message?: string
  results: Found[]
  suggested: Found[]
  lastUsed: (PickedSupplier & { by: string | null; at: string }) | null
  total: number
  canRegister: boolean
}

export interface PickerSibling { id: string; label: string; sub?: string | null }

/** OPS country → the ISO-2 codes the registry is keyed by (mirrors supplierCountriesFor). */
const CODES: Record<string, string[]> = {
  SINGAPORE: ['SG'], MALAYSIA: ['MY'], SINGAPORE_MALAYSIA: ['SG', 'MY'], SRILANKA: ['LK'], VIETNAM: ['VN'],
}
const COUNTRY_NAME: Record<string, string> = { SG: 'Singapore', MY: 'Malaysia', LK: 'Sri Lanka', VN: 'Vietnam' }
const ALL_CODES = ['SG', 'MY', 'LK', 'VN']

const sameSupplier = (a: PickedSupplier | null | undefined, b: PickedSupplier | null | undefined) =>
  !!a && !!b && a.source === b.source && a.id === b.id

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

export function SupplierPicker({
  title = 'Supplier for this movement', context, country, hint, current, siblings = [], siblingsLabel, saving, onPick, onClose,
}: {
  title?: string
  /** One line saying which movement / line this is. */
  context?: ReactNode
  /** The row's OPS country (MALAYSIA, SRILANKA…) — the default filter. */
  country: string | null
  /** The movement's driver / vendor — drives the suggestions. */
  hint: string | null
  current: PickedSupplier | null
  /** Other rows without a supplier that can take the same pick. */
  siblings?: PickerSibling[]
  siblingsLabel?: string
  saving?: boolean
  onPick: (supplier: PickedSupplier | null, alsoFor: string[]) => void
  onClose: () => void
}) {
  const home = useMemo(() => CODES[String(country ?? '').toUpperCase()] ?? [], [country])
  const [codes, setCodes] = useState<string[]>(home)
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [data, setData] = useState<SearchData | null>(null)
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [also, setAlso] = useState<Set<string>>(new Set())
  const [registering, setRegistering] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 200); return () => clearTimeout(t) }, [q])

  useEffect(() => {
    let live = true
    setLoading(true)
    const sp = new URLSearchParams({ q: debounced, country: codes.length ? codes.join(',') : 'ALL', limit: '60' })
    if (hint) sp.set('hint', hint)
    fetch(`/api/accounts-suppliers?${sp}`)
      .then(r => readApiResponse<SearchData>(r))
      .then(j => { if (live) { setData(j.success ? j.data! : { available: false, message: j.error, results: [], suggested: [], lastUsed: null, total: 0, canRegister: false }); setCursor(0) } })
      .catch(() => live && setData({ available: false, message: 'Could not reach the supplier list', results: [], suggested: [], lastUsed: null, total: 0, canRegister: false }))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [debounced, codes, hint])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !registering) onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, registering])

  const choose = useCallback((s: PickedSupplier) => {
    if (saving) return
    onPick({ source: s.source, id: s.id, name: s.name, country: s.country }, Array.from(also))
  }, [onPick, also, saving])

  // Suggestions only while nothing is typed; never the same supplier twice.
  const picks = useMemo(() => {
    if (!data) return { last: null as Found | null, suggested: [] as Found[] }
    const lastFull = data.lastUsed
      ? data.results.find(r => sameSupplier(r, data.lastUsed)) ?? data.suggested.find(r => sameSupplier(r, data.lastUsed))
        ?? { ...data.lastUsed, businessType: null, phone: null, hasBank: false }
      : null
    const last = debounced || sameSupplier(lastFull, current) ? null : lastFull
    const suggested = debounced ? [] : data.suggested.filter(s => !sameSupplier(s, last) && !sameSupplier(s, current))
    return { last, suggested }
  }, [data, debounced, current])

  const flat = useMemo(() => [
    ...(picks.last ? [picks.last] : []), ...picks.suggested, ...(data?.results ?? []),
  ], [picks, data])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(flat.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    else if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); choose(flat[cursor]) }
  }
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Rows are numbered in the order of `flat` so the arrow keys and Enter agree with the screen.
  const sugBase = picks.last ? 1 : 0
  const resBase = sugBase + picks.suggested.length
  const row = (s: Found, i: number, badge?: ReactNode) => {
    const isCurrent = sameSupplier(s, current)
    return (
      <button key={`${i}-${s.source}-${s.id}`} data-idx={i} onClick={() => choose(s)} onMouseEnter={() => setCursor(i)} disabled={saving}
        className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition',
          i === cursor ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50', isCurrent && 'bg-emerald-50/60')}>
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          s.source === 'driver' ? 'bg-sky-100 text-sky-700' : 'bg-indigo-100 text-indigo-700')}>
          {s.source === 'driver' ? <User className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-800"><Highlight text={s.name} q={debounced} /></span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
            {s.source === 'driver' ? <span className="font-semibold text-sky-700">Driver payee</span> : s.businessType ? <span className="truncate">{s.businessType}</span> : null}
            {s.phone && <span>· {s.phone}</span>}
            {badge}
            {isCurrent && <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1 font-bold text-emerald-700"><Check className="h-2.5 w-2.5" />current</span>}
          </span>
        </span>
        {s.country && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">{s.country}</span>}
        <span className={cn('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold',
          s.hasBank ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}
          title={s.hasBank ? 'Bank details are on file in Accounts' : 'No bank details in Accounts yet — they add them before paying'}>
          {s.hasBank ? <Landmark className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}{s.hasBank ? 'bank' : 'no bank'}
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      onMouseDown={e => e.target === e.currentTarget && !registering && onClose()}>
      <div className="my-10 w-full max-w-xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm">
            <CreditCard className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-800">{title}</div>
            {context && <div className="mt-0.5 text-xs text-slate-500">{context}</div>}
            <div className="mt-0.5 text-[10px] text-slate-400">From Accounts → Suppliers Manage{data?.available ? ` · ${data.total} in this view` : ''}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>

        {registering ? (
          <RegisterForm initialName={q.trim() || hint || ''} codes={codes.length ? codes : home} onCancel={() => setRegistering(false)}
            onDone={s => { setRegistering(false); choose(s) }} onUse={s => { setRegistering(false); choose(s) }} />
        ) : (
          <>
            <div className="space-y-3 px-5 pt-4">
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200 focus-within:ring-indigo-300">
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <Search className="h-4 w-4 text-slate-400" />}
                <input autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
                  placeholder="Search suppliers and driver payees…" className="flex-1 bg-transparent text-sm outline-none" />
                {q && <button onClick={() => setQ('')} className="text-slate-300 hover:text-slate-500"><X className="h-3.5 w-3.5" /></button>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {home.length > 0 && (
                  <button onClick={() => setCodes(home)}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', codes.join() === home.join() ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-200')}>
                    {home.map(c => COUNTRY_NAME[c] ?? c).join(' + ')}
                  </button>
                )}
                {ALL_CODES.filter(c => !(home.length === 1 && home[0] === c)).map(c => (
                  <button key={c} onClick={() => setCodes([c])}
                    className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', codes.length === 1 && codes[0] === c && home.join() !== c ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-500 ring-slate-200')}>
                    {c}
                  </button>
                ))}
                <button onClick={() => setCodes([])}
                  className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1', !codes.length ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-500 ring-slate-200')}>
                  All countries
                </button>
              </div>
            </div>

            <div ref={listRef} className="max-h-[46vh] space-y-3 overflow-y-auto px-5 py-3">
              {data && !data.available && (
                <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200">{data.message}</div>
              )}
              {picks.last && (
                <section>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700">
                    <History className="h-3 w-3" /> Used last time for {hint}
                  </div>
                  {row(picks.last, 0, data?.lastUsed?.by ? <span>· picked by {data.lastUsed.by}</span> : null)}
                </section>
              )}
              {picks.suggested.length > 0 && (
                <section>
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    <Sparkles className="h-3 w-3" /> Looks like {hint}
                  </div>
                  {picks.suggested.map((s, k) => row(s, sugBase + k,
                    s.score != null ? <span className="rounded bg-emerald-50 px-1 font-bold text-emerald-700">{Math.round(Math.min(1, s.score) * 100)}% name match</span> : null))}
                </section>
              )}
              {data?.available && (
                <section>
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {debounced ? `Matches for “${debounced}”` : 'All suppliers'}
                  </div>
                  {data.results.length
                    ? data.results.map((s, k) => row(s, resBase + k))
                    : !loading && (
                      <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-500">
                        No supplier called “{debounced}”{codes.length ? ` in ${codes.join(' / ')}` : ''}.
                        {codes.length > 0 && <button onClick={() => setCodes([])} className="ml-1 font-semibold text-indigo-600 hover:underline">Search every country</button>}
                      </div>
                    )}
                </section>
              )}
            </div>

            {siblings.length > 0 && (
              <div className="border-t border-slate-100 px-5 py-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{siblingsLabel ?? 'Also set the same supplier on'}</span>
                  <button onClick={() => setAlso(a => a.size === siblings.length ? new Set() : new Set(siblings.map(s => s.id)))}
                    className="text-[10px] font-semibold text-indigo-600 hover:underline">{also.size === siblings.length ? 'none' : `all ${siblings.length}`}</button>
                </div>
                <div className="max-h-32 space-y-0.5 overflow-auto rounded-xl ring-1 ring-slate-200">
                  {siblings.map(s => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50">
                      <input type="checkbox" checked={also.has(s.id)} onChange={e => setAlso(a => { const n = new Set(a); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n })} />
                      <span className="font-semibold">{s.label}</span>
                      {s.sub && <span className="flex-1 truncate text-slate-400">{s.sub}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
              {data?.canRegister ? (
                <button onClick={() => setRegistering(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/60 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100">
                  <Plus className="h-3.5 w-3.5" /> Not in the list? Register supplier
                </button>
              ) : <span />}
              <div className="flex items-center gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />}
                {current && (
                  <button onClick={() => onPick(null, Array.from(also))} disabled={saving} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-600">
                    Remove supplier
                  </button>
                )}
                <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Add a supplier to Suppliers Manage. Bank details are left to Accounts. */
function RegisterForm({ initialName, codes, onCancel, onDone, onUse }: {
  initialName: string
  codes: string[]
  onCancel: () => void
  onDone: (s: PickedSupplier) => void
  onUse: (s: PickedSupplier) => void
}) {
  const [f, setF] = useState({ name: initialName, country: codes[0] ?? 'SG', businessType: 'Transport', phone: '', address: '', uen: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dupes, setDupes] = useState<Found[] | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setF(v => ({ ...v, [k]: e.target.value })); setDupes(null); setError(null) }

  const submit = async (force = false) => {
    if (f.name.trim().length < 2) { setError('Give the supplier a name.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/accounts-suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, force }),
      })
      const j = await readApiResponse<{ supplier?: Found; existed?: boolean; duplicates?: Found[] }>(res)
      if (res.status === 409 && j.data?.duplicates) { setDupes(j.data.duplicates); return }
      if (!j.success || !j.data?.supplier) { setError(j.error || 'Could not register the supplier'); return }
      onDone(j.data.supplier)
    } catch {
      setError('Could not reach the server')
    } finally { setBusy(false) }
  }

  const input = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-indigo-300'
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="rounded-xl bg-indigo-50/60 px-3 py-2 text-[11px] leading-snug text-indigo-800 ring-1 ring-indigo-100">
        Adds the supplier to <b>Accounts → Suppliers Manage → Supplier Bank Details</b>. Bank details are not taken here — Accounts adds them before paying.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Supplier name *
          <input autoFocus value={f.name} onChange={set('name')} onKeyDown={e => e.key === 'Enter' && submit()} className={cn(input, 'mt-1 normal-case tracking-normal')} placeholder="e.g. Suresh Transport Sdn Bhd" />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Country *
          <select value={f.country} onChange={set('country')} className={cn(input, 'mt-1 normal-case tracking-normal')}>
            {ALL_CODES.map(c => <option key={c} value={c}>{COUNTRY_NAME[c]} ({c})</option>)}
          </select>
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Business type
          <input value={f.businessType} onChange={set('businessType')} className={cn(input, 'mt-1 normal-case tracking-normal')} />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Phone
          <input value={f.phone} onChange={set('phone')} className={cn(input, 'mt-1 normal-case tracking-normal')} placeholder="+60…" />
        </label>
        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">UEN / reg. no
          <input value={f.uen} onChange={set('uen')} className={cn(input, 'mt-1 normal-case tracking-normal')} />
        </label>
        <label className="col-span-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Address
          <input value={f.address} onChange={set('address')} className={cn(input, 'mt-1 normal-case tracking-normal')} />
        </label>
      </div>

      {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 ring-1 ring-rose-200">{error}</div>}
      {dupes && (
        <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Already registered under a similar name?</div>
          {dupes.map(d => (
            <div key={`${d.source}-${d.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-amber-100/60">
              <span className="flex-1 truncate font-semibold text-slate-800">{d.name}</span>
              <span className="text-[10px] text-slate-500">{d.country}{d.source === 'driver' ? ' · driver payee' : ''}</span>
              <button onClick={() => onUse(d)} className="rounded-md bg-white px-2 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50">Use this</button>
            </div>
          ))}
          <button onClick={() => submit(true)} disabled={busy} className="mt-1.5 text-[11px] font-semibold text-amber-800 hover:underline">No — register “{f.name.trim()}” as a new supplier</button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">Back to search</button>
        <button onClick={() => submit(false)} disabled={busy || !!dupes}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Register &amp; select
        </button>
      </div>
    </div>
  )
}
