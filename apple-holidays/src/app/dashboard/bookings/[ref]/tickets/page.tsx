'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, ShoppingCart, AlertCircle,
  Upload, FileText, Image as ImageIcon, ExternalLink, CheckCircle2,
  Eye, CreditCard, X, Zap, Sparkles, Hotel, Ticket as TicketIcon,
  Anchor, Activity, MapPin, Plane, Printer, Pencil, Trash2,
  Car, Users, Utensils, Phone, Coffee, Moon, Sun, Sparkle, HardDrive,
  Database,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import Link from 'next/link'
import CloudFilePicker, { type CloudFile } from '@/components/shared/cloud-file-picker'

// ─── Types ────────────────────────────────────────────────────────────────────

interface PnlLine {
  activity: string
  paymentStatus: string
  paymentRefNumber: string | null
  category: string
  mmtRate: string | null
  sicRate: string | null
  pvtRatePP: string | null
  adEntrance: string | null
  chEntrance: string | null
  otherRate: string | null
  pnl: { paxAdults: number; paxChildren: number } | null
}

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
  // Manual category override
  category: string | null
  // Transfer fields
  transferType: string | null
  vehicleType: string | null
  vehicleNumber: string | null
  driverName: string | null
  driverPhone: string | null
  pnlLine: PnlLine | null
  agendaItem: { date: string; location: string } | null
}

// ─── Config ───────────────────────────────────────────────────────────────────

const CATEGORIES = [
  'HOTEL', 'TICKETS', 'CRUISE', 'WATER', 'GUIDES',
  'MEALS', 'TRANSPORT', 'FLIGHT_TICKETS', 'TAX_FEES', 'OTHER',
]

const CAT_META: Record<string, { icon: React.ComponentType<{ className?: string }>; chip: string; label: string }> = {
  HOTEL:         { icon: Hotel,      chip: 'bg-blue-100 text-blue-700',    label: 'Hotel' },
  TICKETS:       { icon: TicketIcon, chip: 'bg-purple-100 text-purple-700', label: 'Tickets' },
  CRUISE:        { icon: Anchor,     chip: 'bg-cyan-100 text-cyan-700',    label: 'Cruise' },
  WATER:         { icon: Activity,   chip: 'bg-teal-100 text-teal-700',    label: 'Water' },
  GUIDES:        { icon: MapPin,     chip: 'bg-amber-100 text-amber-700',  label: 'Guide' },
  MEALS:         { icon: Utensils,   chip: 'bg-orange-100 text-orange-700', label: 'Meals' },
  TRANSPORT:     { icon: Car,        chip: 'bg-slate-100 text-slate-700',  label: 'Transfer' },
  FLIGHT_TICKETS:{ icon: Plane,      chip: 'bg-indigo-100 text-indigo-700', label: 'Flight' },
  TAX_FEES:      { icon: CreditCard, chip: 'bg-rose-100 text-rose-700',   label: 'Tax/Fee' },
  OTHER:         { icon: TicketIcon, chip: 'bg-slate-100 text-slate-500', label: 'Other' },
}

function effectiveCat(t: Ticket): string {
  return t.category ?? t.pnlLine?.category ?? 'OTHER'
}

function CatIcon({ cat, className = 'w-4 h-4' }: { cat: string; className?: string }) {
  const Icon = (CAT_META[cat] ?? CAT_META.OTHER).icon
  return <Icon className={className} />
}

