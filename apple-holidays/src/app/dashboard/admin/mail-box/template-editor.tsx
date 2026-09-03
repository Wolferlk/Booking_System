'use client'

/**
 * The template editor drawer.
 *
 * Split out of the settings page because it is the only screen here that is a
 * real document editor rather than a list of short fields — and because it owns
 * the token palette, which is the part of Mail Box an operator has to learn.
 *
 * The palette is not decoration: `{{arrivalDate}}` is unguessable, and a
 * template that silently renders an empty sentence is worse than one that
 * refuses to save. So every token is clickable, the live preview substitutes
 * example values, and anything unrecognised is called out under the body rather
 * than discovered later by an agent.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Save, Loader2, Eye, Code2, FileText, Braces, Paperclip, Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { TOKEN_CATALOGUE, inspectTokens, renderTemplate } from '@/lib/mailbox/tokens'

export interface EditableTemplate {
  id?: string
  code?: string
  name: string
  description: string | null
  category: string
  audience: string
  subject: string
  bodyHtml: string
  ccEmails: string[]
  attachPdf: boolean
  isActive: boolean
  sortOrder: number
}

export const BLANK_TEMPLATE: EditableTemplate = {
  name: '',
  description: '',
  category: 'Agent',
  audience: 'AGENT',
  subject: '',
  bodyHtml: '<p>Dear {{agentName}},</p>\n<p></p>\n<p>Kind regards,<br/>{{senderName}}</p>',
  ccEmails: [],
  attachPdf: false,
  isActive: true,
  sortOrder: 0,
}

const CATEGORIES = ['Agent', 'Operations', 'Accounts', 'Reservations', 'General']

/** Example values, so the preview reads like a real mail rather than a form. */
const EXAMPLE_TOKENS: Record<string, string> = Object.fromEntries(
  TOKEN_CATALOGUE.map(t => [t.token, t.example]),
)

