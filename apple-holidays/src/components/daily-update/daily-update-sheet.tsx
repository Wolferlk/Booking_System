'use client'

/**
 * The Daily Update Sheet.
 *
 * A calendar-shaped view of the book: what is arriving in the next ten days,
 * with everything sold today pinned above it. Deliberately a *sheet* rather
 * than a dashboard — the desk reads it top to bottom every morning, fills in
 * whatever IS or CNTL number is still blank, and mails the result out, so the
 * table, the Excel file and the PDF are all the same rows in the same order.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  CalendarDays, CalendarRange, Users, AlertTriangle, Search, X, Check,
  FileSpreadsheet, FileText, RefreshCw, Loader2, Sparkles,
  Plane, PlaneLanding, Building2, Phone, Mail, MessageCircle, Pencil,
  ChevronDown, SlidersHorizontal, Globe, Clock, ArrowUpDown, Ban, ExternalLink,
  PhoneCall, Bot, Plus, Trash2, X as XIcon,
  ClipboardCheck, Send, Store, Briefcase, Layers,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { CountryFlag } from '@/components/ui/country-flag'
import { useCountryFilter } from '@/hooks/use-country-filter'
import {
  CALL_KINDS, CALL_LABELS, CALL_HINTS,
  type BookingCalls, type CallCell, type CallEntry, type CallKind,
} from '@/lib/daily-update-calls'
import {
  FEEDBACK_PURPOSE_LABELS, FEEDBACK_RATING_EMOJI, FEEDBACK_RATING_FIELDS,
  FEEDBACK_RATING_LABELS, worstRating, type FeedbackFormCell,
} from '@/lib/daily-update-feedback'
import type { BookingStatus } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = {
  id: string
  bookingRef: string
  isNumber: string | null
  cntlNumber: string | null
  agentBookingId: string | null
  operationCountry: string | null
  status: string
  arrivalDate: string
  departureDate: string
  nights: number
  createdAt: string
  updatedAt: string
  daysToArrival: number
  guestName: string | null
  guestPhone: string | null
  guestEmail: string | null
  guestWhatsapp: string | null
  agent: string | null
  agentPhone: string | null
  agentEmail: string | null
  agentWhatsapp: string | null
  fileHandler: string | null
  paxAdults: number
  paxChildren: number
  paxInfants: number
  totalPax: number
  createdToday: boolean
  amended: boolean
  hotelOnly: boolean
  cancelled: boolean
  source: 'B2B' | 'B2C'
  calls: BookingCalls
  feedbackForm: FeedbackFormCell
}

type Stats = {
  total: number
  /** Sold today — counted scope-wide, so it is not bounded by the window. */
  bookedToday: number
  arrivingToday: number
  onGround: number
  missingIds: number
  totalPax: number
}

type DateField = 'arrivalDate' | 'departureDate' | 'createdAt' | 'updatedAt'

type Filters = {
  dateField: DateField
  days: number
  from: string
  to: string
  agent: string
  search: string
  country: string
  source: SourceFilter
  includeCancelled: boolean
  sortBy: DateField
  sortDir: 'asc' | 'desc'
}

const DEFAULT_FILTERS: Filters = {
  dateField: 'arrivalDate',
  days: 10,
  from: '',
  to: '',
  agent: '',
  search: '',
  country: '',
  // B2B by default: this sheet is the agent desk's morning read, and a store
  // order has no agent to chase. The other two channels are one click away.
  source: 'B2B',
  includeCancelled: false,
  sortBy: 'arrivalDate',
  sortDir: 'asc',
}

const DATE_FIELDS: { value: DateField; label: string; short: string; icon: typeof CalendarDays }[] = [
  { value: 'arrivalDate',   label: 'Arrival date',         short: 'Arrival',   icon: PlaneLanding },
  { value: 'departureDate', label: 'Departure date',       short: 'Departure', icon: Plane },
  { value: 'createdAt',     label: 'Booking created date', short: 'Created',   icon: Sparkles },
  { value: 'updatedAt',     label: 'Last updated date',    short: 'Updated',   icon: Clock },
]

type SourceFilter = 'ALL' | 'B2B' | 'B2C'

const SOURCES: { value: SourceFilter; label: string; icon: typeof Users; hint: string }[] = [
  { value: 'ALL', label: 'All',  icon: Layers,    hint: 'Every booking, both channels' },
  { value: 'B2B', label: 'B2B',  icon: Briefcase, hint: 'Agent bookings — the default view' },
  { value: 'B2C', label: 'B2C',  icon: Store,     hint: 'Orders imported from the Aahaas storefront' },
]

const DAY_PRESETS = [
  { days: 0,  label: 'Today' },
  { days: 3,  label: '3 days' },
  { days: 7,  label: '7 days' },
  { days: 10, label: '10 days' },
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
]

