'use client'

/**
 * Daily mail volume per monitored address.
 *
 * The counting unit is a mail *arriving at an address*, not a query: a mail to
 * five handlers is five mails here and one row on the query sheet, and a chaser
 * folded into an existing row still counts. That is the difference between "how
 * much mail did we handle" and "how many queries came in", and the two numbers
 * are shown side by side rather than being reconciled into one.
 *
 * The same figures are what the workbook's "Daily Mail Stats" tab carries.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  CheckCircle2, Clock, Inbox, Loader2, Mails, RefreshCw, Table2, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState, Stat } from './ui'
import type { QmDailyStats } from './types'

/** Two series, one job each: mail that was a query, and mail that was not.
 *  Validated for CVD separation against the light chart surface. */
const USEFUL_COLOR = '#059669'
const OTHER_COLOR  = '#7c3aed'

const WINDOWS = [7, 14, 30, 60, 90]

/** `2026-08-13` → `13 Aug`, which is how the team says dates out loud. */
function shortDay(day: string): string {
  const [, month, date] = day.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(date)} ${months[Number(month) - 1] ?? ''}`
}

function DayTooltip({ active, payload }: {
  active?: boolean
  payload?: { payload: QmDailyStats['daily'][number] }[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-slate-800">{shortDay(d.day)}</p>
      <div className="text-xs text-slate-500 mt-0.5 space-y-0.5">
        <p><span className="font-semibold text-emerald-700">{d.useful}</span> useful (became queries)</p>
        <p><span className="font-semibold text-violet-700">{d.other}</span> other mail</p>
        <p className="text-slate-400">
          {d.total} mails received · {d.queries} distinct quer{d.queries === 1 ? 'y' : 'ies'} · {d.replied} replied
        </p>
      </div>
    </div>
  )
}

export default function DailyMailTab({ refreshKey }: { refreshKey: number }) {
  const [days, setDays]       = useState(30)
  const [stats, setStats]     = useState<QmDailyStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/query-monitor/daily-stats?days=${days}`)
      const d   = await res.json()
      if (!d.success) { toast.error(d.error); setStats(null); return }
      setStats(d.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not count the mail')
    } finally { setLoading(false) }
  }, [days])

  useEffect(() => { void load() }, [load, refreshKey])

  async function exportToSheet() {
    setExporting(true)
    try {
      const res = await fetch(`/api/query-monitor/daily-stats?days=${days}`, { method: 'POST' })
      const d   = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Daily counts written', { duration: 8000 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not write the daily counts tab')
    } finally { setExporting(false) }
  }

  if (loading && !stats) {
    return (
      <div className="py-20 grid place-items-center">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    )
  }

  if (!stats) {
    return (
      <EmptyState
        icon={<Mails className="w-6 h-6" />}
        title="No mail counted yet"
        hint="Counts are built from the mail the sweeps have collected. Run a sweep first."
      />
    )
  }

  // Oldest → newest for the chart; the tables stay newest-first, which is how the
  // team reads them.
  const chartData = [...stats.daily].reverse()
  const today = stats.daily[0]
  const t = stats.totals

  return (
    <div className="mt-6 space-y-6">

      {/* ── Window + export ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {WINDOWS.map(w => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={cn(
                'px-3 py-1.5 text-sm font-semibold transition-colors',
                days === w ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {w}d
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-400">
          Days cut on {stats.timezone} · one mail counted once per address it reached
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void load()} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} /> Refresh
          </button>
          <button
            onClick={exportToSheet} disabled={exporting}
            title="Rewrite the workbook's Daily Mail Stats tab with these counts and live Excel charts"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4" />}
            Write daily sheet
          </button>
        </div>
      </div>

      {/* ── Headline numbers ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          icon={<Inbox className="w-5 h-5" />} tone="sky"
          label="Today" value={today?.total ?? 0}
          hint={`${today?.useful ?? 0} useful · ${today?.other ?? 0} other`}
        />
        <Stat
          icon={<Mails className="w-5 h-5" />} tone="slate"
          label={`Last ${stats.days} days`} value={t.total.toLocaleString()}
          hint={`${t.queries.toLocaleString()} distinct queries behind them`}
        />
        <Stat
          icon={<CheckCircle2 className="w-5 h-5" />} tone="emerald"
          label="Useful mail" value={t.useful.toLocaleString()}
          hint={t.total > 0 ? `${Math.round((t.useful / t.total) * 100)}% of everything received` : '—'}
        />
        <Stat
          icon={<Clock className="w-5 h-5" />} tone={t.awaiting > 0 ? 'amber' : 'emerald'}
          label="Awaiting a reply" value={t.awaiting.toLocaleString()}
          hint={`${t.replied.toLocaleString()} answered`}
        />
      </div>

      {/* ── Per day ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-800">Mail received per day</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-4">
          Stacked: what became a query, and what went to the other-mail tab
        </p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="day" tickFormatter={shortDay}
                tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }}
                interval="preserveStartEnd" minTickGap={16}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40}
                allowDecimals={false}
              />
              <Tooltip content={<DayTooltip />} cursor={{ fill: '#f1f5f9' }} />
              <Legend
                verticalAlign="top" align="right" height={28}
                iconType="circle" wrapperStyle={{ fontSize: 12, color: '#64748b' }}
              />
              {/* A 2px surface gap between the two segments, so the boundary is a
                  shape difference and not only a hue difference. */}
              <Bar dataKey="useful" name="Useful (queries)" stackId="mail" fill={USEFUL_COLOR} stroke="#ffffff" strokeWidth={2} />
              <Bar dataKey="other"  name="Other mail"       stackId="mail" fill={OTHER_COLOR}  stroke="#ffffff" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Per mailbox ──────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-800">Per address — last {stats.days} days</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Mailbox</th>
                <th className="text-right px-4 py-2 font-semibold">Total mails</th>
                <th className="text-right px-4 py-2 font-semibold">Useful</th>
                <th className="text-right px-4 py-2 font-semibold">Other</th>
                <th className="text-right px-4 py-2 font-semibold">Replied</th>
                <th className="text-right px-4 py-2 font-semibold">Awaiting</th>
                <th className="text-right px-4 py-2 font-semibold">Answered by them</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.summary.map(s => (
                <tr key={s.mailboxId} className={cn(!s.isActive && 'opacity-50')}>
                  <td className="px-4 py-2 font-semibold text-slate-700">
                    {s.mailbox}
                    {s.isAlias && (
                      <span
                        className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-600"
                        title="A distribution group — counted from the TO/CC line of the mail its members receive"
                      >
                        group
                      </span>
                    )}
                    {!s.isActive && <span className="ml-2 text-[10px] text-slate-400">off</span>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">{s.total.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{s.useful.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-violet-700">{s.other.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{s.replied.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{s.awaiting.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{s.answeredByThem.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Day by day, all addresses ────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">Day by day</h3>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-semibold">Date</th>
                <th className="text-right px-4 py-2 font-semibold">Total mails</th>
                <th className="text-right px-4 py-2 font-semibold">Useful</th>
                <th className="text-right px-4 py-2 font-semibold">Other</th>
                <th className="text-right px-4 py-2 font-semibold">Distinct queries</th>
                <th className="text-right px-4 py-2 font-semibold">Replied</th>
                <th className="text-right px-4 py-2 font-semibold">Awaiting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.daily.map(d => (
                <tr key={d.day}>
                  <td className="px-4 py-2 font-semibold text-slate-700">{shortDay(d.day)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">{d.total.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{d.useful.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-violet-700">{d.other.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{d.queries.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{d.replied.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">{d.awaiting.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
