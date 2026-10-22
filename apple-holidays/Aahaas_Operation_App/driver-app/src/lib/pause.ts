/**
 * Breaks inside a running day — "Pause trip".
 *
 * Offline-first: pausing or resuming changes the phone at once and queues the
 * action. The queue is always sent BEFORE any GPS points (flushPoints calls
 * flushPauseActions first), because the server sorts each point into
 * "driving" or "on a break" by the break times it already knows.
 *
 * GPS keeps running while paused: the route still draws, ops still see the
 * car, and if the car starts driving the driver is asked to resume — a banner
 * in the app, or a notification when the app is in the background.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import { api, ApiError } from './api';
import type { Progress } from './types';

export type PauseReason = 'MEAL' | 'FUEL' | 'GUEST_STOP' | 'REST' | 'PRAYER' | 'VEHICLE' | 'PERSONAL' | 'OTHER';

export const REASONS: { id: PauseReason; label: string; hint: string; icon: string; color: string; minutes: number | null }[] = [
  { id: 'MEAL', label: 'Meal', hint: 'Lunch, dinner, tea', icon: 'restaurant', color: '#F97316', minutes: 45 },
  { id: 'GUEST_STOP', label: 'Guest stop', hint: 'Sightseeing — I wait', icon: 'camera', color: '#8B5CF6', minutes: 60 },
  { id: 'FUEL', label: 'Fuel', hint: 'Filling up', icon: 'water', color: '#0EA5E9', minutes: 15 },
  { id: 'REST', label: 'Rest', hint: 'Stretch, short nap', icon: 'cafe', color: '#14B8A6', minutes: 20 },
  { id: 'PRAYER', label: 'Prayer', hint: 'Temple, kovil, mosque', icon: 'flower', color: '#EAB308', minutes: 20 },
  { id: 'VEHICLE', label: 'Vehicle problem', hint: 'Ops get an alert', icon: 'construct', color: '#EF4444', minutes: null },
  { id: 'PERSONAL', label: 'Personal', hint: 'Own errand, no guest', icon: 'person', color: '#64748B', minutes: 30 },
  { id: 'OTHER', label: 'Other', hint: 'Something else', icon: 'ellipsis-horizontal-circle', color: '#94A3B8', minutes: null },
];
export const reasonOf = (id: string | null | undefined) => REASONS.find(r => r.id === id) ?? REASONS[REASONS.length - 1];

/** Meal time? Then "Meal" is the likely reason. */
export function suggestedReason(now = new Date()): PauseReason {
  const h = now.getHours() + now.getMinutes() / 60;
  return (h >= 11.75 && h < 14.75) || (h >= 18.75 && h < 21.5) || (h >= 7 && h < 9) ? 'MEAL' : 'GUEST_STOP';
}

export interface ActivePause {
  id: string; ref: string; reason: PauseReason; note: string | null; plannedMin: number | null
  /** phone clock, epoch ms */
  startedAt: number
  lat: number | null; lng: number | null
  reminderId?: string | null
}

/** How the car has moved since the break began (worked out on the phone). */
export interface Motion { id: string; lat: number | null; lng: number | null; movedM: number; fast: number; kmh: number | null; alerted: boolean }

const PAUSE_KEY = 'aahaas.trip.pause';
const QUEUE_KEY = 'aahaas.trip.pause.queue';
const MOTION_KEY = 'aahaas.trip.pause.motion';
/** ≈ 20 km/h — faster than walking a car round a car park. */
const FAST_MS = 5.5;

type Action = { ref: string; body: Record<string, unknown> };

let current: ActivePause | null | undefined; // undefined = not read yet
let changedAt = 0;
let pauseListeners: ((p: ActivePause | null) => void)[] = [];
let motionListeners: ((m: Motion) => void)[] = [];
let progressListeners: ((ref: string, p: Progress) => void)[] = [];
let errorListeners: ((message: string) => void)[] = [];

