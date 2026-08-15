'use client'

/**
 * The queries table — every deduplicated inbound query, what the sweep made of
 * it, and where it landed in the sheet. Rows are editable: a correction here is
 * remembered as a manual override and re-written to the workbook.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CornerDownLeft, CornerUpRight, FilterX, Inbox, Layers, Loader2, Mail, MessageSquare,
  Pencil, Search, Share2, Trash2, Undo2, UserPlus, Users, Zap,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { EmptyState, Field, ReplyStatusBadge, SourceBadge, SyncStatusBadge, inputCls } from './ui'
import type { QmEntry, QmStats, QmThread, QmThreadEvent } from './types'

/**
 * What a query's last outbound mail was, in the team's words.
 *
 * "Forwarded on" and "Internal only" are the two states the sheet could never
 * show before: both used to look exactly like a reply from the conversation id
 * alone, and both mean the agent is still waiting.
 */
const REPLY_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
  DIRECT:   { label: 'Direct reply',   cls: 'bg-emerald-100 text-emerald-700' },
  FORWARD:  { label: 'Forwarded on',   cls: 'bg-amber-100 text-amber-700' },
  INTERNAL: { label: 'Internal only',  cls: 'bg-slate-200 text-slate-600' },
}

/** How each kind of mail is drawn on the timeline. */
const EVENT_STYLE: Record<QmThreadEvent['kind'], {
  verb: string; icon: typeof Mail; cls: string
}> = {
  QUERY:     { verb: 'asked',            icon: Mail,           cls: 'text-sky-600 bg-sky-50 border-sky-200' },
  FOLLOW_UP: { verb: 'wrote again',      icon: MessageSquare,  cls: 'text-sky-600 bg-sky-50 border-sky-200' },
  REPLY:     { verb: 'replied to',       icon: CornerDownLeft, cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  FORWARD:   { verb: 'forwarded to',     icon: Share2,         cls: 'text-amber-600 bg-amber-50 border-amber-200' },
  INTERNAL:  { verb: 'noted internally', icon: CornerUpRight,  cls: 'text-slate-500 bg-slate-50 border-slate-200' },
}

const REPLY_FILTERS = [
  { id: '',        label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'REPLIED', label: 'Replied' },
]

const SYNC_FILTERS = [
  { id: '',        label: 'Any sheet state' },
  { id: 'PENDING', label: 'Awaiting write' },
  { id: 'DIRTY',   label: 'Needs rewrite' },
  { id: 'SYNCED',  label: 'In sheet' },
  { id: 'FAILED',  label: 'Write failed' },
]

const DAY_RANGES = [
  { id: '1',  label: 'Today' },
  { id: '7',  label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
]

const ASSIGNED_FILTERS = [
  { id: '',     label: 'Anyone' },
  { id: 'none', label: 'Unassigned' },
  { id: 'any',  label: 'Assigned' },
]

export const splitNames = (list: string) => list.split(',').map(s => s.trim()).filter(Boolean)

/**
 * Every mail this row stands for, ours included.
 *
 * `followUpCount` is the floor for the same reason it is on the server (see
 * `threadMailCount` in run.ts): a row written before the ledger existed has an
 * empty one, and must not suddenly claim to be a single mail.
 */
const threadTotal = (entry: QmEntry) =>
  Math.max(entry.inboundCount + entry.outboundCount, entry.followUpCount + 1)

/**
 * The File Handler cell: one name, chosen from the people the mail was actually
 * sent to. Rendered as a plain `<select>` because it is used dozens of times a
 * day on a dense table — a modal per row would be a worse tool.
 *
 * Blank is a legitimate value and reads as "nobody has picked this up", so it is
 * styled as a prompt rather than as missing data.
 */
function HandlerPicker({
  entry, options, onPick,
}: {
  entry: QmEntry
  options: string[]
  onPick: (name: string) => void
}) {
  const current = entry.handlerNames.trim()

  if (options.length === 0) {
    return <span className="text-slate-300">—</span>
  }

  return (
    <select
      value={current}
      onChange={e => onPick(e.target.value)}
      title={current ? `Owned by ${current}` : 'Nobody has picked this query up yet'}
      className={cn(
        'w-full max-w-[9rem] px-2 py-1 rounded-lg border text-xs font-semibold',
        'focus:outline-none focus:ring-2 focus:ring-emerald-500/40',
        current
          ? 'border-slate-200 bg-white text-slate-800'
          : 'border-dashed border-amber-300 bg-amber-50 text-amber-700',
      )}
    >
      <option value="">Unassigned…</option>
      {options.map(name => <option key={name} value={name}>{name}</option>)}
    </select>
  )
}

/**
 * The conversation, mail by mail, oldest first.
 *
 * This is the panel the sheet's thread columns are a compression of, and it is
 * here so that compression can be checked: "Mails in Thread 5" and "Forwarded
 * on" are claims, and a team that cannot see what they were computed from will
 * go back to opening Outlook. Ours and theirs are drawn on opposite sides for
 * the same reason a chat app does it — the shape of a thread where nothing ever
 * came back is meant to be visible without reading a word.
 */
function ThreadTimeline({ thread, loading }: { thread: QmThread | null; loading: boolean }) {
  if (loading) {
    return (
      <p className="text-xs text-slate-400 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the thread…
      </p>
    )
  }
  if (!thread || thread.events.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No ledger for this thread yet — it is written from the next mail that touches it.
        Rows from before 15 Aug 2026 start empty by design; their history is not rewritten.
      </p>
    )
  }

  return (
    <ol className="space-y-1.5">
      {thread.events.map(event => {
        const style = EVENT_STYLE[event.kind]
        const Icon  = style.icon
        const ours  = event.direction === 'OUT'
        return (
          <li
            key={event.id}
            className={cn(
              'rounded-lg border p-2 text-xs',
              style.cls,
              // Ours indented, theirs flush — the thread's balance at a glance.
              ours ? 'ml-6' : 'mr-6',
            )}
          >
            <div className="flex items-center gap-1.5 flex-wrap">
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="font-semibold">{event.actorName || event.actorAddress}</span>
              <span className="opacity-80">{style.verb}</span>
              {event.toNames && <span className="font-medium">{event.toNames}</span>}
              <span className="ml-auto tabular-nums opacity-70">
                {formatDateTime(event.occurredAt)}
              </span>
            </div>
            {event.snippet && (
              <p className="mt-1 text-slate-600 line-clamp-2">{event.snippet}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default function QueriesTab({
  refreshKey, onStats,
}: {
  refreshKey: number
  onStats: (stats: QmStats) => void
}) {
  const [entries, setEntries] = useState<QmEntry[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [reply, setReply]   = useState('')
  const [sync, setSync]     = useState('')
  const [days, setDays]     = useState('30')
  const [assigned, setAssigned] = useState('')
  // Which worksheet's mail is on screen — the queries, or everything the
  // exclusion patterns diverted to the other tab.
  const [kind, setKind]     = useState<'QUERY' | 'EXCLUDED'>('QUERY')
  const [counts, setCounts] = useState({ queries: 0, excluded: 0 })

  const [editing, setEditing] = useState<QmEntry | null>(null)
  const [viewing, setViewing] = useState<QmEntry | null>(null)

  // The ledger is fetched per query when the detail panel opens, never with the
  // list — a dozen events with a snippet each, times 200 rows, would dwarf
  // everything else on the page. See the route's own note.
  const [thread, setThread] = useState<QmThread | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  useEffect(() => {
    if (!viewing) { setThread(null); return }

    let cancelled = false
    setThread(null)
    setThreadLoading(true)
    ;(async () => {
      try {
        const res  = await fetch(`/api/query-monitor/entries/${viewing.id}/thread`)
        const json = await res.json()
        if (!cancelled && json.success) setThread(json.data as QmThread)
      } catch {
        // A timeline that will not load must not take the detail panel with it —
        // every other field on it came with the list and is already correct.
      } finally {
        if (!cancelled) setThreadLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [viewing])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days, limit: '200', kind })
      if (search)   params.set('search', search)
      if (reply)    params.set('status', reply)
      if (sync)     params.set('sync', sync)
      if (assigned) params.set('assigned', assigned)

      const res = await fetch(`/api/query-monitor/entries?${params}`)
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setEntries(d.data.entries)
      setTotal(d.data.total)
      setCounts({ queries: d.data.stats.queries, excluded: d.data.stats.excluded })
      // The headline tiles measure the SLA, so they only ever reflect real queries.
      if (kind === 'QUERY') onStats(d.data.stats)
    } finally { setLoading(false) }
  }, [search, reply, sync, days, kind, assigned, onStats])

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { void load() }, search ? 350 : 0)
    return () => clearTimeout(id)
  }, [load, search, refreshKey])

  /**
   * Who is carrying what. Two numbers per person: the queries they own, and the
   * ones that merely landed in their inbox — before the File Handler column
   * meant one person, only the second was knowable.
   */
  const handlerTally = useMemo(() => {
    const tally = new Map<string, { owned: number; received: number }>()
    const bump = (name: string, key: 'owned' | 'received') => {
      const row = tally.get(name) ?? { owned: 0, received: 0 }
      row[key] += 1
      tally.set(name, row)
    }
    for (const entry of entries) {
      for (const name of splitNames(entry.toList)) bump(name, 'received')
      const owner = entry.handlerNames.trim()
      if (owner) bump(owner, 'owned')
    }
    return Array.from(tally.entries()).sort((a, b) => b[1].received - a[1].received)
  }, [entries])

  const unassignedShown = useMemo(
    () => entries.filter(e => e.mailKind === 'QUERY' && !e.handlerNames.trim()).length,
    [entries],
  )

  /** Pick the one handler who owns a query, straight from the table. */
  async function assignHandler(entry: QmEntry, name: string) {
    // Optimistic: the dropdown must not snap back while the PATCH is in flight.
    setEntries(list => list.map(e => (e.id === entry.id ? { ...e, handlerNames: name } : e)))

    const res = await fetch(`/api/query-monitor/entries/${entry.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handlerNames: name }),
    })
    const d = await res.json()
    if (!d.success) {
      toast.error(d.error)
      setEntries(list => list.map(e => (e.id === entry.id ? { ...e, handlerNames: entry.handlerNames } : e)))
      return
    }
    toast.success(name ? `File handler set to ${name}` : 'File handler cleared')
    void load()
  }

  async function saveEdit(patch: Record<string, unknown>) {
    if (!editing) return
    const res = await fetch(`/api/query-monitor/entries/${editing.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success(d.message ?? 'Saved')
    setEditing(null)
    void load()
  }

  /** Send one mail to the other worksheet — only possible before it is written. */
  async function moveKind(entry: QmEntry) {
    const next = entry.mailKind === 'EXCLUDED' ? 'QUERY' : 'EXCLUDED'
    const res = await fetch(`/api/query-monitor/entries/${entry.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailKind: next, excludeReason: 'Moved by hand' }),
    })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success(next === 'EXCLUDED'
      ? 'Moved to the other-mail tab — it will not reach the query sheet'
      : 'Moved back to the query sheet')
    void load()
  }

  async function remove(entry: QmEntry) {
    if (!confirm(`Delete "${entry.subject.slice(0, 60)}"? It will be picked up again if the mail is still in the lookback window.`)) return
    const res = await fetch(`/api/query-monitor/entries/${entry.id}`, { method: 'DELETE' })
    const d = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Deleted')
    void load()
  }

  return (
    <div className="space-y-4">
      {/* ── Which worksheet ──────────────────────────────────────────── */}
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
        {([
          { id: 'QUERY',    label: 'Queries',      count: counts.queries },
          { id: 'EXCLUDED', label: 'Other mail',   count: counts.excluded },
        ] as const).map(t => (
          <button
            key={t.id} onClick={() => { setKind(t.id); setReply('') }}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors',
              kind === t.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {t.id === 'EXCLUDED' && <FilterX className="w-3.5 h-3.5" />}
            {t.label}
            <span className={cn('text-[11px]', kind === t.id ? 'text-slate-300' : 'text-slate-400')}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {kind === 'EXCLUDED' && (
        <p className="text-xs text-slate-500 -mt-1">
          Vouchers, on-ground issues, avail checks and the like. These are kept out of the query sheet and
          written to the separate tab instead — edit the patterns under Configuration → Mail that is not a query.
        </p>
      )}

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Subject, sender, agent, destination, CNTL…"
            className={cn(inputCls, 'pl-9')}
          />
        </div>

        {/* Reply SLA only means something for real queries. */}
        {kind === 'QUERY' && (
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {REPLY_FILTERS.map(f => (
              <button
                key={f.id} onClick={() => setReply(f.id)}
                className={cn(
                  'px-3 py-2 text-xs font-semibold transition-colors',
                  reply === f.id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
                )}
              >{f.label}</button>
            ))}
          </div>
        )}

        {kind === 'QUERY' && (
          <select
            value={assigned} onChange={e => setAssigned(e.target.value)}
            title="Whether a file handler has been picked out of the TO list"
            className={cn(inputCls, 'w-auto')}
          >
            {ASSIGNED_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        )}

        <select value={sync} onChange={e => setSync(e.target.value)} className={cn(inputCls, 'w-auto')}>
          {SYNC_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>

        <select value={days} onChange={e => setDays(e.target.value)} className={cn(inputCls, 'w-auto')}>
          {DAY_RANGES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      {/* Per-handler load for the current filter — the "who is busy" read.
          Owned first, because that is the number that means accountability. */}
      {handlerTally.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-semibold text-slate-400">
            <Users className="w-3.5 h-3.5" /> Load
          </span>
          {handlerTally.map(([name, count]) => (
            <button
              key={name} onClick={() => setSearch(name)}
              title={`${count.owned} owned · ${count.received} received — click to filter`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs hover:border-emerald-300 hover:bg-emerald-50"
            >
              <span className="font-semibold text-slate-700">{name}</span>
              <span className="font-semibold text-emerald-600">{count.owned}</span>
              <span className="text-slate-300">/</span>
              <span className="text-slate-400">{count.received}</span>
            </button>
          ))}
          <span className="text-[11px] text-slate-400">owned / received</span>
        </div>
      )}

      {/* The screen's own to-do: mail that reached several handlers and that
          nobody has claimed. Its File Handler cell is blank in the workbook. */}
      {kind === 'QUERY' && unassignedShown > 0 && assigned !== 'none' && (
        <button
          onClick={() => setAssigned('none')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {unassignedShown} quer{unassignedShown === 1 ? 'y has' : 'ies have'} no file handler picked yet — show them
        </button>
      )}

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-20 grid place-items-center text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-6 h-6" />}
            title="No queries in this view"
            hint="Press “Run now” to sweep the mailboxes, or widen the date range."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-left">
                <tr className="text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2.5 font-semibold">Received</th>
                  <th className="px-3 py-2.5 font-semibold">{kind === 'EXCLUDED' ? 'Kept out by' : 'Status'}</th>
                  <th className="px-3 py-2.5 font-semibold min-w-[18rem]">Subject</th>
                  <th className="px-3 py-2.5 font-semibold">File handler</th>
                  <th className="px-3 py-2.5 font-semibold">TO list</th>
                  <th className="px-3 py-2.5 font-semibold">Sales person</th>
                  <th className="px-3 py-2.5 font-semibold">Agent</th>
                  <th className="px-3 py-2.5 font-semibold">Destination</th>
                  <th className="px-3 py-2.5 font-semibold">Travel</th>
                  <th className="px-3 py-2.5 font-semibold">Replied</th>
                  <th className="px-3 py-2.5 font-semibold">Sheet</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map(entry => {
                  const toList = splitNames(entry.toList)
                  return (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">
                        {formatDateTime(entry.receivedAt)}
                      </td>
                      <td className="px-3 py-2.5">
                        {entry.mailKind === 'EXCLUDED'
                          ? (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold max-w-[11rem]"
                              title={entry.excludeReason ?? 'Not a query'}
                            >
                              <FilterX className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{entry.excludeReason ?? 'Not a query'}</span>
                            </span>
                          )
                          : <ReplyStatusBadge status={entry.replyStatus} />}
                      </td>
                      <td className="px-3 py-2.5">
                        <button onClick={() => setViewing(entry)} className="text-left group">
                          <span className="flex items-center gap-1.5">
                            {entry.isUrgent && <Zap className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />}
                            <span className="font-medium text-slate-800 group-hover:text-emerald-700 line-clamp-1">
                              {entry.subject}
                            </span>
                            {/* Every mail of the thread shares this row instead
                                of repeating the subject underneath it — ours as
                                well as theirs, which is what the counter says. */}
                            {threadTotal(entry) > 1 && (
                              <span
                                title={`${entry.inboundCount} mail(s) from them, ${entry.outboundCount} from us — all folded into this row`}
                                className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold"
                              >
                                <Layers className="w-3 h-3" /> {threadTotal(entry)}
                              </span>
                            )}
                            {/* Passed to a colleague and still not answered —
                                the state that used to be indistinguishable from
                                a mail nobody had opened. */}
                            {entry.replyType === 'FORWARD' && entry.replyStatus !== 'REPLIED' && (
                              <span
                                title={entry.forwardChain ?? 'Forwarded on, agent not yet answered'}
                                className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold"
                              >
                                <Share2 className="w-3 h-3" /> Forwarded
                              </span>
                            )}
                          </span>
                          {/* The one-line read of the mail, when the AI switch
                              wrote one — the same sentence that goes in the
                              sheet's AI Summary column. */}
                          {entry.aiSummary && (
                            <span className="block text-[11px] text-slate-500 italic line-clamp-1">
                              {entry.aiSummary}
                            </span>
                          )}
                          {/* What became of the thread, when it is more than the
                              one mail column T already reads. */}
                          {entry.replySummary && threadTotal(entry) > 1 && (
                            <span className="block text-[11px] text-sky-600/90 line-clamp-1">
                              {entry.replySummary}
                            </span>
                          )}
                          {/* Who it actually came from — the address, not just
                              the agency the sender rules mapped it to. */}
                          <span className="block text-[11px] text-slate-400 truncate">
                            {entry.fromName ? `${entry.fromName} · ` : ''}{entry.fromAddress}
                            {entry.lastMessageAt && threadTotal(entry) > 1
                              && ` · last mail ${formatDateTime(entry.lastMessageAt)}`}
                          </span>
                        </button>
                      </td>
                      {/* One owner, picked out of the TO list. Editable right in
                          the row — this is the field the team touches most. */}
                      <td className="px-3 py-2.5">
                        <HandlerPicker
                          entry={entry} options={toList}
                          onPick={name => assignHandler(entry, name)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        {/* Everyone the mail actually reached. One row, never duplicated. */}
                        <div className="flex flex-wrap gap-1 max-w-[12rem]">
                          {toList.length === 0
                            ? <span className="text-slate-300">—</span>
                            : toList.map(name => (
                                <span key={name} className={cn(
                                  'px-1.5 py-0.5 rounded text-[11px] font-medium',
                                  name === entry.handlerNames
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-600',
                                )}>
                                  {name}
                                </span>
                              ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{entry.salesPerson ?? '—'}</td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap max-w-[10rem] truncate">{entry.agent ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-slate-700">{entry.destination ?? '—'}</span>
                          <SourceBadge source={entry.extractionSource} confidence={entry.aiConfidence} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                        {entry.travelDate ? formatDate(entry.travelDate) : '—'}
                      </td>
                      {/* When, and by whom. The pair is the answer to "who
                          replied and when" — one without the other has had to be
                          chased through Outlook every time it was asked. */}
                      <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                        {entry.repliedAt
                          ? (
                            <>
                              {formatDateTime(entry.repliedAt)}
                              {entry.repliedBy && (
                                <span
                                  className="block text-[10px] text-emerald-600 font-semibold"
                                  title={entry.repliedToAddress
                                    ? `Sent to ${entry.repliedToAddress}`
                                    : undefined}
                                >
                                  by {entry.repliedBy}
                                </span>
                              )}
                            </>
                          )
                          : entry.forwardChain
                            ? (
                              <span className="text-amber-600" title={entry.forwardChain}>
                                forwarded, no reply yet
                              </span>
                            )
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5">
                        <SyncStatusBadge status={entry.syncStatus} sheetRow={entry.sheetRow} />
                        {entry.sheetTab && (
                          <p className="text-[10px] text-slate-400 mt-0.5 max-w-[12rem] truncate" title={entry.sheetTab}>
                            {entry.sheetTab}
                          </p>
                        )}
                        {entry.syncError && (
                          <p className="text-[10px] text-rose-500 mt-0.5 max-w-[12rem] truncate" title={entry.syncError}>
                            {entry.syncError}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {/* Only offered before the row is written — moving it
                              afterwards would strand a row on the other tab. */}
                          {!entry.sheetRow && (
                            <button
                              onClick={() => moveKind(entry)}
                              title={entry.mailKind === 'EXCLUDED'
                                ? 'Treat as a real query — write it to the query sheet'
                                : 'Not a query — send it to the other-mail tab instead'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            >
                              {entry.mailKind === 'EXCLUDED'
                                ? <Undo2 className="w-4 h-4" />
                                : <FilterX className="w-4 h-4" />}
                            </button>
                          )}
                          <button
                            onClick={() => setEditing(entry)} title="Edit"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"
                          ><Pencil className="w-4 h-4" /></button>
                          <button
                            onClick={() => remove(entry)} title="Delete"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          ><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && entries.length > 0 && (
        <p className="text-xs text-slate-400">
          Showing {entries.length} of {total.toLocaleString()}{' '}
          {kind === 'EXCLUDED' ? `mail${total === 1 ? '' : 's'} kept out of the query sheet` : `quer${total === 1 ? 'y' : 'ies'}`}
        </p>
      )}

      {/* ── Detail ───────────────────────────────────────────────────── */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title="Query detail" size="2xl">
        {viewing && (
          <div className="space-y-4">
            <div>
              <p className="text-base font-semibold text-slate-900">{viewing.subject}</p>
              <p className="text-xs text-slate-500 mt-1">
                <Mail className="w-3 h-3 inline mr-1" />
                {viewing.fromName ? `${viewing.fromName} · ` : ''}{viewing.fromAddress}
              </p>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 text-sm">
              <Detail label="Allocation time" value={formatDateTime(viewing.receivedAt)} />
              <Detail label="Replied time" value={viewing.repliedAt ? formatDateTime(viewing.repliedAt) : 'Not yet'} />
              <Detail label="Status" value={<ReplyStatusBadge status={viewing.replyStatus} />} />
              <Detail
                label="Replied by"
                value={viewing.repliedBy
                  ? (
                    <span>
                      {viewing.repliedBy}
                      {viewing.repliedByEmail && (
                        <span className="block text-[11px] text-slate-400">{viewing.repliedByEmail}</span>
                      )}
                    </span>
                  )
                  : '—'}
              />
              {/* Where the answer went. "Replied by Sajid" is only half of it —
                  this is what shows it reached the agent and not a colleague. */}
              <Detail label="Replied to" value={viewing.repliedToAddress ?? '—'} />
              <Detail
                label="Response time"
                value={viewing.repliedAt
                  ? `${((new Date(viewing.repliedAt).getTime() - new Date(viewing.receivedAt).getTime()) / 3_600_000).toFixed(2)} h`
                  : '—'}
              />
              <Detail
                label="Mails in thread"
                value={
                  <span>
                    {Math.max(
                      viewing.inboundCount + viewing.outboundCount,
                      viewing.followUpCount + 1,
                    )}
                    <span className="block text-[11px] text-slate-400">
                      {viewing.inboundCount} in · {viewing.outboundCount} out · last{' '}
                      {formatDateTime(viewing.lastMessageAt ?? viewing.receivedAt)}
                    </span>
                  </span>
                }
              />
              <Detail
                label="Last outbound"
                value={viewing.replyType
                  ? (
                    <span className={cn(
                      'inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold',
                      REPLY_TYPE_LABEL[viewing.replyType]?.cls,
                    )}>
                      {REPLY_TYPE_LABEL[viewing.replyType]?.label ?? viewing.replyType}
                    </span>
                  )
                  : <span className="text-slate-400">Nothing sent yet</span>}
              />
              {/* Who handed the thread to whom, in the order it happened. */}
              <Detail label="Forward chain" value={viewing.forwardChain ?? '—'} />
              <Detail
                label="File handler"
                value={viewing.handlerNames || <span className="text-amber-600">Not picked yet</span>}
              />
              <Detail label="TO list" value={viewing.toList || '—'} />
              <Detail label="Sales person" value={viewing.salesPerson ?? '—'} />
              <Detail label="Agent" value={viewing.agent ?? '—'} />
              <Detail label="Destination" value={viewing.destination ?? '—'} />
              <Detail label="Travel date" value={viewing.travelDate ? formatDate(viewing.travelDate) : '—'} />
              <Detail label="Region" value={viewing.region ?? '—'} />
              <Detail label="CNTL" value={viewing.cntl ?? '—'} />
              <Detail label="Amendment" value={viewing.amendment ?? '—'} />
              <Detail
                label="Sheet row"
                value={viewing.sheetRow
                  ? `${viewing.sheetTab ?? 'Query sheet'} · row ${viewing.sheetRow}`
                  : 'Not written yet'}
              />
              <Detail
                label="Backup row"
                value={viewing.backupSheetRow ? `Row ${viewing.backupSheetRow}` : 'Not mirrored yet'}
              />
              {viewing.mailKind === 'EXCLUDED' && (
                <Detail label="Kept out of the query sheet by" value={viewing.excludeReason ?? 'Not a query'} />
              )}
            </div>

            {viewing.aiSummary && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">
                  AI summary <span className="font-normal text-slate-400">· the mail that opened the thread</span>
                </p>
                <p className="text-sm text-slate-700 bg-emerald-50/60 border border-emerald-100 rounded-lg p-3">
                  {viewing.aiSummary}
                </p>
              </div>
            )}

            {/* Column AA. Deliberately shown under the AI summary and not beside
                it: one says what was asked, the other what became of it, and
                reading them in that order is the whole point of having both. */}
            {(viewing.replySummary || thread?.ledgerSays) && (
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1">
                  Reply summary <span className="font-normal text-slate-400">· the whole thread</span>
                </p>
                <p className="text-sm text-slate-700 bg-sky-50/60 border border-sky-100 rounded-lg p-3">
                  {viewing.replySummary || thread?.ledgerSays}
                </p>
                {viewing.replySummaryAt && (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Rewritten {formatDateTime(viewing.replySummaryAt)} — it is written again
                    every time the thread grows.
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">
                Thread <span className="font-normal text-slate-400">· every mail, ours and theirs</span>
              </p>
              <ThreadTimeline thread={thread} loading={threadLoading} />
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Mail extract</p>
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap max-h-56 overflow-y-auto">
                {viewing.bodySnippet || '(empty)'}
              </p>
            </div>

            {viewing.matches && viewing.matches.length > 1 && (
              <p className="text-xs text-slate-500">
                This mail reached {viewing.matches.length} handlers and is deliberately kept as one row —
                every name goes in the TO List column, and one of them owns it in the File Handler column.
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ── Edit ─────────────────────────────────────────────────────── */}
      <EditEntryModal entry={editing} onClose={() => setEditing(null)} onSave={saveEdit} />
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
      <div className="text-sm text-slate-800 mt-0.5 break-words">{value}</div>
    </div>
  )
}

function EditEntryModal({
  entry, onClose, onSave,
}: {
  entry: QmEntry | null
  onClose: () => void
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!entry) return
    setForm({
      handlerNames: entry.handlerNames,
      toList:       entry.toList,
      salesPerson:  entry.salesPerson ?? '',
      agent:        entry.agent ?? '',
      destination:  entry.destination ?? '',
      region:       entry.region ?? '',
      cntl:         entry.cntl ?? '',
      amendment:    entry.amendment ?? '',
      travelDate:   entry.travelDate ? entry.travelDate.slice(0, 10) : '',
      repliedAt:    entry.repliedAt ? entry.repliedAt.slice(0, 16) : '',
    })
  }, [entry])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  async function submit() {
    setSaving(true)
    try {
      await onSave({
        ...form,
        travelDate: form.travelDate || null,
        repliedAt:  form.repliedAt  || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open={!!entry} onClose={onClose} title="Edit query" size="2xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            onClick={submit} disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save & queue for sheet
          </button>
        </div>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        {/* One owner, chosen from the TO list — sheet column F takes a single
            name. Editing the TO list below widens what can be chosen here. */}
        <Field label="File handler" hint="One person, picked from the TO list. Leave unassigned if nobody has taken it.">
          <select
            value={form.handlerNames ?? ''}
            onChange={e => setForm(f => ({ ...f, handlerNames: e.target.value }))}
            className={inputCls}
          >
            <option value="">Unassigned…</option>
            {splitNames(form.toList ?? '').map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </Field>
        <Field label="TO list" hint="Everyone the mail reached, comma-separated — sheet column G">
          <input
            value={form.toList ?? ''}
            onChange={e => {
              const toList = e.target.value
              // Never leave an owner who is no longer on the mail: the API would
              // reject the save, so drop the name here rather than fail later.
              setForm(f => {
                const stillListed = splitNames(toList)
                  .some(n => n.toLowerCase() === (f.handlerNames ?? '').trim().toLowerCase())
                return { ...f, toList, handlerNames: stillListed ? f.handlerNames : '' }
              })
            }}
            className={inputCls}
          />
        </Field>
        <Field label="Sales person">
          <input value={form.salesPerson ?? ''} onChange={set('salesPerson')} className={inputCls} />
        </Field>
        <Field label="Agent">
          <input value={form.agent ?? ''} onChange={set('agent')} className={inputCls} />
        </Field>
        <Field label="Destination">
          <input value={form.destination ?? ''} onChange={set('destination')} className={inputCls} />
        </Field>
        <Field label="Travel date">
          <input type="date" value={form.travelDate ?? ''} onChange={set('travelDate')} className={inputCls} />
        </Field>
        <Field label="Replied time" hint="Setting this marks the query answered">
          <input type="datetime-local" value={form.repliedAt ?? ''} onChange={set('repliedAt')} className={inputCls} />
        </Field>
        <Field label="CNTL">
          <input value={form.cntl ?? ''} onChange={set('cntl')} className={inputCls} />
        </Field>
        <Field label="Amendment">
          <input value={form.amendment ?? ''} onChange={set('amendment')} className={inputCls} />
        </Field>
        <Field label="Region">
          <input value={form.region ?? ''} onChange={set('region')} className={inputCls} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Edited fields are locked against future automatic extraction, and the row is rewritten in the workbook
        {entry?.sheetRow ? ` at row ${entry.sheetRow}` : ' on the next sync'}.
      </p>
    </Modal>
  )
}
