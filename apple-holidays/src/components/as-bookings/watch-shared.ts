/**
 * Client-side types and helpers for the Live Confirmation Watch.
 *
 * Kept apart from `watch-tab.tsx` so the All Bookings fetch pill can share them
 * without pulling the whole settings tab into that page's bundle, and apart from
 * `src/lib/as-watch.ts` because that module imports Prisma and is server-only.
 * The shapes here mirror the API responses that module produces.
 */

export interface WatchSettings {
  enabled: boolean
  intervalMinutes: number
  lookbackDays: number
}

export interface WatchCheck {
  at: string
  trigger: 'auto' | 'manual'
  durationMs: number
  windowFrom: string
  windowTo: string
  found: number
  candidates: number
  created: number
  errors: number
  refs: string[]
  error?: string
}

export interface WatchStatus {
  settings: WatchSettings
  timezone: string
  running: boolean
  lastCheckAt: string | null
  nextCheckAt: string | null
  window: { from: string; to: string }
  lastCheck: WatchCheck | null
  checks: WatchCheck[]
  totals: { checks: number; created: number; errors: number }
}

/** Compact relative duration — "just now", "45s", "4m 12s", "3h 5m", "2d". */
export function relTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  return `${Math.floor(h / 24)}d`
}
