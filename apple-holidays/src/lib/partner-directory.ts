/**
 * Guides & Tour Vendors — shared, client-safe configuration.
 *
 * Both partner kinds carry the same shape (person/company, country, contact,
 * ID, photo, notes, bank), so the directory page, the public registration form
 * and the movement-chart picker are all one component driven by the descriptor
 * below rather than three near-copies per kind.
 *
 * Anything needing Prisma lives in `partner-directory-server.ts`.
 */

import type { OperationCountry } from '@/lib/country-detection'

export type PartnerKind = 'guide' | 'tourVendor'

export const PARTNER_KINDS: PartnerKind[] = ['guide', 'tourVendor']

export interface PartnerKindConfig {
  kind: PartnerKind
  /** Singular label, title case — "Guide". */
  label: string
  /** Plural label — "Guides". */
  labelPlural: string
  /** `SystemSetting` key holding the JSON array of enabled countries. */
  settingKey: 'guide_countries' | 'tour_vendor_countries'
  /** Authenticated CRUD base — `/api/ground/guides`. */
  apiBase: string
  /** Public registration POST endpoint. */
  registerApi: string
  /** Public registration page path. */
  registerPath: string
  /** Dashboard directory page path. */
  dashboardPath: string
  /** Label for the free-text specialisation field (`languages` / `services`). */
  specialityLabel: string
  /** Placeholder for that field. */
  specialityPlaceholder: string
  /** Prisma/API property name for that field. */
  specialityField: 'languages' | 'services'
  /** Tailwind accent used across cards, badges and the register header. */
  accent: {
    text: string
    bg: string
    border: string
    solid: string
    solidHover: string
    ring: string
  }
}

export const PARTNER_CONFIG: Record<PartnerKind, PartnerKindConfig> = {
  guide: {
    kind: 'guide',
    label: 'Guide',
    labelPlural: 'Guides',
    settingKey: 'guide_countries',
    apiBase: '/api/ground/guides',
    registerApi: '/api/public/guide-register',
    registerPath: '/register/guide',
    dashboardPath: '/dashboard/ground/guides',
    specialityLabel: 'Languages Spoken',
    specialityPlaceholder: 'English, Sinhala, German',
    specialityField: 'languages',
    accent: {
      text: 'text-indigo-600',
      bg: 'bg-indigo-50',
      border: 'border-indigo-100',
      solid: 'bg-indigo-500',
      solidHover: 'hover:bg-indigo-600',
      ring: 'focus:ring-indigo-400',
    },
  },
  tourVendor: {
    kind: 'tourVendor',
    label: 'Tour Vendor',
    labelPlural: 'Tour Vendors',
    settingKey: 'tour_vendor_countries',
    apiBase: '/api/ground/tour-vendors',
    registerApi: '/api/public/tour-vendor-register',
    registerPath: '/register/tour-vendor',
    dashboardPath: '/dashboard/ground/tour-vendors',
    specialityLabel: 'Services Offered',
    specialityPlaceholder: 'Safari tours, boat rides, cooking class',
    specialityField: 'services',
    accent: {
      text: 'text-teal-600',
      bg: 'bg-teal-50',
      border: 'border-teal-100',
      solid: 'bg-teal-500',
      solidHover: 'hover:bg-teal-600',
      ring: 'focus:ring-teal-400',
    },
  },
}

// ── Countries ────────────────────────────────────────────────────────────────

/** The countries a guide / tour vendor can be registered against. */
export const PARTNER_COUNTRIES: Exclude<OperationCountry, 'ALL'>[] = [
  'VIETNAM', 'SRILANKA', 'SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA',
]

export const COUNTRY_LABELS: Record<string, string> = {
  VIETNAM: 'Vietnam',
  SRILANKA: 'Sri Lanka',
  SINGAPORE: 'Singapore',
  MALAYSIA: 'Malaysia',
  SINGAPORE_MALAYSIA: 'Singapore / Malaysia',
}

export const COUNTRY_FLAGS: Record<string, string> = {
  VIETNAM: '🇻🇳',
  SRILANKA: '🇱🇰',
  SINGAPORE: '🇸🇬',
  MALAYSIA: '🇲🇾',
  SINGAPORE_MALAYSIA: '🇸🇬🇲🇾',
}

