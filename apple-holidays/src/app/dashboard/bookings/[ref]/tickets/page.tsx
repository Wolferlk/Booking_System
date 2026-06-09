'use client'

import { useEffect, useState, useRef } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import {
  Plus, Loader2, ShoppingCart, AlertCircle,
  Upload, FileText, Image, ExternalLink, CheckCircle2,
  Eye, CreditCard, X,
} from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { UserRole } from '@prisma/client'

interface Ticket {
  id: string
  type: string
  qty: number
  supplier: string | null
  costPerUnit: string | null
  totalCost: string | null
  currency: string
  status: string
  purchasedAt: string | null
  reference: string | null
  notes: string | null
  fileUrl: string | null
  fileName: string | null
  fileType: string | null
  pnlLine: { activity: string; paymentStatus: string; paymentRefNumber: string | null } | null
  agendaItem: { date: string; location: string } | null
}

export default function TicketsPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [newModal, setNewModal] = useState(false)
  const [purchaseModal, setPurchaseModal] = useState<string | null>(null)
  const [purchaseRef, setPurchaseRef] = useState('')
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [viewFile, setViewFile] = useState<Ticket | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState({
    type: '', qty: '1', supplier: '', costPerUnit: '', currency: 'USD', notes: '',
  })

  const canCreate = ['GT_USER', 'SUPER_ADMIN'].includes(role)
  const canPurchase = ['GT_USER', 'SUPER_ADMIN'].includes(role)
  const canUpload = ['GT_USER', 'SUPER_ADMIN'].includes(role)

  async function load() {
    try {
      const res = await fetch(`/api/tickets?bookingRef=${ref}`)
      const json = await res.json()
      if (json.success) setTickets(json.data)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [ref])

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
      toast.error(err instanceof Error ? err.message : 'G2 rule: P&L payment must be confirmed first')
    }
  }

  async function uploadFile(ticketId: string, file: File) {
    setUploadingId(ticketId)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/tickets/${ticketId}/upload`, { method: 'POST', body: formData })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Receipt uploaded successfully')
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

  const purchased = tickets.filter(t => t.status !== 'DRAFT').length
  const pending = tickets.filter(t => t.status === 'DRAFT').length

  return (
    <div>
      <Header
        title={`Tickets — ${ref}`}
        subtitle={`${tickets.length} tickets · ${purchased} purchased · ${pending} pending`}
        actions={
          canCreate ? (
            <button onClick={() => setNewModal(true)} className="btn-primary btn">
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
          const id = e.target.dataset.ticketId
          if (file && id) uploadFile(id, file)
          e.target.value = ''
        }}
      />

      <div className="p-8 space-y-5 max-w-6xl">
        {/* Payment flow info */}
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
              <p className="font-semibold text-emerald-800">Payment Flow</p>
              <p className="text-emerald-600 mt-0.5">GT creates ticket → BT/TE collects from client → AC confirms with ref → GT purchases & uploads receipt.</p>
            </div>
          </div>
        </div>

        {/* Tickets */}
        {tickets.length === 0 ? (
          <Card className="p-12 text-center">
            <ShoppingCart className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-400">No tickets yet</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {tickets.map(t => {
              const payOk = !t.pnlLine || t.pnlLine.paymentStatus === 'CONFIRMED'
              return (
                <Card key={t.id} className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-4 gap-4">
                      {/* Info */}
                      <div className="sm:col-span-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-900">{t.type}</p>
                          <span className={`badge border text-[11px] ${t.status === 'PURCHASED' || t.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
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

                      {/* P&L payment status */}
                      <div>
                        <p className="text-xs text-slate-500">P&L Payment</p>
                        {t.pnlLine ? (
                          <div>
                            <p className="text-xs font-medium text-slate-700 truncate">{t.pnlLine.activity}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {t.pnlLine.paymentStatus === 'CONFIRMED' ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                              )}
                              <span className={`text-xs font-semibold ${t.pnlLine.paymentStatus === 'CONFIRMED' ? 'text-emerald-600' : 'text-amber-600'}`}>
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
                      {/* File upload/view */}
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

                      {/* Purchase */}
                      {canPurchase && t.status === 'DRAFT' && (
                        <button
                          onClick={() => setPurchaseModal(t.id)}
                          disabled={!payOk}
                          title={!payOk ? 'Payment not confirmed by Accounts (G2)' : 'Purchase ticket'}
                          className={payOk ? 'btn-primary btn btn-sm' : 'btn-secondary btn btn-sm opacity-50 cursor-not-allowed'}
                        >
                          <ShoppingCart className="w-3.5 h-3.5" /> Purchase
                        </button>
                      )}

                      {/* Upload receipt for draft (GT can also upload) */}
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
        )}
      </div>

      {/* New Ticket Modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Add Ticket">
        <div className="space-y-4">
          {[
            { label: 'Activity / Ticket Type *', key: 'type', placeholder: 'Ha Long Bay Cruise' },
            { label: 'Supplier', key: 'supplier', placeholder: 'Tour operator name' },
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
              <label className="form-label">Cost Per Unit (USD)</label>
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
          <div>
            <p className="text-xs text-slate-500">Upload the ticket receipt after purchasing using the Upload Receipt button.</p>
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
