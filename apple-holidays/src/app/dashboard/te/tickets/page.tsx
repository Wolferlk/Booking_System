'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Plus, Loader2, Search, Ticket as TicketIcon, Hotel, Anchor, Activity,
  MapPin, Plane, ShoppingCart, CheckCircle2, AlertCircle, Zap, Upload,
  Eye, ExternalLink, FileText, Image as ImageIcon, Pencil, X, Printer,
  Filter,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

// ─── types ───────────────────────────────────────────────────────────────────

interface Ticket {
  id: string
  type: string
  qty: number
  supplier: string | null
  costPerUnit: string | null
  totalCost: string | null
  currency: string
  status: string
  activated: boolean
  purchasedAt: string | null
  reference: string | null
  notes: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  booking: { bookingRef: string; arrivalDate: string; agent: string | null } | null
  pnlLine: {
    activity: string
    paymentStatus: string
    paymentRefNumber: string | null
    category: string
  } | null
  agendaItem: { date: string; location: string } | null
}

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  HOTEL: Hotel, TICKETS: TicketIcon, CRUISE: Anchor,
  WATER: Activity, GUIDES: MapPin, FLIGHT_TICKETS: Plane,
}

const CATEGORY_COLOR: Record<string, string> = {
  HOTEL:          'bg-blue-100 text-blue-700',
  TICKETS:        'bg-purple-100 text-purple-700',
  CRUISE:         'bg-cyan-100 text-cyan-700',
  WATER:          'bg-teal-100 text-teal-700',
  GUIDES:         'bg-green-100 text-green-700',
  FLIGHT_TICKETS: 'bg-indigo-100 text-indigo-700',
  TRANSPORT:      'bg-orange-100 text-orange-700',
  MEALS:          'bg-amber-100 text-amber-700',
  OTHER:          'bg-slate-100 text-slate-600',
}

const CATEGORY_LABEL: Record<string, string> = {
  HOTEL: 'Hotel Voucher', TICKETS: 'Entrance Ticket', CRUISE: 'Cruise Ticket',
  WATER: 'Water Activity', GUIDES: 'Guide Voucher', FLIGHT_TICKETS: 'Flight Ticket',
  TRANSPORT: 'Transfer Voucher', MEALS: 'Meal Voucher', OTHER: 'Service Voucher',
}

const ALL_CATEGORIES = ['HOTEL','TICKETS','CRUISE','WATER','GUIDES','FLIGHT_TICKETS','TRANSPORT','MEALS','OTHER']

type TabFilter = 'all' | 'pending_activation' | 'active' | 'purchased'

function CategoryIcon({ cat, className = 'w-4 h-4' }: { cat: string; className?: string }) {
  const Icon = CATEGORY_ICON[cat] ?? TicketIcon
  return <Icon className={className} />
}

// ─── main component ───────────────────────────────────────────────────────────

