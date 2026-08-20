/** Shared client-side shapes for the Query Monitor screens. */

export interface QmEntry {
  id:               string
  subject:          string
  fromAddress:      string
  fromName:         string
  fromDomain:       string
  receivedAt:       string
  /** Newest mail of the thread; `receivedAt` stays the first one. */
  lastMessageAt:    string | null
  /** Later mails of the same thread that share this row instead of adding one. */
  followUpCount:    number
  repliedAt:        string | null
  /** Sheet column O — whose Sent Items the reply was found in. */
  repliedBy:        string | null
  /** Sheet column W — the mailbox that answer went out of. */
  repliedByEmail:   string | null
  /** Sheet column X — where it went, so a forward cannot pose as a reply. */
  repliedToAddress: string | null
  /**
   * Sheet column Y. DIRECT — the agent was answered · FORWARD — passed to a
   * colleague and not yet answered · INTERNAL — discussed, not yet answered.
   * Only DIRECT stops the SLA clock.
   */
  replyType:        'DIRECT' | 'FORWARD' | 'INTERNAL' | null
  /** Sheet column Z — "Sajid → Vishmika · Vishmika → Sudari", oldest hop first. */
  forwardChain:     string | null
  /** Mails from the agent on this thread, the opening one included. */
  inboundCount:     number
  /** Mails we sent on it — replies, forwards and internal notes alike. */
  outboundCount:    number
  /** Who wrote the newest mail of the thread, and which way it went. */
  lastActor:        string | null
  lastDirection:    'IN' | 'OUT' | null
  replyStatus:      'REPLIED' | 'PENDING' | 'OVERDUE'
  /** Sheet column F — the ONE handler who owns this query, '' while unclaimed. */
  handlerNames:     string
  /** Sheet column G — every handler the mail reached, comma-joined. */
  toList:           string
  salesPerson:      string | null
  agent:            string | null
  destination:      string | null
  travelDate:       string | null
  travelDateText:   string | null
  cntl:             string | null
  amendment:        string | null
  region:           string | null
  isUrgent:         boolean
  /** QUERY → the master query sheet · EXCLUDED → the other-mail tab. */
  mailKind:         'QUERY' | 'EXCLUDED'
  excludeReason:    string | null
  sheetTab:         string | null
  bodySnippet:      string
  extractionSource: 'RULE' | 'AI' | 'MANUAL'
  aiConfidence:     number | null
  /** Sheet column T — one sentence, written only while the AI-read switch is on. */
  aiSummary:        string | null
  aiSummaryAt:      string | null
  /**
   * Sheet column AA — what happened across the whole thread, rewritten each time
   * the thread grows. Unlike `aiSummary` it is filled in whether or not the AI
   * switch is on: with it off the ledger describes itself.
   */
  replySummary:     string | null
  replySummaryAt:   string | null
  sheetRow:         number | null
  /** MERGED = a follow-up sharing another query's row; never written anywhere. */
  syncStatus:       'PENDING' | 'SYNCED' | 'DIRTY' | 'FAILED' | 'SKIPPED' | 'MERGED'
  syncError:        string | null
  syncedAt:         string | null
  /** The standby workbook's own row and state — it numbers rows independently. */
  backupSheetRow:   number | null
  backupSyncStatus: 'PENDING' | 'SYNCED' | 'DIRTY' | 'FAILED' | 'SKIPPED' | 'MERGED'
  backupSyncError:  string | null
  createdAt:        string
  matches?:         { handlerName: string; repliedAt: string | null; mailboxId: string }[]
}

/**
 * One mail of a thread. Fetched per query from `/entries/[id]/thread` when the
 * detail panel opens — never with the list, which would multiply its size.
 */
export interface QmThreadEvent {
  id:           string
  direction:    'IN' | 'OUT'
  /** QUERY · FOLLOW_UP — theirs. REPLY · FORWARD · INTERNAL — ours. */
  kind:         'QUERY' | 'FOLLOW_UP' | 'REPLY' | 'FORWARD' | 'INTERNAL'
  actorName:    string
  actorAddress: string
  /** Recipients, already resolved to handler names where the address is ours. */
  toNames:      string
  toAddresses:  string
  occurredAt:   string
  subject:      string
  snippet:      string | null
}

export interface QmThread {
  rootId:       string
  events:       QmThreadEvent[]
  rollUp: {
    inboundCount:  number
    outboundCount: number
    replyType:     'DIRECT' | 'FORWARD' | 'INTERNAL' | null
    forwardChain:  string | null
    lastActor:     string | null
    lastDirection: 'IN' | 'OUT' | null
    lastMessageAt: string | null
  }
  /** The ledger's own reading, recomputed live — what column AA falls back to. */
  ledgerSays:     string | null
  replySummary:   string | null
  replySummaryAt: string | null
}

export interface QmStats {
  replied:      number
  pending:      number
  overdue:      number
  synced:       number
  awaitingSync: number
  failed:       number
  /** Split by destination tab — both counts stay live whichever tab is shown. */
  queries:      number
  excluded:     number
  /** Queries with nobody picked out of the TO list yet. */
  unassigned:   number
}

