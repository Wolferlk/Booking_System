'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Loader2, ShoppingCart, AlertCircle } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
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
  pnlLine: { activity: string; paymentStatus: string } | null
  agendaItem: { date: string; location: string; toPoint: string } | null
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
  const [form, setForm] = useState({
    type: '', qty: '1', supplier: '', costPerUnit: '', currency: 'USD', notes: '',
  })

  const canCreate = ['GT_USER', 'SUPER_ADMIN'].includes(role)
  const canPurchase = ['GT_USER', 'SUPER_ADMIN'].includes(role)

  async function load() {
    try {
      const res = await fetch(`/api/tickets?bookingRef=${ref}`)
      const json = await res.json()
      if (json.success) setTickets(json.data)
    } finally {
      setLoading(false)
    }
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
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    }
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
      toast.success('Ticket marked as purchased')
      setPurchaseModal(null)
      setPurchaseRef('')
      await load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed — check P&L payment status (G2 rule)')
    }
  }

  const statusColor = (s: string) =>
    s === 'PURCHASED' || s === 'PAID' ? 'green' as const : 'yellow' as const

  if (loading) return <div className="flex justify-center h-48"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-12" /></div>

  return (
    <div>
      <Header
        title={`Tickets — ${ref}`}
        subtitle={`${tickets.length} ticket(s)`}
        actions={
          canCreate && (
            <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setNewModal(true)}>
              Add Ticket
            </Button>
          )
        }
      />

      <div className="p-8 max-w-5xl">
        <Card>
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <ShoppingCart className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No tickets yet</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Activity / Type</th>
                  <th>Supplier</th>
                  <th>Qty</th>
                  <th>Unit Cost</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>P&L Payment</th>
                  <th>Purchased At</th>
                  {canPurchase && <th />}
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr key={t.id}>
                    <td>
                      <p className="text-sm font-medium">{t.type}</p>
                      {t.agendaItem && (
                        <p className="text-xs text-slate-400">{formatDate(t.agendaItem.date)} · {t.agendaItem.location}</p>
                      )}
                    </td>
                    <td className="text-xs">{t.supplier ?? '—'}</td>
                    <td>{t.qty}</td>
                    <td>{t.costPerUnit ? formatCurrency(t.costPerUnit, t.currency) : '—'}</td>
                    <td className="font-semibold">{t.totalCost ? formatCurrency(t.totalCost, t.currency) : '—'}</td>
                    <td>
                      <Badge color={statusColor(t.status)}>{t.status}</Badge>
                    </td>
                    <td>
                      {t.pnlLine ? (
                        <Badge color={t.pnlLine.paymentStatus === 'CONFIRMED' ? 'green' : 'yellow'}>
                          {t.pnlLine.paymentStatus}
                        </Badge>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="text-xs text-slate-500">{t.purchasedAt ? formatDate(t.purchasedAt) : '—'}</td>
                    {canPurchase && (
                      <td>
                        {t.status === 'DRAFT' && (
                          <Button size="sm" variant="secondary" onClick={() => setPurchaseModal(t.id)}>
                            Purchase
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* G2 notice */}
        <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            <strong>Rule G2:</strong> Tickets can only be marked as purchased after the linked P&L line payment is confirmed by the Accounts Team.
          </p>
        </div>
      </div>

      {/* New ticket modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Add Ticket"
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewModal(false)}>Cancel</Button>
            <Button onClick={createTicket}>Create Ticket</Button>
          </>
        }>
        <div className="space-y-4">
          {[
            { label: 'Activity / Ticket Type *', key: 'type', type: 'text', placeholder: 'Ha Long Bay Cruise' },
            { label: 'Supplier', key: 'supplier', type: 'text', placeholder: 'Tour operator name' },
            { label: 'Quantity', key: 'qty', type: 'number', placeholder: '1' },
            { label: 'Cost Per Unit (USD)', key: 'costPerUnit', type: 'number', placeholder: '0.00' },
          ].map(f => (
            <div key={f.key}>
              <label className="form-label">{f.label}</label>
              <input type={f.type} className="form-input" placeholder={f.placeholder}
                value={(form as Record<string, string>)[f.key]}
                onChange={e => setForm(x => ({ ...x, [f.key]: e.target.value }))} />
            </div>
          ))}
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={form.notes}
              onChange={e => setForm(x => ({ ...x, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* Purchase confirm modal */}
      <Modal open={!!purchaseModal} onClose={() => setPurchaseModal(null)} title="Mark Ticket as Purchased"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPurchaseModal(null)}>Cancel</Button>
            <Button onClick={() => purchaseModal && purchaseTicket(purchaseModal)}>
              Confirm Purchase
            </Button>
          </>
        }>
        <div>
          <label className="form-label">Purchase Reference / Voucher No (optional)</label>
          <input className="form-input" placeholder="e.g. TKT-2026-001" value={purchaseRef}
            onChange={e => setPurchaseRef(e.target.value)} />
          <p className="text-xs text-slate-500 mt-2">
            This action requires the linked P&L payment to be confirmed (Rule G2).
          </p>
        </div>
      </Modal>
    </div>
  )
}
