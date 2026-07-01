'use client'

import { useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  User, Phone, Mail, CreditCard, Car, Truck,
  CheckCircle2, Loader2, ChevronDown, ChevronRight,
  Camera, X, Upload,
} from 'lucide-react'

const VEHICLE_TYPES: { value: string; label: string }[] = [
  { value: 'car',         label: 'Car' },
  { value: 'flatroof-van', label: 'Flatroof Van' },
  { value: 'highroof-van', label: 'Highroof Van' },
  { value: 'bus-medium',  label: 'Bus - Medium Coach' },
  { value: 'bus-high',    label: 'Bus - High Coach' },
  { value: 'other',       label: 'Other' },
]

const COUNTRY_META: Record<string, { label: string; flag: string; banks: string[]; holderPlaceholder: string; branchPlaceholder: string }> = {
  VIETNAM: {
    label: 'Vietnam',
    flag: '🇻🇳',
    banks: ['Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'MB Bank', 'ACB', 'Sacombank', 'VPBank', 'TPBank', 'VIB', 'SHB', 'Agribank', 'HDBank', 'Eximbank', 'OCB', 'MSB', 'LienVietPostBank', 'Other'],
    holderPlaceholder: 'NGUYEN VAN MINH',
    branchPlaceholder: 'Ho Chi Minh City',
  },
  SRILANKA: {
    label: 'Sri Lanka',
    flag: '🇱🇰',
    banks: ["Bank of Ceylon", "People's Bank", 'Commercial Bank', 'Hatton National Bank (HNB)', 'Sampath Bank', 'Seylan Bank', 'Nations Trust Bank (NTB)', 'NDB Bank', 'DFCC Bank', 'Pan Asia Bank', 'Union Bank', 'Amana Bank', 'Other'],
    holderPlaceholder: 'KASUN PERERA',
    branchPlaceholder: 'Colombo',
  },
  SINGAPORE: {
    label: 'Singapore',
    flag: '🇸🇬',
    banks: ['DBS', 'OCBC', 'UOB', 'Standard Chartered', 'Citibank', 'HSBC', 'Maybank', 'CIMB', 'Other'],
    holderPlaceholder: 'RAVI KUMAR',
    branchPlaceholder: 'Singapore CBD',
  },
  MALAYSIA: {
    label: 'Malaysia',
    flag: '🇲🇾',
    banks: ['Maybank', 'CIMB', 'RHB', 'Public Bank', 'Hong Leong Bank', 'Bank Islam', 'AmBank', 'Standard Chartered', 'HSBC', 'Other'],
    holderPlaceholder: 'AHMAD BIN ISMAIL',
    branchPlaceholder: 'Kuala Lumpur',
  },
  SINGAPORE_MALAYSIA: {
    label: 'Singapore / Malaysia',
    flag: '🇸🇬🇲🇾',
    banks: ['DBS', 'OCBC', 'UOB', 'Maybank', 'CIMB', 'Standard Chartered', 'Citibank', 'HSBC', 'RHB', 'Other'],
    holderPlaceholder: 'RAVI KUMAR',
    branchPlaceholder: 'Singapore CBD',
  },
}

interface FormState {
  name: string
  phone: string
  email: string
  licenseNo: string
  photoUrl: string
  vehicleType: string
  vehiclePlateNo: string
  vehicleBrand: string
  vehicleModel: string
  vehicleCapacity: string
  vehiclePhotoOutside: string
  vehiclePhotoInside: string
  bankName: string
  bankAccountNo: string
  bankHolder: string
  bankBranch: string
  bankCode: string
}

const EMPTY_FORM: FormState = {
  name: '', phone: '', email: '', licenseNo: '', photoUrl: '',
  vehicleType: 'car', vehiclePlateNo: '', vehicleBrand: '', vehicleModel: '', vehicleCapacity: '',
  vehiclePhotoOutside: '', vehiclePhotoInside: '',
  bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '',
}

export default function DriverRegisterPage() {
  const searchParams = useSearchParams()
  const country = searchParams.get('country') ?? ''
  const meta = COUNTRY_META[country]

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [showVehicle, setShowVehicle] = useState(false)
  const [showBank, setShowBank] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<Record<string, boolean>>({})
  const photoInputRef       = useRef<HTMLInputElement>(null)
  const vehicleOutsideRef   = useRef<HTMLInputElement>(null)
  const vehicleInsideRef    = useRef<HTMLInputElement>(null)

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const uploadPhoto = async (file: File, field: keyof FormState) => {
    setUploading(u => ({ ...u, [field]: true }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/public/upload-photo', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.success) setForm(f => ({ ...f, [field]: data.data.url }))
      else setError(data.message || 'Photo upload failed')
    } catch {
      setError('Photo upload failed')
    } finally {
      setUploading(u => ({ ...u, [field]: false }))
    }
  }

  const handlePhotoChange = (field: keyof FormState) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await uploadPhoto(file, field)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!form.name.trim()) { setError('Full name is required'); return }
    if (!form.phone.trim()) { setError('Phone number is required'); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/public/driver-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, country }),
      })
      const data = await res.json()
      if (data.success) {
        setSuccess(true)
      } else {
        setError(data.message || 'Registration failed. Please try again.')
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-brand-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-sm w-full text-center">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Registration Submitted!</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            Your details have been sent to the operations team. They will review and activate your profile shortly.
          </p>
          {meta && (
            <div className="mt-4 inline-flex items-center gap-2 bg-slate-50 rounded-full px-4 py-2 text-sm text-slate-600">
              <span>{meta.flag}</span>
              <span>{meta.label} Operations</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-500 rounded-xl flex items-center justify-center flex-shrink-0">
            <Truck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 leading-tight">Driver Registration</h1>
            {meta ? (
              <p className="text-xs text-slate-500">{meta.flag} {meta.label} Operations · Apple Holidays</p>
            ) : (
              <p className="text-xs text-slate-500">Apple Holidays</p>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 pb-16">
        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          Fill in your details below to register as a driver. Fields marked with <span className="text-red-500">*</span> are required.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Photo ── */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-violet-100 rounded-lg flex items-center justify-center">
                <Camera className="w-4 h-4 text-violet-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Profile Photo</h2>
              <span className="ml-auto text-xs text-slate-400">Optional</span>
            </div>

            <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange('photoUrl')} />

            {form.photoUrl ? (
              <div className="relative w-24 h-24 mx-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={form.photoUrl} alt="Profile" className="w-24 h-24 rounded-xl object-cover border-2 border-slate-200" />
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, photoUrl: '' }))}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={!!uploading.photoUrl}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl py-6 flex flex-col items-center gap-2 text-slate-400 hover:border-brand-400 hover:text-brand-500 transition-colors"
              >
                {uploading.photoUrl
                  ? <Loader2 className="w-6 h-6 animate-spin" />
                  : <Upload className="w-6 h-6" />
                }
                <span className="text-xs">{uploading.photoUrl ? 'Uploading…' : 'Tap to upload photo'}</span>
              </button>
            )}
          </div>

          {/* ── Personal Info ── */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <h2 className="text-sm font-semibold text-slate-800">Personal Information</h2>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={set('name')}
                  placeholder="e.g. Nguyen Van Minh"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                  autoComplete="name"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set('phone')}
                    placeholder="+84 901 234 567"
                    className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="your@email.com"
                    className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Driver's License Number / Driver NIC
                </label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    value={form.licenseNo}
                    onChange={set('licenseNo')}
                    placeholder="License number or NIC"
                    className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Vehicle (collapsible) ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowVehicle(v => !v)}
              className="w-full flex items-center gap-3 p-5 text-left"
            >
              <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Car className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold text-slate-800">Vehicle Details</span>
                <span className="ml-2 text-xs text-slate-400">Optional</span>
              </div>
              {showVehicle
                ? <ChevronDown className="w-4 h-4 text-slate-400" />
                : <ChevronRight className="w-4 h-4 text-slate-400" />
              }
            </button>

            {showVehicle && (
              <div className="px-5 pb-5 space-y-3 border-t border-slate-50 pt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Vehicle Type</label>
                  <select
                    value={form.vehicleType}
                    onChange={set('vehicleType')}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                  >
                    {VEHICLE_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Plate Number</label>
                  <input
                    value={form.vehiclePlateNo}
                    onChange={set('vehiclePlateNo')}
                    placeholder="e.g. 51A-12345"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300 uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Brand</label>
                    <input
                      value={form.vehicleBrand}
                      onChange={set('vehicleBrand')}
                      placeholder="Toyota"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Model</label>
                    <input
                      value={form.vehicleModel}
                      onChange={set('vehicleModel')}
                      placeholder="Innova"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Seating Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={form.vehicleCapacity}
                    onChange={set('vehicleCapacity')}
                    placeholder="7"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                  />
                </div>

                {/* Vehicle Photos */}
                <input ref={vehicleOutsideRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange('vehiclePhotoOutside')} />
                <input ref={vehicleInsideRef}  type="file" accept="image/*" className="hidden" onChange={handlePhotoChange('vehiclePhotoInside')} />

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-2">Vehicle Photos</label>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Outside */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-500 text-center">Outside</p>
                      {form.vehiclePhotoOutside ? (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={form.vehiclePhotoOutside} alt="Outside" className="w-full h-28 rounded-xl object-cover border border-slate-200" />
                          <button type="button" onClick={() => setForm(f => ({ ...f, vehiclePhotoOutside: '' }))}
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => vehicleOutsideRef.current?.click()}
                          disabled={!!uploading.vehiclePhotoOutside}
                          className="w-full h-28 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors">
                          {uploading.vehiclePhotoOutside ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                          <span className="text-[11px]">{uploading.vehiclePhotoOutside ? 'Uploading…' : 'Add photo'}</span>
                        </button>
                      )}
                    </div>

                    {/* Inside */}
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-slate-500 text-center">Inside</p>
                      {form.vehiclePhotoInside ? (
                        <div className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={form.vehiclePhotoInside} alt="Inside" className="w-full h-28 rounded-xl object-cover border border-slate-200" />
                          <button type="button" onClick={() => setForm(f => ({ ...f, vehiclePhotoInside: '' }))}
                            className="absolute top-1.5 right-1.5 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => vehicleInsideRef.current?.click()}
                          disabled={!!uploading.vehiclePhotoInside}
                          className="w-full h-28 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-1.5 text-slate-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors">
                          {uploading.vehiclePhotoInside ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                          <span className="text-[11px]">{uploading.vehiclePhotoInside ? 'Uploading…' : 'Add photo'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* ── Bank Details (collapsible) ── */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowBank(v => !v)}
              className="w-full flex items-center gap-3 p-5 text-left"
            >
              <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center">
                <CreditCard className="w-4 h-4 text-amber-600" />
              </div>
              <div className="flex-1">
                <span className="text-sm font-semibold text-slate-800">Bank Account Details</span>
                <span className="ml-2 text-xs text-slate-400">Optional</span>
              </div>
              {showBank
                ? <ChevronDown className="w-4 h-4 text-slate-400" />
                : <ChevronRight className="w-4 h-4 text-slate-400" />
              }
            </button>

            {showBank && (
              <div className="px-5 pb-5 space-y-3 border-t border-slate-50 pt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Bank Name</label>
                  {meta?.banks ? (
                    <select
                      value={form.bankName}
                      onChange={set('bankName')}
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
                    >
                      <option value="">Select bank…</option>
                      {meta.banks.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input
                      value={form.bankName}
                      onChange={set('bankName')}
                      placeholder="Bank name"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Account Number</label>
                  <input
                    value={form.bankAccountNo}
                    onChange={set('bankAccountNo')}
                    placeholder="0123456789"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    inputMode="numeric"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">Account Holder Name</label>
                  <input
                    value={form.bankHolder}
                    onChange={set('bankHolder')}
                    placeholder={meta?.holderPlaceholder ?? 'FULL NAME AS ON ACCOUNT'}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300 uppercase"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Branch</label>
                    <input
                      value={form.bankBranch}
                      onChange={set('bankBranch')}
                      placeholder={meta?.branchPlaceholder ?? 'Branch name'}
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">SWIFT / Code</label>
                    <input
                      value={form.bankCode}
                      onChange={set('bankCode')}
                      placeholder="SWIFT code"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent placeholder:text-slate-300"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          {/* ── Submit ── */}
          <button
            type="submit"
            disabled={submitting || Object.values(uploading).some(Boolean)}
            className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-semibold rounded-xl py-4 flex items-center justify-center gap-2 transition-colors text-sm shadow-md"
          >
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</>
              : <><CheckCircle2 className="w-4 h-4" /> Submit Registration</>
            }
          </button>

          <p className="text-center text-xs text-slate-400 pb-4">
            Your information will only be used for tour operations by Apple Holidays.
          </p>
        </form>
      </div>
    </div>
  )
}
