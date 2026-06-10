'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Loader2, CheckCircle, XCircle, Upload, Hash, Paperclip, X, Info } from 'lucide-react'
import Modal from '@/components/ui/modal'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, computePNLLineTotal, isCreditAgent } from '@/lib/utils'
import FileUpload from '@/components/shared/file-upload'
import type { UserRole } from '@prisma/client'

const CATEGORIES = ['HOTEL', 'TICKETS', 'GUIDES', 'MEALS', 'CRUISE', 'WATER', 'TRANSPORT', 'TAX_FEES', 'FLIGHT_TICKETS', 'OTHER']

interface Line {
  id?: string
  activity: string
  category: string
  mmtRate: string
  sicRate: string
  pvtRatePP: string
  adEntrance: string
  chEntrance: string
  otherRate: string
  paymentStatus?: string
  paymentRefNumber?: string | null
  paymentBillUrl?: string | null
  paymentBillName?: string | null
  notes: string
}

export default function PNLPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [pnl, setPnl] = useState<Record<string, unknown> | null>(null)
  const [bookingAgent, setBookingAgent] = useState<string | null>(null)
  const [paxAdults, setPaxAdults] = useState('2')
  const [paxChildren, setPaxChildren] = useState('0')
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmingLine, setConfirmingLine] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{ lineId: string; action: 'CONFIRMED' | 'REJECTED'; activity: string } | null>(null)
  const [refInput, setRefInput] = useState('')
  const [billFile, setBillFile]   = useState<File | null>(null)
  const [billUrl,  setBillUrl]    = useState<string | null>(null)
  const [billName, setBillName]   = useState<string | null>(null)
  const [uploadingBill, setUploadingBill] = useState(false)

  const canEdit    = ['AC_USER', 'SUPER_ADMIN'].includes(role)
  const isCreditBk = isCreditAgent(bookingAgent)

  async function loadPNL() {
    try {
      const res  = await fetch(`/api/bookings/${ref}/pnl`)
      const json = await res.json()
      if (json.success && json.data) {
        const data = json.data as Record<string, unknown>
        setPnl(data)
        setBookingAgent((data.bookingAgent as string | null) ?? null)
        setPaxAdults(String(data.paxAdults ?? 2))
        setPaxChildren(String(data.paxChildren ?? 0))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLines(((data.lineItems ?? []) as any[]).map((l: any) => ({
          id:               l.id as string,
          activity:         l.activity as string,
          category:         l.category as string,
          mmtRate:          String(l.mmtRate),
          sicRate:          String(l.sicRate),
          pvtRatePP:        String(l.pvtRatePP),
          adEntrance:       String(l.adEntrance),
          chEntrance:       String(l.chEntrance),
          otherRate:        String(l.otherRate),
          paymentStatus:    l.paymentStatus as string,
          paymentRefNumber: l.paymentRefNumber as string | null,
          paymentBillUrl:   l.paymentBillUrl as string | null,
          paymentBillName:  l.paymentBillName as string | null,
          notes:            (l.notes as string) ?? '',
        })))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPNL() }, [ref])

  function computeTotal(line: Line) {
    return computePNLLineTotal(
      {
        sicRate:    Number(line.sicRate    || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        pvtRatePP:  Number(line.pvtRatePP  || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        otherRate:  Number(line.otherRate  || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        adEntrance: Number(line.adEntrance || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        chEntrance: Number(line.chEntrance || 0) as unknown as import('@prisma/client').Prisma.Decimal,
      },
      Number(paxAdults || 0),
      Number(paxChildren || 0),
    )
  }

  const totalRevenue = lines.reduce((sum, l) => sum + Number(l.mmtRate || 0), 0)
  const totalCost    = lines.reduce((sum, l) => sum + computeTotal(l), 0)
  const profit       = totalRevenue - totalCost
  const margin       = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0

  async function savePNL() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/pnl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paxAdults:  Number(paxAdults),
          paxChildren: Number(paxChildren),
          lineItems: lines.map(l => ({
            activity:   l.activity,
            category:   l.category,
            mmtRate:    Number(l.mmtRate    || 0),
            sicRate:    Number(l.sicRate    || 0),
            pvtRatePP:  Number(l.pvtRatePP  || 0),
            adEntrance: Number(l.adEntrance || 0),
            chEntrance: Number(l.chEntrance || 0),
            otherRate:  Number(l.otherRate  || 0),
            notes:      l.notes,
          })),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('P&L saved')
      await loadPNL()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function openConfirm(lineId: string, action: 'CONFIRMED' | 'REJECTED', activity: string) {
    setConfirmModal({ lineId, action, activity })
    setRefInput('')
    setBillFile(null)
    setBillUrl(null)
    setBillName(null)
  }

  async function uploadBill(lineId: string, file: File): Promise<{ url: string; name: string } | null> {
    setUploadingBill(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch(`/api/pnl-lines/${lineId}/upload-bill`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      return { url: json.data.fileUrl, name: json.data.fileName }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bill upload failed')
      return null
    } finally {
      setUploadingBill(false)
    }
  }

  async function confirmPayment() {
    if (!confirmModal) return
    if (confirmModal.action === 'CONFIRMED' && !refInput.trim()) {
      toast.error('Reference number is required when confirming payment')
      return
    }
    setConfirmingLine(confirmModal.lineId)
    try {
      let finalBillUrl  = billUrl
      let finalBillName = billName

      // Upload bill if one was selected
      if (billFile) {
        const uploaded = await uploadBill(confirmModal.lineId, billFile)
        if (!uploaded) { setConfirmingLine(null); return }
        finalBillUrl  = uploaded.url
        finalBillName = uploaded.name
      }

      const res  = await fetch(`/api/pnl-lines/${confirmModal.lineId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    confirmModal.action,
          refNumber: refInput.trim(),
          billUrl:   finalBillUrl,
          billName:  finalBillName,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(confirmModal.action === 'CONFIRMED'
        ? `Payment confirmed — Ref: ${refInput}`
        : 'Payment rejected')
      setConfirmModal(null)
      setRefInput('')
      setBillFile(null)
      setBillUrl(null)
      setBillName(null)
      await loadPNL()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setConfirmingLine(null)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleAIParsed(data: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items: any[] = data?.lineItems ?? []
    if (items.length) {
      setLines(items.map(l => ({
        activity:   l.activity || '',
        category:   l.category || 'OTHER',
        mmtRate:    String(l.mmtRate    || 0),
        sicRate:    String(l.sicRate    || 0),
        pvtRatePP:  String(l.pvtRatePP  || 0),
        adEntrance: String(l.adEntrance || 0),
        chEntrance: String(l.chEntrance || 0),
        otherRate:  String(l.otherRate  || 0),
        notes: '',
      })))
      if (data.paxAdults)     setPaxAdults(String(data.paxAdults))
      if (data.paxChildren !== undefined) setPaxChildren(String(data.paxChildren))
      toast.success(`${items.length} P&L lines imported from spreadsheet!`)
    } else {
      toast.error('No line items found in the spreadsheet')
    }
  }

  if (loading) return (
    <div className="flex justify-center h-64">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-20" />
    </div>
  )

  return (
    <div>
      <Header
        title={`P&L — ${ref}`}
        subtitle="Profit & Loss Statement"
        actions={
          canEdit && (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowUpload(!showUpload)} icon={<Upload className="w-4 h-4" />}>
                Import P&L
              </Button>
              <Button size="sm" loading={saving} icon={<Save className="w-4 h-4" />} onClick={savePNL}>
                Save P&L
              </Button>
            </div>
          )
        }
      />

      <div className="p-8 space-y-6 max-w-7xl">

        {/* Credit agent notice */}
        {isCreditBk && (
          <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-800">Credit Agent — No Payment Approval Required</p>
              <p className="text-xs text-blue-600 mt-0.5">
                <strong>{bookingAgent}</strong> settles payments in bulk on the 15th and 30th of each month.
                Once P&L is saved this booking advances directly to Operations Ready.
              </p>
            </div>
          </div>
        )}

        {/* AI Upload */}
        {showUpload && canEdit && (
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Import P&L from Spreadsheet</h3>
            <FileUpload
              accept={['.xlsx', '.xls', '.csv']}
              uploadType="pnl"
              onParsed={handleAIParsed}
              label="Upload P&L Spreadsheet"
              description=".xlsx, .xls, or .csv — AI will extract line items"
            />
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue (MMT Rate)', value: formatCurrency(totalRevenue), color: 'text-slate-900' },
            { label: 'Total Cost (Apple Rate)',  value: formatCurrency(totalCost),    color: 'text-slate-900' },
            { label: 'Profit',  value: formatCurrency(profit), color: profit >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'Margin',  value: `${margin.toFixed(1)}%`, color: margin >= 15 ? 'text-green-600' : 'text-orange-600' },
          ].map(s => (
            <Card key={s.label} className="p-5">
              <p className="text-xs text-slate-500 font-medium">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </Card>
          ))}
        </div>

        {/* Pax counts */}
        {canEdit && (
          <Card className="p-4">
            <div className="flex items-center gap-6">
              <p className="text-sm font-medium text-slate-700">Pax counts (used in total calculation):</p>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Adults</label>
                <input type="number" min="0" className="form-input w-16 text-sm py-1" value={paxAdults}
                  onChange={e => setPaxAdults(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Children</label>
                <input type="number" min="0" className="form-input w-16 text-sm py-1" value={paxChildren}
                  onChange={e => setPaxChildren(e.target.value)} />
              </div>
            </div>
          </Card>
        )}

        {/* Line items table */}
        <Card>
          <CardHeader
            action={
              canEdit && (
                <Button size="sm" variant="secondary" icon={<Plus className="w-3 h-3" />}
                  onClick={() => setLines(ls => [...ls, {
                    activity: '', category: 'OTHER', mmtRate: '0',
                    sicRate: '0', pvtRatePP: '0', adEntrance: '0', chEntrance: '0', otherRate: '0', notes: '',
                  }])}>
                  Add Line
                </Button>
              )
            }
          >
            <h3 className="text-sm font-semibold text-slate-900">P&L Line Items</h3>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="min-w-[180px]">Activity</th>
                  <th>Category</th>
                  <th className="text-right">MMT Rate</th>
                  <th className="text-right">SIC Rate</th>
                  <th className="text-right">PVT PP</th>
                  <th className="text-right">AD Entry</th>
                  <th className="text-right">CH Entry</th>
                  <th className="text-right">Other</th>
                  <th className="text-right font-semibold">Total Cost</th>
                  <th className="text-right">Profit</th>
                  {/* Payment column only for non-credit bookings */}
                  {!isCreditBk && <th>Payment</th>}
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const total          = computeTotal(line)
                  const lineProfitRow  = Number(line.mmtRate || 0) - total
                  return (
                    <tr key={i}>
                      <td>
                        {canEdit ? (
                          <input className="form-input text-xs py-1" value={line.activity}
                            onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, activity: e.target.value } : l))} />
                        ) : (
                          <span className="text-xs font-medium">{line.activity}</span>
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <select className="form-select text-xs py-1 w-28" value={line.category}
                            onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, category: e.target.value } : l))}>
                            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs text-slate-500">{line.category}</span>
                        )}
                      </td>
                      {['mmtRate', 'sicRate', 'pvtRatePP', 'adEntrance', 'chEntrance', 'otherRate'].map(field => (
                        <td key={field} className="text-right">
                          {canEdit ? (
                            <input type="number" step="0.01" min="0"
                              className="form-input text-xs py-1 w-16 text-right"
                              value={(line as unknown as Record<string, string>)[field]}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, [field]: e.target.value } : l))} />
                          ) : (
                            <span className="text-xs">{Number((line as unknown as Record<string, string>)[field]).toFixed(2)}</span>
                          )}
                        </td>
                      ))}
                      <td className="text-right font-semibold text-slate-900 text-xs">{total.toFixed(2)}</td>
                      <td className={`text-right text-xs font-semibold ${lineProfitRow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {lineProfitRow.toFixed(2)}
                      </td>

                      {/* Payment cell — only for non-credit agents */}
                      {!isCreditBk && (
                        <td>
                          {line.id ? (
                            <div className="flex items-center gap-1 flex-wrap">
                              <Badge
                                color={line.paymentStatus === 'CONFIRMED' ? 'green' : line.paymentStatus === 'REJECTED' ? 'red' : 'yellow'}
                              >
                                {line.paymentStatus === 'CONFIRMED' ? 'Confirmed'
                                  : line.paymentStatus === 'REJECTED' ? 'Rejected'
                                  : 'Pending'}
                              </Badge>
                              {/* Show bill link if uploaded */}
                              {line.paymentBillUrl && (
                                <a
                                  href={line.paymentBillUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-slate-400 hover:text-brand-600 ml-1"
                                  title={line.paymentBillName ?? 'View bill'}
                                >
                                  <Paperclip className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {canEdit && line.paymentStatus === 'PENDING' && (
                                <div className="flex gap-1 ml-1">
                                  <button
                                    onClick={() => openConfirm(line.id!, 'CONFIRMED', line.activity)}
                                    disabled={confirmingLine === line.id}
                                    className="text-green-600 hover:text-green-800"
                                    title="Confirm payment"
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => openConfirm(line.id!, 'REJECTED', line.activity)}
                                    disabled={confirmingLine === line.id}
                                    className="text-red-500 hover:text-red-700"
                                    title="Reject payment"
                                  >
                                    <XCircle className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      )}

                      {canEdit && (
                        <td>
                          <button onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}
                            className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-50">
                    <td colSpan={2} className="px-4 py-3 text-sm font-bold text-slate-900">TOTALS</td>
                    <td className="text-right px-4 py-3 text-sm font-bold">{totalRevenue.toFixed(2)}</td>
                    <td colSpan={5} />
                    <td className="text-right px-4 py-3 text-sm font-bold">{totalCost.toFixed(2)}</td>
                    <td className={`text-right px-4 py-3 text-sm font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profit.toFixed(2)}
                    </td>
                    <td colSpan={(!isCreditBk ? 1 : 0) + (canEdit ? 1 : 0)} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      {/* Payment Confirmation Modal — only for non-credit agents */}
      <Modal
        open={!!confirmModal && !isCreditBk}
        onClose={() => { setConfirmModal(null); setRefInput('') }}
        title={confirmModal?.action === 'CONFIRMED' ? 'Confirm Payment' : 'Reject Payment'}
      >
        {confirmModal && (
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-500">P&L Line</p>
              <p className="font-semibold text-slate-900">{confirmModal.activity}</p>
            </div>

            {confirmModal.action === 'CONFIRMED' ? (
              <>
                {/* Bill upload */}
                <div>
                  <label className="form-label flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5 text-slate-400" /> Payment Bill / Receipt
                    <span className="text-slate-400 font-normal text-xs ml-1">(optional but recommended)</span>
                  </label>
                  {billFile ? (
                    <div className="flex items-center gap-2 p-2.5 bg-green-50 border border-green-200 rounded-lg">
                      <Paperclip className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-green-700 truncate flex-1">{billFile.name}</span>
                      <button
                        type="button"
                        onClick={() => { setBillFile(null); setBillUrl(null); setBillName(null) }}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-slate-200 rounded-lg cursor-pointer hover:border-brand-400 hover:bg-brand-50 transition-colors">
                      <Upload className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-500">Click to select bill (PDF, JPG, PNG)</span>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp"
                        onChange={e => {
                          const f = e.target.files?.[0]
                          if (f) { setBillFile(f); setBillUrl(null); setBillName(null) }
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Reference number */}
                <div>
                  <label className="form-label flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-brand-500" /> Reference Number *
                  </label>
                  <input
                    value={refInput}
                    onChange={e => setRefInput(e.target.value)}
                    className="form-input font-mono"
                    placeholder="e.g. TT-2026-0142"
                    autoFocus
                  />
                  <p className="text-xs text-slate-400 mt-1">Bank transfer ref, voucher number, or internal payment ID</p>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={confirmPayment}
                    disabled={!refInput.trim() || !!confirmingLine || uploadingBill}
                    className="btn-primary btn flex-1"
                  >
                    {(confirmingLine || uploadingBill) ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Confirm Payment
                  </button>
                  <button onClick={() => { setConfirmModal(null); setRefInput(''); setBillFile(null) }} className="btn-secondary btn">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
                  This will mark the payment as rejected. The Ground Team will not be able to purchase tickets linked to this line.
                </div>
                <div className="flex gap-3">
                  <button onClick={confirmPayment} disabled={!!confirmingLine} className="btn-danger btn flex-1">
                    {confirmingLine ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                    Reject Payment
                  </button>
                  <button onClick={() => setConfirmModal(null)} className="btn-secondary btn">Cancel</button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
