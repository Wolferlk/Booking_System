'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Loader2, Plus, Edit2, Trash2, ArrowLeft, Download,
  Building2, Phone, Mail, DollarSign, Calendar, FileText,
  CheckCircle2, Clock, AlertTriangle, TrendingUp, Users,
  ExternalLink,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { useSession } from 'next-auth/react'

// ── Types ──────────────────────────────────────────────────────────────────

type CreditPaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

type PaymentCycle = {
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
  processedBy: { id: string; name: string } | null
  createdAt: string
}

type AgentBooking = {
  id: string
  bookingRef: string
  agent: string | null
  fileHandler: string | null
  status: string
  arrivalDate: string
  departureDate: string
  paxAdults: number
  paxChildren: number
  quotedTotal: number
  currency: string
  confirmedPaid: number
  balance: number
  hasPnl: boolean
  leadPassenger: string | null
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
  payments: PaymentCycle[]
  stats: { totalDue: number; totalPaid: number; outstanding: number; overdue: number }
}

const STATUS_CONFIG: Record<CreditPaymentStatus, { label: string; pill: string; icon: React.ComponentType<{ className?: string }> }> = {
  PENDING: { label: 'Pending',  pill: 'bg-yellow-100 text-yellow-700 border border-yellow-200', icon: Clock },
  PARTIAL: { label: 'Partial',  pill: 'bg-blue-100   text-blue-700   border border-blue-200',   icon: TrendingUp },
  PAID:    { label: 'Paid',     pill: 'bg-green-100  text-green-700  border border-green-200',  icon: CheckCircle2 },
  OVERDUE: { label: 'Overdue',  pill: 'bg-red-100    text-red-700    border border-red-200',    icon: AlertTriangle },
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getNextDueDates(): { label: string; value: string }[] {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()
  const results: { label: string; value: string }[] = []

  const candidates = [
    new Date(year, month, 15),
    new Date(year, month, 30),
    new Date(year, month + 1, 15),
    new Date(year, month + 1, 30),
  ]
  for (const d of candidates) {
    if (d > now) {
      results.push({ label: formatDate(d.toISOString(), 'dd MMM yyyy'), value: d.toISOString().slice(0, 10) })
      if (results.length === 2) break
    }
  }
  return results
}

function firstOfMonth(offset = 0) {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).toISOString().slice(0, 10)
}
function lastOfMonth(offset = 0) {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + offset + 1, 0).toISOString().slice(0, 10)
}

// ── Component ──────────────────────────────────────────────────────────────

const EMPTY_CYCLE = {
  periodStart: firstOfMonth(), periodEnd: lastOfMonth(), dueDate: '',
  bookingRefs: '', amountDue: '', amountPaid: '0', currency: 'USD',
  status: 'PENDING' as CreditPaymentStatus, paidAt: '', reference: '', notes: '',
}

type Tab = 'overview' | 'cycles' | 'bookings'