export const onPauseChange = (fn: (p: ActivePause | null) => void) => { pauseListeners.push(fn); return () => { pauseListeners = pauseListeners.filter(l => l !== fn); }; };
export const onMotion = (fn: (m: Motion) => void) => { motionListeners.push(fn); return () => { motionListeners = motionListeners.filter(l => l !== fn); }; };
/** The server's answer to a pause / resume — the trip screens adopt it as their progress. */
export const onTripProgress = (fn: (ref: string, p: Progress) => void) => { progressListeners.push(fn); return () => { progressListeners = progressListeners.filter(l => l !== fn); }; };
/** A queued pause the server refused later (it was offline when the driver tapped). */
export const onPauseError = (fn: (message: string) => void) => { errorListeners.push(fn); return () => { errorListeners = errorListeners.filter(l => l !== fn); }; };

// One read-modify-write at a time: the GPS task and the screen both touch these keys.
let lock: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

export async function getPause(): Promise<ActivePause | null> {
  if (current === undefined) current = await readJson<ActivePause | null>(PAUSE_KEY, null);
  return current;
}
/** Last known value without waiting (null until first read). */
export const pauseNow = () => current ?? null;

async function setPause(p: ActivePause | null) {
  current = p;
  changedAt = Date.now();
  if (p) await AsyncStorage.setItem(PAUSE_KEY, JSON.stringify(p)).catch(() => {});
  else await AsyncStorage.removeItem(PAUSE_KEY).catch(() => {});
  pauseListeners.forEach(l => l(p));
}

export async function getMotion(id: string): Promise<Motion | null> {
  const m = await readJson<Motion | null>(MOTION_KEY, null);
  return m?.id === id ? m : null;
}

async function remind(p: ActivePause): Promise<string | null> {
  if (!p.plannedMin) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `${reasonOf(p.reason).label} — ${p.plannedMin} min are up ⏱`,
        body: 'Your trip is still paused. Swipe "Resume" when you drive again.',
        data: { bookingRef: p.ref, screen: 'trip' },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: p.plannedMin * 60, channelId: 'trips' },
    });
  } catch {
    return null;
  }
}

function cancelReminder(p: ActivePause | null) {
  if (p?.reminderId) Notifications.cancelScheduledNotificationAsync(p.reminderId).catch(() => {});
}

async function enqueue(a: Action) {
  await locked(async () => {
    const q = await readJson<Action[]>(QUEUE_KEY, []);
    q.push(a);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  });
}

export async function hasQueuedActions() {
  return (await readJson<Action[]>(QUEUE_KEY, [])).length > 0;
}

let flushing: Promise<boolean> | null = null;
let awaiting: string | null = null;
let refusedNow: string | null = null;
/**
 * Send queued pause / resume actions in order. Resolves true once the queue is
 * empty, false if the phone is offline (the GPS points then wait too).
 */
export function flushPauseActions(): Promise<boolean> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush(): Promise<boolean> {
  for (let guard = 0; guard < 20; guard++) {
    const q = await readJson<Action[]>(QUEUE_KEY, []);
    const a = q[0];
    if (!a) return true;
    try {
      const r = await api<{ progress: Progress }>(`/api/mobile/trips/${encodeURIComponent(a.ref)}/day`, { body: a.body });
      progressListeners.forEach(l => l(a.ref, r.progress));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 0) return false;
      // Refused (no day running, server not set up …): drop it so the GPS
      // points are not held back, and undo a pause the server never took.
      if (a.body.action === 'pause' && current?.id === a.body.id) {
        cancelReminder(current ?? null);
        await setPause(null);
        // The tap that is waiting gets the message; a later refusal goes to
        // the newest trip screen only, so two mounted screens do not both alert.
        if (a.body.id === awaiting) refusedNow = e.message;
        else errorListeners[errorListeners.length - 1]?.(e.message);
      }
    }
    await locked(async () => {
      const now = await readJson<Action[]>(QUEUE_KEY, []);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(now.slice(1)));
    });
  }
  return false;
}

