'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle, ArrowLeft, BedDouble, CalendarClock, CalendarDays, Car, Check, CheckCheck, ChevronDown, Clock, CornerDownLeft, Eye,
  FileCheck2, FileText, LayoutDashboard, Loader2, Map as MapIcon, MessageCircle, Palette, Plane, Plus, RefreshCw, Search, Send, Sparkles,
  Square, Sun, Trash2, Users, X, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { countryFlag } from '@/lib/country-detection'
import type { OperationCountry } from '@prisma/client'
import {
  GROUP_COLORS, KIND_META, SETUP_NEEDED_ERROR, memberBlocker,
  type GroupCandidate, type GroupColor, type GroupDetail, type GroupKind, type GroupMember, type GroupSendOutcome, type GroupSummary,
  type GuestBrief, type ReplySuggestions,
} from '@/lib/wa-groups/shared'
import { avatarGradient, fmtListStamp, initials, type Conversation } from './shared'

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
const AUTO_KINDS: GroupKind[] = ['daily', 'day7', 'day3', 'driver']
const ON_DEMAND_KINDS: GroupKind[] = ['flights', 'hotels', 'itinerary']
const ALL_KINDS: GroupKind[] = ['day7', 'day3', 'flights', 'hotels', 'itinerary', 'driver', 'daily']

const AUTO_FIELD = { daily: 'autoDaily', day7: 'autoDay7', day3: 'autoDay3', driver: 'autoDriver' } as const
const AUTO_RULE: Record<string, string> = {
  daily:  'Every trip day. A morning time sends that day, an afternoon time sends the next day.',
  day7:   'Goes out 7 days before arrival.',
  day3:   'Goes out 3 days before arrival, once drivers are fully assigned.',
  driver: 'From the day before arrival once all drivers are assigned, and again if they change.',
}

const SEND_CONCURRENCY = 2

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
  return (
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
    </motion.div>
  )
}

const btnGhost = 'rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50'
const btnPrimary = 'flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-50'

// ── Left rail ────────────────────────────────────────────────────────────────

