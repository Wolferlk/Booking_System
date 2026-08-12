'use client'

/**
 * Pre-checking panel for the booking detail page.
 *
 * Everything that has to be verified with a third party before the guest
 * travels, in two tabs:
 *
 *  - **Hotels** — D-10 reconfirmation of every stay with the property.
 *  - **Drivers** — a driver on every movement, and the automatic daily
 *    WhatsApp briefing actually reaching them.
 *
 * The hotel queue across all bookings lives at /dashboard/precheck.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, BedDouble, Car, ClipboardCheck, ExternalLink, Loader2, RefreshCw,
} from 'lucide-react'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import StayCard, { type StayEvent } from '@/components/precheck/stay-card'
import HotelResolverModal from '@/components/precheck/hotel-resolver-modal'
import DriverPrecheck from '@/components/precheck/driver-precheck'
import { RECONFIRM_LEAD_DAYS, type PrecheckStay, type QueueStats } from '@/lib/precheck-shared'
import type { DriverPrecheckStats } from '@/lib/driver-precheck-shared'

type Tab = 'hotels' | 'drivers'

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
  const [tab, setTab] = useState<Tab>('hotels')
  // Reported up by the Drivers tab so its badge is accurate before it is opened.
  const [driverStats, setDriverStats] = useState<DriverPrecheckStats | null>(null)

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
  const hotelAction = (stats?.overdue ?? 0) + (stats?.dueToday ?? 0)
  const driverAction = (driverStats?.unassigned ?? 0) + (driverStats?.missed ?? 0) + (driverStats?.noPhone ?? 0)
  const needsAction = hotelAction + driverAction

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
            {needsAction > 0 && (
              <span className="rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white animate-pulse">
                {needsAction} need{needsAction === 1 ? 's' : ''} action
              </span>
            )}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Everything to verify with a supplier before the guest travels — hotels reconfirmed,
            drivers assigned and briefed.
          </p>

          {/* Tabs */}
          <div className="mt-3 flex items-center gap-1 border-b border-slate-200">
            <TabButton
              active={tab === 'hotels'} onClick={() => setTab('hotels')}
              icon={BedDouble} label="Hotels"
              badge={hotelAction || null} tone="rose"
              hint={`D-${RECONFIRM_LEAD_DAYS} reconfirmation`}
            />
            <TabButton
              active={tab === 'drivers'} onClick={() => setTab('drivers')}
              icon={Car} label="Drivers"
              badge={driverAction || null} tone="rose"
              hint="Assignment & daily briefing"
            />
          </div>
        </CardHeader>

        <CardBody className={cn('space-y-3', tab !== 'hotels' && 'hidden')}>
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

        {/*
          Kept mounted and hidden rather than unmounted, so the Drivers tab
          holds its loaded data (and its badge count stays live) when the
          operator flicks back to Hotels.
        */}
        <CardBody className={cn(tab !== 'drivers' && 'hidden')}>
          <DriverPrecheck bookingRef={bookingRef} onStats={setDriverStats} />
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

function TabButton({
  active, onClick, icon: Icon, label, badge, tone, hint,
}: {
  active: boolean
  onClick: () => void
  icon: typeof BedDouble
  label: string
  badge: number | null
  tone: 'rose'
  hint: string
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      className={cn(
        'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 -mb-px text-xs font-semibold transition-colors',
        active ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {badge != null && badge > 0 && (
        <span className={cn(
          'rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none',
          tone === 'rose' ? 'bg-rose-500 text-white' : 'bg-slate-200 text-slate-600',
        )}>
          {badge}
        </span>
      )}
    </button>
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
