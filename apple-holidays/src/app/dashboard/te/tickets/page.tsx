'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Plus, Loader2, Search, Ticket as TicketIcon, Hotel, Anchor, Activity,
  MapPin, Plane, ShoppingCart, CheckCircle2, AlertCircle, Zap, Upload,
  Eye, ExternalLink, FileText, Image as ImageIcon, Pencil, X, Printer,
  BarChart3, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import { normalizeUploadUrl } from '@/lib/upload-path'
import TicketFilterBar, {
  EMPTY_FILTERS, filtersToParams, countActiveFilters,
  type TicketFilterState, type TicketTab,
} from '@/components/tickets/ticket-filter-bar'
import TicketReportModal from '@/components/tickets/ticket-report-modal'
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
  category: string | null
  purchasedAt: string | null
  reference: string | null
  notes: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  // The portal this was bought through — Accounts pays whoever is named here.
  portalName: string | null
  portalRef: string | null
  // How far the Accounts approval has got. MY/SG/VN cannot buy an attraction
  // ticket until this reads "paid"; the request itself is raised from the
  // booking's own tickets page. Null = never submitted.
  approvalStatus: string | null
  approvalUrgency: string | null
  approvalNote: string | null
  booking: {
    bookingRef: string
    arrivalDate: string
    agent: string | null
    createdAt: string
    operationCountry: string | null
  } | null
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

/**
 * How many rows one request brings back. The list is filtered and paged in SQL
 * now — this page used to read every ticket in the country (tens of thousands,
 * each with its booking and P&L line) into the browser on every visit.
 */
const PAGE_SIZE = 50

