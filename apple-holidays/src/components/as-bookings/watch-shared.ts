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
  cancel?: CancelSweepSummary
}

/** Mirrors `CancelSweepSummary` in `src/lib/as-watch-cancel.ts`. */
export interface CancelSweepSummary {
  upstream: number
  matched: number
  requested: number
  awaiting: number
  skipped: number
  failed: number
  refs: string[]
}

/** Mirrors `CancelState` — where a detected upstream cancellation has got to. */
export type CancelState =
  | 'awaiting' | 'requested' | 'approved' | 'declined' | 'skipped' | 'failed'

/** Mirrors `CancelEntry` in `src/lib/as-watch-cancel.ts`. */
export interface CancelEntry {
  ref: string
  bookingId: string | null
  quotationNo: string
  country: string | null
  guestName: string | null
  arrivalDate: string | null
  upstreamStatus: string
  upstreamClass: string | null
  state: CancelState
  note: string | null
  prevStatus: string | null
  detectedAt: string
  requestedAt: string | null
  actedBy: string | null
  decidedAt: string | null
}

/**
 * How each state reads on the page.
 *
 * `label` is what happened; `blurb` is what it means for the reader — the two
 * are kept apart because "declined" is the one state that looks like a closed
 * item and is in fact an open disagreement nobody is going to raise again.
 */
export const CANCEL_STATE_META: Record<CancelState, {
  label: string
  blurb: string
  tone: 'wait' | 'sent' | 'done' | 'clash' | 'muted'
}> = {
  awaiting: {
    label: 'Waiting for a person',
    blurb: 'Cancelled in AppleSystem. Nothing has changed on the booking yet.',
    tone: 'wait',
  },
  requested: {
    label: 'Waiting for accounts approval',
    blurb: 'The booking is held at Pending Approval — Accounts Team (Cancelling).',
    tone: 'sent',
  },
  approved: {
    label: 'Cancelled by accounts',
    blurb: 'Approved and closed. Nothing further is owed here.',
    tone: 'done',
  },
  declined: {
    label: 'Accounts said no',
    blurb: 'AppleSystem still shows it cancelled — the two systems disagree, and this will not ask again.',
    tone: 'clash',
  },
  skipped: {
    label: 'Left alone',
    blurb: 'Nothing to ask for on this booking.',
    tone: 'muted',
  },
  failed: {
    label: 'Could not be sent',
    blurb: 'The request itself failed. It is retried on the next sweep.',
    tone: 'clash',
  },
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
  cancellations: { actionEnabled: boolean; entries: CancelEntry[] }
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