export const COUNTRY_BADGE: Record<string, string> = {
  VIETNAM: 'bg-red-50 text-red-600 border-red-100',
  SRILANKA: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  SINGAPORE: 'bg-blue-50 text-blue-600 border-blue-100',
  MALAYSIA: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  SINGAPORE_MALAYSIA: 'bg-blue-50 text-blue-600 border-blue-100',
}

/**
 * The stored setting is a JSON array of country codes. It is read from three
 * places (settings page, public register page, movement chart) and every one of
 * them must survive a hand-edited or legacy value, so parsing is total: any
 * value that is not a recognisable list yields "no countries enabled".
 */
export function parseCountryList(value: string | null | undefined): string[] {
  if (!value) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    // Tolerate a comma-separated string, which is what a hand-edit tends to leave behind.
    parsed = value.split(',')
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .map(v => String(v).trim().toUpperCase())
    .filter(v => (PARTNER_COUNTRIES as string[]).includes(v))
}

/**
 * Whether a partner kind is required for a booking's operation country.
 *
 * Singapore and Malaysia are one operating group, so enabling either (or the
 * legacy combined value) counts for all three — this mirrors `countryScope()`
 * and stops a Malaysia booking from losing its guide controls because Settings
 * only listed Singapore.
 */
export function isPartnerEnabledForCountry(
  enabled: string[],
  country: string | null | undefined,
): boolean {
  if (!country) return enabled.length > 0
  const SG_MY = ['SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']
  const c = country.toUpperCase()
  if (SG_MY.includes(c)) return enabled.some(e => SG_MY.includes(e))
  return enabled.includes(c)
}

// ── Bank pickers ─────────────────────────────────────────────────────────────

export const BANKS_BY_COUNTRY: Record<string, string[]> = {
  VIETNAM: ['Vietcombank', 'Techcombank', 'BIDV', 'VietinBank', 'MB Bank', 'ACB', 'Sacombank', 'VPBank', 'TPBank', 'VIB', 'SHB', 'Agribank', 'HDBank', 'Eximbank', 'OCB', 'MSB', 'LienVietPostBank', 'Other'],
  SRILANKA: ['Bank of Ceylon', "People's Bank", 'Commercial Bank', 'Hatton National Bank (HNB)', 'Sampath Bank', 'Seylan Bank', 'Nations Trust Bank (NTB)', 'NDB Bank', 'DFCC Bank', 'Pan Asia Bank', 'Union Bank', 'Amana Bank', 'Other'],
  SINGAPORE: ['DBS', 'OCBC', 'UOB', 'Standard Chartered', 'Citibank', 'HSBC', 'Maybank', 'CIMB', 'Other'],
  MALAYSIA: ['Maybank', 'CIMB', 'RHB', 'Public Bank', 'Hong Leong Bank', 'Bank Islam', 'AmBank', 'Standard Chartered', 'HSBC', 'Other'],
  SINGAPORE_MALAYSIA: ['DBS', 'OCBC', 'UOB', 'Maybank', 'CIMB', 'Standard Chartered', 'Citibank', 'HSBC', 'RHB', 'Other'],
}

export const HOLDER_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'NGUYEN VAN MINH', SRILANKA: 'KASUN PERERA', SINGAPORE: 'RAVI KUMAR',
  MALAYSIA: 'AHMAD BIN ISMAIL', SINGAPORE_MALAYSIA: 'RAVI KUMAR',
}

export const BRANCH_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'Ho Chi Minh City', SRILANKA: 'Colombo', SINGAPORE: 'Singapore CBD',
  MALAYSIA: 'Kuala Lumpur', SINGAPORE_MALAYSIA: 'Singapore CBD',
}

export const SWIFT_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: 'BFTVVNVX', SRILANKA: 'BCEYLKLX', SINGAPORE: 'DBSSSGSG',
  MALAYSIA: 'MBBEMYKL', SINGAPORE_MALAYSIA: 'DBSSSGSG',
}

export const PHONE_PLACEHOLDERS: Record<string, string> = {
  VIETNAM: '+84 901 234 567', SRILANKA: '+94 77 123 4567', SINGAPORE: '+65 8123 4567',
  MALAYSIA: '+60 12 345 6789', SINGAPORE_MALAYSIA: '+65 8123 4567',
}