/** Server-side counts for the tabs, measured against every other filter. */
interface TicketStats {
  all: number
  pendingActivation: number
  active: number
  purchased: number
  issued: number
  notIssued: number
  awaitingApproval: number
  totalCost: number
  totalQty: number
}

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
  const [filters, setFilters]         = useState<TicketFilterState>(EMPTY_FILTERS)
  const [page, setPage]               = useState(1)
  const [total, setTotal]             = useState(0)
  const [pageCount, setPageCount]     = useState(1)
  const [stats, setStats]             = useState<TicketStats | null>(null)
  const [reportOpen, setReportOpen]   = useState(false)

  /**
   * The search box types a character at a time and every keystroke would
   * otherwise be a query against the whole ticket table. The box stays
   * responsive and the request waits for a pause.
   */
  const [debouncedQ, setDebouncedQ]   = useState('')

  // modals
  const [newModal, setNewModal]       = useState(false)
  const [editModal, setEditModal]     = useState<Ticket | null>(null)
  const [activateModal, setActivateModal] = useState<Ticket | null>(null)
  const [purchaseModal, setPurchaseModal] = useState<Ticket | null>(null)
  const [viewFile, setViewFile]       = useState<Ticket | null>(null)
  const [previewError, setPreviewError] = useState(false)

  // form states
  const [newForm, setNewForm]         = useState({ bookingRef: '', type: '', supplier: '', qty: '1', costPerUnit: '', currency: 'USD', notes: '' })
  const [editForm, setEditForm]       = useState({ type: '', supplier: '', qty: '', costPerUnit: '', reference: '', notes: '' })
  const [activateForm, setActivateForm] = useState({ reference: '', supplier: '', notes: '' })
  const [purchaseRef, setPurchaseRef] = useState('')
  const [saving, setSaving]           = useState(false)
  const [uploadingId, setUploadingId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Direct ticket issuing — the same switch the booking's own tickets page
   * reads. Both Accounts gates (the P&L payment and the approval queue) stand
   * down while it is on, and this screen has to agree with that one or the
   * Purchase button means different things depending on where you clicked it.
   *
   * Starts false and only relaxes once the answer is back, so a slow read
   * leaves the page as strict as it has always been.
   */
  const [directIssue, setDirectIssue] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch('/api/settings/ticket-direct-issue')
      .then(r => r.json())
      .then(json => { if (!cancelled && json.success) setDirectIssue(Boolean(json.data?.directIssue)) })
      .catch(() => { /* silent — the strict default already holds, and the server re-checks */ })

    return () => { cancelled = true }
  }, [])

  // The filter the server is actually asked for: everything on screen, with the
  // search box held back until typing stops.
  const effectiveFilters = useMemo<TicketFilterState>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  )

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(filters.q.trim()), 350)
    return () => clearTimeout(id)
  }, [filters.q])

  const queryParams = useMemo(
    () => filtersToParams(effectiveFilters, countryFilter),
    [effectiveFilters, countryFilter],
  )

  // Changing what is being asked for always returns to the first page —
  // staying on page 7 of a list that now has two pages shows nothing.
  const filterKey = queryParams.toString()
  useEffect(() => { setPage(1) }, [filterKey])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams(filterKey)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      params.set('stats', '1')

      const res  = await fetch(`/api/tickets?${params}`)
      const json = await res.json()
      if (json.success) {
        setTickets(json.data)
        setTotal(json.meta?.total ?? json.data.length)
        setPageCount(json.meta?.pageCount ?? 1)
        if (json.meta?.stats) setStats(json.meta.stats)
      } else {
        toast.error(json.error ?? 'Could not load tickets')
      }
    } catch {
      toast.error('Could not reach the server')
    } finally { setLoading(false) }
  }, [filterKey, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPreviewError(false) }, [viewFile])

  // ── tabs ──────────────────────────────────────────────────────────────────
  // Counts come from the server so they describe every matching ticket, not the
  // fifty on screen. They stay blank until the first answer arrives.

  const TAB_LABEL: Record<string, string> = {
    all: 'All', pending_activation: 'Pending Activation', active: 'Active',
    purchased: 'Purchased', issued: 'Issued', not_issued: 'Awaiting Issue',
    awaiting_approval: 'With Accounts',
  }

  const TABS: TicketTab[] = [
    { value: 'all',                label: 'All',                count: stats?.all },
    { value: 'pending_activation', label: 'Pending Activation', count: stats?.pendingActivation },
    { value: 'active',             label: 'Active',             count: stats?.active },
    { value: 'purchased',          label: 'Purchased',          count: stats?.purchased },
    { value: 'issued',             label: 'Issued',             count: stats?.issued },
    { value: 'not_issued',         label: 'Awaiting Issue',     count: stats?.notIssued,
      tone: stats?.notIssued ? 'alert' : undefined },
    { value: 'awaiting_approval',  label: 'With Accounts',      count: stats?.awaitingApproval },
  ]

  /** The current filter in words — printed at the top of the report. */
  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (effectiveFilters.status !== 'all') parts.push(TAB_LABEL[effectiveFilters.status])
    if (effectiveFilters.q) parts.push(`matching “${effectiveFilters.q}”`)
    if (effectiveFilters.categories.length) parts.push(`categories: ${effectiveFilters.categories.join(', ')}`)
    const range = (label: string, from: string, to: string) => {
      if (from || to) parts.push(`${label} ${from || 'any'} → ${to || 'any'}`)
    }
    range('arriving', effectiveFilters.arrivalFrom, effectiveFilters.arrivalTo)
    range('booking created', effectiveFilters.bookingCreatedFrom, effectiveFilters.bookingCreatedTo)
    range('ticket added', effectiveFilters.ticketCreatedFrom, effectiveFilters.ticketCreatedTo)
    range('purchased', effectiveFilters.purchasedFrom, effectiveFilters.purchasedTo)
    if (effectiveFilters.bookingRef) parts.push(`booking ${effectiveFilters.bookingRef}`)
    if (effectiveFilters.agent) parts.push(`agent ${effectiveFilters.agent}`)
    if (effectiveFilters.supplier) parts.push(`supplier ${effectiveFilters.supplier}`)
    if (effectiveFilters.portal) parts.push(`portal ${effectiveFilters.portal}`)
    if (effectiveFilters.approval) parts.push(`approval ${effectiveFilters.approval}`)
    if (effectiveFilters.hasFile !== 'any') {
      parts.push(effectiveFilters.hasFile === 'yes' ? 'with a ticket file' : 'without a ticket file')
    }
    if (countryFilter && countryFilter !== 'ALL') parts.push(countryFilter)
    return parts.length ? parts.join(' · ') : 'All tickets'
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TAB_LABEL is a constant map
  }, [effectiveFilters, countryFilter])

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

  return (
    <div>
      <Header
        title="Tickets & Vouchers"
        subtitle={
          stats
            ? `${stats.all.toLocaleString()} matching · ${stats.purchased.toLocaleString()} purchased · ` +
              `${stats.pendingActivation.toLocaleString()} pending activation · ` +
              `${stats.notIssued.toLocaleString()} awaiting issue · ${formatCurrency(stats.totalCost)} cost`
            : 'Loading…'
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReportOpen(true)}
              className="btn btn-secondary"
              title="Summarise and export the tickets currently filtered"
            >
              <BarChart3 className="w-4 h-4" /> Report
            </button>
            {canCreate && (
              <button onClick={() => setNewModal(true)} className="btn btn-primary">
                <Plus className="w-4 h-4" /> Add Ticket
              </button>
            )}
          </div>
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

        <TicketFilterBar
          filters={filters}
          onChange={setFilters}
          tabs={TABS}
          resultCount={loading ? null : total}
        >
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-secondary btn-sm"
            title="Reload"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </TicketFilterBar>

        {/* Tickets list */}
        {loading ? (
          <div className="flex justify-center h-48 items-center">
            <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <Card className="p-12 text-center">
            <TicketIcon className="w-10 h-10 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No tickets match your filters</p>
            {countActiveFilters(effectiveFilters) > 0 && (
              <button
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="btn btn-secondary btn-sm mt-3 mx-auto"
              >
                Clear filters
              </button>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => {
              // The ticket's own category wins; a row generated from a costing
              // sheet carries it on the P&L line instead. Same order the filter
              // uses, so a category filter and the badge always agree.
              const cat   = t.category ?? t.pnlLine?.category ?? 'OTHER'
              const payOk = directIssue || !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
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
                        {/* Where it was bought — the portal Accounts pays for
                            this ticket. Shown in the list so a run of purchases
                            can be checked without opening each one. */}
                        {t.portalName && (
                          <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                            {t.portalName}{t.portalRef ? ` · ${t.portalRef}` : ''}
                          </span>
                        )}
                        {/* Where the Accounts approval has got to. A ticket
                            cannot be bought until this says paid, so it is
                            shown beside the portal it is about — and an urgent
                            one that is still waiting keeps moving until it is
                            answered. */}
                        {t.approvalStatus && !isPurchased && (
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border ${
                            t.approvalStatus === 'paid'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            t.approvalStatus === 'approved' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                            t.approvalStatus === 'rejected' ? 'bg-red-50 text-red-700 border-red-200' :
                            t.approvalStatus === 'pending' && t.approvalUrgency === 'urgent'
                              ? 'bg-red-600 text-white border-red-700 animate-urgent-glow'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                          title={
                            t.approvalStatus === 'paid'     ? 'Accounts has paid the portal — you can buy this.' :
                            t.approvalStatus === 'approved' ? 'Approved; waiting for Accounts to pay the portal.' :
                            t.approvalStatus === 'rejected' ? `Sent back by Accounts${t.approvalNote ? `: ${t.approvalNote}` : ''}` :
                            'Waiting for Accounts to approve and pay.'
                          }>
                            {t.approvalStatus === 'pending' && (
                              <span className={`w-1.5 h-1.5 rounded-full animate-breathe ${
                                t.approvalUrgency === 'urgent' ? 'bg-white' : 'bg-amber-500'}`} />
                            )}
                            {t.approvalStatus === 'pending'
                              ? (t.approvalUrgency === 'urgent' ? 'URGENT · with Accounts' : 'With Accounts')
                              : t.approvalStatus === 'paid' ? 'Paid — buy it'
                              : t.approvalStatus === 'approved' ? 'Approved'
                              : t.approvalStatus === 'rejected' ? 'Sent back'
                              : t.approvalStatus}
                          </span>
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
                      {isActive && !isPurchased && canPurchase && (() => {
                        // A ticket that has been sent to Accounts can only be
                        // bought once they have paid the portal. Tickets that
                        // never went through the queue (Sri Lanka, and any
                        // category that is not bought through a portal) are
                        // unaffected — they have no approval status at all.
                        // Under direct issuing there is no queue to wait on,
                        // including for a request raised before the switch was
                        // flipped — the purchase route stopped checking it, so
                        // leaving the button greyed out here would block a
                        // ticket the server would happily let through.
                        const waiting = !directIssue && t.approvalStatus !== null && t.approvalStatus !== 'paid'
                        const ok = payOk && !waiting

                        return (
                          <button
                            onClick={() => setPurchaseModal(t)}
                            disabled={!ok}
                            title={!payOk
                              ? 'Payment not yet confirmed (G2)'
                              : waiting
                                ? 'Accounts has not paid for this ticket yet — submit and wait on the booking’s tickets page'
                                : 'Purchase ticket'}
                            className={`btn btn-sm text-xs ${ok ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
                          >
                            <ShoppingCart className="w-3.5 h-3.5" /> Purchase
                          </button>
                        )
                      })()}

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

        {/* Pagination — the list is a window onto the filtered set, so the
            page controls carry the totals the window is cut from. */}
        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <p className="text-xs text-slate-500">
              Showing{' '}
              <span className="font-semibold text-slate-700">
                {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
                {Math.min(page * PAGE_SIZE, total).toLocaleString()}
              </span>{' '}
              of <span className="font-semibold text-slate-700">{total.toLocaleString()}</span> tickets
              {stats && stats.totalCost > 0 && (
                <> · <span className="font-semibold text-slate-700">{formatCurrency(stats.totalCost)}</span> total cost</>
              )}
            </p>

            {pageCount > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="btn btn-secondary btn-sm disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </button>
                <span className="text-xs text-slate-500 px-2">
                  Page{' '}
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={page}
                    onChange={e => {
                      const next = Number(e.target.value)
                      if (next >= 1 && next <= pageCount) setPage(next)
                    }}
                    className="form-input w-14 text-center text-xs py-1 inline-block"
                  />{' '}
                  of {pageCount.toLocaleString()}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                  disabled={page >= pageCount}
                  className="btn btn-secondary btn-sm disabled:opacity-40"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Report ───────────────────────────────────────────────────────── */}
      <TicketReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        params={queryParams}
        filterSummary={filterSummary}
      />

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
            {((viewFile.fileType === 'image') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(viewFile.fileName ?? viewFile.fileUrl ?? '')) && !previewError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizeUploadUrl(viewFile.fileUrl) ?? viewFile.fileUrl!}
                alt="Receipt"
                className="max-w-full max-h-[60vh] rounded-lg border border-slate-200 object-contain"
                onError={() => setPreviewError(true)}
              />
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <FileText className="w-16 h-16 text-slate-300" />
                <p className="text-slate-500">{previewError ? 'Preview unavailable' : 'PDF receipt'}</p>
                <a href={normalizeUploadUrl(viewFile.fileUrl) ?? viewFile.fileUrl!} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                  <ExternalLink className="w-4 h-4" /> Open File
                </a>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
