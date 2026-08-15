/**
 * SharePoint workbook writer for the Query Monitor.
 *
 * Talks to the Excel REST surface of Microsoft Graph (`/workbook/...`) against
 * the live master sheet, so the team sees rows appear without a download/upload
 * cycle and without ever locking the file.
 *
 * Two rules the rest of the code depends on:
 *   1. Writes are confined to the layout's own columns (A–AB on the query sheet,
 *      A–O on the other-mail tab). Anything further right belongs to the team's
 *      lookup lists and pivot helpers, and touching it would corrupt the sheet.
 *      The layout only ever grows into columns verified empty first — except for
 *      the one column that had to *move*; see `realignWorksheet`.
 *   2. The append row is found by scanning column C (Subject) from the bottom,
 *      not from `usedRange`: the used range extends past the real data because
 *      of trailing formatted-but-empty rows.
 *
 * Every call can be aimed at either workbook — the live one the team reads, or
 * the standby copy that mirrors it.
 */
import { graphFetch, getGraphToken } from '@/lib/graph-client'
import {
  EXCLUDED_SHEET_COLUMNS, EXCLUDED_SHEET_FIRST_COLUMN, EXCLUDED_SHEET_LAST_COLUMN,
  EXCLUDED_SHEET_NUMBER_FORMATS,
  FROM_COLUMN_INDEX, LEGACY_SHEET_COLUMNS, PREVIOUS_FROM_COLUMN_INDEX,
  PREVIOUS_SHEET_COLUMNS,
  SETTINGS, SHEET_COLUMNS, SHEET_FIRST_COLUMN, SHEET_LAST_COLUMN,
  SHEET_NUMBER_FORMATS,
} from './constants'
import { getConfig, getSetting, setSetting } from './config'
import {
  adoptionStillFits, clearAdoptedHeader, columnRuns, getAdoptedHeader, matchHeader,
  projectRow, saveAdoptedHeader, type AdoptedHeader, type HeaderMatch,
} from './header-map'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

export interface SheetRef {
  driveId:  string
  itemId:   string
  fileName: string
  webUrl:   string
}

export interface SheetInfo extends SheetRef {
  sheetName:      string
  header:         string[]
  headerMatches:  boolean
  /** Set when row 1 is an older layout of ours that the next write will widen. */
  headerPendingColumns: string[]
  /**
   * True when row 1 is the order this tab carried before **From** was moved next
   * to File Handler. Writes are refused until it is moved — pressing *Prepare*
   * does it, in place, without touching a single row. See `realignWorksheet`.
   */
  headerNeedsRealign: boolean
  /**
   * Set when this tab carries a header the team edited and this system was told
   * to write under it as it stands. Null on a tab that still has our layout.
   */
  custom: {
    adoptedAt: string
    /** Row 1 has changed since — writing under the old mapping would be wrong. */
    stale:     boolean
    /** Our fields and the columns they now live in. */
    columns:   { cell: string; column: string }[]
    /** Our fields the header has no column for — never written. */
    missing:   string[]
  } | null
  lastDataRow:    number
  nextAppendRow:  number
  dataRowCount:   number
  lastModified:   string | null
}

/** A row as it will be laid down in columns A–AB. */
export interface SheetRowValues {
  date:           number | ''  // A — Excel date serial
  status:         string       // B
  subject:        string       // C
  allocationTime: number | ''  // D — Excel datetime serial
  repliedTime:    number | ''  // E — Excel datetime serial
  fileHandler:    string       // F — exactly one name, or blank until chosen
  from:           string       // G — the agent's display name, beside its owner
  fromEmail:      string       // H — the address it actually came from
  toList:         string       // I — every handler the mail reached
  salesPerson:    string       // J
  destination:    string       // K
  agent:          string       // L
  travelDate:     number | ''  // M — Excel date serial
  cntl:           string       // N
  amendment:      string       // O
  region:         string       // P
  repliedBy:      string       // Q — whose Sent Items the reply was found in
  responseHours:  number | ''  // R — allocation → reply, in hours
  sla:            string       // S — Met / Missed, blank while open
  /**
   * T — every mail of the conversation, ours included.
   *
   * Widened on 15 Aug 2026 from "inbound mails folded into this row" to the
   * whole thread, both directions: a row that stands for three agent mails and
   * two of our replies is a five-mail thread, and reading it as three was the
   * complaint that started the ledger. `threadIn`/`threadOut` on the entry keep
   * the split, and column Z spells the traffic out hop by hop.
   */
  threadCount:    number | ''
  lastMail:       number | ''  // U — Excel datetime serial of the newest mail
  aiSummary:      string       // V — one sentence on the mail that opened it
  repliedByEmail: string       // W — the mailbox the reply went out of
  repliedTo:      string       // X — where it went, so a forward cannot pose as a reply
  replyType:      string       // Y — Direct reply / Forwarded / Internal only
  forwardChain:   string       // Z — "Sajid → Vishmika · Vishmika → Sudari"
  replySummary:   string       // AA — what happened across the whole thread
  /**
   * AB — why this row is the one that survived, when duplicates were folded
   * into it. Blank on the overwhelming majority of rows, and that is the point:
   * a filled cell is the sheet showing its working for a line that now stands
   * for mail the team can no longer see written out.
   */
  duplicateReason: string
}

export function rowToCells(row: SheetRowValues): (string | number)[] {
  return [
    row.date, row.status, row.subject, row.allocationTime, row.repliedTime,
    row.fileHandler, row.from, row.fromEmail,
    row.toList, row.salesPerson, row.destination, row.agent,
    row.travelDate, row.cntl, row.amendment, row.region,
    row.repliedBy, row.responseHours, row.sla, row.threadCount, row.lastMail,
    row.aiSummary,
    row.repliedByEmail, row.repliedTo, row.replyType, row.forwardChain,
    row.replySummary, row.duplicateReason,
  ]
}

/** A row on the second tab, columns A–O. See EXCLUDED_SHEET_COLUMNS. */
export interface ExcludedRowValues {
  date:         number | ''  // A — Excel date serial
  receivedTime: number | ''  // B — Excel datetime serial
  subject:      string       // C
  sender:       string       // D
  senderEmail:  string       // E
  fileHandler:  string       // F — one name, or blank
  toList:       string       // G — every handler the mail reached
  reason:       string       // H — the pattern that kept it out of the query sheet
  destination:  string       // I
  cntl:         string       // J
  aiSummary:    string       // K — one sentence, when the AI switch is on
  threadCount:  number | ''  // L — every mail of the conversation, ours included
  lastMail:     number | ''  // M — Excel datetime serial of the newest mail
  replySummary: string       // N — what happened across the whole thread
  duplicateReason: string    // O — why this row survived a fold
}

