'use client'

/**
 * Pre-checking panel for the booking detail page.
 *
 * Shows every hotel stay on this one booking with its D-10 reconfirmation
 * state, so the operator working the booking never has to leave it to chase a
 * property. The standalone queue at /dashboard/precheck is the same data
 * across all bookings.
 */

import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, Loader2, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import StayCard, { type StayEvent } from '@/components/precheck/stay-card'
import HotelResolverModal from '@/components/precheck/hotel-resolver-modal'
import { RECONFIRM_LEAD_DAYS, type PrecheckStay, type QueueStats } from '@/lib/hotel-precheck'

interface PanelData {
  rows: PrecheckStay[]
  stats: QueueStats
  events: Record<string, StayEvent[]>
  generatedAt: string
}

export default function PrecheckPanel({ bookingRef }: { bookingRef: string }) {
  const [data, setData] = useState<PanelData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<PrecheckStay | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/precheck/booking/${encodeURIComponent(bookingRef)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setData(json.data as PanelData)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  // Keep the open resolver modal pointed at the freshly loaded copy of its
  // stay, so a save inside the modal is reflected without closing it.
  useEffect(() => {
    if (!resolving || !data) return
    const fresh = data.rows.find(r => r.stayKey === resolving.stayKey)
    if (fresh && fresh !== resolving) setResolving(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const stats = data?.stats
  const needsAction = (stats?.overdue ?? 0) + (stats?.dueToday ?? 0)

  return (
    <div data-nav="Pre-checking" data-nav-icon="precheck">
      <Card>
        <CardHeader
          action={
            <div className="flex items-center gap-2">
              <Link
                href={`/dashboard/precheck?q=${encodeURIComponent(bookingRef)}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Full queue
              </Link>
              <Button size="sm" variant="ghost" onClick={() => void load()}
                      icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />} />
            </div>
          }
        >
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <ClipboardCheck className="w-4 h-4 text-slate-400" />
            Pre-checking
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
              D-{RECONFIRM_LEAD_DAYS}
            </span>
            {needsAction > 0 && (
              <span className="rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white animate-pulse">
                {needsAction} need{needsAction === 1 ? 's' : ''} action
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Hotel reconfirmation — every stay is checked with the property ten days before check-in.
          </p>
        </CardHeader>

        <CardBody className="space-y-3">
          {/* Progress strip */}
          {stats && stats.total > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[10rem]">
                <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 mb-1">
                  <span>{stats.confirmed} of {stats.total} stays confirmed</span>
                  <span className="tabular-nums">{Math.round((stats.confirmed / stats.total) * 100)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                    style={{ width: `${Math.round((stats.confirmed / stats.total) * 100)}%` }}
                  />
                </div>
              </div>
              {stats.overdue > 0 && <Pill tone="rose">{stats.overdue} overdue</Pill>}
              {stats.dueToday > 0 && <Pill tone="amber">{stats.dueToday} due today</Pill>}
              {stats.issues > 0 && <Pill tone="rose">{stats.issues} issue{stats.issues > 1 ? 's' : ''}</Pill>}
              {stats.unmatched > 0 && <Pill tone="slate">{stats.unmatched} unmatched</Pill>}
              {stats.noContact > 0 && <Pill tone="rose">{stats.noContact} no contact</Pill>}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading hotel stays…
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Could not load pre-checking</div>
                <div className="text-rose-600">{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && data?.rows.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">
              No hotel stays on this booking.
            </p>
          )}

          {data?.rows.map(stay => (
            <StayCard
              key={stay.stayKey}
              stay={stay}
              events={data.events[stay.stayKey]}
              onChanged={load}
              onResolveHotel={setResolving}
              defaultOpen={data.rows.length === 1 && stay.actionable}
            />
          ))}
        </CardBody>
      </Card>

      {resolving && (
        <HotelResolverModal
          open
          stay={resolving}
          onClose={() => setResolving(null)}
          onSaved={load}
        />
      )}
    </div>
  )
}

function Pill({ children, tone }: { children: React.ReactNode; tone: 'rose' | 'amber' | 'slate' }) {
  return (
    <span className={cn(
      'rounded-md px-2 py-0.5 text-[10px] font-bold',
      tone === 'rose'  ? 'bg-rose-50 text-rose-600 border border-rose-200' :
      tone === 'amber' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                         'bg-slate-100 text-slate-500 border border-slate-200',
    )}>
      {children}
    </span>
  )
}
