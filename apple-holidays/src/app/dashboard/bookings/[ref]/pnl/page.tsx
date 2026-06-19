'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { Plus, Trash2, Save, Loader2, CheckCircle, XCircle, Upload, Hash, Paperclip, X, Info, Sparkles, HardDrive, RefreshCw } from 'lucide-react'
import Modal from '@/components/ui/modal'
import Header from '@/components/layout/header'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDateTime, computePNLLineTotal, isCreditAgent } from '@/lib/utils'
import FileUpload from '@/components/shared/file-upload'
import type { UserRole } from '@prisma/client'

const CATEGORIES = ['HOTEL', 'TICKETS', 'GUIDES', 'MEALS', 'CRUISE', 'WATER', 'TRANSPORT', 'TAX_FEES', 'FLIGHT_TICKETS', 'OTHER']

interface Line {
  id?: string
  sortOrder?: number
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
  paymentConfirmedAt?: string | null
  paymentConfirmedBy?: string | null
  notes: string
  totalCost?: number
}

interface PNLRecord {
  id: string
  paxAdults: number
  paxChildren: number
  sourceDocUrl?: string | null
  lockedAt?: string | null
  createdAt?: string
  updatedAt?: string
  bookingAgent?: string | null
  totalRevenue?: number
  totalCost?: number
  profit?: number
  margin?: number
  lineItems?: Line[]
}

