/**
 * SharePoint workbook writer for the Query Monitor.
 *
 * Talks to the Excel REST surface of Microsoft Graph (`/workbook/...`) against
 * the live master sheet, so the team sees rows appear without a download/upload
 * cycle and without ever locking the file.
 *
 * Two rules the rest of the code depends on:
 *   1. Writes are confined to columns A–M. Column N onwards holds the team's
 *      lookup lists and pivot helpers — touching them would corrupt the sheet.
 *   2. The append row is found by scanning column C (Subject) from the bottom,
 *      not from `usedRange`: the used range extends past the real data because
 *      of trailing formatted-but-empty rows.
 */
import { graphFetch, getGraphToken } from '@/lib/graph-client'
import {
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

/** A row as it will be laid down in columns A–M. */
export interface SheetRowValues {
  date:           number | ''  // A — Excel date serial
  status:         string       // B
  subject:        string       // C
  allocationTime: number | ''  // D — Excel datetime serial
  repliedTime:    number | ''  // E — Excel datetime serial
  fileHandler:    string       // F
  salesPerson:    string       // G
  destination:    string       // H
  agent:          string       // I
  travelDate:     number | ''  // J — Excel date serial
  cntl:           string       // K
  amendment:      string       // L
  region:         string       // M
}

export function rowToCells(row: SheetRowValues): (string | number)[] {
  return [
    row.date, row.status, row.subject, row.allocationTime, row.repliedTime,
    row.fileHandler, row.salesPerson, row.destination, row.agent,
    row.travelDate, row.cntl, row.amendment, row.region,
  ]
}

// ── Share-URL resolution ─────────────────────────────────────────────────────

/** Graph's sharing token: unpadded base64url of the share URL, prefixed `u!`. */
export function encodeShareUrl(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * Resolve the configured share URL to a drive/item pair, caching the result —
 * the lookup costs a round-trip and the IDs are stable for the life of the file.
 */
export async function resolveSheetRef(force = false): Promise<SheetRef> {
  if (!force) {
    const cached = await getSetting(SETTINGS.sheetRef)
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as SheetRef
        if (parsed.driveId && parsed.itemId) return parsed
      } catch { /* fall through and re-resolve */ }
    }
  }

  const { sheetUrl } = await getConfig()
  if (!sheetUrl) throw new Error('No workbook URL configured — set it in Query Monitor → Configuration')

  const item = await graphFetch<{
    id: string; name: string; webUrl: string
    parentReference?: { driveId?: string }
  }>(`/shares/${encodeShareUrl(sheetUrl)}/driveItem?$select=id,name,webUrl,parentReference`)

  const driveId = item.parentReference?.driveId
  if (!driveId) throw new Error('Graph returned the workbook without a driveId — is the link a file share?')

  const ref: SheetRef = { driveId, itemId: item.id, fileName: item.name, webUrl: item.webUrl }
  await setSetting(SETTINGS.sheetRef, JSON.stringify(ref))
  return ref
}

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
): Promise<number> {
  const used = await workbookFetch<{ address: string; rowCount: number }>(
    `${worksheetPath(ref, sheetName)}/range(address='${SHEET_FIRST_COLUMN}:${SHEET_LAST_COLUMN}')/usedRange(valuesOnly=true)?$select=address,rowCount`,
    sessionId,
  )

  const upperBound = Math.max(used.rowCount, 2)
  const column = await readRange(ref, sheetName, `C1:C${upperBound}`, sessionId)

  let last = 1 // header row
  column.values.forEach((cell, i) => {
    if (String(cell?.[0] ?? '').trim() !== '') last = i + 1
  })
  return last
}

export async function getSheetInfo(force = false): Promise<SheetInfo> {
  const { sheetName } = await getConfig()
  const ref = await resolveSheetRef(force)

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
  if (rows.length === 0) return { firstRow: 0, lastRow: 0, rows: 0 }

  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.sheetName
  const sessionId = opts.sessionId ?? null

  const lastDataRow = await findLastDataRow(ref, sheetName, sessionId)
  const firstRow    = lastDataRow + 1
  const lastRow     = lastDataRow + rows.length
  const address     = `${SHEET_FIRST_COLUMN}${firstRow}:${SHEET_LAST_COLUMN}${lastRow}`

  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
    sessionId,
    {
      method: 'PATCH',
      body: JSON.stringify({
        values:       rows.map(rowToCells),
        numberFormat: rows.map(() => [...SHEET_NUMBER_FORMATS]),
      }),
    },
  )

  return { firstRow, lastRow, rows: rows.length }
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
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.sheetName
  const address   = `${SHEET_FIRST_COLUMN}${rowNumber}:${SHEET_LAST_COLUMN}${rowNumber}`

  await workbookFetch(
    `${worksheetPath(ref, sheetName)}/range(address='${encodeURIComponent(address)}')`,
    opts.sessionId ?? null,
    {
      method: 'PATCH',
      body: JSON.stringify({
        values:       [rowToCells(row)],
        numberFormat: [[...SHEET_NUMBER_FORMATS]],
      }),
    },
  )
}

/** Read rows back — powers the "verify what's in the sheet" panel in the UI. */
export async function readRows(
  firstRow: number, lastRow: number,
  opts: { ref?: SheetRef; sheetName?: string } = {},
): Promise<string[][]> {
  const cfg       = await getConfig()
  const ref       = opts.ref ?? await resolveSheetRef()
  const sheetName = opts.sheetName ?? cfg.sheetName
  const address   = `${SHEET_FIRST_COLUMN}${firstRow}:${SHEET_LAST_COLUMN}${lastRow}`
  const range     = await readRange(ref, sheetName, address)
  return range.text ?? range.values.map(r => r.map(c => String(c ?? '')))
}

/** Names of every tab in the workbook — lets the UI offer a tab picker. */
export async function listWorksheets(): Promise<{ name: string; visibility: string }[]> {
  const ref = await resolveSheetRef()
  const res = await graphFetch<{ value: { name: string; visibility: string }[] }>(
    `/drives/${ref.driveId}/items/${ref.itemId}/workbook/worksheets?$select=name,visibility`,
  )
  return res.value ?? []
}
