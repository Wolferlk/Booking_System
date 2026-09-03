'use client'

/**
 * Mail Box Settings — the four things that make the compose window work.
 *
 *   Templates      what the desk can say
 *   Agents         who it says it to, and how a booking's agent string resolves
 *   Internal Team  who is copied on every send
 *   All Mail       everything sent, with the replies
 *
 * They live on one screen behind tabs because they are one job. Setting up a new
 * operator means writing a template, adding the agent, and checking the first
 * mail actually landed — three tabs, one page, no navigation between them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Mail, FileText, Building2, Users, Inbox, Plus, Pencil, Trash2, Search,
  Loader2, RefreshCw, ShieldCheck, Paperclip, Sparkles, AlertTriangle,
  ChevronRight, X, Save, Check, Send, CornerUpLeft, Clock, ExternalLink,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { cn, formatDateTime } from '@/lib/utils'
import { canManageMailbox, canUseMailbox } from '@/lib/mailbox/access'
import TemplateEditor, { BLANK_TEMPLATE, type EditableTemplate } from './template-editor'
import type { UserRole } from '@prisma/client'

/* eslint-disable @typescript-eslint/no-explicit-any */

type TabKey = 'templates' | 'agents' | 'internal' | 'outbox'

const TABS: { key: TabKey; label: string; icon: typeof Mail; hint: string }[] = [
  { key: 'templates', label: 'Templates',     icon: FileText,  hint: 'What the desk can say' },
  { key: 'agents',    label: 'Agents',        icon: Building2, hint: 'Who it goes to' },
  { key: 'internal',  label: 'Internal Team', icon: Users,     hint: 'Always copied' },
  { key: 'outbox',    label: 'All Mail',      icon: Inbox,     hint: 'Sent, and replies' },
]

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : []

// ─── Shared bits ─────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, note, action }: {
  icon: typeof Mail; title: string; note: string; action?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center">
      <Icon className="mx-auto h-9 w-9 text-slate-200" />
      <p className="mt-3 text-sm font-bold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-400">{note}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** A comma/newline separated address list, edited as free text. */
function AddressList({ label, value, onChange, placeholder }: {
  label: string; value: string[]; onChange: (v: string[]) => void; placeholder: string
}) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <textarea
        value={value.join(', ')}
        onChange={e => onChange(e.target.value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean))}
        rows={2}
        placeholder={placeholder}
        className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />
    </div>
  )
}

// ─── Agent drawer ────────────────────────────────────────────────────────────

interface AgentForm {
  id?: string
  name: string
  company: string
  primaryEmail: string
  ccEmails: string[]
  matchKeys: string[]
  country: string
  phone: string
  notes: string
  isActive: boolean
}

const BLANK_AGENT: AgentForm = {
  name: '', company: '', primaryEmail: '', ccEmails: [], matchKeys: [],
  country: '', phone: '', notes: '', isActive: true,
}

