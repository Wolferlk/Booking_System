'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Link2, MessageCircle, Search, X } from 'lucide-react'
import { fmtDate, type RelatedThread } from './shared'

/** How many of the most recent sibling numbers stay visible while collapsed. */
const PREVIEW = 3

/**
 * Other numbers filed under the same booking as the open thread.
 *
 * A booking can carry hundreds of these (group tours, bulk sends), so the strip
 * is a single line by default — the few most recent numbers plus a "show all"
 * toggle. Expanded, the full list sits in a capped, scrollable, searchable
 * panel so the conversation and composer never get pushed off screen.
 */
export function RelatedThreadsStrip({ threads, onOpen }: { threads: RelatedThread[]; onOpen: (phone: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const sorted = useMemo(
    () => [...threads].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? '')),
    [threads],
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^\+/, '')
    if (!needle) return sorted
    return sorted.filter(t => t.phone.includes(needle.replace(/\s/g, '')) || (t.displayName ?? '').toLowerCase().includes(needle))
  }, [sorted, q])

  if (!threads.length) return null
  const total = threads.length
  const hidden = Math.max(0, total - PREVIEW)

  const chip = (rt: RelatedThread) => (
    <button
      key={rt.phone}
      onClick={() => onOpen(rt.phone)}
      title={`Open chat with +${rt.phone} — ${rt.messageCount} message${rt.messageCount === 1 ? '' : 's'}, last ${fmtDate(rt.lastAt)}`}
      className="inline-flex max-w-[220px] shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-50"
    >
      <MessageCircle className="h-3 w-3 shrink-0" />
      <span className="truncate">{rt.displayName ? `${rt.displayName} · ` : ''}+{rt.phone}</span>
      <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">{rt.messageCount}</span>
    </button>
  )

  return (
    <div
      className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70"
      title="Messages sent to these numbers belong to the same booking but live in their own thread — the booking page's chat shows them all together."
    >
      {/* Collapsed: one line, never wraps */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-amber-800">
          <Link2 className="h-3 w-3" />
          {total === 1 ? '1 other number' : `${total} other numbers`}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {!open && sorted.slice(0, PREVIEW).map(chip)}
        </div>
        {(hidden > 0 || open) && (
          <button
            onClick={() => { setOpen(o => !o); setQ('') }}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-600 px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-amber-700"
          >
            {open ? 'Hide' : `+${hidden} more`}
            <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {/* Expanded: searchable, height-capped list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-amber-200"
          >
            <div className="px-2.5 pb-2 pt-1.5">
              {total > 8 && (
                <div className="relative mb-1.5">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-amber-500" />
                  <input
                    autoFocus
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder="Find a number or name…"
                    className="w-full rounded-lg border border-amber-200 bg-white py-1 pl-7 pr-7 text-[11.5px] text-slate-700 outline-none placeholder:text-amber-400 focus:border-amber-400"
                  />
                  {q && (
                    <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-amber-500 hover:text-amber-700">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto pr-1">
                {filtered.length ? filtered.map(chip) : (
                  <span className="px-1 py-0.5 text-[11px] text-amber-700">No number matches “{q}”.</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
