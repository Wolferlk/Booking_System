'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { useCountryFilter } from '@/hooks/use-country-filter'
import {
  Plus, Loader2, Car, Truck, User, Phone, Mail, Search, X,
  CreditCard, Wallet, ChevronDown, ChevronRight,
  CheckCircle2, Edit2, Trash2, DollarSign,
  Building2, ArrowUpCircle, ArrowDownCircle, Camera,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Vehicle {
  id: string; type: string; plateNo: string; capacity: number
  brand: string | null; model: string | null
  photoOutside: string | null; photoInside: string | null
  description: string | null
  vendor: { id: string; name: string } | null
}
interface DriverPayment {
  id: string; amount: number; type: string; description: string | null;
  refNumber: string | null; createdAt: string; paidBy: { name: string }
}
interface Driver {
  id: string; name: string; phone: string; email: string | null
  licenseNo: string | null; isActive: boolean; photoUrl: string | null
  vehicleId: string | null; vehicle: Vehicle | null
  country: string | null
  bankName: string | null; bankAccountNo: string | null
  bankHolder: string | null; bankBranch: string | null; bankCode: string | null
  advanceBalance: number
  driverPayments?: DriverPayment[]
}

const BANKS_BY_COUNTRY: Record<string, string[]> = {
  VIETNAM: [
    'Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'MB Bank',
    'ACB', 'Sacombank', 'VPBank', 'TPBank', 'VIB', 'SHB', 'Agribank',
    'HDBank', 'Eximbank', 'OCB', 'MSB', 'LienVietPostBank', 'Other',
  ],
  SRILANKA: [
    'Bank of Ceylon', "People's Bank", 'Commercial Bank', 'Hatton National Bank (HNB)',
    'Sampath Bank', 'Seylan Bank', 'Nations Trust Bank (NTB)', 'NDB Bank',
    'DFCC Bank', 'Pan Asia Bank', 'Union Bank', 'Amana Bank', 'Other',
  ],
  SINGAPORE_MALAYSIA: [
    'DBS', 'OCBC', 'UOB', 'Maybank', 'CIMB', 'Standard Chartered',
    'Citibank', 'HSBC', 'RHB', 'Bank Mandiri', 'Other',
  ],
}

const BANK_LABELS: Record<string, string> = {
  VIETNAM:            '🇻🇳 Vietnamese Bank Account',
  SRILANKA:           '🇱🇰 Sri Lanka Bank Account',
  SINGAPORE_MALAYSIA: '🇸🇬🇲🇾 Singapore / Malaysia Bank Account',
}

const HOLDER_PLACEHOLDERS: Record<string, string> = {
  VIETNAM:            'NGUYEN VAN MINH',
  SRILANKA:           'KASUN PERERA',
  SINGAPORE_MALAYSIA: 'RAVI KUMAR',
}

const BRANCH_PLACEHOLDERS: Record<string, string> = {
  VIETNAM:            'Ho Chi Minh City',
  SRILANKA:           'Colombo',
  SINGAPORE_MALAYSIA: 'Singapore CBD',
}

const SWIFT_PLACEHOLDERS: Record<string, string> = {
  VIETNAM:            'BFTVVNVX',
  SRILANKA:           'BCEYLKLX',
  SINGAPORE_MALAYSIA: 'DBSSSGSG',
}

const VEHICLE_TYPES = ['car', 'van', 'minibus', 'bus', 'motorbike']

const PAY_TYPE_COLORS: Record<string, string> = {
  ADVANCE: 'bg-blue-50 text-blue-700 border-blue-100',
  SALARY: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  REIMBURSEMENT: 'bg-purple-50 text-purple-700 border-purple-100',
  DEDUCTION: 'bg-red-50 text-red-700 border-red-100',
}

export default function DriversPage() {
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()
  const isAdmin = session?.user?.role === 'SUPER_ADMIN'

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const [editDriver, setEditDriver] = useState<Driver | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showPayModal, setShowPayModal] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const userCountry = session?.user?.country ?? 'ALL'
  const isAllCountry = !userCountry || userCountry === 'ALL'

  const [form, setForm] = useState({
    name: '', phone: '', email: '', licenseNo: '', isActive: true, photoUrl: '',
    vehicleId: '', country: '',
    bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '',
  })

  // Active country for the form — drives bank list & labels
  const formCountry = editDriver?.country ?? form.country ?? (isAllCountry ? '' : userCountry)
  const [vehForm, setVehForm] = useState({
    plateNo: '', type: 'van', brand: '', model: '', capacity: '4',
    photoOutside: '', photoInside: '',
  })
  const [showNewVehicle, setShowNewVehicle] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null) // 'driver' | 'outside' | 'inside'
  const [payForm, setPayForm] = useState({ amount: '', type: 'ADVANCE', description: '', refNumber: '' })
  const [saving, setSaving] = useState(false)

  async function loadDrivers() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/ground/drivers?${params}`)
      const data = await res.json()
      if (data.success) setDrivers(data.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadDrivers() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function uploadPhoto(file: File, field: 'driver' | 'outside' | 'inside') {
    const fd = new FormData()
    fd.append('file', file)
    setUploadingPhoto(field)
    try {
      const res = await fetch('/api/upload/photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) {
        if (field === 'driver') setForm(f => ({ ...f, photoUrl: data.data.url }))
        else if (field === 'outside') setVehForm(f => ({ ...f, photoOutside: data.data.url }))
        else setVehForm(f => ({ ...f, photoInside: data.data.url }))
      } else toast.error('Photo upload failed')
    } catch { toast.error('Photo upload failed') }
    finally { setUploadingPhoto(null) }
  }

  function openEdit(driver: Driver) {
    setForm({
      name: driver.name,
      phone: driver.phone,
      email: driver.email ?? '',
      licenseNo: driver.licenseNo ?? '',
      isActive: driver.isActive,
      photoUrl: driver.photoUrl ?? '',
      vehicleId: driver.vehicleId ?? '',
      country: driver.country ?? '',
      bankName: driver.bankName ?? '',
      bankAccountNo: driver.bankAccountNo ?? '',
      bankHolder: driver.bankHolder ?? '',
      bankBranch: driver.bankBranch ?? '',
      bankCode: driver.bankCode ?? '',
    })
    if (driver.vehicle) {
      setVehForm({
        plateNo: driver.vehicle.plateNo,
        type: driver.vehicle.type,
        brand: driver.vehicle.brand ?? '',
        model: driver.vehicle.model ?? '',
        capacity: String(driver.vehicle.capacity),
        photoOutside: driver.vehicle.photoOutside ?? '',
        photoInside: driver.vehicle.photoInside ?? '',
      })
      setShowNewVehicle(true)
    } else {
      setVehForm({ plateNo: '', type: 'van', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '' })
      setShowNewVehicle(false)
    }
    setEditDriver(driver)
  }

  function openAdd() {
    setForm({ name: '', phone: '', email: '', licenseNo: '', isActive: true, photoUrl: '', vehicleId: '', country: '', bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '' })
    setVehForm({ plateNo: '', type: 'van', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '' })
    setShowNewVehicle(false)
    setShowAdd(true)
  }

  async function saveDriver() {
    setSaving(true)
    try {
      let vehicleId = form.vehicleId

      if (showNewVehicle && vehForm.plateNo) {
        const vPayload = {
          plateNo: vehForm.plateNo,
          type: vehForm.type,
          brand: vehForm.brand || null,
          model: vehForm.model || null,
          capacity: Number(vehForm.capacity),
          photoOutside: vehForm.photoOutside || null,
          photoInside: vehForm.photoInside || null,
        }
        if (editDriver?.vehicleId) {
          // Update existing vehicle
          const vRes = await fetch(`/api/ground/vehicles/${editDriver.vehicleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vPayload),
          })
          const vData = await vRes.json()
          if (!vData.success) { toast.error('Failed to update vehicle'); return }
          vehicleId = editDriver.vehicleId
        } else {
          // Create new vehicle
          const vRes = await fetch('/api/ground/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vPayload),
          })
          const vData = await vRes.json()
          if (!vData.success) { toast.error('Failed to create vehicle'); return }
          vehicleId = vData.data.id
        }
      }

      const url = editDriver ? `/api/ground/drivers/${editDriver.id}` : '/api/ground/drivers'
      const method = editDriver ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, vehicleId: vehicleId || null }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(editDriver ? 'Driver updated' : 'Driver added')
        setEditDriver(null); setShowAdd(false); setShowNewVehicle(false)
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

  const filteredDrivers = drivers.filter(driver => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true

    const vehicleText = [
      driver.vehicle?.plateNo,
      driver.vehicle?.brand,
      driver.vehicle?.model,
      driver.vehicle?.type,
    ].filter(Boolean).join(' ').toLowerCase()

    const bankText = [
      driver.bankName,
      driver.bankAccountNo,
      driver.bankHolder,
      driver.bankBranch,
      driver.bankCode,
    ].filter(Boolean).join(' ').toLowerCase()

    return [
      driver.name,
      driver.phone,
      driver.email,
      driver.licenseNo,
      driver.country,
      vehicleText,
      bankText,
    ].some(value => value?.toLowerCase().includes(q))
  })

  return (
    <div>
      <Header
        title="Drivers & Vehicles"
        subtitle="Manage drivers, their vehicles, bank details and payment history"
        actions={
          <button onClick={openAdd} className="btn-primary btn">
            <Plus className="w-4 h-4" /> Add Driver
          </button>
        }
      />

      <div className="p-8 space-y-5">
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search drivers, phones, licenses, vehicles, or banks…"
            className="form-input pl-9 pr-10"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
        ) : filteredDrivers.length === 0 ? (
          <Card className="p-12 text-center">
            <Car className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">
              {searchQuery ? `No drivers match "${searchQuery}"` : 'No drivers yet'}
            </p>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDrivers.map(driver => {
              const isExpanded = expandedId === driver.id
              return (
                <Card key={driver.id} className={`overflow-hidden transition-all ${isExpanded ? 'ring-2 ring-brand-500/20' : ''}`}>
                  <div className="p-5 flex items-center gap-4">
                    {/* Avatar */}
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-brand-500/10 flex items-center justify-center">
                      {driver.photoUrl ? (
                        <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-6 h-6 text-brand-500" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">{driver.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${driver.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {driver.isActive ? 'Active' : 'Inactive'}
                          </span>
                          {driver.country && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              driver.country === 'VIETNAM'            ? 'bg-red-50 text-red-600 border-red-100' :
                              driver.country === 'SRILANKA'           ? 'bg-yellow-50 text-yellow-700 border-yellow-100' :
                              driver.country === 'SINGAPORE_MALAYSIA' ? 'bg-blue-50 text-blue-600 border-blue-100' :
                              'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                              {driver.country === 'VIETNAM' ? '🇻🇳 Vietnam' :
                               driver.country === 'SRILANKA' ? '🇱🇰 Sri Lanka' :
                               driver.country === 'SINGAPORE_MALAYSIA' ? '🇸🇬🇲🇾 SG/MY' : driver.country}
                            </span>
                          )}
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
                              <p className="text-xs text-slate-500">
                                {[driver.vehicle.brand, driver.vehicle.model].filter(Boolean).join(' ') || driver.vehicle.type}
                                {' · '}{driver.vehicle.capacity} seats
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-slate-400">
                            <Truck className="w-4 h-4" /> No vehicle
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
        onClose={() => { setEditDriver(null); setShowAdd(false); setShowNewVehicle(false) }}
        title={editDriver ? `Edit Driver — ${editDriver.name}` : 'Add New Driver'}
        size="lg"
      >
        <div className="space-y-6">
          {/* Driver Photo */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Camera className="w-4 h-4 text-brand-500" /> Driver Photo
            </h3>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-full overflow-hidden bg-brand-50 border-2 border-dashed border-brand-200 flex items-center justify-center flex-shrink-0">
                {form.photoUrl ? (
                  <img src={form.photoUrl} alt="Driver" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-7 h-7 text-brand-300" />
                )}
              </div>
              <div className="flex gap-2">
                <label className="btn-secondary btn btn-sm cursor-pointer">
                  {uploadingPhoto === 'driver' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {form.photoUrl ? 'Change' : 'Upload Photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'driver')} />
                </label>
                {form.photoUrl && (
                  <button type="button" onClick={() => setForm(f => ({ ...f, photoUrl: '' }))}
                    className="text-xs text-red-400 hover:text-red-600 px-2">Remove</button>
                )}
              </div>
            </div>
          </div>

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
              {isAllCountry && (
                <div className="col-span-2">
                  <label className="form-label">Country / Team</label>
                  <select value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    className="form-select">
                    <option value="">Not set</option>
                    <option value="VIETNAM">🇻🇳 Vietnam</option>
                    <option value="SRILANKA">🇱🇰 Sri Lanka</option>
                    <option value="SINGAPORE_MALAYSIA">🇸🇬🇲🇾 Singapore &amp; Malaysia</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Vehicle Details (driver is vehicle owner) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-500" /> Vehicle Details
              </h3>
              {!showNewVehicle && (
                <button type="button" onClick={() => setShowNewVehicle(true)}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1">
                  <Plus className="w-3 h-3" /> Add Vehicle
                </button>
              )}
            </div>
            {showNewVehicle ? (
              <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Plate Number *</label>
                    <input className="form-input font-mono" placeholder="51A-12345"
                      value={vehForm.plateNo} onChange={e => setVehForm(f => ({ ...f, plateNo: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Vehicle Type *</label>
                    <select className="form-select" value={vehForm.type} onChange={e => setVehForm(f => ({ ...f, type: e.target.value }))}>
                      {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Brand</label>
                    <input className="form-input" placeholder="Toyota"
                      value={vehForm.brand} onChange={e => setVehForm(f => ({ ...f, brand: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Model</label>
                    <input className="form-input" placeholder="Hiace"
                      value={vehForm.model} onChange={e => setVehForm(f => ({ ...f, model: e.target.value }))} />
                  </div>
                  <div>
                    <label className="form-label">Capacity (seats)</label>
                    <input type="number" className="form-input" min="1" max="60"
                      value={vehForm.capacity} onChange={e => setVehForm(f => ({ ...f, capacity: e.target.value }))} />
                  </div>
                </div>

                {/* Vehicle photos */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Outside Photo</label>
                    <div className="flex flex-col gap-2">
                      <div className="h-20 rounded-lg overflow-hidden bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center">
                        {vehForm.photoOutside ? (
                          <img src={vehForm.photoOutside} alt="Outside" className="w-full h-full object-cover" />
                        ) : (
                          <Car className="w-6 h-6 text-slate-300" />
                        )}
                      </div>
                      <label className="btn-secondary btn btn-sm cursor-pointer text-center">
                        {uploadingPhoto === 'outside' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                        Upload
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'outside')} />
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Inside Photo</label>
                    <div className="flex flex-col gap-2">
                      <div className="h-20 rounded-lg overflow-hidden bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center">
                        {vehForm.photoInside ? (
                          <img src={vehForm.photoInside} alt="Inside" className="w-full h-full object-cover" />
                        ) : (
                          <Car className="w-6 h-6 text-slate-300" />
                        )}
                      </div>
                      <label className="btn-secondary btn btn-sm cursor-pointer text-center">
                        {uploadingPhoto === 'inside' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                        Upload
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                          onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'inside')} />
                      </label>
                    </div>
                  </div>
                </div>

                <button type="button" onClick={() => setShowNewVehicle(false)}
                  className="text-xs text-slate-400 hover:text-red-500">
                  Remove vehicle section
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No vehicle attached — click &quot;Add Vehicle&quot; above</p>
            )}
          </div>

          {/* Bank Account Details */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-500" />
              {BANK_LABELS[formCountry] ?? 'Bank Account'}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Bank Name</label>
                {BANKS_BY_COUNTRY[formCountry] ? (
                  <select value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                    className="form-select">
                    <option value="">Select Bank</option>
                    {BANKS_BY_COUNTRY[formCountry].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                    className="form-input" placeholder="Bank name" />
                )}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Account Number</label>
                <input value={form.bankAccountNo} onChange={e => setForm(f => ({ ...f, bankAccountNo: e.target.value }))}
                  className="form-input font-mono" placeholder="0123456789" />
              </div>
              <div>
                <label className="form-label">Account Holder Name</label>
                <input value={form.bankHolder} onChange={e => setForm(f => ({ ...f, bankHolder: e.target.value }))}
                  className="form-input" placeholder={HOLDER_PLACEHOLDERS[formCountry] ?? 'Account holder name'} />
              </div>
              <div>
                <label className="form-label">Branch / City</label>
                <input value={form.bankBranch} onChange={e => setForm(f => ({ ...f, bankBranch: e.target.value }))}
                  className="form-input" placeholder={BRANCH_PLACEHOLDERS[formCountry] ?? 'Branch or city'} />
              </div>
              <div className="col-span-2">
                <label className="form-label">SWIFT / Code (optional)</label>
                <input value={form.bankCode} onChange={e => setForm(f => ({ ...f, bankCode: e.target.value }))}
                  className="form-input font-mono" placeholder={SWIFT_PLACEHOLDERS[formCountry] ?? 'SWIFT code'} />
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
            <button onClick={() => { setEditDriver(null); setShowAdd(false); setShowNewVehicle(false) }} className="btn-secondary btn">
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