export interface QmMailbox {
  id:            string
  email:         string
  displayName:   string
  /** ALIAS = a distribution group, counted off the TO/CC line of members' mail. */
  mailboxKind:   'USER' | 'ALIAS'
  /** Further addresses that mean the same group, comma-separated. */
  aliasAddresses: string
  isActive:      boolean
  sortOrder:     number
  lastCheckedAt: string | null
  lastMessageAt: string | null
  lastError:     string | null
  totalSeen:     number
}

export interface QmRule {
  id:            string
  matchType:     'DOMAIN' | 'EMAIL'
  pattern:       string
  salesPerson:   string
  agent:         string
  region:        string | null
  destination:   string | null
  isActive:      boolean
  priority:      number
  matchCount:    number
  lastMatchedAt: string | null
  notes:         string | null
}

export interface QmConfig {
  enabled:           boolean
  intervalMinutes:   number
  lookbackHours:     number
  autoWrite:         boolean
  sheetUrl:          string
  sheetName:         string
  writeStatusColumn: boolean
  captureUnmatched:  boolean
  aiEnabled:         boolean
  /** GPT reads every new mail and writes a one-sentence summary into the sheet. */
  aiSummaryEnabled:  boolean
  slaHours:          number
  replyChaseDays:    number
  /** One row per thread: a follow-up rewrites the query's row instead of adding one. */
  threadMergeEnabled: boolean
  /** How far back a follow-up may reach to find the row it belongs to, in days. */
  threadWindowDays:   number
  excludeEnabled:    boolean
  excludePatterns:   string
  excludedSheetName: string
  /** Tab the OpenAI spend report is rewritten onto. */
  aiUsageSheetName:  string
  /** Tab the daily mail counts are rewritten onto. */
  dailyStatsSheetName: string
  /** How many days back those counts cover. */
  dailyStatsDays:      number
  /** Rewrite the counts at the end of every sweep. */
  dailyStatsAutoWrite: boolean
  /** Tab every collected mail is rewritten onto, unfiltered. */
  allMailsSheetName:   string
  /** How many days of mail that tab covers. */
  allMailsDays:        number
  /** Rewrite the all-mail tab at the end of every sweep. */
  allMailsAutoWrite:   boolean
  /** Turn an answered query's row green in the workbook. */
  highlightReplied:    boolean
  /** `YYYY-MM-DD` — mail older than this never reaches either workbook. */
  startDate:         string
  backupEnabled:     boolean
  backupSheetUrl:    string
  lastRunAt:         string | null
}

/** One address on one day — see src/lib/query-monitor/daily-stats.ts. */
export interface QmDailyCount {
  day:            string
  mailboxId:      string
  mailbox:        string
  isAlias:        boolean
  total:          number
  useful:         number
  other:          number
  replied:        number
  awaiting:       number
  answeredByThem: number
}

export interface QmDailyStats {
  generatedAt: string
  timezone:    string
  days:        number
  from:        string
  to:          string
  daily:       { day: string; total: number; useful: number; other: number; replied: number; awaiting: number; queries: number }[]
  perMailbox:  QmDailyCount[]
  summary:     {
    mailboxId: string; mailbox: string; isAlias: boolean; isActive: boolean
    total: number; useful: number; other: number; replied: number; awaiting: number; answeredByThem: number
  }[]
  totals:      { total: number; useful: number; other: number; replied: number; awaiting: number; queries: number }
}

export interface QmRun {
  id:               string
  trigger:          string
  status:           'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'SKIPPED'
  startedAt:        string
  finishedAt:       string | null
  durationMs:       number | null
  windowFrom:       string | null
  windowTo:         string | null
  mailboxesScanned: number
  messagesSeen:     number
  entriesCreated:   number
  entriesUpdated:   number
  repliesDetected:  number
  rowsAppended:     number
  rowsUpdated:      number
  aiCalls:          number
  errors:           number
  errorMessage:     string | null
  triggeredBy:      string | null
}

export interface QmRunStep {
  t:     string
  level: 'info' | 'success' | 'warn' | 'error'
  msg:   string
  meta?: Record<string, unknown>
}

/** The standby workbook's state, reported alongside the live one. */
export type QmBackupInfo =
  | { ok: true;  info: QmSheetInfo }
  | { ok: false; error: string }

export interface QmSheetInfo {
  driveId:       string
  itemId:        string
  fileName:      string
  webUrl:        string
  sheetName:     string
  header:        string[]
  headerMatches: boolean
  /** New columns the next write will add to row 1, if row 1 is an older layout. */
  headerPendingColumns?: string[]
  /**
   * Set when this tab keeps a header the team edited and the app was told to
   * write under it as it stands. Null while the tab carries the app's layout.
   */
  custom?: {
    adoptedAt: string
    /** Row 1 changed after it was adopted — the mapping has to be taken again. */
    stale:     boolean
    /** Each app column and the letter it now lives under. */
    columns:   { cell: string; column: string }[]
    /** App columns this header has no place for — they are never written. */
    missing:   string[]
  } | null
  lastDataRow:   number
  nextAppendRow: number
  dataRowCount:  number
  lastModified:  string | null
}
