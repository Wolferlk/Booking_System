/**
 * SharePoint workbook writer for the Query Monitor.
 *
 * Talks to the Excel REST surface of Microsoft Graph (`/workbook/...`) against
 * the live master sheet, so the team sees rows appear without a download/upload
 * cycle and without ever locking the file.
 *
 * Two rules the rest of the code depends on:
 *   1. Writes are confined to the layout's own columns (A–N on the query sheet,
 *      A–J on the other-mail tab). Anything further right belongs to the team's
 *      lookup lists and pivot helpers, and touching it would corrupt the sheet.
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
  SETTINGS, SHEET_COLUMNS, SHEET_FIRST_COLUMN, SHEET_LAST_COLUMN,
  SHEET_NUMBER_FORMATS,
} from './constants'
import { getConfig, getSetting, setSetting } from './config'

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
  lastDataRow:    number
  nextAppendRow:  number
  dataRowCount:   number
  lastModified:   string | null
}

/** A row as it will be laid down in columns A–N. */
export interface SheetRowValues {
  date:           number | ''  // A — Excel date serial
  status:         string       // B
  subject:        string       // C
  allocationTime: number | ''  // D — Excel datetime serial
  repliedTime:    number | ''  // E — Excel datetime serial
  fileHandler:    string       // F — exactly one name, or blank until chosen
  toList:         string       // G — every handler the mail reached
  salesPerson:    string       // H
  destination:    string       // I
  agent:          string       // J
  travelDate:     number | ''  // K — Excel date serial
  cntl:           string       // L
  amendment:      string       // M
  region:         string       // N
}

export function rowToCells(row: SheetRowValues): (string | number)[] {
  return [
    row.date, row.status, row.subject, row.allocationTime, row.repliedTime,
    row.fileHandler, row.toList, row.salesPerson, row.destination, row.agent,
    row.travelDate, row.cntl, row.amendment, row.region,
  ]
}

/** A row on the second tab, columns A–J. See EXCLUDED_SHEET_COLUMNS. */
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
}

export function excludedRowToCells(row: ExcludedRowValues): (string | number)[] {
  return [
    row.date, row.receivedTime, row.subject, row.sender, row.senderEmail,
    row.fileHandler, row.toList, row.reason, row.destination, row.cntl,
  ]
}

/** Where a set of rows is written: which tab, and over which columns. */
export interface SheetLayout {
  firstColumn:   string
  lastColumn:    string
  /** Column scanned bottom-up to find the append point — must always be filled. */
  keyColumn:     string
  header:        readonly string[]
  numberFormats: readonly string[]
}

export const QUERY_LAYOUT: SheetLayout = {
  firstColumn:   SHEET_FIRST_COLUMN,
  lastColumn:    SHEET_LAST_COLUMN,
  keyColumn:     'C', // Subject
  header:        SHEET_COLUMNS,
  numberFormats: SHEET_NUMBER_FORMATS,
}

export const EXCLUDED_LAYOUT: SheetLayout = {
  firstColumn:   EXCLUDED_SHEET_FIRST_COLUMN,
  lastColumn:    EXCLUDED_SHEET_LAST_COLUMN,
  keyColumn:     'C', // Subject
  header:        EXCLUDED_SHEET_COLUMNS,
  numberFormats: EXCLUDED_SHEET_NUMBER_FORMATS,
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
  address:     string
  rowCount:    number
  columnCount: number
  values:      (string | number | boolean | null)[][]
  text?:       string[][]
}

async function readRange(
  ref: SheetRef, sheetName: string, address: string, sessionId: string | null = null,
): Promise<RangeResponse> {
  return workbookFetch<RangeResponse>(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')?$select=address,rowCount,columnCount,values,text`,
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

  const header = await readRange(ref, sheetName, `A1:${SHEET_LAST_COLUMN}1`)
  const headerCells = (header.text?.[0] ?? header.values[0]?.map(v => String(v ?? '')) ?? [])
    .map(h => String(h ?? '').trim())

  const headerMatches = SHEET_COLUMNS.every(
    (expected, i) => (headerCells[i] ?? '').toLowerCase() === expected.toLowerCase(),
  )

  const lastDataRow = await findLastDataRow(ref, sheetName)

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
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string } = {},
): Promise<AppendResult> {
  const cfg = await getConfig()
  return appendCells(rows.map(rowToCells), QUERY_LAYOUT, {
    ...opts,
    sheetName: opts.sheetName ?? cfg.sheetName,
  })
}