function CatChip({ cat }: { cat: string }) {
  const m = CAT_META[cat] ?? CAT_META.OTHER
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${m.chip}`}>
      {m.label}
    </span>
  )
}

// Meal detection from ticket type name
function mealIcon(type: string): React.ComponentType<{ className?: string }> | null {
  const t = type.toLowerCase()
  if (t.includes('breakfast') || t.includes('morning meal')) return Coffee
  if (t.includes('lunch') || t.includes('midday')) return Sun
  if (t.includes('dinner') || t.includes('supper') || t.includes('evening meal')) return Moon
  return null
}

// ─── Per-person cost strip ─────────────────────────────────────────────────────

function RateStrip({ pnlLine, transferType, cat }: { pnlLine: PnlLine; transferType: string | null; cat: string }) {
  const pax    = pnlLine.pnl
  const adults = pax?.paxAdults ?? 0
  const kids   = pax?.paxChildren ?? 0

  const fmtV = (v: string | null) => v && Number(v) > 0 ? formatCurrency(v) : null

  const rows: { label: string; value: string }[] = []

  if (cat === 'TRANSPORT') {
    const typ = transferType?.toUpperCase()
    if (typ === 'SIC' && fmtV(pnlLine.sicRate))  rows.push({ label: 'SIC Rate/pax', value: fmtV(pnlLine.sicRate)! })
    if (typ === 'PVT' && fmtV(pnlLine.pvtRatePP)) rows.push({ label: 'PVT Rate/pax', value: fmtV(pnlLine.pvtRatePP)! })
    if (!typ && fmtV(pnlLine.mmtRate))            rows.push({ label: 'Base Rate', value: fmtV(pnlLine.mmtRate)! })
  } else if (cat === 'MEALS') {
    if (fmtV(pnlLine.otherRate)) rows.push({ label: 'Meal Rate/pax', value: fmtV(pnlLine.otherRate)! })
  } else {
    if (fmtV(pnlLine.adEntrance)) rows.push({ label: 'Adult/pax', value: fmtV(pnlLine.adEntrance)! })
    if (fmtV(pnlLine.chEntrance)) rows.push({ label: 'Child/pax', value: fmtV(pnlLine.chEntrance)! })
    if (fmtV(pnlLine.mmtRate))    rows.push({ label: 'Base Rate', value: fmtV(pnlLine.mmtRate)! })
  }

  if (!rows.length && !adults && !kids) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {adults > 0 && (
        <span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Users className="w-2.5 h-2.5" /> {adults} Adult{adults > 1 ? 's' : ''}
        </span>
      )}
      {kids > 0 && (
        <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <Sparkle className="w-2.5 h-2.5" /> {kids} Child{kids > 1 ? 'ren' : ''}
        </span>
      )}
      {rows.map(r => (
        <span key={r.label} className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded-full">
          {r.label}: <span className="font-bold">{r.value}</span>
        </span>
      ))}
    </div>
  )
}

// ─── Transfer Details Block ────────────────────────────────────────────────────

function TransferBlock({ t }: { t: Ticket }) {
  return (
    <div className="mt-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {t.transferType && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
            t.transferType === 'PVT' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
          }`}>
            {t.transferType === 'PVT' ? 'Private' : 'SIC / Shared'}
          </span>
        )}
        {t.vehicleType && (
          <span className="text-xs text-slate-600 flex items-center gap-1">
            <Car className="w-3 h-3" /> {t.vehicleType}
          </span>
        )}
        {t.vehicleNumber && (
          <span className="text-xs font-mono bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
            {t.vehicleNumber}
          </span>
        )}
      </div>
      {(t.driverName || t.driverPhone) && (
        <div className="flex items-center gap-3 text-xs text-slate-600">
          {t.driverName  && <span>Driver: <span className="font-medium">{t.driverName}</span></span>}
          {t.driverPhone && (
            <a href={`tel:${t.driverPhone}`} className="flex items-center gap-1 text-brand-600 hover:underline">
              <Phone className="w-3 h-3" /> {t.driverPhone}
            </a>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [tickets,     setTickets]     = useState<Ticket[]>([])
  const [loading,     setLoading]     = useState(true)
  const [newModal,    setNewModal]    = useState(false)
  const [activating,  setActivating]  = useState<string | null>(null)
  const [activateModal, setActivateModal] = useState<Ticket | null>(null)
  const [activateForm,  setActivateForm]  = useState({
    reference: '', supplier: '', notes: '',
    fileUrl: '', fileName: '', fileType: '',
  })
  const [extracting,       setExtracting]       = useState(false)
  const [drivePickerOpen,  setDrivePickerOpen]  = useState(false)
  const [purchaseModal,    setPurchaseModal]    = useState<string | null>(null)
  const [purchaseRef,   setPurchaseRef]   = useState('')
  const [uploadingId,   setUploadingId]   = useState<string | null>(null)
  const [viewFile,      setViewFile]      = useState<Ticket | null>(null)
  const fileInputRef    = useRef<HTMLInputElement>(null)
  const extractFileRef  = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    type: '', qty: '1', supplier: '', costPerUnit: '', currency: 'USD', notes: '',
  })

  const [editModal,  setEditModal]  = useState<Ticket | null>(null)
  const [editForm,   setEditForm]   = useState({
    type: '', supplier: '', qty: '', costPerUnit: '', reference: '', notes: '',
    category: '',
    transferType: '', vehicleType: '', vehicleNumber: '', driverName: '', driverPhone: '',
  })
  const [editSaving, setEditSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState<string | null>(null)
  const [bulkDeleting,        setBulkDeleting]        = useState(false)
  const [selectedIds,         setSelectedIds]         = useState<Set<string>>(new Set())
  const [bulkModal,           setBulkModal]           = useState(false)
  const [bulkForm,            setBulkForm]            = useState({ reference: '', supplier: '', notes: '' })
  const [bulkActivating,      setBulkActivating]      = useState(false)
  const [bulkReceiptUploading, setBulkReceiptUploading] = useState(false)
  const bulkReceiptRef = useRef<HTMLInputElement>(null)

  const canCreate   = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canPurchase = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canUpload   = ['GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canPnlSync  = ['AC_USER', 'BT_USER', 'GT_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)

  // ── Accounts PNL import state ─────────────────────────────────────────────
  const [pnlLinked,    setPnlLinked]    = useState(false)
  const [pnlImporting, setPnlImporting] = useState(false)
  const [pnlSyncing,   setPnlSyncing]   = useState(false)
  const [pnlResult,    setPnlResult]    = useState<{ created: number; updated: number; skipped: number } | null>(null)

  async function load() {
    try {
      const res  = await fetch(`/api/tickets?bookingRef=${ref}`)
      const json = await res.json()
      if (json.success) setTickets(json.data)
    } finally { setLoading(false) }
  }

  // Check if Accounts PNL is linked and auto-create missing tickets on first load
  useEffect(() => {
    if (!ref || !canPnlSync) return
    async function checkAndAutoCreate() {
      try {
        const res  = await fetch(`/api/bookings/${ref}/ext-pnl`)
        const json = await res.json()
        if (!json.success || !json.data) return
        setPnlLinked(true)
        // Auto-create tickets (only creates missing ones, safe to call every load)
        const cr = await fetch(`/api/bookings/${ref}/ext-pnl/create-tickets`, { method: 'POST' })
        const cj = await cr.json()
        if (cj.success && (cj.data.created > 0)) {
          setPnlResult(cj.data)
          toast.success(`${cj.data.created} ticket${cj.data.created !== 1 ? 's' : ''} auto-created from Accounts PNL`)
          load()
        } else if (cj.success) {
          setPnlResult(cj.data)
        }
      } catch { /* silent — PNL check is best-effort */ }
    }
    checkAndAutoCreate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref])

  // Manual import: create any still-missing tickets
  async function importFromPnl() {
    setPnlImporting(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/ext-pnl/create-tickets`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setPnlResult(json.data)
      toast.success(json.message ?? `${json.data.created} tickets created from PNL`)
      if (json.data.created > 0) load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    } finally { setPnlImporting(false) }
  }

  // Re-sync: update draft tickets with latest PNL data + create new ones
  async function resyncFromPnl() {
    setPnlSyncing(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/ext-pnl/create-tickets?resync=true`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setPnlResult(json.data)
      toast.success(json.message ?? `Re-synced from PNL`)
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Re-sync failed')
    } finally { setPnlSyncing(false) }
  }

  useEffect(() => { load() }, [ref])

  // ── Activate ────────────────────────────────────────────────────────────────

  async function activateTicket(id: string) {
    setActivating(id)
    try {
      const res  = await fetch(`/api/tickets/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: activateForm.reference,
          supplier:  activateForm.supplier,
          notes:     activateForm.notes,
          fileUrl:   activateForm.fileUrl   || undefined,
          fileName:  activateForm.fileName  || undefined,
          fileType:  activateForm.fileType  || undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket activated')
      setActivateModal(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally { setActivating(null) }
  }

  async function activateAll() {
    const inactiveIds = inactive.map(t => t.id)
    setActivating('all')
    try {
      await Promise.all(inactiveIds.map(id =>
        fetch(`/api/tickets/${id}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ))
      toast.success(`${inactiveIds.length} tickets activated`)
      load()
    } catch {
      toast.error('Some activations failed')
    } finally { setActivating(null) }
  }

  function openActivateModal(t: Ticket) {
    setActivateForm({
      reference: t.reference ?? '', supplier: t.supplier ?? '', notes: t.notes ?? '',
      fileUrl: '', fileName: '', fileType: '',
    })
    setActivateModal(t)
  }

  // AI extraction from uploaded image/PDF
  async function handleExtractFile(file: File) {
    if (!activateModal) return
    setExtracting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch(`/api/tickets/${activateModal.id}/extract`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const { fileUrl, fileName, fileType, extracted } = json.data
      setActivateForm(f => ({
        ...f,
        fileUrl, fileName, fileType,
        reference: extracted.reference || f.reference,
        supplier:  extracted.supplier  || f.supplier,
        notes: [
          f.notes,
          extracted.driverName   ? `Driver: ${extracted.driverName}`       : '',
          extracted.driverPhone  ? `Phone: ${extracted.driverPhone}`        : '',
          extracted.vehicleType  ? `Vehicle: ${extracted.vehicleType}`      : '',
          extracted.vehicleNumber? `Plate: ${extracted.vehicleNumber}`      : '',
          extracted.notes        ? extracted.notes                           : '',
        ].filter(Boolean).join(' | '),
      }))
      toast.success('Details extracted from document')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally { setExtracting(false) }
  }

  // Pick file from booking's OneDrive folder and extract details
  async function handleDriveFileSelected(file: CloudFile) {
    setDrivePickerOpen(false)
    if (!activateModal) return
    setExtracting(true)
    try {
      const res  = await fetch(`/api/bookings/${ref}/cloud-files/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: file.id, itemName: file.name, mode: 'ticket' }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const { fileUrl, fileName, fileType, extracted } = json.data
      setActivateForm(f => ({
        ...f,
        fileUrl, fileName, fileType,
        reference: extracted.reference || f.reference,
        supplier:  extracted.supplier  || f.supplier,
        notes: [
          f.notes,
          extracted.driverName   ? `Driver: ${extracted.driverName}`   : '',
          extracted.driverPhone  ? `Phone: ${extracted.driverPhone}`   : '',
          extracted.vehicleType  ? `Vehicle: ${extracted.vehicleType}` : '',
          extracted.vehicleNumber? `Plate: ${extracted.vehicleNumber}` : '',
          extracted.notes        ? extracted.notes                      : '',
        ].filter(Boolean).join(' | '),
      }))
      toast.success(`Details extracted from "${file.name}"`)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Extraction failed')
    } finally { setExtracting(false) }
  }

  // ── Bulk activate ──────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll(ids: string[]) {
    setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids))
  }

  async function activateSelected() {
    setBulkActivating(true)
    try {
      await Promise.all(Array.from(selectedIds).map(id =>
        fetch(`/api/tickets/${id}/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bulkForm),
        }),
      ))
      toast.success(`${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''} activated`)
      setSelectedIds(new Set())
      setBulkModal(false)
      setBulkForm({ reference: '', supplier: '', notes: '' })
      load()
    } catch {
      toast.error('Some activations failed')
    } finally { setBulkActivating(false) }
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  async function createTicket() {
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingRef: ref, ...form, qty: Number(form.qty), costPerUnit: Number(form.costPerUnit) || null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket created')
      setNewModal(false)
      setForm({ type: '', qty: '1', supplier: '', costPerUnit: '', currency: 'USD', notes: '' })
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
  }

  // ── Purchase ───────────────────────────────────────────────────────────────

  async function purchaseTicket(id: string) {
    try {
      const res = await fetch(`/api/tickets/${id}/purchase`, {
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
  }

  // ── File upload (receipt) ──────────────────────────────────────────────────

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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally { setUploadingId(null) }
  }

  function triggerUpload(ticketId: string) {
    if (!fileInputRef.current) return
    fileInputRef.current.dataset.ticketId = ticketId
    fileInputRef.current.click()
  }

  // ── Edit ───────────────────────────────────────────────────────────────────

  function openEdit(t: Ticket) {
    setEditForm({
      type: t.type, supplier: t.supplier ?? '', qty: String(t.qty),
      costPerUnit: t.costPerUnit ?? '', reference: t.reference ?? '', notes: t.notes ?? '',
      category: t.category ?? effectiveCat(t),
      transferType: t.transferType ?? '', vehicleType: t.vehicleType ?? '',
      vehicleNumber: t.vehicleNumber ?? '', driverName: t.driverName ?? '',
      driverPhone: t.driverPhone ?? '',
    })
    setEditModal(t)
  }

  async function saveEdit() {
    if (!editModal) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/tickets/${editModal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:          editForm.type,
          supplier:      editForm.supplier,
          qty:           Number(editForm.qty),
          costPerUnit:   editForm.costPerUnit ? Number(editForm.costPerUnit) : null,
          reference:     editForm.reference,
          notes:         editForm.notes,
          category:      editForm.category || null,
          transferType:  editForm.transferType  || null,
          vehicleType:   editForm.vehicleType   || null,
          vehicleNumber: editForm.vehicleNumber || null,
          driverName:    editForm.driverName    || null,
          driverPhone:   editForm.driverPhone   || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket updated')
      setEditModal(null)
      load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Failed') }
    finally { setEditSaving(false) }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function deleteTicket(id: string) {
    setDeleting(id)
    try {
      const res  = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket deleted')
      setConfirmDelete(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    } finally { setDeleting(null) }
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    if (!window.confirm(`Delete ${selectedIds.size} selected ticket${selectedIds.size > 1 ? 's' : ''}?`)) return
    setBulkDeleting(true)
    try {
      await Promise.all(Array.from(selectedIds).map(id =>
        fetch(`/api/tickets/${id}`, { method: 'DELETE' })
          .then(res => res.json())
          .then(json => {
            if (!json.success) throw new Error(json.error || 'Deletion failed')
          }),
      ))
      toast.success(`${selectedIds.size} ticket${selectedIds.size > 1 ? 's' : ''} deleted`)
      setSelectedIds(new Set())
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Some deletions failed')
    } finally { setBulkDeleting(false) }
  }

  // ── Bulk receipt upload + AI extract ─────────────────────────────────────

  async function handleBulkReceipt(file: File) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBulkReceiptUploading(true)
    try {
      // Upload + AI extract using the first selected ticket
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch(`/api/tickets/${ids[0]}/extract`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      const { fileUrl, fileName, fileType, extracted } = json.data as {
        fileUrl: string; fileName: string; fileType: string
        extracted: { reference?: string; supplier?: string; driverName?: string; driverPhone?: string; vehicleType?: string; vehicleNumber?: string; notes?: string }
      }

      // Build the new note fragment from extracted fields
      const extractedFragment = [
        extracted.reference    ? `Ref: ${extracted.reference}`          : '',
        extracted.supplier     ? `Supplier: ${extracted.supplier}`      : '',
        extracted.driverName   ? `Driver: ${extracted.driverName}`      : '',
        extracted.driverPhone  ? `Phone: ${extracted.driverPhone}`      : '',
        extracted.vehicleType  ? `Vehicle: ${extracted.vehicleType}`    : '',
        extracted.vehicleNumber? `Plate: ${extracted.vehicleNumber}`    : '',
        extracted.notes        ? extracted.notes                        : '',
      ].filter(Boolean).join(' · ')

      // Apply to every selected ticket: merge notes, set reference if empty
      await Promise.all(ids.map(id => {
        const t = tickets.find(tk => tk.id === id)
        const merged = [t?.notes, extractedFragment].filter(Boolean).join(' · ')
        return fetch(`/api/tickets/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileUrl, fileName, fileType,
            ...(extracted.reference && !t?.reference && { reference: extracted.reference }),
            ...(merged && { notes: merged }),
          }),
        })
      }))

      toast.success(`Receipt applied to ${ids.length} ticket${ids.length > 1 ? 's' : ''} — data extracted`)
      setSelectedIds(new Set())
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Receipt upload failed')
    } finally {
      setBulkReceiptUploading(false)
      if (bulkReceiptRef.current) bulkReceiptRef.current.value = ''
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center h-48">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" />
    </div>
  )

  const inactive  = tickets.filter(t => !t.activated)
  const active    = tickets.filter(t => t.activated)
  const purchased = active.filter(t => t.status !== 'DRAFT').length
  const pending   = active.filter(t => t.status === 'DRAFT').length

  // Separate meals from others in active list
  const mealTickets  = active.filter(t => effectiveCat(t) === 'MEALS')
  const otherActive  = active.filter(t => effectiveCat(t) !== 'MEALS')

  const isTransfer = (t: Ticket) => effectiveCat(t) === 'TRANSPORT'
  const isCruise   = (t: Ticket) => effectiveCat(t) === 'CRUISE'
  const editIsTransfer = CATEGORIES.indexOf(editForm.category) !== -1 && editForm.category === 'TRANSPORT'

  return (
    <div>
      <Header
        title={`Tickets & Vouchers — ${ref}`}
        subtitle={`${active.length} active · ${purchased} purchased · ${pending} pending · ${inactive.length} pending activation`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Accounts PNL import buttons */}
            {canPnlSync && pnlLinked && (
              <>
                <button
                  onClick={importFromPnl}
                  disabled={pnlImporting || pnlSyncing}
                  className="btn btn-sm flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                  title="Create tickets for any PNL items that don't have a ticket yet"
                >
                  {pnlImporting
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Database className="w-3.5 h-3.5" />}
                  Import from PNL
                  {pnlResult && pnlResult.skipped > 0 && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-emerald-100 rounded-full">
                      {pnlResult.skipped} exist
                    </span>
                  )}
                </button>
                <button
                  onClick={resyncFromPnl}
                  disabled={pnlImporting || pnlSyncing}
                  className="btn btn-sm flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50"
                  title="Re-sync all draft tickets with latest Accounts PNL data"
                >
                  {pnlSyncing
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Re-sync PNL
                </button>
              </>
            )}
            {active.length > 0 && (
              <Link href={`/print/tickets/${ref}`} target="_blank" className="btn btn-secondary btn-sm">
                <Printer className="w-4 h-4" /> Print Tickets
              </Link>
            )}
            {canCreate && (
              <button onClick={() => setNewModal(true)} className="btn-primary btn">
                <Plus className="w-4 h-4" /> Add Ticket
              </button>
            )}
          </div>
        }
      />

      {/* Hidden file inputs */}
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
      <input
        ref={extractFileRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleExtractFile(file)
          e.target.value = ''
        }}
      />
      {/* Bulk receipt: hidden input — uploads one file to all selected tickets */}
      <input
        ref={bulkReceiptRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleBulkReceipt(file)
          e.target.value = ''
        }}
      />

      <div className="p-8 space-y-6 max-w-6xl">

        {/* ── Accounts PNL status banner ───────────────────────────────────── */}
        {canPnlSync && pnlLinked && (
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm">
            <Database className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-emerald-800">Accounts PNL linked</span>
              {pnlResult ? (
                <span className="text-emerald-700 ml-2">
                  — {pnlResult.created > 0 && `${pnlResult.created} created`}
                  {pnlResult.updated > 0 && ` · ${pnlResult.updated} updated`}
                  {pnlResult.skipped > 0 && ` · ${pnlResult.skipped} already exist`}
                </span>
              ) : (pnlImporting || pnlSyncing) ? (
                <span className="text-emerald-600 ml-2 flex items-center gap-1 inline-flex">
                  <Loader2 className="w-3 h-3 animate-spin" /> Processing…
                </span>
              ) : (
                <span className="text-emerald-600 ml-2">Tickets auto-synced on load</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={importFromPnl}
                disabled={pnlImporting || pnlSyncing}
                className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-40 flex items-center gap-1"
              >
                {pnlImporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Import Missing
              </button>
              <span className="text-emerald-300">|</span>
              <button
                onClick={resyncFromPnl}
                disabled={pnlImporting || pnlSyncing}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-40 flex items-center gap-1"
              >
                {pnlSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Re-sync All
              </button>
            </div>
          </div>
        )}

        {/* ── Global selection action bar ──────────────────────────────────── */}
        {canCreate && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-brand-50 border border-brand-200 rounded-xl">
            <span className="text-sm font-semibold text-brand-800">{selectedIds.size} ticket{selectedIds.size > 1 ? 's' : ''} selected</span>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => bulkReceiptRef.current?.click()}
                disabled={bulkReceiptUploading}
                className="btn btn-sm flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-xs"
                title="Upload one receipt and apply to all selected tickets (AI will extract data)"
              >
                {bulkReceiptUploading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                Add Receipt ({selectedIds.size})
              </button>
              <button
                onClick={deleteSelected}
                disabled={bulkDeleting}
                className="btn btn-sm flex items-center gap-1.5 bg-white border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 text-xs"
              >
                {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Delete ({selectedIds.size})
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Pending Activation ────────────────────────────────────────────── */}
        {inactive.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {canCreate && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 accent-brand-500"
                    checked={inactive.length > 0 && inactive.every(t => selectedIds.has(t.id))}
                    onChange={() => toggleSelectAll(inactive.map(t => t.id))}
                    title="Select all pending"
                  />
                )}
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Auto-generated from P&L
                  <span className="ml-2 text-xs font-normal text-slate-400">— review & activate before purchasing</span>
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {canCreate && selectedIds.size > 0 && (
                  <button onClick={() => setBulkModal(true)} className="btn btn-primary btn-sm text-xs">
                    <Zap className="w-3.5 h-3.5" /> Activate Selected ({selectedIds.size})
                  </button>
                )}
                {canCreate && inactive.length > 1 && (
                  <button onClick={activateAll} disabled={activating === 'all'} className="btn btn-secondary btn-sm text-xs">
                    {activating === 'all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Activate All
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {inactive.map(t => {
                const cat   = effectiveCat(t)
                const meta  = CAT_META[cat] ?? CAT_META.OTHER
                const payOk = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
                const MealIc = mealIcon(t.type)

                return (
                  <div
                    key={t.id}
                    className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
                      selectedIds.has(t.id) ? 'bg-brand-50 border-brand-300' : 'bg-amber-50 border-amber-200'
                    }`}
                  >
                    {canCreate && (
                      <input
                        type="checkbox"
                        className="w-4 h-4 mt-1 rounded border-slate-300 accent-brand-500 flex-shrink-0"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                      />
                    )}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.chip}`}>
                      {MealIc ? <MealIc className="w-4.5 h-4.5" /> : <CatIcon cat={cat} className="w-4.5 h-4.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-slate-900 truncate">{t.type}</p>
                        <CatChip cat={cat} />
                        {isTransfer(t) && t.transferType && (
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            t.transferType === 'PVT' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'
                          }`}>
                            {t.transferType === 'PVT' ? 'Private' : 'SIC'}
                          </span>
                        )}
                        {payOk && t.pnlLine && (
                          <span className="text-[10px] font-medium flex items-center gap-1 text-green-600">
                            <CheckCircle2 className="w-3 h-3" /> Payment confirmed
                          </span>
                        )}
                      </div>
                      {t.supplier && <p className="text-xs text-slate-500 mt-0.5">{t.supplier}</p>}
                      {t.pnlLine && (
                        <RateStrip pnlLine={t.pnlLine} transferType={t.transferType} cat={cat} />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {canCreate && (
                        <button onClick={() => openEdit(t)} className="btn btn-secondary btn-sm" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canCreate && (
                        confirmDelete === t.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => deleteTicket(t.id)} disabled={deleting === t.id}
                              className="btn btn-sm bg-red-600 text-white hover:bg-red-700 text-xs">
                              {deleting === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm?'}
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="btn btn-secondary btn-sm">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmDelete(t.id)}
                            className="btn btn-secondary btn-sm text-red-500 hover:text-red-700" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                      {canCreate && (
                        <button onClick={() => openActivateModal(t)} className="btn btn-primary btn-sm text-xs">
                          <Zap className="w-3.5 h-3.5" /> Activate
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Info cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl">
            <AlertCircle className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-blue-800">Rule G2 — Payment Gate</p>
              <p className="text-blue-600 mt-0.5">Tickets can only be purchased after the linked P&L payment is confirmed by Accounts with a ref number.</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
            <CreditCard className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-semibold text-emerald-800">Flow</p>
              <p className="text-emerald-600 mt-0.5">AC uploads P&L → tickets auto-created → GT activates (with optional ticket scan) → AC confirms payment → GT purchases & uploads receipt.</p>
            </div>
          </div>
        </div>

        {/* ── Meal Tickets ───────────────────────────────────────────────── */}
        {mealTickets.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-orange-500" /> Meal Inclusions
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {mealTickets.map(t => {
                const MealIc = mealIcon(t.type) ?? Utensils
                const payOk  = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
                return (
                  <Card key={t.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <MealIc className="w-4.5 h-4.5 text-orange-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{t.type}</p>
                        {t.supplier && <p className="text-xs text-slate-500">{t.supplier}</p>}
                        {t.pnlLine && (
                          <RateStrip pnlLine={t.pnlLine} transferType={null} cat="MEALS" />
                        )}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${
                            t.status === 'PURCHASED' || t.status === 'PAID'
                              ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>{t.status}</span>
                          {payOk && t.pnlLine?.paymentRefNumber && (
                            <span className="text-[10px] text-slate-400 font-mono">#{t.pnlLine.paymentRefNumber}</span>
                          )}
                          {t.totalCost && (
                            <span className="text-xs font-bold text-slate-700">{formatCurrency(t.totalCost)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        {canCreate && (
                          <button onClick={() => openEdit(t)} className="btn btn-secondary btn-sm p-1" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Active Tickets ─────────────────────────────────────────────────── */}
        {otherActive.length > 0 && (
          <div>
            {(inactive.length > 0 || mealTickets.length > 0) && (
              <div className="flex items-center gap-2 mb-3">
                {canCreate && (
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 accent-brand-500"
                    checked={otherActive.every(t => selectedIds.has(t.id)) && otherActive.length > 0}
                    onChange={() => toggleSelectAll(otherActive.map(t => t.id))}
                    title="Select all active"
                  />
                )}
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" /> Active Tickets
                </h2>
              </div>
            )}
            <div className="space-y-3">
              {otherActive.map(t => {
                const cat    = effectiveCat(t)
                const payOk  = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
                const MealIc = mealIcon(t.type)
                return (
                  <Card key={t.id} className={`p-5 transition-colors ${selectedIds.has(t.id) ? 'ring-2 ring-brand-300 bg-brand-50' : ''}`}>
                    <div className="flex items-start gap-4">
                      {canCreate && (
                        <input
                          type="checkbox"
                          className="w-4 h-4 mt-1 rounded border-slate-300 accent-brand-500 flex-shrink-0"
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        {/* Header row */}
                        <div className="flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${(CAT_META[cat] ?? CAT_META.OTHER).chip}`}>
                            {MealIc ? <MealIc className="w-4.5 h-4.5" /> : <CatIcon cat={cat} className="w-4.5 h-4.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-900">{t.type}</p>
                              <CatChip cat={cat} />
                              <span className={`badge border text-[11px] ${
                                t.status === 'PURCHASED' || t.status === 'PAID'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                  : 'bg-amber-50 text-amber-700 border-amber-100'
                              }`}>{t.status}</span>
                            </div>
                            {t.supplier && <p className="text-xs text-slate-500 mt-0.5">{t.supplier}</p>}
                            {t.agendaItem && (
                              <p className="text-xs text-slate-400 mt-0.5">
                                {formatDate(t.agendaItem.date)} · {t.agendaItem.location}
                              </p>
                            )}
                            {t.reference && (
                              <p className="text-xs text-slate-500 font-mono mt-0.5">Ref: {t.reference}</p>
                            )}
                          </div>
                        </div>

                        {/* Transfer details block */}
                        {isTransfer(t) && (t.transferType || t.vehicleType || t.driverName) && (
                          <TransferBlock t={t} />
                        )}

                        {/* Cruise file link */}
                        {isCruise(t) && t.fileUrl && (
                          <div className="mt-2">
                            <a href={t.fileUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 px-2.5 py-1 rounded-lg hover:bg-cyan-100">
                              <Anchor className="w-3 h-3" /> View Cruise Documents
                            </a>
                          </div>
                        )}

                        {/* PNL rates + pax counts */}
                        {t.pnlLine && (
                          <RateStrip pnlLine={t.pnlLine} transferType={t.transferType} cat={cat} />
                        )}

                        {/* Bottom row: pricing + P&L */}
                        <div className="mt-3 grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Qty × Unit Cost</p>
                            <p className="text-sm font-medium text-slate-800">
                              {t.qty} × {t.costPerUnit ? formatCurrency(t.costPerUnit) : '—'}
                            </p>
                            {t.totalCost && (
                              <p className="text-sm font-bold text-slate-900">{formatCurrency(t.totalCost)}</p>
                            )}
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wide">P&L Payment</p>
                            {t.pnlLine ? (
                              <div>
                                <p className="text-xs font-medium text-slate-700 truncate">{t.pnlLine.activity}</p>
                                {payOk && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                    <span className="text-xs font-semibold text-emerald-600">{t.pnlLine.paymentStatus}</span>
                                    {t.pnlLine.paymentRefNumber && (
                                      <span className="text-xs text-slate-400 font-mono">#{t.pnlLine.paymentRefNumber}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : <p className="text-xs text-slate-400">No P&L link</p>}
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        {t.fileUrl ? (
                          <button onClick={() => setViewFile(t)} className="btn-secondary btn btn-sm">
                            <Eye className="w-3.5 h-3.5" /> View File
                          </button>
                        ) : canUpload && t.status !== 'DRAFT' ? (
                          <button onClick={() => triggerUpload(t.id)} disabled={uploadingId === t.id}
                            className="btn-secondary btn btn-sm">
                            {uploadingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Upload Receipt
                          </button>
                        ) : null}

                        {isCruise(t) && canUpload && !t.fileUrl && (
                          <button onClick={() => triggerUpload(t.id)} disabled={uploadingId === t.id}
                            className="btn btn-sm bg-cyan-600 text-white hover:bg-cyan-700">
                            {uploadingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Anchor className="w-3.5 h-3.5" />}
                            Upload Cruise Docs
                          </button>
                        )}

                        {canPurchase && t.status === 'DRAFT' && (
                          <button
                            onClick={() => setPurchaseModal(t.id)}
                            disabled={!payOk}
                            title={!payOk ? 'Payment not confirmed by Accounts (G2)' : 'Purchase ticket'}
                            className={`btn btn-sm ${payOk ? 'btn-primary' : 'btn-secondary opacity-50 cursor-not-allowed'}`}
                          >
                            <ShoppingCart className="w-3.5 h-3.5" /> Purchase
                          </button>
                        )}
                        {canCreate && (
                          <button onClick={() => openEdit(t)} className="btn btn-secondary btn-sm" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canCreate && (
                          confirmDelete === t.id ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => deleteTicket(t.id)} disabled={deleting === t.id}
                                className="btn btn-sm bg-red-600 text-white text-xs">
                                {deleting === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Confirm?'}
                              </button>
                              <button onClick={() => setConfirmDelete(null)} className="btn btn-secondary btn-sm">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmDelete(t.id)}
                              className="btn btn-secondary btn-sm text-red-500 hover:text-red-700">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                        {canUpload && t.status === 'DRAFT' && !t.fileUrl && !isCruise(t) && (
                          <button onClick={() => triggerUpload(t.id)} disabled={uploadingId === t.id}
                            className="btn-ghost btn btn-sm text-xs">
                            {uploadingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Receipt
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {tickets.length === 0 && (
          <Card className="p-12 text-center">
            <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No tickets yet — they will appear here after P&L is uploaded</p>
          </Card>
        )}
      </div>

      {/* ── Activate Modal ──────────────────────────────────────────────────── */}
      <Modal
        open={!!activateModal}
        onClose={() => setActivateModal(null)}
        title={`Activate — ${activateModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setActivateModal(null)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => activateModal && activateTicket(activateModal.id)}
              disabled={activating === activateModal?.id}
              className="btn btn-primary"
            >
              {activating === activateModal?.id
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Zap className="w-4 h-4" />}
              Activate Ticket
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-sm text-teal-700">
            Once activated, this ticket becomes visible to the client in their portal.
          </div>

          {/* File upload + AI scan */}
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4">
            <p className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" /> Attach Ticket / Voucher (optional — AI will extract details)
            </p>
            {activateForm.fileUrl ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1 text-sm text-slate-700">
                  {activateForm.fileType === 'image' ? <ImageIcon className="w-4 h-4 text-slate-400" /> : <FileText className="w-4 h-4 text-slate-400" />}
                  <span className="truncate font-medium">{activateForm.fileName}</span>
                </div>
                <button
                  className="btn btn-secondary btn-sm text-xs"
                  onClick={() => setActivateForm(f => ({ ...f, fileUrl: '', fileName: '', fileType: '' }))}
                >
                  <X className="w-3 h-3" /> Remove
                </button>
              </div>
            ) : extracting ? (
              <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Scanning with AI…
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => extractFileRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm text-slate-500 hover:text-brand-600 hover:bg-brand-50 border border-slate-200 rounded-lg transition-colors"
                >
                  <Upload className="w-4 h-4" /> Upload from Device
                </button>
                <button
                  onClick={() => setDrivePickerOpen(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg transition-colors font-medium"
                >
                  <HardDrive className="w-4 h-4" /> Pick from Drive
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="form-label">Reference / Confirmation Number</label>
            <input
              className="form-input font-mono"
              placeholder="e.g. TKT-2026-001, HALONGG-456"
              value={activateForm.reference}
              onChange={e => setActivateForm(f => ({ ...f, reference: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Supplier / Provider</label>
            <input
              className="form-input"
              placeholder="e.g. Heritage Cruises, Vietnam Airlines"
              value={activateForm.supplier}
              onChange={e => setActivateForm(f => ({ ...f, supplier: e.target.value }))}
            />
          </div>
          <div>
            <label className="form-label">Notes (optional)</label>
            <textarea
              className="form-textarea"
              rows={2}
              placeholder="Meeting point, dress code, driver details…"
              value={activateForm.notes}
              onChange={e => setActivateForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* ── Edit Modal ──────────────────────────────────────────────────────── */}
      <Modal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        title={`Edit — ${editModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setEditModal(null)} className="btn btn-secondary">Cancel</button>
            <button onClick={saveEdit} disabled={editSaving} className="btn btn-primary">
              {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
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

          {/* Category */}
          <div>
            <label className="form-label">Category</label>
            <select className="form-input" value={editForm.category}
              onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => (
                <option key={c} value={c}>{(CAT_META[c] ?? CAT_META.OTHER).label} — {c}</option>
              ))}
            </select>
          </div>

          {/* Transfer type (only for TRANSPORT) */}
          {editForm.category === 'TRANSPORT' && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Transfer Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Transfer Type</label>
                  <select className="form-input" value={editForm.transferType}
                    onChange={e => setEditForm(f => ({ ...f, transferType: e.target.value }))}>
                    <option value="">— Not set —</option>
                    <option value="SIC">SIC (Seat In Coach / Shared)</option>
                    <option value="PVT">Private (PVT)</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Vehicle Type</label>
                  <input className="form-input" placeholder="Car, Van, Bus, Boat…" value={editForm.vehicleType}
                    onChange={e => setEditForm(f => ({ ...f, vehicleType: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Number Plate</label>
                  <input className="form-input font-mono" placeholder="51A-12345" value={editForm.vehicleNumber}
                    onChange={e => setEditForm(f => ({ ...f, vehicleNumber: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Driver Name</label>
                  <input className="form-input" placeholder="Driver / guide name" value={editForm.driverName}
                    onChange={e => setEditForm(f => ({ ...f, driverName: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Driver Phone</label>
                <input className="form-input" placeholder="+84 xxx xxx xxx" value={editForm.driverPhone}
                  onChange={e => setEditForm(f => ({ ...f, driverPhone: e.target.value }))} />
              </div>
            </div>
          )}

          <div>
            <label className="form-label">Supplier</label>
            <input className="form-input" placeholder="Supplier / provider name" value={editForm.supplier}
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
            <input className="form-input font-mono" placeholder="TKT-2026-001" value={editForm.reference}
              onChange={e => setEditForm(f => ({ ...f, reference: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={editForm.notes}
              onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── New Ticket Modal ─────────────────────────────────────────────────── */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Add Ticket / Voucher">
        <div className="space-y-4">
          {[
            { label: 'Activity / Ticket Type *', key: 'type', placeholder: 'Ha Long Bay Cruise' },
            { label: 'Supplier',                 key: 'supplier', placeholder: 'Tour operator name' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input className="form-input" placeholder={f.placeholder}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Quantity</label>
              <input type="number" className="form-input" placeholder="1" value={form.qty}
                onChange={e => setForm(x => ({ ...x, qty: e.target.value }))} min="1" />
            </div>
            <div>
              <label className="form-label">Cost Per Unit</label>
              <input type="number" className="form-input" placeholder="0.00" value={form.costPerUnit}
                onChange={e => setForm(x => ({ ...x, costPerUnit: e.target.value }))} min="0" step="0.01" />
            </div>
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={form.notes}
              onChange={e => setForm(x => ({ ...x, notes: e.target.value }))} />
          </div>
          <div className="flex gap-3">
            <button onClick={createTicket} disabled={!form.type} className="btn-primary btn flex-1">
              <Plus className="w-4 h-4" /> Create Ticket
            </button>
            <button onClick={() => setNewModal(false)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ── Purchase Modal ───────────────────────────────────────────────────── */}
      <Modal open={!!purchaseModal} onClose={() => setPurchaseModal(null)} title="Mark Ticket as Purchased">
        <div className="space-y-4">
          <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg text-sm text-emerald-700">
            P&L payment is confirmed — you can proceed to purchase this ticket.
          </div>
          <div>
            <label className="form-label">Voucher / Reference Number (optional)</label>
            <input className="form-input" placeholder="TKT-2026-001" value={purchaseRef}
              onChange={e => setPurchaseRef(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <button onClick={() => purchaseModal && purchaseTicket(purchaseModal)} className="btn-primary btn flex-1">
              <CheckCircle2 className="w-4 h-4" /> Confirm Purchase
            </button>
            <button onClick={() => setPurchaseModal(null)} className="btn-secondary btn">Cancel</button>
          </div>
        </div>
      </Modal>

      {/* ── Bulk Activate Modal ──────────────────────────────────────────────── */}
      <Modal
        open={bulkModal}
        onClose={() => setBulkModal(false)}
        title={`Activate ${selectedIds.size} Ticket${selectedIds.size > 1 ? 's' : ''}`}
        footer={
          <>
            <button onClick={() => setBulkModal(false)} className="btn btn-secondary">Cancel</button>
            <button onClick={activateSelected} disabled={bulkActivating} className="btn btn-primary">
              {bulkActivating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              Activate {selectedIds.size} Ticket{selectedIds.size > 1 ? 's' : ''}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-sm text-teal-700">
            One reference and supplier will be applied to all {selectedIds.size} selected tickets.
          </div>
          {[
            { label: 'Reference / Confirmation Number', key: 'reference', placeholder: 'TKT-2026-001' },
            { label: 'Supplier / Provider', key: 'supplier', placeholder: 'Heritage Cruises' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input className="form-input" placeholder={f.placeholder}
                value={(bulkForm as Record<string, string>)[f.key]}
                onChange={e => setBulkForm(x => ({ ...x, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className="form-label">Notes (optional)</label>
            <textarea className="form-textarea" rows={2} placeholder="Meeting point…"
              value={bulkForm.notes}
              onChange={e => setBulkForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* ── Drive File Picker ────────────────────────────────────────────────── */}
      <CloudFilePicker
        bookingRef={ref}
        open={drivePickerOpen}
        onClose={() => setDrivePickerOpen(false)}
        onSelect={handleDriveFileSelected}
        filterExtensions={['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif']}
        title={`Drive Files — ${ref}`}
        selectLabel="Extract Details"
      />

      {/* ── View File Modal ───────────────────────────────────────────────────── */}
      {viewFile && (
        <Modal open onClose={() => setViewFile(null)} title={`Receipt — ${viewFile.type}`} size="lg">
          <div className="flex flex-col items-center gap-4">
            {viewFile.fileName && <p className="text-sm text-slate-500 font-mono">{viewFile.fileName}</p>}
            {viewFile.fileType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewFile.fileUrl!} alt="Receipt"
                className="max-w-full max-h-[60vh] rounded-lg border border-slate-200 object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <FileText className="w-16 h-16 text-slate-300" />
                <p className="text-slate-500">PDF document</p>
                <a href={viewFile.fileUrl!} target="_blank" rel="noopener noreferrer" className="btn-primary btn">
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
