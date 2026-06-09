'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Trash2, Save, Loader2, Wand2, Car, MapPin, Upload,
  Search, X, CheckCircle2, Phone,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

const SERVICE_TYPES = [
  { value: 'PVT_TRANSFER', label: 'PVT Transfer', color: 'blue' as const },
  { value: 'SIC_TRANSFER', label: 'SIC Transfer', color: 'green' as const },
  { value: 'OWN_ARRANGEMENT', label: 'Own Arrangement', color: 'gray' as const },
]

interface AgendaItem {
  id?: string
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  mealPlan: string
  meetingTime: string
  serviceType: string
  assignment?: {
    driverId?: string | null
    driverName?: string
    driverPhone?: string
    vehicleType?: string
    vehiclePlate?: string
  } | null
}

interface Driver {
  id: string
  name: string
  phone: string
  isActive: boolean
  vehicle: { plateNo: string; type: string; brand?: string | null; model?: string | null } | null
}

export default function AgendaPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [items, setItems] = useState<AgendaItem[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [assigningIdx, setAssigningIdx] = useState<number | null>(null)
  const [driverSearch, setDriverSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canEdit = ['BT_USER', 'GT_USER', 'SUPER_ADMIN'].includes(role)
  const canAssign = ['GT_USER', 'SUPER_ADMIN'].includes(role)

  async function loadAgenda() {
    try {
      const [agendaRes, driverRes] = await Promise.all([
        fetch(`/api/bookings/${ref}/agenda`),
        fetch('/api/ground/drivers'),
      ])
      const [agendaJson, driverJson] = await Promise.all([agendaRes.json(), driverRes.json()])
      if (agendaJson.success && agendaJson.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setItems((agendaJson.data.items ?? []).map((i: any) => ({
          id: i.id,
          date: (i.date as string)?.slice(0, 10) ?? '',
          location: i.location ?? '',
          fromPoint: i.fromPoint ?? '',
          toPoint: i.toPoint ?? '',
          details: i.details ?? '',
          mealPlan: i.mealPlan ?? '',
          meetingTime: i.meetingTime ?? '',
          serviceType: i.serviceType ?? 'OWN_ARRANGEMENT',
          assignment: i.assignment,
        })))
      }
      if (driverJson.success) setDrivers(driverJson.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAgenda() }, [ref])

  async function generateFromFile(file: File) {
    setGenerating(true)
    setShowUpload(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/bookings/${ref}/agenda/generate`, {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const generated = json.data.items as AgendaItem[]
      setItems(generated.map(item => ({
        ...item,
        date: (item.date as string)?.slice(0, 10) ?? '',
        fromPoint: item.fromPoint ?? '',
        toPoint: item.toPoint ?? '',
        details: item.details ?? '',
        mealPlan: item.mealPlan ?? '',
        meetingTime: item.meetingTime ?? '',
        serviceType: item.serviceType ?? 'OWN_ARRANGEMENT',
      })))
      toast.success(`Generated ${generated.length} agenda items — review and save`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function generateFromBooking() {
    setGenerating(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda/generate`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const generated = json.data.items as AgendaItem[]
      setItems(generated.map(item => ({
        ...item,
        date: (item.date as string)?.slice(0, 10) ?? '',
        fromPoint: item.fromPoint ?? '',
        toPoint: item.toPoint ?? '',
        details: item.details ?? '',
        mealPlan: item.mealPlan ?? '',
        meetingTime: item.meetingTime ?? '',
        serviceType: item.serviceType ?? 'OWN_ARRANGEMENT',
      })))
      toast.success(`Generated ${generated.length} agenda items from booking data`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function saveAgenda() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Agenda saved!')
      await loadAgenda()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveAssignment(itemId: string, idx: number) {
    const item = items[idx]
    if (!item) return
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, assignment: item.assignment }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Driver assigned!')
      setAssigningIdx(null)
    } catch {
      toast.error('Failed to save assignment')
    }
  }

  const filteredDrivers = drivers.filter(d =>
    d.isActive && (
      d.name.toLowerCase().includes(driverSearch.toLowerCase()) ||
      d.phone.includes(driverSearch) ||
      d.vehicle?.plateNo?.toLowerCase().includes(driverSearch.toLowerCase())
    )
  )

  if (loading) return <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>

  return (
    <div>
      <Header
        title={`Tour Agenda — ${ref}`}
        subtitle={`${items.length} agenda item${items.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex gap-2">
            {canEdit && (
              <>
                <div className="relative">
                  <Button variant="secondary" size="sm" loading={generating}
                    icon={<Wand2 className="w-4 h-4" />}
                    onClick={() => setShowUpload(v => !v)}>
                    AI Generate
                  </Button>
                  {showUpload && (
                    <div className="absolute right-0 top-10 z-20 w-80 bg-white border border-slate-200 rounded-xl shadow-lg p-4">
                      <p className="text-sm font-semibold text-slate-800 mb-1">Generate Agenda with AI</p>
                      <p className="text-xs text-slate-500 mb-3">Upload a tour confirmation (.docx) or generate from booking data</p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".docx,.txt"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) generateFromFile(f)
                          e.target.value = ''
                        }}
                      />
                      <div className="space-y-2">
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center gap-2 p-3 rounded-lg border-2 border-dashed border-brand-200 hover:border-brand-400 hover:bg-brand-50 transition-colors text-sm font-medium text-brand-600"
                        >
                          <Upload className="w-4 h-4" />
                          Upload TC Document (.docx)
                        </button>
                        <button
                          onClick={() => { setShowUpload(false); generateFromBooking() }}
                          className="w-full flex items-center gap-2 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors text-sm text-slate-600"
                        >
                          <Wand2 className="w-4 h-4" />
                          Generate from Booking Data
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <Button size="sm" loading={saving}
                  icon={<Save className="w-4 h-4" />} onClick={saveAgenda}>
                  Save Agenda
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-4 max-w-5xl">
        {items.length === 0 && (
          <Card className="p-12 text-center">
            <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium mb-2">No agenda items yet</p>
            {canEdit && (
              <p className="text-slate-400 text-sm">Click "AI Generate" to auto-create from a tour document, or add manually below</p>
            )}
          </Card>
        )}

        {items.map((item, i) => {
          const svcType = SERVICE_TYPES.find(s => s.value === item.serviceType)
          const isAssigning = assigningIdx === i

          return (
            <Card key={i} className="overflow-hidden">
              <div className="flex">
                <div className={`w-1.5 flex-shrink-0 ${
                  item.serviceType === 'PVT_TRANSFER' ? 'bg-blue-400' :
                  item.serviceType === 'SIC_TRANSFER' ? 'bg-green-400' : 'bg-slate-200'
                }`} />

                <div className="flex-1 p-5">
                  {canEdit ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                      <div>
                        <label className="form-label text-xs">Date</label>
                        <input type="date" className="form-input text-sm py-1.5" value={item.date}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, date: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">Location</label>
                        <input className="form-input text-sm py-1.5" value={item.location}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, location: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">From</label>
                        <input className="form-input text-sm py-1.5" value={item.fromPoint}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, fromPoint: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">To / Activity</label>
                        <input className="form-input text-sm py-1.5" value={item.toPoint}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, toPoint: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">Meeting Time</label>
                        <input type="time" className="form-input text-sm py-1.5" value={item.meetingTime}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, meetingTime: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">Meal Plan</label>
                        <input className="form-input text-sm py-1.5" placeholder="B/BL/BLD" value={item.mealPlan}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, mealPlan: e.target.value } : x))} />
                      </div>
                      <div className="col-span-2 sm:col-span-3">
                        <label className="form-label text-xs">Details / Timings</label>
                        <input className="form-input text-sm py-1.5" value={item.details}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, details: e.target.value } : x))} />
                      </div>
                      <div>
                        <label className="form-label text-xs">Service Type</label>
                        <select className="form-select text-sm py-1.5" value={item.serviceType}
                          onChange={e => setItems(is => is.map((x, j) => j === i ? { ...x, serviceType: e.target.value } : x))}>
                          {SERVICE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button onClick={() => setItems(is => is.filter((_, j) => j !== i))}
                          className="text-red-400 hover:text-red-600 mb-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-semibold text-slate-900">
                            {formatDate(item.date)} · {item.location}
                          </span>
                          {svcType && <Badge color={svcType.color}>{svcType.label}</Badge>}
                          {item.mealPlan && <Badge color="amber">{item.mealPlan}</Badge>}
                          {item.meetingTime && (
                            <span className="text-xs text-slate-500">Meet: {item.meetingTime}</span>
                          )}
                        </div>
                        {item.toPoint && (
                          <p className="text-sm text-slate-700 mt-1">
                            {item.fromPoint && <span className="text-slate-400">{item.fromPoint} → </span>}
                            {item.toPoint}
                          </p>
                        )}
                        {item.details && <p className="text-xs text-slate-500 mt-1">{item.details}</p>}

                        {item.assignment?.driverName && (
                          <div className="mt-2 flex items-center gap-3 text-xs bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 w-fit">
                            <Car className="w-3.5 h-3.5 text-blue-500" />
                            <span className="font-medium text-blue-700">{item.assignment.driverName}</span>
                            {item.assignment.driverPhone && (
                              <a href={`tel:${item.assignment.driverPhone}`} className="text-slate-500 flex items-center gap-1 hover:text-blue-600">
                                <Phone className="w-3 h-3" />{item.assignment.driverPhone}
                              </a>
                            )}
                            {item.assignment.vehiclePlate && (
                              <span className="font-mono text-slate-600">{item.assignment.vehicleType} {item.assignment.vehiclePlate}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {canAssign && (
                        <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                          onClick={() => { setAssigningIdx(i); setDriverSearch('') }}>
                          {item.assignment?.driverName ? 'Re-assign' : 'Assign Driver'}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Driver assignment panel */}
                  {isAssigning && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-slate-700">Select Driver</p>
                        <button onClick={() => setAssigningIdx(null)} className="text-slate-400 hover:text-slate-600">
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Search */}
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                        <input
                          value={driverSearch}
                          onChange={e => setDriverSearch(e.target.value)}
                          placeholder="Search driver by name, phone, or plate..."
                          className="form-input pl-9 text-sm py-2"
                        />
                      </div>

                      {/* Driver list */}
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {filteredDrivers.length === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-4">No active drivers found</p>
                        ) : (
                          filteredDrivers.map(d => {
                            const isSelected = items[i]?.assignment?.driverId === d.id
                            return (
                              <button
                                key={d.id}
                                onClick={() => {
                                  setItems(is => is.map((x, j) => j === i ? {
                                    ...x,
                                    assignment: {
                                      driverId: d.id,
                                      driverName: d.name,
                                      driverPhone: d.phone,
                                      vehicleType: d.vehicle?.type ?? '',
                                      vehiclePlate: d.vehicle?.plateNo ?? '',
                                    },
                                  } : x))
                                }}
                                className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                                  isSelected
                                    ? 'bg-brand-50 border-2 border-brand-300'
                                    : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                                }`}
                              >
                                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                  <span className="text-blue-700 font-bold text-sm">{d.name.slice(0, 1)}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="font-semibold text-sm text-slate-800">{d.name}</p>
                                  <p className="text-xs text-slate-500">
                                    {d.phone}
                                    {d.vehicle && ` · ${d.vehicle.brand ?? ''} ${d.vehicle.model ?? ''} ${d.vehicle.plateNo}`.trim()}
                                  </p>
                                </div>
                                {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                              </button>
                            )
                          })
                        )}
                      </div>

                      {item.assignment?.driverName && (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" onClick={() => item.id && saveAssignment(item.id, i)}>
                            Save Assignment
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => {
                            setItems(is => is.map((x, j) => j === i ? { ...x, assignment: null } : x))
                          }}>
                            Clear
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          )
        })}

        {canEdit && (
          <Button variant="secondary" icon={<Plus className="w-4 h-4" />}
            onClick={() => setItems(is => [...is, {
              date: '', location: '', fromPoint: '', toPoint: '',
              details: '', mealPlan: '', meetingTime: '', serviceType: 'OWN_ARRANGEMENT',
            }])}>
            Add Agenda Item
          </Button>
        )}
      </div>
    </div>
  )
}
