'use client'

/**
 * The working surface for one reservation.
 *
 * A slide-over rather than a page, because the team works a queue: opening a
 * stay must not lose the board behind it.
 *
 * Seven tabs, in the order the work actually happens — Stay, Options, Requests,
 * Comms, Money, Policy, History. The transition buttons live in the footer and
 * are driven entirely by what `reservation-state.ts` says this role may do from
 * this status, so a new transition appears in the UI the moment it is added to
 * the table, with no change here.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowRight, BedDouble, Check, Clock, FileText, History,
  Loader2, MessageSquare, Percent, Save, Wallet, X,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import GateChecklist from './gate-checklist'
import OptionBoard, { type OptionRow } from './option-board'
import { Field, MoneyVariance, StatusChip, EmptyState, fmtDay } from './reservation-ui'
import {
  MEAL_PLAN_LABELS, formatMoney, quoteCancellation, daysBetween,
  type ReservationStatusValue,
} from '@/lib/reservation-shared'
import type { GateResult } from '@/lib/reservation-gate'

type Tab = 'stay' | 'options' | 'requests' | 'comms' | 'money' | 'policy' | 'history'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'stay',     label: 'Stay',     icon: <BedDouble className="h-3.5 w-3.5" /> },
  { id: 'options',  label: 'Options',  icon: <ArrowRight className="h-3.5 w-3.5" /> },
  { id: 'requests', label: 'Requests', icon: <Check className="h-3.5 w-3.5" /> },
  { id: 'comms',    label: 'Comms',    icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { id: 'money',    label: 'Money',    icon: <Wallet className="h-3.5 w-3.5" /> },
  { id: 'policy',   label: 'Policy',   icon: <Percent className="h-3.5 w-3.5" /> },
  { id: 'history',  label: 'History',  icon: <History className="h-3.5 w-3.5" /> },
]

interface Transition {
  to: ReservationStatusValue
  label: string
  requiresNote?: boolean
  guard?: string
  danger?: boolean
}

interface Props {
  reservationId: string | null
  onClose: () => void
  onChanged?: () => void
}

export default function ReservationDrawer({ reservationId, onClose, onChanged }: Props) {
  const [tab, setTab] = useState<Tab>('stay')
  const [data, setData] = useState<any>(null)
  const [gate, setGate] = useState<GateResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Transition dialogue state
  const [pending, setPending] = useState<Transition | null>(null)
  const [note, setNote] = useState('')
  const [waivers, setWaivers] = useState<Record<string, string>>({})
  const [ackPenalty, setAckPenalty] = useState(false)
  const [raiseCn, setRaiseCn] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!reservationId) return
    setLoading(true)
    setError(null)
    try {
      const [dRes, gRes] = await Promise.all([
        fetch(`/api/reservations/${reservationId}`),
        fetch(`/api/reservations/${reservationId}/gate`),
      ])
      const d = await dRes.json()
      if (!d.success) throw new Error(d.error ?? 'Failed to load reservation')
      setData(d.data)
      const g = await gRes.json()
      if (g.success) setGate(g.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [reservationId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setTab('stay'); setPending(null) }, [reservationId])

  const r = data?.reservation
  const transitions: Transition[] = data?.transitions ?? []

  const penalty = useMemo(() => {
    if (!r) return null
    return quoteCancellation({
      checkIn: r.checkIn,
      totalCost: r.totalCost,
      currency: r.currency,
      freeCancelUntil: r.freeCancelUntil,
      penaltyTiers: r.penaltyTiers,
    })
  }, [r])

  async function runTransition() {
    if (!pending || !reservationId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: pending.to,
          note,
          waivers,
          penaltyAcknowledged: ackPenalty,
          raiseCreditNote: pending.to === 'CANCELLED' ? raiseCn : false,
        }),
      })
      const json = await res.json()
      if (!json.success) {
        setError(json.error ?? 'Transition failed')
        // The gate comes back in `detail` — re-render the checklist against it.
        if (json.detail?.blockers || json.detail?.warnings) {
          setGate({
            checks: [...(json.detail.blockers ?? []), ...(json.detail.warnings ?? [])],
            blockers: json.detail.blockers ?? [],
            warnings: json.detail.warnings ?? [],
            blocked: (json.detail.blockers ?? []).length > 0,
            passedAll: false,
          })
        }
        return
      }
      setPending(null)
      setNote('')
      setWaivers({})
      setAckPenalty(false)
      await load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  async function selectOption(optionId: string, reason: string) {
    await fetch(`/api/reservations/${reservationId}/options/${optionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    await load()
    onChanged?.()
  }

  async function removeOption(optionId: string) {
    await fetch(`/api/reservations/${reservationId}/options/${optionId}`, { method: 'DELETE' })
    await load()
  }

  if (!reservationId) return null

  const confirmed = r && ['CONFIRMED', 'AMENDED'].includes(r.status)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          {loading && !r ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : r ? (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-slate-900">{r.hotelName}</h2>
                <StatusChip status={r.status} />
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                <span className="font-mono">{r.bookingRef}</span>
                {r.city && <> · {r.city}</>}
                {' · '}{fmtDay(r.checkIn)} → {fmtDay(r.checkOut)} ({r.nights}N)
                {r.confirmationNumber && <> · conf <span className="font-mono">{r.confirmationNumber}</span></>}
              </p>
            </div>
          ) : (
            <p className="text-sm text-red-600">{error ?? 'Not found'}</p>
          )}
          <button onClick={onClose} className="rounded p-1 text-slate-400 transition hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition',
                tab === t.id
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {t.icon}{t.label}
              {t.id === 'options' && data?.reservation?.options?.length > 0 && (
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">
                  {data.reservation.options.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && !pending && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {r && tab === 'stay' && <StayTab data={data} gate={gate} />}

          {r && tab === 'options' && (
            <OptionBoard
              options={(r.options ?? []) as OptionRow[]}
              nights={r.nights}
              pax={(r.adults ?? 0) + (r.children ?? 0)}
              budget={r.budgetAmount}
              readOnly={confirmed}
              onSelect={selectOption}
              onRemove={removeOption}
            />
          )}

          {r && tab === 'requests' && <RequestsTab requests={r.specialRequests ?? []} />}
          {r && tab === 'comms' && <CommsTab reservation={r} events={r.events ?? data?.reservation?.events ?? []} />}
          {r && tab === 'money' && <MoneyTab data={data} />}
          {r && tab === 'policy' && <PolicyTab reservation={r} penalty={penalty} />}
          {r && tab === 'history' && <HistoryTab events={data?.reservation?.events ?? []} />}
        </div>

        {/* Footer — transitions */}
        {r && (
          <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
            {pending ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-800">{pending.label}</p>
                  <button onClick={() => setPending(null)} className="text-xs text-slate-400 hover:text-slate-600">
                    Cancel
                  </button>
                </div>

                {pending.guard === 'accuracyGate' && gate && (
                  <div className="max-h-64 overflow-y-auto">
                    <GateChecklist
                      gate={gate}
                      waivers={waivers}
                      onWaiverChange={(id, reason) => setWaivers(w => ({ ...w, [id]: reason }))}
                    />
                  </div>
                )}

                {pending.guard === 'penaltyAcknowledged' && penalty && penalty.amount > 0 && (
                  <label className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-xs">
                    <input
                      type="checkbox"
                      checked={ackPenalty}
                      onChange={e => setAckPenalty(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span className="text-red-800">
                      I accept the cancellation charge of{' '}
                      <strong>{formatMoney(penalty.amount, r.currency)}</strong>. {penalty.explanation}
                    </span>
                  </label>
                )}

                {pending.to === 'CANCELLED' && (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={raiseCn} onChange={e => setRaiseCn(e.target.checked)} />
                    Raise a credit note for the recoverable balance
                  </label>
                )}

                {pending.requiresNote && (
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    rows={2}
                    placeholder="Note (required)"
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                )}

                {error && (
                  <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{error}</p>
                )}

                <Button
                  size="sm"
                  variant={pending.danger ? 'danger' : 'primary'}
                  loading={saving}
                  onClick={runTransition}
                  disabled={
                    (pending.requiresNote && !note.trim()) ||
                    (pending.guard === 'accuracyGate' && !!gate?.blocked)
                  }
                >
                  Confirm — {pending.label}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transitions.length === 0 ? (
                  <p className="text-xs text-slate-400">No actions available from this status for your role.</p>
                ) : (
                  transitions.map(t => (
                    <Button
                      key={t.to}
                      size="sm"
                      variant={t.danger ? 'danger' : t.guard === 'accuracyGate' ? 'primary' : 'secondary'}
                      onClick={() => {
                        setPending(t)
                        setNote('')
                        setError(null)
                      }}
                    >
                      {t.label}
                    </Button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function StayTab({ data, gate }: { data: any; gate: GateResult | null }) {
  const r = data.reservation
  const acc = data.accommodation

  // A disagreement between what was sold and what we are booking is a finding,
  // not something to hide — so it is surfaced at the top, not buried.
  const drift: string[] = []
  if (acc) {
    if (daysBetween(r.checkIn, acc.checkIn) !== 0) {
      drift.push(`Check-in: booking says ${fmtDay(acc.checkIn)}, reservation says ${fmtDay(r.checkIn)}`)
    }
    if (daysBetween(r.checkOut, acc.checkOut) !== 0) {
      drift.push(`Check-out: booking says ${fmtDay(acc.checkOut)}, reservation says ${fmtDay(r.checkOut)}`)
    }
  }

  return (
    <div className="space-y-4">
      {drift.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <AlertTriangle className="h-3.5 w-3.5" /> Differs from the booking
          </div>
          {drift.map(d => <p key={d} className="text-[11px] text-amber-800">{d}</p>)}
        </div>
      )}

      {gate && (gate.blockers.length > 0 || gate.warnings.length > 0) && (
        <GateChecklist gate={gate} waivers={{}} onWaiverChange={() => {}} readOnly />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Booking" mono>{r.bookingRef}</Field>
        <Field label="Lead guest">{r.leadGuestName}</Field>
        <Field label="Agent">{data.booking?.agent}</Field>
        <Field label="Check-in">{fmtDay(r.checkIn)}</Field>
        <Field label="Check-out">{fmtDay(r.checkOut)}</Field>
        <Field label="Nights" mono>{r.nights}</Field>
        <Field label="Room type">{r.roomType}</Field>
        <Field label="Rooms" mono>{r.roomCount}</Field>
        <Field label="Meal plan">{MEAL_PLAN_LABELS[r.mealPlan as never] ?? r.mealPlan}</Field>
        <Field label="Adults" mono>{r.adults}</Field>
        <Field label="Children" mono>{`${r.children} (CWB ${r.cwb} / CNB ${r.cnb})`}</Field>
        <Field label="Infants" mono>{r.infants}</Field>
        <Field label="Nett rate" mono>{formatMoney(r.nettRate, r.currency)}</Field>
        <Field label="Total">
          <MoneyVariance amount={r.totalCost} budget={r.budgetAmount} currency={r.currency} />
        </Field>
        <Field label="Confirmation" mono>{r.confirmationNumber}</Field>
      </div>

      {r.notes && (
        <div className="rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{r.notes}</div>
      )}
    </div>
  )
}

function RequestsTab({ requests }: { requests: any[] }) {
  if (requests.length === 0) {
    return <EmptyState title="No special requests" hint="Early check-in, honeymoon set-up, an extra bed — logged here and tracked to the property's actual answer." />
  }

  const STATUS_TONE: Record<string, string> = {
    REQUESTED: 'bg-slate-100 text-slate-600',
    ACKNOWLEDGED: 'bg-sky-100 text-sky-700',
    CONFIRMED: 'bg-emerald-100 text-emerald-700',
    DECLINED: 'bg-red-100 text-red-700',
    NOT_APPLICABLE: 'bg-slate-100 text-slate-400',
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-slate-500">
        Only a <strong>Confirmed</strong> request is a promise we may repeat to the guest. Asking is not agreeing.
      </p>
      {requests.map(q => (
        <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-slate-800">
              {q.kind.replace(/_/g, ' ').toLowerCase()}
            </div>
            {q.detail && <p className="mt-0.5 text-[11px] text-slate-600">{q.detail}</p>}
            {q.hotelResponse && (
              <p className="mt-1 text-[11px] italic text-slate-500">Hotel: “{q.hotelResponse}”</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_TONE[q.status])}>
              {q.status.replace('_', ' ').toLowerCase()}
            </span>
            {q.chargeable && q.cost && (
              <span className="text-[10px] text-slate-500">{formatMoney(q.cost, q.currency ?? 'USD')}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function CommsTab({ reservation: r, events }: { reservation: any; events: any[] }) {
  const contactEvents = events.filter(e =>
    ['contacted', 'hotel_replied', 'message_sent'].includes(e.action))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Last channel">{r.lastChannel?.toLowerCase()}</Field>
        <Field label="Last contacted">{r.lastContactedAt ? fmtDay(r.lastContactedAt) : '—'}</Field>
        <Field label="First reply">{r.firstResponseAt ? fmtDay(r.firstResponseAt) : 'none yet'}</Field>
        <Field label="Attempts" mono>{r.attempts}</Field>
      </div>

      {contactEvents.length === 0 ? (
        <EmptyState title="Nothing sent yet" hint="Every message to the property is logged here with the channel it went out on." />
      ) : (
        <div className="space-y-2">
          {contactEvents.map(e => (
            <div key={e.id} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium text-slate-700">
                  {e.action === 'hotel_replied' ? 'Hotel replied' : `Sent via ${e.channel ?? 'email'}`}
                </span>
                <span className="text-slate-400">{fmtDay(e.createdAt)}</span>
              </div>
              {e.note && <p className="mt-1 text-[11px] text-slate-600">{e.note}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function MoneyTab({ data }: { data: any }) {
  const r = data.reservation
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Currency">{r.currency}</Field>
        <Field label="FX rate to USD" mono>{r.fxRate ?? '—'}</Field>
        <Field label="Nett rate / room / night" mono>{formatMoney(r.nettRate, r.currency)}</Field>
        <Field label="Stay total">
          <MoneyVariance amount={r.totalCost} budget={r.budgetAmount} currency={r.currency} />
        </Field>
        <Field label="P&L budget" mono>{formatMoney(r.budgetAmount, 'USD')}</Field>
        <Field label="USD equivalent" mono>{formatMoney(r.baseTotalCost, 'USD')}</Field>
        <Field label="Payment due">{r.paymentDueAt ? fmtDay(r.paymentDueAt) : '—'}</Field>
        <Field label="Proforma due">{r.proformaDueAt ? fmtDay(r.proformaDueAt) : '—'}</Field>
        <Field label="Paid">{r.paidAt ? fmtDay(r.paidAt) : 'not yet'}</Field>
      </div>

      <Section title="Proforma invoices">
        {(r.invoices ?? []).length === 0
          ? <p className="text-xs text-slate-400">None received.</p>
          : (r.invoices ?? []).map((i: any) => (
              <div key={i.id} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-2 text-xs">
                <span className="font-mono">{i.invoiceNumber ?? 'no number'}</span>
                <span>{formatMoney(i.totalAmount, i.currency)}</span>
                <span className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  i.status === 'DISCREPANCY' ? 'bg-red-100 text-red-700'
                    : i.status === 'PAID' ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600',
                )}>
                  {i.status.replace('_', ' ').toLowerCase()}
                </span>
              </div>
            ))}
      </Section>

      <Section title="Credit notes">
        {(r.creditNotes ?? []).length === 0
          ? <p className="text-xs text-slate-400">None outstanding.</p>
          : (r.creditNotes ?? []).map((c: any) => (
              <div key={c.id} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-2 text-xs">
                <span>{c.reason.replace(/_/g, ' ').toLowerCase()}</span>
                <span>{formatMoney(c.expectedAmount, c.currency)}</span>
                <span className="text-slate-500">chased {c.chaseCount}×</span>
              </div>
            ))}
      </Section>
    </div>
  )
}

function PolicyTab({ reservation: r, penalty }: { reservation: any; penalty: any }) {
  const tiers = Array.isArray(r.penaltyTiers) ? r.penaltyTiers : []

  return (
    <div className="space-y-4">
      <div className={cn(
        'rounded-lg border p-3',
        penalty?.free ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50',
      )}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <Clock className="h-3.5 w-3.5" />
          Cancelling today costs {formatMoney(penalty?.amount ?? 0, r.currency)}
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-700">{penalty?.explanation}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Free cancellation until">
          {r.freeCancelUntil ? fmtDay(r.freeCancelUntil) : 'not captured'}
        </Field>
        <Field label="Days to check-in" mono>{penalty?.daysToCheckIn}</Field>
      </div>

      {tiers.length > 0 && (
        <Section title="Penalty ladder">
          {tiers.map((t: any, i: number) => (
            <div key={i} className="flex items-center justify-between rounded border border-slate-200 px-2.5 py-1.5 text-xs">
              <span className="text-slate-600">Within {t.fromDaysBefore} days of arrival</span>
              <span className="font-medium text-slate-800">
                {t.pct != null && `${t.pct}%`}
                {t.pct != null && t.amount != null && ' or '}
                {t.amount != null && formatMoney(t.amount, r.currency)}
              </span>
            </div>
          ))}
        </Section>
      )}

      {r.policyText && (
        <Section title="As written by the property">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-slate-700">{r.policyText}</p>
        </Section>
      )}
    </div>
  )
}

function HistoryTab({ events }: { events: any[] }) {
  if (events.length === 0) return <EmptyState title="No history yet" />

  return (
    <div className="space-y-2">
      {events.map(e => (
        <div key={e.id} className="flex gap-3 border-l-2 border-slate-200 py-1.5 pl-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-slate-800">
                {e.action.replace(/_/g, ' ')}
              </span>
              {e.fromStatus && e.toStatus && (
                <span className="text-[10px] text-slate-400">{e.fromStatus} → {e.toStatus}</span>
              )}
            </div>
            {e.note && <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">{e.note}</p>}
            <p className="mt-0.5 text-[10px] text-slate-400">
              {e.actorName ?? e.actorEmail ?? 'system'} · {new Date(e.createdAt).toLocaleString('en-GB')}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}