const COUNTRIES = [
  { value: '',                   label: 'All countries' },
  { value: 'VIETNAM',            label: 'Vietnam' },
  { value: 'SRILANKA',           label: 'Sri Lanka' },
  { value: 'SINGAPORE',          label: 'Singapore' },
  { value: 'MALAYSIA',           label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQuery(f: Filters): string {
  const p = new URLSearchParams()
  p.set('dateField', f.dateField)
  p.set('days', String(f.days))
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  if (f.agent) p.set('agent', f.agent)
  if (f.search) p.set('search', f.search)
  if (f.country) p.set('country', f.country)
  p.set('source', f.source)
  p.set('includeCancelled', f.includeCancelled ? '1' : '0')
  p.set('sortBy', f.sortBy)
  p.set('sortDir', f.sortDir)
  return p.toString()
}

/** "TODAY" / "in 3 days" / "landed 2 days ago" — the sheet's urgency column. */
function whenLabel(days: number): string {
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1) return `in ${days} days`
  if (days === -1) return 'landed yesterday'
  return `landed ${Math.abs(days)}d ago`
}

function whenTone(days: number): string {
  if (days < 0) return 'bg-cyan-50 text-cyan-700 ring-cyan-200'
  if (days === 0) return 'bg-red-50 text-red-700 ring-red-200'
  if (days <= 2) return 'bg-orange-50 text-orange-700 ring-orange-200'
  if (days <= 5) return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-slate-50 text-slate-600 ring-slate-200'
}

function accentTone(r: Row): string {
  if (r.cancelled) return 'bg-red-400'
  if (r.daysToArrival < 0) return 'bg-cyan-400'
  if (r.daysToArrival === 0) return 'bg-red-500'
  if (r.daysToArrival <= 2) return 'bg-orange-400'
  if (r.daysToArrival <= 5) return 'bg-amber-400'
  return 'bg-slate-200'
}

// ─── Stat tile ────────────────────────────────────────────────────────────────

function Tile({
  label, value, icon: Icon, gradient, active, onClick, hint,
}: {
  label: string
  value: number
  icon: typeof Users
  gradient: string
  active?: boolean
  onClick?: () => void
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={hint}
      className={cn(
        'group relative overflow-hidden rounded-2xl p-4 text-left transition-all',
        'ring-1 ring-slate-200 bg-white',
        onClick && 'hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-300 cursor-pointer',
        active && 'ring-2 ring-slate-900 shadow-lg',
      )}
    >
      <div className={cn('absolute inset-x-0 top-0 h-1', gradient)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-2xl font-bold text-slate-900 tabular-nums leading-none">{value}</p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 truncate">{label}</p>
        </div>
        <span className={cn('flex-shrink-0 rounded-xl p-2 text-white', gradient)}>
          <Icon className="w-4 h-4" />
        </span>
      </div>
    </button>
  )
}

// ─── Inline IS / CNTL editor ──────────────────────────────────────────────────

/**
 * The one write this screen makes.
 *
 * IS and CNTL numbers arrive late — the file is created from a TC before the
 * numbers are issued — so the sheet is where the gap is spotted, and making
 * somebody open the booking page to fill in six characters is why the gaps
 * survive. Saves go through the booking PUT route, which re-checks role and
 * country server-side; this component only decides whether to show the pencil.
 */
function IdCell({
  value, field, bookingRef, canEdit, onSaved,
}: {
  value: string | null
  field: 'isNumber' | 'cntlNumber'
  bookingRef: string
  canEdit: boolean
  onSaved: (next: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value ?? '') }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const save = useCallback(async () => {
    const next = draft.trim()
    if (next === (value ?? '')) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next === '' ? null : next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) {
        throw new Error(json?.error ?? 'Could not save')
      }
      onSaved(next === '' ? null : next)
      toast.success(`${field === 'isNumber' ? 'IS' : 'CNTL'} number saved for ${bookingRef}`)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
      setDraft(value ?? '')
    } finally {
      setSaving(false)
    }
  }, [draft, value, bookingRef, field, onSaved])

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          value={draft}
          disabled={saving}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
          }}
          onBlur={() => void save()}
          placeholder={field === 'isNumber' ? 'IS number' : 'CNTL number'}
          className="w-28 rounded-lg border border-slate-900 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-slate-900/20"
        />
        {saving
          ? <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
          : <Check className="w-3.5 h-3.5 text-emerald-500" />}
      </div>
    )
  }

  if (!value) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[11px] font-medium',
          canEdit
            ? 'border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100'
            : 'border-slate-300 bg-slate-50 text-slate-400 cursor-default',
        )}
      >
        <AlertTriangle className="w-3 h-3" />
        {canEdit ? 'Add' : 'Missing'}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => setEditing(true)}
      className={cn(
        'group/id inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 font-mono text-xs font-semibold text-slate-800',
        canEdit && 'hover:bg-slate-100',
      )}
    >
      {value}
      {canEdit && <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover/id:opacity-100 transition-opacity" />}
    </button>
  )
}

// ─── Contact block ────────────────────────────────────────────────────────────

/**
 * Which booking columns a contact block writes to.
 *
 * The sheet shows the guest and the agent side by side, but they are different
 * columns on `Booking` — so the party is chosen once here rather than being
 * threaded through as six separate props.
 */
const CONTACT_FIELDS = {
  guest: { phone: 'contactPhone', whatsapp: 'contactWhatsapp', email: 'contactEmail',
           rowPhone: 'guestPhone', rowWhatsapp: 'guestWhatsapp', rowEmail: 'guestEmail' },
  agent: { phone: 'agentPhone',   whatsapp: 'agentWhatsapp',   email: 'agentEmail',
           rowPhone: 'agentPhone', rowWhatsapp: 'agentWhatsapp', rowEmail: 'agentEmail' },
} as const

type Party = keyof typeof CONTACT_FIELDS

/**
 * Guest and agent contact details, editable in place.
 *
 * Contact numbers go stale constantly — an agent forwards a new mobile, a guest
 * changes their WhatsApp mid-trip — and this sheet is where somebody notices,
 * because it is the page the desk reads before it calls anyone. All three
 * fields save in one request so a correction is one action rather than three,
 * and blanking a field clears it rather than being ignored.
 *
 * Like the IS / CNTL editor, the write goes through the booking PUT route,
 * which re-checks role and country server-side and permits contact-only
 * updates at any booking status. This component only decides whether to offer
 * the pencil.
 */
