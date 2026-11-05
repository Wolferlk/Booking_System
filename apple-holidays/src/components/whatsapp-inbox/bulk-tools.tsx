'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, AlertTriangle, BarChart3, Download, Loader2, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { downloadText, fmtTime } from './shared'

// ── Shared shell ─────────────────────────────────────────────────────────────

function Modal({ title, icon, onClose, children, footer }: {
  title: string
  icon: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 px-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
        initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-white px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-green-600 text-white shadow-md shadow-emerald-500/30">{icon}</span>
            <p className="text-[15px] font-bold text-slate-900">{title}</p>
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </motion.div>
    </motion.div>
  )
}

const btnGhost = 'rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50'
const btnPrimary = 'flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-50'

function localMidnight(daysAgo = 0): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

// ── Retry today's failed ─────────────────────────────────────────────────────

interface FailedItem {
  id: string
  phone: string
  bookingRef: string
  tag: string
  preview: string
  createdAt: string
  code: number | null
  reason: string | null
  skip: string | null
}

interface FailedSummary {
  items: FailedItem[]
  retryable: number
  skipped: number
  billingBlocked: boolean
}

export function RetryFailedModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [since] = useState(() => localMidnight().toISOString())
  const [summary, setSummary] = useState<FailedSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [errors, setErrors] = useState<{ phone: string; error: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/whatsapp/retry-failed?since=${encodeURIComponent(since)}`).then(r => r.json())
      if (!res.success) throw new Error(res.error || 'Could not load failed messages')
      setSummary(res.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load failed messages')
    } finally {
      setLoading(false)
    }
  }, [since])

  useEffect(() => { load() }, [load])

  const retry = async () => {
    setRunning(true)
    setErrors([])
    let retried = 0
    const failed: { phone: string; error: string }[] = []
    try {
      // The server resends in batches; keep going until nothing retryable is left.
      for (let round = 0; round < 25; round++) {
        const res = await fetch('/api/whatsapp/retry-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ since }),
        }).then(r => r.json())
        if (!res.success) throw new Error(res.error || 'Retry failed')
        retried += res.data.retried
        failed.push(...res.data.failed)
        if (res.data.remaining === 0 || res.data.retried === 0) break
      }
      setErrors(failed)
      if (retried) toast.success(`Resent ${retried} message${retried === 1 ? '' : 's'}`)
      if (failed.length) toast.error(`${failed.length} could not be sent`)
      if (!retried && !failed.length) toast.info('Nothing left to retry')
      onDone()
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRunning(false)
    }
  }

  const items = summary?.items ?? []

  return (
    <Modal
      title="Retry today's failed messages"
      icon={<RotateCcw className="h-4 w-4" />}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Close</button>
        <motion.button whileTap={{ scale: 0.96 }} onClick={retry} disabled={running || loading || !summary?.retryable} className={btnPrimary}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Retry {summary?.retryable ?? 0} message{summary?.retryable === 1 ? '' : 's'}
        </motion.button>
      </>}
    >
      {loading && !summary ? (
        <div className="grid place-items-center py-12 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-slate-500">No failed messages today. 🎉</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Failed today" value={items.length} tone="text-rose-600" />
            <Stat label="Will be retried" value={summary!.retryable} tone="text-emerald-600" />
            <Stat label="Skipped" value={summary!.skipped} tone="text-slate-500" />
          </div>

          {summary!.billingBlocked && (
            <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Some of these failed because of a payment problem on the WhatsApp Business account (Meta 131042).
              Until billing is fixed in Meta Business Manager, a retry outside the 24h window will fail the same way.
            </p>
          )}

          {errors.length > 0 && (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              <p className="font-semibold">Could not send:</p>
              {errors.slice(0, 8).map((e, i) => <p key={i} className="truncate">+{e.phone}: {e.error}</p>)}
              {errors.length > 8 && <p>…and {errors.length - 8} more</p>}
            </div>
          )}

          <p className="mt-3 text-[11.5px] text-slate-400">
            Each message is sent again the way a desk reply would go now: plain text if the chat is open, otherwise
            through an approved template. Retried messages are marked as resent so they are never sent twice.
          </p>

          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {items.map(i => (
              <li key={i.id} className="flex items-start gap-3 px-3 py-2">
                <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${i.skip ? 'text-slate-300' : 'text-rose-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[12px]">
                    <span className="font-semibold text-slate-800">+{i.phone}</span>
                    {!i.bookingRef.startsWith('UNKNOWN:') && <span className="text-blue-600">{i.bookingRef}</span>}
                    <span className="rounded bg-slate-100 px-1.5 text-[10.5px] font-semibold text-slate-600">{i.tag}</span>
                    <span className="text-slate-400">{fmtTime(i.createdAt)}</span>
                  </p>
                  <p className="truncate text-[12px] text-slate-500">{i.preview || '—'}</p>
                  {i.reason && <p className="text-[11px] text-rose-500">{i.reason}</p>}
                  {i.skip && <p className="text-[11px] font-semibold text-amber-700">Skipped: {i.skip}</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2">
      <p className={`text-xl font-extrabold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
    </div>
  )
}

