'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, BrainCircuit, TrendingUp, Zap, DollarSign, RefreshCw, Terminal, ChevronDown, ChevronUp, Activity } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'

interface Summary {
  tokens: number
  cost: number
  calls: number
}

interface ByTypeRow {
  callType: string
  label: string
  model: string
  calls: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  cost: number
}

interface DailyRow {
  date: string
  tokens: number
  cost: number
  calls: number
}

interface RecentRow {
  id: string
  callType: string
  label: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  bookingRef: string | null
  source: string | null
  createdAt: string
}

interface UsageData {
  summary: { today: Summary; week: Summary; month: Summary }
  byType: ByTypeRow[]
  daily: DailyRow[]
  recent: RecentRow[]
}

const MODEL_COLORS: Record<string, string> = {
  'gpt-4o':      'bg-purple-100 text-purple-700 border-purple-200',
  'gpt-4o-mini': 'bg-blue-100 text-blue-700 border-blue-200',
}

const SOURCE_COLORS: Record<string, string> = {
  email:    'bg-emerald-100 text-emerald-700',
  onedrive: 'bg-sky-100 text-sky-700',
  manual:   'bg-amber-100 text-amber-700',
  pnl:      'bg-indigo-100 text-indigo-700',
  upload:   'bg-orange-100 text-orange-700',
}

