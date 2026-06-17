'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Loader2, Plus, Edit2, Trash2, ChevronRight,
  Users, AlertTriangle, Calendar,
  TrendingUp, MoreVertical,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { useSession } from 'next-auth/react'

type CreditPaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

type AgentStats = {
  totalDue: number
  totalPaid: number
  outstanding: number
  overdue: number
  cycleCount: number
  nextDue: { dueDate: string; amountDue: number; amountPaid: number; status: CreditPaymentStatus } | null
  lastPayment: { dueDate: string; amountPaid: number } | null
}

type CreditAgent = {
  id: string
  name: string
  aliases: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  creditLimit: number | null
  currency: string
  notes: string | null
  isActive: boolean
  createdAt: string
  stats: AgentStats
}

const STATUS_PILL: Record<CreditPaymentStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  PARTIAL: 'bg-blue-100 text-blue-700 border border-blue-200',
  PAID:    'bg-green-100 text-green-700 border border-green-200',
  OVERDUE: 'bg-red-100 text-red-700 border border-red-200',
}

const EMPTY_FORM = {
  name: '', aliases: '', contactName: '', contactEmail: '',
  contactPhone: '', creditLimit: '', currency: 'USD', notes: '',
}

export default function CreditAgentsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const canEdit    = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const isSuperAdmin = role === 'SUPER_ADMIN'

  const [agents, setAgents]   = useState<CreditAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  // Agent modal state
  const [modal, setModal]           = useState(false)
  const [editing, setEditing]       = useState<CreditAgent | null>(null)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [saving, setSaving]         = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/credit-agents')
      const json = await res.json()
      if (json.success) setAgents(json.data)
      else toast.error(json.error ?? 'Failed to load')
    } catch { toast.error('Network error') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // Close menu on outside click
  useEffect(() => {
    const handler = () => setMenuOpen(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(a: CreditAgent, e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen(null)
    setEditing(a)
    setForm({
      name:         a.name,
      aliases:      a.aliases ? (JSON.parse(a.aliases) as string[]).join(', ') : '',
      contactName:  a.contactName  ?? '',
      contactEmail: a.contactEmail ?? '',
      contactPhone: a.contactPhone ?? '',
      creditLimit:  a.creditLimit  ? String(a.creditLimit) : '',
      currency:     a.currency,
      notes:        a.notes ?? '',
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Agent name is required'); return }
    setSaving(true)
    try {
      const aliases = form.aliases.split(',').map(s => s.trim()).filter(Boolean)
      const body = {
        name:         form.name.trim(),
        aliases:      aliases.length ? aliases : null,
        contactName:  form.contactName  || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
        creditLimit:  form.creditLimit ? Number(form.creditLimit) : null,
        currency:     form.currency,
        notes:        form.notes || null,
      }
      const url    = editing ? `/api/credit-agents/${editing.id}` : '/api/credit-agents'
      const method = editing ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(editing ? 'Agent updated' : 'Agent added')
      setModal(false)
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSaving(false) }
  }

  async function deleteAgent(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation()
    setMenuOpen(null)
    if (!confirm(`Permanently delete "${name}" and all their payment cycles?`)) return
    const res  = await fetch(`/api/credit-agents/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) { toast.success('Agent deleted'); await load() }
    else toast.error(json.error ?? 'Delete failed')
  }

  // Global KPIs across all agents
  const totalOutstanding = agents.reduce((s, a) => s + a.stats.outstanding, 0)
  const totalOverdue     = agents.reduce((s, a) => s + a.stats.overdue, 0)
  const totalPaid        = agents.reduce((s, a) => s + a.stats.totalPaid, 0)
  const activeAgents     = agents.filter(a => a.isActive).length

  // Next upcoming due date
  const upcomingDue = agents
    .flatMap(a => a.stats.nextDue ? [{ agent: a.name, ...a.stats.nextDue }] : [])
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0] ?? null

  return (
    <div>
      <Header
        title="Credit Agents"
        subtitle="Bulk settlement partners — pay on 15th & 30th each month"
        actions={
          canEdit ? (
            <button onClick={openAdd} className="btn btn-primary btn-sm">
              <Plus className="w-4 h-4" /> Add Agent
            </button>
          ) : undefined
        }
      />

      <div className="p-8 space-y-6 max-w-7xl">

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Users}         color="brand"  label="Active Agents"   value={String(activeAgents)} />
          <KpiCard icon={TrendingUp}    color="blue"   label="Total Paid"      value={formatCurrency(totalPaid)} />
          <KpiCard icon={AlertTriangle} color="orange" label="Outstanding"     value={formatCurrency(totalOutstanding)} />
          <KpiCard icon={AlertTriangle} color="red"    label="Overdue"         value={formatCurrency(totalOverdue)} warn={totalOverdue > 0} />
        </div>

        {/* Next due callout */}
        {upcomingDue && (
          <div className="flex items-center gap-3 px-5 py-3.5 bg-amber-50 border border-amber-200 rounded-xl text-sm">
            <Calendar className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span className="text-amber-800">
              Next payment due: <strong>{upcomingDue.agent}</strong> —{' '}
              <strong>{formatCurrency(Number(upcomingDue.amountDue) - Number(upcomingDue.amountPaid))}</strong> on{' '}
              <strong>{formatDate(upcomingDue.dueDate)}</strong>
            </span>
          </div>
        )}

        {/* ── Agents list ── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No credit agents yet.</p>
            {canEdit && (
              <button onClick={openAdd} className="mt-3 text-brand-600 text-sm hover:underline">+ Add your first agent</button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {agents.map(agent => {
              const { stats } = agent
              const aliases: string[] = agent.aliases ? JSON.parse(agent.aliases) : []
              const hasOverdue = stats.overdue > 0

              return (
                <Card
                  key={agent.id}
                  className={`cursor-pointer hover:shadow-md transition-all ${!agent.isActive ? 'opacity-60' : ''}`}
                  onClick={() => router.push(`/dashboard/accounts/credit-agents/${agent.id}`)}
                >
                  <div className="flex items-center gap-4 p-5">
                    {/* Avatar */}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${hasOverdue ? 'bg-red-500' : 'bg-brand-500'}`}>
                      {agent.name.slice(0, 2).toUpperCase()}
                    </div>

                    {/* Name + aliases */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{agent.name}</span>
                        {!agent.isActive && (
                          <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full">Inactive</span>
                        )}
                        {hasOverdue && (
                          <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-semibold">OVERDUE</span>
                        )}
                        {stats.nextDue && stats.nextDue.status !== 'PAID' && !hasOverdue && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${STATUS_PILL[stats.nextDue.status]}`}>
                            {stats.nextDue.status}
                          </span>
                        )}
                      </div>
                      {aliases.length > 0 && (
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          Also known as: {aliases.join(' · ')}
                        </div>
                      )}
                      {agent.contactName && (
                        <div className="text-xs text-slate-400">{agent.contactName}</div>
                      )}
                    </div>

                    {/* Stats strip */}
                    <div className="hidden md:flex items-center gap-8 text-right flex-shrink-0">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Total Billed</div>
                        <div className="text-sm font-semibold text-slate-800">{formatCurrency(stats.totalDue, agent.currency)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Paid</div>
                        <div className="text-sm font-semibold text-green-600">{formatCurrency(stats.totalPaid, agent.currency)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Outstanding</div>
                        <div className={`text-sm font-bold ${stats.outstanding > 0 ? (hasOverdue ? 'text-red-600' : 'text-orange-500') : 'text-green-600'}`}>
                          {stats.outstanding > 0 ? formatCurrency(stats.outstanding, agent.currency) : '✓ Clear'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Cycles</div>
                        <div className="text-sm font-semibold text-slate-700">{stats.cycleCount}</div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0 ml-2" onClick={e => e.stopPropagation()}>
                      {canEdit && (
                        <div className="relative">
                          <button
                            onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === agent.id ? null : agent.id) }}
                            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>
                          {menuOpen === agent.id && (
                            <div className="absolute right-0 top-8 z-20 w-44 bg-white border border-slate-200 rounded-xl shadow-xl py-1">
                              <button onClick={e => openEdit(agent, e)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                                <Edit2 className="w-3.5 h-3.5" /> Edit Agent
                              </button>
                              {isSuperAdmin && (
                                <button onClick={e => deleteAgent(agent.id, agent.name, e)} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
                                  <Trash2 className="w-3.5 h-3.5" /> Delete Agent
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>
                  </div>

                  {/* Mobile stats */}
                  <div className="md:hidden grid grid-cols-3 gap-0 border-t border-slate-100 text-center text-xs">
                    {[
                      { label: 'Billed', value: formatCurrency(stats.totalDue, agent.currency) },
                      { label: 'Paid',   value: formatCurrency(stats.totalPaid, agent.currency) },
                      { label: 'Owed',   value: stats.outstanding > 0 ? formatCurrency(stats.outstanding, agent.currency) : '✓' },
                    ].map(s => (
                      <div key={s.label} className="py-2 px-3 border-r border-slate-100 last:border-0">
                        <div className="text-slate-400">{s.label}</div>
                        <div className="font-semibold text-slate-700 mt-0.5">{s.value}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit Agent Modal ── */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Credit Agent'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>
              {editing ? 'Save Changes' : 'Add Agent'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Agent Name *</label>
            <input
              className="form-input"
              placeholder="e.g. Make My Trip"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">
              Aliases
              <span className="ml-1 text-slate-400 font-normal text-xs">(comma separated — used for automatic booking matching)</span>
            </label>
            <input
              className="form-input"
              placeholder="MMT, MakeMyTrip, makemytrip.com"
              value={form.aliases}
              onChange={e => setForm(f => ({ ...f, aliases: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Contact Name</label>
              <input className="form-input" value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Contact Phone</label>
              <input className="form-input" value={form.contactPhone} onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Contact Email</label>
            <input type="email" className="form-input" value={form.contactEmail} onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Credit Limit</label>
              <input type="number" min="0" className="form-input" placeholder="Unlimited" value={form.creditLimit} onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <select className="form-input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD', 'EUR', 'GBP', 'AUD', 'SGD', 'VND'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Helpers

type ColorKey = 'brand' | 'blue' | 'orange' | 'red' | 'green'

function KpiCard({
  icon: Icon, color, label, value, warn = false,
}: { icon: React.ComponentType<{ className?: string }>; color: ColorKey; label: string; value: string; warn?: boolean }) {
  const palettes: Record<ColorKey, { bg: string; icon: string; text: string }> = {
    brand:  { bg: 'bg-brand-50  border-brand-100',  icon: 'text-brand-500',  text: 'text-brand-700' },
    blue:   { bg: 'bg-blue-50   border-blue-100',   icon: 'text-blue-500',   text: 'text-blue-700'  },
    orange: { bg: 'bg-orange-50 border-orange-100', icon: 'text-orange-500', text: 'text-orange-700'},
    red:    { bg: 'bg-red-50    border-red-100',    icon: 'text-red-500',    text: 'text-red-700'   },
    green:  { bg: 'bg-green-50  border-green-100',  icon: 'text-green-500',  text: 'text-green-700' },
  }
  const p = palettes[color]
  return (
    <div className={`${p.bg} border rounded-xl p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${p.icon}`} />
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        {warn && <AlertTriangle className="w-3 h-3 text-red-500 ml-auto" />}
      </div>
      <div className={`text-xl font-bold ${p.text}`}>{value}</div>
    </div>
  )
}