export function GroupsRail({ selectedId, version, onSelect }: { selectedId: string | null; version: number; onSelect: (id: string) => void }) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const res = await api<GroupSummary[]>('/api/whatsapp/groups')
    if (res.success) setGroups(res.data ?? [])
    else if (res.error === SETUP_NEEDED_ERROR) { setNeedsSetup(true); setGroups([]) }
    else { setGroups([]); toast.error(res.error ?? 'Could not load groups') }
  }, [])
  useEffect(() => { load() }, [load, version])

  if (needsSetup) {
    return (
      <div className="m-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="h-4 w-4" /> Groups need a one-time setup</p>
        <p className="mt-1 text-xs leading-relaxed">The database tables are not installed yet. Run <code className="rounded bg-amber-100 px-1">bash prisma/sql/apply-wa-booking-groups.sh</code>, then refresh this page.</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 px-1">
      <button
        onClick={() => setCreating(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/60 py-3 text-[13px] font-bold text-emerald-700 transition hover:bg-emerald-100/70"
      >
        <Plus className="h-4 w-4" /> New group
      </button>

      {groups === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-slate-100" />)}

      {groups?.length === 0 && (
        <div className="rounded-2xl px-5 py-8 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">No groups yet</p>
          <p className="mt-1 text-xs text-slate-400">Group bookings together, then send each guest their plan, documents and trip details from one place.</p>
        </div>
      )}

      {groups?.map(g => {
        const active = g.id === selectedId
        return (
          <motion.button
            key={g.id} layout onClick={() => onSelect(g.id)}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${active ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'}`}
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md ${GROUP_COLORS[g.color].hero}`}>
              <Users className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-bold text-slate-900">{g.name}</span>
                {g.autoCount > 0 && <span title={`${g.autoCount} automation${g.autoCount === 1 ? '' : 's'} on`} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700"><Zap className="h-2.5 w-2.5" />{g.autoCount}</span>}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {g.total} booking{g.total === 1 ? '' : 's'}
                {g.inTrip > 0 && ` · ${g.inTrip} on trip`}
                {g.nextArrivalDays !== null && ` · next in ${g.nextArrivalDays}d`}
              </span>
            </span>
          </motion.button>
        )
      })}

      <AnimatePresence>
        {creating && <CreateGroup onClose={() => setCreating(false)} onCreated={id => { setCreating(false); load(); onSelect(id) }} onSetupNeeded={() => { setCreating(false); setNeedsSetup(true) }} />}
      </AnimatePresence>
    </div>
  )
}

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

function CreateGroup({ onClose, onCreated, onSetupNeeded }: { onClose: () => void; onCreated: (id: string) => void; onSetupNeeded: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<GroupColor>('emerald')
  const [saving, setSaving] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const res = await api<{ id: string }>('/api/whatsapp/groups', { method: 'POST', body: JSON.stringify({ name, color }) })
    setSaving(false)
    if (res.success && res.data) onCreated(res.data.id)
    else if (res.error === SETUP_NEEDED_ERROR) onSetupNeeded()
    else toast.error(res.error ?? 'Could not create the group')
  }

  return (
    <Sheet
      title="New group" subtitle="For example: November Sri Lanka, MMT honeymooners, Team Nimal"
      icon={<span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-white ${GROUP_COLORS[color].hero}`}><Users className="h-4 w-4" /></span>}
      onClose={onClose}
    >
      <form onSubmit={create} className="space-y-4 p-5">
        <input
          autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Group name" maxLength={120}
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
        />
        <ColorPicker value={color} onChange={setColor} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving || !name.trim()} className={btnPrimary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create group
          </button>
        </div>
      </form>
    </Sheet>
  )
}

// ── Command center ───────────────────────────────────────────────────────────

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

export function GroupCommandCenter({ groupId, state, onBack, onOpenChat, onChanged, onArchived }: {
  groupId: string
  state: ReturnType<typeof useGroupDetail>
  onBack: () => void
  onOpenChat: (m: GroupMember) => void
  onChanged: () => void
  onArchived: () => void
}) {
  const { group, missing, reload: load, setGroup } = state
  const [sendKind, setSendKind] = useState<GroupKind | null>(null)
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  async function patch(p: Partial<GroupDetail>, message?: string) {
    setGroup(g => (g ? { ...g, ...p } : g))
    const res = await api(`/api/whatsapp/groups/${groupId}`, { method: 'PATCH', body: JSON.stringify(p) })
    if (!res.success) { toast.error(res.error ?? 'Could not save'); load(); return }
    if (message) toast.success(message)
    onChanged()
  }

  async function archive() {
    if (!group || !window.confirm(`Archive "${group.name}"? Its automations stop. Messages already sent are not affected.`)) return
    const res = await api(`/api/whatsapp/groups/${groupId}`, { method: 'DELETE' })
    if (res.success) { toast.success('Group archived'); onArchived() }
    else toast.error(res.error ?? 'Could not archive')
  }

  async function removeMember(ref: string) {
    const res = await api(`/api/whatsapp/groups/${groupId}/members?ref=${encodeURIComponent(ref)}`, { method: 'DELETE' })
    if (res.success) { load(); onChanged() }
    else toast.error(res.error ?? 'Could not remove')
  }

  function toggleAuto(kind: GroupKind, on: boolean) {
    if (!group) return
    const field = AUTO_FIELD[kind as keyof typeof AUTO_FIELD]
    const time = kind === 'daily' ? group.dailyTime : group.docTime
    patch({ [field]: on }, on ? `${KIND_META[kind].label} is now automatic at ${time} guest time` : `${KIND_META[kind].label} automation is off`)
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

  const inTrip = group.members.filter(m => m.stage === 'in-trip').length
  const soon = group.members.filter(m => m.stage === 'upcoming' && m.daysToArrival <= 7).length
  const autos = [group.autoDaily, group.autoDay7, group.autoDay3, group.autoDriver].filter(Boolean).length
  const stats = [
    { label: 'Bookings', value: group.members.length },
    { label: 'On trip now', value: inTrip },
    { label: 'Arriving in 7 days', value: soon },
    { label: 'Automations on', value: autos },
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-5 p-4 sm:p-5">
        {/* Hero */}
        <motion.section
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className={`relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 text-white shadow-xl ${GROUP_COLORS[group.color].hero}`}
        >
          <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 right-32 h-44 w-44 rounded-full bg-white/10" />
          <div className="relative flex flex-wrap items-center gap-2">
            <button onClick={onBack} aria-label="Back to groups" className="hidden h-9 w-9 place-items-center rounded-xl bg-white/15 max-[860px]:grid"><ArrowLeft className="h-4 w-4" /></button>
            <div className="min-w-0 flex-1">
              {renaming !== null ? (
                <input
                  autoFocus value={renaming} maxLength={120}
                  onChange={e => setRenaming(e.target.value)}
                  onBlur={() => { const n = renaming.trim(); setRenaming(null); if (n && n !== group.name) patch({ name: n }) }}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}
                  className="w-full max-w-md rounded-lg bg-white/20 px-2 py-0.5 text-2xl font-extrabold tracking-tight outline-none placeholder:text-white/60"
                />
              ) : (
                <button disabled={!group.canManage} onClick={() => setRenaming(group.name)} title="Rename" className="max-w-full truncate text-left text-2xl font-extrabold tracking-tight">{group.name}</button>
              )}
            </div>
            {group.canManage && (
              <>
                <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[13px] font-bold text-slate-900 shadow-md transition hover:bg-white/90">
                  <Plus className="h-4 w-4" /> Add bookings
                </button>
                <button onClick={() => setPaletteOpen(v => !v)} aria-label="Change colour" title="Change colour" className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 transition hover:bg-white/25"><Palette className="h-4 w-4" /></button>
                <button onClick={archive} aria-label="Archive group" title="Archive group" className="grid h-9 w-9 place-items-center rounded-xl bg-white/15 transition hover:bg-white/25"><Trash2 className="h-4 w-4" /></button>
              </>
            )}
          </div>
          {paletteOpen && <div className="relative mt-3 w-fit rounded-2xl bg-white p-2"><ColorPicker value={group.color} onChange={c => { setPaletteOpen(false); patch({ color: c }) }} /></div>}
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map(s => (
              <div key={s.label} className="rounded-2xl bg-white/15 px-3.5 py-2.5 backdrop-blur">
                <p className="text-2xl font-extrabold leading-none tabular-nums">{s.value}</p>
                <p className="mt-1 text-[11px] font-medium text-white/80">{s.label}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {group.members.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center">
            <Users className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-base font-bold text-slate-700">Add the first bookings</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">Pick from upcoming arrivals or search by file number, guest or agent. Each guest gets their own message, never a shared chat.</p>
            {group.canManage && <button onClick={() => setAdding(true)} className={`${btnPrimary} mx-auto mt-4`}><Plus className="h-4 w-4" /> Add bookings</button>}
          </div>
        ) : (
          <>
            {/* Automated journey */}
            <section>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <h2 className="text-sm font-extrabold text-slate-900">Guest journey</h2>
                <p className="text-xs text-slate-500">Send now, or switch on Auto. Times are in each guest&apos;s own timezone.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {AUTO_KINDS.map(kind => (
                  <LaunchTile
                    key={kind} kind={kind} group={group} onSend={() => setSendKind(kind)}
                    auto={{
                      on: group[AUTO_FIELD[kind as keyof typeof AUTO_FIELD]],
                      time: kind === 'daily' ? group.dailyTime : group.docTime,
                      onToggle: v => toggleAuto(kind, v),
                      onTime: t => patch(kind === 'daily' ? { dailyTime: t } : { docTime: t }),
                    }}
                  />
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-sm font-extrabold text-slate-900">Trip details on demand</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {ON_DEMAND_KINDS.map(kind => <LaunchTile key={kind} kind={kind} group={group} onSend={() => setSendKind(kind)} />)}
              </div>
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <Board group={group} onOpenChat={onOpenChat} onRemove={removeMember} />
              <aside className="space-y-5">
                <NextUp group={group} />
                <Activity group={group} />
              </aside>
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {sendKind && <SendSheet key={sendKind} group={group} kind={sendKind} onClose={() => setSendKind(null)} onDone={load} />}
        {adding && <AddBookings group={group} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); onChanged() }} />}
      </AnimatePresence>
    </div>
  )
}

function coverageOf(members: GroupMember[], kind: GroupKind) {
  const reachable = members.filter(m => !memberBlocker(m, kind))
  const sent = reachable.filter(m => (kind === 'daily' ? m.dailyDates.length > 0 : isSent(m.coverage[kind]?.status)))
  return { reachable: reachable.length, sent: sent.length }
}

function LaunchTile({ kind, group, onSend, auto }: {
  kind: GroupKind
  group: GroupDetail
  onSend: () => void
  auto?: { on: boolean; time: string; onToggle: (v: boolean) => void; onTime: (t: string) => void }
}) {
  const Icon = KIND_ICON[kind]
  const { reachable, sent } = coverageOf(group.members, kind)
  const pct = reachable ? Math.round((sent / reachable) * 100) : 0
  const [time, setTime] = useState(auto?.time ?? '')
  useEffect(() => { setTime(auto?.time ?? '') }, [auto?.time])

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`flex flex-col rounded-2xl border bg-white p-3.5 shadow-sm transition ${auto?.on ? 'border-emerald-300 ring-2 ring-emerald-500/10' : 'border-slate-200'}`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-md ${KIND_TINT[kind]}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold leading-tight text-slate-900">{KIND_META[kind].label}</p>
          <p className="mt-0.5 text-xs leading-snug text-slate-500">{KIND_META[kind].blurb}</p>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <div className="flex justify-between text-[11px] font-semibold text-slate-500">
          <span>{kind === 'daily' ? 'Guests who had a plan' : 'Guests who have it'}</span>
          <span className="tabular-nums">{sent} of {reachable}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <motion.div className="h-full rounded-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${pct}%` }} />
        </div>
      </div>

      {auto && (
        <div className="mt-3 rounded-xl bg-slate-50 px-2.5 py-2">
          <div className="flex items-center gap-2">
            <Switch on={auto.on} disabled={!group.canManage} onChange={auto.onToggle} label={`Automatic ${KIND_META[kind].label}`} />
            <span className={`text-xs font-bold ${auto.on ? 'text-emerald-700' : 'text-slate-500'}`}>Auto</span>
            <input
              type="time" value={time} disabled={!group.canManage} aria-label={`${KIND_META[kind].label} send time`}
              onChange={e => setTime(e.target.value)}
              onBlur={() => { if (time && time !== auto.time) auto.onTime(time) }}
              className="ml-auto rounded-md border border-slate-200 bg-white px-1 py-0.5 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-400"
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{AUTO_RULE[kind]}{kind !== 'daily' && ' Shares its time with the other journey documents.'}</p>
        </div>
      )}

      {group.canManage && (
        <button onClick={onSend} className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2 text-[13px] font-bold text-white transition hover:bg-slate-700">
          <Send className="h-3.5 w-3.5" /> Send
        </button>
      )}
    </motion.div>
  )
}

function TripTrack({ m }: { m: GroupMember }) {
  const start = addDays(m.arrival, -7)
  const span = Math.max(1, (Date.parse(m.departure) - Date.parse(start)) / 86400000)
  const at = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - Date.parse(start)) / 86400000 / span) * 100))
  const label = m.stage === 'finished' ? 'Finished'
    : m.stage === 'in-trip' ? `On trip · day ${-m.daysToArrival + 1}`
    : m.daysToArrival === 0 ? 'Arrives today' : `In ${m.daysToArrival} day${m.daysToArrival === 1 ? '' : 's'}`
  return (
    <div className="w-36 shrink-0" title={`${shortDate(m.arrival)} to ${shortDate(m.departure)}`}>
      <p className={`text-[11px] font-bold ${m.stage === 'in-trip' ? 'text-emerald-600' : m.stage === 'finished' ? 'text-slate-400' : 'text-slate-700'}`}>{label}</p>
      <div className="relative mt-1.5 h-1 rounded-full bg-slate-200">
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500" style={{ width: `${at(m.localToday)}%` }} />
        {[addDays(m.arrival, -3), m.arrival].map(d => (
          <span key={d} className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 bg-slate-400" style={{ left: `${at(d)}%` }} />
        ))}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">{shortDate(m.arrival)} → {shortDate(m.departure)}</p>
    </div>
  )
}

function CoverageDot({ m, kind }: { m: GroupMember; kind: GroupKind }) {
  const c = m.coverage[kind]
  const Icon = KIND_ICON[kind]
  const tone = !c ? 'bg-slate-100 text-slate-300'
    : c.status === 'failed' ? 'bg-rose-100 text-rose-600'
    : c.status === 'read' ? 'bg-sky-100 text-sky-600'
    : c.status === 'delivered' ? 'bg-emerald-100 text-emerald-700'
    : 'bg-emerald-50 text-emerald-500'
  const word = !c ? 'not sent' : c.status === 'failed' ? 'failed' : c.status === 'read' ? 'read' : c.status === 'delivered' ? 'delivered' : 'sent'
  return (
    <span title={`${KIND_META[kind].label}: ${word}${c ? ` · ${stamp(c.at)}` : ''}`} className={`grid h-6 w-6 place-items-center rounded-full ${tone}`}>
      <Icon className="h-3 w-3" />
    </span>
  )
}

function Board({ group, onOpenChat, onRemove }: { group: GroupDetail; onOpenChat: (m: GroupMember) => void; onRemove: (ref: string) => void }) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-extrabold text-slate-900">Guests</h2>
        <p className="flex items-center gap-2.5 text-[11px] font-medium text-slate-500">
          <Legend tone="bg-sky-400" label="Read" /><Legend tone="bg-emerald-500" label="Delivered" /><Legend tone="bg-emerald-200" label="Sent" /><Legend tone="bg-rose-400" label="Failed" />
        </p>
      </div>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {group.members.map(m => (
          <div key={m.bookingRef} className={`group/row flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 py-3 ${m.blocked ? 'bg-slate-50/70' : ''}`}>
            <div className="flex min-w-[190px] flex-1 items-center gap-2.5">
              <span style={{ background: avatarGradient(m.bookingRef) }} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white">{initials(m.leadName, m.bookingRef)}</span>
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold text-slate-900">{m.leadName ?? 'Guest'}</p>
                <p className="truncate text-[11px] text-slate-500">{flag(m.country)} {m.isNumber || m.bookingRef} · {m.pax}</p>
                {(m.blocked || !m.phone) && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" /> {m.blocked ?? 'No WhatsApp number'}</p>
                )}
              </div>
            </div>
            <TripTrack m={m} />
            <div className="flex gap-1">{ALL_KINDS.map(k => <CoverageDot key={k} m={m} kind={k} />)}</div>
            <div className="flex w-[68px] justify-end gap-1">
              {m.phone && (
                <button onClick={() => onOpenChat(m)} aria-label={`Open chat with ${m.leadName ?? 'guest'}`} title="Open chat" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"><MessageCircle className="h-4 w-4" /></button>
              )}
              {group.canManage && (
                <button onClick={() => onRemove(m.bookingRef)} aria-label={`Remove ${m.leadName ?? 'booking'} from group`} title="Remove from group" className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const Legend = ({ tone, label }: { tone: string; label: string }) => (
  <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${tone}`} /> {label}</span>
)

function NextUp({ group }: { group: GroupDetail }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-900"><CalendarClock className="h-4 w-4 text-emerald-600" /> Next automatic sends</h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {group.upcoming.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">Nothing scheduled. Switch on Auto above and upcoming sends appear here.</p>
        ) : group.upcoming.map(u => {
          const Icon = KIND_ICON[u.kind]
          return (
            <div key={`${u.kind}-${u.bookingRef}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-white ${KIND_TINT[u.kind]}`}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800">{KIND_META[u.kind].short} · {u.leadName ?? u.bookingRef}</p>
                <p className="text-[11px] text-slate-500">{shortDate(u.date)} at {u.time}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Activity({ group }: { group: GroupDetail }) {
  const tone: Record<string, string> = {
    sent: 'text-emerald-600', failed: 'text-rose-600', skipped: 'text-slate-400', sending: 'text-amber-600',
  }
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-extrabold text-slate-900"><Clock className="h-4 w-4 text-emerald-600" /> Activity</h2>
      <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        {group.activity.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">Sends from this group appear here.</p>
        ) : group.activity.map(a => (
          <div key={a.id} className="rounded-xl px-2 py-1.5">
            <p className="flex items-center gap-1 text-xs font-bold text-slate-800">
              {a.trigger === 'auto' && <Zap className="h-3 w-3 shrink-0 text-amber-500" />}
              <span className="truncate">{KIND_META[a.kind].short} · {a.leadName ?? a.bookingRef}</span>
              <span className={`ml-auto shrink-0 text-[11px] font-bold capitalize ${tone[a.status] ?? 'text-slate-500'}`}>{a.status}</span>
            </p>
            <p className="text-[11px] text-slate-400">{stamp(a.createdAt)}{a.sentByName ? ` · ${a.sentByName}` : ''}</p>
            {a.detail && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{a.detail}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

// ── Send sheet ───────────────────────────────────────────────────────────────

type RowState = { status: 'queued' | 'sending' | GroupSendOutcome['status']; detail?: string | null }

function SendSheet({ group, kind, onClose, onDone }: { group: GroupDetail; kind: GroupKind; onClose: () => void; onDone: () => void }) {
  const Icon = KIND_ICON[kind]
  const isDoc = kind === 'day7' || kind === 'day3'
  const [dayOffset, setDayOffset] = useState(() => (new Date().getHours() < 12 ? 0 : 1))
  const [note, setNote] = useState('')
  const dateFor = useCallback((m: GroupMember) => (kind === 'daily' ? addDays(m.localToday, dayOffset) : undefined), [kind, dayOffset])

  const alreadyHas = useCallback((m: GroupMember) => {
    if (kind === 'daily') return m.dailyDates.includes(addDays(m.localToday, dayOffset))
    return isSent(m.coverage[kind]?.status)
  }, [kind, dayOffset])

  const [ticked, setTicked] = useState<Set<string>>(new Set())
  useEffect(() => {
    setTicked(new Set(group.members.filter(m => !memberBlocker(m, kind, dateFor(m)) && !alreadyHas(m)).map(m => m.bookingRef)))
    // Only when the day changes: a background refresh must not undo the desk's ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayOffset])

  const [previewRef, setPreviewRef] = useState<string | null>(null)
  const previewMember = useMemo(() => {
    const open = group.members.filter(m => !memberBlocker(m, kind, dateFor(m)))
    return open.find(m => m.bookingRef === previewRef) ?? open.find(m => ticked.has(m.bookingRef)) ?? open[0] ?? null
  }, [group.members, previewRef, ticked, kind, dateFor])

  const [preview, setPreview] = useState<{ text: string | null; attachment: string | null; empty?: string } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const previewKey = previewMember ? `${previewMember.bookingRef}|${dayOffset}|${note}` : ''
  useEffect(() => {
    if (!previewKey || !previewMember) { setPreview(null); return }
    let stale = false
    setPreviewing(true)
    const t = setTimeout(async () => {
      const res = await api<{ text: string | null; attachment: string | null; empty?: string }>(`/api/whatsapp/groups/${group.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ preview: true, kind, ref: previewMember.bookingRef, date: dateFor(previewMember), note }),
      })
      if (stale) return
      setPreview(res.success && res.data ? res.data : { text: null, attachment: null, empty: res.error })
      setPreviewing(false)
    }, 300)
    return () => { stale = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey])

  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [phase, setPhase] = useState<'ready' | 'running' | 'done'>('ready')
  const stopRef = useRef(false)

  async function run() {
    const queue = group.members.filter(m => ticked.has(m.bookingRef))
    if (queue.length === 0) return
    stopRef.current = false
    setPhase('running')
    setRows(Object.fromEntries(queue.map(m => [m.bookingRef, { status: 'queued' as const }])))
    const set = (ref: string, s: RowState) => setRows(r => ({ ...r, [ref]: s }))

    let next = 0
    const worker = async () => {
      while (next < queue.length && !stopRef.current) {
        const m = queue[next++]
        set(m.bookingRef, { status: 'sending' })
        const res = await api<GroupSendOutcome>(`/api/whatsapp/groups/${group.id}/send`, {
          method: 'POST',
          body: JSON.stringify({ kind, ref: m.bookingRef, date: dateFor(m), note, resend: alreadyHas(m) }),
        })
        if (res.success && res.data) set(m.bookingRef, res.data)
        else set(m.bookingRef, { status: 'failed', detail: res.error ?? 'Send failed' })
      }
    }
    await Promise.all(Array.from({ length: SEND_CONCURRENCY }, worker))
    setPhase('done')
    onDone()
  }

  const counts = Object.values(rows).reduce<Record<string, number>>((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {})
  const finished = (counts.sent ?? 0) + (counts.failed ?? 0) + (counts.skipped ?? 0)
  const total = Object.keys(rows).length

  const close = () => { if (phase !== 'running') onClose() }

  return (
    <Sheet
      wide onClose={close}
      title={`Send ${KIND_META[kind].label.toLowerCase()}`}
      subtitle={`${group.name}: each guest gets their own message`}
      icon={<span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-white shadow-md ${KIND_TINT[kind]}`}><Icon className="h-4 w-4" /></span>}
      footer={
        <>
          {phase !== 'ready' && (
            <p className="mr-auto text-xs font-semibold text-slate-600">
              {finished} of {total} done · {counts.sent ?? 0} sent{counts.failed ? ` · ${counts.failed} failed` : ''}{counts.skipped ? ` · ${counts.skipped} skipped` : ''}
            </p>
          )}
          {phase === 'running' ? (
            <button onClick={() => { stopRef.current = true }} className={`${btnGhost} flex items-center gap-1.5`}><Square className="h-3.5 w-3.5" /> Stop after current</button>
          ) : phase === 'done' ? (
            <button onClick={onClose} className={btnPrimary}><Check className="h-4 w-4" /> Done</button>
          ) : (
            <>
              <button onClick={onClose} className={btnGhost}>Cancel</button>
              <button onClick={run} disabled={ticked.size === 0} className={btnPrimary}>
                <Send className="h-4 w-4" /> Send to {ticked.size} guest{ticked.size === 1 ? '' : 's'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 border-b border-slate-100 p-4 md:border-b-0 md:border-r">
          {kind === 'daily' && (
            <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1">
              {[{ v: 0, l: "Today's plan" }, { v: 1, l: "Tomorrow's plan" }].map(o => (
                <button key={o.v} disabled={phase !== 'ready'} onClick={() => setDayOffset(o.v)} className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${dayOffset === o.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{o.l}</button>
              ))}
            </div>
          )}
          {isDoc && (
            <input
              value={note} onChange={e => setNote(e.target.value)} maxLength={300} disabled={phase !== 'ready'}
              placeholder="Optional line for the message, e.g. Your driver will call you the evening before"
              className="mb-3 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-[13px] outline-none focus:border-emerald-400 focus:bg-white"
            />
          )}
          <ul className="space-y-1">
            {group.members.map(m => {
              const blocker = memberBlocker(m, kind, dateFor(m))
              const row = rows[m.bookingRef]
              const has = alreadyHas(m)
              const on = ticked.has(m.bookingRef)
              const driversShort = kind === 'day3' && m.readiness.driversAssigned < m.readiness.driverItems
              return (
                <li key={m.bookingRef} className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 ${previewMember?.bookingRef === m.bookingRef ? 'bg-emerald-50/70' : ''}`}>
                  {row ? <RowIcon status={row.status} /> : (
                    <input
                      type="checkbox" checked={on} disabled={Boolean(blocker)} aria-label={`Send to ${m.leadName ?? m.bookingRef}`}
                      onChange={() => setTicked(s => { const n = new Set(s); if (on) n.delete(m.bookingRef); else n.add(m.bookingRef); return n })}
                      className="h-4 w-4 shrink-0 accent-emerald-600"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] font-semibold ${blocker ? 'text-slate-400' : 'text-slate-800'}`}>{m.leadName ?? 'Guest'} <span className="font-normal text-slate-400">{m.isNumber || m.bookingRef}</span></p>
                    {row?.detail ? <p className={`text-[11px] leading-snug ${row.status === 'failed' ? 'text-rose-600' : 'text-slate-500'}`}>{row.detail}</p>
                      : blocker ? <p className="text-[11px] text-slate-400">{blocker}</p>
                      : has ? <p className="text-[11px] text-slate-500">Already sent. Tick to send again.</p>
                      : driversShort ? <p className="text-[11px] text-amber-700">Drivers {m.readiness.driversAssigned} of {m.readiness.driverItems} assigned</p>
                      : null}
                  </div>
                  {!blocker && !row && (
                    <button onClick={() => setPreviewRef(m.bookingRef)} aria-label={`Preview for ${m.leadName ?? m.bookingRef}`} title="Preview this guest's message" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="bg-[#efeae2] p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Preview{previewMember ? `: ${previewMember.leadName ?? previewMember.bookingRef}` : ''}
            {previewing && <Loader2 className="h-3 w-3 animate-spin" />}
          </p>
          {preview?.text ? (
            <div className="rounded-2xl rounded-tl-sm bg-white p-3 text-[13px] leading-relaxed text-slate-800 shadow-sm">
              {preview.attachment && (
                <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-2.5 py-2 text-xs font-semibold text-slate-700">
                  <FileText className="h-4 w-4 text-rose-500" /> {preview.attachment}
                </div>
              )}
              <p className="whitespace-pre-wrap break-words"><WaText text={preview.text} /></p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">{preview?.empty ?? (previewMember ? 'Loading…' : 'No guest can receive this right now.')}</p>
          )}
          {kind === 'daily' && <p className="mt-2 text-[11px] leading-snug text-slate-500">Ticket and voucher files for the day follow as separate messages.</p>}
        </div>
      </div>
    </Sheet>
  )
}

function RowIcon({ status }: { status: RowState['status'] }) {
  if (status === 'sending') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-500" />
  if (status === 'sent') return <CheckCheck className="h-4 w-4 shrink-0 text-emerald-600" />
  if (status === 'failed') return <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
  if (status === 'skipped') return <X className="h-4 w-4 shrink-0 text-slate-400" />
  return <Clock className="h-4 w-4 shrink-0 text-slate-300" />
}

// ── Add bookings ─────────────────────────────────────────────────────────────

const WINDOWS = [
  { key: 'next7', label: 'Next 7 days' }, { key: 'next14', label: 'Next 14 days' }, { key: 'next30', label: 'Next 30 days' },
  { key: 'intrip', label: 'On trip now' }, { key: 'all', label: 'All upcoming' },
]

function AddBookings({ group, onClose, onAdded }: { group: GroupDetail; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState('')
  const [window_, setWindow] = useState('next14')
  const [rows, setRows] = useState<GroupCandidate[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const inGroup = useMemo(() => new Set(group.members.map(m => m.bookingRef)), [group.members])

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

  const selectable = (rows ?? []).filter(r => !inGroup.has(r.bookingRef))
  const allOn = selectable.length > 0 && selectable.every(r => picked.has(r.bookingRef))

  async function add() {
    setSaving(true)
    const res = await api<{ added: number }>(`/api/whatsapp/groups/${group.id}/members`, { method: 'POST', body: JSON.stringify({ refs: Array.from(picked) }) })
    setSaving(false)
    if (res.success) { toast.success(`${res.data?.added ?? 0} added to ${group.name}`); onAdded() }
    else toast.error(res.error ?? 'Could not add those bookings')
  }

  return (
    <Sheet
      title="Add bookings" subtitle={group.name} onClose={onClose}
      icon={<span className={`grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br text-white ${GROUP_COLORS[group.color].hero}`}><Plus className="h-4 w-4" /></span>}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={add} disabled={picked.size === 0 || saving} className={btnPrimary}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add {picked.size || ''}
          </button>
        </>
      }
    >
      <div className="sticky top-0 z-10 space-y-2 border-b border-slate-100 bg-white p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="File number, ref, guest or agent"
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
          />
        </div>
        {q.trim().length < 2 && (
          <div className="flex flex-wrap gap-1.5">
            {WINDOWS.map(w => (
              <button key={w.key} onClick={() => setWindow(w.key)} className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold transition ${window_ === w.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{w.label}</button>
            ))}
          </div>
        )}
        {selectable.length > 0 && (
          <label className="flex w-fit items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox" checked={allOn} className="h-4 w-4 accent-emerald-600"
              onChange={() => setPicked(s => {
                const n = new Set(s)
                selectable.forEach(r => (allOn ? n.delete(r.bookingRef) : n.add(r.bookingRef)))
                return n
              })}
            />
            Select all shown ({selectable.length})
          </label>
        )}
      </div>
      <ul className="p-2">
        {rows === null && <li className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></li>}
        {rows?.length === 0 && <li className="px-3 py-10 text-center text-sm text-slate-500">No live bookings found.</li>}
        {rows?.map(r => {
          const member = inGroup.has(r.bookingRef)
          return (
            <li key={r.bookingRef}>
              <label className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${member ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                <input
                  type="checkbox" disabled={member} checked={member || picked.has(r.bookingRef)} className="h-4 w-4 accent-emerald-600"
                  onChange={() => setPicked(s => { const n = new Set(s); if (n.has(r.bookingRef)) n.delete(r.bookingRef); else n.add(r.bookingRef); return n })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-800">{r.leadName ?? 'Guest'}</span>
                  <span className="block truncate text-[11px] text-slate-500">{flag(r.country)} {r.isNumber || r.bookingRef}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-slate-500">
                  <span className="flex items-center justify-end gap-1"><CalendarDays className="h-3 w-3" /> {shortDate(r.arrival)}</span>
                  {member ? <span className="font-semibold">In group</span> : !r.hasPhone && <span className="font-semibold text-amber-700">No number</span>}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}

// ── Contact list (left pane of an open group) ────────────────────────────────

type ContactFilter = 'all' | 'unread' | 'trip' | 'soon'

export function GroupContacts({ state, conversations, activeRef, onBack, onOverview, onOpen }: {
  state: ReturnType<typeof useGroupDetail>
  conversations: Conversation[]
  activeRef: string | null
  onBack: () => void
  onOverview: () => void
  onOpen: (m: GroupMember) => void
}) {
  const { group } = state
  const [filter, setFilter] = useState<ContactFilter>('all')
  const byPhone = useMemo(() => new Map(conversations.map(c => [c.phone, c])), [conversations])

  if (!group) return <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-500" /></div>

  const unreadOf = (m: GroupMember) => (m.phone ? byPhone.get(m.phone)?.unreadCount ?? 0 : 0)
  const unread = group.members.filter(m => unreadOf(m) > 0).length
  const chips: { key: ContactFilter; label: string }[] = [
    { key: 'all', label: `All ${group.members.length}` },
    { key: 'unread', label: `Unread ${unread}` },
    { key: 'trip', label: 'On trip' },
    { key: 'soon', label: 'Arriving soon' },
  ]
  const rows = group.members
    .filter(m => filter === 'all' || (filter === 'unread' ? unreadOf(m) > 0
      : filter === 'trip' ? m.stage === 'in-trip' : m.stage === 'upcoming' && m.daysToArrival <= 7))
    .sort((a, b) =>
      (byPhone.get(b.phone ?? '')?.updatedAt ?? '').localeCompare(byPhone.get(a.phone ?? '')?.updatedAt ?? ''))

  return (
    <div className="px-1">
      <div className={`relative mb-2 overflow-hidden rounded-2xl bg-gradient-to-br p-3 text-white shadow-md ${GROUP_COLORS[group.color].hero}`}>
        <div className="flex items-center gap-2">
          <button onClick={onBack} aria-label="All groups" title="All groups" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 transition hover:bg-white/25"><ArrowLeft className="h-4 w-4" /></button>
          <p className="min-w-0 flex-1 truncate text-[14px] font-extrabold">{group.name}</p>
          <button onClick={onOverview} className="flex shrink-0 items-center gap-1 rounded-lg bg-white/15 px-2 py-1.5 text-[11px] font-bold transition hover:bg-white/25"><LayoutDashboard className="h-3.5 w-3.5" /> Overview</button>
        </div>
      </div>
      <div className="mb-1.5 flex gap-1 overflow-x-auto pb-1">
        {chips.map(c => (
          <button key={c.key} onClick={() => setFilter(c.key)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition ${filter === c.key ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{c.label}</button>
        ))}
      </div>
      {rows.length === 0 && <p className="px-3 py-8 text-center text-xs text-slate-500">No guests match this filter.</p>}
      {rows.map(m => {
        const c = m.phone ? byPhone.get(m.phone) : undefined
        const n = unreadOf(m)
        const when = m.stage === 'in-trip' ? 'On trip' : m.stage === 'finished' ? 'Finished' : m.daysToArrival === 0 ? 'Today' : `T-${m.daysToArrival}`
        return (
          <button
            key={m.bookingRef} disabled={!m.phone} onClick={() => onOpen(m)}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition disabled:opacity-60 ${activeRef === m.bookingRef ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-slate-50'}`}
          >
            <span style={{ background: avatarGradient(m.bookingRef) }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white">{initials(m.leadName, m.bookingRef)}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className={`truncate text-[13.5px] text-slate-900 ${n ? 'font-extrabold' : 'font-bold'}`}>{m.leadName ?? 'Guest'}</span>
                {c && <span className={`ml-auto shrink-0 text-[11px] ${n ? 'font-bold text-emerald-600' : 'text-slate-400'}`}>{fmtListStamp(c.updatedAt)}</span>}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{!m.phone ? 'No WhatsApp number' : c?.snippet || 'No messages yet'}</span>
                {n > 0 && <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">{n}</span>}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[10.5px] font-bold">
                <span className="truncate text-slate-400">{flag(m.country)} {m.isNumber || m.bookingRef}</span>
                <span className={`rounded-full px-1.5 ${m.stage === 'in-trip' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{when}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Trip panel (right pane of a guest chat) ──────────────────────────────────

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

function MaterialRow({ group, m, kind, onInsert, onSent }: {
  group: GroupDetail; m: GroupMember; kind: GroupKind; onInsert: (text: string) => void; onSent: () => void
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
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {already ? 'Send again' : `Send to ${m.leadName?.split(' ')[0] ?? 'guest'}`}
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

function ReplyCoach({ groupId, m, latest, onInsert }: {
  groupId: string; m: GroupMember; latest: { id: string; direction: string } | null; onInsert: (text: string) => void
}) {
  const [state, setState] = useState<{ key: string; data?: ReplySuggestions; error?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState('')
  const asked = useRef(new Set<string>())

  const ask = useCallback(async (key: string, withHint?: string) => {
    setLoading(true)
    const res = await api<ReplySuggestions>(`/api/whatsapp/groups/${groupId}/suggest`, {
      method: 'POST', body: JSON.stringify({ ref: m.bookingRef, hint: withHint }),
    })
    setLoading(false)
    setState(res.success && res.data ? { key, data: res.data } : { key, error: res.error ?? 'Suggestions are unavailable right now.' })
  }, [groupId, m.bookingRef])

  // Drafts itself once per new guest message, so an open chat costs one call.
  useEffect(() => {
    if (latest?.direction !== 'inbound') return
    const key = `${m.bookingRef}|${latest.id}`
    if (asked.current.has(key)) return
    asked.current.add(key)
    ask(key)
  }, [latest, m.bookingRef, ask])

  return (
    <section className="rounded-2xl bg-gradient-to-br from-violet-50 via-white to-sky-50 p-3 ring-1 ring-violet-200/70">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 text-white"><Sparkles className="h-3.5 w-3.5" /></span>
        <p className="flex-1 text-[13px] font-extrabold text-slate-900">Suggested replies</p>
        <button onClick={() => ask(`manual-${Date.now()}`, hint)} disabled={loading} aria-label="New suggestions" title="New suggestions" className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>

      {loading && !state?.data && <div className="mt-2 space-y-1.5"><div className="h-12 animate-pulse rounded-xl bg-violet-100/70" /><div className="h-12 animate-pulse rounded-xl bg-violet-100/50" /></div>}
      {state?.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}
      {!state && !loading && <p className="mt-1.5 text-xs text-slate-500">Drafts appear when the guest writes, using this booking&apos;s details. Press refresh to draft one now.</p>}
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
      <p className="mt-1.5 text-[10.5px] text-slate-400">Goes to the chat box only. Check it before you send.</p>
    </section>
  )
}

export function GuestTripPanel({ group, member, latest, open, onClose, onInsert, onSent }: {
  group: GroupDetail
  member: GroupMember
  latest: { id: string; direction: string } | null
  /** Below the three-pane width the panel is a drawer; this says it is showing. */
  open: boolean
  onClose: () => void
  onInsert: (text: string) => void
  onSent: () => void
}) {
  const [brief, setBrief] = useState<GuestBrief | null>(null)
  useEffect(() => {
    let stale = false
    setBrief(null)
    api<GuestBrief>(`/api/whatsapp/groups/${group.id}/brief?ref=${encodeURIComponent(member.bookingRef)}`).then(res => {
      if (!stale && res.success && res.data) setBrief(res.data)
    })
    return () => { stale = true }
  }, [group.id, member.bookingRef])

  return (
    <aside className={`${open ? 'fixed inset-y-0 right-0 z-30 flex shadow-2xl' : 'hidden'} w-[340px] max-w-full shrink-0 flex-col border-l border-slate-200/80 bg-slate-100/80 backdrop-blur min-[1180px]:static min-[1180px]:z-auto min-[1180px]:flex min-[1180px]:shadow-none`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex justify-end min-[1180px]:hidden">
          <button onClick={onClose} aria-label="Close trip panel" className="grid h-8 w-8 place-items-center rounded-lg bg-white text-slate-500"><X className="h-4 w-4" /></button>
        </div>
        <BoardingPass m={member} brief={brief} color={group.color} />
        {group.canManage && <ReplyCoach key={member.bookingRef} groupId={group.id} m={member} latest={latest} onInsert={onInsert} />}
        <section>
          <h3 className="mb-1.5 px-1 text-[13px] font-extrabold text-slate-900">Send to this guest</h3>
          <div className="space-y-1.5">
            {MATERIAL_ORDER.map(k => <MaterialRow key={`${member.bookingRef}-${k}`} group={group} m={member} kind={k} onInsert={onInsert} onSent={onSent} />)}
          </div>
        </section>
      </div>
    </aside>
  )
}
