import { MobileError } from '@/lib/mobile/http'
import { loadDriverTrip } from '@/lib/mobile/trips'

/** The trip behind `[ref]`, only if this driver is on it. */
export async function requireTrip(driverId: string, ref: string) {
  const trip = await loadDriverTrip(driverId, decodeURIComponent(ref))
  if (!trip) throw new MobileError('This trip is not assigned to you.', 404, 'not_found')
  return trip
}