// ── Message-count report ─────────────────────────────────────────────────────

interface CountRow {
  sent: number
  delivered: number
  read: number
  failed: number
  retried: number
  pending: number
  received: number
}

interface MessageReport {
  from: string
  to: string
  totals: CountRow & { chats: number; chatsMessaged: number; chatsReplied: number }
  byDay: (CountRow & { date: string })[]
  byKind: (CountRow & { kind: string })[]
  failures: { code: number | null; reason: string; count: number }[]
}

type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function presetRange(p: Preset): [string, string] {
  const today = localMidnight()
  switch (p) {
    case 'yesterday': return [ymd(localMidnight(1)), ymd(localMidnight(1))]
    case '7d':        return [ymd(localMidnight(6)), ymd(today)]
    case '30d':       return [ymd(localMidnight(29)), ymd(today)]
    case 'month':     return [ymd(new Date(today.getFullYear(), today.getMonth(), 1)), ymd(today)]
    default:          return [ymd(today), ymd(today)]
  }
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—')

export function MessageReportModal({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>('today')
  const [range, setRange] = useState<[string, string]>(() => presetRange('today'))
  const [report, setReport] = useState<MessageReport | null>(null)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async (from: string, to: string) => {
    if (!from || !to || to < from) { toast.error('Pick a start date on or before the end date'); return }
    setLoading(true)
    try {
      const qs = new URLSearchParams({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to:   new Date(`${to}T23:59:59.999`).toISOString(),
        tz:   String(new Date().getTimezoneOffset()),
      })
      const res = await fetch(`/api/whatsapp/report?${qs}`).then(r => r.json())
      if (!res.success) throw new Error(res.error || 'Could not build the report')
      setReport(res.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not build the report')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { generate(...presetRange('today')) }, [generate])

  const pick = (p: Preset) => {
    setPreset(p)
    if (p === 'custom') return
    const r = presetRange(p)
    setRange(r)
    generate(...r)
  }

  const exportCsv = () => {
    if (!report) return
    const cols = ['Sent', 'Delivered', 'Read', 'Failed', 'Resent', 'Pending', 'Received']
    const vals = (c: CountRow) => [c.sent, c.delivered, c.read, c.failed, c.retried, c.pending, c.received]
    const esc = (v: string | number) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)
    const lines = [
      `WhatsApp message report,${range[0]} to ${range[1]}`,
      '',
      ['Total', ...cols, 'Chats', 'Chats messaged', 'Chats replied'].join(','),
      ['All', ...vals(report.totals), report.totals.chats, report.totals.chatsMessaged, report.totals.chatsReplied].join(','),
      '',
      ['Date', ...cols].join(','),
      ...report.byDay.map(d => [d.date, ...vals(d)].join(',')),
      '',
      ['Kind', ...cols].join(','),
      ...report.byKind.map(k => [esc(k.kind), ...vals(k)].join(',')),
      '',
      'Failure code,Count,Reason',
      ...report.failures.map(f => [f.code ?? 'unknown', f.count, esc(f.reason)].join(',')),
    ]
    downloadText(`whatsapp-report-${range[0]}_${range[1]}.csv`, lines.join('\n'))
  }

  const t = report?.totals

  return (
    <Modal
      title="Message count report"
      icon={<BarChart3 className="h-4 w-4" />}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className={btnGhost}>Close</button>
        <motion.button whileTap={{ scale: 0.96 }} onClick={exportCsv} disabled={!report || loading} className={btnPrimary}>
          <Download className="h-4 w-4" /> Download CSV
        </motion.button>
      </>}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => pick(p.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
              preset === p.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
          <input type="date" value={range[0]} max={range[1]} onChange={e => setRange([e.target.value, range[1]])} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2" />
          to
          <input type="date" value={range[1]} min={range[0]} onChange={e => setRange([range[0], e.target.value])} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2" />
          <button onClick={() => generate(...range)} disabled={loading} className={btnPrimary}>Generate</button>
        </div>
      )}

      {loading && !report ? (
        <div className="grid place-items-center py-12 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : report && t ? (
        <div className={loading ? 'opacity-50 transition' : 'transition'}>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Sent" value={t.sent} />
            <Stat label={`Delivered · ${pct(t.delivered, t.sent)}`} value={t.delivered} tone="text-emerald-600" />
            <Stat label={`Read · ${pct(t.read, t.sent)}`} value={t.read} tone="text-sky-600" />
            <Stat label={`Failed · ${pct(t.failed, t.sent)}`} value={t.failed} tone="text-rose-600" />
            <Stat label="Received" value={t.received} />
            <Stat label="Chats" value={t.chats} />
            <Stat label="Chats we messaged" value={t.chatsMessaged} />
            <Stat label="Chats that replied" value={t.chatsReplied} />
          </div>
          {(t.retried > 0 || t.pending > 0) && (
            <p className="mt-2 text-[11.5px] text-slate-500">
              {t.retried > 0 && <>{t.retried} failed then resent. </>}
              {t.pending > 0 && <>{t.pending} still waiting for a WhatsApp receipt or queued.</>}
            </p>
          )}

          <CountTable title="By kind" firstCol="Kind" rows={report.byKind.map(k => ({ key: k.kind, ...k }))} />
          <CountTable title="By day" firstCol="Date" rows={report.byDay.map(d => ({ key: d.date, ...d }))} />

          {report.failures.length > 0 && (
            <>
              <p className="mt-5 text-[12px] font-bold uppercase tracking-wide text-slate-400">Why messages failed</p>
              <ul className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {report.failures.map(f => (
                  <li key={f.code ?? 'unknown'} className="flex items-start gap-3 px-3 py-2 text-[12px]">
                    <span className="w-10 shrink-0 text-right font-bold tabular-nums text-rose-600">{f.count}</span>
                    <span className="text-slate-600">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

function CountTable({ title, firstCol, rows }: { title: string; firstCol: string; rows: (CountRow & { key: string })[] }) {
  if (rows.length === 0) return null
  return (
    <>
      <p className="mt-5 text-[12px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-1.5 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="bg-slate-50 text-[11px] text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">{firstCol}</th>
              {['Sent', 'Delivered', 'Read', 'Failed', 'Received'].map(h => (
                <th key={h} className="px-3 py-1.5 text-right font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.key}>
                <td className="px-3 py-1.5 font-medium text-slate-700">{r.key}</td>
                <td className="px-3 py-1.5 text-right">{r.sent || '—'}</td>
                <td className="px-3 py-1.5 text-right text-emerald-700">{r.delivered || '—'}</td>
                <td className="px-3 py-1.5 text-right text-sky-700">{r.read || '—'}</td>
                <td className={`px-3 py-1.5 text-right ${r.failed ? 'font-bold text-rose-600' : ''}`}>{r.failed || '—'}</td>
                <td className="px-3 py-1.5 text-right">{r.received || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
