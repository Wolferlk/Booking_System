'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { useCountryFilter } from '@/hooks/use-country-filter'
import {
  Plus, Loader2, Car, Truck, User, Phone, Mail, Search, X,
  CreditCard, Wallet, ChevronDown, ChevronRight,
  CheckCircle2, Edit2, Trash2, DollarSign,
  Building2, ArrowUpCircle, ArrowDownCircle, Camera,
  MessageCircle, Send, Clock, Link2, Download,
  Users, ShieldCheck, Layers, BarChart3, ClipboardList,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { CountryFlag } from '@/components/ui/country-flag'
import { countryLabel } from '@/lib/country-detection'
import PartnerPerformance from '@/components/ground/partner-performance'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string; type: string; plateNo: string; capacity: number
  brand: string | null; model: string | null
  photoOutside: string | null; photoInside: string | null
  description: string | null; isActive?: boolean
  vendor: { id: string; name: string } | null
  driver: { id: string; name: string; phone: string } | null
}
interface DriverPayment {
  id: string; amount: number; type: string; description: string | null;
  refNumber: string | null; createdAt: string; paidBy: { name: string }
}
const MAX_DRIVER_PAYMENT_AMOUNT = 99_999_999.99

function getPaymentAmountError(value: string): string {
  const amount = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) return 'This field is required.'
  const numericAmount = Number(amount)
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) return 'Amount must be greater than 0'
  if (numericAmount > MAX_DRIVER_PAYMENT_AMOUNT) return 'Amount cannot exceed 99,999,999.99'
  return ''
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
  vendorId?: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BANKS_BY_COUNTRY: Record<string, string[]> = {
  VIETNAM: ['Vietcombank','Techcombank','BIDV','VietinBank','MB Bank','ACB','Sacombank','VPBank','TPBank','VIB','SHB','Agribank','HDBank','Eximbank','OCB','MSB','LienVietPostBank','Other'],
  SRILANKA: ['Bank of Ceylon',"People's Bank",'Commercial Bank','Hatton National Bank (HNB)','Sampath Bank','Seylan Bank','Nations Trust Bank (NTB)','NDB Bank','DFCC Bank','Pan Asia Bank','Union Bank','Amana Bank','Other'],
  SINGAPORE: ['DBS','OCBC','UOB','Standard Chartered','Citibank','HSBC','Maybank','CIMB','Other'],
  MALAYSIA: ['Maybank','CIMB','RHB','Public Bank','Hong Leong Bank','Bank Islam','AmBank','Standard Chartered','HSBC','Bank Mandiri','Other'],
  SINGAPORE_MALAYSIA: ['DBS','OCBC','UOB','Maybank','CIMB','Standard Chartered','Citibank','HSBC','RHB','Bank Mandiri','Other'],
}
const BANK_LABELS: Record<string, string> = {
  VIETNAM: 'Vietnamese Bank Account', SRILANKA: 'Sri Lanka Bank Account',
  SINGAPORE: 'Singapore Bank Account', MALAYSIA: 'Malaysia Bank Account',
  SINGAPORE_MALAYSIA: 'Singapore / Malaysia Bank Account',
}
const HOLDER_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'NGUYEN VAN MINH', SRILANKA: 'KASUN PERERA', SINGAPORE: 'RAVI KUMAR',
  MALAYSIA: 'AHMAD BIN ISMAIL', SINGAPORE_MALAYSIA: 'RAVI KUMAR',
}
const BRANCH_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'Ho Chi Minh City', SRILANKA: 'Colombo', SINGAPORE: 'Singapore CBD',
  MALAYSIA: 'Kuala Lumpur', SINGAPORE_MALAYSIA: 'Singapore CBD',
}
const SWIFT_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'BFTVVNVX', SRILANKA: 'BCEYLKLX', SINGAPORE: 'DBSSSGSG',
  MALAYSIA: 'MBBEMYKL', SINGAPORE_MALAYSIA: 'DBSSSGSG',
}
const VEHICLE_TYPES = ['car', 'van', 'minibus', 'bus', 'motorbike']
const PAY_TYPE_COLORS: Record<string, string> = {
  ADVANCE: 'bg-blue-50 text-blue-700 border-blue-100',
  SALARY: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  REIMBURSEMENT: 'bg-purple-50 text-purple-700 border-purple-100',
  DEDUCTION: 'bg-red-50 text-red-700 border-red-100',
}
const COUNTRY_BADGE: Record<string, string> = {
  VIETNAM: 'bg-red-50 text-red-600 border-red-100',
  SRILANKA: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  SINGAPORE: 'bg-blue-50 text-blue-600 border-blue-100',
  MALAYSIA: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  SINGAPORE_MALAYSIA: 'bg-blue-50 text-blue-600 border-blue-100',
}
const TYPE_COLORS: Record<string, string> = {
  car: 'bg-sky-100 text-sky-700',
  van: 'bg-violet-100 text-violet-700',
  minibus: 'bg-amber-100 text-amber-700',
  bus: 'bg-orange-100 text-orange-700',
  motorbike: 'bg-rose-100 text-rose-700',
}

type ActiveTab = 'drivers' | 'vehicles'

// ── Validation ────────────────────────────────────────────────────────────────

function validateVehicleForm(form: { plateNo: string; type: string; brand: string; model: string; capacity: string }) {
  const errors: Record<string, string> = {}
  if (!form.plateNo.trim()) errors.plateNo = 'Plate number is required'
  else if (form.plateNo.length > 20) errors.plateNo = 'Max 20 characters'
  else if (!/^[A-Za-z0-9\-\s]+$/.test(form.plateNo)) errors.plateNo = 'Letters, numbers, hyphens, spaces only'
  if (!form.type) errors.type = 'Vehicle type is required'
  if (form.brand && form.brand.length > 50) errors.brand = 'Max 50 characters'
  if (form.model && form.model.length > 50) errors.model = 'Max 50 characters'
  const capacity = Number(form.capacity)
  if (!form.capacity || capacity < 1) errors.capacity = 'Min 1 seat'
  else if (capacity > 60) errors.capacity = 'Max 60 seats'
  return errors
}

