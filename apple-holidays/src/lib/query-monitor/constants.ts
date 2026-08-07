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
  /** Divert mail whose subject matches an exclusion pattern to the second tab. */
  excludeEnabled:     'query_monitor_exclude_enabled',
  /** Newline-separated subject patterns that mark a mail as "not a query". */
  excludePatterns:    'query_monitor_exclude_patterns',
  /** Worksheet tab that receives the excluded mail. */
  excludedSheetName:  'query_monitor_excluded_sheet_name',
  /** `YYYY-MM-DD` — mail received before this never reaches either workbook. */
  startDate:          'query_monitor_start_date',
  /** Mirror every append and rewrite into a second, standby workbook. */
  backupEnabled:      'query_monitor_backup_enabled',
  /** Share URL of the backup workbook. */
  backupSheetUrl:     'query_monitor_backup_sheet_url',
  /** Resolved {driveId, itemId} cache for the backup URL — cleared when it changes. */
  backupSheetRef:     'query_monitor_backup_sheet_ref',
} as const

/**
 * Subjects that are not new sales queries: post-booking traffic, vouchers,
 * on-ground incidents, availability checks and mailer noise. They are still
 * collected and still shown in the dashboard — they just land on the second
 * worksheet instead of the query sheet, so the team's SLA pivots stay clean.
 *
 * One pattern per line. `#` starts a comment, `/…/flags` is a regular
 * expression, anything else is a case-insensitive substring. Matched against
 * the SUBJECT only — matching bodies would catch every quoted thread.
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  '# Post-booking / on-ground traffic — not a new query',
  'hotel voucher',
  '/\\bon[\\s-]?ground\\b/i',
  'discrepancy',
  'guest expects',
  'refund',
  'complaint',
  '',
  '# Availability checks are handled outside the query sheet',
  'avail check',
  'availability check',
  '',
  '# Bare booking reference, no question in it (e.g. NL2221756007048)',
  '/^(?:re|fw|fwd)?\\s*:?\\s*[A-Z]{2}\\d{8,}\\s*$/i',
  '',
  '# Mailer noise that slips past the sender filter',
  'automatic reply',
  'auto-reply',
  'out of office',
  'undeliverable',
  'delivery has failed',
].join('\n')

/**
 * The workbook the team moved to on 5 Aug 2026, and its standby copy. Both are
 * empty files created for this system, so the app writes their headers itself —
 * unlike the 2026 sheet it replaced, which had to be found, never conjured.
 */
export const NEW_SHEET_URL =
  'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQAHRf-77PFGRYZA9wgzEGeZAbny2k-Dyws0GbBsZxoPaPc?e=cddk42'
export const BACKUP_SHEET_URL =
  'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQBQuzZaKQ-FRoO2Y7xxMEqSAY1ms3HhMEMhmrlp79pUE78?e=Cf9aaW'

/** Nothing received before this date is written to the new workbook. */
export const DEFAULT_START_DATE = '2026-08-05'

export const DEFAULTS = {
  enabled:           'false',
  intervalMinutes:   '60',
  lookbackHours:     '3',
  autoWrite:         'false',
  sheetUrl:          NEW_SHEET_URL,
  sheetName:         'Query Entry Sheet',
  writeStatusColumn: 'true',
  captureUnmatched:  'true',
  aiEnabled:         'true',
  slaHours:          '2',
  replyChaseDays:    '7',
  excludeEnabled:    'true',
  excludePatterns:   DEFAULT_EXCLUDE_PATTERNS,
  excludedSheetName: 'Other Mails',
  startDate:         DEFAULT_START_DATE,
  backupEnabled:     'true',
  backupSheetUrl:    BACKUP_SHEET_URL,
} as const

// ── Sheet layout ─────────────────────────────────────────────────────────────

/**
 * Columns A–N of "Query Entry Sheet", in order.
 *
 * **File Handler (F) holds exactly one name** — the person who owns the query.
 * Every mailbox the mail actually reached is listed in **TO List (G)**, and the
 * handler is chosen out of that list: automatically when the mail hit only one
 * mailbox or when someone replies, otherwise by hand from the dashboard's
 * dropdown. The old sheet comma-joined every recipient into F, which made the
 * team's "who owns this" pivots unusable.
 */
export const SHEET_COLUMNS = [
  'Date', 'Status', 'Subject', 'Allocation time', 'Replied time', 'File Handler',
  'TO List', 'Sales Person', 'Destination', 'Agent', 'Travel Date', 'CNTL',
  'Amendment', 'Region',
] as const

export const SHEET_FIRST_COLUMN = 'A'
export const SHEET_LAST_COLUMN  = 'N'
/** Row 1 is the header; data starts at row 2. */
export const SHEET_HEADER_ROW   = 1

/** Number formats matching the layout the team reads, so rows look hand-made. */
export const SHEET_NUMBER_FORMATS = [
  '[$-en-US]dd-mmm-yy;@', // A Date
  'General',              // B Status
  'General',              // C Subject
  'm/d/yyyy h:mm',        // D Allocation time
  'm/d/yyyy h:mm',        // E Replied time
  'General',              // F File Handler — one name
  'General',              // G TO List — every recipient
  'General',              // H Sales Person
  'General',              // I Destination
  'General',              // J Agent
  'm/d/yyyy',             // K Travel Date
  'General',              // L CNTL
  'General',              // M Amendment
  'General',              // N Region
] as const

// ── Second tab: excluded mail ────────────────────────────────────────────────

/**
 * Layout of the "Other Mails" tab, columns A–I. This tab is created by the app
 * (it has no legacy formulas to respect), so it carries the columns that make an
 * excluded mail traceable rather than mirroring the query sheet: what it was,
 * who got it, and why it was kept out.
 */
export const EXCLUDED_SHEET_COLUMNS = [
  'Date', 'Received time', 'Subject', 'Sender', 'Sender Email',
  'File Handler', 'TO List', 'Reason', 'Destination', 'CNTL',
] as const

export const EXCLUDED_SHEET_FIRST_COLUMN = 'A'
export const EXCLUDED_SHEET_LAST_COLUMN  = 'J'

export const EXCLUDED_SHEET_NUMBER_FORMATS = [
  '[$-en-US]dd-mmm-yy;@', // A Date
  'm/d/yyyy h:mm',        // B Received time
  'General',              // C Subject
  'General',              // D Sender
  'General',              // E Sender Email
  'General',              // F File Handler — one name
  'General',              // G TO List — every recipient
  'General',              // H Reason
  'General',              // I Destination
  'General',              // J CNTL
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

/** QUERY → the master query sheet. EXCLUDED → the second "other mail" tab. */
export type MailKind    = 'QUERY' | 'EXCLUDED'
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
