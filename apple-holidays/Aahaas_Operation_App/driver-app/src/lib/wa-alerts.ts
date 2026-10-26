/**
 * WhatsApp alerts — sounds, vibration, banners and badges for new guest
 * messages, all decided on this phone (settings live in AsyncStorage; the
 * server is only read, through the same whatsapp/conversations call the inbox
 * already makes).
 *
 * While the app is open it checks the inbox every 25 s. The Chats screen feeds
 * its own polls in through `ingest()` and the watcher skips its turn, so the
 * server never sees more calls than before. A closed app gets nothing from here;
 * that needs a server push.
 *
 *   new message      tone + vibration + banner / phone notification
 *   guest waiting    one nudge when a reply is overdue (optional)
 *   while away       one summary when the app comes back
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { ApiError } from './api';
import { web } from './web';

// ── settings ───────────────────────────────────────────────────────────────

export type AlertStyle = 'banner' | 'system' | 'silent';
export type ToneId = 'chime' | 'pop' | 'ding' | 'marimba' | 'ping' | 'system' | 'none';
export type Desk = 'VIETNAM' | 'SRILANKA' | 'SINGAPORE_MALAYSIA' | 'NONE';

export interface WaAlertSettings {
  enabled: boolean
  style: AlertStyle
  tone: ToneId
  vibrate: boolean
  /** show the message text in banners and notifications */
  preview: boolean
  desks: Desk[]
  /** minutes from midnight; the range may wrap past midnight */
  quiet: { on: boolean; from: number; to: number }
  /** 0 = off; otherwise nudge once when a guest has waited this many minutes */
  nudgeMin: number
  appBadge: boolean
}

export const DESKS: { key: Desk; label: string; flag: string }[] = [
  { key: 'VIETNAM', label: 'Vietnam', flag: '🇻🇳' },
  { key: 'SRILANKA', label: 'Sri Lanka', flag: '🇱🇰' },
  { key: 'SINGAPORE_MALAYSIA', label: 'SG / MY', flag: '🇸🇬' },
  { key: 'NONE', label: 'No booking', flag: '🔗' },
];

export const DEFAULTS: WaAlertSettings = {
  enabled: true, style: 'banner', tone: 'chime', vibrate: true, preview: true,
  desks: DESKS.map(d => d.key), quiet: { on: false, from: 22 * 60, to: 7 * 60 }, nudgeMin: 0, appBadge: true,
};

const SETTINGS_KEY = 'wa.alerts.v1';
const MUTES_KEY = 'wa.mutes.v1';
const SEEN_KEY = 'wa.alerts.seenAt';

let settings: WaAlertSettings = DEFAULTS;
/** phone → muted until (epoch ms); -1 = until unmuted */
let mutes: Record<string, number> = {};
const settingsListeners = new Set<() => void>();

const loaded = (async () => {
  try {
    const [s, m] = await Promise.all([AsyncStorage.getItem(SETTINGS_KEY), AsyncStorage.getItem(MUTES_KEY)]);
    if (s) settings = { ...DEFAULTS, ...JSON.parse(s), quiet: { ...DEFAULTS.quiet, ...JSON.parse(s).quiet } };
    if (m) mutes = JSON.parse(m);
  } catch { /* defaults */ }
  settingsListeners.forEach(f => f());
})();

export function getWaAlertSettings() { return settings; }

export function setWaAlertSettings(patch: Partial<WaAlertSettings>) {
  settings = { ...settings, ...patch };
  AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
  if (patch.appBadge === false) Notifications.setBadgeCountAsync(0).catch(() => {});
  else if (patch.appBadge) Notifications.setBadgeCountAsync(unread).catch(() => {});
  settingsListeners.forEach(f => f());
}

export function useWaAlertSettings(): WaAlertSettings {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); settingsListeners.add(f); return () => { settingsListeners.delete(f); }; }, []);
  return settings;
}

// ── per-chat mute ──────────────────────────────────────────────────────────

export function mutedUntil(phone: string): number | null {
  const u = mutes[phone];
  if (u === undefined) return null;
  if (u !== -1 && u <= Date.now()) return null;
  return u;
}