export function excludedRowToCells(row: ExcludedRowValues): (string | number)[] {
  return [
    row.date, row.receivedTime, row.subject, row.sender, row.senderEmail,
    row.fileHandler, row.toList, row.reason, row.destination, row.cntl,
    row.aiSummary,
    row.threadCount, row.lastMail, row.replySummary, row.duplicateReason,
  ]
}

/** Where a set of rows is written: which tab, and over which columns. */
export interface SheetLayout {
  /** Which of the two tabs this describes — the layouts are told apart by it. */
  kind:          'query' | 'excluded'
  firstColumn:   string
  lastColumn:    string
  /** Column scanned bottom-up to find the append point — must always be filled. */
  keyColumn:     string
  /** Which layout field the key column holds, so a mapping can move it. */
  keyIndex:      number
  header:        readonly string[]
  numberFormats: readonly string[]
  /**
   * Set only when the tab carries a header the team edited and we agreed to
   * write under: the physical 0-based column per field, in layout order, -1 for
   * a field the header has no column for. Absent means "by position, A onwards".
   */
  map?:          readonly number[]
}

export const QUERY_LAYOUT: SheetLayout = {
  kind:          'query',
  firstColumn:   SHEET_FIRST_COLUMN,
  lastColumn:    SHEET_LAST_COLUMN,
  keyColumn:     'C', // Subject
  keyIndex:      2,
  header:        SHEET_COLUMNS,
  numberFormats: SHEET_NUMBER_FORMATS,
}

export const EXCLUDED_LAYOUT: SheetLayout = {
  kind:          'excluded',
  firstColumn:   EXCLUDED_SHEET_FIRST_COLUMN,
  lastColumn:    EXCLUDED_SHEET_LAST_COLUMN,
  keyColumn:     'C', // Subject
  keyIndex:      2,
  header:        EXCLUDED_SHEET_COLUMNS,
  numberFormats: EXCLUDED_SHEET_NUMBER_FORMATS,
}

// ── Layouts over a hand-edited header ────────────────────────────────────────

/** `"A" → 0`, `"O" → 14`. The inverse of `columnLetter`. */
export function columnIndex(letter: string): number {
  return letter.toUpperCase().split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1
}

/**
 * The same layout, aimed at the columns a mapping names instead of at A onwards.
 *
 * The span widens to cover every mapped column — reads cover the lot in one
 * request — but writes never do: they go out run by run, so a column of the
 * team's sitting inside the span is read past and never written to.
 */
export function withColumnMap(base: SheetLayout, map: readonly number[]): SheetLayout {
  const used = map.filter(col => col >= 0)
  if (used.length === 0) return base
  if (map.length === base.header.length && map.every((col, i) => col === i)) return base

  const first = Math.min(...used)
  const last  = Math.max(...used)
  const keyColumn = map[base.keyIndex] >= 0 ? columnLetter(map[base.keyIndex]) : columnLetter(first)

  return {
    ...base,
    firstColumn: columnLetter(first),
    lastColumn:  columnLetter(last),
    keyColumn,
    map,
  }
}

/**
 * The layout a tab is actually written under: ours, or the team's if their
 * header was adopted and row 1 still matches the one that was adopted.
 *
 * The staleness check lives in `ensureWorksheet`, which every write path runs
 * before it writes. This resolver is the cheap read of the stored mapping.
 */
export async function layoutFor(
  ref: SheetRef, sheetName: string, base: SheetLayout,
): Promise<SheetLayout> {
  const adopted = await getAdoptedHeader(ref.itemId, sheetName)
  return adopted ? withColumnMap(base, adopted.map) : base
}

// ── Header compatibility ─────────────────────────────────────────────────────

/** `0 → "A"`, `14 → "O"`, `26 → "AA"`. */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Can this header be grown into the current layout without relabelling a column
 * that already describes real data?
 *
 * Yes exactly when what is on row 1 is a *prefix* of the layout — the columns
 * the workbook was started with, in their original order — and every cell after
 * it is blank. Then the missing names can be written into empty cells to the
 * right and not one existing value changes meaning. This is what lets six new
 * columns be added to a sheet the team is already using and reading.
 *
 * Returns the column index the extension starts at, or null when the header is
 * complete, or genuinely someone else's.
 */
export function headerExtension(cells: string[], layout: SheetLayout): number | null {
  const expected = layout.header

  let filled = 0
  while (filled < expected.length && (cells[filled] ?? '').trim() !== '') filled += 1
  if (filled === 0 || filled >= expected.length) return null

  // A prefix of ours, and nothing past it — including in the cells beyond the
  // layout, which would mean the team put something of their own there.
  const isPrefix = expected.slice(0, filled).every((name, i) => same(cells[i] ?? '', name))
  const tailBlank = cells.slice(filled).every(cell => (cell ?? '').trim() === '')

  return isPrefix && tailBlank ? filled : null
}

// ── Moving a column in a file the team is using ──────────────────────────────

/**
 * Is row 1 the order this sheet carried before **From** was moved next to File
 * Handler?
 *
 * Exact match only, over the full previous layout or over any prefix of it that
 * reaches at least the columns the workbook was started with. A sheet in any
 * other state is not recognised and is not touched — the whole safety of moving
 * a column in a live file is that the transformation knows precisely what it is
 * looking at.
 */
export function needsRealign(cells: string[]): boolean {
  const previous = PREVIOUS_SHEET_COLUMNS

  let filled = 0
  while (filled < previous.length && (cells[filled] ?? '').trim() !== '') filled += 1
  // Anything past the previous layout means the team has put something of their
  // own there, and the shifting below would move it.
  if (!cells.slice(filled).every(cell => (cell ?? '').trim() === '')) return false
  // A shorter header than the original A–N is a sheet that was never ours.
  if (filled < LEGACY_SHEET_COLUMNS.length) return false
  // Already carrying From at G — nothing to move.
  if (same(cells[FROM_COLUMN_INDEX] ?? '', SHEET_COLUMNS[FROM_COLUMN_INDEX])) return false

  return previous.slice(0, filled).every((name, i) => same(cells[i] ?? '', name))
}

export interface RealignResult {
  moved:   boolean
  /** Set when the tab was left exactly as it was, and why. */
  skipped?: string
}

/**
 * Move **From** and **From Email** from the far right to G / H, in place.
 *
 * They arrived at U / V with the rest of the thread ledger, which is where new
 * columns can always go safely — but it is not where they are useful. The team
 * reads File Handler and the sender together, and a column twenty places away
 * might as well not be on the sheet.
 *
 * There is no way to do that without moving real columns in a file people are
 * working in, so it is done the way a person would, and Excel does the moving:
 *
 *   1. **Delete U:V**, shifting left. These two columns are ours and days old;
 *      nothing of the team's has ever been in them.
 *   2. **Insert two columns at G**, shifting right. Everything from the old TO
 *      List onwards moves two places, and Excel rewrites every formula, named
 *      range, filter and conditional format that pointed at those cells — which
 *      is the entire reason for doing it as an Excel operation rather than by
 *      rewriting values ourselves.
 *   3. **Name the two new columns.** Row 1 is then exactly this layout's header
 *      for every column that existed before, and the ones added since fill in
 *      through the ordinary `headerExtension` path on the next write.
 *
 * Order matters: U:V are deleted while they are still at U:V. Doing the insert
 * first would move them to W:X and the delete would take two of the team's
 * columns instead.
 *
 * Rows are not touched at all, so every stored `sheetRow` pointer still names
 * the same query and nothing is re-appended or re-synced.
 *
 * The guard is `needsRealign`, and it is strict on purpose: a tab whose row 1 is
 * not *exactly* the shape this knows how to transform is left alone and reported
 * as a header mismatch, which is what stops rows going into the wrong columns.
 */
