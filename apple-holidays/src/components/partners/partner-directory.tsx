'use client'

/**
 * Guides / Tour Vendors directory — the full management screen.
 *
 * Both dashboard pages mount this with a different `kind`; everything that
 * differs between them (labels, endpoints, accent colour, the one speciality
 * field) comes from `PARTNER_CONFIG`, so the two directories cannot drift apart.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, User, Phone, Mail, Search, X, CreditCard, ChevronDown,
  ChevronRight, CheckCircle2, Edit2, Trash2, Building2, Link2, Users,
  Sparkles, StickyNote, Power, MapPin, Copy, ClipboardList,
  Camera, FileDown, AlertCircle,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'
import { CountryFlag } from '@/components/ui/country-flag'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { Field, inputClass, PhotoUpload } from '@/components/partners/partner-fields'
import {
  PARTNER_CONFIG, BANKS_BY_COUNTRY, BRANCH_PLACEHOLDERS, COUNTRY_BADGE,
  COUNTRY_FLAGS, COUNTRY_LABELS, EMPTY_PARTNER_FORM, HOLDER_PLACEHOLDERS,
  NIC_LABELS, PARTNER_COUNTRIES, PHONE_PLACEHOLDERS, SOURCE_META,
  SWIFT_PLACEHOLDERS, validatePartnerForm,
  type PartnerFormState, type PartnerKind, type PartnerRecord,
} from '@/lib/partner-directory'

type StatusFilter = 'all' | 'active' | 'inactive'
type SourceFilter = 'all' | 'STAFF' | 'SELF_REGISTERED' | 'MANUAL_ENTRY'

const WRITE_ROLES = ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

/** A record from the API mapped onto the editable form shape. */
function toForm(record: PartnerRecord): PartnerFormState {
  return {
    name: record.name,
    country: record.country ?? '',
    phone: record.phone,
    whatsappPhone: record.whatsappPhone ?? '',
    email: record.email ?? '',
    photoUrl: record.photoUrl ?? '',
    nicNo: record.nicNo ?? '',
    speciality: record.speciality ?? '',
    additionalInfo: record.additionalInfo ?? '',
    specialNote: record.specialNote ?? '',
    bankName: record.bankName ?? '',
    bankAccountNo: record.bankAccountNo ?? '',
    bankHolder: record.bankHolder ?? '',
    bankBranch: record.bankBranch ?? '',
    bankCode: record.bankCode ?? '',
    isActive: record.isActive,
  }
}