/** minutes: a number, 'morning' (next 08:00) or 'always'; null unmutes. */
export function muteChat(phone: string, minutes: number | 'morning' | 'always' | null) {
  const next = { ...mutes };
  for (const [p, u] of Object.entries(next)) if (u !== -1 && u <= Date.now()) delete next[p];
  if (minutes === null) delete next[phone];
  else if (minutes === 'always') next[phone] = -1;
  else if (minutes === 'morning') {
    const d = new Date(); d.setHours(8, 0, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    next[phone] = d.getTime();
  } else next[phone] = Date.now() + minutes * 60_000;
  mutes = next;
  AsyncStorage.setItem(MUTES_KEY, JSON.stringify(mutes)).catch(() => {});
  settingsListeners.forEach(f => f());
}

export function mutedChats(): { phone: string; until: number }[] {
  return Object.entries(mutes).filter(([p]) => mutedUntil(p) !== null).map(([phone, until]) => ({ phone, until }));
}

export function fmtMuted(until: number) {
  if (until === -1) return 'until you unmute';
  const d = new Date(until);
  const today = new Date().toDateString() === d.toDateString();
  return `until ${today ? '' : 'tomorrow '}${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// ── quiet hours ────────────────────────────────────────────────────────────

export function inQuietHours(s: WaAlertSettings = settings, at = new Date()) {
  if (!s.quiet.on || s.quiet.from === s.quiet.to) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return s.quiet.from < s.quiet.to ? m >= s.quiet.from && m < s.quiet.to : m >= s.quiet.from || m < s.quiet.to;
}

export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// ── tones ──────────────────────────────────────────────────────────────────

export const TONES: { id: ToneId; label: string; hint: string; file?: number }[] = [
  { id: 'chime', label: 'Aahaas chime', hint: 'Two rising bells', file: require('@/assets/sounds/wa-chime.wav') },
  { id: 'pop', label: 'Bubble', hint: 'Short and light', file: require('@/assets/sounds/wa-pop.wav') },
  { id: 'ding', label: 'Front desk', hint: 'One clear bell', file: require('@/assets/sounds/wa-ding.wav') },
  { id: 'marimba', label: 'Marimba', hint: 'Warm three-note', file: require('@/assets/sounds/wa-marimba.wav') },
  { id: 'ping', label: 'Soft ping', hint: 'For a busy desk', file: require('@/assets/sounds/wa-ping.wav') },
  { id: 'system', label: 'Phone default', hint: "Your phone's notification sound" },
  { id: 'none', label: 'No sound', hint: 'Vibration and banner only' },
];
const URGENT = require('@/assets/sounds/wa-urgent.wav') as number;

type AudioLib = typeof import('expo-audio');
type Player = ReturnType<AudioLib['createAudioPlayer']>;
let audioLib: AudioLib | null | undefined;
const players = new Map<number, Player>();

/** expo-audio is in Expo Go and new builds; older installed builds lack it and fall back to the phone sound. */
function audio(): AudioLib | null {
  if (audioLib !== undefined) return audioLib;
  try {
    audioLib = require('expo-audio') as AudioLib;
    // Respect the silent switch and never stop someone's music.
    audioLib.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  } catch {
    audioLib = null;
  }
  return audioLib;
}

export const customTonesAvailable = () => !!audio();

function playFile(file: number): boolean {
  const lib = audio();
  if (!lib) return false;
  try {
    let p = players.get(file);
    if (!p) { p = lib.createAudioPlayer(file); players.set(file, p); }
    p.seekTo(0).catch(() => {});
    p.play();
    return true;
  } catch {
    return false;
  }
}

/** Plays a tone now. Returns false when the phone sound has to stand in. */
export function playTone(id: ToneId | 'urgent'): boolean {
  if (id === 'none' || id === 'system') return id === 'none';
  const file = id === 'urgent' ? URGENT : TONES.find(t => t.id === id)?.file;
  return file ? playFile(file) : false;
}

// ── what the inbox looks like ──────────────────────────────────────────────

export interface WaConvLite {
  phone: string; displayName: string | null; snippet: string; direction: string; updatedAt: string; unreadCount: number
  booking: { bookingRef: string; isNumber?: string | null; operationCountry?: string | null } | null
}

export function deskOf(c: Pick<WaConvLite, 'booking'>): Desk {
  const oc = c.booking?.operationCountry;
  if (!c.booking) return 'NONE';
  if (oc === 'VIETNAM' || oc === 'SRILANKA') return oc;
  if (oc === 'SINGAPORE' || oc === 'MALAYSIA' || oc === 'SINGAPORE_MALAYSIA') return 'SINGAPORE_MALAYSIA';
  return 'NONE';
}

export const flagOf = (c: Pick<WaConvLite, 'booking'>) => DESKS.find(d => d.key === deskOf(c))?.flag ?? '🔗';
export const plainText = (s: string) => s.replace(/([*_~])([^*_~\n]+)\1/g, '$2').replace(/\s+/g, ' ').trim();

// ── banner events ──────────────────────────────────────────────────────────

export interface WaBannerEvent {
  id: string
  kind: 'new' | 'nudge' | 'away' | 'test'
  items: { conv: WaConvLite; count: number }[]
  quiet: boolean
}
const bannerListeners = new Set<(e: WaBannerEvent) => void>();
export function onWaBanner(fn: (e: WaBannerEvent) => void) { bannerListeners.add(fn); return () => { bannerListeners.delete(fn); }; }

// ── unread badge ───────────────────────────────────────────────────────────

let unread = 0;
const unreadListeners = new Set<(n: number) => void>();
export function useWaUnread(): number {
  const [n, setN] = useState(unread);
  useEffect(() => { unreadListeners.add(setN); return () => { unreadListeners.delete(setN); }; }, []);
  return n;
}

// ── where the user is ──────────────────────────────────────────────────────

let activePhone: string | null = null;
let chatsFocused = false;
/** The open thread never alerts for itself. */
export function setActiveWaThread(phone: string | null) { activePhone = phone; }
/** On the Chats list the rows update in place: tone only, no banner, and the watcher skips its poll. */
export function setChatsFocused(on: boolean) { chatsFocused = on; }

// ── the watcher ────────────────────────────────────────────────────────────

let prev: Map<string, { at: number; unread: number }> | null = null;
const nudged = new Set<string>();
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove: () => void } | null = null;
let forbidden = false;

const allowed = (c: WaConvLite) => settings.desks.includes(deskOf(c)) && mutedUntil(c.phone) === null && c.phone !== activePhone;

let queue: Promise<void> = Promise.resolve();

/** Every fresh copy of the full inbox comes through here — the watcher's own polls and the Chats screen's. One at a time, so two overlapping polls never alert twice. */
export function ingest(convs: WaConvLite[]): Promise<void> {
  queue = queue.then(() => compare(convs)).catch(() => {});
  return queue;
}

async function compare(convs: WaConvLite[]) {
  await loaded;
  unread = convs.reduce((s, c) => s + (c.unreadCount || 0), 0);
  unreadListeners.forEach(f => f(unread));
  if (settings.appBadge) Notifications.setBadgeCountAsync(unread).catch(() => {});

  const now = Date.now();
  const newest = convs.reduce((m, c) => Math.max(m, Date.parse(c.updatedAt) || 0), 0);

  if (!prev) {
    // First look since the app opened: one summary of what came in while it was closed.
    const seenAt = Number(await AsyncStorage.getItem(SEEN_KEY).catch(() => null)) || 0;
    const away = seenAt ? convs.filter(c => c.direction === 'inbound' && c.unreadCount > 0 && Date.parse(c.updatedAt) > seenAt && allowed(c)) : [];
    if (away.length && settings.enabled) present('away', away.map(conv => ({ conv, count: conv.unreadCount })));
  } else {
    const fresh = convs
      .filter(c => c.direction === 'inbound' && Date.parse(c.updatedAt) > (prev!.get(c.phone)?.at ?? 0) && allowed(c))
      .map(conv => ({ conv, count: Math.max(1, conv.unreadCount - (prev!.get(conv.phone)?.unread ?? 0)) }));
    if (fresh.length && settings.enabled) present('new', fresh);
  }

  // Guests left waiting: once per message, inside an hour after the threshold so old chats stay quiet.
  if (settings.enabled && settings.nudgeMin > 0) {
    const due = convs.filter(c => {
      const waited = (now - Date.parse(c.updatedAt)) / 60_000;
      return c.direction === 'inbound' && waited >= settings.nudgeMin && waited < settings.nudgeMin + 60
        && !nudged.has(`${c.phone}@${c.updatedAt}`) && allowed(c);
    });
    due.forEach(c => nudged.add(`${c.phone}@${c.updatedAt}`));
    if (due.length) present('nudge', due.map(conv => ({ conv, count: conv.unreadCount })));
  }

  prev = new Map(convs.map(c => [c.phone, { at: Date.parse(c.updatedAt) || 0, unread: c.unreadCount || 0 }]));
  if (newest) AsyncStorage.setItem(SEEN_KEY, String(newest)).catch(() => {});
}

function present(kind: WaBannerEvent['kind'], items: WaBannerEvent['items']) {
  const quiet = kind !== 'test' && inQuietHours();
  const style = settings.style;
  const loud = !quiet && style !== 'silent';

  let phoneSound = false;
  if (loud) {
    const tone = kind === 'nudge' && settings.tone !== 'none' ? 'urgent' : settings.tone;
    phoneSound = !playTone(tone) && settings.tone !== 'none';
    if (settings.vibrate) {
      Haptics.notificationAsync(kind === 'nudge' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }

  if (style === 'system' && (!chatsFocused || kind === 'test')) {
    systemNotification(kind, items, loud && (phoneSound || settings.tone === 'system'));
  } else if (style === 'banner' && (!chatsFocused || kind === 'test')) {
    const e: WaBannerEvent = { id: `${Date.now()}`, kind, items: items.slice(0, 5), quiet };
    bannerListeners.forEach(f => f(e));
    // A custom tone could not play (older build): the phone's own sound stands in.
    if (phoneSound) systemNotification(kind, items, true, true);
  } else if (phoneSound) {
    systemNotification(kind, items, true, true);
  }
}

let channelsReady: Promise<unknown> | null = null;
function channels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= Promise.all([
    Notifications.setNotificationChannelAsync('whatsapp', { name: 'WhatsApp messages', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 180, 120, 180], lightColor: '#25D366' }),
    Notifications.setNotificationChannelAsync('whatsapp-quiet', { name: 'WhatsApp messages (quiet)', importance: Notifications.AndroidImportance.LOW, sound: null, vibrationPattern: null }),
  ]).catch(() => {});
  return channelsReady;
}

export function alertText(kind: WaBannerEvent['kind'], items: WaBannerEvent['items'], preview = settings.preview) {
  const name = (c: WaConvLite) => c.displayName || `+${c.phone}`;
  const total = items.reduce((s, i) => s + i.count, 0);
  if (kind === 'nudge') {
    return items.length === 1
      ? { title: `${name(items[0].conv)} is waiting`, body: `No reply for ${settings.nudgeMin} min${preview ? ` · “${plainText(items[0].conv.snippet).slice(0, 120)}”` : ''}` }
      : { title: `${items.length} guests waiting`, body: `${items.slice(0, 3).map(i => name(i.conv)).join(', ')} — no reply for ${settings.nudgeMin}+ min` };
  }
  if (kind === 'away') {
    return { title: 'While you were away', body: `${total} new message${total === 1 ? '' : 's'} from ${items.length === 1 ? name(items[0].conv) : `${items.length} chats`}` };
  }
  if (items.length === 1) {
    const c = items[0].conv;
    return { title: name(c), body: preview ? plainText(c.snippet) || 'New message' : `${items[0].count > 1 ? `${items[0].count} new messages` : 'New message'}${c.booking ? ` · ${c.booking.isNumber || c.booking.bookingRef}` : ''}` };
  }
  return { title: `${total} new WhatsApp messages`, body: items.slice(0, 4).map(i => name(i.conv)).join(', ') + (items.length > 4 ? ` +${items.length - 4}` : '') };
}

/** Phone notification. `soundOnly` stands in for a tone that could not play: push.ts lets it ring without a banner. */
async function systemNotification(kind: WaBannerEvent['kind'], items: WaBannerEvent['items'], sound: boolean, soundOnly = false) {
  await channels();
  const { title, body } = alertText(kind, items);
  const phone = items.length === 1 ? items[0].conv.phone : undefined;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound, data: { screen: 'wa', phone, name: items[0]?.conv.displayName ?? '', soundOnly } },
      trigger: Platform.OS === 'android' ? { channelId: sound ? 'whatsapp' : 'whatsapp-quiet' } : null,
    });
    if (soundOnly) setTimeout(() => Notifications.dismissNotificationAsync(id).catch(() => {}), 4000);
  } catch { /* no permission: the badge still counts */ }
}

/** "Send a test" in settings — a real alert with today's settings, from a pretend guest. */
export function testAlert() {
  present('test', [{
    conv: { phone: '94770000000', displayName: 'Test guest', snippet: 'Hi! Our flight lands at 14:20 — will the driver be at arrivals? 🙏', direction: 'inbound', updatedAt: new Date().toISOString(), unreadCount: 1, booking: { bookingRef: 'TEST-REF', isNumber: 'IS 0000', operationCountry: 'SRILANKA' } },
    count: 1,
  }]);
}

async function poll() {
  if (forbidden || chatsFocused || AppState.currentState !== 'active') return;
  try {
    await ingest(await web<WaConvLite[]>('whatsapp/conversations'));
  } catch (e) {
    // Not a WhatsApp desk: stop asking for this session.
    if (e instanceof ApiError && e.status === 403) { forbidden = true; stopWaWatcher(); }
  }
}

export function startWaWatcher() {
  if (timer) return;
  forbidden = false;
  poll();
  timer = setInterval(poll, 25_000);
  appSub = AppState.addEventListener('change', st => { if (st === 'active') poll(); });
}

export function stopWaWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
  appSub?.remove();
  appSub = null;
  prev = null;
  nudged.clear();
  unread = 0;
  Notifications.setBadgeCountAsync(0).catch(() => {});
  unreadListeners.forEach(f => f(0));
}
