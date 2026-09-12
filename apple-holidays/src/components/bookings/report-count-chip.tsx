'use client'

/**
 * The daily report's figure, printed next to the list's own.
 *
 * Somebody filters the list to yesterday's created bookings, reads 70, opens
 * the morning report, reads 72, and has no way to tell which one is wrong. The
 * answer is neither: the list counts what was *filed* here in the day, the
 * report counts the confirmations AppleSystem *raised* that day whenever they
 * were filed. Two honest questions, two answers.
 *
 * So the number is put on the same screen as the one it gets compared against,
 * with the arithmetic that joins them one click away. A gap that is explained
 * on sight is not a discrepancy; a gap discovered a week later, in a meeting,
 * is — which is the whole reason this chip exists.
 *
 * It appears only for a window the report could itself have been cut for: a
 * created-date filter over a bounded range. On an arrival-date filter it says
 * nothing rather than comparing two unrelated things.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScrollText, Loader2, Check, ChevronDown, AlertTriangle, ListFilter, X, Table2, Download } from 'lucide-react'
import { readApiResponse } from '@/lib/utils'
import ReconcileDetailModal from './reconcile-detail-modal'

interface Reconcile {
  from: string
  to: string
  timezone: string
  available: boolean
  error: string | null
  upstream: number
  cancelledUpstream: number
  reportTotal: number
  opsIntake: number
  opsIntakeB2B: number
  enteredLater: number
  earlierConfirmations: number
  missing: number
  sweptAt: string | null
}

export interface ReportCountChipProps {
  /** What the list is currently showing, for the side-by-side. */
  listTotal: number
  /** `today` / `yesterday` from a quick filter, else null. */
  preset: 'today' | 'yesterday' | null
  /** An explicit created-date range, else null. */
  from: string | null
  to: string | null
  /** True when other filters (country, source, search…) narrow the list further. */
  narrowed: boolean
  /**
   * Open the report's own bookings in the list — the number made walkable.
   * Given the window the panel is describing, since that is the one the figure
   * was computed for, not whatever the filters may have moved on to.
   */
  onViewCohort?: (from: string, to: string) => void
  /** True while the list is already showing that cohort, so the button offers the way back. */
  cohortActive?: boolean
}

function fmtDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short',
  })
}

