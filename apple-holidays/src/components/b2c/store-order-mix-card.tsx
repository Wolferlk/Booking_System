'use client'

/**
 * Store order mix — a month of Aahaas store orders, on the AahaasFlow boards.
 *
 * The same figures the Monthly Business Review prints (`collectStoreOrderMix`),
 * counted by the date the order was booked in the store, split by Flow's own
 * B2B / B2C and package / flight rule. Read-only.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Briefcase, LayoutGrid, Loader2, Plane, RefreshCw, ShoppingBag } from 'lucide-react'

interface BoardRow { board: string; label: string; orders: number; previous: number | null; filedInOps: number }
interface Mix {
  available: boolean
  error: string | null
  fromDate: string
  toDate: string
  all: number
  previousAll: number | null
  b2bPackages: number
  b2bFlights: number
  b2c: number
  previousB2bPackages: number | null
  previousB2bFlights: number | null
  previousB2c: number | null
  boards: BoardRow[]
  cancelled: number
  tests: { checked: boolean; orders: number }
  notInOps: number
  truncated: boolean
}
interface Payload { month: string; partial: boolean; previousRange: { fromDate: string; toDate: string }; mix: Mix }

/** The current month in Asia/Colombo, which the store's booked dates are in. */
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7)

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return d.toISOString().slice(0, 7)
}

function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function Delta({ now, prev }: { now: number; prev: number | null }) {
  if (prev === null) return <span className="text-xs text-slate-400">no baseline</span>
  const d = now - prev
  if (d === 0) return <span className="text-xs text-slate-500">level · prev {prev}</span>
  const pct = prev > 0 ? ` (${d > 0 ? '+' : ''}${Math.round((d / prev) * 100)}%)` : ''
  return (
    <span className={`text-xs font-semibold ${d > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d)}{pct} <span className="font-normal text-slate-400">prev {prev}</span>
    </span>
  )
}

export default function StoreOrderMixCard() {
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/b2c/store-mix?month=${month}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || json.message || 'Could not load the store order mix')
      setData(json.data)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => { load() }, [load])

  const m = data?.mix
  const tiles = m
    ? [
      { label: 'All orders', value: m.all, prev: m.previousAll, icon: LayoutGrid, tone: 'text-slate-900', ring: 'border-slate-200' },
      { label: 'B2B Packages', value: m.b2bPackages, prev: m.previousB2bPackages, icon: Briefcase, tone: 'text-sky-700', ring: 'border-sky-200' },
      { label: 'B2B Flights', value: m.b2bFlights, prev: m.previousB2bFlights, icon: Plane, tone: 'text-sky-700', ring: 'border-sky-200' },
      { label: 'B2C', value: m.b2c, prev: m.previousB2c, icon: ShoppingBag, tone: 'text-fuchsia-700', ring: 'border-fuchsia-200' },
    ]
    : []

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Store order mix</h2>
          <p className="text-xs text-slate-500">
            Aahaas store orders booked in the month, split as AahaasFlow shows them
            {data?.partial ? ` · month to date, against ${data.previousRange.fromDate} → ${data.previousRange.toDate}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonth(x => shiftMonth(x, -1))} className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50" aria-label="Previous month">‹</button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium text-slate-800">{monthName(month)}</span>
          <button onClick={() => setMonth(x => shiftMonth(x, 1))} disabled={month >= thisMonth()} className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40" aria-label="Next month">›</button>
          <button onClick={load} disabled={loading} className="ml-1 rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50" aria-label="Refresh">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {m && !m.available && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {m.error ?? 'The Aahaas store could not be read.'}
        </div>
      )}

      {m?.available && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(t => (
              <div key={t.label} className={`rounded-xl border ${t.ring} bg-slate-50/60 p-3`}>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                </div>
                <div className={`mt-1 text-2xl font-bold ${t.tone}`}>{t.value.toLocaleString('en-US')}</div>
                <Delta now={t.value} prev={t.prev} />
              </div>
            ))}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="py-2 font-semibold">Board</th>
                  <th className="py-2 text-right font-semibold">Orders</th>
                  <th className="py-2 text-right font-semibold">Prev</th>
                  <th className="py-2 text-right font-semibold">In OPS</th>
                </tr>
              </thead>
              <tbody>
                {m.boards.map(r => (
                  <tr key={r.board} className="border-b border-slate-100 last:border-0">
                    <td className={`py-2 font-medium ${r.board === 'cancelled' ? 'text-red-600' : r.board.startsWith('b2c') ? 'text-fuchsia-700' : 'text-sky-700'}`}>{r.label}</td>
                    <td className="py-2 text-right font-semibold text-slate-900">{r.orders}</td>
                    <td className="py-2 text-right text-slate-500">{r.previous ?? '—'}</td>
                    <td className="py-2 text-right text-slate-600">{r.board === 'cancelled' ? '—' : r.filedInOps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Counted by booked date, travel orders only, all markets. Cancelled orders (every product cancelled or refunded) are not in the tiles.
            {m.tests.orders ? ` ${m.tests.orders} test order${m.tests.orders === 1 ? '' : 's'} left out.` : ''}
            {!m.tests.checked ? ' The test-order register could not be read, so test orders may be counted.' : ''}
            {m.notInOps ? ` ${m.notInOps} live order${m.notInOps === 1 ? ' is' : 's are'} not filed in OPS yet.` : ''}
            {m.truncated ? ' The month held more orders than one read allows — counts are a floor.' : ''}
          </p>
        </>
      )}
    </div>
  )
}
