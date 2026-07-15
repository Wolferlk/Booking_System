'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Truck, ChevronDown, ChevronUp, Loader2, Pencil, Save, X, Download,
  Send, RefreshCw, Plus, Trash2, Ticket, Fuel, Wallet, AlertCircle,
  Phone, CheckCircle2, ArrowRightLeft, Route,
} from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Button from '@/components/ui/button'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  CATEGORY_LABEL, computeDriverLog, TOUR_CATEGORIES, FUEL_CATEGORIES,
  formatDetailMeta, resolveKmRate, applyKmEdit,
  type DriverLogCategory, type DriverLogLine,
} from '@/lib/driver-log'
import type { UserRole } from '@prisma/client'

// Currencies offered by the display-currency converter (must mirror the server's
// SUPPORTED_TARGET_CURRENCIES in @/lib/currency).
const CONVERT_CURRENCIES = ['USD', 'LKR', 'VND', 'MYR', 'SGD'] as const

// ── Types mirroring the API's DriverLogView ─────────────────────────────────

interface Computation {
  currency: string
  tourPct: number
  fuelPct: number
  lines: DriverLogLine[]
  tourLines: DriverLogLine[]
  fuelLines: DriverLogLine[]
  otherLines: DriverLogLine[]
  excludedLines: DriverLogLine[]
  tourTotal: number
  otherTotal: number
  tourAdvanceBase: number
  fuelTotal: number
  tourAdvance: number
  fuelAdvance: number
  excludedTotal: number
  grandTotal: number
  grandAdvance: number
  restPayment: number
}

interface DriverLogView {
  bookingRef: string
  leadPassenger: string | null
  arrivalDate: string | null
  departureDate: string | null
  paxAdults: number | null
  paxChildren: number | null
  pnlLinked: boolean
  isSaved: boolean
  driverName: string | null
  driverPhone: string | null
  allocationPhone: string | null
  autoSend: boolean
  autoSendGlobal: boolean
  waSentAt: string | null
  notes: string
  defaults: { tourPct: number; fuelPct: number }
  computation: Computation
  freshLines: DriverLogLine[]
}

interface Props {
  bookingRef: string
  role: UserRole
  /** Start expanded (used by the standalone full-page Driver Log view). */
  defaultOpen?: boolean
}

const WRITE_ROLES: UserRole[] = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

const CATEGORY_OPTIONS: DriverLogCategory[] = [
  'TOUR_LUNCH', 'TOUR_ENTRANCE', 'FUEL_ACCOMMODATION', 'FUEL_TRAVEL', 'FUEL_WATER', 'EXCLUDED', 'OTHER',
]

// ── Component ────────────────────────────────────────────────────────────────