/** The excluded-mail equivalent, against the second tab's A–I layout. */
export async function appendExcludedRows(
  rows: ExcludedRowValues[],
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string } = {},
): Promise<AppendResult> {
  const cfg = await getConfig()
  return appendCells(rows.map(excludedRowToCells), EXCLUDED_LAYOUT, {
    ...opts,
    sheetName: opts.sheetName ?? cfg.excludedSheetName,
  })
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
  const address     = `${layout.firstColumn}${firstRow}:${layout.lastColumn}${lastRow}`

  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
    sessionId,
    {
      method: 'PATCH',
      body: JSON.stringify({
        values:       rows,
        numberFormat: rows.map(() => [...layout.numberFormats]),
      }),
    },
  )

  return { firstRow, lastRow, rows: rows.length }
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

  const headerAddress = `${layout.firstColumn}1:${layout.lastColumn}1`
  const header  = await readRange(ref, sheetName, headerAddress, sessionId)
  const cells   = (header.text?.[0] ?? header.values[0]?.map(v => String(v ?? '')) ?? [])
    .map(h => String(h ?? '').trim())

  const isEmpty  = cells.every(cell => cell === '')
  const matches  = layout.header.every((expected, i) => (cells[i] ?? '').toLowerCase() === expected.toLowerCase())

  if (matches) return { created: !exists, headerWritten: false, headerMismatch: false }

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

/**
 * Rewrite a single existing row in place — used when a reply lands after the row
 * was already appended, or when someone corrects an entry in the dashboard.
 */
export async function updateRow(
  rowNumber: number,
  row: SheetRowValues,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string } = {},
): Promise<void> {
  const cfg = await getConfig()
  await updateCells(rowNumber, rowToCells(row), QUERY_LAYOUT, {
    ...opts, sheetName: opts.sheetName ?? cfg.sheetName,
  })
}

/** Rewrite a row on the second tab — the handler list is what usually changes. */
export async function updateExcludedRow(
  rowNumber: number,
  row: ExcludedRowValues,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName?: string } = {},
): Promise<void> {
  const cfg = await getConfig()
  await updateCells(rowNumber, excludedRowToCells(row), EXCLUDED_LAYOUT, {
    ...opts, sheetName: opts.sheetName ?? cfg.excludedSheetName,
  })
}

async function updateCells(
  rowNumber: number,
  cells: (string | number)[],
  layout: SheetLayout,
  opts: { sessionId?: string | null; ref?: SheetRef; sheetName: string },
): Promise<void> {
  const ref     = opts.ref ?? await resolveSheetRef()
  const address = `${layout.firstColumn}${rowNumber}:${layout.lastColumn}${rowNumber}`

  await workbookFetch(
    `${worksheetPath(ref, opts.sheetName)}/range(address='${encodeURIComponent(address)}')`,
    opts.sessionId ?? null,
    {
      method: 'PATCH',
      body: JSON.stringify({
        values:       [cells],
        numberFormat: [[...layout.numberFormats]],
      }),
    },
  )
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

  for (const row of rows) {
    const address = `${layout.firstColumn}${row}:${layout.lastColumn}${row}`
    await workbookFetch(
      `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')/delete`,
      sessionId,
      { method: 'POST', body: JSON.stringify({ shift: 'Up' }) },
    )
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
  const address   = `${SHEET_FIRST_COLUMN}${firstRow}:${SHEET_LAST_COLUMN}${lastRow}`
  const range     = await readRange(ref, sheetName, address)
  return range.text ?? range.values.map(r => r.map(c => String(c ?? '')))
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
  return ranges.flatMap(range =>
    range.text ?? range.values.map(r => r.map(c => String(c ?? ''))),
  )
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
  return ranges.flatMap(range => range.values)
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
