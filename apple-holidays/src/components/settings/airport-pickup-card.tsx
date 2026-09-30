'use client'

/**
 * Airport pickup timings — how early the hotel pickup is before a departure,
 * and how long after a landing the guests meet the driver.
 *
 * Every airport row on the movement chart reads these: the "Suggested pickup"
 * chip in the agenda editor, the "Use as meeting time" button, the transfer
 * sentence added to Details, the PDF, the Word file and AI generation. The
 * rules are one JSON row (see lib/flight-pickup-rules.ts), so the card keeps a
 * draft and saves it in one go rather than firing a save on every click.
 */

import { useEffect, useMemo, useState } from 'react'
import { PlaneTakeoff, PlaneLanding, Minus, Plus, RotateCcw, Save, Globe2, MapPin, Hotel, UserCheck } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { to12h } from '@/lib/clock-time'
import {
  ARRIVAL_MIN_RANGE, DEFAULT_FLIGHT_PICKUP_RULES, DEPARTURE_MIN_RANGE, FLIGHT_PICKUP_KEY, ROUND_STEPS,
  durationLabel, parseFlightPickupRules, shiftClock, type FlightPickupRules,
} from '@/lib/flight-pickup-rules'

interface Props {
  settings: { flight_pickup_rules?: string }
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

const STEP = 15
const DEPARTURE_PRESETS = [120, 150, 180, 210, 240]
const ARRIVAL_PRESETS = [0, 15, 30, 45, 60]

/** The sample flight the preview is drawn against — a morning departure and a midday landing. */
const SAMPLE_DEP = '11:15'
const SAMPLE_ARR = '12:40'

type RuleKey = Exclude<keyof FlightPickupRules, 'roundToMin'>

function Stepper({
  value, onChange, range, presets, accent,
}: {
  value: number
  onChange: (n: number) => void
  range: { min: number; max: number }
  presets: number[]
  accent: 'indigo' | 'emerald'
}) {
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, n))
  const on = accent === 'indigo' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white'
  const ring = accent === 'indigo' ? 'text-indigo-700' : 'text-emerald-700'
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(clamp(value - STEP))}
          disabled={value <= range.min}
          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center"
          aria-label="Decrease by 15 minutes"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className={`min-w-[92px] text-center text-sm font-bold tabular-nums ${ring}`}>
          {durationLabel(value)}
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + STEP))}
          disabled={value >= range.max}
          className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-40 flex items-center justify-center"
          aria-label="Increase by 15 minutes"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
              value === p ? on : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {p === 0 ? 'On landing' : durationLabel(p)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * One row of the preview: two clock points and the gap between them, drawn to
 * scale against a 4-hour track so a longer buffer visibly takes more road.
 */
function Timeline({
  leftTime, leftLabel, leftIcon, rightTime, rightLabel, rightIcon, gap, accent,
}: {
  leftTime: string | null
  leftLabel: string
  leftIcon: React.ReactNode
  rightTime: string | null
  rightLabel: string
  rightIcon: React.ReactNode
  gap: number
  accent: 'indigo' | 'emerald'
}) {
  const pct = Math.max(12, Math.min(100, (gap / 240) * 100))
  const bar = accent === 'indigo' ? 'bg-indigo-400' : 'bg-emerald-400'
  const pill = accent === 'indigo' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-[88px] flex-shrink-0 text-right">
        <p className="font-bold text-slate-800 tabular-nums">{leftTime ? to12h(leftTime) : '—'}</p>
        <p className="text-slate-400 flex items-center justify-end gap-1">{leftIcon}{leftLabel}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="relative h-6 flex items-center">
          <div className="absolute inset-x-0 h-px bg-slate-200" />
          <div className={`relative h-1.5 rounded-full ${bar} transition-all duration-500`} style={{ width: `${pct}%` }} />
          <span className={`absolute left-1/2 -translate-x-1/2 -top-1 px-1.5 rounded border text-[10px] font-semibold ${pill}`}>
            {durationLabel(gap)}
          </span>
        </div>
      </div>
      <div className="w-[88px] flex-shrink-0">
        <p className="font-bold text-slate-800 tabular-nums">{rightTime ? to12h(rightTime) : '—'}</p>
        <p className="text-slate-400 flex items-center gap-1">{rightIcon}{rightLabel}</p>
      </div>
    </div>
  )
}