export default function DriverLogPanel({ bookingRef, role, defaultOpen = false }: Props) {
  const canEdit = WRITE_ROLES.includes(role)

  const [open, setOpen]       = useState(defaultOpen)
  const [view, setView]       = useState<DriverLogView | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded]   = useState(false)

  // Edit state
  const [editing, setEditing]     = useState(false)
  const [lines, setLines]         = useState<DriverLogLine[]>([])
  const [tourPct, setTourPct]     = useState(0)
  const [fuelPct, setFuelPct]     = useState(0)
  const [driverPhone, setDriverPhone] = useState('')
  const [notes, setNotes]         = useState('')
  const [autoSend, setAutoSend]   = useState(false)
  const [saving, setSaving]       = useState(false)

  const [downloading, setDownloading] = useState(false)
  const [sending, setSending]         = useState(false)

  // Display-currency conversion (view-only; stored amounts stay in base currency)
  const DEFAULT_DISPLAY_CUR = 'LKR'
  const [displayCur, setDisplayCur] = useState<string>('')     // '' = show base currency
  const [fxRate, setFxRate]         = useState(1)
  const [fxLoading, setFxLoading]   = useState(false)
  const [fxManual, setFxManual]     = useState(false)          // user hand-edited the rate
  const [fxInit, setFxInit]         = useState(false)          // default LKR applied once

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/driver-log`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setView(json.data as DriverLogView)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load Driver Log')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [bookingRef])

  useEffect(() => { if (open && !loaded) load() }, [open, loaded, load])

  // ── Sync edit state from a loaded view ──────────────────────────────────────
  function enterEdit() {
    if (!view) return
    setLines(view.computation.lines.map(l => ({ ...l })))
    setTourPct(view.computation.tourPct)
    setFuelPct(view.computation.fuelPct)
    setDriverPhone(view.driverPhone ?? '')
    setNotes(view.notes ?? '')
    setAutoSend(view.autoSend)
    setEditing(true)
  }

  // Live recompute while editing so totals update as the user types.
  const liveComp = useMemo(() => (
    editing ? computeDriverLog(lines, { currency: view?.computation.currency ?? 'USD', tourPct, fuelPct }) : null
  ), [editing, lines, tourPct, fuelPct, view])

  const comp = liveComp ?? view?.computation ?? null

  // ── Line editing helpers ────────────────────────────────────────────────────
  function updateLine(id: string, patch: Partial<DriverLogLine>) {
    setLines(prev => prev.map(l => (l.id === id ? { ...l, ...patch } : l)))
  }
  function removeLine(id: string) {
    setLines(prev => prev.filter(l => l.id !== id))
  }
  function addLine() {
    setLines(prev => [...prev, {
      id: `manual-${Date.now()}`, category: 'OTHER', label: 'New line', detail: '', amount: 0, source: 'manual',
    }])
  }

  // Edit KM count / rate on a Travel line → auto-recompute amount (km × rate).
  function updateKm(id: string, km: number, rate?: number) {
    setLines(prev => prev.map(l => (l.id === id ? applyKmEdit(l, km, rate) : l)))
  }

  function recomputeFromPnl() {
    if (!view) return
    setLines(view.freshLines.map(l => ({ ...l })))
    setTourPct(view.defaults.tourPct)
    setFuelPct(view.defaults.fuelPct)
    toast.success('Reset from Accounts PNL — review and save')
  }

  // ── Display-currency conversion ─────────────────────────────────────────────
  const baseCur = view?.computation.currency ?? 'USD'

  async function changeDisplayCurrency(target: string, opts?: { silent?: boolean }) {
    setFxManual(false)
    // Empty or same-as-base → show raw stored amounts, no API call.
    if (!target || target.toUpperCase() === baseCur.toUpperCase()) {
      setDisplayCur(''); setFxRate(1); return
    }
    setFxLoading(true)
    try {
      const res  = await fetch(`/api/currency/rate?from=${encodeURIComponent(baseCur)}&to=${encodeURIComponent(target)}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setFxRate(Number(json.data.rate) || 1)
      setDisplayCur(target)
    } catch (err) {
      if (opts?.silent) {
        // Automatic default failed (e.g. key not configured) — fall back to base.
        setDisplayCur(''); setFxRate(1)
      } else {
        // User explicitly picked this currency — keep it and let them type the
        // rate in by hand rather than snapping back to base.
        toast.error(`${err instanceof Error ? err.message : 'Live rate unavailable'} — enter the rate manually`)
        setDisplayCur(target); setFxRate(1); setFxManual(true)
      }
    } finally {
      setFxLoading(false)
    }
  }

  // Default the display currency to LKR once the view has loaded (Sri Lanka
  // operations hand LKR to the driver). The user can switch it or override the rate.
  useEffect(() => {
    if (view && !fxInit && !editing) {
      setFxInit(true)
      changeDisplayCurrency(DEFAULT_DISPLAY_CUR, { silent: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, fxInit, editing])

  // Effective display currency + a money formatter that applies the live rate.
  // Conversion is display-only and disabled while editing (edits stay in base).
  const showCur = editing || !displayCur ? baseCur : displayCur
  const rate    = editing || !displayCur ? 1 : fxRate
  const money   = useCallback(
    (v: number) => formatCurrency((Number(v) || 0) * rate, showCur),
    [rate, showCur],
  )

  // ── Save ────────────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/driver-log`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tourPct, fuelPct, driverPhone: driverPhone || null, lines, notes, autoSend }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setView(json.data as DriverLogView)
      setEditing(false)
      toast.success('Driver Log saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Download PDF ──────────────────────────────────────────────────────────
  async function downloadPdf() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/driver-log/pdf`)
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error ?? `PDF failed (${res.status})`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `DriverAdvance-${bookingRef}.pdf`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  // ── Send WhatsApp ───────────────────────────────────────────────────────────
  async function sendWhatsApp() {
    const phone = (editing ? driverPhone : view?.driverPhone) ?? ''
    if (!phone.trim()) { toast.error('No driver WhatsApp number set'); return }
    if (!confirm(`Send the Driver Advance Sheet to ${phone} on WhatsApp?`)) return
    setSending(true)
    try {
      const res = await fetch(`/api/bookings/${bookingRef}/driver-log/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Sent to driver')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  // ── Collapsed button ────────────────────────────────────────────────────────
  if (!open) {
    return (
      <Card>
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 rounded-xl transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-50">
              <Truck className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Driver Advance Sheet</h3>
              <p className="text-xs text-slate-500">Tour &amp; fuel advances from Accounts PNL · print / WhatsApp to driver</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
            Open <ChevronDown className="w-4 h-4" />
          </span>
        </button>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        action={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {view?.waSentAt && !editing && (
              <span className="text-[10px] text-emerald-600 font-medium inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Sent {formatDateTime(view.waSentAt)}
              </span>
            )}
            {!editing && (
              <>
                <button
                  onClick={downloadPdf}
                  disabled={downloading || !view}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition-colors"
                >
                  {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                  PDF
                </button>
                {canEdit && (
                  <button
                    onClick={sendWhatsApp}
                    disabled={sending || !view}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                  >
                    {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    WhatsApp
                  </button>
                )}
                {canEdit && view && (
                  <button
                    onClick={enterEdit}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                )}
              </>
            )}
            {editing && (
              <>
                <button
                  onClick={recomputeFromPnl}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                  title="Reset all lines & percentages from the linked Accounts PNL"
                >
                  <RefreshCw className="w-3 h-3" /> Reset from PNL
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-emerald-200 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  <X className="w-3 h-3" /> Cancel
                </button>
              </>
            )}
            <button onClick={() => { setOpen(false); setEditing(false) }} className="text-slate-400 hover:text-slate-600">
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Truck className="w-4 h-4 text-amber-600" />
          <h3 className="text-sm font-bold text-slate-900">Driver Advance Sheet</h3>
          {view?.isSaved
            ? <Badge color="green">Saved</Badge>
            : <Badge color="gray">Auto-computed</Badge>}
          {view && !view.pnlLinked && <Badge color="yellow">No PNL linked</Badge>}
          {view?.autoSendGlobal && (
            <span className="text-[10px] text-slate-400">Auto-send 6pm: <strong className="text-slate-600">ON</strong></span>
          )}
        </div>
      </CardHeader>

      <div className="p-5 space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        )}

        {!loading && view && !view.pnlLinked && lines.length === 0 && comp && comp.lines.length === 0 && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              No Accounts PNL is linked to this booking yet, so there is nothing to compute automatically.
              Link a PNL in the Accounts PNL panel above, or {canEdit ? 'add lines manually via Edit.' : 'ask Accounts to link one.'}
            </p>
          </div>
        )}

        {!loading && comp && (
          <>
            {/* ── Driver + meta ── */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <span className="text-slate-500">Driver: <strong className="text-slate-800">{view?.driverName ?? '—'}</strong></span>
              <span className="inline-flex items-center gap-1 text-slate-500">
                <Phone className="w-3 h-3" />
                {editing ? (
                  <input
                    value={driverPhone}
                    onChange={e => setDriverPhone(e.target.value)}
                    placeholder="Driver WhatsApp number"
                    className="form-input py-1 text-xs w-48"
                  />
                ) : (
                  <strong className="text-slate-800 font-mono">{view?.driverPhone ?? '— not set —'}</strong>
                )}
                {view && !view.driverPhone && !editing && (
                  <span className="text-[10px] text-amber-500">(no driver allocated)</span>
                )}
              </span>
              <span className="text-slate-500">Guest: <strong className="text-slate-800">{view?.leadPassenger ?? '—'}</strong></span>
            </div>

            {/* ── Display-currency converter (view-only) ── */}
            {!editing && (
              <div className="flex items-center justify-end gap-2 text-xs">
                <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-slate-500">Show amounts in</span>
                <select
                  value={displayCur || baseCur}
                  onChange={e => changeDisplayCurrency(e.target.value)}
                  disabled={fxLoading}
                  className="form-select py-1 text-xs font-semibold"
                >
                  {(CONVERT_CURRENCIES.includes(baseCur.toUpperCase() as typeof CONVERT_CURRENCIES[number])
                    ? CONVERT_CURRENCIES
                    : [baseCur, ...CONVERT_CURRENCIES]
                  ).map(c => (
                    <option key={c} value={c}>{c}{c.toUpperCase() === baseCur.toUpperCase() ? ' (base)' : ''}</option>
                  ))}
                </select>
                {fxLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
                {displayCur && !fxLoading && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-mono">
                    1 {baseCur} =
                    <input
                      type="number" step="0.0001" min={0}
                      value={fxRate}
                      onChange={e => { setFxRate(Number(e.target.value) || 0); setFxManual(true) }}
                      title="Exchange rate — edit to override the live rate"
                      className="form-input py-0.5 w-24 text-[10px] font-mono text-right"
                    />
                    {displayCur}
                    {fxManual
                      ? <span className="text-[9px] text-amber-500 not-italic">manual</span>
                      : <span className="text-[9px] text-slate-300">live</span>}
                  </span>
                )}
              </div>
            )}

            {/* ── Summary cards ── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Tour */}
              <div className="rounded-xl border border-purple-100 bg-purple-50/60 p-4">
                <div className="flex items-center gap-1.5 text-purple-600 mb-2">
                  <Ticket className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wide">Tour Advance</span>
                </div>
                <SummaryRow label="Total" value={money(comp.tourAdvanceBase)} />
                <SummaryRow
                  label="Advance %"
                  value={editing
                    ? <PctInput value={tourPct} onChange={setTourPct} />
                    : <span className="font-mono font-semibold">{comp.tourPct}%</span>}
                />
                <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-purple-200">
                  <span className="text-[11px] font-bold text-purple-700">Advance</span>
                  <span className="text-sm font-mono font-extrabold text-purple-800">{money(comp.tourAdvance)}</span>
                </div>
              </div>
              {/* Fuel */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-center gap-1.5 text-blue-600 mb-2">
                  <Fuel className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wide">Fuel Advance</span>
                </div>
                <SummaryRow label="Total" value={money(comp.fuelTotal)} />
                <SummaryRow
                  label="Advance %"
                  value={editing
                    ? <PctInput value={fuelPct} onChange={setFuelPct} />
                    : <span className="font-mono font-semibold">{comp.fuelPct}%</span>}
                />
                <div className="flex items-center justify-between pt-1.5 mt-1.5 border-t border-blue-200">
                  <span className="text-[11px] font-bold text-blue-700">Advance</span>
                  <span className="text-sm font-mono font-extrabold text-blue-800">{money(comp.fuelAdvance)}</span>
                </div>
              </div>
              {/* Grand */}
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 flex flex-col justify-center">
                <div className="flex items-center gap-1.5 text-emerald-600 mb-1">
                  <Wallet className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-bold uppercase tracking-wide">Total Advance</span>
                </div>
                <p className="text-2xl font-mono font-extrabold text-emerald-700">{money(comp.grandAdvance)}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">of {money(comp.grandTotal)} total</p>
              </div>
            </div>

            {/* ── Rest payment (balance to settle after the advance) ── */}
            <div className="flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3">
              <div className="flex items-center gap-1.5 text-amber-700">
                <Wallet className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wide">Rest Payment</span>
                <span className="text-[10px] text-amber-500 font-normal normal-case">
                  (balance after advance{comp.excludedTotal > 0 ? ` · incl. excluded ${money(comp.excludedTotal)}` : ''})
                </span>
              </div>
              <span className="text-sm font-mono font-extrabold text-amber-800">{money(comp.restPayment)}</span>
            </div>

            {/* ── Line groups ── */}
            <LineGroup
              title="Tour — Lunch & Entrance Tickets"
              accent="purple"
              lines={editing ? lines.filter(l => TOUR_CATEGORIES.includes(l.category)) : comp.tourLines}
              money={money}
              editing={editing}
              onUpdate={updateLine}
              onKm={updateKm}
              onRemove={removeLine}
            />
            <LineGroup
              title="Fuel — Accommodation, Travel (KM × Rate) & Water"
              accent="blue"
              lines={editing ? lines.filter(l => FUEL_CATEGORIES.includes(l.category)) : comp.fuelLines}
              money={money}
              editing={editing}
              onUpdate={updateLine}
              onKm={updateKm}
              onRemove={removeLine}
            />
            {(editing ? lines.filter(l => l.category === 'OTHER') : comp.otherLines).length > 0 && (
              <LineGroup
                title="Other — Advanced as Tour"
                accent="slate"
                lines={editing ? lines.filter(l => l.category === 'OTHER') : comp.otherLines}
                money={money}
                editing={editing}
                onUpdate={updateLine}
                onKm={updateKm}
                onRemove={removeLine}
              />
            )}
            {(editing ? lines.filter(l => l.category === 'EXCLUDED') : comp.excludedLines).length > 0 && (
              <LineGroup
                title="Excluded — Bata & Guide Fee (never advanced)"
                accent="red"
                lines={editing ? lines.filter(l => l.category === 'EXCLUDED') : comp.excludedLines}
                money={money}
                editing={editing}
                onUpdate={updateLine}
                onKm={updateKm}
                onRemove={removeLine}
              />
            )}

            {/* ── Edit-only controls ── */}
            {editing && (
              <div className="space-y-3">
                <button
                  onClick={addLine}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>

                <div>
                  <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Notes (shown on the sheet)</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Any note for the driver / ground team…"
                    className="form-textarea w-full text-xs mt-1"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} className="rounded" />
                  Include in the automatic 6pm (day-before) WhatsApp send for this booking
                  {!view?.autoSendGlobal && <span className="text-[10px] text-amber-500">(global auto-send is OFF)</span>}
                </label>
              </div>
            )}

            {/* ── Footer note ── */}
            {!editing && (
              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                Tour advance = Lunch + Entrance tickets + Other. Fuel advance = Driver Accommodation + Travel (KM × Rate) + Water Bottles.
                Rest Payment = total − total advance + Bata &amp; Guide Fee (excluded, settled with the balance).
                Percentages are configured in Settings; edit here to override per booking.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-xs text-slate-600">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function PctInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={0} max={100} step={1}
        value={value}
        onChange={e => onChange(Math.min(100, Math.max(0, Number(e.target.value))))}
        className="form-input py-0.5 w-16 text-xs font-mono text-right"
      />
      <span className="text-slate-400">%</span>
    </span>
  )
}

const ACCENTS: Record<string, { head: string; border: string; foot: string }> = {
  purple: { head: 'text-purple-700', border: 'border-purple-100', foot: 'bg-purple-50/60 text-purple-700' },
  blue:   { head: 'text-blue-700',   border: 'border-blue-100',   foot: 'bg-blue-50/60 text-blue-700' },
  slate:  { head: 'text-slate-600',  border: 'border-slate-200',  foot: 'bg-slate-50 text-slate-600' },
  red:    { head: 'text-red-700',    border: 'border-red-100',    foot: 'bg-red-50/60 text-red-700' },
}

/** Small labelled chip used to render a structured detail breakdown. */
function DetailChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
      <span className="text-slate-400">{label}</span>
      <span className="font-mono font-semibold text-slate-700">{value}</span>
    </span>
  )
}

/** Read-only rich rendering of a line's structured detail meta. */
function LineDetail({ line }: { line: DriverLogLine }) {
  const m = line.meta
  const chips: React.ReactNode[] = []
  if (m) {
    if (m.km != null && m.rate != null) {
      chips.push(<DetailChip key="km" label="Distance" value={`${m.km.toLocaleString('en-US')} KM`} />)
      chips.push(<DetailChip key="rate" label="Rate" value={`${m.rate.toLocaleString('en-US', { maximumFractionDigits: 4 })} / KM`} />)
    } else if (m.nights != null && m.nights > 0) {
      chips.push(<DetailChip key="nights" label="Nights" value={m.nights.toLocaleString('en-US')} />)
    } else {
      if (m.adult_count != null) chips.push(<DetailChip key="ad" label="Adult" value={`${m.adult_count}${m.adult_rate != null ? ` × ${m.adult_rate}` : ''}`} />)
      if (m.child_count != null) chips.push(<DetailChip key="ch" label="Child" value={`${m.child_count}${m.child_rate != null ? ` × ${m.child_rate}` : ''}`} />)
      if (m.transfer_amount != null && m.transfer_amount > 0) chips.push(<DetailChip key="tr" label="Transfer" value={m.transfer_amount.toLocaleString('en-US')} />)
    }
  }

  const fallback = formatDetailMeta(m) || line.detail
  return (
    <div className="text-[10px] text-slate-400 mt-0.5 space-y-1">
      <div>{CATEGORY_LABEL[line.category]}{fallback && chips.length === 0 ? ` · ${fallback}` : ''}</div>
      {chips.length > 0 && <div className="flex flex-wrap gap-1">{chips}</div>}
    </div>
  )
}

function LineGroup({
  title, accent, lines, money, editing, onUpdate, onKm, onRemove,
}: {
  title: string
  accent: keyof typeof ACCENTS
  lines: DriverLogLine[]
  money: (v: number) => string
  editing: boolean
  onUpdate: (id: string, patch: Partial<DriverLogLine>) => void
  onKm: (id: string, km: number, rate?: number) => void
  onRemove: (id: string) => void
}) {
  const a = ACCENTS[accent]
  const total = lines.reduce((s, l) => s + Number(l.amount || 0), 0)

  return (
    <div>
      <h4 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${a.head}`}>{title}</h4>
      <div className={`overflow-x-auto rounded-xl border ${a.border}`}>
        <table className="w-full text-xs">
          <tbody>
            {lines.length === 0 && (
              <tr><td className="text-center text-slate-400 py-3">No items</td></tr>
            )}
            {lines.map(l => {
              const km = resolveKmRate(l)
              return (
              <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-2 align-top">
                  {editing ? (
                    <div className="space-y-1.5">
                      <input
                        value={l.label}
                        onChange={e => onUpdate(l.id, { label: e.target.value })}
                        className="form-input py-1 text-xs w-full"
                        placeholder="Label"
                      />
                      <div className="flex items-center gap-1.5">
                        <ArrowRightLeft className="w-3 h-3 text-slate-300" />
                        <select
                          value={l.category}
                          onChange={e => onUpdate(l.id, { category: e.target.value as DriverLogCategory })}
                          className="form-select py-1 text-[11px]"
                          title="Move this item to another category — totals recompute automatically"
                        >
                          {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                        </select>
                        {l.source === 'pnl'
                          ? <span className="text-[10px] text-slate-400">from PNL</span>
                          : <span className="text-[10px] text-brand-500">manual</span>}
                      </div>
                      {/* KM × rate editor — auto-recomputes the amount */}
                      {km && (
                        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-blue-50/70 border border-blue-100 px-2 py-1.5">
                          <Route className="w-3 h-3 text-blue-500" />
                          <label className="text-[10px] text-blue-600">KM</label>
                          <input
                            type="number" step="1" min={0}
                            value={km.km}
                            onChange={e => onKm(l.id, Number(e.target.value), km.rate)}
                            className="form-input py-0.5 w-20 text-xs font-mono text-right"
                          />
                          <span className="text-[10px] text-blue-400">×</span>
                          <label className="text-[10px] text-blue-600">Rate</label>
                          <input
                            type="number" step="0.0001" min={0}
                            value={km.rate}
                            onChange={e => onKm(l.id, km.km, Number(e.target.value))}
                            className="form-input py-0.5 w-24 text-xs font-mono text-right"
                          />
                          <span className="text-[10px] text-blue-500 font-mono">= {money(l.amount)}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="font-medium text-slate-800">{l.label}</div>
                      <LineDetail line={l} />
                    </>
                  )}
                </td>
                <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                  {editing ? (
                    <input
                      type="number" step="0.01"
                      value={l.amount}
                      onChange={e => onUpdate(l.id, { amount: Number(e.target.value) })}
                      disabled={!!km}
                      title={km ? 'Auto-computed from KM × Rate' : undefined}
                      className="form-input py-1 w-24 text-xs font-mono text-right disabled:bg-slate-50 disabled:text-slate-400"
                    />
                  ) : (
                    <span className="font-mono font-semibold text-slate-700">{money(l.amount)}</span>
                  )}
                </td>
                {editing && (
                  <td className="px-2 py-2 align-top">
                    <button onClick={() => onRemove(l.id)} className="text-slate-300 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            )})}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className={a.foot}>
                <td className="px-3 py-1.5 text-[11px] font-bold text-right">Subtotal</td>
                <td className="px-3 py-1.5 text-right font-mono font-bold whitespace-nowrap">{money(total)}</td>
                {editing && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
