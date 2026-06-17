'use client'

import { useEffect, useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, Search, Filter, Eye, Pencil, Trash2,
  X, User, Mail, Phone, Shield, CheckCircle, XCircle,
  Calendar, Activity, BookOpen, RefreshCw, Lock, EyeOff,
  AlertTriangle, ChevronUp, ChevronDown, ToggleLeft, ToggleRight,
  UserCheck, UserX, Users, Key, Globe,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { ROLE_LABELS } from '@/lib/rbac'
import { formatDate, formatDateTime, getInitials, cn } from '@/lib/utils'
import { useCountryFilter } from '@/hooks/use-country-filter'
import type { UserRole, OperationCountry } from '@prisma/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserRecord {
  id: string
  email: string
  name: string
  role: UserRole
  country: OperationCountry
  phone: string | null
  avatar: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  _count: { bookingsCreated: number; activityLogs: number }
}

type ModalMode = 'none' | 'view' | 'add' | 'edit' | 'delete'
type SortField = 'name' | 'role' | 'createdAt' | 'isActive'
type SortDir   = 'asc' | 'desc'

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<UserRole, 'blue' | 'green' | 'purple' | 'orange' | 'gray' | 'red'> = {
  BT_USER: 'blue', GT_USER: 'green', TE_USER: 'purple',
  AC_USER: 'orange', CLIENT: 'gray', SUPER_ADMIN: 'red',
  GT_TE_USER: 'green', ULTRA_SUPER_ADMIN: 'orange',
}

const ROLE_BG: Record<UserRole, string> = {
  BT_USER:           'bg-blue-500',
  GT_USER:           'bg-emerald-500',
  TE_USER:           'bg-purple-500',
  AC_USER:           'bg-orange-500',
  CLIENT:            'bg-slate-400',
  SUPER_ADMIN:       'bg-red-500',
  GT_TE_USER:        'bg-teal-500',
  ULTRA_SUPER_ADMIN: 'bg-amber-500',
}

const ALL_ROLES = Object.entries(ROLE_LABELS) as [UserRole, string][]