const PHONE_RE = /[^0-9+\-\s()]/g
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateDriverForm(form: { name: string; phone: string; email: string; licenseNo: string; bankAccountNo: string; bankHolder: string; bankBranch: string; bankCode: string }) {
  const errors: Record<string, string> = {}
  if (!form.name.trim()) errors.name = 'Full name is required'
  else if (form.name.trim().length < 2) errors.name = 'Min 2 characters'
  else if (form.name.length > 100) errors.name = 'Max 100 characters'
  if (!form.phone.trim()) errors.phone = 'Phone is required'
  else if (form.phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a valid phone number'
  else if (form.phone.length > 20) errors.phone = 'Max 20 characters'
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.email = 'Enter a valid email'
  else if (form.email.length > 150) errors.email = 'Max 150 characters'
  if (form.licenseNo.length > 30) errors.licenseNo = 'Max 30 characters'
  if (form.bankAccountNo.length > 34) errors.bankAccountNo = 'Max 34 characters'
  else if (form.bankAccountNo && !/^[A-Za-z0-9\-\s]+$/.test(form.bankAccountNo)) errors.bankAccountNo = 'Letters, numbers, hyphens only'
  if (form.bankHolder.length > 100) errors.bankHolder = 'Max 100 characters'
  if (form.bankBranch.length > 100) errors.bankBranch = 'Max 100 characters'
  if (form.bankCode.length > 20) errors.bankCode = 'Max 20 characters'
  else if (form.bankCode && !/^[A-Za-z0-9]+$/.test(form.bankCode)) errors.bankCode = 'Letters and numbers only'
  return errors
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DriversPage() {
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()
  const isAdmin = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session?.user?.role ?? '')
  const canDelete = isAdmin
  const userCountry = session?.user?.country ?? 'ALL'
  const isAllCountry = !userCountry || userCountry === 'ALL'
  const defaultDriverCountry = isAllCountry ? (countryFilter !== 'ALL' ? countryFilter : '') : userCountry

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>('drivers')

  // ── Drivers state ──────────────────────────────────────────────────────────
  const [drivers, setDrivers]       = useState<Driver[]>([])
  const [loadingD, setLoadingD]     = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  // Which half of an expanded driver row is showing. Kept per driver so opening
  // a second row does not reset the first one back to Details.
  const [detailTab, setDetailTab] = useState<Record<string, 'details' | 'performance'>>({})
  const [driverMessages, setDriverMessages] = useState<Record<string, { id: string; body: string; bookingRef: string; createdAt: string; status: string }[]>>({})
  const [sendingMsg, setSendingMsg]   = useState<string | null>(null)
  const [msgText, setMsgText]         = useState<Record<string, string>>({})
  const [editDriver, setEditDriver]   = useState<Driver | null>(null)
  const [showAdd, setShowAdd]         = useState(false)
  const [showPayModal, setShowPayModal] = useState<string | null>(null)
  const [dSearch, setDSearch]         = useState('')
  const [dTypeFilter, setDTypeFilter] = useState('')
  const [dCapFilter, setDCapFilter]   = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [exportingD, setExportingD]   = useState(false)

  // ── Vehicles state ─────────────────────────────────────────────────────────
  const [vehicles, setVehicles]       = useState<Vehicle[]>([])
  const [loadingV, setLoadingV]       = useState(false)
  const [vehLoaded, setVehLoaded]     = useState(false)
  const [vSearch, setVSearch]         = useState('')
  const [vTypeFilter, setVTypeFilter] = useState('')
  const [vCapFilter, setVCapFilter]   = useState('')
  const [vOwnerFilter, setVOwnerFilter] = useState<'all' | 'independent' | 'vendor'>('all')

  // ── Shared form state ─────────────────────────────────────────────────────
  const [form, setForm] = useState({ name: '', phone: '', email: '', licenseNo: '', isActive: true, photoUrl: '', vehicleId: '', country: '', bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '' })
  const formCountry = editDriver?.country ?? form.country ?? (isAllCountry ? '' : userCountry)
  const [vehForm, setVehForm] = useState({ plateNo: '', type: 'van', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '' })
  const [vehErrors, setVehErrors]     = useState<Record<string, string>>({})
  const [driverErrors, setDriverErrors] = useState<Record<string, string>>({})
  const [showNewVehicle, setShowNewVehicle] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null)
  const [payForm, setPayForm]         = useState({ amount: '', type: 'ADVANCE', description: '', refNumber: '' })
  const [saving, setSaving]           = useState(false)
  const paymentAmountError = getPaymentAmountError(payForm.amount)
  const [lightbox, setLightbox]       = useState<{ url: string; label: string } | null>(null)

  // ── Data loading ───────────────────────────────────────────────────────────

  async function loadDrivers() {
    setLoadingD(true)
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/ground/drivers?${params}`)
      const data = await res.json()
      if (data.success) setDrivers(data.data)
    } finally { setLoadingD(false) }
  }

  async function loadVehicles() {
    setLoadingV(true)
    try {
      const res = await fetch('/api/ground/vehicles?all=1')
      const data = await res.json()
      if (data.success) setVehicles(data.data)
      setVehLoaded(true)
    } finally { setLoadingV(false) }
  }

  useEffect(() => { loadDrivers() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load vehicles once on mount so the "All Vehicles" / "Total Vehicles" counts are
  // correct before the user ever opens the Vehicles tab.
  useEffect(() => { loadVehicles() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'vehicles' && !vehLoaded) loadVehicles()
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered lists ─────────────────────────────────────────────────────────

  const filteredDrivers = useMemo(() => drivers.filter(d => {
    // Exclude vendor's drivers
    if (d.vendorId) return false
    const q = dSearch.trim().toLowerCase()
    if (q) {
      const hit = [d.name, d.phone, d.licenseNo, d.vehicle?.brand, d.vehicle?.model, d.vehicle?.type, d.vehicle?.plateNo, d.email]
        .some(v => v?.toLowerCase().includes(q))
      if (!hit) return false
    }
    if (dTypeFilter && d.vehicle?.type !== dTypeFilter) return false
    if (dCapFilter && (!d.vehicle || d.vehicle.capacity < Number(dCapFilter))) return false
    return true
  }), [drivers, dSearch, dTypeFilter, dCapFilter])

  const filteredVehicles = useMemo(() => vehicles.filter(v => {
    const q = vSearch.trim().toLowerCase()
    if (q) {
      const hit = [v.plateNo, v.type, v.brand, v.model, v.description, v.vendor?.name, v.driver?.name, v.driver?.phone, String(v.capacity)]
        .some(s => s?.toLowerCase().includes(q))
      if (!hit) return false
    }
    if (vTypeFilter && v.type !== vTypeFilter) return false
    if (vCapFilter && v.capacity < Number(vCapFilter)) return false
    if (vOwnerFilter === 'independent' && v.vendor) return false
    if (vOwnerFilter === 'vendor' && !v.vendor) return false
    return true
  }), [vehicles, vSearch, vTypeFilter, vCapFilter, vOwnerFilter])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const stats = useMemo(() => ({
    indepDrivers: drivers.filter(d => !d.vendorId).length,
    activeDrivers: drivers.filter(d => !d.vendorId && d.isActive).length,
    withVehicle: drivers.filter(d => !d.vendorId && d.vehicle).length,
    totalVehicles: vehicles.length,
    vendorVehicles: vehicles.filter(v => v.vendor).length,
    indepVehicles: vehicles.filter(v => !v.vendor).length,
  }), [drivers, vehicles])

  // ── Export ─────────────────────────────────────────────────────────────────

  async function exportDrivers() {
    setExportingD(true)
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/ground/drivers/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `drivers-report-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
      toast.success('Report downloaded')
    } catch { toast.error('Export failed') }
    setExportingD(false)
  }

  // ── Driver actions ─────────────────────────────────────────────────────────

  async function loadDriverDetail(id: string) {
    if (expandedId === id) { setExpandedId(null); return }
    setDetailLoading(id)
    try {
      const [detailRes, waRes] = await Promise.all([
        fetch(`/api/ground/drivers/${id}`),
        fetch(`/api/ground/drivers/${id}/whatsapp`),
      ])
      const detail = await detailRes.json()
      const wa     = await waRes.json()
      if (detail.success) {
        setDrivers(prev => prev.map(d => d.id === id ? { ...d, ...detail.data } : d))
        setExpandedId(id)
      }
      if (wa.success) setDriverMessages(prev => ({ ...prev, [id]: wa.data ?? [] }))
    } finally { setDetailLoading(null) }
  }

  async function sendDriverMessage(driver: Driver) {
    const text = msgText[driver.id]?.trim()
    if (!text) return
    setSendingMsg(driver.id)
    try {
      const res  = await fetch(`/api/ground/drivers/${driver.id}/whatsapp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Send failed')
      toast.success('Message sent to driver')
      setMsgText(prev => ({ ...prev, [driver.id]: '' }))
      setDriverMessages(prev => ({ ...prev, [driver.id]: [json.data, ...(prev[driver.id] ?? [])] }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally { setSendingMsg(null) }
  }

  async function uploadPhoto(file: File, field: 'driver' | 'outside' | 'inside') {
    const fd = new FormData(); fd.append('file', file); setUploadingPhoto(field)
    try {
      const res  = await fetch('/api/upload/photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) {
        if (field === 'driver')   setForm(f => ({ ...f, photoUrl: data.data.url }))
        else if (field === 'outside') setVehForm(f => ({ ...f, photoOutside: data.data.url }))
        else setVehForm(f => ({ ...f, photoInside: data.data.url }))
      } else toast.error('Photo upload failed')
    } catch { toast.error('Photo upload failed') }
    finally { setUploadingPhoto(null) }
  }

  function openEdit(driver: Driver) {
    setForm({ name: driver.name, phone: driver.phone, email: driver.email ?? '', licenseNo: driver.licenseNo ?? '', isActive: driver.isActive, photoUrl: driver.photoUrl ?? '', vehicleId: driver.vehicleId ?? '', country: driver.country ?? '', bankName: driver.bankName ?? '', bankAccountNo: driver.bankAccountNo ?? '', bankHolder: driver.bankHolder ?? '', bankBranch: driver.bankBranch ?? '', bankCode: driver.bankCode ?? '' })
    if (driver.vehicle) {
      setVehForm({ plateNo: driver.vehicle.plateNo, type: driver.vehicle.type, brand: driver.vehicle.brand ?? '', model: driver.vehicle.model ?? '', capacity: String(driver.vehicle.capacity), photoOutside: driver.vehicle.photoOutside ?? '', photoInside: driver.vehicle.photoInside ?? '' })
      setShowNewVehicle(true)
    } else {
      setVehForm({ plateNo: '', type: 'van', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '' })
      setShowNewVehicle(false)
    }
    setVehErrors({}); setDriverErrors({}); setEditDriver(driver)
  }

  function openAdd() {
    setForm({ name: '', phone: '', email: '', licenseNo: '', isActive: true, photoUrl: '', vehicleId: '', country: defaultDriverCountry, bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '' })
    setVehForm({ plateNo: '', type: 'van', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '' })
    setVehErrors({}); setDriverErrors({}); setShowNewVehicle(false); setShowAdd(true)
  }

  async function saveDriver() {
    const dErrors = validateDriverForm(form)
    if (Object.values(dErrors).some(e => e.trim())) { setDriverErrors(dErrors); toast.error('Please fix highlighted fields'); return }
    if (showNewVehicle) {
      const errors = validateVehicleForm(vehForm)
      if (Object.values(errors).some(e => e.trim())) { setVehErrors(errors); toast.error('Please fix vehicle form errors'); return }
    }
    setSaving(true)
    try {
      let vehicleId = form.vehicleId
      if (showNewVehicle && vehForm.plateNo) {
        const vPayload = { plateNo: vehForm.plateNo, type: vehForm.type, brand: vehForm.brand || null, model: vehForm.model || null, capacity: Number(vehForm.capacity), photoOutside: vehForm.photoOutside || null, photoInside: vehForm.photoInside || null }
        if (editDriver?.vehicleId) {
          const vRes = await fetch(`/api/ground/vehicles/${editDriver.vehicleId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vPayload) })
          const vData = await vRes.json()
          if (!vData.success) { toast.error('Failed to update vehicle'); return }
          vehicleId = editDriver.vehicleId
        } else {
          const vRes = await fetch('/api/ground/vehicles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vPayload) })
          const vData = await vRes.json()
          if (!vData.success) { toast.error('Failed to create vehicle'); return }
          vehicleId = vData.data.id
        }
      }
      const url = editDriver ? `/api/ground/drivers/${editDriver.id}` : '/api/ground/drivers'
      const res = await fetch(url, { method: editDriver ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, vehicleId: vehicleId || null }) })
      const data = await res.json()
      if (data.success) {
        toast.success(editDriver ? 'Driver updated' : 'Driver added')
        setEditDriver(null); setShowAdd(false); setShowNewVehicle(false); loadDrivers()
      } else toast.error(data.error ?? 'Failed')
    } finally { setSaving(false) }
  }

  async function deleteDriver(id: string) {
    if (!confirm('Delete this driver? Cannot be undone.')) return
    const res  = await fetch(`/api/ground/drivers/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) { toast.success('Driver deleted'); loadDrivers() }
    else toast.error(data.error ?? 'Failed')
  }

  async function bulkDelete() {
    if (!selectedIds.size || !confirm(`Delete ${selectedIds.size} driver(s)? Cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      const results = await Promise.all(Array.from(selectedIds).map(id => fetch(`/api/ground/drivers/${id}`, { method: 'DELETE' }).then(r => r.json())))
      const failed = results.filter(r => !r.success).length
      if (!failed) toast.success(`${selectedIds.size} driver(s) deleted`)
      else toast.error(`${failed} deletion(s) failed`)
      setSelectedIds(new Set()); loadDrivers()
    } finally { setBulkDeleting(false) }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll() {
    setSelectedIds(
      selectedIds.size === filteredDrivers.length && filteredDrivers.length > 0
        ? new Set()
        : new Set(filteredDrivers.map(d => d.id))
    )
  }

  async function addPayment(driverId: string) {
    const amountError = getPaymentAmountError(payForm.amount)
    if (amountError || !payForm.type) { toast.error(amountError || 'Select a payment type'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/ground/drivers/${driverId}/payments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payForm) })
      const data = await res.json()
      if (data.success) {
        toast.success('Payment recorded'); setShowPayModal(null)
        setPayForm({ amount: '', type: 'ADVANCE', description: '', refNumber: '' })
        loadDriverDetail(driverId)
      } else toast.error(data.error ?? 'Failed')
    } finally { setSaving(false) }
  }

  const hasActiveDFilters = dTypeFilter || dCapFilter
  const hasActiveVFilters = vTypeFilter || vCapFilter || vOwnerFilter !== 'all'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="Drivers & Vehicles"
        subtitle="Manage independent drivers, all vehicles and payment records"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportDrivers}
              disabled={exportingD}
              className="btn-secondary btn flex items-center gap-1.5"
              title="Download Excel report"
            >
              {exportingD ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export
            </button>
            <button
              onClick={() => {
                const country = countryFilter !== 'ALL' ? countryFilter : (defaultDriverCountry || '')
                const url = `${window.location.origin}/register/driver${country ? `?country=${country}` : ''}`
                navigator.clipboard.writeText(url).then(() => toast.success('Registration link copied!')).catch(() => prompt('Copy this link:', url))
              }}
              className="btn-secondary btn"
            >
              <Link2 className="w-4 h-4" /> Copy Link
            </button>
            {activeTab === 'drivers' && (
              <button onClick={openAdd} className="btn-primary btn">
                <Plus className="w-4 h-4" /> Add Driver
              </button>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-5">

        {/* ── Stats strip ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { icon: <Users className="w-4 h-4 text-brand-500" />,   label: 'Drivers',          value: stats.indepDrivers,  bg: 'bg-brand-50' },
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, label: 'Active',     value: stats.activeDrivers, bg: 'bg-emerald-50' },
            { icon: <Truck className="w-4 h-4 text-violet-500" />,  label: 'With Vehicle',     value: stats.withVehicle,   bg: 'bg-violet-50' },
            { icon: <Car className="w-4 h-4 text-sky-500" />,       label: 'Total Vehicles',   value: stats.totalVehicles, bg: 'bg-sky-50' },
            { icon: <ShieldCheck className="w-4 h-4 text-amber-500" />, label: 'Independent',  value: stats.indepVehicles, bg: 'bg-amber-50' },
            { icon: <Building2 className="w-4 h-4 text-rose-500" />, label: 'Vendor Fleet',   value: stats.vendorVehicles,bg: 'bg-rose-50' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 flex items-center gap-3 border border-white/60`}>
              <div>{s.icon}</div>
              <div>
                <p className="text-xl font-bold text-slate-800 leading-none">{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Tabs ───────────────────────────────────────────────────────── */}
        <div className="flex border-b border-slate-200 gap-1">
          {([
            { key: 'drivers',  label: 'Independent Drivers', icon: <Users className="w-4 h-4" />,  count: stats.indepDrivers },
            { key: 'vehicles', label: 'All Vehicles',        icon: <Layers className="w-4 h-4" />, count: stats.totalVehicles || vehicles.length },
          ] as { key: ActiveTab; label: string; icon: React.ReactNode; count: number }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all -mb-px ${
                activeTab === tab.key
                  ? 'border-brand-500 text-brand-600 bg-brand-50/50'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.icon}
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${activeTab === tab.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════
            TAB 1 — INDEPENDENT DRIVERS
        ════════════════════════════════════════════════════════ */}
        {activeTab === 'drivers' && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-[220px] max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  value={dSearch} onChange={e => setDSearch(e.target.value)}
                  placeholder="Search name, phone, license, plate, brand, type, model…"
                  className="form-input pl-9 pr-10"
                />
                {dSearch && (
                  <button type="button" onClick={() => setDSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Vehicle Type</label>
                <select value={dTypeFilter} onChange={e => setDTypeFilter(e.target.value)}
                  className={`form-select text-sm py-2 pr-8 ${dTypeFilter ? 'border-brand-400 ring-1 ring-brand-300' : ''}`}>
                  <option value="">All Types</option>
                  {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Min Seats</label>
                <select value={dCapFilter} onChange={e => setDCapFilter(e.target.value)}
                  className={`form-select text-sm py-2 pr-8 ${dCapFilter ? 'border-brand-400 ring-1 ring-brand-300' : ''}`}>
                  <option value="">Any</option>
                  {['2','4','6','8','10','15','20','30'].map(n => <option key={n} value={n}>{n}+ seats</option>)}
                </select>
              </div>
              {hasActiveDFilters && (
                <button type="button" onClick={() => { setDTypeFilter(''); setDCapFilter('') }}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg border border-slate-200 hover:border-red-200 hover:bg-red-50 transition-colors">
                  <X className="w-3.5 h-3.5" /> Clear Filters
                </button>
              )}
            </div>

            {loadingD ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
            ) : filteredDrivers.length === 0 ? (
              <Card className="p-12 text-center">
                <User className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">{dSearch || hasActiveDFilters ? 'No drivers match the current search / filters' : 'No independent drivers yet'}</p>
                <p className="text-slate-400 text-sm mt-1">{!dSearch && !hasActiveDFilters && 'Vendor drivers are managed under their respective vendors.'}</p>
              </Card>
            ) : (
              <div className="space-y-4">
                {canDelete && filteredDrivers.length > 0 && (
                  <div className="flex items-center gap-3 px-1">
                    <input type="checkbox"
                      checked={selectedIds.size === filteredDrivers.length && filteredDrivers.length > 0}
                      ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredDrivers.length }}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 cursor-pointer" />
                    <span className="text-xs text-slate-500">
                      {selectedIds.size > 0 ? `${selectedIds.size} of ${filteredDrivers.length} selected` : `Select all (${filteredDrivers.length})`}
                    </span>
                  </div>
                )}

                {filteredDrivers.map(driver => {
                  const isExpanded = expandedId === driver.id
                  const isSelected = selectedIds.has(driver.id)
                  return (
                    <Card key={driver.id} className={`overflow-hidden transition-all ${isExpanded ? 'ring-2 ring-brand-500/20' : ''} ${isSelected ? 'ring-2 ring-brand-400 bg-brand-50/30' : ''}`}>
                      <div className="p-5 flex items-center gap-4">
                        {canDelete && (
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(driver.id)} onClick={e => e.stopPropagation()}
                            className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 cursor-pointer flex-shrink-0" />
                        )}
                        {/* Avatar */}
                        <div
                          className={`w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 bg-brand-500/10 flex items-center justify-center ${driver.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : ''}`}
                          onClick={() => driver.photoUrl && setLightbox({ url: driver.photoUrl, label: driver.name })}
                        >
                          {driver.photoUrl ? <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden') }} /> : null}
                          <User className={`w-6 h-6 text-brand-500 ${driver.photoUrl ? 'hidden' : ''}`} />
                        </div>
                        {/* Info grid */}
                        <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-900">{driver.name}</p>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${driver.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                {driver.isActive ? 'Active' : 'Inactive'}
                              </span>
                              {driver.country && (
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${COUNTRY_BADGE[driver.country] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                  <span className="inline-flex items-center gap-1">
                                    <CountryFlag country={driver.country} className="w-4 h-3" />
                                    {countryLabel(driver.country as import('@/lib/country-detection').OperationCountry)}
                                  </span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500"><Phone className="w-3 h-3" /> {driver.phone}</div>
                            {driver.email && <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400"><Mail className="w-3 h-3" /> {driver.email}</div>}
                          </div>
                          <div>
                            {driver.vehicle ? (
                              <div className="flex items-start gap-2">
                                <Truck className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{driver.vehicle.plateNo}</p>
                                  <p className="text-xs text-slate-500">{[driver.vehicle.brand, driver.vehicle.model].filter(Boolean).join(' ') || driver.vehicle.type}{' · '}{driver.vehicle.capacity} seats</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-xs text-slate-400"><Truck className="w-4 h-4" /> No vehicle</div>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-amber-500" /><span className="text-xs text-slate-500">Advance Balance</span></div>
                            <p className={`text-base font-bold mt-0.5 ${Number(driver.advanceBalance) > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                              {formatCurrency(Number(driver.advanceBalance))}
                            </p>
                            {driver.bankName && <p className="text-xs text-slate-400 mt-0.5">{driver.bankName} · ****{driver.bankAccountNo?.slice(-4)}</p>}
                          </div>
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button onClick={() => openEdit(driver)} className="btn-ghost btn btn-sm"><Edit2 className="w-4 h-4" /></button>
                          {/* Payment action temporarily disabled while payment processing is under review.

                          <button onClick={() => { setShowPayModal(driver.id); setPayForm({ amount: '', type: 'ADVANCE', description: '', refNumber: '' }) }} className="btn-secondary btn btn-sm">

                            <DollarSign className="w-4 h-4" /> Payment

                          </button>

                          */}
                          {canDelete && (
                            <button onClick={() => deleteDriver(driver.id)} className="btn-ghost btn btn-sm text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                          )}
                          <button onClick={() => loadDriverDetail(driver.id)} className="btn-ghost btn btn-sm">
                            {detailLoading === driver.id ? <Loader2 className="w-4 h-4 animate-spin" /> : isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && driver.driverPayments !== undefined && (
                        <div className="border-t border-slate-100 bg-slate-50/50 p-5 space-y-5">
                          <div className="flex items-center gap-1 rounded-lg bg-slate-200/60 p-0.5 w-fit">
                            {([
                              ['details', 'Details', ClipboardList],
                              ['performance', 'Performance', BarChart3],
                            ] as const).map(([key, label, Icon]) => (
                              <button
                                key={key}
                                onClick={() => setDetailTab(prev => ({ ...prev, [driver.id]: key }))}
                                className={cn(
                                  'px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors',
                                  (detailTab[driver.id] ?? 'details') === key
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700',
                                )}
                              >
                                <Icon className="w-3.5 h-3.5" />{label}
                              </button>
                            ))}
                          </div>

                          {(detailTab[driver.id] ?? 'details') === 'performance' ? (
                            <PartnerPerformance
                              kind="driver"
                              id={driver.id}
                              showValue={isAdmin}
                              onOpenBooking={ref => window.open(`/dashboard/bookings/${ref}`, '_blank')}
                            />
                          ) : (
                          <>
                          {(driver.photoUrl || driver.vehicle?.photoOutside || driver.vehicle?.photoInside) && (
                            <div className="flex flex-wrap gap-4">
                              {driver.photoUrl && (
                                <div className="flex flex-col items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Driver</span>
                                  <button onClick={() => setLightbox({ url: driver.photoUrl!, label: `${driver.name} — Profile` })} className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:ring-2 hover:ring-brand-400 transition-all">
                                    <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" />
                                  </button>
                                </div>
                              )}
                              {driver.vehicle?.photoOutside && (
                                <div className="flex flex-col items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Outside</span>
                                  <button onClick={() => setLightbox({ url: driver.vehicle!.photoOutside!, label: `${driver.vehicle!.plateNo} — Outside` })} className="w-28 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:ring-2 hover:ring-emerald-400 transition-all">
                                    <img src={driver.vehicle.photoOutside} alt="Outside" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                                  </button>
                                </div>
                              )}
                              {driver.vehicle?.photoInside && (
                                <div className="flex flex-col items-center gap-1.5">
                                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Inside</span>
                                  <button onClick={() => setLightbox({ url: driver.vehicle!.photoInside!, label: `${driver.vehicle!.plateNo} — Inside` })} className="w-28 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 hover:ring-2 hover:ring-emerald-400 transition-all">
                                    <img src={driver.vehicle.photoInside} alt="Inside" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* Bank */}
                            <div>
                              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-500" />Bank Account</h4>
                              {driver.bankAccountNo ? (
                                <div className="space-y-2 text-sm">
                                  {[['Bank', driver.bankName],['Account No.', driver.bankAccountNo],['Holder', driver.bankHolder],['Branch', driver.bankBranch],['Code', driver.bankCode]].filter(([,v]) => v).map(([k, v]) => (
                                    <div key={k as string} className="flex items-center gap-2">
                                      <span className="text-slate-400 w-24 flex-shrink-0">{k}</span>
                                      <span className="font-medium text-slate-700 font-mono">{v}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : <p className="text-sm text-slate-400">No bank details</p>}
                            </div>
                            {/* Payments */}
                            <div>
                              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-brand-500" />Payment History</h4>
                              {driver.driverPayments!.length === 0 ? (
                                <p className="text-sm text-slate-400">No payments yet</p>
                              ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto">
                                  {driver.driverPayments!.map(p => (
                                    <div key={p.id} className="flex items-center gap-3 text-sm bg-white rounded-lg px-3 py-2.5 border border-slate-100">
                                      {p.type === 'DEDUCTION' ? <ArrowDownCircle className="w-4 h-4 text-red-500 flex-shrink-0" /> : <ArrowUpCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className={`badge border text-[10px] ${PAY_TYPE_COLORS[p.type] ?? 'bg-slate-100 text-slate-600 border-slate-100'}`}>{p.type}</span>
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
                            {/* WhatsApp */}
                            <div>
                              <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><MessageCircle className="w-4 h-4 text-emerald-500" />WhatsApp</h4>
                              <div className="flex gap-2 mb-3">
                                <input
                                  type="text" placeholder="Type a message…"
                                  value={msgText[driver.id] ?? ''}
                                  onChange={e => setMsgText(prev => ({ ...prev, [driver.id]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendDriverMessage(driver) } }}
                                  className="flex-1 px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-300"
                                />
                                <button onClick={() => sendDriverMessage(driver)} disabled={sendingMsg === driver.id || !msgText[driver.id]?.trim()}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40 transition-colors">
                                  {sendingMsg === driver.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {(driverMessages[driver.id] ?? []).length === 0 ? (
                                  <p className="text-xs text-slate-400 py-2">No messages sent yet.</p>
                                ) : (driverMessages[driver.id] ?? []).map(m => (
                                  <div key={m.id} className="bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[10px] font-mono text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">{m.bookingRef !== 'MANUAL' ? m.bookingRef : 'Manual'}</span>
                                      <span className="text-[10px] text-slate-400 ml-auto flex items-center gap-1"><Clock className="w-2.5 h-2.5" />{new Date(m.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed line-clamp-3">{m.body}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                          </>
                          )}
                        </div>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB 2 — ALL VEHICLES
        ════════════════════════════════════════════════════════ */}
        {activeTab === 'vehicles' && (
          <>
            {/* Filters */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-[240px] max-w-2xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  value={vSearch} onChange={e => setVSearch(e.target.value)}
                  placeholder="Search plate, type, brand, model, driver name, vendor, capacity…"
                  className="form-input pl-9 pr-10"
                />
                {vSearch && (
                  <button type="button" onClick={() => setVSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Type</label>
                <select value={vTypeFilter} onChange={e => setVTypeFilter(e.target.value)}
                  className={`form-select text-sm py-2 pr-8 ${vTypeFilter ? 'border-brand-400 ring-1 ring-brand-300' : ''}`}>
                  <option value="">All Types</option>
                  {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Min Seats</label>
                <select value={vCapFilter} onChange={e => setVCapFilter(e.target.value)}
                  className={`form-select text-sm py-2 pr-8 ${vCapFilter ? 'border-brand-400 ring-1 ring-brand-300' : ''}`}>
                  <option value="">Any</option>
                  {['2','4','6','8','10','15','20','30'].map(n => <option key={n} value={n}>{n}+ seats</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Ownership</label>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  {([['all','All'],['independent','Independent'],['vendor','Vendor']] as [typeof vOwnerFilter, string][]).map(([val, label]) => (
                    <button key={val} onClick={() => setVOwnerFilter(val)}
                      className={`px-3 py-2 text-xs font-semibold transition-all ${vOwnerFilter === val ? 'bg-brand-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {hasActiveVFilters && (
                <button type="button" onClick={() => { setVTypeFilter(''); setVCapFilter(''); setVOwnerFilter('all') }}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg border border-slate-200 hover:border-red-200 hover:bg-red-50 transition-colors">
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>

            {/* Results summary */}
            {!loadingV && (
              <p className="text-xs text-slate-500">
                Showing <span className="font-semibold text-slate-700">{filteredVehicles.length}</span> of {vehicles.length} vehicles
                {' '}·{' '}<span className="text-amber-600 font-medium">{filteredVehicles.filter(v => !v.vendor).length} independent</span>
                {' '}·{' '}<span className="text-rose-600 font-medium">{filteredVehicles.filter(v => v.vendor).length} vendor</span>
              </p>
            )}

            {loadingV ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
            ) : filteredVehicles.length === 0 ? (
              <Card className="p-12 text-center">
                <Car className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">{vSearch || hasActiveVFilters ? 'No vehicles match the current search / filters' : 'No vehicles found'}</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredVehicles.map(v => (
                  <div key={v.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md hover:border-slate-300 transition-all group">
                    {/* Photo */}
                    <div className="relative h-36 bg-gradient-to-br from-slate-100 to-slate-50 overflow-hidden">
                      {v.photoOutside ? (
                        <button onClick={() => setLightbox({ url: v.photoOutside!, label: v.plateNo })} className="w-full h-full">
                          <img src={v.photoOutside} alt={v.plateNo} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={e => { e.currentTarget.style.display = 'none' }} />
                        </button>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Car className="w-14 h-14 text-slate-200" />
                        </div>
                      )}
                      {/* Ownership badge */}
                      <div className="absolute top-2 right-2">
                        {v.vendor ? (
                          <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">{v.vendor.name}</span>
                        ) : (
                          <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">Independent</span>
                        )}
                      </div>
                      {/* Type badge */}
                      <div className="absolute bottom-2 left-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TYPE_COLORS[v.type] ?? 'bg-slate-200 text-slate-700'}`}>
                          {v.type.charAt(0).toUpperCase() + v.type.slice(1)}
                        </span>
                      </div>
                    </div>

                    {/* Details */}
                    <div className="p-4 space-y-3">
                      <div>
                        <p className="font-bold text-slate-900 font-mono text-base">{v.plateNo}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[v.brand, v.model].filter(Boolean).join(' ') || '—'}
                        </p>
                      </div>

                      {/* Capacity + seats */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 bg-slate-50 rounded-lg px-2.5 py-1.5">
                          <Users className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm font-bold text-slate-700">{v.capacity}</span>
                          <span className="text-xs text-slate-400">seats</span>
                        </div>
                        {v.isActive === false && (
                          <span className="text-[10px] bg-red-50 text-red-500 border border-red-100 px-2 py-0.5 rounded-full font-semibold">Inactive</span>
                        )}
                      </div>

                      {/* Driver or vendor */}
                      {v.driver ? (
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                          <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                            <User className="w-3 h-3 text-brand-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">{v.driver.name}</p>
                            <p className="text-[10px] text-slate-400">{v.driver.phone}</p>
                          </div>
                        </div>
                      ) : v.vendor ? (
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                          <div className="w-6 h-6 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-3 h-3 text-rose-600" />
                          </div>
                          <p className="text-xs font-semibold text-slate-700 truncate">{v.vendor.name}</p>
                        </div>
                      ) : (
                        <div className="pt-1 border-t border-slate-100">
                          <p className="text-xs text-slate-400 italic">No driver assigned</p>
                        </div>
                      )}

                      {/* Description */}
                      {v.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-2 italic">{v.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900 text-white px-5 py-3 rounded-2xl shadow-2xl">
          <span className="text-sm font-medium">{selectedIds.size} driver{selectedIds.size > 1 ? 's' : ''} selected</span>
          <div className="w-px h-5 bg-white/20" />
          <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-white transition-colors">Clear</button>
          <button onClick={bulkDelete} disabled={bulkDeleting}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors">
            {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            Delete Selected
          </button>
        </div>
      )}

      {/* Add/Edit Driver Modal */}
      <Modal open={!!(editDriver || showAdd)} onClose={() => { setEditDriver(null); setShowAdd(false); setShowNewVehicle(false) }}
        title={editDriver ? `Edit Driver — ${editDriver.name}` : 'Add New Driver'} size="lg">
        <div className="space-y-6">
          {/* Driver Photo */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Camera className="w-4 h-4 text-brand-500" /> Driver Photo</h3>
            <div className="flex items-center gap-4">
              <div className={`w-20 h-20 rounded-full overflow-hidden bg-brand-50 border-2 border-dashed border-brand-200 flex items-center justify-center flex-shrink-0 ${form.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : ''}`}
                onClick={() => form.photoUrl && setLightbox({ url: form.photoUrl, label: 'Driver Profile Photo' })}>
                {form.photoUrl ? (
                  <><img src={form.photoUrl} alt="Driver" className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden') }} /><User className="w-8 h-8 text-brand-300 hidden" /></>
                ) : <User className="w-8 h-8 text-brand-300" />}
              </div>
              <div className="flex flex-col gap-2">
                <label className="btn-secondary btn btn-sm cursor-pointer">
                  {uploadingPhoto === 'driver' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {form.photoUrl ? 'Change Photo' : 'Upload Photo'}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'driver')} />
                </label>
                {form.photoUrl && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setLightbox({ url: form.photoUrl, label: 'Driver Profile Photo' })} className="text-xs text-brand-500 hover:text-brand-700 px-2 underline">View Full</button>
                    <button type="button" onClick={() => setForm(f => ({ ...f, photoUrl: '' }))} className="text-xs text-red-400 hover:text-red-600 px-2">Remove</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Basic info */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><User className="w-4 h-4 text-brand-500" /> Basic Information</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Full Name * <span className="text-slate-400 text-xs ml-1">{form.name.length}/100</span></label>
                <input value={form.name} maxLength={100} className={`form-input ${driverErrors.name ? 'border-red-500 focus:ring-red-300' : ''}`} placeholder="Nguyen Van Minh"
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, name: v })); setDriverErrors(p => ({ ...p, name: validateDriverForm({ ...form, name: v }).name || '' })) }} />
                {driverErrors.name && <p className="text-xs text-red-500 mt-1">{driverErrors.name}</p>}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Phone * <span className="text-slate-400 text-xs ml-1">{form.phone.length}/20</span></label>
                <input value={form.phone} maxLength={20} className={`form-input ${driverErrors.phone ? 'border-red-500 focus:ring-red-300' : ''}`} placeholder="+84-905-123456"
                  onChange={e => { const v = e.target.value.replace(PHONE_RE, ''); setForm(f => ({ ...f, phone: v })); setDriverErrors(p => ({ ...p, phone: validateDriverForm({ ...form, phone: v }).phone || '' })) }} />
                {driverErrors.phone && <p className="text-xs text-red-500 mt-1">{driverErrors.phone}</p>}
              </div>
              <div>
                <label className="form-label">Email <span className="text-slate-400 text-xs ml-1">{form.email.length}/150</span></label>
                <input value={form.email} maxLength={150} className={`form-input ${driverErrors.email ? 'border-red-500 focus:ring-red-300' : ''}`} placeholder="driver@email.com"
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, email: v })); setDriverErrors(p => ({ ...p, email: validateDriverForm({ ...form, email: v }).email || '' })) }} />
                {driverErrors.email && <p className="text-xs text-red-500 mt-1">{driverErrors.email}</p>}
              </div>
              <div>
                <label className="form-label">License Number <span className="text-slate-400 text-xs ml-1">{form.licenseNo.length}/30</span></label>
                <input value={form.licenseNo} maxLength={30} className={`form-input ${driverErrors.licenseNo ? 'border-red-500 focus:ring-red-300' : ''}`} placeholder="VN-2024-001"
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, licenseNo: v })); setDriverErrors(p => ({ ...p, licenseNo: validateDriverForm({ ...form, licenseNo: v }).licenseNo || '' })) }} />
                {driverErrors.licenseNo && <p className="text-xs text-red-500 mt-1">{driverErrors.licenseNo}</p>}
              </div>
              {isAllCountry && (
                <div className="col-span-2">
                  <label className="form-label">Country / Team</label>
                  <select value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="form-select">
                    <option value="">Not set</option>
                    <option value="VIETNAM">Vietnam</option>
                    <option value="SRILANKA">Sri Lanka</option>
                    <option value="SINGAPORE">Singapore</option>
                    <option value="MALAYSIA">Malaysia</option>
                    <option value="SINGAPORE_MALAYSIA">Singapore &amp; Malaysia (legacy)</option>
                  </select>
                </div>
              )}
            </div>
          </div>
          {/* Vehicle */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2"><Truck className="w-4 h-4 text-emerald-500" /> Vehicle Details</h3>
              {!showNewVehicle && <button type="button" onClick={() => setShowNewVehicle(true)} className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"><Plus className="w-3 h-3" /> Add Vehicle</button>}
            </div>
            {showNewVehicle ? (
              <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Plate Number * <span className="text-slate-400 text-xs ml-1">{vehForm.plateNo.length}/20</span></label>
                    <input maxLength={20} className={`form-input font-mono ${vehErrors.plateNo ? 'border-red-500 focus:ring-red-300' : ''}`} placeholder="51A-12345" value={vehForm.plateNo}
                      onChange={e => { const v = e.target.value; setVehForm(f => ({ ...f, plateNo: v })); setVehErrors(p => ({ ...p, plateNo: validateVehicleForm({ ...vehForm, plateNo: v }).plateNo || '' })) }} />
                    {vehErrors.plateNo && <p className="text-xs text-red-500 mt-1">{vehErrors.plateNo}</p>}
                  </div>
                  <div>
                    <label className="form-label">Vehicle Type *</label>
                    <select className={`form-select ${vehErrors.type ? 'border-red-500' : ''}`} value={vehForm.type} onChange={e => setVehForm(f => ({ ...f, type: e.target.value }))}>
                      {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Brand <span className="text-slate-400 text-xs ml-1">{vehForm.brand.length}/50</span></label>
                    <input className={`form-input ${vehErrors.brand ? 'border-red-500' : ''}`} placeholder="Toyota" maxLength={50} value={vehForm.brand}
                      onChange={e => { const v = e.target.value; setVehForm(f => ({ ...f, brand: v })); setVehErrors(p => ({ ...p, brand: validateVehicleForm({ ...vehForm, brand: v }).brand || '' })) }} />
                  </div>
                  <div>
                    <label className="form-label">Model <span className="text-slate-400 text-xs ml-1">{vehForm.model.length}/50</span></label>
                    <input className={`form-input ${vehErrors.model ? 'border-red-500' : ''}`} placeholder="Hiace" maxLength={50} value={vehForm.model}
                      onChange={e => { const v = e.target.value; setVehForm(f => ({ ...f, model: v })); setVehErrors(p => ({ ...p, model: validateVehicleForm({ ...vehForm, model: v }).model || '' })) }} />
                  </div>
                  <div>
                    <label className="form-label">Capacity (seats) *</label>
                    <input type="number" className={`form-input ${vehErrors.capacity ? 'border-red-500' : ''}`} min="1" max="60" value={vehForm.capacity}
                      onChange={e => { const v = String(Math.min(Math.max(Number(e.target.value) || 0, 1), 60)); setVehForm(f => ({ ...f, capacity: v })); setVehErrors(p => ({ ...p, capacity: validateVehicleForm({ ...vehForm, capacity: v }).capacity || '' })) }} />
                    {vehErrors.capacity && <p className="text-xs text-red-500 mt-1">{vehErrors.capacity}</p>}
                  </div>
                </div>
                {/* Vehicle photos */}
                <div className="grid grid-cols-2 gap-4">
                  {(['outside','inside'] as ('outside'|'inside')[]).map(side => (
                    <div key={side}>
                      <label className="form-label">{side.charAt(0).toUpperCase() + side.slice(1)} Photo</label>
                      <div className="flex flex-col gap-2">
                        <div className={`h-28 rounded-lg overflow-hidden bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center ${vehForm[side === 'outside' ? 'photoOutside' : 'photoInside'] ? 'cursor-pointer hover:ring-2 hover:ring-emerald-400' : ''}`}
                          onClick={() => { const url = vehForm[side === 'outside' ? 'photoOutside' : 'photoInside']; if (url) setLightbox({ url, label: `Vehicle — ${side}` }) }}>
                          {vehForm[side === 'outside' ? 'photoOutside' : 'photoInside'] ? (
                            <img src={vehForm[side === 'outside' ? 'photoOutside' : 'photoInside']} alt={side} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.display = 'none' }} />
                          ) : <Car className="w-6 h-6 text-slate-300" />}
                        </div>
                        <div className="flex gap-2">
                          <label className="btn-secondary btn btn-sm cursor-pointer flex-1 text-center">
                            {uploadingPhoto === side ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
                            {vehForm[side === 'outside' ? 'photoOutside' : 'photoInside'] ? 'Change' : 'Upload'}
                            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], side)} />
                          </label>
                          {vehForm[side === 'outside' ? 'photoOutside' : 'photoInside'] && (
                            <button type="button" onClick={() => setVehForm(f => ({ ...f, [side === 'outside' ? 'photoOutside' : 'photoInside']: '' }))} className="text-xs text-red-400 hover:text-red-600 px-2">Remove</button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => setShowNewVehicle(false)} className="text-xs text-slate-400 hover:text-red-500">Remove vehicle section</button>
              </div>
            ) : <p className="text-sm text-slate-400 italic">No vehicle attached — click &quot;Add Vehicle&quot; above</p>}
          </div>
          {/* Bank */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-amber-500" />
              {formCountry && <CountryFlag country={formCountry} className="w-4 h-3" />}
              {BANK_LABELS[formCountry] ?? 'Bank Account'}
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Bank Name</label>
                {BANKS_BY_COUNTRY[formCountry] ? (
                  <select value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} className="form-select">
                    <option value="">Select Bank</option>
                    {BANKS_BY_COUNTRY[formCountry].map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <input value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} className="form-input" placeholder="Bank name" />
                )}
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="form-label">Account Number <span className="text-slate-400 text-xs ml-1">{form.bankAccountNo.length}/34</span></label>
                <input value={form.bankAccountNo} maxLength={34} className={`form-input font-mono ${driverErrors.bankAccountNo ? 'border-red-500' : ''}`} placeholder="0123456789"
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, bankAccountNo: v })); setDriverErrors(p => ({ ...p, bankAccountNo: validateDriverForm({ ...form, bankAccountNo: v }).bankAccountNo || '' })) }} />
                {driverErrors.bankAccountNo && <p className="text-xs text-red-500 mt-1">{driverErrors.bankAccountNo}</p>}
              </div>
              <div>
                <label className="form-label">Account Holder <span className="text-slate-400 text-xs ml-1">{form.bankHolder.length}/100</span></label>
                <input value={form.bankHolder} maxLength={100} className="form-input" placeholder={HOLDER_PLACEHOLDERS[formCountry] ?? 'Account holder'}
                  onChange={e => setForm(f => ({ ...f, bankHolder: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Branch / City <span className="text-slate-400 text-xs ml-1">{form.bankBranch.length}/100</span></label>
                <input value={form.bankBranch} maxLength={100} className="form-input" placeholder={BRANCH_PLACEHOLDERS[formCountry] ?? 'Branch'}
                  onChange={e => setForm(f => ({ ...f, bankBranch: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="form-label">SWIFT / Code <span className="text-slate-400 text-xs ml-1">{form.bankCode.length}/20</span></label>
                <input value={form.bankCode} maxLength={20} className={`form-input font-mono ${driverErrors.bankCode ? 'border-red-500' : ''}`} placeholder={SWIFT_PLACEHOLDERS[formCountry] ?? 'SWIFT code'}
                  onChange={e => { const v = e.target.value; setForm(f => ({ ...f, bankCode: v })); setDriverErrors(p => ({ ...p, bankCode: validateDriverForm({ ...form, bankCode: v }).bankCode || '' })) }} />
                {driverErrors.bankCode && <p className="text-xs text-red-500 mt-1">{driverErrors.bankCode}</p>}
              </div>
            </div>
          </div>
          {/* Status */}
          <div className="flex items-center gap-3">
            <input type="checkbox" id="isActive" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
            <label htmlFor="isActive" className="text-sm font-medium text-slate-700">Active Driver</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={saveDriver} disabled={saving || !form.name || !form.phone || Object.values(driverErrors).some(e => e.trim()) || (showNewVehicle && Object.values(vehErrors).some(e => e.trim()))} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {editDriver ? 'Save Changes' : 'Add Driver'}
            </button>
            <button onClick={() => { setEditDriver(null); setShowAdd(false); setShowNewVehicle(false) }} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Add Payment Modal */}
      <Modal open={!!showPayModal} onClose={() => setShowPayModal(null)} title="Record Driver Payment">
        <div className="space-y-4">
          <div>
            <label className="form-label">Payment Type *</label>
            <select value={payForm.type} onChange={e => setPayForm(f => ({ ...f, type: e.target.value }))} className="form-select">
              <option value="ADVANCE">Advance Payment</option>
              <option value="SALARY">Salary</option>
              <option value="REIMBURSEMENT">Reimbursement</option>
              <option value="DEDUCTION">Deduction</option>
            </select>
          </div>
          <div>
            <label className="form-label">Amount (USD) *</label>
            <input type="number" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} className={cn('form-input', paymentAmountError && payForm.amount ? 'border-red-400 focus:border-red-400' : '')} placeholder="0.00" min="0.01" max="99999999.99" step="0.01" required aria-invalid={!!paymentAmountError} />
            {paymentAmountError && <p className="mt-1 text-xs text-red-600">{paymentAmountError}</p>}
          </div>
          <div>
            <label className="form-label">Reference Number</label>
            <input value={payForm.refNumber} onChange={e => setPayForm(f => ({ ...f, refNumber: e.target.value }))} className="form-input" placeholder="REF-2026-001" />
          </div>
          <div>
            <label className="form-label">Description</label>
            <input value={payForm.description} onChange={e => setPayForm(f => ({ ...f, description: e.target.value }))} className="form-input" placeholder="e.g. Monthly advance for June" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => addPayment(showPayModal!)} disabled={saving || !!paymentAmountError} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Record Payment
            </button>
            <button onClick={() => setShowPayModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Photo Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex flex-col items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-white font-medium text-sm">{lightbox.label}</span>
              <button onClick={() => setLightbox(null)} className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <img src={lightbox.url} alt={lightbox.label} className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl" />
            <a href={lightbox.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white underline" onClick={e => e.stopPropagation()}>Open original</a>
          </div>
        </div>
      )}
    </div>
  )
}
