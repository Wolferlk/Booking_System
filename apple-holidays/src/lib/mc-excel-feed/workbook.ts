/**
 * MC Excel Feed — the workbook, over the Excel REST surface of Microsoft Graph.
 *
 * Same app login and approach as the Query Monitor's live workbook: values are
 * written into the open file (no download / upload round trip), so the desk can
 * keep typing in Excel Online while OPS writes, and a persistent workbook
 * session batches our writes into one save.
 *
 * What this module will do to a workbook, and nothing else:
 *   - write values into the ranges the planner hands it (OPS columns only);
 *   - insert whole empty rows (shift down) where a new movement belongs;
 *   - set font colour / clear fill on rows it inserted or flagged;
 *   - add the feed tab and its header when the tab is missing or row 1 empty;
 *   - replace the file with the dropdown-ready layout ONLY when every tab of
 *     the workbook is empty (checked immediately before, guarded by eTag).
 * It never deletes a row, a cell or a tab.
 */
import { getGraphToken, graphFetch } from '@/lib/graph-client'
import { cacheSheetRef, getCachedSheetRef, protectedWorkbookIds, type CachedSheetRef } from './config'
import { colLetter, LAYOUT_NAME, PALETTE, STAMP_NAME, type ColumnSource, type FeedCellValue } from './shared'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const RETRYABLE = new Set([429, 503, 509])

export class WorkbookError extends Error {
  constructor(message: string, readonly code: 'LINK' | 'PROTECTED' | 'GRAPH' | 'NOT_EMPTY' | 'CONFLICT') { super(message) }
}

