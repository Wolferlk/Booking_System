/**
 * How the journey map's fly-through behaves.
 *
 * The numbers live in `system_settings` so an operator can tune the animation
 * once for everyone — staff pages and the traveller portal alike — rather than
 * every viewer re-discovering the speed control. The map still keeps a local
 * override (see `journey-map.tsx`), so a single viewer can go faster without
 * changing what everybody else sees.
 */

export const JM_SETTING_KEYS = {
  speed:            'journey_map_speed',
  followZoom:       'journey_map_follow_zoom',
  cinematic:        'journey_map_cinematic',
  autoOpen:         'journey_map_auto_open',
  portalFullscreen: 'journey_map_portal_fullscreen',
} as const

export interface JourneyMapSettings {
  /**
   * Playback rate, where 1 is the reference pace. Below 1 is slower — the
   * default, because the old fixed pace crossed a leg in 1.5s and nobody could
   * read a stop before the camera had left it.
   */
  speed: number
  /** How close the camera sits to the vehicle while it is travelling. */
  followZoom: number
  /** Camera rides with the vehicle instead of cutting stop to stop. */
  cinematic: boolean
  /** Open each place's detail card as the vehicle arrives. */
  autoOpen: boolean
  /** A traveller pressing play gets the map fullscreen. */
  portalFullscreen: boolean
}

export const DEFAULT_JM_SETTINGS: JourneyMapSettings = {
  speed: 0.55,
  followZoom: 12.5,
  cinematic: true,
  autoOpen: true,
  portalFullscreen: true,
}

/** The pace everything else is measured against, at `speed === 1`. */
export const JM_BASE_LEG_MS = 2600
export const JM_BASE_DWELL_MS = 1800

export const JM_SPEED_MIN = 0.25
export const JM_SPEED_MAX = 3

/** The presets the in-map speed button cycles through. */
export const JM_SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const

export function clampSpeed(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_JM_SETTINGS.speed
  return Math.min(JM_SPEED_MAX, Math.max(JM_SPEED_MIN, n))
}

/**
 * Wall-clock milliseconds for one leg and one stop at a given rate.
 *
 * A leg also stretches a little with its own length, so a 300 km sector does
 * not flash past in the same beat as a 4 km hop across town — capped, or a
 * long-haul sector would hold the viewer for a minute.
 */
export function legDurationMs(speed: number, share = 0): number {
  const stretch = 1 + Math.min(Math.max(share, 0), 0.4) * 3.5
  return (JM_BASE_LEG_MS * stretch) / clampSpeed(speed)
}

export function dwellDurationMs(speed: number): number {
  return JM_BASE_DWELL_MS / clampSpeed(speed)
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v == null || v === '') return fallback
  return v === 'true' || v === '1'
}

/** Read the settings out of a raw `system_settings` key/value map. */
export function parseJourneyMapSettings(
  raw: Record<string, string | undefined | null>,
): JourneyMapSettings {
  const speed = Number(raw[JM_SETTING_KEYS.speed])
  const zoom = Number(raw[JM_SETTING_KEYS.followZoom])
  return {
    speed: Number.isFinite(speed) && speed > 0 ? clampSpeed(speed) : DEFAULT_JM_SETTINGS.speed,
    followZoom: Number.isFinite(zoom) && zoom >= 4 && zoom <= 18 ? zoom : DEFAULT_JM_SETTINGS.followZoom,
    cinematic: bool(raw[JM_SETTING_KEYS.cinematic] ?? undefined, DEFAULT_JM_SETTINGS.cinematic),
    autoOpen: bool(raw[JM_SETTING_KEYS.autoOpen] ?? undefined, DEFAULT_JM_SETTINGS.autoOpen),
    portalFullscreen: bool(raw[JM_SETTING_KEYS.portalFullscreen] ?? undefined, DEFAULT_JM_SETTINGS.portalFullscreen),
  }
}

/** Human label for a speed multiplier — "0.5×", "1×". */
export function speedLabel(speed: number): string {
  const s = clampSpeed(speed)
  return `${Number.isInteger(s) ? s : s.toFixed(2).replace(/0$/, '').replace(/\.$/, '')}×`
}
