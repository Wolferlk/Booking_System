'use client'

/**
 * Reconfirmation deadline panel for the booking detail page.
 *
 * Every tour must be reconfirmed with the guest ten days before travel. Until
 * now, a booking that missed that deadline showed up as a red cell on the
 * operations board and a line in the morning mail with no explanation attached,
 * so the desk that already knew *why* had no way of saying so — and the same
 * files were re-chased every day.
 *
 * This panel is where that is answered. It shows three things in order:
 *
 *   1. **Where the booking stands** — the D-10 date, how far past it the file
 *      is, and which of the two reconfirmation signals (client confirmed /
 *      pre-tour call) are actually in.
 *   2. **The recorded reason**, with who wrote it and how long ago. An
 *      explanation older than a few days is badged as needing a refresh rather
 *      than being quietly accepted — "agent not responding" is a fact about last
 *      week, not a permanent excuse.
 *   3. **The form to record or change it**, offered only while a reason is
 *      genuinely owed.
 *
 * A reconfirmed booking, a Hotel Only file, or one still inside its window
 * renders as a settled strip and nothing more — the panel is deliberately quiet
 * unless it has something to ask for. Whatever is saved here appears verbatim on
 * the ops board and in the daily report.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Clock, Loader2,
  PhoneCall, RefreshCw, Trash2, UserCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { cn, readApiResponse } from '@/lib/utils'
import {
  RECONFIRM_DUE_DAYS, RECONFIRM_REASONS, REASON_META,
  type ReconfirmDelay, type ReconfirmDelayReason, type ReconfirmStanding,
} from '@/lib/reconfirm-delay-shared'

interface ReconfirmView {
  bookingRef: string
  arrivalDate: string
  standing: ReconfirmStanding
  clientConfirmed: boolean
  preTourCalledAt: string | null
  delay: ReconfirmDelay | null
  today: string
  timezone: string
}

function prettyDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function ReconfirmDelayPanel({
  bookingRef, canEdit = true,
}: {
  bookingRef: string
  /** False for roles that may read the file but not work it. */
  canEdit?: boolean
}) {
  const [view, setView] = useState<ReconfirmView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Form state. Seeded from whatever is on file so "edit" opens on the current
  // answer rather than an empty picker the operator has to retype.
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState<ReconfirmDelayReason | ''>('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/reconfirm-delay`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Could not load')
      const data = json.data as ReconfirmView
      setView(data)
      setReason(data.delay?.reason ?? '')
      setNote(data.delay?.note ?? '')
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!reason) return
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/reconfirm-delay`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, note }),
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error ?? 'Could not save')
      toast.success(json.message ?? 'Reason recorded')
      setEditing(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/reconfirm-delay`, {
        method: 'DELETE',
      })
      const json = await readApiResponse(res)
      if (!json.success) throw new Error(json.error ?? 'Could not remove')
      toast.success(json.message ?? 'Reason removed')
      setEditing(false)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const s = view?.standing
  const owed = !!s?.needsReason
  const delay = view?.delay ?? null
  // The badge in the header answers the whole panel at a glance: unexplained
  // breaches are the state the board is chasing, so they shout; an explained one
  // is amber, because it is still late — recording a reason is not fixing it.
  const headline = !s ? null
    : s.state === 'NA'   ? { text: 'Not applicable', tone: 'slate' as const }
    : s.state === 'DONE' ? { text: 'Reconfirmed', tone: 'emerald' as const }
    : s.state === 'BREACHED'
      ? delay
        ? { text: `${Math.abs(s.daysToDue)}d late — reason on file`, tone: 'amber' as const }
        : { text: `${Math.abs(s.daysToDue)}d late — no reason`, tone: 'rose' as const }
    : s.state === 'DUE' ? { text: 'Due today', tone: 'amber' as const }
    : { text: `Due in ${s.daysToDue}d`, tone: 'slate' as const }

  return (
    <div data-nav="Reconfirmation" data-nav-icon="phone">
      <Card>
        <CardHeader
          action={
            <Button size="sm" variant="ghost" onClick={() => void load()}
                    icon={<RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />} />
          }
        >
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
            <ClipboardCheck className="w-4 h-4 text-slate-400" />
            Guest reconfirmation
            {headline && <Badge tone={headline.tone}>{headline.text}</Badge>}
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Every tour is reconfirmed with the guest by D-{RECONFIRM_DUE_DAYS} — ten days before
            travel. When that is missed, the reason recorded here is what the ops board and the
            daily report show.
          </p>
        </CardHeader>

        <CardBody className="space-y-3">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading reconfirmation status…
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">Could not load reconfirmation status</div>
                <div className="text-rose-600">{error}</div>
              </div>
            </div>
          )}

          {view && s && !loading && !error && (
            <>
              {/* ── Where the file stands ─────────────────────────────────── */}
              <div className="grid gap-2 sm:grid-cols-3">
                <Fact
                  icon={CalendarClock}
                  label={`D-${RECONFIRM_DUE_DAYS} deadline`}
                  value={prettyDate(s.dueAt)}
                  note={
                    s.state === 'NA' ? 'Hotel Only — no tour to reconfirm'
                      : s.daysToDue < 0 ? `${Math.abs(s.daysToDue)} day(s) ago`
                      : s.daysToDue === 0 ? 'Today'
                      : `in ${s.daysToDue} day(s)`
                  }
                  tone={s.breached ? 'rose' : 'slate'}
                />
                <Fact
                  icon={UserCheck}
                  label="Client confirmed"
                  value={view.clientConfirmed ? 'Yes' : 'No'}
                  note={view.clientConfirmed
                    ? 'Status reached Client Confirmed'
                    : 'Status has not reached Client Confirmed'}
                  tone={view.clientConfirmed ? 'emerald' : 'slate'}
                />
                <Fact
                  icon={PhoneCall}
                  label="Pre-tour call"
                  value={view.preTourCalledAt ? 'Logged' : 'None'}
                  note={view.preTourCalledAt
                    ? `Called ${prettyDate(view.preTourCalledAt)}`
                    : 'No reconfirmation call written up'}
                  tone={view.preTourCalledAt ? 'emerald' : 'slate'}
                />
              </div>

              {/* Either signal reconfirms the guest, so say so — an operator
                  looking at one green tick and one grey should not wonder
                  whether the file is half-done. */}
              {s.state === 'DONE' && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold">Reconfirmed — nothing to explain</div>
                    <div className="text-emerald-700">
                      Either signal is enough: a guest who has confirmed in writing does not also
                      need a call, and a completed pre-tour call reconfirms a booking whose status
                      has not caught up.
                    </div>
                  </div>
                </div>
              )}

              {s.state === 'NA' && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  Hotel Only booking — accommodation and nothing else, so there is no tour to
                  reconfirm with the guest and the D-{RECONFIRM_DUE_DAYS} deadline does not apply.
                  The hotel itself is still reconfirmed on the Pre-checking queue.
                </p>
              )}

              {(s.state === 'UPCOMING' || s.state === 'DUE') && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
                  {s.state === 'DUE'
                    ? `D-${RECONFIRM_DUE_DAYS} is today — reconfirm the guest before the deadline passes.`
                    : `Still inside the window. A reason can only be recorded once D-${RECONFIRM_DUE_DAYS} has passed with the guest still unreconfirmed.`}
                </p>
              )}

              {/* ── The recorded reason ───────────────────────────────────── */}
              {delay && !editing && (
                <div className={cn(
                  'rounded-lg border p-3',
                  delay.stale ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white',
                )}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      {delay.reasonLabel}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {REASON_META[delay.reason]?.owner}
                    </span>
                    {delay.stale && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                        <Clock className="w-3 h-3" /> Not updated in {delay.ageDays} days
                      </span>
                    )}
                  </div>
                  {delay.note && (
                    <p className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{delay.note}</p>
                  )}
                  <p className="mt-2 text-[10px] text-slate-400">
                    Recorded {prettyDate(delay.recordedAt)}
                    {delay.recordedBy ? ` by ${delay.recordedBy}` : ''}
                    {' · shown on the ops board and in the daily report'}
                  </p>
                  {canEdit && owed && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                        {delay.stale ? 'Update the reason' : 'Change reason'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void remove()} disabled={saving}
                              icon={<Trash2 className="w-3.5 h-3.5" />}>
                        Withdraw
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* A breach with nothing on file is the state the whole feature
                  exists to remove, so it is stated as a demand, not a hint. */}
              {owed && !delay && !editing && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-start gap-2 text-xs text-rose-800">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">
                        No reason recorded for missing D-{RECONFIRM_DUE_DAYS}
                      </div>
                      <div className="text-rose-700">
                        This booking is {Math.abs(s.daysToDue)} day(s) past its deadline and is
                        showing on the ops board and in the daily report as unexplained.
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <Button size="sm" className="mt-3" onClick={() => setEditing(true)}>
                      Record the reason
                    </Button>
                  )}
                </div>
              )}

              {/* ── The form ──────────────────────────────────────────────── */}
              {canEdit && owed && editing && (
                <div className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-3">
                  <div className="space-y-1.5">
                    {RECONFIRM_REASONS.map(r => (
                      <label
                        key={r.key}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition-colors',
                          reason === r.key
                            ? 'border-brand-500 bg-white ring-1 ring-brand-200'
                            : 'border-slate-200 bg-white hover:border-slate-300',
                        )}
                      >
                        <input
                          type="radio"
                          name="reconfirm-reason"
                          className="mt-0.5"
                          checked={reason === r.key}
                          onChange={() => setReason(r.key)}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-slate-800">
                            {r.label}
                            <span className="ml-1.5 font-semibold text-[10px] text-slate-400">
                              {r.owner}
                            </span>
                          </span>
                          <span className="block text-[11px] leading-snug text-slate-500">{r.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      Details
                      {reason && REASON_META[reason]?.requiresNote
                        ? ' (required)'
                        : ' (optional, but it is what the report prints)'}
                    </label>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      rows={3}
                      maxLength={600}
                      placeholder="What has actually been tried, and what is it waiting on?"
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void save()}
                      disabled={saving || !reason || (!!reason && !!REASON_META[reason]?.requiresNote && !note.trim())}
                      icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
                    >
                      Save reason
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditing(false)
                      setReason(delay?.reason ?? '')
                      setNote(delay?.note ?? '')
                    }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* A historical explanation on a booking that has since been
                  reconfirmed is left visible but read-only: it is the record of
                  what held the file up, and deleting it would erase the answer
                  to "why was this one late?" a week later. */}
              {delay && !owed && (
                <p className="text-[10px] text-slate-400">
                  This reason was recorded while the booking was overdue and is kept as history.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────────

type Tone = 'rose' | 'amber' | 'emerald' | 'slate'

const TONE: Record<Tone, string> = {
  rose:    'bg-rose-50 text-rose-700 border-rose-200',
  amber:   'bg-amber-50 text-amber-700 border-amber-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  slate:   'bg-slate-100 text-slate-600 border-slate-200',
}

function Badge({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return (
    <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-bold', TONE[tone])}>
      {children}
    </span>
  )
}

function Fact({
  icon: Icon, label, value, note, tone,
}: {
  icon: typeof CalendarClock
  label: string
  value: string
  note: string
  tone: Tone
}) {
  return (
    <div className={cn('rounded-lg border p-2.5', TONE[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide opacity-70">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="mt-1 text-sm font-bold">{value}</div>
      <div className="text-[10px] leading-snug opacity-80">{note}</div>
    </div>
  )
}
