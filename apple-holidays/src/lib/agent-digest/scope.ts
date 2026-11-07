/** Which bookings a digest may look at. Shared by the daily digest and the ticket pack. */
import { detectCountryFromRef } from '@/lib/country-detection'
import { DIGEST_COUNTRIES, type DigestConfig, type DigestCountry } from './shared'

export const ACTIVE_EXCLUDED = ['DRAFT', 'CANCELLED', 'PENDING_CANCELLATION'] as const
/** "Confirmed" = past the booking-team / ground-review stages. */
export const CONFIRMED_EXCLUDED = [...ACTIVE_EXCLUDED, 'BT_CONFIRMED', 'GT_REVIEW', 'CHANGE_REQUESTED'] as const

export const ymd = (d: Date | string) => new Date(d).toISOString().slice(0, 10)
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export function bookingCountry(op: string | null, ref: string): string | null {
  return op ?? detectCountryFromRef(ref)
}

export function countryAllowed(country: string | null, wanted: DigestCountry[]): boolean {
  if (!wanted.length) return true
  if (!country || country === 'ALL') return false
  if (country === 'SINGAPORE_MALAYSIA') return wanted.includes('SINGAPORE') || wanted.includes('MALAYSIA')
  return (wanted as string[]).includes(country)
}

export function displayCountry(c: string | null): DigestCountry | null {
  return c && (DIGEST_COUNTRIES as readonly string[]).includes(c) ? (c as DigestCountry) : null
}

export function agentLabelOf(config: DigestConfig): string {
  return config.agents[0] || 'All agents'
}
