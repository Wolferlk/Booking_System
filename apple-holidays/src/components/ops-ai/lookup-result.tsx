'use client'

import Link from 'next/link'
import { ChevronRight, Table2 } from 'lucide-react'
import type { BookingRow, OpsLookup } from './types'

function isBookingRows(value: unknown): value is BookingRow[] {
  return Array.isArray(value) && value.every(v => Boolean(v) && typeof (v as BookingRow).bookingRef === 'string')
}

/**
 * Evidence panel for the read-only lookups the agent ran while thinking. Kept
 * deliberately compact — it explains the answer, it is not a data grid.
 */
export default function LookupResult({ lookup, onNavigate }: { lookup: OpsLookup; onNavigate: () => void }) {
  if (lookup.tool === 'search_bookings' && isBookingRows(lookup.result)) {
    if (!lookup.result.length) {
      return <p className="px-1 text-[11.5px] text-slate-500">No bookings matched that search.</p>
    }
    return (
      <div className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/50">
        <div className="flex items-center gap-1.5 border-b border-slate-700/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Table2 className="h-3 w-3" />
          {lookup.result.length} result{lookup.result.length === 1 ? '' : 's'}
        </div>
        <ul className="divide-y divide-slate-800/80">
          {lookup.result.map(row => (
            <li key={row.bookingRef}>
              <Link
                href={`/dashboard/bookings/${row.bookingRef}`}
                onClick={onNavigate}
                className="flex items-center gap-2 px-3 py-2 transition-colors hover:bg-slate-800/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] font-semibold text-brand-300">{row.bookingRef}</span>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-slate-400">
                      {row.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {row.arrivalDate} → {row.departureDate} · {row.pax} pax
                    {row.agent ? ` · ${row.agent}` : ''}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  if (lookup.tool === 'run_sql_query') {
    const data = lookup.result as { columns?: string[]; rows?: Record<string, unknown>[]; truncated?: boolean } | null
    const columns = data?.columns ?? []
    const rows = data?.rows ?? []
    if (!rows.length) {
      return <p className="px-1 text-[11.5px] text-slate-500">{lookup.message}</p>
    }
    const shown = rows.slice(0, 20)
    return (
      <div className="overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/50">
        <div className="flex items-center gap-1.5 border-b border-slate-700/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Table2 className="h-3 w-3" />
          {rows.length} row{rows.length === 1 ? '' : 's'}{data?.truncated ? ' (capped)' : ''}
        </div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-900/90">
              <tr>
                {columns.map(c => (
                  <th key={c} className="whitespace-nowrap px-2.5 py-1.5 text-left font-semibold text-slate-400">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {shown.map((row, i) => (
                <tr key={i} className="hover:bg-slate-800/40">
                  {columns.map(c => (
                    <td key={c} className="max-w-[220px] truncate px-2.5 py-1.5 text-slate-300">
                      {row[c] === null || row[c] === undefined ? '—' : String(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown.length && (
          <p className="border-t border-slate-700/60 px-3 py-1.5 text-[10px] text-slate-500">
            Showing first {shown.length} of {rows.length}.
          </p>
        )}
      </div>
    )
  }

  if (lookup.tool === 'read_booking') {
    const ref = (lookup.result as { bookingRef?: string } | null)?.bookingRef
    return (
      <p className="px-1 text-[11.5px] text-slate-500">
        Read the full record for <span className="font-medium text-slate-400">{ref ?? 'that booking'}</span>.
      </p>
    )
  }

  return <p className="px-1 text-[11.5px] text-slate-500">{lookup.message}</p>
}
