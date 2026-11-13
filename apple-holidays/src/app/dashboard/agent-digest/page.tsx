'use client'

/**
 * Agent Daily Digest
 *
 * Design a daily WhatsApp / email for an agent (e.g. 30 Sundays) — their
 * on-ground trips with every MC / agenda line's driver, vehicle, driver
 * vendor, guide and tour vendor — and let it go out by itself every day.
 *
 *   Designer — blocks (on ground today, arriving tomorrow …), fields,
 *              recipients, timing; live WhatsApp + email preview of real data.
 *   Tomorrow — what every digest will send next, built live, nothing sent.
 *   History  — every delivery, by day (yesterday by default), with the exact
 *              message and the frozen snapshot behind it.
 *   Tickets  — the ticket radar: every booking arriving soon, how far its
 *              tickets have got and what the ticket pack will do with it.
 *
 * A digest of kind TICKETS is a ticket pack: every ticket of the guests arriving
 * in N days (D-3 by default), with status and files to download.
 *
 * Safety: previews never write; "Send test" goes only to the number/email you
 * type; auto-send is OFF until switched on per digest.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowDown, ArrowUp, Archive, BellRing, CalendarClock, CalendarDays, Check, CheckCircle2,
  ChevronLeft, ChevronRight, Clock, ExternalLink, Eye, FlaskConical, History, Layers, Loader2, Mail,
  FileText, MessageCircle, Plane, Plus, Radar, RefreshCw, Rocket, RotateCcw, Save, Search, Send, ShieldCheck, Smartphone, Sparkles, Ticket, Trash2, Users, X, XCircle, Zap,
} from 'lucide-react'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { CountryFlag } from '@/components/ui/country-flag'
import { cn } from '@/lib/utils'
import {
  addDays, BASIS_META, defaultConfig, DIGEST_COUNTRIES, DIGEST_COUNTRY_META, DIGEST_PRESETS, DIGEST_TIMEZONES,
  FIELD_GROUPS, fmtDay, fmtShort, isEmail, isEmptyPayload, newId, normaliseConfig, relDayLabel, renderEmailHtml,
  renderTemplateText, SCOPE_META, templateParams, todayIn,
  type DateBasis, type DigestBlock, type DigestConfig, type DigestPayload, type DigestRecipient, type DigestRuleView,
} from '@/lib/agent-digest/shared'
import {
  TICKET_CATEGORIES, TICKET_HOLD_META, TICKET_SHOW_FIELDS, TICKET_STATE_META,
  type TicketHold, type TicketPackConfig, type TicketState,
} from '@/lib/agent-digest/tickets-config'

// ── API ──────────────────────────────────────────────────────────────────────

async function api<T>(url: string, init?: RequestInit): Promise<{ data: T; message?: string }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) throw new Error(json.error || `Request failed (${res.status})`)
  return { data: json.data as T, message: json.message }
}

interface ArchivedRule { id: string; name: string; archivedAt: string; archivedByName: string | null }

interface Overview {
  setupRequired: boolean
  setupMessage: string | null
  rules: DigestRuleView[]
  archived?: ArchivedRule[]
  counters: { today: { sent: number; failed: number }; yesterday: { sent: number; failed: number } } | null
  today: string
  templateName: string
  me: string
}

interface Draft {
  id: string | null
  name: string
  isActive: boolean
  autoSend: boolean
  sendTime: string
  timezone: string
  config: DigestConfig
}

interface SendResult {
  runDate: string; link: string | null; sent: number; failed: number; skipped: number; reason?: string
  details: { name: string; channel: string; to: string; status: string; mode?: string; note?: string }[]
}

interface HistoryRow {
  id: string; runId: string | null; ruleId: string | null; ruleName: string; runDate: string; channel: string
  recipient: string; recipientName: string | null; status: string; mode: string | null; subject: string | null
  error: string | null; trigger: string; sentByName: string | null; bookingCount: number; itemCount: number; createdAt: string
}

interface UpcomingItem {
  rule: DigestRuleView; runDate: string; sendAt: string; payload: DigestPayload; willSkip: boolean
  recipients: { name: string; whatsapp: string | null; email: string | null }[]
}

const blankDraft = (): Draft => ({
  id: null, name: '', isActive: true, autoSend: false, sendTime: '07:00', timezone: 'Asia/Colombo', config: defaultConfig(),
})

const fromRule = (r: DigestRuleView): Draft => ({
  id: r.id, name: r.name, isActive: r.isActive, autoSend: r.autoSend, sendTime: r.sendTime, timezone: r.timezone,
  config: normaliseConfig(r.config),
})

function countdown(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'now'
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h >= 24 ? `in ${Math.floor(h / 24)}d ${h % 24}h` : h ? `in ${h}h ${m}m` : `in ${m}m`
}

/** Renders a popup on <body>, as ui/modal does, so nothing in the page can offset or clip it. Client-only: popups open on a click. */
function BodyPortal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}

/** Stops the page behind a popup scrolling, without the layout jumping when the scrollbar goes. */
function useBodyScrollLock() {
  useEffect(() => {
    const { overflow, paddingRight } = document.body.style
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
    return () => {
      document.body.style.overflow = overflow
      document.body.style.paddingRight = paddingRight
    }
  }, [])
}

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// ── Small UI atoms ───────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button" disabled={disabled} aria-label={label} aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', on ? 'bg-emerald-500' : 'bg-slate-300')}
    >
      <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  )
}

