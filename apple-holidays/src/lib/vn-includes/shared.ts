/**
 * Vietnam agenda includes — the parts a movement is really made of.
 *
 * A Vietnam P&L line is sold as one bundle ("SIC - 4 Island tour + cable car +
 * Local lunch") but paid out in pieces, each to its own supplier. The operator
 * building the movement chart picks those pieces from the Vietnam product sheet
 * (Settings → Vietnam Product Sheet), and the Accounts payables board reads them
 * back to pay each piece separately.
 *
 * This file is safe to import from the browser: constants, types and pure text
 * helpers only. Database and Graph work lives in ./catalog.ts and ./includes.ts.
 */

/** The workbook the desk shared on 23 Sep 2026. Overridable in Settings. */
export const DEFAULT_PRODUCT_SHEET_URL =
  'https://aahaas-my.sharepoint.com/:x:/p/sasindu/IQCCa-VX-VYrQYbQchimCXRyAZvAWVj9FIODmvQAZ6zOc0g?e=KVhaHd'

/** `system_settings` keys this feature owns. */
export const VN_INCLUDE_SETTINGS = {
  /** The shared link to the product workbook. */
  sheetUrl:   'vn_include_product_sheet_url',
  /** Tab the products are read from. Blank = the first tab whose header fits. */
  sheetTab:   'vn_include_product_sheet_tab',
  /** Tab operator-added products are appended to. Created on first use. */
  manualTab:  'vn_include_manual_tab',
  /** JSON: the last sync's outcome (see CatalogMeta). */
  meta:       'vn_include_catalog_meta',
  /** JSON: the resolved drive/item ids for the current link. */
  sheetRef:   'vn_include_sheet_ref',
} as const

export const DEFAULT_MANUAL_TAB = 'Manual Products'

/**
 * Movements that take includes. The desk asked for SIC Transfer and Private
 * Tour — the two types a Vietnam bundle is sold under. Add a value here and the
 * picker appears on that type too; nothing else needs to change.
 */
export const INCLUDE_SERVICE_TYPES = ['SIC_TRANSFER', 'PVT_TOUR'] as const

export function takesIncludes(serviceType: string | null | undefined, country: string | null | undefined): boolean {
  return country === 'VIETNAM'
    && (INCLUDE_SERVICE_TYPES as readonly string[]).includes(String(serviceType ?? ''))
}

/**
 * The sheet's own codes, in the order the desk reads them. A code the sheet
 * gains later still works — it simply gets the neutral colour.
 */
export const INCLUDE_CODES = ['Trans', 'Ticket', 'SIC', 'Day Cruise', 'Guide fee', 'F&B', 'Hotel', 'Cruise'] as const

const CODE_TONES: Record<string, string> = {
  'trans':      'bg-blue-50 text-blue-700 ring-blue-200',
  'ticket':     'bg-purple-50 text-purple-700 ring-purple-200',
  'sic':        'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'day cruise': 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  'cruise':     'bg-sky-50 text-sky-700 ring-sky-200',
  'guide fee':  'bg-indigo-50 text-indigo-700 ring-indigo-200',
  'f&b':        'bg-orange-50 text-orange-700 ring-orange-200',
  'hotel':      'bg-amber-50 text-amber-700 ring-amber-200',
}

export function codeTone(code: string): string {
  return CODE_TONES[code.trim().toLowerCase()] ?? 'bg-slate-50 text-slate-600 ring-slate-200'
}

/** A product as the picker receives it. */
export interface IncludeProduct {
  id: string
  productKey: string
  code: string
  name: string
  usageCount: number
  minPriceVnd: number | null
  source: 'SHEET' | 'MANUAL'
  syncStatus?: string | null
  /** 0–1, how well it matched the query. Present on search results only. */
  score?: number
}

/** An include as it travels between the chart, the API and the database. */
export interface AgendaInclude {
  id?: string
  productId?: string | null
  productKey: string
  code: string
  name: string
  unitPriceVnd: number | null
  quantity: number
  note?: string | null
  source: 'SHEET' | 'MANUAL'
}

export interface CatalogMeta {
  syncedAt: string | null
  fileName: string | null
  webUrl: string | null
  tab: string | null
  rows: number
  added: number
  updated: number
  retired: number
  manualRows: number
  pendingManual: number
  error: string | null
}

// ── Text ─────────────────────────────────────────────────────────────────────

/**
 * The sheet's column B, cleaned for display. The desk's file carries the
 * leftovers of pasted Word bullets and quote prefixes — "·         Da Nang
 * Combo…", ": PVT- Vin wonder…:" — which would otherwise sort every such row to
 * the top and read as noise in the picker.
 */
export function cleanProductName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u00a0\u2000-\u200b]/g, ' ')
    .replace(/^[\s\u00b7\u2022\u25cf\u25aa\u25e6\-\u2013\u2014:;,.*]+/, '')
    .replace(/[\s:;,]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Accent-free, lower-case, punctuation reduced to spaces — the search form. */
export function searchForm(text: string): string {
  return text
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Identity of a product across syncs — the sheet has no id column. */
export function productKeyFor(code: string, name: string): string {
  const key = `${searchForm(code)}|${searchForm(name)}`
  // The column is VARCHAR(191); two names that differ only past that point are
  // the same product in practice.
  return key.slice(0, 191)
}

/** Words that carry no meaning when matching an activity to a product. */
const STOP = new Set([
  'and', 'the', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'for', 'with', 'by', 'or', 'from',
  'incl', 'including', 'include', 'includes', 'only', 'basis', 'via', 'vice', 'versa',
])

export function tokens(text: string): string[] {
  return searchForm(text).split(' ').filter(t => t && !STOP.has(t))
}

/** "1,050,000" → "1,050,000 ₫"; null → "—". */
export function formatVnd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('en-US')} ₫`
}
