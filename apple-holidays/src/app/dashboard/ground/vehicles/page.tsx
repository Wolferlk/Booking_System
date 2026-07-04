'use client'

import { useEffect, useState, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Truck, Plus, Search, X, Pencil, Trash2, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'

interface Driver {
  id: string
  name: string
  phone: string
}

interface Vendor {
  id: string
  name: string
}

interface Vehicle {
  id: string
  type: string
  plateNo: string
  brand: string | null
  model: string | null
  capacity: number
  description: string | null
  isActive: boolean
  driver: Driver | null
  vendor: Vendor | null
}

const VEHICLE_TYPES = ['car', 'van', 'minibus', 'bus', 'suv', 'truck']

const emptyForm = { type: 'car', plateNo: '', brand: '', model: '', capacity: '4', description: '' }

export default function VehiclesPage() {
  const { data: session } = useSession()
  const canManage = ['GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(session?.user?.role ?? '')

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [filterType, setFilterType] = useState('')

  const [modal, setModal]       = useState<'new' | Vehicle | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [saving, setSaving]     = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/ground/vehicles?all=1')
      const json = await res.json()
      if (json.success) setVehicles(json.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setForm(emptyForm)
    setModal('new')
  }

  function openEdit(v: Vehicle) {
    setForm({
      type:        v.type,
      plateNo:     v.plateNo,
      brand:       v.brand ?? '',
      model:       v.model ?? '',
      capacity:    String(v.capacity),
      description: v.description ?? '',
    })
    setModal(v)
  }

  async function save() {
    if (!form.plateNo.trim()) { toast.error('Plate number is required'); return }
    setSaving(true)
    try {
      const isNew = modal === 'new'
      const url    = isNew ? '/api/ground/vehicles' : `/api/ground/vehicles/${(modal as Vehicle).id}`
      const method = isNew ? 'POST' : 'PUT'
      const res    = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:        form.type,
          plateNo:     form.plateNo.trim().toUpperCase(),
          brand:       form.brand.trim() || null,
          model:       form.model.trim() || null,
          capacity:    parseInt(form.capacity, 10) || 4,
          description: form.description.trim() || null,
        }),
      })
      const json = await res.json()
      if (!json.success) { toast.error(json.error); return }
      toast.success(isNew ? 'Vehicle added' : 'Vehicle updated')
      setModal(null)
      load()
    } finally { setSaving(false) }
  }

  async function toggleActive(v: Vehicle) {
    const res  = await fetch(`/api/ground/vehicles/${v.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !v.isActive }),
    })
    const json = await res.json()
    if (json.success) setVehicles(vs => vs.map(x => x.id === v.id ? { ...x, isActive: !v.isActive } : x))
    else toast.error(json.error)
  }

  async function deleteVehicle(id: string) {
    if (!confirm('Delete this vehicle? This cannot be undone.')) return
    setDeleting(id)
    try {
      const res  = await fetch(`/api/ground/vehicles/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) { toast.error(json.error); return }
      toast.success('Vehicle deleted')
      setVehicles(vs => vs.filter(v => v.id !== id))
    } finally { setDeleting(null) }
  }

  const filtered = vehicles.filter(v => {
    const q = search.toLowerCase()
    const matchSearch = !q || v.plateNo.toLowerCase().includes(q) || (v.brand ?? '').toLowerCase().includes(q) ||
      (v.model ?? '').toLowerCase().includes(q) || (v.driver?.name ?? '').toLowerCase().includes(q) ||
      (v.vendor?.name ?? '').toLowerCase().includes(q)
    const matchType = !filterType || v.type === filterType
    return matchSearch && matchType
  })

  const typeCount = VEHICLE_TYPES.reduce<Record<string, number>>((acc, t) => {
    acc[t] = vehicles.filter(v => v.type === t).length
    return acc
  }, {})

  return (
    <div className="flex flex-col min-h-screen bg-slate-950">
      <Header />
      <main className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/15 flex items-center justify-center">
              <Truck className="w-5 h-5 text-teal-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Vehicles</h1>
              <p className="text-xs text-slate-500">{vehicles.length} total · {vehicles.filter(v => v.isActive).length} active</p>
            </div>
          </div>
          {canManage && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={openNew}>Add Vehicle</Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by plate, brand, driver…"
              className="form-input pl-8 pr-8 text-sm w-full py-1.5"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className="form-select text-sm py-1.5 w-36">
            <option value="">All types</option>
            {VEHICLE_TYPES.filter(t => typeCount[t] > 0).map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)} ({typeCount[t]})</option>
            ))}
          </select>
        </div>

        {/* Vehicle list */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <Card className="p-10 text-center">
            <Truck className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">{search || filterType ? 'No vehicles match your filters' : 'No vehicles yet'}</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map(v => (
              <Card key={v.id} className={`p-4 ${!v.isActive ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-white text-sm">{v.plateNo}</span>
                      <Badge color={
                        v.type === 'car' ? 'blue' : v.type === 'van' ? 'green' : v.type === 'bus' ? 'purple' :
                        v.type === 'minibus' ? 'teal' : 'gray'
                      }>
                        {v.type.charAt(0).toUpperCase() + v.type.slice(1)}
                      </Badge>
                      {!v.isActive && <Badge color="gray">Inactive</Badge>}
                    </div>
                    <p className="text-sm text-slate-400 mt-1">
                      {[v.brand, v.model].filter(Boolean).join(' ') || '—'}
                      {v.capacity ? <span className="text-slate-500 ml-2">· {v.capacity} seats</span> : null}
                    </p>
                    {v.driver && (
                      <p className="text-xs text-emerald-400 mt-1.5 font-medium">
                        👤 {v.driver.name} · {v.driver.phone}
                      </p>
                    )}
                    {v.vendor && (
                      <p className="text-xs text-violet-400 mt-0.5 font-medium">
                        🏢 {v.vendor.name}
                      </p>
                    )}
                    {v.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-1">{v.description}</p>
                    )}
                  </div>

                  {canManage && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => toggleActive(v)}
                        title={v.isActive ? 'Deactivate' : 'Activate'}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-700 transition-colors"
                      >
                        {v.isActive ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </button>
                      <button
                        onClick={() => openEdit(v)}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteVehicle(v.id)}
                        disabled={deleting === v.id}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                      >
                        {deleting === v.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Add / Edit Modal */}
      {modal && (
        <Modal onClose={() => setModal(null)} title={modal === 'new' ? 'Add Vehicle' : 'Edit Vehicle'}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Type *</label>
                <select className="form-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                  {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Plate Number *</label>
                <input className="form-input uppercase" value={form.plateNo}
                  onChange={e => setForm(f => ({ ...f, plateNo: e.target.value }))}
                  placeholder="ABC-1234" />
              </div>
              <div>
                <label className="form-label">Brand</label>
                <input className="form-input" value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                  placeholder="Toyota, Ford…" />
              </div>
              <div>
                <label className="form-label">Model</label>
                <input className="form-input" value={form.model}
                  onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  placeholder="Hiace, Transit…" />
              </div>
              <div>
                <label className="form-label">Capacity (seats)</label>
                <input type="number" className="form-input" value={form.capacity} min={1} max={100}
                  onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-textarea" rows={2} value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Optional notes about this vehicle…" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : modal === 'new' ? 'Add Vehicle' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