/** National ID label, which differs enough per country to be worth naming properly. */
export const NIC_LABELS: Record<string, string> = {
  VIETNAM: 'Citizen ID (CCCD)', SRILANKA: 'NIC Number', SINGAPORE: 'NRIC / FIN',
  MALAYSIA: 'MyKad Number', SINGAPORE_MALAYSIA: 'NRIC / MyKad',
}

// ── Shared record shape ──────────────────────────────────────────────────────

export type PartnerSource = 'STAFF' | 'SELF_REGISTERED' | 'MANUAL_ENTRY'

export const SOURCE_META: Record<PartnerSource, { label: string; className: string }> = {
  STAFF:           { label: 'Added by staff',   className: 'bg-slate-100 text-slate-600 border-slate-200' },
  SELF_REGISTERED: { label: 'Self-registered',  className: 'bg-violet-50 text-violet-700 border-violet-100' },
  MANUAL_ENTRY:    { label: 'From movement',    className: 'bg-amber-50 text-amber-700 border-amber-100' },
}

export interface PartnerRecord {
  id: string
  name: string
  country: string | null
  phone: string
  whatsappPhone: string | null
  email: string | null
  photoUrl: string | null
  nicNo: string | null
  /** `languages` for guides, `services` for tour vendors. */
  speciality: string | null
  additionalInfo: string | null
  specialNote: string | null
  bankName: string | null
  bankAccountNo: string | null
  bankHolder: string | null
  bankBranch: string | null
  bankCode: string | null
  isActive: boolean
  source: PartnerSource
  createdAt: string
  assignmentCount?: number
}

/** Blank form values — also the shape the CRUD endpoints accept. */
export interface PartnerFormState {
  name: string
  country: string
  phone: string
  whatsappPhone: string
  email: string
  photoUrl: string
  nicNo: string
  speciality: string
  additionalInfo: string
  specialNote: string
  bankName: string
  bankAccountNo: string
  bankHolder: string
  bankBranch: string
  bankCode: string
  isActive: boolean
}

export const EMPTY_PARTNER_FORM: PartnerFormState = {
  name: '', country: '', phone: '', whatsappPhone: '', email: '', photoUrl: '',
  nicNo: '', speciality: '', additionalInfo: '', specialNote: '',
  bankName: '', bankAccountNo: '', bankHolder: '', bankBranch: '', bankCode: '',
  isActive: true,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Shared by the directory modal and the public form so both reject the same input. */
export function validatePartnerForm(
  form: PartnerFormState,
  opts: { requireCountry?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (!form.name.trim()) errors.name = 'Name is required'
  else if (form.name.trim().length < 2) errors.name = 'Min 2 characters'
  else if (form.name.length > 100) errors.name = 'Max 100 characters'

  if (!form.phone.trim()) errors.phone = 'Phone number is required'
  else if (form.phone.replace(/\D/g, '').length < 7) errors.phone = 'Enter a valid phone number'
  else if (form.phone.length > 20) errors.phone = 'Max 20 characters'

  if (form.whatsappPhone.trim() && form.whatsappPhone.replace(/\D/g, '').length < 7) {
    errors.whatsappPhone = 'Enter a valid WhatsApp number'
  }

  if (opts.requireCountry && !form.country) errors.country = 'Select a country'

  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errors.email = 'Enter a valid email'
  else if (form.email.length > 150) errors.email = 'Max 150 characters'

  if (form.nicNo.length > 40) errors.nicNo = 'Max 40 characters'
  if (form.bankAccountNo.length > 34) errors.bankAccountNo = 'Max 34 characters'
  else if (form.bankAccountNo && !/^[A-Za-z0-9\-\s]+$/.test(form.bankAccountNo)) errors.bankAccountNo = 'Letters, numbers, hyphens only'
  if (form.bankHolder.length > 100) errors.bankHolder = 'Max 100 characters'
  if (form.bankBranch.length > 100) errors.bankBranch = 'Max 100 characters'
  if (form.bankCode.length > 20) errors.bankCode = 'Max 20 characters'

  return errors
}
