'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, BedDouble, CalendarDays, Car, Check, CheckCheck, ChevronDown, Copy, CornerDownLeft,
  FileCheck2, FileText, Link2, Loader2, Map as MapIcon, MessageCircle, Plane, Plus, RefreshCw, Search, Send, Sparkles,
  Sun, Trash2, UserPlus, Users, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { countryFlag } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'
import {
  GROUP_COLORS, KIND_META, PARTICIPANT_ROLES, SETUP_NEEDED_ERROR, memberBlocker,
  type ContactSuggestion, type GroupCandidate, type GroupColor, type GroupDetail, type GroupKind, type GroupMember,
  type GroupParticipant, type GroupSendOutcome, type GroupSummary, type GuestBrief, type ParticipantRole, type ReplySuggestions,
  type TimelineItem,
} from '@/lib/wa-groups/shared'
import { avatarGradient, fmtListStamp, initials } from './shared'

const KIND_ICON: Record<GroupKind, typeof Sun> = {
  daily: Sun, day7: FileText, day3: FileCheck2, flights: Plane, hotels: BedDouble, itinerary: MapIcon, driver: Car,
}
const KIND_TINT: Record<GroupKind, string> = {
  daily:     'from-amber-400 to-orange-500 shadow-orange-500/30',
  day7:      'from-sky-400 to-blue-600 shadow-blue-500/30',
  day3:      'from-indigo-400 to-violet-600 shadow-violet-500/30',
  driver:    'from-emerald-400 to-green-600 shadow-emerald-500/30',
  flights:   'from-cyan-400 to-sky-600 shadow-sky-500/30',
  hotels:    'from-rose-400 to-pink-600 shadow-pink-500/30',
  itinerary: 'from-lime-400 to-emerald-600 shadow-emerald-500/30',
}
const AUTO_FIELD = { daily: 'autoDaily', day7: 'autoDay7', day3: 'autoDay3', driver: 'autoDriver' } as const
const AUTO_RULE: Record<string, string> = {
  daily:  'Every trip day. A morning time sends that day, an afternoon time the next day.',
  day7:   'Goes out 7 days before arrival.',
  day3:   'Goes out 3 days before arrival, once drivers are fully assigned.',
  driver: 'From the day before arrival once all drivers are assigned, and again if they change.',
}

const ROLE_TONE: Record<string, string> = {
  guest: 'text-emerald-700', family: 'text-teal-700', driver: 'text-orange-700', guide: 'text-violet-700',
  agent: 'text-sky-700', staff: 'text-slate-700', other: 'text-slate-600',
}

type Api<T> = { success: boolean; data?: T; error?: string; message?: string }

async function api<T>(url: string, init?: RequestInit): Promise<Api<T>> {
  try {
    const res = await fetch(url, {
      cache: 'no-store', ...init,
      ...(init?.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
    })
    return await res.json()
  } catch {
    return { success: false, error: 'Network error. Check your connection and try again.' }
  }
}

const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const flag = (c: string | null) => countryFlag(c as OperationCountry | null)
const isSent = (status?: string) => Boolean(status) && status !== 'failed' && status !== 'retried'

/** Renders WhatsApp's *bold* so the preview reads as the guest will see it. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
        /^\*[^*\n]+\*$/.test(part) ? <strong key={i}>{part.slice(1, -1)}</strong> : <span key={i}>{part}</span>)}
    </>
  )
}

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}
    >
      <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${on ? 'right-0.5' : 'left-0.5'}`} />
    </button>
  )
}

function Sheet({ title, subtitle, icon, wide, onClose, children, footer }: {
  title: string; subtitle?: string; icon: React.ReactNode; wide?: boolean
  onClose: () => void; children: React.ReactNode; footer?: React.ReactNode
}) {
  // Portalled: the inbox's blurred panes would otherwise trap a fixed overlay inside them.
  return createPortal(
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 px-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
    >
      <motion.div
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}
        initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }} onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-3.5">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-slate-900">{title}</p>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

const btnGhost = 'rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50'
const btnPrimary = 'flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-50'

function ColorPicker({ value, onChange }: { value: GroupColor; onChange: (c: GroupColor) => void }) {
  return (
    <div className="flex gap-2">
      {(Object.keys(GROUP_COLORS) as GroupColor[]).map(c => (
        <button
          key={c} type="button" aria-label={c} title={c} onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full bg-gradient-to-br ring-offset-2 transition ${GROUP_COLORS[c].hero} ${value === c ? 'ring-2 ring-slate-800' : 'hover:scale-110'}`}
        />
      ))}
    </div>
  )
}

/** One group, shared by the contact list, the overview and the trip panel. */
export function useGroupDetail(groupId: string | null) {
  const [group, setGroup] = useState<GroupDetail | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    if (!groupId) return
    const res = await api<GroupDetail>(`/api/whatsapp/groups/${groupId}`)
    if (res.success && res.data) { setGroup(res.data); setMissing(false) }
    else setMissing(true)
  }, [groupId])

  useEffect(() => { setGroup(null); setMissing(false); reload() }, [groupId, reload])
  useEffect(() => {
    if (!groupId) return
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload() }, 30000)
    return () => clearInterval(t)
  }, [groupId, reload])

  return { group, missing, reload, setGroup }
}

const MATERIAL_ORDER: GroupKind[] = ['day7', 'day3', 'daily', 'itinerary', 'flights', 'hotels', 'driver']

function autoNote(g: GroupDetail, m: GroupMember, kind: GroupKind): string | null {
  const dated = (days: number) => {
    const d = addDays(m.arrival, -days)
    return d >= m.localToday ? `Auto ${shortDate(d)}, ${g.docTime}` : null
  }
  if (kind === 'day7' && g.autoDay7 && !isSent(m.coverage.day7?.status)) return dated(7)
  if (kind === 'day3' && g.autoDay3 && !isSent(m.coverage.day3?.status)) return dated(3)
  if (kind === 'daily' && g.autoDaily && m.stage !== 'finished') return `Auto daily, ${g.dailyTime}`
  if (kind === 'driver' && g.autoDriver && m.stage !== 'finished') return 'Auto when assigned'
  return null
}

