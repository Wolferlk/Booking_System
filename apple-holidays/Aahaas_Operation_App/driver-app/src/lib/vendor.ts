/**
 * Vehicle-vendor side of the app — the shapes /api/mobile/vendor/* returns
 * (see the server's lib/mobile/vendor.ts) and how they are shown.
 */
import { Share } from 'react-native';
import type { IconName } from '@/components/ui';
import { C } from './theme';

export type AppStatus = 'ON_APP' | 'CODE_SENT' | 'NOT_JOINED';
export type JobState = 'NEEDS_DRIVER' | 'NEEDS_VEHICLE' | 'READY' | 'LIVE' | 'DONE';

export interface LiveDay { bookingRef: string; km: number; startedAt: string; lastPingAt: string | null }

export interface VendorDriver {
  id: string; name: string; phone: string; whatsapp: string; email: string | null; licenseNo: string | null
  photoUrl: string | null; isActive: boolean; country: string | null
  vehicle: { id: string; plateNo: string; type: string; brand: string | null; model: string | null; capacity: number; photoOutside: string | null; isActive: boolean } | null
  app: { status: AppStatus; lastSeenAt: string | null; platform: string | null; codeSentAt: string | null } | null
  live: LiveDay | null
  upcomingTrips: number
  nextTrip: { date: string; fileNo: string; route: string } | null
}

export interface VendorVehicle {
  id: string; type: string; plateNo: string; brand: string | null; model: string | null; capacity: number
  photoOutside: string | null; photoInside: string | null; isActive: boolean
  driver: { id: string; name: string; phone: string; photoUrl: string | null; isActive: boolean } | null
  upcomingTrips: number
}

export interface JobLeg {
  assignmentId: string; date: string; time: string | null; timeTo: string | null; location: string
  from: string | null; to: string | null; serviceType: string; noDriverNeeded: boolean
  driverName: string | null; vehiclePlate: string | null
}

export interface VendorJob {
  id: string; key: string; bookingRef: string; fileNo: string; title: string | null; country: string | null
  wholeBooking: boolean; startDate: string; endDate: string; pax: { adults: number; children: number }
  legs: JobLeg[]
  driver: { id: string | null; name: string; phone: string | null; photoUrl: string | null } | null
  vehicle: { plateNo: string; type: string | null } | null
  mixed: boolean; notes: string | null; live: LiveDay | null; state: JobState
}

export interface VendorHome {
  today: string
  counts: { drivers: number; onApp: number; vehicles: number; liveNow: number; upcoming: number; unassigned: number }
  live: (LiveDay & { driverId: string; name: string; photoUrl: string | null; plateNo: string | null })[]
  todayJobs: VendorJob[]
  next: VendorJob[]
  attention: { kind: string; tone: 'red' | 'gold' | 'blue'; title: string; body: string }[]
  pendingRequests: number
}

export const VEHICLE_LABEL: Record<string, string> = {
  car: 'Car', 'flatroof-van': 'Flat-roof van', 'highroof-van': 'High-roof van', van: 'Van', minibus: 'Mini bus',
  'bus-medium': 'Medium bus', 'bus-high': 'Large bus', motorbike: 'Motorbike', other: 'Other',
};
export const VEHICLE_ICON: Record<string, IconName> = {
  car: 'car-sport', 'flatroof-van': 'bus', 'highroof-van': 'bus', van: 'bus', minibus: 'bus',
  'bus-medium': 'bus', 'bus-high': 'bus', motorbike: 'bicycle', other: 'car',
};
export const vehicleLabel = (t: string | null | undefined) => (t ? VEHICLE_LABEL[t] ?? t : 'Vehicle');

export const APP_STATUS: Record<AppStatus, { label: string; color: string; bg: string; icon: IconName }> = {
  ON_APP: { label: 'On the app', color: C.green, bg: C.greenSoft, icon: 'checkmark-circle' },
  CODE_SENT: { label: 'Code sent', color: C.gold, bg: C.goldSoft, icon: 'logo-whatsapp' },
  NOT_JOINED: { label: 'Not on the app', color: C.sub, bg: C.cardHi, icon: 'phone-portrait-outline' },
};

export const JOB_STATE: Record<JobState, { label: string; color: string; bg: string; icon: IconName }> = {
  NEEDS_DRIVER: { label: 'Needs a driver', color: C.red, bg: C.redSoft, icon: 'person-add' },
  NEEDS_VEHICLE: { label: 'Needs a vehicle', color: C.amber, bg: C.goldSoft, icon: 'car' },
  READY: { label: 'Ready', color: C.green, bg: C.greenSoft, icon: 'checkmark-circle' },
  LIVE: { label: 'On the road', color: C.blue, bg: C.blueSoft, icon: 'navigate' },
  DONE: { label: 'Done', color: C.sub, bg: C.cardHi, icon: 'flag' },
};

export const initials = (n: string) => n.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

/** Step-by-step message the vendor forwards to a new driver (WhatsApp, SMS…). */
export async function shareInvite(driver: { name: string; whatsapp: string }, vendorName: string) {
  const first = driver.name.trim().split(/\s+/)[0];
  await Share.share({
    message:
      `Hi ${first}, ${vendorName} added you as a driver on the Aahaas app.\n\n` +
      `1. Install "Aahaas" from the App Store / Play Store\n` +
      `2. Tap Driver → "New driver? Verify your phone"\n` +
      `3. Type ${driver.whatsapp} and tap "I already have a code" (or "Send code")\n` +
      `4. Enter the 6-digit code from WhatsApp and choose a password\n\n` +
      `Your trips, guest details and route will be there.`,
  });
}
