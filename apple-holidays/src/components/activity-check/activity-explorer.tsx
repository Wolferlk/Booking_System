'use client'

/**
 * The Activity Explorer.
 *
 * A keyword box is only useful to someone who already knows the keyword. This
 * is the other half: the products the book actually contains, mined from real
 * activity titles and ranked by how many files carry them, so a user can pick
 * "Ba Na Hills" out of a list instead of guessing how it was typed.
 */

import { useCallback, useEffect, useState } from 'react'
import { Search, Loader2, Plus, Check, MapPin, Compass, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import Modal from '@/components/ui/modal'

type Entry = {
  key: string
  label: string
  count: number
  bookings: number
  firstDate: string | null
  lastDate: string | null
  sources: ('AGENDA' | 'ITINERARY')[]
  example: string
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

export default function ActivityExplorer({
  open,
  onClose,
  country,
  activeTerms,
  onPick,
}: {
  open: boolean
  onClose: () => void
  country: string
  activeTerms: string[]
  onPick: (term: string) => void
}) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'activities' | 'locations'>('activities')
  const [data, setData] = useState<{ activities: Entry[]; locations: Entry[]; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (needle: string) => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (needle.trim()) sp.set('q', needle.trim())
      if (country) sp.set('country', country)
      const res = await fetch(`/api/activity-check/catalogue?${sp}`)
      const json = await res.json()
      if (json.success) setData(json.data)
    } catch {
      // A failed catalogue load is a convenience lost, not a broken screen —
      // the keyword box beside it still works.
    } finally {
      setLoading(false)
    }
  }, [country])

  // Debounced: the catalogue reads a wide window, so it should not re-run on
  // every keystroke.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => void load(q), q ? 350 : 0)
    return () => clearTimeout(t)
  }, [open, q, load])

  const active = new Set(activeTerms.map(t => t.toLowerCase().trim()))
  const entries = data ? (tab === 'activities' ? data.activities : data.locations) : []

  return (
    <Modal open={open} onClose={onClose} title="Activity Explorer" size="4xl">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          Built from the activity names on real agendas and itineraries over the last six months and the
          year ahead. Ranked by how many files carry each one — click to add it as a search keyword.
        </p>

        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 focus-within:border-brand-400">
            <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Filter the list — try “hills”, “cruise”, “bridge”…"
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
            />
            {loading && <Loader2 className="w-4 h-4 text-brand-500 animate-spin" />}
          </div>
          <button
            onClick={() => void load(q)}
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-300"
            aria-label="Reload"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-slate-100">
          {([
            { id: 'activities' as const, label: 'Activities & tours', icon: Compass, n: data?.activities.length },
            { id: 'locations' as const, label: 'Locations', icon: MapPin, n: data?.locations.length },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 py-2 text-xs font-semibold border-b-2 -mb-px inline-flex items-center gap-1.5',
                tab === t.id
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600',
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
              {t.n !== undefined && <span className="text-[10px] text-slate-400">({t.n})</span>}
            </button>
          ))}
        </div>

        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {!data && loading && (
            <div className="py-12 text-center text-sm text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Reading the book…
            </div>
          )}
          {data && entries.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-400">
              Nothing here{q ? ` for “${q}”` : ''}. Type the keyword straight into the search box instead.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {entries.map(e => {
              const on = active.has(e.label.toLowerCase())
              return (
                <button
                  key={e.key}
                  onClick={() => onPick(e.label)}
                  className={cn(
                    'text-left p-3 rounded-xl border transition-colors group',
                    on
                      ? 'border-brand-400 bg-brand-50'
                      : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm text-slate-800 leading-snug">{e.label}</span>
                    <span className={cn(
                      'flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center',
                      on ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-400 group-hover:bg-brand-100 group-hover:text-brand-600',
                    )}>
                      {on ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                    <span><b className="text-slate-700">{e.bookings}</b> file{e.bookings === 1 ? '' : 's'}</span>
                    <span><b className="text-slate-700">{e.count}</b> activit{e.count === 1 ? 'y' : 'ies'}</span>
                    <span>{fmt(e.firstDate)} → {fmt(e.lastDate)}</span>
                    {e.sources.map(s => (
                      <span
                        key={s}
                        className={cn(
                          'px-1.5 rounded font-semibold',
                          s === 'AGENDA' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700',
                        )}
                      >
                        {s === 'AGENDA' ? 'agenda' : 'itinerary'}
                      </span>
                    ))}
                  </div>
                  {e.example && e.example.toLowerCase() !== e.label.toLowerCase() && (
                    <p className="mt-1.5 text-[10px] text-slate-400 line-clamp-2 italic">e.g. “{e.example}”</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}