export async function realignWorksheet(
  ref: SheetRef, sheetName: string, sessionId: string | null = null,
): Promise<RealignResult> {
  const cells = await readWideHeader(ref, sheetName, sessionId)
  if (!needsRealign(cells)) return { moved: false, skipped: 'not the previous layout' }

  const range = (address: string) =>
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`

  // Only if they really are our two columns. A blind delete of U:V on a sheet
  // that never got them would take Reply Type and Forward Chain with it.
  const fromAt = PREVIOUS_FROM_COLUMN_INDEX
  const hasFromColumns =
    same(cells[fromAt] ?? '', 'From') && same(cells[fromAt + 1] ?? '', 'From Email')

  if (hasFromColumns) {
    const first = columnLetter(fromAt)
    const last  = columnLetter(fromAt + 1)
    await workbookFetch(`${range(`${first}:${last}`)}/delete`, sessionId, {
      method: 'POST', body: JSON.stringify({ shift: 'Left' }),
    })
  }

  const target    = columnLetter(FROM_COLUMN_INDEX)
  const targetEnd = columnLetter(FROM_COLUMN_INDEX + 1)
  await workbookFetch(`${range(`${target}:${targetEnd}`)}/insert`, sessionId, {
    method: 'POST', body: JSON.stringify({ shift: 'Right' }),
  })

  const headerAddress = `${target}1:${targetEnd}1`
  await workbookFetch(range(headerAddress), sessionId, {
    method: 'PATCH',
    body: JSON.stringify({
      values: [[SHEET_COLUMNS[FROM_COLUMN_INDEX], SHEET_COLUMNS[FROM_COLUMN_INDEX + 1]]],
    }),
  })
  await workbookFetch(`${range(headerAddress)}/format/font`, sessionId, {
    method: 'PATCH', body: JSON.stringify({ bold: true }),
  }).catch(() => {})

  return { moved: true }
}

// ── Share-URL resolution ─────────────────────────────────────────────────────

/** Graph's sharing token: unpadded base64url of the share URL, prefixed `u!`. */
export function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/** Which of the two workbooks a call is aimed at. */
export type WorkbookTarget = 'primary' | 'backup'

/**
 * Resolve a configured share URL to a drive/item pair, caching the result — the
 * lookup costs a round-trip and the IDs are stable for the life of the file.
 *
 * The backup workbook is resolved and cached exactly like the primary, under its
 * own setting keys, so a change to one never invalidates the other.
 */
export async function resolveSheetRef(force = false, target: WorkbookTarget = 'primary'): Promise<SheetRef> {
  const refKey = target === 'backup' ? SETTINGS.backupSheetRef : SETTINGS.sheetRef

  if (!force) {
    const cached = await getSetting(refKey)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SheetRef
        if (parsed.driveId && parsed.itemId) return parsed
      } catch { /* fall through and re-resolve */ }
    }
  }

  const config = await getConfig()
  const url = target === 'backup' ? config.backupSheetUrl : config.sheetUrl
  if (!url) {
    throw new Error(target === 'backup'
      ? 'No backup workbook URL configured — set it in Query Monitor → Configuration'
      : 'No workbook URL configured — set it in Query Monitor → Configuration')
  }

  const item = await graphFetch<{
    id: string; name: string; webUrl: string
    parentReference?: { driveId?: string }
  }>(`/shares/${encodeShareUrl(url)}/driveItem?$select=id,name,webUrl,parentReference`)

  const driveId = item.parentReference?.driveId
  if (!driveId) throw new Error('Graph returned the workbook without a driveId — is the link a file share?')

  const ref: SheetRef = { driveId, itemId: item.id, fileName: item.name, webUrl: item.webUrl }
  await setSetting(refKey, JSON.stringify(ref))
  return ref
}

/** Convenience wrapper — the standby copy that mirrors every write. */
export const resolveBackupSheetRef = (force = false) => resolveSheetRef(force, 'backup')

// ── Low-level workbook calls ─────────────────────────────────────────────────

function worksheetPath(ref: SheetRef, sheetName: string): string {
  return `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets('${encodeURIComponent(sheetName)}')`
}

/**
 * A persistent workbook session batches our writes into one save instead of one
 * save per call. Sessions expire on their own, so a failure to open or close is
 * never fatal — we just fall back to session-less calls.
 */
export async function openSession(ref: SheetRef): Promise<string | null> {
  try {
    const res = await graphFetch<{ id: string }>(
      `/drives/${ref.driveId}/items/${ref.itemId}/workbook/createSession`,
      { method: 'POST', body: JSON.stringify({ persistChanges: true }) },
    )
    return res.id ?? null
  } catch {
    return null
  }
}

export async function closeSession(ref: SheetRef, sessionId: string | null): Promise<void> {
  if (!sessionId) return
  try {
    const token = await getGraphToken()
    await fetch(`${GRAPH_BASE}/drives/${ref.driveId}/items/${ref.itemId}/workbook/closeSession`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'workbook-session-id': sessionId,
      },
    })
  } catch { /* the session times out by itself */ }
}

async function workbookFetch<T>(
  path: string,
  sessionId: string | null,
  opts: RequestInit = {},
): Promise<T> {
  return graphFetch<T>(path, {
    ...opts,
    headers: {
      ...(sessionId ? { 'workbook-session-id': sessionId } : {}),
      ...(opts.headers ?? {}),
    },
  })
}

interface RangeResponse {
  address:      string
  rowCount:     number
  columnCount:  number
  values:       (string | number | boolean | null)[][]
  text?:        string[][]
  numberFormat?: string[][]
}

async function readRange(
  ref: SheetRef, sheetName: string, address: string, sessionId: string | null = null,
  /** Formats are only asked for when a block is being copied cell for cell. */
  withFormats = false,
): Promise<RangeResponse> {
  const select = `address,rowCount,columnCount,values,text${withFormats ? ',numberFormat' : ''}`
  return workbookFetch<RangeResponse>(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')?$select=${select}`,
    sessionId,
  )
}

// ── Sheet inspection ─────────────────────────────────────────────────────────

