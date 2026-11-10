'use client'

/**
 * Settings → Customer Branding ("white-label mode").
 *
 * Four switches — WhatsApp, Mails, PDF, Word — each takes the Apple Holidays
 * name (and the Apple mark on documents) off everything a guest receives on
 * that channel. The preview runs the exact rewriter the senders use
 * (lib/customer-branding.ts), so what it shows is what goes out.
 *
 * Stored as one JSON row (`customer_branding`). Switches save instantly; the
 * replacement name saves with its own button.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck, Crown, EyeOff, Eye, MessageCircle, Mail, FileText, FileType2, Users, Save, Sparkles, ShieldCheck, Info,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  BRAND_CHANNELS, CUSTOMER_BRANDING_KEY, DEFAULT_REPLACEMENT, debrandText, parseCustomerBranding,
  serialiseCustomerBranding, type BrandChannel, type CustomerBrandingPolicy,
} from '@/lib/customer-branding'

interface Props {
  settings: Record<string, string | undefined>
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

const CHANNEL_META: Record<BrandChannel, { label: string; blurb: string; icon: LucideIcon; tint: string; ring: string }> = {
  whatsapp: { label: 'WhatsApp messages', blurb: 'Tour confirmations, daily plans, feedback asks, inbox replies, file names', icon: MessageCircle, tint: 'text-emerald-600 bg-emerald-50', ring: 'ring-emerald-300' },
  email:    { label: 'Mails',             blurb: 'Subject, body and attachment names of guest mails',                          icon: Mail,          tint: 'text-sky-600 bg-sky-50',         ring: 'ring-sky-300' },
  pdf:      { label: 'PDF documents',     blurb: 'Tour Confirmation, Full Details + Vouchers, Agenda — name and logo',          icon: FileText,      tint: 'text-rose-600 bg-rose-50',       ring: 'ring-rose-300' },
  word:     { label: 'Word documents',    blurb: 'Tour Confirmation and Agenda .docx — header, footer and file properties',    icon: FileType2,     tint: 'text-indigo-600 bg-indigo-50',   ring: 'ring-indigo-300' },
}

const NAME_IDEAS = ['Your Travel Team', 'On Ground Operation Team', 'Ground Operations', 'Your Holiday Team']

/** What each channel looks like today, word for word from the real templates. */
const SAMPLES: Record<BrandChannel, string> = {
  whatsapp: [
    'Hello Pinaki,',
    'Greetings from Apple Holidays! 🌟',
    '',
    'Please find the attached *Tour Confirmation* for your upcoming trip.',
    '',
    '*Booking Reference:* VN43206',
    '*Travel Dates:* 10 Nov 2026 – 14 Nov 2026',
    '',
    'Thank you for travelling with AppleHolidays!',
    'Have a wonderful day 💙 — AppleHolidays Team',
  ].join('\n'),
  email: [
    'Subject: Tour Confirmation — VN43206 · Apple Holidays',
    '',
    'Dear Pinaki,',
    'Thank you for booking with Apple Holidays.',
    'Your tour confirmation is attached.',
    '',
    'Apple Holidays · MMT Vietnam · confirm.booking@aahaas.com',
    '📎 AppleHolidays_Tour_Confirmation_VN43206.pdf',
  ].join('\n'),
  pdf: 'Apple Holidays',
  word: 'Apple Holidays',
}

