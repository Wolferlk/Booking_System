'use client'

/** Settings → Ticket Issue Desk: on/off, who approves on WhatsApp, and the templates. */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Lock, MessageCircle, Plus, Send, Ticket, Trash2 } from 'lucide-react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'

interface Config {
  enabled: boolean
  providers: { globaltix: boolean; cebu: boolean }
  recipients: { name: string; phone: string }[]
  otpTemplate: string
  detailsTemplate: string
  language: string
}
interface Templates { otp: string; details: string; error: string | null }
interface Tables { ready: boolean; missing: string[]; error: string | null }

const STATUS_TONE: Record<string, string> = {
  APPROVED: 'bg-emerald-50 text-emerald-700', PENDING: 'bg-amber-50 text-amber-700', IN_APPEAL: 'bg-amber-50 text-amber-700',
  REJECTED: 'bg-red-50 text-red-700', PAUSED: 'bg-red-50 text-red-700', DISABLED: 'bg-red-50 text-red-700', MISSING: 'bg-slate-100 text-slate-600', UNKNOWN: 'bg-slate-100 text-slate-600',
}
const Status = ({ value }: { value: string }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[value] ?? STATUS_TONE.UNKNOWN}`}>{value}</span>

async function call<T>(init?: RequestInit): Promise<{ data: T; message?: string }> {
  const res = await fetch('/api/settings/ticket-portal', init)
  const json = await res.json().catch(() => ({}))
  if (!json.success) throw new Error(json.error || `The server answered ${res.status}.`)
  return json
}
const send = <T,>(method: string, body: unknown) => call<T>({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export default function TicketPortalCard() {
  const [config, setConfig] = useState<Config | null>(null)
  const [templates, setTemplates] = useState<Templates | null>(null)
  const [tables, setTables] = useState<Tables | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    call<{ config: Config; templates: Templates; tables?: Tables }>().then(r => { setConfig(r.data.config); setTemplates(r.data.templates); setTables(r.data.tables ?? null) }).catch(e => toast.error(e.message))
  }, [])

  if (!config) return <Card><CardBody><div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div></CardBody></Card>

  const patch = (p: Partial<Config>) => setConfig({ ...config, ...p })
  const setRecipient = (i: number, p: Partial<Config['recipients'][number]>) => patch({ recipients: config.recipients.map((r, n) => (n === i ? { ...r, ...p } : r)) })

  async function save() {
    setBusy('save')
    try {
      const { data, message } = await send<{ config: Config; templates: Templates }>('PUT', { password, config })
      setConfig(data.config); setTemplates(data.templates); setPassword('')
      toast.success(message ?? 'Saved')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not saved') } finally { setBusy(null) }
  }
  async function register() {
    setBusy('register')
    try {
      const { data } = await send<{ results: Record<string, string>; templates: Templates }>('POST', { action: 'register' })
      setTemplates(data.templates)
      toast.info(`Code template: ${data.results.otp} · Details template: ${data.results.details}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not sent to Meta') } finally { setBusy(null) }
  }
  async function createTables() {
    setBusy('tables')
    try {
      const { data, message } = await send<{ tables: Tables }>('POST', { action: 'create-tables', password })
      setTables(data.tables); setPassword('')
      toast.success(message ?? 'Tables created')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Tables not created') } finally { setBusy(null) }
  }
  async function test() {
    setBusy('test')
    try {
      const { data, message } = await send<{ sentTo: { name: string; ok: boolean; error?: string }[] }>('POST', { action: 'test' })
      const failed = data.sentTo.filter(s => !s.ok)
      if (failed.length) toast.error(`${failed[0].name}: ${failed[0].error ?? 'refused'}`)
      else toast.success(message ?? 'Sent')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Not sent') } finally { setBusy(null) }
  }

  const Toggle = ({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) => (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-900">Ticket Issue Desk</h3>
        </div>
      </CardHeader>
      <CardBody>
        <div className="space-y-5">
          <p className="text-xs text-slate-500">Compare GlobalTix, Cebu and Manual on the Tickets page. Paying or cancelling on a portal needs a WhatsApp code from an approver below.</p>

          {tables && !tables.ready && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
              <p className="font-semibold">The desk cannot run on this database yet</p>
              <p className="mt-1">
                {tables.missing.length
                  ? <>Missing tables: <span className="font-mono">{tables.missing.join(', ')}</span>. Until they exist the Tickets page shows no Issue button, even with the desk ON.</>
                  : <>The desk tables could not be checked: {tables.error}</>}
              </p>
              {tables.missing.length > 0 && (
                <p className="mt-1 text-red-700">Creating them adds three new, empty tables. Nothing that already exists is changed. Enter the Critical Services Password below, then press the button.</p>
              )}
              {tables.missing.length > 0 && (
                <button type="button" onClick={createTables} disabled={busy !== null || !password.trim()} className="btn btn-sm mt-2 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {busy === 'tables' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Create desk tables
                </button>
              )}
            </div>
          )}

          <div className={`flex items-center justify-between rounded-xl border p-4 ${config.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
            <div>
              <p className="text-sm font-semibold text-slate-800">Desk is {config.enabled ? 'ON' : 'OFF'}</p>
              <p className="mt-0.5 text-xs text-slate-500">{config.enabled ? 'Issue buttons show on the Tickets page. Real money can be spent on the portals.' : 'The Tickets page works exactly as before.'}</p>
            </div>
            <Toggle on={config.enabled} onClick={() => patch({ enabled: !config.enabled })} label="Turn the desk on or off" />
          </div>

          <div className="flex flex-wrap gap-6">
            {(['globaltix', 'cebu'] as const).map(p => (
              <label key={p} className="flex items-center gap-2 text-sm text-slate-700">
                <Toggle on={config.providers[p]} onClick={() => patch({ providers: { ...config.providers, [p]: !config.providers[p] } })} label={`${p} on or off`} />
                {p === 'globaltix' ? 'GlobalTix' : 'Cebu'}
              </label>
            ))}
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500"><MessageCircle className="h-3.5 w-3.5" /> Approver WhatsApp numbers</p>
            <div className="space-y-2">
              {config.recipients.map((r, i) => (
                <div key={i} className="flex gap-2">
                  <input className="form-input flex-1 py-1.5 text-sm" placeholder="Name" value={r.name} onChange={e => setRecipient(i, { name: e.target.value })} />
                  <input className="form-input flex-1 py-1.5 text-sm" placeholder="Number with country code, e.g. 94771234567" value={r.phone} onChange={e => setRecipient(i, { phone: e.target.value })} />
                  <button type="button" onClick={() => patch({ recipients: config.recipients.filter((_, n) => n !== i) })} className="btn btn-secondary btn-sm" aria-label={`Remove ${r.name || 'approver'}`}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {config.recipients.length < 10 && <button type="button" onClick={() => patch({ recipients: [...config.recipients, { name: '', phone: '' }] })} className="btn btn-secondary btn-sm"><Plus className="h-3.5 w-3.5" /> Add number</button>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">Code template {templates && <Status value={templates.otp} />}</span>
              <input className="form-input py-1.5 font-mono text-sm" value={config.otpTemplate} onChange={e => patch({ otpTemplate: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-600">Details template {templates && <Status value={templates.details} />}</span>
              <input className="form-input py-1.5 font-mono text-sm" value={config.detailsTemplate} onChange={e => patch({ detailsTemplate: e.target.value })} />
            </label>
          </div>
          {templates?.error && <p className="text-xs text-red-600">{templates.error}</p>}
          <p className="text-xs text-slate-500">Meta only lets a code template carry the code, so the booking, ticket and amount go in the details message just before it.</p>
          {templates && (templates.details === 'MISSING' || templates.details === 'REJECTED') && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              The details template is {templates.details === 'MISSING' ? 'not registered yet' : 'rejected by Meta'}. Press <b>Register templates with Meta</b> to send the reworded one for approval. Until Meta approves it, approvers still get the code, just without the booking details.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={register} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'register' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Register templates with Meta</button>
            <button type="button" onClick={test} disabled={busy !== null} className="btn btn-secondary btn-sm">{busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />} Send test code</button>
          </div>

          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <label className="min-w-[220px] flex-1">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700"><Lock className="h-3.5 w-3.5" /> Critical Services Password</span>
              <input type="password" autoComplete="off" className="form-input py-1.5 text-sm" value={password} onChange={e => setPassword(e.target.value)} placeholder="Needed to save" />
            </label>
            <button type="button" onClick={save} disabled={busy !== null || !password.trim()} className="btn btn-primary btn-sm disabled:opacity-50">{busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save</button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
