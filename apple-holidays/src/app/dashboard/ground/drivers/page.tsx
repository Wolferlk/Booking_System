'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, Car, Truck, User, Phone, Mail,
  CreditCard, Wallet, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Edit2, Trash2, DollarSign,
  Building2, Hash, ArrowUpCircle, ArrowDownCircle,
  BadgeCheck, Clock, RefreshCw,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Vehicle { id: string; type: string; plateNo: string; capacity: number; description: string | null }
interface DriverPayment {
  id: string; amount: number; type: string; description: string | null;
  refNumber: string | null; createdAt: string; paidBy: { name: string }
}
interface Driver {
  id: string; name: string; phone: string; email: string | null
  licenseNo: string | null; isActive: boolean
  vehicleId: string | null; vehicle: Vehicle | null
  bankName: string | null; bankAccountNo: string | null
  bankHolder: string | null; bankBranch: string | null; bankCode: string | null
  advanceBalance: number
  driverPayments?: DriverPayment[]
}

const VN_BANKS = [
  'Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'MB Bank',
  'ACB', 'Sacombank', 'VPBank', 'TPBank', 'VIB', 'SHB', 'Agribank',
  'HDBank', 'Eximbank', 'OCB', 'MSB', 'LienVietPostBank', 'Other',
]

const PAY_TYPE_COLORS: Record<string, string> = {
  ADVANCE: 'bg-blue-50 text-blue-700 border-blue-100',
  SALARY: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  REIMBURSEMENT: 'bg-purple-50 text-purple-700 border-purple-100',
  DEDUCTION: 'bg-red-50 text-red-700 border-red-100',
}

