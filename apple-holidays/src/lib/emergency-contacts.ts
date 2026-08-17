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
