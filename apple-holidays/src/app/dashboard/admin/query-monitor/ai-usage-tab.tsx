'use client'

/**
 * OpenAI spend for the Query Monitor — hourly, daily, weekly, monthly.
 *
 * Two charts, one axis each: dollars, then the tokens that produced them. They
 * are deliberately not combined — a USD figure and a token count share no scale,
 * and putting them on two y-axes makes the crossing point look like a fact.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  BrainCircuit, CalendarDays, CalendarRange, Clock, DollarSign, Loader2,
  RefreshCw, Table2, TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState, Stat } from './ui'

type Scope = 'qm' | 'all'
type Grain = 'hourly' | 'daily' | 'weekly' | 'monthly'

interface Bucket {
  key:              string
  label:            string
  periodLabel:      string
  calls:            number
  promptTokens:     number
  completionTokens: number
  totalTokens:      number
  costUsd:          number
}

interface Totals {
  calls: number; promptTokens: number; completionTokens: number
  totalTokens: number; costUsd: number
}

interface ByType {
  callType: string; label: string; model: string
  calls: number; totalTokens: number; costUsd: number
}

interface Stats {
  scope:       Scope
  timezone:    string
  generatedAt: string
  windows:     Record<Grain, number>
  totals:      { hour: Totals; today: Totals; week: Totals; month: Totals; allTime: Totals }
  series:      Record<Grain, Bucket[]>
  byCallType:  ByType[]
}

/** Validated for CVD separation against the light chart surface. */
const COST_COLOR       = '#059669'
const PROMPT_COLOR     = '#7c3aed'
const COMPLETION_COLOR = '#0ea5e9'

const GRAINS: { id: Grain; label: string; window: (s: Stats) => string }[] = [
  { id: 'hourly',  label: 'Hourly',  window: s => `last ${s.windows.hourly} hours` },
  { id: 'daily',   label: 'Daily',   window: s => `last ${s.windows.daily} days` },
  { id: 'weekly',  label: 'Weekly',  window: s => `last ${s.windows.weekly} weeks` },
  { id: 'monthly', label: 'Monthly', window: s => `last ${s.windows.monthly} months` },
]

function usd(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function ChartTooltip({ active, payload, moneyOnly }: {
  active?: boolean
  payload?: { payload: Bucket }[]
  moneyOnly?: boolean
}) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-semibold text-slate-800">{b.periodLabel}</p>
      {moneyOnly ? (
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="font-semibold text-emerald-700">{usd(b.costUsd)}</span>
          {' · '}{tokens(b.totalTokens)} tokens · {b.calls} call{b.calls === 1 ? '' : 's'}
        </p>
      ) : (
        <div className="text-xs text-slate-500 mt-0.5 space-y-0.5">
          <p><span className="font-semibold text-violet-700">{tokens(b.promptTokens)}</span> prompt</p>
          <p><span className="font-semibold text-sky-600">{tokens(b.completionTokens)}</span> completion</p>
          <p className="text-slate-400">{tokens(b.totalTokens)} total · {usd(b.costUsd)}</p>
        </div>
      )}
    </div>
  )
}

