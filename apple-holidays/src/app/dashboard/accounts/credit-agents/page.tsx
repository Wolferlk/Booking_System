'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Loader2, Plus, Edit2, Trash2, DollarSign, Calendar,
  ChevronDown, ChevronUp, Users, TrendingUp, Clock, CheckCircle2,
  AlertTriangle, Download, X,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { useSession } from 'next-auth/react'

type CreditPaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

type CreditAgentPayment = {
  id: string
  periodStart: string
  periodEnd: string
  dueDate: string
  bookingRefs: string | null
  amountDue: number
  amountPaid: number
  currency: string
  status: CreditPaymentStatus
  paidAt: string | null
  reference: string | null
  notes: string | null
  processedBy?: { id: string; name: string } | null
  createdAt: string
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
  payments: CreditAgentPayment[]
  _count?: { payments: number }
  createdAt: string
}

const STATUS_COLORS: Record<CreditPaymentStatus, string> = {
  PENDING:  'bg-yellow-100 text-yellow-700',
  PARTIAL:  'bg-blue-100 text-blue-700',
  PAID:     'bg-green-100 text-green-700',
  OVERDUE:  'bg-red-100 text-red-700',
}

// Compute next 15th and 30th due dates
function getNextDueDates(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const results: string[] = []
  const d15 = new Date(year, month, 15)
  const d30 = new Date(year, month, 30)
  if (d15 > now) results.push(d15.toISOString().slice(0, 10))
  else results.push(new Date(year, month + 1, 15).toISOString().slice(0, 10))
  if (d30 > now) results.push(d30.toISOString().slice(0, 10))
  else results.push(new Date(year, month + 1, 30).toISOString().slice(0, 10))
  return results
}

const EMPTY_AGENT = { name: '', aliases: '', contactName: '', contactEmail: '', contactPhone: '', creditLimit: '', currency: 'USD', notes: '' }
const EMPTY_PAYMENT = { periodStart: '', periodEnd: '', dueDate: '', bookingRefs: '', amountDue: '', amountPaid: '', currency: 'USD', status: 'PENDING' as CreditPaymentStatus, paidAt: '', reference: '', notes: '' }

