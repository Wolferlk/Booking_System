/**
 * Server-side reader for the Settings → Guest Emergency Contacts card.
 * Pure parsing / merging lives in `emergency-contacts.ts` so the settings UI
 * can share it; this file only adds the database read.
 */
import { prisma } from '@/lib/prisma'
import {
  GUEST_EMERGENCY_KEY, defaultGuestEmergencyPolicy, parseGuestEmergencyPolicy,
  resolveGuestEmergencyContacts, formatEmergencyContactsBlock,
  type GuestEmergencyPolicy, type ResolvedEmergencyContact,
} from '@/lib/emergency-contacts'

export async function loadGuestEmergencyPolicy(): Promise<GuestEmergencyPolicy> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: GUEST_EMERGENCY_KEY } })
    return parseGuestEmergencyPolicy(row?.value)
  } catch (err) {
    console.error('[emergency-contacts] settings read failed, using defaults:', err)
    return defaultGuestEmergencyPolicy()
  }
}

/** Everything a guest document should list for this booking. */
export async function guestEmergencyContactsFor(booking: {
  operationCountry?: string | null
  emergencyContacts?: { name?: string | null; phone?: string | null; role?: string | null }[] | null
}): Promise<ResolvedEmergencyContact[]> {
  const policy = await loadGuestEmergencyPolicy()
  return resolveGuestEmergencyContacts(policy, booking.operationCountry, booking.emergencyContacts ?? [])
}

/** The WhatsApp "*Emergency Contacts:*" block, from Settings (team contacts only). */
export async function emergencyContactsBlockFor(operationCountry: string | null | undefined): Promise<string> {
  const policy = await loadGuestEmergencyPolicy()
  const contacts = resolveGuestEmergencyContacts({ ...policy, includeBookingContacts: false }, operationCountry)
  return formatEmergencyContactsBlock(contacts)
}
