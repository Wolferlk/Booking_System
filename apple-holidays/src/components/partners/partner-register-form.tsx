'use client'

/**
 * Public self-registration form for guides and tour vendors.
 *
 * Reached through a link Ground shares over WhatsApp (`/register/guide?country=SRILANKA`),
 * so it is built mobile-first and assumes no login and no prior context. The
 * country arrives in the query string; when it is missing or not switched on in
 * Settings, the visitor picks from the countries that are.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  User, Phone, Mail, CreditCard, MessageCircle, MapPin, Sparkles,
  CheckCircle2, Loader2, ChevronDown, ChevronRight, Camera, Building2,
  StickyNote, ShieldCheck, AlertCircle,
} from 'lucide-react'
import { Field, inputClass, PhotoUpload } from '@/components/partners/partner-fields'
import {
  PARTNER_CONFIG, BANKS_BY_COUNTRY, BRANCH_PLACEHOLDERS, COUNTRY_FLAGS,
  COUNTRY_LABELS, EMPTY_PARTNER_FORM, HOLDER_PLACEHOLDERS, NIC_LABELS,
  PHONE_PLACEHOLDERS, SWIFT_PLACEHOLDERS, validatePartnerForm,
  type PartnerFormState, type PartnerKind,
} from '@/lib/partner-directory'

export default function PartnerRegisterForm({ kind }: { kind: PartnerKind }) {
  const config = PARTNER_CONFIG[kind]
  const searchParams = useSearchParams()
  const linkCountry = (searchParams.get('country') ?? '').toUpperCase()

  const [form, setForm] = useState<PartnerFormState>({ ...EMPTY_PARTNER_FORM, country: linkCountry })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [enabledCountries, setEnabledCountries] = useState<string[] | null>(null)
  const [showBank, setShowBank] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // Which countries this partner kind is open for. Until it loads the form is
  // held back, so nobody fills in a page that turns out not to accept them.
  useEffect(() => {
    fetch('/api/public/partner-settings')
      .then(r => r.json())
      .then(json => setEnabledCountries(json.success ? (json.data[kind] ?? []) : []))
      .catch(() => setEnabledCountries([]))
  }, [kind])

  // A country in the link is only honoured once it is confirmed as enabled —
  // an old link for a country since switched off falls back to the picker.
  useEffect(() => {
    if (!enabledCountries) return
    setForm(f => {
      if (f.country && enabledCountries.includes(f.country)) return f
      return { ...f, country: enabledCountries.length === 1 ? enabledCountries[0] : '' }
    })
  }, [enabledCountries])

  const country = form.country
  const banks = BANKS_BY_COUNTRY[country]

  const set = (key: keyof PartnerFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(f => ({ ...f, [key]: e.target.value }))
      setErrors(prev => (prev[key] ? { ...prev, [key]: '' } : prev))
    }

  /** Drives the progress bar — the fields that make a profile genuinely usable. */
  const completion = useMemo(() => {
    const checks = [
      form.name.trim(), form.phone.trim(), form.country, form.email.trim(),
      form.nicNo.trim(), form.photoUrl, form.speciality.trim(), form.bankAccountNo.trim(),
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const found = validatePartnerForm(form, { requireCountry: true })
    if (Object.keys(found).length) {
      setErrors(found)
      setError('Please correct the highlighted fields')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(config.registerApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.success) setSuccess(true)
      else setError(data.error || data.message || 'Registration failed. Please try again.')
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Success ────────────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Registration Submitted!</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            Your details have been sent to the operations team. They will review and
            activate your {config.label.toLowerCase()} profile shortly.
          </p>
          {country && (
            <div className="mt-4 inline-flex items-center gap-2 bg-slate-50 rounded-full px-4 py-2 text-sm text-slate-600">
              <span>{COUNTRY_FLAGS[country]}</span>
              <span>{COUNTRY_LABELS[country]} Operations</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Loading / closed ───────────────────────────────────────────────────────

  if (enabledCountries === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  if (enabledCountries.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Registration Not Open</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            {config.label} registration is not currently open. Please contact the
            Apple Holidays operations team for help.
          </p>
        </div>
      </div>
    )
  }

  // ── Form ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header + progress */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <div className={`w-9 h-9 ${config.accent.solid} rounded-xl flex items-center justify-center flex-shrink-0`}>
            {kind === 'guide'
              ? <Sparkles className="w-5 h-5 text-white" />
              : <Building2 className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 leading-tight">{config.label} Registration</h1>
            <p className="text-xs text-slate-500 truncate">
              {country ? `${COUNTRY_FLAGS[country]} ${COUNTRY_LABELS[country]} Operations · ` : ''}Apple Holidays
            </p>
          </div>
          <span className="ml-auto text-xs font-semibold text-slate-400 tabular-nums">{completion}%</span>
        </div>
        <div className="h-1 bg-slate-100">
          <div
            className={`h-full ${config.accent.solid} transition-all duration-500`}
            style={{ width: `${completion}%` }}
          />
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 pb-16">
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          Fill in your details below to register as a {config.label.toLowerCase()}.
          Fields marked with <span className="text-red-500">*</span> are required.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>

          {/* ── Photo ── */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
                <Camera className="w-4 h-4 text-violet-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Profile Photo</h2>
              <span className="ml-auto text-xs text-slate-400">Optional</span>
            </div>
            <PhotoUpload
              value={form.photoUrl}
              onChange={url => setForm(f => ({ ...f, photoUrl: url }))}
              endpoint="/api/public/upload-photo"
              onError={setError}
            />
          </section>

          {/* ── Personal / company info ── */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">
                {kind === 'guide' ? 'Personal Information' : 'Business Information'}
              </h2>
            </div>

            <div className="space-y-3">
              <Field label={kind === 'guide' ? 'Full Name' : 'Business / Vendor Name'} required error={errors.name}>
                <input
                  value={form.name} onChange={set('name')} autoComplete="name"
                  placeholder={kind === 'guide' ? 'e.g. Kasun Perera' : 'e.g. Lanka Adventure Tours'}
                  className={inputClass(errors.name)}
                />
              </Field>

              <Field label="Country" required error={errors.country}>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <select
                    value={form.country} onChange={set('country')}
                    className={inputClass(errors.country, 'pl-10 appearance-none')}
                  >
                    <option value="">Select country…</option>
                    {enabledCountries.map(c => (
                      <option key={c} value={c}>{COUNTRY_FLAGS[c]} {COUNTRY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label="Phone Number" required error={errors.phone}>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel"
                    placeholder={PHONE_PLACEHOLDERS[country] ?? '+94 77 123 4567'}
                    className={inputClass(errors.phone, 'pl-10')}
                  />
                </div>
              </Field>

              <Field
                label="WhatsApp Number" error={errors.whatsappPhone}
                hint="Leave blank if it is the same as your phone number"
              >
                <div className="relative">
                  <MessageCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  <input
                    type="tel" value={form.whatsappPhone} onChange={set('whatsappPhone')}
                    placeholder={PHONE_PLACEHOLDERS[country] ?? '+94 77 123 4567'}
                    className={inputClass(errors.whatsappPhone, 'pl-10')}
                  />
                </div>
              </Field>

              <Field label="Email" error={errors.email}>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email" value={form.email} onChange={set('email')} autoComplete="email"
                    placeholder="your@email.com"
                    className={inputClass(errors.email, 'pl-10')}
                  />
                </div>
              </Field>

              <Field label={`${NIC_LABELS[country] ?? 'NIC / ID Number'}`} error={errors.nicNo}>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={form.nicNo} onChange={set('nicNo')}
                    placeholder="ID number"
                    className={inputClass(errors.nicNo, 'pl-10')}
                  />
                </div>
              </Field>

              <Field label={config.specialityLabel}>
                <input
                  value={form.speciality} onChange={set('speciality')}
                  placeholder={config.specialityPlaceholder}
                  className={inputClass()}
                />
              </Field>
            </div>
          </section>

          {/* ── Notes ── */}
          <section className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
                <StickyNote className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Additional Details</h2>
              <span className="ml-auto text-xs text-slate-400">Optional</span>
            </div>

            <div className="space-y-3">
              <Field label="Additional Information" hint="Address, experience, certifications, working areas…">
                <textarea
                  value={form.additionalInfo} onChange={set('additionalInfo')} rows={3}
                  placeholder="Anything the operations team should know about you"
                  className={inputClass(undefined, 'resize-y')}
                />
              </Field>

              <Field label="Special Note" hint="Availability limits, preferred regions, day-off requests…">
                <textarea
                  value={form.specialNote} onChange={set('specialNote')} rows={2}
                  placeholder="e.g. Not available on Sundays"
                  className={inputClass(undefined, 'resize-y')}
                />
              </Field>
            </div>
          </section>

          {/* ── Bank (collapsible) ── */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowBank(v => !v)}
              className="w-full flex items-center gap-3 p-5 text-left"
            >
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Building2 className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold text-slate-800">Bank Account Details</span>
                <span className="ml-2 text-xs text-slate-400">For payments</span>
              </div>
              {showBank ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
            </button>

            {showBank && (
              <div className="px-5 pb-5 space-y-3 border-t border-slate-50 pt-4">
                <Field label="Bank Name">
                  {banks ? (
                    <select value={form.bankName} onChange={set('bankName')} className={inputClass()}>
                      <option value="">Select bank…</option>
                      {banks.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input value={form.bankName} onChange={set('bankName')} placeholder="Bank name" className={inputClass()} />
                  )}
                </Field>

                <Field label="Account Number" error={errors.bankAccountNo}>
                  <input
                    value={form.bankAccountNo} onChange={set('bankAccountNo')} inputMode="numeric"
                    placeholder="0123456789" className={inputClass(errors.bankAccountNo)}
                  />
                </Field>

                <Field label="Account Holder Name" error={errors.bankHolder}>
                  <input
                    value={form.bankHolder} onChange={set('bankHolder')}
                    placeholder={HOLDER_PLACEHOLDERS[country] ?? 'FULL NAME AS ON ACCOUNT'}
                    className={inputClass(errors.bankHolder, 'uppercase')}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Branch" error={errors.bankBranch}>
                    <input
                      value={form.bankBranch} onChange={set('bankBranch')}
                      placeholder={BRANCH_PLACEHOLDERS[country] ?? 'Branch name'}
                      className={inputClass(errors.bankBranch)}
                    />
                  </Field>
                  <Field label="SWIFT / Code" error={errors.bankCode}>
                    <input
                      value={form.bankCode} onChange={set('bankCode')}
                      placeholder={SWIFT_PLACEHOLDERS[country] ?? 'SWIFT code'}
                      className={inputClass(errors.bankCode)}
                    />
                  </Field>
                </div>
              </div>
            )}
          </section>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`w-full ${config.accent.solid} ${config.accent.solidHover} disabled:opacity-60 text-white font-semibold rounded-xl py-4 flex items-center justify-center gap-2 transition-colors text-sm shadow-md`}
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              : <><CheckCircle2 className="w-4 h-4" /> Submit Registration</>}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-slate-400 pb-4">
            <ShieldCheck className="w-3.5 h-3.5" />
            Your information will only be used for tour operations by Apple Holidays.
          </p>
        </form>
      </div>
    </div>
  )
}