/**
 * Last row that actually holds data, found by walking column C upwards.
 * `usedRange` over-reports here (the sheet carries formatted empty rows past the
 * final entry), and appending into those would leave gaps in the pivots.
 */
export async function findLastDataRow(
  ref: SheetRef, sheetName: string, sessionId: string | null = null,
  layout: SheetLayout = QUERY_LAYOUT,
): Promise<number> {
  const used = await workbookFetch<{ address: string; rowCount: number }>(
    `${worksheetPath(ref, sheetName)}/range(address='${layout.firstColumn}:${layout.lastColumn}')/usedRange(valuesOnly=true)?$select=address,rowCount`,
    sessionId,
  )

  const upperBound = Math.max(used.rowCount, 2)
  const key = layout.keyColumn
  const column = await readRange(ref, sheetName, `${key}1:${key}${upperBound}`, sessionId)

  let last = 1 // header row
  column.values.forEach((cell, i) => {
    if (String(cell?.[0] ?? '').trim() !== '') last = i + 1
  })
  return last
}

export async function getSheetInfo(force = false, target: WorkbookTarget = 'primary'): Promise<SheetInfo> {
  const { sheetName } = await getConfig()
  const ref = await resolveSheetRef(force, target)

  // Both workbooks were created empty for this system, so the query tab may not
  // exist yet on a first look. Making it here means "Test" prepares the file
  // rather than failing on it. It reports a wrong header rather than correcting
  // one — that is what the explicit "Prepare" action is for.
  await ensureWorksheet(ref, sheetName, QUERY_LAYOUT, null, { repair: false }).catch(() => {})

  const headerCells = await readWideHeader(ref, sheetName)

  const exact = SHEET_COLUMNS.every(
    (expected, i) => (headerCells[i] ?? '').toLowerCase() === expected.toLowerCase(),
  )
  // An older header of ours is not a mismatch — the next write fills the new
  // column names in beside it. Only a header we cannot grow into is a problem.
  const headerExtendsAt = exact ? null : headerExtension(headerCells.slice(0, SHEET_COLUMNS.length), QUERY_LAYOUT)

  // A header of the team's that this system has agreed to write under is a
  // match — for as long as it is still the header that was agreed to.
  const adopted = await getAdoptedHeader(ref.itemId, sheetName)
  const adoptionFits = adopted ? adoptionStillFits(adopted, headerCells) : false
  const custom: SheetInfo['custom'] = adopted
    ? {
        adoptedAt: adopted.adoptedAt,
        stale:     !adoptionFits,
        columns:   SHEET_COLUMNS
          .map((cell, i) => ({ cell, column: adopted.map[i] >= 0 ? columnLetter(adopted.map[i]) : '' }))
          .filter(entry => entry.column !== ''),
        missing:   SHEET_COLUMNS.filter((_, i) => (adopted.map[i] ?? -1) < 0),
      }
    : null

  // Recognisably the order this tab carried before From was moved next to File
  // Handler. Reported rather than repaired: "Test" is a read, and restructuring
  // a live workbook is something the team should press "Prepare" for.
  const realignPending = !adopted && !exact && headerExtendsAt === null && needsRealign(headerCells)

  const headerMatches = adopted ? adoptionFits : (exact || headerExtendsAt !== null)

  const layout = adopted && adoptionFits ? withColumnMap(QUERY_LAYOUT, adopted.map) : QUERY_LAYOUT
  const lastDataRow = await findLastDataRow(ref, sheetName, null, layout)

  let lastModified: string | null = null
  try {
    const meta = await graphFetch<{ lastModifiedDateTime?: string }>(
      `/drives/${ref.driveId}/items/${ref.itemId}?$select=lastModifiedDateTime`,
    )
    lastModified = meta.lastModifiedDateTime ?? null
  } catch { /* non-essential */ }

  return {
    ...ref,
    sheetName,
    header:        headerCells,
    headerMatches,
    headerPendingColumns: headerExtendsAt === null ? [] : [...SHEET_COLUMNS.slice(headerExtendsAt)],
    headerNeedsRealign: realignPending,
    custom,
    lastDataRow,
    nextAppendRow: lastDataRow + 1,
    dataRowCount:  Math.max(0, lastDataRow - 1),
    lastModified,
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

export interface AppendResult {
  firstRow: number
  lastRow:  number
  rows:     number
}

/**
 * Append rows below the last populated row, one contiguous A–M block.
 *
 * The caller supplies rows in order and gets back the row numbers they landed
 * on, which are stored per entry so a row can later be traced, re-read or
 * corrected in place.
 */
export async function appendRows(
  rows: SheetRowValues[],
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string; layout?: SheetLayout } = {},
): Promise<AppendResult> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.sheetName
  const layout    = opts.layout ?? await layoutFor(ref, sheetName, QUERY_LAYOUT)
  return appendCells(rows.map(rowToCells), layout, { ...opts, ref, sheetName })
}

/** The excluded-mail equivalent, against the second tab's A–I layout. */
export async function appendExcludedRows(
  rows: ExcludedRowValues[],
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string; layout?: SheetLayout } = {},
): Promise<AppendResult> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.excludedSheetName
  const layout    = opts.layout ?? await layoutFor(ref, sheetName, EXCLUDED_LAYOUT)
  return appendCells(rows.map(excludedRowToCells), layout, { ...opts, ref, sheetName })
}

/** The shared mechanics: find the append point, PATCH one contiguous block. */
async function appendCells(
  rows: (string | number)[][],
  layout: SheetLayout,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName: string },
): Promise<AppendResult> {
  if (rows.length === 0) return { firstRow: 0, lastRow: 0, rows: 0 }

  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName
  const sessionId = opts.sessionId ?? null

  const lastDataRow = await findLastDataRow(ref, sheetName, sessionId, layout)
  const firstRow    = lastDataRow + 1
  const lastRow     = lastDataRow + rows.length

  await writeBlock(ref, sheetName, firstRow, lastRow, rows, layout, sessionId)

  return { firstRow, lastRow, rows: rows.length }
}

/**
 * Lay a block of layout-ordered rows onto the sheet.
 *
 * Without a mapping that is one PATCH over A–T. With one it is a PATCH per run
 * of neighbouring mapped columns, which is what keeps a column the team put in
 * the middle of ours from being written over.
 */
async function writeBlock(
  ref: SheetRef, sheetName: string, firstRow: number, lastRow: number,
  rows: (string | number)[][], layout: SheetLayout, sessionId: string | null,
): Promise<void> {
  const patch = async (address: string, values: unknown[][], numberFormat: string[][]) => {
    await workbookFetch(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
      sessionId,
      { method: 'PATCH', body: JSON.stringify({ values, numberFormat }) },
    )
  }

  if (!layout.map) {
    await patch(
      `${layout.firstColumn}${firstRow}:${layout.lastColumn}${lastRow}`,
      rows,
      rows.map(() => [...layout.numberFormats]),
    )
    return
  }

  for (const run of columnRuns(layout.map)) {
    const address = `${columnLetter(run.first)}${firstRow}:${columnLetter(run.last)}${lastRow}`
    await patch(
      address,
      rows.map(row => run.fields.map(f => row[f] ?? '')),
      rows.map(() => run.fields.map(f => layout.numberFormats[f] ?? 'General')),
    )
  }
}