export default function CreditAgentsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role ?? ''
  const canEdit = ['AC_USER', 'SUPER_ADMIN'].includes(role)

  const [agents, setAgents] = useState<CreditAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [agentPayments, setAgentPayments] = useState<Record<string, CreditAgentPayment[]>>({})
  const [loadingPayments, setLoadingPayments] = useState<string | null>(null)

  // Agent modal
  const [agentModal, setAgentModal] = useState(false)
  const [editingAgent, setEditingAgent] = useState<CreditAgent | null>(null)
  const [agentForm, setAgentForm] = useState(EMPTY_AGENT)
  const [savingAgent, setSavingAgent] = useState(false)

  // Payment modal
  const [paymentModal, setPaymentModal] = useState(false)
  const [paymentAgentId, setPaymentAgentId] = useState<string | null>(null)
  const [editingPayment, setEditingPayment] = useState<CreditAgentPayment | null>(null)
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT)
  const [savingPayment, setSavingPayment] = useState(false)

  const loadAgents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/credit-agents')
      const json = await res.json()
      if (json.success) setAgents(json.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAgents() }, [loadAgents])

  async function loadPayments(agentId: string) {
    if (agentPayments[agentId]) return
    setLoadingPayments(agentId)
    try {
      const res = await fetch(`/api/credit-agents/${agentId}/payments`)
      const json = await res.json()
      if (json.success) setAgentPayments(prev => ({ ...prev, [agentId]: json.data }))
    } finally { setLoadingPayments(null) }
  }

  function toggleExpand(agentId: string) {
    if (expandedId === agentId) { setExpandedId(null); return }
    setExpandedId(agentId)
    loadPayments(agentId)
  }

  function openAddAgent() {
    setEditingAgent(null)
    setAgentForm(EMPTY_AGENT)
    setAgentModal(true)
  }

  function openEditAgent(a: CreditAgent) {
    setEditingAgent(a)
    setAgentForm({
      name: a.name,
      aliases: a.aliases ? JSON.parse(a.aliases).join(', ') : '',
      contactName: a.contactName ?? '',
      contactEmail: a.contactEmail ?? '',
      contactPhone: a.contactPhone ?? '',
      creditLimit: a.creditLimit ? String(a.creditLimit) : '',
      currency: a.currency,
      notes: a.notes ?? '',
    })
    setAgentModal(true)
  }

  async function saveAgent() {
    setSavingAgent(true)
    try {
      const aliases = agentForm.aliases.split(',').map(s => s.trim()).filter(Boolean)
      const body = {
        ...agentForm,
        aliases: aliases.length ? aliases : null,
        creditLimit: agentForm.creditLimit ? Number(agentForm.creditLimit) : null,
      }
      const url = editingAgent ? `/api/credit-agents/${editingAgent.id}` : '/api/credit-agents'
      const method = editingAgent ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(editingAgent ? 'Agent updated' : 'Agent added')
      setAgentModal(false)
      await loadAgents()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSavingAgent(false) }
  }

  async function deleteAgent(id: string, name: string) {
    if (!confirm(`Delete credit agent "${name}"? All payment records will be removed.`)) return
    const res = await fetch(`/api/credit-agents/${id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) { toast.success('Agent deleted'); await loadAgents() }
    else toast.error(json.error ?? 'Delete failed')
  }

  function openAddPayment(agentId: string) {
    const dueDates = getNextDueDates()
    const now = new Date()
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
    setEditingPayment(null)
    setPaymentAgentId(agentId)
    setPaymentForm({
      ...EMPTY_PAYMENT,
      periodStart: firstOfMonth,
      periodEnd: lastOfMonth,
      dueDate: dueDates[0] || '',
      currency: agents.find(a => a.id === agentId)?.currency ?? 'USD',
    })
    setPaymentModal(true)
  }

  function openEditPayment(agentId: string, p: CreditAgentPayment) {
    setEditingPayment(p)
    setPaymentAgentId(agentId)
    setPaymentForm({
      periodStart: p.periodStart.slice(0, 10),
      periodEnd: p.periodEnd.slice(0, 10),
      dueDate: p.dueDate.slice(0, 10),
      bookingRefs: p.bookingRefs ? JSON.parse(p.bookingRefs).join(', ') : '',
      amountDue: String(p.amountDue),
      amountPaid: String(p.amountPaid),
      currency: p.currency,
      status: p.status,
      paidAt: p.paidAt ? p.paidAt.slice(0, 10) : '',
      reference: p.reference ?? '',
      notes: p.notes ?? '',
    })
    setPaymentModal(true)
  }

  async function savePayment() {
    if (!paymentAgentId) return
    setSavingPayment(true)
    try {
      const bookingRefs = paymentForm.bookingRefs.split(',').map(s => s.trim()).filter(Boolean)
      const body = {
        ...paymentForm,
        bookingRefs: bookingRefs.length ? bookingRefs : null,
        amountDue: Number(paymentForm.amountDue),
        amountPaid: Number(paymentForm.amountPaid || 0),
        paidAt: paymentForm.paidAt || null,
      }
      const url = editingPayment
        ? `/api/credit-agent-payments/${editingPayment.id}`
        : `/api/credit-agents/${paymentAgentId}/payments`
      const method = editingPayment ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(editingPayment ? 'Payment updated' : 'Payment added')
      setPaymentModal(false)
      // Refresh payments for this agent
      setAgentPayments(prev => { const next = { ...prev }; delete next[paymentAgentId]; return next })
      await loadPayments(paymentAgentId)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSavingPayment(false) }
  }

  async function deletePayment(agentId: string, paymentId: string) {
    if (!confirm('Delete this payment record?')) return
    const res = await fetch(`/api/credit-agent-payments/${paymentId}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) {
      toast.success('Payment deleted')
      setAgentPayments(prev => ({ ...prev, [agentId]: (prev[agentId] ?? []).filter(p => p.id !== paymentId) }))
    } else toast.error(json.error ?? 'Delete failed')
  }

  function downloadAgentReport(agent: CreditAgent) {
    const pmts = agentPayments[agent.id] ?? agent.payments ?? []
    if (!pmts.length) { toast.error('No payment data to export'); return }
    const headers = ['Period', 'Due Date', 'Amount Due', 'Amount Paid', 'Balance', 'Status', 'Reference', 'Paid At', 'Booking Refs']
    const rows = pmts.map(p => [
      `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}`,
      formatDate(p.dueDate),
      Number(p.amountDue).toFixed(2),
      Number(p.amountPaid).toFixed(2),
      (Number(p.amountDue) - Number(p.amountPaid)).toFixed(2),
      p.status,
      p.reference ?? '',
      p.paidAt ? formatDate(p.paidAt) : '',
      p.bookingRefs ? JSON.parse(p.bookingRefs).join(' | ') : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${agent.name.replace(/\s+/g, '_')}-payments-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  // Totals
  const totalOutstanding = agents.reduce((sum, a) => {
    const pmts = agentPayments[a.id] ?? a.payments ?? []
    return sum + pmts.filter(p => p.status !== 'PAID').reduce((s, p) => s + Number(p.amountDue) - Number(p.amountPaid), 0)
  }, 0)
  const totalOverdue = agents.reduce((sum, a) => {
    const pmts = agentPayments[a.id] ?? a.payments ?? []
    return sum + pmts.filter(p => p.status === 'OVERDUE').reduce((s, p) => s + Number(p.amountDue) - Number(p.amountPaid), 0)
  }, 0)

  return (
    <div>
      <Header
        title="Credit Agents"
        subtitle="Agents who pay on the 15th & 30th of each month"
        actions={
          canEdit ? (
            <button onClick={openAddAgent} className="btn btn-primary btn-sm">
              <Plus className="w-4 h-4" /> Add Agent
            </button>
          ) : undefined
        }
      />

      <div className="p-8 space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: Users, label: 'Total Agents', value: String(agents.length), color: 'text-brand-600', bg: 'bg-brand-50' },
            { icon: TrendingUp, label: 'Outstanding', value: formatCurrency(totalOutstanding), color: 'text-blue-600', bg: 'bg-blue-50' },
            { icon: AlertTriangle, label: 'Overdue', value: formatCurrency(totalOverdue), color: 'text-red-600', bg: 'bg-red-50' },
            { icon: Calendar, label: 'Next Due', value: getNextDueDates()[0] ? formatDate(getNextDueDates()[0]) : '—', color: 'text-slate-700', bg: 'bg-slate-50' },
          ].map(k => (
            <div key={k.label} className={`${k.bg} rounded-xl p-4 border border-white shadow-sm`}>
              <div className="flex items-center gap-2 mb-1">
                <k.icon className={`w-4 h-4 ${k.color}`} />
                <span className="text-xs text-slate-500 font-medium">{k.label}</span>
              </div>
              <div className={`text-xl font-bold ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Agents list */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
        ) : agents.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-sm">No credit agents yet. Add one to get started.</div>
        ) : (
          <div className="space-y-3">
            {agents.map(agent => {
              const pmts = agentPayments[agent.id] ?? agent.payments ?? []
              const totalDue  = pmts.reduce((s, p) => s + Number(p.amountDue), 0)
              const totalPaid = pmts.reduce((s, p) => s + Number(p.amountPaid), 0)
              const balance   = totalDue - totalPaid
              const hasOverdue = pmts.some(p => p.status === 'OVERDUE')
              const isExpanded = expandedId === agent.id
              const aliases: string[] = agent.aliases ? JSON.parse(agent.aliases) : []

              return (
                <Card key={agent.id} className={`transition-all ${!agent.isActive ? 'opacity-50' : ''}`}>
                  {/* Agent header row */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50 transition-colors rounded-xl"
                    onClick={() => toggleExpand(agent.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-brand-700 font-bold text-sm">{agent.name.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{agent.name}</span>
                          {!agent.isActive && <span className="text-[10px] bg-slate-200 text-slate-500 px-1.5 rounded">Inactive</span>}
                          {hasOverdue && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 rounded font-medium">OVERDUE</span>}
                        </div>
                        {aliases.length > 0 && (
                          <div className="text-xs text-slate-400 truncate">Also: {aliases.join(' · ')}</div>
                        )}
                        {agent.contactName && <div className="text-xs text-slate-400">{agent.contactName}</div>}
                      </div>
                    </div>

                    <div className="flex items-center gap-6 flex-shrink-0">
                      <div className="hidden sm:flex gap-6 text-xs text-right">
                        <div>
                          <div className="text-slate-400">Total Due</div>
                          <div className="font-semibold text-slate-800">{formatCurrency(totalDue, agent.currency)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Paid</div>
                          <div className="font-semibold text-green-600">{formatCurrency(totalPaid, agent.currency)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Balance</div>
                          <div className={`font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {balance > 0 ? formatCurrency(balance, agent.currency) : '✓'}
                          </div>
                        </div>
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEditAgent(agent)} className="p-1.5 text-slate-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => downloadAgentReport(agent)} className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors">
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {role === 'SUPER_ADMIN' && (
                            <button onClick={() => deleteAgent(agent.id, agent.name)} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}

                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </div>

                  {/* Expanded payments panel */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 px-4 pb-4">
                      {/* Agent details */}
                      {(agent.contactEmail || agent.contactPhone || agent.creditLimit) && (
                        <div className="flex flex-wrap gap-4 py-3 text-xs text-slate-500 border-b border-slate-100 mb-3">
                          {agent.contactEmail && <span>✉ {agent.contactEmail}</span>}
                          {agent.contactPhone && <span>☎ {agent.contactPhone}</span>}
                          {agent.creditLimit && <span>Credit Limit: <strong>{formatCurrency(agent.creditLimit, agent.currency)}</strong></span>}
                          {agent.notes && <span className="text-slate-400 italic">{agent.notes}</span>}
                        </div>
                      )}

                      {/* Payment history */}
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Payment History</h4>
                        {canEdit && (
                          <button onClick={() => openAddPayment(agent.id)} className="btn btn-primary btn-sm text-xs py-1">
                            <Plus className="w-3 h-3" /> Add Payment
                          </button>
                        )}
                      </div>

                      {loadingPayments === agent.id ? (
                        <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 text-brand-500 animate-spin" /></div>
                      ) : pmts.length === 0 ? (
                        <div className="text-xs text-slate-400 text-center py-6">No payment records yet</div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100">
                                {['Period', 'Due Date', 'Amount Due', 'Paid', 'Balance', 'Status', 'Reference', 'Booking Refs', ''].map(h => (
                                  <th key={h} className="text-left px-2 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {pmts.map(p => {
                                const bal = Number(p.amountDue) - Number(p.amountPaid)
                                const refs: string[] = p.bookingRefs ? JSON.parse(p.bookingRefs) : []
                                return (
                                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-2 py-2 text-slate-600 whitespace-nowrap">
                                      {formatDate(p.periodStart, 'dd MMM')} – {formatDate(p.periodEnd, 'dd MMM yyyy')}
                                    </td>
                                    <td className="px-2 py-2 whitespace-nowrap">
                                      <span className={new Date(p.dueDate) < new Date() && p.status !== 'PAID' ? 'text-red-600 font-medium' : 'text-slate-600'}>
                                        {formatDate(p.dueDate)}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 font-semibold">{formatCurrency(p.amountDue, p.currency)}</td>
                                    <td className="px-2 py-2 text-green-600">{formatCurrency(p.amountPaid, p.currency)}</td>
                                    <td className={`px-2 py-2 font-bold ${bal > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                      {bal > 0 ? formatCurrency(bal, p.currency) : '✓'}
                                    </td>
                                    <td className="px-2 py-2">
                                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${STATUS_COLORS[p.status]}`}>
                                        {p.status}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 font-mono text-slate-500">{p.reference || '—'}</td>
                                    <td className="px-2 py-2 text-slate-400 max-w-[140px] truncate">
                                      {refs.length ? refs.join(', ') : '—'}
                                    </td>
                                    <td className="px-2 py-2">
                                      {canEdit && (
                                        <div className="flex gap-1">
                                          <button onClick={() => openEditPayment(agent.id, p)} className="p-1 text-slate-400 hover:text-brand-600 transition-colors">
                                            <Edit2 className="w-3 h-3" />
                                          </button>
                                          <button onClick={() => deletePayment(agent.id, p.id)} className="p-1 text-slate-400 hover:text-red-600 transition-colors">
                                            <X className="w-3 h-3" />
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Agent Modal ── */}
      <Modal
        open={agentModal}
        onClose={() => setAgentModal(false)}
        title={editingAgent ? 'Edit Credit Agent' : 'Add Credit Agent'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAgentModal(false)}>Cancel</Button>
            <Button loading={savingAgent} onClick={saveAgent}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Agent Name *</label>
            <input className="form-input" value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} placeholder="Make My Trip" />
          </div>
          <div>
            <label className="form-label">Aliases <span className="text-slate-400 font-normal">(comma separated)</span></label>
            <input className="form-input" value={agentForm.aliases} onChange={e => setAgentForm(f => ({ ...f, aliases: e.target.value }))} placeholder="MMT, MakeMyTrip, makemytrip.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Contact Name</label>
              <input className="form-input" value={agentForm.contactName} onChange={e => setAgentForm(f => ({ ...f, contactName: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Contact Phone</label>
              <input className="form-input" value={agentForm.contactPhone} onChange={e => setAgentForm(f => ({ ...f, contactPhone: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Contact Email</label>
            <input type="email" className="form-input" value={agentForm.contactEmail} onChange={e => setAgentForm(f => ({ ...f, contactEmail: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Credit Limit</label>
              <input type="number" className="form-input" value={agentForm.creditLimit} onChange={e => setAgentForm(f => ({ ...f, creditLimit: e.target.value }))} placeholder="0.00" />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <select className="form-input" value={agentForm.currency} onChange={e => setAgentForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD', 'EUR', 'GBP', 'AUD', 'SGD', 'VND'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} value={agentForm.notes} onChange={e => setAgentForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── Payment Modal ── */}
      <Modal
        open={paymentModal}
        onClose={() => setPaymentModal(false)}
        title={editingPayment ? 'Edit Payment Record' : 'Add Payment Record'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentModal(false)}>Cancel</Button>
            <Button loading={savingPayment} onClick={savePayment}>Save</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Period Start *</label>
              <input type="date" className="form-input" value={paymentForm.periodStart} onChange={e => setPaymentForm(f => ({ ...f, periodStart: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Period End *</label>
              <input type="date" className="form-input" value={paymentForm.periodEnd} onChange={e => setPaymentForm(f => ({ ...f, periodEnd: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Due Date *</label>
              <input type="date" className="form-input" value={paymentForm.dueDate} onChange={e => setPaymentForm(f => ({ ...f, dueDate: e.target.value }))} />
              <p className="text-xs text-slate-400 mt-1">Next: {getNextDueDates().join(' or ')}</p>
            </div>
            <div>
              <label className="form-label">Status</label>
              <select className="form-input" value={paymentForm.status} onChange={e => setPaymentForm(f => ({ ...f, status: e.target.value as CreditPaymentStatus }))}>
                {(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as CreditPaymentStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Booking Refs <span className="text-slate-400 font-normal">(comma separated)</span></label>
            <input className="form-input" value={paymentForm.bookingRefs} onChange={e => setPaymentForm(f => ({ ...f, bookingRefs: e.target.value }))} placeholder="VN26001, VN26002, VN26003" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="form-label">Amount Due *</label>
              <input type="number" className="form-input" value={paymentForm.amountDue} onChange={e => setPaymentForm(f => ({ ...f, amountDue: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Amount Paid</label>
              <input type="number" className="form-input" value={paymentForm.amountPaid} onChange={e => setPaymentForm(f => ({ ...f, amountPaid: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <select className="form-input" value={paymentForm.currency} onChange={e => setPaymentForm(f => ({ ...f, currency: e.target.value }))}>
                {['USD', 'EUR', 'GBP', 'AUD', 'SGD', 'VND'].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Reference</label>
              <input className="form-input" value={paymentForm.reference} onChange={e => setPaymentForm(f => ({ ...f, reference: e.target.value }))} placeholder="Bank ref / transfer ID" />
            </div>
            <div>
              <label className="form-label">Paid At</label>
              <input type="date" className="form-input" value={paymentForm.paidAt} onChange={e => setPaymentForm(f => ({ ...f, paidAt: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-input" rows={2} value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