export default function CreditAgentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router  = useRouter()
  const { data: session } = useSession()
  const role        = session?.user?.role ?? ''
  const canEdit     = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const isSuperAdmin = role === 'SUPER_ADMIN'

  const [agent,    setAgent]    = useState<CreditAgent | null>(null)
  const [bookings, setBookings] = useState<AgentBooking[]>([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState<Tab>('overview')

  // Cycle modal
  const [cycleModal,   setCycleModal]   = useState(false)
  const [editingCycle, setEditingCycle] = useState<PaymentCycle | null>(null)
  const [cycleForm,    setCycleForm]    = useState(EMPTY_CYCLE)
  const [savingCycle,  setSavingCycle]  = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────

  const loadAgent = useCallback(async () => {
    const res  = await fetch(`/api/credit-agents/${id}`)
    const json = await res.json()
    if (json.success) setAgent(json.data)
    else toast.error(json.error ?? 'Failed to load agent')
  }, [id])

  const loadBookings = useCallback(async () => {
    const res  = await fetch(`/api/credit-agents/${id}/bookings`)
    const json = await res.json()
    if (json.success) setBookings(json.data)
  }, [id])

  useEffect(() => {
    Promise.all([loadAgent(), loadBookings()]).finally(() => setLoading(false))
  }, [loadAgent, loadBookings])

  // ── Cycle actions ────────────────────────────────────────────────────────

  function openAddCycle() {
    const dueDates = getNextDueDates()
    setEditingCycle(null)
    setCycleForm({
      ...EMPTY_CYCLE,
      dueDate:  dueDates[0]?.value ?? '',
      currency: agent?.currency ?? 'USD',
    })
    setCycleModal(true)
  }

  function openEditCycle(cycle: PaymentCycle) {
    setEditingCycle(cycle)
    setCycleForm({
      periodStart: cycle.periodStart.slice(0, 10),
      periodEnd:   cycle.periodEnd.slice(0, 10),
      dueDate:     cycle.dueDate.slice(0, 10),
      bookingRefs: cycle.bookingRefs ? (JSON.parse(cycle.bookingRefs) as string[]).join(', ') : '',
      amountDue:   String(cycle.amountDue),
      amountPaid:  String(cycle.amountPaid),
      currency:    cycle.currency,
      status:      cycle.status,
      paidAt:      cycle.paidAt ? cycle.paidAt.slice(0, 10) : '',
      reference:   cycle.reference ?? '',
      notes:       cycle.notes ?? '',
    })
    setCycleModal(true)
  }

  async function saveCycle() {
    if (!cycleForm.periodStart || !cycleForm.periodEnd || !cycleForm.dueDate) {
      toast.error('Period start, end and due date are required')
      return
    }
    if (!cycleForm.amountDue || Number(cycleForm.amountDue) <= 0) {
      toast.error('Amount due must be greater than 0')
      return
    }
    setSavingCycle(true)
    try {
      const refs = cycleForm.bookingRefs.split(',').map(s => s.trim()).filter(Boolean)
      const body = {
        periodStart: cycleForm.periodStart,
        periodEnd:   cycleForm.periodEnd,
        dueDate:     cycleForm.dueDate,
        bookingRefs: refs,
        amountDue:   Number(cycleForm.amountDue),
        amountPaid:  Number(cycleForm.amountPaid || 0),
        currency:    cycleForm.currency,
        status:      cycleForm.status || undefined,  // let API auto-derive if not set
        paidAt:      cycleForm.paidAt || null,
        reference:   cycleForm.reference || null,
        notes:       cycleForm.notes || null,
      }
      const url    = editingCycle ? `/api/credit-agent-payments/${editingCycle.id}` : `/api/credit-agents/${id}/payments`
      const method = editingCycle ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(editingCycle ? 'Cycle updated' : 'Payment cycle created')
      setCycleModal(false)
      await loadAgent()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally { setSavingCycle(false) }
  }

  async function deleteCycle(cycleId: string) {
    if (!confirm('Delete this payment cycle?')) return
    const res  = await fetch(`/api/credit-agent-payments/${cycleId}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) { toast.success('Cycle deleted'); await loadAgent() }
    else toast.error(json.error ?? 'Delete failed')
  }

  async function markPaid(cycle: PaymentCycle) {
    const ref = prompt('Enter payment reference (bank transfer ID, etc.):')
    if (ref === null) return
    setSavingCycle(true)
    try {
      const res  = await fetch(`/api/credit-agent-payments/${cycle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountPaid: Number(cycle.amountDue),
          status: 'PAID',
          paidAt: new Date().toISOString().slice(0, 10),
          reference: ref || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Marked as fully paid')
      await loadAgent()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setSavingCycle(false) }
  }

  // ── CSV export ───────────────────────────────────────────────────────────

  function exportCycles() {
    if (!agent?.payments.length) { toast.error('No cycle data to export'); return }
    const headers = ['Period', 'Due Date', 'Amount Due', 'Amount Paid', 'Balance', 'Status', 'Paid At', 'Reference', 'Booking Refs', 'Notes']
    const rows = agent.payments.map(c => {
      const refs: string[] = c.bookingRefs ? JSON.parse(c.bookingRefs) : []
      return [
        `${formatDate(c.periodStart, 'dd MMM yyyy')} – ${formatDate(c.periodEnd, 'dd MMM yyyy')}`,
        formatDate(c.dueDate),
        Number(c.amountDue).toFixed(2),
        Number(c.amountPaid).toFixed(2),
        (Number(c.amountDue) - Number(c.amountPaid)).toFixed(2),
        c.status,
        c.paidAt ? formatDate(c.paidAt) : '',
        c.reference ?? '',
        refs.join(' | '),
        c.notes ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    })
    const csv  = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a    = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(blob),
      download: `${agent.name.replace(/\s+/g, '_')}-cycles-${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
    toast.success('Report exported')
  }

  function exportBookings() {
    if (!bookings.length) { toast.error('No booking data to export'); return }
    const headers = ['Booking Ref', 'Lead Pax', 'File Handler', 'Status', 'Arrival', 'Departure', 'Pax', 'Quoted', 'Paid', 'Balance']
    const rows = bookings.map(b => [
      b.bookingRef, b.leadPassenger ?? '', b.fileHandler ?? '', b.status,
      b.arrivalDate ? formatDate(b.arrivalDate) : '',
      b.departureDate ? formatDate(b.departureDate) : '',
      b.paxAdults + b.paxChildren,
      b.quotedTotal.toFixed(2), b.confirmedPaid.toFixed(2), b.balance.toFixed(2),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const csv  = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `${agent?.name.replace(/\s+/g, '_')}-bookings-${new Date().toISOString().slice(0, 10)}.csv`,
    })
    a.click()
    toast.success('Bookings exported')
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
    </div>
  )

  if (!agent) return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
      <p>Agent not found</p>
      <button onClick={() => router.back()} className="mt-3 text-brand-600 text-sm hover:underline">Go back</button>
    </div>
  )

  const aliases: string[]   = agent.aliases ? JSON.parse(agent.aliases) : []
  const cycles               = agent.payments
  const { stats }            = agent
  const pendingCycles        = cycles.filter(c => c.status !== 'PAID')
  const paidCycles           = cycles.filter(c => c.status === 'PAID')

  // Booking stats
  const totalBookingValue    = bookings.reduce((s, b) => s + b.quotedTotal, 0)
  const totalBookingPaid     = bookings.reduce((s, b) => s + b.confirmedPaid, 0)
  const totalBookingBalance  = bookings.reduce((s, b) => s + b.balance, 0)

  return (
    <div>
      <Header
        title={agent.name}
        subtitle={aliases.length ? `Also: ${aliases.join(' · ')}` : 'Credit Agent'}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => router.push('/dashboard/accounts/credit-agents')} className="btn btn-ghost btn-sm">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={exportCycles} className="btn btn-secondary btn-sm">
              <Download className="w-4 h-4" /> Export
            </button>
            {canEdit && (
              <button onClick={openAddCycle} className="btn btn-primary btn-sm">
                <Plus className="w-4 h-4" /> New Cycle
              </button>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-7xl">

        {/* ── Stats bar ── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { label: 'Total Billed',  value: formatCurrency(stats.totalDue,    agent.currency), color: 'text-slate-800' },
            { label: 'Total Paid',    value: formatCurrency(stats.totalPaid,   agent.currency), color: 'text-green-600' },
            { label: 'Outstanding',   value: formatCurrency(stats.outstanding, agent.currency), color: stats.outstanding > 0 ? 'text-orange-500' : 'text-green-600' },
            { label: 'Overdue',       value: formatCurrency(stats.overdue,     agent.currency), color: stats.overdue > 0 ? 'text-red-600 font-bold' : 'text-slate-400' },
            { label: 'Total Bookings',value: String(bookings.length),                           color: 'text-brand-600' },
          ].map(s => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
              <div className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{s.label}</div>
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Tabs ── */}
        <div className="border-b border-slate-200">
          <nav className="flex gap-1">
            {([
              { key: 'overview',  label: 'Overview' },
              { key: 'cycles',    label: `Payment Cycles (${cycles.length})` },
              { key: 'bookings',  label: `Bookings (${bookings.length})` },
            ] as { key: Tab; label: string }[]).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.key
                    ? 'border-brand-500 text-brand-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ══ TAB: OVERVIEW ══════════════════════════════════════════════════ */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* Agent info */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-slate-400" /> Agent Details
                </h3>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <InfoRow icon={Building2} label="Name"  value={agent.name} />
                {aliases.length > 0 && <InfoRow icon={Building2} label="Aliases" value={aliases.join(', ')} />}
                {agent.contactName  && <InfoRow icon={Users}    label="Contact" value={agent.contactName} />}
                {agent.contactEmail && <InfoRow icon={Mail}     label="Email"   value={agent.contactEmail} />}
                {agent.contactPhone && <InfoRow icon={Phone}    label="Phone"   value={agent.contactPhone} />}
                {agent.creditLimit  && (
                  <InfoRow icon={DollarSign} label="Credit Limit" value={formatCurrency(agent.creditLimit, agent.currency)} />
                )}
                {agent.notes && (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 italic">{agent.notes}</div>
                )}
                <div className="pt-2 border-t border-slate-100 text-xs text-slate-400">
                  Added {formatDate(agent.createdAt)}
                </div>
              </CardBody>
            </Card>

            {/* Pending / overdue cycles */}
            <Card className="lg:col-span-2">
              <CardHeader
                action={
                  canEdit ? (
                    <button onClick={openAddCycle} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
                      <Plus className="w-3 h-3" /> New Cycle
                    </button>
                  ) : undefined
                }
              >
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" /> Open Cycles
                </h3>
              </CardHeader>
              <CardBody className="p-0">
                {pendingCycles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <CheckCircle2 className="w-8 h-8 mb-2 text-green-300" />
                    <p className="text-sm">All settled — no open cycles</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {pendingCycles.map(cycle => {
                      const balance   = Number(cycle.amountDue) - Number(cycle.amountPaid)
                      const isOverdue = cycle.status === 'OVERDUE'
                      const cfg       = STATUS_CONFIG[cycle.status]
                      const Icon      = cfg.icon
                      const refs: string[] = cycle.bookingRefs ? JSON.parse(cycle.bookingRefs) : []

                      return (
                        <div key={cycle.id} className={`px-5 py-4 ${isOverdue ? 'bg-red-50' : ''}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.pill}`}>
                                  <Icon className="w-3 h-3" /> {cfg.label}
                                </span>
                                <span className="text-xs text-slate-500">
                                  Due {formatDate(cycle.dueDate)}
                                  {isOverdue && <span className="ml-1 text-red-600 font-semibold">— OVERDUE</span>}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                Period: {formatDate(cycle.periodStart, 'dd MMM')} – {formatDate(cycle.periodEnd, 'dd MMM yyyy')}
                              </div>
                              {refs.length > 0 && (
                                <div className="mt-1 text-xs text-slate-400">
                                  Bookings: {refs.join(', ')}
                                </div>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className="text-xs text-slate-400">Balance</div>
                              <div className={`text-base font-bold ${isOverdue ? 'text-red-600' : 'text-orange-500'}`}>
                                {formatCurrency(balance, cycle.currency)}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {formatCurrency(Number(cycle.amountPaid), cycle.currency)} paid of {formatCurrency(Number(cycle.amountDue), cycle.currency)}
                              </div>
                            </div>
                          </div>
                          {canEdit && (
                            <div className="flex gap-2 mt-3">
                              <button
                                onClick={() => markPaid(cycle)}
                                className="btn btn-primary btn-sm text-xs py-1"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Mark Paid
                              </button>
                              <button onClick={() => openEditCycle(cycle)} className="btn btn-secondary btn-sm text-xs py-1">
                                <Edit2 className="w-3 h-3" /> Edit
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Recent paid cycles */}
            {paidCycles.length > 0 && (
              <Card className="lg:col-span-3">
                <CardHeader>
                  <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" /> Recent Settled Cycles
                  </h3>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y divide-slate-100">
                    {paidCycles.slice(0, 5).map(cycle => (
                      <div key={cycle.id} className="flex items-center gap-4 px-5 py-3">
                        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                        <div className="flex-1 text-xs text-slate-500">
                          {formatDate(cycle.periodStart, 'dd MMM')} – {formatDate(cycle.periodEnd, 'dd MMM yyyy')}
                        </div>
                        <div className="text-xs text-slate-400">{cycle.reference}</div>
                        <div className="text-xs font-semibold text-green-600">{formatCurrency(Number(cycle.amountPaid), cycle.currency)}</div>
                        <div className="text-xs text-slate-400">{cycle.paidAt ? formatDate(cycle.paidAt) : ''}</div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        )}

        {/* ══ TAB: PAYMENT CYCLES ════════════════════════════════════════════ */}
        {tab === 'cycles' && (
          <Card>
            <CardHeader
              action={
                <div className="flex items-center gap-2">
                  <button onClick={exportCycles} className="text-xs text-slate-500 hover:text-brand-600 flex items-center gap-1">
                    <Download className="w-3 h-3" /> CSV
                  </button>
                  {canEdit && (
                    <button onClick={openAddCycle} className="btn btn-primary btn-sm text-xs">
                      <Plus className="w-3.5 h-3.5" /> New Cycle
                    </button>
                  )}
                </div>
              }
            >
              <h3 className="text-sm font-semibold text-slate-900">
                All Payment Cycles
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {cycles.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">
                  No payment cycles yet.
                  {canEdit && (
                    <button onClick={openAddCycle} className="ml-2 text-brand-600 hover:underline">Create the first one</button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                        <Th>Period</Th>
                        <Th>Due Date</Th>
                        <Th>Amount Due</Th>
                        <Th>Paid</Th>
                        <Th>Balance</Th>
                        <Th>Status</Th>
                        <Th>Reference</Th>
                        <Th>Booking Refs</Th>
                        {canEdit && <Th></Th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cycles.map(cycle => {
                        const balance   = Number(cycle.amountDue) - Number(cycle.amountPaid)
                        const isOverdue = cycle.status === 'OVERDUE'
                        const cfg       = STATUS_CONFIG[cycle.status]
                        const Icon      = cfg.icon
                        const refs: string[] = cycle.bookingRefs ? JSON.parse(cycle.bookingRefs) : []

                        return (
                          <tr key={cycle.id} className={`hover:bg-slate-50 transition-colors ${isOverdue ? 'bg-red-50/40' : ''}`}>
                            <Td>
                              {formatDate(cycle.periodStart, 'dd MMM')}–{formatDate(cycle.periodEnd, 'dd MMM yyyy')}
                            </Td>
                            <Td className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                              {formatDate(cycle.dueDate)}
                            </Td>
                            <Td className="font-semibold">{formatCurrency(Number(cycle.amountDue), cycle.currency)}</Td>
                            <Td className="text-green-600">{formatCurrency(Number(cycle.amountPaid), cycle.currency)}</Td>
                            <Td className={`font-bold ${balance > 0 ? (isOverdue ? 'text-red-600' : 'text-orange-500') : 'text-green-600'}`}>
                              {balance > 0 ? formatCurrency(balance, cycle.currency) : '✓ Clear'}
                            </Td>
                            <Td>
                              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.pill}`}>
                                <Icon className="w-3 h-3" /> {cfg.label}
                              </span>
                            </Td>
                            <Td className="font-mono text-slate-500 text-xs">{cycle.reference || '—'}</Td>
                            <Td className="text-slate-400 text-xs max-w-[180px] truncate">
                              {refs.length ? refs.join(', ') : '—'}
                            </Td>
                            {canEdit && (
                              <Td>
                                <div className="flex items-center gap-1">
                                  {cycle.status !== 'PAID' && (
                                    <button
                                      onClick={() => markPaid(cycle)}
                                      title="Mark as paid"
                                      className="p-1.5 rounded text-slate-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    onClick={() => openEditCycle(cycle)}
                                    className="p-1.5 rounded text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => deleteCycle(cycle.id)}
                                    className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </Td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                      <tr className="text-xs font-semibold text-slate-700">
                        <td colSpan={2} className="px-4 py-2.5">Totals ({cycles.length} cycles)</td>
                        <td className="px-3 py-2.5">{formatCurrency(stats.totalDue,  agent.currency)}</td>
                        <td className="px-3 py-2.5 text-green-600">{formatCurrency(stats.totalPaid, agent.currency)}</td>
                        <td className={`px-3 py-2.5 ${stats.outstanding > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                          {formatCurrency(stats.outstanding, agent.currency)}
                        </td>
                        <td colSpan={canEdit ? 4 : 3}></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {/* ══ TAB: BOOKINGS ══════════════════════════════════════════════════ */}
        {tab === 'bookings' && (
          <Card>
            <CardHeader
              action={
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <button onClick={exportBookings} className="hover:text-brand-600 flex items-center gap-1">
                    <Download className="w-3 h-3" /> CSV
                  </button>
                  <span>|</span>
                  <span>{bookings.length} bookings · {formatCurrency(totalBookingValue, agent.currency)} total</span>
                </div>
              }
            >
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" /> Bookings from {agent.name}
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              {bookings.length === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">
                  No bookings found matching this agent
                </div>
              ) : (
                <>
                  {/* Booking stats strip */}
                  <div className="grid grid-cols-3 gap-0 border-b border-slate-100 bg-slate-50">
                    {[
                      { label: 'Total Value',  value: formatCurrency(totalBookingValue,   agent.currency), color: 'text-slate-800' },
                      { label: 'Confirmed Paid', value: formatCurrency(totalBookingPaid,  agent.currency), color: 'text-green-600' },
                      { label: 'Balance Due',  value: formatCurrency(totalBookingBalance, agent.currency), color: totalBookingBalance > 0 ? 'text-orange-500' : 'text-green-600' },
                    ].map(s => (
                      <div key={s.label} className="px-5 py-3 text-center border-r border-slate-100 last:border-0">
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{s.label}</div>
                        <div className={`text-base font-bold mt-0.5 ${s.color}`}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                          <Th>Ref</Th>
                          <Th>Lead Pax</Th>
                          <Th>File Handler</Th>
                          <Th>Status</Th>
                          <Th>Arrival</Th>
                          <Th>Pax</Th>
                          <Th>Quoted</Th>
                          <Th>Paid</Th>
                          <Th>Balance</Th>
                          <Th></Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bookings.map(b => (
                          <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                            <Td className="font-mono font-semibold text-brand-700">{b.bookingRef}</Td>
                            <Td>{b.leadPassenger || '—'}</Td>
                            <Td className="text-slate-500">{b.fileHandler || '—'}</Td>
                            <Td><StatusBadge status={b.status as never} /></Td>
                            <Td className="text-slate-500">{b.arrivalDate ? formatDate(b.arrivalDate) : '—'}</Td>
                            <Td className="text-center">{b.paxAdults + b.paxChildren}</Td>
                            <Td className="font-medium">{formatCurrency(b.quotedTotal, b.currency)}</Td>
                            <Td className="text-green-600">{formatCurrency(b.confirmedPaid, b.currency)}</Td>
                            <Td className={`font-semibold ${b.balance > 0 ? 'text-orange-500' : 'text-green-600'}`}>
                              {b.balance > 0 ? formatCurrency(b.balance, b.currency) : '✓'}
                            </Td>
                            <Td>
                              <Link
                                href={`/dashboard/bookings/${b.bookingRef}`}
                                className="p-1.5 text-slate-400 hover:text-brand-600 transition-colors inline-flex"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Link>
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        )}

      </div>

      {/* ── New / Edit Cycle Modal ── */}
      <Modal
        open={cycleModal}
        onClose={() => setCycleModal(false)}
        title={editingCycle ? 'Edit Payment Cycle' : 'Create Payment Cycle'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCycleModal(false)}>Cancel</Button>
            <Button loading={savingCycle} onClick={saveCycle}>
              {editingCycle ? 'Save Changes' : 'Create Cycle'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">

          {/* Period */}
          <div>
            <label className="form-label">Billing Period *</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  type="date"
                  className="form-input"
                  value={cycleForm.periodStart}
                  onChange={e => setCycleForm(f => ({ ...f, periodStart: e.target.value }))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Period start</p>
              </div>
              <div>
                <input
                  type="date"
                  className="form-input"
                  value={cycleForm.periodEnd}
                  onChange={e => setCycleForm(f => ({ ...f, periodEnd: e.target.value }))}
                />
                <p className="text-[10px] text-slate-400 mt-1">Period end</p>
              </div>
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className="form-label">Due Date * <span className="text-slate-400 font-normal">(15th or 30th)</span></label>
            <input
              type="date"
              className="form-input"
              value={cycleForm.dueDate}
              onChange={e => setCycleForm(f => ({ ...f, dueDate: e.target.value }))}
            />
            <div className="flex gap-2 mt-1.5">
              {getNextDueDates().map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setCycleForm(f => ({ ...f, dueDate: d.value }))}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    cycleForm.dueDate === d.value
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'border-slate-200 text-slate-600 hover:border-brand-400'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Booking refs */}
          <div>
            <label className="form-label">Booking Refs <span className="text-slate-400 font-normal">(comma separated)</span></label>
            <input
              className="form-input font-mono"
              placeholder="VN26001, VN26002, VN26003"
              value={cycleForm.bookingRefs}
              onChange={e => setCycleForm(f => ({ ...f, bookingRefs: e.target.value }))}
            />
          </div>

          {/* Amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="form-label">Amount Due *</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-input"
                value={cycleForm.amountDue}
                onChange={e => setCycleForm(f => ({ ...f, amountDue: e.target.value }))}
              />
            </div>
            <div className="col-span-1">
              <label className="form-label">Amount Paid</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-input"
                value={cycleForm.amountPaid}
                onChange={e => setCycleForm(f => ({ ...f, amountPaid: e.target.value }))}
              />
            </div>
            <div className="col-span-1">
              <label className="form-label">Currency</label>
              <select
                className="form-input"
                value={cycleForm.currency}
                onChange={e => setCycleForm(f => ({ ...f, currency: e.target.value }))}
              >
                {['USD', 'EUR', 'GBP', 'AUD', 'SGD', 'VND'].map(c => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status + paid date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Status <span className="text-slate-400 font-normal">(auto-set if blank)</span></label>
              <select
                className="form-input"
                value={cycleForm.status}
                onChange={e => setCycleForm(f => ({ ...f, status: e.target.value as CreditPaymentStatus }))}
              >
                <option value="">Auto-derive</option>
                {(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as CreditPaymentStatus[]).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Paid At</label>
              <input
                type="date"
                className="form-input"
                value={cycleForm.paidAt}
                onChange={e => setCycleForm(f => ({ ...f, paidAt: e.target.value }))}
              />
            </div>
          </div>

          {/* Reference + notes */}
          <div>
            <label className="form-label">Payment Reference</label>
            <input
              className="form-input"
              placeholder="Bank transfer ID / receipt number"
              value={cycleForm.reference}
              onChange={e => setCycleForm(f => ({ ...f, reference: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={2}
              value={cycleForm.notes}
              onChange={e => setCycleForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

        </div>
      </Modal>
    </div>
  )
}

// ── Table helpers ──────────────────────────────────────────────────────────

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-3 py-2.5 font-semibold">{children}</th>
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>
}
function InfoRow({
  icon: Icon, label, value,
}: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" />
      <div>
        <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
        <div className="text-sm text-slate-800 font-medium">{value}</div>
      </div>
    </div>
  )
}
