/**
 * Emergency contacts shown to customers, per operation country.
 * Used in the WhatsApp confirmation / full-details messages.
 */

type Contact = { name: string; phone: string }

const SENTHOOR: Contact = { name: 'Senthoor Pandian', phone: '+91 95852 22335' }
const ARUSHA:   Contact = { name: 'Arusha',           phone: '+94 70 368 2583' }

// Helen left the company — her number must never reach a guest again. Removed
// here and from the agenda confirmation email in `src/lib/agenda-mailer.ts`.
const VIETNAM_CONTACTS: Contact[] = [
  SENTHOOR,
  { name: 'Tina',  phone: '+84 94 516 95 95' },
]

const REGIONAL_CONTACTS: Contact[] = [SENTHOOR, ARUSHA]

export function getEmergencyContacts(operationCountry: string | null | undefined): Contact[] {
  switch (operationCountry) {
    case 'VIETNAM':            return VIETNAM_CONTACTS
    case 'SRILANKA':
    case 'SINGAPORE':
    case 'MALAYSIA':
    case 'SINGAPORE_MALAYSIA': return REGIONAL_CONTACTS
    default:                   return VIETNAM_CONTACTS
  }
}

/**
 * People who have left the company.
 *
 * The two lists above are ours to edit, but every booking also carries its own
 * `emergencyContacts` rows, extracted from the TC when the file was created.
 * Those rows are live booking data — thousands of them, written before the
 * person resigned — so they are not rewritten. Instead every guest-facing
 * surface that reads them filters through `withoutRetiredContacts()`, which is
 * what actually stops the number reaching a traveller.
 *
 * Matched on the digits of the phone number as well as the name, because the
 * same person is spelled several ways across older TCs.
 */
const RETIRED_CONTACTS: { name: RegExp; digits: string }[] = [
  { name: /\bhelen\b/i, digits: '84949591536' },
]

/** Digits only, so `+84 94 959 15 36` and `0094949591536` compare equal. */
function phoneDigits(phone: string | null | undefined): string {
  return String(phone ?? '').replace(/\D/g, '').replace(/^0+/, '')
}

/** True when this contact belongs to someone who has left the company. */
export function isRetiredContact(c: { name?: string | null; phone?: string | null }): boolean {
  const digits = phoneDigits(c.phone)
  return RETIRED_CONTACTS.some(r =>
    (digits.length >= 8 && digits.endsWith(r.digits.slice(-9))) || r.name.test(String(c.name ?? '')),
  )
}

/** Drops retired staff from a booking's own emergency-contact rows. */
export function withoutRetiredContacts<T extends { name?: string | null; phone?: string | null }>(
  contacts: T[],
): T[] {
  return contacts.filter(c => !isRetiredContact(c))
}

/** Ready-to-paste WhatsApp block, including the bolded heading. */
export function buildEmergencyContactsBlock(operationCountry: string | null | undefined): string {
  const lines = getEmergencyContacts(operationCountry)
    .map(c => `📞 ${c.name} (${c.phone})`)
    .join('\n')
  return `*Emergency Contacts:*\n${lines}`
}

/* ────────────────────────────────────────────────────────────────────────────
   Guest emergency contacts — editable in Settings
   ─────────────────────────────────────────────────
   One SystemSetting row (`guest_emergency_contacts`, JSON) holds the people a
   guest should call, each tagged with the operation countries they cover. The
   booking documents (Tour Confirmation, Full Details PDF / Word) and the
   WhatsApp text blocks read it. Until somebody saves the card, the hard-coded
   lists above are the answer, so nothing changes on the day this ships.
   ──────────────────────────────────────────────────────────────────────── */

export const GUEST_EMERGENCY_KEY = 'guest_emergency_contacts'

/** Countries a contact can cover. Empty `countries` = every country. */
export const EMERGENCY_COUNTRIES = ['VIETNAM', 'SRILANKA', 'SINGAPORE_MALAYSIA'] as const
export type EmergencyCountry = (typeof EMERGENCY_COUNTRIES)[number]

export interface GuestEmergencyContact {
  name: string
  phone: string
  /** Shown beside the name, e.g. "24/7 Operations" or "Vietnam desk". */
  role?: string
  countries: EmergencyCountry[]
}

export interface GuestEmergencyPolicy {
  contacts: GuestEmergencyContact[]
  /** Also list the contacts extracted from each booking's own TC. */
  includeBookingContacts: boolean
  /** False until the Settings card has been saved once. */
  configured: boolean
}

