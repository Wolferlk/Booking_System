/**
 * VN Vendor Sync — constants, types and labels. Safe to import from the browser.
 *
 * Fills each Vietnam movement's Tour Vendor from the desk's Excel checklist
 * ("Checklist 2026.xlsx", mirrored by Checklist VN 2.1v). Server side lives in
 * ./server.ts, the matcher in ./match.ts.
 */

export const DEFAULT_INTERVAL_MIN = 15
export const DEFAULT_DAYS_AHEAD = 120

/** `system_settings` keys this feature owns. */
export const VENDOR_SYNC_SETTINGS = {
  /** AUTO (apply HIGH matches) | SUGGEST (never write, only propose) | OFF */
  mode:        'vn_vendor_sync_mode',
  intervalMin: 'vn_vendor_sync_interval_min',
  daysAhead:   'vn_vendor_sync_days_ahead',
} as const

export type VendorSyncMode = 'AUTO' | 'SUGGEST' | 'OFF'

export const VENDOR_SYNC_NOT_INSTALLED =
  'VN Vendor Sync is not set up on this database yet — run prisma/sql/apply-vn-vendor-sync.sh'

export type LinkStatus = 'APPLIED' | 'SUGGESTED' | 'IN_SYNC' | 'KEPT_MANUAL' | 'IGNORED' | 'STALE'
export type EventAction =
  | 'APPLIED' | 'UPDATED' | 'SUGGESTED' | 'KEPT_MANUAL' | 'SHEET_DROPPED'
  | 'UNDONE' | 'IGNORED' | 'RESTORED' | 'ERROR' | 'EDITED' | 'REVERTED'

/** Actions that changed what the movement holds (the history "Revert" walks back). */
export const CHANGE_ACTIONS: EventAction[] = ['APPLIED', 'UPDATED', 'UNDONE', 'EDITED', 'REVERTED']

