/**
 * Reading a desk's own transport workbook ("Malaysia 16th to 30th September
 * 2026.xlsx") into rows a Trans-Reconsultation sheet can take.
 *
 * Pure: a buffer and a file name in, rows and what the file says about itself
 * out. No database, no AI — the import service decides what to do with an
 * unreadable header (it asks OpenAI for the column map) and what each row
 * pairs with on the MC Report.
 *
 * The desks' files are hand-kept, so the reader is forgiving on purpose:
 *  • the header can sit on any of the first rows and be spelled many ways;
 *  • dates arrive as Excel serials, as text ("18/09", "18-Sep-26") or blank
 *    under a merged cell — a blank one carries the date of the row above;
 *  • times arrive as day fractions, "12:10", "1210hrs" or "7.30 pm";
 *  • a rate cell can hold "100+58 DNR" — the text is kept, the sum is the rate.
 */
import * as XLSX from 'xlsx'
import {
  RECON_COUNTRIES, RECON_COUNTRY_META, parseRate, periodForDate, periodOf,
  type Half, type ReconCountry,
} from './shared'

export const IMPORT_FIELDS = ['serviceDate', 'tourNo', 'guestName', 'pax', 'pickUp', 'dropOff', 'time', 'details', 'rateText', 'remarks'] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
/** Column letter per field. */
export type ColumnMap = Partial<Record<ImportField, string>>

export interface ImportRow {
  /** 1-based row number in the workbook, as Excel shows it. */
  row: number
  serviceDate: string | null
  tourNo: string | null
  guestName: string | null
  pax: string | null
  pickUp: string | null
  dropOff: string | null
  time: string | null
  details: string | null
  rateText: string | null
  rate: number | null
  remarks: string | null
  /** Cells this reader had to fill or guess. */
  notes: string[]
}

export interface ParsedSheet {
  name: string
  headerRow: number | null
  columns: ColumnMap
  headers: Record<string, string>
  rows: ImportRow[]
  /** How sure the header detection is (fields recognised / fields that matter). */
  headerScore: number
}

export interface DetectedContext {
  country: ReconCountry | null
  countryWhy: string
  year: number | null
  month: number | null
  half: Half | null
  periodWhy: string
  /** Rows by half month, most first — "14 of 15 rows are 16–30 Sep 2026". */
  periodVotes: { key: string; label: string; count: number }[]
}

// ── Cells ───────────────────────────────────────────────────────────────────

const clean = (v: unknown) => String(v ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim()
const pad = (n: number) => String(n).padStart(2, '0')
const colLetter = (i: number) => XLSX.utils.encode_col(i)

/** Excel serial (1900 system) → YYYY-MM-DD. Time of day is ignored. */
function serialToIso(n: number): string | null {
  if (!Number.isFinite(n) || n < 20000 || n > 80000) return null
  const d = new Date(Math.round((Math.floor(n) - 25569) * 86_400_000))
  return d.toISOString().slice(0, 10)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/** A date cell, day first ("18/09/2026", "18-Sep", "Sep 18 2026", "2026-09-18"). */
export function parseDateCell(v: unknown, fallbackYear: number | null): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return serialToIso(v)
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = clean(v).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1')
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?\b/)
  if (m) return valid(year(m[3], fallbackYear), +m[2], +m[1])
  m = s.match(/\b(\d{1,2})[\s-]*([a-z]{3,9})[\s,-]*(\d{2,4})?\b/)
  if (m && MONTHS[m[2]]) return valid(year(m[3], fallbackYear), MONTHS[m[2]], +m[1])
  m = s.match(/\b([a-z]{3,9})[\s-]*(\d{1,2})(?:[\s,-]+(\d{2,4}))?\b/)
  if (m && MONTHS[m[1]]) return valid(year(m[3], fallbackYear), MONTHS[m[1]], +m[2])
  return null
}
const year = (y: string | undefined, fallback: number | null) => !y ? (fallback ?? new Date().getUTCFullYear()) : y.length === 2 ? 2000 + Number(y) : Number(y)
function valid(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null
}

