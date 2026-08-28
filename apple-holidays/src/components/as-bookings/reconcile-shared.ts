/**
 * Client-side types for the AppleSystem reconciliation tab.
 *
 * Kept apart from `src/lib/as-reconcile.ts` because that module imports Prisma
 * and is server-only; these shapes mirror the JSON its API routes return.
 */

export interface ReconcileSettings {
  enabled: boolean
  intervalMinutes: number
  lookbackDays: number
  refreshEnabled: boolean
  autoCancelEnabled: boolean
}

export interface ReconcileAction {
  ref: string
  kind: 'created' | 'refreshed' | 'cancelled' | 'flagged' | 'error'
  detail?: string
}

export interface ReconcileRun {
  at: string
  trigger: 'auto' | 'manual'
  durationMs: number
  windowFrom: string
  windowTo: string
  scanned: number
  upstreamConfirmed: number
  presentBefore: number
  missing: number
  created: number
  importErrors: number
  stale: number
  refreshed: number
  unchanged: number
  syncErrors: number
  refreshBacklog: number
  drifted: number
  cancelled: number
  awaitingSecondSighting: number
  flagged: number
  inParity: boolean
  unresolved: number
  unresolvedRefs: string[]
  actions: ReconcileAction[]
  error?: string
}

export interface ReconcileDay {
  date: string
  upstreamConfirmed: number
  systemHeld: number
  missing: number
  missingRefs: string[]
  createdTotal: number
  refreshedTotal: number
  cancelledTotal: number
  flaggedTotal: number
  errorsTotal: number
  runs: number
  lastRunAt: string
  cancelled: { ref: string; at: string; prevStatus: string; upstreamStatus: string }[]
}

export interface ReconcileStatus {
  settings: ReconcileSettings
  timezone: string
  running: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  window: { from: string; to: string }
  lastRun: ReconcileRun | null
  runs: ReconcileRun[]
  today: ReconcileDay | null
  days: ReconcileDay[]
  totals: { runs: number; created: number; refreshed: number; cancelled: number; errors: number }
}
