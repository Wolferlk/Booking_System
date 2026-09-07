'use client'

/**
 * The report panel behind "Report" on Tickets & Vouchers.
 *
 * It reports on *the current filter*, not on everything — the numbers here and
 * the list behind the modal are the same set of tickets, which is the whole
 * point of building both on one server-side filter. The CSV button exports the
 * same set again, row by row.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Download, FileSpreadsheet, Printer, AlertTriangle } from 'lucide-react'
import Modal from '@/components/ui/modal'
import { toast } from 'sonner'

interface Bucket { key: string; count: number; qty: number; cost: number; purchased: number; issued: number }

interface Summary {
  generatedAt: string
  matched: number
  analysed: number
  truncated: boolean
  totals: {
    tickets: number; qty: number; cost: number
    purchased: number; purchasedCost: number
    pendingActivation: number; issued: number; awaitingIssue: number
    awaitingApproval: number; bookings: number
  }
  byCategory: Bucket[]
  byState: Bucket[]
  bySupplier: Bucket[]
  byPortal: Bucket[]
  byAgent: Bucket[]
  byCurrency: Bucket[]
  byArrivalMonth: Bucket[]
}

const CATEGORY_LABEL: Record<string, string> = {
  HOTEL: 'Hotel Voucher', TICKETS: 'Entrance Ticket', CRUISE: 'Cruise Ticket',
  WATER: 'Water Activity', GUIDES: 'Guide Voucher', FLIGHT_TICKETS: 'Flight Ticket',
  TRANSPORT: 'Transfer Voucher', MEALS: 'Meal Voucher', TAX_FEES: 'Tax & Fees',
  OTHER: 'Service Voucher',
}

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const MONTH_LABEL = (key: string) => {
  if (!/^\d{4}-\d{2}$/.test(key)) return key
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function Stat({ label, value, tone = 'slate', sub }: {
  label: string; value: string; tone?: 'slate' | 'emerald' | 'amber' | 'red' | 'indigo'; sub?: string
}) {
  const tones = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    amber:   'bg-amber-50 border-amber-200 text-amber-800',
    red:     'bg-red-50 border-red-200 text-red-800',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-800',
  }
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="text-xl font-bold leading-tight mt-0.5">{value}</p>
      {sub && <p className="text-[10px] opacity-70 mt-0.5">{sub}</p>}
    </div>
  )
}

/**
 * A breakdown table with an inline share bar. The bar is drawn against the
 * biggest row rather than the total, so a long tail stays readable.
 */
function Breakdown({ title, rows, labelOf, empty }: {
  title: string
  rows: Bucket[]
  labelOf?: (key: string) => string
  empty: string
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wide">{title}</h4>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">{empty}</p>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-semibold px-2.5 py-1.5">Name</th>
                <th className="text-right font-semibold px-2.5 py-1.5 w-16">Tickets</th>
                <th className="text-right font-semibold px-2.5 py-1.5 w-14">Qty</th>
                <th className="text-right font-semibold px-2.5 py-1.5 w-20">Bought</th>
                <th className="text-right font-semibold px-2.5 py-1.5 w-24">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="truncate max-w-[180px] text-slate-700" title={r.key}>
                        {labelOf ? labelOf(r.key) : r.key}
                      </span>
                      <span
                        className="h-1.5 rounded-full bg-brand-400/60 shrink-0"
                        style={{ width: `${Math.round((r.count / max) * 56)}px` }}
                      />
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-semibold text-slate-800">{r.count.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-500">{r.qty.toLocaleString()}</td>
                  <td className="px-2.5 py-1.5 text-right text-slate-500">
                    {r.purchased.toLocaleString()}
                    <span className="text-slate-300"> / {r.issued.toLocaleString()} iss.</span>
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono text-slate-700">{money(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function TicketReportModal({
  open, onClose, params, filterSummary,
}: {
  open: boolean
  onClose: () => void
  /** The current filter, already serialised — the report reads exactly this. */
  params: URLSearchParams
  /** Human-readable version of the same filter, printed on the report. */
  filterSummary: string
}) {
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const query = params.toString()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/tickets/report?format=summary&${query}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return
        if (json.success) setData(json.data)
        else setError(json.error ?? 'Could not build the report')
      })
      .catch(() => { if (!cancelled) setError('Could not reach the server') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [open, query])

  const exportCsv = useCallback(async () => {
    setExporting(true)
    try {
      const res = await fetch(`/api/tickets/report?format=csv&${query}`)
      if (!res.ok) {
        // The server refuses an export that is too big rather than truncating.
        const json = await res.json().catch(() => null)
        throw new Error(json?.error ?? 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Tickets-Report-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Report downloaded')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }, [query])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ticket Report"
      size="4xl"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <p className="text-[11px] text-slate-400 truncate">
            {data ? `Generated ${new Date(data.generatedAt).toLocaleString()}` : 'Reporting on the current filter'}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="btn btn-secondary btn-sm">
              <Printer className="w-4 h-4" /> Print
            </button>
            <button onClick={exportCsv} disabled={exporting || !data} className="btn btn-primary btn-sm">
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export CSV
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Filter</p>
          <p className="text-xs text-slate-700">{filterSummary}</p>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-40">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : !data ? null : (
          <>
            {data.truncated && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {data.matched.toLocaleString()} tickets match, and this summary is measured on the
                  first {data.analysed.toLocaleString()}. Narrow the date range for a complete picture.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Stat label="Tickets" value={data.totals.tickets.toLocaleString()}
                sub={`${data.totals.qty.toLocaleString()} units · ${data.totals.bookings.toLocaleString()} bookings`} />
              <Stat label="Total cost" value={money(data.totals.cost)} tone="indigo"
                sub={`${money(data.totals.purchasedCost)} already bought`} />
              <Stat label="Purchased" value={data.totals.purchased.toLocaleString()} tone="emerald"
                sub={`${data.totals.issued.toLocaleString()} have a ticket file`} />
              <Stat label="Awaiting issue" value={data.totals.awaitingIssue.toLocaleString()}
                tone={data.totals.awaitingIssue ? 'red' : 'slate'}
                sub="Bought, but no file uploaded" />
              <Stat label="Pending activation" value={data.totals.pendingActivation.toLocaleString()}
                tone={data.totals.pendingActivation ? 'amber' : 'slate'} />
              <Stat label="With Accounts" value={data.totals.awaitingApproval.toLocaleString()}
                tone={data.totals.awaitingApproval ? 'amber' : 'slate'}
                sub="Approval still unanswered" />
              <Stat label="Bookings covered" value={data.totals.bookings.toLocaleString()} />
              <Stat label="Avg cost / ticket"
                value={money(data.totals.tickets ? data.totals.cost / data.totals.tickets : 0)} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Breakdown title="By category" rows={data.byCategory}
                labelOf={k => CATEGORY_LABEL[k] ?? k} empty="Nothing to break down." />
              <Breakdown title="By state" rows={data.byState} empty="Nothing to break down." />
              <Breakdown title="By arrival month" rows={data.byArrivalMonth}
                labelOf={MONTH_LABEL} empty="No arrival dates in range." />
              <Breakdown title="Top suppliers" rows={data.bySupplier} empty="No suppliers recorded." />
              <Breakdown title="By portal" rows={data.byPortal} empty="No portals recorded." />
              <Breakdown title="Top agents" rows={data.byAgent} empty="No agents recorded." />
            </div>

            {data.byCurrency.length > 1 && (
              <Breakdown title="By currency" rows={data.byCurrency}
                empty="Single currency." />
            )}

            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export CSV writes one row per ticket with every column shown here, ready for Excel.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
