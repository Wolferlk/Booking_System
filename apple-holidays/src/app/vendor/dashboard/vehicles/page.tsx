'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, Car, User2, Edit2, Trash2, XCircle, Upload } from 'lucide-react'

interface Driver { id: string; name: string; phone: string; photoUrl: string | null }
interface Vehicle {
  id: string; type: string; plateNo: string; brand: string | null; model: string | null
  capacity: number; isActive: boolean; photoOutside: string | null; photoInside: string | null
  driver: Driver | null
}

const VEHICLE_TYPES = ['car','flatroof-van','highroof-van','van','minibus','bus-medium','bus-high','motorbike','other']
const TYPE_ICON: Record<string, string> = {
  car: '🚗', van: '🚐', 'flatroof-van': '🚐', 'highroof-van': '🚌', minibus: '🚌',
  'bus-medium': '🚍', 'bus-high': '🚍', motorbike: '🏍️', other: '🚙',
}
const TYPE_LABEL: Record<string, string> = {
  car: 'Car', van: 'Van', 'flatroof-van': 'Flatroof Van', 'highroof-van': 'Highroof Van',
  minibus: 'Minibus', 'bus-medium': 'Bus (Medium)', 'bus-high': 'Bus (High)', motorbike: 'Motorbike', other: 'Other',
}

const emptyForm = () => ({ type: 'car', plateNo: '', brand: '', model: '', capacity: '4', photoOutside: '', photoInside: '', driverId: '' })
type Form = ReturnType<typeof emptyForm>

