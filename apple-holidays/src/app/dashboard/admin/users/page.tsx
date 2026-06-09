'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, Shield } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { ROLE_LABELS } from '@/lib/rbac'
import { formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

const ROLE_COLORS: Record<string, 'blue' | 'green' | 'purple' | 'orange' | 'gray' | 'red'> = {
  BT_USER: 'blue', GT_USER: 'green', TE_USER: 'purple',
  AC_USER: 'orange', CLIENT: 'gray', SUPER_ADMIN: 'red',
}

interface User {
  id: string; email: string; name: string; role: UserRole
  phone: string | null; isActive: boolean; createdAt: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'BT_USER', phone: '' })
  const [saving, setSaving] = useState(false)

  async function loadUsers() {
    const res = await fetch('/api/users')
    const json = await res.json()
    if (json.success) setUsers(json.data)
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function createUser() {
    setSaving(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('User created')
      setModal(false)
      setForm({ email: '', name: '', password: '', role: 'BT_USER', phone: '' })
      await loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Header
        title="User Management"
        subtitle={`${users.length} users`}
        actions={
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setModal(true)}>
            Add User
          </Button>
        }
      />

      <div className="p-8">
        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th><th>Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 text-xs font-bold flex-shrink-0">
                          {u.name.slice(0, 1)}
                        </div>
                        <span className="text-sm font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="text-slate-500 text-sm">{u.email}</td>
                    <td>
                      <Badge color={ROLE_COLORS[u.role] ?? 'gray'}>
                        {ROLE_LABELS[u.role]}
                      </Badge>
                    </td>
                    <td className="text-slate-500 text-xs">{u.phone ?? '—'}</td>
                    <td>
                      <Badge color={u.isActive ? 'green' : 'red'}>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    <td className="text-slate-400 text-xs">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Create New User"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={createUser}>Create User</Button>
          </>
        }>
        <div className="space-y-4">
          {[
            { label: 'Full Name *', key: 'name', type: 'text' },
            { label: 'Email *', key: 'email', type: 'email' },
            { label: 'Password *', key: 'password', type: 'password' },
            { label: 'Phone', key: 'phone', type: 'tel' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input type={f.type} className="form-input"
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className="form-label">Role *</label>
            <select className="form-select" value={form.role} onChange={e => setForm(x => ({ ...x, role: e.target.value }))}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}