/**
 * Make sure a tab exists with our header on row 1, creating it if the workbook
 * has never had one. Called for both tabs of both workbooks: all four are files
 * this system lays out itself, so an empty workbook is a valid starting point.
 *
 * A header that is present but *wrong* — most often a file copied from the old
 * 13-column sheet, which has no TO List — is corrected only while the tab holds
 * no data rows. With rows below it, the header describes real cells: rewriting
 * it would relabel columns without moving anything, silently shifting every
 * value's meaning. That case is reported instead, and a human decides.
 */
export async function ensureWorksheet(
  ref: SheetRef, sheetName: string, layout: SheetLayout, sessionId: string | null = null,
  /**
   * Whether a wrong-but-present header may be corrected. Off for the read-only
   * status panel: pressing "Test" should report a mismatch, not quietly change
   * the file. On for "Prepare" and for the sync, which are asking to write.
   */
  opts: { repair?: boolean } = {},
): Promise<{ created: boolean; headerWritten: boolean; headerMismatch: boolean }> {
  const repair = opts.repair ?? true
  const sheets = await workbookFetch<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
    sessionId,
  )
  const exists = (sheets.value ?? []).some(w => w.name.toLowerCase() === sheetName.toLowerCase())

  if (!exists) {
    await workbookFetch(
      `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/add`,
      sessionId,
      { method: 'POST', body: JSON.stringify({ name: sheetName }) },
    )
  }

  // A header the team laid out and we agreed to write under. Nothing on row 1
  // is ours to touch here — the only question is whether it is still the header
  // the mapping was taken from. Changed since, and every write under the old
  // mapping would land a column out, so it is reported as a mismatch and the
  // admin is asked to look at it again.
  const adopted = await getAdoptedHeader(ref.itemId, sheetName)
  if (adopted) {
    const row1 = await readWideHeader(ref, sheetName, sessionId)
    return {
      created:       !exists,
      headerWritten: false,
      headerMismatch: !adoptionStillFits(adopted, row1),
    }
  }

  const headerAddress = `${layout.firstColumn}1:${layout.lastColumn}1`
  const header  = await readRange(ref, sheetName, headerAddress, sessionId)
  let cells     = (header.text?.[0] ?? header.values[0]?.map(v => String(v ?? '')) ?? [])
    .map(h => String(h ?? '').trim())

  // The one header change that cannot be made by writing into empty cells:
  // From / From Email have to *move* to G / H. Done before anything else looks
  // at row 1, so everything below sees the tab in its settled shape. It is a
  // repair, so the read-only status panel reports the old order rather than
  // quietly restructuring the file behind a "Test" button.
  if (repair && layout.kind === 'query' && needsRealign(cells)) {
    const realigned = await realignWorksheet(ref, sheetName, sessionId)
    if (realigned.moved) {
      const again = await readRange(ref, sheetName, headerAddress, sessionId)
      cells = (again.text?.[0] ?? again.values[0]?.map(v => String(v ?? '')) ?? [])
        .map(h => String(h ?? '').trim())
    }
  }

  const isEmpty  = cells.every(cell => cell === '')
  const matches  = layout.header.every((expected, i) => (cells[i] ?? '').toLowerCase() === expected.toLowerCase())

  if (matches) return { created: !exists, headerWritten: false, headerMismatch: false }

  // An earlier version of our own header, with empty cells where the newer
  // columns go. Only those empty cells are written, so the rows below keep every
  // value they have and every column keeps its meaning — this is how the layout
  // grows over a workbook the team is already using.
  const extendFrom = headerExtension(cells, layout)
  if (extendFrom !== null) {
    if (!repair) return { created: !exists, headerWritten: false, headerMismatch: false }

    // A blank header cell does not prove the column is free. The team keeps
    // lookup lists and pivot helpers to the right of the layout, and once these
    // columns are ours every append and rewrite writes over them. So the rows
    // below are read before the header goes in, and anything already standing
    // there stops the widening — that is a decision for a person, not a sweep.
    const lastDataRow = await findLastDataRow(ref, sheetName, sessionId, layout)
    if (lastDataRow > 1) {
      const occupied = await readRangeChunks(
        ref, sheetName, 2, lastDataRow,
        { ...layout, firstColumn: columnLetter(extendFrom) }, sessionId, 500,
      )
      const inUse = occupied.some(range =>
        range.values.some(row => row.some(cell => String(cell ?? '').trim() !== '')),
      )
      if (inUse) return { created: !exists, headerWritten: false, headerMismatch: true }
    }

    const address = `${columnLetter(extendFrom)}1:${layout.lastColumn}1`
    await workbookFetch(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
      sessionId,
      { method: 'PATCH', body: JSON.stringify({ values: [layout.header.slice(extendFrom)] }) },
    )
    await workbookFetch(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')/format/font`,
      sessionId,
      { method: 'PATCH', body: JSON.stringify({ bold: true }) },
    ).catch(() => {})

    return { created: !exists, headerWritten: true, headerMismatch: false }
  }

  // A blank row 1 is always filled in — there is no existing header to respect.
  // A wrong one is only replaced when asked, and only above an empty sheet.
  if (!isEmpty) {
    if (!repair) return { created: !exists, headerWritten: false, headerMismatch: true }

    const lastDataRow = await findLastDataRow(ref, sheetName, sessionId, layout)
    if (lastDataRow > 1) {
      return { created: !exists, headerWritten: false, headerMismatch: true }
    }
  }

  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(headerAddress)}')`,
    sessionId,
    { method: 'PATCH', body: JSON.stringify({ values: [[...layout.header]] }) },
  )
  // Bold is cosmetic — a failure here must not stop the rows going in.
  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(headerAddress)}')/format/font`,
    sessionId,
    { method: 'PATCH', body: JSON.stringify({ bold: true }) },
  ).catch(() => {})

  return { created: !exists, headerWritten: true, headerMismatch: false }
}

/**
 * Lay out a workbook so it is ready to receive rows: both tabs present, both
 * headers correct. Safe to run repeatedly, and it never touches a tab that
 * already holds data under a different header — that is reported back for a
 * human to resolve.
 */
