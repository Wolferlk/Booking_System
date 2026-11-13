'use client'

/**
 * The guest's WhatsApp, front and centre at the top of the booking page.
 *
 * It is the one number the daily trip plan, the feedback request and the AI
 * calls all dial, so it gets a card of its own instead of hiding in the
 * Contacts section:
 *   · has a valid number  → big number, flag, "live" pulse, copy / open chat /
 *                           edit, and three lit "powers" pills
 *   · number lacks a code → amber card with the one-tap "+91" fix
 *   · no number           → a dashed "Assign WhatsApp" card; click to type one
 *                           or pick a number already on the booking
 * Saving goes through the booking PUT (contact-only update), which validates
 * the number again and moves the AI-call service onto it.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  MessageCircle, Copy, ExternalLink, Pencil, Plus, X, Check, Loader2,
  CalendarDays, Star, Bot, AlertTriangle, Sparkles, UserRound,
} from 'lucide-react'
import { FlagByCode } from '@/components/ui/country-flag'
import { IntlPhoneInput } from '@/components/bookings/intl-phone-input'
import { checkPhone, phoneProblem, type DialCountry } from '@/lib/phone-intl'

interface Candidate { label: string; value: string }

export default function GuestWhatsAppHero({
  bookingRef, whatsapp, phone, leadName, candidates, hint, canEdit, onSaved,
}: {
  bookingRef: string
  whatsapp: string | null
  phone: string | null
  leadName: string | null
  /** Other numbers found on the booking (lead passenger, guest phone…). */
  candidates: Candidate[]
  hint: DialCountry | null
  canEdit: boolean
  onSaved: () => void | Promise<void>
}) {
  const current = (whatsapp || phone || '').trim()
  const verdict = useMemo(() => checkPhone(current, hint), [current, hint])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const ready = verdict.state === 'valid'
  const pretty = ready ? verdict.pretty : current
  const digits = ready ? verdict.digits : null

  // Distinct, valid suggestions that are not already the number on file.
  const picks = useMemo(() => {
    const seen = new Set<string>()
    return candidates.flatMap(c => {
      const v = checkPhone(c.value, hint)
      const fixed = v.state === 'valid' ? v : v.state === 'no-country-code' && v.suggestion ? v.suggestion : null
      if (!fixed || fixed.digits === digits || seen.has(fixed.digits)) return []
      seen.add(fixed.digits)
      return [{ label: c.label, pretty: fixed.pretty, iso: fixed.country?.iso ?? null }]
    }).slice(0, 3)
  }, [candidates, hint, digits])

  function open(prefill: string) {
    setDraft(prefill)
    setEditing(true)
  }

  async function save(value: string) {
    const v = checkPhone(value, hint)
    if (v.state !== 'valid') { toast.error(phoneProblem(v) ?? 'Enter a WhatsApp number'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/bookings/${encodeURIComponent(bookingRef)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactWhatsapp: v.digits }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const sync = json.data?.aiCallsSync as { result: string; callPhone?: string; error?: string } | null
      const engage = json.data?.guestEngage as { status: string; approval?: string; registration?: string } | null
      if (engage?.status === 'started') {
        toast.success(`WhatsApp set to ${v.pretty} · Autopilot started`, {
          description: [
            engage.approval === 'allowed' ? 'Guest already allows calls ✓' : 'Allow request sent to the guest',
            engage.registration === 'registered' ? 'AI calls registered' : engage.registration === 'existing' ? 'AI calls already set up' : null,
            engage.approval !== 'allowed' ? 'reminders every 24 h until they tap Allow' : null,
          ].filter(Boolean).join(' · '),
        })
      } else if (sync?.result === 'updated') {
        toast.success(`WhatsApp set to ${v.pretty}`, { description: 'Daily plan, feedback & AI calls now use this number.' })
      } else if (sync?.result === 'kept-different') {
        toast.success(`WhatsApp set to ${v.pretty}`, { description: `AI calls stay on +${sync.callPhone} (another traveller).` })
      } else if (sync?.result === 'failed') {
        toast.warning(`WhatsApp set to ${v.pretty}`, { description: 'AI calls could not be moved — update them in AI Calls.' })
      } else {
        toast.success(`WhatsApp set to ${v.pretty}`, { description: 'Daily plan & feedback will reach the guest here.' })
      }
      setEditing(false)
      await onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  // ── Editor (assign / change) ────────────────────────────────────────────
  if (editing) {
    return (
      <div className="h-full rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-full bg-[#25D366] text-white shadow">
            <MessageCircle className="w-4 h-4" />
          </span>
          <p className="text-sm font-semibold text-slate-800">
            {current ? 'Change guest WhatsApp' : 'Assign guest WhatsApp'}
          </p>
          <button type="button" onClick={() => setEditing(false)} className="ml-auto text-slate-400 hover:text-slate-600" title="Cancel">
            <X className="w-4 h-4" />
          </button>
        </div>

        <IntlPhoneInput kind="whatsapp" hint={hint} value={draft} onChange={setDraft}
          placeholder={hint ? `+${hint.dial} guest's WhatsApp` : '+94 771234567'} />

        {picks.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Found on this booking
            </p>
            <div className="flex flex-wrap gap-1.5">
              {picks.map(p => (
                <button key={p.pretty} type="button" onClick={() => setDraft(p.pretty)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-emerald-300 hover:bg-emerald-50 transition">
                  {p.iso ? <FlagByCode code={p.iso} className="w-4 h-3 rounded-[1px]" /> : <UserRound className="w-3 h-3" />}
                  <span className="tabular-nums font-medium">{p.pretty}</span>
                  <span className="text-slate-400">· {p.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button type="button" disabled={saving || checkPhone(draft, hint).state !== 'valid'} onClick={() => save(draft)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow hover:bg-[#1ebe5a] disabled:opacity-40 disabled:cursor-not-allowed transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save &amp; activate
          </button>
          <p className="text-[11px] text-slate-400">Daily plan, feedback &amp; AI calls switch to it right away.</p>
        </div>
      </div>
    )
  }

  // ── Empty: assign ───────────────────────────────────────────────────────
  if (!current) {
    return (
      <button type="button" disabled={!canEdit} onClick={() => open(picks[0]?.pretty ?? '')}
        className="group h-full w-full text-left rounded-2xl p-[1.5px] bg-gradient-to-r from-emerald-300 via-teal-200 to-amber-200 bg-[length:200%_100%] animate-[waGlow_4s_linear_infinite] disabled:opacity-60 disabled:cursor-not-allowed">
        <style>{`@keyframes waGlow{0%{background-position:0% 0}100%{background-position:200% 0}}`}</style>
        <div className="flex h-full items-center gap-4 rounded-[15px] bg-white px-4 py-3.5 border border-dashed border-transparent group-hover:bg-emerald-50/40 transition">
          <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-slate-400 group-hover:bg-[#25D366] group-hover:text-white transition">
            <MessageCircle className="w-5 h-5" />
            <span className="absolute -right-0.5 -bottom-0.5 flex items-center justify-center w-[18px] h-[18px] rounded-full bg-amber-400 text-white ring-2 ring-white">
              <Plus className="w-3 h-3" />
            </span>
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-600">No guest WhatsApp</p>
            <p className="text-base font-semibold text-slate-800">
              {canEdit ? 'Tap to assign a WhatsApp number' : 'Guest WhatsApp not on file'}
            </p>
            <p className="text-xs text-slate-400 truncate">
              Without it the guest gets no daily plan, feedback form or AI calls
              {picks.length > 0 && canEdit && <> · <span className="text-emerald-600 font-medium">{picks.length} number{picks.length > 1 ? 's' : ''} found on booking</span></>}
            </p>
          </div>
          <PowerPills on={false} />
        </div>
      </button>
    )
  }

  // ── Number on file ──────────────────────────────────────────────────────
  const country = ready ? verdict.country : null
  return (
    <div className={`relative h-full overflow-hidden rounded-2xl border shadow-sm ${
      ready ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-teal-50/40' : 'border-amber-300 bg-gradient-to-r from-amber-50 via-white to-white'}`}>
      {/* soft WhatsApp-green glow */}
      {ready && <span aria-hidden className="pointer-events-none absolute -left-10 -top-10 w-40 h-40 rounded-full bg-[#25D366]/10 blur-2xl" />}

      <div className="relative flex items-center gap-4 px-4 py-3.5">
        <span className="relative flex items-center justify-center w-12 h-12 shrink-0">
          {ready && <span className="absolute inset-0 rounded-full bg-[#25D366]/30 animate-ping [animation-duration:2.5s]" />}
          <span className={`relative flex items-center justify-center w-12 h-12 rounded-full text-white shadow-md ${ready ? 'bg-gradient-to-br from-[#25D366] to-[#128C7E]' : 'bg-amber-400'}`}>
            <MessageCircle className="w-6 h-6" />
          </span>
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
            Guest WhatsApp{leadName && <span className="normal-case tracking-normal font-medium text-slate-500">· {leadName}</span>}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {country && <FlagByCode code={country.iso} className="w-6 h-4 rounded-[3px] shadow-sm" />}
            <span className="text-xl font-bold tracking-wide text-slate-900 tabular-nums whitespace-nowrap">{pretty}</span>
            {ready ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <AlertTriangle className="w-3 h-3" /> No country code
              </span>
            )}
          </div>
          {ready ? (
            <PowerPills on className="mt-1.5" />
          ) : verdict.state === 'no-country-code' && verdict.suggestion && canEdit ? (
            <button type="button" disabled={saving} onClick={() => save(verdict.suggestion!.pretty)}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white border border-amber-300 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 shadow-sm">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlagByCode code={verdict.suggestion.country.iso} className="w-4 h-3 rounded-[1px]" />}
              Fix → {verdict.suggestion.pretty}
            </button>
          ) : (
            <p className="mt-1 text-[11px] text-amber-700">Automations can’t reach this number until it has a country code.</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <IconBtn title="Copy number" onClick={() => { navigator.clipboard.writeText(ready ? `+${digits}` : current); toast.success('WhatsApp number copied') }}>
            <Copy className="w-4 h-4" />
          </IconBtn>
          {ready && (
            <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer" title="Open in WhatsApp"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-[#128C7E] hover:bg-emerald-50 transition">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {canEdit && (
            <IconBtn title="Change number" onClick={() => open(pretty)}>
              <Pencil className="w-4 h-4" />
            </IconBtn>
          )}
        </div>
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/80 transition">
      {children}
    </button>
  )
}

/** The three automations this number feeds — lit when it is reachable. */
function PowerPills({ on, className = '' }: { on: boolean; className?: string }) {
  const items = [
    { icon: CalendarDays, label: 'Daily plan' },
    { icon: Star, label: 'Feedback' },
    { icon: Bot, label: 'AI calls' },
  ]
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {items.map(({ icon: Icon, label }) => (
        <span key={label} title={label}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            on ? 'bg-white text-emerald-700 border border-emerald-200' : 'bg-slate-50 text-slate-400 border border-slate-200'}`}>
          <Icon className="w-3 h-3" /> <span className="hidden sm:inline">{label}</span>
        </span>
      ))}
    </div>
  )
}