/** Pause now. Resolves with the server's refusal message, if it refused straight away. */
export async function pauseTrip(input: { ref: string; reason: PauseReason; note?: string | null; plannedMin?: number | null; lat?: number | null; lng?: number | null }): Promise<string | null> {
  const p: ActivePause = {
    id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    ref: input.ref, reason: input.reason, note: input.note?.trim() || null, plannedMin: input.plannedMin ?? null,
    startedAt: Date.now(), lat: input.lat ?? null, lng: input.lng ?? null,
  };
  p.reminderId = await remind(p);
  await setPause(p);
  await AsyncStorage.removeItem(MOTION_KEY).catch(() => {});
  await enqueue({ ref: p.ref, body: { action: 'pause', id: p.id, reason: p.reason, note: p.note, plannedMin: p.plannedMin, t: p.startedAt, lat: p.lat, lng: p.lng } });
  awaiting = p.id;
  refusedNow = null;
  await flushPauseActions();
  awaiting = null;
  return refusedNow;
}

export async function resumeTrip(input: { ref: string; countMoved?: boolean; by?: 'DRIVER' | 'MOVING'; lat?: number | null; lng?: number | null }) {
  const p = await getPause();
  cancelReminder(p);
  await setPause(null);
  await AsyncStorage.removeItem(MOTION_KEY).catch(() => {});
  await enqueue({ ref: input.ref, body: { action: 'resume', t: Date.now(), lat: input.lat ?? null, lng: input.lng ?? null, countMoved: !!input.countMoved, by: input.by ?? 'DRIVER' } });
  await flushPauseActions();
}

/** The day ended (the server closes the break itself). */
export async function forgetPause() {
  const p = await getPause();
  if (!p) return;
  cancelReminder(p);
  await setPause(null);
  await AsyncStorage.removeItem(MOTION_KEY).catch(() => {});
}

/**
 * Line the phone up with the server when nothing is waiting to be sent — a
 * reinstall, a second phone, or ops ending the day.
 */
export async function syncPause(ref: string, progress: Progress) {
  if (Date.now() - changedAt < 10_000 || (await hasQueuedActions())) return;
  const mine = await getPause();
  const running = progress.days.find(d => d.status === 'STARTED');
  const server = running?.pause ?? null;
  if (server && mine?.id !== server.id) {
    cancelReminder(mine);
    await setPause({
      id: server.id, ref, reason: server.reason as PauseReason, note: server.note, plannedMin: server.plannedMin,
      startedAt: new Date(server.startedAt).getTime(), lat: server.lat, lng: server.lng,
    });
  } else if (!server && mine?.ref === ref) {
    await forgetPause();
  }
}

function hopM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * Called by the GPS layer for every batch. While paused, adds up how far the
 * car moved and, once it is clearly driving, asks the driver to resume.
 */
export async function notePausePoints(pts: { lat: number; lng: number; accuracy: number | null; speed: number | null }[]) {
  const p = await getPause();
  if (!p || !pts.length) return;
  const m = await locked(async () => {
    const prev = await readJson<Motion | null>(MOTION_KEY, null);
    const m: Motion = prev?.id === p.id ? prev : { id: p.id, lat: p.lat, lng: p.lng, movedM: 0, fast: 0, kmh: null, alerted: false };
    for (const pt of pts) {
      if (pt.accuracy != null && pt.accuracy > 65) continue;
      if (m.lat == null || m.lng == null) { m.lat = pt.lat; m.lng = pt.lng; continue; }
      const d = hopM({ lat: m.lat, lng: m.lng }, pt);
      if (d >= 25) { m.movedM += d; m.lat = pt.lat; m.lng = pt.lng; }
      m.fast = (pt.speed ?? 0) > FAST_MS ? m.fast + 1 : 0;
      m.kmh = pt.speed != null && pt.speed >= 0 ? Math.round(pt.speed * 3.6) : null;
    }
    const shout = m.fast >= 2 && !m.alerted;
    if (shout) m.alerted = true;
    await AsyncStorage.setItem(MOTION_KEY, JSON.stringify(m)).catch(() => {});
    return { m, shout };
  });
  motionListeners.forEach(l => l(m.m));
  // On screen the paused card shows a banner; off screen, a notification.
  if (m.shout && AppState.currentState !== 'active') {
    Notifications.scheduleNotificationAsync({
      content: {
        title: 'Driving on a break? 🚗',
        body: 'Your trip is paused, so kilometres are not counting. Tap to open the trip and resume.',
        data: { bookingRef: p.ref, screen: 'trip' },
      },
      trigger: null,
    }).catch(() => {});
  }
}
