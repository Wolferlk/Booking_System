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
      toast.success(json.message || 'Assignment saved')
      onSaved(next)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save assignment')
    } finally {
      setSaving(false)
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
            <Button size="sm" loading={saving} onClick={handleSave}>
              {saving ? 'Saving…' : 'Save Assignment'}
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
      </div>
    </Modal>
  )
}
