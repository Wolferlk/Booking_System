/**
 * Open trips as the Get Trips board receives them, plus a tiny in-memory hand-off
 * so the detail screen opens instantly with the trip the driver tapped.
 */
export interface OpenLeg {
  agendaItemId: string; date: string; time: string | null; timeTo: string | null
  location: string; from: string | null; to: string | null; serviceType: string
  driven: boolean; details: string | null; mealPlan: string | null
}
export interface OpenTrip {
  key: string; kind: 'BOOKING' | 'MOVEMENT'; fileNo: string; countryLabel: string
  startDate: string; endDate: string; days: number; daysAway: number; startTime: string | null
  title: string; route: string; cities: string[]; pax: number; paxAdults: number; paxChildren: number
  vehicleType: string | null; noAgenda: boolean
  requireApproval: boolean; myRequestId: string | null; busy: boolean; fits: boolean | null
  /** vendors only: active drivers not yet out on the trip's days */
  freeDrivers?: number | null
  legs: OpenLeg[]
  stays: { hotel: string; city: string; checkIn: string; checkOut: string }[]
}

/** The board's endpoint for whoever is signed in — a freelance driver or a vehicle vendor. */
export function openTripsPath(actor: { kind: string } | null): string {
  return actor?.kind === 'VENDOR' ? '/api/mobile/vendor/open-trips' : '/api/mobile/open-trips';
}

const cache = new Map<string, OpenTrip>();
export function rememberTrips(trips: OpenTrip[]) { trips.forEach(t => cache.set(t.key, t)); }
export function cachedTrip(key: string) { return cache.get(key) ?? null; }
