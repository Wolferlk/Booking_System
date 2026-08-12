'use client'

/**
 * Hotel Resolver — turn a hotel *name* on a booking into a hotel we can ring.
 *
 * Three tabs, in the order staff actually work:
 *
 *  1. **Match** — ranked candidates from this system's overlay and from the
 *     Accounts master list (`hotel_details`, read-only), each with a
 *     confidence bar and the reasons behind it.
 *  2. **Details** — the editable profile, for when nothing matched or the
 *     master row is thin.
 *  3. **AI Find** — live web search for the property's contacts, returned as
 *     reviewable suggestions with sources. Nothing it finds is saved until a
 *     person clicks it in.
 *
 * The Accounts master list is never written to. Everything saved here lands in
 * the booking system's own `hotel_profiles` overlay, linked to the master row
 * by id when one was matched.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Building2, Check, Copy, Globe, Link2, Loader2, Mail, MapPin, Phone,
  Plus, Search, Sparkles, Star, Trash2, ShieldCheck, MessageCircle,
  ExternalLink, Unlink, Info,
} from 'lucide-react'
import Modal from '@/components/ui/modal'
import Button from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ConfidenceBar, HealthMeter } from './precheck-ui'
import type { PrecheckHotel, PrecheckStay } from '@/lib/precheck-shared'

type Tab = 'match' | 'details' | 'ai'

interface MatchRow {
  id?: string
  name: string
  city?: string | null
  countryCode?: string | null
  country_code?: string | null
  accountsHotelId?: number | null
  phone?: string | null
  whatsapp?: string | null
  whatsappVerified?: boolean
  email?: string | null
  address?: string | null
  website?: string | null
  source?: string
  confidence?: number | null
  signals?: string[]
  health?: { score: number; label: string; missing: string[] }
}

interface AiPhone {
  label: string
  value: string
  e164: string | null
  isMobile: boolean
  isWhatsapp: boolean
  guessed: boolean
}

interface AiResult {
  officialName: string | null
  city: string | null
  country: string | null
  address: string | null
  website: string | null
  email: string | null
  googleMapsUrl: string | null
  phones: AiPhone[]
  whatsapp: string | null
  whatsappGuessed: boolean
  confidence: number
  sources: string[]
  note: string | null
}

interface Draft {
  name: string
  city: string
  countryCode: string
  accountsHotelId: number | null
  accountsHotelName: string | null
  address: string
  website: string
  phone: string
  email: string
  whatsapp: string
  whatsappVerified: boolean
  googleMapsUrl: string
  notes: string
}

function draftFrom(stay: PrecheckStay): Draft {
  const h = stay.hotel
  return {
    name: h?.name ?? stay.hotelName,
    city: h?.city ?? stay.city ?? '',
    countryCode: h?.countryCode ?? stay.countryCode,
    accountsHotelId: h?.accountsHotelId ?? null,
    accountsHotelName: h?.accountsHotelName ?? null,
    address: h?.address ?? '',
    website: h?.website ?? '',
    phone: h?.phone ?? stay.bookingContact ?? '',
    email: h?.email ?? '',
    whatsapp: h?.whatsapp ?? '',
    whatsappVerified: h?.whatsappVerified ?? false,
    googleMapsUrl: h?.googleMapsUrl ?? '',
    notes: h?.notes ?? '',
  }
}

export default function HotelResolverModal({
  open, onClose, stay, onSaved,
}: {
  open: boolean
  onClose: () => void
  stay: PrecheckStay
  /** Called after any write, so the parent can refetch. */
  onSaved: () => void
}) {
  const [tab, setTab] = useState<Tab>(stay.hotel ? 'details' : 'match')
  const [draft, setDraft] = useState<Draft>(() => draftFrom(stay))
  const [hotel, setHotel] = useState<PrecheckHotel | null>(stay.hotel)
  const [saving, setSaving] = useState(false)

  // Match tab
  const [query, setQuery] = useState(stay.hotelName)
  const [searching, setSearching] = useState(false)
  const [profiles, setProfiles] = useState<MatchRow[]>([])
  const [master, setMaster] = useState<MatchRow[]>([])
  const [masterError, setMasterError] = useState<string | null>(null)

  // AI tab
  const [aiLoading, setAiLoading] = useState(false)
  const [ai, setAi] = useState<AiResult | null>(null)

  // Contacts tab (inside Details)
  const [newContact, setNewContact] = useState({ kind: 'PHONE', label: '', value: '' })

  useEffect(() => {
    if (!open) return
    setDraft(draftFrom(stay))
    setHotel(stay.hotel)
    setQuery(stay.hotelName)
    setTab(stay.hotel ? 'details' : 'match')
  }, [open, stay])

  // ── Search ─────────────────────────────────────────────────────────────────

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    setSearching(true)
    try {
      const params = new URLSearchParams({ q, match: '1', countryCode: stay.countryCode })
      if (stay.city) params.set('city', stay.city)
      const res = await fetch(`/api/precheck/hotels?${params}`)
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setProfiles(json.data.profiles ?? [])
      setMaster(json.data.master ?? [])
      setMasterError(json.data.masterError ?? null)
    } catch (e) {
      toast.error(`Search failed: ${(e as Error).message}`)
    } finally {
      setSearching(false)
    }
  }, [stay.city, stay.countryCode])

  // Auto-run the match search the moment the tab opens on an unmatched hotel —
  // making staff press "search" for a query we already know is busywork.
  useEffect(() => {
    if (open && tab === 'match' && profiles.length === 0 && master.length === 0) {
      void runSearch(stay.hotelName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  // ── Writes ─────────────────────────────────────────────────────────────────

  /** Save the draft as a hotel profile and link it to this stay. */
  const saveProfile = useCallback(async (source: 'MANUAL' | 'ACCOUNTS' | 'AI', overrides?: Partial<Draft>) => {
    const d = { ...draft, ...overrides }
    if (!d.name.trim()) { toast.error('A hotel name is required'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/precheck/hotels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...d,
          source,
          ...(source === 'AI' && ai ? { aiResearch: ai } : {}),
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      const saved = json.data as { id: string }
      const linkRes = await fetch('/api/precheck/stay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stayKey: stay.stayKey, hotelProfileId: saved.id }),
      })
      const linkJson = await linkRes.json()
      if (!linkJson.success) throw new Error(linkJson.error)

      toast.success(`${d.name} linked to this stay`)
      setDraft(d)
      onSaved()
      setTab('details')
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [draft, ai, stay.stayKey, onSaved])

  /** Adopt a candidate from either list into the draft, then save it. */
  const adopt = useCallback((row: MatchRow, from: 'profile' | 'master') => {
    const next: Draft = {
      ...draft,
      name: row.name,
      city: row.city ?? draft.city,
      countryCode: (row.countryCode ?? row.country_code ?? draft.countryCode ?? 'LK').toUpperCase().slice(0, 2),
      accountsHotelId: from === 'master' ? (row.accountsHotelId ?? (row as { id?: unknown }).id as number ?? null) : (row.accountsHotelId ?? null),
      accountsHotelName: from === 'master' ? row.name : (draft.accountsHotelName ?? null),
      address: row.address ?? draft.address,
      website: row.website ?? draft.website,
      phone: row.phone ?? draft.phone,
      email: row.email ?? draft.email,
      whatsapp: row.whatsapp ?? draft.whatsapp,
    }
    setDraft(next)
    void saveProfile(from === 'master' ? 'ACCOUNTS' : 'MANUAL', next)
  }, [draft, saveProfile])

  const unlink = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/precheck/stay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stayKey: stay.stayKey, hotelProfileId: null }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      toast.success('Hotel unlinked from this stay')
      setHotel(null)
      onSaved()
      setTab('match')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [stay.stayKey, onSaved])

  // ── Contacts ───────────────────────────────────────────────────────────────

  const contactCall = useCallback(async (init: RequestInit & { url: string }) => {
    const { url, ...rest } = init
    const res = await fetch(url, rest)
    const json = await res.json()
    if (!json.success) throw new Error(json.error)
    setHotel(json.data as PrecheckHotel)
    onSaved()
    return json.data
  }, [onSaved])

  const addContact = useCallback(async () => {
    if (!hotel) { toast.error('Save the hotel first, then add contacts'); return }
    if (!newContact.value.trim()) { toast.error('Enter a number or email'); return }
    try {
      await contactCall({
        url: '/api/precheck/hotels/contacts',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hotelId: hotel.id, ...newContact }),
      })
      setNewContact({ kind: 'PHONE', label: '', value: '' })
      toast.success('Contact added')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [hotel, newContact, contactCall])

  const patchContact = useCallback(async (channelId: string, patch: Record<string, unknown>) => {
    try {
      await contactCall({
        url: '/api/precheck/hotels/contacts',
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, ...patch }),
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [contactCall])

  const removeContact = useCallback(async (channelId: string, value: string) => {
    if (!window.confirm(`Remove the contact "${value}"?`)) return
    try {
      await contactCall({ url: `/api/precheck/hotels/contacts?channelId=${encodeURIComponent(channelId)}`, method: 'DELETE' })
      toast.success('Contact removed')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [contactCall])

  // ── AI research ────────────────────────────────────────────────────────────

  const runAi = useCallback(async (): Promise<AiResult | null> => {
    setAiLoading(true)
    setAi(null)
    try {
      const res = await fetch('/api/precheck/hotels/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelName: draft.name || stay.hotelName,
          city: draft.city || stay.city,
          countryCode: draft.countryCode,
          bookingRef: stay.bookingRef,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const result = json.data as AiResult
      setAi(result)
      return result
    } catch (e) {
      toast.error((e as Error).message)
      return null
    } finally {
      setAiLoading(false)
    }
  }, [draft.name, draft.city, draft.countryCode, stay])

  /** Overwrite every field the AI has an answer for, keeping the rest. */
  const applyAiAll = useCallback(() => {
    if (!ai) return
    setDraft(d => ({
      ...d,
      name: ai.officialName || d.name,
      city: ai.city || d.city,
      address: ai.address || d.address,
      website: ai.website || d.website,
      email: ai.email || d.email,
      googleMapsUrl: ai.googleMapsUrl || d.googleMapsUrl,
      phone: ai.phones[0]?.e164 || ai.phones[0]?.value || d.phone,
      whatsapp: ai.whatsapp || d.whatsapp,
      // An inferred WhatsApp number is never auto-trusted.
      whatsappVerified: ai.whatsapp && !ai.whatsappGuessed ? d.whatsappVerified : false,
    }))
    setTab('details')
    toast.success('Suggestions copied into the form — review, then save')
  }, [ai])

  /**
   * Fill in the blanks on the Details form from a web lookup.
   *
   * The common case this exists for: a hotel matched cleanly against the
   * Accounts master list, but that list is a *payables* register — it carries
   * bank and payment-day data and frequently has no phone number at all. The
   * match is right; the contact details are simply missing.
   *
   * So this only writes to fields that are currently empty. Anything a person
   * already typed, or that came off the master row, is left exactly as it is —
   * a web scrape must never quietly overwrite a number staff have verified.
   */
  const fillMissingFromAi = useCallback(async () => {
    const result = await runAi()
    if (!result) return

    const filled: string[] = []
    setDraft(d => {
      const next = { ...d }
      const fill = (key: keyof Draft, value: string | null | undefined, label: string) => {
        if (!value) return
        if (String(next[key] ?? '').trim() !== '') return
        ;(next as Record<string, unknown>)[key] = value
        filled.push(label)
      }

      fill('phone', result.phones[0]?.e164 || result.phones[0]?.value, 'phone')
      fill('whatsapp', result.whatsapp, 'WhatsApp')
      fill('email', result.email, 'email')
      fill('website', result.website, 'website')
      fill('address', result.address, 'address')
      fill('city', result.city, 'city')
      fill('googleMapsUrl', result.googleMapsUrl, 'map link')
      return next
    })

    if (filled.length === 0) {
      toast.info(
        result.phones.length === 0 && !result.email
          ? 'The lookup found no contact details for this hotel — check the AI Find tab.'
          : 'Nothing was missing — see the AI Find tab to compare and overwrite.',
      )
      return
    }
    toast.success(`Filled ${filled.join(', ')} — review, then Save hotel`)
  }, [runAi])

  /** True when a linked hotel has no way to reach it — what the AI button is for. */
  const missingContacts = !draft.phone.trim() && !draft.whatsapp.trim() && !draft.email.trim()

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }))

  // ── Render ─────────────────────────────────────────────────────────────────

  const tabs: Array<{ id: Tab; label: string; icon: typeof Search; hint?: string }> = [
    { id: 'match',   label: 'Match',   icon: Link2 },
    { id: 'details', label: 'Details', icon: Building2 },
    { id: 'ai',      label: 'AI Find', icon: Sparkles },
  ]

  return (
    <Modal open={open} onClose={onClose} size="4xl" title={`Hotel — ${stay.hotelName}`}>
      <div className="space-y-4">
        {/* Context strip */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono font-bold text-slate-700">{stay.isNumber || stay.bookingRef}</span>
          {stay.city && <span className="inline-flex items-center gap-1 text-slate-500"><MapPin className="w-3 h-3" />{stay.city}</span>}
          {hotel ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 font-semibold text-emerald-700">
              <Check className="w-3 h-3" /> Linked to {hotel.name}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 font-semibold text-amber-700">
              <Info className="w-3 h-3" /> Not matched yet
            </span>
          )}
          {hotel?.accountsHotelId && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
              Accounts #{hotel.accountsHotelId}
            </span>
          )}
          {hotel && (
            <button onClick={unlink} disabled={saving} className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-rose-600">
              <Unlink className="w-3 h-3" /> Unlink
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200">
          {tabs.map(t => {
            const Icon = t.icon
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors',
                  active ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            )
          })}
        </div>

        {/* ── MATCH ─────────────────────────────────────────────────────── */}
        {tab === 'match' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void runSearch(query) }}
                  placeholder="Search hotels…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                />
              </div>
              <Button size="sm" onClick={() => void runSearch(query)} loading={searching}>Search</Button>
            </div>

            <CandidateList
              title="Apple Holidays hotel book"
              subtitle="Profiles this system already holds, with WhatsApp and verified numbers"
              rows={profiles}
              emptyLabel="No saved profile matches this name yet."
              onPick={r => adopt(r, 'profile')}
              busy={saving}
            />

            <CandidateList
              title="Accounts master list"
              subtitle="invoice_processor · hotel_details — read-only, picking one links it here"
              rows={master}
              emptyLabel={masterError ? `Accounts DB unavailable: ${masterError}` : 'No master-list hotel matches this name.'}
              onPick={r => adopt(r, 'master')}
              busy={saving}
              tone="master"
            />

            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <span className="font-semibold text-slate-800">Nothing fits?</span> Create a new hotel from this booking&apos;s name.
              </div>
              <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => { setDraft(draftFrom(stay)); setTab('details') }}>
                Add &quot;{stay.hotelName}&quot;
              </Button>
            </div>
          </div>
        )}

        {/* ── DETAILS ───────────────────────────────────────────────────── */}
        {tab === 'details' && (
          <div className="space-y-4">
            {/*
              The Accounts master list is a payables register — it holds bank
              and payment-day data, and very often no phone number. A hotel can
              therefore be matched perfectly and still be unreachable, so the
              gap is called out here with the one-click fix beside it.
            */}
            {missingContacts && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <Info className="w-4 h-4 flex-shrink-0 text-amber-600" />
                <p className="flex-1 min-w-[12rem] text-xs text-amber-800">
                  {hotel?.accountsHotelId
                    ? <>Matched to the Accounts master list, but it holds no phone, WhatsApp or email for this hotel.</>
                    : <>No way to reach this hotel yet — no phone, WhatsApp or email.</>}
                </p>
                <Button size="sm" loading={aiLoading} onClick={() => void fillMissingFromAi()}
                        icon={<Sparkles className="w-3.5 h-3.5" />}>
                  Find details with AI
                </Button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Hotel name" value={draft.name} onChange={v => set('name', v)} required />
              <Input label="City" value={draft.city} onChange={v => set('city', v)} />
              <Input label="Phone" value={draft.phone} onChange={v => set('phone', v)} icon={<Phone className="w-3.5 h-3.5" />} />
              <Input label="WhatsApp" value={draft.whatsapp} onChange={v => set('whatsapp', v)} icon={<MessageCircle className="w-3.5 h-3.5" />} />
              <Input label="Email" value={draft.email} onChange={v => set('email', v)} icon={<Mail className="w-3.5 h-3.5" />} />
              <Input label="Website" value={draft.website} onChange={v => set('website', v)} icon={<Globe className="w-3.5 h-3.5" />} />
              <div className="sm:col-span-2">
                <Input label="Address" value={draft.address} onChange={v => set('address', v)} />
              </div>
              <div className="sm:col-span-2">
                <Input label="Notes" value={draft.notes} onChange={v => set('notes', v)} placeholder="Reconfirmation quirks, who to ask for, best time to call…" />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={draft.whatsappVerified}
                onChange={e => set('whatsappVerified', e.target.checked)}
                className="rounded border-slate-300 text-brand-500 focus:ring-brand-500"
              />
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              I have confirmed this WhatsApp number reaches the hotel
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {ai && (
                <button
                  onClick={() => setTab('ai')}
                  className="mr-auto inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {ai.sources.length > 0 ? `${ai.sources.length} source${ai.sources.length > 1 ? 's' : ''} · ` : ''}
                  see the full AI result
                </button>
              )}
              {/*
                Available whether or not anything is missing — a hotel that has
                only a landline still wants its WhatsApp number found. When
                fields are already filled the lookup leaves them alone and the
                AI Find tab is where they can be compared and overwritten.
              */}
              <Button size="sm" variant="secondary" loading={aiLoading}
                      onClick={() => void fillMissingFromAi()}
                      icon={<Sparkles className="w-3.5 h-3.5" />}
                      title="Search the web and fill any field that is still blank">
                Find details with AI
              </Button>
              <Button size="sm" loading={saving} onClick={() => void saveProfile(ai ? 'AI' : hotel ? (hotel.source as 'MANUAL') : 'MANUAL')}>
                {hotel ? 'Save hotel' : 'Create & link hotel'}
              </Button>
            </div>

            {/* Contact channels */}
            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact points</h4>
                  <p className="text-[11px] text-slate-400">Keep every number the property answers on — front desk, reservations, the manager&apos;s mobile.</p>
                </div>
                {hotel && (
                  <HealthMeter score={hotel.health.score} label={hotel.health.label} missing={hotel.health.missing} />
                )}
              </div>

              {!hotel ? (
                <p className="text-xs text-slate-400 italic py-3">Save the hotel first — contact points attach to a saved profile.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {hotel.channels.length === 0 && (
                      <p className="text-xs text-slate-400 italic py-2">No contact points yet.</p>
                    )}
                    {hotel.channels.map(c => (
                      <div key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className={cn(
                          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase',
                          c.kind === 'WHATSAPP' ? 'bg-emerald-100 text-emerald-700' :
                          c.kind === 'EMAIL' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600',
                        )}>{c.kind}</span>
                        <span className="font-mono text-xs text-slate-800 truncate">{c.e164 ?? c.value}</span>
                        {c.label && <span className="text-[10px] text-slate-400 truncate">{c.label}</span>}
                        {c.guessed && !c.verified && (
                          <span className="text-[9px] font-bold uppercase text-amber-600 bg-amber-50 rounded px-1 py-0.5">guessed</span>
                        )}
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            title={c.isPrimary ? 'Primary contact' : 'Make primary'}
                            onClick={() => void patchContact(c.id, { isPrimary: true })}
                            className={cn('p-1 rounded hover:bg-slate-100', c.isPrimary ? 'text-amber-500' : 'text-slate-300')}
                          >
                            <Star className={cn('w-3.5 h-3.5', c.isPrimary && 'fill-current')} />
                          </button>
                          <button
                            title={c.verified ? 'Verified — click to unverify' : 'Mark verified'}
                            onClick={() => void patchContact(c.id, { verified: !c.verified })}
                            className={cn('p-1 rounded hover:bg-slate-100', c.verified ? 'text-emerald-600' : 'text-slate-300')}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Copy"
                            onClick={() => { void navigator.clipboard.writeText(c.e164 ?? c.value); toast.success('Copied') }}
                            className="p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Remove"
                            onClick={() => void removeContact(c.id, c.e164 ?? c.value)}
                            className="p-1 rounded text-slate-300 hover:text-rose-600 hover:bg-rose-50"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <select
                      value={newContact.kind}
                      onChange={e => setNewContact(n => ({ ...n, kind: e.target.value }))}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-brand-500"
                    >
                      {['PHONE', 'MOBILE', 'WHATSAPP', 'EMAIL', 'FAX'].map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input
                      value={newContact.label}
                      onChange={e => setNewContact(n => ({ ...n, label: e.target.value }))}
                      placeholder="Label (Reservations…)"
                      className="w-40 rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-brand-500"
                    />
                    <input
                      value={newContact.value}
                      onChange={e => setNewContact(n => ({ ...n, value: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') void addContact() }}
                      placeholder="+94 77 123 4567"
                      className="flex-1 min-w-[10rem] rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-mono focus:ring-2 focus:ring-brand-500"
                    />
                    <Button size="sm" variant="secondary" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => void addContact()}>Add</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── AI ────────────────────────────────────────────────────────── */}
        {tab === 'ai' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-white/70 p-2"><Sparkles className="w-4 h-4 text-violet-600" /></div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-slate-800">Find this hotel&apos;s contacts on the web</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Searches the property&apos;s own site, its Google Business listing and the major OTAs.
                    Everything comes back as a <span className="font-semibold">suggestion with sources</span> — nothing is saved until you say so.
                  </p>
                </div>
                <Button size="sm" loading={aiLoading} onClick={() => void runAi()} icon={<Sparkles className="w-3.5 h-3.5" />}>
                  {ai ? 'Search again' : 'Search'}
                </Button>
              </div>
            </div>

            {aiLoading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Searching the web for {draft.name || stay.hotelName}…
              </div>
            )}

            {ai && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-bold text-slate-800">{ai.officialName ?? draft.name}</span>
                  <ConfidenceBar confidence={ai.confidence} signals={ai.confidence < 50 ? ['low confidence — check carefully'] : []} />
                  <Button size="sm" className="ml-auto" onClick={applyAiAll} icon={<Check className="w-3.5 h-3.5" />}>
                    Copy all into form
                  </Button>
                </div>

                {ai.note && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Info className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />{ai.note}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ai.phones.map((p, i) => (
                    <SuggestionRow
                      key={i}
                      icon={<Phone className="w-3.5 h-3.5" />}
                      label={p.label}
                      value={p.e164 ?? p.value}
                      badge={p.isWhatsapp ? (p.guessed ? 'WhatsApp?' : 'WhatsApp') : p.isMobile ? 'mobile' : null}
                      onUse={() => { set('phone', p.e164 ?? p.value); toast.success('Phone copied into the form') }}
                    />
                  ))}
                  {ai.whatsapp && (
                    <SuggestionRow
                      icon={<MessageCircle className="w-3.5 h-3.5 text-emerald-600" />}
                      label={ai.whatsappGuessed ? 'WhatsApp (inferred from a mobile line)' : 'WhatsApp'}
                      value={ai.whatsapp}
                      badge={ai.whatsappGuessed ? 'unverified' : null}
                      onUse={() => { set('whatsapp', ai.whatsapp!); set('whatsappVerified', false); toast.success('WhatsApp copied into the form') }}
                    />
                  )}
                  {ai.email && (
                    <SuggestionRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={ai.email}
                      onUse={() => { set('email', ai.email!); toast.success('Email copied into the form') }} />
                  )}
                  {ai.website && (
                    <SuggestionRow icon={<Globe className="w-3.5 h-3.5" />} label="Website" value={ai.website}
                      onUse={() => { set('website', ai.website!); toast.success('Website copied into the form') }} />
                  )}
                  {ai.address && (
                    <SuggestionRow icon={<MapPin className="w-3.5 h-3.5" />} label="Address" value={ai.address}
                      onUse={() => { set('address', ai.address!); toast.success('Address copied into the form') }} />
                  )}
                </div>

                {ai.sources.length > 0 && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Sources</div>
                    <div className="space-y-0.5">
                      {ai.sources.map((s, i) => (
                        <a key={i} href={s} target="_blank" rel="noopener noreferrer"
                           className="flex items-center gap-1 text-[11px] text-sky-600 hover:underline truncate">
                          <ExternalLink className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{s}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <Button variant="secondary" size="sm" className="w-full"
                        loading={saving} onClick={() => void saveProfile('AI')}>
                  Save these details as the hotel profile
                </Button>
              </div>
            )}

            {!ai && !aiLoading && (
              <p className="text-center text-xs text-slate-400 py-8">
                No search run yet. Results appear here for review before anything is saved.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function CandidateList({
  title, subtitle, rows, emptyLabel, onPick, busy, tone,
}: {
  title: string
  subtitle: string
  rows: MatchRow[]
  emptyLabel: string
  onPick: (r: MatchRow) => void
  busy: boolean
  tone?: 'master'
}) {
  return (
    <div>
      <div className="mb-1.5">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</h4>
        <p className="text-[10px] text-slate-400">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400 italic py-2">{emptyLabel}</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <button
              key={`${r.id ?? r.name}-${i}`}
              disabled={busy}
              onClick={() => onPick(r)}
              className={cn(
                'w-full text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50',
                'hover:border-brand-400 hover:bg-brand-50/40',
                tone === 'master' ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white',
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                {r.whatsapp && <MessageCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                {r.health && <HealthMeter score={r.health.score} label={r.health.label} missing={r.health.missing} compact />}
                {typeof r.confidence === 'number' && (
                  <span className="ml-auto flex-shrink-0"><ConfidenceBar confidence={r.confidence} /></span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-500 pl-5">
                {r.city && <span>{r.city}</span>}
                {r.phone && <span className="font-mono">{r.phone}</span>}
                {r.address && <span className="truncate max-w-[16rem]">{r.address}</span>}
                {r.signals && r.signals.length > 0 && <span className="text-slate-400">{r.signals.join(' · ')}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SuggestionRow({
  icon, label, value, badge, onUse,
}: { icon: React.ReactNode; label: string; value: string; badge?: string | null; onUse: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 min-w-0">
      <span className="text-slate-400 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 truncate">{label}</div>
        <div className="text-xs font-mono text-slate-800 truncate">{value}</div>
      </div>
      {badge && (
        <span className="flex-shrink-0 rounded bg-amber-50 border border-amber-200 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-700">{badge}</span>
      )}
      <button onClick={onUse} title="Copy into the form"
              className="flex-shrink-0 rounded p-1 text-slate-400 hover:text-brand-600 hover:bg-brand-50">
        <Check className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function Input({
  label, value, onChange, placeholder, icon, required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  icon?: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}{required && <span className="text-rose-400"> *</span>}
      </span>
      <div className="relative mt-0.5">
        {icon && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">{icon}</span>}
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-lg border border-slate-300 py-1.5 text-xs',
            'focus:ring-2 focus:ring-brand-500 focus:border-brand-500',
            icon ? 'pl-8 pr-2.5' : 'px-2.5',
          )}
        />
      </div>
    </label>
  )
}