export default function ReportCountChip({
  listTotal, preset, from, to, narrowed, onViewCohort, cohortActive = false,
}: ReportCountChipProps) {
  const [data, setData]       = useState<Reconcile | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed]   = useState<string | null>(null)
  const [open, setOpen]       = useState(false)
  // The rows behind the three lines below — opened in its own window, since the
  // answer to "which ones?" is a table and this panel is a paragraph.
  const [detail, setDetail]   = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const active = !!preset || !!(from && to)

  // The same window the figure was computed for, in the spelling both the
  // detail route and the workbook route parse — so the file somebody downloads
  // cannot be cut for a different day from the number they downloaded it under.
  const windowQuery = preset ? `preset=${preset}` : `from=${from}&to=${to}`

  const load = useCallback(async () => {
    if (!active) { setData(null); return }
    setLoading(true)
    setFailed(null)
    try {
      const params = new URLSearchParams()
      if (preset) params.set('preset', preset)
      else { params.set('from', from!); params.set('to', to!) }

      const res  = await fetch(`/api/bookings/report-count?${params}`)
      const json = await readApiResponse<Reconcile>(res)
      if (!json.success || !json.data) { setFailed(json.error ?? 'Comparison failed'); setData(null); return }
      setData(json.data)
    } catch {
      setFailed('Could not reach the comparison')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [active, preset, from, to])

  useEffect(() => { void load() }, [load])

  // Close the panel on an outside click, like the other menus on this page.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  if (!active) return null

  if (loading && !data) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Checking the daily report…
      </span>
    )
  }

  if (failed || !data) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-400"
        title={failed ?? 'The daily report figure could not be read'}
      >
        <ScrollText className="w-3 h-3" /> Report figure unavailable
      </span>
    )
  }

  // The ledger being unreadable is not a mismatch — the report itself falls back
  // to counting plain intake in that state, so there is nothing to compare.
  if (!data.available) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-400"
        title={data.error ?? 'The accounts ledger could not be read, so the report figure cannot be confirmed'}
      >
        <ScrollText className="w-3 h-3" /> Report figure unavailable
      </span>
    )
  }

  // The report is B2B AppleSystem only, so the honest comparison is against the
  // B2B half of this window's intake — not against a list that may also hold
  // storefront orders and whatever else the user has filtered to.
  const agrees = data.reportTotal === data.opsIntakeB2B && !narrowed
  const delta  = data.reportTotal - data.opsIntakeB2B

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
          agrees
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
            : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
        }`}
        title="What the daily report counts for this window, and how it reconciles with this list"
      >
        <ScrollText className="w-3 h-3" />
        Daily report · {data.reportTotal.toLocaleString()}
        {agrees ? <Check className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-40 w-[22rem] bg-white border border-slate-200 rounded-xl shadow-lg p-4 space-y-3 text-left">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Count check · {data.from === data.to ? fmtDate(data.from) : `${fmtDate(data.from)} → ${fmtDate(data.to)}`}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              The report counts the <strong>{data.upstream}</strong> confirmation
              {data.upstream === 1 ? '' : 's'} Apple System raised in this window
              — whenever they were filed here. This list counts what was filed
              here inside it. They reconcile like this:
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
            <Row label="Filed here in this window (B2B)" value={data.opsIntakeB2B} />
            <Row
              label="Filed here against an earlier confirmation"
              value={-data.earlierConfirmations}
              hint="In this list, not on the report"
            />
            <Row
              label="Confirmed in this window, filed here later"
              value={data.enteredLater}
              hint="On the report, not in this list"
            />
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-b-lg">
              <span className="font-semibold text-slate-700">Daily report</span>
              <span className="font-bold text-slate-900 tabular-nums">{data.reportTotal}</span>
            </div>
          </div>

          {data.missing > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-rose-600">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>
                <strong>{data.missing}</strong> confirmation{data.missing === 1 ? ' is' : 's are'} on
                the report with no booking here at all. That one is worth chasing —
                the rest of this panel is not.
              </span>
            </p>
          )}

          {/* The figure, opened. Everything above explains why the two numbers
              differ; this is what lets somebody go and look, instead of
              rebuilding the report's window out of list filters by hand — which
              cannot be done at all, since half the cohort sits outside it. */}
          {onViewCohort && (
            <button
              onClick={() => { onViewCohort(data.from, data.to); setOpen(false) }}
              className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                cohortActive
                  ? 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  : 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700'
              }`}
              title={
                cohortActive
                  ? 'Go back to the list as you had it filtered'
                  : 'List exactly the bookings this figure counts, whichever day they were filed here'
              }
            >
              {cohortActive
                ? <><X className="w-3.5 h-3.5" /> Stop showing the report’s bookings</>
                : <><ListFilter className="w-3.5 h-3.5" /> View these {data.reportTotal} booking{data.reportTotal === 1 ? '' : 's'}</>}
            </button>
          )}

          {/* The number, and then the names. "View these bookings" re-filters the
              list; these two answer the question the panel raises but cannot
              itself hold — which bookings are on each side, and why. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => { setDetail(true); setOpen(false) }}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              title="Every booking behind every line above, bucketed, with the reason it counts on one side and not the other"
            >
              <Table2 className="w-3.5 h-3.5" /> View reconcile
            </button>
            <a
              href={`/api/bookings/report-count/workbook?${windowQuery}`}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
              title="The same reconciliation as an Excel file — one tab per population, plus two tabs explaining the arithmetic"
            >
              <Download className="w-3.5 h-3.5" /> Excel
            </a>
          </div>

          {onViewCohort && data.missing > 0 && !cohortActive && (
            <p className="text-[10px] text-slate-400 leading-relaxed -mt-1">
              That list can only hold {data.reportTotal} of the {data.upstream} — the {data.missing} with
              no booking here have no row to show.
            </p>
          )}

          <div className="border-t border-slate-100 pt-2.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">This list, as filtered</span>
              <span className="font-bold text-slate-900 tabular-nums">{listTotal.toLocaleString()}</span>
            </div>
            {narrowed && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your list also has other filters set, and the report figure is
                always the whole window across every country — so these two are
                not expected to match while those are on.
              </p>
            )}
            {!narrowed && listTotal !== data.opsIntake && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                The list total counts every channel; the report is B2B only
                ({data.opsIntake - data.opsIntakeB2B} storefront order
                {data.opsIntake - data.opsIntakeB2B === 1 ? '' : 's'} in this window).
              </p>
            )}
            {!narrowed && delta !== 0 && (
              <p className="text-[11px] text-slate-400 leading-relaxed">
                The {Math.abs(delta)}-booking difference is the two middle rows
                above, not a missing record.
              </p>
            )}
          </div>

          <p className="text-[10px] text-slate-300">
            Days are {data.timezone} business days, the same ones the report is cut for.
            {data.sweptAt && ` Ledger last swept ${new Date(data.sweptAt).toLocaleString('en-GB')}.`}
          </p>
        </div>
      )}

      {detail && (
        <ReconcileDetailModal
          preset={preset}
          from={from}
          to={to}
          onClose={() => setDetail(false)}
        />
      )}
    </div>
  )
}

function Row({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 gap-3">
      <span className="text-slate-600 leading-tight">
        {label}
        {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
      </span>
      <span className={`font-semibold tabular-nums shrink-0 ${
        value < 0 ? 'text-rose-500' : value > 0 ? 'text-emerald-600' : 'text-slate-400'
      }`}>
        {value > 0 ? '+' : ''}{value}
      </span>
    </div>
  )
}