export const LINK_STATUS: Record<LinkStatus, { label: string; hint: string; pill: string; dot: string }> = {
  APPLIED:     { label: 'Applied',        hint: 'Filled in from the Excel by the sync',              pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  IN_SYNC:     { label: 'Matches',        hint: 'The movement already names this vendor',            pill: 'bg-teal-50 text-teal-700 ring-teal-200',          dot: 'bg-teal-400' },
  SUGGESTED:   { label: 'To review',      hint: 'Probably right — needs one click to apply',         pill: 'bg-amber-50 text-amber-700 ring-amber-200',       dot: 'bg-amber-400' },
  KEPT_MANUAL: { label: 'Kept yours',     hint: 'Someone set a different vendor by hand — left alone', pill: 'bg-violet-50 text-violet-700 ring-violet-200',  dot: 'bg-violet-400' },
  STALE:       { label: 'Not on sheet',   hint: 'The sheet no longer names a vendor for this movement', pill: 'bg-slate-100 text-slate-600 ring-slate-200',   dot: 'bg-slate-400' },
  IGNORED:     { label: 'Ignored',        hint: 'The sync will not touch this movement',             pill: 'bg-slate-50 text-slate-400 ring-slate-200',       dot: 'bg-slate-300' },
}

export const EVENT_ACTION: Record<EventAction, { label: string; tone: string }> = {
  APPLIED:       { label: 'Applied',        tone: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  UPDATED:       { label: 'Updated',        tone: 'text-sky-700 bg-sky-50 ring-sky-200' },
  SUGGESTED:     { label: 'Suggested',      tone: 'text-amber-700 bg-amber-50 ring-amber-200' },
  KEPT_MANUAL:   { label: 'Kept manual',    tone: 'text-violet-700 bg-violet-50 ring-violet-200' },
  SHEET_DROPPED: { label: 'Left the sheet', tone: 'text-slate-600 bg-slate-100 ring-slate-200' },
  UNDONE:        { label: 'Undone',         tone: 'text-rose-700 bg-rose-50 ring-rose-200' },
  IGNORED:       { label: 'Ignored',        tone: 'text-slate-500 bg-slate-50 ring-slate-200' },
  RESTORED:      { label: 'Resumed',        tone: 'text-indigo-700 bg-indigo-50 ring-indigo-200' },
  ERROR:         { label: 'Error',          tone: 'text-rose-700 bg-rose-50 ring-rose-200' },
  EDITED:        { label: 'Edited',         tone: 'text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200' },
  REVERTED:      { label: 'Reverted',       tone: 'text-orange-700 bg-orange-50 ring-orange-200' },
}

export const KIND_LABEL: Record<string, string> = {
  AIRPORT_ARRIVAL: 'Airport pick-up',
  AIRPORT_DEPARTURE: 'Airport drop-off',
  HOTEL_MOVE: 'Hotel change',
  ACTIVITY: 'Tour / activity',
}

// ── API shapes ───────────────────────────────────────────────────────────────

export interface VendorSyncConfig {
  mode: VendorSyncMode
  intervalMin: number
  daysAhead: number
}

export interface VendorSyncRunInfo {
  id: string
  trigger: string
  scope: string
  mode: string
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  sheetStatus: string | null
  sheetNote: string | null
  bookings: number
  movements: number
  matched: number
  applied: number
  updated: number
  suggested: number
  keptManual: number
  inSync: number
  noMatch: number
  error: string | null
  triggeredBy: string | null
  undoneAt: string | null
  undoneBy: string | null
}

export interface AlsoCandidate {
  vendor: string
  details: string
  code: string | null
  score: number
}

export interface VendorSyncLinkInfo {
  id: string
  movementKey: string
  agendaItemId: string | null
  movementDate: string | null
  movementLabel: string | null
  movementKind: string | null
  tourCode: string | null
  sheetRow: number | null
  lineDetails: string | null
  lineCode: string | null
  sheetVendor: string | null
  score: number | null
  confidence: 'HIGH' | 'MEDIUM' | null
  reason: string | null
  also: AlsoCandidate[]
  directorySource: 'TOUR_VENDOR' | 'VEHICLE_VENDOR' | 'NONE' | null
  vendorName: string | null
  vendorPhone: string | null
  status: LinkStatus
  note: string | null
  appliedName: string | null
  prevName: string | null
  appliedAt: string | null
  appliedBy: string | null
  /** What the movement holds right now (read fresh from assignments). */
  current: { tourVendorId: string | null; tourVendorName: string | null; tourVendorPhone: string | null } | null
}

export interface VendorSyncEventInfo {
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

export interface BookingVendorSyncPayload {
  installed: boolean
  config: VendorSyncConfig
  canEdit: boolean
  /** The sheet has a tour block for this booking. */
  onSheet: boolean
  tourCodes: string[]
  links: VendorSyncLinkInfo[]
  events: VendorSyncEventInfo[]
  lastRun: VendorSyncRunInfo | null
  sheetSyncedAt: string | null
  nextRunAt: string | null
}

/** One movement on the compare board: Excel vs system vs before, and who changed it. */
export interface CompareRow {
  linkId: string
  bookingRef: string
  agendaItemId: string | null
  movementDate: string | null
  movementLabel: string | null
  movementKind: string | null
  status: LinkStatus
  note: string | null
  excel: {
    vendor: string | null          // as typed in the sheet
    resolved: string | null        // directory name it resolves to
    phone: string | null
    source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR' | 'NONE' | null
    line: string | null
    code: string | null
    sheetRow: number | null
    tourCode: string | null
    score: number | null
    confidence: 'HIGH' | 'MEDIUM' | null
    reason: string | null
    also: AlsoCandidate[]
  }
  now: { name: string | null; phone: string | null; tourVendorId: string | null } | null
  before: { name: string | null; from: 'SYNC' | 'HISTORY' | 'UNKNOWN' }
  /** Does the system already say what the Excel says? */
  same: boolean
  lastChange: { action: EventAction; actor: string; at: string; from: string | null; to: string | null } | null
  /** Who the current value came from. */
  setBy: string
  canRevert: boolean
}

export interface DirectoryHit {
  id: string
  name: string
  phone: string | null
  source: 'TOUR_VENDOR' | 'VEHICLE_VENDOR'
}

export interface RunSummary extends VendorSyncRunInfo {
  /** Booking-level changes, for the toast. */
  changes: { bookingRef: string; label: string; action: EventAction; to: string | null }[]
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs} h ${mins % 60 ? `${mins % 60} min ` : ''}ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '—'
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000)
  if (mins <= 0) return 'due now'
  if (mins < 60) return `in ${mins} min`
  return `in ${Math.floor(mins / 60)} h ${mins % 60} min`
}

/** Same business? Case, accents and "travel/co/ltd" noise aside. */
export function sameVendorName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(travel|travels|tour|tours|co|ltd|company|jsc|group|transport|transportation|services?|vietnam|vn|the|cruises?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
  const x = n(a), y = n(b)
  return Boolean(x) && Boolean(y) && (x === y || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))))
}
