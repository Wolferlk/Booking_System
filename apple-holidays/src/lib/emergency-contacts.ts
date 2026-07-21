/**
 * Emergency contacts shown to customers, per operation country.
 * Used in the WhatsApp confirmation / full-details messages.
 */

type Contact = { name: string; phone: string }

const SENTHOOR: Contact = { name: 'Senthoor Pandian', phone: '+91 95852 22335' }
const ARUSHA:   Contact = { name: 'Arusha',           phone: '+94 70 368 2583' }

const VIETNAM_CONTACTS: Contact[] = [
  { name: 'Helen', phone: '+84 94 959 15 36' },
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

/** Ready-to-paste WhatsApp block, including the bolded heading. */
export function buildEmergencyContactsBlock(operationCountry: string | null | undefined): string {
  const lines = getEmergencyContacts(operationCountry)
    .map(c => `📞 ${c.name} (${c.phone})`)
    .join('\n')
  return `*Emergency Contacts:*\n${lines}`
}