export default function DriversPage() {
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'SUPER_ADMIN'

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [editDriver, setEditDriver] = useState<Driver | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showPayModal, setShowPayModal] = useState<string | null>(null) // driverId

  // Form states
  const [form, setForm] = useState({
    name: '', phone: '', email: '', licenseNo: '', isActive: true, vehicleId: '',
    bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '',
  })
  const [payForm, setPayForm] = useState({ amount: '', type: 'ADVANCE', description: '', refNumber: '' })
  const [saving, setSaving] = useState(false)

  async function loadDrivers() {
    setLoading(true)
    try {
      const [dRes, vRes] = await Promise.all([
        fetch('/api/ground/drivers'),
        fetch('/api/ground/vehicles'),
      ])
      const [dData, vData] = await Promise.all([dRes.json(), vRes.json()])
      if (dData.success) setDrivers(dData.data)
      if (vData.success) setVehicles(vData.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadDrivers() }, [])

  async function loadDriverDetail(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setDetailLoading(id)
    try {
      const res = await fetch(`/api/ground/drivers/${id}`)
      const data = await res.json()
      if (data.success) {
        setDrivers(prev => prev.map(d => d.id === id ? { ...d, ...data.data } : d))
        setExpandedId(id)
      }
    } finally { setDetailLoading(null) }
  }

  function openEdit(driver: Driver) {
    setForm({
      name: driver.name,
      phone: driver.phone,
      email: driver.email ?? '',
      licenseNo: driver.licenseNo ?? '',
      isActive: driver.isActive,
      vehicleId: driver.vehicleId ?? '',
      bankName: driver.bankName ?? '',
      bankAccountNo: driver.bankAccountNo ?? '',
      bankHolder: driver.bankHolder ?? '',
      bankBranch: driver.bankBranch ?? '',
      bankCode: driver.bankCode ?? '',
    })
    setEditDriver(driver)
  }

  function openAdd() {
    setForm({ name: '', phone: '', email: '', licenseNo: '', isActive: true, vehicleId: '', bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '' })
    setShowAdd(true)
  }

  async function saveDriver() {
    setSaving(true)
    try {
      const url = editDriver ? `/api/ground/drivers/${editDriver.id}` : '/api/ground/drivers'
      const method = editDriver ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, vehicleId: form.vehicleId || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(editDriver ? 'Driver updated' : 'Driver added')
        setEditDriver(null); setShowAdd(false)
        loadDrivers()
      } else toast.error(data.error ?? 'Failed')
    } finally { setSaving(false) }
  }

  async function deleteDriver(id: string) {
    if (!confirm('Delete this driver? This cannot be undone.')) return
    const res = await fetch(`/api/ground/drivers/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) { toast.success('Driver deleted'); loadDrivers() }
    else toast.error(data.error ?? 'Failed')
  }

  async function addPayment(driverId: string) {
    if (!payForm.amount || !payForm.type) return
    setSaving(true)
    try {
      const res = await fetch(`/api/ground/drivers/${driverId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payForm),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Payment recorded')
        setShowPayModal(null)
        setPayForm({ amount: '', type: 'ADVANCE', description: '', refNumber: '' })
        loadDriverDetail(driverId)
      } else toast.error(data.error ?? 'Failed')
    } finally { setSaving(false) }
  }

  const availableVehicles = vehicles.filter(v =>
    !drivers.some(d => d.vehicleId === v.id && d.id !== editDriver?.id)
  )

  return (
    <div>
      <Header
        title="Drivers & Vehicles"
        subtitle="Manage drivers, vehicle assignments, bank details and payment history"
        actions={
          <button onClick={openAdd} className="btn-primary btn">
            <Plus className="w-4 h-4" /> Add Driver
          </button>
        }
      />

      <div className="p-8 space-y-5">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
        ) : drivers.length === 0 ? (
          <Card className="p-12 text-center">
            <Car className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">No drivers yet</p>
          </Card>
        ) : (
          <div className="space-y-4">
            {drivers.map(driver => {
              const isExpanded = expandedId === driver.id
              return (
                <Card key={driver.id} className={`overflow-hidden transition-all ${isExpanded ? 'ring-2 ring-brand-500/20' : ''}`}>
                  {/* Driver header row */}
                  <div className="p-5 flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-xl bg-brand-500/10 flex items-center justify-center flex-shrink-0">
                      <User className="w-6 h-6 text-brand-500" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{driver.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${driver.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {driver.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
                          <Phone className="w-3 h-3" /> {driver.phone}
                        </div>
                        {driver.email && (
                          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
                            <Mail className="w-3 h-3" /> {driver.email}
                          </div>
                        )}
                      </div>

                      {/* Vehicle */}
                      <div>
                        {driver.vehicle ? (
                          <div className="flex items-start gap-2">
                            <Truck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{driver.vehicle.plateNo}</p>
                              <p className="text-xs text-slate-500">{driver.vehicle.type} · {driver.vehicle.capacity} seats</p>
                              {driver.vehicle.description && <p className="text-xs text-slate-400">{driver.vehicle.description}</p>}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Truck className="w-4 h-4" /> No vehicle assigned
                          </div>
                        )}
                      </div>

                      {/* Finance */}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Wallet className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-xs text-slate-500">Advance Balance</span>
                        </div>
                        <p className={`text-base font-bold mt-0.5 ${Number(driver.advanceBalance) > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                          {formatCurrency(Number(driver.advanceBalance))}
                        </p>
                        {driver.bankName && (
                          <p className="text-xs text-slate-400 mt-0.5">{driver.bankName} · ****{driver.bankAccountNo?.slice(-4)}</p>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => openEdit(driver)} className="btn-ghost btn btn-sm">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { setShowPayModal(driver.id); setPayForm({ amount: '', type: 'ADVANCE', description: '', refNumber: '' }) }}
                        className="btn-secondary btn btn-sm"
                      >
                        <DollarSign className="w-4 h-4" /> Payment
                      </button>
                      {isAdmin && (
                        <button onClick={() => deleteDriver(driver.id)} className="btn-ghost btn btn-sm text-red-500 hover:bg-red-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => loadDriverDetail(driver.id)} className="btn-ghost btn btn-sm">
                        {detailLoading === driver.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && driver.driverPayments !== undefined && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Bank details */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-brand-500" />
                          Bank Account Details
                        </h4>
                        {driver.bankAccountNo ? (
                          <div className="space-y-2 text-sm">
                            {[
                              ['Bank', driver.bankName],
                              ['Account No.', driver.bankAccountNo],
                              ['Account Holder', driver.bankHolder],
                              ['Branch', driver.bankBranch],
                              ['Code / SWIFT', driver.bankCode],
                            ].filter(([, v]) => v).map(([k, v]) => (
                              <div key={k as string} className="flex items-center gap-2">
                                <span className="text-slate-400 w-28 flex-shrink-0">{k}</span>
                                <span className="font-medium text-slate-700 font-mono">{v}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-slate-400">No bank details on file</p>
                        )}
                      </div>

                      {/* Payment history */}
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-brand-500" />
                          Payment History
                        </h4>
                        {driver.driverPayments!.length === 0 ? (
                          <p className="text-sm text-slate-400">No payments yet</p>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {driver.driverPayments!.map(p => (
                              <div key={p.id} className="flex items-center gap-3 text-sm bg-white rounded-lg px-3 py-2.5 border border-slate-100">
                                {p.type === 'DEDUCTION' ? (
                                  <ArrowDownCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                ) : (
                                  <ArrowUpCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={`badge border text-[10px] ${PAY_TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-600 border-slate-100'}`}>
                                      {p.type}
                                    </span>
                                    <span className="font-semibold text-slate-800">{formatCurrency(p.amount)}</span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                                    {p.description && <span>{p.description}</span>}
                                    {p.refNumber && <span className="font-mono">#{p.refNumber}</span>}
                                    <span>{formatDate(p.createdAt)}</span>
                                  </div>
                                </div>
                                <span className="text-xs text-slate-400 flex-shrink-0">{p.paidBy.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Driver Modal */}
      <Modal
        open={!!(editDriver || showAdd)}
        onClose={() => { setEditDriver(null); setShowAdd(false) }}
        title={editDriver ? `Edit Driver — ${editDriver.name}` : 'Add New Driver'}
        size="lg"
      >
        <div className="space-y-6">
          {/* Basic info */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <User className="w-4 h-4 text-brand-500" /> Basic Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Full Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="form-input" placeholder="Nguyen Van Minh" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Phone *</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="form-input" placeholder="+84-905-123456" />
              </div>
              <div>
                <label className="form-label">Email</label>
                <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="form-input" placeholder="driver@email.com" />
              </div>
              <div>
                <label className="form-label">License Number</label>
                <input value={form.licenseNo} onChange={e => setForm(f => ({ ...f, licenseNo: e.target.value }))}
                  className="form-input" placeholder="VN-2024-001" />
              </div>
            </div>
          </div>

          {/* Vehicle assignment */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-500" /> Vehicle Assignment
            </h3>
            <select value={form.vehicleId} onChange={e => setForm(f => ({ ...f, vehicleId: e.target.value }))}
              className="form-select">
              <option value="">— No Vehicle —</option>
              {availableVehicles.map(v => (
                <option key={v.id} value={v.id}>
                  {v.plateNo} · {v.type} · {v.capacity} seats{v.description ? ` (${v.description})` : ''}
                </option>
              ))}
              {editDriver?.vehicle && !availableVehicles.find(v => v.id === editDriver.vehicleId) && (
                <option value={editDriver.vehicleId!}>
                  {editDriver.vehicle.plateNo} (currently assigned)
                </option>
              )}
            </select>
          </div>

          {/* Vietnamese Bank Details */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-500" /> Vietnamese Bank Account
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Bank Name</label>
                <select value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                  className="form-select">
                  <option value="">Select Bank</option>
                  {VN_BANKS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Account Number</label>
                <input value={form.bankAccountNo} onChange={e => setForm(f => ({ ...f, bankAccountNo: e.target.value }))}
                  className="form-input font-mono" placeholder="0123456789" />
              </div>
              <div>
                <label className="form-label">Account Holder Name</label>
                <input value={form.bankHolder} onChange={e => setForm(f => ({ ...f, bankHolder: e.target.value }))}
                  className="form-input" placeholder="NGUYEN VAN MINH" />
              </div>
              <div>
                <label className="form-label">Branch / City</label>
                <input value={form.bankBranch} onChange={e => setForm(f => ({ ...f, bankBranch: e.target.value }))}
                  className="form-input" placeholder="Ho Chi Minh City" />
              </div>
              <div className="col-span-2">
                <label className="form-label">SWIFT / Napas Code (optional)</label>
                <input value={form.bankCode} onChange={e => setForm(f => ({ ...f, bankCode: e.target.value }))}
                  className="form-input font-mono" placeholder="BFTVVNVX" />
              </div>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="isActive" checked={form.isActive}
              onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
            <label htmlFor="isActive" className="text-sm font-medium text-slate-700">Active Driver</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={saveDriver} disabled={saving || !form.name || !form.phone}
              className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {editDriver ? 'Save Changes' : 'Add Driver'}
            </button>
            <button onClick={() => { setEditDriver(null); setShowAdd(false) }} className="btn-secondary btn">
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Payment Modal */}
      <Modal
        open={!!showPayModal}
        onClose={() => setShowPayModal(null)}
        title="Record Driver Payment"
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Payment Type *</label>
            <select value={payForm.type} onChange={e => setPayForm(f => ({ ...f, type: e.target.value }))}
              className="form-select">
              <option value="ADVANCE">Advance Payment</option>
              <option value="SALARY">Salary</option>
              <option value="REIMBURSEMENT">Reimbursement</option>
              <option value="DEDUCTION">Deduction</option>
            </select>
          </div>
          <div>
            <label className="form-label">Amount (USD) *</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
              className="form-input" placeholder="0.00" min="0" step="0.01" />
          </div>
          <div>
            <label className="form-label">Reference Number</label>
            <input value={payForm.refNumber} onChange={e => setPayForm(f => ({ ...f, refNumber: e.target.value }))}
              className="form-input" placeholder="REF-2026-001" />
          </div>
          <div>
            <label className="form-label">Description</label>
            <input value={payForm.description} onChange={e => setPayForm(f => ({ ...f, description: e.target.value }))}
              className="form-input" placeholder="e.g. Monthly advance for June" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => addPayment(showPayModal!)} disabled={saving || !payForm.amount}
              className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Record Payment
            </button>
            <button onClick={() => setShowPayModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