export default function TemplateEditor({
  open, initial, onClose, onSaved,
}: {
  open: boolean
  initial: EditableTemplate
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<EditableTemplate>(initial)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'rich' | 'html' | 'preview'>('rich')
  const [tokenQuery, setTokenQuery] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const seeded = useRef<string>('')

  useEffect(() => {
    if (open) {
      setForm(initial)
      seeded.current = ''
      setMode('rich')
    }
  }, [open, initial])

  useEffect(() => {
    if (!open || mode !== 'rich') return
    const key = initial.id ?? 'new'
    if (editorRef.current && seeded.current !== key) {
      editorRef.current.innerHTML = form.bodyHtml
      seeded.current = key
    }
  }, [open, mode, initial.id, form.bodyHtml])

  const set = <K extends keyof EditableTemplate>(k: K, v: EditableTemplate[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  /**
   * Inserts a token at the caret when the caret is inside the body, and appends
   * to the subject when the subject was the last field touched. Tracking which
   * field is "live" avoids the alternative — a token that always lands in the
   * body, which is wrong half the time a subject line is being written.
   */
  const lastFocus = useRef<'subject' | 'body'>('body')
  const subjectRef = useRef<HTMLInputElement>(null)

  function insertToken(token: string) {
    const text = `{{${token}}}`
    if (lastFocus.current === 'subject') {
      const el = subjectRef.current
      const pos = el?.selectionStart ?? form.subject.length
      const next = form.subject.slice(0, pos) + text + form.subject.slice(pos)
      set('subject', next)
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(pos + text.length, pos + text.length)
      })
      return
    }
    if (mode === 'rich' && editorRef.current) {
      editorRef.current.focus()
      document.execCommand('insertText', false, text)
      set('bodyHtml', editorRef.current.innerHTML)
    } else {
      set('bodyHtml', form.bodyHtml + text)
    }
  }

  const tokens = useMemo(() => {
    const q = tokenQuery.trim().toLowerCase()
    const list = q
      ? TOKEN_CATALOGUE.filter(t => t.token.toLowerCase().includes(q) || t.label.toLowerCase().includes(q))
      : TOKEN_CATALOGUE
    const map = new Map<string, typeof TOKEN_CATALOGUE>()
    for (const t of list) {
      const arr = map.get(t.group) ?? []
      arr.push(t)
      map.set(t.group, arr)
    }
    return Array.from(map.entries())
  }, [tokenQuery])

  const unknown = useMemo(
    () => inspectTokens(`${form.subject} ${form.bodyHtml}`).unknown,
    [form.subject, form.bodyHtml],
  )

  async function save() {
    if (!form.name.trim())    { toast.error('Give the template a name'); return }
    if (!form.subject.trim()) { toast.error('Add a subject line'); return }
    if (!form.bodyHtml.trim()) { toast.error('The body is empty'); return }

    setSaving(true)
    try {
      const res = await fetch(
        form.id ? `/api/mailbox/templates/${form.id}` : '/api/mailbox/templates',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        },
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Saved')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-slide-up">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-3">
          <FileText className="h-4 w-4 text-brand-500" />
          <h2 className="text-base font-extrabold text-slate-900">
            {form.id ? 'Edit template' : 'New template'}
          </h2>
          {form.code && (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">{form.code}</span>
          )}
          <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Form + body */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 grid grid-cols-1 gap-3 border-b border-slate-100 p-4 sm:grid-cols-2">
              <div>
                <label className="form-label">Template name *</label>
                <input
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="Booking Update — Agent"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="form-label">Category</label>
                <select
                  value={form.category}
                  onChange={e => set('category', e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  {Array.from(new Set([form.category, ...CATEGORIES])).map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="form-label">What it is for</label>
                <input
                  value={form.description ?? ''}
                  onChange={e => set('description', e.target.value)}
                  placeholder="Shown under the name when picking a template"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="form-label">Subject *</label>
                <input
                  ref={subjectRef}
                  value={form.subject}
                  onFocus={() => { lastFocus.current = 'subject' }}
                  onChange={e => set('subject', e.target.value)}
                  placeholder="Booking Update — {{bookingRef}}"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-medium text-sm focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={form.attachPdf}
                    onChange={e => set('attachPdf', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                  <span className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" /> Attach the booking PDF by default
                  </span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" checked={form.isActive}
                    onChange={e => set('isActive', e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                  <span className="text-xs font-semibold text-slate-600">Available when composing</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Order</span>
                  <input
                    type="number"
                    value={form.sortOrder}
                    onChange={e => set('sortOrder', Number(e.target.value) || 0)}
                    className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  />
                </div>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Message body</label>
                <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                  {([
                    ['rich', 'Edit', FileText],
                    ['preview', 'Preview', Eye],
                    ['html', 'HTML', Code2],
                  ] as const).map(([m, label, Icon]) => (
                    <button
                      key={m}
                      onClick={() => {
                        if (mode === 'rich' && editorRef.current) set('bodyHtml', editorRef.current.innerHTML)
                        if (m === 'rich') seeded.current = ''
                        setMode(m)
                      }}
                      className={cn(
                        'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-all',
                        mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      <Icon className="h-3 w-3" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'preview' ? (
                <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 bg-white px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Subject</p>
                    <p className="text-sm font-semibold text-slate-800">
                      {renderTemplate(form.subject, EXAMPLE_TOKENS) || '—'}
                    </p>
                  </div>
                  <div dangerouslySetInnerHTML={{ __html: renderTemplate(form.bodyHtml, EXAMPLE_TOKENS) }} />
                </div>
              ) : mode === 'html' ? (
                <textarea
                  value={form.bodyHtml}
                  onChange={e => set('bodyHtml', e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full resize-none rounded-xl border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-emerald-200 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
                  <div className="flex items-center gap-0.5 border-b border-slate-100 bg-slate-50 px-2 py-1">
                    {([['bold', 'B', 'font-black'], ['italic', 'I', 'italic font-serif'], ['underline', 'U', 'underline']] as const).map(
                      ([cmd, glyph, cls]) => (
                        <button key={cmd} type="button"
                          onMouseDown={e => {
                            e.preventDefault()
                            document.execCommand(cmd)
                            if (editorRef.current) set('bodyHtml', editorRef.current.innerHTML)
                          }}
                          className={cn('h-7 w-7 rounded-md text-xs text-slate-600 hover:bg-slate-200', cls)}>{glyph}</button>
                      ))}
                    <span className="mx-1 h-4 w-px bg-slate-200" />
                    <button type="button" onMouseDown={e => {
                      e.preventDefault()
                      document.execCommand('insertUnorderedList')
                      if (editorRef.current) set('bodyHtml', editorRef.current.innerHTML)
                    }} className="h-7 rounded-md px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-200">List</button>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    suppressContentEditableWarning
                    onFocus={() => { lastFocus.current = 'body' }}
                    onInput={e => set('bodyHtml', (e.target as HTMLDivElement).innerHTML)}
                    className="flex-1 overflow-y-auto bg-white p-3 text-sm text-slate-800 focus:outline-none [&_table]:w-full [&_img]:max-w-full"
                  />
                </div>
              )}

              {unknown.length > 0 && (
                <p className="mt-1.5 text-[11px] font-medium text-amber-600">
                  Not a known token, so it will be sent literally: {unknown.map(t => `{{${t}}}`).join(', ')}
                </p>
              )}
            </div>
          </div>

          {/* Token palette */}
          <aside className="hidden w-60 shrink-0 flex-col border-l border-slate-100 bg-slate-50/60 lg:flex">
            <div className="p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <Braces className="h-3.5 w-3.5 text-brand-500" />
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-600">Insert a detail</p>
              </div>
              <p className="mb-2 text-[10px] leading-snug text-slate-400">
                Click to drop it in. Each one is replaced with this booking&apos;s real value when the mail is sent.
              </p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-300" />
                <input
                  value={tokenQuery}
                  onChange={e => setTokenQuery(e.target.value)}
                  placeholder="Search"
                  className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-2 text-xs placeholder:text-slate-300 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {tokens.map(([group, items]) => (
                <div key={group} className="mb-2.5">
                  <p className="mb-1 px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">{group}</p>
                  <div className="space-y-0.5">
                    {items.map(t => (
                      <button
                        key={t.token}
                        onClick={() => insertToken(t.token)}
                        title={`Example: ${t.example}`}
                        className="w-full rounded-lg border border-transparent bg-white px-2 py-1 text-left hover:border-brand-200 hover:bg-brand-50"
                      >
                        <p className="truncate text-[11px] font-semibold text-slate-700">{t.label}</p>
                        <p className="truncate font-mono text-[10px] text-brand-600">{`{{${t.token}}}`}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
          <button onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2 text-sm font-bold text-white hover:bg-brand-600 active:scale-[0.98] disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {form.id ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  )
}