export default function PartnerDirectory({ kind }: { kind: PartnerKind }) {
  const config = PARTNER_CONFIG[kind]
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()

  const canWrite = WRITE_ROLES.includes(session?.user?.role ?? '')
  const userCountry = session?.user?.country ?? 'ALL'
  const isAllCountry = !userCountry || userCountry === 'ALL'
  const defaultCountry = isAllCountry ? (countryFilter !== 'ALL' ? countryFilter : '') : userCountry

  const [records, setRecords] = useState<PartnerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [enabledCountries, setEnabledCountries] = useState<string[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [editing, setEditing] = useState<PartnerRecord | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState<PartnerFormState>(EMPTY_PARTNER_FORM)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null)
  const [showLinkModal, setShowLinkModal] = useState(false)

  // ── Data ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res = await fetch(`${config.apiBase}?${params}`)
      const json = await res.json()
      if (json.success) setRecords(json.data)
      else toast.error(json.error ?? `Failed to load ${config.labelPlural.toLowerCase()}`)
    } catch {
      toast.error('Network error while loading')
    } finally {
      setLoading(false)
    }
  }, [config.apiBase, config.labelPlural, countryFilter])

  useEffect(() => { void load() }, [load])

  // The registration link is only meaningful for countries Settings has enabled,
  // so the link dialog offers exactly those.
  useEffect(() => {
    fetch('/api/public/partner-settings')
      .then(r => r.json())
      .then(json => setEnabledCountries(json.success ? (json.data[kind] ?? []) : []))
      .catch(() => setEnabledCountries([]))
  }, [kind])

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => records.filter(r => {
    const q = search.trim().toLowerCase()
    if (q) {
      const hit = [r.name, r.phone, r.whatsappPhone, r.email, r.nicNo, r.speciality, r.bankName, r.additionalInfo, r.specialNote]
        .some(v => v?.toLowerCase().includes(q))
      if (!hit) return false
    }
    if (statusFilter === 'active' && !r.isActive) return false
    if (statusFilter === 'inactive' && r.isActive) return false
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false
    return true
  }), [records, search, statusFilter, sourceFilter])

  const stats = useMemo(() => ({
    total: records.length,
    active: records.filter(r => r.isActive).length,
    pending: records.filter(r => !r.isActive && r.source === 'SELF_REGISTERED').length,
    withBank: records.filter(r => r.bankAccountNo).length,
  }), [records])

  const hasFilters = statusFilter !== 'all' || sourceFilter !== 'all'

  // ── Actions ────────────────────────────────────────────────────────────────

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_PARTNER_FORM, country: defaultCountry })
    setErrors({})
    setShowModal(true)
  }

  function openEdit(record: PartnerRecord) {
    setEditing(record)
    setForm(toForm(record))
    setErrors({})
    setShowModal(true)
  }

  async function save() {
    const found = validatePartnerForm(form)
    if (Object.keys(found).length) {
      setErrors(found)
      toast.error('Please fix the highlighted fields')
      return
    }
    setSaving(true)
    try {
      const url = editing ? `${config.apiBase}/${editing.id}` : config.apiBase
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const json = await res.json()
      if (!json.success) { toast.error(json.error ?? 'Save failed'); return }
      toast.success(json.message ?? 'Saved')
      setShowModal(false)
      await load()
    } catch {
      toast.error('Network error while saving')
    } finally {
      setSaving(false)
    }
  }

  /** Activate / deactivate without opening the editor — the common review action. */
  async function toggleActive(record: PartnerRecord) {
    setTogglingId(record.id)
    // Optimistic: the row flips immediately and is rolled back if the call fails.
    setRecords(prev => prev.map(r => r.id === record.id ? { ...r, isActive: !r.isActive } : r))
    try {
      const res = await fetch(`${config.apiBase}/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !record.isActive }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(record.isActive ? `${config.label} deactivated` : `${config.label} activated`)
    } catch (err) {
      setRecords(prev => prev.map(r => r.id === record.id ? { ...r, isActive: record.isActive } : r))
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setTogglingId(null)
    }
  }

  async function remove(record: PartnerRecord) {
    const used = record.assignmentCount
      ? `\n\nThis ${config.label.toLowerCase()} appears on ${record.assignmentCount} movement(s). Those movements keep the name and phone already sent out, but lose the link to this record.`
      : ''
    if (!confirm(`Delete ${record.name}? This cannot be undone.${used}`)) return

    const res = await fetch(`${config.apiBase}/${record.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.success) { toast.success(json.message ?? 'Deleted'); void load() }
    else toast.error(json.error ?? 'Delete failed')
  }

  async function bulkDelete() {
    if (!selectedIds.size) return
    if (!confirm(`Delete ${selectedIds.size} ${config.label.toLowerCase()}(s)? This cannot be undone.`)) return
    setBulkBusy(true)
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(id =>
          fetch(`${config.apiBase}/${id}`, { method: 'DELETE' }).then(r => r.json()).catch(() => ({ success: false }))),
      )
      const failed = results.filter(r => !r.success).length
      if (failed) toast.error(`${failed} deletion(s) failed`)
      else toast.success(`${selectedIds.size} deleted`)
      setSelectedIds(new Set())
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkSetActive(active: boolean) {
    if (!selectedIds.size) return
    setBulkBusy(true)
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(id =>
          fetch(`${config.apiBase}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive: active }),
          }).then(r => r.json()).catch(() => ({ success: false }))),
      )
      const failed = results.filter(r => !r.success).length
      if (failed) toast.error(`${failed} update(s) failed`)
      else toast.success(`${selectedIds.size} ${active ? 'activated' : 'deactivated'}`)
      setSelectedIds(new Set())
      await load()
    } finally {
      setBulkBusy(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(
      selectedIds.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map(r => r.id)),
    )
  }

  /** CSV export — built client-side from what is on screen, filters included. */
  function exportCsv() {
    const headers = ['Name', 'Country', 'Phone', 'WhatsApp', 'Email', 'ID Number', config.specialityLabel, 'Bank', 'Account No', 'Holder', 'Branch', 'Code', 'Status', 'Source', 'Additional Info', 'Special Note']
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = filtered.map(r => [
      r.name, COUNTRY_LABELS[r.country ?? ''] ?? '', r.phone, r.whatsappPhone, r.email,
      r.nicNo, r.speciality, r.bankName, r.bankAccountNo, r.bankHolder, r.bankBranch,
      r.bankCode, r.isActive ? 'Active' : 'Inactive', SOURCE_META[r.source].label,
      r.additionalInfo, r.specialNote,
    ].map(escape).join(','))

    const blob = new Blob([[headers.map(escape).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${config.labelPlural.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('CSV downloaded')
  }

  function copyLink(country: string) {
    const url = `${window.location.origin}${config.registerPath}${country ? `?country=${country}` : ''}`
    navigator.clipboard.writeText(url)
      .then(() => toast.success('Registration link copied!'))
      .catch(() => prompt('Copy this link:', url))
  }

  const formCountry = form.country
  const banks = BANKS_BY_COUNTRY[formCountry]

  const setField = (key: keyof PartnerFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(f => ({ ...f, [key]: e.target.value }))
      setErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev))
    }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      <Header
        title={config.labelPlural}
        subtitle={`Manage ${config.labelPlural.toLowerCase()}, review self-registrations and share the registration link`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportCsv} disabled={!filtered.length} className="btn-secondary btn flex items-center gap-1.5 disabled:opacity-50">
              <FileDown className="w-4 h-4" /> Export
            </button>
            <button onClick={() => setShowLinkModal(true)} className="btn-secondary btn flex items-center gap-1.5">
              <Link2 className="w-4 h-4" /> Registration Link
            </button>
            {canWrite && (
              <button onClick={openAdd} className="btn-primary btn flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Add {config.label}
              </button>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-5">

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: <Users className="w-4 h-4 text-brand-500" />, label: `Total ${config.labelPlural}`, value: stats.total, bg: 'bg-brand-50' },
            { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, label: 'Active', value: stats.active, bg: 'bg-emerald-50' },
            { icon: <AlertCircle className="w-4 h-4 text-violet-500" />, label: 'Awaiting Review', value: stats.pending, bg: 'bg-violet-50' },
            { icon: <Building2 className="w-4 h-4 text-amber-500" />, label: 'With Bank Details', value: stats.withBank, bg: 'bg-amber-50' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl px-4 py-3 flex items-center gap-3 border border-white/60`}>
              {s.icon}
              <div>
                <p className="text-xl font-bold text-slate-800 leading-none">{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Self-registrations waiting for review */}
        {stats.pending > 0 && statusFilter !== 'inactive' && (
          <button
            onClick={() => { setStatusFilter('inactive'); setSourceFilter('SELF_REGISTERED') }}
            className="w-full flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-left hover:bg-violet-100 transition-colors"
          >
            <AlertCircle className="w-4 h-4 text-violet-600 flex-shrink-0" />
            <p className="text-sm text-violet-800">
              <span className="font-semibold">{stats.pending}</span> self-registration{stats.pending !== 1 ? 's' : ''} waiting
              for review — they stay hidden from the movement chart until activated.
            </p>
            <ChevronRight className="w-4 h-4 text-violet-500 ml-auto flex-shrink-0" />
          </button>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[220px] max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search name, phone, email, ID, ${config.specialityLabel.toLowerCase()}…`}
              className="form-input pl-9 pr-10"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Status</label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {([['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] as [StatusFilter, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-3 py-2 text-xs font-semibold transition-all ${statusFilter === val ? 'bg-brand-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Source</label>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as SourceFilter)}
              className={`form-select text-sm py-2 pr-8 ${sourceFilter !== 'all' ? 'border-brand-400 ring-1 ring-brand-300' : ''}`}>
              <option value="all">All sources</option>
              <option value="STAFF">Added by staff</option>
              <option value="SELF_REGISTERED">Self-registered</option>
              <option value="MANUAL_ENTRY">From movement chart</option>
            </select>
          </div>

          {hasFilters && (
            <button type="button" onClick={() => { setStatusFilter('all'); setSourceFilter('all') }}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-500 px-3 py-2 rounded-lg border border-slate-200 hover:border-red-200 hover:bg-red-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Clear Filters
            </button>
          )}
        </div>

        {/* Bulk bar */}
        {canWrite && selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
            <span className="text-sm font-semibold text-brand-800">{selectedIds.size} selected</span>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={() => bulkSetActive(true)} disabled={bulkBusy} className="btn-secondary btn btn-sm flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Activate
              </button>
              <button onClick={() => bulkSetActive(false)} disabled={bulkBusy} className="btn-secondary btn btn-sm flex items-center gap-1.5">
                <Power className="w-3.5 h-3.5" /> Deactivate
              </button>
              <button onClick={bulkDelete} disabled={bulkBusy}
                className="btn btn-sm flex items-center gap-1.5 bg-red-500 text-white hover:bg-red-600">
                {bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Delete
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="btn-ghost btn btn-sm">Clear</button>
            </div>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 text-brand-500 animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            {kind === 'guide'
              ? <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              : <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />}
            <p className="text-slate-500 font-medium">
              {search || hasFilters
                ? `No ${config.labelPlural.toLowerCase()} match the current search / filters`
                : `No ${config.labelPlural.toLowerCase()} yet`}
            </p>
            {!search && !hasFilters && (
              <p className="text-slate-400 text-sm mt-1">
                Add one directly, or share the registration link so they can register themselves.
              </p>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {canWrite && (
              <div className="flex items-center gap-3 px-1">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filtered.length && filtered.length > 0}
                  ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 cursor-pointer"
                />
                <span className="text-xs text-slate-500">
                  {selectedIds.size > 0 ? `${selectedIds.size} of ${filtered.length} selected` : `Select all (${filtered.length})`}
                </span>
              </div>
            )}

            {filtered.map(record => {
              const isExpanded = expandedId === record.id
              const isSelected = selectedIds.has(record.id)
              return (
                <Card key={record.id} className={`overflow-hidden transition-all ${isExpanded ? 'ring-2 ring-brand-500/20' : ''} ${isSelected ? 'ring-2 ring-brand-400 bg-brand-50/30' : ''}`}>
                  <div className="p-5 flex items-center gap-4">
                    {canWrite && (
                      <input
                        type="checkbox" checked={isSelected}
                        onChange={() => toggleSelect(record.id)} onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 cursor-pointer flex-shrink-0"
                      />
                    )}

                    {/* Avatar */}
                    <div
                      className={`w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 ${config.accent.bg} flex items-center justify-center ${record.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-brand-400' : ''}`}
                      onClick={() => record.photoUrl && setLightbox({ url: record.photoUrl, label: record.name })}
                    >
                      {record.photoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={record.photoUrl} alt={record.name} className="w-full h-full object-cover" />
                        : kind === 'guide'
                          ? <User className={`w-6 h-6 ${config.accent.text}`} />
                          : <Building2 className={`w-6 h-6 ${config.accent.text}`} />}
                    </div>

                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900 truncate">{record.name}</p>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${record.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {record.isActive ? 'Active' : 'Inactive'}
                          </span>
                          {record.country && (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${COUNTRY_BADGE[record.country] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                              <CountryFlag country={record.country} className="w-4 h-3" />
                              {COUNTRY_LABELS[record.country] ?? record.country}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500"><Phone className="w-3 h-3" /> {record.phone}</div>
                        {record.email && <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400 truncate"><Mail className="w-3 h-3 flex-shrink-0" /> {record.email}</div>}
                      </div>

                      <div className="min-w-0">
                        {record.speciality && (
                          <>
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{config.specialityLabel}</p>
                            <p className="text-sm text-slate-700 line-clamp-2">{record.speciality}</p>
                          </>
                        )}
                        {record.nicNo && (
                          <p className="text-xs text-slate-400 mt-1 font-mono">{record.nicNo}</p>
                        )}
                      </div>

                      <div className="min-w-0">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${SOURCE_META[record.source].className}`}>
                          {SOURCE_META[record.source].label}
                        </span>
                        {record.bankName && (
                          <p className="text-xs text-slate-400 mt-1.5">{record.bankName} · ****{record.bankAccountNo?.slice(-4)}</p>
                        )}
                        {!!record.assignmentCount && (
                          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                            <ClipboardList className="w-3 h-3" /> {record.assignmentCount} movement{record.assignmentCount !== 1 ? 's' : ''}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {canWrite && (
                        <button
                          onClick={() => toggleActive(record)} disabled={togglingId === record.id}
                          title={record.isActive ? 'Deactivate' : 'Activate'}
                          className={`btn-ghost btn btn-sm ${record.isActive ? 'text-slate-400 hover:text-amber-600' : 'text-emerald-500 hover:bg-emerald-50'}`}
                        >
                          {togglingId === record.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                        </button>
                      )}
                      {canWrite && (
                        <button onClick={() => openEdit(record)} title="Edit" className="btn-ghost btn btn-sm"><Edit2 className="w-4 h-4" /></button>
                      )}
                      {canWrite && (
                        <button onClick={() => remove(record)} title="Delete" className="btn-ghost btn btn-sm text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                      )}
                      <button onClick={() => setExpandedId(isExpanded ? null : record.id)} title="Details" className="btn-ghost btn btn-sm">
                        {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <User className="w-4 h-4 text-brand-500" /> Contact
                        </h4>
                        <dl className="space-y-2 text-sm">
                          {[
                            ['Phone', record.phone],
                            ['WhatsApp', record.whatsappPhone],
                            ['Email', record.email],
                            [NIC_LABELS[record.country ?? ''] ?? 'ID Number', record.nicNo],
                            [config.specialityLabel, record.speciality],
                          ].filter(([, v]) => v).map(([k, v]) => (
                            <div key={k as string} className="flex gap-2">
                              <dt className="text-slate-400 w-28 flex-shrink-0">{k}</dt>
                              <dd className="font-medium text-slate-700 break-all">{v}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-brand-500" /> Bank Account
                        </h4>
                        {record.bankAccountNo || record.bankName ? (
                          <dl className="space-y-2 text-sm">
                            {[
                              ['Bank', record.bankName], ['Account No.', record.bankAccountNo],
                              ['Holder', record.bankHolder], ['Branch', record.bankBranch], ['Code', record.bankCode],
                            ].filter(([, v]) => v).map(([k, v]) => (
                              <div key={k as string} className="flex gap-2">
                                <dt className="text-slate-400 w-24 flex-shrink-0">{k}</dt>
                                <dd className="font-medium text-slate-700 font-mono break-all">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : <p className="text-sm text-slate-400">No bank details</p>}
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                          <StickyNote className="w-4 h-4 text-amber-500" /> Notes
                        </h4>
                        {record.additionalInfo && (
                          <div className="mb-3">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Additional</p>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{record.additionalInfo}</p>
                          </div>
                        )}
                        {record.specialNote && (
                          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
                            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Special Note</p>
                            <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{record.specialNote}</p>
                          </div>
                        )}
                        {!record.additionalInfo && !record.specialNote && <p className="text-sm text-slate-400">No notes</p>}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add / edit modal ─────────────────────────────────────────────── */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        size="2xl"
        title={editing ? `Edit ${config.label}` : `Add ${config.label}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setShowModal(false)} className="btn-secondary btn">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary btn flex items-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {editing ? 'Save Changes' : `Add ${config.label}`}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Photo + identity */}
          <div className="flex gap-5">
            <div className="w-32 flex-shrink-0">
              <p className="text-xs font-medium text-slate-600 mb-2 flex items-center gap-1.5"><Camera className="w-3.5 h-3.5" /> Photo</p>
              <PhotoUpload
                value={form.photoUrl}
                onChange={url => setForm(f => ({ ...f, photoUrl: url }))}
                endpoint="/api/upload/photo"
                onError={msg => toast.error(msg)}
                label="Upload"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field label={kind === 'guide' ? 'Full Name' : 'Business / Vendor Name'} required error={errors.name}>
                <input value={form.name} onChange={setField('name')} className={inputClass(errors.name)}
                  placeholder={kind === 'guide' ? 'e.g. Kasun Perera' : 'e.g. Lanka Adventure Tours'} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Country" error={errors.country}
                  hint={isAllCountry ? undefined : 'Fixed to your assigned country'}>
                  <select
                    value={form.country} onChange={setField('country')}
                    disabled={!isAllCountry}
                    className={inputClass(errors.country, !isAllCountry ? 'bg-slate-50 text-slate-500' : '')}
                  >
                    <option value="">Any country</option>
                    {PARTNER_COUNTRIES.map(c => (
                      <option key={c} value={c}>{COUNTRY_FLAGS[c]} {COUNTRY_LABELS[c]}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={form.isActive ? 'active' : 'inactive'}
                    onChange={e => setForm(f => ({ ...f, isActive: e.target.value === 'active' }))}
                    className={inputClass()}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </Field>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Phone Number" required error={errors.phone}>
              <input type="tel" value={form.phone} onChange={setField('phone')}
                placeholder={PHONE_PLACEHOLDERS[formCountry] ?? '+94 77 123 4567'}
                className={inputClass(errors.phone)} />
            </Field>
            <Field label="WhatsApp Number" error={errors.whatsappPhone} hint="Blank = same as phone">
              <input type="tel" value={form.whatsappPhone} onChange={setField('whatsappPhone')}
                placeholder={PHONE_PLACEHOLDERS[formCountry] ?? '+94 77 123 4567'}
                className={inputClass(errors.whatsappPhone)} />
            </Field>
            <Field label="Email" error={errors.email}>
              <input type="email" value={form.email} onChange={setField('email')}
                placeholder="name@email.com" className={inputClass(errors.email)} />
            </Field>
            <Field label={NIC_LABELS[formCountry] ?? 'NIC / ID Number'} error={errors.nicNo}>
              <input value={form.nicNo} onChange={setField('nicNo')} placeholder="ID number" className={inputClass(errors.nicNo)} />
            </Field>
            <Field label={config.specialityLabel} className="sm:col-span-2">
              <input value={form.speciality} onChange={setField('speciality')}
                placeholder={config.specialityPlaceholder} className={inputClass()} />
            </Field>
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Additional Information">
              <textarea value={form.additionalInfo} onChange={setField('additionalInfo')} rows={3}
                placeholder="Address, experience, working areas…" className={inputClass(undefined, 'resize-y')} />
            </Field>
            <Field label="Special Note">
              <textarea value={form.specialNote} onChange={setField('specialNote')} rows={3}
                placeholder="Availability limits, preferred regions…" className={inputClass(undefined, 'resize-y')} />
            </Field>
          </div>

          {/* Bank */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-emerald-500" /> Bank Account Details
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Bank Name">
                {banks ? (
                  <select value={form.bankName} onChange={setField('bankName')} className={inputClass()}>
                    <option value="">Select bank…</option>
                    {banks.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                ) : (
                  <input value={form.bankName} onChange={setField('bankName')} placeholder="Bank name" className={inputClass()} />
                )}
              </Field>
              <Field label="Account Number" error={errors.bankAccountNo}>
                <input value={form.bankAccountNo} onChange={setField('bankAccountNo')} inputMode="numeric"
                  placeholder="0123456789" className={inputClass(errors.bankAccountNo)} />
              </Field>
              <Field label="Account Holder" error={errors.bankHolder}>
                <input value={form.bankHolder} onChange={setField('bankHolder')}
                  placeholder={HOLDER_PLACEHOLDERS[formCountry] ?? 'FULL NAME AS ON ACCOUNT'}
                  className={inputClass(errors.bankHolder, 'uppercase')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Branch" error={errors.bankBranch}>
                  <input value={form.bankBranch} onChange={setField('bankBranch')}
                    placeholder={BRANCH_PLACEHOLDERS[formCountry] ?? 'Branch'} className={inputClass(errors.bankBranch)} />
                </Field>
                <Field label="SWIFT / Code" error={errors.bankCode}>
                  <input value={form.bankCode} onChange={setField('bankCode')}
                    placeholder={SWIFT_PLACEHOLDERS[formCountry] ?? 'SWIFT'} className={inputClass(errors.bankCode)} />
                </Field>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── Registration link modal ──────────────────────────────────────── */}
      <Modal open={showLinkModal} onClose={() => setShowLinkModal(false)} size="lg" title={`${config.label} Registration Link`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500 leading-relaxed">
            Share this link over WhatsApp so a {config.label.toLowerCase()} can register themselves.
            Submissions arrive <strong>inactive</strong> and appear here for review before they can be
            used on a movement chart.
          </p>

          {enabledCountries.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                No country requires {config.labelPlural.toLowerCase()} yet, so the link will not accept
                registrations. Switch countries on in <strong>Settings → Guides &amp; Tour Vendors</strong> first.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {enabledCountries.map(c => (
                <div key={c} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="text-lg">{COUNTRY_FLAGS[c]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{COUNTRY_LABELS[c]}</p>
                    <p className="text-[11px] text-slate-400 font-mono truncate">
                      {config.registerPath}?country={c}
                    </p>
                  </div>
                  <button onClick={() => copyLink(c)} className="btn-secondary btn btn-sm flex items-center gap-1.5 flex-shrink-0">
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 px-3 py-2.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700">Generic link</p>
                  <p className="text-[11px] text-slate-400">The {config.label.toLowerCase()} picks their own country</p>
                </div>
                <button onClick={() => copyLink('')} className="btn-ghost btn btn-sm flex items-center gap-1.5 flex-shrink-0">
                  <Copy className="w-3.5 h-3.5" /> Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Photo lightbox ───────────────────────────────────────────────── */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-6" onClick={() => setLightbox(null)}>
          <div className="max-w-lg w-full text-center" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.label} className="w-full rounded-2xl shadow-2xl object-contain max-h-[75vh]" />
            <p className="text-white/80 text-sm mt-3">{lightbox.label}</p>
            <button onClick={() => setLightbox(null)} className="mt-3 text-white/60 hover:text-white text-xs inline-flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
