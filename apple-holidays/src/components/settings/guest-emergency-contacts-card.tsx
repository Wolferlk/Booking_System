'use client'

/**
 * Settings → Guest Emergency Contacts.
 *
 * The people a traveller should call, per operation country. They print on
 * the Tour Confirmation and the Full Details + Vouchers documents (PDF and
 * Word) and in the WhatsApp text blocks. Stored as one JSON row
 * (`guest_emergency_contacts`, see lib/emergency-contacts.ts); the card keeps
 * a draft and saves it in one go.
 */

import { useEffect, useMemo, useState } from 'react'
import { PhoneCall, Plus, Trash2, Save, RotateCcw, ArrowUp, ArrowDown, Eye, FileText } from 'lucide-react'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import {
  EMERGENCY_COUNTRIES, GUEST_EMERGENCY_KEY, defaultGuestEmergencyPolicy, parseGuestEmergencyPolicy,
  resolveGuestEmergencyContacts, serialiseGuestEmergencyPolicy,
  type EmergencyCountry, type GuestEmergencyContact, type GuestEmergencyPolicy,
} from '@/lib/emergency-contacts'

interface Props {
  settings: Record<string, string | undefined>
  saving: string | null
  onSave: (key: string, value: string) => Promise<void>
}

const COUNTRY_LABEL: Record<EmergencyCountry, string> = {
  VIETNAM: '🇻🇳 Vietnam',
  SRILANKA: '🇱🇰 Sri Lanka',
  SINGAPORE_MALAYSIA: '🇸🇬 Singapore / 🇲🇾 Malaysia',
}

const blank = (): GuestEmergencyContact => ({ name: '', phone: '', role: '', countries: [] })

