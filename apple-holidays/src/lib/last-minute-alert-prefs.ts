'use client'

/**
 * How loud the D-4 alarm is allowed to be *on this browser*.
 *
 * The alarm itself is a team-wide fact — see `last-minute.ts`. How it is
 * delivered is not: a desk with a phone to their ear, a screen mirrored into a
 * meeting, or an operator who has just acknowledged twelve files and is now
 * working through them all want the same thing, which is the interruption to
 * stop for a while without the *work* being marked as done. Acknowledging would
 * be the wrong tool for that — it clears the file for everybody and puts a name
 * against it.
 *
 * So muting is deliberately **per browser, never per team**. Nothing here
 * touches the server, and nothing here can hide a booking from anyone else. Two
 * further guards keep a mute from turning into a silent failure:
 *
 *  • The header chip is *never* suppressed. Muting stops the popup and the
 *    sound; the count stays on screen, and one click still opens the list.
 *  • A timed mute expires on its own. "Permanently off" is offered because
 *    somebody will want it — a display screen, a machine that is not an
 *    operator's — but it is stated plainly in the UI rather than hidden behind
 *    a long duration.
 *
 * Both the header alert and the settings page read and write through here, and
 * every write announces itself (a `CustomEvent` for this tab, the native
 * `storage` event for the others), so a mute set in Settings silences the popup
 * that is open behind it without a reload.
 */

/** Sound on/off. Historic key — it predates the mute controls, so it is kept. */
const SOUND_KEY = 'last_minute_alert_sound'

/** Mute state: `'off'` for permanent, otherwise an epoch-ms expiry. */
const MUTE_KEY = 'last_minute_alert_mute_until'

/** Fired on this tab after any write. Other tabs get the native `storage` event. */
export const LM_PREFS_EVENT = 'last-minute-alert-prefs-changed'

/** Not muted. */
export const MUTE_NONE = 0

/** Muted until switched back on by hand. */
export const MUTE_FOREVER = Number.POSITIVE_INFINITY

export interface LastMinuteAlertPrefs {
  /** Play the alarm tone when the popup interrupts. */
  soundOn: boolean
  /**
   * When the popup is allowed to interrupt again: `MUTE_NONE` when it always
   * may, `MUTE_FOREVER` when it never may, otherwise an epoch-ms instant.
   */
  muteUntil: number
}

/** The durations offered in the UI. Hours, because that is how a desk thinks. */
export const MUTE_CHOICES = [1, 2, 3] as const

export const DEFAULT_PREFS: LastMinuteAlertPrefs = { soundOn: true, muteUntil: MUTE_NONE }

/**
 * Read the preferences. Never throws: a private-mode `localStorage`, a disabled
 * one or a corrupted value all degrade to "fully audible", which is the safe
 * direction to fail in for an alarm.
 */
export function readAlertPrefs(): LastMinuteAlertPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const soundOn = localStorage.getItem(SOUND_KEY) !== 'off'
    const raw = localStorage.getItem(MUTE_KEY)
    if (!raw) return { soundOn, muteUntil: MUTE_NONE }
    if (raw === 'off') return { soundOn, muteUntil: MUTE_FOREVER }
    const at = Number(raw)
    // A lapsed or unparseable expiry is simply not a mute.
    return { soundOn, muteUntil: Number.isFinite(at) && at > Date.now() ? at : MUTE_NONE }
  } catch {
    return DEFAULT_PREFS
  }
}

function announce() {
  try { window.dispatchEvent(new CustomEvent(LM_PREFS_EVENT)) } catch { /* very old browser */ }
}

export function setAlertSound(on: boolean): void {
  try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* private mode */ }
  announce()
}

/** Mute for `hours`, or — with no argument — until it is switched back on. */
export function muteAlert(hours?: number): void {
  const value = hours == null ? 'off' : String(Date.now() + hours * 3_600_000)
  try { localStorage.setItem(MUTE_KEY, value) } catch { /* private mode */ }
  announce()
}

export function unmuteAlert(): void {
  try { localStorage.removeItem(MUTE_KEY) } catch { /* private mode */ }
  announce()
}

export function isMuted(prefs: LastMinuteAlertPrefs, now = Date.now()): boolean {
  return prefs.muteUntil === MUTE_FOREVER || prefs.muteUntil > now
}

/** "Muted for 42 min", "Muted until switched on", or `null` when audible. */
export function muteLabel(prefs: LastMinuteAlertPrefs, now = Date.now()): string | null {
  if (prefs.muteUntil === MUTE_FOREVER) return 'Muted until switched back on'
  if (prefs.muteUntil <= now) return null
  const mins = Math.max(1, Math.round((prefs.muteUntil - now) / 60_000))
  if (mins < 60) return `Muted for ${mins} more min`
  const hrs = Math.floor(mins / 60)
  const rest = mins % 60
  return `Muted for ${hrs}h${rest > 0 ? ` ${rest}m` : ''} more`
}

/**
 * Subscribe to preference changes — this tab and every other one.
 *
 * Returns the unsubscribe function, so a `useEffect` can return it directly.
 */
export function onAlertPrefsChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SOUND_KEY || e.key === MUTE_KEY) fn()
  }
  window.addEventListener(LM_PREFS_EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(LM_PREFS_EVENT, fn)
    window.removeEventListener('storage', onStorage)
  }
}