export default function CustomerBrandingCard({ settings, saving, onSave }: Props) {
  const stored = useMemo(() => parseCustomerBranding(settings[CUSTOMER_BRANDING_KEY]), [settings])
  const [name, setName] = useState(stored.replacement)
  const [tab, setTab] = useState<BrandChannel>('whatsapp')
  const [showBefore, setShowBefore] = useState(false)
  useEffect(() => setName(stored.replacement), [stored.replacement])

  const busy = saving === CUSTOMER_BRANDING_KEY
  const save = (patch: Partial<CustomerBrandingPolicy>) =>
    onSave(CUSTOMER_BRANDING_KEY, serialiseCustomerBranding({ ...stored, ...patch, hide: { ...stored.hide, ...(patch.hide ?? {}) } }))

  const hiddenCount = BRAND_CHANNELS.filter(c => stored.hide[c]).length
  const nameDirty = name.trim() !== stored.replacement && name.trim().length > 0
  const previewName = name.trim() || DEFAULT_REPLACEMENT
  const active = stored.hide[tab] && !showBefore

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <EyeOff className="w-4 h-4 text-slate-400" /> Customer Branding
              <span className={`ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                hiddenCount === 4 ? 'bg-slate-900 text-white' : hiddenCount === 0 ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'
              }`}>
                {hiddenCount === 4 ? 'White-label' : hiddenCount === 0 ? 'Branded' : `${hiddenCount}/4 hidden`}
              </span>
            </h3>
            <p className="mt-1 text-[11.5px] text-slate-500 max-w-xl">
              Keep the <b>Apple Holidays</b> name off what guests receive. Each switch covers one channel. Sentences are
              reworded so they still read naturally (&ldquo;travelling with us&rdquo;), and links and e-mail addresses are never changed.
            </p>
          </div>
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              type="button" disabled={busy}
              onClick={() => save({ hide: { whatsapp: true, email: true, pdf: true, word: true } })}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Hide everywhere
            </button>
            <button
              type="button" disabled={busy}
              onClick={() => save({ hide: { whatsapp: false, email: false, pdf: false, word: false } })}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
            >
              Show everywhere
            </button>
          </div>
        </div>
      </CardHeader>

      <CardBody className="space-y-5">
        {/* ── The four switches ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {BRAND_CHANNELS.map(c => {
            const m = CHANNEL_META[c]
            const hidden = stored.hide[c]
            const Icon = m.icon
            return (
              <button
                key={c}
                type="button"
                disabled={busy}
                onClick={() => { void save({ hide: { ...stored.hide, [c]: !hidden } }); setTab(c) }}
                className={`group relative flex items-start gap-3 rounded-xl border p-3 text-left transition-all disabled:opacity-60 ${
                  hidden ? `border-transparent ring-2 ${m.ring} bg-white` : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${m.tint}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-900">{m.label}</span>
                  <span className="block text-[11px] text-slate-500 leading-snug">{m.blurb}</span>
                  <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold">
                    <span className={`relative transition-colors ${hidden ? 'text-slate-400' : 'text-slate-800'}`}>
                      Apple Holidays
                      <span className={`absolute left-0 top-1/2 h-[1.5px] bg-rose-500 transition-all duration-300 ${hidden ? 'w-full' : 'w-0'}`} />
                    </span>
                    {hidden && <span className="text-slate-400">→ {stored.replacement}</span>}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`relative w-9 h-5 rounded-full transition-colors ${hidden ? 'bg-slate-900' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${hidden ? 'left-[18px]' : 'left-0.5'}`} />
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${hidden ? 'text-slate-900' : 'text-slate-400'}`}>
                    {hidden ? 'Name off' : 'Name on'}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* ── Replacement name + audience ── */}
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> What guests see instead
            </p>
            <div className="flex gap-2">
              <input
                value={name}
                maxLength={60}
                onChange={e => setName(e.target.value)}
                placeholder={DEFAULT_REPLACEMENT}
                className="flex-1 min-w-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
              <button
                type="button"
                disabled={!nameDirty || busy}
                onClick={() => save({ replacement: name.trim() })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {NAME_IDEAS.map(n => (
                <button
                  key={n} type="button" onClick={() => setName(n)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    name.trim() === n ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              Used for &ldquo;Greetings from …&rdquo;, sign-offs and the document header. &ldquo;Travelling with Apple Holidays&rdquo;
              becomes &ldquo;travelling with us&rdquo;.
            </p>
          </div>

          <div className="self-start space-y-2 lg:w-72">
            <MiniSwitch
              on={stored.includeAgents}
              disabled={busy}
              onClick={() => save({ includeAgents: !stored.includeAgents })}
              icon={<Users className="w-4 h-4" />}
              title="Also hide from travel agents"
              blurb="Agent mails, Mail Box, File Handler PDF, Agent Digest. Off = agents still see our name."
            />
            <MiniSwitch
              on={stored.superPartnersKeepName}
              disabled={busy}
              onClick={() => save({ superPartnersKeepName: !stored.superPartnersKeepName })}
              icon={<Crown className="w-4 h-4" />}
              title="Super Partner guests keep the name"
              blurb="Guests of Super Partner agents (Customer Daily Trip Details) still see AppleHolidays on WhatsApp."
            />
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex gap-1 rounded-lg bg-white p-0.5 border border-slate-200">
              {BRAND_CHANNELS.map(c => {
                const Icon = CHANNEL_META[c].icon
                return (
                  <button
                    key={c} type="button" onClick={() => setTab(c)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                      tab === c ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {c === 'whatsapp' ? 'WhatsApp' : c === 'email' ? 'Mail' : c.toUpperCase()}
                  </button>
                )
              })}
            </div>
            <button
              type="button" onClick={() => setShowBefore(b => !b)}
              className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800"
            >
              {showBefore ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {showBefore ? 'Showing: before' : 'Showing: what the guest gets'}
            </button>
          </div>

          <Preview channel={tab} active={active} name={previewName} />

          <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
            {stored.hide[tab]
              ? <><BadgeCheck className="w-3.5 h-3.5 text-emerald-500" /> {CHANNEL_META[tab].label}: name is off for guests.</>
              : <><Info className="w-3.5 h-3.5 text-amber-500" /> {CHANNEL_META[tab].label}: name is on, so guests get it exactly as before.</>}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500 leading-relaxed">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 text-slate-400 mt-0.5" />
          <span>
            Drivers, vendors, guides, ticket approvers, OTP codes and staff alerts always keep the name; they are our own people.
            Approved WhatsApp <b>templates</b> keep their fixed wording at Meta; only the details we fill in are reworded.
            The WhatsApp inbox log shows the message as it was written. Changes reach every sender within 30 seconds.
          </span>
        </div>
      </CardBody>
    </Card>
  )
}

/* ── Preview pieces ───────────────────────────────────────────────────────── */

function MiniSwitch({ on, disabled, onClick, icon, title, blurb }: {
  on: boolean; disabled: boolean; onClick: () => void; icon: React.ReactNode; title: string; blurb: string
}) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className="w-full flex items-start gap-3 rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50 disabled:opacity-60"
    >
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-semibold text-slate-900">{title}</span>
        <span className="block text-[11px] text-slate-500 leading-snug">{blurb}</span>
      </span>
      <span className={`mt-1 relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${on ? 'bg-slate-900' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

/** Text with the replacement name softly highlighted, so the change is easy to spot. */
function Marked({ text, name }: { text: string; name: string }) {
  const parts = text.split(new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|\\bus\\b)`, 'g'))
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1
          ? <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit">{p}</mark>
          : <span key={i}>{p}</span>,
      )}
    </>
  )
}

/** WhatsApp's *bold*, rendered. */
function WaLine({ line, name, active }: { line: string; name: string; active: boolean }) {
  const bits = line.split(/(\*[^*]+\*)/g)
  return (
    <>
      {bits.map((b, i) => {
        const bold = /^\*[^*]+\*$/.test(b)
        const t = bold ? b.slice(1, -1) : b
        const body = active ? <Marked text={t} name={name} /> : t
        return bold ? <b key={i}>{body}</b> : <span key={i}>{body}</span>
      })}
    </>
  )
}

function Preview({ channel, active, name }: { channel: BrandChannel; active: boolean; name: string }) {
  const sample = SAMPLES[channel]
  const out = active ? debrandText(sample, name) : sample

  if (channel === 'whatsapp') {
    return (
      <div className="mx-auto max-w-sm rounded-[22px] bg-[#0b141a] p-3 shadow-inner">
        <div className="rounded-lg rounded-tl-none bg-[#202c33] px-3 py-2 text-[12.5px] leading-relaxed text-slate-100 whitespace-pre-wrap">
          {out.split('\n').map((l, i) => (
            <div key={i} className="min-h-[1em]"><WaLine line={l} name={name} active={active} /></div>
          ))}
          <div className="mt-1 text-right text-[10px] text-slate-400">10:42 ✓✓</div>
        </div>
      </div>
    )
  }

  if (channel === 'email') {
    const [subject, ...body] = out.split('\n')
    return (
      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white text-[12.5px] shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2 font-semibold text-slate-800">
          {active ? <Marked text={subject} name={name} /> : subject}
        </div>
        <div className="px-4 py-3 space-y-0.5 text-slate-600">
          {body.map((l, i) => (
            <div key={i} className={`min-h-[1em] ${l.startsWith('📎') ? 'mt-2 text-[11px] font-mono text-sky-700' : ''}`}>
              {active ? <Marked text={l} name={name} /> : l}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // PDF / Word: a miniature page — header band, a few body lines, footer.
  const isPdf = channel === 'pdf'
  const header = active ? name : 'Apple Holidays'
  const footer = active
    ? debrandText(isPdf ? 'Apple Holidays  ·  Ref: VN43206  ·  Page 1 of 3' : 'Apple Holidays Booking System — Confidential', name)
    : isPdf ? 'Apple Holidays · Ref: VN43206 · Page 1 of 3' : 'Apple Holidays Booking System — Confidential'
  return (
    <div className="mx-auto w-full max-w-[280px] aspect-[1/1.2] rounded-md bg-white shadow-md ring-1 ring-slate-200 overflow-hidden flex flex-col">
      <div className={`flex items-center gap-2 px-3 py-2.5 ${isPdf ? 'bg-slate-800 text-white' : 'border-b-2 border-indigo-200 text-slate-800'}`}>
        {!active && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/png/apple-logo.png" alt="" className="h-7 w-7 rounded bg-white/90 object-contain" />
        )}
        <div className="min-w-0">
          <div className="text-[12px] font-extrabold truncate">
            {active ? <mark className="rounded bg-amber-100 px-0.5 text-slate-900">{header}</mark> : header}
          </div>
          <div className={`text-[8px] ${isPdf ? 'text-slate-300' : 'text-slate-400'}`}>Vietnam · Tour Operations</div>
        </div>
        <div className={`ml-auto text-[10px] font-bold ${isPdf ? 'text-amber-400' : 'text-indigo-500'}`}>VN43206</div>
      </div>
      <div className="flex-1 space-y-1.5 px-3 py-3">
        <div className="text-[10px] font-bold text-slate-700">TOUR CONFIRMATION</div>
        {[92, 78, 85, 60, 88, 70, 45].map((w, i) => (
          <div key={i} className="h-1.5 rounded bg-slate-100" style={{ width: `${w}%` }} />
        ))}
      </div>
      <div className="border-t border-slate-100 px-3 py-1.5 text-center text-[8px] text-slate-400">
        {footer}
      </div>
    </div>
  )
}
