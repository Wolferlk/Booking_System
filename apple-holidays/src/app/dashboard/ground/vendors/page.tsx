'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Loader2, Truck, Phone, Mail, MapPin, Edit2, Trash2, Car, ChevronDown, ChevronUp } from 'lucide-react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Modal from '@/components/ui/modal'

interface VehicleInVendor {
  id: string
  type: string
  plateNo: string
  brand: string | null
  model: string | null
  capacity: number
  isActive: boolean
  driver: { id: string; name: string; phone: string } | null
}

interface Vendor {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  isActive: boolean
  vehicles: VehicleInVendor[]
}

const VEHICLE_TYPES = ['car', 'van', 'minibus', 'bus', 'motorbike']

export default function VendorsPage() {
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()
  const isAdmin = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session?.user?.role ?? '')

  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Vendor form
  const [vendorModal, setVendorModal] = useState<Vendor | 'new' | null>(null)
  const [vendorForm, setVendorForm] = useState({ name: '', phone: '', email: '', address: '' })

  // Vehicle form
  const [vehicleModal, setVehicleModal] = useState<{ vendorId: string; vehicle?: VehicleInVendor } | null>(null)
  const [vForm, setVForm] = useState({ type: 'van', plateNo: '', brand: '', model: '', capacity: '4' })

  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/ground/vendors?${params}`)
      const data = await res.json()
      if (data.success) setVendors(data.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  function openAddVendor() {
    setVendorForm({ name: '', phone: '', email: '', address: '' })
    setVendorModal('new')
  }

  function openEditVendor(v: Vendor) {
    setVendorForm({ name: v.name, phone: v.phone ?? '', email: v.email ?? '', address: v.address ?? '' })
    setVendorModal(v)
  }

  async function saveVendor() {
    setSaving(true)
    try {
      const url = vendorModal === 'new' ? '/api/ground/vendors' : `/api/ground/vendors/${(vendorModal as Vendor).id}`
      const method = vendorModal === 'new' ? 'POST' : 'PUT'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vendorForm) })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(vendorModal === 'new' ? 'Vendor added' : 'Vendor updated')
      setVendorModal(null)
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function deleteVendor(id: string) {
    if (!confirm('Delete this vendor? Their vehicles will also be deleted.')) return
    await fetch(`/api/ground/vendors/${id}`, { method: 'DELETE' })
    toast.success('Vendor deleted'); load()
  }

  function openAddVehicle(vendorId: string) {
    setVForm({ type: 'van', plateNo: '', brand: '', model: '', capacity: '4' })
    setVehicleModal({ vendorId })
  }

  function openEditVehicle(vendorId: string, vehicle: VehicleInVendor) {
    setVForm({ type: vehicle.type, plateNo: vehicle.plateNo, brand: vehicle.brand ?? '', model: vehicle.model ?? '', capacity: String(vehicle.capacity) })
    setVehicleModal({ vendorId, vehicle })
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
        body: JSON.stringify({ ...vForm, capacity: Number(vForm.capacity), vendorId: vehicleModal.vendorId }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)
      toast.success(vehicleModal.vehicle ? 'Vehicle updated' : 'Vehicle added')
      setVehicleModal(null)
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function deleteVehicle(id: string) {
    if (!confirm('Remove this vehicle?')) return
    await fetch(`/api/ground/vehicles/${id}`, { method: 'DELETE' })
    toast.success('Vehicle removed'); load()
  }

  return (
    <div>
      <Header
        title="Vehicle Vendors"
        subtitle="Companies supplying vehicles for tours"
        actions={
          isAdmin ? (
            <button onClick={openAddVendor} className="btn-primary btn">
              <Plus className="w-4 h-4" /> Add Vendor
            </button>
          ) : undefined
        }
      />

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
            return (
              <Card key={vendor.id} className="overflow-hidden">
                {/* Vendor header */}
                <div
                  className="flex items-center gap-4 p-5 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : vendor.id)}
                >
                  <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <Truck className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-slate-900">{vendor.name}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${vendor.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {vendor.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-0.5">
                      {vendor.phone && <span className="text-xs text-slate-500 flex items-center gap-1"><Phone className="w-3 h-3" />{vendor.phone}</span>}
                      {vendor.email && <span className="text-xs text-slate-500 flex items-center gap-1"><Mail className="w-3 h-3" />{vendor.email}</span>}
                      {vendor.address && <span className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="w-3 h-3" />{vendor.address}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{vendor.vehicles.length} vehicle{vendor.vehicles.length !== 1 ? 's' : ''}</span>
                    {isAdmin && (
                      <>
                        <button onClick={e => { e.stopPropagation(); openEditVendor(vendor) }} className="p-1.5 text-slate-400 hover:text-brand-600"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={e => { e.stopPropagation(); deleteVendor(vendor.id) }} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>
                    )}
                    {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                  </div>
                </div>

                {/* Vehicles */}
                {expanded && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4">
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
                      <div className="space-y-2">
                        {vendor.vehicles.map(v => (
                          <div key={v.id} className="flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-200">
                            <Car className="w-4 h-4 text-slate-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800">
                                {[v.brand, v.model].filter(Boolean).join(' ') || v.type}
                                <span className="ml-2 font-mono text-slate-500 text-xs">{v.plateNo}</span>
                              </p>
                              <p className="text-xs text-slate-400">
                                {v.type} · {v.capacity} seats
                                {v.driver && <> · <span className="text-blue-600">{v.driver.name}</span></>}
                              </p>
                            </div>
                            {isAdmin && (
                              <div className="flex gap-1">
                                <button onClick={() => openEditVehicle(vendor.id, v)} className="p-1 text-slate-400 hover:text-brand-600"><Edit2 className="w-3 h-3" /></button>
                                <button onClick={() => deleteVehicle(v.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })
        )}
      </div>

      {/* Vendor Modal */}
      <Modal open={!!vendorModal} onClose={() => setVendorModal(null)} title={vendorModal === 'new' ? 'Add Vendor' : 'Edit Vendor'}>
        <div className="space-y-4">
          {[
            { label: 'Company Name *', key: 'name', placeholder: 'Vietnam Tours Co.' },
            { label: 'Phone', key: 'phone', placeholder: '+84 ...' },
            { label: 'Email', key: 'email', placeholder: 'contact@...' },
            { label: 'Address', key: 'address', placeholder: 'City, Province' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input
                className="form-input"
                placeholder={f.placeholder}
                value={(vendorForm as Record<string, string>)[f.key]}
                onChange={e => setVendorForm(x => ({ ...x, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex gap-3">
            <button onClick={saveVendor} disabled={saving || !vendorForm.name} className="btn-primary btn flex-1">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Save
            </button>
            <button onClick={() => setVendorModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Vehicle Modal */}
      <Modal open={!!vehicleModal} onClose={() => setVehicleModal(null)} title={vehicleModal?.vehicle ? 'Edit Vehicle' : 'Add Vehicle to Fleet'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Type *</label>
              <select className="form-select" value={vForm.type} onChange={e => setVForm(x => ({ ...x, type: e.target.value }))}>
                {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Plate Number *</label>
              <input className="form-input font-mono" placeholder="51A-12345" value={vForm.plateNo} onChange={e => setVForm(x => ({ ...x, plateNo: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Brand</label>
              <input className="form-input" placeholder="Toyota" value={vForm.brand} onChange={e => setVForm(x => ({ ...x, brand: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Model</label>
              <input className="form-input" placeholder="Hiace" value={vForm.model} onChange={e => setVForm(x => ({ ...x, model: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Capacity (seats)</label>
              <input type="number" className="form-input" min="1" max="60" value={vForm.capacity} onChange={e => setVForm(x => ({ ...x, capacity: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveVehicle} disabled={saving || !vForm.plateNo} className="btn-primary btn flex-1">Save</button>
            <button onClick={() => setVehicleModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