const CALL_TYPE_COLORS: Record<string, string> = {
  agenda_generation:  'text-purple-600',
  booking_extraction: 'text-blue-600',
  pnl_extraction:     'text-orange-600',
  pnl_classify:       'text-indigo-600',
  ticket_details:     'text-teal-600',
  ai_suggestion:      'text-green-600',
  other:              'text-slate-500',
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtCost(n: number) {
  return `$${n.toFixed(4)}`
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000)  return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function MiniBar({ value, max, color = 'bg-purple-400' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function AiUsageMonitor() {
  const [data, setData]       = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [showRecent, setShowRecent] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/admin/ai-usage')
      .then(r => r.json())
      .then(j => { if (j.success) setData(j.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
      </div>
    )
  }

  if (!data) return null

  const { summary, byType, daily, recent } = data
  const maxDailyTokens = Math.max(...daily.map(d => d.tokens), 1)
  const maxTypeTokens  = Math.max(...byType.map(t => t.totalTokens), 1)
  const visibleRecent  = showAll ? recent : recent.slice(0, 10)

  return (
    <div className="space-y-5">

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Today', data: summary.today,  icon: <Zap className="w-4 h-4 text-amber-500" />,   bg: 'from-amber-50 to-yellow-50',  border: 'border-amber-100' },
          { label: '7 Days', data: summary.week,   icon: <Activity className="w-4 h-4 text-purple-500" />, bg: 'from-purple-50 to-violet-50', border: 'border-purple-100' },
          { label: '30 Days', data: summary.month, icon: <TrendingUp className="w-4 h-4 text-blue-500" />, bg: 'from-blue-50 to-sky-50',     border: 'border-blue-100'   },
        ].map(({ label, data: d, icon, bg, border }) => (
          <div key={label} className={`rounded-xl border ${border} bg-gradient-to-br ${bg} p-3`}>
            <div className="flex items-center gap-1.5 mb-2">
              {icon}
              <span className="text-xs font-semibold text-slate-600">{label}</span>
            </div>
            <p className="text-lg font-bold text-slate-800">{fmt(d.tokens)}</p>
            <p className="text-xs text-slate-500">tokens · {d.calls} calls</p>
            <p className="text-xs font-semibold text-emerald-600 mt-0.5 flex items-center gap-0.5">
              <DollarSign className="w-3 h-3" />{d.cost.toFixed(4)}
            </p>
          </div>
        ))}
      </div>

      {/* Daily Bar Chart */}
      {daily.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Last 14 Days</p>
          <div className="flex items-end gap-1 h-16">
            {daily.slice(-14).map(d => {
              const h = maxDailyTokens > 0 ? Math.max(4, (d.tokens / maxDailyTokens) * 100) : 4
              const label = new Date(d.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })
              return (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div
                    className="w-full rounded-sm bg-purple-400 group-hover:bg-purple-500 transition-colors cursor-default"
                    style={{ height: `${h}%` }}
                  />
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-slate-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {label} · {fmt(d.tokens)} tokens · {fmtCost(d.cost)}
                    </div>
                    <div className="w-1.5 h-1.5 bg-slate-800 rotate-45 -mt-0.5" />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-xs text-slate-400">{daily.slice(-14)[0]?.date?.slice(5)}</span>
            <span className="text-xs text-slate-400">Today</span>
          </div>
        </div>
      )}

      {/* By Call Type */}
      {byType.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Breakdown by Type (30 days)</p>
          <div className="space-y-2">
            {byType.map(row => (
              <div key={`${row.callType}-${row.model}`} className="bg-slate-50 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${CALL_TYPE_COLORS[row.callType] ?? 'text-slate-600'}`}>
                      {row.label}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${MODEL_COLORS[row.model] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                      {row.model}
                    </span>
                    <span className="text-xs text-slate-400">{row.calls} calls</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-slate-700">{fmt(row.totalTokens)}</span>
                    <span className="text-xs text-emerald-600 ml-2 font-medium">{fmtCost(row.cost)}</span>
                  </div>
                </div>
                <MiniBar value={row.totalTokens} max={maxTypeTokens} color={
                  row.callType === 'agenda_generation'  ? 'bg-purple-400' :
                  row.callType === 'booking_extraction' ? 'bg-blue-400'   :
                  row.callType === 'pnl_extraction'     ? 'bg-orange-400' :
                  row.callType === 'pnl_classify'       ? 'bg-indigo-400' :
                  'bg-teal-400'
                } />
                <div className="flex gap-3 mt-1.5 text-xs text-slate-400">
                  <span>↑ prompt {fmt(row.promptTokens)}</span>
                  <span>↓ completion {fmt(row.completionTokens)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Calls */}
      {recent.length > 0 && (
        <div>
          <button
            onClick={() => setShowRecent(v => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 hover:text-slate-700 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            Recent API Calls
            {showRecent ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
          </button>

          {showRecent && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="bg-slate-900 px-3 py-2 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs text-slate-400 ml-2 font-mono">ai_usage_log — live</span>
              </div>
              <div className="bg-slate-950 font-mono text-xs max-h-64 overflow-y-auto">
                {visibleRecent.map((row, i) => (
                  <div key={row.id} className={`flex items-start gap-2 px-3 py-1.5 border-b border-slate-800 ${i % 2 === 0 ? '' : 'bg-slate-900/30'}`}>
                    <span className="text-slate-600 flex-shrink-0 w-16 text-right">{relativeTime(row.createdAt)}</span>
                    <span className={`flex-shrink-0 ${CALL_TYPE_COLORS[row.callType] ?? 'text-slate-400'}`}>
                      {row.label}
                    </span>
                    <span className="text-slate-500">({row.model})</span>
                    <span className="text-amber-400">↑{fmt(row.promptTokens)}</span>
                    <span className="text-green-400">↓{fmt(row.completionTokens)}</span>
                    <span className="text-slate-400">={fmt(row.totalTokens)}</span>
                    <span className="text-emerald-400 ml-auto flex-shrink-0">{fmtCost(row.cost)}</span>
                    {row.bookingRef && (
                      <span className="text-sky-400 flex-shrink-0">[{row.bookingRef}]</span>
                    )}
                    {row.source && (
                      <span className={`text-xs px-1 rounded flex-shrink-0 ${SOURCE_COLORS[row.source] ?? 'bg-slate-700 text-slate-300'}`}>
                        {row.source}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {recent.length > 10 && (
                <button
                  onClick={() => setShowAll(v => !v)}
                  className="w-full py-2 text-xs text-slate-500 hover:text-slate-700 bg-slate-50 border-t border-slate-200 transition-colors"
                >
                  {showAll ? 'Show less' : `Show all ${recent.length} recent calls`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {recent.length === 0 && (
        <div className="text-center py-8 text-slate-400">
          <BrainCircuit className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No AI calls recorded yet.</p>
          <p className="text-xs mt-1">Usage will appear here once the system makes OpenAI API calls.</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

    </div>
  )
}
