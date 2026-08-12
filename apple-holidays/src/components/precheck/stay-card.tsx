'use client'

/**
 * One hotel stay in the reconfirmation queue.
 *
 * Collapsed it answers the only question that matters at a glance: is this
 * stay confirmed, and how late am I? Expanded it becomes the full worksheet —
 * every field the reconfirmation form specifies, the hotel's contact points as
 * one-tap actions, a ready-to-send WhatsApp message, and the audit trail of
 * who already spoke to this property.
 *
 * The same card renders inside the booking detail page and on the standalone
 * queue, so an operator learns it once.
 */

import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Bed, Building2, CalendarDays, Check, ChevronDown, ChevronUp, Clock,
  Copy, ExternalLink, Hash, Link2, Mail, MessageCircle, Moon,
  Phone, Save, Send, Sparkles, Users, History, MapPin,
} from 'lucide-react'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { buildReconfirmMessage, whatsappLink } from '@/lib/hotel-contact'
import type { PrecheckStay } from '@/lib/hotel-precheck'
import {
  DueRing, Field, HealthMeter, NoContactBadge, STATUS_META,
  STATUS_ORDER, StatusPill, UrgencyChip, fmtDay, fmtDayShort, fmtWhen,
} from './precheck-ui'

export interface StayEvent {
  id: string
  action: string
  fromStatus: string | null
  toStatus: string | null
  channel: string | null
  note: string | null
  actorName: string | null
  createdAt: string
}

/** Editable fields, held as strings so partially-typed input never snaps back. */
interface EditState {
  confirmationNumber: string
  roomType: string
  roomCategory: string
  roomCount: string
  mealType: string
  adults: string
  children: string
  cwb: string
  cnb: string
  discrepancyNote: string
  notes: string
  followUpAt: string
}

const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB', 'AI']
const ROOM_CATEGORIES = ['Standard', 'Superior', 'Deluxe', 'Premium', 'Suite', 'Villa']

function editFrom(s: PrecheckStay): EditState {
  const n = (v: number | null) => (v == null ? '' : String(v))
  return {
    confirmationNumber: s.confirmationNumber ?? '',
    roomType: s.roomType ?? '',
    roomCategory: s.roomCategory ?? '',
    roomCount: n(s.roomCount),
    mealType: s.mealType ?? '',
    adults: n(s.adults),
    children: n(s.children),
    cwb: n(s.cwb),
    cnb: n(s.cnb),
    discrepancyNote: s.discrepancyNote ?? '',
    notes: s.notes ?? '',
    followUpAt: s.followUpAt ? s.followUpAt.slice(0, 10) : '',
  }
}

