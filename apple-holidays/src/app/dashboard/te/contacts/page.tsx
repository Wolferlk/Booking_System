'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, Phone, MessageSquare, Mail, Globe, Users } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'

interface ContactLog {
  id: string
  type: string
  subject: string
  notes: string | null
  contactedAt: string
  user: { name: string }
  booking: { bookingRef: string; operationCountry: string | null }
}

const CONTACT_TYPES = [
  { value: 'PHONE',    label: 'Phone Call',   icon: Phone },
  { value: 'WHATSAPP', label: 'WhatsApp',     icon: MessageSquare },
  { value: 'EMAIL',    label: 'Email',        icon: Mail },
  { value: 'PORTAL',   label: 'Portal',       icon: Globe },
  { value: 'IN_PERSON',label: 'In Person',   icon: Users },
]

const TYPE_COLOR: Record<string, string> = {
  PHONE:     'bg-blue-100 text-blue-700',
  WHATSAPP:  'bg-green-100 text-green-700',
  EMAIL:     'bg-purple-100 text-purple-700',
  PORTAL:    'bg-cyan-100 text-cyan-700',
  IN_PERSON: 'bg-orange-100 text-orange-700',
}

export default function ContactLogPage() {
  const { countryFilter } = useCountryFilter()
  const [logs, setLogs] = useState<ContactLog[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ bookingRef: '', type: 'PHONE', subject: '', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`/api/te/contacts?${params}`)
      const json = await res.json()
      if (json.success) setLogs(json.data)
      else toast.error(json.error ?? 'Failed to load')
    } catch { toast.error('Network error') }
    finally { setLoading(false) }
  }, [countryFilter])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!form.bookingRef || !form.subject) { toast.error('Booking ref and subject are required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/te/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Contact logged')
      setModal(false)
      setForm({ bookingRef: '', type: 'PHONE', subject: '', notes: '' })
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <Header
        title="Contact Log"
        subtitle="Record all guest and agent communications"
        actions={
          <button onClick={() => setModal(true)} className="btn btn-primary btn-sm">
            <Plus className="w-4 h-4" /> Log Contact
          </button>
        }
      />

      <div className="p-8 space-y-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <Card className="p-12 text-center">
            <Phone className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No contact logs yet</p>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-slate-900">
                {logs.length} contact{logs.length !== 1 ? 's' : ''} logged
              </h3>
            </CardHeader>
            <CardBody className="p-0">
              <div className="divide-y divide-slate-100">
                {logs.map(log => {
                  const TypeIcon = CONTACT_TYPES.find(t => t.value === log.type)?.icon ?? Phone
                  return (
                    <div key={log.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${TYPE_COLOR[log.type] ?? 'bg-slate-100 text-slate-600'}`}>
                        <TypeIcon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`/dashboard/bookings/${log.booking.bookingRef}`}
                            className="font-mono font-semibold text-sm text-brand-700 hover:underline"
                          >
                            {log.booking.bookingRef}
                          </a>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${TYPE_COLOR[log.type] ?? 'bg-slate-100 text-slate-600'}`}>
                            {CONTACT_TYPES.find(t => t.value === log.type)?.label ?? log.type}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-slate-800 mt-0.5">{log.subject}</p>
                        {log.notes && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{log.notes}</p>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                          {formatDate(log.contactedAt)} · {log.user.name}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardBody>
          </Card>
        )}
      </div>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Log Guest / Agent Contact"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={save}>Save Log</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Booking Ref *</label>
            <input
              className="form-input font-mono"
              placeholder="VN19005"
              value={form.bookingRef}
              onChange={e => setForm(x => ({ ...x, bookingRef: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Contact Type *</label>
            <div className="grid grid-cols-3 gap-2">
              {CONTACT_TYPES.map(t => {
                const Icon = t.icon
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setForm(x => ({ ...x, type: t.value }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      form.type === t.value
                        ? 'bg-brand-500/10 border-brand-500/40 text-brand-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="form-label">Subject *</label>
            <input
              className="form-input"
              placeholder="e.g. Confirmed pick-up time with driver"
              value={form.subject}
              onChange={e => setForm(x => ({ ...x, subject: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Additional details about the conversation…"
              value={form.notes}
              onChange={e => setForm(x => ({ ...x, notes: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
