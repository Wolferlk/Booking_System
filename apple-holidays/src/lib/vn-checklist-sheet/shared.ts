/**
 * Checklist VN 2.1v — the Vietnam desk's live Excel checklist, mirrored into OPS.
 *
 * The desk keeps one workbook ("Checklist 2026.xlsx", SharePoint) with a block
 * per tour: a header row (tour code, agent, pax, dates, revenue, PNL) and one
 * row per thing a vendor is paid for. OPS downloads that file every 2 hours,
 * parses it and stores it in the `vn_sheet_checklist_*` tables, so each booking
 * page can show its own block without touching the file.
 *
 * The workbook is read, never written. This is NOT the editable OPS checklist
 * in src/lib/vn-checklist/ (the costing-sheet popup) — that one is typed into
 * OPS; this one is whatever the Excel says.
 *
 * Safe to import from the browser: constants, types and pure helpers only.
 */

/** The workbook the desk shared on 24 Sep 2026. Overridable in Settings. */
export const DEFAULT_CHECKLIST_SHEET_URL =
  'https://aahaas-my.sharepoint.com/:x:/p/tina_asiacharm/IQAFry6wGspUS7GODy3xioXCAa_l2s-DxkE-5MtF8eo6c4g?e=HQPUqe'

export const DEFAULT_SYNC_INTERVAL_HOURS = 2

/** `system_settings` keys this feature owns. */
export const SHEET_SETTINGS = {
  url:           'vn_sheet_checklist_url',
  /** Comma-separated tab names. Blank = every "Checklist YYYY" tab. */
  tabs:          'vn_sheet_checklist_tabs',
  enabled:       'vn_sheet_checklist_enabled',
  intervalHours: 'vn_sheet_checklist_interval_hours',
  /** JSON: resolved drive/item ids for the current link. */
  ref:           'vn_sheet_checklist_ref',
} as const

export const SHEET_NOT_INSTALLED =
  'Checklist VN 2.1v is not set up on this database yet — run prisma/sql/apply-vn-checklist-sheet.sh'

// ── Paid status ──────────────────────────────────────────────────────────────

/**
 * The "Paid" column is free text. In the 2026 tab it holds, by frequency:
 * "ACT paid" (12.7k), "Check" (8.9k), blank (4.7k), "Tina paid" (3.5k),
 * "Paid from India" (79). Buckets keep the raw text alongside, so an odd value
 * ("Paid by Sharmila") still reads as typed.
 */
export type PaidBucket = 'ACT_PAID' | 'TINA_PAID' | 'INDIA_PAID' | 'OTHER_PAID' | 'CHECK' | 'OPEN'

export function paidBucketOf(raw: unknown): PaidBucket {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s) return 'OPEN'
  if (/\bcheck/.test(s)) return 'CHECK'
  if (/\bact\b/.test(s) && /paid/.test(s)) return 'ACT_PAID'
  if (/tina/.test(s)) return 'TINA_PAID'
  if (/india/.test(s)) return 'INDIA_PAID'
  if (/paid/.test(s)) return 'OTHER_PAID'
  return 'OPEN'
}

export const isPaidBucket = (b: string) => b === 'ACT_PAID' || b === 'TINA_PAID' || b === 'INDIA_PAID' || b === 'OTHER_PAID'

