/**
 * Query Monitor — living with a header the team edited by hand.
 *
 * The writer puts a row down by *position*: column A is the date, column D the
 * allocation time, and so on to column T. That is only true while row 1 says
 * what this system expects it to say. When somebody renames "TO List" to
 * "Recipients", drops a column they never used or slides a column of their own
 * in at C, every later write lands one column out — which is why a mismatched
 * header stops the sweep dead rather than writing through it.
 *
 * Stopping is safe but it is not an answer, so there are two ways out and this
 * file backs both:
 *
 *   • **Adopt** — keep the header exactly as the team left it and learn where
 *     each of our fields now lives. Nothing on the sheet is touched; from then
 *     on writes are scattered into the columns the mapping names, and any
 *     column of theirs in between is never written to.
 *
 *   • **Restore** — put our layout back, having first copied the whole tab to
 *     an archive tab so nothing that was there is lost, then move every row's
 *     values into the columns the standard layout expects. Rows keep their row
 *     numbers, so the row pointers held per entry stay true and the sweep
 *     carries on where it left off.
 *
 * A mapping is stored with the header it was read from. If row 1 changes again
 * afterwards the mapping is stale — it describes a sheet that no longer exists —
 * and writing under it would be exactly the corruption this file prevents. So
 * the stored header is compared before every use.
 */
import { getSetting, setSetting } from './config'
import { SETTINGS } from './constants'

/** What a tab's row 1 was, and where each of our fields sits on it. */
export interface AdoptedHeader {
  /** Physical 0-based column per layout field, in layout order. -1 = nowhere. */
  map:       number[]
  /** Row 1 as it stood when this was adopted — the mapping is only valid for it. */
  header:    string[]
  adoptedAt: string
}

/** Keyed by `${itemId}::${tab}` so the two workbooks never share a mapping. */
type ColumnMapStore = Record<string, AdoptedHeader>

export const mapKey = (itemId: string, sheetName: string) => `${itemId}::${sheetName.toLowerCase()}`

// ── Storage ──────────────────────────────────────────────────────────────────