export default function StayCard({
  stay, events, onChanged, onResolveHotel, showBooking, defaultOpen,
}: {
  stay: PrecheckStay
  events?: StayEvent[]
  /** Refetch the parent after any write. */
  onChanged: () => void
  /** Open the hotel matcher for this stay. */
  onResolveHotel: (stay: PrecheckStay) => void
  /** Show the booking ref/guest header — on the global queue, not the panel. */
  showBooking?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [saving, setSaving] = useState(false)
  const [edit, setEdit] = useState<EditState>(() => editFrom(stay))
  const [showTimeline, setShowTimeline] = useState(false)

  const hotel = stay.hotel

  // ── The message we would send this hotel right now.
  const message = useMemo(() => buildReconfirmMessage({
    hotelName: hotel?.name ?? stay.hotelName,
    bookingRef: stay.bookingRef,
    isNumber: stay.isNumber,
    leadGuest: stay.leadGuest,
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    nights: stay.nights,
    roomCount: Number(edit.roomCount) || stay.roomCount,
    roomType: edit.roomType || stay.roomType,
    roomCategory: edit.roomCategory || stay.roomCategory,
    mealType: edit.mealType || stay.mealType,
    adults: Number(edit.adults) || stay.adults,
    children: Number(edit.children) || stay.children,
    cwb: Number(edit.cwb) || stay.cwb,
    cnb: Number(edit.cnb) || stay.cnb,
    confirmationNumber: edit.confirmationNumber || stay.confirmationNumber,
  }), [stay, hotel, edit])

  // ── Writes ─────────────────────────────────────────────────────────────────

  const post = useCallback(async (body: Record<string, unknown>, successMsg: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/precheck/stay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stayKey: stay.stayKey, ...body }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(successMsg)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [stay.stayKey, onChanged])

  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const saveAll = useCallback(() => post({
    confirmationNumber: edit.confirmationNumber,
    roomType: edit.roomType,
    roomCategory: edit.roomCategory,
    roomCount: num(edit.roomCount),
    mealType: edit.mealType,
    adults: num(edit.adults),
    children: num(edit.children),
    cwb: num(edit.cwb),
    cnb: num(edit.cnb),
    discrepancyNote: edit.discrepancyNote,
    notes: edit.notes,
    followUpAt: edit.followUpAt || null,
  }, 'Stay details saved'), [edit, post])

  const setStatus = useCallback((status: string) => post({ status }, `Marked ${STATUS_META[status]?.label ?? status}`), [post])

  /**
   * Record that the hotel was contacted on a channel.
   *
   * Stamps the attempt *before* the channel opens, so a call that goes
   * unanswered is still on the record — the audit trail has to show effort,
   * not just successes.
   */
  const logContact = useCallback((channel: string, then?: () => void) => {
    void post(
      { markChecked: true, lastChannel: channel, ...(stay.status === 'PENDING' ? { status: 'IN_PROGRESS' } : {}) },
      `Logged a ${channel.toLowerCase()} attempt`,
    ).then(() => then?.())
  }, [post, stay.status])

  const set = <K extends keyof EditState>(k: K, v: string) => setEdit(e => ({ ...e, [k]: v }))

  // ── Render ─────────────────────────────────────────────────────────────────

  const paxSummary = [
    stay.adults ? `${stay.adults}A` : null,
    stay.children ? `${stay.children}C` : null,
    stay.cwb ? `${stay.cwb} CWB` : null,
    stay.cnb ? `${stay.cnb} CNB` : null,
  ].filter(Boolean).join(' · ') || '—'

  return (
    <div className={cn(
      'rounded-xl border bg-white transition-shadow',
      stay.urgency === 'OVERDUE'   ? 'border-rose-200 shadow-[0_1px_0_0_rgba(244,63,94,0.15)]' :
      stay.urgency === 'DUE_TODAY' ? 'border-amber-200' : 'border-slate-200',
      open && 'shadow-md',
    )}>
      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-3">
        <DueRing daysToDue={stay.daysToDue} daysToCheckIn={stay.daysToCheckIn} urgency={stay.urgency} />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {showBooking && (
              <span className="font-mono text-xs font-bold text-slate-700">{stay.isNumber || stay.bookingRef}</span>
            )}
            <span className="text-sm font-semibold text-slate-900 truncate">{hotel?.name ?? stay.hotelName}</span>
            {stay.city && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-slate-400">
                <MapPin className="w-3 h-3" />{stay.city}
              </span>
            )}
            <StatusPill status={stay.status} size="sm" />
            {stay.urgency !== 'SETTLED' && <UrgencyChip urgency={stay.urgency} />}
            {stay.unmatched && (
              <button
                onClick={() => onResolveHotel(stay)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
              >
                <Link2 className="w-3 h-3" /> Match hotel
              </button>
            )}
            {stay.noContact && <NoContactBadge />}
            {stay.ownArrangement && (
              <span className="rounded-md bg-violet-50 border border-violet-200 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600">
                Own arrangement
              </span>
            )}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="w-3 h-3" />
              {fmtDayShort(stay.checkIn)} → {fmtDayShort(stay.checkOut)}
            </span>
            <span className="inline-flex items-center gap-1"><Moon className="w-3 h-3" />{stay.nights}n</span>
            {(stay.roomCount || stay.roomType) && (
              <span className="inline-flex items-center gap-1">
                <Bed className="w-3 h-3" />
                {[stay.roomCount ? `${stay.roomCount}x` : null, stay.roomCategory, stay.roomType].filter(Boolean).join(' ')}
              </span>
            )}
            {stay.mealType && <span className="font-semibold text-slate-600">{stay.mealType}</span>}
            <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{paxSummary}</span>
            {stay.confirmationNumber && (
              <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-700">
                <Hash className="w-3 h-3" />{stay.confirmationNumber}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Clock className="w-3 h-3" /> checked {fmtWhen(stay.lastCheckedAt)}
              {stay.attempts > 0 && ` · ${stay.attempts} attempt${stay.attempts > 1 ? 's' : ''}`}
            </span>
          </div>
        </div>

        {/* Quick contact actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <ContactActions stay={stay} message={message} onLog={logContact} />
          <button
            onClick={() => setOpen(o => !o)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title={open ? 'Collapse' : 'Open the reconfirmation worksheet'}
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Expanded worksheet ─────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-slate-100 p-3 space-y-4 bg-slate-50/50 rounded-b-xl">
          {/* Status rail */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
              Reconfirmation status
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map(s => {
                const m = STATUS_META[s]
                const Icon = m.icon
                const active = stay.status === s
                return (
                  <button
                    key={s}
                    disabled={saving}
                    onClick={() => setStatus(s)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all disabled:opacity-50',
                      active ? `${m.chip} ring-2 ${m.ring}` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-white',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" /> {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Hotel contact block */}
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-xs font-bold text-slate-800 truncate">{hotel?.name ?? stay.hotelName}</span>
                {hotel?.accountsHotelId && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                    ACCOUNTS #{hotel.accountsHotelId}
                  </span>
                )}
                {hotel && <HealthMeter score={hotel.health.score} label={hotel.health.label} missing={hotel.health.missing} />}
              </div>
              <Button size="sm" variant="secondary" onClick={() => onResolveHotel(stay)}
                      icon={hotel ? <Building2 className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}>
                {hotel ? 'Edit hotel & contacts' : 'Match / add hotel'}
              </Button>
            </div>

            {hotel ? (
              <div className="flex flex-wrap gap-1.5">
                {hotel.channels.length === 0 && !hotel.phone && !hotel.email && (
                  <span className="text-[11px] text-slate-400 italic">
                    No contact points saved — use &quot;Match / add hotel&quot; to look them up.
                  </span>
                )}
                {hotel.channels.map(c => (
                  <span key={c.id} className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-mono',
                    c.verified ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
                  )}>
                    <span className="font-sans font-bold uppercase text-[8px] opacity-60">{c.label || c.kind}</span>
                    {c.e164 ?? c.value}
                    <button onClick={() => { void navigator.clipboard.writeText(c.e164 ?? c.value); toast.success('Copied') }}
                            className="opacity-40 hover:opacity-100"><Copy className="w-2.5 h-2.5" /></button>
                  </span>
                ))}
                {hotel.website && (
                  <a href={hotel.website} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 hover:bg-sky-100">
                    <ExternalLink className="w-2.5 h-2.5" /> website
                  </a>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400 italic">
                This hotel is not matched to the hotel book yet
                {stay.bookingContact && <> — the booking lists <span className="font-mono text-slate-600">{stay.bookingContact}</span></>}.
              </p>
            )}
          </div>

          {/* Editable stay detail */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            <Text label="Hotel confirmation no." value={edit.confirmationNumber} onChange={v => set('confirmationNumber', v)} mono placeholder="e.g. HTL-99213" />
            <Text label="Room type" value={edit.roomType} onChange={v => set('roomType', v)} placeholder="Double / Twin" />
            <Select label="Room category" value={edit.roomCategory} onChange={v => set('roomCategory', v)} options={ROOM_CATEGORIES} />
            <Text label="Room count" value={edit.roomCount} onChange={v => set('roomCount', v)} numeric />
            <Select label="Meal plan" value={edit.mealType} onChange={v => set('mealType', v)} options={MEAL_PLANS} />
            <Text label="Adults" value={edit.adults} onChange={v => set('adults', v)} numeric />
            <Text label="Children" value={edit.children} onChange={v => set('children', v)} numeric />
            <Text label="CWB" value={edit.cwb} onChange={v => set('cwb', v)} numeric hint="Child with bed" />
            <Text label="CNB" value={edit.cnb} onChange={v => set('cnb', v)} numeric hint="Child no bed" />
            <Text label="Follow up on" value={edit.followUpAt} onChange={v => set('followUpAt', v)} type="date" />
            <div className="col-span-2">
              <Text label="Notes" value={edit.notes} onChange={v => set('notes', v)} placeholder="What the hotel said…" />
            </div>
            {(stay.status === 'DISCREPANCY' || stay.status === 'ISSUE' || edit.discrepancyNote) && (
              <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                <Text
                  label="Discrepancy / issue"
                  value={edit.discrepancyNote}
                  onChange={v => set('discrepancyNote', v)}
                  placeholder="Hotel has 2 rooms not 3; meal plan is BB not HB…"
                  tone="warn"
                />
              </div>
            )}
          </div>

          {/* Read-only context */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 rounded-lg bg-white border border-slate-200 p-2.5">
            <Field label="Booking" value={<span className="font-mono">{stay.isNumber || stay.bookingRef}</span>} />
            <Field label="Guest" value={stay.leadGuest ?? '—'} />
            <Field label="Check-in" value={fmtDay(stay.checkIn)} />
            <Field label="Check-out" value={fmtDay(stay.checkOut)} />
            <Field label="D-10 due" value={fmtDay(stay.dueAt)} />
            <Field label="Nights" value={stay.nights} />
            <Field label="Last checked" value={stay.lastCheckedAt ? `${fmtWhen(stay.lastCheckedAt)} · ${stay.lastCheckedBy ?? 'unknown'}` : 'never'} />
            <Field label="Channel" value={stay.lastChannel ?? '—'} />
          </div>

          {/* WhatsApp composer */}
          <details className="rounded-lg border border-emerald-200 bg-emerald-50/50 overflow-hidden group">
            <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">
              <MessageCircle className="w-3.5 h-3.5" />
              Reconfirmation message
              <span className="ml-auto text-[10px] font-normal text-emerald-600 group-open:hidden">preview & send</span>
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <pre className="whitespace-pre-wrap rounded-lg border border-emerald-200 bg-white p-2.5 text-[11px] leading-relaxed text-slate-700 max-h-56 overflow-y-auto">
                {message}
              </pre>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<Copy className="w-3.5 h-3.5" />}
                        onClick={() => { void navigator.clipboard.writeText(message); toast.success('Message copied') }}>
                  Copy
                </Button>
                {hotel?.whatsapp && (
                  <Button size="sm" icon={<Send className="w-3.5 h-3.5" />}
                          onClick={() => {
                            window.open(whatsappLink(hotel.whatsapp!, message), '_blank', 'noopener')
                            logContact('WHATSAPP')
                          }}>
                    Open in WhatsApp
                  </Button>
                )}
                {hotel?.email && (
                  <Button size="sm" variant="secondary" icon={<Mail className="w-3.5 h-3.5" />}
                          onClick={() => {
                            const subject = `Reconfirmation — ${stay.isNumber || stay.bookingRef} — ${fmtDay(stay.checkIn)}`
                            window.location.href = `mailto:${hotel.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`
                            logContact('EMAIL')
                          }}>
                    Email
                  </Button>
                )}
              </div>
            </div>
          </details>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" loading={saving} onClick={saveAll} icon={<Save className="w-3.5 h-3.5" />}>Save details</Button>
            <Button size="sm" variant="secondary" disabled={saving}
                    onClick={() => post({ markChecked: true, eventNote: 'Marked checked' }, 'Marked as checked')}
                    icon={<Check className="w-3.5 h-3.5" />}>
              Mark checked now
            </Button>
            <Button size="sm" variant="secondary" disabled={saving}
                    onClick={() => post({ status: 'CONFIRMED', markChecked: true, confirmationNumber: edit.confirmationNumber || null }, 'Stay confirmed')}
                    className="!text-emerald-700 !border-emerald-300 hover:!bg-emerald-50"
                    icon={<Check className="w-3.5 h-3.5" />}>
              Confirm stay
            </Button>
            {events && events.length > 0 && (
              <button onClick={() => setShowTimeline(t => !t)}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700">
                <History className="w-3.5 h-3.5" /> {showTimeline ? 'Hide' : 'Show'} history ({events.length})
              </button>
            )}
          </div>

          {/* Timeline */}
          {showTimeline && events && events.length > 0 && (
            <ol className="relative border-l border-slate-200 ml-1.5 space-y-2.5 pt-1">
              {events.map(e => (
                <li key={e.id} className="ml-3.5 relative">
                  <span className={cn(
                    'absolute -left-[1.15rem] top-1 w-2 h-2 rounded-full ring-2 ring-white',
                    e.toStatus ? (STATUS_META[e.toStatus]?.dot ?? 'bg-slate-300') : 'bg-slate-300',
                  )} />
                  <div className="text-[11px] text-slate-700">
                    <span className="font-semibold">{describeEvent(e)}</span>
                    {e.channel && <span className="ml-1 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase text-slate-500">{e.channel}</span>}
                  </div>
                  {e.note && <div className="text-[11px] text-slate-500">{e.note}</div>}
                  <div className="text-[10px] text-slate-400">
                    {e.actorName ?? 'system'} · {fmtWhen(e.createdAt)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** One-tap call / WhatsApp / email, each logging the attempt as it fires. */
function ContactActions({
  stay, message, onLog,
}: { stay: PrecheckStay; message: string; onLog: (channel: string, then?: () => void) => void }) {
  const h = stay.hotel
  const phone = h?.phone ?? stay.bookingContact

  return (
    <>
      {phone && (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, '')}`}
          onClick={() => onLog('CALL')}
          title={`Call ${phone}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-600"
        >
          <Phone className="w-4 h-4" />
        </a>
      )}
      {h?.whatsapp && (
        <a
          href={whatsappLink(h.whatsapp, message)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onLog('WHATSAPP')}
          title={h.whatsappVerified ? `WhatsApp ${h.whatsapp}` : `WhatsApp ${h.whatsapp} (unverified number)`}
          className={cn(
            'relative rounded-lg p-1.5 hover:bg-emerald-50',
            h.whatsappVerified ? 'text-emerald-600' : 'text-emerald-400',
          )}
        >
          <MessageCircle className="w-4 h-4" />
          {!h.whatsappVerified && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" title="Unverified number" />
          )}
        </a>
      )}
      {h?.email && (
        <a
          href={`mailto:${h.email}`}
          onClick={() => onLog('EMAIL')}
          title={`Email ${h.email}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <Mail className="w-4 h-4" />
        </a>
      )}
    </>
  )
}

function describeEvent(e: StayEvent): string {
  switch (e.action) {
    case 'created':       return 'Reconfirmation opened'
    case 'status_change': return `${STATUS_META[e.fromStatus ?? '']?.label ?? e.fromStatus ?? '—'} → ${STATUS_META[e.toStatus ?? '']?.label ?? e.toStatus}`
    case 'checked':       return 'Hotel contacted'
    case 'linked':        return 'Hotel linked'
    case 'unlinked':      return 'Hotel unlinked'
    case 'edited':        return 'Details edited'
    default:              return e.action
  }
}

function Text({
  label, value, onChange, placeholder, numeric, mono, hint, type, tone,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  numeric?: boolean
  mono?: boolean
  hint?: string
  type?: string
  tone?: 'warn'
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400" title={hint}>
        {label}{hint && <span className="ml-0.5 text-slate-300">ⓘ</span>}
      </span>
      <input
        type={type ?? (numeric ? 'number' : 'text')}
        min={numeric ? 0 : undefined}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'mt-0.5 w-full rounded-lg border px-2 py-1 text-xs',
          'focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
          mono && 'font-mono',
          tone === 'warn' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-300 bg-white',
        )}
      />
    </label>
  )
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
      <input
        list={`opts-${label.replace(/\s/g, '')}`}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
      />
      <datalist id={`opts-${label.replace(/\s/g, '')}`}>
        {options.map(o => <option key={o} value={o} />)}
      </datalist>
    </label>
  )
}
