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
  /** Have GPT read every new mail and write a one-sentence summary into the sheet. */
  aiSummaryEnabled:   'query_monitor_ai_summary_enabled',
  /** Hours without a reply before an entry is flagged OVERDUE. */
  slaHours:           'query_monitor_sla_hours',
  /** How many days back to keep re-checking unanswered entries for a reply. */
  replyChaseDays:     'query_monitor_reply_chase_days',
  /** Fold later mail of a thread into the row the query already owns. */
  threadMergeEnabled: 'query_monitor_thread_merge_enabled',
  /** How far back a sweep looks for the row a follow-up belongs to, in days. */
  threadWindowDays:   'query_monitor_thread_window_days',
  /** ISO timestamp of the last completed sweep — drives the interval tick. */
  lastRunAt:          'query_monitor_last_run_at',
  /** Guard so two processes can't sweep at once. */
  runLock:            'query_monitor_run_lock',
  /**
   * Guard so two processes can't *write* at once — a hand-pressed "Sync to
   * sheet" landing in the middle of the cron sweep's write is what appended the
   * same block of rows twice. Separate from the sweep lock: the sweep holds
   * that one while it calls the write.
   */
  syncLock:           'query_monitor_sync_lock',
  /** Divert mail whose subject matches an exclusion pattern to the second tab. */
  excludeEnabled:     'query_monitor_exclude_enabled',
  /** Newline-separated subject patterns that mark a mail as "not a query". */
  excludePatterns:    'query_monitor_exclude_patterns',
  /** Worksheet tab that receives the excluded mail. */
  excludedSheetName:  'query_monitor_excluded_sheet_name',
  /** Worksheet tab the OpenAI spend report is rewritten onto. */
  aiUsageSheetName:   'query_monitor_ai_usage_sheet_name',
  /** Worksheet tab the daily mail counts are rewritten onto. */
  dailyStatsSheetName: 'query_monitor_daily_stats_sheet_name',
  /** How many days the daily counts cover, newest first. */
  dailyStatsDays:     'query_monitor_daily_stats_days',
  /** Worksheet tab every collected mail is rewritten onto, unfiltered. */
  allMailsSheetName:  'query_monitor_all_mails_sheet_name',
  /** How many days of mail that tab covers, newest first. */
  allMailsDays:       'query_monitor_all_mails_days',
  /** Rewrite the all-mail tab at the end of every sweep. */
  allMailsAutoWrite:  'query_monitor_all_mails_auto_write',
  /**
   * Set once the raw-mail log has been seeded from the entries that existed
   * before it did. See `backfillMailLog` — the tab would otherwise start on the
   * day the log was switched on and show nothing behind it.
   */
  allMailsBackfilled: 'query_monitor_all_mails_backfilled',
  /** Rewrite the daily counts tab at the end of every sweep. */
  dailyStatsAutoWrite: 'query_monitor_daily_stats_auto_write',
  /** Paint a query's row green once it has been answered. */
  highlightReplied:   'query_monitor_highlight_replied',
  /** `YYYY-MM-DD` — mail received before this never reaches either workbook. */
  startDate:          'query_monitor_start_date',
  /** Mirror every append and rewrite into a second, standby workbook. */
  backupEnabled:      'query_monitor_backup_enabled',
  /** Share URL of the backup workbook. */
  backupSheetUrl:     'query_monitor_backup_sheet_url',
  /** Resolved {driveId, itemId} cache for the backup URL — cleared when it changes. */
  backupSheetRef:     'query_monitor_backup_sheet_ref',
  /**
   * Hand-edited headers this system has agreed to write under, as
   * `{"<itemId>::<tab>": {map, header, adoptedAt}}`. See header-map.ts. Absent
   * for a tab that still carries our own layout, which is written by position.
   */
  columnMap:          'query_monitor_column_map',
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
  'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQAHRf-77PFGRYZA9wgzEGeZATxx0cyX0-Sh-tpg3VfPFqY?e=hawnx9'
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
  // Off until the team asks for it: it is a GPT call on *every* new mail, not
  // only on the ones the parser could not read.
  aiSummaryEnabled:  'false',
  slaHours:          '2',
  replyChaseDays:    '7',
  threadMergeEnabled: 'true',
  threadWindowDays:   '30',
  excludeEnabled:    'true',
  excludePatterns:   DEFAULT_EXCLUDE_PATTERNS,
  excludedSheetName: 'Other Mails',
  aiUsageSheetName:  'AI Usage',
  dailyStatsSheetName: 'Daily Mail Stats',
  dailyStatsDays:      '30',
  dailyStatsAutoWrite: 'true',
  allMailsSheetName:   'All Mails',
  allMailsDays:        '30',
  allMailsAutoWrite:   'true',
  highlightReplied:    'true',
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
  // Who wrote in, kept beside the person who owns it. It arrived on the far
  // right with the rest of the ledger and was moved here on 15 Aug 2026: the
  // team reads F and G together — "who asked, and who is on it" — and a column
  // twenty places away might as well not be on the sheet. Moving it is a real
  // structural change to a live file; see `realignWorksheet`.
  'From', 'From Email',
  'TO List', 'Sales Person', 'Destination', 'Agent', 'Travel Date', 'CNTL',
  'Amendment', 'Region',
  // ── Added Aug 2026, to the right of the columns already in use ─────────────
  'Replied By', 'Response (hrs)', 'SLA', 'Mails in Thread', 'Last Mail',
  'AI Summary',
  // ── The thread ledger, added 15 Aug 2026 ──────────────────────────────────
  // Who answered and where that answer went, who passed the thread on, what
  // happened across the whole thread rather than in the mail that opened it —
  // and why this row is the one that survived a duplicate.
  'Replied By Email', 'Replied To', 'Reply Type', 'Forward Chain',
  'Reply Summary', 'Duplicate Reason',
] as const