export default function VendorVehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [drivers, setDrivers]   = useState<Driver[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Vehicle | 'new' | null>(null)
  const [form, setForm]         = useState<Form>(emptyForm())
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const outsideRef = useRef<HTMLInputElement>(null)
  const insideRef  = useRef<HTMLInputElement>(null)

  async function load() {
    const [vh, dr] = await Promise.all([
      fetch('/api/vendor/vehicles').then(r => r.json()),
      fetch('/api/vendor/drivers').then(r => r.json()),
    ])
    if (vh.success) setVehicles(vh.data)
    if (dr.success) setDrivers(dr.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function uploadPhoto(file: File, field: 'photoOutside' | 'photoInside') {
    setUploading(u => ({ ...u, [field]: true }))
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/public/upload-photo', { method: 'POST', body: fd })
      const d   = await res.json()
      if (!d.success) { toast.error('Upload failed'); return }
      setForm(f => ({ ...f, [field]: d.data.url }))
    } finally { setUploading(u => ({ ...u, [field]: false })) }
  }

  function openNew() { setForm(emptyForm()); setModal('new') }

  function openEdit(v: Vehicle) {
    setForm({
      type: v.type, plateNo: v.plateNo, brand: v.brand ?? '', model: v.model ?? '',
      capacity: String(v.capacity), photoOutside: v.photoOutside ?? '', photoInside: v.photoInside ?? '',
      driverId: v.driver?.id ?? '',
    })
    setModal(v)
  }

  async function save() {
    if (!form.plateNo.trim()) { toast.error('Plate number required'); return }
    setSaving(true)
    try {
      const isNew = modal === 'new'
      const url   = isNew ? '/api/vendor/vehicles' : `/api/vendor/vehicles/${(modal as Vehicle).id}`
      const body  = isNew
        ? { type: form.type, plateNo: form.plateNo, brand: form.brand, model: form.model, capacity: Number(form.capacity), photoOutside: form.photoOutside, photoInside: form.photoInside }
        : { type: form.type, brand: form.brand, model: form.model, capacity: Number(form.capacity), photoOutside: form.photoOutside, photoInside: form.photoInside, driverId: form.driverId || null }
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!d.success) { toast.error(d.error); return }
      toast.success(isNew ? 'Vehicle added' : 'Vehicle updated')
      setModal(null); load()
    } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Remove this vehicle?')) return
    const res = await fetch(`/api/vendor/vehicles/${id}`, { method: 'DELETE' })
    const d   = await res.json()
    if (!d.success) { toast.error(d.error); return }
    toast.success('Vehicle removed'); load()
  }

  // Drivers not yet assigned to any vehicle (for dropdown)
  const freeDrivers = drivers.filter(d => {
    const assignedVehicle = vehicles.find(v => v.driver?.id === d.id)
    if (modal && modal !== 'new') {
      const editing = modal as Vehicle
      if (editing.driver?.id === d.id) return true
    }
    return !assignedVehicle
  })

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-white font-black text-2xl">Vehicles</h1>
          <p className="text-slate-500 text-sm">{vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} in fleet</p>
        </div>
        <button onClick={openNew} className="w-10 h-10 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30 active:scale-95 transition-transform">
          <Plus className="w-5 h-5 text-white" />
        </button>
      </div>

      {vehicles.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
            <Car className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-semibold">No vehicles yet</p>
          <p className="text-slate-600 text-xs mt-1">Add vehicles to assign them to trips</p>
          <button onClick={openNew} className="mt-4 text-sm text-brand-400 font-semibold">+ Add your first vehicle</button>
        </div>
      ) : (
        vehicles.map(v => (
          <div key={v.id} className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
            <div className="p-4 flex items-center gap-3">
              {/* Photo or emoji */}
              <button
                onClick={() => v.photoOutside && setLightbox(v.photoOutside)}
                className={`w-14 h-14 rounded-2xl flex-shrink-0 bg-white/8 flex items-center justify-center overflow-hidden ${v.photoOutside ? 'cursor-pointer' : ''}`}
              >
                {v.photoOutside
                  ? <img src={v.photoOutside} alt={v.plateNo} className="w-full h-full object-cover" />
                  : <span className="text-2xl">{TYPE_ICON[v.type] ?? '🚗'}</span>
                }
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white font-bold text-sm font-mono">{v.plateNo}</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${v.isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-700/50 text-slate-500'}`}>
                    {v.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-slate-400 text-xs mt-0.5">
                  {[v.brand, v.model].filter(Boolean).join(' ') || TYPE_LABEL[v.type] || v.type} · {v.capacity} seats
                </p>
                {v.driver ? (
                  <div className="flex items-center gap-1 mt-1">
                    <User2 className="w-3 h-3 text-brand-400" />
                    <span className="text-brand-300 text-xs font-semibold">{v.driver.name}</span>
                  </div>
                ) : (
                  <p className="text-slate-600 text-xs mt-1">No driver assigned</p>
                )}
              </div>

              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button onClick={() => openEdit(v)} className="p-2 text-slate-500 hover:text-brand-400 active:scale-90 transition-all">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => remove(v.id)} className="p-2 text-slate-500 hover:text-red-400 active:scale-90 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Interior photo strip */}
            {v.photoInside && (
              <div className="px-4 pb-3">
                <button onClick={() => setLightbox(v.photoInside!)} className="w-full h-20 rounded-xl overflow-hidden">
                  <img src={v.photoInside} alt="Inside" className="w-full h-full object-cover" />
                </button>
                <p className="text-slate-600 text-[10px] mt-1 text-center">Interior</p>
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
          <div className="bg-[#0d1628] border border-white/10 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-sm max-h-[90dvh] overflow-y-auto overscroll-contain">
            <div className="sticky top-0 bg-[#0d1628] border-b border-white/8 px-5 py-4 flex items-center justify-between rounded-t-3xl z-10">
              <p className="text-white font-bold text-base">{modal === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}</p>
              <button onClick={() => setModal(null)} className="p-1.5 text-slate-500 hover:text-white transition-colors">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Photos */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Photos</label>
                <div className="grid grid-cols-2 gap-3">
                  {([['photoOutside', outsideRef, 'Outside'] as const, ['photoInside', insideRef, 'Inside'] as const]).map(([field, ref, label]) => (
                    <div key={field}>
                      <button type="button" onClick={() => ref.current?.click()}
                        className="w-full aspect-video rounded-xl bg-white/6 border-2 border-dashed border-white/12 overflow-hidden flex flex-col items-center justify-center relative gap-1.5">
                        {form[field]
                          ? <img src={form[field]} alt="" className="w-full h-full object-cover absolute inset-0" />
                          : <><Upload className="w-5 h-5 text-slate-500" /><span className="text-[10px] text-slate-500">{label}</span></>
                        }
                        {uploading[field] && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Loader2 className="w-4 h-4 text-white animate-spin" /></div>}
                      </button>
                      <input ref={ref} type="file" accept="image/*" className="hidden"
                        onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], field)} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Type</label>
                  <select value={form.type} onChange={set('type')}
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white focus:outline-none appearance-none"
                    style={{ colorScheme: 'dark' }}>
                    {VEHICLE_TYPES.map(t => <option key={t} value={t} style={{ background: '#1e2d45' }}>{TYPE_LABEL[t] || t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Plate No. *</label>
                  <input value={form.plateNo} onChange={set('plateNo')} placeholder="CAH 5296"
                    disabled={modal !== 'new'}
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Brand</label>
                  <input value={form.brand} onChange={set('brand')} placeholder="Toyota"
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Model</label>
                  <input value={form.model} onChange={set('model')} placeholder="Hiace"
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Seats</label>
                  <input type="number" min="1" max="60" value={form.capacity} onChange={set('capacity')}
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white focus:outline-none" />
                </div>
              </div>

              {/* Driver assignment (edit mode only) */}
              {modal !== 'new' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider">Assign Driver</label>
                  <select
                    value={form.driverId}
                    onChange={set('driverId')}
                    className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-3 px-3 text-sm text-white focus:outline-none appearance-none"
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="" style={{ background: '#1e2d45' }}>— No driver —</option>
                    {/* Current driver always shown */}
                    {(modal as Vehicle).driver && !freeDrivers.find(d => d.id === (modal as Vehicle).driver?.id) && (
                      <option value={(modal as Vehicle).driver!.id} style={{ background: '#1e2d45' }}>
                        {(modal as Vehicle).driver!.name}
                      </option>
                    )}
                    {freeDrivers.map(d => (
                      <option key={d.id} value={d.id} style={{ background: '#1e2d45' }}>{d.name} · {d.phone}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex gap-3 pt-1 pb-2">
                <button onClick={save} disabled={saving || !form.plateNo.trim()}
                  className="flex-1 bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {modal === 'new' ? 'Add Vehicle' : 'Save Changes'}
                </button>
                <button onClick={() => setModal(null)} className="px-5 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl text-sm font-semibold transition-colors">
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
