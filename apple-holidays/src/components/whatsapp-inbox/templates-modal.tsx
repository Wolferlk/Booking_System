'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutTemplate, Loader2, Search, Send, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { DOODLE_BG, countPlaceholders, type WaTemplate } from './shared'

interface Props {
  phone: string | null
  recipientLabel: string | null
  onClose: () => void
  onSent: () => void
}

const inputCls = 'h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/15'

export function TemplatesModal({ phone, recipientLabel, onClose, onSent }: Props) {
  const [tab, setTab] = useState<'send' | 'new'>('send')
  const [templates, setTemplates] = useState<WaTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState('')
  const [headerVals, setHeaderVals] = useState<string[]>([])
  const [bodyVals, setBodyVals] = useState<string[]>([])
  const [sending, setSending] = useState(false)

  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('UTILITY')
  const [newLanguage, setNewLanguage] = useState('en')
  const [newHeader, setNewHeader] = useState('')
  const [newHeaderVals, setNewHeaderVals] = useState<string[]>([])
  const [newBody, setNewBody] = useState('')
  const [newBodyVals, setNewBodyVals] = useState<string[]>([])
  const [newFooter, setNewFooter] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function selectTemplate(t: WaTemplate) {
    setSelectedName(t.name)
    setHeaderVals(Array(t.headerVariableCount).fill(''))
    setBodyVals(Array(t.bodyVariableCount).fill(''))
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/whatsapp/templates?status=APPROVED').then(r => r.json())
        if (cancelled) return
        if (res.success) {
          setTemplates(res.data)
          if (res.data[0]) selectTemplate(res.data[0])
        } else {
          toast.error(res.error || "Couldn't load templates")
        }
      } catch {
        if (!cancelled) toast.error("Couldn't load templates")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t => `${t.name} ${t.bodyText} ${t.category ?? ''}`.toLowerCase().includes(q))
  }, [templates, query])

  const selected = templates.find(t => t.name === selectedName) ?? null

  const preview = useMemo(() => {
    if (!selected) return { header: '', body: '' }
    const fill = (s: string, vals: string[]) =>
      vals.reduce((acc, v, i) => acc.replaceAll(`{{${i + 1}}}`, v || `{{${i + 1}}}`), s)
    return {
      header: selected.headerText ? fill(selected.headerText, headerVals) : '',
      body: fill(selected.bodyText, bodyVals),
    }
  }, [selected, headerVals, bodyVals])

  async function sendTemplate() {
    if (!phone || !selected) return
    if (headerVals.some(v => !v.trim()) || bodyVals.some(v => !v.trim())) {
      toast.error('Fill in every placeholder before sending')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/whatsapp/send-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          template: selected.name,
          lang: selected.language,
          headerParams: headerVals,
          bodyParams: bodyVals,
          previewText: [preview.header, preview.body].filter(Boolean).join('\n\n'),
        }),
      }).then(r => r.json())
      if (!res.success) throw new Error(res.error)
      toast.success('Template sent.')
      onSent()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  function onNewHeaderChange(v: string) {
    setNewHeader(v)
    const n = countPlaceholders(v)
    setNewHeaderVals(prev => Array.from({ length: n }, (_, i) => prev[i] ?? ''))
  }
  function onNewBodyChange(v: string) {
    setNewBody(v)
    const n = countPlaceholders(v)
    setNewBodyVals(prev => Array.from({ length: n }, (_, i) => prev[i] ?? ''))
  }

  async function submitNew() {
    const name = newName.trim()
    const bodyText = newBody.trim()
    if (!name) { toast.error('Name is required'); return }
    if (!bodyText) { toast.error('Body text is required'); return }
    if (newHeaderVals.some(v => !v.trim()) || newBodyVals.some(v => !v.trim())) {
      toast.error('Every {{n}} placeholder needs an example value')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category: newCategory,
          language: newLanguage.trim() || 'en',
          bodyText,
          bodyExamples: newBodyVals,
          headerText: newHeader.trim() || null,
          headerExamples: newHeaderVals,
          footerText: newFooter.trim() || null,
        }),
      }).then(r => r.json())
      if (!res.success) throw new Error(res.error)
      toast.success(`Submitted — status: ${res.data?.status || 'PENDING'}. Meta review can take minutes to ~24h.`)
      setNewName(''); setNewHeader(''); setNewHeaderVals([])
      setNewBody(''); setNewBodyVals([]); setNewFooter('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const newPreview = useMemo(() => {
    const fill = (s: string, vals: string[]) =>
      vals.reduce((acc, v, i) => acc.replaceAll(`{{${i + 1}}}`, v || `{{${i + 1}}}`), s)
    return { header: fill(newHeader, newHeaderVals), body: fill(newBody, newBodyVals), footer: newFooter }
  }, [newHeader, newHeaderVals, newBody, newBodyVals, newFooter])

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 px-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-black/5"
        initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-white px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-md shadow-emerald-500/30">
              <LayoutTemplate className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[15px] font-bold text-slate-900">Message templates</p>
              <p className="text-[11.5px] text-slate-500">
                {phone ? <>To <span className="font-semibold text-slate-700">{recipientLabel || `+${phone}`}</span></> : 'Open a conversation to send a template'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex rounded-xl bg-slate-100 p-1">
              {(['send', 'new'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className="relative z-10 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition">
                  {tab === t && (
                    <motion.span layoutId="tpl-tab" className="absolute inset-0 -z-10 rounded-lg bg-white shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
                  )}
                  <span className={tab === t ? 'text-emerald-700' : 'text-slate-500'}>{t === 'send' ? 'Send' : 'Create new'}</span>
                </button>
              ))}
            </div>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {tab === 'send' ? (
          <div className="grid min-h-0 flex-1 grid-cols-[260px_1fr] max-md:grid-cols-1">
            {/* template list */}
            <div className="flex min-h-0 flex-col border-r border-slate-100 max-md:max-h-56 max-md:border-b max-md:border-r-0">
              <div className="p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search templates…" className={`${inputCls} h-9 w-full pl-8 text-[13px]`} />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {loading ? (
                  <div className="space-y-2 px-1">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-8 text-center text-[12.5px] text-slate-400">{templates.length ? 'No matches' : 'No approved templates yet'}</p>
                ) : filtered.map(t => (
                  <button
                    key={`${t.name}-${t.language}`}
                    onClick={() => selectTemplate(t)}
                    className={`mb-1 w-full rounded-xl border px-3 py-2 text-left transition ${
                      t.name === selectedName ? 'border-emerald-300 bg-emerald-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-slate-800">{t.name}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[9.5px] font-bold uppercase text-slate-500">{t.language}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-400">{t.bodyText}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* fill + preview */}
            <div className="min-h-0 overflow-y-auto p-5">
              {!selected ? (
                <div className="grid h-full place-items-center text-center text-[13px] text-slate-400">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin text-emerald-500" /> : 'Pick a template on the left.'}
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selected.category && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-bold text-blue-600">{selected.category}</span>}
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700">{selected.status}</span>
                    </div>
                    {headerVals.length + bodyVals.length === 0 && (
                      <p className="rounded-xl bg-slate-50 px-3 py-3 text-[12.5px] text-slate-500">This template has no placeholders — it&apos;s ready to send.</p>
                    )}
                    {headerVals.map((v, i) => (
                      <label key={`h${i}`} className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-semibold text-slate-500">Header {`{{${i + 1}}}`}</span>
                        <input value={v} onChange={e => setHeaderVals(vals => vals.map((x, idx) => (idx === i ? e.target.value : x)))} className={inputCls} />
                      </label>
                    ))}
                    {bodyVals.map((v, i) => (
                      <label key={`b${i}`} className="flex flex-col gap-1">
                        <span className="text-[11.5px] font-semibold text-slate-500">Body {`{{${i + 1}}}`}</span>
                        <input value={v} onChange={e => setBodyVals(vals => vals.map((x, idx) => (idx === i ? e.target.value : x)))} className={inputCls} />
                      </label>
                    ))}
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={sendTemplate}
                      disabled={!phone || sending}
                      className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-50"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send template
                    </motion.button>
                  </div>
                  <PhonePreview header={preview.header} body={preview.body} footer="" />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_300px]">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold text-slate-500">Name</span>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. singapore_offer — lowercase, underscores only" className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold text-slate-500">Category</span>
                  <select value={newCategory} onChange={e => setNewCategory(e.target.value)} className={inputCls}>
                    <option value="UTILITY">Utility</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Authentication</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] font-semibold text-slate-500">Language</span>
                  <input value={newLanguage} onChange={e => setNewLanguage(e.target.value)} className={inputCls} />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold text-slate-500">Header (optional, plain text)</span>
                <input value={newHeader} onChange={e => onNewHeaderChange(e.target.value)} placeholder="e.g. Your itinerary is ready" className={inputCls} />
              </label>
              {newHeaderVals.map((v, i) => (
                <label key={`nh${i}`} className="flex flex-col gap-1 pl-3">
                  <span className="text-[11.5px] font-semibold text-slate-500">Header {`{{${i + 1}}}`} example</span>
                  <input value={v} onChange={e => setNewHeaderVals(vals => vals.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="value Meta will show reviewers" className={`${inputCls} h-9`} />
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold text-slate-500">Body</span>
                <textarea
                  value={newBody}
                  onChange={e => onNewBodyChange(e.target.value)}
                  rows={5}
                  placeholder="Hi {{1}}, your booking {{2}} is confirmed…"
                  className="resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/15"
                />
              </label>
              <p className="flex items-start gap-1.5 text-[11.5px] text-slate-400">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                Use {'{{1}}'}, {'{{2}}'}… for placeholders — Meta requires an example value for each before it will review the template.
              </p>
              {newBodyVals.map((v, i) => (
                <label key={`nb${i}`} className="flex flex-col gap-1 pl-3">
                  <span className="text-[11.5px] font-semibold text-slate-500">Body {`{{${i + 1}}}`} example</span>
                  <input value={v} onChange={e => setNewBodyVals(vals => vals.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder="value Meta will show reviewers" className={`${inputCls} h-9`} />
                </label>
              ))}
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] font-semibold text-slate-500">Footer (optional, plain text, no placeholders)</span>
                <input value={newFooter} onChange={e => setNewFooter(e.target.value)} placeholder="e.g. — AppleHolidays" className={inputCls} />
              </label>
              <div className="flex justify-end">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={submitNew}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-emerald-500/25 transition hover:brightness-105 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
                  Submit for review
                </motion.button>
              </div>
            </div>
            <PhonePreview header={newPreview.header} body={newPreview.body || 'Your message preview appears here…'} footer={newPreview.footer} />
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function PhonePreview({ header, body, footer }: { header: string; body: string; footer: string }) {
  return (
    <div className="self-start rounded-[28px] border-[6px] border-slate-800 bg-slate-800 shadow-xl">
      <div className="flex items-center gap-2 rounded-t-[22px] bg-[#075e54] px-3 py-2 text-white">
        <span className="h-6 w-6 rounded-full bg-white/25" />
        <span className="text-[12px] font-semibold">Live preview</span>
      </div>
      <div className="min-h-[200px] rounded-b-[22px] bg-[#efeae2] p-3" style={DOODLE_BG}>
        <motion.div
          key={header + body + footer}
          initial={{ opacity: 0.6, y: 4 }} animate={{ opacity: 1, y: 0 }}
          className="max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3 py-2 shadow-sm"
        >
          {header && <p className="mb-1 text-[13px] font-bold text-slate-900">{header}</p>}
          <p className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-slate-800">{body}</p>
          {footer && <p className="mt-1.5 text-[11px] text-slate-400">{footer}</p>}
          <p className="mt-1 text-right text-[9.5px] text-slate-400">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </motion.div>
      </div>
    </div>
  )
}
