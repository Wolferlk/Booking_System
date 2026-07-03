'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus, Loader2, User2, Phone, Car, Camera,
  Edit2, Trash2, ChevronDown, ChevronUp, XCircle,
} from 'lucide-react'

interface Vehicle { id: string; plateNo: string; type: string; brand: string | null; model: string | null; capacity: number; photoOutside: string | null; photoInside: string | null }
interface Driver {
  id: string; name: string; phone: string; email: string | null; licenseNo: string | null
  isActive: boolean; photoUrl: string | null
  vehicle: Vehicle | null
}

const emptyForm = () => ({
  name: '', phone: '', email: '', licenseNo: '', photoUrl: '',
})
type Form = ReturnType<typeof emptyForm>

type EditForm = Form & { vehicleId: string }

export default function VendorDriversPage() {
  const [drivers, setDrivers]   = useState<Driver[]>([])
  const [vehicles, setVehicles] = useState<{ id: string; plateNo: string; type: string }[]>([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modal, setModal]       = useState<Driver | 'new' | null>(null)
  const [form, setForm]         = useState<Form>(emptyForm())
  const [editVehicleId, setEditVehicleId] = useState('')
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  async function load() {
    const [dr, vh] = await Promise.all([
      fetch('/api/vendor/drivers').then(r => r.json()),
      fetch('/api/vendor/vehicles').then(r => r.json()),
    ])
    if (dr.success) setDrivers(dr.data)
    if (vh.success) setVehicles(vh.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function uploadPhoto(file: File) {
    setUploading(true)
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/public/upload-photo', { method: 'POST', body: fd })
      const d   = await res.json()
      if (!d.success) { toast.error('Upload failed'); return }
      setForm(f => ({ ...f, photoUrl: d.data.url }))
    } finally { setUploading(false) }
  }

  function openNew() {
    setForm(emptyForm())
    setEditVehicleId('')
    setModal('new')
  }

  function openEdit(d: Driver) {
    setForm({ name: d.name, phone: d.phone, email: d.email ?? '', licenseNo: d.licenseNo ?? '', photoUrl: d.photoUrl ?? '' })
    setEditVehicleId(d.vehicle?.id ?? '')
    setModal(d)
  }

  async function save() {
    if (!form.name.trim() || !form.phone.trim()) { toast.error('Name and phone required'); return }
    setSaving(true)
    try {
      const isNew = modal === 'new'
      const url   = isNew ? '/api/vendor/drivers' : `/api/vendor/drivers/${(modal as Driver).id}`
      const body  = isNew
        ? { ...form }
        : { ...form, vehicleId: editVehicleId || null }
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(isNew ? 'Driver added' : 'Driver updated')
      setModal(null)
      load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Remove this driver?')) return
    const res = await fetch(`/api/vendor/drivers/${id}`, { method: 'DELETE' })
    const d   = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Driver removed')
    load()
  }

  // Vehicles not yet assigned to any driver (for the assignment dropdown)
  const freeVehicles = vehicles.filter(v => {
    const currentOwner = drivers.find(d => d.vehicle?.id === v.id)
    // If editing, allow the driver's currently assigned vehicle to appear
    if (modal && modal !== 'new') {
      const editing = modal as Driver
      if (editing.vehicle?.id === v.id) return true
    }
    return !currentOwner
  })

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between pt-1 sm:pt-2">
        <div>
          <h1 className="text-white font-black text-2xl sm:text-3xl">Drivers</h1>
          <p className="text-slate-500 text-sm mt-1">{drivers.length} driver{drivers.length !== 1 ? 's' : ''} in your fleet</p>
        </div>
        <button onClick={openNew} className="w-full sm:w-auto sm:px-4 h-11 rounded-2xl bg-brand-500 flex items-center justify-center gap-2 shadow-lg shadow-brand-500/30 active:scale-95 transition-transform">
          <Plus className="w-5 h-5 text-white" />
          <span className="sm:hidden text-white text-sm font-bold">Add Driver</span>
          <span className="hidden sm:inline text-white text-sm font-bold">Add Driver</span>
        </button>
      </div>

      {drivers.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
            <User2 className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-semibold">No drivers yet</p>
          <p className="text-slate-600 text-xs mt-1">Add drivers to assign them to trips</p>
          <button onClick={openNew} className="mt-4 text-sm text-brand-400 font-semibold">+ Add your first driver</button>
        </div>
      ) : (
        drivers.map(driver => (
          <div key={driver.id} className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="p-4 flex items-center gap-3">
              {/* Avatar */}
              <button
                onClick={() => driver.photoUrl && setLightbox(driver.photoUrl)}
                className={`w-14 h-14 rounded-2xl overflow-hidden flex-shrink-0 bg-white/8 flex items-center justify-center ${driver.photoUrl ? 'cursor-pointer' : ''}`}
              >
                {driver.photoUrl
                  ? <img src={driver.photoUrl} alt={driver.name} className="w-full h-full object-cover" />
                  : <User2 className="w-6 h-6 text-slate-600" />
                }
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-white font-bold text-sm">{driver.name}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${driver.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700/50 text-slate-500'}`}>
                    {driver.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-400 text-xs">{driver.phone}</span>
                </div>
                {driver.vehicle ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Car className="w-3 h-3 text-slate-500" />
                    <span className="text-slate-400 text-xs font-mono">{driver.vehicle.plateNo}</span>
                    <span className="text-slate-600 text-xs">· {driver.vehicle.type}</span>
                  </div>
                ) : (
                  <p className="text-slate-600 text-xs mt-0.5">No vehicle assigned</p>
                )}
              </div>

              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button onClick={() => openEdit(driver)} className="p-2 text-slate-500 hover:text-brand-400 active:scale-90 transition-all">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => remove(driver.id)} className="p-2 text-slate-500 hover:text-red-400 active:scale-90 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
                {driver.vehicle && (
                  <button onClick={() => setExpanded(expanded === driver.id ? null : driver.id)} className="p-2 text-slate-500">
                    {expanded === driver.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>

            {/* Expanded vehicle photos */}
            {expanded === driver.id && driver.vehicle && (
              <div className="border-t border-white/6 bg-black/15 p-3 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vehicle Photos</p>
                <div className="grid grid-cols-2 gap-2">
                  {[driver.vehicle.photoOutside, driver.vehicle.photoInside].map((url, i) =>
                    url ? (
                      <button key={i} onClick={() => setLightbox(url)} className="aspect-video rounded-xl overflow-hidden bg-white/4 border border-white/8">
                        <img src={url} alt={i === 0 ? 'Outside' : 'Inside'} className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div key={i} className="aspect-video rounded-xl bg-white/4 border border-white/6 flex items-center justify-center">
                        <p className="text-slate-600 text-xs">{i === 0 ? 'No outside photo' : 'No inside photo'}</p>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full rounded-2xl object-contain" />
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex flex-col justify-end sm:items-center sm:justify-center p-0 sm:p-4">
          <div className="bg-[#0d1628] border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain">
            {/* Header */}
            <div className="sticky top-0 bg-[#0d1628] border-b border-white/8 px-5 py-4 flex items-center justify-between rounded-t-3xl z-10">
              <p className="text-white font-bold text-base">{modal === 'new' ? 'Add Driver' : 'Edit Driver'}</p>
              <button onClick={() => setModal(null)} className="p-1.5 text-slate-500 hover:text-white transition-colors">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Photo */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  className="relative w-20 h-20 rounded-2xl bg-white/6 border-2 border-dashed border-white/15 overflow-hidden flex items-center justify-center"
                >
                  {form.photoUrl
                    ? <img src={form.photoUrl} alt="" className="w-full h-full object-cover" />
                    : <Camera className="w-7 h-7 text-slate-500" />
                  }
                  {uploading && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </button>
                <input ref={photoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0])} />
              </div>

              {/* Basic info */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Full Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={set('name')}
                    placeholder="e.g. Kamal Perera"
                    autoComplete="off"
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Phone *</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set('phone')}
                    placeholder="+94 77 123 4567"
                    autoComplete="off"
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={set('email')}
                      autoComplete="off"
                      className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">License No.</label>
                    <input
                      value={form.licenseNo}
                      onChange={set('licenseNo')}
                      autoComplete="off"
                      className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white placeholder:text-slate-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Vehicle assignment (edit mode only) */}
              {modal !== 'new' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Assign Vehicle</label>
                  <select
                    value={editVehicleId}
                    onChange={e => setEditVehicleId(e.target.value)}
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-4 text-sm text-white focus:outline-none appearance-none"
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="" style={{ background: '#1e2d45' }}>— No vehicle —</option>
                    {/* Current vehicle always shown */}
                    {(modal as Driver).vehicle && !freeVehicles.find(v => v.id === (modal as Driver).vehicle?.id) && (
                      <option value={(modal as Driver).vehicle!.id} style={{ background: '#1e2d45' }}>
                        {(modal as Driver).vehicle!.plateNo} · {(modal as Driver).vehicle!.type}
                      </option>
                    )}
                    {freeVehicles.map(v => (
                      <option key={v.id} value={v.id} style={{ background: '#1e2d45' }}>{v.plateNo} · {v.type}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3 pt-1 pb-2">
                <button
                  onClick={save}
                  disabled={saving || !form.name.trim() || !form.phone.trim()}
                  className="flex-1 bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {modal === 'new' ? 'Add Driver' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setModal(null)}
                  className="px-5 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl text-sm font-semibold transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