/**
 * The A–N layout the workbook was started with, before the reply-detail and
 * AI-summary columns were added.
 *
 * Kept so `ensureWorksheet` can tell "an older header of ours, with room to the
 * right" apart from "somebody else's header" — the first is extended in place
 * over live data, the second is refused. See `headerExtension`.
 */
export const LEGACY_SHEET_COLUMNS = [
  'Date', 'Status', 'Subject', 'Allocation time', 'Replied time', 'File Handler',
  'TO List', 'Sales Person', 'Destination', 'Agent', 'Travel Date', 'CNTL',
  'Amendment', 'Region',
] as const

/**
 * The order the sheet carried before **From** was moved next to File Handler:
 * the same columns, with From / From Email at U / V instead of G / H.
 *
 * This is not history for its own sake. A workbook already in use carries this
 * header and this data, and turning it into the layout above means moving real
 * columns in a live file — so the move has to recognise, exactly, the one shape
 * it knows how to transform, and refuse everything else. See `realignWorksheet`.
 */
export const PREVIOUS_SHEET_COLUMNS = [
  'Date', 'Status', 'Subject', 'Allocation time', 'Replied time', 'File Handler',
  'TO List', 'Sales Person', 'Destination', 'Agent', 'Travel Date', 'CNTL',
  'Amendment', 'Region',
  'Replied By', 'Response (hrs)', 'SLA', 'Mails in Thread', 'Last Mail',
  'AI Summary',
  'From', 'From Email', 'Replied By Email', 'Replied To', 'Reply Type',
  'Forward Chain', 'Reply Summary',
] as const

/** Where From / From Email have to end up: straight after File Handler. */
export const FROM_COLUMN_INDEX = 6
/** Where they are on a sheet still carrying the previous order. */
export const PREVIOUS_FROM_COLUMN_INDEX = 20

export const SHEET_FIRST_COLUMN = 'A'
export const SHEET_LAST_COLUMN  = 'AB'
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
  'General',              // G From — the sender's display name
  'General',              // H From Email
  'General',              // I TO List — every recipient
  'General',              // J Sales Person
  'General',              // K Destination
  'General',              // L Agent
  'm/d/yyyy',             // M Travel Date
  'General',              // N CNTL
  'General',              // O Amendment
  'General',              // P Region
  'General',              // Q Replied By
  '0.00',                 // R Response (hrs) — a real number, so it averages
  'General',              // S SLA — Met / Missed
  '0',                    // T Mails in Thread
  'm/d/yyyy h:mm',        // U Last Mail
  'General',              // V AI Summary
  'General',              // W Replied By Email
  'General',              // X Replied To
  'General',              // Y Reply Type
  'General',              // Z Forward Chain
  'General',              // AA Reply Summary
  'General',              // AB Duplicate Reason
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
  // Added Aug 2026 — an on-ground incident in one line is the whole point of
  // reading this tab, so it carries the summary too.
  'AI Summary',
  // ── The thread ledger, added 15 Aug 2026 ──────────────────────────────────
  // An on-ground incident is the traffic that threads hardest: the same mail
  // comes back four times before it is settled. This tab has no SLA columns to
  // hang that off, so it takes the three that say it plainly.
  'Mails in Thread', 'Last Mail', 'Reply Summary', 'Duplicate Reason',
] as const