const COUNTRY_META: Record<OperationCountry, { label: string; flag: string; color: string }> = {
  VIETNAM:            { label: 'Vietnam',              flag: '🇻🇳',     color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  SRILANKA:           { label: 'Sri Lanka',            flag: '🇱🇰',     color: 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30' },
  SINGAPORE_MALAYSIA: { label: 'Singapore & Malaysia', flag: '🇸🇬🇲🇾', color: 'bg-blue-500/15 text-blue-600 border-blue-500/30' },
  ALL:                { label: 'All Countries',        flag: '🌍',      color: 'bg-amber-500/15 text-amber-600 border-amber-500/30' },
}

// Roles available per country (used to filter the role dropdown when adding/editing)
const COUNTRY_ROLES: Record<OperationCountry, UserRole[]> = {
  VIETNAM:            ['BT_USER', 'GT_USER', 'TE_USER', 'SUPER_ADMIN'],
  SRILANKA:           ['BT_USER', 'GT_TE_USER', 'SUPER_ADMIN'],
  SINGAPORE_MALAYSIA: ['BT_USER', 'GT_TE_USER', 'SUPER_ADMIN'],
  ALL:                ['BT_USER', 'GT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'CLIENT', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'],
}

const SELECTABLE_COUNTRIES: OperationCountry[] = ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA']

const EMPTY_FORM = {
  name: '', email: '', phone: '', role: 'BT_USER' as UserRole,
  country: 'VIETNAM' as OperationCountry,
  isActive: true, password: '', confirmPassword: '',
}

// ─── Password strength ────────────────────────────────────────────────────────

function pwdStrength(pwd: string) {
  if (!pwd) return null
  let score = 0
  if (pwd.length >= 8)             score++
  if (/[A-Z]/.test(pwd))          score++
  if (/[0-9]/.test(pwd))          score++
  if (/[^A-Za-z0-9]/.test(pwd))  score++
  const levels = [
    { label: 'Very Weak', bar: 'bg-red-500',     text: 'text-red-500'     },
    { label: 'Weak',      bar: 'bg-orange-400',  text: 'text-orange-500'  },
    { label: 'Fair',      bar: 'bg-yellow-400',  text: 'text-yellow-600'  },
    { label: 'Good',      bar: 'bg-blue-500',    text: 'text-blue-600'    },
    { label: 'Strong',    bar: 'bg-emerald-500', text: 'text-emerald-600' },
  ]
  return { score, ...levels[score] }
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function UserAvatar({ user, size = 'md' }: { user: Pick<UserRecord, 'name' | 'role'>; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const sz = { sm: 'w-7 h-7 text-[10px]', md: 'w-9 h-9 text-xs', lg: 'w-12 h-12 text-sm', xl: 'w-16 h-16 text-base' }[size]
  return (
    <div className={cn('rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 shadow-sm', sz, ROLE_BG[user.role])}>
      {getInitials(user.name)}
    </div>
  )
}

// ─── Role select options ──────────────────────────────────────────────────────

function RoleSelect({ value, onChange, country }: { value: string; onChange: (v: string) => void; country?: OperationCountry }) {
  const allowedRoles = country ? COUNTRY_ROLES[country] : ALL_ROLES.map(([v]) => v as UserRole)
  const roleEntries = ALL_ROLES.filter(([v]) => allowedRoles.includes(v as UserRole))
  return (
    <select className="form-select" value={value} onChange={e => onChange(e.target.value)}>
      {roleEntries.map(([val, label]) => (
        <option key={val} value={val}>{label}</option>
      ))}
    </select>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const { countryFilter } = useCountryFilter()
  const { data: session } = useSession()

  // Data
  const [users, setUsers]         = useState<UserRecord[]>([])
  const [loading, setLoading]     = useState(true)

  // Filters
  const [search, setSearch]       = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sort, setSort]           = useState<{ field: SortField; dir: SortDir }>({ field: 'createdAt', dir: 'desc' })

  // Modals
  const [mode, setMode]           = useState<ModalMode>('none')
  const [selected, setSelected]   = useState<UserRecord | null>(null)

  // Add / Edit form
  const [form, setForm]           = useState({ ...EMPTY_FORM })
  const [showPwd, setShowPwd]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [resetPwd, setResetPwd]   = useState(false)
  const [saving, setSaving]       = useState(false)

  // Delete
  const [criticalPwd, setCriticalPwd] = useState('')
  const [showCritical, setShowCritical] = useState(false)
  const [deleting, setDeleting]   = useState(false)

  // Toggle active inline
  const [togglingId, setTogglingId] = useState<string | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────

  async function loadUsers() {
    setLoading(true)
    try {
      const cqs = countryFilter && countryFilter !== 'ALL' ? `?country=${countryFilter}` : ''
      const res  = await fetch(`/api/users${cqs}`)
      const json = await res.json()
      if (json.success) setUsers(json.data)
      else toast.error(json.error ?? 'Failed to load users')
    } catch {
      toast.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [countryFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered + Sorted ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = [...users]

    if (search) {
      const q = search.toLowerCase()
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone ?? '').includes(q),
      )
    }
    if (roleFilter) list = list.filter(u => u.role === roleFilter)
    if (statusFilter === 'active')   list = list.filter(u =>  u.isActive)
    if (statusFilter === 'inactive') list = list.filter(u => !u.isActive)

    list.sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      switch (sort.field) {
        case 'name':      return dir * a.name.localeCompare(b.name)
        case 'role':      return dir * a.role.localeCompare(b.role)
        case 'isActive':  return dir * (Number(a.isActive) - Number(b.isActive))
        case 'createdAt': return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        default: return 0
      }
    })
    return list
  }, [users, search, roleFilter, statusFilter, sort])

  // ── Stats ─────────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const active   = users.filter(u =>  u.isActive).length
    const inactive = users.filter(u => !u.isActive).length
    const byRole   = ALL_ROLES.map(([role, label]) => ({
      role, label, count: users.filter(u => u.role === role).length,
    })).filter(r => r.count > 0)
    return { total: users.length, active, inactive, byRole }
  }, [users])

  // ── Sort toggle ───────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    setSort(s => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }))
  }

  // ── Open modals ───────────────────────────────────────────────────────────────

  function openView(u: UserRecord) {
    setSelected(u); setMode('view')
  }

  function openEdit(u: UserRecord) {
    setSelected(u)
    setForm({ name: u.name, email: u.email, phone: u.phone ?? '', role: u.role, country: u.country ?? 'VIETNAM', isActive: u.isActive, password: '', confirmPassword: '' })
    setResetPwd(false); setShowPwd(false); setShowConfirm(false)
    setMode('edit')
  }

  function openAdd() {
    setSelected(null)
    // Pre-fill country from session for SUPER_ADMIN, default to VIETNAM for Ultra
    const sessionCountry = (session?.user as any)?.country as OperationCountry | undefined
    const defaultCountry: OperationCountry = (sessionCountry && sessionCountry !== 'ALL') ? sessionCountry : 'VIETNAM'
    setForm({ ...EMPTY_FORM, country: defaultCountry })
    setResetPwd(false); setShowPwd(false); setShowConfirm(false)
    setMode('add')
  }

  function openDelete(u: UserRecord) {
    setSelected(u); setCriticalPwd(''); setShowCritical(false); setMode('delete')
  }

  function closeModal() {
    setMode('none'); setSelected(null)
  }

  // ── Toggle active ─────────────────────────────────────────────────────────────

  async function toggleActive(u: UserRecord) {
    if (u.id === session?.user?.id) {
      toast.error('You cannot deactivate your own account')
      return
    }
    setTogglingId(u.id)
    try {
      const res  = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !u.isActive }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(u.isActive ? 'User deactivated' : 'User activated')
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isActive: !u.isActive } : x))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setTogglingId(null)
    }
  }

  // ── Save (Add/Edit) ────────────────────────────────────────────────────────────

  async function saveUser() {
    if (!form.name.trim()) { toast.error('Full name is required'); return }
    if (!form.email.trim()) { toast.error('Email is required'); return }
    if (mode === 'add' || (mode === 'edit' && resetPwd)) {
      if (!form.password) { toast.error('Password is required'); return }
      if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return }
      if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return }
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        role: form.role,
        country: form.country,
        isActive: form.isActive,
      }
      if (mode === 'add' || (mode === 'edit' && resetPwd)) {
        payload.password = form.password
      }

      const url    = mode === 'edit' ? `/api/users/${selected!.id}` : '/api/users'
      const method = mode === 'edit' ? 'PATCH' : 'POST'

      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      toast.success(mode === 'edit' ? 'User updated' : 'User created')
      closeModal()
      await loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────────

  async function deleteUser() {
    if (!selected || !criticalPwd.trim()) {
      toast.error('Enter the critical service password to confirm deletion')
      return
    }
    setDeleting(true)
    try {
      const res  = await fetch(`/api/users/${selected.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criticalPassword: criticalPwd }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`User "${selected.name}" has been permanently deleted`)
      closeModal()
      await loadUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deletion failed')
    } finally {
      setDeleting(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const strength = pwdStrength(form.password)
  const isSelf   = (u: UserRecord) => u.id === session?.user?.id

  function SortTh({ field, label }: { field: SortField; label: string }) {
    const active = sort.field === field
    return (
      <th
        onClick={() => handleSort(field)}
        className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap cursor-pointer hover:text-slate-800 select-none group"
      >
        <span className="flex items-center gap-1">
          {label}
          <span className={cn('transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40')}>
            {sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
        </span>
      </th>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title="User Management"
        subtitle={`${filtered.length} of ${users.length} user${users.length !== 1 ? 's' : ''}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={loadUsers} disabled={loading} className="btn btn-secondary btn-sm">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              Refresh
            </button>
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
              Add User
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-5">

        {/* ── Ultra Super Admin identity banner ────────────────────────────── */}
        {(session?.user?.role as string) === 'ULTRA_SUPER_ADMIN' && (
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-amber-50 border border-amber-200">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Key className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-800">Ultra Super Admin — Full System Control</p>
              <p className="text-xs text-amber-600 mt-0.5">You can create, edit, and delete users across all countries. Changes are logged in the audit trail.</p>
            </div>
          </div>
        )}

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {/* Total */}
          <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
              <Users className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Total</div>
              <div className="text-xl font-bold text-slate-900 leading-tight">{stats.total}</div>
            </div>
          </div>
          {/* Active */}
          <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <UserCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Active</div>
              <div className="text-xl font-bold text-emerald-600 leading-tight">{stats.active}</div>
            </div>
          </div>
          {/* Inactive */}
          <div className="col-span-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
              <UserX className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Inactive</div>
              <div className="text-xl font-bold text-red-500 leading-tight">{stats.inactive}</div>
            </div>
          </div>
          {/* Per role */}
          {stats.byRole.map(({ role, label, count }) => (
            <div key={role} className="col-span-1 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', ROLE_BG[role as UserRole] + '/15')}>
                <Shield className={cn('w-4 h-4', {
                  'text-blue-600': role === 'BT_USER',
                  'text-emerald-600': role === 'GT_USER',
                  'text-purple-600': role === 'TE_USER',
                  'text-orange-600': role === 'AC_USER',
                  'text-slate-500': role === 'CLIENT',
                  'text-red-600': role === 'SUPER_ADMIN',
                })} />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold leading-tight">{label.replace(' ', '\n')}</div>
                <div className="text-xl font-bold text-slate-800 leading-tight">{count}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Filters ────────────────────────────────────────────────────── */}
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              {/* Search */}
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  className="form-input pl-9"
                  placeholder="Search name, email, phone…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Role */}
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <select className="form-select w-auto" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                  <option value="">All Roles</option>
                  {ALL_ROLES.map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Status pills */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                {(['all', 'active', 'inactive'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium capitalize transition-colors border-0 outline-none',
                      statusFilter === s
                        ? 'bg-brand-500 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Clear */}
              {(search || roleFilter || statusFilter !== 'all') && (
                <button onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter('all') }}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
                  <X className="w-3 h-3" /> Clear
                </button>
              )}

              <span className="ml-auto text-xs text-slate-400">
                {filtered.length} result{filtered.length !== 1 ? 's' : ''}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader action={
            <div className="text-xs text-slate-400">
              {loading ? 'Loading…' : `${filtered.length} user${filtered.length !== 1 ? 's' : ''}`}
            </div>
          }>
            <h3 className="text-sm font-semibold text-slate-900">System Users</h3>
          </CardHeader>
          <CardBody className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-7 h-7 text-brand-500 animate-spin" />
                <p className="text-sm text-slate-400">Loading users…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <Users className="w-10 h-10 opacity-20" />
                <p className="text-sm font-medium">No users match your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px] w-8">#</th>
                      <SortTh field="name" label="User" />
                      <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Contact</th>
                      <SortTh field="role" label="Role" />
                      <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Country</th>
                      <SortTh field="isActive" label="Status" />
                      <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px] whitespace-nowrap">Activity</th>
                      <SortTh field="createdAt" label="Joined" />
                      <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((u, idx) => (
                      <tr key={u.id} className={cn('transition-colors group hover:bg-slate-50/80', !u.isActive && 'opacity-60')}>
                        {/* # */}
                        <td className="px-4 py-3 text-slate-400 text-xs">{idx + 1}</td>

                        {/* User */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <UserAvatar user={u} />
                            <div>
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                {u.name}
                                {isSelf(u) && (
                                  <span className="text-[9px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">YOU</span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 truncate max-w-[180px]">{u.email}</div>
                            </div>
                          </div>
                        </td>

                        {/* Contact */}
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {u.phone
                            ? <div className="flex items-center gap-1"><Phone className="w-3 h-3" />{u.phone}</div>
                            : <span className="text-slate-300">—</span>}
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3">
                          <Badge color={ROLE_COLORS[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                        </td>

                        {/* Country */}
                        <td className="px-4 py-3">
                          {u.country && COUNTRY_META[u.country] ? (
                            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border', COUNTRY_META[u.country].color)}>
                              <span>{COUNTRY_META[u.country].flag}</span>
                              <span>{COUNTRY_META[u.country].label}</span>
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>

                        {/* Status toggle */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleActive(u)}
                            disabled={!!togglingId || isSelf(u)}
                            className={cn(
                              'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-all',
                              u.isActive
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100',
                              isSelf(u) && 'cursor-not-allowed opacity-50',
                            )}
                            title={isSelf(u) ? 'Cannot change own status' : undefined}
                          >
                            {togglingId === u.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : u.isActive
                                ? <ToggleRight className="w-3.5 h-3.5" />
                                : <ToggleLeft className="w-3.5 h-3.5" />}
                            {u.isActive ? 'Active' : 'Inactive'}
                          </button>
                        </td>

                        {/* Activity */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1" title="Bookings created">
                              <BookOpen className="w-3 h-3 text-blue-400" />
                              {u._count.bookingsCreated}
                            </span>
                            <span className="flex items-center gap-1" title="Activity log entries">
                              <Activity className="w-3 h-3 text-purple-400" />
                              {u._count.activityLogs}
                            </span>
                          </div>
                        </td>

                        {/* Joined */}
                        <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                          {formatDate(u.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => openView(u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                              title="View user"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openEdit(u)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                              title="Edit user"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {!isSelf(u) && (
                              <button
                                onClick={() => openDelete(u)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete user"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          VIEW MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal open={mode === 'view'} onClose={closeModal} title="User Details" size="md">
        {selected && (
          <div className="space-y-5">
            {/* Avatar + name */}
            <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
              <UserAvatar user={selected} size="xl" />
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-slate-900">{selected.name}</h3>
                <p className="text-sm text-slate-500 truncate">{selected.email}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge color={ROLE_COLORS[selected.role]}>{ROLE_LABELS[selected.role]}</Badge>
                  <Badge color={selected.isActive ? 'green' : 'red'}>
                    {selected.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  {isSelf(selected) && (
                    <span className="text-[10px] font-bold text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-200">
                      YOU
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Detail grid */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: <Mail className="w-4 h-4" />,     label: 'Email',         value: selected.email,           color: 'text-blue-500' },
                { icon: <Phone className="w-4 h-4" />,    label: 'Phone',         value: selected.phone ?? '—',    color: 'text-green-500' },
                { icon: <Shield className="w-4 h-4" />,   label: 'Role',          value: ROLE_LABELS[selected.role], color: 'text-purple-500' },
                { icon: <Globe className="w-4 h-4" />,    label: 'Country',       value: selected.country ? `${COUNTRY_META[selected.country]?.flag ?? ''} ${COUNTRY_META[selected.country]?.label ?? selected.country}` : '—', color: 'text-cyan-500' },
                { icon: <CheckCircle className="w-4 h-4" />, label: 'Status',     value: selected.isActive ? 'Active' : 'Inactive', color: selected.isActive ? 'text-emerald-500' : 'text-red-500' },
                { icon: <Calendar className="w-4 h-4" />, label: 'Joined',        value: formatDate(selected.createdAt),   color: 'text-slate-400' },
                { icon: <RefreshCw className="w-4 h-4" />, label: 'Last Updated', value: formatDateTime(selected.updatedAt), color: 'text-slate-400' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className={cn('flex-shrink-0 mt-0.5', item.color)}>{item.icon}</div>
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">{item.label}</div>
                    <div className="text-sm font-medium text-slate-800 break-all">{item.value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Activity row */}
            <div className="flex gap-3">
              <div className="flex-1 p-3 rounded-lg bg-blue-50 border border-blue-100 text-center">
                <BookOpen className="w-5 h-5 text-blue-500 mx-auto mb-1" />
                <div className="text-xl font-bold text-blue-700">{selected._count.bookingsCreated}</div>
                <div className="text-[10px] text-blue-500 uppercase tracking-wide">Bookings Created</div>
              </div>
              <div className="flex-1 p-3 rounded-lg bg-purple-50 border border-purple-100 text-center">
                <Activity className="w-5 h-5 text-purple-500 mx-auto mb-1" />
                <div className="text-xl font-bold text-purple-700">{selected._count.activityLogs}</div>
                <div className="text-[10px] text-purple-500 uppercase tracking-wide">Activity Events</div>
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          {selected && (
            <Button size="sm" icon={<Pencil className="w-3.5 h-3.5" />} onClick={() => { closeModal(); openEdit(selected) }}>
              Edit User
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={closeModal}>Close</Button>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          ADD / EDIT MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={mode === 'add' || mode === 'edit'}
        onClose={closeModal}
        title={mode === 'edit' ? `Edit User — ${selected?.name}` : 'Add New User'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>Cancel</Button>
            <Button loading={saving} onClick={saveUser}>
              {mode === 'edit' ? 'Save Changes' : 'Create User'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Name + Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" /> Full Name *
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. John Doe"
                value={form.name}
                onChange={e => setForm(x => ({ ...x, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" /> Email Address *
              </label>
              <input
                type="email"
                className="form-input"
                placeholder="e.g. name@aahaas.com"
                value={form.email}
                onChange={e => setForm(x => ({ ...x, email: e.target.value }))}
              />
            </div>
          </div>

          {/* Phone */}
          <div>
            <label className="form-label flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-400" /> Phone Number
            </label>
            <input
              type="tel"
              className="form-input"
              placeholder="e.g. +94 77 123 4567"
              value={form.phone}
              onChange={e => setForm(x => ({ ...x, phone: e.target.value }))}
            />
          </div>

          {/* Country (Ultra Super Admin only — SUPER_ADMIN is locked to their country) */}
          {(session?.user?.role as string) === 'ULTRA_SUPER_ADMIN' ? (
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-400" /> Operating Country *
              </label>
              <select
                className="form-select"
                value={form.country}
                onChange={e => {
                  const c = e.target.value as OperationCountry
                  // Reset role if it's not valid for the new country
                  const validRoles = COUNTRY_ROLES[c]
                  const newRole = validRoles.includes(form.role) ? form.role : validRoles[0]
                  setForm(x => ({ ...x, country: c, role: newRole }))
                }}
              >
                {SELECTABLE_COUNTRIES.map(c => (
                  <option key={c} value={c}>{COUNTRY_META[c].flag} {COUNTRY_META[c].label}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                This user will only see data for the selected country.
              </p>
            </div>
          ) : (
            /* SUPER_ADMIN — show locked country badge, no edit */
            <div>
              <label className="form-label flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-400" /> Operating Country
              </label>
              {form.country && COUNTRY_META[form.country] ? (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
                  <span className="text-lg">{COUNTRY_META[form.country].flag}</span>
                  <span className="text-sm font-medium text-slate-700">{COUNTRY_META[form.country].label}</span>
                  <Lock className="w-3 h-3 text-slate-400 ml-auto" />
                </div>
              ) : null}
            </div>
          )}

          {/* Role */}
          <div>
            <label className="form-label flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-slate-400" /> Role *
            </label>
            <RoleSelect
              value={form.role}
              onChange={v => setForm(x => ({ ...x, role: v as UserRole }))}
              country={form.country}
            />
          </div>

          {/* Active status */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50">
            <div>
              <div className="text-sm font-medium text-slate-800">Account Status</div>
              <div className="text-xs text-slate-500">Inactive users cannot sign in</div>
            </div>
            <button
              type="button"
              onClick={() => setForm(x => ({ ...x, isActive: !x.isActive }))}
              className={cn(
                'relative inline-flex h-6 w-11 rounded-full transition-colors focus:outline-none',
                form.isActive ? 'bg-emerald-500' : 'bg-slate-300',
              )}
            >
              <span className={cn(
                'inline-block h-5 w-5 transform rounded-full bg-white shadow-sm mt-0.5 transition-transform',
                form.isActive ? 'translate-x-5 ml-0.5' : 'translate-x-0.5',
              )} />
            </button>
          </div>

          {/* Password section */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-400" />
                <span className="text-sm font-semibold text-slate-700">
                  {mode === 'add' ? 'Set Password' : 'Change Password'}
                </span>
              </div>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={() => { setResetPwd(r => !r); setForm(x => ({ ...x, password: '', confirmPassword: '' })) }}
                  className={cn('text-xs font-medium px-2.5 py-1 rounded-lg transition-colors',
                    resetPwd ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-200 text-slate-600 hover:bg-slate-300',
                  )}
                >
                  <Key className="w-3 h-3 inline mr-1" />
                  {resetPwd ? 'Cancel password change' : 'Change password'}
                </button>
              )}
            </div>

            {(mode === 'add' || resetPwd) && (
              <div className="p-4 space-y-3">
                {/* Password */}
                <div>
                  <label className="form-label">New Password *</label>
                  <div className="relative">
                    <input
                      type={showPwd ? 'text' : 'password'}
                      className="form-input pr-10"
                      placeholder="Minimum 6 characters"
                      value={form.password}
                      onChange={e => setForm(x => ({ ...x, password: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowPwd(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {/* Strength bar */}
                  {strength && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} className={cn('h-1 flex-1 rounded-full transition-all', i < strength.score ? strength.bar : 'bg-slate-200')} />
                        ))}
                      </div>
                      <div className={cn('text-[10px] font-semibold', strength.text)}>{strength.label}</div>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="form-label">Confirm Password *</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      className={cn('form-input pr-10',
                        form.confirmPassword && form.confirmPassword !== form.password && 'border-red-400 focus:ring-red-300',
                      )}
                      placeholder="Re-enter password"
                      value={form.confirmPassword}
                      onChange={e => setForm(x => ({ ...x, confirmPassword: e.target.value }))}
                    />
                    <button type="button" onClick={() => setShowConfirm(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {form.confirmPassword && form.password !== form.confirmPassword && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Passwords do not match
                    </p>
                  )}
                  {form.confirmPassword && form.password === form.confirmPassword && form.password.length >= 6 && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Passwords match
                    </p>
                  )}
                </div>
              </div>
            )}

            {mode === 'edit' && !resetPwd && (
              <div className="px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                Password is unchanged. Click &quot;Change password&quot; above to update it.
              </div>
            )}
          </div>

          {/* Role + country summary */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 flex items-start gap-3">
            <Shield className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-700">
                {ROLE_LABELS[form.role]}
                {form.country && form.country !== 'ALL' && COUNTRY_META[form.country]
                  ? ` — ${COUNTRY_META[form.country].flag} ${COUNTRY_META[form.country].label}`
                  : ''}
              </p>
              <p className="text-[11px] text-blue-600 mt-0.5">
                {form.role === 'ULTRA_SUPER_ADMIN' && '🌐 System owner — all-countries access, all modules, user management & danger zone. Requires critical password on login.'}
                {form.role === 'SUPER_ADMIN' && 'Full country access — user management, danger zone, and all admin functions for the assigned country.'}
                {form.role === 'BT_USER'     && 'Booking creation, confirmation, P&L management, and mail inbox.'}
                {form.role === 'GT_USER'     && 'Ground operations: assignments, tickets, drivers, vendors, and MC report. (Vietnam only)'}
                {form.role === 'GT_TE_USER'  && 'Combined ground + travel experience — assignments, reminders, payments. (Sri Lanka & Singapore/Malaysia)'}
                {form.role === 'TE_USER'     && 'Travel experience: live overview, analytics, ticket & voucher management. (Vietnam only)'}
                {form.role === 'AC_USER'     && 'Accounts: P&L management, profit dashboard, credit agents, and reports.'}
                {form.role === 'CLIENT'      && 'Read-only access to client portal — cannot access the dashboard.'}
              </p>
            </div>
          </div>
        </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          DELETE MODAL — CRITICAL SERVICE PASSWORD REQUIRED
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={mode === 'delete'}
        onClose={closeModal}
        title="Delete User"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={deleting}>Cancel</Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={deleteUser}
              icon={<Trash2 className="w-4 h-4" />}
            >
              Permanently Delete
            </Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-5">
            {/* Warning banner */}
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700">This action is permanent and cannot be undone</p>
                <p className="text-xs text-red-600 mt-1">
                  The user account, credentials, and all associated activity records will be permanently removed from the system.
                </p>
              </div>
            </div>

            {/* Target user card */}
            <div className="flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <UserAvatar user={selected} size="lg" />
              <div>
                <div className="font-semibold text-slate-900">{selected.name}</div>
                <div className="text-xs text-slate-500">{selected.email}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge color={ROLE_COLORS[selected.role]} >{ROLE_LABELS[selected.role]}</Badge>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-xs text-slate-500">{selected._count.bookingsCreated} bookings</span>
                </div>
              </div>
            </div>

            {/* Critical password */}
            <div className="border border-red-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border-b border-red-200">
                <Key className="w-4 h-4 text-red-500" />
                <span className="text-sm font-semibold text-red-700">Critical Service Password Required</span>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-xs text-slate-600">
                  Enter the system critical service password to authorise this deletion. This prevents accidental deletions.
                </p>
                <div>
                  <label className="form-label">Critical Service Password</label>
                  <div className="relative">
                    <input
                      type={showCritical ? 'text' : 'password'}
                      className="form-input pr-10 font-mono"
                      placeholder="Enter critical service password"
                      value={criticalPwd}
                      onChange={e => setCriticalPwd(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && deleteUser()}
                      autoFocus
                    />
                    <button type="button" onClick={() => setShowCritical(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showCritical ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Consequences */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">What will be deleted:</p>
              {[
                'User account and login credentials',
                `Activity logs (${selected._count.activityLogs} entries)`,
                'All session data and tokens',
              ].map(item => (
                <div key={item} className="flex items-center gap-2 text-xs text-slate-600">
                  <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                  {item}
                </div>
              ))}
              {selected._count.bookingsCreated > 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-700 mt-2 p-2 bg-amber-50 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {selected._count.bookingsCreated} booking{selected._count.bookingsCreated !== 1 ? 's' : ''} created by this user will remain in the system (booking data is preserved).
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
