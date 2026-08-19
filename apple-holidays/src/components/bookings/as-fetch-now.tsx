'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { RefreshCw, Radar, ChevronDown, AlertTriangle, CheckCircle2, Settings2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { readApiResponse } from '@/lib/utils'
import { relTime, type WatchCheck, type WatchStatus } from '@/components/as-bookings/watch-shared'

/**
 * "Fetch now" control for the All Bookings header.
 *
 * Doubles as the status light for the live confirmation watch: the dot says
 * whether the automatic watch is running, the label says how long ago
 * AppleSystem was last asked, and the button forces a check right now. A manual
 * fetch works even while the automatic watch is switched off, so this is also
 * the "just go and look" button when someone is waiting on a specific booking.
 */
export default function AsFetchNow({ onImported }: { onImported?: () => void }) {
  const [status, setStatus]   = useState<WatchStatus | null>(null)
  const [fetching, setFetching] = useState(false)
  const [open, setOpen]       = useState(false)
  const [lastResult, setLastResult] = useState<WatchCheck | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const boxRef = useRef<HTMLDivElement>(null)

  // Keep "x ago" honest without hammering the API.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/as-bookings-v2/watch')
      const json = await readApiResponse<WatchStatus>(res)
      if (json.success && json.data) setStatus(json.data)
    } catch {
      /* the pill is ambient — a failed poll must not shout */
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => { void load() }, 60_000)
    return () => clearInterval(id)
  }, [load])

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const fetchNow = useCallback(async () => {
    setFetching(true)
    try {
      const res  = await fetch('/api/as-bookings-v2/watch/run', { method: 'POST' })
      const json = await readApiResponse<{ ran: boolean; check?: WatchCheck; status: WatchStatus }>(res)

      if (!json.success) { toast.error(json.error ?? 'Fetch failed'); return }
      if (json.data?.status) setStatus(json.data.status)
      const check = json.data?.check ?? null
      setLastResult(check)

      if (check?.error) {
        toast.error(`AppleSystem unreachable — ${check.error}`)
        setOpen(true)
      } else if ((check?.created ?? 0) > 0) {
        toast.success(json.message ?? `${check?.created} new booking(s) imported`, {
          description: check?.refs.length ? check.refs.join(', ') : undefined,
        })
        setOpen(true)
        onImported?.()          // refresh the list so the new rows appear
      } else {
        toast.info(json.message ?? 'No new confirmations — everything is already here')
      }
    } catch {
      toast.error('Network error during fetch')
    } finally {
      setFetching(false)
      setNow(Date.now())
    }
  }, [onImported])

  const enabled = !!status?.settings.enabled
  const running = !!status?.running || fetching
  const lastAge = status?.lastCheckAt ? relTime(now - Date.parse(status.lastCheckAt)) : null

  const dot = running ? 'bg-brand-500' : enabled ? 'bg-emerald-500' : 'bg-slate-300'

  return (
    <div className="relative" ref={boxRef}>
      <div className="flex items-stretch rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Status half — opens the detail popover */}
        <button
          onClick={() => setOpen(v => !v)}
          title="AppleSystem confirmation watch"
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            {(enabled || running) && (
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${dot}`} />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
          </span>
          <span className="hidden sm:inline whitespace-nowrap">
            {running ? 'Checking…' : lastAge ? `Synced ${lastAge} ago` : 'Not checked yet'}
          </span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Action half */}
        <button
          onClick={fetchNow}
          disabled={fetching}
          className="flex items-center gap-1.5 border-l border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors active:scale-[0.98] disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${fetching ? 'animate-spin text-brand-500' : 'text-slate-400'}`} />
          <span className="hidden sm:inline">{fetching ? 'Fetching' : 'Fetch Now'}</span>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="flex items-start gap-2.5 px-4 py-3 border-b border-slate-100">
            <Radar className={`w-4 h-4 mt-0.5 shrink-0 ${enabled ? 'text-emerald-500' : 'text-slate-300'}`} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                Live confirmation watch · {enabled ? 'On' : 'Paused'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                {enabled
                  ? `Checks AppleSystem every ${status?.settings.intervalMinutes} min for newly confirmed quotations and creates them here automatically.`
                  : 'Automatic checking is off — use Fetch Now, or switch the watch on in settings.'}
              </p>
            </div>
          </div>

          <dl className="px-4 py-3 space-y-2 text-xs">
            <Row label="Last checked" value={status?.lastCheckAt ? `${lastAge} ago` : 'Never'} />
            <Row
              label="Next check"
              value={enabled && status?.nextCheckAt
                ? (Date.parse(status.nextCheckAt) - now <= 0 ? 'due now' : `in ${relTime(Date.parse(status.nextCheckAt) - now)}`)
                : 'Paused'}
            />
            <Row label="Window swept" value={`${status?.window.from ?? '—'} → ${status?.window.to ?? '—'}`} />
            <Row label="Created recently" value={String(status?.totals.created ?? 0)} />
          </dl>

          {lastResult && (
            <div className={`px-4 py-2.5 border-t text-xs ${
              lastResult.error   ? 'bg-red-50 border-red-100 text-red-700'
              : lastResult.created > 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-800'
                                 : 'bg-slate-50 border-slate-100 text-slate-500'
            }`}>
              <p className="flex items-start gap-1.5 font-medium">
                {lastResult.error
                  ? <><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> {lastResult.error}</>
                  : lastResult.created > 0
                    ? <><CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" /> Imported {lastResult.created} — {lastResult.refs.join(', ')}</>
                    : <><Clock className="w-3.5 h-3.5 mt-px shrink-0" /> Nothing new in the last check</>}
              </p>
            </div>
          )}

          <Link
            href="/dashboard/new-as-booking?tab=watch"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5 text-slate-400" />
            Change check interval &amp; window
          </Link>
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-semibold text-slate-700 tabular-nums text-right truncate">{value}</dd>
    </div>
  )
}
