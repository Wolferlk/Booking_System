/** Shared client-side shapes for the Query Monitor screens. */

export interface QmEntry {
  id:               string
  subject:          string
  fromAddress:      string
  fromName:         string
  fromDomain:       string
  receivedAt:       string
  repliedAt:        string | null
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
  sheetRow:         number | null
  syncStatus:       'PENDING' | 'SYNCED' | 'DIRTY' | 'FAILED' | 'SKIPPED'
  syncError:        string | null
  syncedAt:         string | null
  /** The standby workbook's own row and state — it numbers rows independently. */
  backupSheetRow:   number | null
  backupSyncStatus: 'PENDING' | 'SYNCED' | 'DIRTY' | 'FAILED' | 'SKIPPED'
  backupSyncError:  string | null
  createdAt:        string
  matches?:         { handlerName: string; repliedAt: string | null; mailboxId: string }[]
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
  slaHours:          number
  replyChaseDays:    number
  excludeEnabled:    boolean
  excludePatterns:   string
  excludedSheetName: string
  /** `YYYY-MM-DD` — mail older than this never reaches either workbook. */
  startDate:         string
  backupEnabled:     boolean
  backupSheetUrl:    string
  lastRunAt:         string | null
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
  lastDataRow:   number
  nextAppendRow: number
  dataRowCount:  number
  lastModified:  string | null
}