export default function TETicketsPage() {
  const { data: session } = useSession()
  const { countryFilter } = useCountryFilter()
  const role = session?.user?.role as UserRole
  const canEdit     = ['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canCreate   = ['GT_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canPurchase = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canUpload   = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  const [tickets, setTickets]         = useState<Ticket[]>([])
  const [loading, setLoading]         = useState(true)
  const [search, setSearch]           = useState('')
  const [tab, setTab]                 = useState<TabFilter>('all')
  const [catFilter, setCatFilter]     = useState('')

  // modals
  const [newModal, setNewModal]       = useState(false)
  const [editModal, setEditModal]     = useState<Ticket | null>(null)
  const [activateModal, setActivateModal] = useState<Ticket | null>(null)
  const [purchaseModal, setPurchaseModal] = useState<Ticket | null>(null)
  const [viewFile, setViewFile]       = useState<Ticket | null>(null)

  // form states
  const [newForm, setNewForm]         = useState({ bookingRef: '', type: '', supplier: '', qty: '1', costPerUnit: '', currency: 'USD', notes: '' })
  const [editForm, setEditForm]       = useState({ type: '', supplier: '', qty: '', costPerUnit: '', reference: '', notes: '' })
  const [activateForm, setActivateForm] = useState({ reference: '', supplier: '', notes: '' })
  const [purchaseRef, setPurchaseRef] = useState('')
  const [saving, setSaving]           = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
      const res  = await fetch(`/api/tickets?${params}`)
      const json = await res.json()
      if (json.success) setTickets(json.data)
    } finally { setLoading(false) }
  }, [countryFilter])

  useEffect(() => { load() }, [load])

  // ── derived filtered list ─────────────────────────────────────────────────

  const filtered = tickets.filter(t => {
    const q = search.toLowerCase()
    const matchSearch = !q || [
      t.type, t.supplier, t.booking?.bookingRef, t.booking?.agent, t.reference,
    ].some(v => v?.toLowerCase().includes(q))

    const matchTab =
      tab === 'all'               ? true :
      tab === 'pending_activation'? !t.activated :
      tab === 'active'            ? t.activated && t.status === 'DRAFT' :
      tab === 'purchased'         ? t.status === 'PURCHASED' || t.status === 'PAID' : true

    const cat = t.pnlLine?.category ?? 'OTHER'
    const matchCat = !catFilter || cat === catFilter

    return matchSearch && matchTab && matchCat
  })

  // stats
  const totalAll     = tickets.length
  const totalPending = tickets.filter(t => !t.activated).length
  const totalActive  = tickets.filter(t => t.activated && t.status === 'DRAFT').length
  const totalPurchased = tickets.filter(t => t.status === 'PURCHASED' || t.status === 'PAID').length

  // ── actions ───────────────────────────────────────────────────────────────

  async function createTicket() {
    setSaving(true)
    try {
      const res  = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, qty: Number(newForm.qty), costPerUnit: Number(newForm.costPerUnit) || null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket created')
      setNewModal(false)
      setNewForm({ bookingRef: '', type: '', supplier: '', qty: '1', costPerUnit: '', currency: 'USD', notes: '' })
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  function openEdit(t: Ticket) {
    setEditForm({
      type: t.type,
      supplier: t.supplier ?? '',
      qty: String(t.qty),
      costPerUnit: t.costPerUnit ?? '',
      reference: t.reference ?? '',
      notes: t.notes ?? '',
    })
    setEditModal(t)
  }

  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    try {
      const res  = await fetch(`/api/tickets/${editModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editForm.type,
          supplier: editForm.supplier,
          qty: Number(editForm.qty),
          costPerUnit: editForm.costPerUnit ? Number(editForm.costPerUnit) : null,
          reference: editForm.reference,
          notes: editForm.notes,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket updated')
      setEditModal(null)
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function activateTicket() {
    if (!activateModal) return
    setSaving(true)
    try {
      const res  = await fetch(`/api/tickets/${activateModal.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activateForm),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket activated')
      setActivateModal(null)
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setSaving(false) }
  }

  async function purchaseTicket() {
    if (!purchaseModal) return
    setSaving(true)
    try {
      const res  = await fetch(`/api/tickets/${purchaseModal.id}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: purchaseRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket purchased')
      setPurchaseModal(null); setPurchaseRef('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Payment not confirmed by Accounts (G2)')
    }
    finally { setSaving(false) }
  }

  async function uploadFile(ticketId: string, file: File) {
    setUploadingId(ticketId)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch(`/api/tickets/${ticketId}/upload`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Receipt uploaded')
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Upload failed') }
    finally { setUploadingId(null) }
  }

  function triggerUpload(ticketId: string) {
    if (!fileInputRef.current) return
    fileInputRef.current.dataset.ticketId = ticketId
    fileInputRef.current.click()
  }

  // ─── render ───────────────────────────────────────────────────────────────

  const TABS: { value: TabFilter; label: string; count: number }[] = [
    { value: 'all',               label: 'All',               count: totalAll },
    { value: 'pending_activation',label: 'Pending Activation', count: totalPending },
    { value: 'active',            label: 'Active',             count: totalActive },
    { value: 'purchased',         label: 'Purchased',          count: totalPurchased },
  ]

  return (
    <div>
      <Header
        title="Tickets & Vouchers"
        subtitle={`${totalAll} total · ${totalPurchased} purchased · ${totalPending} pending activation`}
        actions={
          canCreate ? (
            <button onClick={() => setNewModal(true)} className="btn btn-primary">
              <Plus className="w-4 h-4" /> Add Ticket
            </button>
          ) : undefined
        }
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          const id   = e.target.dataset.ticketId
          if (file && id) uploadFile(id, file)
          e.target.value = ''
        }}
      />

      <div className="p-8 space-y-5">

        {/* Filter bar */}
        <Card className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by type, supplier, booking ref, agent…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="form-input pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 shrink-0" />
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                className="form-select w-full sm:w-48"
              >
                <option value="">All categories</option>
                {ALL_CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {TABS.map(t => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  tab === t.value
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  tab === t.value ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* Tickets list */}
        {loading ? (
          <div className="flex justify-center h-48 items-center">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center">
            <TicketIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No tickets match your filters</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(t => {
              const cat   = t.pnlLine?.category ?? 'OTHER'
              const payOk = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
              const isActive   = t.activated
              const isPurchased = t.status === 'PURCHASED' || t.status === 'PAID'

              return (
                <Card key={t.id} className={`p-4 ${!isActive ? 'border-amber-200 bg-amber-50' : ''}`}>
                  <div className="flex items-start gap-4">

                    {/* Category icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${CATEGORY_COLOR[cat] ?? 'bg-slate-100 text-slate-500'}`}>
                      <CategoryIcon cat={cat} className="w-5 h-5" />
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-slate-900 text-sm">{t.type}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${CATEGORY_COLOR[cat]}`}>
                          {cat.replace('_', ' ')}
                        </span>
                        {/* Status badge */}
                        {!isActive ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            Pending Activation
                          </span>
                        ) : isPurchased ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                            {t.status}
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                            Active
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                        {t.booking && (
                          <Link
                            href={`/dashboard/bookings/${t.booking.bookingRef}/tickets`}
                            onClick={e => e.stopPropagation()}
                            className="text-xs font-mono text-brand-600 hover:underline"
                          >
                            {t.booking.bookingRef}
                          </Link>
                        )}
                        {t.booking?.agent && (
                          <span className="text-xs text-slate-500">{t.booking.agent}</span>
                        )}
                        {t.booking?.arrivalDate && (
                          <span className="text-xs text-slate-400">Arrival: {formatDate(t.booking.arrivalDate)}</span>
                        )}
                        {t.supplier && (
                          <span className="text-xs text-slate-500">Supplier: {t.supplier}</span>
                        )}
                        {t.reference && (
                          <span className="text-xs font-mono text-slate-500">Ref: {t.reference}</span>
                        )}
                        {t.agendaItem && (
                          <span className="text-xs text-slate-400">{formatDate(t.agendaItem.date)} · {t.agendaItem.location}</span>
                        )}
                      </div>

                      {/* P&L payment row */}
                      {t.pnlLine && (
                        <div className="flex items-center gap-1 mt-1">
                          {payOk
                            ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            : <AlertCircle  className="w-3 h-3 text-amber-500" />}
                          <span className={`text-[11px] font-medium ${payOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                            Payment {t.pnlLine.paymentStatus}
                            {t.pnlLine.paymentRefNumber && ` · #${t.pnlLine.paymentRefNumber}`}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Pricing */}
                    <div className="hidden sm:block text-right shrink-0 min-w-[90px]">
                      <p className="text-xs text-slate-400">Qty × Cost</p>
                      <p className="text-sm font-medium text-slate-700">
                        {t.qty} × {t.costPerUnit ? formatCurrency(t.costPerUnit) : '—'}
                      </p>
                      {t.totalCost && (
                        <p className="text-sm font-bold text-slate-900">{formatCurrency(t.totalCost)}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                      {/* Activate */}
                      {!isActive && canEdit && (
                        <button
                          onClick={() => { setActivateForm({ reference: t.reference ?? '', supplier: t.supplier ?? '', notes: t.notes ?? '' }); setActivateModal(t) }}
                          className="btn btn-primary btn-sm text-xs"
                        >
                          <Zap className="w-3.5 h-3.5" /> Activate
                        </button>
                      )}

                      {/* Purchase */}
                      {isActive && !isPurchased && canPurchase && (
                        <button
                          onClick={() => setPurchaseModal(t)}
                          disabled={!payOk}
                          title={!payOk ? 'Payment not yet confirmed (G2)' : 'Purchase ticket'}
                          className={`btn btn-sm text-xs ${payOk ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
                        >
                          <ShoppingCart className="w-3.5 h-3.5" /> Purchase
                        </button>
                      )}

                      {/* View / upload receipt */}
                      {t.fileUrl ? (
                        <button onClick={() => setViewFile(t)} className="btn btn-secondary btn-sm text-xs">
                          <Eye className="w-3.5 h-3.5" /> Receipt
                        </button>
                      ) : isActive && canUpload ? (
                        <button
                          onClick={() => triggerUpload(t.id)}
                          disabled={uploadingId === t.id}
                          className="btn btn-secondary btn-sm text-xs"
                        >
                          {uploadingId === t.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Upload className="w-3.5 h-3.5" />}
                          Upload
                        </button>
                      ) : null}

                      {/* Print voucher */}
                      {isActive && t.booking && (
                        <Link
                          href={`/print/tickets/${t.booking.bookingRef}`}
                          target="_blank"
                          onClick={e => e.stopPropagation()}
                          className="btn btn-secondary btn-sm text-xs"
                          title="Print vouchers for this booking"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </Link>
                      )}

                      {/* Edit */}
                      {canEdit && (
                        <button onClick={() => openEdit(t)} className="btn btn-secondary btn-sm text-xs">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Add Ticket Modal ─────────────────────────────────────────────── */}
      <Modal
        open={newModal}
        onClose={() => setNewModal(false)}
        title="Add Ticket / Voucher"
        footer={
          <>
            <button onClick={() => setNewModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={createTicket} disabled={saving || !newForm.bookingRef || !newForm.type} className="btn btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Ticket
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Booking Reference *</label>
            <input
              className="form-input font-mono"
              placeholder="e.g. VN19730"
              value={newForm.bookingRef}
              onChange={e => setNewForm(f => ({ ...f, bookingRef: e.target.value.toUpperCase() }))}
            />
          </div>
          <div>
            <label className="form-label">Activity / Ticket Type *</label>
            <input
              className="form-input"
              placeholder="e.g. Ha Long Bay Cruise, Ba Na Hills Entrance"
              value={newForm.type}
              onChange={e => setNewForm(f => ({ ...f, type: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Supplier</label>
            <input
              className="form-input"
              placeholder="e.g. Heritage Cruises, Vietnam Airlines"
              value={newForm.supplier}
              onChange={e => setNewForm(f => ({ ...f, supplier: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Quantity</label>
              <input type="number" className="form-input" min="1" value={newForm.qty}
                onChange={e => setNewForm(f => ({ ...f, qty: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Cost Per Unit</label>
              <input type="number" className="form-input" placeholder="0.00" min="0" step="0.01"
                value={newForm.costPerUnit}
                onChange={e => setNewForm(f => ({ ...f, costPerUnit: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={newForm.notes}
              onChange={e => setNewForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── Edit Ticket Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        title={`Edit — ${editModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setEditModal(null)} className="btn btn-secondary">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="btn btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
              Save Changes
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="form-label">Activity / Ticket Type</label>
            <input className="form-input" value={editForm.type}
              onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Supplier</label>
            <input className="form-input" placeholder="Supplier / provider name"
              value={editForm.supplier}
              onChange={e => setEditForm(f => ({ ...f, supplier: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Quantity</label>
              <input type="number" className="form-input" min="1" value={editForm.qty}
                onChange={e => setEditForm(f => ({ ...f, qty: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Cost Per Unit</label>
              <input type="number" className="form-input" placeholder="0.00" min="0" step="0.01"
                value={editForm.costPerUnit}
                onChange={e => setEditForm(f => ({ ...f, costPerUnit: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="form-label">Reference / Confirmation No.</label>
            <input className="form-input font-mono" placeholder="TKT-2026-001"
              value={editForm.reference}
              onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── Activate Modal ────────────────────────────────────────────────── */}
      <Modal
        open={!!activateModal}
        onClose={() => setActivateModal(null)}
        title={`Activate — ${activateModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setActivateModal(null)} className="btn btn-secondary">Cancel</button>
            <button onClick={activateTicket} disabled={saving} className="btn btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Activate Ticket
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-sm text-teal-700">
            Once activated, this ticket becomes visible to the client in their portal.
          </div>
          <div>
            <label className="form-label">Reference / Confirmation Number</label>
            <input className="form-input font-mono" placeholder="TKT-2026-001"
              value={activateForm.reference}
              onChange={e => setActivateForm(f => ({ ...f, reference: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Supplier / Provider</label>
            <input className="form-input" placeholder="e.g. Heritage Cruises"
              value={activateForm.supplier}
              onChange={e => setActivateForm(f => ({ ...f, supplier: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-textarea" rows={2}
              value={activateForm.notes}
              onChange={e => setActivateForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── Purchase Modal ────────────────────────────────────────────────── */}
      <Modal
        open={!!purchaseModal}
        onClose={() => setPurchaseModal(null)}
        title={`Purchase — ${purchaseModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setPurchaseModal(null)} className="btn btn-secondary">Cancel</button>
            <button onClick={purchaseTicket} disabled={saving} className="btn btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Confirm Purchase
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-700">
            P&L payment is confirmed — you can proceed to purchase this ticket.
          </div>
          <div>
            <label className="form-label">Voucher / Reference Number (optional)</label>
            <input className="form-input font-mono" placeholder="TKT-2026-001"
              value={purchaseRef}
              onChange={e => setPurchaseRef(e.target.value)} />
          </div>
        </div>
      </Modal>

      {/* ── View Receipt Modal ────────────────────────────────────────────── */}
      {viewFile && (
        <Modal open onClose={() => setViewFile(null)} title={`Receipt — ${viewFile.type}`} size="lg">
          <div className="flex flex-col items-center gap-4">
            {viewFile.fileName && <p className="text-sm text-slate-500 font-mono">{viewFile.fileName}</p>}
            {viewFile.fileType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewFile.fileUrl!} alt="Receipt" className="max-w-full max-h-[60vh] rounded-lg border border-slate-200 object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <FileText className="w-16 h-16 text-slate-300" />
                <p className="text-slate-500">PDF receipt</p>
                <a href={viewFile.fileUrl!} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <ExternalLink className="w-4 h-4" /> Open PDF
                </a>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
