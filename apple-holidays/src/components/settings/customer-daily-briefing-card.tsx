'use client'

/**
 * Customer daily trip details — the default time guests get the WhatsApp with
 * their day's plan, and the master on/off switch.
 *
 * Writes the same rows lib/customer-whatsapp-automation.ts reads (that module
 * pulls in prisma, so the keys are repeated here). The time is the guest's
 * local time; a booking's own "Own time" / "Off" override still wins. The
 * scheduler re-reads the row every 5 minutes, so no restart is needed.
 *
 * Super Partners: only these agents' guests see the AppleHolidays header and
 * sign-off; everyone else gets the plan white-labelled (lib/super-partners.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Clock, Crown, FileText, Loader2, MessageCircle, Plus, RefreshCw, RotateCcw, Send, X } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  SETTING_SUPER_PARTNERS, DEFAULT_SUPER_PARTNERS, parseSuperPartners, isSuperPartner,
} from '@/lib/super-partners'

const KEY_TIME    = 'auto_whatsapp_daily_briefing_time'
const KEY_ENABLED = 'auto_whatsapp_daily_briefing_enabled'
const FALLBACK_TIME = '18:00'
const PRESETS = ['07:00', '08:00', '17:00', '18:00', '19:00', '20:00']

interface Props {
  settings: Record<string, string | undefined>
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

export default function CustomerDailyBriefingCard({ settings, saving, onSave }: Props) {
  const time    = settings[KEY_TIME] || FALLBACK_TIME
  const enabled = settings[KEY_ENABLED] !== 'false'   // default ON
  const sameDay = Number(time.slice(0, 2)) < 12
  const busyTime = saving === KEY_TIME

  const saveTime = (v: string) => {
    if (!/^\d{2}:\d{2}$/.test(v) || v === time) return
    void onSave(KEY_TIME, v)
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-slate-400" /> Customer Daily Trip Details
        </h3>
      </CardHeader>
      <CardBody className="p-5 space-y-5">
        <p className="text-xs text-slate-500 leading-relaxed">
          Guests mid-trip get a WhatsApp with their plan every day. This is the default send time for
          every booking, in the guest&apos;s local time (Ho Chi Minh for Vietnam, Colombo for Sri Lanka…).
          A booking set to its own time or to Off on the booking page keeps that.
        </p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-800">Automatic daily send</p>
            <p className="text-xs text-slate-400">When off, daily details only go out when sent manually.</p>
          </div>
          <button
            disabled={saving === KEY_ENABLED}
            onClick={() => onSave(KEY_ENABLED, enabled ? 'false' : 'true')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
            aria-label="Toggle automatic daily send"
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label htmlFor="daily-briefing-time" className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-slate-400" /> Default send time
            </label>
            <input
              id="daily-briefing-time"
              type="time"
              key={time}
              defaultValue={time}
              disabled={busyTime}
              onBlur={e => saveTime(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm tabular-nums disabled:opacity-50"
            />
            {busyTime && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                disabled={busyTime}
                onClick={() => saveTime(p)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors disabled:opacity-50 ${
                  p === time
                    ? 'border-brand-300 bg-brand-50 text-brand-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            At {time} guests get {sameDay ? "that same day's" : "the next day's"} plan.
            Before 12:00 sends the same day&apos;s plan; 12:00 or later sends tomorrow&apos;s.
          </p>
        </div>

        <SuperPartners settings={settings} saving={saving} onSave={onSave} />

        <GuestTemplate />
      </CardBody>
    </Card>
  )
}

interface BookingAgent { name: string; count: number }

const AGENTS_SHOWN = 12

function SuperPartners({ settings, saving, onSave }: Props) {
  const keys = useMemo(() => parseSuperPartners(settings[SETTING_SUPER_PARTNERS]), [settings])
  const busy = saving === SETTING_SUPER_PARTNERS
  const isDefault = settings[SETTING_SUPER_PARTNERS] == null
  const [draft, setDraft] = useState('')
  const [agents, setAgents] = useState<BookingAgent[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetch('/api/admin/settings/booking-agents')
      .then(r => r.json())
      .then(j => setAgents(j.success ? j.data : []))
      .catch(() => setAgents([]))
  }, [])

  const save = (next: string[]) => void onSave(SETTING_SUPER_PARTNERS, JSON.stringify(parseSuperPartners(JSON.stringify(next))))
  const add = (k: string) => {
    const v = k.trim()
    if (!v) return
    save([...keys, v])
    setDraft('')
  }

  const covered = agents?.filter(a => isSuperPartner(a.name, keys)) ?? []
  const coveredBookings = covered.reduce((n, a) => n + a.count, 0)
  const totalBookings = agents?.reduce((n, a) => n + a.count, 0) ?? 0
  const visibleAgents = showAll ? agents ?? [] : (agents ?? []).slice(0, AGENTS_SHOWN)

  return (
    <div className="space-y-3 border-t border-slate-100 pt-5">
      <div>
        <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
          <Crown className="w-4 h-4 text-amber-500" /> Super Partners
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          Only guests of these agents see AppleHolidays branding in the daily plan. Everyone else gets the
          same plan without it. A name matches any agent that contains it, ignoring case and spaces, so
          &ldquo;MakeMyTrip&rdquo; also covers &ldquo;Make My Trip Pvt Ltd&rdquo;.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {keys.length === 0 && <span className="text-xs text-slate-400 italic">No super partners. Every guest gets the unbranded plan.</span>}
        {keys.map(k => (
          <span key={k} className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 pl-2.5 pr-1 py-0.5 text-[11px] font-medium text-amber-800">
            {k}
            <button
              type="button"
              disabled={busy}
              onClick={() => save(keys.filter(x => x !== k))}
              className="rounded-full p-0.5 hover:bg-amber-100 disabled:opacity-50"
              aria-label={`Remove ${k}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={draft}
          disabled={busy}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(draft) }}
          placeholder="Add an agent, e.g. 30 Sundays"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => add(draft)}
          className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
        {!isDefault && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save(DEFAULT_SUPER_PARTNERS)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
            title={`Reset to ${DEFAULT_SUPER_PARTNERS.join(', ')}`}
          >
            <RotateCcw className="w-3.5 h-3.5" /> Default
          </button>
        )}
      </div>

      {/* What the guest actually sees, side by side */}
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { label: 'Super Partner guest', branded: true },
          { label: 'Any other agent', branded: false },
        ].map(p => (
          <div key={p.label} className="rounded-lg bg-[#e7fbe6] border border-emerald-100 px-3 py-2 text-[11px] leading-relaxed text-slate-700">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">{p.label}</p>
            <p className="font-semibold">🌴 {p.branded ? 'AppleHolidays — Your Day Plan' : 'Your Day Plan'}</p>
            <p className="text-slate-400">…</p>
            <p>Have a wonderful day 💙{p.branded ? ' — AppleHolidays Team' : ''}</p>
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <p className="text-xs text-slate-500">
          Agents on bookings
          {agents && totalBookings > 0 && (
            <span className="text-slate-400"> · {coveredBookings} of {totalBookings} bookings branded</span>
          )}
        </p>
        {agents === null ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleAgents.map(a => {
              const on = isSuperPartner(a.name, keys)
              return (
                <button
                  key={a.name}
                  type="button"
                  disabled={busy || on}
                  onClick={() => add(a.name)}
                  title={on ? 'Already a super partner' : 'Make this agent a super partner'}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                    on
                      ? 'border-amber-200 bg-amber-50 text-amber-800 cursor-default'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50'
                  }`}
                >
                  {on ? '👑 ' : '+ '}{a.name} <span className="text-slate-400 tabular-nums">{a.count}</span>
                </button>
              )
            })}
            {agents.length > AGENTS_SHOWN && (
              <button type="button" onClick={() => setShowAll(v => !v)} className="text-[11px] text-brand-600 hover:underline px-1">
                {showAll ? 'Show fewer' : `Show all ${agents.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface GuestTemplateInfo {
  name: string
  body: string
  examples: string[]
  status: { status: string; mismatch?: string; error?: string }
}

/**
 * The WhatsApp template that carries the plan (and any desk message) to a guest
 * whose 24h window is shut. Until it is APPROVED, guests outside the window are
 * sent free-form exactly as before, which Meta drops.
 */
function GuestTemplate() {
  const [info, setInfo] = useState<GuestTemplateInfo | null>(null)
  const [hidden, setHidden] = useState(false)
  const [checking, setChecking] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [showBody, setShowBody] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/whatsapp/templates/bootstrap-guest')
      if (res.status === 403) { setHidden(true); return }   // admins only
      const json = await res.json()
      if (json.success) setInfo(json.data)
    } catch { /* leave the last known status */ } finally { setChecking(false) }
  }, [])
  useEffect(() => { void check() }, [check])

  async function register() {
    setRegistering(true)
    try {
      const res = await fetch('/api/whatsapp/templates/bootstrap-guest', { method: 'POST' })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success(json.message || 'Template submitted to Meta')
      setInfo(i => (i ? { ...i, status: json.data.status } : i))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Registration failed', { duration: 10000 })
    } finally { setRegistering(false) }
  }

  if (hidden) return null
  const st = info?.status.status ?? '…'
  const tone = st === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : st === 'PENDING' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : st === 'MISSING' || st === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-slate-50 text-slate-500 border-slate-200'

  return (
    <div className="space-y-2 border-t border-slate-100 pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-slate-400" /> Delivery when the 24h window is closed
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            WhatsApp drops free-form messages to a guest who hasn&apos;t written to us in 24 hours. Once this
            template is approved, the daily plan, the feedback invite and messages typed in a booking&apos;s chat
            go out through it instead: line breaks become &ldquo;·&rdquo; and a long plan is split into parts.
            Until then nothing changes.
          </p>
        </div>
        <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}>{st}</span>
      </div>

      {info?.status.mismatch && <p className="text-xs text-red-600">Template {info.status.mismatch}.</p>}
      {info?.status.error && <p className="text-xs text-slate-400 break-words">Status check: {info.status.error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <code className="text-[11px] text-slate-600 bg-slate-100 rounded px-1.5 py-0.5">{info?.name ?? 'apple_holidays_guest_message'}</code>
        {(st === 'MISSING' || st === 'REJECTED') && (
          <button
            type="button"
            disabled={registering}
            onClick={register}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Register with Meta
          </button>
        )}
        <button
          type="button"
          disabled={checking}
          onClick={check}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Check status
        </button>
        {info && (
          <button type="button" onClick={() => setShowBody(v => !v)} className="text-[11px] text-brand-600 hover:underline">
            {showBody ? 'Hide wording' : 'Show wording'}
          </button>
        )}
      </div>

      {showBody && info && (
        <div className="rounded-lg bg-[#e7fbe6] border border-emerald-100 px-3 py-2 text-[11px] leading-relaxed text-slate-700 whitespace-pre-wrap">
          {info.body.replace(/\{\{(\d+)\}\}/g, (_m, n: string) => info.examples[Number(n) - 1] ?? '')}
        </div>
      )}
    </div>
  )
}
