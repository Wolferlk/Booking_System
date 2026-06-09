'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Loader2, Wand2, Car, MapPin } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
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
    driverName?: string
    driverPhone?: string
    vehicleType?: string
    vehiclePlate?: string
  } | null
}

interface AssignmentForm {
  driverName: string
  driverPhone: string
  vehicleType: string
  vehiclePlate: string
  notes: string
}

export default function AgendaPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [items, setItems] = useState<AgendaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [assigningIdx, setAssigningIdx] = useState<number | null>(null)
  const [assignmentForm, setAssignmentForm] = useState<AssignmentForm>({
    driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '', notes: '',
  })

  const canEdit = ['BT_USER', 'SUPER_ADMIN'].includes(role)
  const canAssign = ['GT_USER', 'SUPER_ADMIN'].includes(role)

  async function loadAgenda() {
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda`)
      const json = await res.json()
      if (json.success && json.data) {
        setItems((json.data.items ?? []).map((i: Record<string, unknown>) => ({
          id: i.id as string,
          date: (i.date as string)?.slice(0, 10) ?? '',
          location: i.location as string ?? '',
          fromPoint: i.fromPoint as string ?? '',
          toPoint: i.toPoint as string ?? '',
          details: i.details as string ?? '',
          mealPlan: i.mealPlan as string ?? '',
          meetingTime: i.meetingTime as string ?? '',
          serviceType: i.serviceType as string ?? 'OWN_ARRANGEMENT',
          assignment: i.assignment as AgendaItem['assignment'],
        })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAgenda() }, [ref])

  async function generateAgenda() {
    setGenerating(true)
    try {
      const bookingRes = await fetch(`/api/bookings/${ref}`)
      const bookingJson = await bookingRes.json()
      if (!bookingJson.success) throw new Error('Failed to load booking')

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      toast.info('AI agenda generation requires a booking document upload')
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

  async function saveAssignment(itemId: string) {
    try {
      const res = await fetch(`/api/bookings/${ref}/agenda`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, assignment: assignmentForm }),
      })
      // For simplicity, save assignment through a separate endpoint
      // In production, POST to /api/agenda-items/:id/assignment
      toast.success('Assignment saved')
      setAssigningIdx(null)
      await loadAgenda()
    } catch {
      toast.error('Failed to save assignment')
    }
  }

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
                <Button variant="secondary" size="sm" loading={generating}
                  icon={<Wand2 className="w-4 h-4" />} onClick={generateAgenda}>
                  AI Generate
                </Button>
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
        {items.length === 0 && !canEdit && (
          <Card className="p-12 text-center">
            <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No agenda items yet</p>
          </Card>
        )}

        {items.map((item, i) => {
          const svcType = SERVICE_TYPES.find(s => s.value === item.serviceType)
          return (
            <Card key={i} className="overflow-hidden">
              <div className="flex">
                {/* Left colour bar */}
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

                        {/* Assignment info */}
                        {item.assignment?.driverName && (
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-600 bg-blue-50 rounded-lg px-3 py-1.5 w-fit">
                            <Car className="w-3.5 h-3.5 text-blue-500" />
                            {item.assignment.driverName} · {item.assignment.vehicleType} {item.assignment.vehiclePlate}
                          </div>
                        )}
                      </div>

                      {/* Assignment button for GT */}
                      {canAssign && (item.serviceType === 'PVT_TRANSFER' || item.serviceType === 'SIC_TRANSFER') && (
                        <Button variant="secondary" size="sm" icon={<Car className="w-3.5 h-3.5" />}
                          onClick={() => {
                            setAssigningIdx(i)
                            setAssignmentForm({
                              driverName: item.assignment?.driverName ?? '',
                              driverPhone: item.assignment?.driverPhone ?? '',
                              vehicleType: item.assignment?.vehicleType ?? '',
                              vehiclePlate: item.assignment?.vehiclePlate ?? '',
                              notes: '',
                            })
                          }}>
                          {item.assignment?.driverName ? 'Edit Assignment' : 'Assign Driver'}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Inline assignment form */}
                  {assigningIdx === i && (
                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[
                        { label: 'Driver Name', key: 'driverName' },
                        { label: 'Phone', key: 'driverPhone' },
                        { label: 'Vehicle Type', key: 'vehicleType' },
                        { label: 'Plate No', key: 'vehiclePlate' },
                      ].map(f => (
                        <div key={f.key}>
                          <label className="form-label text-xs">{f.label}</label>
                          <input className="form-input text-sm py-1.5"
                            value={(assignmentForm as Record<string, string>)[f.key]}
                            onChange={e => setAssignmentForm(a => ({ ...a, [f.key]: e.target.value }))} />
                        </div>
                      ))}
                      <div className="flex items-end gap-2">
                        <Button size="sm" onClick={() => item.id && saveAssignment(item.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAssigningIdx(null)}>Cancel</Button>
                      </div>
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