function shareToken(url: string): string {
  return 'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

/**
 * One Graph call that tolerates an empty answer (204 from clear / freeze).
 * Retries only "not done, try again" answers, like graph-client — never a 5xx
 * that may have been applied.
 */
async function call<T>(path: string, init: RequestInit & { session?: string | null } = {}): Promise<T> {
  const { session, ...opts } = init
  let last: Error | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await getGraphToken()
    const res = await fetch(`${GRAPH}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(session ? { 'workbook-session-id': session } : {}),
        ...(opts.headers ?? {}),
      },
    })
    const text = await res.text()
    if (res.ok) {
      if (!text) return {} as T
      try { return JSON.parse(text) as T } catch { return {} as T }
    }
    last = new WorkbookError(`Graph ${res.status}: ${text.slice(0, 300)}`, 'GRAPH')
    if (!RETRYABLE.has(res.status) || attempt === 3) throw last
    const after = Number(res.headers.get('retry-after'))
    await new Promise(r => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 20_000) : 1000 * 2 ** attempt))
  }
  throw last ?? new WorkbookError('Graph call failed', 'GRAPH')
}

// ── The file ─────────────────────────────────────────────────────────────────

export interface FeedSheetRef extends CachedSheetRef { eTag: string | null; lastModified: string | null; size: number | null }

export async function resolveFeedWorkbook(url: string): Promise<FeedSheetRef> {
  if (!url) throw new WorkbookError('No workbook link is set', 'LINK')
  type Item = { id: string; name: string; webUrl: string; eTag?: string; lastModifiedDateTime?: string; size?: number; file?: unknown; parentReference?: { driveId?: string } }
  const select = '$select=id,name,webUrl,eTag,lastModifiedDateTime,size,file,parentReference'
  let item: Item
  const cached = await getCachedSheetRef(url)
  try {
    item = cached
      ? await graphFetch<Item>(`/drives/${cached.driveId}/items/${cached.itemId}?${select}`)
      : await graphFetch<Item>(`/shares/${shareToken(url)}/driveItem?${select}`)
    if (cached) item.parentReference = { driveId: cached.driveId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new WorkbookError(`Microsoft Graph could not open the link (${msg.slice(0, 180)}). Use a share link to the Excel file itself, inside the aahaas.com tenant.`, 'LINK')
  }
  const driveId = item.parentReference?.driveId
  if (!driveId || !item.file) throw new WorkbookError('The link points to a folder, not an Excel file', 'LINK')
  if (!/\.xlsx$/i.test(item.name)) throw new WorkbookError(`"${item.name}" is not an .xlsx workbook`, 'LINK')
  const blocked = (await protectedWorkbookIds()).get(item.id)
  if (blocked) throw new WorkbookError(`This link is ${blocked} — OPS only reads that file and will not write into it. Use a separate workbook for the feed.`, 'PROTECTED')
  const ref = { driveId, itemId: item.id, fileName: item.name, webUrl: item.webUrl, forUrl: url }
  if (!cached) await cacheSheetRef(ref)
  return { ...ref, eTag: item.eTag ?? null, lastModified: item.lastModifiedDateTime ?? null, size: item.size ?? null }
}

const wb = (ref: CachedSheetRef) => `/drives/${ref.driveId}/items/${ref.itemId}/workbook`
const ws = (ref: CachedSheetRef, tab: string) => `${wb(ref)}/worksheets('${encodeURIComponent(tab.replace(/'/g, "''"))}')`
const rng = (ref: CachedSheetRef, tab: string, address: string) => `${ws(ref, tab)}/range(address='${encodeURIComponent(address)}')`

export async function openSession(ref: CachedSheetRef): Promise<string | null> {
  try {
    const r = await call<{ id?: string }>(`${wb(ref)}/createSession`, { method: 'POST', body: JSON.stringify({ persistChanges: true }) })
    return r.id ?? null
  } catch { return null }
}

export async function closeSession(ref: CachedSheetRef, session: string | null): Promise<void> {
  if (!session) return
  await call(`${wb(ref)}/closeSession`, { method: 'POST', session }).catch(() => undefined)
}

export async function listTabs(ref: CachedSheetRef, session: string | null = null): Promise<string[]> {
  const r = await call<{ value?: { name: string }[] }>(`${wb(ref)}/worksheets?$select=name`, { session })
  return (r.value ?? []).map(w => w.name)
}

/** Bottom-right of the used range (values only) — 0/0 for an empty tab. */
export async function usedExtent(ref: CachedSheetRef, tab: string, session: string | null = null): Promise<{ rows: number; cols: number }> {
  const r = await call<{ address?: string; values?: unknown[][] }>(`${ws(ref, tab)}/usedRange(valuesOnly=true)?$select=address,values`, { session })
  const end = String(r.address ?? '').split('!').pop()?.split(':').pop() ?? ''
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(end)
  if (!m) return { rows: 0, cols: 0 }
  // An empty tab reports A1 with an empty value.
  if (!r.address?.includes(':') && (r.values?.[0]?.[0] ?? '') === '') return { rows: 0, cols: 0 }
  const cols = m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
  return { rows: Number(m[2]), cols }
}

/** Every value from A1 to the used range's bottom-right, read in slices. */
export async function readGrid(ref: CachedSheetRef, tab: string, session: string | null = null): Promise<unknown[][]> {
  const { rows, cols } = await usedExtent(ref, tab, session)
  if (!rows) return []
  const last = colLetter(Math.max(cols, 1) - 1)
  const out: unknown[][] = []
  for (let r = 1; r <= rows; r += 1500) {
    const end = Math.min(rows, r + 1499)
    const part = await call<{ values?: unknown[][] }>(`${rng(ref, tab, `A${r}:${last}${end}`)}?$select=values`, { session })
    out.push(...(part.values ?? []))
  }
  return out
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Write a block. Split by rows so no request nears Graph's 4 MB body limit. */
export async function writeBlock(
  ref: CachedSheetRef, tab: string, firstRow: number, firstCol: number, lastCol: number,
  values: FeedCellValue[][], formats: string[][], session: string | null,
): Promise<number> {
  let calls = 0
  let i = 0
  while (i < values.length) {
    let size = 0
    let j = i
    while (j < values.length && j - i < 250 && size < 2_500_000) { size += JSON.stringify(values[j]).length; j++ }
    const top = firstRow + i
    const address = `${colLetter(firstCol)}${top}:${colLetter(lastCol)}${top + (j - i) - 1}`
    await call(rng(ref, tab, address), {
      method: 'PATCH', session,
      body: JSON.stringify({ values: values.slice(i, j), numberFormat: formats.slice(i, j) }),
    })
    calls++
    i = j
  }
  return calls
}

/** Insert `count` whole empty rows so the first new row is `atRow` (rows below shift down). */
export async function insertRows(ref: CachedSheetRef, tab: string, atRow: number, count: number, session: string | null): Promise<void> {
  await call(`${rng(ref, tab, `${atRow}:${atRow + count - 1}`)}/insert`, { method: 'POST', session, body: JSON.stringify({ shift: 'Down' }) })
}

/** An inserted row copies the format of the row above it (the header, or a greyed row) — return it to plain. */
export async function plainRows(ref: CachedSheetRef, tab: string, firstRow: number, lastRow: number, lastCol: number, session: string | null): Promise<void> {
  const address = `A${firstRow}:${colLetter(lastCol)}${lastRow}`
  await call(`${rng(ref, tab, address)}/format/fill/clear`, { method: 'POST', session }).catch(() => undefined)
  await call(`${rng(ref, tab, address)}/format/font`, { method: 'PATCH', session, body: JSON.stringify({ bold: false, italic: false, color: '#000000' }) }).catch(() => undefined)
}

/** Drop every cell format on rows OPS just inserted under the header (they copied the header's style). */
export async function clearRowFormats(ref: CachedSheetRef, tab: string, firstRow: number, lastRow: number, lastCol: number, session: string | null): Promise<void> {
  await call(`${rng(ref, tab, `A${firstRow}:${colLetter(lastCol)}${lastRow}`)}/clear`, { method: 'POST', session, body: JSON.stringify({ applyTo: 'Formats' }) }).catch(() => undefined)
}

/** Grey (inactive) or back to normal. Cosmetic — a failure never fails the sync. */
export async function greyRows(ref: CachedSheetRef, tab: string, rows: number[], lastCol: number, on: boolean, session: string | null): Promise<void> {
  const sorted = Array.from(new Set(rows)).sort((a, b) => a - b)
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    const address = `A${sorted[i]}:${colLetter(lastCol)}${sorted[j]}`
    await call(`${rng(ref, tab, address)}/format/font`, {
      method: 'PATCH', session, body: JSON.stringify({ color: on ? '#9CA3AF' : '#000000', italic: on }),
    }).catch(() => undefined)
    i = j + 1
  }
}

export async function addTab(ref: CachedSheetRef, tab: string, session: string | null): Promise<void> {
  await call(`${wb(ref)}/worksheets/add`, { method: 'POST', session, body: JSON.stringify({ name: tab }) })
}

/** Header cells coloured by owner — OPS teal, desk amber, both-ways violet — so ownership is visible on the sheet itself. */
export async function writeHeader(
  ref: CachedSheetRef, tab: string, row: number, firstCol: number,
  cells: { header: string; source: ColumnSource }[], session: string | null,
): Promise<void> {
  if (!cells.length) return
  const address = `${colLetter(firstCol)}${row}:${colLetter(firstCol + cells.length - 1)}${row}`
  await call(rng(ref, tab, address), { method: 'PATCH', session, body: JSON.stringify({ values: [cells.map(c => c.header)] }) })
  await call(`${rng(ref, tab, address)}/format`, { method: 'PATCH', session, body: JSON.stringify({ horizontalAlignment: 'Center', verticalAlignment: 'Center', wrapText: true, rowHeight: 32 }) }).catch(() => undefined)
  for (let i = 0; i < cells.length; i++) {
    const a = `${colLetter(firstCol + i)}${row}`
    const s = cells[i].source
    const fill = s === 'ops' ? PALETTE.ops : s === 'both' ? PALETTE.both : PALETTE.desk
    await call(`${rng(ref, tab, a)}/format/fill`, { method: 'PATCH', session, body: JSON.stringify({ color: fill }) }).catch(() => undefined)
    await call(`${rng(ref, tab, a)}/format/font`, { method: 'PATCH', session, body: JSON.stringify({ bold: true, color: s === 'desk' ? PALETTE.deskText : '#FFFFFF' }) }).catch(() => undefined)
  }
}

// ── The OPS layout ───────────────────────────────────────────────────────────

/** True when the workbook carries the OPS layout (it then colours bookings itself, by conditional formatting). */
export async function hasLayout(ref: CachedSheetRef, session: string | null): Promise<boolean> {
  const r = await call<{ value?: { name: string }[] }>(`${wb(ref)}/names?$select=name`, { session }).catch(() => ({ value: [] }))
  return (r.value ?? []).some(n => n.name === LAYOUT_NAME)
}

/** Write the banner's "last synced" line. Cosmetic: any failure is ignored. */
export async function writeStamp(ref: CachedSheetRef, text: string, session: string | null): Promise<void> {
  try {
    const r = await call<{ address?: string }>(`${wb(ref)}/names('${STAMP_NAME}')/range?$select=address`, { session })
    const [sheet, cell] = String(r.address ?? '').replace(/\$/g, '').split('!')
    if (!sheet || !cell) return
    const tab = sheet.replace(/^'|'$/g, '').replace(/''/g, "'")
    await call(rng(ref, tab, cell.split(':')[0]), { method: 'PATCH', session, body: JSON.stringify({ values: [[text]] }) })
  } catch { /* no stamp cell — not the OPS layout */ }
}

/** Read one column's values for rows first…last. */
export async function readColumn(ref: CachedSheetRef, tab: string, col: number, first: number, last: number, session: string | null): Promise<unknown[]> {
  const out: unknown[] = []
  for (let r = first; r <= last; r += 3000) {
    const end = Math.min(last, r + 2999)
    const part = await call<{ values?: unknown[][] }>(`${rng(ref, tab, `${colLetter(col)}${r}:${colLetter(col)}${end}`)}?$select=values`, { session })
    out.push(...(part.values ?? []).map(v => v[0]))
  }
  return out
}

/**
 * Fill rows first…last (columns A…lastCol) with one colour. A direct call, not
 * a Graph $batch: batched fills came back "200" per request on the live
 * workbook and still left it white (2026-11-27), so painting goes through the
 * same path as the value writes and is checked afterwards with readFill.
 * Cosmetic: false on failure, never throws.
 */
export async function fillRows(
  ref: CachedSheetRef, tab: string, first: number, last: number, lastCol: number, color: string, session: string | null,
): Promise<boolean> {
  try {
    await call(`${rng(ref, tab, `A${first}:${colLetter(lastCol)}${last}`)}/format/fill`, { method: 'PATCH', session, body: JSON.stringify({ color }) })
    return true
  } catch { return false }
}

/** The fill colour Excel reports for one cell, upper-case "#RRGGBB" ("#FFFFFF" when unfilled), or null when it can't be read. */
export async function readFill(ref: CachedSheetRef, tab: string, cell: string, session: string | null): Promise<string | null> {
  try {
    const r = await call<{ color?: string | null }>(`${rng(ref, tab, cell)}/format/fill`, { session })
    const c = String(r.color ?? '').trim().toUpperCase()
    return /^#[0-9A-F]{6}$/.test(c) ? c : '#FFFFFF'
  } catch { return null }
}

export async function freezeHeader(ref: CachedSheetRef, tab: string, rows: number, session: string | null): Promise<void> {
  await call(`${ws(ref, tab)}/freezePanes/freezeRows`, { method: 'POST', session, body: JSON.stringify({ count: rows }) }).catch(() => undefined)
}

export async function setColumnWidths(ref: CachedSheetRef, tab: string, widths: number[], session: string | null): Promise<void> {
  // Graph widths are points; one Excel character ≈ 7 points.
  for (let i = 0; i < widths.length; i++) {
    await call(`${rng(ref, tab, `${colLetter(i)}:${colLetter(i)}`)}/format`, { method: 'PATCH', session, body: JSON.stringify({ columnWidth: widths[i] * 7 }) }).catch(() => undefined)
  }
}

/** True when no tab of the workbook holds a single value. */
export async function workbookIsEmpty(ref: CachedSheetRef): Promise<{ empty: boolean; tabs: { name: string; rows: number }[] }> {
  const tabs = await listTabs(ref)
  const out: { name: string; rows: number }[] = []
  for (const name of tabs) out.push({ name, rows: (await usedExtent(ref, name)).rows })
  return { empty: out.every(t => t.rows === 0), tabs: out }
}

/**
 * Replace the file's content — only ever called for a workbook just checked to
 * be empty, and with the eTag read then, so a file edited in between is refused
 * (412) rather than overwritten. SharePoint keeps the previous version.
 */
export async function uploadWorkbook(ref: CachedSheetRef, buf: Buffer, eTag: string | null): Promise<void> {
  const token = await getGraphToken()
  const res = await fetch(`${GRAPH}/drives/${ref.driveId}/items/${ref.itemId}/content`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(eTag ? { 'If-Match': eTag } : {}),
    },
    body: new Uint8Array(buf),
  })
  if (res.status === 412) throw new WorkbookError('The workbook changed while it was being set up — nothing was replaced. Check it is still empty and try again.', 'CONFLICT')
  if (res.status === 423) throw new WorkbookError('The workbook is locked (open for editing in the desktop app?) — close it and try again.', 'CONFLICT')
  if (!res.ok) throw new WorkbookError(`Upload refused: Graph ${res.status} ${(await res.text()).slice(0, 200)}`, 'GRAPH')
}
