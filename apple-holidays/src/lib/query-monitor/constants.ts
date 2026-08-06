/**
 * Booking Team Query Monitor — shared constants.
 *
 * Everything operational is a SystemSetting so it can be changed from the admin
 * UI without a deploy: which sheet, how often, how far back to look, whether the
 * sweep may write to the live workbook at all.
 */

// ── SystemSetting keys ───────────────────────────────────────────────────────

export const SETTINGS = {
  /** Master switch for the hourly sweep. */
  enabled:            'query_monitor_enabled',
  /** Minutes between sweeps (default 60 = hourly). */
  intervalMinutes:    'query_monitor_interval_minutes',
  /** How far back each sweep reads mail, in hours. Overlaps on purpose. */
  lookbackHours:      'query_monitor_lookback_hours',
  /** When ON the sweep appends to the live workbook; when OFF rows stay PENDING in the DB. */
  autoWrite:          'query_monitor_auto_write',
  /** Share URL of the target workbook. */
  sheetUrl:           'query_monitor_sheet_url',
  /** Worksheet tab that receives the rows. */
  sheetName:          'query_monitor_sheet_name',
  /** Resolved {driveId, itemId} cache for the share URL — cleared when sheetUrl changes. */
  sheetRef:           'query_monitor_sheet_ref',
  /** Write the computed reply status into column B. */
  writeStatusColumn:  'query_monitor_write_status',
  /** Create rows for senders that match no rule (sales person "Others"). */
  captureUnmatched:   'query_monitor_capture_unmatched',
  /** Use GPT to pull destination / travel date when the regexes come up empty. */
  aiEnabled:          'query_monitor_ai_enabled',
  /** Hours without a reply before an entry is flagged OVERDUE. */
  slaHours:           'query_monitor_sla_hours',
  /** How many days back to keep re-checking unanswered entries for a reply. */
  replyChaseDays:     'query_monitor_reply_chase_days',
  /** ISO timestamp of the last completed sweep — drives the interval tick. */
  lastRunAt:          'query_monitor_last_run_at',
  /** Guard so two processes can't sweep at once. */
  runLock:            'query_monitor_run_lock',
} as const

export const DEFAULTS = {
  enabled:           'false',
  intervalMinutes:   '60',
  lookbackHours:     '3',
  autoWrite:         'false',
  sheetUrl:          'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQDe6rioPeb-RKOaBK0wPN06ATQvYzfrYFKyi0I4O-dPDmo?e=g5mkDb',
  sheetName:         'Query Entry Sheet',
  writeStatusColumn: 'true',
  captureUnmatched:  'true',
  aiEnabled:         'true',
  slaHours:          '2',
  replyChaseDays:    '7',
} as const

// ── Sheet layout ─────────────────────────────────────────────────────────────

/**
 * Columns A–M of "Query Entry Sheet", in order. Column N onwards holds the
 * team's lookup lists and pivot helpers — writes must never reach past M.
 */
export const SHEET_COLUMNS = [
  'Date', 'Status', 'Subject', 'Allocation time', 'Replied time', 'File Handler',
  'Sales Person', 'Destination', 'Agent', 'Travel Date', 'CNTL', 'Amendment', 'Region',
] as const

export const SHEET_FIRST_COLUMN = 'A'
export const SHEET_LAST_COLUMN  = 'M'
/** Row 1 is the header; data starts at row 2. */
export const SHEET_HEADER_ROW   = 1

/** Number formats copied from the existing manual rows so new rows look identical. */
export const SHEET_NUMBER_FORMATS = [
  '[$-en-US]dd-mmm-yy;@', // A Date
  'General',              // B Status
  'General',              // C Subject
  'm/d/yyyy h:mm',        // D Allocation time
  'm/d/yyyy h:mm',        // E Replied time
  'General',              // F File Handler
  'General',              // G Sales Person
  'General',              // H Destination
  'General',              // I Agent
  'm/d/yyyy',             // J Travel Date
  'General',              // K CNTL
  'General',              // L Amendment
  'General',              // M Region
] as const

// ── Domain ignore list ───────────────────────────────────────────────────────

