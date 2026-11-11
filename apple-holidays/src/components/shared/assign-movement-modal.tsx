'use client'

/**
 * Assign a movement — guide, tour vendor and driver / transport vendor — from
 * anywhere a movement is listed, not only from inside its booking's chart.
 *
 * The MC Report is the page operations actually work the day from, so the same
 * dialog the agenda uses is reachable there: everything a movement needs is
 * chosen in one place and saved through the booking's own agenda endpoint, so
 * the SL allocation board sync and the driver WhatsApp fire exactly as they do
 * from the chart.
 *
 * Guide / tour-vendor pickers appear only for countries Settings has switched
 * that partner kind on for — a Vietnam movement never shows a control the
 * country does not operate with.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Search, Loader2, CheckCircle2, Car, Building2, Phone, AlertTriangle,
  Palmtree, Hotel, UserX, Route,
} from 'lucide-react'
import { toast } from 'sonner'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import PartnerAssignPicker, { EMPTY_SELECTION, type PartnerSelection } from '@/components/partners/partner-assign-picker'
import { isPartnerEnabledForCountry, type PartnerKind } from '@/lib/partner-directory'
import { formatDate } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MovementAssignment {
  driverId?:        string | null
  vendorId?:        string | null
  vendorName?:      string | null
  driverName?:      string | null
  driverPhone?:     string | null
  vehicleType?:     string | null
  vehiclePlate?:    string | null
  driverRate?:      number | null
  rateCurrency?:    string | null
  guideId?:         string | null
  guideName?:       string | null
  guidePhone?:      string | null
  tourVendorId?:    string | null
  tourVendorName?:  string | null
  tourVendorPhone?: string | null
}

/**
 * A movement marked as needing no driver at all — the resolved flags the server
 * stored, handed back so the caller can fold them into its own row. Mirrors the
 * agenda chart's three marks (see driver-requirement.ts): No Driver Needed is
 * BOTH flags on.
 */
export interface NoDriverMark {
  isLeisure:      boolean
  isHotelOnly:    boolean
  noDriverNeeded: boolean
}

type NoDriverKind = 'leisure' | 'none' | 'hotel'

/**
 * Another movement on the same booking the chosen driver can be copied to —
 * Sri Lanka round tours run one driver for the whole file, so the MC Report
 * hands these in to offer "one driver, whole tour".
 */
export interface TourSibling {
  /** `AgendaItem.id` */
  id:   string
  /** `yyyy-mm-dd` — only used for the little day chips. */
  date: string
}

const NO_DRIVER_OPTIONS: {
  kind: NoDriverKind
  label: string
  Icon: typeof Palmtree
  blurb: string
  chip:     string // idle chip classes
  chipOn:   string // selected chip classes
  panel:    string // confirm strip classes
  confirm:  string // confirm button classes
}[] = [
  {
    kind: 'none', label: 'No Driver Needed', Icon: UserX,
    blurb: 'The ground team does not drive this movement — a tour vendor, the hotel or a partner covers it. It leaves the driver allocation count.',
    chip:    'hover:border-slate-400 hover:bg-slate-50 text-slate-600',
    chipOn:  'border-slate-700 bg-slate-700 text-white shadow-md shadow-slate-300',
    panel:   'border-slate-200 bg-slate-50',
    confirm: 'bg-slate-700 hover:bg-slate-800',
  },
  {
    kind: 'leisure', label: "It's Leisure Day", Icon: Palmtree,
    blurb: 'A free / at-leisure day — the guests are on their own and no driver will be allocated.',
    chip:    'hover:border-amber-400 hover:bg-amber-50 text-amber-700',
    chipOn:  'border-amber-500 bg-amber-500 text-white shadow-md shadow-amber-200',
    panel:   'border-amber-200 bg-amber-50',
    confirm: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    kind: 'hotel', label: 'Hotel Only', Icon: Hotel,
    blurb: 'Accommodation only, or the guests arrange their own transport — nothing to drive.',
    chip:    'hover:border-pink-400 hover:bg-pink-50 text-pink-700',
    chipOn:  'border-pink-500 bg-pink-500 text-white shadow-md shadow-pink-200',
    panel:   'border-pink-200 bg-pink-50',
    confirm: 'bg-pink-500 hover:bg-pink-600',
  },
]

