'use client'

/**
 * "What does this movement include?" — for Vietnam SIC Transfer / Private Tour
 * movements. The operator picks the parts of the bundle from the Vietnam
 * product sheet (or adds one the sheet lacks); each part becomes a separate
 * payable on the Accounts payables board.
 *
 * Search is word-prefix ("hal cru" finds Halong … Cruise), filterable by the
 * sheet's codes, keyboard-driven, and — before anything is typed — proposes
 * the products the activity text itself names. See lib/vn-includes.
 */

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Search, X, Plus, Minus, Loader2, Sparkles, PackagePlus, Check, CloudOff, Layers, ChevronDown,
} from 'lucide-react'
import {
  INCLUDE_CODES, codeTone, formatVnd, searchForm,
  type AgendaInclude, type IncludeProduct,
} from '@/lib/vn-includes/shared'

interface Props {
  value: AgendaInclude[]
  onChange: (next: AgendaInclude[]) => void
  /** The movement's To / Activity text — what suggestions are read from. */
  activity: string
  bookingRef: string
}

const suggestCache = new Map<string, IncludeProduct[]>()

function CodePill({ code, className = '' }: { code: string; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset whitespace-nowrap ${codeTone(code)} ${className}`}>
      {code}
    </span>
  )
}

/** Bold the parts of `text` that a typed word matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = searchForm(query).split(' ').filter(w => w.length > 0)
  if (!words.length) return <>{text}</>
  const parts = text.split(/(\s+)/)
  return (
    <>
      {parts.map((part, i) => {
        const form = searchForm(part)
        const w = words.find(x => form.startsWith(x))
        if (!w || !form) return <span key={i}>{part}</span>
        // Bold the matched prefix of the word, keeping its original characters.
        const cut = Math.min(part.length, w.length + (part.length - part.trimStart().length))
        return <span key={i}><mark className="bg-amber-100 text-inherit rounded-sm">{part.slice(0, cut)}</mark>{part.slice(cut)}</span>
      })}
    </>
  )
}

export function includesTotalVnd(list: AgendaInclude[]): number | null {
  const priced = list.filter(i => i.unitPriceVnd !== null && i.unitPriceVnd !== undefined)
  if (!priced.length) return null
  return priced.reduce((s, i) => s + Number(i.unitPriceVnd) * (i.quantity || 1), 0)
}

export default function IncludePicker({ value, onChange, activity, bookingRef }: Props) {
  const [query, setQuery] = useState('')
  const [code, setCode] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<IncludeProduct[]>([])
  const [suggestions, setSuggestions] = useState<IncludeProduct[] | null>(null)
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState<null | { code: string; name: string; price: string }>(null)
  const [savingNew, setSavingNew] = useState(false)
  const [editingPrice, setEditingPrice] = useState<string | null>(null)

  const listId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const chosen = useMemo(() => new Set(value.map(v => v.productKey)), [value])
  const total = includesTotalVnd(value)

  // Close on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Search — debounced, and a newer keystroke cancels the older request.
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q: query, limit: '30' })
        if (code) params.set('code', code)
        const res = await fetch(`/api/vn-includes/products?${params}`, { signal: ctrl.signal })
        const json = await res.json()
        if (!json.success) throw new Error(json.error)
        setResults(json.data)
        setError(null)
        setActive(0)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setError((err as Error).message || 'Search failed')
      } finally {
        if (!ctrl.signal.aborted) setLoading(false)
      }
    }, query ? 180 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [query, code, open])

  // Suggestions from the activity text — once per distinct text.
  useEffect(() => {
    if (!open || query || !activity.trim()) { if (!activity.trim()) setSuggestions(null); return }
    const key = activity.trim()
    const hit = suggestCache.get(key)
    if (hit) { setSuggestions(hit); return }
    let live = true
    fetch(`/api/vn-includes/products?suggest=${encodeURIComponent(key)}&limit=8`)
      .then(r => r.json())
      .then(json => {
        if (!live || !json.success) return
        suggestCache.set(key, json.data)
        setSuggestions(json.data)
      })
      .catch(() => { /* suggestions are a convenience */ })
    return () => { live = false }
  }, [open, query, activity])

  const showSuggestions = !query && !code && (suggestions?.length ?? 0) > 0
  const visible: IncludeProduct[] = showSuggestions
    ? [...suggestions!, ...results.filter(r => !suggestions!.some(s => s.productKey === r.productKey))]
    : results

  function add(p: IncludeProduct) {
    if (chosen.has(p.productKey)) {
      onChange(value.filter(v => v.productKey !== p.productKey))
      return
    }
    onChange([...value, {
      productId: p.id, productKey: p.productKey, code: p.code, name: p.name,
      unitPriceVnd: p.minPriceVnd, quantity: 1, source: p.source,
    }])
    setQuery('')
    inputRef.current?.focus()
  }

  function update(key: string, patch: Partial<AgendaInclude>) {
    onChange(value.map(v => v.productKey === key ? { ...v, ...patch } : v))
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, visible.length)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < visible.length && visible[active]) add(visible[active])
      else if (query.trim()) startAdding()
    } else if (e.key === 'Escape') { setOpen(false) }
  }

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function startAdding() {
    setAdding({ code: code || 'Ticket', name: query.trim(), price: '' })
    setOpen(false)
  }

  async function saveNew() {
    if (!adding) return
    setSavingNew(true)
    try {
      const res = await fetch('/api/vn-includes/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adding.code, name: adding.name, priceVnd: adding.price, bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const p = json.data.product as IncludeProduct
      if (!chosen.has(p.productKey)) {
        onChange([...value, {
          productId: p.id, productKey: p.productKey, code: p.code, name: p.name,
          unitPriceVnd: p.minPriceVnd, quantity: 1, source: p.source,
        }])
      }
      suggestCache.clear()
      if (p.syncStatus === 'FAILED' || p.syncStatus === 'PENDING') toast.warning(json.message)
      else toast.success(json.message)
      setAdding(null)
      setQuery('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the product')
    } finally { setSavingNew(false) }
  }

  return (
    <div ref={boxRef} className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
          <Layers className="w-3.5 h-3.5" /> Includes
          {value.length > 0 && <span className="rounded-full bg-emerald-600 text-white px-1.5 text-[10px] leading-4">{value.length}</span>}
        </p>
        {total !== null && (
          <span className="text-[11px] font-semibold text-emerald-800 tabular-nums" title="Sum of the sheet's lowest price × quantity — a reference, not the P&L cost">
            {formatVnd(total)}
          </span>
        )}
      </div>

      {/* Chosen includes */}
      <div className="px-3 pt-2 space-y-1.5">
        {value.length === 0 && (
          <p className="text-[11px] leading-snug text-slate-500">
            Pick what this movement includes. Each one is paid separately in Accounts.
          </p>
        )}
        {value.map(inc => (
          <div key={inc.productKey} className="group flex items-start gap-2 rounded-lg bg-white border border-slate-200 px-2 py-1.5 shadow-sm">
            <CodePill code={inc.code} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-800 leading-snug line-clamp-2" title={inc.name}>{inc.name}</p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center rounded-md border border-slate-200">
                  <button type="button" className="px-1 py-0.5 hover:bg-slate-100 disabled:opacity-30"
                    disabled={inc.quantity <= 1}
                    onClick={() => update(inc.productKey, { quantity: Math.max(1, inc.quantity - 1) })}
                    aria-label="One fewer"><Minus className="w-3 h-3" /></button>
                  <span className="px-1.5 tabular-nums font-semibold text-slate-700" title="Quantity">{inc.quantity}</span>
                  <button type="button" className="px-1 py-0.5 hover:bg-slate-100"
                    onClick={() => update(inc.productKey, { quantity: Math.min(999, inc.quantity + 1) })}
                    aria-label="One more"><Plus className="w-3 h-3" /></button>
                </span>
                <span>×</span>
                {editingPrice === inc.productKey ? (
                  <input
                    autoFocus
                    inputMode="numeric"
                    className="w-24 rounded border border-emerald-300 px-1 py-0.5 text-[11px] tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    defaultValue={inc.unitPriceVnd ?? ''}
                    placeholder="VND"
                    onBlur={e => {
                      const raw = e.target.value.replace(/[,\s₫]/g, '')
                      const n = raw === '' ? null : Number(raw)
                      update(inc.productKey, { unitPriceVnd: n !== null && Number.isFinite(n) && n >= 0 ? n : inc.unitPriceVnd })
                      setEditingPrice(null)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
                  />
                ) : (
                  <button type="button" onClick={() => setEditingPrice(inc.productKey)}
                    className="tabular-nums hover:text-emerald-700 hover:underline decoration-dotted"
                    title="The sheet's lowest price. Click to change it for this booking.">
                    {formatVnd(inc.unitPriceVnd)}
                  </button>
                )}
                {inc.source === 'MANUAL' && (
                  <span className="rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500" title="Added by hand — not from the product sheet">manual</span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => onChange(value.filter(v => v.productKey !== inc.productKey))}
              className="text-slate-300 hover:text-red-500 mt-0.5" aria-label={`Remove ${inc.name}`}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative p-3">
        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100">
          <Search className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKey}
            placeholder="Search products — e.g. cable car, lunch, kayak"
            className="w-full bg-transparent py-1.5 text-xs focus:outline-none"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
          />
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
            : <button type="button" onClick={() => setOpen(o => !o)} className="text-slate-400 hover:text-slate-600" aria-label="Show products">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>}
        </div>

        {open && (
          <div className="absolute left-3 right-3 z-30 mt-1 rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex flex-wrap gap-1 border-b border-slate-100 p-2">
              {['', ...INCLUDE_CODES].map(c => (
                <button key={c || 'all'} type="button" onClick={() => setCode(c)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    code === c ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {c || 'All'}
                </button>
              ))}
            </div>

            <div ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto py-1">
              {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
              {showSuggestions && (
                <p className="flex items-center gap-1 px-3 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                  <Sparkles className="w-3 h-3" /> Looks like this activity
                </p>
              )}
              {visible.map((p, idx) => {
                const isChosen = chosen.has(p.productKey)
                const isSuggestion = showSuggestions && idx < suggestions!.length
                return (
                  <Fragment key={p.productKey}>
                    {showSuggestions && idx === suggestions!.length && (
                      <p className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 border-t border-slate-100 mt-1">Most used</p>
                    )}
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => add(p)}
                      className={`w-full flex items-start gap-2 px-3 py-1.5 text-left ${
                        idx === active ? 'bg-emerald-50' : ''
                      } ${isSuggestion ? 'border-l-2 border-violet-300' : 'border-l-2 border-transparent'}`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        isChosen ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300'
                      }`}>
                        {isChosen && <Check className="w-3 h-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-slate-800 leading-snug">
                          <Highlight text={p.name} query={query} />
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                          <CodePill code={p.code} />
                          {p.usageCount > 0 && <span>used {p.usageCount}×</span>}
                          {p.source === 'MANUAL' && <span className="text-slate-500">manual{p.syncStatus !== 'SYNCED' && ' · not on sheet yet'}</span>}
                        </span>
                      </span>
                      <span className="text-[11px] font-semibold tabular-nums text-slate-600 whitespace-nowrap">{formatVnd(p.minPriceVnd)}</span>
                    </button>
                  </Fragment>
                )
              })}
              {!loading && !error && visible.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-500">No product on the sheet matches &ldquo;{query}&rdquo;.</p>
              )}
            </div>

            <button
              type="button"
              data-idx={visible.length}
              onMouseEnter={() => setActive(visible.length)}
              onClick={startAdding}
              className={`w-full flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-xs font-medium text-emerald-700 rounded-b-xl ${
                active === visible.length ? 'bg-emerald-50' : 'hover:bg-emerald-50'
              }`}
            >
              <PackagePlus className="w-3.5 h-3.5" />
              {query.trim() ? <>Not listed? Add &ldquo;{query.trim()}&rdquo; as a new product</> : 'Not listed? Add a product by hand'}
            </button>
          </div>
        )}

        {/* Manual product */}
        {adding && (
          <div className="mt-2 rounded-lg border border-dashed border-emerald-300 bg-white p-2.5 space-y-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
              <PackagePlus className="w-3.5 h-3.5 text-emerald-600" /> New product
              <span className="font-normal text-slate-400">— also written to the sheet&apos;s Manual Products tab</span>
            </p>
            <div className="flex gap-2">
              <select value={adding.code} onChange={e => setAdding({ ...adding, code: e.target.value })}
                className="form-select text-xs py-1 w-28 flex-shrink-0">
                {INCLUDE_CODES.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="Other">Other</option>
              </select>
              <input value={adding.name} autoFocus onChange={e => setAdding({ ...adding, name: e.target.value })}
                placeholder="Product name as the supplier bills it"
                className="form-input text-xs py-1 flex-1 min-w-0" />
            </div>
            <div className="flex items-center gap-2">
              <input value={adding.price} inputMode="numeric"
                onChange={e => setAdding({ ...adding, price: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') void saveNew() }}
                placeholder="Price (VND) — optional"
                className="form-input text-xs py-1 w-44" />
              <div className="flex-1" />
              <button type="button" onClick={() => setAdding(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2">Cancel</button>
              <button type="button" onClick={() => void saveNew()} disabled={savingNew || adding.name.trim().length < 3}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {savingNew ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add &amp; include
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Read-only chips for the chart's view mode. */
export function IncludeChips({ value }: { value: AgendaInclude[] }) {
  if (!value.length) return null
  const total = includesTotalVnd(value)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
        <Layers className="w-3 h-3" /> Includes
      </span>
      {value.map(inc => (
        <span key={inc.productKey} title={`${inc.name} — ${inc.quantity} × ${formatVnd(inc.unitPriceVnd)}`}
          className="inline-flex max-w-[22rem] items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
          <CodePill code={inc.code} />
          <span className="truncate">{inc.name}</span>
          {inc.quantity > 1 && <span className="font-semibold text-slate-500">×{inc.quantity}</span>}
        </span>
      ))}
      {total !== null && <span className="text-[11px] font-semibold text-emerald-800 tabular-nums">{formatVnd(total)}</span>}
    </div>
  )
}

/** Includes a rebuilt chart could not re-attach — shown so no payable is lost silently. */
export function UnplacedIncludesNotice({ items, onDiscard }: {
  items: { id?: string; name: string; code: string; itemDate: string; itemActivity: string | null }[]
  onDiscard?: (id: string) => void
}) {
  if (!items.length) return null
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <p className="flex items-center gap-1.5 font-semibold">
        <CloudOff className="w-3.5 h-3.5" /> {items.length} include{items.length === 1 ? '' : 's'} no longer match a movement
      </p>
      <p className="mt-0.5 text-amber-700">
        The chart was rebuilt (amendment or regenerate) and these could not be placed on a movement. They are kept, and
        Accounts still sees them, until you add them to the right movement again or discard them.
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((u, i) => (
          <li key={u.id ?? i} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{u.itemDate}</span> · {u.itemActivity || 'movement'} → <CodePill code={u.code} /> {u.name}
            </span>
            {onDiscard && u.id && (
              <button type="button" onClick={() => onDiscard(u.id!)}
                className="flex-shrink-0 text-[11px] font-medium text-amber-700 hover:text-red-600 underline decoration-dotted">
                Discard on save
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