function StatusPill({ m, kind }: { m: GroupMember; kind: GroupKind }) {
  const c = m.coverage[kind]
  if (!c) return <span className="text-[11px] font-semibold text-slate-400">Not sent</span>
  const failed = c.status === 'failed'
  const word = failed ? 'Failed' : c.status === 'read' ? 'Read' : c.status === 'delivered' ? 'Delivered' : 'Sent'
  const tone = failed ? 'text-rose-600' : c.status === 'read' ? 'text-sky-600' : 'text-emerald-600'
  return (
    <span className={`text-[11px] font-semibold ${tone}`}>
      {word} {shortDate(c.at)}{kind === 'daily' && m.dailyDates.length > 1 ? ` · ${m.dailyDates.length} days` : ''}
    </span>
  )
}

function MaterialRow({ group, m, kind, onInsert, onSent, onPatch }: {
  group: GroupDetail; m: GroupMember; kind: GroupKind
  onInsert: (text: string) => void; onSent: () => void; onPatch: (p: Partial<GroupDetail>, message?: string) => void
}) {
  const Icon = KIND_ICON[kind]
  const isDoc = kind === 'day7' || kind === 'day3'
  const [open, setOpen] = useState(false)
  const [dayOffset, setDayOffset] = useState(() => (new Date().getHours() < 12 ? 0 : 1))
  const [preview, setPreview] = useState<{ text: string | null; attachment: string | null; empty?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const date = kind === 'daily' ? addDays(m.localToday, dayOffset) : undefined
  const blocker = memberBlocker(m, kind, date)
  const auto = autoNote(group, m, kind)
  const autoField = AUTO_FIELD[kind as keyof typeof AUTO_FIELD] ?? null
  const savedTime = kind === 'daily' ? group.dailyTime : group.docTime
  const [time, setTime] = useState(savedTime)
  useEffect(() => { setTime(savedTime) }, [savedTime])
  const lastTry = group.activity.find(a => a.kind === kind)
  const lastFail = lastTry && lastTry.status !== 'sent' && lastTry.detail ? lastTry.detail : null
  const already = kind === 'daily' ? Boolean(date && m.dailyDates.includes(date)) : isSent(m.coverage[kind]?.status)

  const fetchPreview = useCallback(async () => {
    const res = await api<{ text: string | null; attachment: string | null; empty?: string }>(`/api/whatsapp/groups/${group.id}/send`, {
      method: 'POST', body: JSON.stringify({ preview: true, kind, ref: m.bookingRef, date }),
    })
    const p = res.success && res.data ? res.data : { text: null, attachment: null, empty: res.error }
    setPreview(p)
    return p
  }, [group.id, kind, m.bookingRef, date])

  useEffect(() => { if (open && !blocker) fetchPreview() }, [open, blocker, fetchPreview])

  async function insert() {
    setBusy(true)
    const p = await fetchPreview()
    setBusy(false)
    if (p.text) onInsert(p.text)
    else toast.error(p.empty ?? 'Nothing to insert')
  }

  async function send() {
    setBusy(true)
    const res = await api<GroupSendOutcome>(`/api/whatsapp/groups/${group.id}/send`, {
      method: 'POST', body: JSON.stringify({ kind, ref: m.bookingRef, date, resend: already }),
    })
    setBusy(false)
    const out = res.data
    if (res.success && out?.status === 'sent') {
      toast.success(`${KIND_META[kind].label} sent`, out.detail ? { description: out.detail } : undefined)
      setOpen(false)
      onSent()
    } else toast.error(out?.detail ?? res.error ?? 'Send failed')
  }

  return (
    <div className={`rounded-2xl border bg-white transition ${open ? 'border-emerald-300 shadow-md' : 'border-slate-200'}`}>
      <div className="flex items-center gap-2.5 p-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-sm ${KIND_TINT[kind]}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-slate-900">{KIND_META[kind].label}</p>
          <p className="flex flex-wrap items-center gap-x-1.5">
            <StatusPill m={m} kind={kind} />
            {auto && <span className="inline-flex items-center gap-0.5 text-[10.5px] font-bold text-amber-600"><Zap className="h-2.5 w-2.5" />{auto}</span>}
          </p>
        </div>
        {group.canManage && (
          <div className="flex shrink-0 gap-1">
            {!isDoc && (
              <button onClick={insert} disabled={busy || Boolean(blocker)} aria-label={`Put ${KIND_META[kind].label} in the chat box`} title="Put in the chat box to edit" className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 disabled:opacity-40"><CornerDownLeft className="h-4 w-4" /></button>
            )}
            <button onClick={() => setOpen(v => !v)} disabled={kind !== 'daily' && Boolean(blocker)} aria-label={`Send ${KIND_META[kind].label}`} title={blocker ?? 'Preview and send'} className={`grid h-8 w-8 place-items-center rounded-lg transition disabled:opacity-40 ${open ? 'bg-slate-100 text-slate-700' : 'bg-slate-900 text-white hover:bg-slate-700'}`}>
              {open ? <ChevronDown className="h-4 w-4" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>
      {!open && blocker && <p className="px-3 pb-2 text-[11px] text-slate-400">{blocker}</p>}
      {lastFail && <p className="px-3 pb-2 text-[11px] leading-snug text-rose-600">{lastFail}</p>}
      {autoField && (
        <div className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5">
          <Switch on={group[autoField]} disabled={!group.canManage} label={`Automatic ${KIND_META[kind].label}`} onChange={on => onPatch({ [autoField]: on }, on ? `${KIND_META[kind].label} is now automatic` : `${KIND_META[kind].label} automation is off`)} />
          <span className={`flex-1 text-[11px] font-bold ${group[autoField] ? 'text-emerald-700' : 'text-slate-500'}`}>Auto</span>
          <input
            type="time" value={time} disabled={!group.canManage} aria-label={`${KIND_META[kind].label} send time`}
            onChange={e => setTime(e.target.value)}
            onBlur={() => { if (time && time !== savedTime) onPatch(kind === 'daily' ? { dailyTime: time } : { docTime: time }) }}
            className="shrink-0 rounded-md border border-slate-200 bg-white px-1 py-0.5 text-[11px] font-semibold text-slate-700 outline-none focus:border-emerald-400"
          />
        </div>
      )}
      {autoField && group[autoField] && <p className="px-3 pb-2 text-[11px] leading-snug text-slate-500">{AUTO_RULE[kind]}</p>}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2 border-t border-slate-100 p-2.5">
              {kind === 'daily' && (
                <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                  {['Today', 'Tomorrow'].map((l, i) => (
                    <button key={l} onClick={() => setDayOffset(i)} className={`flex-1 rounded-md py-1 text-[11px] font-bold ${dayOffset === i ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
                  ))}
                </div>
              )}
              {blocker ? <p className="text-xs text-slate-500">{blocker}</p> : (
                <>
                  <div className="max-h-52 overflow-y-auto rounded-xl bg-[#efeae2] p-2">
                    {preview?.text ? (
                      <div className="rounded-xl rounded-tl-sm bg-white p-2.5 text-xs leading-relaxed text-slate-800 shadow-sm">
                        {preview.attachment && <p className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1.5 font-semibold"><FileText className="h-3.5 w-3.5 text-rose-500" /> {preview.attachment}</p>}
                        <p className="whitespace-pre-wrap break-words"><WaText text={preview.text} /></p>
                      </div>
                    ) : <p className="p-2 text-xs text-slate-500">{preview?.empty ?? 'Loading preview…'}</p>}
                  </div>
                  {already && <p className="text-[11px] font-semibold text-amber-700">This guest already has it. Sending again sends a second copy.</p>}
                  <button onClick={send} disabled={busy || !preview?.text} className={`${btnPrimary} w-full justify-center`}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {already ? 'Send again' : group.channel.mode === 'whatsapp' ? 'Send to the group' : 'Send to guests'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BoardingPass({ m, brief, color }: { m: GroupMember; brief: GuestBrief | null; color: GroupColor }) {
  const when = m.stage === 'in-trip' ? `Day ${-m.daysToArrival + 1}` : m.stage === 'finished' ? 'Done' : m.daysToArrival === 0 ? 'Today' : `T-${m.daysToArrival}`
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/5">
      <div className={`bg-gradient-to-br p-3.5 text-white ${GROUP_COLORS[color].hero}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-extrabold">{m.leadName ?? 'Guest'}</p>
            <p className="truncate text-[11px] text-white/80">{flag(m.country)} {m.isNumber || m.bookingRef} · {m.pax}</p>
          </div>
          <span className="shrink-0 rounded-lg bg-white/20 px-2 py-1 text-[13px] font-extrabold tabular-nums">{when}</span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px] font-bold">
          <span>{shortDate(m.arrival)}</span>
          <span className="relative h-px flex-1 bg-white/50"><Plane className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" /></span>
          <span>{shortDate(m.departure)}</span>
        </div>
      </div>
      <div className="relative border-t border-dashed border-slate-200">
        <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-slate-100" />
        <span className="absolute -right-2 -top-2 h-4 w-4 rounded-full bg-slate-100" />
      </div>
      <div className="grid grid-cols-4 divide-x divide-slate-100 py-2 text-center">
        {[
          { l: 'Flights', v: m.readiness.flights },
          { l: 'Hotels', v: m.readiness.hotels },
          { l: 'Days', v: m.readiness.itinerary },
          { l: 'Drivers', v: `${m.readiness.driversAssigned}/${m.readiness.driverItems}` },
        ].map(x => (
          <div key={x.l}>
            <p className="text-[13px] font-extrabold tabular-nums text-slate-900">{x.v}</p>
            <p className="text-[10px] font-medium text-slate-500">{x.l}</p>
          </div>
        ))}
      </div>
      {brief && (
        <div className="border-t border-slate-100 px-3 py-2">
          <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{m.stage === 'in-trip' ? 'Today' : 'Arrival day'} · {shortDate(brief.focusDate)}</p>
          {brief.focusPlan.length === 0 ? <p className="mt-0.5 text-xs text-slate-500">Nothing on the movement chart yet.</p> : (
            <ul className="mt-1 space-y-1">
              {brief.focusPlan.slice(0, 4).map((p, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-700">
                  <span className="w-10 shrink-0 font-bold tabular-nums text-slate-900">{p.time ?? '--'}</span>
                  <span className="min-w-0 flex-1"><span className="line-clamp-2">{p.title}</span>{p.driver && <span className="text-[11px] text-slate-500">{p.driver}</span>}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function ReplyCoach({ groupId, latest, onInsert }: {
  groupId: string; latest: { id: string; direction: string } | null; onInsert: (text: string) => void
}) {
  const [state, setState] = useState<{ key: string; data?: ReplySuggestions; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState('')
  const asked = useRef(new Set<string>())

  const ask = useCallback(async (key: string, withHint?: string) => {
    setLoading(true)
    const res = await api<ReplySuggestions>(`/api/whatsapp/groups/${groupId}/suggest`, {
      method: 'POST', body: JSON.stringify({ hint: withHint }),
    })
    setLoading(false)
    setState(res.success && res.data ? { key, data: res.data } : { key, error: res.error ?? 'Suggestions are unavailable right now.' })
  }, [groupId])

  // Drafts itself once per new message from a contact, so an open chat costs one call.
  useEffect(() => {
    if (latest?.direction !== 'inbound' || asked.current.has(latest.id)) return
    asked.current.add(latest.id)
    ask(latest.id)
  }, [latest, ask])

  return (
    <section className="rounded-2xl bg-gradient-to-br from-violet-50 via-white to-sky-50 p-3 ring-1 ring-violet-200/70">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 text-white"><Sparkles className="h-3.5 w-3.5" /></span>
        <p className="flex-1 text-[13px] font-extrabold text-slate-900">Suggested replies</p>
        <button onClick={() => ask(`manual-${Date.now()}`, hint)} disabled={loading} aria-label="New suggestions" title="New suggestions" className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {loading && !state?.data && <div className="mt-2 space-y-1.5"><div className="h-12 animate-pulse rounded-xl bg-violet-100/70" /><div className="h-12 animate-pulse rounded-xl bg-violet-100/50" /></div>}
      {state?.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}
      {!state && !loading && <p className="mt-1.5 text-xs text-slate-500">Drafts appear when someone writes, using this booking&apos;s details. Press refresh to draft one now.</p>}
      {state?.data && (
        <>
          {state.data.summary && <p className="mt-2 text-xs font-medium leading-snug text-slate-600">{state.data.summary}</p>}
          <div className="mt-2 space-y-1.5">
            {state.data.replies.map((r, i) => (
              <motion.button
                key={`${state.key}-${i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                onClick={() => onInsert(r.text)} title="Put in the chat box to review"
                className="block w-full rounded-xl bg-white p-2.5 text-left shadow-sm ring-1 ring-slate-200/70 transition hover:ring-violet-300"
              >
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-violet-600">{r.label}</span>
                <span className="mt-0.5 line-clamp-4 block text-xs leading-relaxed text-slate-700">{r.text}</span>
              </motion.button>
            ))}
          </div>
        </>
      )}
      <form onSubmit={e => { e.preventDefault(); ask(`manual-${Date.now()}`, hint) }} className="mt-2">
        <input
          value={hint} onChange={e => setHint(e.target.value)} maxLength={200} placeholder="Steer it: e.g. apologise, driver is 10 min late"
          className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-violet-400"
        />
      </form>
      <p className="mt-1.5 text-[10.5px] text-slate-400">Goes to the chat box only. Everyone in the group gets what you send, so check it first.</p>
    </section>
  )
}

// ── Booking picker ───────────────────────────────────────────────────────────

const WINDOWS = [
  { key: 'next7', label: 'Next 7 days' }, { key: 'next14', label: 'Next 14 days' }, { key: 'next30', label: 'Next 30 days' },
  { key: 'intrip', label: 'On trip now' }, { key: 'all', label: 'All upcoming' },
]

function BookingPicker({ onPick, picked }: { onPick: (b: GroupCandidate) => void; picked: string | null }) {
  const [q, setQ] = useState('')
  const [window_, setWindow] = useState('next14')
  const [rows, setRows] = useState<GroupCandidate[] | null>(null)

  useEffect(() => {
    let stale = false
    const t = setTimeout(async () => {
      const res = await api<GroupCandidate[]>(`/api/whatsapp/groups/candidates?window=${window_}&q=${encodeURIComponent(q.trim())}`)
      if (stale) return
      setRows(res.data ?? [])
      if (!res.success) toast.error(res.error ?? 'Could not load bookings')
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q, window_])

  return (
    <div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q} onChange={e => setQ(e.target.value)} placeholder="File number, ref, guest or agent"
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
        />
      </div>
      {q.trim().length < 2 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {WINDOWS.map(w => (
            <button key={w.key} type="button" onClick={() => setWindow(w.key)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition ${window_ === w.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{w.label}</button>
          ))}
        </div>
      )}
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {rows === null && <li className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></li>}
        {rows?.length === 0 && <li className="px-3 py-8 text-center text-sm text-slate-500">No live bookings found.</li>}
        {rows?.map(r => (
          <li key={r.bookingRef}>
            <button type="button" onClick={() => onPick(r)} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${picked === r.bookingRef ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'hover:bg-slate-50'}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-slate-800">{r.leadName ?? 'Guest'}</span>
                <span className="block truncate text-[11px] text-slate-500">{flag(r.country)} {r.isNumber || r.bookingRef}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-slate-500">
                <span className="flex items-center justify-end gap-1"><CalendarDays className="h-3 w-3" /> {shortDate(r.arrival)}</span>
                {!r.hasPhone && <span className="font-semibold text-amber-700">No number</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CreateGroup({ onClose, onCreated, onSetupNeeded }: { onClose: () => void; onCreated: (id: string) => void; onSetupNeeded: () => void }) {
  const [booking, setBooking] = useState<GroupCandidate | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState<GroupColor>('emerald')
  const [saving, setSaving] = useState(false)

  function pick(b: GroupCandidate) {
    setBooking(b)
    setName(`${b.isNumber || b.bookingRef} ${b.leadName ?? 'Trip'}`.trim())
  }

  async function create() {
    if (!booking || !name.trim()) return
    setSaving(true)
    const res = await api<{ id: string; existing?: boolean }>('/api/whatsapp/groups', {
      method: 'POST', body: JSON.stringify({ name, color, ref: booking.bookingRef }),
    })
    setSaving(false)
    if (res.success && res.data) {
      if (res.data.existing) toast('This booking already has a group, so it is open now')
      onCreated(res.data.id)
    } else if (res.error === SETUP_NEEDED_ERROR) onSetupNeeded()
    else toast.error(res.error ?? 'Could not create the group')
  }

  return (
    <Sheet
      title="New chat group" subtitle="One group per booking. The guest joins it automatically." onClose={onClose}
      icon={<span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-white ${GROUP_COLORS[color].hero}`}><Users className="h-4 w-4" /></span>}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={create} disabled={saving || !booking || !name.trim()} className={btnPrimary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create group
          </button>
        </>
      }
    >
      <div className="space-y-3 p-5">
        <BookingPicker onPick={pick} picked={booking?.bookingRef ?? null} />
        {booking && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder="Group name" maxLength={120} aria-label="Group name"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
            <ColorPicker value={color} onChange={setColor} />
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ── Left pane ────────────────────────────────────────────────────────────────

const avatar = (seed: string, name: string | null, size: string) => (
  <span style={{ background: avatarGradient(seed) }} className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${size}`}>{initials(name, seed)}</span>
)

export function GroupsRail({ selectedId, version, state, onSelect, onOpenPrivate }: {
  selectedId: string | null
  version: number
  state: ReturnType<typeof useGroupDetail>
  onSelect: (id: string | null) => void
  onOpenPrivate: (phone: string) => void
}) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await api<GroupSummary[]>('/api/whatsapp/groups')
    if (res.success) setGroups(res.data ?? [])
    else if (res.error === SETUP_NEEDED_ERROR) { setNeedsSetup(true); setGroups([]) }
    else setGroups(g => g ?? [])
  }, [])
  useEffect(() => { load() }, [load, version])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, 15000)
    return () => clearInterval(t)
  }, [load])

  if (needsSetup) {
    return (
      <div className="m-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="h-4 w-4" /> Groups need a one-time setup</p>
        <p className="mt-1 text-xs leading-relaxed">The database tables are not installed yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-wa-booking-groups.sh</code>, then refresh this page.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1 px-1">
      <button
        onClick={() => setCreating(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 py-3 text-[13px] font-bold text-emerald-700 transition hover:bg-emerald-100/70"
      >
        <Plus className="h-4 w-4" /> New chat group
      </button>

      {groups === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-slate-100" />)}

      {groups?.length === 0 && (
        <div className="rounded-2xl px-5 py-8 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">No chat groups yet</p>
          <p className="mt-1 text-xs text-slate-400">Start one for a booking and bring the guest, family, driver and agent into the same chat.</p>
        </div>
      )}

      {groups?.map(g => {
        const open = g.id === selectedId
        return (
          <div key={g.id} className={`rounded-2xl transition ${open ? 'bg-emerald-50/70 ring-1 ring-emerald-200' : ''}`}>
            <button onClick={() => onSelect(open ? null : g.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${open ? '' : 'hover:bg-slate-50'}`}>
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-md ${GROUP_COLORS[g.color].hero}`}><Users className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`truncate text-[14px] text-slate-900 ${g.unread ? 'font-extrabold' : 'font-bold'}`}>{g.name}</span>
                  {g.lastAt && <span className={`ml-auto shrink-0 text-[11px] ${g.unread ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>{fmtListStamp(g.lastAt)}</span>}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{g.lastText || (g.bookingRef ? 'No messages yet' : 'No booking linked')}</span>
                  {g.unread > 0 && <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">{g.unread}</span>}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] font-bold text-slate-400">
                  {g.shownRef && <span className="truncate">{flag(g.country)} {g.shownRef}</span>}
                  <span className="shrink-0">{g.participants} contact{g.participants === 1 ? '' : 's'}</span>
                  {g.mode === 'whatsapp' && <span className="shrink-0 text-emerald-600">WhatsApp group</span>}
                  {g.autoCount > 0 && <span title={`${g.autoCount} automation${g.autoCount === 1 ? '' : 's'} on`} className="inline-flex shrink-0 items-center text-amber-600"><Zap className="h-2.5 w-2.5" />{g.autoCount}</span>}
                </span>
              </span>
            </button>
            {open && state.group && <div className="px-2 pb-2"><ContactList state={state} onOpenPrivate={onOpenPrivate} onChanged={load} /></div>}
          </div>
        )
      })}

      <AnimatePresence>
        {creating && <CreateGroup onClose={() => setCreating(false)} onCreated={id => { setCreating(false); load(); onSelect(id) }} onSetupNeeded={() => { setCreating(false); setNeedsSetup(true) }} />}
      </AnimatePresence>
    </div>
  )
}

function ContactList({ state, onOpenPrivate, onChanged }: {
  state: ReturnType<typeof useGroupDetail>; onOpenPrivate: (phone: string) => void; onChanged?: () => void
}) {
  const { group, reload } = state
  const [adding, setAdding] = useState(false)
  if (!group) return null
  const real = group.channel.mode === 'whatsapp'

  async function remove(p: GroupParticipant) {
    if (!window.confirm(`Remove ${p.name ?? `+${p.phone}`} from this group?${real ? ' They cannot rejoin by the invite link afterwards.' : ''}`)) return
    const res = await api(`/api/whatsapp/groups/${group!.id}/participants?id=${p.id}`, { method: 'DELETE' })
    if (res.success) { reload(); onChanged?.() }
    else toast.error(res.error ?? 'Could not remove')
  }

  return (
    <div className="space-y-0.5">
      {group.participants.map(p => (
        <div key={p.id} className="group/c flex items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-white">
          {avatar(p.phone, p.name, 'h-7 w-7 text-[10px]')}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-slate-800">{p.name ?? `+${p.phone}`}</p>
            <p className="truncate text-[10.5px] capitalize text-slate-500">
              <span className={`font-bold ${ROLE_TONE[p.role]}`}>{p.role}</span>
              {real && ` · ${p.joinState === 'joined' ? 'joined' : 'not joined yet'}`}
            </p>
          </div>
          <button onClick={() => onOpenPrivate(p.phone)} aria-label={`Private chat with ${p.name ?? p.phone}`} title="Private chat" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"><MessageCircle className="h-3.5 w-3.5" /></button>
          {group.canManage && <button onClick={() => remove(p)} aria-label={`Remove ${p.name ?? p.phone}`} title="Remove from group" className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}
        </div>
      ))}
      {group.canManage && group.member && (
        <button onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-[12.5px] font-bold text-emerald-700 transition hover:bg-white">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100"><UserPlus className="h-3.5 w-3.5" /></span> Add contact
        </button>
      )}
      <AnimatePresence>
        {adding && <AddContact group={group} onClose={() => setAdding(false)} onAdded={() => { reload(); onChanged?.() }} />}
      </AnimatePresence>
    </div>
  )
}

function AddContact({ group, onClose, onAdded }: { group: GroupDetail; onClose: () => void; onAdded: () => void }) {
  const [suggestions, setSuggestions] = useState<ContactSuggestion[] | null>(null)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<ParticipantRole>('family')
  const [busy, setBusy] = useState(false)
  const inGroup = useMemo(() => new Set(group.participants.map(p => p.phone)), [group.participants])

  useEffect(() => {
    api<ContactSuggestion[]>(`/api/whatsapp/groups/${group.id}/participants`).then(res => setSuggestions(res.data ?? []))
  }, [group.id])

  async function add(p: { phone: string; name: string | null; role: ParticipantRole }) {
    setBusy(true)
    const res = await api(`/api/whatsapp/groups/${group.id}/participants`, { method: 'POST', body: JSON.stringify(p) })
    setBusy(false)
    if (res.success) { toast.success(`${p.name ?? `+${p.phone}`} added`); onAdded(); return true }
    toast.error(res.error ?? 'Could not add this contact')
    return false
  }

  const open = (suggestions ?? []).filter(s => !inGroup.has(s.phone))
  return (
    <Sheet title="Add contact" subtitle={group.name} onClose={onClose} icon={<span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-100 text-emerald-700"><UserPlus className="h-4 w-4" /></span>}>
      <div className="space-y-4 p-5">
        {open.length > 0 && (
          <section>
            <p className="mb-1.5 text-xs font-bold text-slate-500">From this booking</p>
            <ul className="space-y-1">
              {open.map(s => (
                <li key={s.phone} className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-2.5 py-2">
                  {avatar(s.phone, s.name, 'h-8 w-8 text-[10px]')}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-slate-800">{s.name ?? `+${s.phone}`}</span>
                    <span className="block truncate text-[11px] text-slate-500">{s.label} · +{s.phone}</span>
                  </span>
                  <button disabled={busy} onClick={() => add(s)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-50">Add</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <form
          onSubmit={async e => {
            e.preventDefault()
            if (await add({ phone, name: name.trim() || null, role })) { setPhone(''); setName('') }
          }}
          className="space-y-2"
        >
          <p className="text-xs font-bold text-slate-500">Someone else</p>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="WhatsApp number with country code" aria-label="WhatsApp number" inputMode="tel" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-400 focus:bg-white" />
          <div className="flex gap-2">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" maxLength={120} className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-400 focus:bg-white" />
            <select value={role} onChange={e => setRole(e.target.value as ParticipantRole)} aria-label="Role" className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm capitalize outline-none focus:border-emerald-400">
              {PARTICIPANT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={btnGhost}>Done</button>
            <button type="submit" disabled={busy || !phone.trim()} className={btnPrimary}><Plus className="h-4 w-4" /> Add</button>
          </div>
        </form>
      </div>
    </Sheet>
  )
}

// ── Middle pane ──────────────────────────────────────────────────────────────

function Bubble({ m }: { m: TimelineItem }) {
  const out = m.direction === 'outbound'
  const Icon = m.kind ? KIND_ICON[m.kind] : null
  const d = m.delivery
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed shadow-sm ${out ? 'rounded-tr-sm bg-[#d9fdd3]' : 'rounded-tl-sm bg-white'}`}>
        {m.senderName && (
          <p className={`mb-0.5 text-[11.5px] font-bold ${out ? 'text-emerald-700' : ROLE_TONE[m.role ?? 'other'] ?? 'text-slate-600'}`}>
            {m.senderName}{m.role && !out ? <span className="ml-1 font-medium capitalize text-slate-400">{m.role}</span> : null}
          </p>
        )}
        {m.kind && Icon && (
          <p className="mb-1 flex items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1 text-[11.5px] font-bold text-slate-700"><Icon className="h-3.5 w-3.5" /> {KIND_META[m.kind].label}</p>
        )}
        {m.mediaUrl && <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-sky-700 underline"><FileText className="h-3.5 w-3.5" /> Open {m.mediaType ?? 'file'}</a>}
        {m.body && <p className="whitespace-pre-wrap break-words text-slate-800"><WaText text={m.body} /></p>}
        <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-slate-500">
          {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          {out && m.status === 'sending' && <Loader2 className="h-3 w-3 animate-spin" />}
          {out && m.status === 'failed' && <span className="font-bold text-rose-600">Failed</span>}
          {out && d && d.total > 0 && (
            <span title={`${d.delivered} of ${d.total} delivered, ${d.read} read, ${d.failed} failed`} className={`inline-flex items-center gap-0.5 font-semibold ${d.failed ? 'text-rose-600' : d.read === d.total ? 'text-sky-600' : ''}`}>
              {d.delivered === d.total ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />} {d.delivered}/{d.total}
            </span>
          )}
        </p>
        {m.detail && <p className="mt-1 border-t border-black/5 pt-1 text-[11px] leading-snug text-rose-700">{m.detail}</p>}
      </div>
    </motion.div>
  )
}

export function GroupWorkspace({ state, onBack, onOpenPrivate, onChanged, onArchived }: {
  state: ReturnType<typeof useGroupDetail>
  onBack: () => void
  onOpenPrivate: (phone: string) => void
  onChanged: () => void
  onArchived: () => void
}) {
  const { group, missing, reload, setGroup } = state
  const groupId = group?.id ?? null
  const [items, setItems] = useState<TimelineItem[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastId = useRef<string | null>(null)

  const loadChat = useCallback(async () => {
    if (!groupId) return
    const res = await api<TimelineItem[]>(`/api/whatsapp/groups/${groupId}/chat`)
    if (res.success) setItems(res.data ?? [])
  }, [groupId])

  useEffect(() => { setItems(null); setDraft(''); setPanelOpen(false); lastId.current = null; loadChat() }, [groupId, loadChat])
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadChat() }, 6000)
    return () => clearInterval(t)
  }, [loadChat])

  const newest = items?.length ? items[items.length - 1] : null
  useEffect(() => {
    if (newest && newest.id !== lastId.current) {
      lastId.current = newest.id
      requestAnimationFrame(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight })
      onChanged()
    }
  }, [newest, onChanged])

  async function send() {
    const text = draft.trim()
    if (!text || !groupId || sending) return
    setSending(true)
    const res = await api<{ failed: number; total: number }>(`/api/whatsapp/groups/${groupId}/chat`, { method: 'POST', body: JSON.stringify({ body: text }) })
    setSending(false)
    if (!res.success) { toast.error(res.error ?? 'Could not send'); return }
    setDraft('')
    if (res.data?.failed) toast.error(`${res.data.failed} of ${res.data.total} could not be sent`)
    loadChat()
  }

  function insert(text: string) {
    setDraft(d => (d.trim() ? `${d.trimEnd()}\n\n${text}` : text))
    setPanelOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  async function patch(p: Partial<GroupDetail>, message?: string) {
    setGroup(g => (g ? { ...g, ...p } : g))
    const res = await api(`/api/whatsapp/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(p) })
    if (!res.success) { toast.error(res.error ?? 'Could not save'); reload(); return }
    if (message) toast.success(message)
    onChanged()
  }

  async function attach(b: GroupCandidate) {
    const res = await api(`/api/whatsapp/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify({ ref: b.bookingRef }) })
    if (res.success) { reload(); onChanged() }
    else toast.error(res.error ?? 'Could not link this booking')
  }

  async function archive() {
    if (!group || !window.confirm(`Archive "${group.name}"? Its automations stop. Messages already sent are not affected.`)) return
    const res = await api(`/api/whatsapp/groups/${group.id}`, { method: 'DELETE' })
    if (res.success) { toast.success('Group archived'); onArchived() }
    else toast.error(res.error ?? 'Could not archive')
  }

  if (missing) {
    return (
      <div className="grid h-full place-items-center text-center text-slate-500">
        <div>
          <p className="font-semibold">This group could not be loaded</p>
          <button onClick={onBack} className="mt-2 text-sm font-semibold text-emerald-600">Back to groups</button>
        </div>
      </div>
    )
  }
  if (!group) return <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-500" /></div>

  if (!group.member) {
    return (
      <div className="mx-auto w-full max-w-md p-6">
        <button onClick={onBack} className="mb-3 hidden items-center gap-1 text-sm font-semibold text-slate-500 max-[860px]:flex"><ArrowLeft className="h-4 w-4" /> Groups</button>
        <h2 className="text-lg font-extrabold text-slate-900">Link a booking to {group.name}</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Each chat group belongs to one booking. The guest joins automatically.</p>
        {group.canManage ? <BookingPicker onPick={attach} picked={null} /> : <p className="text-sm text-slate-500">You do not have access to change this group.</p>}
        {group.canManage && <button onClick={archive} className="mt-4 text-xs font-semibold text-rose-600">Archive this group</button>}
      </div>
    )
  }

  const real = group.channel.mode === 'whatsapp'
  const names = group.participants.map(p => p.name?.split(' ')[0] ?? `+${p.phone}`).join(', ')

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="z-10 flex shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 py-2.5 backdrop-blur-md">
          <button onClick={onBack} aria-label="Back to groups" className="hidden h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 max-[860px]:grid"><ArrowLeft className="h-4 w-4" /></button>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-md ${GROUP_COLORS[group.color].hero}`}><Users className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight text-slate-900">{group.name}</p>
            <p className="truncate text-[11.5px] text-slate-500">{names || 'No contacts yet'}</p>
          </div>
          <div className="flex -space-x-2 max-[640px]:hidden">
            {group.participants.slice(0, 5).map(p => <span key={p.id} className="rounded-full ring-2 ring-white">{avatar(p.phone, p.name, 'h-7 w-7 text-[10px]')}</span>)}
          </div>
          <button onClick={() => setPanelOpen(o => !o)} aria-label="Trip panel" title="Trip panel" className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 min-[1180px]:hidden"><Sparkles className="h-4 w-4" /></button>
        </div>

        <p className={`shrink-0 px-4 py-1.5 text-center text-[11px] font-medium ${real ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
          {real ? 'Real WhatsApp group: everyone sees every message.' : 'Inbox group: each contact gets your message on their own WhatsApp and cannot see the others. All replies land here.'}
        </p>

        <div ref={boxRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-4 py-4">
          {items === null && <div className="grid h-full place-items-center"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>}
          {items?.length === 0 && (
            <div className="mx-auto mt-10 max-w-xs rounded-2xl bg-white/80 p-4 text-center text-sm text-slate-600">
              <p className="font-bold text-slate-800">Start the conversation</p>
              <p className="mt-1 text-xs">Messages and replies from everyone in this group appear here.</p>
            </div>
          )}
          {items?.map(m => <Bubble key={m.id} m={m} />)}
        </div>

        {group.canManage && (
          <form onSubmit={e => { e.preventDefault(); send() }} className="flex shrink-0 items-end gap-2 border-t border-slate-200/80 bg-white px-3 py-2.5">
            <textarea
              ref={inputRef} value={draft} rows={Math.min(6, Math.max(1, draft.split('\n').length))} maxLength={4000} aria-label="Message to the group"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={`Message ${group.participants.length} contact${group.participants.length === 1 ? '' : 's'}`}
              className="min-h-[42px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />
            <button type="submit" disabled={!draft.trim() || sending} aria-label="Send to group" className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-md transition hover:brightness-105 disabled:opacity-40">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
        )}
      </div>

      <TripPanel
        state={state} open={panelOpen} latest={newest ? { id: newest.id, direction: newest.direction } : null}
        onClose={() => setPanelOpen(false)} onInsert={insert} onPatch={patch} onArchive={archive} onOpenPrivate={onOpenPrivate}
        onSent={() => { reload(); loadChat() }}
      />
    </div>
  )
}

// ── Right pane ───────────────────────────────────────────────────────────────

function ChannelCard({ group, onChanged }: { group: GroupDetail; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const c = group.channel

  async function call(action?: string) {
    setBusy(true)
    const res = await api<{ sent?: number }>(`/api/whatsapp/groups/${group.id}/real`, { method: 'POST', body: JSON.stringify({ action }) })
    setBusy(false)
    if (res.success) toast.success(res.message ?? 'Done')
    else toast.error(res.error ?? 'Meta refused the request')
    onChanged()
  }

  if (c.mode === 'whatsapp') {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
        <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-emerald-800"><Link2 className="h-4 w-4" /> Real WhatsApp group</p>
        <p className="mt-0.5 text-xs text-emerald-800/80">Contacts join by tapping the invite link. Up to 8 people.</p>
        {c.inviteLink ? (
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => { navigator.clipboard?.writeText(c.inviteLink!); toast.success('Link copied') }} className={`${btnGhost} flex flex-1 items-center justify-center gap-1 bg-white !px-2 !py-1.5 !text-xs`}><Copy className="h-3.5 w-3.5" /> Copy link</button>
            {group.canManage && <button onClick={() => call('invite')} disabled={busy} className={`${btnPrimary} flex-1 justify-center !px-2 !py-1.5 !text-xs`}><Send className="h-3.5 w-3.5" /> Send invites</button>}
          </div>
        ) : <p className="mt-2 text-xs text-emerald-800/80">Waiting for Meta to give the invite link.</p>}
      </section>
    )
  }
  if (c.mode === 'pending') {
    return <section className="rounded-2xl border border-slate-200 bg-white p-3 text-xs text-slate-600"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Meta is creating the WhatsApp group. It works as an inbox group until then.</section>
  }
  if (!group.canManage) return null
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <p className="text-[13px] font-extrabold text-slate-900">Make it a real WhatsApp group</p>
      <p className="mt-0.5 text-xs leading-snug text-slate-500">Everyone would see each other on their phones. Needs Meta&apos;s Official Business Account, 8 people at most, and contacts join by invite link.</p>
      {c.lastError && <p className="mt-1.5 text-[11px] leading-snug text-rose-600">{c.lastError}</p>}
      <button onClick={() => call()} disabled={busy} className={`${btnGhost} mt-2 flex w-full items-center justify-center gap-1.5 !py-1.5 !text-xs`}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />} {c.lastError ? 'Try again' : 'Create WhatsApp group'}
      </button>
    </section>
  )
}

function TripPanel({ state, open, latest, onClose, onInsert, onPatch, onSent, onArchive, onOpenPrivate }: {
  state: ReturnType<typeof useGroupDetail>
  /** Below the three-pane width the panel is a drawer; this says it is showing. */
  open: boolean
  latest: { id: string; direction: string } | null
  onClose: () => void
  onInsert: (text: string) => void
  onPatch: (p: Partial<GroupDetail>, message?: string) => void
  onSent: () => void
  onArchive: () => void
  onOpenPrivate: (phone: string) => void
}) {
  const { group, reload } = state
  const member = group?.member ?? null
  const ref = member?.bookingRef ?? null
  const id = group?.id ?? null
  const [brief, setBrief] = useState<GuestBrief | null>(null)
  useEffect(() => {
    if (!ref || !id) return
    let stale = false
    setBrief(null)
    api<GuestBrief>(`/api/whatsapp/groups/${id}/brief?ref=${encodeURIComponent(ref)}`).then(res => {
      if (!stale && res.success && res.data) setBrief(res.data)
    })
    return () => { stale = true }
  }, [id, ref])
  if (!group || !member) return null

  return (
    <aside className={`${open ? 'fixed inset-y-0 right-0 z-30 flex shadow-2xl' : 'hidden'} w-[340px] max-w-full shrink-0 flex-col border-l border-slate-200/80 bg-slate-100/80 backdrop-blur min-[1180px]:static min-[1180px]:z-auto min-[1180px]:flex min-[1180px]:shadow-none max-[1179px]:bg-slate-100`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex justify-end min-[1180px]:hidden">
          <button onClick={onClose} aria-label="Close trip panel" className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-500"><X className="h-4 w-4" /></button>
        </div>
        <BoardingPass m={member} brief={brief} color={group.color} />
        {group.canManage && <ReplyCoach key={group.id} groupId={group.id} latest={latest} onInsert={onInsert} />}
        <section>
          <h3 className="px-1 text-[13px] font-extrabold text-slate-900">Trip materials</h3>
          <p className="mb-1.5 px-1 text-[11px] text-slate-500">{group.channel.mode === 'whatsapp' ? 'Goes to the whole group.' : 'Goes to the guest and family in this group.'}</p>
          <div className="space-y-1.5">
            {MATERIAL_ORDER.map(k => <MaterialRow key={`${group.id}-${k}`} group={group} m={member} kind={k} onInsert={onInsert} onSent={onSent} onPatch={onPatch} />)}
          </div>
        </section>
        <section className="rounded-2xl bg-white p-2 min-[861px]:hidden">
          <h3 className="mb-1 px-1 text-[13px] font-extrabold text-slate-900">Contacts</h3>
          <ContactList state={state} onOpenPrivate={onOpenPrivate} />
        </section>
        <ChannelCard group={group} onChanged={reload} />
        {group.canManage && (
          <button onClick={onArchive} className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /> Archive group</button>
        )}
      </div>
    </aside>
  )
}
