'use client'

/**
 * The schedule editor — a right-hand slide-over rather than a centred modal,
 * because it is a long form and the operator often wants to keep the schedule
 * list visible while comparing two recipients lists.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AtSign, Bot, CalendarDays, Check, ChevronDown, Clock, FileSpreadsheet, Globe2,
  Loader2, Mail, Plus, Save, Send, Trash2, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  COUNTRY_OPTIONS, PERIOD_OPTIONS, SECTION_OPTIONS, TIMEZONE_OPTIONS, WEEKDAYS,
  emptySchedule, type ReportPeriod, type Schedule, type ScheduleSections,
} from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─── Recipient chip input ─────────────────────────────────────────────────────

function RecipientInput({
  label, hint, value, onChange, tone = 'slate', required,
}: {
  label: string
  hint?: string
  value: string[]
  onChange: (next: string[]) => void
  tone?: 'slate' | 'teal'
  required?: boolean
}) {
  const [draft, setDraft] = useState('')

  /** Accepts pasted lists: "a@x.com, b@y.com; c@z.com" all land as separate chips. */
  const commit = useCallback((raw: string) => {
    const parts = raw.split(/[,;\s]+/).map(p => p.trim().toLowerCase()).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) {
      if (EMAIL_RE.test(p) && !next.includes(p)) next.push(p)
    }
    onChange(next)
    setDraft('')
  }, [value, onChange])

  const invalidDraft = draft.trim().length > 0 && !EMAIL_RE.test(draft.trim())

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
          <span className="ml-2 font-normal text-slate-400">{value.length || 'none'}</span>
        </label>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>

      <div className={cn(
        'flex flex-wrap gap-1.5 p-2 rounded-lg border bg-white min-h-[42px] transition-colors',
        invalidDraft ? 'border-red-300' : 'border-slate-200 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100',
      )}>
        {value.map(addr => (
          <span
            key={addr}
            className={cn(
              'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-xs font-medium',
              tone === 'teal' ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-700',
            )}
          >
            {addr}
            <button
              type="button"
              onClick={() => onChange(value.filter(a => a !== addr))}
              className="p-0.5 rounded hover:bg-black/10 transition-colors"
              aria-label={`Remove ${addr}`}
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
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => commit(draft)}
          onPaste={e => {
            const text = e.clipboardData.getData('text')
            if (/[,;\s]/.test(text)) { e.preventDefault(); commit(text) }
          }}
          placeholder={value.length ? 'Add another…' : 'name@company.com'}
          className="flex-1 min-w-[140px] text-sm outline-none bg-transparent placeholder:text-slate-300"
        />
      </div>
      {invalidDraft && <p className="text-[11px] text-red-500 mt-1">That does not look like an email address.</p>}
    </div>
  )
}

// ─── Small controls ───────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-xs font-semibold text-slate-700">{label}</label>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Toggle({
  checked, onChange, label, hint, icon,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  icon?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all',
        checked ? 'border-teal-300 bg-teal-50/60' : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <span className={cn(
        'mt-0.5 w-9 h-5 rounded-full flex-shrink-0 relative transition-colors',
        checked ? 'bg-teal-600' : 'bg-slate-300',
      )}>
        <span className={cn(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[18px]' : 'left-0.5',
        )} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
          {icon}{label}
        </span>
        {hint && <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{hint}</span>}
      </span>
    </button>
  )
}

const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-colors'

// ─── Editor ───────────────────────────────────────────────────────────────────

export interface EditorProps {
  open: boolean
  schedule: Schedule | null
  defaultTimezone: string
  sender: string
  onClose: () => void
  onSaved: () => void
  onDelete: (s: Schedule) => void
  onPreview: (draft: Partial<Schedule>) => void
}