export default function GuestEmergencyContactsCard({ settings, saving, onSave }: Props) {
  const stored = useMemo(() => parseGuestEmergencyPolicy(settings[GUEST_EMERGENCY_KEY]), [settings])
  const [draft, setDraft] = useState<GuestEmergencyPolicy>(stored)
  const [preview, setPreview] = useState<EmergencyCountry>('VIETNAM')
  useEffect(() => setDraft(stored), [stored])

  const dirty = serialiseGuestEmergencyPolicy(draft) !== serialiseGuestEmergencyPolicy(stored) || !stored.configured
  const invalid = draft.contacts.some(c => (c.name.trim() || c.phone.trim()) && !(c.name.trim() && c.phone.replace(/\D/g, '').length >= 6))
  const previewList = resolveGuestEmergencyContacts({ ...draft, includeBookingContacts: false }, preview)

  const update = (i: number, patch: Partial<GuestEmergencyContact>) =>
    setDraft(d => ({ ...d, contacts: d.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))
  const move = (i: number, dir: -1 | 1) =>
    setDraft(d => {
      const list = [...d.contacts]
      const j = i + dir
      if (j < 0 || j >= list.length) return d
      ;[list[i], list[j]] = [list[j], list[i]]
      return { ...d, contacts: list }
    })
  const toggleCountry = (i: number, c: EmergencyCountry) =>
    update(i, {
      countries: draft.contacts[i].countries.includes(c)
        ? draft.contacts[i].countries.filter(x => x !== c)
        : [...draft.contacts[i].countries, c],
    })

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-slate-400" /> Guest Emergency Contacts
        </h3>
        <p className="mt-1 text-[11.5px] text-slate-500">
          Who a guest should call during the tour. Printed on the Tour Confirmation and the Full Details + Vouchers
          documents (PDF &amp; Word) and in the WhatsApp emergency block. Tag each person with the countries they cover —
          no tag means every country.
        </p>
        {!stored.configured && (
          <p className="mt-2 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            Not saved yet — documents use the built-in list shown below. Save once to take control of it.
          </p>
        )}
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="space-y-2.5">
          {draft.contacts.map((c, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_1.1fr_auto] items-start">
                <input
                  value={c.name}
                  onChange={e => update(i, { name: e.target.value })}
                  placeholder="Name"
                  className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <input
                  value={c.role ?? ''}
                  onChange={e => update(i, { role: e.target.value })}
                  placeholder="Role (e.g. 24/7 Operations)"
                  className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <input
                  value={c.phone}
                  onChange={e => update(i, { phone: e.target.value })}
                  placeholder="+84 94 516 95 95"
                  inputMode="tel"
                  className={`px-2.5 py-1.5 text-sm font-mono border rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${
                    c.phone && c.phone.replace(/\D/g, '').length < 6 ? 'border-red-300 bg-red-50' : 'border-slate-200'
                  }`}
                />
                <div className="flex items-center gap-1 justify-end">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center">
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.contacts.length - 1} title="Move down"
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center">
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" title="Remove"
                    onClick={() => setDraft(d => ({ ...d, contacts: d.contacts.filter((_, j) => j !== i) }))}
                    className="w-7 h-7 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 flex items-center justify-center">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Covers</span>
                <button
                  type="button"
                  onClick={() => update(i, { countries: [] })}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    c.countries.length === 0 ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  All countries
                </button>
                {EMERGENCY_COUNTRIES.map(country => (
                  <button
                    key={country}
                    type="button"
                    onClick={() => toggleCountry(i, country)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      c.countries.includes(country) ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {COUNTRY_LABEL[country]}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDraft(d => ({ ...d, contacts: [...d.contacts, blank()] }))}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border-2 border-dashed border-slate-200 text-xs font-semibold text-slate-500 hover:border-brand-400 hover:text-brand-600"
          >
            <Plus className="w-3.5 h-3.5" /> Add contact
          </button>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.includeBookingContacts}
            onChange={e => setDraft(d => ({ ...d, includeBookingContacts: e.target.checked }))}
            className="mt-0.5"
          />
          <span className="text-[12px] text-slate-600">
            <b className="text-slate-800">Also list the booking&apos;s own contacts from the TC</b>
            <br />
            Added under the people above. Rows with no usable phone number, numbers already listed and staff who have left
            are skipped automatically.
          </span>
        </label>

        {/* Preview — what the guest sees in the PDF */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <Eye className="w-3.5 h-3.5" /> Guest sees · <FileText className="w-3.5 h-3.5" /> PDF
            </p>
            <div className="flex gap-1">
              {EMERGENCY_COUNTRIES.map(country => (
                <button key={country} type="button" onClick={() => setPreview(country)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    preview === country ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 border border-slate-200'
                  }`}>
                  {COUNTRY_LABEL[country]}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-1 h-4 bg-amber-600 rounded-sm" />
              <span className="text-[11px] font-bold tracking-wide text-slate-800">EMERGENCY CONTACTS</span>
            </div>
            {previewList.length === 0 ? (
              <p className="text-[12px] text-amber-700">No contact covers this country — guests would see none.</p>
            ) : previewList.map((c, i) => (
              <div key={i} className={`grid grid-cols-[1fr_1fr_auto] gap-2 px-2 py-1.5 text-[12px] ${i % 2 === 0 ? 'bg-slate-50' : ''}`}>
                <span className="font-bold text-slate-800 truncate">{c.name}</span>
                <span className="text-slate-500 truncate">{c.role}</span>
                <span className="font-bold text-emerald-600 tabular-nums">{c.phone}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {invalid && <span className="text-[11px] text-red-600 mr-auto">Every contact needs a name and a phone number.</span>}
          <button
            type="button"
            onClick={() => setDraft(defaultGuestEmergencyPolicy())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Built-in list
          </button>
          <button
            type="button"
            disabled={!dirty || invalid || saving === GUEST_EMERGENCY_KEY}
            onClick={() => onSave(GUEST_EMERGENCY_KEY, serialiseGuestEmergencyPolicy(draft))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-brand-500 hover:bg-brand-600 disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" /> {saving === GUEST_EMERGENCY_KEY ? 'Saving…' : 'Save contacts'}
          </button>
        </div>
      </CardBody>
    </Card>
  )
}
