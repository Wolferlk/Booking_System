'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, ShoppingCart, AlertCircle,
  Upload, FileText, Image as ImageIcon, ExternalLink, CheckCircle2,
  Eye, CreditCard, X, Zap, Sparkles, Hotel, Ticket as TicketIcon,
  Anchor, Activity, MapPin, Plane, Printer,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'
import Link from 'next/link'

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
  pnlLine: {
    activity: string
    paymentStatus: string
    paymentRefNumber: string | null
    category: string
  } | null
  agendaItem: { date: string; location: string } | null
}

// Map P&L category → icon
const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  HOTEL:          Hotel,
  TICKETS:        TicketIcon,
  CRUISE:         Anchor,
  WATER:          Activity,
  GUIDES:         MapPin,
  FLIGHT_TICKETS: Plane,
}

function CategoryIcon({ cat, className = 'w-4 h-4' }: { cat: string; className?: string }) {
  const Icon = CATEGORY_ICON[cat] ?? TicketIcon
  return <Icon className={className} />
}

export default function TicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [newModal, setNewModal] = useState(false)
  const [activating, setActivating] = useState<string | null>(null)
  const [activateModal, setActivateModal] = useState<Ticket | null>(null)
  const [activateForm, setActivateForm] = useState({ reference: '', supplier: '', notes: '' })
  const [purchaseModal, setPurchaseModal] = useState<string | null>(null)
  const [purchaseRef, setPurchaseRef] = useState('')
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [viewFile, setViewFile] = useState<Ticket | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    type: '', qty: '1', supplier: '', costPerUnit: '', currency: 'USD', notes: '',
  })

  const canCreate   = ['GT_USER', 'SUPER_ADMIN'].includes(role)
  const canPurchase = ['GT_USER', 'SUPER_ADMIN'].includes(role)
  const canUpload   = ['GT_USER', 'SUPER_ADMIN'].includes(role)

  async function load() {
    try {
      const res  = await fetch(`/api/tickets?bookingRef=${ref}`)
      const json = await res.json()
      if (json.success) setTickets(json.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [ref])

  async function activateTicket(id: string, data: { reference: string; supplier: string; notes: string }) {
    setActivating(id)
    try {
      const res  = await fetch(`/api/tickets/${id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Ticket activated — client can now view it')
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
    setActivateForm({ reference: t.reference ?? '', supplier: t.supplier ?? '', notes: t.notes ?? '' })
    setActivateModal(t)
  }

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

  if (loading) return (
    <div className="flex justify-center h-48">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" />
    </div>
  )

  const inactive = tickets.filter(t => !t.activated)
  const active   = tickets.filter(t => t.activated)
  const purchased = active.filter(t => t.status !== 'DRAFT').length
  const pending   = active.filter(t => t.status === 'DRAFT').length

  return (
    <div>
      <Header
        title={`Tickets & Vouchers — ${ref}`}
        subtitle={`${active.length} active · ${purchased} purchased · ${pending} pending · ${inactive.length} pending activation`}
        actions={
          <div className="flex items-center gap-2">
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

      <div className="p-8 space-y-6 max-w-6xl">

        {/* ── Section 1: Pending Activation (auto-generated from P&L) ── */}
        {inactive.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Auto-generated from P&L
                  <span className="ml-2 text-xs font-normal text-slate-400">— review and activate before purchasing</span>
                </h2>
              </div>
              {canCreate && inactive.length > 1 && (
                <button
                  onClick={activateAll}
                  disabled={activating === 'all'}
                  className="btn btn-primary btn-sm text-xs"
                >
                  {activating === 'all'
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Zap className="w-3.5 h-3.5" />}
                  Activate All ({inactive.length})
                </button>
              )}
            </div>

            <div className="space-y-2">
              {inactive.map(t => {
                const cat    = t.pnlLine?.category ?? 'OTHER'
                const payOk  = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'

                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-4 p-4 bg-amber-50 border border-amber-200 rounded-xl"
                  >
                    <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <CategoryIcon cat={cat} className="w-4.5 h-4.5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{t.type}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide">
                          {cat.replace('_', ' ')}
                        </span>
                        {t.pnlLine && (
                          <span className={`text-[10px] font-medium flex items-center gap-1 ${payOk ? 'text-green-600' : 'text-amber-600'}`}>
                            {payOk
                              ? <><CheckCircle2 className="w-3 h-3" /> Payment confirmed</>
                              : <><AlertCircle className="w-3 h-3" /> Payment pending</>}
                          </span>
                        )}
                      </div>
                    </div>
                    {canCreate && (
                      <button
                        onClick={() => openActivateModal(t)}
                        className="btn btn-primary btn-sm text-xs flex-shrink-0"
                      >
                        <Zap className="w-3.5 h-3.5" /> Activate
                      </button>
                    )}
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
              <p className="text-emerald-600 mt-0.5">AC uploads P&L → tickets auto-created → GT activates → AC confirms payment → GT purchases & uploads receipt.</p>
            </div>
          </div>
        </div>

        {/* ── Section 2: Active Tickets ── */}
        {active.length === 0 && inactive.length === 0 ? (
          <Card className="p-12 text-center">
            <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400 text-sm">No tickets yet — they will appear here after P&L is uploaded</p>
          </Card>
        ) : active.length === 0 ? null : (
          <div>
            {inactive.length > 0 && (
              <h2 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" /> Active Tickets
              </h2>
            )}
            <div className="space-y-3">
              {active.map(t => {
                const payOk = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
                return (
                  <Card key={t.id} className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-4">
                        {/* Info */}
                        <div className="sm:col-span-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {t.pnlLine?.category && (
                              <CategoryIcon cat={t.pnlLine.category} className="w-4 h-4 text-slate-400" />
                            )}
                            <p className="font-semibold text-slate-900">{t.type}</p>
                            <span className={`badge border text-[11px] ${
                              t.status === 'PURCHASED' || t.status === 'PAID'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                                : 'bg-amber-50 text-amber-700 border-amber-100'
                            }`}>
                              {t.status}
                            </span>
                          </div>
                          {t.supplier && <p className="text-xs text-slate-500 mt-0.5">{t.supplier}</p>}
                          {t.agendaItem && (
                            <p className="text-xs text-slate-400 mt-0.5">{formatDate(t.agendaItem.date)} · {t.agendaItem.location}</p>
                          )}
                          {t.reference && <p className="text-xs text-slate-500 font-mono mt-0.5">Ref: {t.reference}</p>}
                        </div>

                        {/* Pricing */}
                        <div>
                          <p className="text-xs text-slate-500">Qty × Unit Cost</p>
                          <p className="text-sm font-medium text-slate-800">
                            {t.qty} × {t.costPerUnit ? formatCurrency(t.costPerUnit) : '—'}
                          </p>
                          {t.totalCost && (
                            <p className="text-sm font-bold text-slate-900">{formatCurrency(t.totalCost)}</p>
                          )}
                        </div>

                        {/* P&L payment */}
                        <div>
                          <p className="text-xs text-slate-500">P&L Payment</p>
                          {t.pnlLine ? (
                            <div>
                              <p className="text-xs font-medium text-slate-700 truncate">{t.pnlLine.activity}</p>
                              <div className="flex items-center gap-1 mt-0.5">
                                {payOk
                                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                  : <AlertCircle  className="w-3.5 h-3.5 text-amber-500"   />}
                                <span className={`text-xs font-semibold ${payOk ? 'text-emerald-600' : 'text-amber-600'}`}>
                                  {t.pnlLine.paymentStatus}
                                </span>
                                {t.pnlLine.paymentRefNumber && (
                                  <span className="text-xs text-slate-400 font-mono">#{t.pnlLine.paymentRefNumber}</span>
                                )}
                              </div>
                            </div>
                          ) : <p className="text-xs text-slate-400">No P&L link</p>}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                        {t.fileUrl ? (
                          <button onClick={() => setViewFile(t)} className="btn-secondary btn btn-sm">
                            <Eye className="w-3.5 h-3.5" /> View Receipt
                          </button>
                        ) : canUpload && t.status !== 'DRAFT' ? (
                          <button onClick={() => triggerUpload(t.id)} disabled={uploadingId === t.id} className="btn-secondary btn btn-sm">
                            {uploadingId === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            Upload Receipt
                          </button>
                        ) : null}

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

                        {canUpload && t.status === 'DRAFT' && !t.fileUrl && (
                          <button onClick={() => triggerUpload(t.id)} disabled={uploadingId === t.id} className="btn-ghost btn btn-sm text-xs">
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

      </div>

      {/* Activate Ticket Modal */}
      <Modal
        open={!!activateModal}
        onClose={() => setActivateModal(null)}
        title={`Activate — ${activateModal?.type ?? ''}`}
        footer={
          <>
            <button onClick={() => setActivateModal(null)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={() => activateModal && activateTicket(activateModal.id, activateForm)}
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
          {activateModal?.pnlLine?.category === 'FLIGHT_TICKETS' && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
              ✈ Flight ticket — please add ticket details and upload the PDF/photo after activating.
            </div>
          )}
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
              placeholder="Meeting point, dress code, what to bring..."
              value={activateForm.notes}
              onChange={e => setActivateForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* New Ticket Modal */}
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

      {/* Purchase Modal */}
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

      {/* View File Modal */}
      {viewFile && (
        <Modal open onClose={() => setViewFile(null)} title={`Receipt — ${viewFile.type}`} size="lg">
          <div className="flex flex-col items-center gap-4">
            {viewFile.fileName && (
              <p className="text-sm text-slate-500 font-mono">{viewFile.fileName}</p>
            )}
            {viewFile.fileType === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewFile.fileUrl!} alt="Receipt" className="max-w-full max-h-[60vh] rounded-lg border border-slate-200 object-contain" />
            ) : (
              <div className="flex flex-col items-center gap-4 py-8">
                <FileText className="w-16 h-16 text-slate-300" />
                <p className="text-slate-500">PDF receipt</p>
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