function Section({ icon, title, hint, children, right }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-xl bg-teal-50 text-teal-600">{icon}</div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {hint && <p className="text-xs text-slate-500">{hint}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20'

// ── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'designer' | 'upcoming' | 'radar' | 'history'

export default function AgentDigestPage() {
  const [tab, setTab] = useState<Tab>('designer')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [showGallery, setShowGallery] = useState(false)

  const load = useCallback(async (selectId?: string | null) => {
    setLoading(true)
    try {
      const { data } = await api<Overview>('/api/agent-digest')
      setOverview(data)
      setDraft(cur => {
        const wanted = selectId !== undefined ? selectId : cur?.id
        const hit = wanted ? data.rules.find(r => r.id === wanted) : null
        if (hit) return fromRule(hit)
        if (cur && !cur.id) return cur
        return data.rules[0] ? fromRule(data.rules[0]) : null
      })
      setDirty(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const patch = useCallback((p: Partial<Draft>) => { setDraft(d => (d ? { ...d, ...p } : d)); setDirty(true) }, [])
  const patchConfig = useCallback((p: Partial<DigestConfig>) => {
    setDraft(d => (d ? { ...d, config: { ...d.config, ...p } } : d)); setDirty(true)
  }, [])

  const pick = (r: DigestRuleView) => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    setDraft(fromRule(r)); setDirty(false); setTab('designer')
  }

  const restore = async (r: ArchivedRule) => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    try {
      await api(`/api/agent-digest/rules?id=${r.id}`, { method: 'PATCH' })
      toast.success(`Restored “${r.name}” — auto-send is off until you turn it on`)
      setTab('designer')
      await load(r.id)
    } catch (e) { toast.error((e as Error).message) }
  }

  const startFromPreset = (key: string) => {
    if (dirty && !confirm('Discard unsaved changes?')) return
    const preset = DIGEST_PRESETS.find(p => p.key === key)!
    const built = preset.build()
    const base = blankDraft()
    const { name, ...cfg } = built
    setDraft({ ...base, name, config: normaliseConfig({ ...base.config, ...cfg }) })
    setDirty(true); setShowGallery(false); setTab('designer')
  }

  const rules = useMemo(() => overview?.rules ?? [], [overview])
  const stats = useMemo(() => ({
    total: rules.length,
    auto: rules.filter(r => r.autoSend && r.isActive).length,
    sentToday: overview?.counters?.today.sent ?? 0,
    failedToday: overview?.counters?.today.failed ?? 0,
    sentYesterday: overview?.counters?.yesterday.sent ?? 0,
  }), [rules, overview])

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-900 to-teal-900 px-6 pb-6 pt-7 text-white">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
              <BellRing className="h-3.5 w-3.5" /> Agent Daily Digest
            </div>
            <h1 className="mt-1.5 text-2xl font-bold">Every agent, every morning — who’s driving, guiding and supplying.</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Build a daily WhatsApp / email for an agent like 30 Sundays: today’s on-ground trips line by line, tomorrow’s arrivals,
              with the allocated driver, vehicle, driver vendor, guide and tour vendor.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />} onClick={() => load()}>Refresh</Button>
            <Button variant="secondary" size="sm" icon={<Ticket className="h-3.5 w-3.5" />} onClick={() => startFromPreset('ticket-pack')} disabled={overview?.setupRequired}>New ticket pack</Button>
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowGallery(true)} disabled={overview?.setupRequired}>New digest</Button>
          </div>
        </div>

        <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: 'Digests', value: stats.total, icon: <Layers className="h-4 w-4" /> },
            { label: 'Auto-sending', value: stats.auto, icon: <Zap className="h-4 w-4" /> },
            { label: 'Sent today', value: stats.sentToday, icon: <CheckCircle2 className="h-4 w-4" /> },
            { label: 'Failed today', value: stats.failedToday, icon: <XCircle className="h-4 w-4" />, warn: stats.failedToday > 0 },
            { label: 'Sent yesterday', value: stats.sentYesterday, icon: <History className="h-4 w-4" /> },
          ].map(s => (
            <div key={s.label} className={cn('rounded-2xl border px-4 py-3 backdrop-blur', s.warn ? 'border-rose-400/40 bg-rose-500/15' : 'border-white/10 bg-white/5')}>
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">{s.icon}{s.label}</div>
              <div className="mt-1 text-2xl font-bold">{s.value}</div>
            </div>
          ))}
        </div>

        <div className="relative mt-5 flex w-fit max-w-full flex-wrap gap-1 rounded-xl bg-white/5 p-1 text-sm">
          {([
            ['designer', 'Designer', <Sparkles key="a" className="h-4 w-4" />],
            ['upcoming', 'Tomorrow’s sends', <CalendarClock key="b" className="h-4 w-4" />],
            ['radar', 'Ticket radar', <Radar key="d" className="h-4 w-4" />],
            ['history', 'Sent history', <History key="c" className="h-4 w-4" />],
          ] as [Tab, string, React.ReactNode][]).map(([k, label, icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={cn('flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 font-medium transition', tab === k ? 'bg-white text-slate-900 shadow' : 'text-slate-300 hover:text-white')}>
              {icon}{label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {overview?.setupRequired && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">One-time setup needed</p>
              <p className="mt-0.5">{overview.setupMessage}</p>
            </div>
          </div>
        )}

        {tab === 'designer' && (
          <div className="grid gap-5 xl:grid-cols-[260px_minmax(0,1fr)]">
            <RuleRail rules={rules} archived={overview?.archived ?? []} activeId={draft?.id ?? null} onPick={pick} onRestore={restore} onNew={() => setShowGallery(true)} loading={loading} />
            {draft ? (
              <Designer
                draft={draft} dirty={dirty} patch={patch} patchConfig={patchConfig}
                onSaved={id => load(id)} onArchived={() => { setDraft(null); load(null) }}
                setupRequired={!!overview?.setupRequired} me={overview?.me ?? ''}
              />
            ) : (
              <EmptyState onNew={() => setShowGallery(true)} disabled={!!overview?.setupRequired} />
            )}
          </div>
        )}
        {tab === 'upcoming' && <UpcomingTab onOpen={r => pick(r)} />}
        {tab === 'radar' && <RadarTab rules={rules} onNewPack={() => startFromPreset('ticket-pack')} />}
        {tab === 'history' && <HistoryTab rules={rules} />}
      </div>

      {showGallery && <BodyPortal><PresetGallery onPick={startFromPreset} onClose={() => setShowGallery(false)} /></BodyPortal>}
    </div>
  )
}

// ── Left rail ────────────────────────────────────────────────────────────────

function RuleRail({ rules, archived, activeId, onPick, onRestore, onNew, loading }: {
  rules: DigestRuleView[]; archived: ArchivedRule[]; activeId: string | null; onPick: (r: DigestRuleView) => void
  onRestore: (r: ArchivedRule) => void; onNew: () => void; loading: boolean
}) {
  const [, tick] = useState(0)
  const [showArchived, setShowArchived] = useState(false)
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  return (
    <aside className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Your digests</p>
        <button onClick={onNew} className="rounded-lg p-1 text-slate-500 hover:bg-slate-200" aria-label="New digest"><Plus className="h-4 w-4" /></button>
      </div>
      {loading && !rules.length && <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {rules.map(r => (
        <button key={r.id} onClick={() => onPick(r)}
          className={cn('w-full rounded-2xl border p-3.5 text-left transition',
            r.id === activeId ? 'border-teal-500 bg-white shadow-md ring-2 ring-teal-500/15' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm')}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold leading-tight text-slate-900">{r.name}</p>
            <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', !r.isActive ? 'bg-slate-300' : r.autoSend ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,.2)]' : 'bg-amber-400')} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {(r.config.agents.length ? r.config.agents.slice(0, 2) : ['All agents']).map(a => (
              <span key={a} className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">{a}</span>
            ))}
            {r.config.countries.map(c => <CountryFlag key={c} country={c} className="h-3 w-4 rounded-[2px]" />)}
            {r.config.kind === 'TICKETS' && <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700"><Ticket className="h-2.5 w-2.5" />D-{r.config.ticketPack.daysBefore}</span>}
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
            <Clock className="h-3 w-3" />
            {r.autoSend && r.isActive ? <>Daily {r.sendTime} · <b className="font-semibold text-emerald-700">{countdown(r.nextSendAt)}</b></> : <span>Manual only</span>}
          </div>
          {r.lastSentAt && (
            <div className={cn('mt-1 text-[11px]', r.lastStatus === 'failed' ? 'text-rose-600' : 'text-slate-400')}>
              Last {r.lastStatus === 'failed' && r.lastTotalCount && r.lastFailedCount !== r.lastTotalCount
                ? `send: ${r.lastFailedCount} of ${r.lastTotalCount} failed`
                : r.lastStatus} {ago(r.lastSentAt)}
              {r.lastStatus === 'failed' && r.lastError && (
                <span className="mt-0.5 block line-clamp-2 break-words text-[10px] text-rose-500" title={r.lastError}>{r.lastError}</span>
              )}
            </div>
          )}
        </button>
      ))}
      {!loading && !rules.length && <p className="px-1 py-4 text-xs text-slate-400">No digests yet.</p>}
      {archived.length > 0 && (
        <div className="pt-2">
          <button onClick={() => setShowArchived(v => !v)} aria-expanded={showArchived}
            className="flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
            <Archive className="h-3.5 w-3.5" /> Archived ({archived.length})
            <span className="ml-auto text-[11px] font-medium">{showArchived ? 'Hide' : 'Show'}</span>
          </button>
          {showArchived && (
            <div className="mt-1 space-y-1.5">
              {archived.map(r => (
                <div key={r.id} className="rounded-xl border border-dashed border-slate-300 bg-white/60 p-2.5">
                  <p className="text-[13px] font-medium leading-tight text-slate-700">{r.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Archived {ago(r.archivedAt)}{r.archivedByName ? ` by ${r.archivedByName}` : ''}</p>
                  <button onClick={() => onRestore(r)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900">
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

function EmptyState({ onNew, disabled }: { onNew: () => void; disabled: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white px-6 py-20 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-500 text-white shadow-lg"><Sparkles className="h-7 w-7" /></div>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Design your first daily digest</h2>
      <p className="mt-1 max-w-md text-sm text-slate-500">Pick a starter — e.g. the 30 Sundays daily ops update — then shape the blocks, fields and recipients. Nothing is sent until you say so.</p>
      <Button className="mt-5" icon={<Plus className="h-4 w-4" />} onClick={onNew} disabled={disabled}>New digest</Button>
    </div>
  )
}

function PresetGallery({ onPick, onClose }: { onPick: (key: string) => void; onClose: () => void }) {
  useBodyScrollLock()
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-full w-full max-w-3xl overflow-y-auto overscroll-contain rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Start a new digest</h2>
            <p className="text-sm text-slate-500">Choose a starting point — everything stays editable.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {DIGEST_PRESETS.map(p => (
            <button key={p.key} onClick={() => onPick(p.key)}
              className="group rounded-2xl border border-slate-200 p-4 text-left transition hover:-translate-y-0.5 hover:border-teal-400 hover:shadow-lg">
              <div className="text-3xl">{p.emoji}</div>
              <p className="mt-2 font-semibold text-slate-900 group-hover:text-teal-700">{p.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{p.blurb}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Designer ─────────────────────────────────────────────────────────────────

function Designer({ draft, dirty, patch, patchConfig, onSaved, onArchived, setupRequired, me }: {
  draft: Draft; dirty: boolean
  patch: (p: Partial<Draft>) => void
  patchConfig: (p: Partial<DigestConfig>) => void
  onSaved: (id: string) => void
  onArchived: () => void
  setupRequired: boolean
  me: string
}) {
  const c = draft.config
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [confirmSend, setConfirmSend] = useState(false)
  const [showTest, setShowTest] = useState(false)
  const [lastResult, setLastResult] = useState<SendResult | null>(null)

  const save = async () => {
    setSaving(true)
    try {
      const body = JSON.stringify({ name: draft.name, isActive: draft.isActive, autoSend: draft.autoSend, sendTime: draft.sendTime, timezone: draft.timezone, config: c })
      const { data, message } = draft.id
        ? await api<DigestRuleView>(`/api/agent-digest/rules?id=${draft.id}`, { method: 'PUT', body })
        : await api<DigestRuleView>('/api/agent-digest/rules', { method: 'POST', body })
      toast.success(message ?? 'Saved')
      onSaved(data.id)
    } catch (e) { toast.error((e as Error).message) } finally { setSaving(false) }
  }

  const archive = async () => {
    if (!draft.id) { onArchived(); return }
    if (!confirm(`Archive “${draft.name}”? It stops sending and moves to Archived in the left list, where you can restore it. Its history is kept.`)) return
    try {
      await api(`/api/agent-digest/rules?id=${draft.id}`, { method: 'DELETE' })
      toast.success('Archived'); onArchived()
    } catch (e) { toast.error((e as Error).message) }
  }

  const askSendNow = () => {
    if (!draft.id) return toast.error('Save the digest first')
    if (dirty) return toast.error('Save your changes first — “Send now” uses the saved design')
    setConfirmSend(true)
  }

  const sendNow = async () => {
    setConfirmSend(false)
    setSending(true)
    try {
      const { data, message } = await api<SendResult>('/api/agent-digest/send', { method: 'POST', body: JSON.stringify({ ruleId: draft.id }) })
      setLastResult(data)
      if (data.failed) toast.warning(message); else toast.success(message)
      if (draft.id) onSaved(draft.id) // refresh the cards' "Last sent / failed" line
    } catch (e) { toast.error((e as Error).message) } finally { setSending(false) }
  }

  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="space-y-5">
        {/* Title bar */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <input value={draft.name} onChange={e => patch({ name: e.target.value })} placeholder={c.kind === 'TICKETS' ? 'Pack name, e.g. 30 Sundays — tickets D-3' : 'Digest name, e.g. 30 Sundays — daily ops'}
            className="min-w-[240px] flex-1 border-0 bg-transparent text-lg font-semibold text-slate-900 placeholder:text-slate-300 focus:outline-none" />
          {dirty && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">Unsaved</span>}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon={<Archive className="h-3.5 w-3.5" />} onClick={archive}>{draft.id ? 'Archive' : 'Discard'}</Button>
            <Button variant="secondary" size="sm" icon={<FlaskConical className="h-3.5 w-3.5" />} onClick={() => setShowTest(true)} disabled={setupRequired}>Send test</Button>
            <Button variant="secondary" size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={askSendNow} loading={sending} disabled={setupRequired || !draft.id}>Send now</Button>
            <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={save} loading={saving} disabled={setupRequired}>Save</Button>
          </div>
        </div>

        {lastResult && <ResultCard result={lastResult} onClose={() => setLastResult(null)} />}

        <WhoSection c={c} patchConfig={patchConfig} />
        {c.kind === 'TICKETS' ? <TicketPackSection c={c} patchConfig={patchConfig} /> : (
          <>
            <BlocksSection c={c} patchConfig={patchConfig} />
            <FieldsSection c={c} patchConfig={patchConfig} />
          </>
        )}
        <RecipientsSection c={c} patchConfig={patchConfig} />
        <DeliverySection draft={draft} patch={patch} patchConfig={patchConfig} />
      </div>

      <div className="2xl:sticky 2xl:top-4 2xl:self-start">
        <LivePreview draft={draft} />
      </div>

      {showTest && <BodyPortal><TestDialog draft={draft} me={me} onClose={() => setShowTest(false)} onResult={setLastResult} /></BodyPortal>}
      <Modal
        open={confirmSend} onClose={() => setConfirmSend(false)} title={c.kind === 'TICKETS' ? 'Send today’s ticket pack now?' : 'Send today’s digest now?'}
        footer={<>
          <Button variant="secondary" size="sm" onClick={() => setConfirmSend(false)}>Cancel</Button>
          <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={sendNow}>Send now</Button>
        </>}
      >
        <p className="text-sm text-slate-600">
          This goes to {c.recipients.length} recipient{c.recipients.length === 1 ? '' : 's'}. Everyone gets it again now, even if today’s copy already went out.
        </p>
      </Modal>
    </div>
  )
}

// Who: agents + countries + status
function WhoSection({ c, patchConfig }: { c: DigestConfig; patchConfig: (p: Partial<DigestConfig>) => void }) {
  const [agents, setAgents] = useState<{ name: string; count: number }[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { api<{ agents: { name: string; count: number }[] }>('/api/agent-digest/agents').then(r => setAgents(r.data.agents)).catch(() => undefined) }, [])
  const add = (name: string) => {
    const v = name.trim()
    if (!v || c.agents.some(a => a.toLowerCase() === v.toLowerCase())) return
    patchConfig({ agents: [...c.agents, v] }); setQ('')
  }
  const suggestions = agents.filter(a => !c.agents.includes(a.name) && a.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8)

  return (
    <Section icon={<Users className="h-4 w-4" />} title="Whose bookings" hint="Agent, country and booking status filters">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-600">Agents <span className="font-normal text-slate-400">— leave empty for every agent; spelling variants are matched (30 Sundays = 30sundays)</span></label>
          <div className="relative mt-1.5">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 py-1.5 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">
              {c.agents.map(a => (
                <span key={a} className="flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                  {a}<button onClick={() => patchConfig({ agents: c.agents.filter(x => x !== a) })}><X className="h-3 w-3" /></button>
                </span>
              ))}
              <div className="flex min-w-[160px] flex-1 items-center gap-1">
                <Search className="h-3.5 w-3.5 text-slate-400" />
                <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(q) } }}
                  placeholder={c.agents.length ? 'Add another…' : 'Type an agent, e.g. 30 Sundays'} className="flex-1 border-0 bg-transparent py-1 text-sm focus:outline-none" />
              </div>
            </div>
            {open && (suggestions.length > 0 || q) && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {q && !suggestions.some(s => s.name.toLowerCase() === q.toLowerCase()) && (
                  <button onMouseDown={() => add(q)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"><Plus className="h-3.5 w-3.5 text-teal-600" /> Match “{q}”</button>
                )}
                {suggestions.map(s => (
                  <button key={s.name} onMouseDown={() => add(s.name)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span>{s.name}</span><span className="text-xs text-slate-400">{s.count} trips</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-600">Countries</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button onClick={() => patchConfig({ countries: [] })}
              className={cn('rounded-xl border px-3 py-2 text-sm font-medium transition', !c.countries.length ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
              🌏 All
            </button>
            {DIGEST_COUNTRIES.map(code => {
              const on = c.countries.includes(code)
              return (
                <button key={code} onClick={() => patchConfig({ countries: on ? c.countries.filter(x => x !== code) : [...c.countries, code] })}
                  className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition', on ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                  <CountryFlag country={code} className="h-3.5 w-5 rounded-[2px]" /> {DIGEST_COUNTRY_META[code].label}
                  {on && <Check className="h-3.5 w-3.5" />}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-slate-600">Bookings</label>
          {([['ACTIVE', 'Every live booking'], ['CONFIRMED', 'Ground-verified onwards']] as const).map(([k, l]) => (
            <button key={k} onClick={() => patchConfig({ statusFilter: k })}
              className={cn('rounded-full px-3 py-1 text-xs font-medium', c.statusFilter === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{l}</button>
          ))}
          <span className="text-[11px] text-slate-400">Cancelled, draft and test bookings are always left out.</span>
        </div>
      </div>
    </Section>
  )
}

// Blocks timeline
const BASES: DateBasis[] = ['ON_GROUND', 'ARRIVAL', 'TOUR_START', 'ACTIVITY', 'DEPARTURE']

function BlocksSection({ c, patchConfig }: { c: DigestConfig; patchConfig: (p: Partial<DigestConfig>) => void }) {
  const set = (id: string, p: Partial<DigestBlock>) => patchConfig({ blocks: c.blocks.map(b => (b.id === id ? { ...b, ...p } : b)) })
  const move = (i: number, d: -1 | 1) => {
    const next = [...c.blocks]; const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]; patchConfig({ blocks: next })
  }
  const add = () => patchConfig({ blocks: [...c.blocks, { id: newId('b'), label: 'Departing today', basis: 'DEPARTURE', offset: 0, scope: 'TOUR', enabled: true }] })

  return (
    <Section icon={<CalendarDays className="h-4 w-4" />} title="What goes in — date blocks"
      hint="Each block picks bookings by a date relative to the send day. Mix them: on ground today + arriving tomorrow + departing today."
      right={<Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={add} disabled={c.blocks.length >= 8}>Add block</Button>}>
      <ol className="relative space-y-3 border-l-2 border-dashed border-teal-200 pl-5">
        {c.blocks.map((b, i) => (
          <li key={b.id} className={cn('relative rounded-2xl border p-4 transition', b.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-60')}>
            <span className="absolute -left-[31px] top-4 flex h-5 w-5 items-center justify-center rounded-full bg-teal-500 text-[10px] font-bold text-white ring-4 ring-slate-50">{i + 1}</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg">{BASIS_META[b.basis].emoji}</span>
              <input value={b.label} onChange={e => set(b.id, { label: e.target.value })} className="min-w-[180px] flex-1 border-0 bg-transparent text-sm font-semibold text-slate-900 focus:outline-none" />
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(i, 1)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                <Toggle on={b.enabled} onChange={v => set(b.id, { enabled: v })} label="Block on/off" />
                <button onClick={() => patchConfig({ blocks: c.blocks.filter(x => x.id !== b.id) })} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Remove block"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {BASES.map(k => (
                <button key={k} title={BASIS_META[k].hint} onClick={() => set(b.id, { basis: k })}
                  className={cn('rounded-full px-3 py-1 text-xs font-medium transition', b.basis === k ? 'bg-teal-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                  {BASIS_META[k].emoji} {BASIS_META[k].label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Which day</span>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button onClick={() => set(b.id, { offset: Math.max(-7, b.offset - 1) })} className="px-2 py-1 text-slate-500 hover:bg-slate-50"><ChevronLeft className="h-3.5 w-3.5" /></button>
                  <span className="min-w-[96px] px-2 text-center font-semibold text-slate-800">{relDayLabel(b.offset)}</span>
                  <button onClick={() => set(b.id, { offset: Math.min(30, b.offset + 1) })} className="px-2 py-1 text-slate-500 hover:bg-slate-50"><ChevronRight className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">Show as</span>
                {(['ITEM', 'TOUR'] as const).map(s => (
                  <button key={s} title={SCOPE_META[s].hint} onClick={() => set(b.id, { scope: s })}
                    className={cn('rounded-lg border px-2.5 py-1 font-medium', b.scope === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
                    {SCOPE_META[s].label}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{BASIS_META[b.basis].hint} · {SCOPE_META[b.scope].hint}.</p>
          </li>
        ))}
        {!c.blocks.length && <li className="rounded-2xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400">No blocks — add one to choose which bookings go in.</li>}
      </ol>
    </Section>
  )
}

function FieldsSection({ c, patchConfig }: { c: DigestConfig; patchConfig: (p: Partial<DigestConfig>) => void }) {
  return (
    <Section icon={<Eye className="h-4 w-4" />} title="Details to include" hint="Tap to switch. The preview updates instantly. Driver rates and prices are never sent.">
      <div className="grid gap-4 md:grid-cols-3">
        {FIELD_GROUPS.map(g => (
          <div key={g.title}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.fields.map(f => {
                const on = c.fields[f.key]
                return (
                  <button key={f.key} onClick={() => patchConfig({ fields: { ...c.fields, [f.key]: !on } })}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition',
                      on ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-400 line-through decoration-slate-300')}>
                    {on && <Check className="h-3 w-3" />}{f.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function RecipientsSection({ c, patchConfig }: { c: DigestConfig; patchConfig: (p: Partial<DigestConfig>) => void }) {
  const set = (id: string, p: Partial<DigestRecipient>) => patchConfig({ recipients: c.recipients.map(r => (r.id === id ? { ...r, ...p } : r)) })
  const add = () => patchConfig({ recipients: [...c.recipients, { id: newId('r'), name: '', phone: '', email: '', whatsapp: true, emailOn: false }] })
  const [cc, setCc] = useState('')
  return (
    <Section icon={<Smartphone className="h-4 w-4" />} title="Who receives it" hint="One or more WhatsApp numbers and/or emails. Use the international format: +94 77 123 4567."
      right={<Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={add}>Add recipient</Button>}>
      <div className="space-y-2">
        {c.recipients.map(r => {
          const badPhone = r.whatsapp && r.phone && r.phone.replace(/\D/g, '').length < 8
          const badMail = r.emailOn && r.email && !isEmail(r.email)
          return (
            <div key={r.id} className="grid items-center gap-2 rounded-xl border border-slate-200 p-2.5 md:grid-cols-[1fr_1fr_1.3fr_auto]">
              <input value={r.name} onChange={e => set(r.id, { name: e.target.value })} placeholder="Name (used in “Good morning …”)" className={inputCls} />
              <div className="flex items-center gap-2">
                <button onClick={() => set(r.id, { whatsapp: !r.whatsapp })} title="WhatsApp on/off"
                  className={cn('rounded-lg p-2', r.whatsapp ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}><MessageCircle className="h-4 w-4" /></button>
                <input value={r.phone} onChange={e => set(r.id, { phone: e.target.value })} placeholder="+94 77…" className={cn(inputCls, badPhone && 'border-rose-400')} disabled={!r.whatsapp} />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => set(r.id, { emailOn: !r.emailOn })} title="Email on/off"
                  className={cn('rounded-lg p-2', r.emailOn ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400')}><Mail className="h-4 w-4" /></button>
                <input value={r.email} onChange={e => set(r.id, { email: e.target.value })} placeholder="ops@agent.com" className={cn(inputCls, badMail && 'border-rose-400')} disabled={!r.emailOn} />
              </div>
              <button onClick={() => patchConfig({ recipients: c.recipients.filter(x => x.id !== r.id) })} className="justify-self-end rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          )
        })}
        {!c.recipients.length && <div className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-400">No recipients yet.</div>}
      </div>
      <div className="mt-4">
        <label className="text-xs font-medium text-slate-600">Internal email copies (CC)</label>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {c.ccEmails.map(e => (
            <span key={e} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">{e}
              <button onClick={() => patchConfig({ ccEmails: c.ccEmails.filter(x => x !== e) })}><X className="h-3 w-3" /></button></span>
          ))}
          <input value={cc} onChange={e => setCc(e.target.value)} placeholder="ops@aahaas.com ↵"
            onKeyDown={e => { if (e.key === 'Enter' && isEmail(cc)) { e.preventDefault(); patchConfig({ ccEmails: Array.from(new Set([...c.ccEmails, cc.trim()])) }); setCc('') } }}
            className="min-w-[200px] rounded-lg border border-slate-200 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
        </div>
      </div>
    </Section>
  )
}

const TOKENS = ['{recipient}', '{agent}', '{day}', '{date}', '{bookings}', '{lines}', '{countries}']
const PACK_TOKENS = ['{recipient}', '{agent}', '{arrival}', '{day}', '{bookings}', '{tickets}', '{ready}', '{countries}']

function DeliverySection({ draft, patch, patchConfig }: { draft: Draft; patch: (p: Partial<Draft>) => void; patchConfig: (p: Partial<DigestConfig>) => void }) {
  const c = draft.config
  const introRef = useRef<HTMLTextAreaElement>(null)
  const insert = (tok: string) => {
    const el = introRef.current
    if (!el) return patchConfig({ intro: c.intro + tok })
    const s = el.selectionStart ?? c.intro.length
    patchConfig({ intro: c.intro.slice(0, s) + tok + c.intro.slice(el.selectionEnd ?? s) })
  }
  return (
    <Section icon={<Rocket className="h-4 w-4" />} title="When & how" hint="Daily automatic send, channels and message wording">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className={cn('flex items-center justify-between gap-3 rounded-xl border p-3.5', draft.autoSend ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200')}>
            <div>
              <p className="text-sm font-semibold text-slate-900">Send automatically every day</p>
              <p className="text-xs text-slate-500">
                {c.kind === 'TICKETS'
                  ? `Checks every day at the send time; only bookings that are due that day go out. Off = only when you press “Send now”.`
                  : 'Off = only when you press “Send now”. Saved designs start off.'}
              </p>
            </div>
            <Toggle on={draft.autoSend} onChange={v => patch({ autoSend: v })} label="Auto send" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Send time</label>
              <input type="time" value={draft.sendTime} onChange={e => e.target.value && patch({ sendTime: e.target.value })} className={cn(inputCls, 'mt-1')} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Time zone</label>
              <select value={draft.timezone} onChange={e => patch({ timezone: e.target.value })} className={cn(inputCls, 'mt-1')}>
                {DIGEST_TIMEZONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['06:30', '07:00', '08:00', '18:00', '20:00'].map(t => (
              <button key={t} onClick={() => patch({ sendTime: t })} className={cn('rounded-full px-2.5 py-1 text-xs', draft.sendTime === t ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{t}</button>
            ))}
          </div>
          <div className="space-y-2.5">
            {([
              ['WhatsApp', <MessageCircle key="w" className="h-4 w-4 text-emerald-600" />, c.channels.whatsapp, (v: boolean) => patchConfig({ channels: { ...c.channels, whatsapp: v } })],
              ['Email', <Mail key="e" className="h-4 w-4 text-sky-600" />, c.channels.email, (v: boolean) => patchConfig({ channels: { ...c.channels, email: v } })],
              ['Skip days with nothing to report', <Clock key="s" className="h-4 w-4 text-slate-400" />, c.skipEmpty, (v: boolean) => patchConfig({ skipEmpty: v })],
              ['Active', <CheckCircle2 key="a" className="h-4 w-4 text-slate-400" />, draft.isActive, (v: boolean) => patch({ isActive: v })],
            ] as [string, React.ReactNode, boolean, (v: boolean) => void][]).map(([label, icon, on, set]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-slate-700">{icon}{label}</span>
                <Toggle on={on} onChange={set} label={label} />
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-sm font-semibold text-slate-900">Attachments</p>
            <p className="text-xs text-slate-500">{c.kind === 'TICKETS' ? 'A list of the tickets and their status. The ticket files stay on the link.' : 'A copy of the digest, with the details chosen on this page.'}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-xs font-medium text-slate-600"><Mail className="h-3.5 w-3.5 text-sky-600" /> Email</span>
              {([['pdf', 'PDF'], ['excel', 'Excel'], ['word', 'Word']] as const).map(([k, label]) => {
                const on = c.attachments[k]
                return (
                  <button key={k} onClick={() => patchConfig({ attachments: { ...c.attachments, [k]: !on } })} aria-pressed={on}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-400 line-through decoration-slate-300')}>
                    {on && <Check className="h-3 w-3" />}{label}
                  </button>
                )
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm text-slate-700"><MessageCircle className="h-4 w-4 text-emerald-600" />PDF on WhatsApp</span>
              <Toggle on={c.attachments.whatsappPdf} onChange={v => patchConfig({ attachments: { ...c.attachments, whatsappPdf: v } })} label="PDF on WhatsApp" />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">WhatsApp can only carry a PDF. Until its template is approved under Sent history, the message goes with the link only.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Layout</span>
            {(['detailed', 'compact'] as const).map(s => (
              <button key={s} onClick={() => patchConfig({ style: s })}
                className={cn('rounded-lg border px-3 py-1 text-xs font-medium capitalize', c.style === s ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600')}>{s}</button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Opening <span className="font-normal text-slate-400">— email & full-update page</span></label>
            <textarea ref={introRef} rows={3} value={c.intro} onChange={e => patchConfig({ intro: e.target.value })} className={cn(inputCls, 'mt-1 font-mono text-xs')} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(c.kind === 'TICKETS' ? PACK_TOKENS : TOKENS).map(t => <button key={t} onClick={() => insert(t)} className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-teal-100 hover:text-teal-800">{t}</button>)}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Sign-off <span className="font-normal text-slate-400">— email & full-update page</span></label>
            <textarea rows={3} value={c.footer} onChange={e => patchConfig({ footer: e.target.value })} className={cn(inputCls, 'mt-1 font-mono text-xs')} />
          </div>
          <div className="rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
            {c.kind === 'TICKETS' ? (
              <><b>WhatsApp always uses the approved template</b> <code>aahaas_agent_ticket_pack</code>: name, agent, arrival date, booking and ticket counts, and a link to
              the tickets with their downloads. It must be approved by Meta first — submit it under Sent history.</>
            ) : (
              <><b>WhatsApp always uses the approved template</b> <code>aahaas_agent_daily_digest</code>: name, agent, date, booking and line counts, and a link to the
              full update (every driver, guide and vendor, laid out with the fields and wording chosen here). It must be approved by Meta first — submit it under Sent history.</>
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

// ── Ticket pack settings ─────────────────────────────────────────────────────

function SwitchRow({ title, hint, on, onChange }: { title: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
      <div>
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  )
}

function TicketPackSection({ c, patchConfig }: { c: DigestConfig; patchConfig: (p: Partial<DigestConfig>) => void }) {
  const t = c.ticketPack
  const set = (p: Partial<TicketPackConfig>) => patchConfig({ ticketPack: { ...t, ...p } })
  const days = [7, 6, 5, 4, 3, 2, 1]
  return (
    <>
      <Section icon={<Plane className="h-4 w-4" />} title="When it goes out" hint="Counted back from each booking’s arrival date">
        <div className="rounded-2xl bg-gradient-to-r from-teal-50 to-emerald-50 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {days.map(d => (
              <button key={d} onClick={() => set({ daysBefore: d })} aria-pressed={t.daysBefore === d}
                className={cn('h-10 min-w-[46px] rounded-xl px-2 text-sm font-semibold transition', t.daysBefore === d ? 'bg-teal-600 text-white shadow-md' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-teal-300')}>
                D-{d}
              </button>
            ))}
            <span className="flex h-10 items-center gap-1 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white"><Plane className="h-3.5 w-3.5" /> Arrival</span>
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">Other
              <input type="number" min={0} max={30} value={t.daysBefore}
                onChange={e => set({ daysBefore: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm" /> days before
            </label>
          </div>
          <p className="mt-3 text-sm text-teal-900">
            Guests arriving on <b>{fmtShort(addDays(todayIn('Asia/Colombo'), t.daysBefore))}</b> go out today; {t.daysBefore === 1 ? 'one day' : `${t.daysBefore} days`} before arrival, every time.
          </p>
        </div>
        <div className="mt-4">
          <label className="text-xs font-medium text-slate-600">Wait for tickets before sending</label>
          <div className="mt-1.5 grid gap-2 md:grid-cols-3">
            {(Object.keys(TICKET_HOLD_META) as TicketHold[]).map(k => (
              <button key={k} onClick={() => set({ hold: k })} aria-pressed={t.hold === k}
                className={cn('rounded-xl border p-3 text-left transition', t.hold === k ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:border-slate-300')}>
                <p className="text-sm font-semibold text-slate-900">{TICKET_HOLD_META[k].label}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{TICKET_HOLD_META[k].hint}</p>
              </button>
            ))}
          </div>
          {t.hold !== 'NONE' && !t.catchUp && (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Turn on “Catch up” below, or a booking held on its day will never go out.
            </p>
          )}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <SwitchRow title="Catch up on late bookings" hint="A booking added or held after its day goes out on the next send." on={t.catchUp} onChange={v => set({ catchUp: v })} />
          <SwitchRow title="Follow up when tickets arrive" hint="Sends again, marked New, when a pending ticket becomes downloadable." on={t.followUps} onChange={v => set({ followUps: v })} />
        </div>
      </Section>

      <Section icon={<Ticket className="h-4 w-4" />} title="Which tickets, and what the agent sees" hint="No prices, costs or portals are ever included">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-slate-600">Categories <span className="font-normal text-slate-400">— none selected sends all of them</span></label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TICKET_CATEGORIES.map(cat => {
                const on = t.categories.includes(cat.key)
                return (
                  <button key={cat.key} onClick={() => set({ categories: on ? t.categories.filter(x => x !== cat.key) : [...t.categories, cat.key] })} aria-pressed={on}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600')}>
                    {on && <Check className="h-3 w-3" />}{cat.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600">Show on each ticket</label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TICKET_SHOW_FIELDS.map(f => {
                const on = t.show[f.key]
                return (
                  <button key={f.key} onClick={() => set({ show: { ...t.show, [f.key]: !on } })} aria-pressed={on}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition', on ? 'border-teal-300 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-400 line-through decoration-slate-300')}>
                    {on && <Check className="h-3 w-3" />}{f.label}
                  </button>
                )
              })}
            </div>
          </div>
          <SwitchRow title="Include bookings with no tickets entered" hint="Shows “Tickets are being arranged”. No Tickets and Hotel Only bookings are always left out." on={t.includeEmpty} onChange={v => set({ includeEmpty: v })} />
        </div>
      </Section>

      <Section icon={<ShieldCheck className="h-4 w-4" />} title="Downloads" hint="PDF and image files open from a private link. A ticket that is not activated is never downloadable.">
        <div className="grid gap-2 md:grid-cols-2">
          <SwitchRow title="Only after purchase" hint="Off: a file is available once the ticket is activated, as in the client portal." on={t.downloadOnlyPurchased} onChange={v => set({ downloadOnlyPurchased: v })} />
          <SwitchRow title="Include the main ticket file" hint="Turn off if that file is a receipt showing a price. Per-guest files are always included." on={t.includeMainFile} onChange={v => set({ includeMainFile: v })} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          Link stops working
          <input type="number" min={1} max={60} value={t.linkDaysAfterTrip}
            onChange={e => set({ linkDaysAfterTrip: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
            className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
          days after the guests leave
        </label>
      </Section>
    </>
  )
}

// ── Ticket radar ─────────────────────────────────────────────────────────────

interface RadarRow {
  ref: string; lead: string | null; agent: string | null; arrival: string; sendDay: string; tickets: number; ready: number
  counts: Record<string, number>; stage: 'SENT' | 'WAIVED' | 'NO_TICKETS' | 'HELD' | 'TODAY' | 'LATE' | 'UPCOMING'; sentOn: string | null
}

const RADAR_STAGE: Record<RadarRow['stage'], { label: string; cls: string }> = {
  SENT:       { label: 'Sent', cls: 'bg-emerald-100 text-emerald-700' },
  TODAY:      { label: 'Goes out today', cls: 'bg-teal-100 text-teal-700' },
  LATE:       { label: 'Next send', cls: 'bg-sky-100 text-sky-700' },
  UPCOMING:   { label: 'Upcoming', cls: 'bg-slate-100 text-slate-600' },
  HELD:       { label: 'Held', cls: 'bg-amber-100 text-amber-800' },
  NO_TICKETS: { label: 'No tickets entered', cls: 'bg-rose-100 text-rose-700' },
  WAIVED:     { label: 'No tickets needed', cls: 'bg-slate-100 text-slate-500' },
}

function ReadinessBar({ row }: { row: RadarRow }) {
  const order: TicketState[] = ['READY', 'FILE_READY', 'PURCHASED', 'ACTIVATED', 'NOT_ACTIVATED']
  if (!row.tickets) return <span className="text-xs text-slate-400">—</span>
  return (
    <div className="min-w-[150px]">
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
        {order.map(s => row.counts[s] ? (
          <span key={s} title={`${row.counts[s]} · ${TICKET_STATE_META[s].label}`} style={{ width: `${(row.counts[s] / row.tickets) * 100}%`, backgroundColor: TICKET_STATE_META[s].bar }} />
        ) : null)}
      </div>
      <p className="mt-1 text-[11px] text-slate-500"><b className="text-slate-800">{row.ready}</b> of {row.tickets} ready to download</p>
    </div>
  )
}

function RadarTab({ rules, onNewPack }: { rules: DigestRuleView[]; onNewPack: () => void }) {
  const packs = useMemo(() => rules.filter(r => r.config.kind === 'TICKETS'), [rules])
  const [ruleId, setRuleId] = useState('')
  const [days, setDays] = useState(14)
  const [data, setData] = useState<{ today: string; daysBefore: number; rows: RadarRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [onlyGaps, setOnlyGaps] = useState(false)
  const activeId = ruleId || packs[0]?.id || ''

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ days: String(days) }); if (activeId) qs.set('ruleId', activeId)
      const { data } = await api<{ today: string; daysBefore: number; rows: RadarRow[] }>(`/api/agent-digest/tickets/radar?${qs}`)
      setData(data)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }, [activeId, days])
  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => (data?.rows ?? []).filter(r => !onlyGaps || (r.stage !== 'WAIVED' && (r.ready < r.tickets || !r.tickets))), [data, onlyGaps])
  const sum = useMemo(() => {
    const all = data?.rows ?? []
    return {
      today: all.filter(r => r.stage === 'TODAY').length,
      gaps: all.filter(r => r.sendDay <= addDays(data?.today ?? '', 1) && r.stage !== 'WAIVED' && r.stage !== 'SENT' && r.ready < r.tickets).length,
      empty: all.filter(r => r.stage === 'NO_TICKETS').length,
      sent: all.filter(r => r.stage === 'SENT').length,
    }
  }, [data])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div><label className="block text-[11px] text-slate-500">Ticket pack</label>
          {packs.length ? (
            <select value={activeId} onChange={e => setRuleId(e.target.value)} className="rounded-lg border border-slate-200 py-1.5 pl-2 pr-8 text-xs">
              {packs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          ) : <p className="py-1.5 text-xs text-slate-600">All agents at D-3 · <button onClick={onNewPack} className="font-semibold text-teal-700 hover:underline">create a pack</button></p>}
        </div>
        <div className="flex gap-1.5">
          {[7, 14, 30].map(d => (
            <button key={d} onClick={() => setDays(d)} className={cn('rounded-full px-3 py-1.5 text-xs font-medium', days === d ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>Next {d} days</button>
          ))}
        </div>
        <button onClick={() => setOnlyGaps(v => !v)} aria-pressed={onlyGaps} className={cn('rounded-full px-3 py-1.5 text-xs font-medium', onlyGaps ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>Only not ready</button>
        <Button variant="ghost" size="sm" icon={<RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />} onClick={load}>Refresh</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Going out today', sum.today, 'text-teal-700'],
          ['Due by tomorrow, not ready', sum.gaps, sum.gaps ? 'text-rose-600' : 'text-slate-900'],
          ['No tickets entered', sum.empty, sum.empty ? 'text-amber-600' : 'text-slate-900'],
          ['Already sent', sum.sent, 'text-slate-900'],
        ].map(([l, v, cls]) => (
          <div key={l as string} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className={cn('text-2xl font-bold', cls as string)}>{v as number}</div>
            <div className="text-xs text-slate-500">{l as string}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-4 py-2.5">Goes out</th><th className="px-4 py-2.5">Arrival</th><th className="px-4 py-2.5">Booking</th><th className="px-4 py-2.5">Tickets</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {busy && !data && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {rows.map(r => (
              <tr key={r.ref} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-xs font-medium text-slate-800">{fmtShort(r.sendDay)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{fmtShort(r.arrival)}</td>
                <td className="px-4 py-2.5 text-xs"><div className="font-semibold text-slate-900">{r.ref}</div><div className="text-slate-500">{[r.lead, r.agent].filter(Boolean).join(' · ')}</div></td>
                <td className="px-4 py-2.5"><ReadinessBar row={r} /></td>
                <td className="px-4 py-2.5 text-xs">
                  <span className={cn('rounded-full px-2 py-0.5 font-semibold', RADAR_STAGE[r.stage].cls)}>{RADAR_STAGE[r.stage].label}</span>
                  {r.sentOn && <div className="mt-1 text-[11px] text-slate-400">{fmtShort(r.sentOn)}</div>}
                </td>
                <td className="px-4 py-2.5 text-right"><a href={`/dashboard/bookings/${encodeURIComponent(r.ref)}/tickets`} className="rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">Open tickets</a></td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">{onlyGaps ? 'Every ticket in this period is ready.' : 'No bookings arrive in this period.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Live preview ─────────────────────────────────────────────────────────────

function LivePreview({ draft }: { draft: Draft }) {
  const [day, setDay] = useState(() => todayIn(draft.timezone))
  const [payload, setPayload] = useState<DigestPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'whatsapp' | 'email'>('whatsapp')
  const c = draft.config
  // Only what changes the DATA triggers a refetch; wording/fields render locally.
  const dataKey = JSON.stringify({ k: c.kind, id: draft.id, tp: c.ticketPack, a: c.agents, co: c.countries, s: c.statusFilter, b: c.blocks, n: c.fields.movementNote, day })

  useEffect(() => {
    let alive = true
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const { data } = await api<{ payload: DigestPayload }>('/api/agent-digest/preview', {
          method: 'POST', body: JSON.stringify({ name: draft.name, config: c, runDate: day, ruleId: draft.id }),
        })
        if (alive) { setPayload(data.payload); setErr(null) }
      } catch (e) { if (alive) setErr((e as Error).message) } finally { if (alive) setBusy(false) }
    }, 450)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey])

  const recipient = c.recipients[0]?.name || 'Team'
  const live = payload ? { ...payload, agentLabel: c.agents[0] || 'All agents', ruleName: draft.name } : null
  const isPack = c.kind === 'TICKETS'
  const text = live ? renderTemplateText(templateParams(live, recipient, 'https://ops.aahaas.com/digest/…'), c.kind, c.attachments.whatsappPdf) : ''
  const html = live ? renderEmailHtml(live, c, recipient, 'https://ops.aahaas.com/digest/…') : ''

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          <button onClick={() => setMode('whatsapp')} className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium', mode === 'whatsapp' ? 'bg-white shadow text-emerald-700' : 'text-slate-500')}><MessageCircle className="h-3.5 w-3.5" /> WhatsApp</button>
          <button onClick={() => setMode('email')} className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium', mode === 'email' ? 'bg-white shadow text-sky-700' : 'text-slate-500')}><Mail className="h-3.5 w-3.5" /> {isPack ? 'Email / tickets' : 'Email / full update'}</button>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setDay(d => addDays(d, -1))} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
          <button onClick={() => setDay(d => addDays(d, 1))} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{isPack ? <>If sent on <b>{fmtDay(day)}</b>: arrivals of <b>{fmtShort(addDays(day, c.ticketPack.daysBefore))}</b>. Nothing is sent.</> : <>Real data for <b>{fmtDay(day)}</b> — nothing is sent.</>}</span>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
      {live && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[['Bookings', live.totals.bookings, 'text-slate-900'], [isPack ? 'Tickets' : 'Lines', live.totals.lines, 'text-slate-900'], [isPack ? 'Not ready' : 'Pending', live.totals.missing, live.totals.missing ? 'text-rose-600' : 'text-slate-900']].map(([l, v, cls]) => (
            <div key={l as string} className="rounded-xl bg-slate-50 px-3 py-2 text-center">
              <div className={cn('text-lg font-bold', cls as string)}>{v as number}</div><div className="text-[10px] uppercase tracking-wider text-slate-400">{l as string}</div>
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{err}</p>}
      {!!live?.pack?.held.length && (
        <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          <p className="font-semibold">Held back, waiting for tickets ({live.pack.held.length})</p>
          {live.pack.held.slice(0, 5).map(h => <p key={h.ref}>{h.ref}{h.lead ? ` · ${h.lead}` : ''} · {h.ready} of {h.tickets} ready</p>)}
        </div>
      )}

      {mode === 'whatsapp' ? (
        <div className="mx-auto mt-3 w-full max-w-[380px] rounded-[2.2rem] border-[10px] border-slate-900 bg-slate-900 shadow-xl">
          <div className="flex items-center gap-2 rounded-t-[1.5rem] bg-[#075e54] px-4 py-2.5 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-xs font-bold">AH</div>
            <div><p className="text-sm font-semibold leading-tight">AppleHolidays Ops</p><p className="text-[10px] text-emerald-100">to {recipient}</p></div>
          </div>
          <div className="h-[560px] overflow-y-auto rounded-b-[1.5rem] bg-[#ece5dd] p-3" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px)', backgroundSize: '14px 14px' }}>
            {live && isEmptyPayload(live) && c.skipEmpty ? (
              <div className="mx-auto mt-10 w-fit rounded-lg bg-white/80 px-3 py-2 text-center text-xs text-slate-500">Nothing to report this day — the digest would be skipped.</div>
            ) : (
              <>
                <div className="ml-auto w-[92%] rounded-xl rounded-tr-sm bg-[#dcf8c6] px-3 py-2 text-[12.5px] leading-snug text-slate-800 shadow-sm">
                  {c.attachments.whatsappPdf && (
                    <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2">
                      <FileText className="h-5 w-5 shrink-0 text-rose-600" />
                      <span className="min-w-0 truncate text-[11.5px] font-medium">{isPack ? 'Ticket-Pack' : 'Daily-Update'}-{day}.pdf</span>
                    </div>
                  )}
                  <WaText text={text} />
                  <div className="mt-1.5 border-t border-black/5 pt-1 text-[10px] text-slate-500">AppleHolidays Operations</div>
                  <div className="mt-1 text-right text-[10px] text-slate-500">{draft.sendTime} ✓✓</div>
                </div>
                <p className="mx-auto mt-3 w-fit rounded-lg bg-white/80 px-3 py-1.5 text-center text-[11px] text-slate-500">
                  WhatsApp template <code>{isPack ? 'aahaas_agent_ticket_pack' : 'aahaas_agent_daily_digest'}{c.attachments.whatsappPdf ? '_pdf' : ''}</code> · the link opens the {isPack ? 'tickets' : 'full update'} (switch to Email to see it)
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        <iframe title="Email preview" srcDoc={html} className="mt-3 h-[640px] w-full rounded-2xl border border-slate-200 bg-slate-100" />
      )}

    </div>
  )
}

/** WhatsApp-style rendering: *bold* and _italic_. */
function WaText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {text.split('\n').map((line, i) => (
        <div key={i}>
          {line.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((seg, j) =>
            seg.startsWith('*') && seg.endsWith('*') && seg.length > 2 ? <b key={j}>{seg.slice(1, -1)}</b>
              : seg.startsWith('_') && seg.endsWith('_') && seg.length > 2 ? <i key={j}>{seg.slice(1, -1)}</i>
                : <span key={j}>{seg}</span>)}
          {!line && ' '}
        </div>
      ))}
    </div>
  )
}

// ── Test dialog + result ─────────────────────────────────────────────────────

function TestDialog({ draft, me, onClose, onResult }: { draft: Draft; me: string; onClose: () => void; onResult: (r: SendResult) => void }) {
  useBodyScrollLock()
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [day, setDay] = useState(() => todayIn(draft.timezone))
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      // Tests always use the design exactly as it is on screen, saved or not.
      const { data, message } = await api<SendResult>('/api/agent-digest/send', {
        method: 'POST',
        body: JSON.stringify({
          draft: { name: draft.name || 'Draft digest', config: draft.config },
          runDate: day,
          test: { phone, email, name: me },
        }),
      })
      onResult(data)
      if (data.failed) toast.warning(message); else toast.success(message)
      onClose()
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-teal-600" /><h2 className="text-lg font-semibold text-slate-900">Send a test copy</h2></div>
        <p className="mt-1 text-sm text-slate-500">Goes only to what you type here — never to the agent. Uses the design as it is on screen, saved or not.</p>
        <div className="mt-4 space-y-3">
          <div><label className="text-xs font-medium text-slate-600">Your WhatsApp</label><input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+94 77 123 4567" className={cn(inputCls, 'mt-1')} /></div>
          <div><label className="text-xs font-medium text-slate-600">Your email</label><input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@aahaas.com" className={cn(inputCls, 'mt-1')} /></div>
          <div><label className="text-xs font-medium text-slate-600">For day</label><input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)} className={cn(inputCls, 'mt-1')} /></div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button icon={<Send className="h-4 w-4" />} onClick={go} loading={busy} disabled={!phone.trim() && !isEmail(email)}>Send test</Button>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ result, onClose }: { result: SendResult; onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Send result · {fmtDay(result.runDate)}</p>
          <p className="text-xs text-slate-500">{result.reason ?? `${result.sent} sent · ${result.failed} failed · ${result.skipped} skipped`}</p>
        </div>
        <div className="flex items-center gap-2">
          {result.link && <a href={result.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Web view</a>}
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
      </div>
      {result.details.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {result.details.map((d, i) => (
            <li key={i} className="flex items-center gap-2 py-1.5">
              {d.status === 'sent' ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : d.status === 'failed' ? <XCircle className="h-4 w-4 text-rose-500" /> : <Clock className="h-4 w-4 text-slate-400" />}
              {d.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5 text-slate-400" /> : <Mail className="h-3.5 w-3.5 text-slate-400" />}
              <span className="font-medium text-slate-700">{d.name}</span><span className="text-slate-400">{d.to}</span>
              {d.mode && <span className="rounded bg-slate-100 px-1.5 text-[10px] text-slate-500">{d.mode}</span>}
              {d.note && <span className={cn('truncate', d.status === 'failed' ? 'text-rose-600' : 'text-slate-400')}>{d.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Tomorrow tab ─────────────────────────────────────────────────────────────

function UpcomingTab({ onOpen }: { onOpen: (r: DigestRuleView) => void }) {
  const [offset, setOffset] = useState(1)
  const [items, setItems] = useState<UpcomingItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(async () => {
    setBusy(true)
    try { const { data } = await api<{ items: UpcomingItem[] }>(`/api/agent-digest/upcoming?offset=${offset}`); setItems(data.items) }
    catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }, [offset])
  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[[0, 'Today'], [1, 'Tomorrow'], [2, 'In 2 days'], [3, 'In 3 days']].map(([o, l]) => (
          <button key={o} onClick={() => setOffset(o as number)} className={cn('rounded-full px-3.5 py-1.5 text-sm font-medium', offset === o ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>{l as string}</button>
        ))}
        <Button variant="ghost" size="sm" icon={<RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />} onClick={load}>Rebuild</Button>
        <span className="text-xs text-slate-400">Built live from current allocations — changes made before the send time are picked up.</span>
      </div>
      {busy && !items && <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Building…</div>}
      {items && !items.length && <p className="rounded-2xl bg-white p-8 text-center text-sm text-slate-400 ring-1 ring-slate-200">No active digests.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {items?.map(it => {
          const c = it.rule.config
          const isPack = c.kind === 'TICKETS'
          const text = renderTemplateText(templateParams(it.payload, it.recipients[0]?.name || 'Team', 'https://ops.aahaas.com/digest/…'), c.kind)
          const isOpen = open === it.rule.id
          return (
            <div key={it.rule.id} className={cn('rounded-2xl border bg-white p-4 shadow-sm', it.willSkip ? 'border-slate-200' : 'border-teal-200')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <button onClick={() => onOpen(it.rule)} className="text-left text-sm font-semibold text-slate-900 hover:text-teal-700">{it.rule.name}</button>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" /> {fmtDay(it.runDate)} · {it.rule.sendTime} ({it.rule.timezone.split('/')[1]?.replace('_', ' ')})</p>
                </div>
                {it.willSkip
                  ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">{it.rule.autoSend ? 'Will skip — empty' : 'Manual only'}</span>
                  : <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"><Zap className="h-3 w-3" /> Will send</span>}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 py-2"><div className="text-lg font-bold">{it.payload.totals.bookings}</div><div className="text-[10px] uppercase text-slate-400">bookings</div></div>
                <div className="rounded-xl bg-slate-50 py-2"><div className="text-lg font-bold">{it.payload.totals.lines}</div><div className="text-[10px] uppercase text-slate-400">{isPack ? 'tickets' : 'lines'}</div></div>
                <div className={cn('rounded-xl py-2', it.payload.totals.missing ? 'bg-rose-50' : 'bg-slate-50')}><div className={cn('text-lg font-bold', it.payload.totals.missing && 'text-rose-600')}>{it.payload.totals.missing}</div><div className="text-[10px] uppercase text-slate-400">{isPack ? 'not ready' : 'pending'}</div></div>
              </div>
              {it.payload.totals.missing > 0 && (
                <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> {isPack
                  ? `${it.payload.totals.missing} ticket(s) cannot be downloaded yet — activate, buy or upload them before the send.`
                  : `${it.payload.totals.missing} line(s) with nobody allocated (no driver, vehicle or vendor) — allocate before the send to avoid “Driver pending”.`}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {it.recipients.map((r, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                    {r.whatsapp && <MessageCircle className="h-3 w-3 text-emerald-600" />}{r.email && <Mail className="h-3 w-3 text-sky-600" />}{r.name || r.whatsapp || r.email}
                  </span>
                ))}
                {!it.recipients.length && <span className="text-[11px] text-rose-600">No recipients</span>}
              </div>
              <div className="mt-3 space-y-1">
                {it.payload.blocks.map(b => (
                  <div key={b.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{BASIS_META[b.basis].emoji} {b.label} <span className="text-slate-400">· {fmtShort(b.date)}</span></span>
                    <span className="font-semibold text-slate-800">{b.bookings.length}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setOpen(isOpen ? null : it.rule.id)} className="mt-3 flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
                <Eye className="h-3.5 w-3.5" /> {isOpen ? 'Hide message' : 'Preview message'}
              </button>
              {isOpen && <div className="mt-2 max-h-[420px] overflow-y-auto rounded-xl bg-[#ece5dd] p-3"><div className="rounded-xl bg-[#dcf8c6] p-3 text-[12px] text-slate-800"><WaText text={text} /></div></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── History tab ──────────────────────────────────────────────────────────────

interface RunDetail {
  run: { id: string; ruleName: string; runDate: string; trigger: string; createdAt: string; createdByName: string | null; link: string; payload: DigestPayload & { config?: unknown } }
  sends: { id: string; channel: string; recipient: string; recipientName: string | null; status: string; mode: string | null; subject: string | null; body: string | null; error: string | null; createdAt: string }[]
}

function HistoryTab({ rules }: { rules: DigestRuleView[] }) {
  const today = todayIn('Asia/Colombo')
  const [from, setFrom] = useState(addDays(today, -1))
  const [to, setTo] = useState(addDays(today, -1))
  const [ruleId, setRuleId] = useState('')
  const [status, setStatus] = useState('')
  const [rows, setRows] = useState<HistoryRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [templates, setTemplates] = useState<Record<string, TemplateInfo>>({})

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const qs = new URLSearchParams({ from, to }); if (ruleId) qs.set('ruleId', ruleId); if (status) qs.set('status', status)
      const { data } = await api<{ rows: HistoryRow[] }>(`/api/agent-digest/history?${qs}`); setRows(data.rows)
    } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }, [from, to, ruleId, status])
  useEffect(() => { void load() }, [load])
  const loadTpl = useCallback(() => {
    for (const qs of TEMPLATE_QUERIES) {
      api<TemplateInfo>(`/api/agent-digest/template${qs}`).then(r => setTemplates(t => ({ ...t, [qs]: r.data }))).catch(() => undefined)
    }
  }, [])
  useEffect(() => { loadTpl() }, [loadTpl])

  const openRun = async (runId: string | null) => {
    if (!runId) return
    try { const { data } = await api<RunDetail>(`/api/agent-digest/runs/${runId}`); setDetail(data) } catch (e) { toast.error((e as Error).message) }
  }
  const registerTpl = async (qs: string) => {
    try {
      const { message } = await api(`/api/agent-digest/template${qs}`, { method: 'POST' })
      toast.success(message ?? 'Submitted')
      loadTpl()
    } catch (e) {
      // Keep Meta's reason on screen — a toast disappears before it can be read.
      const msg = (e as Error).message
      toast.error(msg, { duration: 15000 })
      setTemplates(t => (t[qs] ? { ...t, [qs]: { ...t[qs], error: msg } } : t))
      loadTpl()
    }
  }
  const quick = (a: number, b: number) => { setFrom(addDays(today, a)); setTo(addDays(today, b)) }

  const sum = useMemo(() => {
    const r = rows ?? []
    return { sent: r.filter(x => x.status === 'sent').length, failed: r.filter(x => x.status === 'failed').length, wa: r.filter(x => x.channel === 'whatsapp').length, mail: r.filter(x => x.channel === 'email').length }
  }, [rows])

  return (
    <div className="space-y-4">
      {TEMPLATE_QUERIES.map(qs => templates[qs] && <TemplateBanner key={qs} tpl={templates[qs]} onSubmit={() => registerTpl(qs)} onRefresh={loadTpl} />)}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-1.5">
          {[[-1, -1, 'Yesterday'], [0, 0, 'Today'], [-7, 0, 'Last 7 days'], [-30, 0, 'Last 30 days']].map(([a, b, l]) => (
            <button key={l as string} onClick={() => quick(a as number, b as number)}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium', from === addDays(today, a as number) && to === addDays(today, b as number) ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>{l as string}</button>
          ))}
        </div>
        <div><label className="block text-[11px] text-slate-500">From</label><input type="date" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" /></div>
        <div><label className="block text-[11px] text-slate-500">To</label><input type="date" value={to} onChange={e => e.target.value && setTo(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" /></div>
        <div><label className="block text-[11px] text-slate-500">Digest</label>
          <select value={ruleId} onChange={e => setRuleId(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs"><option value="">All</option>{rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <div><label className="block text-[11px] text-slate-500">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs"><option value="">All</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select></div>
        <div className="ml-auto flex gap-3 text-xs text-slate-500">
          <span><b className="text-emerald-600">{sum.sent}</b> sent</span><span><b className="text-rose-600">{sum.failed}</b> failed</span>
          <span><MessageCircle className="inline h-3 w-3" /> {sum.wa}</span><span><Mail className="inline h-3 w-3" /> {sum.mail}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Digest</th><th className="px-4 py-2.5">To</th><th className="px-4 py-2.5">Content</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {busy && !rows && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>}
            {rows?.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 text-xs text-slate-600">
                  <div className="font-medium text-slate-800">{fmtShort(r.runDate)}</div>
                  <div>{new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {r.trigger === 'schedule' ? 'auto' : r.trigger}{r.sentByName && r.trigger !== 'schedule' ? ` by ${r.sentByName}` : ''}</div>
                </td>
                <td className="px-4 py-2.5 text-xs font-medium text-slate-800">{r.ruleName}</td>
                <td className="px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-800">{r.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> : <Mail className="h-3.5 w-3.5 text-sky-600" />}{r.recipientName ?? r.recipient}</div>
                  <div className="text-slate-400">{r.recipient}{r.mode ? ` · ${r.mode}` : ''}</div>
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-600">{r.bookingCount} bookings · {r.itemCount} {rules.find(x => x.id === r.ruleId)?.config.kind === 'TICKETS' ? 'tickets' : 'lines'}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className={cn('rounded-full px-2 py-0.5 font-semibold', r.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : r.status === 'failed' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600')}>{r.status}</span>
                  {r.error && <div className="mt-1 max-w-[260px] truncate text-[11px] text-slate-400" title={r.error}>{r.error}</div>}
                </td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => openRun(r.runId)} className="rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">View</button></td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">Nothing was sent in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      {detail && <BodyPortal><RunDrawer detail={detail} onClose={() => setDetail(null)} /></BodyPortal>}
    </div>
  )
}

/** Every WhatsApp template the digests use: link-only and with the PDF. */
const TEMPLATE_QUERIES = ['', '?kind=tickets', '?pdf=1', '?kind=tickets&pdf=1']

interface TemplateInfo {
  name: string
  language: string
  body: string
  /** APPROVED | PENDING | REJECTED | PAUSED | DISABLED | MISSING, or null when Meta could not be reached. */
  status: string | null
  approved: boolean | null
  metaBody: string | null
  metaLanguage: string | null
  error?: string
}

const TPL_STATUS: Record<string, { tone: string; text: string }> = {
  APPROVED: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'is approved — WhatsApp digests can be sent.' },
  PENDING:  { tone: 'border-sky-200 bg-sky-50 text-sky-800', text: 'is submitted and waiting for Meta’s review (usually minutes to a few hours). Nothing to do — WhatsApp sends start working once it is approved.' },
  IN_APPEAL:{ tone: 'border-sky-200 bg-sky-50 text-sky-800', text: 'is in appeal with Meta.' },
  REJECTED: { tone: 'border-rose-200 bg-rose-50 text-rose-800', text: 'was rejected by Meta. Open WhatsApp Manager → Message templates to see the reason and edit it, then it goes back to review.' },
  PAUSED:   { tone: 'border-amber-200 bg-amber-50 text-amber-900', text: 'is paused by Meta (quality). WhatsApp sends fail until it is unpaused.' },
  DISABLED: { tone: 'border-rose-200 bg-rose-50 text-rose-800', text: 'is disabled by Meta.' },
  MISSING:  { tone: 'border-amber-200 bg-amber-50 text-amber-900', text: 'does not exist on Meta yet — submit it. No WhatsApp digest can be sent until it is approved (email still works).' },
}

function TemplateBanner({ tpl, onSubmit, onRefresh }: { tpl: TemplateInfo; onSubmit: () => void; onRefresh: () => void }) {
  const base = tpl.status ? TPL_STATUS[tpl.status] ?? { tone: 'border-amber-200 bg-amber-50 text-amber-900', text: `has status ${tpl.status}.` }
    : { tone: 'border-slate-200 bg-slate-50 text-slate-700', text: `status unknown — Meta not reachable (${tpl.error ?? 'no detail'}).` }
  // A PDF template only adds the attachment: without it the link message still goes.
  const pdfNote = tpl.name.endsWith('_pdf') && tpl.status === 'MISSING' ? 'does not exist on Meta yet — submit it. Until it is approved, WhatsApp goes with the link only, without the PDF.'
    : tpl.name.endsWith('_pdf') && tpl.status === 'PENDING' ? 'is waiting for Meta’s review. Until then, WhatsApp goes with the link only, without the PDF.'
      : tpl.name.endsWith('_pdf') && tpl.status === 'APPROVED' ? 'is approved — WhatsApp messages carry the PDF.' : null
  const meta = pdfNote ? { ...base, text: pdfNote } : base
  const differs = tpl.metaBody && tpl.metaBody.trim() !== tpl.body.trim()
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 text-sm', meta.tone)}>
      <span className="flex items-center gap-2">
        {tpl.approved ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : tpl.status === 'PENDING' ? <Clock className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
        <span>WhatsApp template <code className="font-mono text-xs">{tpl.name}</code>{tpl.metaLanguage ? ` (${tpl.metaLanguage})` : ''} {meta.text}</span>
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRefresh}>Check again</Button>
        {tpl.status === 'MISSING' && <Button size="sm" variant="secondary" onClick={onSubmit}>Submit to Meta</Button>}
      </div>
      {differs && (
        <p className="w-full rounded-lg bg-white/70 px-3 py-2 text-[11px] text-slate-600">
          The wording on Meta is an earlier version — that is fine, it takes the same values. Meta’s text: <span className="italic">{tpl.metaBody}</span>
        </p>
      )}
      {tpl.status !== 'APPROVED' && tpl.error && tpl.status === 'MISSING' && <p className="w-full rounded-lg bg-white/70 px-3 py-2 font-mono text-[11px] text-rose-700">{tpl.error}</p>}
    </div>
  )
}

function RunDrawer({ detail, onClose }: { detail: RunDetail; onClose: () => void }) {
  useBodyScrollLock()
  const [tab, setTab] = useState<'message' | 'snapshot'>('message')
  const [sel, setSel] = useState(detail.sends[0]?.id ?? null)
  const send = detail.sends.find(s => s.id === sel)
  const html = useMemo(() => renderEmailHtml(detail.run.payload, normaliseConfig(detail.run.payload.config), '', null), [detail])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 p-5">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">{detail.run.trigger === 'schedule' ? 'Automatic' : detail.run.trigger} send · {new Date(detail.run.createdAt).toLocaleString('en-GB')}</p>
            <h2 className="text-lg font-semibold text-slate-900">{detail.run.ruleName}</h2>
            <p className="text-sm text-slate-500">{fmtDay(detail.run.runDate)}</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={detail.run.link} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50"><ExternalLink className="h-3.5 w-3.5" /> Web view</a>
            <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </div>
        <div className="flex gap-1 border-b border-slate-200 px-5 pt-2 text-sm">
          {(['message', 'snapshot'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={cn('-mb-px border-b-2 px-3 py-2 font-medium capitalize', tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500')}>{t === 'message' ? 'Messages sent' : 'Snapshot'}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'message' ? (
            <>
              <div className="flex flex-wrap gap-1.5">
                {detail.sends.map(s => (
                  <button key={s.id} onClick={() => setSel(s.id)}
                    className={cn('flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', sel === s.id ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-slate-200 text-slate-600')}>
                    {s.channel === 'whatsapp' ? <MessageCircle className="h-3 w-3" /> : <Mail className="h-3 w-3" />}{s.recipientName ?? s.recipient}
                    <span className={cn('h-1.5 w-1.5 rounded-full', s.status === 'sent' ? 'bg-emerald-500' : 'bg-rose-500')} />
                  </button>
                ))}
              </div>
              {send && (
                <div className="mt-4">
                  {send.error && <p className={cn('mb-3 rounded-lg p-2.5 text-xs', send.status === 'failed' ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600')}>{send.error}</p>}
                  {send.subject && <p className="mb-2 text-xs text-slate-500">Subject: <b className="text-slate-800">{send.subject}</b></p>}
                  <div className="rounded-xl bg-[#ece5dd] p-3"><div className="rounded-xl bg-[#dcf8c6] p-3 text-[12px] text-slate-800"><WaText text={send.body ?? '(no body stored)'} /></div></div>
                </div>
              )}
              {!detail.sends.length && <p className="text-sm text-slate-400">No deliveries recorded for this run.</p>}
            </>
          ) : (
            <iframe title="Snapshot" srcDoc={html} className="h-[75vh] w-full rounded-xl border border-slate-200" />
          )}
        </div>
      </div>
    </div>
  )
}