export async function prepareWorkbook(
  target: WorkbookTarget = 'primary',
): Promise<{
  fileName: string
  tabs: { name: string; created: boolean; headerWritten: boolean; headerMismatch: boolean }[]
}> {
  const cfg = await getConfig()
  const ref = await resolveSheetRef(false, target)
  const sessionId = await openSession(ref)

  try {
    const tabs = []
    for (const [name, layout] of [
      [cfg.sheetName,         QUERY_LAYOUT],
      [cfg.excludedSheetName, EXCLUDED_LAYOUT],
    ] as const) {
      const result = await ensureWorksheet(ref, name, layout, sessionId)
      tabs.push({ name, ...result })
    }
    return { fileName: ref.fileName, tabs }
  } finally {
    await closeSession(ref, sessionId)
  }
}

// ── Living with a hand-edited header ─────────────────────────────────────────

/**
 * How far right a header is read when it is not ours: a renamed sheet can carry
 * its own columns well past T, and a mapping has to see all of them to know
 * which columns are free.
 */
const HEADER_SCAN_LAST_COLUMN = 'BZ'

/** Tab names as the workbook has them — the check before touching one. */
async function listWorksheetNames(ref: SheetRef, sessionId: string | null = null): Promise<string[]> {
  const sheets = await workbookFetch<{ value: { name: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name`,
    sessionId,
  )
  return (sheets.value ?? []).map(w => w.name)
}

async function readWideHeader(
  ref: SheetRef, sheetName: string, sessionId: string | null = null,
): Promise<string[]> {
  const row = await readRange(ref, sheetName, `A1:${HEADER_SCAN_LAST_COLUMN}1`, sessionId)
  return (row.text?.[0] ?? row.values[0]?.map(v => String(v ?? '')) ?? [])
    .map(cell => String(cell ?? '').trim())
}

export interface TabHeaderReport {
  tab:     string
  /** Layout columns found on row 1 and their column letters, in layout order. */
  mapped:  { column: string; cell: string }[]
  /** Layout columns row 1 has no home for — these are never written. */
  missing: string[]
  /** Headings on row 1 that are the team's own — read past, never written. */
  foreign: string[]
  /** Nothing to do here — an absent tab, or one whose row 1 is still blank. */
  skipped?: boolean
  error?:  string
}

/**
 * Keep the header the team has, and learn it.
 *
 * Nothing on the sheet changes — not row 1, not a single cell of data. What
 * changes is where later writes go: each of our fields is matched to the column
 * that now carries it, by name, and from here on rows are scattered into those
 * columns instead of into A onwards. Columns the header has that are none of
 * ours are read past and never touched, and fields the header has no column for
 * are simply not written.
 *
 * Refused when the tab has no header at all (nothing to learn) or when the
 * subject column cannot be found: the append point is located by scanning it,
 * so without it there is no safe place to put a row.
 */
export async function adoptCustomHeader(
  target: WorkbookTarget = 'primary',
): Promise<{ fileName: string; tabs: TabHeaderReport[] }> {
  const cfg = await getConfig()
  const ref = await resolveSheetRef(false, target)
  const sessionId = await openSession(ref)

  try {
    const tabs: TabHeaderReport[] = []
    const existing = await listWorksheetNames(ref, sessionId)

    for (const [name, layout] of [
      [cfg.sheetName,         QUERY_LAYOUT],
      [cfg.excludedSheetName, EXCLUDED_LAYOUT],
    ] as const) {
      try {
        if (!existing.some(w => w.toLowerCase() === name.toLowerCase())) {
          // Not an error: the other-mail tab is only created when the first
          // non-query mail arrives, and there is no header of theirs to keep.
          tabs.push({ tab: name, mapped: [], missing: [], foreign: [], skipped: true, error: 'No such tab yet — nothing to keep' })
          continue
        }

        const cells = await readWideHeader(ref, name, sessionId)

        if (cells.every(cell => cell === '')) {
          // An empty row 1 is not a header the team wrote — Prepare owns that case.
          tabs.push({ tab: name, mapped: [], missing: [], foreign: [], skipped: true, error: 'Row 1 is empty — press Prepare to write the standard header instead' })
          continue
        }

        const match = matchHeader(cells, layout.header)
        if (match.map[layout.keyIndex] < 0) {
          tabs.push({
            tab: name, mapped: [], missing: [...match.missing], foreign: [...match.foreign],
            error: `No "${layout.header[layout.keyIndex]}" column on row 1 — the append point is found by scanning it, so it has to be there`,
          })
          continue
        }

        const adopted: AdoptedHeader = { map: match.map, header: cells, adoptedAt: new Date().toISOString() }
        await saveAdoptedHeader(ref.itemId, name, adopted)
        tabs.push({ tab: name, ...describeMatch(match, layout) })
      } catch (err) {
        tabs.push({
          tab: name, mapped: [], missing: [], foreign: [],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { fileName: ref.fileName, tabs }
  } finally {
    await closeSession(ref, sessionId)
  }
}

function describeMatch(match: HeaderMatch, layout: SheetLayout): Omit<TabHeaderReport, 'tab'> {
  return {
    mapped: layout.header
      .map((cell, i) => ({ cell, column: match.map[i] >= 0 ? columnLetter(match.map[i]) : '' }))
      .filter(entry => entry.column !== ''),
    missing: [...match.missing],
    foreign: [...match.foreign],
  }
}

export interface TabRestoreReport {
  tab:      string
  /** The tab everything was copied to before anything was rewritten. */
  archive:  string
  /** Data rows moved into the standard columns. */
  rows:     number
  /** Columns of the team's whose values now live only on the archive tab. */
  archivedColumns: string[]
  error?:   string
}

/**
 * Put our layout back, without losing a row.
 *
 * The order matters, and it is the whole reason this is one operation rather
 * than "clear the tab and re-sync":
 *
 *   1. The tab is copied, header and all, to an archive tab. Whatever the team
 *      had — their own columns, their notes, values our layout has no field for
 *      — is on that tab afterwards, exactly as it was.
 *   2. Every data row is read and moved into the columns the standard layout
 *      expects, matched by the heading it was sitting under. A row that was
 *      under "Recipients" comes back under "TO List", in column G.
 *   3. Row 1 is rewritten as our header and the mapping is dropped, so writing
 *      goes back to being by position.
 *
 * Rows keep their row numbers and their order throughout, so every row pointer
 * stored per entry still points at the same query and the sweep carries on
 * without re-appending anything.
 */
export async function restoreStandardHeader(
  target: WorkbookTarget = 'primary',
): Promise<{ fileName: string; tabs: TabRestoreReport[] }> {
  const cfg = await getConfig()
  const ref = await resolveSheetRef(false, target)
  const sessionId = await openSession(ref)

  try {
    const tabs: TabRestoreReport[] = []
    for (const [name, layout] of [
      [cfg.sheetName,         QUERY_LAYOUT],
      [cfg.excludedSheetName, EXCLUDED_LAYOUT],
    ] as const) {
      try {
        tabs.push(await restoreOneTab(ref, name, layout, sessionId))
      } catch (err) {
        tabs.push({
          tab: name, archive: '', rows: 0, archivedColumns: [],
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    return { fileName: ref.fileName, tabs }
  } finally {
    await closeSession(ref, sessionId)
  }
}

async function restoreOneTab(
  ref: SheetRef, sheetName: string, layout: SheetLayout, sessionId: string | null,
): Promise<TabRestoreReport> {
  const names = await listWorksheetNames(ref, sessionId)
  if (!names.some(w => w.toLowerCase() === sheetName.toLowerCase())) {
    // The other-mail tab only appears once a non-query mail turns up; a tab that
    // is not there has no rows to keep and nothing to put back.
    return { tab: sheetName, archive: '', rows: 0, archivedColumns: [] }
  }

  const currentHeader = await readWideHeader(ref, sheetName, sessionId)
  const match = matchHeader(currentHeader, layout.header)

  // Already ours and never adopted: there is nothing to move and nothing to
  // archive, and an archive tab per press would be its own kind of mess.
  const adopted = await getAdoptedHeader(ref.itemId, sheetName)
  const alreadyStandard = layout.header.every(
    (name, i) => (currentHeader[i] ?? '').toLowerCase() === name.toLowerCase(),
  )
  if (!adopted && alreadyStandard) {
    return { tab: sheetName, archive: '', rows: 0, archivedColumns: [] }
  }

  // Where the rows are read from: the columns the *current* header puts them in.
  // With no match at all this falls back to reading by position, which is right
  // for a tab whose header was deleted but whose rows are still ours.
  const readLayout = match.map.some(col => col >= 0) ? withColumnMap(layout, match.map) : layout
  const lastDataRow = await findLastDataRow(ref, sheetName, sessionId, readLayout)

  const width = Math.max(
    currentHeader.reduce((w, cell, i) => (cell === '' ? w : i + 1), 0),
    columnIndex(layout.lastColumn) + 1,
  )
  const lastColumn = columnLetter(width - 1)

  // ── 1. Archive: the tab exactly as it stands ──────────────────────────────
  const archive = uniqueTabName(names, sheetName)
  await workbookFetch(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets/add`,
    sessionId,
    { method: 'POST', body: JSON.stringify({ name: archive }) },
  )

  // Copied with their number formats: a date carried over as a bare serial would
  // be a column of five-digit numbers on the archive tab, which is not a copy of
  // anything anybody can read.
  for (let start = 1; start <= Math.max(lastDataRow, 1); start += ARCHIVE_CHUNK) {
    const end   = Math.min(start + ARCHIVE_CHUNK - 1, Math.max(lastDataRow, 1))
    const block = await readRange(ref, sheetName, `A${start}:${lastColumn}${end}`, sessionId, true)
    if (block.values.length === 0) continue
    await workbookFetch(
      `${worksheetPath(ref, archive)}/range(address='${encodeURIComponent(`A${start}:${lastColumn}${end}`)}')`,
      sessionId,
      {
        method: 'PATCH',
        body: JSON.stringify({
          values: block.values,
          ...(block.numberFormat ? { numberFormat: block.numberFormat } : {}),
        }),
      },
    )
  }

  // ── 2. Move every row into the columns our layout expects ─────────────────
  let moved = 0
  if (lastDataRow > 1) {
    for (let start = 2; start <= lastDataRow; start += ARCHIVE_CHUNK) {
      const end  = Math.min(start + ARCHIVE_CHUNK - 1, lastDataRow)
      const rows = await readValuesRange(ref, sheetName, start, end, readLayout, sessionId, ARCHIVE_CHUNK)
      if (rows.length === 0) continue

      const realigned = rows.map(row => row.map(cell => (
        cell === null || cell === undefined || typeof cell === 'boolean' ? '' : cell
      )))
      await writeBlock(ref, sheetName, start, end, realigned, layout, sessionId)
      moved += realigned.length
    }
  }

  // ── 3. Our header back on row 1, and writing by position again ────────────
  const headerAddress = `${layout.firstColumn}1:${layout.lastColumn}1`
  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(headerAddress)}')`,
    sessionId,
    { method: 'PATCH', body: JSON.stringify({ values: [[...layout.header]] }) },
  )
  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(headerAddress)}')/format/font`,
    sessionId,
    { method: 'PATCH', body: JSON.stringify({ bold: true }) },
  ).catch(() => {})

  await clearAdoptedHeader(ref.itemId, sheetName)

  // Headings of theirs that stood inside A–T: those columns now carry our
  // fields, so what was under them survives on the archive tab and nowhere else.
  const ourLast = columnIndex(layout.lastColumn)
  const archivedColumns = currentHeader
    .map((cell, i) => ({ cell, i }))
    .filter(({ cell, i }) => cell !== '' && i <= ourLast && !match.map.includes(i))
    .map(({ cell }) => cell)

  return { tab: sheetName, archive, rows: moved, archivedColumns }
}

