'use client'

/**
 * City / airport exceptions for Airport Pickup Timings.
 *
 * The general rule is international vs domestic. Some airports do not fit it:
 * Phu Quoc is small enough that an hour is plenty, SGN international queues
 * need more than the rest of the country. Each exception names one airport
 * (typed any way — "pqc", "PQC Airport", "Phu Quoc", "noi bai") and sets its
 * own departure pickup and / or arrival meeting; whatever it leaves on
 * "General" keeps the rule above. Matching is in lib/flight-pickup-rules.ts.
 */

import { useMemo, useRef, useState } from 'react'
import {
  MapPinned, Plus, Trash2, PlaneTakeoff, PlaneLanding, Search, CheckCircle2, AlertTriangle, Pencil, Sparkles,
} from 'lucide-react'
import { to12h } from '@/lib/clock-time'
import { airport, searchAirports } from '@/lib/ops-geo'
import {
  ARRIVAL_MIN_RANGE, DEPARTURE_MIN_RANGE, MAX_AIRPORT_OVERRIDES,
  durationLabel, overrideKey, overrideLabel, parseDurationInput, resolveAirportInput, shiftClock,
  type AirportPickupOverride, type AirportRuleScope, type FlightPickupRules,
} from '@/lib/flight-pickup-rules'

/** One-click adds — the fields our files fly through most. */
const QUICK_CODES = ['PQC', 'SGN', 'HAN', 'DAD', 'CXR', 'HPH', 'HUI', 'DLI', 'CMB', 'SIN', 'KUL', 'PEN', 'LGK']

/** Countries with domestic sectors we operate — an "All flights" row previews against the domestic rule there. */
const HOME_COUNTRIES = new Set(['Vietnam', 'Sri Lanka', 'Malaysia'])

const DEPARTURE_CHIPS =[30, 45, 60, 90, 120, 180]
const ARRIVAL_CHIPS = [0, 15, 30, 45, 60, 120]

const SCOPE_LABEL: Record<AirportRuleScope, string> = {
  all: 'All flights',
  domestic: 'Domestic',
  international: 'International',
}

const SAMPLE_DEP = '11:15'
const SAMPLE_ARR = '12:40'

function newId(): string {
  return `apt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** "+1 hr" / "−2 hrs" / "same" — how an exception differs from the general rule. */
function deltaLabel(mine: number, general: number): { text: string; tone: string } {
  const d = mine - general
  if (d === 0) return { text: 'same as general', tone: 'text-slate-400' }
  return d > 0
    ? { text: `${durationLabel(d)} more than general`, tone: 'text-rose-600' }
    : { text: `${durationLabel(-d)} less than general`, tone: 'text-emerald-600' }
}

function DurationPicker({
  value, general, chips, range, accent, onChange, zeroLabel,
}: {
  value: number | null
  general: number
  chips: number[]
  range: { min: number; max: number }
  accent: 'indigo' | 'emerald'
  onChange: (v: number | null) => void
  zeroLabel?: string
}) {
  const [custom, setCustom] = useState<string | null>(null)
  const on = accent === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
  const isCustom = value !== null && !chips.includes(value)
  const parsed = custom !== null ? parseDurationInput(custom) : null
  const clamped = parsed === null ? null : Math.min(range.max, Math.max(range.min, parsed))

  const commit = () => {
    if (clamped !== null) onChange(clamped)
    setCustom(null)
  }

  const chip = (active: boolean) =>
    `px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${active ? on : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-100'}`

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={chip(value === null).replace(on, 'bg-slate-600 text-white')}
        title="Use the international / domestic figure above"
      >
        General ({durationLabel(general)})
      </button>
      {chips.filter(c => c >= range.min && c <= range.max).map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} className={chip(value === c)}>
          {c === 0 && zeroLabel ? zeroLabel : durationLabel(c)}
        </button>
      ))}
      {custom === null ? (
        <button
          type="button"
          onClick={() => setCustom(isCustom && value !== null ? durationLabel(value) : '')}
          className={`${chip(isCustom)} inline-flex items-center gap-1`}
        >
          <Pencil className="w-2.5 h-2.5" />
          {isCustom && value !== null ? durationLabel(value) : 'Custom'}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={custom}
            onChange={e => setCustom(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') setCustom(null)
            }}
            onBlur={commit}
            placeholder="1h 15m"
            className="w-20 px-1.5 py-0.5 rounded-md border border-slate-300 text-[11px] focus:outline-none focus:ring-2 focus:ring-sky-300"
          />
          <span className={`text-[10px] ${clamped === null ? 'text-slate-400' : 'text-slate-600 font-semibold'}`}>
            {custom.trim() === '' ? 'e.g. 75, 1:15, 1.5h' : clamped === null ? 'not a duration' : `= ${durationLabel(clamped)}${parsed !== clamped ? ' (limit)' : ''}`}
          </span>
        </span>
      )}
    </div>
  )
}