async function readStore(): Promise<ColumnMapStore> {
  const raw = await getSetting(SETTINGS.columnMap)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as ColumnMapStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export async function getAdoptedHeader(itemId: string, sheetName: string): Promise<AdoptedHeader | null> {
  const store = await readStore()
  const entry = store[mapKey(itemId, sheetName)]
  return entry && Array.isArray(entry.map) ? entry : null
}

export async function saveAdoptedHeader(
  itemId: string, sheetName: string, adopted: AdoptedHeader,
): Promise<void> {
  const store = await readStore()
  store[mapKey(itemId, sheetName)] = adopted
  await setSetting(SETTINGS.columnMap, JSON.stringify(store))
}

/** Back to writing by position — used once a tab has been restored. */
export async function clearAdoptedHeader(itemId: string, sheetName: string): Promise<boolean> {
  const store = await readStore()
  const key = mapKey(itemId, sheetName)
  if (!(key in store)) return false
  delete store[key]
  await setSetting(SETTINGS.columnMap, JSON.stringify(store))
  return true
}

/** Whether row 1 still says what it said when the mapping was taken. */
export function adoptionStillFits(adopted: AdoptedHeader, cells: string[]): boolean {
  const width = Math.max(adopted.header.length, adopted.map.reduce((m, c) => Math.max(m, c + 1), 0))
  for (let i = 0; i < width; i += 1) {
    if (norm(adopted.header[i] ?? '') !== norm(cells[i] ?? '')) return false
  }
  return true
}

// ── Matching a hand-edited header to our fields ──────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Names the team has actually used for our columns, and near-misses worth
 * accepting. Keyed by the normalised layout column name.
 *
 * Only unambiguous synonyms belong here. Anything that could be two of our
 * columns at once ("time", "date") is left out: an unmatched column is a column
 * we do not write, which is recoverable, while a wrongly matched one quietly
 * files values under the wrong heading.
 */
const ALIASES: Record<string, string[]> = {
  'date':             ['received date', 'mail date', 'query date', 'date received'],
  'status':           ['reply status', 'query status'],
  'subject':          ['mail subject', 'email subject', 'query'],
  'allocation time':  ['allocated time', 'allocation', 'allocation date time', 'received time'],
  'replied time':     ['reply time', 'responded time', 'answered time'],
  'file handler':     ['handler', 'owner', 'assigned to', 'file handler name'],
  'to list':          ['to', 'to all', 'recipients', 'recipient list', 'mailed to'],
  'sales person':     ['salesperson', 'sales', 'sales exec', 'sales executive'],
  'destination':      ['country', 'destination country'],
  'agent':            ['agent name', 'b2b agent'],
  'travel date':      ['travelling date', 'traveling date', 'travel dt', 'tour date'],
  'cntl':             ['control', 'control no', 'cntl no'],
  'amendment':        ['amendments', 'amendment type'],
  'region':           ['area', 'market'],
  'replied by':       ['reply by', 'answered by', 'responded by'],
  'response hrs':     ['response hours', 'response time hrs', 'response time', 'turnaround hrs'],
  'sla':              ['sla status', 'sla met'],
  'mails in thread':  ['thread count', 'mails', 'no of mails', 'number of mails'],
  'last mail':        ['last mail time', 'latest mail', 'last mail at'],
  'ai summary':       ['summary', 'ai note', 'ai remarks'],
  'sender':           ['from', 'sender name'],
  'sender email':     ['from email', 'sender address', 'email'],
  'reason':           ['exclusion reason', 'why excluded', 'excluded reason'],
}

/** Every spelling that counts as this layout column. */
function spellings(columnName: string): string[] {
  const canonical = norm(columnName)
  return [canonical, ...(ALIASES[canonical] ?? [])]
}

export interface HeaderMatch {
  /** Physical 0-based column per layout field, in layout order. -1 = not found. */
  map:      number[]
  /** Layout columns row 1 has no home for — never written under this mapping. */
  missing:  string[]
  /** Headings on row 1 that are none of ours — left exactly as they are. */
  foreign:  string[]
  /** True when the mapping is just A, B, C… i.e. our own layout after all. */
  identity: boolean
}

/**
 * Work out where each of our fields lives on a header somebody else laid out.
 *
 * Exact (normalised) names are matched first across the whole row, and only
 * then the aliases — otherwise a sheet carrying both "Received time" and
 * "Allocation time" could have the alias claim the column the real name wanted.
 * A physical column is claimed once; the leftmost unclaimed match wins.
 */
export function matchHeader(cells: string[], columns: readonly string[]): HeaderMatch {
  const normalized = cells.map(c => norm(String(c ?? '')))
  const taken  = new Set<number>()
  const map    = columns.map(() => -1)

  const claim = (field: number, names: string[]) => {
    if (map[field] !== -1) return
    for (let col = 0; col < normalized.length; col += 1) {
      if (normalized[col] === '' || taken.has(col)) continue
      if (names.includes(normalized[col])) { map[field] = col; taken.add(col); return }
    }
  }

  columns.forEach((name, i) => claim(i, [norm(name)]))
  columns.forEach((name, i) => claim(i, spellings(name)))

  const missing = columns.filter((_, i) => map[i] === -1)
  const foreign = cells.filter((cell, col) => String(cell ?? '').trim() !== '' && !taken.has(col))
    .map(c => String(c).trim())

  return {
    map, missing, foreign,
    identity: map.every((col, i) => col === i),
  }
}

// ── Writing through a mapping ────────────────────────────────────────────────

/** A stretch of neighbouring columns that can go out in one range call. */
export interface ColumnRun {
  /** Physical 0-based column the run starts at. */
  first:  number
  /** Physical 0-based column it ends at. */
  last:   number
  /** Layout field index per column of the run, left to right. */
  fields: number[]
}

/**
 * Split a mapping into the fewest ranges that touch none of the team's columns.
 *
 * Our fields are usually still side by side after a hand edit, so this is one or
 * two runs in practice — but each run is written on its own, so a column of
 * theirs sitting between two of ours is skipped rather than overwritten.
 */
export function columnRuns(map: readonly number[]): ColumnRun[] {
  const pairs = map
    .map((col, field) => ({ col, field }))
    .filter(p => p.col >= 0)
    .sort((a, b) => a.col - b.col)

  const runs: ColumnRun[] = []
  for (const { col, field } of pairs) {
    const open = runs[runs.length - 1]
    if (open && col === open.last + 1) {
      open.last = col
      open.fields.push(field)
    } else {
      runs.push({ first: col, last: col, fields: [field] })
    }
  }
  return runs
}

/**
 * A row read off a mapped tab, put back into layout order.
 *
 * `cells` is the physical block that was read, starting at `firstColumn`.
 * Everything downstream — the duplicate key, the append guard, the dashboard
 * preview — is written against layout order and stays unaware of the mapping.
 */
export function projectRow<T>(
  cells: T[], map: readonly number[], firstColumn: number, blank: T,
): T[] {
  return map.map(col => {
    if (col < 0) return blank
    const value = cells[col - firstColumn]
    return value === undefined ? blank : value
  })
}
