'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Plus, Loader2, User2, Phone, Mail, Car, Camera,
  Edit2, Trash2, CheckCircle2, XCircle, ChevronDown, ChevronUp, Upload,
} from 'lucide-react'

interface Vehicle { id: string; plateNo: string; type: string; brand: string | null; model: string | null; capacity: number; photoOutside: string | null; photoInside: string | null }
interface Driver {
  id: string; name: string; phone: string; email: string | null; licenseNo: string | null
  isActive: boolean; photoUrl: string | null
  bankName: string | null; bankAccountNo: string | null; bankHolder: string | null; bankBranch: string | null; bankCode: string | null
  vehicle: Vehicle | null
}

const VEHICLE_TYPES = ['car','flatroof-van','highroof-van','van','minibus','bus-medium','bus-high','motorbike','other']

const emptyDriver = () => ({
  name:'', phone:'', email:'', licenseNo:'', photoUrl:'',
  bankName:'', bankAccountNo:'', bankHolder:'', bankBranch:'', bankCode:'',
  vehicleType:'car', vehiclePlateNo:'', vehicleBrand:'', vehicleModel:'', vehicleCapacity:'4',
  vehiclePhotoOutside:'', vehiclePhotoInside:'',
})

type Form = ReturnType<typeof emptyDriver>