/** A time cell → "HH:MM" (a day fraction, "12:10", "1210hrs", "7.30 pm", "0630"). */
export function parseTimeCell(v: unknown): string | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') {
    const frac = v - Math.floor(v)
    if (v >= 1 && frac === 0) {
      // 1210 typed as a number
      if (v >= 0 && v < 2400 && v % 100 < 60) return `${pad(Math.floor(v / 100))}:${pad(v % 100)}`
      return null
    }
    const mins = Math.round(frac * 1440) % 1440
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`
  }
  const s = clean(v).toLowerCase()
  let m = s.match(/\b(\d{1,2})\s*[:.h]\s*(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/)
  if (!m) { const n = s.match(/\b(\d{3,4})\s*(hrs?|h|am|pm)?\b/); if (n) m = [n[0], n[1].slice(0, -2), n[1].slice(-2), n[2] ?? ''] as unknown as RegExpMatchArray }
  if (!m) { const n = s.match(/\b(\d{1,2})\s*(am|pm)\b/); if (n) m = [n[0], n[1], '00', n[2]] as unknown as RegExpMatchArray }
  if (!m) return clean(v).slice(0, 32) || null
  let h = Number(m[1]); const min = Number(m[2])
  const ap = String(m[3] ?? '').replace(/\./g, '')
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return clean(v).slice(0, 32)
  return `${pad(h)}:${pad(min)}`
}

const text = (v: unknown) => {
  if (v == null) return null
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return clean(v) || null
}

// ── Header detection ────────────────────────────────────────────────────────

/** Order matters: a "PICK UP TIME" heading is a time, not a pick-up. */
const HEADER_RULES: [ImportField, RegExp][] = [
  ['time', /\btime\b|\bp\/?u\s*time\b|\bhrs?\b$/],
  ['serviceDate', /^(service\s*|travel\s*|tour\s*)?date$|^day$|^date\b/],
  ['tourNo', /tour\s*(no|number|#|code|ref)|^file\b|booking\s*(no|ref|id)?|^ref\b|vn\s*code|^is\s*(no|number)|^code$|confirmation/],
  ['guestName', /guest|client|lead|passenger\s*name|pax\s*name|^name$|customer/],
  ['pax', /^pax$|^no\.?\s*of\s*pax|^pax\s*(count|no)|persons|^people$|^adults?$/],
  ['pickUp', /pick\s*-?\s*up|^from$|pickup|origin/],
  ['dropOff', /drop\s*-?\s*(off)?|^to$|dropoff|destination/],
  ['rateText', /rate|amount|cost|price|charges?|^total|myr|sgd|usd|vnd|lkr|payable/],
  ['remarks', /remark|note|comment|vendor|driver|supplier/],
  ['details', /detail|description|service|itinerary|programme|program|activity|flight/],
]

function headerField(cell: string): ImportField | null {
  const s = clean(cell).toLowerCase()
  if (!s || s.length > 40) return null
  for (const [f, re] of HEADER_RULES) if (re.test(s)) return f
  return null
}

const IMPORTANT: ImportField[] = ['serviceDate', 'tourNo', 'pickUp', 'dropOff', 'details', 'rateText']

function findHeader(grid: unknown[][]): { row: number; columns: ColumnMap; headers: Record<string, string>; score: number } | null {
  let best: { row: number; columns: ColumnMap; headers: Record<string, string>; score: number } | null = null
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const columns: ColumnMap = {}
    const headers: Record<string, string> = {}
    grid[r]?.forEach((cell, c) => {
      const f = headerField(String(cell ?? ''))
      if (f && !columns[f]) { columns[f] = colLetter(c); headers[colLetter(c)] = clean(cell) }
    })
    const hit = IMPORTANT.filter(f => columns[f]).length
    const score = hit / IMPORTANT.length
    if (columns.serviceDate && hit >= 3 && (!best || score > best.score)) best = { row: r, columns, headers, score }
  }
  return best
}

// ── Rows ────────────────────────────────────────────────────────────────────

/** Turn a grid into rows with a known column map. `headerRow` is 0-based. */
export function rowsFrom(grid: unknown[][], columns: ColumnMap, headerRow: number, fallbackYear: number | null): ImportRow[] {
  const idx = (f: ImportField) => (columns[f] ? XLSX.utils.decode_col(columns[f]!) : -1)
  const at = (row: unknown[], f: ImportField) => { const i = idx(f); return i >= 0 ? row[i] : undefined }
  const out: ImportRow[] = []
  let prev: ImportRow | null = null

  for (let r = headerRow + 1; r < grid.length; r++) {
    const g = grid[r] ?? []
    const notes: string[] = []
    const rateRaw = at(g, 'rateText')
    const row: ImportRow = {
      row: r + 1,
      serviceDate: parseDateCell(at(g, 'serviceDate'), fallbackYear),
      tourNo: text(at(g, 'tourNo')),
      guestName: text(at(g, 'guestName')),
      pax: text(at(g, 'pax')),
      pickUp: text(at(g, 'pickUp')),
      dropOff: text(at(g, 'dropOff')),
      time: parseTimeCell(at(g, 'time')),
      details: text(at(g, 'details')),
      rateText: text(rateRaw),
      rate: typeof rateRaw === 'number' ? Math.round(rateRaw * 100) / 100 : parseRate(text(rateRaw)),
      remarks: text(at(g, 'remarks')),
      notes,
    }
    const substance = [row.pickUp, row.dropOff, row.details, row.rateText].filter(Boolean).length
    // A blank or repeated header line, a totals row, a section title.
    if (!substance && !row.tourNo) continue
    if (/^(total|grand\s*total|sub\s*total)\b/i.test(String(row.tourNo ?? row.details ?? row.rateText ?? '')) ||
        /^total\b/i.test(clean(at(g, 'guestName'))) || (!row.serviceDate && !row.tourNo && /total/i.test(g.map(clean).join(' ')))) continue
    if (headerField(String(at(g, 'serviceDate') ?? '')) === 'serviceDate' && headerField(String(at(g, 'pickUp') ?? '')) === 'pickUp') continue
    if (substance < 1) continue

    // Merged / left-blank cells under a tour block take the row above.
    if (prev) {
      if (!row.serviceDate && at(g, 'serviceDate') == null && prev.serviceDate) { row.serviceDate = prev.serviceDate; notes.push('date carried from the row above') }
      if (!row.tourNo && prev.tourNo) { row.tourNo = prev.tourNo; notes.push('tour no carried from the row above') }
      if (!row.guestName && row.tourNo === prev.tourNo && prev.guestName) row.guestName = prev.guestName
      if (!row.pax && row.tourNo === prev.tourNo && prev.pax) row.pax = prev.pax
    }
    if (!row.serviceDate) notes.push(at(g, 'serviceDate') == null ? 'no date' : `date "${clean(at(g, 'serviceDate'))}" not understood`)
    if (row.rateText && row.rate == null) notes.push(`rate "${row.rateText}" has no number`)
    out.push(row)
    prev = row
  }
  return out
}

/** Every sheet of the workbook as a grid of raw values. */
export function readGrids(buffer: Buffer | ArrayBuffer): { name: string; grid: unknown[][] }[] {
  const wb = XLSX.read(buffer, { type: buffer instanceof ArrayBuffer ? 'array' : 'buffer', cellDates: false, cellFormula: false, cellHTML: false })
  return wb.SheetNames.map(name => ({
    name,
    grid: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true }),
  }))
}

/** Grid as tab-separated text with row numbers and column letters, for the AI column mapper. */
export function gridSample(grid: unknown[][], rows = 18): string {
  const width = Math.min(26, Math.max(0, ...grid.slice(0, rows).map(r => r?.length ?? 0)))
  const head = ['row', ...Array.from({ length: width }, (_, i) => colLetter(i))].join('\t')
  return [head, ...grid.slice(0, rows).map((r, i) => [String(i + 1), ...Array.from({ length: width }, (_, c) => {
    const v = r?.[c]
    return typeof v === 'number' ? String(v) : clean(v).slice(0, 60)
  })].join('\t'))].join('\n')
}

/**
 * Parse the workbook. Each sheet is tried; the one with a recognisable header
 * and the most rows wins. A sheet whose header could not be found comes back
 * with headerRow null so the caller can ask for a column map.
 */
export function parseWorkbook(buffer: Buffer | ArrayBuffer, fileName: string, override?: { sheet?: string; headerRow?: number; columns?: ColumnMap }) {
  const grids = readGrids(buffer)
  const yearHint = Number(fileName.match(/\b(20\d{2})\b/)?.[1]) || null
  const sheets: ParsedSheet[] = grids.map(({ name, grid }) => {
    if (override?.columns && (!override.sheet || override.sheet === name)) {
      const hr = (override.headerRow ?? 1) - 1
      return { name, headerRow: hr + 1, columns: override.columns, headers: {}, rows: rowsFrom(grid, override.columns, hr, yearHint), headerScore: 1 }
    }
    const h = findHeader(grid)
    if (!h) return { name, headerRow: null, columns: {}, headers: {}, rows: [], headerScore: 0 }
    return { name, headerRow: h.row + 1, columns: h.columns, headers: h.headers, rows: rowsFrom(grid, h.columns, h.row, yearHint), headerScore: h.score }
  })
  const pick = override?.sheet
    ? sheets.find(s => s.name === override.sheet) ?? sheets[0]
    : [...sheets].sort((a, b) => b.rows.length - a.rows.length || b.headerScore - a.headerScore)[0]
  return { sheets, sheet: pick, grids }
}

// ── What the file says about itself ─────────────────────────────────────────

const COUNTRY_WORDS: Record<ReconCountry, RegExp> = {
  MALAYSIA: /\bmala[iy]sia\b|\bkuala\s*lumpur\b|\bklia\b|\bgenting\b|\bpenang\b|\blangkawi\b|\bmalacca\b|\bmelaka\b|\bputrajaya\b|\bbatu\s*caves?\b|\bbukit\s*bintang\b|\bklcc\b|\bkl\s*sentral\b/i,
  SINGAPORE: /\bsingapore\b|\bchangi\b|\bsentosa\b|\bmarina\s*bay\b|\borchard\b|\bjewel\b|\bclarke\s*quay\b/i,
  VIETNAM: /\bviet\s*nam\b|\bhanoi\b|\bha\s*noi\b|\bho\s*chi\s*minh\b|\bsaigon\b|\bda\s*nang\b|\bhoi\s*an\b|\bha\s*long\b|\bphu\s*quoc\b|\bnha\s*trang\b|\bsapa\b/i,
  SRILANKA: /\bsri\s*lanka\b|\bcolombo\b|\bkandy\b|\bsigiriya\b|\bgalle\b|\bnegombo\b|\bbentota\b|\bnuwara\s*eliya\b|\bella\b|\bkatunayake\b|\bcmb\b/i,
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function detectContext(fileName: string, sheetName: string, rows: ImportRow[]): DetectedContext {
  const name = `${fileName.replace(/\.[a-z0-9]+$/i, '')} ${sheetName}`.replace(/[_]+/g, ' ')

  // Country — the file name first (the desk names its files by country),
  // then the tour prefixes, then the places on the rows.
  const score: Record<ReconCountry, number> = { MALAYSIA: 0, SINGAPORE: 0, VIETNAM: 0, SRILANKA: 0 }
  const why: Record<ReconCountry, string[]> = { MALAYSIA: [], SINGAPORE: [], VIETNAM: [], SRILANKA: [] }
  for (const c of RECON_COUNTRIES) {
    if (COUNTRY_WORDS[c].test(name)) { score[c] += 100; why[c].push('the file name') }
    const prefix = RECON_COUNTRY_META[c].prefix
    const tours = rows.filter(r => new RegExp(`\\b${prefix}\\s*\\d{4,}`, 'i').test(r.tourNo ?? '')).length
    if (tours) { score[c] += tours * 3; why[c].push(`${tours} ${prefix} tour no${tours === 1 ? '' : 's'}`) }
    const places = rows.filter(r => COUNTRY_WORDS[c].test(`${r.pickUp ?? ''} ${r.dropOff ?? ''} ${r.details ?? ''}`)).length
    if (places) { score[c] += places; why[c].push(`${places} row${places === 1 ? '' : 's'} naming its places`) }
  }
  const ranked = [...RECON_COUNTRIES].sort((a, b) => score[b] - score[a])
  const country = score[ranked[0]] > 0 ? ranked[0] : null

  // Period — "16th to 30th September 2026" in the name, checked against the
  // dates the rows actually carry.
  const votes = new Map<string, { key: string; label: string; count: number; y: number; m: number; h: Half }>()
  for (const r of rows) {
    if (!r.serviceDate) continue
    const p = periodForDate(r.serviceDate)
    const key = `${p.year}-${p.month}-${p.half}`
    const v = votes.get(key) ?? { key, label: `${p.half === 1 ? '1–15' : `16–${Number(p.end.slice(8))}`} ${MONTH_NAMES[p.month - 1].slice(0, 3)} ${p.year}`, count: 0, y: p.year, m: p.month, h: p.half }
    v.count++; votes.set(key, v)
  }
  const ranking = Array.from(votes.values()).sort((a, b) => b.count - a.count)

  let fromName: { y: number; m: number; h: Half } | null = null
  const n = name.toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1')
  const range = n.match(/\b(\d{1,2})\s*(?:-|–|to|until|till)\s*(\d{1,2})\s+([a-z]{3,9})\.?\s*,?\s*(20\d{2})/)
  const monthOnly = n.match(/\b([a-z]{3,9})\.?\s*,?\s*(20\d{2})\b/)
  if (range && MONTHS[range[3]]) {
    fromName = { y: +range[4], m: MONTHS[range[3]], h: Number(range[1]) >= 16 ? 2 : Number(range[2]) <= 15 ? 1 : 1 }
  } else if (monthOnly && MONTHS[monthOnly[1]]) {
    const h: Half | null = /\b(2nd|second)\s*half\b|\b16\b/.test(n) ? 2 : /\b(1st|first)\s*half\b|\b15\b/.test(n) ? 1 : null
    if (h) fromName = { y: +monthOnly[2], m: MONTHS[monthOnly[1]], h }
  }

  const top = ranking[0]
  let year: number | null = null, month: number | null = null, half: Half | null = null, periodWhy = ''
  if (fromName) {
    year = fromName.y; month = fromName.m; half = fromName.h
    const p = periodOf(year, month, half)
    const inside = rows.filter(r => r.serviceDate && r.serviceDate >= p.start && r.serviceDate <= p.end).length
    const dated = rows.filter(r => r.serviceDate).length
    periodWhy = `from the file name; ${inside} of ${dated} dated row${dated === 1 ? '' : 's'} fall inside it`
    if (top && top.count > inside) periodWhy += ` — but ${top.count} rows are ${top.label}, check this`
  } else if (top) {
    year = top.y; month = top.m; half = top.h
    periodWhy = `${top.count} of ${rows.filter(r => r.serviceDate).length} dated rows are ${top.label}`
  } else {
    periodWhy = 'no dates could be read'
  }

  return {
    country,
    countryWhy: country ? why[country].join(', ') : 'nothing in the file names a country',
    year, month, half, periodWhy,
    periodVotes: ranking.map(({ key, label, count }) => ({ key, label, count })),
  }
}