export default function PNLPage() {
  const { ref } = useParams<{ ref: string }>()
  const { data: session } = useSession()
  const role = session?.user?.role as UserRole

  const [pnl, setPnl] = useState<PNLRecord | null>(null)
  const [bookingAgent, setBookingAgent] = useState<string | null>(null)
  const [paxAdults, setPaxAdults] = useState('2')
  const [paxChildren, setPaxChildren] = useState('0')
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmingLine, setConfirmingLine] = useState<string | null>(null)
  const [showUpload, setShowUpload]         = useState(false)
  const [syncingOneDrive, setSyncingOneDrive] = useState(false)
  const [syncResult, setSyncResult]           = useState<{ found: boolean; message: string } | null>(null)

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{ lineId: string; action: 'CONFIRMED' | 'REJECTED'; activity: string } | null>(null)
  const [refInput, setRefInput] = useState('')
  const [billFile, setBillFile]   = useState<File | null>(null)
  const [billUrl,  setBillUrl]    = useState<string | null>(null)
  const [billName, setBillName]   = useState<string | null>(null)
  const [uploadingBill, setUploadingBill] = useState(false)

  // AI category auto-classification: tracks which line indices are currently classifying
  const [classifyingLines, setClassifyingLines] = useState<Set<number>>(new Set())
  const debounceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const canEdit           = ['BT_USER', 'AC_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const canConfirmPayment = ['AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN'].includes(role)
  const isCreditBk        = isCreditAgent(bookingAgent)

  const loadPNL = useCallback(async () => {
    try {
      const res  = await fetch(`/api/bookings/${ref}/pnl`)
      const json = await res.json()
      if (json.success && json.data) {
        const data = json.data as PNLRecord
        setPnl(data)
        setBookingAgent(data.bookingAgent ?? null)
        setPaxAdults(String(data.paxAdults ?? 2))
        setPaxChildren(String(data.paxChildren ?? 0))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setLines(((data.lineItems ?? []) as any[]).map((l: any) => ({
          id:               l.id as string,
          sortOrder:        l.sortOrder as number | undefined,
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
          paymentConfirmedAt: l.paymentConfirmedAt as string | null,
          paymentConfirmedBy: l.paymentConfirmedBy as string | null,
          notes:            (l.notes as string) ?? '',
          totalCost:        Number(l.totalCost ?? 0),
        })))
      }
    } finally {
      setLoading(false)
    }
  }, [ref])

  useEffect(() => { loadPNL() }, [loadPNL])

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

  const handleActivityChange = useCallback((idx: number, value: string) => {
    setLines(ls => ls.map((l, j) => j === idx ? { ...l, activity: value } : l))

    // Cancel any in-flight debounce for this row
    const existing = debounceTimers.current.get(idx)
    if (existing) clearTimeout(existing)

    if (!value.trim()) return

    // Debounce: wait 700ms after user stops typing, then classify
    const timer = setTimeout(async () => {
      setClassifyingLines(s => { const n = new Set(s); n.add(idx); return n })
      try {
        const res = await fetch('/api/ai/classify-category', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity: value }),
        })
        const json = await res.json()
        if (json.success && json.data?.category) {
          setLines(ls => ls.map((l, j) => j === idx ? { ...l, category: json.data.category } : l))
        }
      } catch {
        // silently ignore — user can set manually
      } finally {
        setClassifyingLines(s => { const n = new Set(s); n.delete(idx); return n })
        debounceTimers.current.delete(idx)
      }
    }, 700)

    debounceTimers.current.set(idx, timer)
  }, [])

  async function syncFromOneDrive() {
    setSyncingOneDrive(true)
    setSyncResult(null)
    try {
      const res  = await fetch('/api/onedrive/sync', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ bookingRef: ref }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Sync failed')

      const results: { pnlsUpdated: number; bookingsCreated: number; bookingsUpdated: number; errors: number }[] =
        json.data?.results ?? []
      const pnlFound = results.some(r => r.pnlsUpdated > 0)
      const errors   = results.reduce((s, r) => s + r.errors, 0)

      if (pnlFound) {
        setSyncResult({ found: true, message: 'PNL synced from OneDrive successfully' })
        toast.success('PNL data loaded from OneDrive')
        await loadPNL()
      } else if (errors > 0) {
        setSyncResult({ found: false, message: 'Sync completed with errors — check OneDrive Monitor for details' })
        toast.error('Sync encountered errors')
      } else {
        setSyncResult({ found: false, message: 'No PNL file found in the OneDrive booking folder' })
        toast.warning('No PNL file found in OneDrive for this booking')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed'
      setSyncResult({ found: false, message: msg })
      toast.error(msg)
    } finally {
      setSyncingOneDrive(false)
    }
  }

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
        mmtRate:    String(l.mmtRate || 0),
        sicRate:    String(l.sicRate || 0),
        pvtRatePP:  String(l.pvtRatePP || 0),
        adEntrance: String(l.adEntrance || 0),
        chEntrance: String(l.chEntrance || 0),
        otherRate:  String(l.otherRate || 0),
        notes:      '',
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
          <div className="flex gap-2">
            <button
              onClick={syncFromOneDrive}
              disabled={syncingOneDrive}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 transition-colors"
              title="Search OneDrive for PNL file and import data"
            >
              {syncingOneDrive
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Syncing…</>
                : <><HardDrive className="w-3.5 h-3.5" /><RefreshCw className="w-3 h-3 -ml-0.5" /> Sync from OneDrive</>
              }
            </button>
            {canEdit && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setShowUpload(!showUpload)} icon={<Upload className="w-4 h-4" />}>
                  Import P&L
                </Button>
                <Button size="sm" loading={saving} icon={<Save className="w-4 h-4" />} onClick={savePNL}>
                  Save P&L
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="p-8 space-y-6 max-w-7xl">

        {/* BT_USER info banner */}
        {role === 'BT_USER' && (
          <div className="flex items-start gap-3 p-4 bg-brand-50 border border-brand-200 rounded-xl">
            <Info className="w-5 h-5 text-brand-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-brand-800">Upload P&L with your booking</p>
              <p className="text-xs text-brand-600 mt-0.5">
                Import the Excel spreadsheet or add lines manually, then click <strong>Save P&L</strong>.
                Tickets and vouchers will be auto-created from Hotel, Cruise, Tickets, and other service lines —
                the Ground Team will activate them before the trip.
              </p>
            </div>
          </div>
        )}

        {/* OneDrive sync result banner */}
        {syncResult && (
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${syncResult.found ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
            <HardDrive className={`w-4 h-4 flex-shrink-0 mt-0.5 ${syncResult.found ? 'text-green-600' : 'text-amber-500'}`} />
            <p className={`text-sm font-medium ${syncResult.found ? 'text-green-800' : 'text-amber-800'}`}>
              {syncResult.message}
            </p>
            <button onClick={() => setSyncResult(null)} className="ml-auto text-slate-400 hover:text-slate-600 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

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

        {pnl && (
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">P&L Record Details</h3>
                <p className="text-xs text-slate-500 mt-1">Metadata and source document information for this booking P&L.</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Adults</p>
                  <p className="font-semibold text-slate-900">{pnl.paxAdults}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Children</p>
                  <p className="font-semibold text-slate-900">{pnl.paxChildren}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Locked</p>
                  <p className="font-semibold text-slate-900">{pnl.lockedAt ? formatDateTime(pnl.lockedAt) : 'No'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Source file</p>
                  {pnl.sourceDocUrl ? (
                    <a href={pnl.sourceDocUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 hover:underline">
                      Open source document
                    </a>
                  ) : (
                    <p className="font-semibold text-slate-900">Not stored</p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Created</p>
                  <p className="font-semibold text-slate-900">{pnl.createdAt ? formatDateTime(pnl.createdAt) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Updated</p>
                  <p className="font-semibold text-slate-900">{pnl.updatedAt ? formatDateTime(pnl.updatedAt) : '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Total Revenue</p>
                  <p className="font-semibold text-slate-900">{formatCurrency(pnl.totalRevenue ?? totalRevenue)}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Total Cost</p>
                  <p className="font-semibold text-slate-900">{formatCurrency(pnl.totalCost ?? totalCost)}</p>
                </div>
              </div>
            </div>
          </Card>
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
            { label: 'Total Revenue ', value: formatCurrency(totalRevenue), color: 'text-slate-900' },
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
                  <th className="w-10">#</th>
                  <th className="min-w-[180px]">Activity</th>
                  <th>Category</th>
                  <th className="text-right">MMT Rate</th>
                  <th className="text-right">SIC Rate</th>
                  <th className="text-right">PVT PP</th>
                  <th className="text-right">AD Entry</th>
                  <th className="text-right">CH Entry</th>
                  <th className="text-right">Other</th>
                  <th className="text-right font-semibold">Total Apple Rate</th>
                  <th className="text-right">Profit</th>
                  <th>Notes</th>
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
                      <td className="text-xs text-slate-400 font-mono">{line.sortOrder ?? i + 1}</td>
                      <td>
                        {canEdit ? (
                          <input className="form-input text-xs py-1" value={line.activity}
                            onChange={e => handleActivityChange(i, e.target.value)} />
                        ) : (
                          <span className="text-xs font-medium">{line.activity}</span>
                        )}
                      </td>
                      <td>
                        {canEdit ? (
                          <div className="relative inline-flex items-center">
                            <select className="form-select text-xs py-1 w-28" value={line.category}
                              onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, category: e.target.value } : l))}>
                              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                            </select>
                            {classifyingLines.has(i) && (
                              <Sparkles className="w-3 h-3 text-brand-500 animate-pulse absolute -right-4" aria-label="AI classifying…" />
                            )}
                          </div>
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
                      <td className="text-right font-semibold text-slate-900 text-xs">{(line.totalCost ?? total).toFixed(2)}</td>
                      <td className={`text-right text-xs font-semibold ${lineProfitRow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {lineProfitRow.toFixed(2)}
                      </td>

                      <td>
                        {canEdit ? (
                          <input
                            className="form-input text-xs py-1 w-44"
                            value={line.notes}
                            onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, notes: e.target.value } : l))}
                            placeholder="Notes"
                          />
                        ) : (
                          <span className="text-xs text-slate-600">{line.notes || '—'}</span>
                        )}
                      </td>

                      {/* Payment cell — only for non-credit agents */}
                      {!isCreditBk && (
                        <td>
                          {line.id ? (
                            <div className="flex flex-col gap-1">
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
                                {canConfirmPayment && line.paymentStatus === 'PENDING' && (
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
                              <div className="text-[11px] text-slate-500 space-y-0.5">
                                {line.paymentRefNumber && <div className="font-mono">Ref #{line.paymentRefNumber}</div>}
                                {line.paymentConfirmedAt && <div>Confirmed {formatDateTime(line.paymentConfirmedAt)}</div>}
                                {line.paymentConfirmedBy && <div className="font-mono">By {line.paymentConfirmedBy}</div>}
                              </div>
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
                    <td colSpan={3} className="px-4 py-3 text-sm font-bold text-slate-900">TOTALS</td>
                    <td className="text-right px-4 py-3 text-sm font-bold">{totalRevenue.toFixed(2)}</td>
                    <td colSpan={5} />
                    <td className="text-right px-4 py-3 text-sm font-bold">{totalCost.toFixed(2)}</td>
                    <td className={`text-right px-4 py-3 text-sm font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {profit.toFixed(2)}
                    </td>
                    <td />
                    {((!isCreditBk ? 1 : 0) + (canEdit ? 1 : 0)) > 0 && (
                      <td colSpan={(!isCreditBk ? 1 : 0) + (canEdit ? 1 : 0)} />
                    )}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      </div>

      {/* Payment Confirmation Modal — AC_USER only, non-credit agents */}
      <Modal
        open={!!confirmModal && !isCreditBk && canConfirmPayment}
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