export default function AiUsageTab({ refreshKey }: { refreshKey: number }) {
  const [scope, setScope]     = useState<Scope>('qm')
  const [grain, setGrain]     = useState<Grain>('daily')
  const [stats, setStats]     = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [showTable, setShowTable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/query-monitor/ai-usage?scope=${scope}`)
      const d   = await res.json()
      if (!d.success) { toast.error(d.error); setStats(null); return }
      setStats(d.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read AI usage')
    } finally { setLoading(false) }
  }, [scope])

  useEffect(() => { void load() }, [load, refreshKey])

  async function exportToSheet() {
    setExporting(true)
    try {
      const res = await fetch(`/api/query-monitor/ai-usage?scope=${scope}`, { method: 'POST' })
      const d   = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(d.message ?? 'Usage tab rewritten')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not write the usage tab')
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
        icon={<BrainCircuit className="w-6 h-6" />}
        title="No AI usage to show"
        hint="Every GPT call the system makes is logged with its token counts and cost. Nothing has been recorded yet."
      />
    )
  }

  const buckets = stats.series[grain]
  const spent   = buckets.reduce((sum, b) => sum + b.costUsd, 0)
  const maxType = Math.max(...stats.byCallType.map(t => t.costUsd), 0.000001)
  const grainMeta = GRAINS.find(g => g.id === grain)!

  return (
    <div className="mt-6 space-y-6">

      {/* ── Scope + export ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {([['qm', 'Query Monitor'], ['all', 'All AI in the system']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setScope(id)}
              className={cn(
                'px-3 py-1.5 text-sm font-semibold transition-colors',
                scope === id ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-400">
          Buckets cut on {stats.timezone} · all figures are OpenAI&rsquo;s billed token cost
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
            title="Rewrite the workbook's AI Usage tab with these figures and live Excel charts"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Table2 className="w-4 h-4" />}
            Write usage sheet
          </button>
        </div>
      </div>

      {/* ── The four grains as single numbers ────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          ['This hour',  stats.totals.hour,  <Clock key="h" className="w-5 h-5" />,        'amber'],
          ['Today',      stats.totals.today, <CalendarDays key="d" className="w-5 h-5" />, 'emerald'],
          ['This week',  stats.totals.week,  <CalendarRange key="w" className="w-5 h-5" />, 'sky'],
          ['This month', stats.totals.month, <TrendingUp key="m" className="w-5 h-5" />,   'violet'],
        ] as const).map(([label, t, icon, tone]) => (
          <Stat
            key={label}
            icon={icon}
            tone={tone}
            label={label}
            value={usd(t.costUsd)}
            hint={`${tokens(t.totalTokens)} tokens · ${t.calls} call${t.calls === 1 ? '' : 's'}`}
          />
        ))}
      </div>

      {/* ── Grain selector ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {GRAINS.map(g => (
          <button
            key={g.id}
            onClick={() => setGrain(g.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors',
              grain === g.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
            )}
          >
            {g.label}
          </button>
        ))}
        <span className="text-xs text-slate-400">
          {grainMeta.window(stats)} · <span className="font-semibold text-emerald-700">{usd(spent)}</span> in the window
        </span>
        <button
          onClick={() => setShowTable(v => !v)}
          className="ml-auto text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          {showTable ? 'Hide figures' : 'Show figures'}
        </button>
      </div>

      {/* ── Spend ───────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <DollarSign className="w-4 h-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Spend, {grainMeta.label.toLowerCase()} — USD
          </h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                width={62} tickFormatter={(v: number) => usd(v)}
              />
              <Tooltip content={<ChartTooltip moneyOnly />} cursor={{ fill: '#f8fafc' }} />
              <Bar dataKey="costUsd" fill={COST_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── Tokens ──────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2 mb-3">
          <BrainCircuit className="w-4 h-4 text-violet-600" />
          <h3 className="text-sm font-semibold text-slate-800">
            Tokens, {grainMeta.label.toLowerCase()} — prompt and completion
          </h3>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                width={52} tickFormatter={(v: number) => tokens(v)}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
              <Legend
                verticalAlign="top" align="right" height={28}
                wrapperStyle={{ fontSize: 12, color: '#64748b' }}
              />
              <Bar dataKey="promptTokens" name="Prompt" stackId="t" fill={PROMPT_COLOR} maxBarSize={28} />
              <Bar dataKey="completionTokens" name="Completion" stackId="t" fill={COMPLETION_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* ── The same numbers as text ────────────────────────────────── */}
      {showTable && (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto max-h-80">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-semibold">Period</th>
                  <th className="px-3 py-2 font-semibold text-right">Cost (USD)</th>
                  <th className="px-3 py-2 font-semibold text-right">Calls</th>
                  <th className="px-3 py-2 font-semibold text-right">Prompt</th>
                  <th className="px-3 py-2 font-semibold text-right">Completion</th>
                  <th className="px-3 py-2 font-semibold text-right">Total tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...buckets].reverse().map(b => (
                  <tr key={b.key} className={cn(b.calls === 0 && 'text-slate-300')}>
                    <td className="px-3 py-1.5 text-slate-700">{b.periodLabel}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-emerald-700">{usd(b.costUsd)}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{b.calls}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{b.promptTokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{b.completionTokens.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right text-slate-700">{b.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── What the money went on ──────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">
          By call type — last {stats.windows.daily} days
        </h3>
        {stats.byCallType.length === 0 ? (
          <p className="text-sm text-slate-400 py-4">No AI calls in the window.</p>
        ) : (
          <div className="space-y-2.5">
            {stats.byCallType.map(t => (
              <div key={`${t.callType}-${t.model}`}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-700 font-medium truncate">
                    {t.label}
                    <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500">
                      {t.model}
                    </span>
                  </span>
                  <span className="flex-shrink-0 text-slate-400 text-xs">
                    {t.calls} calls · {tokens(t.totalTokens)} tokens
                    <span className="ml-2 font-semibold text-emerald-700 text-sm">{usd(t.costUsd)}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, (t.costUsd / maxType) * 100)}%`, background: COST_COLOR }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-slate-400">
        All time: <span className="font-semibold text-slate-600">{usd(stats.totals.allTime.costUsd)}</span> across{' '}
        {stats.totals.allTime.calls.toLocaleString()} calls and{' '}
        {tokens(stats.totals.allTime.totalTokens)} tokens.
      </p>
    </div>
  )
}
