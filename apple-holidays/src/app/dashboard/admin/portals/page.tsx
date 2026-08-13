'use client'

/**
 * Ticket Portals — where the ground team buys tickets.
 *
 * Malaysia, Singapore and Vietnam buy through resellers (Cebu, Global Tix,
 * Travel Vago, Be My Guest) or from an agent by name. Whoever is picked on a
 * ticket is who Accounts pays for it, so this list is shared: the rows live in
 * the Accounts database and its Settings → Ticket Portals page manages the same
 * ones. A portal added here is on the payment board immediately.
 *
 * Nothing is deleted from here. A portal that stops being used is turned off,
 * because tickets already bought through it carry its name — and this app is a
 * guest in that database, so removing a row is not its call.
 */

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Store, Plus, Loader2, Pencil, Power, X, Check, AlertCircle, Building2, User, CreditCard, ShoppingBag,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { hasPermission } from '@/lib/rbac'
import type { UserRole } from '@prisma/client'

const COUNTRIES: Record<string, string> = {
  SG: '🇸🇬 Singapore',
  MY: '🇲🇾 Malaysia',
  VN: '🇻🇳 Vietnam',
  LK: '🇱🇰 Sri Lanka',
}

const KIND_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; chip: string }> = {
  portal: { label: 'Booking portal', icon: ShoppingBag, chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  agent:  { label: 'Agent / person', icon: User,        chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  direct: { label: 'Direct purchase', icon: Building2,  chip: 'bg-slate-50 text-slate-600 border-slate-200' },
  bank:   { label: 'Bank transfer',  icon: CreditCard,  chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

const CATEGORIES = ['TICKETS', 'HOTEL', 'TRANSPORT', 'OTHER']

interface Portal {
  id: number
  country: string
  name: string
  slug: string
  kind: string
  categories: string[] | null
  supplierName: string | null
  currency: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  notes: string | null
  isActive: boolean
  sortOrder: number
  updatedBy: string | null
}

type Usage = Record<string, { tickets: number; purchased: number }>

const EMPTY = {
  name: '', kind: 'portal', categories: [] as string[], supplierName: '', currency: '',
  contactName: '', contactPhone: '', contactEmail: '', notes: '', sortOrder: '50', isActive: true,
}

export default function PortalsPage() {
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole
  const canManage = role ? hasPermission(role, 'admin:override') : false

  const [country, setCountry] = useState('SG')
  const [portals, setPortals] = useState<Portal[]>([])
  const [usage,   setUsage]   = useState<Usage>({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const [adding,  setAdding]  = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [form,    setForm]    = useState({ ...EMPTY })
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res  = await fetch(`/api/portals?portalCountry=${country}&all=true`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Could not load the portals.')
      setPortals(json.data.portals || [])
      setUsage(json.data.usage || {})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the portals.')
      setPortals([])
    } finally {
      setLoading(false)
    }
  }, [country])

  useEffect(() => { void load() }, [load])

  function openAdd() {
    setForm({ ...EMPTY })
    setEditing(null)
    setAdding(true)
  }

  function openEdit(p: Portal) {
    setForm({
      name: p.name,
      kind: p.kind,
      categories: p.categories ?? [],
      supplierName: p.supplierName ?? '',
      currency: p.currency ?? '',
      contactName: p.contactName ?? '',
      contactPhone: p.contactPhone ?? '',
      contactEmail: p.contactEmail ?? '',
      notes: p.notes ?? '',
      sortOrder: String(p.sortOrder ?? 50),
      isActive: p.isActive,
    })
    setAdding(false)
    setEditing(p.id)
  }

  function toggleCategory(cat: string) {
    setForm(f => ({
      ...f,
      categories: f.categories.includes(cat)
        ? f.categories.filter(c => c !== cat)
        : [...f.categories, cat],
    }))
  }

  async function save() {
    if (!form.name.trim()) { toast.error('A portal needs a name.'); return }
    setSaving(true)
    try {
      const body = {
        country,
        name: form.name.trim(),
        kind: form.kind,
        categories: form.categories,
        supplierName: form.supplierName || null,
        currency: form.currency || null,
        contactName: form.contactName || null,
        contactPhone: form.contactPhone || null,
        contactEmail: form.contactEmail || null,
        notes: form.notes || null,
        sortOrder: Number(form.sortOrder) || 50,
        isActive: form.isActive,
      }

      const res = await fetch(editing ? `/api/portals/${editing}` : '/api/portals', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      toast.success(json.message || 'Saved.')
      setAdding(false); setEditing(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save that portal.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(p: Portal) {
    try {
      const res = await fetch(`/api/portals/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !p.isActive }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message || 'Saved.')
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change that portal.')
    }
  }

  const active = portals.filter(p => p.isActive).length

  return (
    <>
      <Header
        title="Ticket Portals"
        subtitle="Where tickets are bought — shared with the Accounts payment board"
      />

      <div className="p-6 max-w-6xl mx-auto space-y-5">
        <Card className="p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
              <Store className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-[280px]">
              <h2 className="text-base font-bold text-slate-800">One list, both systems</h2>
              <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                The portal picked when a ticket is issued is the portal Accounts pays. These rows live in the
                Accounts database, so a change here is on the payment board straight away — and a portal that
                stops being used is turned off rather than deleted, because tickets already bought through it
                carry its name.
              </p>
            </div>
            {canManage && (
              <button onClick={openAdd} className="btn btn-primary">
                <Plus className="w-4 h-4" /> Add portal
              </button>
            )}
          </div>
        </Card>

        {/* Country tabs — a portal belongs to one operation. Global Tix serves
            Malaysia and Singapore as two separate rows on purpose: they are
            settled separately, and turning one off must not affect the other. */}
        <div className="flex gap-2 flex-wrap">
          {Object.entries(COUNTRIES).map(([code, label]) => (
            <button
              key={code}
              onClick={() => { setCountry(code); setAdding(false); setEditing(null) }}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition ${
                country === code
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {(adding || editing !== null) && canManage && (
          <Card className="p-5 border-indigo-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-800">
                {editing ? 'Edit portal' : `New portal for ${COUNTRIES[country]}`}
              </h3>
              <button onClick={() => { setAdding(false); setEditing(null) }} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Portal name</label>
                <input className="form-input" placeholder="Global Tix" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Kind</label>
                <select className="form-input" value={form.kind}
                  onChange={e => setForm(f => ({ ...f, kind: e.target.value }))}>
                  {Object.entries(KIND_META).map(([value, meta]) => (
                    <option key={value} value={value}>{meta.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="form-label">Paid to (supplier in Accounts)</label>
                <input className="form-input" placeholder="As named in Suppliers Manage" value={form.supplierName}
                  onChange={e => setForm(f => ({ ...f, supplierName: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Currency</label>
                <input className="form-input uppercase" placeholder="SGD" maxLength={3} value={form.currency}
                  onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Contact</label>
                <input className="form-input" placeholder="Who to call" value={form.contactName}
                  onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.contactPhone}
                  onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))} />
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Used for — leave all unticked for every kind of ticket</label>
                <div className="flex flex-wrap gap-3 mt-1">
                  {CATEGORIES.map(cat => (
                    <label key={cat} className="flex items-center gap-2 text-sm font-medium text-slate-600">
                      <input type="checkbox" checked={form.categories.includes(cat)} onChange={() => toggleCategory(cat)} />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="form-label">Notes</label>
                <textarea className="form-textarea" rows={2} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              <div className="md:col-span-2 flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                  <input type="checkbox" checked={form.isActive}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} />
                  Available for new purchases
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-500">Order</span>
                  <input type="number" className="form-input w-24" value={form.sortOrder}
                    onChange={e => setForm(f => ({ ...f, sortOrder: e.target.value }))} />
                </div>
                <div className="flex-1" />
                <button onClick={save} disabled={saving} className="btn btn-primary">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editing ? 'Save changes' : 'Add portal'}
                </button>
              </div>
            </div>
          </Card>
        )}

        <Card className="overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
            <h3 className="font-bold text-slate-800">{COUNTRIES[country]}</h3>
            <span className="text-xs text-slate-400">
              {active} available · {portals.length - active} off
            </span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <AlertCircle className="w-6 h-6 text-amber-500 mx-auto mb-2" />
              <p className="text-sm text-slate-500">{error}</p>
            </div>
          ) : portals.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No portals for {COUNTRIES[country]} yet. Until one is added, tickets for this country cannot
              record where they were bought — and cannot be marked purchased.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {portals.map(p => {
                const meta = KIND_META[p.kind] ?? KIND_META.portal
                const Icon = meta.icon
                const use = usage[p.slug]

                return (
                  <div key={p.id} className={`px-5 py-4 flex items-center gap-4 flex-wrap ${p.isActive ? '' : 'bg-slate-50/70'}`}>
                    <div className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 ${meta.chip}`}>
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-[200px]">
                      <p className={`font-bold text-sm ${p.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                        {p.name}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {meta.label}
                        {p.supplierName ? ` · paid to ${p.supplierName}` : ''}
                        {p.categories?.length ? ` · ${p.categories.join(', ')}` : ' · every kind of ticket'}
                      </p>
                    </div>

                    <div className="text-right min-w-[110px]">
                      {use ? (
                        <>
                          <p className="text-sm font-bold text-slate-700">{use.tickets} tickets</p>
                          <p className="text-xs text-slate-400">{use.purchased} purchased</p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-300">unused</p>
                      )}
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(p)} className="btn btn-secondary btn-sm" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleActive(p)} className="btn btn-secondary btn-sm"
                          title={p.isActive ? 'Turn off for new purchases' : 'Make available again'}>
                          <Power className={`w-3.5 h-3.5 ${p.isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {!canManage && (
          <p className="text-xs text-slate-400 text-center">
            You can see the list; adding or changing a portal needs an admin, because it decides where money is sent.
          </p>
        )}
      </div>
    </>
  )
}
