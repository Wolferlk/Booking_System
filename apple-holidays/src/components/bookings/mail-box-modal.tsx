'use client'

/**
 * Mail Box — the compose window that opens from a booking.
 *
 * Deliberately not built on the shared `<Modal>`: this needs three columns and a
 * tab strip, and the shared dialog is a single scrolling body sized for forms.
 * What it does keep is the shared dialog's behaviour — escape to close, a
 * backdrop click, and a locked body scroll — so it feels like the rest of the
 * system rather than a different application bolted on.
 *
 * The two tabs are the whole feature: **Compose** writes to the agent, and
 * **Conversations** reads what came back. They sit together because the question
 * "what did we already tell them?" is asked while writing the next mail, not on
 * a separate screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Mail, Send, Loader2, Users, ShieldCheck, Sparkles, Search,
  FileText, Paperclip, Plus, RefreshCw, CornerUpLeft, ChevronRight,
  AlertTriangle, Building2, Eye, Code2, Inbox, Check, Clock, Settings2,
} from 'lucide-react'
import Link from 'next/link'
import { cn, formatDateTime } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Types mirroring /api/mailbox/compose ────────────────────────────────────

interface ComposeTemplate {
  id: string
  code: string
  name: string
  description: string | null
  category: string
  audience: string
  attachPdf: boolean
  ccEmails: string[]
  subject: string
  bodyHtml: string
}

interface ComposeAgent {
  id: string
  name: string
  company: string | null
  primaryEmail: string
  ccEmails: unknown
}

interface ThreadSummary {
  id: string
  subject: string
  toAddresses: string
  ccAddresses: string
  status: string
  replyCount: number
  unreadReplies: number
  lastMessageAt: string
  createdAt: string
  sentByName: string | null
  agentName: string | null
  templateName: string | null
  messageCount: number
}

interface ThreadMessage {
  id: string
  direction: string
  fromAddress: string
  fromName: string
  toAddresses: string
  ccAddresses: string
  subject: string
  bodyHtml: string
  bodyText: string
  hasAttachments: boolean
  sentAt: string
}

interface ComposePayload {
  booking: Record<string, any>
  detection: {
    reason: 'email' | 'exact' | 'alias' | 'partial' | 'none'
    agent: ComposeAgent | null
    candidates: ComposeAgent[]
    fromDirectory: boolean
  }
  suggestedTo: string[]
  suggestedCc: string[]
  internal: { id: string; name: string; email: string; team: string | null; alwaysCc: boolean }[]
  lockedCc: string[]
  testMode: { enabled: boolean; to: string; cc: string }
  templates: ComposeTemplate[]
  threads: ThreadSummary[]
}

/** Plain-English account of how the agent was identified — shown, never hidden. */
const DETECTION_COPY: Record<ComposePayload['detection']['reason'], { label: string; tone: string; note: string }> = {
  email:   { label: 'Matched on email',   tone: 'emerald', note: "The booking's agent address is in the directory." },
  exact:   { label: 'Matched on name',    tone: 'emerald', note: 'The agent name matches the directory exactly.' },
  alias:   { label: 'Matched on alias',   tone: 'emerald', note: 'Matched through a saved spelling variant.' },
  partial: { label: 'Close match only',   tone: 'amber',   note: 'The names are similar but not identical — please confirm.' },
  none:    { label: 'No directory match', tone: 'slate',   note: "Using the booking's own agent email. Add them to the directory to save the contacts." },
}

// ─── Recipient chips ─────────────────────────────────────────────────────────

