'use client'

/**
 * Driver Pre-checking — the Drivers tab of the Pre-checking panel.
 *
 * The hotel side asks "is the room confirmed?". This asks the two questions
 * that actually strand a guest: **is somebody driving every movement, and did
 * the daily WhatsApp briefing reach them?**
 *
 * One row per movement, laid out as a tour timeline. Each row carries the
 * briefing state, the assigned driver, and a View button that opens the exact
 * message — the one that went out, or a live preview of the one that will.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, BellOff, Car, CheckCircle2, Clock, Eye, Loader2, MapPin,
  MessageCircle, Palmtree, Pencil, Phone, RefreshCw, Send, UserPlus, Users,
  UserX, History,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import DriverAssignModal from './driver-assign-modal'
import MessageViewerModal, { type MessageViewerPayload } from './message-viewer-modal'
import { fmtWhen } from './precheck-ui'
import {
  BRIEFING_META,
  type BriefingState,
  type DriverPrecheckDay,
  type DriverPrecheckStats,
  type DriverPrecheckView,
} from '@/lib/driver-precheck-shared'

/** Colour and icon per briefing state — the visual spine of the whole tab. */
const STATE_STYLE: Record<BriefingState, { chip: string; dot: string; icon: typeof Clock }> = {
  SENT:         { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: CheckCircle2 },
  PENDING:      { chip: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-500',   icon: Clock },
  SCHEDULED:    { chip: 'bg-sky-50 text-sky-700 border-sky-200',             dot: 'bg-sky-400',     icon: Send },
  MISSED:       { chip: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500',    icon: AlertTriangle },
  NO_DRIVER:    { chip: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-400',    icon: UserX },
  NO_PHONE:     { chip: 'bg-orange-50 text-orange-700 border-orange-200',    dot: 'bg-orange-400',  icon: Phone },
  NOT_REQUIRED: { chip: 'bg-slate-100 text-slate-500 border-slate-200',      dot: 'bg-slate-300',   icon: Palmtree },
}

export default function DriverPrecheck({
  bookingRef, onStats,
}: {
  bookingRef: string
  /** Reports the headline counts up, so the parent tab can badge them. */
  onStats?: (stats: DriverPrecheckStats) => void
}) {
  const [data, setData] = useState<DriverPrecheckView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<DriverPrecheckDay | null>(null)
  const [viewing, setViewing] = useState<MessageViewerPayload | null>(null)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/precheck/driver/${encodeURIComponent(bookingRef)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const view = json.data as DriverPrecheckView
      setData(view)
      onStats?.(view.stats)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bookingRef, onStats])

  useEffect(() => { void load() }, [load])

  const stats = data?.stats
  const unassigned = stats?.unassigned ?? 0

  /** Open the viewer on either the delivered message or the live preview. */
  const viewMessage = useCallback((day: DriverPrecheckDay) => {
    const dayLabel = new Date(day.date).toLocaleDateString('en-GB', {
      weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
    })
    const sent = day.sentMessage
    setViewing({
      title: `Daily briefing — Day ${day.dayNo} · ${dayLabel}`,
      body: sent?.body || day.previewMessage,
      // A day stamped as sent whose log row we could not pair is still "sent";
      // only genuinely unsent days are labelled a preview.
      isPreview: !day.sentAt,
      sentAt: sent?.sentAt ?? day.sentAt,
      status: sent?.status ?? null,
      phone: sent?.phone ?? day.driver.phone,
      driverName: day.driver.name,
      previewNote: BRIEFING_META[day.briefing].blurb,
    })
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading driver pre-checking…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <div className="font-semibold">Could not load driver pre-checking</div>
          <div className="text-rose-600">{error}</div>
        </div>
      </div>
    )
  }

  if (!data?.hasAgenda) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 py-10 text-center">
        <Car className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-sm font-semibold text-slate-600">No tour agenda yet</p>
        <p className="text-xs text-slate-400">
          Drivers are assigned per movement — build the agenda first and the days appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="min-w-[11rem] flex-1">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-slate-500">
            <span>{stats!.assigned} of {stats!.driverDays} movements staffed</span>
            <span className="tabular-nums">{stats!.allocation}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                stats!.allocation === 100
                  ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                  : 'bg-gradient-to-r from-amber-400 to-rose-400',
              )}
              style={{ width: `${stats!.allocation}%` }}
            />
          </div>
        </div>

        <Stat icon={Users} label="drivers" value={stats!.driverCount} />
        <Stat icon={CheckCircle2} label="briefed" value={stats!.sent} tone={stats!.sent > 0 ? 'emerald' : undefined} />
        {stats!.pending > 0 && <Stat icon={Clock} label="due today" value={stats!.pending} tone="amber" />}
        {stats!.missed > 0 && <Stat icon={AlertTriangle} label="not sent" value={stats!.missed} tone="rose" />}
        {unassigned > 0 && <Stat icon={UserX} label="no driver" value={unassigned} tone="rose" />}
        {stats!.noPhone > 0 && <Stat icon={Phone} label="no number" value={stats!.noPhone} tone="orange" />}

        <Button size="sm" variant="ghost" onClick={() => void load()}
                icon={<RefreshCw className="w-3.5 h-3.5" />} />
      </div>

      {/* The whole feature depends on one cron switch — say so when it is off. */}
      {!data.autoBriefingEnabled && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <BellOff className="w-4 h-4 flex-shrink-0" />
          <span>
            Automatic driver WhatsApp messaging is switched <strong>off</strong> system-wide.
            Scheduled briefings below will not send until it is re-enabled in Settings.
          </span>
        </div>
      )}

      {/* ── Day timeline ────────────────────────────────────────────────── */}
      <ol className="space-y-2">
        {data.days.map(day => (
          <DayRow
            key={day.agendaItemId}
            day={day}
            onEdit={() => setEditing(day)}
            onView={() => viewMessage(day)}
          />
        ))}
      </ol>

      {/* ── Other driver traffic ────────────────────────────────────────── */}
      {data.otherMessages.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <button
            onClick={() => setShowLog(s => !s)}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <History className="w-3.5 h-3.5 text-slate-400" />
            Other driver messages ({data.otherMessages.length})
            <span className="ml-auto text-[10px] font-normal text-slate-400">
              assignment notices, cancellations, advance sheets
            </span>
          </button>
          {showLog && (
            <ul className="space-y-1 border-t border-slate-100 p-2">
              {data.otherMessages.map(m => (
                <li key={m.id}>
                  <button
                    onClick={() => setViewing({
                      title: 'Driver message',
                      body: m.body,
                      isPreview: false,
                      sentAt: m.sentAt,
                      status: m.status,
                      phone: m.phone,
                    })}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50"
                  >
                    <MessageCircle className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
                    <span className="truncate text-[11px] text-slate-600">
                      {m.body.split('\n').find(Boolean)?.replace(/\*/g, '') ?? '(no text)'}
                    </span>
                    <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-slate-400">{m.phone}</span>
                    <span className="flex-shrink-0 text-[10px] text-slate-400">{fmtWhen(m.sentAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <DriverAssignModal
          open
          bookingRef={bookingRef}
          day={editing}
          remainingUnassigned={data.days.filter(
            d => !d.driverNotRequired && !d.driver.name && d.agendaItemId !== editing.agendaItemId,
          ).length}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}

      <MessageViewerModal open={!!viewing} payload={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function DayRow({
  day, onEdit, onView,
}: { day: DriverPrecheckDay; onEdit: () => void; onView: () => void }) {
  const style = STATE_STYLE[day.briefing]
  const Icon = style.icon
  const meta = BRIEFING_META[day.briefing]
  const d = day.driver

  const dateLabel = new Date(day.date).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  })

  return (
    <li className={cn(
      'rounded-xl border bg-white p-3 transition-colors',
      day.briefing === 'MISSED' || day.briefing === 'NO_DRIVER' ? 'border-rose-200' :
      day.briefing === 'PENDING' ? 'border-amber-200' :
      day.driverNotRequired ? 'border-slate-100 bg-slate-50/40' : 'border-slate-200',
    )}>
      <div className="flex items-start gap-3">
        {/* Day marker */}
        <div className="flex w-12 flex-shrink-0 flex-col items-center">
          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Day</span>
          <span className="text-lg font-bold leading-none text-slate-700">{day.dayNo}</span>
          <span className={cn('mt-1 h-1.5 w-1.5 rounded-full', style.dot)} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Movement */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold text-slate-500">{dateLabel}</span>
            <span className="truncate text-sm font-semibold text-slate-900">{day.location}</span>
            {day.meetingTime && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {day.meetingTime}
              </span>
            )}
            <span
              className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold', style.chip)}
              title={meta.blurb}
            >
              <Icon className="w-3 h-3" /> {meta.label}
            </span>
            {day.sentAt && (
              <span className="text-[10px] text-slate-400">{fmtWhen(day.sentAt)}</span>
            )}
          </div>

          {(day.fromPoint || day.toPoint) && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{day.fromPoint ?? ''}{day.toPoint ? ` → ${day.toPoint}` : ''}</span>
            </div>
          )}

          {/* Driver */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {d.name ? (
              <>
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <Car className="w-3 h-3 text-slate-400" /> {d.name}
                </span>
                {d.phone
                  ? <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`} className="font-mono text-slate-500 hover:text-sky-600">{d.phone}</a>
                  : <span className="font-semibold text-orange-600">no number</span>}
                {(d.vehicleType || d.vehiclePlate) && (
                  <span className="text-slate-500">{[d.vehicleType, d.vehiclePlate].filter(Boolean).join(' · ')}</span>
                )}
                {d.rate != null && (
                  <span className="text-slate-400">{d.rateCurrency ?? 'USD'} {d.rate.toFixed(2)}</span>
                )}
                {!d.driverId && (
                  <span className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 text-[9px] font-bold uppercase text-slate-400"
                        title="Typed in by hand — not linked to a registered driver, so they cannot be tracked across bookings">
                    ad-hoc
                  </span>
                )}
                {d.registeredInactive && (
                  <span className="rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[9px] font-bold uppercase text-rose-600"
                        title="This driver has been deactivated in the driver register">
                    inactive
                  </span>
                )}
                {d.masterPhone && (
                  <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-bold text-amber-700"
                        title={`The driver register has ${d.masterPhone} for this driver`}>
                    number differs from register
                  </span>
                )}
              </>
            ) : day.driverNotRequired ? (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Palmtree className="w-3 h-3" /> No driver needed on this day
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                <UserX className="w-3 h-3" /> Nobody assigned
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            onClick={onView}
            title={day.sentAt ? 'View the briefing that was sent' : 'Preview the briefing that will be sent'}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Eye className="w-4 h-4" />
          </button>
          {!day.driverNotRequired && (
            <button
              onClick={onEdit}
              title={d.name ? 'Edit the driver on this movement' : 'Assign a driver'}
              className={cn(
                'rounded-lg p-1.5',
                d.name ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                       : 'text-white bg-brand-500 hover:bg-brand-600',
              )}
            >
              {d.name ? <Pencil className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

function Stat({
  icon: Icon, label, value, tone,
}: {
  icon: typeof Clock
  label: string
  value: number
  tone?: 'emerald' | 'amber' | 'rose' | 'orange'
}) {
  const colour = tone
    ? { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600', orange: 'text-orange-600' }[tone]
    : 'text-slate-600'
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <Icon className={cn('w-3.5 h-3.5', colour)} />
      <span className={cn('text-sm font-bold tabular-nums', colour)}>{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
    </span>
  )
}
