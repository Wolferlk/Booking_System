'use client'

/**
 * Movement chart ↔ late flight details.
 *
 * Shows, above the chart:
 *  • which empty airport meeting times were filled automatically once the
 *    flights arrived, with the derivation ("UL225 lands 1:35 PM + 45 min")
 *    and any driver who was briefed before the time existed;
 *  • empty airport times the flights can time right now, with "Fill now"
 *    (or "Apply to chart" while the chart is being edited, so nothing is
 *    saved behind the editor's back);
 *  • empty airport times still waiting, and what is missing for each.
 *
 * Server side: lib/agenda-flight-time-sync.ts. Only EMPTY times are ever set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plane, Wand2, Clock3, X, Settings2, UserRound, Loader2 } from 'lucide-react'
import { to12h } from '@/lib/clock-time'
import { rowKey } from '@/lib/agenda-flight-time-plan'

interface PanelItem {
  id?: string
  date: string
  fromPoint: string
  toPoint: string
  meetingTime: string
  timeFrom: string
  timeTo: string
}

interface ApiFill {
  itemId: string
  date: string
  fromPoint: string | null
  toPoint: string | null
  kind: 'blank' | 'retime'
  before: string | null
  after: string
  role: 'departure' | 'arrival'
  flightNo: string
  flightTime: string
  bufferLabel: string
  driverName: string | null
  why: string
  timeFrom?: string | null
  timeTo?: string | null
}

interface ApiData {
  reason: string | null
  autoFillEnabled: boolean
  retimeEnabled: boolean
  fills: ApiFill[]
  waiting: Array<{ itemId: string; text: string; reason: string }>
  recent: {
    at: string
    trigger: string
    actor?: string | null
    rows: Array<{
      rowKey: string; date: string; fromPoint: string | null; toPoint: string | null
      kind: 'blank' | 'retime'; after: string; role: 'departure' | 'arrival'
      flightNo: string; flightTime: string; bufferLabel: string; driverName: string | null
    }>
  } | null
  autoRows: Array<{ rowKey: string; time: string }>
}

export interface LocalFill { itemId: string; meetingTime: string; timeFrom?: string | null; timeTo?: string | null }

const route = (a: string | null, b: string | null) => [a, b].filter(Boolean).join(' → ')
const shortDate = (d: string) => {
  const t = new Date(`${d}T00:00:00`)
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}
const why = (r: { role: string; flightNo: string; flightTime: string; bufferLabel: string }) =>
  r.role === 'departure'
    ? `${r.flightNo} departs ${to12h(r.flightTime)} − ${r.bufferLabel}`
    : `${r.flightNo} lands ${to12h(r.flightTime)} + ${r.bufferLabel}`

export default function FlightTimeFillPanel({
  bookingRef, items, isEditing, canEdit, isAdmin, onApplyLocal, onReload, onAutoRows,
}: {
  bookingRef: string
  items: PanelItem[]
  isEditing: boolean
  canEdit: boolean
  isAdmin: boolean
  /** Editing: put the times into the editor's rows; the operator saves. */
  onApplyLocal: (fills: LocalFill[]) => void
  /** Re-read the chart after a server-side fill. */
  onReload: () => void
  /** Rows whose current time was written by the auto-fill — for the row badge. */
  onAutoRows?: (rows: Map<string, string>) => void
}) {
  const [data, setData] = useState<ApiData | null>(null)
  const [busy, setBusy] = useState(false)
  const [hideRecent, setHideRecent] = useState(false)
  const lastRecentAt = useRef<string | null>(null)
  const editingRef = useRef(isEditing)
  editingRef.current = isEditing

  // What the chart on screen says, so a reload / save re-reads the plan.
  const signature = useMemo(
    () => items.map(i => `${i.id ?? ''}|${i.date}|${i.fromPoint}|${i.toPoint}|${i.meetingTime}`).join('\n'),
    [items],
  )

  const fetchPlan = useCallback(async (): Promise<ApiData | null> => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/flight-times`)
      const json = await res.json()
      if (!json.success) return null
      const d = json.data as ApiData
      setData(d)
      onAutoRows?.(new Map((d.autoRows ?? []).map(r => [r.rowKey, r.time])))
      return d
    } catch { return null }
  }, [bookingRef, onAutoRows])

  // Read the plan whenever the chart changes (and is not mid-edit), then once
  // more a few seconds later: a save queues the server's fill ~4 s after it.
  useEffect(() => {
    if (isEditing) return
    let cancelled = false
    void fetchPlan().then(d => { if (d && lastRecentAt.current === null) lastRecentAt.current = d.recent?.at ?? '' })
    const t = setTimeout(async () => {
      if (cancelled) return
      const d = await fetchPlan()
      const at = d?.recent?.at ?? ''
      if (d && lastRecentAt.current !== null && at && at !== lastRecentAt.current && !editingRef.current) {
        lastRecentAt.current = at
        setHideRecent(false)
        onReload()
      }
    }, 7_000)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, isEditing, fetchPlan])

  // Recent auto-fills that the chart still shows (an edit since hides them).
  const recentLive = useMemo(() => {
    if (!data?.recent || hideRecent) return []
    if (Date.now() - Date.parse(data.recent.at) > 14 * 86_400_000) return []
    const now = new Map(items.map(i => [rowKey(i), i.meetingTime]))
    return data.recent.rows.filter(r => now.get(r.rowKey) === r.after)
  }, [data, items, hideRecent])

  // Pending fills whose row is still empty on screen.
  const pending = useMemo(() => {
    if (!data) return []
    const byId = new Map(items.filter(i => i.id).map(i => [i.id as string, i]))
    return data.fills.filter(f => {
      const row = byId.get(f.itemId)
      if (!row) return false
      return f.kind === 'retime' ? row.meetingTime === (f.before ?? '') : !row.meetingTime.trim()
    })
  }, [data, items])

  async function fillNow() {
    if (isEditing) {
      onApplyLocal(pending.map(f => ({
        itemId: f.itemId, meetingTime: f.after,
        ...(f.timeTo !== undefined ? { timeFrom: f.timeFrom ?? null, timeTo: f.timeTo ?? null } : {}),
      })))
      toast.success(`${pending.length} meeting time${pending.length === 1 ? '' : 's'} set on the chart`, { description: 'Save the chart to keep them.' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/agenda/flight-times`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Fill failed')
      const d = json.data as ApiData
      lastRecentAt.current = d.recent?.at ?? lastRecentAt.current
      setHideRecent(false)
      toast.success(json.message || 'Done', {
        description: d.fills.some(f => f.driverName) ? 'A driver was already briefed without this time — resend the brief if needed.' : undefined,
      })
      onReload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fill failed')
    } finally { setBusy(false) }
  }

  if (!data || data.reason === 'no-agenda' || data.reason === 'closed') return null
  const waiting = data.waiting.filter(w => items.some(i => i.id === w.itemId && !i.meetingTime.trim()))
  if (recentLive.length === 0 && pending.length === 0 && waiting.length === 0) return null

  const drivers = Array.from(new Set(recentLive.map(r => r.driverName).filter(Boolean)))
  const needsFlights = waiting.some(w => w.reason === 'no-flight' || w.reason === 'flight-no-time')

  return (
    <div className="mb-3 space-y-2">
      {recentLive.length > 0 && data.recent && (
        <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white px-4 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Plane className="w-4 h-4 text-sky-600 flex-shrink-0" />
            <span className="font-medium text-sky-900">
              {recentLive.length} airport meeting time{recentLive.length === 1 ? '' : 's'} set from flight details
            </span>
            <span className="text-sky-700/80 text-xs">
              {data.recent.trigger === 'manual' ? `by ${data.recent.actor || 'Fill now'}` : 'automatically, after the flights were added'}
              {' · '}{new Date(data.recent.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
            <button type="button" onClick={() => setHideRecent(true)} className="ml-auto text-sky-400 hover:text-sky-700" aria-label="Hide">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-sky-900">
            {recentLive.map(r => (
              <li key={r.rowKey} className="flex flex-wrap gap-x-2">
                <span className="text-sky-600 tabular-nums w-14">{shortDate(r.date)}</span>
                <span className="min-w-0 truncate max-w-[22rem]">{route(r.fromPoint, r.toPoint)}</span>
                <span className="font-semibold tabular-nums">{to12h(r.after)}</span>
                <span className="text-sky-600/80">({why(r)}{r.kind === 'retime' ? ' · re-timed' : ''})</span>
              </li>
            ))}
          </ul>
          {drivers.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[11.5px] text-amber-700">
              <UserRound className="w-3.5 h-3.5" />
              {drivers.join(', ')} {drivers.length === 1 ? 'was' : 'were'} briefed before this time existed. No message was sent, so resend the brief if needed.
            </p>
          )}
        </div>
      )}

      {pending.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span className="font-medium text-amber-900">
              {pending.length} empty airport meeting time{pending.length === 1 ? '' : 's'} can be set from the flights
            </span>
            {isAdmin && (
              <a href="/dashboard/admin/config#setting-airport-pickup" target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] text-amber-700 hover:text-amber-900">
                Airport Pickup Timings <Settings2 className="w-3 h-3" />
              </a>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => void fillNow()}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {isEditing ? 'Apply to chart' : 'Fill now'}
              </button>
            )}
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-amber-900">
            {pending.map(f => (
              <li key={f.itemId} className="flex flex-wrap gap-x-2">
                <span className="text-amber-600 tabular-nums w-14">{shortDate(f.date)}</span>
                <span className="min-w-0 truncate max-w-[22rem]">{route(f.fromPoint, f.toPoint)}</span>
                <span className="font-semibold tabular-nums">→ {to12h(f.after)}</span>
                <span className="text-amber-700/80">({why(f)}{f.kind === 'retime' ? ` · was ${to12h(f.before ?? '')}` : ''})</span>
              </li>
            ))}
          </ul>
          {!data.autoFillEnabled && (
            <p className="mt-1 text-[11px] text-amber-700">Automatic fill is off (Settings → Airport Pickup Timings), so these wait for a click.</p>
          )}
        </div>
      )}

      {waiting.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2 text-[12px] text-slate-600">
          <p className="flex flex-wrap items-center gap-1.5 font-medium text-slate-700">
            <Clock3 className="w-3.5 h-3.5 text-slate-400" />
            {waiting.length} airport meeting time{waiting.length === 1 ? ' is' : 's are'} still empty
            {needsFlights && (
              <>
                <Link href={`/dashboard/bookings/${encodeURIComponent(bookingRef)}`} className="ml-1 text-brand-600 hover:underline font-semibold">
                  Add flights
                </Link>
                {data.autoFillEnabled && <span className="font-normal text-slate-400">· they fill in by themselves once the flights are added</span>}
              </>
            )}
          </p>
          <ul className="mt-1 space-y-0.5">
            {waiting.map(w => <li key={w.itemId} className="truncate">{w.text}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
