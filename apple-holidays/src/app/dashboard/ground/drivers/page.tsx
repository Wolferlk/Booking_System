'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, Car } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { useSession } from 'next-auth/react'

interface Driver { id: string; name: string; phone: string; email: string | null; licenseNo: string | null; isActive: boolean }

export default function DriversPage() {
  const { data: session } = useSession()
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', licenseNo: '' })

  const canCreate = ['GT_USER', 'SUPER_ADMIN'].includes(session?.user?.role ?? '')

  async function load() {
    const res = await fetch('/api/ground/drivers')
    const json = await res.json()
    if (json.success) setDrivers(json.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function create() {
    setSaving(true)
    try {
      const res = await fetch('/api/ground/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Driver added')
      setModal(false)
      setForm({ name: '', phone: '', email: '', licenseNo: '' })
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="Driver Directory"
        subtitle={`${drivers.length} active drivers`}
        actions={canCreate && <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setModal(true)}>Add Driver</Button>}
      />
      <div className="p-8">
        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
          ) : drivers.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Car className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No drivers added yet</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Phone</th><th>Email</th><th>License No</th><th>Status</th></tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.name}</td>
                    <td>{d.phone}</td>
                    <td className="text-slate-500 text-xs">{d.email ?? '—'}</td>
                    <td className="text-slate-500 text-xs font-mono">{d.licenseNo ?? '—'}</td>
                    <td><Badge color={d.isActive ? 'green' : 'red'}>{d.isActive ? 'Active' : 'Inactive'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Add Driver"
        footer={<><Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button><Button loading={saving} onClick={create}>Add Driver</Button></>}>
        <div className="space-y-4">
          {[
            { label: 'Full Name *', key: 'name', type: 'text' },
            { label: 'Phone *', key: 'phone', type: 'tel' },
            { label: 'Email', key: 'email', type: 'email' },
            { label: 'License No', key: 'licenseNo', type: 'text' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input type={f.type} className="form-input"
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