/** The A–J layout this tab was created with. See `LEGACY_SHEET_COLUMNS`. */
export const LEGACY_EXCLUDED_SHEET_COLUMNS = EXCLUDED_SHEET_COLUMNS.slice(0, 10)

export const EXCLUDED_SHEET_FIRST_COLUMN = 'A'
export const EXCLUDED_SHEET_LAST_COLUMN  = 'O'

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
  'General',              // K AI Summary
  '0',                    // L Mails in Thread
  'm/d/yyyy h:mm',        // M Last Mail
  'General',              // N Reply Summary
  'General',              // O Duplicate Reason
] as const

// ── Replied-row highlight ────────────────────────────────────────────────────

/**
 * The fill painted across a query's row once it has been answered.
 *
 * `#C6EFCE` deliberately: it is the green of Excel's own "Good" cell style, so a
 * row this system colours and a row someone colours by hand from the ribbon look
 * identical. Only the layout's own columns are painted — the team's lists to the
 * right of the layout are never touched.
 */
export const REPLIED_ROW_FILL = '#C6EFCE'

// ── Third tab: daily mail counts ─────────────────────────────────────────────

/**
 * The "Daily Mail Stats" tab: how much mail reached each monitored address on
 * each day, split into the mail that became a query and the mail that did not.
 *
 * Like the AI Usage tab and unlike the two query tabs, this one is entirely the
 * app's: nothing on it is hand-edited, so every export clears it and lays it out
 * again from the database. The counts move on every sweep and half a stale
 * report is worse than none.
 */
export const DAILY_STATS_COLUMNS = [
  'Date', 'Mailbox', 'Total mails', 'Useful (queries)', 'Other mail',
  'Replied', 'Awaiting reply', 'Answered by them', 'Reply rate',
] as const

export const DAILY_STATS_FIRST_COLUMN = 'A'
export const DAILY_STATS_LAST_COLUMN  = 'I'

export const DAILY_STATS_NUMBER_FORMATS = [
  '[$-en-US]dd-mmm-yy;@', // A Date
  'General',              // B Mailbox
  '#,##0',                // C Total mails
  '#,##0',                // D Useful (queries)
  '#,##0',                // E Other mail
  '#,##0',                // F Replied
  '#,##0',                // G Awaiting reply
  '#,##0',                // H Answered by them
  '0%',                   // I Reply rate
] as const

// ── Fourth tab: every mail, unfiltered ───────────────────────────────────────

/**
 * The "All Mails" tab: **one row per message that reached a monitored mailbox,
 * with nothing filtered out and nothing folded away.**
 *
 * The other three tabs each answer a narrower question, and all three of them
 * hide mail on purpose — the query sheet folds a chaser into the row its thread
 * already owns, the other-mail tab holds only what the exclusion patterns
 * diverted, and neither has ever seen internal or automated mail, which the
 * sweep discards at the mailbox. This tab is the raw ledger underneath all of
 * that: every mail, once, in the order it arrived.
 *
 * The columns are the query sheet's, minus the three that only mean anything on
 * a query — Replied time, Sales Person and Destination. Everything a mail's
 * thread knows (status, SLA, reply detail, summaries) is filled in from the
 * entry it belongs to; a mail that never became an entry carries its identity in
 * Status and leaves those columns blank.
 *
 * Like the daily counts and the AI usage report and unlike the two query tabs,
 * this one is entirely the app's: every export clears it and lays it out again,
 * because a status on it moves whenever a reply lands.
 */
export const ALL_MAILS_SHEET_COLUMNS = [
  'Date', 'Status', 'Subject', 'Allocation time', 'File Handler',
  'From', 'From Email', 'TO List', 'Agent', 'Travel Date', 'CNTL',
  'Amendment', 'Region', 'Replied By', 'Response (hrs)', 'SLA',
  'Mails in Thread', 'Last Mail', 'AI Summary', 'Replied By Email',
  'Replied To', 'Reply Type', 'Forward Chain', 'Reply Summary',
  'Duplicate Reason',
] as const

