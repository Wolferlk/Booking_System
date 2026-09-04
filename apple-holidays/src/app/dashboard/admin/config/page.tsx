'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Settings, FlaskConical, Users, Loader2, Mail, MessageCircle, ShieldAlert, HardDrive, Zap, Power, Lock, Unlock, Eye, EyeOff, BrainCircuit, FileSearch, Tags, FolderSync, TrendingUp, Bot, BarChart3, Database, RefreshCw, CheckCircle2, Pencil, Truck, Ticket, Fuel, Send, MonitorPlay, Copy, Link2, ExternalLink, Sparkles, Store, Search, X, BellRing, SearchX, Map as MapIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import AiUsageMonitor from '@/components/settings/ai-usage-monitor'
import LastMinuteAlertSettings from '@/components/settings/last-minute-alert-settings'
import JourneyMapCard from '@/components/settings/journey-map-card'
import FileHandlerResolveSettings from '@/components/settings/file-handler-resolve-settings'
import {
  PARTNER_CONFIG, PARTNER_COUNTRIES, COUNTRY_FLAGS, COUNTRY_LABELS, parseCountryList,
} from '@/lib/partner-directory'

const DEFAULT_TEST_EMAIL_1 = 'sasiofficial25@gmail.com'
const DEFAULT_TEST_EMAIL_2 = 'sasindu@aahaas.com'
const DEFAULT_TEST_WHATSAPP = '94778231121'

interface Settings {
  use_test_data?: string
  test_email_1?: string
  test_email_2?: string
  test_whatsapp?: string
  less_credit_mode?: string
  auto_mail_enabled?: string
  auto_onedrive_enabled?: string
  ai_feedback_cc?: string
  // AI Token Controls
  ai_auto_agenda_generate?: string
  ai_pnl_auto_extract?: string
  ai_pnl_auto_classify?: string
  onedrive_new_files_only?: string
  ext_pnl_edit_enabled?: string
  // Ticket issuing without Accounts — stands down the G2 payment gate and the
  // G4 approval queue. Shared with the Accounts system, which reads this same
  // row to know its ticket queue has gone quiet.
  ticket_direct_issue?: string
  // Driver Log (Sri Lanka) advance sheet
  driver_log_tour_advance_pct?: string
  driver_log_fuel_advance_pct?: string
  driver_log_auto_send_enabled?: string
  // Live Screen (office TV) dashboard — public token-gated /view link
  view_dashboard_token?: string
  // Countries that require a guide / tour vendor (JSON array of country codes)
  guide_countries?: string
  tour_vendor_countries?: string
  // Journey map fly-through — pace and camera, shared by ops and the portal
  journey_map_speed?: string
  journey_map_follow_zoom?: string
  journey_map_cinematic?: string
  journey_map_auto_open?: string
  journey_map_portal_fullscreen?: string
}

/**
 * Which countries operate with guides / tour vendors.
 *
 * Only a handful of destinations use them, and the switch drives three things
 * at once: whether the movement chart shows the controls, whether the public
 * registration link accepts submissions, and which country links the directory
 * page offers. One place to change, so those three can never disagree.
 */
function PartnerCountriesCard({
  settings, saving, onSave,
}: {
  settings: Settings
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}) {
  const kinds = [
    { kind: 'guide' as const, config: PARTNER_CONFIG.guide, icon: Sparkles, tint: 'text-indigo-500' },
    { kind: 'tourVendor' as const, config: PARTNER_CONFIG.tourVendor, icon: Store, tint: 'text-teal-500' },
  ]

  function toggle(settingKey: string, current: string[], country: string) {
    const next = current.includes(country)
      ? current.filter(c => c !== country)
      : [...current, country]
    void onSave(settingKey, JSON.stringify(next))
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-slate-400" /> Guides &amp; Tour Vendors
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-6">
        <p className="text-xs text-slate-500 leading-relaxed">
          Only some destinations operate with guides and local tour vendors. Switch on the
          countries that need them — the movement chart shows the controls only for those
          countries, and the public registration links only accept registrations for them.
        </p>

        {kinds.map(({ kind, config, icon: Icon, tint }) => {
          const selected = parseCountryList(settings[config.settingKey])
          const busy = saving === config.settingKey
          return (
            <div key={kind} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${tint}`} />
                <p className="text-sm font-semibold text-slate-800">{config.labelPlural}</p>
                <span className="text-xs text-slate-400">
                  {selected.length === 0 ? 'Off everywhere' : `${selected.length} country${selected.length !== 1 ? 'ies' : ''}`}
                </span>
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              </div>

              <div className="flex flex-wrap gap-2">
                {PARTNER_COUNTRIES.map(country => {
                  const on = selected.includes(country)
                  return (
                    <button
                      key={country}
                      onClick={() => toggle(config.settingKey, selected, country)}
                      disabled={busy}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        on
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span>{COUNTRY_FLAGS[country]}</span>
                      {COUNTRY_LABELS[country]}
                      {on && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <a href={config.dashboardPath} className="inline-flex items-center gap-1.5 font-medium text-blue-600 hover:text-blue-700">
                  <ExternalLink className="w-3.5 h-3.5" /> Manage {config.labelPlural.toLowerCase()}
                </a>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}${config.registerPath}`
                    navigator.clipboard.writeText(url)
                      .then(() => toast.success('Registration link copied'))
                      .catch(() => prompt('Copy this link:', url))
                  }}
                  className="inline-flex items-center gap-1.5 font-medium text-slate-500 hover:text-slate-700"
                >
                  <Link2 className="w-3.5 h-3.5" /> Copy registration link
                </button>
              </div>
            </div>
          )
        })}
      </CardBody>
    </Card>
  )
}

