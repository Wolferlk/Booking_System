'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Loader2, CheckCircle, XCircle, Upload } from 'lucide-react'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, computePNLLineTotal } from '@/lib/utils'
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
  notes: string
}

export default function PNLPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [pnl, setPnl] = useState<Record<string, unknown> | null>(null)
  const [paxAdults, setPaxAdults] = useState('2')
  const [paxChildren, setPaxChildren] = useState('0')
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmingLine, setConfirmingLine] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  const canEdit = ['AC_USER', 'SUPER_ADMIN'].includes(role)

  async function loadPNL() {
    try {
      const res = await fetch(`/api/bookings/${ref}/pnl`)
      const json = await res.json()
      if (json.success && json.data) {
        const data = json.data as Record<string, unknown>
        setPnl(data)
        setPaxAdults(String(data.paxAdults ?? 2))
        setPaxChildren(String(data.paxChildren ?? 0))
        setLines((data.lineItems as Line[] ?? []).map((l: Record<string, unknown>) => ({
          id: l.id as string,
          activity: l.activity as string,
          category: l.category as string,
          mmtRate: String(l.mmtRate),
          sicRate: String(l.sicRate),
          pvtRatePP: String(l.pvtRatePP),
          adEntrance: String(l.adEntrance),
          chEntrance: String(l.chEntrance),
          otherRate: String(l.otherRate),
          paymentStatus: l.paymentStatus as string,
          notes: (l.notes as string) ?? '',
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
        sicRate: Number(line.sicRate || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        pvtRatePP: Number(line.pvtRatePP || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        otherRate: Number(line.otherRate || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        adEntrance: Number(line.adEntrance || 0) as unknown as import('@prisma/client').Prisma.Decimal,
        chEntrance: Number(line.chEntrance || 0) as unknown as import('@prisma/client').Prisma.Decimal,
      },
      Number(paxAdults || 0),
      Number(paxChildren || 0),
    )
  }

  const totalRevenue = lines.reduce((sum, l) => sum + Number(l.mmtRate || 0), 0)
  const totalCost = lines.reduce((sum, l) => sum + computeTotal(l), 0)
  const profit = totalRevenue - totalCost
  const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0

  async function savePNL() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${ref}/pnl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paxAdults: Number(paxAdults),
          paxChildren: Number(paxChildren),
          lineItems: lines.map(l => ({
            activity: l.activity,
            category: l.category,
            mmtRate: Number(l.mmtRate || 0),
            sicRate: Number(l.sicRate || 0),
            pvtRatePP: Number(l.pvtRatePP || 0),
            adEntrance: Number(l.adEntrance || 0),
            chEntrance: Number(l.chEntrance || 0),
            otherRate: Number(l.otherRate || 0),
            notes: l.notes,
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

  async function confirmPayment(lineId: string, action: 'CONFIRMED' | 'REJECTED') {
    setConfirmingLine(lineId)
    try {
      const res = await fetch(`/api/pnl-lines/${lineId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(`Payment ${action.toLowerCase()}`)
      await loadPNL()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setConfirmingLine(null)
    }
  }

  function handleAIParsed(data: Record<string, unknown>) {
    const items = (data as Record<string, unknown>).lineItems as Line[] | undefined
    if (items?.length) {
      setLines(items.map(l => ({
        activity: (l as Record<string, unknown>).activity as string || '',
        category: (l as Record<string, unknown>).category as string || 'OTHER',
        mmtRate: String((l as Record<string, unknown>).mmtRate || 0),
        sicRate: String((l as Record<string, unknown>).sicRate || 0),
        pvtRatePP: String((l as Record<string, unknown>).pvtRatePP || 0),
        adEntrance: String((l as Record<string, unknown>).adEntrance || 0),
        chEntrance: String((l as Record<string, unknown>).chEntrance || 0),
        otherRate: String((l as Record<string, unknown>).otherRate || 0),
        notes: '',
      })))
      toast.success('P&L lines extracted from spreadsheet!')
    }
  }

  if (loading) return <div className="flex justify-center h-64"><Loader2 className="w-6 h-6 text-brand-500 animate-spin mt-20" /></div>

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
            { label: 'Total Cost (Apple Rate)', value: formatCurrency(totalCost), color: 'text-slate-900' },
            { label: 'Profit', value: formatCurrency(profit), color: profit >= 0 ? 'text-green-600' : 'text-red-600' },
            { label: 'Margin', value: `${margin.toFixed(1)}%`, color: margin >= 15 ? 'text-green-600' : 'text-orange-600' },
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
                  <th>Payment</th>
                  {canEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const total = computeTotal(line)
                  const lineProfitRow = Number(line.mmtRate || 0) - total
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
                              value={(line as Record<string, string>)[field]}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, [field]: e.target.value } : l))} />
                          ) : (
                            <span className="text-xs">{Number((line as Record<string, string>)[field]).toFixed(2)}</span>
                          )}
                        </td>
                      ))}
                      <td className="text-right font-semibold text-slate-900 text-xs">{total.toFixed(2)}</td>
                      <td className={`text-right text-xs font-semibold ${lineProfitRow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {lineProfitRow.toFixed(2)}
                      </td>
                      <td>
                        {line.id ? (
                          <div className="flex items-center gap-1">
                            <Badge
                              color={line.paymentStatus === 'CONFIRMED' ? 'green' : line.paymentStatus === 'REJECTED' ? 'red' : 'yellow'}
                            >
                              {line.paymentStatus === 'CONFIRMED' ? 'Confirmed' : line.paymentStatus === 'REJECTED' ? 'Rejected' : 'Pending'}
                            </Badge>
                            {canEdit && line.paymentStatus === 'PENDING' && (
                              <div className="flex gap-1 ml-1">
                                <button
                                  onClick={() => confirmPayment(line.id!, 'CONFIRMED')}
                                  disabled={confirmingLine === line.id}
                                  className="text-green-600 hover:text-green-800"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => confirmPayment(line.id!, 'REJECTED')}
                                  disabled={confirmingLine === line.id}
                                  className="text-red-500 hover:text-red-700"
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
                    <td colSpan={canEdit ? 2 : 1} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
