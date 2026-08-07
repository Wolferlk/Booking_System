'use client'

/**
 * The queries table — every deduplicated inbound query, what the sweep made of
 * it, and where it landed in the sheet. Rows are editable: a correction here is
 * remembered as a manual override and re-written to the workbook.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  FilterX, Inbox, Loader2, Mail, Pencil, Search, Trash2, Undo2, Users, Zap,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { EmptyState, Field, ReplyStatusBadge, SourceBadge, SyncStatusBadge, inputCls } from './ui'
import type { QmEntry, QmStats } from './types'

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
  // Which worksheet's mail is on screen — the queries, or everything the
  // exclusion patterns diverted to the other tab.
  const [kind, setKind]     = useState<'QUERY' | 'EXCLUDED'>('QUERY')
  const [counts, setCounts] = useState({ queries: 0, excluded: 0 })

  const [editing, setEditing] = useState<QmEntry | null>(null)
  const [viewing, setViewing] = useState<QmEntry | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days, limit: '200', kind })
      if (search) params.set('search', search)
      if (reply)  params.set('status', reply)
      if (sync)   params.set('sync', sync)

      const res = await fetch(`/api/query-monitor/entries?${params}`)
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setEntries(d.data.entries)
      setTotal(d.data.total)
      setCounts({ queries: d.data.stats.queries, excluded: d.data.stats.excluded })
      // The headline tiles measure the SLA, so they only ever reflect real queries.
      if (kind === 'QUERY') onStats(d.data.stats)
    } finally { setLoading(false) }
  }, [search, reply, sync, days, kind, onStats])

  // Debounced so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const id = setTimeout(() => { void load() }, search ? 350 : 0)
    return () => clearTimeout(id)
  }, [load, search, refreshKey])

  const handlerTally = useMemo(() => {
    const tally = new Map<string, number>()
    for (const entry of entries) {
      for (const name of entry.handlerNames.split(',').map(s => s.trim()).filter(Boolean)) {
        tally.set(name, (tally.get(name) ?? 0) + 1)
      }
    }
    return Array.from(tally.entries()).sort((a, b) => b[1] - a[1])
  }, [entries])

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

        <select value={sync} onChange={e => setSync(e.target.value)} className={cn(inputCls, 'w-auto')}>
          {SYNC_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>

        <select value={days} onChange={e => setDays(e.target.value)} className={cn(inputCls, 'w-auto')}>
          {DAY_RANGES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </div>

      {/* Per-handler load for the current filter — the "who is busy" read. */}
      {handlerTally.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-semibold text-slate-400">
            <Users className="w-3.5 h-3.5" /> Load
          </span>
          {handlerTally.map(([name, count]) => (
            <span key={name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200 text-xs">
              <span className="font-semibold text-slate-700">{name}</span>
              <span className="text-slate-400">{count}</span>
            </span>
          ))}
        </div>
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
                  const handlers = entry.handlerNames.split(',').map(s => s.trim()).filter(Boolean)
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
                          </span>
                          <span className="block text-[11px] text-slate-400 truncate">
                            {entry.fromName || entry.fromAddress} · {entry.fromDomain}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        {/* One mail can reach several handlers — every name shows here,
                            but it is still a single row, in the sheet as on screen. */}
                        <div className="flex flex-wrap gap-1 max-w-[12rem]">
                          {handlers.length === 0
                            ? <span className="text-slate-300">—</span>
                            : handlers.map(name => (
                                <span key={name} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[11px] font-medium">
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
                      <td className="px-3 py-2.5 text-slate-500 text-xs whitespace-nowrap">
                        {entry.repliedAt ? formatDateTime(entry.repliedAt) : '—'}
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
              <Detail label="File handlers" value={viewing.handlerNames || '—'} />
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
              {viewing.mailKind === 'EXCLUDED' && (
                <Detail label="Kept out of the query sheet by" value={viewing.excludeReason ?? 'Not a query'} />
              )}
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
                every name is listed in the File Handler column instead of duplicating the query.
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
        <Field label="File handler(s)" hint="Comma-separated — exactly what goes in the sheet cell">
          <input value={form.handlerNames ?? ''} onChange={set('handlerNames')} className={inputCls} />
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
