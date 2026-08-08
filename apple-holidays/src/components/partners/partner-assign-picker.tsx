'use client'

/**
 * Guide / tour-vendor picker for a movement in the agenda chart.
 *
 * Two ways in, as ops actually work: pick someone already registered, or type
 * the name and phone straight in when the supplier was arranged on the day. A
 * typed entry is filed into the directory server-side on save, so the same
 * person is pickable from the list next time.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Search, CheckCircle2, Loader2, Sparkles, Store, Phone, X, Pencil, Users,
} from 'lucide-react'
import { PARTNER_CONFIG, type PartnerKind, type PartnerRecord } from '@/lib/partner-directory'

export interface PartnerSelection {
  id: string | null
  name: string
  phone: string
}

export const EMPTY_SELECTION: PartnerSelection = { id: null, name: '', phone: '' }

export default function PartnerAssignPicker({
  kind, country, value, onChange,
}: {
  kind: PartnerKind
  /** Booking's operation country — scopes the list to who actually works there. */
  country: string | null | undefined
  value: PartnerSelection
  onChange: (next: PartnerSelection) => void
}) {
  const config = PARTNER_CONFIG[kind]
  const Icon = kind === 'guide' ? Sparkles : Store

  const [records, setRecords] = useState<PartnerRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Manual entry stays open once used, so an edit to a typed name does not
  // collapse the fields out from under the person typing.
  const [manual, setManual] = useState(() => Boolean(value.name) && !value.id)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ activeOnly: '1' })
    if (country) params.set('country', country)

    fetch(`${config.apiBase}?${params}`)
      .then(r => r.json())
      .then(json => { if (!cancelled && json.success) setRecords(json.data) })
      .catch(() => { /* the manual fields still work without the list */ })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [config.apiBase, country])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return records
    return records.filter(r =>
      [r.name, r.phone, r.whatsappPhone, r.speciality].some(v => v?.toLowerCase().includes(q)))
  }, [records, search])

  const selected = value.id ? records.find(r => r.id === value.id) : null

  function pick(record: PartnerRecord) {
    if (value.id === record.id) { onChange(EMPTY_SELECTION); return }  // click again to clear
    setManual(false)
    onChange({ id: record.id, name: record.name, phone: record.whatsappPhone || record.phone })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className={`w-3.5 h-3.5 ${config.accent.text}`} />
        <p className="text-[11px] font-semibold text-slate-700">{config.label}</p>
        <span className="text-[11px] text-slate-400">Optional</span>

        {value.name && (
          <button
            type="button"
            onClick={() => { onChange(EMPTY_SELECTION); setManual(false) }}
            className="ml-auto text-[11px] text-slate-400 hover:text-red-500 inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Current selection */}
      {value.name && (
        <div className={`flex items-center gap-2.5 rounded-lg border ${config.accent.border} ${config.accent.bg} px-3 py-2`}>
          <div className="w-7 h-7 rounded-full bg-white/70 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {selected?.photoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={selected.photoUrl} alt={value.name} className="w-full h-full object-cover" />
              : <span className={`text-xs font-bold ${config.accent.text}`}>{value.name.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800 truncate">{value.name}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {value.phone || 'No phone'}
              {selected?.speciality ? ` · ${selected.speciality}` : ''}
              {!value.id ? ' · typed manually' : ''}
            </p>
          </div>
          <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${config.accent.text}`} />
        </div>
      )}

      {/* Registered list */}
      {!manual && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search registered ${config.labelPlural.toLowerCase()}…`}
              className="form-input pl-8 text-xs py-1.5"
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-[11px] text-slate-400 text-center py-3">
              {records.length === 0
                ? `No active ${config.labelPlural.toLowerCase()} registered for this country yet — type the details below.`
                : 'No matches'}
            </p>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {filtered.map(r => {
                const isSelected = value.id === r.id
                return (
                  <button
                    key={r.id} type="button" onClick={() => pick(r)}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-all ${
                      isSelected
                        ? `${config.accent.bg} border-2 ${config.accent.border}`
                        : 'bg-slate-50 hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0 overflow-hidden border border-slate-200">
                      {r.photoUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={r.photoUrl} alt={r.name} className="w-full h-full object-cover" />
                        : <span className="text-[11px] font-bold text-slate-500">{r.name.slice(0, 1).toUpperCase()}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-800 truncate">{r.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {r.phone}{r.speciality ? ` · ${r.speciality}` : ''}
                      </p>
                    </div>
                    {isSelected && <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${config.accent.text}`} />}
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Manual entry */}
      {manual ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={value.name}
              onChange={e => onChange({ id: null, name: e.target.value, phone: value.phone })}
              placeholder={`${config.label} name`}
              className="form-input text-xs py-1.5"
            />
            <div className="relative">
              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
              <input
                value={value.phone}
                onChange={e => onChange({ id: null, name: value.name, phone: e.target.value })}
                placeholder="Phone number"
                className="form-input pl-7 text-xs py-1.5"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Saved to the {config.labelPlural.toLowerCase()} directory automatically, so you can pick them next time.
          </p>
          <button
            type="button"
            onClick={() => setManual(false)}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
          >
            <Users className="w-3 h-3" /> Choose a registered {config.label.toLowerCase()} instead
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setManual(true); onChange({ id: null, name: value.name, phone: value.phone }) }}
          className="text-[11px] font-medium text-slate-500 hover:text-slate-700 inline-flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" /> Not registered? Type the details
        </button>
      )}
    </div>
  )
}
