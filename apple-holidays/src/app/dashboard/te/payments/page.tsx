'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Loader2, CreditCard } from 'lucide-react'
import { useCountryFilter } from '@/hooks/use-country-filter'
import Header from '@/components/layout/header'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Payment {
  id: string; type: string; amount: string; currency: string
  status: string; method: string | null; reference: string | null
  paidAt: string | null; createdAt: string
  booking: { bookingRef: string }
  processedBy: { name: string } | null
}

export default function PaymentsPage() {
  const { countryFilter } = useCountryFilter()
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    bookingRef: '', type: 'customer_payment', amount: '', currency: 'USD',
    method: 'bank_transfer', reference: '', notes: '',
  })

  useEffect(() => {
    const params = new URLSearchParams()
    if (countryFilter && countryFilter !== 'ALL') params.set('country', countryFilter)
    fetch(`/api/payments?${params}`).then(r => r.json())
      .then(j => { if (j.success) setPayments(j.data) })
      .finally(() => setLoading(false))
  }, [countryFilter])

  async function recordPayment() {
    setSaving(true)
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Payment recorded')
      setModal(false)
      const refreshed = await fetch('/api/payments')
      const j = await refreshed.json()
      if (j.success) setPayments(j.data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const statusColor = (s: string) =>
    s === 'COMPLETE' ? 'green' as const : s === 'REJECTED' ? 'red' as const : 'yellow' as const

  return (
    <div>
      <Header
        title="Payment Records"
        subtitle="Track customer payments"
        actions={
          <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setModal(true)}>
            Record Payment
          </Button>
        }
      />

      <div className="p-8">
        <Card>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-brand-500 animate-spin" /></div>
          ) : payments.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <CreditCard className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No payments recorded</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Booking</th><th>Type</th><th>Amount</th><th>Method</th>
                  <th>Reference</th><th>Status</th><th>Paid At</th><th>By</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td className="font-mono font-semibold text-sm">{p.booking?.bookingRef}</td>
                    <td className="text-xs capitalize">{p.type.replace('_', ' ')}</td>
                    <td className="font-semibold">{formatCurrency(p.amount, p.currency)}</td>
                    <td className="text-xs text-slate-500">{p.method ?? '—'}</td>
                    <td className="text-xs text-slate-500">{p.reference ?? '—'}</td>
                    <td><Badge color={statusColor(p.status)}>{p.status}</Badge></td>
                    <td className="text-xs text-slate-500">{p.paidAt ? formatDate(p.paidAt) : '—'}</td>
                    <td className="text-xs text-slate-500">{p.processedBy?.name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Record Customer Payment"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button loading={saving} onClick={recordPayment}>Record</Button>
          </>
        }>
        <div className="space-y-4">
          <div>
            <label className="form-label">Booking Ref *</label>
            <input className="form-input font-mono" placeholder="VN19005" value={form.bookingRef}
              onChange={e => setForm(x => ({ ...x, bookingRef: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Amount *</label>
              <input type="number" step="0.01" className="form-input" value={form.amount}
                onChange={e => setForm(x => ({ ...x, amount: e.target.value }))} />
            </div>
            <div>
              <label className="form-label">Currency</label>
              <select className="form-select" value={form.currency}
                onChange={e => setForm(x => ({ ...x, currency: e.target.value }))}>
                <option>USD</option><option>INR</option><option>VND</option>
              </select>
            </div>
          </div>
          <div>
            <label className="form-label">Payment Method</label>
            <select className="form-select" value={form.method}
              onChange={e => setForm(x => ({ ...x, method: e.target.value }))}>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Reference</label>
            <input className="form-input" placeholder="Transaction ID / Receipt No" value={form.reference}
              onChange={e => setForm(x => ({ ...x, reference: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Notes</label>
            <textarea className="form-textarea" rows={2} value={form.notes}
              onChange={e => setForm(x => ({ ...x, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
