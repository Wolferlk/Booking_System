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
  legs: OpenLeg[]
  stays: { hotel: string; city: string; checkIn: string; checkOut: string }[]
}

const cache = new Map<string, OpenTrip>();
export function rememberTrips(trips: OpenTrip[]) { trips.forEach(t => cache.set(t.key, t)); }
export function cachedTrip(key: string) { return cache.get(key) ?? null; }
