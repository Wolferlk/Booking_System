'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Briefcase, Check, ChevronDown, Loader2, Search, X } from 'lucide-react'

interface AgentOption { name: string; count: number }

const sameAgent = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Searchable multi-select of booking agents for the All Bookings list.
 * Each agent shows how many bookings it has, with a bar scaled to the busiest
 * agent, so the big accounts are easy to spot and pick.
 */
export default function AgentFilter({ value, onChange, country, source }: {
  value: string[]
  onChange: (next: string[]) => void
  country?: string
  source?: string
}) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [agents, setAgents]   = useState<AgentOption[] | null>(null)
  const [loading, setLoading] = useState(false)
  const wrapRef  = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Refetch when the scope changes; the list is small (one row per agent).
  useEffect(() => {
    const params = new URLSearchParams()
    if (country && country !== 'ALL') params.set('country', country)
    if (source) params.set('source', source)
    let alive = true
    setLoading(true)
    fetch(`/api/bookings/agents?${params}`)
      .then(r => r.json())
      .then(j => { if (alive && j.success) setAgents(j.data.agents) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [country, source])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    setTimeout(() => inputRef.current?.focus(), 0)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [open])

  const max = agents?.[0]?.count ?? 1
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = agents ?? []
    return q ? list.filter(a => a.name.toLowerCase().includes(q)) : list
  }, [agents, query])

  const isOn = (name: string) => value.some(v => sameAgent(v, name))
  const toggle = (name: string) =>
    onChange(isOn(name) ? value.filter(v => !sameAgent(v, name)) : [...value, name])

  const label = value.length === 0 ? 'All agents'
    : value.length === 1 ? value[0]
    : `${value[0]} +${value.length - 1}`

  return (
    <div ref={wrapRef} className="relative w-full sm:w-72 flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`form-input flex items-center gap-2 text-left pr-8 ${
          value.length ? 'border-brand-300 bg-brand-50/60 text-brand-800 font-medium' : 'text-slate-600'
        }`}
        title="Filter by agent"
      >
        <Briefcase className={`w-4 h-4 shrink-0 ${value.length ? 'text-brand-600' : 'text-slate-400'}`} />
        <span className="truncate flex-1">{label}</span>
        {value.length > 1 && (
          <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{value.length}</span>
        )}
      </button>
      {value.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange([])}
          aria-label="Clear agent filter"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : (
        <ChevronDown className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      )}

      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-full sm:w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 animate-slide-up">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && filtered[0]) toggle(filtered[0].name) }}
              placeholder="Find an agent…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-7 pr-2 text-sm focus:border-brand-300 focus:bg-white focus:outline-none"
            />
          </div>

          {value.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-slate-100 px-2 py-2">
              {value.map(v => (
                <span key={v} className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                  {v}
                  <button type="button" onClick={() => toggle(v)} aria-label={`Remove ${v}`} className="hover:text-brand-950"><X className="w-3 h-3" /></button>
                </span>
              ))}
              <button type="button" onClick={() => onChange([])} className="ml-auto text-[11px] font-medium text-slate-400 hover:text-slate-600">Clear</button>
            </div>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {loading && !agents ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading agents…</div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">No agent matches “{query}”</p>
            ) : filtered.map(a => {
              const on = isOn(a.name)
              return (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => toggle(a.name)}
                  className={`group relative flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}>
                    {on && <Check className="w-3 h-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate ${on ? 'font-semibold text-brand-800' : 'text-slate-700'}`}>{a.name}</span>
                    <span className="mt-0.5 block h-1 rounded-full bg-slate-100">
                      <span className={`block h-1 rounded-full ${on ? 'bg-brand-500' : 'bg-slate-300 group-hover:bg-brand-300'}`} style={{ width: `${Math.max(4, (a.count / max) * 100)}%` }} />
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400">{a.count}</span>
                </button>
              )
            })}
          </div>
          {agents && (
            <p className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              {agents.length} agents · pick several to compare · Enter picks the top match
            </p>
          )}
        </div>
      )}
    </div>
  )
}