/** Senders that never represent a customer query. Case-insensitive substrings. */
export const IGNORED_SENDER_PATTERNS = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'postmaster', 'notifications@', 'notification@', 'calendar-notification',
  'microsoftonline', 'sharepointonline', 'quarantine',
]

/** Our own tenant — internal traffic is not an inbound sales query. */
export const INTERNAL_DOMAINS = ['aahaas.com', 'appleholidays.lk']

// ── Seed data ────────────────────────────────────────────────────────────────

/**
 * The five file-handler mailboxes the booking team asked to monitor.
 * `availcheck@aahaas.com` does not resolve in the tenant (Graph returns
 * ErrorInvalidUser), so it is seeded inactive with the reason recorded — fix the
 * address in the UI and switch it on, no code change needed.
 */
export const SEED_MAILBOXES: {
  email: string; displayName: string; isActive: boolean; lastError?: string
}[] = [
  { email: 'sajid.joshua@aahaas.com',     displayName: 'Sajid',    isActive: true },
  { email: 'vishmika.kavindi@aahaas.com', displayName: 'Vishmika', isActive: true },
  { email: 'richard.kenny@aahaas.com', displayName: 'Richard', isActive: true },
  { email: 'sudari.sachinthani@aahaas.com', displayName: 'Sudari', isActive: true },
  { email: 'abdul.rahman@aahaas.com',     displayName: 'Abdul',    isActive: true },
   { email: 'afrose.a@aahaas.com',     displayName: 'afrose',    isActive: true },
  { email: 'shabrina.jabbar@aahaas.com',  displayName: 'Shabrina', isActive: true },
  {
    email: 'availcheck@aahaas.com', displayName: 'Availcheck', isActive: false,
    lastError: 'Graph: ErrorInvalidUser — this address is not a mailbox in the tenant. '
             + 'Correct it (or give the shared mailbox a licence/UPN) and activate.',
  },
]

/**
 * Sales-person / agent mappings for the sender domains the team listed. The
 * labels match what already appears in the spreadsheet so the pivots keep
 * working; add or edit them from the UI at any time.
 */
export const SEED_SENDER_RULES: {
  pattern: string; matchType: 'DOMAIN' | 'EMAIL'; salesPerson: string; agent: string; priority?: number
}[] = [
  { pattern: 'pickyourtrail.com', matchType: 'DOMAIN', salesPerson: 'PICK YOUR TRAILS', agent: 'Pick Your Trail' },
  { pattern: 'makemytrip.in',     matchType: 'DOMAIN', salesPerson: 'MMT',              agent: 'MMT' },
  { pattern: 'makemytrip.com',    matchType: 'DOMAIN', salesPerson: 'MMT',              agent: 'MMT' },
  { pattern: 'go-mmt.com',        matchType: 'DOMAIN', salesPerson: 'MMT',              agent: 'MMT' },
  { pattern: 'tripfactory.travel',matchType: 'DOMAIN', salesPerson: 'TRIP FACTORY',     agent: 'Trip Factory' },
  { pattern: 'tbo.com',           matchType: 'DOMAIN', salesPerson: 'TBO',              agent: 'TBO' },
  { pattern: '30sundays.club',    matchType: 'DOMAIN', salesPerson: 'Sikkandar',        agent: '30 Sundays' },
  { pattern: 'nexusdmc.com',      matchType: 'DOMAIN', salesPerson: 'NEXUS DMC',        agent: 'Nexus DMC' },
]

/** Written into the Sales Person column when no rule matches. */
export const UNMATCHED_SALES_PERSON = 'Others'

// ── Status vocabulary ────────────────────────────────────────────────────────

export type ReplyStatus = 'REPLIED' | 'PENDING' | 'OVERDUE'
export type SyncStatus  = 'PENDING' | 'SYNCED' | 'DIRTY' | 'FAILED' | 'SKIPPED'
export type RunStatus   = 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
export type RunTrigger  = 'CRON' | 'MANUAL' | 'BOOT'

/** Human labels for column B of the sheet. */
export const REPLY_STATUS_SHEET_LABEL: Record<ReplyStatus, string> = {
  REPLIED: 'Replied',
  PENDING: 'Pending',
  OVERDUE: 'Overdue',
}