function ExceptionRow({
  o, rules, flash, onChange, onRemove, taken,
}: {
  o: AirportPickupOverride
  rules: FlightPickupRules
  flash: boolean
  onChange: (patch: Partial<AirportPickupOverride>) => void
  onRemove: () => void
  taken: (scope: AirportRuleScope) => boolean
}) {
  const ref = o.code ? airport(o.code) : null
  // The general figures this row would otherwise use. "All flights" previews
  // against the domestic rule for a home-country airport, international otherwise.
  const intl = o.scope === 'international'
    || (o.scope === 'all' && !(ref && HOME_COUNTRIES.has(ref.country)))
  const generalDep = intl ? rules.departureIntlMin : rules.departureDomesticMin
  const generalArr = intl ? rules.arrivalIntlMin : rules.arrivalDomesticMin
  const dep = o.departureMin ?? generalDep
  const arr = o.arrivalMin ?? generalArr
  const nothingSet = o.departureMin === null && o.arrivalMin === null

  const pickup = shiftClock(SAMPLE_DEP, -dep, rules.roundToMin)
  const meet = shiftClock(SAMPLE_ARR, arr, rules.roundToMin)
  const depDelta = o.departureMin !== null ? deltaLabel(o.departureMin, generalDep) : null
  const arrDelta = o.arrivalMin !== null ? deltaLabel(o.arrivalMin, generalArr) : null

  return (
    <div
      className={`rounded-xl border bg-white p-3 transition-shadow duration-700 ${
        flash ? 'border-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.35)]' : nothingSet ? 'border-amber-200' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`flex-shrink-0 rounded-lg px-2 py-1 text-[13px] font-black tracking-wider ${
            o.code ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
          }`}>
            {o.code || <MapPinned className="w-4 h-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-slate-800 truncate">{overrideLabel(o)}</p>
            <p className="text-[11px] text-slate-500 truncate">
              {ref ? `${ref.city}, ${ref.country}` : o.code ? 'Code not in our airport list — matched by code' : 'Matched by name'}
              {' · matches '}
              <span className="font-mono text-slate-600">
                {[o.code, o.code && `${o.code} Airport`, o.city].filter(Boolean).slice(0, 3).join(', ')}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {(Object.keys(SCOPE_LABEL) as AirportRuleScope[]).map(s => {
              const blocked = s !== o.scope && taken(s)
              return (
                <button
                  key={s}
                  type="button"
                  disabled={blocked}
                  title={blocked ? `${overrideLabel(o)} already has a ${SCOPE_LABEL[s].toLowerCase()} exception` : undefined}
                  onClick={() => onChange({ scope: s })}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold transition-colors disabled:opacity-30 ${
                    o.scope === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {SCOPE_LABEL[s]}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center"
            aria-label={`Remove ${overrideLabel(o)}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-2.5 grid gap-2 lg:grid-cols-2">
        <div className="rounded-lg bg-indigo-50/50 border border-indigo-100 px-2.5 py-2 space-y-1.5">
          <p className="flex items-center justify-between gap-2 text-[10.5px] font-bold uppercase tracking-wider text-indigo-500">
            <span className="flex items-center gap-1"><PlaneTakeoff className="w-3 h-3" /> Hotel pickup before take-off</span>
            {depDelta && <span className={`normal-case tracking-normal font-semibold ${depDelta.tone}`}>{depDelta.text}</span>}
          </p>
          <DurationPicker
            value={o.departureMin} general={generalDep} chips={DEPARTURE_CHIPS} range={DEPARTURE_MIN_RANGE}
            accent="indigo" onChange={v => onChange({ departureMin: v })}
          />
          <p className="text-[10.5px] text-slate-500 tabular-nums">
            {to12h(SAMPLE_DEP)} flight → pickup <b className="text-slate-700">{pickup ? to12h(pickup) : '—'}</b>
          </p>
        </div>
        <div className="rounded-lg bg-emerald-50/50 border border-emerald-100 px-2.5 py-2 space-y-1.5">
          <p className="flex items-center justify-between gap-2 text-[10.5px] font-bold uppercase tracking-wider text-emerald-600">
            <span className="flex items-center gap-1"><PlaneLanding className="w-3 h-3" /> Meet the driver after landing</span>
            {arrDelta && <span className={`normal-case tracking-normal font-semibold ${arrDelta.tone}`}>{arrDelta.text}</span>}
          </p>
          <DurationPicker
            value={o.arrivalMin} general={generalArr} chips={ARRIVAL_CHIPS} range={ARRIVAL_MIN_RANGE}
            accent="emerald" zeroLabel="On landing" onChange={v => onChange({ arrivalMin: v })}
          />
          <p className="text-[10.5px] text-slate-500 tabular-nums">
            Lands {to12h(SAMPLE_ARR)} → meet <b className="text-slate-700">{meet ? to12h(meet) : '—'}</b>
          </p>
        </div>
      </div>

      {nothingSet && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
          <AlertTriangle className="w-3 h-3" /> Pick a departure or arrival time — with both on General this exception changes nothing.
        </p>
      )}
    </div>
  )
}