/** Booking country → the bucket a contact is tagged with. */
export function emergencyCountryOf(operationCountry: string | null | undefined): EmergencyCountry {
  switch (operationCountry) {
    case 'SRILANKA':           return 'SRILANKA'
    case 'SINGAPORE':
    case 'MALAYSIA':
    case 'SINGAPORE_MALAYSIA': return 'SINGAPORE_MALAYSIA'
    default:                   return 'VIETNAM'
  }
}

/** The policy as it stands before anyone edits it — today's hard-coded lists. */
export function defaultGuestEmergencyPolicy(): GuestEmergencyPolicy {
  return {
    contacts: [
      { ...SENTHOOR, role: 'Operations', countries: [] },
      { name: 'Tina',      phone: '+84 94 516 95 95', role: 'Vietnam desk', countries: ['VIETNAM'] },
      { ...ARUSHA,   role: 'Operations', countries: ['SRILANKA', 'SINGAPORE_MALAYSIA'] },
    ],
    includeBookingContacts: true,
    configured: false,
  }
}

/** Never throws — a broken row falls back to the defaults. */
export function parseGuestEmergencyPolicy(raw: string | null | undefined): GuestEmergencyPolicy {
  if (!raw) return defaultGuestEmergencyPolicy()
  try {
    const parsed = JSON.parse(raw) as Partial<GuestEmergencyPolicy>
    const contacts = (Array.isArray(parsed.contacts) ? parsed.contacts : [])
      .map((c): GuestEmergencyContact => ({
        name:  String(c?.name ?? '').trim(),
        phone: String(c?.phone ?? '').trim(),
        role:  String(c?.role ?? '').trim() || undefined,
        countries: (Array.isArray(c?.countries) ? c.countries : [])
          .filter((x): x is EmergencyCountry => (EMERGENCY_COUNTRIES as readonly string[]).includes(String(x))),
      }))
      .filter(c => c.name && c.phone)
    return {
      contacts,
      includeBookingContacts: parsed.includeBookingContacts !== false,
      configured: true,
    }
  } catch {
    return defaultGuestEmergencyPolicy()
  }
}

/** Stored shape — cleaned, so the reader never has to guess. */
export function serialiseGuestEmergencyPolicy(p: GuestEmergencyPolicy): string {
  return JSON.stringify({
    contacts: p.contacts
      .map(c => ({
        name: c.name.trim(), phone: c.phone.trim(),
        ...(c.role?.trim() ? { role: c.role.trim() } : {}),
        countries: c.countries,
      }))
      .filter(c => c.name && c.phone),
    includeBookingContacts: p.includeBookingContacts,
  })
}

export interface ResolvedEmergencyContact {
  name: string
  phone: string
  role?: string | null
  /** 'settings' = our team; 'booking' = taken from this booking's TC. */
  source: 'settings' | 'booking'
}

/**
 * The guest-facing list for one booking: the Settings contacts for its country
 * first, then (if enabled) the TC's own rows. Retired staff are dropped and a
 * number that appears twice is listed once.
 */
export function resolveGuestEmergencyContacts(
  policy: GuestEmergencyPolicy,
  operationCountry: string | null | undefined,
  bookingContacts: { name?: string | null; phone?: string | null; role?: string | null }[] = [],
): ResolvedEmergencyContact[] {
  const country = emergencyCountryOf(operationCountry)
  const seen = new Set<string>()
  const out: ResolvedEmergencyContact[] = []
  const push = (c: ResolvedEmergencyContact) => {
    if (isRetiredContact(c)) return
    const key = phoneDigits(c.phone).slice(-9) || c.name.toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(c)
  }
  for (const c of policy.contacts) {
    if (c.countries.length && !c.countries.includes(country)) continue
    push({ name: c.name, phone: c.phone, role: c.role ?? null, source: 'settings' })
  }
  if (policy.includeBookingContacts) {
    for (const c of bookingContacts) {
      const name = String(c.name ?? '').trim()
      const phone = String(c.phone ?? '').trim()
      // A TC row with no number is no use to a guest at 2 a.m.
      if (!phone || phoneDigits(phone).length < 6) continue
      push({ name: name || 'Emergency', phone, role: c.role ?? null, source: 'booking' })
    }
  }
  return out
}

/** WhatsApp block from an already-resolved list. */
export function formatEmergencyContactsBlock(contacts: { name: string; phone: string }[]): string {
  return `*Emergency Contacts:*\n${contacts.map(c => `📞 ${c.name} (${c.phone})`).join('\n')}`
}