export default function AirportPickupCard({ settings, saving, onSave }: Props) {
  const stored = useMemo(() => parseFlightPickupRules(settings.flight_pickup_rules), [settings.flight_pickup_rules])
  const [draft, setDraft] = useState<FlightPickupRules>(stored)
  useEffect(() => setDraft(stored), [stored])

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const isDefault = JSON.stringify(draft) === JSON.stringify(DEFAULT_FLIGHT_PICKUP_RULES)
  const set = (k: RuleKey) => (n: number) => setDraft(d => ({ ...d, [k]: n }))

  const depIntl = shiftClock(SAMPLE_DEP, -draft.departureIntlMin, draft.roundToMin)
  const depDom = shiftClock(SAMPLE_DEP, -draft.departureDomesticMin, draft.roundToMin)
  const arrIntl = shiftClock(SAMPLE_ARR, draft.arrivalIntlMin, draft.roundToMin)
  const arrDom = shiftClock(SAMPLE_ARR, draft.arrivalDomesticMin, draft.roundToMin)

  const Row = ({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600 pt-1">{icon}{label}</span>
      {children}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <PlaneTakeoff className="w-4 h-4 text-slate-400" /> Airport Pickup Timings
        </h3>
        <p className="mt-1 text-[11.5px] text-slate-500">
          How early the hotel pickup is before a flight, and when guests meet the driver after landing.
          Used for the suggested time on every airport row in the movement chart, the PDF, the Word file and AI generation.
        </p>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {/* Departure */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-500">
              <PlaneTakeoff className="w-3.5 h-3.5" /> Departure · hotel pickup before take-off
            </p>
            <div className="divide-y divide-indigo-100/70">
              <Row icon={<Globe2 className="w-3.5 h-3.5 text-slate-400" />} label="International">
                <Stepper value={draft.departureIntlMin} onChange={set('departureIntlMin')} range={DEPARTURE_MIN_RANGE} presets={DEPARTURE_PRESETS} accent="indigo" />
              </Row>
              <Row icon={<MapPin className="w-3.5 h-3.5 text-slate-400" />} label="Domestic">
                <Stepper value={draft.departureDomesticMin} onChange={set('departureDomesticMin')} range={DEPARTURE_MIN_RANGE} presets={DEPARTURE_PRESETS} accent="indigo" />
              </Row>
            </div>
          </div>

          {/* Arrival */}
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-emerald-600">
              <PlaneLanding className="w-3.5 h-3.5" /> Arrival · meet the driver after landing
            </p>
            <div className="divide-y divide-emerald-100/70">
              <Row icon={<Globe2 className="w-3.5 h-3.5 text-slate-400" />} label="International">
                <Stepper value={draft.arrivalIntlMin} onChange={set('arrivalIntlMin')} range={ARRIVAL_MIN_RANGE} presets={ARRIVAL_PRESETS} accent="emerald" />
              </Row>
              <Row icon={<MapPin className="w-3.5 h-3.5 text-slate-400" />} label="Domestic">
                <Stepper value={draft.arrivalDomesticMin} onChange={set('arrivalDomesticMin')} range={ARRIVAL_MIN_RANGE} presets={ARRIVAL_PRESETS} accent="emerald" />
              </Row>
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Round suggested times</p>
          <div className="flex flex-wrap gap-1.5">
            {ROUND_STEPS.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setDraft(d => ({ ...d, roundToMin: r }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  draft.roundToMin === r ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {r === 0 ? 'Exact' : `${r} min`}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            Pickups round earlier and arrival meetings round later, so rounding only ever adds slack —
            an 11:10 flight with a 3 hr buffer becomes an 8:00 pickup at 15 min, not 8:10.
          </p>
        </div>

        {/* Live preview against a sample flight */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Preview · departs {to12h(SAMPLE_DEP)}, lands {to12h(SAMPLE_ARR)}
          </p>
          <Timeline
            leftTime={depIntl} leftLabel="Pickup" leftIcon={<Hotel className="w-3 h-3" />}
            rightTime={SAMPLE_DEP} rightLabel="Intl dep" rightIcon={<PlaneTakeoff className="w-3 h-3" />}
            gap={draft.departureIntlMin} accent="indigo"
          />
          <Timeline
            leftTime={depDom} leftLabel="Pickup" leftIcon={<Hotel className="w-3 h-3" />}
            rightTime={SAMPLE_DEP} rightLabel="Dom dep" rightIcon={<PlaneTakeoff className="w-3 h-3" />}
            gap={draft.departureDomesticMin} accent="indigo"
          />
          <Timeline
            leftTime={SAMPLE_ARR} leftLabel="Intl lands" leftIcon={<PlaneLanding className="w-3 h-3" />}
            rightTime={arrIntl} rightLabel="Meet" rightIcon={<UserCheck className="w-3 h-3" />}
            gap={draft.arrivalIntlMin} accent="emerald"
          />
          <Timeline
            leftTime={SAMPLE_ARR} leftLabel="Dom lands" leftIcon={<PlaneLanding className="w-3 h-3" />}
            rightTime={arrDom} rightLabel="Meet" rightIcon={<UserCheck className="w-3 h-3" />}
            gap={draft.arrivalDomesticMin} accent="emerald"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 max-w-md">
            Saved Details text is not rewritten. To refresh a row, press <b>Remove from details</b> then <b>Add to details</b> on its flight card.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDraft(DEFAULT_FLIGHT_PICKUP_RULES)}
              disabled={isDefault}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Defaults
            </button>
            <button
              type="button"
              onClick={() => void onSave(FLIGHT_PICKUP_KEY, JSON.stringify(draft))}
              disabled={!dirty || saving === FLIGHT_PICKUP_KEY}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40"
            >
              <Save className="w-3.5 h-3.5" /> {saving === FLIGHT_PICKUP_KEY ? 'Saving…' : dirty ? 'Save timings' : 'Saved'}
            </button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