export const ALL_MAILS_FIRST_COLUMN = 'A'
export const ALL_MAILS_LAST_COLUMN  = 'Y'

export const ALL_MAILS_NUMBER_FORMATS = [
  '[$-en-US]dd-mmm-yy;@', // A Date
  'General',              // B Status
  'General',              // C Subject
  'm/d/yyyy h:mm',        // D Allocation time
  'General',              // E File Handler
  'General',              // F From
  'General',              // G From Email
  'General',              // H TO List
  'General',              // I Agent
  'm/d/yyyy',             // J Travel Date
  'General',              // K CNTL
  'General',              // L Amendment
  'General',              // M Region
  'General',              // N Replied By
  '0.00',                 // O Response (hrs) — a real number, so it averages
  'General',              // P SLA
  '0',                    // Q Mails in Thread
  'm/d/yyyy h:mm',        // R Last Mail
  'General',              // S AI Summary
  'General',              // T Replied By Email
  'General',              // U Replied To
  'General',              // V Reply Type
  'General',              // W Forward Chain
  'General',              // X Reply Summary
  'General',              // Y Duplicate Reason
] as const

/**
 * Column B on that tab — what this mail *is*, which on a raw ledger has to say
 * more than a reply status can.
 *
 * A query's row shows where it stands (Replied / Pending / Overdue). Everything
 * else shows why it is not a query: it chased a thread that already has a row,
 * an exclusion pattern diverted it, or the sweep never took it on at all.
 */
export const ALL_MAILS_STATUS = {
  FOLLOW_UP: 'Follow-up',
  EXCLUDED:  'Other mail',
  INTERNAL:  'Internal',
  AUTOMATED: 'Automated',
  UNTRACKED: 'Not tracked',
} as const

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
 * How a monitored address is read.
 *
 * `USER` is a mailbox Graph can open — a person's, or a licenced shared one.
 * `ALIAS` is a distribution group that has no mailbox behind it: Graph answers
 * `ErrorInvalidUser` for it and, without `Group.Read.All`, cannot even be asked
 * what it is. Its traffic is instead recognised on the TO/CC line of mail
 * collected out of the members' inboxes, which costs no extra call and no extra
 * permission. See `ALIAS_ATTRIBUTION` in run.ts.
 */
export type MailboxKind = 'USER' | 'ALIAS'

/**
 * The file-handler mailboxes the booking team asked to monitor, plus the
 * `availcheck@` group they are all on.
 *
 * availcheck is a **distribution group**, not a mailbox — verified against the
 * tenant: `/users/availcheck@aahaas.com` is `Request_ResourceNotFound`, no user
 * carries it as a proxy address, and this app registration has no
 * `Group.Read.All` to look the group itself up. So it is monitored as an ALIAS:
 * every mail the members receive that names it in TO or CC counts as a mail to
 * availcheck. It is written under two domains, hence the second address.
 */
export const SEED_MAILBOXES: {
  email: string; displayName: string; isActive: boolean
  kind?: MailboxKind; aliasAddresses?: string; lastError?: string
}[] = [
  { email: 'sajid.joshua@aahaas.com',     displayName: 'Sajid',    isActive: true },
  { email: 'vishmika.kavindi@aahaas.com', displayName: 'Vishmika', isActive: true },
  { email: 'richard.kenny@aahaas.com', displayName: 'Richard', isActive: true },
  { email: 'sudari.sachinthani@aahaas.com', displayName: 'Sudari', isActive: true },
  { email: 'abdul.rahman@aahaas.com',     displayName: 'Abdul',    isActive: true },
   { email: 'afrose.a@aahaas.com',     displayName: 'afrose',    isActive: true },
  { email: 'shabrina.jabbar@aahaas.com',  displayName: 'Shabrina', isActive: true },
  {
    email: 'availcheck@aahaas.com', displayName: 'Availcheck', isActive: true,
    kind: 'ALIAS', aliasAddresses: 'availcheck@appleholidaysds.com',
  },
]

/** Recognised on a TO/CC line, an ALIAS address counts as a recipient. */
export const ALIAS_MAILBOX_NOTE =
  'Distribution group — Graph cannot open it, so its mail is counted from the TO/CC '
  + 'line of the mail its members receive. A mail sent only to this group and to '
  + 'nobody monitored is not visible to this system.'

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