export default function VendorDriversPage() {
  const [drivers, setDrivers]   = useState<Driver[]>([])
  const [loading, setLoading]   = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [modal, setModal]       = useState<Driver | 'new' | null>(null)
  const [form, setForm]         = useState<Form>(emptyDriver())
  const [saving, setSaving]     = useState(false)
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const driverPhotoRef   = useRef<HTMLInputElement>(null)
  const outsideRef       = useRef<HTMLInputElement>(null)
  const insideRef        = useRef<HTMLInputElement>(null)

  async function load() {
    const res = await fetch('/api/vendor/drivers')
    const d   = await res.json()
    if (d.success) setDrivers(d.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function uploadPhoto(file: File, field: keyof Form, ref?: string) {
    setUploading(u => ({ ...u, [ref ?? field]: true }))
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/public/upload-photo', { method: 'POST', body: fd })
      const d   = await res.json()
      if (!d.success) { toast.error('Upload failed'); return }
      setForm(f => ({ ...f, [field]: d.data.url }))
    } finally {
      setUploading(u => ({ ...u, [ref ?? field]: false }))
    }
  }

  function openNew() {
    setForm(emptyDriver())
    setModal('new')
  }

  function openEdit(d: Driver) {
    setForm({
      name: d.name, phone: d.phone, email: d.email ?? '', licenseNo: d.licenseNo ?? '', photoUrl: d.photoUrl ?? '',
      bankName: d.bankName ?? '', bankAccountNo: d.bankAccountNo ?? '', bankHolder: d.bankHolder ?? '',
      bankBranch: d.bankBranch ?? '', bankCode: d.bankCode ?? '',
      vehicleType: d.vehicle?.type ?? 'car', vehiclePlateNo: '', vehicleBrand: '', vehicleModel: '',
      vehicleCapacity: String(d.vehicle?.capacity ?? 4),
      vehiclePhotoOutside: d.vehicle?.photoOutside ?? '', vehiclePhotoInside: d.vehicle?.photoInside ?? '',
    })
    setModal(d)
  }

  async function save() {
    if (!form.name.trim() || !form.phone.trim()) { toast.error('Name and phone required'); return }
    setSaving(true)
    try {
      const isNew = modal === 'new'
      const url   = isNew ? '/api/vendor/drivers' : `/api/vendor/drivers/${(modal as Driver).id}`
      const res   = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
    await fetch(`/api/vendor/drivers/${id}`, { method: 'DELETE' })
    toast.success('Driver removed')
    load()
  }

  if (loading) return <div className="flex justify-center py-32"><Loader2 className="w-6 h-6 text-brand-400 animate-spin" /></div>

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-white font-black text-2xl">Drivers</h1>
          <p className="text-slate-500 text-sm">{drivers.length} driver{drivers.length !== 1 ? 's' : ''} in your fleet</p>
        </div>
        <button onClick={openNew} className="w-10 h-10 rounded-2xl bg-brand-500 flex items-center justify-center shadow-lg shadow-brand-500/30 active:scale-95 transition-transform">
          <Plus className="w-5 h-5 text-white" />
        </button>
      </div>

      {drivers.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/4 flex items-center justify-center mb-4">
            <User2 className="w-7 h-7 text-slate-600" />
          </div>
          <p className="text-slate-400 font-semibold">No drivers yet</p>
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
                {driver.vehicle && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <Car className="w-3 h-3 text-slate-500" />
                    <span className="text-slate-400 text-xs font-mono">{driver.vehicle.plateNo}</span>
                    <span className="text-slate-600 text-xs">· {driver.vehicle.type}</span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1 flex-shrink-0">
                <button onClick={() => openEdit(driver)} className="p-2 text-slate-500 hover:text-brand-400 active:scale-90 transition-all">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => remove(driver.id)} className="p-2 text-slate-500 hover:text-red-400 active:scale-90 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
                <button onClick={() => setExpanded(expanded === driver.id ? null : driver.id)} className="p-2 text-slate-500">
                  {expanded === driver.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
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
            <div className="sticky top-0 bg-[#0d1628] border-b border-white/8 px-5 py-4 flex items-center justify-between rounded-t-3xl">
              <p className="text-white font-bold">{modal === 'new' ? 'Add Driver' : 'Edit Driver'}</p>
              <button onClick={() => setModal(null)} className="text-slate-500 hover:text-white"><XCircle className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Driver photo */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => driverPhotoRef.current?.click()}
                  className="w-20 h-20 rounded-2xl bg-white/6 border-2 border-dashed border-white/15 overflow-hidden flex items-center justify-center relative"
                >
                  {form.photoUrl
                    ? <img src={form.photoUrl} alt="" className="w-full h-full object-cover" />
                    : <Camera className="w-7 h-7 text-slate-500" />
                  }
                  {uploading['photoUrl'] && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Loader2 className="w-5 h-5 text-white animate-spin" /></div>}
                </button>
                <input ref={driverPhotoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], 'photoUrl')} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Full Name *', key: 'name' as keyof Form, full: true },
                  { label: 'Phone *', key: 'phone' as keyof Form, type: 'tel' },
                  { label: 'Email', key: 'email' as keyof Form, type: 'email' },
                  { label: 'License No.', key: 'licenseNo' as keyof Form },
                ].map(f => (
                  <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">{f.label}</label>
                    <input
                      type={f.type ?? 'text'}
                      value={form[f.key]}
                      onChange={set(f.key)}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                    />
                  </div>
                ))}
              </div>

              {modal === 'new' && (
                <>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider border-t border-white/8 pt-3 mt-2">Vehicle (optional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Type</label>
                      <select
                        value={form.vehicleType}
                        onChange={set('vehicleType')}
                        autoComplete="off"
                        className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white focus:outline-none appearance-none"
                        style={{ colorScheme: 'dark' }}
                      >
                        {VEHICLE_TYPES.map(t => <option key={t} value={t} style={{ background: '#1e2d45' }}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Plate No.</label>
                      <input
                        value={form.vehiclePlateNo}
                        onChange={set('vehiclePlateNo')}
                        placeholder="CAH 5296"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Brand</label>
                      <input
                        value={form.vehicleBrand}
                        onChange={set('vehicleBrand')}
                        placeholder="Toyota"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">Model</label>
                      <input
                        value={form.vehicleModel}
                        onChange={set('vehicleModel')}
                        placeholder="Hiace"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Vehicle photos */}
                  <div className="grid grid-cols-2 gap-3">
                    {([['vehiclePhotoOutside', outsideRef, 'Outside Photo'] as const, ['vehiclePhotoInside', insideRef, 'Inside Photo'] as const]).map(([field, ref, label]) => (
                      <div key={field}>
                        <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">{label}</label>
                        <button type="button" onClick={() => ref.current?.click()}
                          className="w-full aspect-video rounded-xl bg-white/6 border border-dashed border-white/15 overflow-hidden flex items-center justify-center relative">
                          {form[field]
                            ? <img src={form[field]} alt="" className="w-full h-full object-cover" />
                            : <Upload className="w-5 h-5 text-slate-500" />
                          }
                          {uploading[field] && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><Loader2 className="w-4 h-4 text-white animate-spin" /></div>}
                        </button>
                        <input ref={ref} type="file" accept="image/*" className="hidden"
                          onChange={e => e.target.files?.[0] && uploadPhoto(e.target.files[0], field, field)} />
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Bank details */}
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider border-t border-white/8 pt-3 mt-2">Bank Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'Bank Name', key: 'bankName' as keyof Form, full: true },
                  { label: 'Account Number', key: 'bankAccountNo' as keyof Form },
                  { label: 'Account Holder', key: 'bankHolder' as keyof Form },
                  { label: 'Branch', key: 'bankBranch' as keyof Form },
                  { label: 'Bank Code / SWIFT', key: 'bankCode' as keyof Form, full: true },
                ].map(f => (
                  <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold text-slate-400 mb-1 uppercase tracking-wider">{f.label}</label>
                    <input
                      value={form[f.key]}
                      onChange={set(f.key)}
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full bg-[#1e2d45] border border-white/15 rounded-xl py-2.5 px-3 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                ))}
              </div>

              <div className="flex gap-3 pt-2 pb-2">
                <button onClick={save} disabled={saving || !form.name || !form.phone}
                  className="flex-1 bg-brand-500 hover:bg-brand-600 text-white rounded-xl py-3.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {modal === 'new' ? 'Add Driver' : 'Save Changes'}
                </button>
                <button onClick={() => setModal(null)} className="px-4 bg-white/6 hover:bg-white/10 text-slate-300 rounded-xl text-sm font-semibold">
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
