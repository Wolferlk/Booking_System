'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Link2, Users, Clock, Activity, CheckCircle2, Ban, Pencil, Trash2,
  Plane, PlaneTakeoff, ScrollText, Plus, ShieldCheck, X, RefreshCw, Copy,
} from 'lucide-react'
import Header from '@/components/layout/header'
import Modal from '@/components/ui/modal'
import { formatDateTime } from '@/lib/utils'

interface Handler {
  id: string; name: string; email: string; phone: string | null; whatsappPhone: string | null
  country: string; isActive: boolean; createdAt: string; approvedAt: string | null
  approvedBy: string | null; lastLoginAt: string | null; _count: { logs: number }
}
interface Log {
  id: string; fileHandlerName: string; action: string; bookingRef: string | null
  isNumber: string | null; cntlNumber: string | null; operationCountry: string | null
  details: string | null; createdAt: string
}

const COUNTRIES = ['ALL', 'SRILANKA', 'VIETNAM', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']
const FLAG: Record<string, string> = { SRILANKA: '🇱🇰', VIETNAM: '🇻🇳', SINGAPORE: '🇸🇬', MALAYSIA: '🇲🇾', SINGAPORE_MALAYSIA: '🇸🇬🇲🇾', ALL: '🌐' }

const ACTION_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  LOGIN:            { label: 'Signed in',        cls: 'bg-slate-100 text-slate-600',   icon: <Users className="w-3.5 h-3.5" /> },
  FLIGHT_ADDED:     { label: 'Flight added',     cls: 'bg-emerald-100 text-emerald-700', icon: <PlaneTakeoff className="w-3.5 h-3.5" /> },
  FLIGHT_UPDATED:   { label: 'Flight edited',    cls: 'bg-sky-100 text-sky-700',       icon: <Plane className="w-3.5 h-3.5" /> },
  CANCEL_REQUESTED: { label: 'Cancel requested', cls: 'bg-amber-100 text-amber-700',   icon: <Ban className="w-3.5 h-3.5" /> },
}

export default function FileHandlersAdminPage() {
  const [handlers, setHandlers] = useState<Handler[]>([])
  const [counts, setCounts] = useState({ total: 0, pending: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [logsOpen, setLogsOpen] = useState(false)
  const [logs, setLogs] = useState<Log[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [logFilter, setLogFilter] = useState<{ handlerId?: string; name?: string }>({})

  const [editing, setEditing] = useState<Handler | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/file-handlers')
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      setHandlers(d.data.handlers); setCounts(d.data.counts)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function openLogs(handler?: Handler) {
    setLogFilter(handler ? { handlerId: handler.id, name: handler.name } : {})
    setLogsOpen(true); setLogsLoading(true)
    try {
      const res = await fetch(`/api/admin/file-handlers/logs${handler ? `?handlerId=${handler.id}` : ''}`)
      const d = await res.json()
      if (d.success) setLogs(d.data.logs)
    } finally { setLogsLoading(false) }
  }

  async function patch(id: string, body: Record<string, unknown>, okMsg?: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/file-handlers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return false }
      toast.success(okMsg ?? d.message ?? 'Updated')
      await load(); return true
    } finally { setBusy(null) }
  }

  async function remove(h: Handler) {
    if (!confirm(`Delete file handler "${h.name}"? Their activity logs are kept.`)) return
    setBusy(h.id)
    try {
      const res = await fetch(`/api/admin/file-handlers/${h.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success('Deleted'); await load()
    } finally { setBusy(null) }
  }

  function copyPortalLink() {
    const url = `${window.location.origin}/filehandler/login`
    navigator.clipboard.writeText(url).then(
      () => toast.success('Portal login link copied!'),
      () => toast.error('Could not copy — link: ' + url),
    )
  }

  const pending = handlers.filter(h => !h.isActive)
  const activeList = handlers.filter(h => h.isActive)

  return (
    <>
      <Header
        title="File Handlers"
        subtitle="Approve registrations, manage accounts, and audit all file-handler activity"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={copyPortalLink} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">
              <Link2 className="w-4 h-4" /> Copy Portal Link
            </button>
            <button onClick={() => openLogs()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200">
              <ScrollText className="w-4 h-4" /> All Logs
            </button>
            <button onClick={() => setCreateOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700">
              <Plus className="w-4 h-4" /> New Handler
            </button>
          </div>
        }
      />

      <div className="px-4 sm:px-8 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Stat icon={<Users className="w-5 h-5 text-emerald-600" />} label="Total handlers" value={counts.total} />
          <Stat icon={<Clock className="w-5 h-5 text-amber-600" />} label="Pending approval" value={counts.pending} highlight={counts.pending > 0} />
          <Stat icon={<Activity className="w-5 h-5 text-sky-600" />} label="Active" value={activeList.length} />
        </div>

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 text-emerald-600 animate-spin" /></div>
        ) : (
          <>
            {/* Pending approvals */}
            {pending.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-amber-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4" /> Awaiting approval ({pending.length})
                </h2>
                <div className="space-y-2">
                  {pending.map(h => (
                    <div key={h.id} className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
                      <HandlerIdentity h={h} />
                      <div className="flex items-center gap-2 ml-auto">
                        <button disabled={busy === h.id} onClick={() => patch(h.id, { action: 'approve' }, 'Approved — the handler can now log in')}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                          {busy === h.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Approve
                        </button>
                        <IconBtn title="Edit" onClick={() => setEditing(h)}><Pencil className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Delete" danger onClick={() => remove(h)}><Trash2 className="w-4 h-4" /></IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Active handlers */}
            <section>
              <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Active handlers ({activeList.length})
              </h2>
              {activeList.length === 0 ? (
                <p className="text-slate-400 text-sm py-6 text-center border border-dashed border-slate-200 rounded-xl">No active file handlers yet.</p>
              ) : (
                <div className="space-y-2">
                  {activeList.map(h => (
                    <div key={h.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 shadow-sm">
                      <HandlerIdentity h={h} />
                      <div className="text-xs text-slate-500 hidden md:block">
                        <p>{h._count.logs} action{h._count.logs === 1 ? '' : 's'}</p>
                        <p>{h.lastLoginAt ? `Last in ${formatDateTime(h.lastLoginAt)}` : 'Never logged in'}</p>
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        <IconBtn title="View logs" onClick={() => openLogs(h)}><ScrollText className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Edit" onClick={() => setEditing(h)}><Pencil className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Deactivate" onClick={() => patch(h.id, { action: 'deactivate' }, 'Deactivated')}><Ban className="w-4 h-4" /></IconBtn>
                        <IconBtn title="Delete" danger onClick={() => remove(h)}><Trash2 className="w-4 h-4" /></IconBtn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* Logs modal */}
      <Modal open={logsOpen} onClose={() => setLogsOpen(false)} size="lg"
        title={logFilter.name ? `Activity — ${logFilter.name}` : 'All File Handler Activity'}>
        {logsLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-emerald-600 animate-spin" /></div>
        ) : logs.length === 0 ? (
          <p className="text-slate-400 text-sm py-8 text-center">No activity recorded yet.</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1 space-y-2">
            {logs.map(l => {
              const m = ACTION_META[l.action] ?? { label: l.action, cls: 'bg-slate-100 text-slate-600', icon: <Activity className="w-3.5 h-3.5" /> }
              return (
                <div key={l.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-bold whitespace-nowrap ${m.cls}`}>{m.icon}{m.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 font-medium">
                      {l.fileHandlerName}
                      {l.bookingRef && <span className="text-slate-500 font-normal"> · {FLAG[l.operationCountry ?? ''] ?? ''} {l.bookingRef}{l.isNumber ? ` (IS ${l.isNumber})` : ''}</span>}
                    </p>
                    {l.details && <p className="text-xs text-slate-500 mt-0.5">{l.details}</p>}
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{formatDateTime(l.createdAt)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* Edit modal */}
      {editing && (
        <HandlerForm handler={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load() }} />
      )}
      {createOpen && (
        <HandlerForm onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await load() }} />
      )}
    </>
  )
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`bg-white border rounded-xl p-4 shadow-sm flex items-center gap-3 ${highlight ? 'border-amber-300 ring-1 ring-amber-200' : 'border-slate-200'}`}>
      <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center">{icon}</div>
      <div><p className="text-2xl font-black text-slate-900 leading-none">{value}</p><p className="text-xs text-slate-500 mt-1">{label}</p></div>
    </div>
  )
}

