'use client'

/**
 * Manual P&L upload — the fallback for bookings the Accounts costing sheet has
 * no record of.
 *
 * The Detailed P&L panel reads the Accounts system's own sheet, matched on the
 * IS number. When that match fails there is nothing to cost tickets from, and
 * until now the page ended there. This panel lets Accounts or the Booking team
 * upload the P&L file (or type the lines by hand), store it against the booking
 * as ordinary `PNL` / `PNLLineItem` rows, and turn those lines into tickets.
 *
 * Two separate writes, deliberately:
 *   Save     → POST /api/bookings/[ref]/pnl              — replaces the stored P&L
 *   Tickets  → POST /api/bookings/[ref]/pnl/create-tickets — additive, skips lines
 *                                                            that already have one
 * Saving is destructive by design (the endpoint wipes and rewrites every line),
 * so an existing stored P&L is shown first and the upload form is opened only
 * on request.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Loader2, Upload, Save, Ticket, Plus, Trash2, ArrowRight,
  FileSpreadsheet, AlertTriangle, X,
} from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import Button from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import FileUpload from '@/components/shared/file-upload'
import type { UserRole, PNLCategory } from '@prisma/client'

const CATEGORIES: PNLCategory[] = [
  'HOTEL', 'TICKETS', 'GUIDES', 'MEALS', 'CRUISE',
  'WATER', 'TRANSPORT', 'TAX_FEES', 'FLIGHT_TICKETS', 'OTHER',
]

/** Roles that may store a P&L on a booking — mirrors `pnl:create` in rbac.ts. */
const CAN_UPLOAD: UserRole[] = ['BT_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

interface DraftLine {
  activity:   string
  category:   PNLCategory
  mmtRate:    number
  sicRate:    number
  pvtRatePP:  number
  adEntrance: number
  chEntrance: number
  otherRate:  number
}

interface StoredLine extends DraftLine {
  id: string
  totalCost: number
}

interface StoredPnl {
  lineItems:   StoredLine[]
  paxAdults:   number
  paxChildren: number
  totalCost:   number
  totalRevenue: number
  updatedAt:   string | null
}

const emptyLine = (): DraftLine => ({
  activity: '', category: 'OTHER',
  mmtRate: 0, sicRate: 0, pvtRatePP: 0, adEntrance: 0, chEntrance: 0, otherRate: 0,
})

const num = (v: unknown) => Number(v ?? 0) || 0

const lineTotal = (l: DraftLine, adults: number, children: number) =>
  (num(l.sicRate) + num(l.pvtRatePP) + num(l.otherRate)) * (adults + children)
  + num(l.adEntrance) * adults
  + num(l.chEntrance) * children

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface Props {
  bookingRef: string
  role: UserRole
  /** Pax counts from the booking, used when the file carries none. */
  paxAdults?: number
  paxChildren?: number
  /** Called after a save or a ticket run, so the page can refresh. */
  onChanged?: () => void
}

export default function ManualPnlUpload({
  bookingRef, role, paxAdults = 0, paxChildren = 0, onChanged,
}: Props) {
  const [stored, setStored]   = useState<StoredPnl | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)

  const [lines, setLines]     = useState<DraftLine[]>([])
  const [adults, setAdults]   = useState(paxAdults)
  const [children, setChildren] = useState(paxChildren)

  const [saving, setSaving]     = useState(false)
  const [ticketing, setTicketing] = useState(false)
  const [ticketCount, setTicketCount] = useState<number | null>(null)

  const canUpload = CAN_UPLOAD.includes(role)

  const loadStored = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/pnl`)
      const json = await res.json()
      setStored(json.success && json.data ? (json.data as StoredPnl) : null)
    } catch {
      setStored(null)
    } finally {
      setLoading(false)
    }
  }, [bookingRef])

  const loadTicketCount = useCallback(async () => {
    try {
      const res  = await fetch(`/api/tickets?bookingRef=${bookingRef}`)
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) setTicketCount(json.data.length)
    } catch { /* best effort */ }
  }, [bookingRef])

  useEffect(() => { loadStored(); loadTicketCount() }, [loadStored, loadTicketCount])

  useEffect(() => {
    // Pax defaults follow the booking until the file or the user says otherwise.
    setAdults(a => (a === 0 ? paxAdults : a))
    setChildren(c => (c === 0 ? paxChildren : c))
  }, [paxAdults, paxChildren])

  /** The parsed payload from /api/upload — same shape the old P&L intake used. */
  function onParsed(data: Record<string, unknown>) {
    const parsed = Array.isArray(data.lineItems) ? (data.lineItems as Record<string, unknown>[]) : []
    if (parsed.length === 0) {
      toast.warning('No P&L lines were found in that file — add them by hand below.')
    }
    setLines(parsed.map(l => ({
      activity:   String(l.activity ?? ''),
      category:   (CATEGORIES.includes(l.category as PNLCategory) ? l.category : 'OTHER') as PNLCategory,
      mmtRate:    num(l.mmtRate),
      sicRate:    num(l.sicRate),
      pvtRatePP:  num(l.pvtRatePP),
      adEntrance: num(l.adEntrance),
      chEntrance: num(l.chEntrance),
      otherRate:  num(l.otherRate),
    })))
    if (num(data.paxAdults) > 0)   setAdults(num(data.paxAdults))
    if (num(data.paxChildren) > 0) setChildren(num(data.paxChildren))
  }

  function patchLine(i: number, patch: Partial<DraftLine>) {
    setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function save() {
    const clean = lines.filter(l => l.activity.trim())
    if (clean.length === 0) return toast.error('Add at least one line with an activity name')

    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/pnl`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ paxAdults: adults, paxChildren: children, lineItems: clean }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to save the P&L')

      toast.success(`P&L saved — ${clean.length} line${clean.length === 1 ? '' : 's'} stored on this booking`)
      setFormOpen(false)
      setLines([])
      await Promise.all([loadStored(), loadTicketCount()])
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the P&L')
    } finally {
      setSaving(false)
    }
  }

  async function createTickets() {
    setTicketing(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/pnl/create-tickets`, { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to create tickets')
      const { created } = json.data as { created: number; skipped: number }
      if (created > 0) toast.success(json.message)
      else toast.info(json.message)
      await loadTicketCount()
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tickets')
    } finally {
      setTicketing(false)
    }
  }

  const draftTotal = lines.reduce((s, l) => s + lineTotal(l, adults, children), 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-slate-900">Manual P&amp;L</h3>
            <span className="text-xs text-slate-500">Upload the costing file for this booking</span>
            {stored && stored.lineItems.length > 0 && (
              <Badge color="green">{stored.lineItems.length} line{stored.lineItems.length === 1 ? '' : 's'} stored</Badge>
            )}
            {ticketCount != null && (
              <Badge color="blue">{ticketCount} ticket{ticketCount === 1 ? '' : 's'} on booking</Badge>
            )}
          </div>

          {canUpload && (
            <div className="flex items-center gap-2">
              {stored && stored.lineItems.length > 0 && (
                <Button size="sm" onClick={createTickets} disabled={ticketing}>
                  {ticketing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ticket className="w-3.5 h-3.5" />}
                  Create tickets
                </Button>
              )}
              <Button variant={stored ? 'secondary' : 'primary'} size="sm" onClick={() => setFormOpen(o => !o)}>
                {formOpen ? <X className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
                {formOpen ? 'Cancel' : stored && stored.lineItems.length > 0 ? 'Replace P&L' : 'Upload P&L'}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardBody>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-4 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Reading the stored P&amp;L…
          </div>
        )}

        {!loading && !canUpload && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Uploading a P&amp;L for this booking is done by the Accounts or Booking team.
          </div>
        )}

        {!loading && canUpload && !formOpen && (!stored || stored.lineItems.length === 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            The Accounts costing sheet has nothing for this booking. Upload the P&amp;L file here
            (<span className="font-medium">.xlsx, .pdf, .docx, .csv</span>) and tickets can be created from it.
          </div>
        )}

        {/* ── Stored P&L ─────────────────────────────────────────────── */}
        {!loading && !formOpen && stored && stored.lineItems.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 flex-wrap text-xs text-slate-500">
              <span>{stored.paxAdults} adult{stored.paxAdults === 1 ? '' : 's'} · {stored.paxChildren} child{stored.paxChildren === 1 ? '' : 'ren'}</span>
              <span>Total cost <strong className="text-slate-900 font-mono">{money(stored.totalCost)}</strong></span>
              <Link
                href={`/dashboard/bookings/${bookingRef}/tickets`}
                className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:text-indigo-900"
              >
                Open tickets <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left font-semibold px-3 py-2">Activity</th>
                    <th className="text-left font-semibold px-3 py-2">Category</th>
                    <th className="text-right font-semibold px-3 py-2">SIC</th>
                    <th className="text-right font-semibold px-3 py-2">PVT/PP</th>
                    <th className="text-right font-semibold px-3 py-2">Ad. Ent.</th>
                    <th className="text-right font-semibold px-3 py-2">Ch. Ent.</th>
                    <th className="text-right font-semibold px-3 py-2">Other</th>
                    <th className="text-right font-semibold px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stored.lineItems.map(l => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-slate-800">{l.activity}</td>
                      <td className="px-3 py-2"><Badge color="gray">{l.category.replace(/_/g, ' ')}</Badge></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{money(num(l.sicRate))}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{money(num(l.pvtRatePP))}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{money(num(l.adEntrance))}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{money(num(l.chEntrance))}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600">{money(num(l.otherRate))}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900">{money(num(l.totalCost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Upload / edit form ─────────────────────────────────────── */}
        {!loading && canUpload && formOpen && (
          <div className="space-y-4">
            {stored && stored.lineItems.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Saving replaces the {stored.lineItems.length} P&amp;L line{stored.lineItems.length === 1 ? '' : 's'} already
                  stored on this booking. Tickets that have been activated or purchased are kept.
                </span>
              </div>
            )}

            <FileUpload
              uploadType="pnl"
              accept={['.xlsx', '.xls', '.pdf', '.docx', '.csv']}
              label="Upload the P&L file"
              description="Drag & drop, or click to pick the costing sheet"
              onParsed={onParsed}
            />

            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs font-semibold text-slate-600">
                Adults
                <input
                  type="number" min={0} value={adults}
                  onChange={e => setAdults(Math.max(0, Number(e.target.value)))}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm font-mono"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Children
                <input
                  type="number" min={0} value={children}
                  onChange={e => setChildren(Math.max(0, Number(e.target.value)))}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm font-mono"
                />
              </label>
              <span className="text-xs text-slate-400">Pax counts drive every line total.</span>
            </div>

            {lines.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 min-w-[200px]">Activity</th>
                      <th className="text-left font-semibold px-3 py-2">Category</th>
                      <th className="text-right font-semibold px-3 py-2">SIC</th>
                      <th className="text-right font-semibold px-3 py-2">PVT/PP</th>
                      <th className="text-right font-semibold px-3 py-2">Ad. Ent.</th>
                      <th className="text-right font-semibold px-3 py-2">Ch. Ent.</th>
                      <th className="text-right font-semibold px-3 py-2">Other</th>
                      <th className="text-right font-semibold px-3 py-2">Total</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5">
                          <input
                            value={l.activity}
                            onChange={e => patchLine(i, { activity: e.target.value })}
                            placeholder="Activity name"
                            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={l.category}
                            onChange={e => patchLine(i, { category: e.target.value as PNLCategory })}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                          >
                            {CATEGORIES.map(c => (
                              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </td>
                        {(['sicRate', 'pvtRatePP', 'adEntrance', 'chEntrance', 'otherRate'] as const).map(field => (
                          <td key={field} className="px-3 py-1.5">
                            <input
                              type="number" step="0.01" min={0} value={l[field]}
                              onChange={e => patchLine(i, { [field]: Number(e.target.value) } as Partial<DraftLine>)}
                              className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm text-right font-mono"
                            />
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-slate-900">
                          {money(lineTotal(l, adults, children))}
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                            className="text-slate-400 hover:text-rose-600"
                            aria-label="Remove line"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setLines(ls => [...ls, emptyLine()])}>
                <Plus className="w-3.5 h-3.5" /> Add line
              </Button>

              <div className="flex items-center gap-3">
                {lines.length > 0 && (
                  <span className="text-sm text-slate-600">
                    {lines.length} line{lines.length === 1 ? '' : 's'} ·
                    <strong className="ml-1 font-mono text-slate-900">{money(draftTotal)}</strong>
                  </span>
                )}
                <Button size="sm" onClick={save} disabled={saving || lines.length === 0}>
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save P&amp;L &amp; create tickets
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