export default function AirportExceptions({
  draft, setDraft,
}: {
  draft: FlightPickupRules
  setDraft: React.Dispatch<React.SetStateAction<FlightPickupRules>>
}) {
  const list = draft.airportOverrides
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())

  const resolved = useMemo(() => resolveAirportInput(query), [query])
  const suggestions = useMemo(() => searchAirports(query, 6), [query])
  const full = list.length >= MAX_AIRPORT_OVERRIDES

  const update = (next: AirportPickupOverride[]) => setDraft(d => ({ ...d, airportOverrides: next }))

  const flash = (id: string) => {
    setFlashId(id)
    rowRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlashId(null), 1600)
  }

  /** Add an airport, or jump to it when it is already listed for all flights. */
  const add = (input: { code: string; city: string } | null) => {
    if (!input || (!input.code && !input.city)) return
    const existing = list.find(o => overrideKey(o) === overrideKey({ ...input, scope: 'all' }))
    if (existing) {
      flash(existing.id)
    } else if (!full) {
      const o: AirportPickupOverride = {
        id: newId(), code: input.code, city: input.city, scope: 'all', departureMin: null, arrivalMin: null,
      }
      update([o, ...list])
      setTimeout(() => flash(o.id), 30)
    }
    setQuery('')
    setOpen(false)
    setActive(0)
  }

  const listed = new Set(list.map(o => o.code).filter(Boolean))
  const quick = QUICK_CODES.filter(c => !listed.has(c))

  // What Enter would add: the highlighted suggestion, else whatever the text resolved to.
  const pick = open && suggestions[active]
    ? { code: suggestions[active].iata, city: suggestions[active].city }
    : resolved

  return (
    <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/70 to-white p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-700">
            <MapPinned className="w-3.5 h-3.5" /> City &amp; airport exceptions
            {list.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-600 text-white px-1.5 text-[10px] tracking-normal">{list.length}</span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 max-w-xl">
            Airports that need their own timing. An exception beats the international / domestic figure above for flights
            leaving from (pickup) or landing at (meeting) that airport. Type the code or the city any way —
            <span className="font-mono"> pqc</span>, <span className="font-mono">PQC Airport</span>, <span className="font-mono">Phu Quoc</span>.
          </p>
        </div>
      </div>

      {/* Search / add */}
      <div className="relative">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={query}
              disabled={full}
              onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
              onFocus={() => setOpen(true)}
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, suggestions.length - 1))) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
                if (e.key === 'Enter') { e.preventDefault(); add(pick) }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder={full ? `Limit of ${MAX_AIRPORT_OVERRIDES} reached` : 'Add a city or airport — PQC, SGN Airport, Da Nang, noi bai…'}
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-[12.5px] focus:outline-none focus:ring-2 focus:ring-amber-300"
            />
          </div>
          <button
            type="button"
            onClick={() => add(pick)}
            disabled={!pick || full}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>

        {/* What the text resolves to, so a typo is visible before it is saved */}
        {query.trim() && resolved && (
          <p className={`mt-1 flex items-center gap-1 text-[11px] ${resolved.known ? 'text-emerald-700' : 'text-amber-700'}`}>
            {resolved.known
              ? <><CheckCircle2 className="w-3 h-3" /> Recognised: <b>{resolved.code} Airport</b> · {resolved.city}, {resolved.country}</>
              : <><AlertTriangle className="w-3 h-3" /> Not in our airport list — will match <b>{overrideLabel(resolved)}</b> by {resolved.code ? 'code' : 'name'}</>}
          </p>
        )}

        {open && query.trim() && suggestions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
            {suggestions.map((s, i) => {
              const already = list.some(o => o.code === s.iata)
              return (
                <button
                  key={s.iata}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => add({ code: s.iata, city: s.city })}
                  className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] ${i === active ? 'bg-amber-50' : ''}`}
                >
                  <span className="w-11 rounded bg-slate-900 text-white text-center font-black text-[11px] py-0.5 tracking-wider">{s.iata}</span>
                  <span className="flex-1 min-w-0 truncate">
                    <b className="text-slate-800">{s.city}</b> <span className="text-slate-400">· {s.country}</span>
                  </span>
                  {already && <span className="text-[10px] text-amber-700 font-semibold">listed</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {quick.length > 0 && !full && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="flex items-center gap-1 text-[10.5px] font-semibold text-slate-400 mr-1">
            <Sparkles className="w-3 h-3" /> Quick add
          </span>
          {quick.map(c => (
            <button
              key={c}
              type="button"
              title={airport(c) ? `${airport(c)!.city}, ${airport(c)!.country}` : c}
              onClick={() => add({ code: c, city: airport(c)?.city ?? '' })}
              className="px-2 py-0.5 rounded-md border border-dashed border-slate-300 text-[11px] font-bold text-slate-500 hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50"
            >
              + {c}
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white/60 px-3 py-4 text-center text-[11.5px] text-slate-400">
          No exceptions — every airport uses the international / domestic timings above.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map(o => (
            <div key={o.id} ref={el => { if (el) rowRefs.current.set(o.id, el); else rowRefs.current.delete(o.id) }}>
              <ExceptionRow
                o={o}
                rules={draft}
                flash={flashId === o.id}
                onChange={patch => update(list.map(x => (x.id === o.id ? { ...x, ...patch } : x)))}
                onRemove={() => update(list.filter(x => x.id !== o.id))}
                taken={scope => list.some(x => x.id !== o.id && overrideKey(x) === overrideKey({ ...o, scope }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
