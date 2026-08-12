'use client'

/**
 * Driver assignment for one movement.
 *
 * Two tabs matching the two real situations:
 *
 *  1. **Choose** — pick from the registered drivers, filtered to the booking's
 *     country and warned about clashes with other bookings over the same days.
 *  2. **New driver** — the driver is not in the system. Registering them writes
 *     a real `drivers` row (active, country set from the booking), so they are
 *     allocatable everywhere afterwards, not just here.
 *
 * Below both sits the trip-specific detail — vehicle, plate, rate — which
 * belongs to the movement rather than the person, and legitimately differs
 * from one tour to the next.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle, Car, Check, Loader2, Phone, Search, UserPlus, Users, X,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DriverOption, DriverPrecheckDay } from '@/lib/driver-precheck-shared'

type Tab = 'choose' | 'new'

interface Form {
  driverId: string | null
  driverName: string
  driverPhone: string
  vehicleType: string
  vehiclePlate: string
  driverRate: string
  rateCurrency: string
  notes: string
}

function formFrom(day: DriverPrecheckDay): Form {
  const d = day.driver
  return {
    driverId: d.driverId,
    driverName: d.name ?? '',
    driverPhone: d.phone ?? '',
    vehicleType: d.vehicleType ?? '',
    vehiclePlate: d.vehiclePlate ?? '',
    driverRate: d.rate == null ? '' : String(d.rate),
    rateCurrency: d.rateCurrency ?? 'USD',
    notes: d.notes ?? '',
  }
}

export default function DriverAssignModal({
  open, onClose, bookingRef, day, remainingUnassigned, onSaved,
}: {
  open: boolean
  onClose: () => void
  bookingRef: string
  day: DriverPrecheckDay
  /** How many other movements still have nobody — drives the "apply to all" offer. */
  remainingUnassigned: number
  onSaved: () => void
}) {
  const [tab, setTab] = useState<Tab>('choose')
  const [form, setForm] = useState<Form>(() => formFrom(day))
  const [saving, setSaving] = useState(false)

  // Choose tab
  const [query, setQuery] = useState('')
  const [drivers, setDrivers] = useState<DriverOption[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // New-driver tab
  const [newDriver, setNewDriver] = useState({ name: '', phone: '', email: '', licenseNo: '' })
  const [creating, setCreating] = useState(false)

  // Propagation options
  const [applyToAll, setApplyToAll] = useState(false)
  const [syncMaster, setSyncMaster] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(formFrom(day))
    setTab('choose')
    setApplyToAll(false)
    setSyncMaster(false)
    setNewDriver({ name: '', phone: '', email: '', licenseNo: '' })
  }, [open, day])

  const loadDrivers = useCallback(async (q: string) => {
    setLoadingList(true)
    try {
      const params = new URLSearchParams({ bookingRef })
      if (q.trim()) params.set('q', q.trim())
      const res = await fetch(`/api/precheck/driver/search?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setDrivers(json.data as DriverOption[])
    } catch (e) {
      toast.error(`Could not load drivers: ${(e as Error).message}`)
    } finally {
      setLoadingList(false)
    }
  }, [bookingRef])

  useEffect(() => {
    if (!open || tab !== 'choose') return
    const t = setTimeout(() => void loadDrivers(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [open, tab, query, loadDrivers])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }))

  /** Adopt a registered driver into the form; their vehicle fills any blanks. */
  const pick = useCallback((d: DriverOption) => {
    setForm(f => ({
      ...f,
      driverId: d.id,
      driverName: d.name,
      driverPhone: d.phone,
      vehicleType: f.vehicleType || d.vehicleType || '',
      vehiclePlate: f.vehiclePlate || d.vehiclePlate || '',
    }))
    toast.success(`${d.name} selected — review the vehicle, then assign`)
  }, [])

  const save = useCallback(async (clear = false) => {
    if (!clear && !form.driverName.trim()) { toast.error('Pick a driver, or add a new one'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/precheck/driver/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingRef,
          agendaItemId: day.agendaItemId,
          clear,
          driverId: form.driverId,
          driverName: form.driverName,
          driverPhone: form.driverPhone,
          vehicleType: form.vehicleType,
          vehiclePlate: form.vehiclePlate,
          driverRate: form.driverRate.trim() === '' ? null : Number(form.driverRate),
          rateCurrency: form.rateCurrency,
          notes: form.notes,
          applyToAll: clear ? false : applyToAll,
          syncMaster: clear ? false : syncMaster,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message ?? 'Saved')
      onSaved()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [bookingRef, day.agendaItemId, form, applyToAll, syncMaster, onSaved, onClose])

  /** Register a driver who is not on file, then select them. */
  const createDriver = useCallback(async () => {
    if (!newDriver.name.trim())  { toast.error('A driver name is required'); return }
    if (!newDriver.phone.trim()) { toast.error('A phone number is required — the briefing needs somewhere to go'); return }

    setCreating(true)
    try {
      const res = await fetch('/api/precheck/driver/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newDriver, bookingRef }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      const { driver, duplicate } = json.data as { driver: DriverOption; duplicate: boolean }
      setForm(f => ({ ...f, driverId: driver.id, driverName: driver.name, driverPhone: driver.phone }))
      setTab('choose')
      setQuery(driver.name)
      toast[duplicate ? 'info' : 'success'](json.message ?? 'Driver added')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }, [newDriver, bookingRef])

  const dayLabel = new Date(day.date).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  })

  return (
    <Modal open={open} onClose={onClose} size="2xl" title={`Driver — Day ${day.dayNo} · ${dayLabel}`}>
      <div className="space-y-4">
        {/* Movement context */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">{day.location}</span>
          {(day.fromPoint || day.toPoint) && (
            <span className="ml-2">{day.fromPoint ?? ''}{day.toPoint ? ` → ${day.toPoint}` : ''}</span>
          )}
          {day.meetingTime && <span className="ml-2 font-mono">pick-up {day.meetingTime}</span>}
        </div>

        {/* Changing the driver invalidates a briefing already sent. */}
        {day.briefing === 'SENT' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Today&apos;s briefing has already gone to <strong>{day.driver.name}</strong>. Changing the driver
              resets that, so the new driver is briefed automatically — the previous one is not told,
              so message them yourself if the change matters.
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200">
          {([['choose', 'Choose driver', Users], ['new', 'New driver', UserPlus]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors',
                tab === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>

        {/* ── CHOOSE ─────────────────────────────────────────────────────── */}
        {tab === 'choose' && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search registered drivers by name or number…"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {loadingList && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading drivers…
              </div>
            )}

            {!loadingList && drivers.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 py-6 text-center">
                <p className="text-xs text-slate-500">No registered driver matches that.</p>
                <Button size="sm" variant="secondary" className="mt-2" icon={<UserPlus className="w-3.5 h-3.5" />}
                        onClick={() => { setNewDriver(n => ({ ...n, name: query })); setTab('new') }}>
                  Add a new driver
                </Button>
              </div>
            )}

            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {drivers.map(d => {
                const selected = form.driverId === d.id
                return (
                  <button
                    key={d.id}
                    onClick={() => pick(d)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                      selected ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-800 truncate">{d.name}</span>
                      <span className="font-mono text-[11px] text-slate-500">{d.phone}</span>
                      {selected && <Check className="w-3.5 h-3.5 text-brand-600" />}
                      {d.clashes.length > 0 && (
                        <span
                          className="ml-auto inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
                          title={d.clashes.map(c => `${c.bookingRef} — ${new Date(c.date).toLocaleDateString('en-GB')} ${c.location}`).join('\n')}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          also on {d.clashes.length} movement{d.clashes.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-slate-400">
                      {d.vehicleType && <span>{d.vehicleType}{d.vehiclePlate ? ` · ${d.vehiclePlate}` : ''}</span>}
                      {d.vendorName && <span>{d.vendorName}</span>}
                      {d.country && <span>{d.country}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── NEW DRIVER ─────────────────────────────────────────────────── */}
        {tab === 'new' && (
          <div className="space-y-3">
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              This registers the driver properly — they become available for <strong>any</strong> booking,
              show up in the allocation boards, and can receive the automatic daily briefing.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Driver name" required value={newDriver.name}
                     onChange={v => setNewDriver(n => ({ ...n, name: v }))} />
              <Field label="WhatsApp number" required value={newDriver.phone} mono
                     placeholder="+94 77 123 4567"
                     onChange={v => setNewDriver(n => ({ ...n, phone: v }))} />
              <Field label="Email" value={newDriver.email}
                     onChange={v => setNewDriver(n => ({ ...n, email: v }))} />
              <Field label="Licence no." value={newDriver.licenseNo}
                     onChange={v => setNewDriver(n => ({ ...n, licenseNo: v }))} />
            </div>
            <div className="flex justify-end">
              <Button size="sm" loading={creating} onClick={() => void createDriver()}
                      icon={<UserPlus className="w-3.5 h-3.5" />}>
                Register driver
              </Button>
            </div>
          </div>
        )}

        {/* ── Trip detail + save ─────────────────────────────────────────── */}
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-2">
            <Car className="w-4 h-4 text-slate-400" />
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">This movement</h4>
            {form.driverName && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                {form.driverName}
                {form.driverPhone && <span className="font-mono text-slate-500">{form.driverPhone}</span>}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Driver name" value={form.driverName} onChange={v => set('driverName', v)} />
            <Field label="Phone" value={form.driverPhone} mono onChange={v => set('driverPhone', v)} />
            <Field label="Vehicle" value={form.vehicleType} onChange={v => set('vehicleType', v)} />
            <Field label="Plate" value={form.vehiclePlate} mono onChange={v => set('vehiclePlate', v)} />
            <Field label="Rate" value={form.driverRate} numeric onChange={v => set('driverRate', v)} />
            <Field label="Currency" value={form.rateCurrency} onChange={v => set('rateCurrency', v)} />
            <div className="col-span-2">
              <Field label="Notes" value={form.notes} onChange={v => set('notes', v)} />
            </div>
          </div>

          <div className="space-y-1.5">
            {remainingUnassigned > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={applyToAll} onChange={e => setApplyToAll(e.target.checked)}
                       className="rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
                Also assign to the <strong>{remainingUnassigned}</strong> other movement{remainingUnassigned === 1 ? '' : 's'} with no driver
                <span className="text-slate-400">(movements already staffed are left alone)</span>
              </label>
            )}
            {form.driverId && form.driverPhone && form.driverPhone !== day.driver.masterPhone && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" checked={syncMaster} onChange={e => setSyncMaster(e.target.checked)}
                       className="rounded border-slate-300 text-brand-500 focus:ring-brand-500" />
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                Update this number on the driver&apos;s record, for every future booking
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {day.driver.name && (
              <Button size="sm" variant="ghost" disabled={saving}
                      className="mr-auto !text-slate-400 hover:!text-rose-600"
                      icon={<X className="w-3.5 h-3.5" />}
                      onClick={() => {
                        if (window.confirm(`Remove ${day.driver.name} from day ${day.dayNo}?`)) void save(true)
                      }}>
                Remove driver
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button size="sm" loading={saving} onClick={() => void save(false)} icon={<Check className="w-3.5 h-3.5" />}>
              {applyToAll ? 'Assign to all' : 'Assign driver'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Field({
  label, value, onChange, placeholder, mono, numeric, required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  numeric?: boolean
  required?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
        {label}{required && <span className="text-rose-400"> *</span>}
      </span>
      <input
        type={numeric ? 'number' : 'text'}
        min={numeric ? 0 : undefined}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={cn(
          'mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs',
          'focus:border-brand-500 focus:ring-2 focus:ring-brand-500',
          mono && 'font-mono',
        )}
      />
    </label>
  )
}
