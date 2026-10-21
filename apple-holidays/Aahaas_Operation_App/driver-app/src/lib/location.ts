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
const PATH_KEY = 'aahaas.gps.path';
const MAX_QUEUE = 20_000;
const MAX_PATH = 4_000;

export interface QueuedPoint { lat: number; lng: number; accuracy: number | null; speed: number | null; t: number }

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

let watcher: Location.LocationSubscription | null = null;
let flushing = false;
let listeners: ((p: QueuedPoint) => void)[] = [];
let kmListeners: ((km: number) => void)[] = [];

export function onPoint(fn: (p: QueuedPoint) => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

/** Today's km as the server last reported it — whoever did the sending (screen timer or GPS task). */
export function onDayKm(fn: (km: number) => void) {
  kmListeners.push(fn);
  return () => { kmListeners = kmListeners.filter(l => l !== fn); };
}

// Every read-modify-write of the queue goes through here, one at a time, so a
// point arriving while a batch is being sent is never overwritten.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.catch(() => {});
  return run;
}

async function enqueue(locs: Location.LocationObject[]) {
  if (!locs.length) return;
  const pts: QueuedPoint[] = locs.map(l => ({
    lat: l.coords.latitude, lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null, speed: l.coords.speed ?? null, t: l.timestamp,
  }));
  await withQueue(async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY).catch(() => null);
    const q: QueuedPoint[] = raw ? JSON.parse(raw) : [];
    q.push(...pts);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)));
    // Today's route for the on-phone map (good fixes only).
    const good = pts.filter(p => p.accuracy == null || p.accuracy <= 65).map(p => [p.lat, p.lng, p.t, p.speed ?? -1]);
    if (good.length) {
      const rawPath = await AsyncStorage.getItem(PATH_KEY).catch(() => null);
      const path: number[][] = rawPath ? JSON.parse(rawPath) : [];
      path.push(...good);
      await AsyncStorage.setItem(PATH_KEY, JSON.stringify(path.slice(-MAX_PATH)));
    }
  });
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
      if (dayKm != null) { const km = dayKm; kmListeners.forEach(l => l(km)); }
      await withQueue(async () => {
        const again = await AsyncStorage.getItem(QUEUE_KEY);
        const now: QueuedPoint[] = again ? JSON.parse(again) : [];
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(now.slice(batch.length)));
      });
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

/** True until the driver has granted background ("all the time") location — the disclosure must be shown first. */
export async function needsLocationDisclosure(): Promise<boolean> {
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.status !== 'granted';
  } catch {
    return true;
  }
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
              notificationColor: '#FF2638',
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

export interface PathPoint { lat: number; lng: number; t: number; speed: number | null }

/** The route driven since "Start day" on this phone. */
export async function loadPath(): Promise<PathPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(PATH_KEY);
    const path: number[][] = raw ? JSON.parse(raw) : [];
    return path.map(([lat, lng, t, sp]) => ({ lat, lng, t, speed: sp >= 0 ? sp : null }));
  } catch {
    return [];
  }
}

export async function clearPath(): Promise<void> {
  await withQueue(() => AsyncStorage.removeItem(PATH_KEY)).catch(() => {});
}

export async function stopTracking(): Promise<void> {
  watcher?.remove();
  watcher = null;
  await clearPath();
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