function ChipField({
  label, values, onChange, locked = [], placeholder, suggestions = [],
}: {
  label: string
  values: string[]
  onChange: (v: string[]) => void
  locked?: string[]
  placeholder: string
  suggestions?: { email: string; name: string }[]
}) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  const commit = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean)
    const next = [...values]
    for (const p of parts) {
      if (!p.includes('@')) continue
      if (next.some(v => v.toLowerCase() === p.toLowerCase())) continue
      if (locked.some(v => v.toLowerCase() === p.toLowerCase())) continue
      next.push(p)
    }
    onChange(next)
    setDraft('')
  }

  const unused = suggestions.filter(s =>
    !values.some(v => v.toLowerCase() === s.email.toLowerCase()) &&
    !locked.some(v => v.toLowerCase() === s.email.toLowerCase()))

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</label>
        {unused.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-0.5"
          >
            <Plus className="w-3 h-3" /> Add from team
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 transition-all">
        {locked.map(email => (
          <span
            key={`locked-${email}`}
            title="Always copied — managed in Mail Box Settings"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 border border-slate-200 pl-2 pr-1.5 py-0.5 text-xs font-medium text-slate-600"
          >
            <ShieldCheck className="w-3 h-3 text-slate-400" />
            {email}
          </span>
        ))}
        {values.map(email => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-50 border border-brand-200 pl-2 pr-1 py-0.5 text-xs font-medium text-brand-700"
          >
            {email}
            <button
              type="button"
              onClick={() => onChange(values.filter(v => v !== email))}
              className="rounded p-0.5 hover:bg-brand-100 text-brand-400 hover:text-brand-700"
              aria-label={`Remove ${email}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') {
              if (draft.trim()) { e.preventDefault(); commit(draft) }
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={values.length || locked.length ? '' : placeholder}
          className="flex-1 min-w-[140px] border-0 p-0 text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-0"
        />
      </div>

      {open && unused.length > 0 && (
        <div className="absolute z-20 right-0 mt-1 w-64 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-1">
          {unused.map(s => (
            <button
              key={s.email}
              type="button"
              onClick={() => { commit(s.email); setOpen(false) }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50"
            >
              <p className="text-xs font-semibold text-slate-800 truncate">{s.name}</p>
              <p className="text-[11px] text-slate-400 truncate">{s.email}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Rich body editor ────────────────────────────────────────────────────────

/**
 * A `contentEditable` surface over the template's own HTML.
 *
 * Templates are HTML — tables, banners, brand chrome — so a plain textarea would
 * force the desk to edit markup to change a sentence. The editor is re-seeded
 * only when `seedKey` changes (a different template), never on keystroke, or
 * React would rewrite the DOM under the caret on every character typed.
 */
function BodyEditor({
  html, seedKey, onChange, mode,
}: {
  html: string
  seedKey: string
  onChange: (html: string) => void
  mode: 'rich' | 'html' | 'preview'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const seeded = useRef<string>('')

  useEffect(() => {
    if (mode !== 'rich') return
    if (ref.current && seeded.current !== seedKey) {
      ref.current.innerHTML = html
      seeded.current = seedKey
    }
  }, [html, seedKey, mode])

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
    if (ref.current) onChange(ref.current.innerHTML)
  }

  if (mode === 'preview') {
    return (
      <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
        <div className="mx-auto my-0 max-w-full" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  if (mode === 'html') {
    return (
      <textarea
        value={html}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        className="flex-1 w-full resize-none rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-emerald-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-slate-200 overflow-hidden focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 transition-all">
      <div className="flex items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1">
        {([
          ['bold', 'B', 'font-black'],
          ['italic', 'I', 'italic font-serif'],
          ['underline', 'U', 'underline'],
        ] as const).map(([cmd, glyph, cls]) => (
          <button
            key={cmd}
            type="button"
            onMouseDown={e => { e.preventDefault(); exec(cmd) }}
            className={cn('w-7 h-7 rounded-md text-xs text-slate-600 hover:bg-slate-200', cls)}
          >{glyph}</button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }}
          className="px-2 h-7 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-200">List</button>
        <button type="button" onMouseDown={e => {
          e.preventDefault()
          const url = window.prompt('Link URL')
          if (url) exec('createLink', url)
        }} className="px-2 h-7 rounded-md text-[11px] font-semibold text-slate-600 hover:bg-slate-200">Link</button>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('removeFormat') }}
          className="px-2 h-7 rounded-md text-[11px] font-semibold text-slate-500 hover:bg-slate-200">Clear</button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={e => onChange((e.target as HTMLDivElement).innerHTML)}
        className="flex-1 overflow-y-auto bg-white p-3 text-sm text-slate-800 focus:outline-none [&_table]:w-full [&_img]:max-w-full"
      />
    </div>
  )
}

// ─── The modal ───────────────────────────────────────────────────────────────

export default function MailBoxModal({
  open, onClose, bookingRef, canManage,
}: {
  open: boolean
  onClose: () => void
  bookingRef: string
  canManage: boolean
}) {
  const [tab, setTab] = useState<'compose' | 'threads'>('compose')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ComposePayload | null>(null)
  const [sending, setSending] = useState(false)

  // Compose state
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [to, setTo] = useState<string[]>([])
  const [cc, setCc] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [seedKey, setSeedKey] = useState('blank')
  const [attachPdf, setAttachPdf] = useState(false)
  const [editorMode, setEditorMode] = useState<'rich' | 'html' | 'preview'>('rich')
  const [templateQuery, setTemplateQuery] = useState('')
  const [agentOverride, setAgentOverride] = useState<string | null>(null)

  // Conversations state
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [openThreadId, setOpenThreadId] = useState<string | null>(null)
  const [threadDetail, setThreadDetail] = useState<{ thread: any } | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/mailbox/compose?ref=${encodeURIComponent(bookingRef)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const payload = json.data as ComposePayload
      setData(payload)
      setThreads(payload.threads)
      setTo(payload.suggestedTo)
      setCc(payload.suggestedCc)
      setAgentOverride(payload.detection.agent?.id ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open Mail Box')
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  useEffect(() => { if (open) load() }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  const templates = data?.templates ?? []
  const lockedCc = data?.lockedCc ?? []

  const grouped = useMemo(() => {
    const q = templateQuery.trim().toLowerCase()
    const list = q
      ? templates.filter(t =>
          t.name.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q))
      : templates
    const map = new Map<string, ComposeTemplate[]>()
    for (const t of list) {
      const arr = map.get(t.category) ?? []
      arr.push(t)
      map.set(t.category, arr)
    }
    return Array.from(map.entries())
  }, [templates, templateQuery])

  function pickTemplate(t: ComposeTemplate | null) {
    if (!t) {
      setTemplateId(null)
      setSubject(`Booking ${bookingRef}`)
      setBody('<p></p>')
      setSeedKey(`blank-${Date.now()}`)
      setAttachPdf(false)
      return
    }
    setTemplateId(t.id)
    setSubject(t.subject)
    setBody(t.bodyHtml)
    setSeedKey(t.id)
    setAttachPdf(t.attachPdf)
    if (t.ccEmails?.length) {
      setCc(prev => {
        const next = [...prev]
        for (const e of t.ccEmails) {
          if (!next.some(v => v.toLowerCase() === e.toLowerCase())) next.push(e)
        }
        return next
      })
    }
    setEditorMode('rich')
  }

  function applyAgent(agentId: string | null) {
    setAgentOverride(agentId)
    if (!data) return
    const all = [data.detection.agent, ...data.detection.candidates].filter(Boolean) as ComposeAgent[]
    const agent = all.find(a => a.id === agentId)
    if (!agent) return
    const extra = Array.isArray(agent.ccEmails) ? (agent.ccEmails as unknown[]).map(String) : []
    setTo([agent.primaryEmail])
    setCc(prev => {
      const next = [...prev]
      for (const e of extra) if (!next.some(v => v.toLowerCase() === e.toLowerCase())) next.push(e)
      return next
    })
    toast.success(`Recipients set from ${agent.name}`)
  }

  async function send() {
    if (to.length === 0) { toast.error('Add at least one recipient'); return }
    if (!subject.trim()) { toast.error('Add a subject'); return }
    setSending(true)
    try {
      const res = await fetch('/api/mailbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingRef, templateId, agentId: agentOverride,
          to, cc, subject, bodyHtml: body, attachPdf,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Sent')
      await load()
      setTab('threads')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const openThread = useCallback(async (id: string) => {
    setOpenThreadId(id)
    setThreadLoading(true)
    setThreadDetail(null)
    try {
      const res = await fetch(`/api/mailbox/threads/${id}?sync=true`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setThreadDetail(json.data)
      if (json.data.syncError) toast.error(`Replies may be out of date: ${json.data.syncError}`)
      await fetch(`/api/mailbox/threads/${id}`, { method: 'PATCH' })
      setThreads(prev => prev.map(t => t.id === id ? { ...t, unreadReplies: 0 } : t))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open the conversation')
    } finally {
      setThreadLoading(false)
    }
  }, [])

  async function refreshThread() {
    if (!openThreadId) return
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/mailbox/threads/${openThreadId}`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setThreadDetail({ thread: json.data.thread })
      toast.success(json.message ?? 'Refreshed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Refresh failed')
    } finally {
      setThreadLoading(false)
    }
  }

  if (!open) return null

  const detection = data?.detection
  const copy = detection ? DETECTION_COPY[detection.reason] : null
  const unreadTotal = threads.reduce((s, t) => s + t.unreadReplies, 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative flex w-full max-w-6xl h-[92vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="relative shrink-0 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <Mail className="h-4.5 w-4.5 text-brand-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold tracking-tight text-white leading-none">Mail Box</h2>
              <p className="mt-1 text-[11px] text-white/50">
                Booking <span className="font-mono font-semibold text-white/80">{bookingRef}</span>
                {data?.booking?.agent ? <> · {data.booking.agent}</> : null}
              </p>
            </div>

            <div className="ml-4 flex items-center gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10">
              {([
                ['compose', 'Compose', Send],
                ['threads', 'Conversations', Inbox],
              ] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                    tab === key ? 'bg-white text-slate-900 shadow' : 'text-white/60 hover:text-white hover:bg-white/10',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {key === 'threads' && threads.length > 0 && (
                    <span className={cn(
                      'ml-0.5 rounded-full px-1.5 py-px text-[10px] font-extrabold',
                      unreadTotal > 0 ? 'bg-rose-500 text-white'
                        : tab === key ? 'bg-slate-200 text-slate-600' : 'bg-white/15 text-white/70',
                    )}>
                      {unreadTotal > 0 ? unreadTotal : threads.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {canManage && (
                <Link
                  href="/dashboard/admin/mail-box"
                  target="_blank"
                  className="hidden sm:flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white/60 hover:text-white hover:bg-white/10"
                >
                  <Settings2 className="h-3.5 w-3.5" /> Settings
                </Link>
              )}
              <button onClick={onClose} className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {data?.testMode.enabled && (
          <div className="shrink-0 flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <p className="text-[11px] font-semibold text-amber-800">
              Test mode is ON — this will go to {data.testMode.to}, not the agent.
              Turn it off in Admin → Settings to send for real.
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
          </div>
        ) : tab === 'compose' ? (
          /* ── Compose ──────────────────────────────────────────────────── */
          <div className="flex min-h-0 flex-1">

            {/* Template rail */}
            <aside className="hidden md:flex w-56 shrink-0 flex-col border-r border-slate-100 bg-slate-50/60">
              <div className="p-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
                  <input
                    value={templateQuery}
                    onChange={e => setTemplateQuery(e.target.value)}
                    placeholder="Find a template"
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <button
                  onClick={() => pickTemplate(null)}
                  className={cn(
                    'mb-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all',
                    templateId === null
                      ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200'
                      : 'border-slate-200 bg-white hover:border-slate-300',
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                  <span className="text-xs font-bold text-slate-800">Blank message</span>
                </button>

                {grouped.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center">
                    <p className="text-[11px] text-slate-400">
                      {templates.length === 0 ? 'No templates yet.' : 'Nothing matches.'}
                    </p>
                    {canManage && templates.length === 0 && (
                      <Link href="/dashboard/admin/mail-box" target="_blank"
                        className="mt-1 inline-block text-[11px] font-bold text-brand-600 hover:underline">
                        Create one →
                      </Link>
                    )}
                  </div>
                )}

                {grouped.map(([category, items]) => (
                  <div key={category} className="mb-3">
                    <p className="mb-1 px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{category}</p>
                    <div className="space-y-1">
                      {items.map(t => (
                        <button
                          key={t.id}
                          onClick={() => pickTemplate(t)}
                          className={cn(
                            'w-full rounded-lg border px-2.5 py-1.5 text-left transition-all',
                            templateId === t.id
                              ? 'border-brand-300 bg-brand-50 ring-1 ring-brand-200'
                              : 'border-transparent bg-white hover:border-slate-200',
                          )}
                        >
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3 w-3 shrink-0 text-slate-400" />
                            <span className="truncate text-xs font-semibold text-slate-800">{t.name}</span>
                            {t.attachPdf && <Paperclip className="ml-auto h-3 w-3 shrink-0 text-slate-400" />}
                          </div>
                          {t.description && (
                            <p className="mt-0.5 line-clamp-2 pl-4.5 text-[10px] leading-snug text-slate-400">{t.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            {/* Composer */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="shrink-0 space-y-2.5 border-b border-slate-100 p-4">
                <ChipField
                  label="To"
                  values={to}
                  onChange={setTo}
                  placeholder="agent@example.com"
                  suggestions={(data?.internal ?? []).map(r => ({ email: r.email, name: r.name }))}
                />
                <ChipField
                  label="Cc"
                  values={cc}
                  onChange={setCc}
                  locked={lockedCc}
                  placeholder="Add anyone else"
                  suggestions={(data?.internal ?? []).filter(r => !r.alwaysCc).map(r => ({ email: r.email, name: r.name }))}
                />
                <div>
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">Subject</label>
                  <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="What is this about?"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Message</label>
                  <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                    {([
                      ['rich', 'Edit', FileText],
                      ['preview', 'Preview', Eye],
                      ['html', 'HTML', Code2],
                    ] as const).map(([m, label, Icon]) => (
                      <button
                        key={m}
                        onClick={() => setEditorMode(m)}
                        className={cn(
                          'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all',
                          editorMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                        )}
                      >
                        <Icon className="h-3 w-3" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <BodyEditor html={body} seedKey={seedKey} onChange={setBody} mode={editorMode} />
              </div>

              <div className="shrink-0 flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={attachPdf}
                    onChange={e => setAttachPdf(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400"
                  />
                  <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" /> Attach booking PDF
                  </span>
                </label>

                <p className="hidden sm:block text-[11px] text-slate-400">
                  {to.length + cc.length + lockedCc.length} recipient{to.length + cc.length + lockedCc.length === 1 ? '' : 's'}
                </p>

                <button
                  onClick={send}
                  disabled={sending || to.length === 0}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-brand-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sending ? 'Sending…' : 'Send mail'}
                </button>
              </div>
            </div>

            {/* Context rail */}
            <aside className="hidden lg:flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-slate-100 bg-slate-50/60 p-3">
              <div className={cn(
                'rounded-xl border p-3',
                copy?.tone === 'emerald' ? 'border-emerald-200 bg-emerald-50'
                  : copy?.tone === 'amber' ? 'border-amber-200 bg-amber-50'
                    : 'border-slate-200 bg-white',
              )}>
                <div className="flex items-center gap-1.5">
                  <Building2 className={cn('h-3.5 w-3.5',
                    copy?.tone === 'emerald' ? 'text-emerald-600'
                      : copy?.tone === 'amber' ? 'text-amber-600' : 'text-slate-400')} />
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">Agent detection</p>
                </div>
                <p className="mt-1.5 text-sm font-bold text-slate-900">
                  {detection?.agent?.name ?? data?.booking?.agent ?? 'Unknown agent'}
                </p>
                {detection?.agent?.company && (
                  <p className="text-[11px] text-slate-500">{detection.agent.company}</p>
                )}
                <p className={cn('mt-1.5 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                  copy?.tone === 'emerald' ? 'bg-emerald-100 text-emerald-700'
                    : copy?.tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600')}>
                  {copy?.label}
                </p>
                <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{copy?.note}</p>

                {(detection?.candidates.length ?? 0) > 0 && (
                  <div className="mt-2.5 space-y-1 border-t border-black/5 pt-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Use instead</p>
                    {detection!.candidates.map(c => (
                      <button
                        key={c.id}
                        onClick={() => applyAgent(c.id)}
                        className={cn(
                          'flex w-full items-center gap-1 rounded-lg border px-2 py-1 text-left text-[11px] transition-all',
                          agentOverride === c.id
                            ? 'border-brand-300 bg-brand-50 font-bold text-brand-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {agentOverride === c.id
                          ? <Check className="h-3 w-3 shrink-0" />
                          : <ChevronRight className="h-3 w-3 shrink-0 text-slate-300" />}
                      </button>
                    ))}
                  </div>
                )}

                {canManage && detection?.reason === 'none' && (
                  <Link href="/dashboard/admin/mail-box?tab=agents" target="_blank"
                    className="mt-2 inline-block text-[11px] font-bold text-brand-600 hover:underline">
                    Add to the directory →
                  </Link>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">Internal copy</p>
                </div>
                {lockedCc.length === 0 ? (
                  <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
                    Nobody is set to receive an automatic copy.
                    {canManage && (
                      <>
                        {' '}
                        <Link href="/dashboard/admin/mail-box?tab=internal" target="_blank"
                          className="font-bold text-brand-600 hover:underline">Add the team →</Link>
                      </>
                    )}
                  </p>
                ) : (
                  <>
                    <p className="mt-1 text-[11px] text-slate-400">Copied on every send.</p>
                    <div className="mt-1.5 space-y-1">
                      {(data?.internal ?? []).filter(r => r.alwaysCc).map(r => (
                        <div key={r.id} className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-500" />
                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-semibold text-slate-700">{r.name}</p>
                            <p className="truncate text-[10px] text-slate-400">{r.email}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">This booking</p>
                <dl className="mt-1.5 space-y-1 text-[11px]">
                  {([
                    ['Lead guest', data?.booking?.leadPassenger],
                    ['Passengers', data?.booking?.paxSummary],
                    ['File handler', data?.booking?.fileHandler],
                    ['Status', data?.booking?.status],
                  ] as [string, string | undefined][]).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2">
                      <dt className="shrink-0 text-slate-400">{k}</dt>
                      <dd className="min-w-0 truncate text-right font-semibold text-slate-700">{v || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </aside>
          </div>
        ) : (
          /* ── Conversations ────────────────────────────────────────────── */
          <div className="flex min-h-0 flex-1">
            <aside className="flex w-72 shrink-0 flex-col border-r border-slate-100 bg-slate-50/60">
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                  {threads.length} sent
                </p>
                <button onClick={load} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600">
                  <RefreshCw className="h-3 w-3" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {threads.length === 0 && (
                  <div className="mt-8 px-3 text-center">
                    <Inbox className="mx-auto h-8 w-8 text-slate-200" />
                    <p className="mt-2 text-xs font-semibold text-slate-500">No mail yet</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      Anything you send from Compose appears here, with the replies.
                    </p>
                  </div>
                )}
                {threads.map(t => (
                  <button
                    key={t.id}
                    onClick={() => openThread(t.id)}
                    className={cn(
                      'mb-1 w-full rounded-lg border px-2.5 py-2 text-left transition-all',
                      openThreadId === t.id
                        ? 'border-brand-300 bg-white ring-1 ring-brand-200'
                        : 'border-transparent bg-white/70 hover:border-slate-200',
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">{t.subject}</p>
                      {t.unreadReplies > 0 && (
                        <span className="shrink-0 rounded-full bg-rose-500 px-1.5 text-[10px] font-extrabold text-white">
                          {t.unreadReplies}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400">{t.toAddresses}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                      <span className={cn(
                        'rounded px-1 py-px font-bold',
                        t.status === 'FAILED' ? 'bg-rose-100 text-rose-700'
                          : t.status === 'REPLIED' ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600',
                      )}>
                        {t.status === 'REPLIED' ? `${t.replyCount} repl${t.replyCount === 1 ? 'y' : 'ies'}` : t.status}
                      </span>
                      <span className="text-slate-400">{formatDateTime(t.lastMessageAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              {!openThreadId ? (
                <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
                  <CornerUpLeft className="h-9 w-9 text-slate-200" />
                  <p className="mt-3 text-sm font-bold text-slate-600">Pick a mail to read it</p>
                  <p className="mt-1 max-w-xs text-xs text-slate-400">
                    Opening one checks the mailbox for new replies on that conversation.
                  </p>
                </div>
              ) : threadLoading && !threadDetail ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
                </div>
              ) : threadDetail?.thread ? (
                <>
                  <div className="shrink-0 border-b border-slate-100 px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-extrabold text-slate-900">{threadDetail.thread.subject}</h3>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">
                          To {threadDetail.thread.toAddresses}
                          {threadDetail.thread.ccAddresses ? ` · Cc ${threadDetail.thread.ccAddresses}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          Sent by {threadDetail.thread.sentByName ?? 'Unknown'}
                          {threadDetail.thread.templateName ? ` · ${threadDetail.thread.templateName}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={refreshThread}
                        disabled={threadLoading}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {threadLoading
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <RefreshCw className="h-3 w-3" />}
                        Check replies
                      </button>
                    </div>
                    {threadDetail.thread.status === 'FAILED' && threadDetail.thread.error && (
                      <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5">
                        <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-rose-500" />
                        <p className="text-[11px] font-medium text-rose-700">{threadDetail.thread.error}</p>
                      </div>
                    )}
                  </div>

                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
                    {(threadDetail.thread.messages as ThreadMessage[]).map(m => {
                      const inbound = m.direction === 'IN'
                      return (
                        <div key={m.id} className={cn('flex', inbound ? 'justify-start' : 'justify-end')}>
                          <div className={cn(
                            'max-w-[88%] overflow-hidden rounded-2xl border shadow-sm',
                            inbound ? 'border-slate-200 bg-white' : 'border-brand-200 bg-brand-50/60',
                          )}>
                            <div className={cn(
                              'flex items-center gap-2 border-b px-3 py-1.5',
                              inbound ? 'border-slate-100 bg-slate-50' : 'border-brand-100 bg-brand-50',
                            )}>
                              <span className={cn(
                                'rounded px-1.5 py-px text-[10px] font-extrabold uppercase tracking-wider',
                                inbound ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700',
                              )}>
                                {inbound ? 'Reply' : 'Sent'}
                              </span>
                              <span className="min-w-0 truncate text-[11px] font-semibold text-slate-700">
                                {m.fromName || m.fromAddress}
                              </span>
                              {m.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-slate-400" />}
                              <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-slate-400">
                                <Clock className="h-2.5 w-2.5" />
                                {formatDateTime(m.sentAt)}
                              </span>
                            </div>
                            <div className="max-h-[420px] overflow-y-auto bg-white px-3 py-2">
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

                  <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-2.5">
                    <button
                      onClick={() => {
                        setTab('compose')
                        setSubject(threadDetail.thread.subject.startsWith('Re:')
                          ? threadDetail.thread.subject
                          : `Re: ${threadDetail.thread.subject}`)
                        setBody('<p></p>')
                        setSeedKey(`reply-${Date.now()}`)
                        setTemplateId(null)
                        const first = String(threadDetail.thread.toAddresses ?? '')
                          .split(',').map(s => s.trim()).filter(Boolean)
                        if (first.length) setTo(first)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <CornerUpLeft className="h-3.5 w-3.5" /> Write a follow-up
                    </button>
                    <span className="ml-2 text-[11px] text-slate-400">
                      Starts a fresh mail to the same people, with the subject carried over.
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-xs text-slate-400">Could not load this conversation.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
