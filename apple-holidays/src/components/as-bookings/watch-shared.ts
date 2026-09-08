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
  failedQuotations?: string[]
}

/** Mirrors `FailureReason` in `src/lib/as-import-ledger.ts`. */
export type FailureReason =
  | 'no-is-number'
  | 'no-country'
  | 'no-itinerary'
  | 'missing-ids'
  | 'upstream'
  | 'other'

export type LedgerSource = 'watch' | 'reconcile' | 'import'

export interface CreatedEntry {
  ref: string
  bookingId: string
  quotationNo: string
  country: string | null
  at: string
  source: LedgerSource
  arrivalDate: string | null
  guestName: string | null
}

export interface FailedEntry {
  quotationNo: string
  ref: string | null
  country: string | null
  reason: FailureReason
  message: string
  firstAt: string
  lastAt: string
  attempts: number
  source: LedgerSource
  notifiedAt: string | null
  dismissedAt: string | null
  dismissedBy: string | null
}

export interface ImportLedger {
  created: CreatedEntry[]
  failed: FailedEntry[]
}

/** Plain-English reason labels — mirrors `REASON_LABEL` on the server. */
export const REASON_LABEL: Record<FailureReason, string> = {
  'no-is-number': 'No IS number in AppleSystem',
  'no-country':   'Destination country could not be determined',
  'no-itinerary': 'No dated itinerary',
  'missing-ids':  'Quotation is missing its identifiers',
  'upstream':     'AppleSystem did not respond',
  'other':        'Could not be imported',
}

/**
 * What the operator should actually do about each reason. A retryable blip and a
 * quotation that will never import look identical in a tally, which is how two
 * stuck bookings came to be re-announced forever — so the panel says which it is.
 */
export const REASON_ACTION: Record<FailureReason, string> = {
  'no-is-number': 'Assign an IS number to the quotation in AppleSystem — it imports on the next sweep.',
  'no-country':   'The IS number carries no VN / IS / SG / MY prefix. Correct it in AppleSystem.',
  'no-itinerary': 'Add the dated day-by-day itinerary in AppleSystem, then it can import.',
  'missing-ids':  'The AppleSystem row is incomplete — raise it with AppleSystem support.',
  'upstream':     'A transient AppleSystem outage. It retries automatically; no action needed.',
  'other':        'Open the quotation in AppleSystem and check it against the message below.',
}

export function isTransient(reason: FailureReason): boolean {
  return reason === 'upstream'
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
  ledger: ImportLedger
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