/** Rows per Graph call when a whole tab is being copied or moved. */
const ARCHIVE_CHUNK = 200

/**
 * A free name for the archive tab, inside Excel's 31-character limit.
 * `Query Entry Sheet` → `Query Entry Sheet bak 0811-1443`.
 */
function uniqueTabName(existing: string[], sheetName: string): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, '').replace(/(\d{4})(\d{4})/, '$1-$2')
  const suffix = ` bak ${stamp}`
  const base = sheetName.slice(0, 31 - suffix.length) + suffix

  const taken = new Set(existing.map(n => n.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, 31 - String(n).length - 1)} ${n}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  throw new Error('Could not find a free name for the archive tab — delete an old "bak" tab and try again')
}

/**
 * Rewrite a single existing row in place — used when a reply lands after the row
 * was already appended, or when someone corrects an entry in the dashboard.
 */
export async function updateRow(
  rowNumber: number,
  row: SheetRowValues,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string; layout?: SheetLayout } = {},
): Promise<void> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.sheetName
  const layout    = opts.layout ?? await layoutFor(ref, sheetName, QUERY_LAYOUT)
  await writeBlock(ref, sheetName, rowNumber, rowNumber, [rowToCells(row)], layout, opts.sessionId ?? null)
}

/** Rewrite a row on the second tab — the handler list is what usually changes. */
export async function updateExcludedRow(
  rowNumber: number,
  row: ExcludedRowValues,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string; layout?: SheetLayout } = {},
): Promise<void> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.excludedSheetName
  const layout    = opts.layout ?? await layoutFor(ref, sheetName, EXCLUDED_LAYOUT)
  await writeBlock(ref, sheetName, rowNumber, rowNumber, [excludedRowToCells(row)], layout, opts.sessionId ?? null)
}

/**
 * Paint (or strip) the fill across one row of a tab.
 *
 * This is how an answered query turns green in the workbook. Three properties
 * matter and all three come from where the painting stops:
 *
 * - **Only the layout's own columns.** Under a hand-edited header that means the
 *   mapped runs, so a column of the team's sitting between ours keeps whatever
 *   colour they gave it. Nothing right of the layout is ever touched.
 * - **Values are not involved.** This is a `format/fill` call; not one cell's
 *   contents can change through it, whatever else is wrong.
 * - **Cosmetic, so never fatal.** The caller treats a failure as "not coloured
 *   yet" — a row that is on the sheet with the right values but the wrong colour
 *   is a nuisance, a sweep that dies painting it is an outage.
 */