export default function ScheduleEditor({
  open, schedule, defaultTimezone, sender, onClose, onSaved, onDelete, onPreview,
}: EditorProps) {
  const [draft, setDraft] = useState<Partial<Schedule>>(() => emptySchedule(defaultTimezone))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setDraft(schedule ? { ...schedule } : emptySchedule(defaultTimezone))
  }, [open, schedule, defaultTimezone])

  const set = useCallback(<K extends keyof Schedule>(key: K, value: Schedule[K]) => {
    setDraft(d => ({ ...d, [key]: value }))
  }, [])

  const setSection = useCallback((key: keyof ScheduleSections, value: boolean) => {
    setDraft(d => ({ ...d, sections: { ...(d.sections as ScheduleSections), [key]: value } }))
  }, [])

  const sections = (draft.sections ?? { created: true, onGround: true, complaints: true, upcoming: true }) as ScheduleSections
  const anySection = Object.values(sections).some(Boolean)
  const canSave = (draft.to?.length ?? 0) > 0 && anySection && !saving

  const totalRecipients = (draft.to?.length ?? 0) + (draft.cc?.length ?? 0) + (draft.bcc?.length ?? 0)

  const cadencePreview = useMemo(() => {
    const at = `${String(draft.hour ?? 8).padStart(2, '0')}:${String(draft.minute ?? 0).padStart(2, '0')} ${draft.timezone}`
    if (draft.period === 'WEEKLY') return `Every ${WEEKDAYS[draft.dayOfWeek ?? 1]} at ${at}`
    if (draft.period === 'MONTHLY') {
      return `Monthly on ${draft.dayOfMonth === 0 ? 'the last day' : `day ${draft.dayOfMonth}`} at ${at}`
    }
    return `Every day at ${at}`
  }, [draft.period, draft.hour, draft.minute, draft.timezone, draft.dayOfWeek, draft.dayOfMonth])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/reports/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Save failed')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-slate-50 h-full shadow-2xl flex flex-col animate-slide-in-right">
        {/* Head */}
        <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 truncate">
              {schedule ? 'Edit schedule' : 'New report schedule'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {cadencePreview} · {totalRecipients} recipient{totalRecipients === 1 ? '' : 's'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
          )}

          {/* Identity */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
            <Field label="Schedule name" hint="Shown in the card list and the email footer">
              <input
                value={draft.name ?? ''}
                onChange={e => set('name', e.target.value)}
                placeholder="Morning ops brief"
                className={inputCls}
              />
            </Field>

            <Field label="Report period">
              <div className="grid grid-cols-3 gap-2">
                {PERIOD_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('period', p.value as ReportPeriod)}
                    className={cn(
                      'px-3 py-2.5 rounded-lg border text-left transition-all',
                      draft.period === p.value
                        ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-100'
                        : 'border-slate-200 bg-white hover:border-slate-300',
                    )}
                  >
                    <div className="text-sm font-semibold text-slate-800">{p.label}</div>
                    <div className="text-[11px] text-slate-500 leading-tight mt-0.5">{p.hint}</div>
                  </button>
                ))}
              </div>
            </Field>
          </section>

          {/* When */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Clock className="w-4 h-4 text-teal-600" /> When to send
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Send time">
                <input
                  type="time"
                  value={`${String(draft.hour ?? 8).padStart(2, '0')}:${String(draft.minute ?? 0).padStart(2, '0')}`}
                  onChange={e => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    setDraft(d => ({ ...d, hour: h || 0, minute: m || 0 }))
                  }}
                  className={inputCls}
                />
              </Field>

              <Field label="Timezone" hint="Times are local to this zone">
                <div className="relative">
                  <select
                    value={draft.timezone ?? defaultTimezone}
                    onChange={e => set('timezone', e.target.value)}
                    className={cn(inputCls, 'appearance-none pr-9')}
                  >
                    {Array.from(new Set([draft.timezone ?? defaultTimezone].concat(TIMEZONE_OPTIONS))).map(tz => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </Field>
            </div>

            {draft.period === 'WEEKLY' && (
              <Field label="Day of week">
                <div className="grid grid-cols-7 gap-1.5">
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set('dayOfWeek', i)}
                      className={cn(
                        'py-2 rounded-lg text-xs font-semibold border transition-all',
                        draft.dayOfWeek === i
                          ? 'border-teal-500 bg-teal-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {d.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </Field>
            )}

            {draft.period === 'MONTHLY' && (
              <Field label="Day of month" hint="Capped at 28 so every month fires">
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => set('dayOfMonth', d)}
                      className={cn(
                        'w-9 h-9 rounded-lg text-xs font-semibold border transition-all',
                        draft.dayOfMonth === d
                          ? 'border-teal-500 bg-teal-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => set('dayOfMonth', 0)}
                    className={cn(
                      'h-9 px-3 rounded-lg text-xs font-semibold border transition-all',
                      draft.dayOfMonth === 0
                        ? 'border-teal-500 bg-teal-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                    )}
                  >
                    Last day
                  </button>
                </div>
              </Field>
            )}

            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              <CalendarDays className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
              {cadencePreview}
            </div>
          </section>

          {/* Recipients */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Mail className="w-4 h-4 text-teal-600" /> Recipients
              </div>
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> sent from {sender}
              </span>
            </div>

            <RecipientInput
              label="To" required tone="teal"
              hint="Enter, comma or paste a whole list"
              value={draft.to ?? []}
              onChange={v => set('to', v)}
            />
            <RecipientInput label="CC" value={draft.cc ?? []} onChange={v => set('cc', v)} />
            <RecipientInput label="BCC" hint="Hidden from other recipients" value={draft.bcc ?? []} onChange={v => set('bcc', v)} />

            <div className="grid grid-cols-2 gap-3">
              <Field label="Reply-to" hint="Optional">
                <input
                  value={draft.replyTo ?? ''}
                  onChange={e => set('replyTo', e.target.value || null)}
                  placeholder="ops@aahaas.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Subject prefix" hint="Optional">
                <input
                  value={draft.subjectPrefix ?? ''}
                  onChange={e => set('subjectPrefix', e.target.value || null)}
                  placeholder="[Ops]"
                  className={inputCls}
                />
              </Field>
            </div>
          </section>

          {/* Content */}
          <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <FileSpreadsheet className="w-4 h-4 text-teal-600" /> What goes in it
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {SECTION_OPTIONS.map(s => (
                <Toggle
                  key={s.key}
                  checked={sections[s.key]}
                  onChange={v => setSection(s.key, v)}
                  label={s.label}
                  hint={s.hint}
                />
              ))}
            </div>
            {!anySection && (
              <p className="text-xs text-red-600">Pick at least one section — an empty report has nothing to say.</p>
            )}

            <Field label="Countries" hint={draft.countries?.length ? `${draft.countries.length} selected` : 'All countries'}>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => set('countries', [])}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all inline-flex items-center gap-1.5',
                    !draft.countries?.length
                      ? 'border-teal-500 bg-teal-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                  )}
                >
                  <Globe2 className="w-3.5 h-3.5" /> All
                </button>
                {COUNTRY_OPTIONS.map(c => {
                  const on = draft.countries?.includes(c.value) ?? false
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => {
                        const cur = draft.countries ?? []
                        set('countries', on ? cur.filter(x => x !== c.value) : [...cur, c.value])
                      }}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all inline-flex items-center gap-1.5',
                        on
                          ? 'border-teal-500 bg-teal-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                      )}
                    >
                      {on && <Check className="w-3.5 h-3.5" />}{c.label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <div className="grid sm:grid-cols-2 gap-2">
              <Toggle
                checked={draft.attachCsv ?? false}
                onChange={v => set('attachCsv', v)}
                label="Attach CSV export"
                hint="Every row in the report as a spreadsheet"
                icon={<FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />}
              />
              <Toggle
                checked={draft.aiSummary ?? false}
                onChange={v => set('aiSummary', v)}
                label="AI written summary"
                hint="Three sentences of context above the numbers"
                icon={<Bot className="w-3.5 h-3.5 text-slate-400" />}
              />
              <Toggle
                checked={draft.skipIfEmpty ?? false}
                onChange={v => set('skipIfEmpty', v)}
                label="Skip when nothing happened"
                hint="No bookings, tours or complaints — send nothing"
              />
              <Field label="Detail rows per table" hint="Over ~40, Gmail may clip">
                <input
                  type="number"
                  min={10}
                  max={250}
                  value={draft.maxRows ?? 30}
                  onChange={e => set('maxRows', Number(e.target.value))}
                  className={inputCls}
                />
              </Field>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-4">
            <Toggle
              checked={draft.enabled ?? true}
              onChange={v => set('enabled', v)}
              label="Schedule is active"
              hint="Turn off to keep the configuration without sending"
            />
          </section>
        </div>

        {/* Foot */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex items-center gap-2">
          {schedule && (
            <button
              onClick={() => onDelete(schedule)}
              className="p-2.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
              title="Delete schedule"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onPreview(draft)}
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors inline-flex items-center gap-2"
          >
            <Send className="w-4 h-4" /> Preview
          </button>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : schedule ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            {schedule ? 'Save changes' : 'Create schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
