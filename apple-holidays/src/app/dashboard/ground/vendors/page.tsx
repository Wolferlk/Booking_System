'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, Truck, Phone, Mail, MapPin, Edit2, Trash2, Car,
  ChevronDown, ChevronUp, Link2, CheckCircle2, Power, Globe, UserCheck, Clock,
  Camera, Upload, User2,
} from 'lucide-react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'

interface DriverInVendor {
  id: string
  name: string
  phone: string
  email: string | null
  licenseNo: string | null
  isActive: boolean
  photoUrl: string | null
  vehicle: {
    id: string
    plateNo: string
    type: string
    brand: string | null
    model: string | null
    capacity: number
    photoOutside: string | null
    photoInside: string | null
    isActive: boolean
  } | null
}

interface VehicleInVendor {
  id: string
  type: string
  plateNo: string
  brand: string | null
  model: string | null
  capacity: number
  isActive: boolean
  photoOutside: string | null
  photoInside: string | null
  driver: { id: string; name: string; phone: string; photoUrl: string | null; licenseNo: string | null; isActive: boolean } | null
}

interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  isActive: boolean
  isRegistered: boolean
  country: string | null
  vehicles: VehicleInVendor[]
  drivers: DriverInVendor[]
}

const VEHICLE_TYPES = ['car', 'van', 'minibus', 'bus', 'motorbike']

const COUNTRY_LABELS: Record<string, string> = {
  SRILANKA: 'Sri Lanka',
  VIETNAM: 'Vietnam',
  SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore & Malaysia',
}