export async function setRowFill(
  ref: SheetRef, sheetName: string, rowNumber: number, layout: SheetLayout,
  color: string | null, sessionId: string | null = null,
): Promise<void> {
  const spans = layout.map
    ? columnRuns(layout.map).map(run => [columnLetter(run.first), columnLetter(run.last)] as const)
    : [[layout.firstColumn, layout.lastColumn] as const]

  for (const [first, last] of spans) {
    const address = `${first}${rowNumber}:${last}${rowNumber}`
    const range = `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`
    await workbookFetch(
      color ? `${range}/format/fill` : `${range}/format/fill/clear`,
      sessionId,
      color
        ? { method: 'PATCH', body: JSON.stringify({ color }) }
        : { method: 'POST',  body: '{}' },
    )
  }
}

/**
 * Remove rows from a tab and close the gap behind them.
 *
 * Only the layout's own columns are shifted up. A whole-row delete would drag
 * the team's lookup lists and pivot helpers — which live to the right of column
 * N and are not aligned to our rows — up with them.
 *
 * Deletion runs bottom-up so that the row numbers still to be deleted keep
 * meaning what they meant when they were collected. Every row below a deleted
 * one moves up by one, so the caller must renumber the row pointers it holds;
 * `remapRowNumber` does that arithmetic.
 */
export async function deleteRowsAt(
  ref: SheetRef, sheetName: string, rowNumbers: number[], layout: SheetLayout,
  sessionId: string | null = null,
): Promise<number> {
  const rows = Array.from(new Set(rowNumbers))
    .filter(r => Number.isInteger(r) && r > 1) // never the header
    .sort((a, b) => b - a)

  // Under a mapping the same rule applies one step further in: only the runs
  // that are ours shift up, so a column of the team's between two of ours keeps
  // its own rows in place.
  const spans = layout.map
    ? columnRuns(layout.map).map(run => [columnLetter(run.first), columnLetter(run.last)] as const)
    : [[layout.firstColumn, layout.lastColumn] as const]

  for (const row of rows) {
    for (const [first, last] of spans) {
      const address = `${first}${row}:${last}${row}`
      await workbookFetch(
        `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')/delete`,
        sessionId,
        { method: 'POST', body: JSON.stringify({ shift: 'Up' }) },
      )
    }
  }
  return rows.length
}

/** Where a row ends up once `deleted` rows above it have been removed. */
export function remapRowNumber(row: number, deleted: number[]): number {
  return row - deleted.filter(d => d < row).length
}

/** Read rows back — powers the "verify what's in the sheet" panel in the UI. */
export async function readRows(
  firstRow: number, lastRow: number,
  opts: { ref?: SheetRef; sheetName?: string; target?: WorkbookTarget } = {},
): Promise<string[][]> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef(false, opts.target ?? 'primary')
  const sheetName = opts.sheetName ?? cfg.sheetName
  const layout    = await layoutFor(ref, sheetName, QUERY_LAYOUT)
  const address   = `${layout.firstColumn}${firstRow}:${layout.lastColumn}${lastRow}`
  const range     = await readRange(ref, sheetName, address)
  const rows      = range.text ?? range.values.map(r => r.map(c => String(c ?? '')))
  return projectRows(rows, layout, '')
}

/**
 * Read a block of rows off any tab, as the text Excel displays.
 *
 * `readRows` above is fixed to the query layout and the configured tab; this one
 * is aimed anywhere, takes a session, and pages the request so a long sheet is
 * not asked for in a single range call. Text — not values — because the
 * duplicate sweep compares what the team sees, and a date read as a serial
 * number would differ between a typed cell and a written one.
 */
export async function readRowsRange(
  ref: SheetRef, sheetName: string, firstRow: number, lastRow: number,
  layout: SheetLayout = QUERY_LAYOUT, sessionId: string | null = null,
  chunkSize = 500,
): Promise<string[][]> {
  const ranges = await readRangeChunks(ref, sheetName, firstRow, lastRow, layout, sessionId, chunkSize)
  const rows = ranges.flatMap(range =>
    range.text ?? range.values.map(r => r.map(c => String(c ?? ''))),
  )
  return projectRows(rows, layout, '')
}

/**
 * Put a physical block back into layout order.
 *
 * Everything that reads the sheet — the append guard, the duplicate sweep, the
 * dashboard preview — indexes rows as "column A is the date, column C the
 * subject". Doing the reordering here is what keeps all of them unaware that
 * the tab underneath might be laid out to somebody else's taste.
 */
function projectRows<T>(rows: T[][], layout: SheetLayout, blank: T): T[][] {
  if (!layout.map) return rows
  const first = columnIndex(layout.firstColumn)
  return rows.map(row => projectRow(row, layout.map!, first, blank))
}

/**
 * The same block as the underlying cell values — dates as Excel serials rather
 * than as the strings they are formatted into.
 *
 * The append guard compares what is on the sheet against what it is about to
 * write, and what it is about to write are serials. Comparing against formatted
 * text would mean re-implementing the workbook's date formats.
 */
export async function readValuesRange(
  ref: SheetRef, sheetName: string, firstRow: number, lastRow: number,
  layout: SheetLayout = QUERY_LAYOUT, sessionId: string | null = null,
  chunkSize = 500,
): Promise<(string | number | boolean | null)[][]> {
  const ranges = await readRangeChunks(ref, sheetName, firstRow, lastRow, layout, sessionId, chunkSize)
  return projectRows(ranges.flatMap(range => range.values), layout, null)
}

/** Page a tall range into requests Graph will answer. */
async function readRangeChunks(
  ref: SheetRef, sheetName: string, firstRow: number, lastRow: number,
  layout: SheetLayout, sessionId: string | null, chunkSize: number,
): Promise<RangeResponse[]> {
  if (lastRow < firstRow) return []

  const out: RangeResponse[] = []
  for (let start = firstRow; start <= lastRow; start += chunkSize) {
    const end     = Math.min(start + chunkSize - 1, lastRow)
    const address = `${layout.firstColumn}${start}:${layout.lastColumn}${end}`
    out.push(await readRange(ref, sheetName, address, sessionId))
  }
  return out
}

/** Names of every tab in the workbook — lets the UI offer a tab picker. */
export async function listWorksheets(
  target: WorkbookTarget = 'primary',
): Promise<{ name: string; visibility: string }[]> {
  const ref = await resolveSheetRef(false, target)
  const res = await graphFetch<{ value: { name: string; visibility: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name,visibility`,
  )
  return res.value ?? []
}
