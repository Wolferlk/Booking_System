'use client'

/**
 * Country-code-aware phone / WhatsApp input + the "this number powers…" strip.
 *
 * The guest's WhatsApp is what the daily trip plan, the feedback request and
 * the AI calls all dial. A number typed without its country code looks fine to
 * a human and is silently undeliverable to Meta, so this input:
 *   · shows the detected country (flag + dial code) as you type
 *   · flags a missing code and offers a one-tap fix using the guest's
 *     nationality ("Use +91 9535250259")
 *   · lets staff pick any other country from a searchable list
 * Validation rules live in `lib/phone-intl.ts`, shared with the booking PUT
 * route, so the page and the server can never disagree.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Search, CalendarDays, Star, Bot,
  Zap, ArrowRight, Loader2, Link2,
} from 'lucide-react'
import { FlagByCode } from '@/components/ui/country-flag'
import {
  DIAL_COUNTRIES, checkPhone, withCountry, type DialCountry, type PhoneVerdict,
} from '@/lib/phone-intl'

const digitsOf = (v: string | null | undefined) => String(v ?? '').replace(/\D/g, '')

// ─────────────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────────────

export function IntlPhoneInput({
  value, onChange, hint, kind, placeholder, compact,
}: {
  value: string
  onChange: (v: string) => void
  /** Guest's likely country (nationality) — drives the one-tap fix. */
  hint: DialCountry | null
  kind: 'phone' | 'whatsapp'
  placeholder?: string
  /** Hide the helper line's long text (modal grid). */
  compact?: boolean
}) {
  const verdict = useMemo(() => checkPhone(value, hint), [value, hint])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const shownCountry =
    verdict.state === 'valid' ? verdict.country :
    verdict.state === 'invalid' ? verdict.country : null

  const pick = (c: DialCountry) => {
    setOpen(false); setQ('')
    // Re-home the national part under the chosen code.
    const national =
      verdict.state === 'no-country-code' ? verdict.national :
      verdict.state === 'valid' && verdict.country ? verdict.digits.slice(verdict.country.dial.length) :
      digitsOf(value)
    const fixed = national ? withCountry(national, c) : null
    onChange(fixed ? fixed.pretty : `+${c.dial} ${national}`.trim())
  }

  const tone =
    verdict.state === 'valid' ? 'border-emerald-300 focus-within:ring-emerald-100' :
    verdict.state === 'no-country-code' ? 'border-amber-400 focus-within:ring-amber-100' :
    verdict.state === 'invalid' ? 'border-red-300 focus-within:ring-red-100' :
    'border-slate-200 focus-within:ring-brand-100'

  const list = DIAL_COUNTRIES.filter(c => {
    const s = q.trim().toLowerCase().replace(/^\+/, '')
    return !s || c.name.toLowerCase().includes(s) || c.dial.startsWith(s) || c.iso.toLowerCase() === s
  })

  return (
    <div ref={boxRef} className="relative">
      <div className={`flex items-stretch rounded-lg border bg-white transition focus-within:ring-4 ${tone}`}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 pl-2.5 pr-2 border-r border-slate-100 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-l-lg shrink-0"
          title="Choose country code"
        >
          {shownCountry
            ? <FlagByCode code={shownCountry.iso} className="w-5 h-3.5 rounded-[2px] shadow-sm" />
            : <span className="w-5 h-3.5 rounded-[2px] bg-slate-100 text-[9px] leading-[14px] text-center text-slate-400">?</span>}
          <span className="tabular-nums">{shownCountry ? `+${shownCountry.dial}` : '+—'}</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>
        <input
          className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm outline-none tabular-nums"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={placeholder ?? (hint ? `+${hint.dial} …` : '+94 77 123 4567')}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { if (verdict.state === 'valid') onChange(verdict.pretty) }}
        />
        <span className="flex items-center pr-2.5">
          {verdict.state === 'valid' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          {verdict.state === 'no-country-code' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
          {verdict.state === 'invalid' && <AlertTriangle className="w-4 h-4 text-red-500" />}
        </span>
      </div>

      {open && (
        <div className="absolute z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input autoFocus className="flex-1 text-sm outline-none" placeholder="Country or code…"
              value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {hint && !q && (
              <li className="px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Guest nationality</li>
            )}
            {hint && !q && <CountryRow c={hint} onPick={pick} highlight />}
            {!q && <li className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">All</li>}
            {list.map(c => <CountryRow key={c.iso} c={c} onPick={pick} />)}
            {list.length === 0 && <li className="px-3 py-3 text-xs text-slate-400">No match</li>}
          </ul>
        </div>
      )}

      <VerdictLine verdict={verdict} kind={kind} compact={compact} onFix={onChange} onPickCountry={() => setOpen(true)} />
    </div>
  )
}

function CountryRow({ c, onPick, highlight }: { c: DialCountry; onPick: (c: DialCountry) => void; highlight?: boolean }) {
  return (
    <li>
      <button type="button" onClick={() => onPick(c)}
        className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-slate-50 ${highlight ? 'bg-amber-50/60' : ''}`}>
        <FlagByCode code={c.iso} className="w-5 h-3.5 rounded-[2px] shadow-sm" />
        <span className="flex-1 text-left text-slate-700">{c.name}</span>
        <span className="text-xs text-slate-400 tabular-nums">+{c.dial}</span>
      </button>
    </li>
  )
}

function VerdictLine({ verdict, kind, compact, onFix, onPickCountry }: {
  verdict: PhoneVerdict; kind: 'phone' | 'whatsapp'; compact?: boolean
  onFix: (v: string) => void; onPickCountry: () => void
}) {
  if (verdict.state === 'empty') return null
  if (verdict.state === 'valid') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-600">
        <CheckCircle2 className="w-3 h-3" />
        {kind === 'whatsapp' ? 'WhatsApp-ready' : 'Valid'}
        {!compact && <span className="text-slate-400">· {verdict.country?.name ?? 'International'} · {verdict.pretty}</span>}
        {verdict.unverified && <span className="text-amber-600">(country code not in our list — double-check)</span>}
      </p>
    )
  }
  if (verdict.state === 'no-country-code') {
    return (
      <div className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5">
        <p className="text-[11px] text-amber-800 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          No country code{kind === 'whatsapp' || !compact ? ' — WhatsApp & AI calls can’t reach this number' : ''}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {verdict.suggestion && (
            <button type="button" onClick={() => onFix(verdict.suggestion!.pretty)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white border border-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100 shadow-sm">
              <FlagByCode code={verdict.suggestion.country.iso} className="w-4 h-3 rounded-[1px]" />
              Use {verdict.suggestion.pretty}
            </button>
          )}
          <button type="button" onClick={onPickCountry}
            className="text-[11px] text-amber-700 underline decoration-dotted hover:text-amber-900">
            {verdict.suggestion ? 'other country…' : 'pick country…'}
          </button>
        </div>
      </div>
    )
  }
  return (
    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-red-600">
      <AlertTriangle className="w-3 h-3" /> {verdict.reason}
    </p>
  )
}

/** "Same as phone" chip — shows when the phone is valid and WhatsApp differs. */
export function SameAsPhoneChip({ phone, whatsapp, hint, onUse }: {
  phone: string; whatsapp: string; hint: DialCountry | null; onUse: (v: string) => void
}) {
  const p = checkPhone(phone, hint)
  if (p.state !== 'valid' || digitsOf(whatsapp) === p.digits) return null
  return (
    <button type="button" onClick={() => onUse(p.pretty)}
      className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-green-700 hover:text-green-800">
      <Link2 className="w-3 h-3" /> same as phone
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// "This number powers…" strip
// ─────────────────────────────────────────────────────────────────────────────

interface Reach {
  briefing: { enabled: boolean; time: string; override: string | null; timezone: string }
  feedback: { enabled: boolean }
  aiCalls: { registered: boolean; status: string | null; callPhone: string | null }
}

const TZ_LABEL: Record<string, string> = {
  'Asia/Ho_Chi_Minh': 'Vietnam time', 'Asia/Colombo': 'Sri Lanka time', 'Asia/Singapore': 'SG/MY time',
}

function shortDate(d: string | null | undefined) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function ContactReachStrip({
  bookingRef, whatsapp, phone, savedWhatsapp, hint, arrivalDate, departureDate, reloadKey, onOpenAiCalls,
}: {
  bookingRef: string
  /** The number as currently typed / shown (WhatsApp, falling back to phone). */
  whatsapp: string
  phone: string
  /** What is stored now — to tell "will switch on save" from "already on it". */
  savedWhatsapp: string | null
  hint: DialCountry | null
  arrivalDate?: string | null
  departureDate?: string | null
  reloadKey?: number
  onOpenAiCalls?: () => void
}) {
  const [reach, setReach] = useState<Reach | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/bookings/${encodeURIComponent(bookingRef)}/contact-reach`)
      .then(r => r.json())
      .then(j => { if (alive && j?.success) setReach(j.data as Reach) })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [bookingRef, reloadKey])

  const source = whatsapp.trim() ? whatsapp : phone
  const v = checkPhone(source, hint)
  const ready = v.state === 'valid'
  const digits = ready ? v.digits : null
  const pretty = ready ? v.pretty : null
  const dirty = digitsOf(savedWhatsapp) !== (digits ?? digitsOf(source))

  type Row = { icon: typeof Bot; title: string; sub: string; state: 'ok' | 'warn' | 'off' | 'todo'; chip: string; action?: () => void }
  const rows: Row[] = []

  const blocked = { state: 'warn' as const, chip: source.trim() ? 'Needs country code' : 'No number' }

  // 1. Daily plan
  if (reach) {
    const tz = TZ_LABEL[reach.briefing.timezone] ?? reach.briefing.timezone
    const span = arrivalDate && departureDate ? ` · ${shortDate(arrivalDate)} → ${shortDate(departureDate)}` : ''
    rows.push({
      icon: CalendarDays, title: 'Daily trip plan',
      sub: reach.briefing.enabled ? `Every day at ${reach.briefing.time} ${tz}${span}` : 'Switched off for this booking',
      ...(!reach.briefing.enabled ? { state: 'off' as const, chip: 'Off' } : ready ? { state: 'ok' as const, chip: 'Auto-sending' } : blocked),
    })
    rows.push({
      icon: Star, title: 'Feedback request',
      sub: `Departure day${departureDate ? ` · ${shortDate(departureDate)}` : ''}`,
      ...(!reach.feedback.enabled ? { state: 'off' as const, chip: 'Off' } : ready ? { state: 'ok' as const, chip: 'Scheduled' } : blocked),
    })

    // 3. AI calls
    const ai = reach.aiCalls
    const live = ai.status === 'active' || ai.status === 'paused'
    if (!ai.registered) {
      rows.push({
        icon: Bot, title: 'AI calls',
        sub: ready ? `Not registered yet — will pre-fill ${pretty}` : 'Not registered',
        ...(ready ? { state: 'todo' as const, chip: 'Set up' } : blocked),
        action: ready ? onOpenAiCalls : undefined,
      })
    } else if (!live) {
      rows.push({ icon: Bot, title: 'AI calls', sub: `Service ${ai.status}`, state: 'off', chip: ai.status ?? 'Off', action: onOpenAiCalls })
    } else if (!ready) {
      rows.push({ icon: Bot, title: 'AI calls', sub: `Dialling +${ai.callPhone ?? '—'}`, ...blocked })
    } else if (ai.callPhone === digits) {
      rows.push({ icon: Bot, title: 'AI calls', sub: `Dialling ${pretty}${ai.status === 'paused' ? ' (paused)' : ''}`, state: 'ok', chip: 'Linked' })
    } else {
      rows.push({
        icon: Bot, title: 'AI calls',
        sub: dirty ? `Dialling +${ai.callPhone} → moves to ${pretty} on save` : `Dialling a different number (+${ai.callPhone})`,
        state: dirty ? 'todo' : 'warn', chip: dirty ? 'Switches on save' : 'Different number', action: onOpenAiCalls,
      })
    }
  }

  const okCount = rows.filter(r => r.state === 'ok').length

  return (
    <div className="mt-3 rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`relative flex w-2 h-2`}>
          {ready && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />}
          <span className={`relative inline-flex w-2 h-2 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-400'}`} />
        </span>
        <p className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1">
          <Zap className="w-3 h-3" /> This number powers
        </p>
        {pretty && <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{pretty}</span>}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-slate-300 ml-auto" />}
      </div>

      <ol className="relative ml-1 space-y-2">
        {/* the "wire" from the number to each automation */}
        <span aria-hidden className={`absolute left-[11px] top-2 bottom-2 w-px ${ready ? 'bg-gradient-to-b from-emerald-300 to-emerald-100' : 'border-l border-dashed border-amber-300'}`} />
        {rows.map(r => {
          const Icon = r.icon
          const dot =
            r.state === 'ok' ? 'bg-emerald-500 text-white' :
            r.state === 'warn' ? 'bg-amber-100 text-amber-600' :
            r.state === 'todo' ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'
          const chip =
            r.state === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            r.state === 'warn' ? 'bg-amber-50 text-amber-700 border-amber-200' :
            r.state === 'todo' ? 'bg-brand-50 text-brand-700 border-brand-200' : 'bg-slate-50 text-slate-500 border-slate-200'
          return (
            <li key={r.title} className="relative flex items-center gap-2.5">
              <span className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-white ${dot}`}>
                <Icon className="w-3.5 h-3.5" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 leading-tight">{r.title}</p>
                <p className="text-[11px] text-slate-400 truncate">{r.sub}</p>
              </div>
              {r.action ? (
                <button type="button" onClick={r.action}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium hover:brightness-95 ${chip}`}>
                  {r.chip} <ArrowRight className="w-3 h-3" />
                </button>
              ) : (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${chip}`}>{r.chip}</span>
              )}
            </li>
          )
        })}
        {!reach && !loading && <li className="text-[11px] text-slate-400 pl-8">Automation status unavailable</li>}
      </ol>

      {reach && (
        <p className="mt-2 text-[10px] text-slate-400">
          {ready
            ? `${okCount} of ${rows.length} automations will reach the guest on this number.`
            : 'Fix the number above and every automation picks it up automatically.'}
        </p>
      )}
    </div>
  )
}