export const PAID_BUCKETS: Record<PaidBucket, { label: string; pill: string; bar: string; dot: string }> = {
  ACT_PAID:   { label: 'ACT paid',        pill: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  TINA_PAID:  { label: 'Tina paid',       pill: 'bg-teal-50 text-teal-700 ring-teal-200',          bar: 'bg-teal-400',    dot: 'bg-teal-400' },
  INDIA_PAID: { label: 'Paid from India', pill: 'bg-sky-50 text-sky-700 ring-sky-200',             bar: 'bg-sky-400',     dot: 'bg-sky-400' },
  OTHER_PAID: { label: 'Paid (other)',    pill: 'bg-cyan-50 text-cyan-700 ring-cyan-200',          bar: 'bg-cyan-400',    dot: 'bg-cyan-400' },
  CHECK:      { label: 'Check',           pill: 'bg-amber-50 text-amber-700 ring-amber-200',       bar: 'bg-amber-400',   dot: 'bg-amber-400' },
  OPEN:       { label: 'Not marked',      pill: 'bg-slate-50 text-slate-500 ring-slate-200',       bar: 'bg-slate-300',   dot: 'bg-slate-300' },
}

export const PAID_BUCKET_ORDER: PaidBucket[] = ['ACT_PAID', 'TINA_PAID', 'INDIA_PAID', 'OTHER_PAID', 'CHECK', 'OPEN']

// ── Codes ────────────────────────────────────────────────────────────────────

/** The sheet's CODE column, most used first. Anything else gets the neutral tone. */
const CODE_STYLE: Record<string, { tone: string; hex: string }> = {
  'trans':      { tone: 'bg-blue-50 text-blue-700 ring-blue-200',         hex: '#3b82f6' },
  'ticket':     { tone: 'bg-violet-50 text-violet-700 ring-violet-200',   hex: '#8b5cf6' },
  'sic':        { tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hex: '#10b981' },
  'day cruise': { tone: 'bg-cyan-50 text-cyan-700 ring-cyan-200',         hex: '#06b6d4' },
  'guide fee':  { tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200',   hex: '#6366f1' },
  'hotel':      { tone: 'bg-amber-50 text-amber-700 ring-amber-200',      hex: '#f59e0b' },
  'f&b':        { tone: 'bg-orange-50 text-orange-700 ring-orange-200',   hex: '#f97316' },
  'cruise':     { tone: 'bg-sky-50 text-sky-700 ring-sky-200',            hex: '#0ea5e9' },
}

export function codeStyle(code: string | null | undefined) {
  return CODE_STYLE[String(code ?? '').trim().toLowerCase()] ?? { tone: 'bg-slate-50 text-slate-600 ring-slate-200', hex: '#94a3b8' }
}

// ── Refs ─────────────────────────────────────────────────────────────────────

/**
 * Every VN booking ref inside a tour code. The sheet mostly uses the ref as the
 * code ("VN42202"), but also combines two ("VN15137/VN17876"), suffixes one
 * ("VN40741-Arusha", "VN12345 - VIP MMT AKRITI") and spaces one ("VN 12345").
 */
export function refsInCode(code: string): string[] {
  const out: string[] = []
  const re = /VN\s*(\d{4,6})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code.toUpperCase()))) if (!out.includes(`VN${m[1]}`)) out.push(`VN${m[1]}`)
  return out
}

export const refKeyOf = (refs: string[]) => (refs.length ? `,${refs.join(',')},` : '')

// ── API shapes ───────────────────────────────────────────────────────────────

export interface SheetLine {
  id: string
  position: number
  sheetRow: number | null
  details: string
  vendor: string | null
  code: string | null
  dates: string | null
  qcStatus: string | null
  unitPrice: number | null
  quan1: number | null
  quan2: number | null
  totalEstimateVnd: number | null
  paidRaw: string | null
  paidBucket: PaidBucket
  incurred: string | null
  note: string | null
}

export interface SheetTour {
  tourCode: string
  refs: string[]
  agent: string | null
  agentRef: string | null
  pax: number | null
  monthLabel: string | null
  arrivalDate: string | null
  departureDate: string | null
  days: number | null
  itinerary: string | null
  quotedUsd: number | null
  revenueUsd: number | null
  totalVnd: number | null
  totalEstimateVnd: number | null
  pnlIncurredVnd: number | null
  profitMargin: number | null
  exchangeRate: number | null
  lineCount: number
  linesTotalVnd: number
  paidLineCount: number
  checkLineCount: number
  openLineCount: number
  sheetTab: string | null
  sheetRow: number | null
  isActive: boolean
  firstSeenAt: string
  changedAt: string
}

export interface SheetEvent {
  id: string
  kind: 'ADDED' | 'CHANGED' | 'REMOVED' | 'RESTORED'
  summary: string
  changes: { field: string; from?: string | null; to?: string | null; line?: string }[]
  createdAt: string
}

export interface SheetSyncInfo {
  id: string
  trigger: string
  status: 'RUNNING' | 'SUCCESS' | 'UNCHANGED' | 'FAILED'
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  fileName: string | null
  fileModifiedAt: string | null
  tabs: string | null
  tours: number
  lines: number
  added: number
  changed: number
  removed: number
  warnings: string | null
  error: string | null
  triggeredBy: string | null
}

export interface BookingSheetPayload {
  installed: boolean
  tours: (SheetTour & { lines: SheetLine[]; events: SheetEvent[] })[]
  lastSync: SheetSyncInfo | null
  lastSuccessAt: string | null
  intervalHours: number
  sheetWebUrl: string | null
  refreshing: boolean
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtVnd(v: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (opts.compact) {
    const a = Math.abs(v)
    const sign = v < 0 ? '−' : ''
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B ₫`
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M ₫`
    if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}K ₫`
  }
  return `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString('en-US')} ₫`
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 48) return `${hrs} h ${mins % 60 ? `${mins % 60} min ` : ''}ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