const COUNTRIES = [
  { value: 'SRILANKA', label: 'Sri Lanka' },
  { value: 'VIETNAM', label: 'Vietnam' },
  { value: 'SINGAPORE', label: 'Singapore' },
  { value: 'MALAYSIA', label: 'Malaysia' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia' },
]

function sanitizePhoneValue(value: string) {
  const cleaned = value.replace(/[^+0-9\s\-()]/g, '')
  const plusCount = (cleaned.match(/\+/g) || []).length
  if (plusCount <= 1) return cleaned
  return cleaned.replace(/\+/g, '').replace(/^/, '+')
}

function validateEmail(email: string): boolean {
  if (!email) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const emptyVendorForm = () => ({ name: '', phone: '', email: '', address: '', country: '' })
const emptyVehicleForm = () => ({
  type: 'van',
  plateNo: '',
  brand: '',
  model: '',
  capacity: '4',
  photoOutside: '',
  photoInside: '',
  driverId: '',
  isActive: true,
})
const emptyDriverForm = () => ({
  name: '',
  phone: '',
  email: '',
  licenseNo: '',
  photoUrl: '',
  vehicleId: '',
  isActive: true,
})

export default function VendorsPage() {
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()
  const isAdmin = ['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session?.user?.role ?? '')

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [vendorModal, setVendorModal] = useState<Vendor | 'new' | null>(null)
  const [vendorForm, setVendorForm] = useState(emptyVendorForm())
  const [emailError, setEmailError] = useState('')

  const [vehicleModal, setVehicleModal] = useState<{ vendorId: string; vehicle?: VehicleInVendor } | null>(null)
  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm())

  const [driverModal, setDriverModal] = useState<{ vendorId: string; driver?: DriverInVendor } | null>(null)
  const [driverForm, setDriverForm] = useState(emptyDriverForm())

  const [saving, setSaving] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})

  const vehicleOutsideRef = useRef<HTMLInputElement>(null)
  const vehicleInsideRef = useRef<HTMLInputElement>(null)
  const driverPhotoRef = useRef<HTMLInputElement>(null)

  const selectedVendorForVehicle = useMemo(
    () => vendors.find(v => v.id === vehicleModal?.vendorId) ?? null,
    [vendors, vehicleModal?.vendorId],
  )
  const selectedVendorForDriver = useMemo(
    () => vendors.find(v => v.id === driverModal?.vendorId) ?? null,
    [vendors, driverModal?.vendorId],
  )

  async function copyRegLink() {
    const appUrl = window.location.origin
    const link = `${appUrl}/vendor/register`
    await navigator.clipboard.writeText(link).catch(() => prompt('Copy this registration link:', link))
    toast.success('Vendor registration link copied!')
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 3000)
  }

  async function toggleActive(vendor: Vendor) {
    setTogglingId(vendor.id)
    try {
      const res = await fetch(`/api/ground/vendors/${vendor.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !vendor.isActive }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(vendor.isActive ? 'Vendor deactivated' : 'Vendor activated')
      setVendors(prev => prev.map(v => v.id === vendor.id ? { ...v, isActive: !vendor.isActive } : v))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update vendor')
    } finally {
      setTogglingId(null)
    }
  }

  async function load() {
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/ground/vendors?${params}`)
      const data = await res.json()
      if (data.success) {
        setVendors(data.data)
        if (expandedId && !data.data.find((v: Vendor) => v.id === expandedId)) {
          setExpandedId(null)
        }
      } else {
        toast.error(data.error ?? 'Failed to load vendors')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to load vendors')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  function openAddVendor() {
    setVendorForm(emptyVendorForm())
    setEmailError('')
    setVendorModal('new')
  }

  function openEditVendor(vendor: Vendor) {
    setVendorForm({
      name: vendor.name,
      phone: vendor.phone ?? '',
      email: vendor.email ?? '',
      address: vendor.address ?? '',
      country: vendor.country ?? '',
    })
    setEmailError('')
    setVendorModal(vendor)
  }

  async function saveVendor() {
    setSaving(true)
    try {
      if (vendorForm.email && !validateEmail(vendorForm.email)) {
        throw new Error('Please enter a valid email address')
      }

      const url = vendorModal === 'new' ? '/api/ground/vendors' : `/api/ground/vendors/${(vendorModal as Vendor).id}`
      const method = vendorModal === 'new' ? 'POST' : 'PUT'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vendorForm),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(vendorModal === 'new' ? 'Vendor added' : 'Vendor updated')
      setVendorModal(null)
      setEmailError('')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save vendor')
    } finally {
      setSaving(false)
    }
  }

  async function deleteVendor(id: string) {
    if (!confirm('Delete this vendor? Their vehicles and driver links will also be cleared.')) return
    try {
      const res = await fetch(`/api/ground/vendors/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Vendor deleted')
      if (expandedId === id) setExpandedId(null)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete vendor')
    }
  }

  function openAddVehicle(vendorId: string) {
    setVehicleForm(emptyVehicleForm())
    setVehicleModal({ vendorId })
  }

  function openEditVehicle(vendorId: string, vehicle: VehicleInVendor) {
    setVehicleForm({
      type: vehicle.type,
      plateNo: vehicle.plateNo,
      brand: vehicle.brand ?? '',
      model: vehicle.model ?? '',
      capacity: String(vehicle.capacity),
      photoOutside: vehicle.photoOutside ?? '',
      photoInside: vehicle.photoInside ?? '',
      driverId: vehicle.driver?.id ?? '',
      isActive: vehicle.isActive,
    })
    setVehicleModal({ vendorId, vehicle })
  }

  async function uploadPhoto(file: File, target: 'vehicleOutside' | 'vehicleInside' | 'driver') {
    setUploading(prev => ({ ...prev, [target]: true }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/public/upload-photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (!data.success) throw new Error(data.error ?? 'Upload failed')

      if (target === 'vehicleOutside') {
        setVehicleForm(prev => ({ ...prev, photoOutside: data.data.url }))
      } else if (target === 'vehicleInside') {
        setVehicleForm(prev => ({ ...prev, photoInside: data.data.url }))
      } else {
        setDriverForm(prev => ({ ...prev, photoUrl: data.data.url }))
      }
      toast.success('Photo uploaded')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(prev => ({ ...prev, [target]: false }))
    }
  }

  async function saveVehicle() {
    if (!vehicleModal) return
    setSaving(true)
    try {
      const url = vehicleModal.vehicle ? `/api/ground/vehicles/${vehicleModal.vehicle.id}` : '/api/ground/vehicles'
      const method = vehicleModal.vehicle ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: vehicleForm.type,
          plateNo: vehicleForm.plateNo.trim().toUpperCase(),
          brand: vehicleForm.brand,
          model: vehicleForm.model,
          capacity: Number(vehicleForm.capacity),
          photoOutside: vehicleForm.photoOutside,
          photoInside: vehicleForm.photoInside,
          vendorId: vehicleModal.vendorId,
          driverId: vehicleForm.driverId || null,
          isActive: vehicleForm.isActive,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(vehicleModal.vehicle ? 'Vehicle updated' : 'Vehicle added')
      setVehicleModal(null)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save vehicle')
    } finally {
      setSaving(false)
    }
  }

  async function deleteVehicle(id: string) {
    if (!confirm('Remove this vehicle?')) return
    try {
      const res = await fetch(`/api/ground/vehicles/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Vehicle removed')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete vehicle')
    }
  }

  function openAddDriver(vendorId: string) {
    setDriverForm(emptyDriverForm())
    setDriverModal({ vendorId })
  }

  function openEditDriver(vendorId: string, driver: DriverInVendor) {
    setDriverForm({
      name: driver.name,
      phone: driver.phone,
      email: driver.email ?? '',
      licenseNo: driver.licenseNo ?? '',
      photoUrl: driver.photoUrl ?? '',
      vehicleId: driver.vehicle?.id ?? '',
      isActive: driver.isActive,
    })
    setDriverModal({ vendorId, driver })
  }

  async function saveDriver() {
    if (!driverModal) return
    setSaving(true)
    try {
      if (driverForm.email && !validateEmail(driverForm.email)) {
        throw new Error('Please enter a valid email address')
      }

      const url = driverModal.driver ? `/api/ground/drivers/${driverModal.driver.id}` : '/api/ground/drivers'
      const method = driverModal.driver ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: driverForm.name.trim(),
          phone: sanitizePhoneValue(driverForm.phone.trim()),
          email: driverForm.email,
          licenseNo: driverForm.licenseNo,
          photoUrl: driverForm.photoUrl,
          vehicleId: driverForm.vehicleId || null,
          vendorId: driverModal.vendorId,
          isActive: driverForm.isActive,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(driverModal.driver ? 'Driver updated' : 'Driver added')
      setDriverModal(null)
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save driver')
    } finally {
      setSaving(false)
    }
  }

  async function deleteDriver(id: string) {
    if (!confirm('Remove this driver?')) return
    try {
      const res = await fetch(`/api/ground/drivers/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success('Driver removed')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete driver')
    }
  }

  const pendingCount = vendors.filter(v => v.isRegistered && !v.isActive).length

  const availableDriversForVehicle = vehicleModal && selectedVendorForVehicle
    ? selectedVendorForVehicle.drivers.filter(driver => !driver.vehicle || driver.vehicle.id === vehicleModal.vehicle?.id)
    : []

  const availableVehiclesForDriver = driverModal && selectedVendorForDriver
    ? selectedVendorForDriver.vehicles.filter(vehicle => !vehicle.driver || vehicle.driver.id === driverModal.driver?.id)
    : []

  return (
    <div>
      <Header
        title="Vehicle Vendors"
        subtitle="Companies supplying vehicles for tours"
        actions={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <button
                onClick={copyRegLink}
                title="Copy vendor registration link"
                className="btn-secondary btn flex items-center gap-1.5"
              >
                {linkCopied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Link2 className="w-4 h-4" />}
                {linkCopied ? 'Copied!' : 'Copy Reg. Link'}
              </button>
              <button onClick={openAddVendor} className="btn-primary btn">
                <Plus className="w-4 h-4" /> Add Vendor
              </button>
            </div>
          ) : undefined
        }
      />

      {pendingCount > 0 && (
        <div className="mx-8 mt-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Clock className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-sm text-amber-800">
            <span className="font-bold">{pendingCount} vendor{pendingCount > 1 ? 's' : ''}</span> self-registered and pending activation.
            Click the <Power className="inline w-3.5 h-3.5" /> icon to activate.
          </p>
        </div>
      )}

      <div className="p-8 space-y-4 max-w-5xl">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
        ) : vendors.length === 0 ? (
          <Card className="p-12 text-center">
            <Truck className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">No vendors yet</p>
          </Card>
        ) : (
          vendors.map(vendor => {
            const expanded = expandedId === vendor.id
            const isPending = vendor.isRegistered && !vendor.isActive

            return (
              <Card key={vendor.id} className={`overflow-hidden ${isPending ? 'border-amber-200' : ''}`}>
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : vendor.id)}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${isPending ? 'bg-amber-100' : 'bg-purple-100'}`}>
                    <Truck className={`w-5 h-5 ${isPending ? 'text-amber-600' : 'text-purple-600'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-900">{vendor.name}</p>
                      {vendor.isRegistered ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700 flex items-center gap-1">
                          <UserCheck className="w-2.5 h-2.5" /> Registered
                        </span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-400">
                          Not Registered
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${vendor.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {vendor.isActive ? 'Active' : isPending ? 'Pending Approval' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-4 mt-0.5">
                      {vendor.country && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Globe className="w-3 h-3" />{COUNTRY_LABELS[vendor.country] ?? vendor.country}
                        </span>
                      )}
                      {vendor.phone && <span className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{vendor.phone}</span>}
                      {vendor.email && <span className="text-xs text-slate-500 flex items-center gap-1"><Mail className="w-3 h-3" />{vendor.email}</span>}
                      {vendor.address && <span className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{vendor.address}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      {vendor.vehicles.length} vehicle{vendor.vehicles.length !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      {vendor.drivers.length} driver{vendor.drivers.length !== 1 ? 's' : ''}
                    </span>
                    {isAdmin && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); toggleActive(vendor) }}
                          disabled={togglingId === vendor.id}
                          title={vendor.isActive ? 'Deactivate vendor' : 'Activate vendor'}
                          className={`p-1.5 rounded-lg transition-colors ${vendor.isActive ? 'text-emerald-600 hover:bg-red-50 hover:text-red-500' : 'text-amber-500 hover:bg-emerald-50 hover:text-emerald-600'}`}
                        >
                          {togglingId === vendor.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Power className="w-3.5 h-3.5" />
                          }
                        </button>
                        <button onClick={e => { e.stopPropagation(); openEditVendor(vendor) }} className="p-1.5 text-slate-400 hover:text-brand-600">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); deleteVendor(vendor.id) }} className="p-1.5 text-slate-400 hover:text-red-500">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-5">
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700">Fleet Vehicles</p>
                        {isAdmin && (
                          <button onClick={() => openAddVehicle(vendor.id)} className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
                            <Plus className="w-3 h-3" /> Add Vehicle
                          </button>
                        )}
                      </div>

                      {vendor.vehicles.length === 0 ? (
                        <p className="text-sm text-slate-400 py-4 text-center">No vehicles yet</p>
                      ) : (
                        <div className="space-y-3">
                          {vendor.vehicles.map(vehicle => (
                            <div key={vehicle.id} className="flex gap-3 p-3 bg-white rounded-xl border border-slate-200">
                              <button
                                className={`w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 flex items-center justify-center ${vehicle.photoOutside ? 'cursor-pointer' : ''}`}
                                onClick={() => vehicle.photoOutside && window.open(vehicle.photoOutside, '_blank', 'noopener,noreferrer')}
                                type="button"
                              >
                                {vehicle.photoOutside
                                  ? <img src={vehicle.photoOutside} alt={vehicle.plateNo} className="w-full h-full object-cover" />
                                  : <Car className="w-5 h-5 text-slate-400" />
                                }
                              </button>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-slate-800">
                                    {[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || vehicle.type}
                                  </p>
                                  <span className="font-mono text-slate-500 text-xs">{vehicle.plateNo}</span>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${vehicle.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {vehicle.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400">
                                  {vehicle.type} · {vehicle.capacity} seats
                                  {vehicle.driver && <> · <span className="text-blue-600">{vehicle.driver.name}</span></>}
                                </p>
                                <div className="flex items-center gap-2 mt-2">
                                  {vehicle.photoOutside && (
                                    <button
                                      type="button"
                                      onClick={() => window.open(vehicle.photoOutside!, '_blank', 'noopener,noreferrer')}
                                      className="text-[11px] text-slate-500 hover:text-slate-700"
                                    >
                                      Outside photo
                                    </button>
                                  )}
                                  {vehicle.photoInside && (
                                    <button
                                      type="button"
                                      onClick={() => window.open(vehicle.photoInside!, '_blank', 'noopener,noreferrer')}
                                      className="text-[11px] text-slate-500 hover:text-slate-700"
                                    >
                                      Inside photo
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isAdmin && (
                                <div className="flex gap-1 flex-shrink-0">
                                  <button onClick={() => openEditVehicle(vendor.id, vehicle)} className="p-1.5 text-slate-400 hover:text-brand-600">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => deleteVehicle(vehicle.id)} className="p-1.5 text-slate-400 hover:text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700">Drivers</p>
                        {isAdmin && (
                          <button onClick={() => openAddDriver(vendor.id)} className="text-xs flex items-center gap-1 text-brand-600 hover:text-brand-700 font-medium">
                            <Plus className="w-3 h-3" /> Add Driver
                          </button>
                        )}
                      </div>

                      {vendor.drivers.length === 0 ? (
                        <p className="text-sm text-slate-400 py-4 text-center">No drivers yet</p>
                      ) : (
                        <div className="space-y-3">
                          {vendor.drivers.map(driver => (
                            <div key={driver.id} className="flex gap-3 p-3 bg-white rounded-xl border border-slate-200">
                              <button
                                className={`w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-slate-100 flex items-center justify-center ${driver.photoUrl ? 'cursor-pointer' : ''}`}
                                onClick={() => driver.photoUrl && window.open(driver.photoUrl, '_blank', 'noopener,noreferrer')}
                                type="button"
                              >
                                {driver.photoUrl
                                  ? <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" />
                                  : <User2 className="w-5 h-5 text-slate-400" />
                                }
                              </button>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-slate-800">{driver.name}</p>
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${driver.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                    {driver.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400">{driver.phone}</p>
                                <p className="text-xs text-slate-400">
                                  {driver.licenseNo ? `License: ${driver.licenseNo}` : 'No license number'}
                                  {driver.vehicle && <> · <span className="text-blue-600">{driver.vehicle.plateNo}</span></>}
                                </p>
                                {driver.vehicle && (
                                  <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-2 text-xs text-slate-500">
                                    {driver.vehicle.brand || driver.vehicle.model
                                      ? [driver.vehicle.brand, driver.vehicle.model].filter(Boolean).join(' ')
                                      : driver.vehicle.type}
                                    {' '}· {driver.vehicle.capacity} seats
                                  </div>
                                )}
                              </div>

                              {isAdmin && (
                                <div className="flex gap-1 flex-shrink-0">
                                  <button onClick={() => openEditDriver(vendor.id, driver)} className="p-1.5 text-slate-400 hover:text-brand-600">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => deleteDriver(driver.id)} className="p-1.5 text-slate-400 hover:text-red-500">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      <Modal open={!!vendorModal} onClose={() => setVendorModal(null)} title={vendorModal === 'new' ? 'Add Vendor' : 'Edit Vendor'} size="md">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <label className="form-label">Company Name *</label>
              <span className="text-xs text-slate-500">{vendorForm.name.length}/50</span>
            </div>
            <input
              className="form-input"
              placeholder="Vietnam Tours Co."
              value={vendorForm.name}
              onChange={e => setVendorForm(x => ({ ...x, name: e.target.value }))}
              maxLength={50}
            />
          </div>

          <div>
            <label className="form-label">Phone</label>
            <input
              className="form-input"
              placeholder="+84 ..."
              value={vendorForm.phone}
              onChange={e => setVendorForm(x => ({ ...x, phone: sanitizePhoneValue(e.target.value) }))}
              inputMode="tel"
              pattern="^\+?[0-9\s\-()]*$"
            />
            <p className="text-xs text-slate-400 mt-0.5">Digits, +, -, (), and spaces only</p>
          </div>

          <div>
            <label className="form-label">Email</label>
            <input
              className={`form-input ${emailError ? 'border-red-500 focus:border-red-500' : ''}`}
              type="email"
              placeholder="contact@..."
              value={vendorForm.email}
              onChange={e => {
                const email = e.target.value
                setVendorForm(x => ({ ...x, email }))
                setEmailError(email && !validateEmail(email) ? 'Please enter a valid email address' : '')
              }}
            />
            {emailError && <p className="text-xs text-red-500 mt-0.5">{emailError}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="form-label">Address</label>
              <span className="text-xs text-slate-500">{vendorForm.address.length}/200</span>
            </div>
            <input
              className="form-input"
              placeholder="City, Province"
              value={vendorForm.address}
              onChange={e => setVendorForm(x => ({ ...x, address: e.target.value }))}
              maxLength={200}
            />
          </div>

          <div>
            <label className="form-label">Country</label>
            <select
              className="form-select"
              value={vendorForm.country}
              onChange={e => setVendorForm(x => ({ ...x, country: e.target.value }))}
            >
              <option value="">-- Not specified --</option>
              {COUNTRIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <button onClick={saveVendor} disabled={saving || !vendorForm.name || !!emailError} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save
            </button>
            <button onClick={() => setVendorModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!vehicleModal}
        onClose={() => setVehicleModal(null)}
        title={vehicleModal?.vehicle ? 'Edit Vehicle' : 'Add Vehicle'}
        size="xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Type *</label>
              <select className="form-select" value={vehicleForm.type} onChange={e => setVehicleForm(x => ({ ...x, type: e.target.value }))}>
                {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="form-label">Plate Number *</label>
                <span className="text-xs text-slate-500">{vehicleForm.plateNo.length}/20</span>
              </div>
              <input
                className="form-input font-mono"
                placeholder="51A-12345"
                value={vehicleForm.plateNo}
                onChange={e => setVehicleForm(x => ({ ...x, plateNo: e.target.value.toUpperCase() }))}
                maxLength={20}
                disabled={!!vehicleModal?.vehicle}
              />
            </div>
            <div>
              <label className="form-label">Brand</label>
              <input className="form-input" placeholder="Toyota" value={vehicleForm.brand} onChange={e => setVehicleForm(x => ({ ...x, brand: e.target.value }))} maxLength={50} />
            </div>
            <div>
              <label className="form-label">Model</label>
              <input className="form-input" placeholder="Hiace" value={vehicleForm.model} onChange={e => setVehicleForm(x => ({ ...x, model: e.target.value }))} maxLength={50} />
            </div>
            <div>
              <label className="form-label">Capacity (seats)</label>
              <input
                type="number"
                className="form-input"
                min="1"
                max="60"
                value={vehicleForm.capacity}
                onChange={e => {
                  const val = Math.min(Math.max(Number(e.target.value) || 1, 1), 60)
                  setVehicleForm(x => ({ ...x, capacity: String(val) }))
                }}
              />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={vehicleForm.isActive}
                  onChange={e => setVehicleForm(x => ({ ...x, isActive: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Outside Photo</label>
              <button
                type="button"
                onClick={() => vehicleOutsideRef.current?.click()}
                className="w-full aspect-video rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 overflow-hidden flex flex-col items-center justify-center relative gap-1.5"
              >
                {vehicleForm.photoOutside
                  ? <img src={vehicleForm.photoOutside} alt="Outside" className="w-full h-full object-cover absolute inset-0" />
                  : <><Camera className="w-5 h-5 text-slate-400" /><span className="text-[10px] text-slate-400">Upload outside photo</span></>
                }
                {uploading.vehicleOutside && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="w-4 h-4 text-white animate-spin" /></div>}
              </button>
              <input
                ref={vehicleOutsideRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'vehicleOutside')}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Inside Photo</label>
              <button
                type="button"
                onClick={() => vehicleInsideRef.current?.click()}
                className="w-full aspect-video rounded-xl bg-slate-50 border-2 border-dashed border-slate-200 overflow-hidden flex flex-col items-center justify-center relative gap-1.5"
              >
                {vehicleForm.photoInside
                  ? <img src={vehicleForm.photoInside} alt="Inside" className="w-full h-full object-cover absolute inset-0" />
                  : <><Upload className="w-5 h-5 text-slate-400" /><span className="text-[10px] text-slate-400">Upload inside photo</span></>
                }
                {uploading.vehicleInside && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 className="w-4 h-4 text-white animate-spin" /></div>}
              </button>
              <input
                ref={vehicleInsideRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'vehicleInside')}
              />
            </div>
          </div>

          <div>
            <label className="form-label">Assign Driver</label>
            <select
              className="form-select"
              value={vehicleForm.driverId}
              onChange={e => setVehicleForm(x => ({ ...x, driverId: e.target.value }))}
            >
              <option value="">-- No driver --</option>
              {availableDriversForVehicle.map(driver => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} · {driver.phone}
                  {driver.vehicle ? ` · current: ${driver.vehicle.plateNo}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button onClick={saveVehicle} disabled={saving || !vehicleForm.plateNo.trim()} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Vehicle
            </button>
            <button onClick={() => setVehicleModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!driverModal}
        onClose={() => setDriverModal(null)}
        title={driverModal?.driver ? 'Edit Driver' : 'Add Driver'}
        size="lg"
      >
        <div className="space-y-5">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => driverPhotoRef.current?.click()}
              className="relative w-20 h-20 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 overflow-hidden flex items-center justify-center"
            >
              {driverForm.photoUrl
                ? <img src={driverForm.photoUrl} alt="" className="w-full h-full object-cover" />
                : <Camera className="w-7 h-7 text-slate-400" />
              }
              {uploading.driver && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
            </button>
            <input
              ref={driverPhotoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'driver')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Full Name *</label>
              <input className="form-input" value={driverForm.name} onChange={e => setDriverForm(x => ({ ...x, name: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Phone *</label>
              <input className="form-input" value={driverForm.phone} onChange={e => setDriverForm(x => ({ ...x, phone: sanitizePhoneValue(e.target.value) }))} inputMode="tel" />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" type="email" value={driverForm.email} onChange={e => setDriverForm(x => ({ ...x, email: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">License No.</label>
              <input className="form-input" value={driverForm.licenseNo} onChange={e => setDriverForm(x => ({ ...x, licenseNo: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="form-label">Assign Vehicle</label>
            <select
              className="form-select"
              value={driverForm.vehicleId}
              onChange={e => setDriverForm(x => ({ ...x, vehicleId: e.target.value }))}
            >
              <option value="">-- No vehicle --</option>
              {availableVehiclesForDriver.map(vehicle => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.plateNo} · {vehicle.type}
                  {vehicle.driver ? ` · current: ${vehicle.driver.name}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <span className="text-sm text-slate-600">Active</span>
            <input
              type="checkbox"
              checked={driverForm.isActive}
              onChange={e => setDriverForm(x => ({ ...x, isActive: e.target.checked }))}
            />
          </div>

          <div className="flex gap-3">
            <button onClick={saveDriver} disabled={saving || !driverForm.name.trim() || !driverForm.phone.trim()} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save Driver
            </button>
            <button onClick={() => setDriverModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