function AgentDrawer({ open, initial, onClose, onSaved }: {
  open: boolean; initial: AgentForm; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<AgentForm>(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setForm(initial) }, [open, initial])

  const set = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) { toast.error('Give the agent a name'); return }
    if (!form.primaryEmail.includes('@')) { toast.error('A valid primary email is required'); return }
    setSaving(true)
    try {
      const res = await fetch(form.id ? `/api/mailbox/agents/${form.id}` : '/api/mailbox/agents', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Saved')
      onSaved(); onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Building2 className="h-4 w-4 text-brand-500" />
          <h2 className="text-base font-extrabold text-slate-900">{form.id ? 'Edit agent' : 'New agent'}</h2>
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Agent name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="Make My Trip"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
            <div>
              <label className="form-label">Company</label>
              <input value={form.company} onChange={e => set('company', e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>

          <div>
            <label className="form-label">Primary email *</label>
            <input value={form.primaryEmail} onChange={e => set('primaryEmail', e.target.value)}
              placeholder="ops@agent.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            <p className="mt-1 text-[11px] text-slate-400">Goes on the To line when this agent is detected.</p>
          </div>

          <AddressList label="Always copy these addresses" value={form.ccEmails}
            onChange={v => set('ccEmails', v)} placeholder="reservations@agent.com, accounts@agent.com" />

          <div>
            <AddressList label="Name variations" value={form.matchKeys}
              onChange={v => set('matchKeys', v)} placeholder="MMT, MakeMyTrip Pvt Ltd" />
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              How this operator is spelled on bookings. The agent name above is always matched, so
              only add the variants — abbreviations, trading names, the misspelling that keeps
              coming through on confirmations.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Country</label>
              <input value={form.country} onChange={e => set('country', e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>

          <div>
            <label className="form-label">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          </div>

          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={form.isActive} onChange={e => set('isActive', e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
            <span className="text-xs font-semibold text-slate-600">Available for auto-detection and composing</span>
          </label>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button onClick={onClose} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {form.id ? 'Save' : 'Add agent'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function MailBoxSettingsPage() {
  const { data: session, status } = useSession()
  const role = session?.user?.role as UserRole | undefined

  const [tab, setTab] = useState<TabKey>('templates')
  // Read `?tab=` from the URL directly rather than through `useSearchParams`,
  // which forces this whole client page under a Suspense boundary at build time.
  // The deep link only has to work on arrival, so one read on mount is enough.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t && TABS.some(x => x.key === t)) setTab(t as TabKey)
  }, [])

  const [templates, setTemplates] = useState<any[]>([])
  const [agents, setAgents] = useState<any[]>([])
  const [internal, setInternal] = useState<any[]>([])
  const [threads, setThreads] = useState<any[]>([])
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [templateEditor, setTemplateEditor] = useState<EditableTemplate | null>(null)
  const [agentDrawer, setAgentDrawer] = useState<AgentForm | null>(null)
  const [query, setQuery] = useState('')

  // Internal-team inline add
  const [newInternal, setNewInternal] = useState({ name: '', email: '', team: '', alwaysCc: true })

  // Outbox
  const [openThread, setOpenThread] = useState<any | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  const canManage = role ? canManageMailbox(role) : false
  const canUse    = role ? canUseMailbox(role) : false

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, a, i, th] = await Promise.all([
        fetch('/api/mailbox/templates').then(r => r.json()),
        fetch('/api/mailbox/agents').then(r => r.json()),
        fetch('/api/mailbox/internal').then(r => r.json()),
        fetch('/api/mailbox/threads?limit=100').then(r => r.json()),
      ])
      if (t.success) setTemplates(t.data.templates)
      if (a.success) setAgents(a.data.agents)
      if (i.success) setInternal(i.data.recipients)
      if (th.success) { setThreads(th.data.threads); setUnreadTotal(th.data.unreadTotal) }
    } catch {
      toast.error('Could not load Mail Box settings')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { if (canUse) load() }, [canUse, load])

  async function act(url: string, options: RequestInit, okMessage?: string) {
    setBusy(true)
    try {
      const res = await fetch(url, options)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? okMessage ?? 'Done')
      await load()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
      return false
    } finally { setBusy(false) }
  }

  async function openThreadDetail(id: string) {
    setThreadLoading(true)
    setOpenThread({ id })
    try {
      const res = await fetch(`/api/mailbox/threads/${id}?sync=true`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setOpenThread(json.data.thread)
      await fetch(`/api/mailbox/threads/${id}`, { method: 'PATCH' })
      setThreads(prev => prev.map(t => t.id === id ? { ...t, unreadReplies: 0 } : t))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the mail')
      setOpenThread(null)
    } finally { setThreadLoading(false) }
  }

  const filteredThreads = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || tab !== 'outbox') return threads
    return threads.filter(t =>
      (t.subject ?? '').toLowerCase().includes(q) ||
      (t.bookingRef ?? '').toLowerCase().includes(q) ||
      (t.toAddresses ?? '').toLowerCase().includes(q))
  }, [threads, query, tab])

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || tab !== 'agents') return agents
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.company ?? '').toLowerCase().includes(q) ||
      a.primaryEmail.toLowerCase().includes(q))
  }, [agents, query, tab])

  if (status === 'loading') {
    return <div className="flex h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
  }
  if (!canUse) {
    return (
      <div>
        <Header title="Mail Box Settings" />
        <div className="p-8">
          <EmptyState icon={ShieldCheck} title="Not available for your role"
            note="Mail Box is open to the booking, ground, experience, accounts and reservation desks." />
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header
        title="Mail Box Settings"
        subtitle="Templates, the agent directory, the internal copy list, and every mail sent"
        actions={
          <button onClick={load} disabled={loading}
            className="btn btn-sm btn-secondary inline-flex items-center gap-1.5">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
          </button>
        }
      />

      <div className="space-y-5 p-4 sm:p-8">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2">
          {TABS.map(t => {
            const count = t.key === 'templates' ? templates.length
              : t.key === 'agents' ? agents.length
                : t.key === 'internal' ? internal.length
                  : threads.length
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setQuery(''); setOpenThread(null) }}
                className={cn(
                  'group flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-left transition-all',
                  tab === t.key
                    ? 'border-brand-300 bg-brand-50 shadow-sm ring-1 ring-brand-200'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm',
                )}
              >
                <t.icon className={cn('h-4 w-4', tab === t.key ? 'text-brand-600' : 'text-slate-400')} />
                <div>
                  <p className={cn('text-sm font-bold leading-none', tab === t.key ? 'text-brand-800' : 'text-slate-800')}>
                    {t.label}
                    <span className={cn('ml-1.5 rounded-full px-1.5 py-px text-[10px] font-extrabold',
                      t.key === 'outbox' && unreadTotal > 0 ? 'bg-rose-500 text-white'
                        : tab === t.key ? 'bg-brand-200 text-brand-800' : 'bg-slate-100 text-slate-500')}>
                      {t.key === 'outbox' && unreadTotal > 0 ? unreadTotal : count}
                    </span>
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">{t.hint}</p>
                </div>
              </button>
            )
          })}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {(tab === 'agents' || tab === 'outbox') && (
            <div className="relative min-w-[220px] flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder={tab === 'agents' ? 'Find an agent' : 'Search subject, booking or address'}
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
            </div>
          )}

          <div className="ml-auto flex flex-wrap gap-2">
            {tab === 'templates' && canManage && (
              <>
                <button onClick={() => act('/api/mailbox/templates/install-starters', { method: 'POST' })}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  <Sparkles className="h-3.5 w-3.5 text-brand-500" /> Install built-in templates
                </button>
                <button onClick={() => setTemplateEditor(BLANK_TEMPLATE)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white hover:bg-brand-600">
                  <Plus className="h-3.5 w-3.5" /> New template
                </button>
              </>
            )}
            {tab === 'agents' && canManage && (
              <button onClick={() => setAgentDrawer(BLANK_AGENT)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white hover:bg-brand-600">
                <Plus className="h-3.5 w-3.5" /> Add agent
              </button>
            )}
            {tab === 'outbox' && (
              <button onClick={() => act('/api/mailbox/threads', { method: 'POST' })} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <RefreshCw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} /> Check for replies
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-300" /></div>
        ) : (
          <>
            {/* ── Templates ────────────────────────────────────────────── */}
            {tab === 'templates' && (
              templates.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No templates yet"
                  note="A template is a subject and a message with the booking's details filled in automatically. Install the built-in set to get five ready to use, then edit them to sound like your desk."
                  action={canManage && (
                    <button onClick={() => act('/api/mailbox/templates/install-starters', { method: 'POST' })}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white hover:bg-brand-600">
                      <Sparkles className="h-3.5 w-3.5" /> Install built-in templates
                    </button>
                  )}
                />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {templates.map(t => (
                    <div key={t.id} className={cn(
                      'group rounded-2xl border bg-white p-4 shadow-card transition-all hover:shadow-card-hover',
                      t.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60',
                    )}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-900">{t.name}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-slate-400">{t.code}</p>
                        </div>
                        <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                          {t.category}
                        </span>
                      </div>

                      {t.description && (
                        <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-slate-500">{t.description}</p>
                      )}

                      <p className="mt-2 truncate rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                        {t.subject}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                        {t.attachPdf && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700">
                            <Paperclip className="h-2.5 w-2.5" /> PDF
                          </span>
                        )}
                        <span className={cn('rounded px-1.5 py-0.5 font-bold',
                          t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                          {t.isActive ? 'Active' : 'Hidden'}
                        </span>
                        {asList(t.ccEmails).length > 0 && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-500">
                            +{asList(t.ccEmails).length} cc
                          </span>
                        )}
                      </div>

                      {canManage && (
                        <div className="mt-3 flex gap-1.5 border-t border-slate-100 pt-2.5">
                          <button
                            onClick={() => setTemplateEditor({
                              id: t.id, code: t.code, name: t.name, description: t.description,
                              category: t.category, audience: t.audience, subject: t.subject,
                              bodyHtml: t.bodyHtml, ccEmails: asList(t.ccEmails),
                              attachPdf: t.attachPdf, isActive: t.isActive, sortOrder: t.sortOrder,
                            })}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                            <Pencil className="h-3 w-3" /> Edit
                          </button>
                          <button
                            onClick={() => act(`/api/mailbox/templates/${t.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ isActive: !t.isActive }),
                            })}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                            {t.isActive ? 'Hide' : 'Show'}
                          </button>
                          <button
                            onClick={() => {
                              if (!window.confirm(`Delete "${t.name}"? If it has been used, it is hidden instead so the sent mail stays readable.`)) return
                              act(`/api/mailbox/templates/${t.id}`, { method: 'DELETE' })
                            }}
                            className="ml-auto rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ── Agents ───────────────────────────────────────────────── */}
            {tab === 'agents' && (
              <>
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5">
                  <p className="text-[11px] leading-relaxed text-blue-800">
                    A booking stores its operator as free text, so the same agent arrives spelled several
                    ways. Adding them here turns that string into real contacts — the compose window then
                    fills in the To and Cc lines by itself and says how it matched.
                  </p>
                </div>

                {filteredAgents.length === 0 ? (
                  <EmptyState icon={Building2} title={agents.length ? 'No agent matches that' : 'No agents yet'}
                    note={agents.length ? 'Try a different search.' : "Add the operators you write to most. Each one can carry several addresses and the spellings its name arrives in."}
                    action={canManage && agents.length === 0 && (
                      <button onClick={() => setAgentDrawer(BLANK_AGENT)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2 text-xs font-bold text-white hover:bg-brand-600">
                        <Plus className="h-3.5 w-3.5" /> Add the first agent
                      </button>
                    )} />
                ) : (
                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          {['Agent', 'Primary email', 'Also copied', 'Matches on', 'Mails', ''].map(h => (
                            <th key={h} className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredAgents.map(a => (
                          <tr key={a.id} className={cn('hover:bg-slate-50/60', !a.isActive && 'opacity-55')}>
                            <td className="px-4 py-2.5">
                              <p className="text-sm font-bold text-slate-900">{a.name}</p>
                              {a.company && <p className="text-[11px] text-slate-400">{a.company}</p>}
                              {!a.isActive && <span className="mt-0.5 inline-block rounded bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500">Inactive</span>}
                            </td>
                            <td className="px-4 py-2.5 text-xs text-slate-600">{a.primaryEmail}</td>
                            <td className="px-4 py-2.5">
                              {asList(a.ccEmails).length === 0
                                ? <span className="text-xs text-slate-300">—</span>
                                : <div className="flex flex-wrap gap-1">
                                    {asList(a.ccEmails).slice(0, 2).map(e => (
                                      <span key={e} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{e}</span>
                                    ))}
                                    {asList(a.ccEmails).length > 2 && (
                                      <span className="text-[10px] font-semibold text-slate-400">+{asList(a.ccEmails).length - 2}</span>
                                    )}
                                  </div>}
                            </td>
                            <td className="px-4 py-2.5">
                              {asList(a.matchKeys).length === 0
                                ? <span className="text-xs text-slate-300">name only</span>
                                : <div className="flex flex-wrap gap-1">
                                    {asList(a.matchKeys).slice(0, 3).map(k => (
                                      <span key={k} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{k}</span>
                                    ))}
                                  </div>}
                            </td>
                            <td className="px-4 py-2.5 text-xs font-bold text-slate-500">{a.threadCount ?? 0}</td>
                            <td className="px-4 py-2.5 text-right">
                              {canManage && (
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => setAgentDrawer({
                                    id: a.id, name: a.name, company: a.company ?? '',
                                    primaryEmail: a.primaryEmail, ccEmails: asList(a.ccEmails),
                                    matchKeys: asList(a.matchKeys), country: a.country ?? '',
                                    phone: a.phone ?? '', notes: a.notes ?? '', isActive: a.isActive,
                                  })} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => {
                                    if (!window.confirm(`Remove ${a.name}? If they have mail on file they are deactivated instead.`)) return
                                    act(`/api/mailbox/agents/${a.id}`, { method: 'DELETE' })
                                  }} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── Internal team ────────────────────────────────────────── */}
            {tab === 'internal' && (
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2 space-y-3">
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-2.5">
                    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-emerald-900">
                      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        Anyone marked <strong>Always copy</strong> is added to the Cc of every Mail Box send.
                        The compose window shows them as locked chips, and the server re-adds them on the way
                        out — so the internal copy cannot be dropped by accident.
                      </span>
                    </p>
                  </div>

                  {internal.length === 0 ? (
                    <EmptyState icon={Users} title="Nobody on the internal list"
                      note="Add the Aahaas addresses that should see every mail going out to an agent." />
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50">
                            {['Name', 'Email', 'Team', 'Always copy', ''].map(h => (
                              <th key={h} className="px-4 py-2.5 text-left text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {internal.map(r => (
                            <tr key={r.id} className={cn('hover:bg-slate-50/60', !r.isActive && 'opacity-55')}>
                              <td className="px-4 py-2.5 text-sm font-bold text-slate-900">{r.name}</td>
                              <td className="px-4 py-2.5 text-xs text-slate-600">{r.email}</td>
                              <td className="px-4 py-2.5 text-xs text-slate-500">{r.team || '—'}</td>
                              <td className="px-4 py-2.5">
                                <button
                                  disabled={!canManage || busy}
                                  onClick={() => act(`/api/mailbox/internal/${r.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ alwaysCc: !r.alwaysCc }),
                                  })}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold transition-colors',
                                    r.alwaysCc ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                                    !canManage && 'cursor-default',
                                  )}>
                                  {r.alwaysCc ? <><Check className="h-3 w-3" /> Always</> : 'Suggested only'}
                                </button>
                              </td>
                              <td className="px-4 py-2.5 text-right">
                                {canManage && (
                                  <button onClick={() => {
                                    if (!window.confirm(`Remove ${r.name} from the internal list?`)) return
                                    act(`/api/mailbox/internal/${r.id}`, { method: 'DELETE' })
                                  }} className="rounded-lg p-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {canManage && (
                  <div className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
                    <p className="text-sm font-bold text-slate-900">Add a team member</p>
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <label className="form-label">Name</label>
                        <input value={newInternal.name} onChange={e => setNewInternal(s => ({ ...s, name: e.target.value }))}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                      </div>
                      <div>
                        <label className="form-label">Email</label>
                        <input value={newInternal.email} onChange={e => setNewInternal(s => ({ ...s, email: e.target.value }))}
                          placeholder="name@aahaas.com"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                      </div>
                      <div>
                        <label className="form-label">Team</label>
                        <input value={newInternal.team} onChange={e => setNewInternal(s => ({ ...s, team: e.target.value }))}
                          placeholder="Operations"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                      </div>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={newInternal.alwaysCc}
                          onChange={e => setNewInternal(s => ({ ...s, alwaysCc: e.target.checked }))}
                          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                        <span className="text-xs font-semibold text-slate-600">Copy on every mail</span>
                      </label>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          const ok = await act('/api/mailbox/internal', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(newInternal),
                          })
                          if (ok) setNewInternal({ name: '', email: '', team: '', alwaysCc: true })
                        }}
                        className="w-full rounded-xl bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50">
                        Add to internal list
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Outbox ───────────────────────────────────────────────── */}
            {tab === 'outbox' && (
              filteredThreads.length === 0 ? (
                <EmptyState icon={Inbox} title={threads.length ? 'Nothing matches that search' : 'No mail sent yet'}
                  note={threads.length ? 'Try a different subject, booking reference or address.' : 'Open a booking and press Mail Box to send the first one. Everything sent lands here, together with the replies.'} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-5">
                  <div className="lg:col-span-2 space-y-1.5 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
                    {filteredThreads.map(t => (
                      <button key={t.id} onClick={() => openThreadDetail(t.id)}
                        className={cn(
                          'w-full rounded-xl border bg-white p-3 text-left shadow-card transition-all hover:shadow-card-hover',
                          openThread?.id === t.id ? 'border-brand-300 ring-1 ring-brand-200' : 'border-slate-200',
                        )}>
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">{t.subject}</p>
                          {t.unreadReplies > 0 && (
                            <span className="shrink-0 rounded-full bg-rose-500 px-1.5 text-[10px] font-extrabold text-white">
                              {t.unreadReplies}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">To {t.toAddresses}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                          {t.bookingRef && (
                            <span className="rounded bg-slate-900 px-1.5 py-px font-mono font-bold text-white">{t.bookingRef}</span>
                          )}
                          <span className={cn('rounded px-1.5 py-px font-bold',
                            t.status === 'FAILED' ? 'bg-rose-100 text-rose-700'
                              : t.status === 'REPLIED' ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-slate-100 text-slate-600')}>
                            {t.status === 'REPLIED' ? `${t.replyCount} repl${t.replyCount === 1 ? 'y' : 'ies'}` : t.status}
                          </span>
                          {t.template?.name && <span className="text-slate-400">{t.template.name}</span>}
                          <span className="ml-auto text-slate-400">{formatDateTime(t.lastMessageAt)}</span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="lg:col-span-3">
                    {!openThread ? (
                      <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white text-center">
                        <CornerUpLeft className="h-8 w-8 text-slate-200" />
                        <p className="mt-2 text-sm font-bold text-slate-600">Pick a mail to read it</p>
                        <p className="mt-1 max-w-xs text-xs text-slate-400">
                          Opening one checks the mailbox for new replies on that conversation.
                        </p>
                      </div>
                    ) : threadLoading && !openThread.messages ? (
                      <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white">
                        <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                        <div className="border-b border-slate-100 p-4">
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-extrabold text-slate-900">{openThread.subject}</h3>
                              <p className="mt-0.5 text-[11px] text-slate-500">To {openThread.toAddresses}</p>
                              {openThread.ccAddresses && (
                                <p className="text-[11px] text-slate-400">Cc {openThread.ccAddresses}</p>
                              )}
                              <p className="mt-1 text-[11px] text-slate-400">
                                Sent by {openThread.sentByName ?? 'Unknown'}
                                {openThread.template?.name ? ` · ${openThread.template.name}` : ''}
                              </p>
                            </div>
                            {openThread.bookingRef && (
                              <a href={`/dashboard/bookings/${openThread.bookingRef}`} target="_blank" rel="noreferrer"
                                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                                {openThread.bookingRef} <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {openThread.status === 'FAILED' && openThread.error && (
                            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5">
                              <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-rose-500" />
                              <p className="text-[11px] font-medium text-rose-700">{openThread.error}</p>
                            </div>
                          )}
                        </div>

                        <div className="max-h-[56vh] space-y-3 overflow-y-auto bg-slate-50 p-4">
                          {(openThread.messages ?? []).map((m: any) => {
                            const inbound = m.direction === 'IN'
                            return (
                              <div key={m.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                                <div className={cn('max-w-[90%] overflow-hidden rounded-2xl border shadow-sm',
                                  inbound ? 'border-slate-200 bg-white' : 'border-brand-200 bg-brand-50/60')}>
                                  <div className={cn('flex items-center gap-2 border-b px-3 py-1.5',
                                    inbound ? 'border-slate-100 bg-slate-50' : 'border-brand-100 bg-brand-50')}>
                                    <span className={cn('rounded px-1.5 py-px text-[10px] font-extrabold uppercase tracking-wider',
                                      inbound ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700')}>
                                      {inbound ? 'Reply' : 'Sent'}
                                    </span>
                                    <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">
                                      {m.fromName || m.fromAddress}
                                    </span>
                                    {m.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                                    <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                                      <Clock className="h-2.5 w-2.5" /> {formatDateTime(m.sentAt)}
                                    </span>
                                  </div>
                                  <div className="max-h-[380px] overflow-y-auto bg-white px-3 py-2">
                                    {m.bodyHtml
                                      ? <div className="text-sm text-slate-700 [&_img]:max-w-full [&_table]:max-w-full"
                                          dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                                      : <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{m.bodyText}</pre>}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </div>

      <TemplateEditor
        open={templateEditor !== null}
        initial={templateEditor ?? BLANK_TEMPLATE}
        onClose={() => setTemplateEditor(null)}
        onSaved={load}
      />
      <AgentDrawer
        open={agentDrawer !== null}
        initial={agentDrawer ?? BLANK_AGENT}
        onClose={() => setAgentDrawer(null)}
        onSaved={load}
      />
    </div>
  )
}
