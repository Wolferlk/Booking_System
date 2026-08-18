'use client'

/**
 * How the end-of-trip report behaves: when it goes out on its own, how bad a
 * trip has to be before it is held, and who hears about it when it is.
 */

import { useState } from 'react'
import { Info, Loader2, Save, ShieldAlert, Zap } from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import type { ExperienceReportSettings, RiskLevel } from '@/lib/te/experience-report/types'

interface Props {
  open: boolean
  settings: ExperienceReportSettings
  onClose: () => void
  onSaved: (next: ExperienceReportSettings) => void
}

const HOLD_LEVELS: { value: Exclude<RiskLevel, 'none'>; label: string; hint: string }[] = [
  { value: 'low',    label: 'Cautious', hint: 'Hold on any negative signal at all — even an “average” rating.' },
  { value: 'medium', label: 'Balanced', hint: 'Hold on a real complaint, a poor rating or a negative call.' },
  { value: 'high',   label: 'Serious only', hint: 'Hold only on severe problems — safety, refunds, repeated failures.' },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-400">{hint}</p>}
    </div>
  )
}

const inputClass =
  'mt-1.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-50'

export default function SettingsPanel({ open, settings, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<ExperienceReportSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [sweeping, setSweeping] = useState(false)

  const set = <K extends keyof ExperienceReportSettings>(key: K, value: ExperienceReportSettings[K]) =>
    setDraft(d => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/te/experience-reports/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Settings saved')
      onSaved(json.data)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  const sweep = async (dryRun: boolean) => {
    setSweeping(true)
    try {
      const res = await fetch('/api/te/experience-reports/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Sweep finished')
      if (json.data?.errors?.length) {
        toast.error(`${json.data.errors.length} booking(s) failed — check the list.`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The sweep failed')
    } finally {
      setSweeping(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Experience report settings" size="2xl">
      <div className="space-y-6">

        {/* Automation */}
        <section className="rounded-2xl border border-slate-200 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-extrabold text-slate-800">After the trip ends</h3>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3.5">
            <input
              type="checkbox"
              checked={draft.autoSend}
              onChange={e => set('autoSend', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-violet-600"
            />
            <span>
              <span className="block text-[13px] font-bold text-slate-700">Build and send reports automatically</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-400">
                One report per trip once it is over. Nothing is sent day by day.
              </span>
            </span>
          </label>

          <label className="mt-2.5 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3.5">
            <input
              type="checkbox"
              checked={draft.requireApproval}
              onChange={e => set('requireApproval', e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-violet-600"
            />
            <span>
              <span className="block text-[13px] font-bold text-slate-700">Always review before sending</span>
              <span className="mt-0.5 block text-[11.5px] leading-relaxed text-slate-400">
                Even a clean trip waits for someone to press Send.
              </span>
            </span>
          </label>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Wait after departure" hint="Days to let late calls and feedback forms land before writing the report.">
              <input
                type="number" min={0} max={30}
                value={draft.quietDays}
                onChange={e => set('quietDays', Number(e.target.value))}
                className={inputClass}
              />
            </Field>
            <Field label="Look back" hint="How far back the sweep looks for trips it has not reported on yet.">
              <input
                type="number" min={1} max={90}
                value={draft.lookbackDays}
                onChange={e => set('lookbackDays', Number(e.target.value))}
                className={inputClass}
              />
            </Field>
          </div>
        </section>

        {/* Bad experience */}
        <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-500" />
            <h3 className="text-sm font-extrabold text-slate-800">When the client had a bad experience</h3>
          </div>

          <p className="mb-4 flex items-start gap-2 rounded-xl bg-white/70 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A held report never reaches the agent. It goes to the address below instead, saying plainly that the agent
            has not been told, and waits for a person to decide what happens next.
          </p>

          <Field label="Hold when the trip grades at">
            <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
              {HOLD_LEVELS.map(level => (
                <button
                  key={level.value}
                  onClick={() => set('holdAtLevel', level.value)}
                  className={`rounded-xl border-2 p-3 text-left transition ${
                    draft.holdAtLevel === level.value
                      ? 'border-rose-400 bg-white shadow-sm'
                      : 'border-transparent bg-white/60 hover:bg-white'
                  }`}
                >
                  <span className="block text-[12.5px] font-extrabold text-slate-800">{level.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-400">{level.hint}</span>
                </button>
              ))}
            </div>
          </Field>

          <div className="mt-4">
            <Field label="Escalation inbox" hint="Where held reports go. One address.">
              <input
                type="email"
                value={draft.escalationEmail}
                onChange={e => set('escalationEmail', e.target.value)}
                placeholder="name@aahaas.com"
                className={inputClass}
              />
            </Field>
          </div>
        </section>

        {/* Recipients */}
        <section className="rounded-2xl border border-slate-200 p-5">
          <h3 className="mb-4 text-sm font-extrabold text-slate-800">Copies on the agent mail</h3>
          <Field label="Always CC" hint="Comma-separated. The client's own contact email is added automatically when we hold one.">
            <input
              value={draft.ccEmails.join(', ')}
              onChange={e => set('ccEmails', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
              placeholder="confirm.booking@aahaas.com, ops@aahaas.com"
              className={inputClass}
            />
          </Field>
        </section>

        {/* Manual sweep */}
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-sm font-extrabold text-slate-800">Run the sweep now</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-400">
            Normally this runs on a schedule. Use these to catch up without waiting.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => sweep(true)}
              disabled={sweeping}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:opacity-60"
            >
              {sweeping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Preview what would happen
            </button>
            <button
              onClick={() => sweep(false)}
              disabled={sweeping}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-[13px] font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {sweeping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Run it
            </button>
          </div>
        </section>

        {settings.updatedAt && (
          <p className="text-[11px] text-slate-400">
            Last changed {new Date(settings.updatedAt).toLocaleString('en-GB')}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500 transition hover:bg-slate-100">
            Close
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save settings
          </button>
        </div>
      </div>
    </Modal>
  )
}