function LiveScreenCard() {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/view` : '/view'

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { toast.error('Could not copy — copy it manually') }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <MonitorPlay className="w-4 h-4 text-slate-400" /> Live Screen Dashboard
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-4">
        <p className="text-xs text-slate-500">
          A big, animated real-time board for the office TV — today&apos;s tours on the ground per country,
          total &amp; upcoming bookings, and a sound alert whenever a new booking arrives. The link below is
          permanent — it never expires and needs no login. Data refreshes automatically every 2 minutes.
          Anyone with the link can view it, so keep it internal.
        </p>

        <div className="flex items-center gap-2 p-3 rounded-xl border border-slate-200 bg-slate-50">
          <Link2 className="w-4 h-4 text-slate-400 shrink-0" />
          <input readOnly value={link} className="flex-1 bg-transparent text-xs text-slate-700 font-mono outline-none truncate" onFocus={e => e.target.select()} />
          <button onClick={copy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800">
            {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
          <ExternalLink className="w-3.5 h-3.5" /> Open dashboard
        </a>
      </CardBody>
    </Card>
  )
}

function AIToggleRow({
  icon, label, description, tokenNote, enabled, saving, locked, color, invertColor, onToggle,
}: {
  icon: React.ReactNode
  label: string
  description: string
  tokenNote: string
  enabled: boolean
  saving: boolean
  locked: boolean
  color: 'purple' | 'blue' | 'indigo' | 'teal'
  invertColor?: boolean
  onToggle: () => void
}) {
  const colorMap = {
    purple: { on: 'bg-purple-500', off: 'bg-slate-300', badge: 'bg-purple-100 text-purple-700 border-purple-200', icon: 'text-purple-500' },
    blue:   { on: 'bg-blue-500',   off: 'bg-slate-300', badge: 'bg-blue-100 text-blue-700 border-blue-200',     icon: 'text-blue-500'   },
    indigo: { on: 'bg-indigo-500', off: 'bg-slate-300', badge: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: 'text-indigo-500' },
    teal:   { on: 'bg-teal-500',   off: 'bg-slate-300', badge: 'bg-teal-100 text-teal-700 border-teal-200',     icon: 'text-teal-500'   },
  }
  const c = colorMap[color]
  // For "New Files Only" toggle, ON means saving, so color shows green when enabled
  const isActive = invertColor ? enabled : enabled
  const bgColor  = isActive ? c.on : c.off

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3 flex-1">
        <div className={`mt-0.5 flex-shrink-0 ${c.icon}`}>{icon}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{label}</p>
            {!enabled && (
              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${c.badge}`}>
                {invertColor ? 'Active — saving tokens' : 'OFF — saving tokens'}
              </span>
            )}
            {enabled && !invertColor && (
              <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                AI Active
              </span>
            )}
            {!enabled && invertColor && (
              <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border bg-slate-100 text-slate-500 border-slate-200">
                Sync All
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
          <p className="text-xs text-emerald-600 font-medium mt-1">💡 {tokenNote}</p>
        </div>
      </div>
      <button
        onClick={onToggle}
        disabled={saving || locked}
        className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-400 disabled:opacity-40 disabled:cursor-not-allowed ${bgColor}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
        />
        {saving && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-3 h-3 animate-spin text-white" />
          </span>
        )}
      </button>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Settings index
   ───────────────
   Settings has grown past the point where scrolling finds anything, so every
   card on the page is registered here once: its title, the group it belongs
   to, and the words somebody might actually type when hunting for it
   ("test mode", "onedrive", "driver fuel"). The search box, the group filter
   and the jump-to rail all read this same list, so a card can never appear in
   one and be missing from another. Adding a card means adding a row here and
   wrapping it in <Section id="…">.
   ──────────────────────────────────────────────────────────────────────── */

type SectionGroup = 'Core' | 'Money & Tickets' | 'Operations' | 'Automation & AI' | 'Reference'

const SECTION_GROUPS: SectionGroup[] = ['Core', 'Money & Tickets', 'Operations', 'Automation & AI', 'Reference']

interface SectionMeta {
  id: string
  title: string
  group: SectionGroup
  icon: LucideIcon
  /** Extra words people search by that don't appear in the title. */
  keywords: string
}

const SECTIONS: SectionMeta[] = [
  { id: 'live-screen',    title: 'Live Screen Dashboard',        group: 'Core',            icon: MonitorPlay,  keywords: 'tv office board view public link token realtime sound alert' },
  { id: 'partners',       title: 'Guides & Tour Vendors',        group: 'Core',            icon: Sparkles,     keywords: 'countries registration link directory movement chart local partner' },
  { id: 'journey-map',    title: 'Journey Map Fly-Through',      group: 'Core',            icon: MapIcon,      keywords: 'camera speed zoom cinematic portal fullscreen animation route' },
  { id: 'data-mode',      title: 'Mail & WhatsApp Mode',         group: 'Core',            icon: FlaskConical, keywords: 'test data real customer sandbox email whatsapp number redirect safe' },

  { id: 'pnl-edit',       title: 'Accounts PNL Editing',         group: 'Money & Tickets', icon: Pencil,       keywords: 'profit loss adjustments unlink version invoice processor view only' },
  { id: 'ticket-issue',   title: 'Ticket Issuing & Approval',    group: 'Money & Tickets', icon: Ticket,       keywords: 'g2 g4 accounts approval gate direct purchase malaysia singapore vietnam portal payment' },
  { id: 'pnl-sync',       title: 'Accounts PNL Database Sync',   group: 'Money & Tickets', icon: Database,     keywords: 'link matching is number tour ref invoice snapshot refresh bulk' },

  { id: 'driver-advance', title: 'Driver Advance Sheet',         group: 'Operations',      icon: Truck,        keywords: 'sri lanka fuel tour percentage lunch entrance water accommodation whatsapp auto send 6pm' },
  { id: 'last-minute',    title: 'Last-Minute Booking Alerts',   group: 'Operations',      icon: BellRing,     keywords: 'd-4 alarm sound browser notification late file acknowledge' },
  { id: 'file-handler',   title: 'File Handler Resolution',      group: 'Operations',      icon: FolderSync,   keywords: '30 sundays placeholder onedrive handler mapping resolve' },

  { id: 'automation',     title: 'Automation Settings',          group: 'Automation & AI', icon: Zap,          keywords: 'auto mail inbox polling onedrive scheduled background critical password pause' },
  { id: 'ai-feedback-cc', title: 'AI Call Bot Summary Email',    group: 'Automation & AI', icon: Bot,          keywords: 'feedback cc recipients agent summary transcript sentiment' },
  { id: 'ai-tokens',      title: 'AI Token Controls',            group: 'Automation & AI', icon: BrainCircuit, keywords: 'gpt cost savings agenda generation pnl extract classify onedrive new files only' },
  { id: 'ai-usage',       title: 'OpenAI Token Usage',           group: 'Automation & AI', icon: BarChart3,    keywords: 'statistics spend monitor consumption chart model' },

  { id: 'danger-zone',    title: 'Danger Zone Notice',           group: 'Reference',       icon: ShieldAlert,  keywords: 'risky less credit mode protected critical password' },
  { id: 'test-mode-help', title: 'How Test Mode Works',          group: 'Reference',       icon: FlaskConical, keywords: 'documentation explanation redirect pdf reference help' },
]

/** All the text a query is matched against, built once per section. */
const SECTION_HAYSTACK = new Map(
  SECTIONS.map(s => [s.id, `${s.title} ${s.group} ${s.keywords}`.toLowerCase()]),
)

/**
 * Every whitespace-separated term has to appear somewhere in the section's
 * title, group or keywords — so "driver fuel" and "fuel driver" both land on
 * the advance sheet, and a half-typed "onedr" still matches.
 */
function sectionMatches(id: string, terms: string[]) {
  if (terms.length === 0) return true
  const hay = SECTION_HAYSTACK.get(id) ?? ''
  return terms.every(t => hay.includes(t))
}

/** ON / OFF / value pill shown next to a section in the jump-to rail. */
type SectionStatus = { label: string; tone: 'on' | 'off' | 'warn' | 'muted' }

const STATUS_TONES: Record<SectionStatus['tone'], string> = {
  on:    'bg-emerald-100 text-emerald-700',
  off:   'bg-slate-100 text-slate-500',
  warn:  'bg-amber-100 text-amber-700',
  muted: 'bg-slate-100 text-slate-400',
}

/**
 * Scroll target and highlight wrapper for one settings card. The ring flashes
 * for a moment after a jump so the eye lands on the right card instead of
 * hunting for what just moved.
 */
function Section({
  id, visible, flashed, children,
}: {
  id: string
  visible: boolean
  flashed: boolean
  children: React.ReactNode
}) {
  return (
    <section
      id={`setting-${id}`}
      hidden={!visible}
      className={`scroll-mt-40 rounded-xl transition-shadow duration-500 ${
        flashed ? 'ring-2 ring-brand-400 ring-offset-4 ring-offset-slate-50' : ''
      }`}
    >
      {children}
    </section>
  )
}

/**
 * The jump-to rail — every card on the page, grouped, with its live state next
 * to it. On a wide screen this is the fastest way to answer "is auto mail on?"
 * without scrolling the page at all.
 */
function SectionRail({
  matches, activeId, statuses, onJump,
}: {
  matches: Set<string>
  activeId: string | null
  statuses: Record<string, SectionStatus | undefined>
  onJump: (id: string) => void
}) {
  return (
    <nav className="space-y-4">
      {SECTION_GROUPS.map(group => {
        const rows = SECTIONS.filter(s => s.group === group && matches.has(s.id))
        if (rows.length === 0) return null
        return (
          <div key={group}>
            <p className="px-2 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
            <div className="space-y-0.5">
              {rows.map(s => {
                const status = statuses[s.id]
                const active = activeId === s.id
                return (
                  <button
                    key={s.id}
                    onClick={() => onJump(s.id)}
                    className={`group w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      active ? 'bg-white shadow-card text-slate-900' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'
                    }`}
                  >
                    <s.icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-brand-500' : 'text-slate-400 group-hover:text-slate-500'}`} />
                    <span className="flex-1 min-w-0 truncate text-xs font-medium">{s.title}</span>
                    {status && (
                      <span className={`flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_TONES[status.tone]}`}>
                        {status.label}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

/**
 * Search box + group filter. Typing narrows the page itself rather than
 * scrolling a result list, so what stays on screen is the real, working card —
 * you can flip the switch straight out of the search result.
 */
function SettingsFinder({
  query, onQuery, group, onGroup, groupCounts, resultCount, inputRef, unlocked, onJumpFirst,
}: {
  query: string
  onQuery: (v: string) => void
  group: SectionGroup | 'All'
  onGroup: (g: SectionGroup | 'All') => void
  groupCounts: Record<string, number>
  resultCount: number
  inputRef: React.MutableRefObject<HTMLInputElement | null>
  unlocked: boolean
  onJumpFirst: () => void
}) {
  const tabs: Array<SectionGroup | 'All'> = ['All', ...SECTION_GROUPS]

  return (
    <div className="sticky top-[72px] z-10 -mx-1 px-1 pt-1 pb-3 bg-slate-50/95 backdrop-blur">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-card p-3 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => onQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { onQuery(''); e.currentTarget.blur() }
              if (e.key === 'Enter')  onJumpFirst()
            }}
            placeholder="Search settings — try “driver”, “onedrive”, “tickets”…"
            className="w-full pl-9 pr-24 py-2.5 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-300 focus:bg-white transition-colors"
          />
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {query ? (
              <button
                onClick={() => { onQuery(''); inputRef.current?.focus() }}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-400 border border-slate-200 rounded bg-white">/</kbd>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {tabs.map(t => {
            const count  = t === 'All' ? SECTIONS.length : (groupCounts[t] ?? 0)
            const on     = group === t
            const empty  = count === 0
            return (
              <button
                key={t}
                onClick={() => onGroup(t)}
                disabled={empty && !on}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                  on
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {t}
                <span className={`text-[10px] font-bold ${on ? 'text-brand-500' : 'text-slate-400'}`}>{count}</span>
              </button>
            )
          })}

          <span className="ml-auto flex items-center gap-3 text-xs text-slate-400">
            <span>{resultCount} of {SECTIONS.length} shown</span>
            <span className={`inline-flex items-center gap-1 font-medium ${unlocked ? 'text-emerald-600' : 'text-slate-400'}`}>
              {unlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {unlocked ? 'Critical unlocked' : 'Critical locked'}
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ConfigPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [settings, setSettings] = useState<Settings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [criticalPassword, setCriticalPassword] = useState('')
  const [showCriticalPassword, setShowCriticalPassword] = useState(false)

  const [extPnlSyncing, setExtPnlSyncing] = useState(false)
  const [extPnlResult, setExtPnlResult]   = useState<{ total: number; linked: number; refreshed: number; skipped: number; errors: number } | null>(null)

  async function syncAllExtPnl() {
    setExtPnlSyncing(true)
    setExtPnlResult(null)
    try {
      const res  = await fetch('/api/admin/ext-pnl/sync-all', { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setExtPnlResult(json.data)
      toast.success(`Accounts PNL sync complete — ${json.data.linked} new links, ${json.data.refreshed} refreshed`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setExtPnlSyncing(false)
    }
  }

  useEffect(() => {
    if (status === 'loading') return
    if (!session || !['SUPER_ADMIN','ULTRA_SUPER_ADMIN'].includes(session.user.role)) router.replace('/dashboard')
  }, [session, status, router])

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(json => {
        if (json.success) setSettings(json.data ?? {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function saveSetting(key: string, value: string, password?: string) {
    setSaving(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, password }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSettings(prev => ({ ...prev, [key]: value }))
      toast.success('Setting saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(null)
    }
  }

  async function saveProtectedSetting(key: string, value: string) {
    if (!criticalPassword.trim()) {
      toast.error('Enter the critical services password first')
      return
    }
    await saveSetting(key, value, criticalPassword)
  }

  const useTestData       = settings.use_test_data === 'true'
  const testEmail1        = settings.test_email_1  ?? DEFAULT_TEST_EMAIL_1
  const testEmail2        = settings.test_email_2  ?? DEFAULT_TEST_EMAIL_2
  const testWa            = settings.test_whatsapp ?? DEFAULT_TEST_WHATSAPP
  // Default ON — only false when explicitly set to 'false'
  const autoMailEnabled       = settings.auto_mail_enabled     !== 'false'
  const autoOnedriveEnabled   = settings.auto_onedrive_enabled !== 'false'
  // AI Token Control settings — default ON, except onedrive_new_files_only (default OFF)
  const aiAgendaEnabled     = settings.ai_auto_agenda_generate !== 'false'
  const aiPnlExtractEnabled = settings.ai_pnl_auto_extract     !== 'false'
  const aiPnlClassifyEnabled= settings.ai_pnl_auto_classify    !== 'false'
  const onedriveNewOnly     = settings.onedrive_new_files_only === 'true'
  // Accounts PNL editing — default OFF (view-only) unless explicitly enabled
  const extPnlEditEnabled   = settings.ext_pnl_edit_enabled === 'true'
  // Direct ticket issuing — default OFF, so both Accounts gates stand unless
  // somebody with the critical password has deliberately taken them down.
  const ticketDirectIssue   = settings.ticket_direct_issue === 'true'
  // Driver Log (Sri Lanka) advance sheet — percentages default 100%, auto-send OFF
  const driverLogTourPct    = settings.driver_log_tour_advance_pct ?? '100'
  const driverLogFuelPct    = settings.driver_log_fuel_advance_pct ?? '100'
  const driverLogAutoSend   = settings.driver_log_auto_send_enabled === 'true'

  // Token savings estimate (tokens/month, rough)
  const savedTokens =
    (!aiAgendaEnabled     ? 4_500_000 : 0) +
    (!aiPnlExtractEnabled ? 918_750   : 0) +
    (!aiPnlClassifyEnabled? 552_500   : 0) +
    (onedriveNewOnly      ? 2_000_000 : 0)

  /* ── Finding a setting ────────────────────────────────────────────────────
     Search and the group filter both narrow the same set of ids; the page then
     hides the cards that fell out rather than rendering a separate result list,
     so whatever survives the filter is the live, working card. Hiding (not
     unmounting) keeps the cards that fetch their own data — the usage monitor,
     the file handler list — from re-fetching every keystroke. */
  const [query, setQuery]         = useState('')
  const [group, setGroup]         = useState<SectionGroup | 'All'>('All')
  const [activeId, setActiveId]   = useState<string | null>(null)
  const [flashId, setFlashId]     = useState<string | null>(null)
  const searchRef                 = useRef<HTMLInputElement | null>(null)

  const terms = useMemo(
    () => query.toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  )

  /** Ids surviving the search box alone — the group pill counts are built from
      this, so each pill shows how many hits it is hiding. */
  const searchMatches = useMemo(
    () => SECTIONS.filter(s => sectionMatches(s.id, terms)),
    [terms],
  )

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of searchMatches) counts[s.group] = (counts[s.group] ?? 0) + 1
    return counts
  }, [searchMatches])

  const visibleSections = useMemo(
    () => searchMatches.filter(s => group === 'All' || s.group === group),
    [searchMatches, group],
  )

  const visibleIds = useMemo(() => new Set(visibleSections.map(s => s.id)), [visibleSections])
  const show = (id: string) => visibleIds.has(id)

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`setting-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlashId(id)
    setActiveId(id)
    window.setTimeout(() => setFlashId(cur => (cur === id ? null : cur)), 1600)
  }, [])

  // "/" anywhere on the page jumps into the search box — but not while typing
  // into one of the settings fields, where "/" is just a slash.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Highlights whichever card the page is currently sitting on in the rail.
  useEffect(() => {
    if (loading) return
    const observer = new IntersectionObserver(
      entries => {
        const onScreen = entries.filter(e => e.isIntersecting)
        if (onScreen.length === 0) return
        const top = onScreen.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b))
        setActiveId(top.target.id.replace(/^setting-/, ''))
      },
      { rootMargin: '-140px 0px -60% 0px', threshold: 0 },
    )
    for (const s of visibleSections) {
      const el = document.getElementById(`setting-${s.id}`)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [visibleSections, loading])

  /* Live state per card, shown in the rail so the most-asked questions — is
     test mode on, is auto mail running, are the ticket gates down — are
     answerable without opening anything. */
  const aiOnCount = [aiAgendaEnabled, aiPnlExtractEnabled, aiPnlClassifyEnabled, !onedriveNewOnly].filter(Boolean).length
  const automationOn = [autoMailEnabled, autoOnedriveEnabled].filter(Boolean).length
  const partnerCount = parseCountryList(settings.guide_countries).length + parseCountryList(settings.tour_vendor_countries).length

  const sectionStatuses: Record<string, SectionStatus | undefined> = {
    'data-mode':      useTestData      ? { label: 'Test', tone: 'warn' }   : { label: 'Live',  tone: 'on' },
    'pnl-edit':       extPnlEditEnabled? { label: 'Edit', tone: 'warn' }   : { label: 'View',  tone: 'off' },
    'ticket-issue':   ticketDirectIssue? { label: 'Direct', tone: 'warn' } : { label: 'Gated', tone: 'on' },
    'driver-advance': driverLogAutoSend? { label: 'Auto', tone: 'on' }     : { label: 'Manual', tone: 'off' },
    'automation':     automationOn === 2 ? { label: 'On', tone: 'on' } : automationOn === 1 ? { label: '1/2', tone: 'warn' } : { label: 'Off', tone: 'off' },
    'ai-tokens':      { label: `${aiOnCount}/4`, tone: aiOnCount === 4 ? 'on' : aiOnCount === 0 ? 'off' : 'warn' },
    'partners':       { label: String(partnerCount), tone: partnerCount > 0 ? 'on' : 'off' },
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    )
  }

  return (
    <div>
      <Header title="Settings" subtitle="System configuration" />

      <div className="px-4 sm:px-8 py-6">
        <div className="mx-auto max-w-6xl flex items-start gap-8">

          {/* Jump-to rail — wide screens only; the finder above the cards does
              the same job on narrow ones. */}
          <aside className="hidden xl:block w-56 flex-shrink-0 sticky top-[88px]">
            <SectionRail
              matches={visibleIds}
              activeId={activeId}
              statuses={sectionStatuses}
              onJump={jumpTo}
            />
          </aside>

          <div className="flex-1 min-w-0 max-w-3xl">

            <SettingsFinder
              query={query}
              onQuery={setQuery}
              group={group}
              onGroup={setGroup}
              groupCounts={groupCounts}
              resultCount={visibleSections.length}
              inputRef={searchRef}
              unlocked={Boolean(criticalPassword.trim())}
              onJumpFirst={() => { if (visibleSections[0]) jumpTo(visibleSections[0].id) }}
            />

            {visibleSections.length === 0 && (
              <div className="flex flex-col items-center justify-center text-center py-20 rounded-2xl border border-dashed border-slate-200 bg-white/60">
                <SearchX className="w-8 h-8 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">No settings match &ldquo;{query}&rdquo;</p>
                <p className="mt-1 text-xs text-slate-400 max-w-xs">
                  Try a shorter word — the search covers each card&apos;s name, its group and the things it controls.
                </p>
                <button
                  onClick={() => { setQuery(''); setGroup('All') }}
                  className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" /> Clear filters
                </button>
              </div>
            )}

            {/* gap, not space-y — hidden cards must not leave a gap behind */}
            <div className="flex flex-col gap-6">
            <Section id="live-screen" visible={show('live-screen')} flashed={flashId === 'live-screen'}>
              {/* Live Screen Dashboard link */}
              <LiveScreenCard />
            </Section>

            <Section id="partners" visible={show('partners')} flashed={flashId === 'partners'}>
              {/* Which countries operate with guides / tour vendors */}
              <PartnerCountriesCard settings={settings} saving={saving} onSave={saveSetting} />
            </Section>

            <Section id="journey-map" visible={show('journey-map')} flashed={flashId === 'journey-map'}>
              {/* How the journey map's fly-through plays, for everyone */}
              <JourneyMapCard settings={settings} saving={saving} onSave={saveSetting} />
            </Section>

            <Section id="data-mode" visible={show('data-mode')} flashed={flashId === 'data-mode'}>
              {/* Data Mode Toggle */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Settings className="w-4 h-4 text-slate-400" /> Mail &amp; WhatsApp Mode
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-5">

                  <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-3">
                      {useTestData
                        ? <FlaskConical className="w-5 h-5 text-amber-500" />
                        : <Users className="w-5 h-5 text-green-500" />
                      }
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          {useTestData ? 'Test Data Mode' : 'Real Customer Data Mode'}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {useTestData
                            ? 'Emails & WhatsApp go to test addresses only — real customers are not contacted.'
                            : 'Emails & WhatsApp go directly to the real customer and agent addresses.'}
                        </p>
                      </div>
                    </div>
                    <button
                      disabled={saving === 'use_test_data'}
                      onClick={() => saveSetting('use_test_data', useTestData ? 'false' : 'true')}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                        useTestData ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                    >
                      {saving === 'use_test_data' && (
                        <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                      )}
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          useTestData ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {useTestData && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">
                        Test Addresses (active)
                      </p>

                      <div className="flex items-center gap-3">
                        <Mail className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          {[
                            { label: 'Test Email 1', key: 'test_email_1', value: testEmail1 },
                            { label: 'Test Email 2', key: 'test_email_2', value: testEmail2 },
                          ].map(item => (
                            <div key={item.key} className="flex items-center gap-2">
                              <span className="text-xs text-amber-600 w-24 flex-shrink-0">{item.label}</span>
                              <input
                                type="email"
                                defaultValue={item.value}
                                onBlur={e => {
                                  if (e.target.value !== item.value) {
                                    saveSetting(item.key, e.target.value)
                                  }
                                }}
                                className="flex-1 px-2 py-1 text-xs border border-amber-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <MessageCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-xs text-amber-600 w-24 flex-shrink-0">Test WhatsApp</span>
                          <input
                            type="text"
                            defaultValue={testWa}
                            onBlur={e => {
                              if (e.target.value !== testWa) {
                                saveSetting('test_whatsapp', e.target.value)
                              }
                            }}
                            className="flex-1 px-2 py-1 text-xs border border-amber-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {!useTestData && (
                    <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                      <p className="text-xs text-green-700">
                        <strong>Live mode:</strong> All mail &amp; WhatsApp messages will be delivered to the actual customer and agent contact details extracted from each booking.
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Section>

            <Section id="pnl-edit" visible={show('pnl-edit')} flashed={flashId === 'pnl-edit'}>
              {/* ── Accounts PNL Editing ── */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-slate-400" /> Accounts PNL Editing
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${extPnlEditEnabled ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${extPnlEditEnabled ? 'bg-amber-100' : 'bg-slate-100'}`}>
                        <Pencil className={`w-4 h-4 ${extPnlEditEnabled ? 'text-amber-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Allow Editing the Accounts PNL Panel</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {extPnlEditEnabled
                            ? 'Editing is ON — staff can add P&L adjustments, switch versions, create tickets, unlink, and manually link records.'
                            : 'View-only (default) — the Accounts PNL panel shows details only. No adjustments, unlink, version switching, ticket creation, or manual linking.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold ${extPnlEditEnabled ? 'text-amber-600' : 'text-slate-400'}`}>
                        {extPnlEditEnabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        disabled={saving === 'ext_pnl_edit_enabled'}
                        onClick={() => saveSetting('ext_pnl_edit_enabled', extPnlEditEnabled ? 'false' : 'true')}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${extPnlEditEnabled ? 'bg-amber-500' : 'bg-slate-300'}`}
                      >
                        {saving === 'ext_pnl_edit_enabled' && (
                          <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                        )}
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${extPnlEditEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 text-xs text-slate-400">
                    <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p>This only affects the live Accounts PNL panel on each booking&apos;s P&amp;L page. Editing is still additionally restricted to Accounts, Booking Team, and Admin roles.</p>
                  </div>
                </CardBody>
              </Card>
            </Section>

            <Section id="ticket-issue" visible={show('ticket-issue')} flashed={flashId === 'ticket-issue'}>
              {/* ── Direct Ticket Issuing — Accounts out of the loop ── */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Ticket className="w-4 h-4 text-slate-400" /> Ticket Issuing &amp; Accounts Approval
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Normally a ticket waits on two answers from Accounts before it can be bought: the
                    P&amp;L line it costs against has to be paid (<span className="font-semibold">G2</span>),
                    and on Malaysia, Singapore and Vietnam the ticket itself has to be submitted, approved
                    and the portal paid (<span className="font-semibold">G4</span>). Switch this on and
                    both stand down — the ground team purchases straight away, and the Accounts ticket
                    approval queue stops expecting anything from OPS.
                  </p>

                  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${ticketDirectIssue ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${ticketDirectIssue ? 'bg-amber-100' : 'bg-slate-100'}`}>
                        <Ticket className={`w-4 h-4 ${ticketDirectIssue ? 'text-amber-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Issue Tickets Without Accounts Approval</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {ticketDirectIssue
                            ? 'ON — Purchase is open with no P&L payment confirmation and no approval request. Receipts are the only record Accounts will get.'
                            : 'OFF (default) — tickets wait for the P&L payment (G2) and, on MY/SG/VN, for Accounts to approve and pay the portal (G4).'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold ${ticketDirectIssue ? 'text-amber-600' : 'text-slate-400'}`}>
                        {ticketDirectIssue ? 'ON' : 'OFF'}
                      </span>
                      <button
                        disabled={saving === 'ticket_direct_issue' || !criticalPassword.trim()}
                        onClick={() => saveProtectedSetting('ticket_direct_issue', ticketDirectIssue ? 'false' : 'true')}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${ticketDirectIssue ? 'bg-amber-500' : 'bg-slate-300'}`}
                      >
                        {saving === 'ticket_direct_issue' && (
                          <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                        )}
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${ticketDirectIssue ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>

                  {/* This switch releases money, so it is locked behind the same
                      password as the other critical services. The field is repeated
                      here rather than only under Automation below, so turning the
                      gates off is never a single stray click on a scrolled page. */}
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Critical Services Password
                    </p>
                    <div className="relative">
                      <input
                        type={showCriticalPassword ? 'text' : 'password'}
                        value={criticalPassword}
                        onChange={e => setCriticalPassword(e.target.value)}
                        placeholder="Enter password to change this switch"
                        className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-colors bg-white"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCriticalPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showCriticalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-xs text-slate-400">
                    <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p>
                      Requests already sitting with Accounts are left exactly as they are — nothing is
                      cancelled or rewritten, and switching back off puts the queue back where it was.
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Section>

            <Section id="driver-advance" visible={show('driver-advance')} flashed={flashId === 'driver-advance'}>
              {/* ── Driver Log (Sri Lanka) Advance Sheet ── */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-500" /> Driver Advance Sheet (Sri Lanka)
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <p className="text-xs text-slate-500">
                    Controls the Driver Advance Sheet shown on Sri Lanka bookings. The advance percentages
                    set the default share of each total that is advanced to the driver
                    (Tour = Lunch + Entrance tickets, Fuel = Driver Accommodation + Travel KM×Rate + Water).
                    These can be overridden per booking on the sheet itself.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-purple-200 bg-purple-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2 text-purple-700">
                        <Ticket className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wide">Tour Advance %</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={0} max={100} step={1}
                          defaultValue={driverLogTourPct}
                          onBlur={e => { if (e.target.value !== driverLogTourPct) saveSetting('driver_log_tour_advance_pct', String(Math.min(100, Math.max(0, Number(e.target.value))))) }}
                          className="w-24 px-2 py-1 text-sm font-mono border border-purple-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                        />
                        <span className="text-slate-400 text-sm">% of Lunch + Entrance tickets</span>
                        {saving === 'driver_log_tour_advance_pct' && <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />}
                      </div>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                      <div className="flex items-center gap-2 mb-2 text-blue-700">
                        <Fuel className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wide">Fuel Advance %</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={0} max={100} step={1}
                          defaultValue={driverLogFuelPct}
                          onBlur={e => { if (e.target.value !== driverLogFuelPct) saveSetting('driver_log_fuel_advance_pct', String(Math.min(100, Math.max(0, Number(e.target.value))))) }}
                          className="w-24 px-2 py-1 text-sm font-mono border border-blue-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <span className="text-slate-400 text-sm">% of Accommodation + Travel + Water</span>
                        {saving === 'driver_log_fuel_advance_pct' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                      </div>
                    </div>
                  </div>

                  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${driverLogAutoSend ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${driverLogAutoSend ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                        <Send className={`w-4 h-4 ${driverLogAutoSend ? 'text-emerald-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Auto-send to driver (6pm, day before tour)</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {driverLogAutoSend
                            ? 'ON — every Sri Lanka booking starting the next day has its advance sheet WhatsApped to the allocated driver at 6pm (Asia/Colombo). Runs on the backend even with no user online.'
                            : 'OFF — driver advance sheets are only sent manually from each booking.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold ${driverLogAutoSend ? 'text-emerald-600' : 'text-slate-400'}`}>
                        {driverLogAutoSend ? 'ON' : 'OFF'}
                      </span>
                      <button
                        disabled={saving === 'driver_log_auto_send_enabled'}
                        onClick={() => saveSetting('driver_log_auto_send_enabled', driverLogAutoSend ? 'false' : 'true')}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${driverLogAutoSend ? 'bg-emerald-500' : 'bg-slate-300'}`}
                      >
                        {saving === 'driver_log_auto_send_enabled' && (
                          <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                        )}
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${driverLogAutoSend ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Section>

            <Section id="last-minute" visible={show('last-minute')} flashed={flashId === 'last-minute'}>
              {/* ── Last-minute booking alerts (per browser) ── */}
              <LastMinuteAlertSettings />
            </Section>

            <Section id="automation" visible={show('automation')} flashed={flashId === 'automation'}>
              {/* ── Automation Settings ── */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Zap className="w-4 h-4 text-brand-500" /> Automation Settings
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5" />
                      Critical Services Password
                    </p>
                    <div className="relative">
                      <input
                        type={showCriticalPassword ? 'text' : 'password'}
                        value={criticalPassword}
                        onChange={e => setCriticalPassword(e.target.value)}
                        placeholder="Enter password to change automation settings"
                        className="w-full pr-10 px-3 py-2.5 text-sm rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition-colors bg-white"
                        autoComplete="off"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCriticalPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showCriticalPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-amber-700/80">
                      Use the same password from <code className="font-mono">CRITICAL_SERVICES_PASSWORD</code> to change automation toggles.
                    </p>
                  </div>

                  {/* Auto Mail */}
                  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${autoMailEnabled ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${autoMailEnabled ? 'bg-green-100' : 'bg-slate-100'}`}>
                        <Mail className={`w-4 h-4 ${autoMailEnabled ? 'text-green-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Auto Mail Processing</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {autoMailEnabled
                            ? 'System is automatically reading inbox emails and creating bookings every 5 min.'
                            : 'Mail processing is paused — emails will not be read or processed.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold ${autoMailEnabled ? 'text-green-600' : 'text-slate-400'}`}>
                        {autoMailEnabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        disabled={saving === 'auto_mail_enabled' || !criticalPassword.trim()}
                        onClick={() => saveProtectedSetting('auto_mail_enabled', autoMailEnabled ? 'false' : 'true')}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${autoMailEnabled ? 'bg-green-500' : 'bg-slate-300'}`}
                      >
                        {saving === 'auto_mail_enabled' && (
                          <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                        )}
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${autoMailEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>

                  {/* Auto OneDrive */}
                  <div className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${autoOnedriveEnabled ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${autoOnedriveEnabled ? 'bg-blue-100' : 'bg-slate-100'}`}>
                        <HardDrive className={`w-4 h-4 ${autoOnedriveEnabled ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-800">Auto OneDrive Poll &amp; Processing</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {autoOnedriveEnabled
                            ? 'Auto-poll is ACTIVE — OneDrive is scanned every 10 min and new TC/PNL files auto-create bookings.'
                            : 'Auto-poll is PAUSED — OneDrive will not be scanned automatically. Manual sync still works.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-semibold ${autoOnedriveEnabled ? 'text-blue-600' : 'text-slate-400'}`}>
                        {autoOnedriveEnabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        disabled={saving === 'auto_onedrive_enabled' || !criticalPassword.trim()}
                        onClick={() => saveProtectedSetting('auto_onedrive_enabled', autoOnedriveEnabled ? 'false' : 'true')}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${autoOnedriveEnabled ? 'bg-blue-500' : 'bg-slate-300'}`}
                      >
                        {saving === 'auto_onedrive_enabled' && (
                          <Loader2 className="absolute inset-0 m-auto w-4 h-4 text-white animate-spin" />
                        )}
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${autoOnedriveEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 text-xs text-slate-400 pt-1">
                    <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p>Turning off automation does not affect manual scans or the admin OneDrive monitor page — only the automatic scheduled processing is paused.</p>
                  </div>

                </CardBody>
              </Card>
            </Section>

            <Section id="ai-feedback-cc" visible={show('ai-feedback-cc')} flashed={flashId === 'ai-feedback-cc'}>
              {/* ── AI Call Bot — Feedback Summary CC ── */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-violet-500" /> AI Call Bot — Feedback Summary Email
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    When you click <strong>&ldquo;Review &amp; Send Summary&rdquo;</strong> on a booking, the feedback summary email is sent to the agent automatically. Configure who else should always receive a CC copy.
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-violet-500" />
                      Global CC Addresses <span className="font-normal text-slate-400">(comma-separated)</span>
                    </label>
                    <input
                      type="text"
                      defaultValue={settings.ai_feedback_cc ?? ''}
                      onBlur={e => {
                        const v = e.target.value.trim()
                        if (v !== (settings.ai_feedback_cc ?? '')) saveSetting('ai_feedback_cc', v)
                      }}
                      placeholder="manager@aahaas.com, ops@aahaas.com"
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
                    />
                    <p className="text-[10px] text-slate-400 mt-1.5 leading-relaxed">
                      These addresses are always CC&apos;d in addition to any per-booking CC recipients. The agent&apos;s email and customer contact email are always added automatically from the booking.
                      In test mode, this list is ignored and emails go to the test addresses only.
                    </p>
                  </div>

                  <div className="rounded-xl border border-violet-100 bg-violet-50 p-3">
                    <p className="text-xs text-violet-700 leading-relaxed font-medium flex items-start gap-2">
                      <Bot className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      The feedback summary email includes: day-by-day call history, sentiment analysis, hotel / meals / driver / vehicle ratings, issue highlights, AI summaries, and full call transcripts — all in a branded HTML email.
                    </p>
                  </div>
                </CardBody>
              </Card>
            </Section>

            <Section id="ai-tokens" visible={show('ai-tokens')} flashed={flashId === 'ai-tokens'}>
              {/* ── AI Token Controls ── */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between w-full">
                    <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <Bot className="w-4 h-4 text-purple-500" /> AI Token Controls
                    </h3>
                    {savedTokens > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                        <TrendingUp className="w-3 h-3" />
                        ~{(savedTokens / 1_000_000).toFixed(1)}M tokens/mo saved
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardBody className="p-5 space-y-4">

                  <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3 text-xs text-purple-700 flex items-start gap-2">
                    <BrainCircuit className="w-4 h-4 flex-shrink-0 mt-0.5 text-purple-500" />
                    <span>
                      These toggles control which automatic AI (GPT-4o) calls run in the background.
                      Turning off a setting <strong>does not break anything</strong> — it just skips that AI step to save costs.
                    </span>
                  </div>

                  {/* Inline password field so saves work without scrolling */}
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                    <div className="relative flex-1">
                      <input
                        type={showCriticalPassword ? 'text' : 'password'}
                        placeholder="Critical services password required to change these"
                        value={criticalPassword}
                        onChange={e => setCriticalPassword(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-purple-300 pr-8"
                      />
                      <button
                        onClick={() => setShowCriticalPassword(v => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                        {showCriticalPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {criticalPassword.trim() && (
                      <span className="text-xs text-emerald-600 font-medium flex-shrink-0">Unlocked</span>
                    )}
                  </div>

                  {/* AI Auto Agenda Generate */}
                  <AIToggleRow
                    icon={<BrainCircuit className="w-4 h-4" />}
                    label="Auto-Generate Agenda"
                    description={aiAgendaEnabled
                      ? 'GPT-4o generates a full movement chart for every new booking from email — ~7,500 tokens per email.'
                      : 'Agenda generation is OFF — only a skeleton agenda is created. Manually generate from the booking page.'}
                    tokenNote="~7,500 tokens saved per TC email"
                    enabled={aiAgendaEnabled}
                    saving={saving === 'ai_auto_agenda_generate'}
                    locked={!criticalPassword.trim()}
                    color="purple"
                    onToggle={() => saveProtectedSetting('ai_auto_agenda_generate', aiAgendaEnabled ? 'false' : 'true')}
                  />

                  {/* AI PNL Extraction */}
                  <AIToggleRow
                    icon={<FileSearch className="w-4 h-4" />}
                    label="PNL from Mails &amp; Files"
                    description={aiPnlExtractEnabled
                      ? 'PNL is read automatically from incoming emails and OneDrive files (PDF/Word/Excel). Turn OFF to use only Account DB PNL.'
                      : 'PNL extraction from emails and OneDrive files is OFF — only Account DB PNL is used (no AI cost for PNL).'}
                    tokenNote="Stops all automatic PNL from mails and OneDrive — use Account DB instead"
                    enabled={aiPnlExtractEnabled}
                    saving={saving === 'ai_pnl_auto_extract'}
                    locked={!criticalPassword.trim()}
                    color="blue"
                    onToggle={() => saveProtectedSetting('ai_pnl_auto_extract', aiPnlExtractEnabled ? 'false' : 'true')}
                  />

                  {/* AI PNL Classify */}
                  <AIToggleRow
                    icon={<Tags className="w-4 h-4" />}
                    label="AI PNL Category Classify"
                    description={aiPnlClassifyEnabled
                      ? 'GPT-4o-mini classifies each PNL line into a category (Hotel, Transport, etc.) — ~650 tokens per booking.'
                      : 'AI classification is OFF — keyword-based fallback is used instead (free, slightly less accurate).'}
                    tokenNote="~650 tokens saved per PNL classification"
                    enabled={aiPnlClassifyEnabled}
                    saving={saving === 'ai_pnl_auto_classify'}
                    locked={!criticalPassword.trim()}
                    color="indigo"
                    onToggle={() => saveProtectedSetting('ai_pnl_auto_classify', aiPnlClassifyEnabled ? 'false' : 'true')}
                  />

                  {/* OneDrive New Files Only */}
                  <AIToggleRow
                    icon={<FolderSync className="w-4 h-4" />}
                    label="OneDrive: New Files Only"
                    description={onedriveNewOnly
                      ? 'Only newly created/updated files are processed — folders already fully processed are skipped. Saves tokens and time on each sync.'
                      : 'Every sync re-checks all folders, including ones already processed. Useful for re-processing but costs more tokens.'}
                    tokenNote="~2M+ tokens saved per month by skipping re-processed folders"
                    enabled={onedriveNewOnly}
                    saving={saving === 'onedrive_new_files_only'}
                    locked={!criticalPassword.trim()}
                    color="teal"
                    onToggle={() => saveProtectedSetting('onedrive_new_files_only', onedriveNewOnly ? 'false' : 'true')}
                    invertColor
                  />

                  <div className="flex items-start gap-2 text-xs text-slate-400 pt-1 border-t border-slate-100">
                    <Power className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <p>
                      Manual processing (e.g., &quot;Process File&quot; button in Drive Bookings, or manual agenda generation) is always available regardless of these settings.
                      These only affect <strong>automatic background processing</strong>.
                    </p>
                  </div>

                </CardBody>
              </Card>
            </Section>

            <Section id="danger-zone" visible={show('danger-zone')} flashed={flashId === 'danger-zone'}>
              <Card className="border-2 border-red-200 bg-red-50/30">
                <CardHeader>
                  <h3 className="text-sm font-semibold text-red-900 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-500" /> Danger Zone Notice
                  </h3>
                </CardHeader>
                <CardBody className="p-5">
                  <p className="text-sm text-red-800">
                    Risky switches like Test Data Mode and Less Credit Mode are now protected in the
                    <strong> Danger Zone</strong> page. Open the danger area to change them with the critical password.
                  </p>
                </CardBody>
              </Card>
            </Section>

            <Section id="test-mode-help" visible={show('test-mode-help')} flashed={flashId === 'test-mode-help'}>
              {/* Reference info */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-slate-400" /> How Test Mode Works
                  </h3>
                </CardHeader>
                <CardBody className="p-5">
                  <ul className="space-y-2 text-xs text-slate-600">
                    <li className="flex gap-2"><Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>Send Email:</strong> Redirects To &amp; CC to test email addresses — the booking confirmation PDF is still generated from real booking data.</span></li>
                    <li className="flex gap-2"><MessageCircle className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>WhatsApp:</strong> Pre-fills the number with the test WhatsApp number instead of the customer&apos;s number.</span></li>
                    <li className="flex gap-2"><Users className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" /><span><strong>Real mode:</strong> Uses the actual agent email, contact email, and customer WhatsApp extracted from each booking.</span></li>
                  </ul>
                </CardBody>
              </Card>
            </Section>

            <Section id="ai-usage" visible={show('ai-usage')} flashed={flashId === 'ai-usage'}>
              {/* ── OpenAI Usage Monitor ── */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between w-full">
                    <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-purple-500" /> OpenAI Token Usage
                    </h3>
                    <span className="text-xs text-slate-400">Live statistics from the database</span>
                  </div>
                </CardHeader>
                <CardBody className="p-5">
                  <AiUsageMonitor />
                </CardBody>
              </Card>
            </Section>

            <Section id="file-handler" visible={show('file-handler')} flashed={flashId === 'file-handler'}>
              {/* 30 Sundays placeholder file handler → real handler */}
              <FileHandlerResolveSettings />
            </Section>

            <Section id="pnl-sync" visible={show('pnl-sync')} flashed={flashId === 'pnl-sync'}>
              {/* Accounts PNL Sync */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-500" /> Accounts PNL Database Sync
                  </h3>
                </CardHeader>
                <CardBody className="p-5 space-y-4">
                  <p className="text-sm text-slate-600">
                    Scans all bookings and attempts to auto-link each one to a matching record in the Accounts
                    team&apos;s <code className="bg-slate-100 px-1 rounded text-xs">invoice_processor</code> database.
                    Matching is tried in order: IS Number → Tour Ref → Invoice Number. Already-linked bookings
                    get their cached snapshot refreshed.
                  </p>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={syncAllExtPnl}
                      disabled={extPnlSyncing}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      {extPnlSyncing
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> Syncing all bookings…</>
                        : <><RefreshCw className="w-4 h-4" /> Sync All Bookings with Accounts PNL</>}
                    </button>
                  </div>

                  {extPnlResult && (
                    <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-emerald-800 space-y-0.5">
                        <p className="font-semibold">Sync complete — {extPnlResult.total} bookings processed</p>
                        <p>
                          <span className="font-medium">{extPnlResult.linked}</span> newly linked ·{' '}
                          <span className="font-medium">{extPnlResult.refreshed}</span> refreshed ·{' '}
                          <span className="font-medium">{extPnlResult.skipped}</span> no match ·{' '}
                          <span className={extPnlResult.errors > 0 ? 'text-red-700 font-semibold' : ''}>
                            {extPnlResult.errors} errors
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </CardBody>
              </Card>
            </Section>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