function EditableContact({
  party, bookingRef, phone, whatsapp, email, canEdit, onSaved,
}: {
  party: Party
  bookingRef: string
  phone: string | null
  whatsapp: string | null
  email: string | null
  canEdit: boolean
  onSaved: (patch: Record<string, string | null>) => void
}) {
  const map = CONTACT_FIELDS[party]
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState({ phone: phone ?? '', whatsapp: whatsapp ?? '', email: email ?? '' })
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft({ phone: phone ?? '', whatsapp: whatsapp ?? '', email: email ?? '' })
  }, [phone, whatsapp, email])

  useEffect(() => { if (editing) firstRef.current?.focus() }, [editing])

  const cancel = useCallback(() => {
    setDraft({ phone: phone ?? '', whatsapp: whatsapp ?? '', email: email ?? '' })
    setEditing(false)
  }, [phone, whatsapp, email])

  const save = useCallback(async () => {
    const next = {
      phone:    draft.phone.trim(),
      whatsapp: draft.whatsapp.trim(),
      email:    draft.email.trim(),
    }

    if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) {
      toast.error('That email address does not look right')
      return
    }

    // Only what actually changed is sent — a booking PUT carrying every field
    // would look like a full edit to the route's contact-only check.
    const body: Record<string, string | null> = {}
    const rowPatch: Record<string, string | null> = {}
    const compare: [keyof typeof next, string, string, string | null][] = [
      ['phone',    map.phone,    map.rowPhone,    phone],
      ['whatsapp', map.whatsapp, map.rowWhatsapp, whatsapp],
      ['email',    map.email,    map.rowEmail,    email],
    ]
    for (const [key, field, rowKey, current] of compare) {
      if (next[key] !== (current ?? '')) {
        body[field] = next[key] === '' ? null : next[key]
        rowPatch[rowKey] = next[key] === '' ? null : next[key]
      }
    }

    if (Object.keys(body).length === 0) { setEditing(false); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) throw new Error(json?.error ?? 'Could not save')

      onSaved(rowPatch)
      toast.success(`${party === 'guest' ? 'Guest' : 'Agent'} contact updated for ${bookingRef}`)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
      cancel()
    } finally {
      setSaving(false)
    }
  }, [draft, phone, whatsapp, email, map, bookingRef, party, onSaved, cancel])

  if (editing) {
    const field = (
      key: 'phone' | 'whatsapp' | 'email',
      Icon: typeof Phone,
      placeholder: string,
      tone: string,
    ) => (
      <div className="flex items-center gap-1.5">
        <Icon className={cn('w-3 h-3 flex-shrink-0', tone)} />
        <input
          ref={key === 'phone' ? firstRef : undefined}
          value={draft[key]}
          disabled={saving}
          onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void save() }
            if (e.key === 'Escape') cancel()
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-slate-300 px-1.5 py-1 text-[11px] focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900/20 disabled:bg-slate-50"
        />
      </div>
    )

    return (
      <div className="w-[190px] space-y-1 rounded-lg border border-slate-900 bg-white p-1.5 shadow-lg">
        {field('phone', Phone, 'Phone', 'text-slate-400')}
        {field('whatsapp', MessageCircle, 'WhatsApp', 'text-emerald-500')}
        {field('email', Mail, 'Email', 'text-slate-400')}
        <div className="flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Save
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  const empty = !phone && !whatsapp && !email

  return (
    <div className="group/contact flex items-start gap-1">
      <div className="min-w-0 flex-1 space-y-0.5">
        {empty && <span className="text-xs text-slate-300">—</span>}
        {phone && (
          <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900">
            <Phone className="w-3 h-3 flex-shrink-0 text-slate-400" />
            <span className="truncate">{phone}</span>
          </a>
        )}
        {whatsapp && whatsapp !== phone && (
          <a
            href={`https://wa.me/${whatsapp.replace(/[^\d]/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700"
          >
            <MessageCircle className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{whatsapp}</span>
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800">
            <Mail className="w-3 h-3 flex-shrink-0 text-slate-400" />
            <span className="truncate max-w-[150px]">{email}</span>
          </a>
        )}
      </div>

      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={`Edit ${party} phone, WhatsApp and email`}
          className={cn(
            'mt-0.5 flex-shrink-0 rounded p-1 transition-opacity hover:bg-slate-100',
            // An empty block gives no other affordance, so its pencil stays put.
            empty ? 'text-amber-500' : 'text-slate-300 opacity-0 group-hover/contact:opacity-100',
          )}
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}


// ─── Call columns ─────────────────────────────────────────────────────────────

/** "18 Aug, 14:30" — calls are read at a glance, so the year is dropped. */
function callStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** The value a datetime-local input wants, in the viewer's own timezone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'bg-emerald-100 text-emerald-700',
  neutral:  'bg-slate-100 text-slate-600',
  negative: 'bg-rose-100 text-rose-700',
}

/**
 * One call column for one booking.
 *
 * Done calls collapse to their latest summary plus when it happened, because
 * that is what the desk scans for; the count badge is what makes the on-ground
 * column meaningful, where several calls are normal. Everything else — the full
 * history, the AI transcript summaries, add and edit — lives behind the cell,
 * so ten columns of detail do not turn the sheet into a wall of text.
 */
function CallCellView({
  kind, cell, bookingRef, guestName, canEdit, onChanged,
}: {
  kind: CallKind
  cell: CallCell
  bookingRef: string
  guestName: string | null
  canEdit: boolean
  onChanged: (kind: CallKind, entries: CallEntry[]) => void
}) {
  const [open, setOpen] = useState(false)
  const done = cell.count > 0
  const latest = cell.latest

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={done ? `${cell.count} logged · click for the full history` : CALL_HINTS[kind]}
        className={cn(
          'group/call w-full rounded-lg px-1.5 py-1 text-left transition-colors',
          done ? 'hover:bg-slate-100' : 'hover:bg-amber-50',
        )}
      >
        {done && latest ? (
          <>
            <div className="flex items-center gap-1">
              <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
              </span>
              <span className="text-[10px] font-semibold text-slate-700">{callStamp(latest.at)}</span>
              {cell.count > 1 && (
                <span className="rounded-full bg-slate-800 px-1.5 text-[9px] font-bold text-white">
                  ×{cell.count}
                </span>
              )}
              {latest.source === 'AI' && (
                <Bot className="w-3 h-3 flex-shrink-0 text-violet-500" aria-label="Placed by the AI call bot" />
              )}
            </div>
            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{latest.summary}</p>
            {latest.sentiment && (
              <span className={cn(
                'mt-0.5 inline-block rounded px-1 text-[8px] font-bold uppercase',
                SENTIMENT_TONE[latest.sentiment] ?? 'bg-slate-100 text-slate-600',
              )}>
                {latest.sentiment}
              </span>
            )}
          </>
        ) : (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[10px] font-medium',
            canEdit
              ? 'border-amber-400 bg-amber-50 text-amber-700'
              : 'border-slate-200 bg-slate-50 text-slate-400',
          )}>
            {canEdit ? <Plus className="w-3 h-3" /> : null}
            {canEdit ? 'Log call' : 'Not done'}
          </span>
        )}
      </button>

      {open && (
        <CallHistoryModal
          kind={kind}
          cell={cell}
          bookingRef={bookingRef}
          guestName={guestName}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  )
}

/**
 * The full history for one call column, with add / edit / delete.
 *
 * AI records are shown alongside manual ones but carry no controls — this sheet
 * reports the bot's calls, it does not own them, and letting somebody "correct"
 * a transcript summary here would put the two out of step with no audit trail.
 */
function CallHistoryModal({
  kind, cell, bookingRef, guestName, canEdit, onClose, onChanged,
}: {
  kind: CallKind
  cell: CallCell
  bookingRef: string
  guestName: string | null
  canEdit: boolean
  onClose: () => void
  onChanged: (kind: CallKind, entries: CallEntry[]) => void
}) {
  const [entries, setEntries] = useState<CallEntry[]>(cell.entries)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ summary: '', notes: '', at: toLocalInput(new Date().toISOString()) })

  const publish = useCallback((next: CallEntry[]) => {
    const sorted = [...next].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    setEntries(sorted)
    onChanged(kind, sorted)
  }, [kind, onChanged])

  const resetForm = () => {
    setEditingId(null)
    setForm({ summary: '', notes: '', at: toLocalInput(new Date().toISOString()) })
  }

  const submit = useCallback(async () => {
    if (!form.summary.trim()) { toast.error('Add a short summary of the call'); return }
    setBusy(true)
    try {
      const editing = editingId !== null
      const res = await fetch('/api/daily-update/calls', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { id: editingId } : { bookingRef, kind }),
          summary: form.summary.trim(),
          notes:   form.notes.trim(),
          // datetime-local has no timezone, so it is read as local time — which
          // is what the person logging the call meant.
          at: form.at ? new Date(form.at).toISOString() : new Date().toISOString(),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) throw new Error(json?.error ?? 'Could not save the call')

      const saved = json.data as CallEntry
      publish(editing ? entries.map(e => (e.id === editingId ? saved : e)) : [saved, ...entries])
      toast.success(editing ? 'Call updated' : `${CALL_LABELS[kind]} logged for ${bookingRef}`)
      resetForm()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the call')
    } finally {
      setBusy(false)
    }
  }, [form, editingId, entries, bookingRef, kind, publish])

  const remove = useCallback(async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/daily-update/calls?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) throw new Error(json?.error ?? 'Could not remove the entry')
      publish(entries.filter(e => e.id !== id))
      if (editingId === id) resetForm()
      toast.success('Call entry removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the entry')
    } finally {
      setBusy(false)
    }
  }, [entries, editingId, publish])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <PhoneCall className="w-4 h-4 text-slate-400" />
              {CALL_LABELS[kind]}
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              <span className="font-mono font-semibold">{bookingRef}</span>
              {guestName ? ` · ${guestName}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">{CALL_HINTS[kind]}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[42vh] space-y-2 overflow-y-auto px-5 py-3">
          {entries.length === 0 && (
            <p className="py-6 text-center text-xs text-slate-400">
              No {CALL_LABELS[kind].toLowerCase()} logged yet.
            </p>
          )}
          {entries.map(e => (
            <div
              key={e.id}
              className={cn(
                'rounded-xl border p-3',
                e.source === 'AI' ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-white',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-800">{callStamp(e.at)}</span>
                {e.source === 'AI' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">
                    <Bot className="w-3 h-3" /> AI bot
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                    Manual
                  </span>
                )}
                {e.sentiment && (
                  <span className={cn(
                    'rounded px-1.5 text-[10px] font-bold uppercase',
                    SENTIMENT_TONE[e.sentiment] ?? 'bg-slate-100 text-slate-600',
                  )}>
                    {e.sentiment}
                  </span>
                )}
                {e.outcome && <span className="text-[10px] text-slate-400">{e.outcome}</span>}

                {canEdit && e.source === 'MANUAL' && (
                  <span className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(e.id)
                        setForm({ summary: e.summary, notes: e.notes ?? '', at: toLocalInput(e.at) })
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="Edit this entry"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(e.id)}
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      title="Remove this entry"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-700">{e.summary}</p>
              {e.notes && <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-500">{e.notes}</p>}
              {e.by && <p className="mt-1.5 text-[10px] text-slate-400">Logged by {e.by}</p>}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {editingId ? 'Edit entry' : `Log a ${CALL_LABELS[kind].toLowerCase()}`}
            </p>
            <input
              value={form.summary}
              onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
              placeholder="What came out of the call?"
              maxLength={500}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Further notes (optional)"
              rows={2}
              className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="datetime-local"
                  value={form.at}
                  onChange={e => setForm(f => ({ ...f, at: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-slate-900 focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {editingId ? 'Save changes' : 'Log call'}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={busy}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Guest feedback form column ───────────────────────────────────────────────

const FF_TONE: Record<string, string> = {
  EXCELLENT: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
  GOOD:      'bg-sky-100 text-sky-700 ring-sky-200',
  AVERAGE:   'bg-amber-100 text-amber-700 ring-amber-200',
  POOR:      'bg-rose-100 text-rose-700 ring-rose-200',
}

function FfBadge({ value, large }: { value: string; large?: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full font-bold ring-1',
      large ? 'px-2.5 py-1 text-[11px]' : 'px-1.5 py-0.5 text-[9px]',
      FF_TONE[value] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
    )}>
      <span>{FEEDBACK_RATING_EMOJI[value] ?? ''}</span>
      {FEEDBACK_RATING_LABELS[value] ?? value}
    </span>
  )
}

/**
 * The digital Guest Feedback Form, per booking.
 *
 * The form is sent to the guest on WhatsApp after departure and filled in on
 * the public `/feedback/[ref]` page; this column is the answer coming back. The
 * cell is deliberately tri-state — never sent, sent and waiting, or in — because
 * "no rating yet" means two completely different jobs depending on which it is.
 *
 * The tone follows the *weakest* rating anywhere on the form, not the overall
 * one: a trip rated Excellent overall with a Poor driver is exactly the row the
 * desk needs to notice while scanning.
 */
function FeedbackFormCellView({
  cell, bookingRef, guestName, canEdit, onSent,
}: {
  cell: FeedbackFormCell
  bookingRef: string
  guestName: string | null
  canEdit: boolean
  onSent: (at: string) => void
}) {
  const [open, setOpen] = useState(false)
  const form = cell.form
  const worst = form ? worstRating(form) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={
          form ? 'Feedback form received — click for every section'
          : cell.sentAt ? 'Form sent, no response yet — click to see the status or resend'
          : 'The digital feedback form has not been sent to this guest yet'
        }
        className="group/ff w-full rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-slate-100"
      >
        {form ? (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <FfBadge value={worst ?? form.overall ?? 'GOOD'} />
              <span className="text-[10px] font-semibold text-slate-700">{callStamp(form.submittedAt)}</span>
            </div>
            {form.remarks && (
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{form.remarks}</p>
            )}
          </>
        ) : cell.sentAt ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-dashed border-amber-300 bg-amber-50/70 px-2 py-1 text-[10px] font-medium text-amber-700">
            <Clock className="w-3 h-3" /> Sent {callStamp(cell.sentAt)}
          </span>
        ) : (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[10px] font-medium',
            canEdit ? 'border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 bg-slate-50 text-slate-400',
          )}>
            {canEdit ? <Send className="w-3 h-3" /> : null} Not sent
          </span>
        )}
      </button>

      {open && (
        <FeedbackFormModal
          cell={cell}
          bookingRef={bookingRef}
          guestName={guestName}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
          onSent={onSent}
        />
      )}
    </>
  )
}

/**
 * The full form for one booking, plus the one action this column offers:
 * sending the guest the WhatsApp link to fill it in.
 *
 * The send is a two-step confirm rather than a single button. It messages a real
 * guest, and it is reachable from a dense sheet where the neighbouring cells all
 * open harmless read-only panels — a mis-click has to cost a second click, not a
 * WhatsApp to somebody who already answered.
 */
function FeedbackFormModal({
  cell, bookingRef, guestName, canEdit, onClose, onSent,
}: {
  cell: FeedbackFormCell
  bookingRef: string
  guestName: string | null
  canEdit: boolean
  onClose: () => void
  onSent: (at: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sentAt, setSentAt] = useState(cell.sentAt)
  const form = cell.form

  const send = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/whatsapp-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'feedback' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.success === false) throw new Error(json?.error ?? 'Could not send the form')
      const at = new Date().toISOString()
      setSentAt(at)
      onSent(at)
      setConfirming(false)
      toast.success(`Feedback form sent to ${guestName ?? bookingRef}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the form')
    } finally {
      setBusy(false)
    }
  }, [bookingRef, guestName, onSent])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ClipboardCheck className="w-4 h-4 text-slate-400" />
              Feedback Form
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              <span className="font-mono font-semibold">{bookingRef}</span>
              {guestName ? ` · ${guestName}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              The digital Guest Feedback Form, sent to the guest on WhatsApp after departure.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto px-5 py-4">
          {form ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Overall experience</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Submitted {formatDateTime(form.submittedAt)}
                    {form.clientName ? ` by ${form.clientName}` : ''}
                  </p>
                </div>
                {form.overall
                  ? <FfBadge value={form.overall} large />
                  : <span className="text-xs text-slate-400">Not answered</span>}
              </div>

              {form.purpose && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Purpose of stay</span>
                  <span className="font-semibold text-slate-700">
                    {FEEDBACK_PURPOSE_LABELS[form.purpose] ?? form.purpose}
                  </span>
                </div>
              )}

              <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                {FEEDBACK_RATING_FIELDS.map(({ key, label }) => {
                  const value = form.ratings[key]
                  return (
                    <div key={key} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-500">{label}</span>
                      {value ? <FfBadge value={value} /> : <span className="text-slate-300">—</span>}
                    </div>
                  )
                })}
              </div>

              {form.remarks && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Remarks</p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-700">{form.remarks}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center">
              <ClipboardCheck className="mx-auto w-8 h-8 text-slate-200" />
              <p className="mt-2 text-sm font-semibold text-slate-600">
                {sentAt ? 'Sent — no response yet' : 'Not sent yet'}
              </p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
                {sentAt
                  ? `The form link went out on ${formatDateTime(sentAt)}. Nothing has come back.`
                  : 'The guest has not been sent the digital feedback form for this booking.'}
              </p>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
            <p className="text-[11px] text-slate-500">
              {sentAt ? `Last sent ${formatDateTime(sentAt)}` : 'Never sent'}
            </p>
            {confirming ? (
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-xl px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send to the guest on WhatsApp
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                <Send className="w-3.5 h-3.5" />
                {sentAt || form ? 'Send the form again' : 'Send the feedback form'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DailyUpdateSheet() {
  const { data: session } = useSession()
  const { canFilter } = useCountryFilter()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [searchDraft, setSearchDraft] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [agents, setAgents] = useState<{ name: string; count: number }[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [range, setRange] = useState<{ start: string; end: string } | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | 'html' | null>(null)

  const patch = useCallback((next: Partial<Filters>) => {
    setFilters(f => ({ ...f, ...next }))
  }, [])

  // Debounce the search box so typing a booking ref does not fire a query per key.
  useEffect(() => {
    const t = setTimeout(() => patch({ search: searchDraft.trim() }), 350)
    return () => clearTimeout(t)
  }, [searchDraft, patch])

  const query = useMemo(() => buildQuery(filters), [filters])

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/daily-update?${query}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load the sheet')
      setRows(json.data.rows)
      setAgents(json.data.agents)
      setStats(json.data.stats)
      setRange(json.data.range)
      setCanEdit(Boolean(json.data.canEdit))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the sheet')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  /**
   * Downloads go through fetch rather than a plain link so a 403 or a render
   * failure surfaces as a toast instead of a browser tab full of JSON.
   */
  const download = useCallback(async (kind: 'xlsx' | 'pdf' | 'html') => {
    setDownloading(kind)
    try {
      const url =
        kind === 'xlsx' ? `/api/daily-update/export?${query}`
        : kind === 'pdf' ? `/api/daily-update/export-pdf?${query}`
        : `/api/daily-update/export-html?${query}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json?.error ?? `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = `daily-update-${new Date().toISOString().slice(0, 10)}.${kind}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
      toast.success(
        kind === 'xlsx' ? 'Excel sheet downloaded'
        : kind === 'pdf' ? 'PDF sheet downloaded'
        : 'HTML sheet downloaded',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setDownloading(null)
    }
  }, [query])

  const applyEdit = useCallback((id: string, patch: Partial<Row>) => {
    setRows(rs => {
      const next = rs.map(r => (r.id === id ? { ...r, ...patch } : r))
      setStats(st => (st
        ? { ...st, missingIds: next.filter(r => !r.isNumber || !r.cntlNumber).length }
        : st))
      return next
    })
  }, [])

  const visible = useMemo(
    () => (onlyMissing ? rows.filter(r => !r.isNumber || !r.cntlNumber) : rows),
    [rows, onlyMissing],
  )

  const activeField = DATE_FIELDS.find(f => f.value === filters.dateField) ?? DATE_FIELDS[0]
  const usingCustomRange = Boolean(filters.from || filters.to)
  const isDefaultView =
    JSON.stringify({ ...filters, search: '' }) === JSON.stringify({ ...DEFAULT_FILTERS, search: '' }) && !onlyMissing

  return (
    <div className="space-y-5">
      {/* ── Summary tiles ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="On the sheet" value={stats?.total ?? 0} icon={CalendarRange}
          gradient="bg-gradient-to-br from-slate-700 to-slate-900"
          hint="Bookings matching the current window and filters"
        />
        {/* The only figure that deliberately looks outside the window. Clicking
            it retunes the sheet to the Created / Today view, which is where
            today's intake now lives — it is no longer a second band of rows. */}
        <Tile
          label="Booked today" value={stats?.bookedToday ?? 0} icon={Sparkles}
          gradient="bg-gradient-to-br from-emerald-500 to-green-600"
          active={filters.dateField === 'createdAt' && filters.days === 0 && !filters.from && !filters.to}
          onClick={() => patch({ dateField: 'createdAt', sortBy: 'createdAt', days: 0, from: '', to: '' })}
          hint="Bookings sold today, whatever window the sheet is showing — click to list them"
        />
        <Tile
          label="Arriving today" value={stats?.arrivingToday ?? 0} icon={PlaneLanding}
          gradient="bg-gradient-to-br from-rose-500 to-red-600"
          hint="Guests landing today"
        />
        <Tile
          label="On the ground" value={stats?.onGround ?? 0} icon={Building2}
          gradient="bg-gradient-to-br from-cyan-500 to-sky-600"
          hint="Already arrived and not yet departed"
        />
        <Tile
          label="Total pax" value={stats?.totalPax ?? 0} icon={Users}
          gradient="bg-gradient-to-br from-violet-500 to-purple-600"
        />
        <Tile
          label="Missing IS / CNTL" value={stats?.missingIds ?? 0} icon={AlertTriangle}
          gradient="bg-gradient-to-br from-amber-400 to-orange-500"
          active={onlyMissing}
          onClick={() => setOnlyMissing(v => !v)}
          hint="Click to show only files with a blank IS or CNTL number"
        />
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Which date the window is measured against */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
              {DATE_FIELDS.map(f => {
                const Icon = f.icon
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => patch({ dateField: f.value, sortBy: f.value })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
                      filters.dateField === f.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                    )}
                    title={`Filter by ${f.label.toLowerCase()}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">{f.short}</span>
                  </button>
                )
              })}
            </div>

            {/* Sales channel — B2B agent bookings by default, B2C store orders
                and the combined view one click away. */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
              {SOURCES.map(sc => {
                const Icon = sc.icon
                return (
                  <button
                    key={sc.value}
                    type="button"
                    onClick={() => patch({ source: sc.value })}
                    title={sc.hint}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
                      filters.source === sc.value
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {sc.label}
                  </button>
                )
              })}
            </div>

            {/* Day window */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
              {DAY_PRESETS.map(p => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => patch({ days: p.days, from: '', to: '' })}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all',
                    !usingCustomRange && filters.days === p.days
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchDraft}
                onChange={e => setSearchDraft(e.target.value)}
                placeholder="Ref, IS, CNTL, guest, agent, phone…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => setSearchDraft('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                showAdvanced || filters.agent || filters.country || usingCustomRange
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filters
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showAdvanced && 'rotate-180')} />
            </button>

            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              <span className="hidden sm:inline">Refresh</span>
            </button>

            <div className="inline-flex overflow-hidden rounded-xl shadow-sm">
              <button
                type="button"
                onClick={() => void download('xlsx')}
                disabled={downloading !== null}
                className="inline-flex items-center gap-1.5 bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {downloading === 'xlsx'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileSpreadsheet className="w-3.5 h-3.5" />}
                Excel
              </button>
              <button
                type="button"
                onClick={() => void download('pdf')}
                disabled={downloading !== null}
                title="Rendered from the same designed sheet the HTML view shows"
                className="inline-flex items-center gap-1.5 bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {downloading === 'pdf'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileText className="w-3.5 h-3.5" />}
                PDF
              </button>
              {/* The HTML view is the document the PDF is printed from. Opened
                  rather than downloaded: it carries its own print button, so it
                  also serves as the browser "save as PDF" route. */}
              <a
                href={`/api/daily-update/export-html?${query}&view=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open the designed sheet in a new tab — print or save from there"
                className="inline-flex items-center gap-1.5 bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                HTML
              </a>
            </div>
          </div>

          {showAdvanced && (
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* Agent */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agent</span>
                <select
                  value={filters.agent}
                  onChange={e => patch({ agent: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                >
                  <option value="">All agents</option>
                  {agents.map(a => (
                    <option key={a.name} value={a.name}>{a.name} ({a.count})</option>
                  ))}
                </select>
              </label>

              {/* Country — only the two admin roles may cross countries; everyone
                  else is already scoped server-side, so the control is hidden. */}
              {canFilter && (
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Country</span>
                  <select
                    value={filters.country}
                    onChange={e => patch({ country: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                  >
                    {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </label>
              )}

              {/* Explicit range */}
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {activeField.short} from
                </span>
                <input
                  type="date"
                  value={filters.from}
                  onChange={e => patch({ from: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {activeField.short} to
                </span>
                <input
                  type="date"
                  value={filters.to}
                  onChange={e => patch({ to: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-900 focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center gap-4 sm:col-span-2 xl:col-span-4">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    checked={filters.includeCancelled}
                    onChange={e => patch({ includeCancelled: e.target.checked })}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  Include cancelled bookings
                </label>
                <button
                  type="button"
                  onClick={() => { setFilters(DEFAULT_FILTERS); setSearchDraft(''); setOnlyMissing(false) }}
                  disabled={isDefaultView}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" /> Reset to default view
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Context line — what this sheet currently covers */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-4 py-2 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
            <CalendarDays className="w-3.5 h-3.5" />
            {activeField.label}
          </span>
          {range && (
            <span>{formatDate(range.start)} → {formatDate(range.end)}</span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
            {filters.source === 'B2C' ? <Store className="w-3 h-3" />
              : filters.source === 'B2B' ? <Briefcase className="w-3 h-3" />
              : <Layers className="w-3 h-3" />}
            {filters.source === 'ALL' ? 'All channels' : `${filters.source} only`}
          </span>
          {filters.agent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {filters.agent}
              <button type="button" onClick={() => patch({ agent: '' })}><X className="w-3 h-3" /></button>
            </span>
          )}
          {filters.country && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              <Globe className="w-3 h-3" /> {filters.country.replace('_', ' & ')}
              <button type="button" onClick={() => patch({ country: '' })}><X className="w-3 h-3" /></button>
            </span>
          )}
          {onlyMissing && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
              Missing IS / CNTL only
              <button type="button" onClick={() => setOnlyMissing(false)}><X className="w-3 h-3" /></button>
            </span>
          )}
          <span className="ml-auto">{visible.length} row{visible.length === 1 ? '' : 's'}</span>
        </div>
      </Card>

      {/* ── The sheet ─────────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <p className="text-sm">Building today&apos;s sheet…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <p className="text-sm text-slate-600">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <CalendarRange className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold text-slate-600">Nothing on the sheet</p>
            <p className="max-w-sm text-xs text-slate-400">
              No bookings fall inside this window. Widen the day range, switch the date the window is measured
              against, or clear the filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1680px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                  <th className="px-3 py-2.5 w-10">#</th>
                  <th className="px-3 py-2.5">Booking</th>
                  <th className="px-3 py-2.5">IS number</th>
                  <th className="px-3 py-2.5">CNTL number</th>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => patch({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      Travel dates <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Guest</th>
                  <th className="px-3 py-2.5">Guest contact</th>
                  <th className="px-3 py-2.5">Agent</th>
                  <th className="px-3 py-2.5">Agent contact</th>
                  {CALL_KINDS.map(kind => (
                    <th key={kind} className="px-3 py-2.5" title={CALL_HINTS[kind]}>
                      {CALL_LABELS[kind]}
                    </th>
                  ))}
                  <th
                    className="px-3 py-2.5"
                    title="The digital Guest Feedback Form — sent to the guest on WhatsApp, filled in online"
                  >
                    Feedback Form
                  </th>
                  <th className="px-3 py-2.5">Created / Updated</th>
                </tr>
              </thead>

              <SheetSection
                title={`${activeField.label} — ${range ? `${formatDate(range.start)} to ${formatDate(range.end)}` : 'window'}`}
                rows={visible}
                canEdit={canEdit}
                onEdit={applyEdit}
              />
            </table>
          </div>
        )}
      </Card>

      <p className="px-1 text-[11px] text-slate-400">
        {canEdit
          ? 'IS / CNTL numbers and guest and agent contacts can be edited in place — click a value or the pencil. '
          : ''}
        Contains guest and agent contact details — internal use only. Downloads carry exactly the rows and order
        shown above.
        {session?.user?.name ? ` Viewed by ${session.user.name}.` : ''}
      </p>
    </div>
  )
}

// ─── One banded group of rows ─────────────────────────────────────────────────

function SheetSection({
  title, rows, canEdit, onEdit,
}: {
  title: string
  rows: Row[]
  canEdit: boolean
  onEdit: (id: string, patch: Partial<Row>) => void
}) {
  return (
    <tbody className="divide-y divide-slate-100">
      <tr>
        <td colSpan={14} className="p-0">
          <div className="flex items-center gap-2 bg-gradient-to-r from-slate-700 to-slate-500 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white">
            <CalendarRange className="w-3 h-3" />
            {title}
            <span className="ml-1 rounded-full bg-white/25 px-1.5 py-px text-[9px]">{rows.length}</span>
          </div>
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr
          key={r.id}
          className={cn(
            'group transition-colors hover:bg-slate-50',
            r.cancelled && 'bg-red-50/40',
            r.createdToday && !r.cancelled && 'bg-emerald-50/30',
          )}
        >
          <td className="relative px-3 py-2.5 align-top text-xs text-slate-400 tabular-nums">
            <span className={cn('absolute inset-y-0 left-0 w-1', accentTone(r))} />
            {i + 1}
          </td>

          {/* Booking */}
          <td className="px-3 py-2.5 align-top">
            <a
              href={`/dashboard/bookings/${encodeURIComponent(r.bookingRef)}`}
              className={cn(
                'font-mono text-xs font-bold hover:underline',
                r.cancelled ? 'text-red-700 line-through' : 'text-slate-900',
              )}
            >
              {r.bookingRef}
            </a>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {r.operationCountry && (
                <span className="inline-flex items-center" title={r.operationCountry}>
                  <CountryFlag country={r.operationCountry} className="w-4 h-3 rounded-[1px]" />
                </span>
              )}
              <StatusBadge status={r.status as BookingStatus} className="scale-90 origin-left" />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {r.createdToday && !r.cancelled && (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">New today</span>
              )}
              {r.amended && !r.createdToday && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700">Amended</span>
              )}
              {r.hotelOnly && (
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-700">Hotel only</span>
              )}
              {r.cancelled && (
                <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-red-700">
                  <Ban className="w-2.5 h-2.5" /> Cancelled
                </span>
              )}
            </div>
          </td>

          {/* IS + CNTL — editable in place when they are blank */}
          <td className="px-3 py-2.5 align-top">
            <IdCell
              value={r.isNumber} field="isNumber" bookingRef={r.bookingRef} canEdit={canEdit}
              onSaved={next => onEdit(r.id, { isNumber: next })}
            />
          </td>
          <td className="px-3 py-2.5 align-top">
            <IdCell
              value={r.cntlNumber} field="cntlNumber" bookingRef={r.bookingRef} canEdit={canEdit}
              onSaved={next => onEdit(r.id, { cntlNumber: next })}
            />
            {r.agentBookingId && (
              <div className="mt-0.5 text-[10px] text-slate-400">Agent ID {r.agentBookingId}</div>
            )}
          </td>

          {/* Travel window */}
          <td className="px-3 py-2.5 align-top">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
              <PlaneLanding className="w-3 h-3 text-slate-400" />
              {formatDate(r.arrivalDate)}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <Plane className="w-3 h-3 text-slate-300" />
              {formatDate(r.departureDate)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-bold ring-1', whenTone(r.daysToArrival))}>
                {whenLabel(r.daysToArrival)}
              </span>
              <span className="text-[10px] text-slate-400">
                {r.nights}N · {r.totalPax} pax
              </span>
            </div>
          </td>

          {/* Guest */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-xs font-semibold text-slate-900">{r.guestName ?? '—'}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {r.paxAdults}A · {r.paxChildren}C · {r.paxInfants}I
            </p>
            {r.fileHandler && (
              <p className="mt-0.5 text-[10px] text-slate-400">Handler: {r.fileHandler}</p>
            )}
          </td>
          <td className="px-3 py-2.5 align-top">
            <EditableContact
              party="guest" bookingRef={r.bookingRef} canEdit={canEdit}
              phone={r.guestPhone} whatsapp={r.guestWhatsapp} email={r.guestEmail}
              onSaved={patch => onEdit(r.id, patch as Partial<Row>)}
            />
          </td>

          {/* Agent */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-xs font-semibold text-slate-900">{r.agent ?? '—'}</p>
          </td>
          <td className="px-3 py-2.5 align-top">
            <EditableContact
              party="agent" bookingRef={r.bookingRef} canEdit={canEdit}
              phone={r.agentPhone} whatsapp={r.agentWhatsapp} email={r.agentEmail}
              onSaved={patch => onEdit(r.id, patch as Partial<Row>)}
            />
          </td>

          {/* Calls — pre-trip, on-ground, post-tour */}
          {CALL_KINDS.map(kind => (
            <td key={kind} className="px-2 py-2.5 align-top">
              <CallCellView
                kind={kind}
                cell={r.calls[kind]}
                bookingRef={r.bookingRef}
                guestName={r.guestName}
                canEdit={canEdit}
                onChanged={(k, entries) => onEdit(r.id, {
                  calls: {
                    ...r.calls,
                    [k]: { entries, count: entries.length, latest: entries[0] ?? null },
                  },
                })}
              />
            </td>
          ))}

          {/* The digital feedback form the guest fills in after departure */}
          <td className="px-2 py-2.5 align-top">
            <FeedbackFormCellView
              cell={r.feedbackForm}
              bookingRef={r.bookingRef}
              guestName={r.guestName}
              canEdit={canEdit}
              onSent={at => onEdit(r.id, { feedbackForm: { ...r.feedbackForm, sentAt: at } })}
            />
          </td>

          {/* Audit dates */}
          <td className="px-3 py-2.5 align-top">
            <p className="text-[10px] text-slate-500">Created {formatDateTime(r.createdAt)}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">Updated {formatDateTime(r.updatedAt)}</p>
          </td>
        </tr>
      ))}
    </tbody>
  )
}
