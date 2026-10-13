/**
 * Trip GPS — runs only between "Start day" and "End day".
 *
 * Preferred: a background location task (keeps counting with the screen off or
 * Google Maps open). That needs a development / store build — Expo Go cannot
 * run background location — so in Expo Go, or when the driver refuses
 * "Allow all the time", it falls back to a foreground watcher.
 *
 * Every point goes into an on-device queue first and is sent in batches, so a
 * tunnel or a hill without signal loses nothing: the queue is flushed when the
 * network comes back. The server ignores points it already has.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { api } from './api';

export const LOCATION_TASK = 'aahaas-trip-location';
const QUEUE_KEY = 'aahaas.gps.queue';
const MAX_QUEUE = 20_000;

export interface QueuedPoint { lat: number; lng: number; accuracy: number | null; speed: number | null; t: number }

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let watcher: Location.LocationSubscription | null = null;
let flushing = false;
let listeners: ((p: QueuedPoint) => void)[] = [];

export function onPoint(fn: (p: QueuedPoint) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

async function enqueue(locs: Location.LocationObject[]) {
  if (!locs.length) return;
  const pts: QueuedPoint[] = locs.map(l => ({
    lat: l.coords.latitude, lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null, speed: l.coords.speed ?? null, t: l.timestamp,
  }));
  const raw = await AsyncStorage.getItem(QUEUE_KEY).catch(() => null);
  const q: QueuedPoint[] = raw ? JSON.parse(raw) : [];
  q.push(...pts);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
  pts.forEach(p => listeners.forEach(l => l(p)));
}

/** Send queued points; keeps whatever could not be sent. Returns today's km if the server said. */
export async function flushPoints(): Promise<number | null> {
  if (flushing) return null;
  flushing = true;
  let dayKm: number | null = null;
  try {
    for (let guard = 0; guard < 50; guard++) {
      const raw = await AsyncStorage.getItem(QUEUE_KEY);
      const q: QueuedPoint[] = raw ? JSON.parse(raw) : [];
      if (!q.length) break;
      const batch = q.slice(0, 300);
      const res = await api<{ accepted: number; dayKm: number | null }>('/api/mobile/locations', { body: { points: batch } });
      dayKm = res.dayKm;
      const again = await AsyncStorage.getItem(QUEUE_KEY);
      const now: QueuedPoint[] = again ? JSON.parse(again) : [];
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(now.slice(batch.length)));
    }
  } catch {
    // offline — try again next time
  } finally {
    flushing = false;
  }
  return dayKm;
}

// Must be defined at module scope (imported from the root layout).
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  await enqueue(data.locations);
  await flushPoints();
});

export type TrackingMode = 'background' | 'foreground';

export class LocationError extends Error {
  constructor(message: string, public code: 'services_off' | 'denied') { super(message); }
}

/** Ask for permission (explaining first is the caller's job) and start tracking. */
export async function startTracking(): Promise<TrackingMode> {
  if (!(await Location.hasServicesEnabledAsync())) {
    if (Platform.OS === 'android') await Location.enableNetworkProviderAsync().catch(() => {});
    if (!(await Location.hasServicesEnabledAsync())) {
      throw new LocationError('Location is switched off on this phone. Turn it on in Settings and try again.', 'services_off');
    }
  }
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') throw new LocationError('The app needs your location to count kilometres.', 'denied');

  if (!isExpoGo) {
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK, {
            accuracy: Location.Accuracy.High,
            distanceInterval: 30,
            timeInterval: 15_000,
            deferredUpdatesInterval: 60_000,
            activityType: Location.ActivityType.AutomotiveNavigation,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'Aahaas trip running',
              notificationBody: 'Counting your kilometres. End the day in the app to stop.',
              notificationColor: '#E11D48',
            },
          });
        }
        return 'background';
      }
    } catch {
      // fall through to the foreground watcher
    }
  }

  if (!watcher) {
    watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 30, timeInterval: 15_000 },
      loc => { enqueue([loc]).then(() => flushPoints()); },
    );
  }
  return 'foreground';
}

/** Re-attach after an app restart if a day is still running. */
export async function resumeTracking(): Promise<TrackingMode | null> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return 'background';
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return null;
    return await startTracking();
  } catch {
    return null;
  }
}

export async function stopTracking(): Promise<void> {
  watcher?.remove();
  watcher = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch { /* not running */ }
  await flushPoints();
}

export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
    const p = last ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}

export const trackingSupportsBackground = !isExpoGo;