interface Driver {
  id: string
  name: string
  phone: string
  photoUrl?: string | null
  isBusyOnDate?: boolean
  busyBookings?: string[]
  vehicle: {
    plateNo: string
    type: string
    brand?: string | null
    model?: string | null
  } | null
}

interface Vendor {
  id: string
  name: string
  phone: string | null
  country: string | null
}

const CURRENCIES = ['USD', 'VND', 'SGD', 'MYR', 'LKR', 'AUD', 'GBP']

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssignMovementModal({
  open, onClose, bookingRef, agendaItemId, date, country, assignment, onSaved,
  onMarkedNoDriver, tourSiblings, onSavedTour,
}: {
  open: boolean
  onClose: () => void
  /** Booking the movement belongs to — the save goes through its agenda route. */
  bookingRef: string
  /** `AgendaItem.id`. A movement that has never been saved cannot be assigned. */
  agendaItemId: string
  /** `yyyy-mm-dd`, used for the driver availability check. */
  date: string
  /** Booking's operation country — scopes drivers, vendors and partner pickers. */
  country: string | null | undefined
  /** Who currently holds the movement, if anyone. */
  assignment: MovementAssignment | null
  /** Fires with what was saved (null when the assignment was removed). */
  onSaved: (next: MovementAssignment | null) => void
  /**
   * When given, the dialog also offers the three "no driver" day marks —
   * Leisure Day, Hotel Only and No Driver Needed. Fires after the mark is
   * saved (which releases any held driver), so the caller can update its row.
   */
  onMarkedNoDriver?: (mark: NoDriverMark) => void
  /**
   * The booking's other still-assignable movements. When given (Sri Lanka round
   * tours), the dialog offers to copy the saved assignment onto every one of
   * them in the same go — one driver for the whole file.
   */
  tourSiblings?: TourSibling[]
  /** Fires with the sibling ids that were successfully given the assignment. */
  onSavedTour?: (ids: string[], next: MovementAssignment) => void
}) {
  const [mode,           setMode]           = useState<'driver' | 'vendor'>('driver')
  const [drivers,        setDrivers]        = useState<Driver[]>([])
  const [vendors,        setVendors]        = useState<Vendor[]>([])
  const [vendorDrivers,  setVendorDrivers]  = useState<Driver[]>([])
  const [loadingDrivers, setLoadingDrivers] = useState(false)
  const [loadingVendorDrivers, setLoadingVendorDrivers] = useState(false)
  const [driverSearch,   setDriverSearch]   = useState('')
  const [vendorSearch,   setVendorSearch]   = useState('')
  const [saving,         setSaving]         = useState(false)

  // Driver-mode selection, held here rather than mutating the caller's row.
  const [pickedDriverId, setPickedDriverId] = useState<string | null>(null)
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [vendorDriverForm, setVendorDriverForm] = useState({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
  const [rateInput,         setRateInput]         = useState('')
  const [rateCurrencyInput, setRateCurrencyInput] = useState('USD')

  const [partnerCountries, setPartnerCountries] = useState<Record<PartnerKind, string[]>>({ guide: [], tourVendor: [] })
  const [guideSel,      setGuideSel]      = useState<PartnerSelection>(EMPTY_SELECTION)
  const [tourVendorSel, setTourVendorSel] = useState<PartnerSelection>(EMPTY_SELECTION)

  // "No driver" day mark — picking a chip only arms it; the inline Confirm
  // button is what saves, because the mark releases any driver already held.
  const [noDriverKind, setNoDriverKind] = useState<NoDriverKind | null>(null)
  const [savingMark,   setSavingMark]   = useState(false)

  // "One driver, whole tour" — copy the saved assignment onto every other
  // movement of the booking. Progress is shown while the copies run.
  const [applyWholeTour, setApplyWholeTour] = useState(false)
  const [tourProgress,   setTourProgress]   = useState(0)

  const guidesEnabled      = isPartnerEnabledForCountry(partnerCountries.guide,      country)
  const tourVendorsEnabled = isPartnerEnabledForCountry(partnerCountries.tourVendor, country)

  // ── Loads ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    fetch('/api/public/partner-settings')
      .then(r => r.json())
      .then(json => { if (json.success) setPartnerCountries(json.data) })
      .catch(() => { /* leave both off — driver assignment still works */ })
  }, [open])

  const loadDrivers = useCallback(async () => {
    setLoadingDrivers(true)
    try {
      const params = new URLSearchParams()
      if (date) { params.set('date', date); params.set('excludeRef', bookingRef) }
      if (country) params.set('country', country)
      const qs   = params.toString()
      const res  = await fetch(qs ? `/api/ground/drivers?${qs}` : '/api/ground/drivers')
      const json = await res.json()
      if (json.success) setDrivers(json.data)
    } catch { /* the list simply stays empty */ }
    finally { setLoadingDrivers(false) }
  }, [date, bookingRef, country])

  const loadVendors = useCallback(async () => {
    try {
      const res  = await fetch(`/api/ground/vendors${country ? `?country=${encodeURIComponent(country)}` : ''}`)
      const json = await res.json()
      if (json.success) setVendors(json.data)
    } catch { /* non-critical */ }
  }, [country])

  async function loadVendorDrivers(vendorId: string) {
    if (!vendorId) { setVendorDrivers([]); return }
    setLoadingVendorDrivers(true)
    try {
      const res  = await fetch(`/api/ground/drivers?vendorId=${vendorId}`)
      const json = await res.json()
      if (json.success) setVendorDrivers(json.data)
    } catch { /* non-critical */ }
    finally { setLoadingVendorDrivers(false) }
  }

  // Seed every control from what the movement already holds each time the
  // dialog opens, so re-assigning starts from the current state rather than
  // from whatever the previously-opened row left behind.
  useEffect(() => {
    if (!open) return
    const a = assignment ?? {}
    setMode(a.vendorId ? 'vendor' : 'driver')
    setPickedDriverId(a.driverId ?? null)
    setSelectedVendorId(a.vendorId ?? '')
    setVendorDriverForm({
      driverName:   a.driverName   ?? '',
      driverPhone:  a.driverPhone  ?? '',
      vehicleType:  a.vehicleType  ?? '',
      vehiclePlate: a.vehiclePlate ?? '',
    })
    setRateInput(a.driverRate != null ? String(a.driverRate) : '')
    setRateCurrencyInput(a.rateCurrency ?? 'USD')
    setGuideSel({ id: a.guideId ?? null, name: a.guideName ?? '', phone: a.guidePhone ?? '' })
    setTourVendorSel({ id: a.tourVendorId ?? null, name: a.tourVendorName ?? '', phone: a.tourVendorPhone ?? '' })
    setDriverSearch(''); setVendorSearch('')
    setNoDriverKind(null)
    setApplyWholeTour(false); setTourProgress(0)
    void loadDrivers()
    void loadVendors()
    if (a.vendorId) void loadVendorDrivers(a.vendorId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agendaItemId])

  // ── Filters ─────────────────────────────────────────────────────────────────

  const filteredDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase()
    if (!q) return drivers
    return drivers.filter(d =>
      [d.name, d.phone, d.vehicle?.plateNo, d.vehicle?.type].some(v => v?.toLowerCase().includes(q)))
  }, [drivers, driverSearch])

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase()
    if (!q) return vendors
    return vendors.filter(v => [v.name, v.phone].some(x => x?.toLowerCase().includes(q)))
  }, [vendors, vendorSearch])

  const pickedDriver = drivers.find(d => d.id === pickedDriverId) ?? null

  // ── Save ────────────────────────────────────────────────────────────────────

  async function save(next: MovementAssignment | null) {
    if (!agendaItemId) { toast.error('This movement has no saved agenda item to assign'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/bookings/${bookingRef}/agenda`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: agendaItemId, assignment: next }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onSaved(next)

      // Copy the assignment onto the rest of the tour. Sequential on purpose:
      // each save re-runs the SL allocation sync and the driver WhatsApp
      // dedupe, which must see one write at a time. A failed day is reported
      // and skipped — the days already copied stand.
      if (next && applyWholeTour && tourSiblings?.length && onSavedTour) {
        const okIds: string[] = []
        let failed = 0
        for (let i = 0; i < tourSiblings.length; i++) {
          const sibling = tourSiblings[i]
          setTourProgress(i + 1)
          try {
            const r = await fetch(`/api/bookings/${bookingRef}/agenda`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId: sibling.id, assignment: next }),
            })
            const j = await r.json()
            if (!j.success) throw new Error(j.error)
            okIds.push(sibling.id)
          } catch { failed += 1 }
        }
        if (okIds.length) onSavedTour(okIds, next)
        if (failed) {
          toast.error(`${failed} movement${failed === 1 ? '' : 's'} could not take the driver — assign ${failed === 1 ? 'it' : 'them'} individually`)
        }
        toast.success(`Driver assigned to ${okIds.length + 1} movement${okIds.length ? 's' : ''} of ${bookingRef}`)
      } else {
        toast.success(json.message || 'Assignment saved')
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save assignment')
    } finally {
      setSaving(false)
      setTourProgress(0)
    }
  }

  /**
   * Save the armed "no driver" mark through the same agenda endpoint the chart
   * uses — the server releases any assignment and keeps the SL allocation
   * board in step. No Driver Needed is sent as its own key; the server stores
   * it as both flags (see driver-requirement.ts).
   */
  async function saveNoDriverMark() {
    if (!noDriverKind || !agendaItemId) return
    setSavingMark(true)
    try {
      const body =
        noDriverKind === 'none'    ? { itemId: agendaItemId, noDriverNeeded: true } :
        noDriverKind === 'leisure' ? { itemId: agendaItemId, isLeisure: true }
                                   : { itemId: agendaItemId, isHotelOnly: true }
      const res  = await fetch(`/api/bookings/${bookingRef}/agenda`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(
        noDriverKind === 'none'    ? 'Marked as no driver needed — left out of the driver count' :
        noDriverKind === 'leisure' ? 'Marked as leisure day — no driver required'
                                   : 'Marked as hotel only — no driver required')
      onMarkedNoDriver?.({
        isLeisure:      noDriverKind !== 'hotel',
        isHotelOnly:    noDriverKind !== 'leisure',
        noDriverNeeded: noDriverKind === 'none',
      })
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark the movement')
    } finally {
      setSavingMark(false)
    }
  }

  function handleSave() {
    // Guide / tour vendor apply to the movement however transport is arranged,
    // so they ride along with both modes — switching tabs must never drop a
    // guide that was already chosen.
    const partnerFields = {
      guideId:         guideSel.id,
      guideName:       guideSel.name.trim()  || null,
      guidePhone:      guideSel.phone.trim() || null,
      tourVendorId:    tourVendorSel.id,
      tourVendorName:  tourVendorSel.name.trim()  || null,
      tourVendorPhone: tourVendorSel.phone.trim() || null,
    }
    const rate = {
      driverRate:   rateInput ? Number(rateInput) : null,
      rateCurrency: rateCurrencyInput || 'USD',
    }

    let next: MovementAssignment
    if (mode === 'vendor' && selectedVendorId) {
      const vendor = vendors.find(v => v.id === selectedVendorId)
      next = {
        driverId:     null,
        vendorId:     selectedVendorId,
        vendorName:   vendor?.name ?? null,
        driverName:   vendorDriverForm.driverName   || null,
        driverPhone:  vendorDriverForm.driverPhone  || null,
        vehicleType:  vendorDriverForm.vehicleType  || null,
        vehiclePlate: vendorDriverForm.vehiclePlate || null,
        ...rate, ...partnerFields,
      }
    } else if (mode === 'driver' && pickedDriver) {
      next = {
        driverId:     pickedDriver.id,
        vendorId:     null,
        vendorName:   null,
        driverName:   pickedDriver.name,
        driverPhone:  pickedDriver.phone,
        vehicleType:  pickedDriver.vehicle?.type    ?? null,
        vehiclePlate: pickedDriver.vehicle?.plateNo ?? null,
        ...rate, ...partnerFields,
      }
    } else {
      // Nobody picked this time — keep whoever already holds the movement and
      // only apply the guide / tour vendor and rate changes.
      next = { ...(assignment ?? {}), ...rate, ...partnerFields }
    }

    // An empty assignment is removed rather than saved as a blank row — that is
    // also what releases a driver who was dropped from the movement.
    const isEmpty = !next.driverId && !next.vendorId && !next.driverName
      && !next.guideName && !next.tourVendorName
    void save(isEmpty ? null : next)
  }

  const hasExisting = Boolean(
    assignment?.driverName || assignment?.vendorId || assignment?.guideName || assignment?.tourVendorName,
  )

  if (!open) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign Movement"
      size="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {hasExisting && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => save(null)}>
                Remove Assignment
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={saving} disabled={noDriverKind !== null} onClick={handleSave}>
              {saving
                ? (applyWholeTour && tourProgress > 0
                    ? `Day ${tourProgress + 1} of ${(tourSiblings?.length ?? 0) + 1}…`
                    : 'Saving…')
                : applyWholeTour && (tourSiblings?.length ?? 0) > 0
                    ? 'Assign Whole Tour'
                    : 'Save Assignment'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400 -mt-2">
          {bookingRef}
          {date && <> · availability check for <strong className="text-slate-600">{formatDate(date)}</strong></>}
        </p>

        {/* ── "No driver" day marks — same three as the movement chart ─────── */}
        {onMarkedNoDriver && (
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Nothing to drive this day?
              </p>
              <span className="text-[10px] text-slate-400">marks the movement instead of assigning</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {NO_DRIVER_OPTIONS.map(({ kind, label, Icon, chip, chipOn }) => {
                const armed = noDriverKind === kind
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setNoDriverKind(armed ? null : kind)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold transition-all ${
                      armed ? chipOn : `border-slate-200 bg-white ${chip}`
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{label}</span>
                  </button>
                )
              })}
            </div>
            {noDriverKind && (() => {
              const opt = NO_DRIVER_OPTIONS.find(o => o.kind === noDriverKind)!
              const holdsDriver = Boolean(assignment?.driverId || assignment?.vendorId || assignment?.driverName)
              return (
                <div className={`mt-2 rounded-xl border p-3 animate-slide-up ${opt.panel}`}>
                  <p className="text-xs text-slate-600">{opt.blurb}</p>
                  {holdsDriver && (
                    <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-red-600">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {assignment?.driverName || assignment?.vendorName || 'The assigned driver'} will be released from this movement.
                    </p>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setNoDriverKind(null)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1">
                      Keep assigning
                    </button>
                    <button
                      type="button"
                      disabled={savingMark}
                      onClick={() => void saveNoDriverMark()}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors disabled:opacity-60 ${opt.confirm}`}
                    >
                      {savingMark
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <CheckCircle2 className="w-3 h-3" />}
                      Mark as {opt.label.replace(/^It's /, '')}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        )}

        {/* While a mark is armed, assigning is off the table — the body dims so
            the confirm strip above is unmistakably the live control. */}
        <div className={noDriverKind ? 'opacity-40 pointer-events-none select-none space-y-4' : 'space-y-4'}>

        {/* ── Guide / tour vendor — only for countries that operate with them ── */}
        {(guidesEnabled || tourVendorsEnabled) && (
          <div className="space-y-2">
            {guidesEnabled && (
              <PartnerAssignPicker kind="guide" country={country} value={guideSel} onChange={setGuideSel} />
            )}
            {tourVendorsEnabled && (
              <PartnerAssignPicker kind="tourVendor" country={country} value={tourVendorSel} onChange={setTourVendorSel} />
            )}
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
          {([
            { key: 'driver' as const, label: 'Driver', Icon: Car },
            { key: 'vendor' as const, label: 'Vendor', Icon: Building2 },
          ]).map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex-1 flex items-center justify-center gap-1.5 text-sm py-1.5 rounded-md font-medium transition-colors ${
                mode === key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* Rate — internal MMT cost, never shown to the driver */}
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
          <p className="text-[11px] font-semibold text-emerald-700 mb-2">💰 Driver Rate (MMT Cost)</p>
          <div className="flex gap-2">
            <select value={rateCurrencyInput} onChange={e => setRateCurrencyInput(e.target.value)}
              className="form-select text-xs py-1 w-20">
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="number" value={rateInput} onChange={e => setRateInput(e.target.value)}
              placeholder="0.00" className="form-input text-sm flex-1 py-1" step="0.01" min="0" />
          </div>
        </div>

        {mode === 'driver' ? (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input value={driverSearch} onChange={e => setDriverSearch(e.target.value)}
                placeholder="Search by name, phone, or plate…"
                className="form-input pl-9 text-sm py-2" />
            </div>

            {loadingDrivers ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
            ) : filteredDrivers.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-4">No active drivers found</p>
            ) : (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {filteredDrivers.map(d => {
                  const isSelected = pickedDriverId === d.id
                  const isBusy     = d.isBusyOnDate ?? false
                  return (
                    <button
                      key={d.id}
                      onClick={() => setPickedDriverId(isSelected ? null : d.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                        isSelected ? 'bg-brand-50 border-2 border-brand-300' :
                        isBusy     ? 'bg-red-50 border border-red-200 hover:bg-red-100' :
                                     'bg-slate-50 hover:bg-slate-100 border border-transparent'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden ${isBusy ? 'bg-red-100' : 'bg-blue-100'}`}>
                        {d.photoUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={d.photoUrl} alt={d.name} className="w-full h-full object-cover" />
                          : <span className={`font-bold text-sm ${isBusy ? 'text-red-700' : 'text-blue-700'}`}>{d.name.slice(0, 1)}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm text-slate-800 truncate">{d.name}</p>
                          {isBusy && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 flex-shrink-0">
                              <AlertTriangle className="w-3 h-3" /> BUSY {d.busyBookings?.join(', ')}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {d.phone}{d.vehicle && ` · ${[d.vehicle.brand, d.vehicle.model].filter(Boolean).join(' ')} ${d.vehicle.plateNo}`.trimEnd()}
                        </p>
                      </div>
                      {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input value={vendorSearch} onChange={e => setVendorSearch(e.target.value)}
                  placeholder="Search vendors…" className="form-input pl-9 text-sm py-2" />
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {filteredVendors.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No vendors found</p>
                ) : (
                  filteredVendors.map(v => {
                    const isSelected = selectedVendorId === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedVendorId(v.id)
                          setVendorDriverForm({ driverName: '', driverPhone: '', vehicleType: '', vehiclePlate: '' })
                          void loadVendorDrivers(v.id)
                        }}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all ${
                          isSelected ? 'bg-brand-50 border-2 border-brand-300' : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-brand-100' : 'bg-violet-100'}`}>
                          <span className={`font-bold text-sm ${isSelected ? 'text-brand-700' : 'text-violet-700'}`}>{v.name.slice(0, 1)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm text-slate-800 truncate">{v.name}</p>
                          <p className="text-xs text-slate-500 truncate">{v.phone ?? '—'}{v.country ? ` · ${v.country}` : ''}</p>
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
            </div>

            {selectedVendorId && (
              <div>
                <label className="form-label text-xs">Select Driver (from vendor fleet)</label>
                {loadingVendorDrivers ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                    <span className="text-xs text-slate-400">Loading drivers…</span>
                  </div>
                ) : vendorDrivers.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {vendorDrivers.map(d => {
                      const isSelected = vendorDriverForm.driverName === d.name && vendorDriverForm.driverPhone === d.phone
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setVendorDriverForm({
                            driverName:   d.name,
                            driverPhone:  d.phone,
                            vehicleType:  d.vehicle?.type    ?? '',
                            vehiclePlate: d.vehicle?.plateNo ?? '',
                          })}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left text-sm transition-all ${
                            isSelected ? 'bg-brand-50 border-2 border-brand-300' : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-brand-100' : 'bg-blue-100'}`}>
                            <span className={`font-bold text-xs ${isSelected ? 'text-brand-700' : 'text-blue-700'}`}>{d.name.slice(0, 1)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800 text-sm truncate">{d.name}</p>
                            <p className="text-xs text-slate-500 truncate">{d.phone}{d.vehicle ? ` · ${d.vehicle.type} ${d.vehicle.plateNo}` : ''}</p>
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-500 flex-shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 py-1 italic">No registered drivers for this vendor — enter details manually below</p>
                )}
              </div>
            )}

            <div>
              <label className="form-label text-xs">
                {selectedVendorId && vendorDrivers.length > 0 ? 'Override / Manual Entry' : 'Driver Details'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="form-label text-xs">Driver Name</label>
                  <input className="form-input text-sm py-1.5" placeholder="Driver full name"
                    value={vendorDriverForm.driverName}
                    onChange={e => setVendorDriverForm(f => ({ ...f, driverName: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label text-xs">Driver Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                    <input className="form-input pl-7 text-sm py-1.5" placeholder="+94 …"
                      value={vendorDriverForm.driverPhone}
                      onChange={e => setVendorDriverForm(f => ({ ...f, driverPhone: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <label className="form-label text-xs">Vehicle Type</label>
                  <input className="form-input text-sm py-1.5" placeholder="Van, Bus, Car…"
                    value={vendorDriverForm.vehicleType}
                    onChange={e => setVendorDriverForm(f => ({ ...f, vehicleType: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label text-xs">Plate No</label>
                  <input className="form-input text-sm py-1.5 font-mono" placeholder="CA-1234"
                    value={vendorDriverForm.vehiclePlate}
                    onChange={e => setVendorDriverForm(f => ({ ...f, vehiclePlate: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── One driver, whole tour — Sri Lanka round tours ─────────────── */}
        {(tourSiblings?.length ?? 0) > 0 && onSavedTour && (
          <div
            className={`rounded-2xl border p-3 transition-all ${
              applyWholeTour
                ? 'border-indigo-300 bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 ring-1 ring-indigo-200'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            <button
              type="button"
              onClick={() => setApplyWholeTour(v => !v)}
              className="w-full flex items-center gap-3 text-left"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${
                applyWholeTour ? 'bg-indigo-500 text-white shadow-md shadow-indigo-200' : 'bg-white text-indigo-500 border border-indigo-200'
              }`}>
                <Route className="w-[18px] h-[18px]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">One driver, whole tour</p>
                <p className="text-xs text-slate-500 truncate">
                  Also give this driver the booking&apos;s other {tourSiblings!.length} movement{tourSiblings!.length === 1 ? '' : 's'}
                </p>
              </div>
              {/* Switch */}
              <span className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
                applyWholeTour ? 'bg-indigo-500' : 'bg-slate-300'
              }`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  applyWholeTour ? 'left-[18px]' : 'left-0.5'
                }`} />
              </span>
            </button>

            {applyWholeTour && (
              <div className="mt-2.5 animate-slide-up">
                {/* The journey, day by day — the opened movement leads it. */}
                <div className="flex items-center gap-1 flex-wrap">
                  {[{ id: agendaItemId, date }, ...tourSiblings!]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((s, i, arr) => (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${
                          s.id === agendaItemId
                            ? 'bg-indigo-500 text-white'
                            : 'bg-white text-indigo-700 border border-indigo-200'
                        }`}>
                          {shortDay(s.date)}
                        </span>
                        {i < arr.length - 1 && <span className="w-2 h-px bg-indigo-300" />}
                      </span>
                    ))}
                </div>
                {saving && tourProgress > 0 && (
                  <div className="mt-2 h-1 rounded-full bg-indigo-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                      style={{ width: `${Math.round((tourProgress / tourSiblings!.length) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </Modal>
  )
}

/** `yyyy-mm-dd` → "12 Nov" for the whole-tour day chips. */
function shortDay(d: string): string {
  const dt = new Date(d)
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
