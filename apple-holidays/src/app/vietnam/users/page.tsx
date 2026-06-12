'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  ChevronLeft, Plus, Loader2, Pencil, Trash2,
  ToggleLeft, ToggleRight, Shield, Search, X,
} from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  BT_USER: 'Booking Team',
  GT_USER: 'Ground Team',
  TE_USER: 'Travel Experience',
  AC_USER: 'Accounts Team',
  CLIENT: 'Client / Agent',
  SUPER_ADMIN: 'Super Admin',
}

const ROLE_COLORS: Record<string, string> = {
  BT_USER: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  GT_USER: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  TE_USER: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  AC_USER: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  CLIENT: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  SUPER_ADMIN: 'bg-red-500/15 text-red-400 border-red-500/30',
}

interface User {
  id: string
  email: string
  name: string
  role: string
  phone: string | null
  isActive: boolean
  createdAt: string
}

const EMPTY_FORM = { name: '', email: '', password: '', role: 'BT_USER', phone: '' }

export default function UsersManagementPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')

  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteUser, setDeleteUser] = useState<User | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  async function loadUsers() {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      const json = await res.json()
      if (json.success) setUsers(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  async function createUser() {
    if (!form.name || !form.email || !form.password) {
      toast.error('Name, email and password are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('User created successfully')
      setAddOpen(false)
      setForm(EMPTY_FORM)
      await loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setSaving(false)
    }
  }

  async function updateUser() {
    if (!editUser) return
    setSaving(true)
    try {
      const payload: Record<string, string | boolean> = {
        name: form.name,
        email: form.email,
        phone: form.phone,
        role: form.role,
      }
      if (form.password) payload.password = form.password
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('User updated')
      setEditUser(null)
      setForm(EMPTY_FORM)
      await loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(user: User) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`User ${user.isActive ? 'deactivated' : 'activated'}`)
      await loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
  }

  async function confirmDelete() {
    if (!deleteUser) return
    setSaving(true)
    try {
      const res = await fetch(`/api/users/${deleteUser.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('User deleted')
      setDeleteUser(null)
      await loadUsers()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(user: User) {
    setForm({ name: user.name, email: user.email, password: '', role: user.role, phone: user.phone ?? '' })
    setEditUser(user)
  }

  const filtered = users.filter(u => {
    const matchSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    const matchRole = roleFilter === 'ALL' || u.role === roleFilter
    return matchSearch && matchRole
  })

  return (
    <div className="min-h-screen bg-[#060a14]">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[600px] h-[400px] bg-brand-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[400px] bg-blue-600/5 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-[#060a14]/80 backdrop-blur-sm sticky top-0">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href="/vietnam" className="flex items-center gap-1.5 text-slate-500 hover:text-white transition-colors text-sm group">
              <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
              Back
            </Link>
            <div className="w-px h-5 bg-slate-700/60" />
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-tight">User Management</p>
                <p className="text-slate-500 text-[10px] uppercase tracking-wider">MMT Vietnam</p>
              </div>
            </div>
          </div>
          <button
            onClick={() => { setForm(EMPTY_FORM); setAddOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-8 py-10">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Users', value: users.length, color: 'text-white' },
            { label: 'Active', value: users.filter(u => u.isActive).length, color: 'text-emerald-400' },
            { label: 'Inactive', value: users.filter(u => !u.isActive).length, color: 'text-red-400' },
            { label: 'Roles', value: new Set(users.map(u => u.role)).size, color: 'text-brand-400' },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl border border-white/8 bg-white/3 p-4">
              <p className="text-xs text-slate-500 mb-1">{stat.label}</p>
              <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-brand-500/50"
          >
            <option value="ALL">All Roles</option>
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-white/8 bg-white/2 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-slate-600 text-sm">
              {search || roleFilter !== 'ALL' ? 'No users match your filters.' : 'No users yet. Add the first one!'}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/8">
                  {['User', 'Email', 'Role', 'Phone', 'Status', 'Created', 'Actions'].map(h => (
                    <th key={h} className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map(u => (
                  <tr key={u.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400 text-xs font-black flex-shrink-0">
                          {u.name.slice(0, 1).toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-white">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-sm">{u.email}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${ROLE_COLORS[u.role] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30'}`}>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-500 text-sm">{u.phone ?? '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border ${u.isActive ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-600 text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit user"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-brand-400 hover:bg-brand-500/10 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          title={u.isActive ? 'Deactivate' : 'Activate'}
                          className={`p-1.5 rounded-lg transition-colors ${u.isActive ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10'}`}
                        >
                          {u.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => setDeleteUser(u)}
                          title="Delete user"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="mt-3 text-slate-700 text-xs">{filtered.length} of {users.length} users</p>
      </main>

      {/* Add User Modal */}
      {addOpen && (
        <UserModal
          title="Add New User"
          form={form}
          setForm={setForm}
          saving={saving}
          onClose={() => setAddOpen(false)}
          onSubmit={createUser}
          submitLabel="Create User"
          showPassword
        />
      )}

      {/* Edit User Modal */}
      {editUser && (
        <UserModal
          title={`Edit — ${editUser.name}`}
          form={form}
          setForm={setForm}
          saving={saving}
          onClose={() => setEditUser(null)}
          onSubmit={updateUser}
          submitLabel="Save Changes"
          showPassword
          passwordOptional
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0e1523] border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-white font-bold">Delete User</p>
                <p className="text-slate-500 text-xs">This action cannot be undone</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm mb-6">
              Are you sure you want to delete <span className="text-white font-semibold">{deleteUser.name}</span>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteUser(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={saving}
                className="flex-1 px-4 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface UserModalProps {
  title: string
  form: typeof EMPTY_FORM
  setForm: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>
  saving: boolean
  onClose: () => void
  onSubmit: () => void
  submitLabel: string
  showPassword?: boolean
  passwordOptional?: boolean
}

function UserModal({ title, form, setForm, saving, onClose, onSubmit, submitLabel, showPassword, passwordOptional }: UserModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0e1523] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/8">
          <p className="text-white font-bold">{title}</p>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {[
            { label: 'Full Name *', key: 'name', type: 'text' },
            { label: 'Email *', key: 'email', type: 'email' },
            { label: 'Phone', key: 'phone', type: 'tel' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">{f.label}</label>
              <input
                type={f.type}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500/50"
              />
            </div>
          ))}
          {showPassword && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                Password {passwordOptional ? '(leave blank to keep)' : '*'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(x => ({ ...x, password: e.target.value }))}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-slate-600 focus:outline-none focus:border-brand-500/50"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1.5">Role *</label>
            <select
              value={form.role}
              onChange={e => setForm(x => ({ ...x, role: e.target.value }))}
              className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-brand-500/50"
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value} className="bg-[#0e1523]">{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-white/10 text-slate-400 text-sm hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