function HandlerIdentity({ h }: { h: Handler }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white font-black flex-shrink-0">
        {h.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="font-bold text-slate-900 text-sm truncate flex items-center gap-1.5">{h.name} <span>{FLAG[h.country] ?? ''}</span></p>
        <p className="text-xs text-slate-500 truncate">{h.email}{h.whatsappPhone ? ` · ${h.whatsappPhone}` : ''}</p>
      </div>
    </div>
  )
}

function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button title={title} onClick={onClick}
      className={`p-2 rounded-lg border transition-colors ${danger ? 'text-red-500 border-red-200 hover:bg-red-50' : 'text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
      {children}
    </button>
  )
}

function HandlerForm({ handler, onClose, onSaved }: { handler?: Handler; onClose: () => void; onSaved: () => void }) {
  const editing = !!handler
  const [name, setName] = useState(handler?.name ?? '')
  const [email, setEmail] = useState(handler?.email ?? '')
  const [whatsapp, setWhatsapp] = useState(handler?.whatsappPhone ?? '')
  const [country, setCountry] = useState(handler?.country ?? 'ALL')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const INPUT = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500'

  async function save() {
    if (!name.trim() || !email.trim()) { toast.error('Name and email are required'); return }
    if (!editing && password.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setSaving(true)
    try {
      const body: Record<string, unknown> = { name: name.trim(), email: email.trim(), whatsappPhone: whatsapp.trim(), country }
      if (password) body.password = password
      const res = await fetch(editing ? `/api/admin/file-handlers/${handler!.id}` : '/api/admin/file-handlers', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(editing ? 'Handler updated' : 'Handler created')
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${handler!.name}` : 'New File Handler'}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} {editing ? 'Save' : 'Create'}
          </button>
        </div>
      }>
      <div className="space-y-3">
        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label><input className={INPUT} value={name} onChange={e => setName(e.target.value)} /></div>
        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email</label><input type="email" className={INPUT} value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">WhatsApp / Phone</label><input className={INPUT} value={whatsapp} onChange={e => setWhatsapp(e.target.value)} /></div>
        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">Country</label>
          <select className={INPUT} value={country} onChange={e => setCountry(e.target.value)}>
            {COUNTRIES.map(c => <option key={c} value={c}>{FLAG[c]} {c.replace(/_/g, ' / ')}</option>)}
          </select>
        </div>
        <div><label className="block text-xs font-bold text-slate-500 uppercase mb-1">{editing ? 'Reset password (optional)' : 'Password'}</label>
          <input type="password" className={INPUT} value={password} onChange={e => setPassword(e.target.value)} placeholder={editing ? 'Leave blank to keep current' : 'Min 6 characters'} />
        </div>
      </div>
    </Modal>
  )
}
