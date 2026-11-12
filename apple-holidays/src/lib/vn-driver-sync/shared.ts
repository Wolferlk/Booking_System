/**
 * VN Driver Sync — types, labels and settings shared by the server and the page.
 * Client-safe: no Prisma, no Node APIs.
 */

export const DEFAULT_SHEET_ID = '1E_wc4G_9Ibk0WRNl0j7R2H91NDvyVK5m7YlAe1qNuaM'
export const DEFAULT_INTERVAL_MIN = 15
export const DEFAULT_DAYS_AHEAD = 120

export const DRIVER_SYNC_SETTINGS = {
  mode: 'vn_driver_sync_mode',
  intervalMin: 'vn_driver_sync_interval_min',
  daysAhead: 'vn_driver_sync_days_ahead',
  useAi: 'vn_driver_sync_use_ai',
  sheet: 'vn_driver_sync_sheet',
  /** JSON: { at, hash, source, rows, tabs } of the last good sheet read. */
  sheetState: 'vn_driver_sync_sheet_state',
} as const

export type DriverSyncMode = 'AUTO' | 'SUGGEST' | 'OFF'

export interface DriverSyncConfig {
  mode: DriverSyncMode
  intervalMin: number
  daysAhead: number
  useAi: boolean
  /** The sheet link or id the desk pasted. */
  sheet: string
}

export type LinkStatus = 'APPLIED' | 'IN_SYNC' | 'SUGGESTED' | 'KEPT_MANUAL' | 'NO_NUMBER' | 'STALE' | 'IGNORED'

export const LINK_STATUS: Record<LinkStatus, { label: string; hint: string; dot: string; tone: string }> = {
  APPLIED:     { label: 'Applied',     hint: 'The sync wrote this driver and it is still there',                         dot: 'bg-emerald-400', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  IN_SYNC:     { label: 'Matches',     hint: 'The movement already holds what the sheet says',                            dot: 'bg-teal-400',    tone: 'bg-teal-50 text-teal-700 ring-teal-200' },
  SUGGESTED:   { label: 'To review',   hint: 'A likely match the sync would not write on its own — check and apply',      dot: 'bg-amber-400',   tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  KEPT_MANUAL: { label: 'Kept yours',  hint: 'Someone assigned a different driver by hand — theirs stays',                dot: 'bg-violet-400',  tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  NO_NUMBER:   { label: 'No number',   hint: 'The sheet names a vendor but no phone number — nothing written',            dot: 'bg-slate-400',   tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
  STALE:       { label: 'Sheet changed', hint: 'The sync wrote this, then the sheet dropped it — left as it is, check it', dot: 'bg-rose-400',    tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  IGNORED:     { label: 'Ignored',     hint: 'A person told the sync to leave this movement alone',                       dot: 'bg-zinc-400',    tone: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
}

export type EventAction = 'APPLIED' | 'UPDATED' | 'APPROVED' | 'SUGGESTED' | 'KEPT_MANUAL' | 'SHEET_DROPPED' | 'UNDONE' | 'IGNORED' | 'RESTORED'

export const EVENT_ACTION: Record<EventAction, { label: string; tone: string }> = {
  APPLIED:       { label: 'Applied',       tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  UPDATED:       { label: 'Updated',       tone: 'bg-sky-50 text-sky-700 ring-sky-200' },
  APPROVED:      { label: 'Approved',      tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  SUGGESTED:     { label: 'Suggested',     tone: 'bg-amber-50 text-amber-700 ring-amber-200' },
  KEPT_MANUAL:   { label: 'Kept yours',    tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  SHEET_DROPPED: { label: 'Sheet changed', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  UNDONE:        { label: 'Undone',        tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  IGNORED:       { label: 'Ignored',       tone: 'bg-zinc-100 text-zinc-600 ring-zinc-200' },
  RESTORED:      { label: 'Restored',      tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

export interface DriverSyncRunInfo {
  id: string
  trigger: string
  scope: string
  mode: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  sheetNote: string | null
  sheetRows: number
  bookings: number
  movements: number
  matched: number
  applied: number
  updated: number
  suggested: number
  keptManual: number
  inSync: number
  noNumber: number
  noMatch: number
  aiCalls: number
  error: string | null
  triggeredBy: string | null
  undoneAt: string | null
  undoneBy: string | null
}

/** A sheet row with a phone number that no system movement took. */
export interface UnmatchedRow {
  bookingRef: string
  date: string | null
  tab: string
  row: number
  details: string | null
  time: string | null
  service: string | null
  text: string
  why: string
}

export interface DriverSyncLinkInfo {
  id: string
  bookingRef: string
  agendaItemId: string | null
  movementDate: string | null
  movementLabel: string | null
  movementText: string | null
  sheet: { tab: string | null; row: number | null; date: string | null; details: string | null; time: string | null; service: string | null; text: string | null }
  phones: string | null
  score: number | null
  confidence: 'HIGH' | 'MEDIUM' | null
  method: 'RULES' | 'AI' | null
  reason: string | null
  status: LinkStatus
  note: string | null
  /** What the movement holds right now. */
  now: { driverName: string | null; driverPhone: string | null; fromDirectory: boolean }
  appliedAt: string | null
  appliedBy: string | null
  prevName: string | null
  updatedAt: string
}

export interface DriverSyncEventInfo {
  id: string
  runId: string | null
  bookingRef: string
  movementLabel: string | null
  action: EventAction
  fromValue: string | null
  toValue: string | null
  score: number | null
  detail: string | null
  actor: string | null
  createdAt: string
}

export interface SheetState {
  at: string
  hash: string
  source: 'SERVICE_ACCOUNT' | 'PUBLIC_LINK'
  rows: number
  tabs: string[]
  title?: string | null
}

export interface DriverSyncOverview {
  installed: boolean
  canEdit: boolean
  isAdmin: boolean
  config: DriverSyncConfig
  access: { serviceAccount: string | null; sheetUrl: string }
  sheet: SheetState | null
  totals: Record<string, number>
  runs: DriverSyncRunInfo[]
  links: DriverSyncLinkInfo[]
  linkTotal: number
  events: DriverSyncEventInfo[]
  unmatched: UnmatchedRow[]
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}

/** "https://docs.google.com/spreadsheets/d/<id>/edit…" or a bare id → the id. */
export function sheetIdOf(input: string | null | undefined): string | null {
  const s = String(input ?? '').trim()
  if (!s) return null
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/)
  if (m) return m[1]
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null
}

export const sheetUrlOf = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`
