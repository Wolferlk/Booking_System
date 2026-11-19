/**
 * Excel MC Generate — build / refresh a Vietnam movement chart from the VN
 * desk's "(VN TEAM) Movement Chart" workbook.
 *
 * Client-safe and pure: no Prisma, no Node APIs. The server (./server.ts) only
 * reads the workbook and hands over this booking's rows as `McSheetLine`s; the
 * matching, the diff against the chart on screen and the merge all happen here,
 * in the browser, so nothing is written until the operator confirms — and then
 * through the ordinary chart save (POST /api/bookings/[ref]/agenda), with its
 * transaction, its rollback and its Booking Logs entry.
 *
 * "Sheet updated" detection. When a chart is saved from the sheet, the
 * fingerprint of every sheet row the operator saw is kept as the booking's
 * baseline. Next time:
 *   - a row whose fingerprint is NOT in the baseline was changed (or added) in
 *     Excel since — its differences are pre-ticked;
 *   - a row whose fingerprint IS in the baseline is unchanged in Excel, so any
 *     difference from the chart is an edit someone made in OPS — kept, unticked.
 */

// ── Wire types ───────────────────────────────────────────────────────────────

export interface McSheetLine {
  /** Content fingerprint — stable while the row's cells stay the same. */
  key: string
  tab: string
  row: number
  date: string | null          // yyyy-mm-dd
  location: string | null
  from: string | null
  to: string | null
  details: string | null
  meal: string | null          // mapped to the system's meal-plan wording
  timeRaw: string | null       // as the desk typed it ("8:00 - 8:30 AM")
  time: string | null          // HH:MM (start)
  timeEnd: string | null       // HH:MM (end of a range), when there is one
  serviceRaw: string | null
  serviceType: string | null   // system code (or the custom text)
  vendorText: string | null    // the Vendors cell
  driverName: string | null    // what the chart stores as the driver ("Go Air - Driver's manager: +84…")
  driverPhone: string | null   // numbers only, " / " joined
  guest: string | null
  adults: string | null
  children: string | null
}

export interface McBaseline {
  at: string
  by: string | null
  /** Fingerprints of the sheet rows as they stood at the last build / auto-update. */
  keys: string[]
  title?: string | null
  /**
   * Every value the sheet has ever put on this chart (valueKey per field+date),
   * newest first. A chart field holding one of these still carries sheet data,
   * so the auto-update may refresh it; anything else was typed in OPS — kept.
   */
  vals?: string[]
  /** Last time the auto-update changed this chart. */
  autoAt?: string | null
  /** Auto-update paused for this booking. */
  paused?: boolean
}

export interface McAutoInfo {
  mode: 'OFF' | 'AUTO'
  intervalMin: number
  lastRun: McAutoRunState | null
  canAdmin: boolean
}

export interface McAutoRunState {
  at: string
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  trigger: string
  bookings: number
  changedBookings: number
  fields: number
  created: number
  durationMs: number
  error?: string | null
}

export interface McSheetPayload {
  bookingRef: string
  lines: McSheetLine[]
  sheet: { title: string | null; source: string; readAt: string; tabs: string[]; fromCache: boolean; url: string }
  warnings: string[]
  baseline: McBaseline | null
  auto?: McAutoInfo
}

/** The fields of a chart movement this feature reads and writes. */
export interface ChartItemLike {
  id?: string
  date: string
  location: string
  fromPoint: string
  toPoint: string
  details: string
  mealPlan: string
  meetingTime: string
  timeFrom: string
  timeTo: string
  serviceType: string
  isLeisure: boolean
  isHotelOnly: boolean
  assignment?: {
    driverId?: string | null
    vendorId?: string | null
    vendorName?: string | null
    driverName?: string | null
    driverPhone?: string | null
    [k: string]: unknown
  } | null
}

// ── Small helpers ────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

/** Lower-case, no accents (Vietnamese đ too), single spaces. */
export function fold(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** FNV-1a, 32-bit, as 8 hex chars — enough to tell one row's content from another's. */
export function fingerprint(parts: (string | null | undefined)[]): string {
  const s = parts.map(p => fold(p)).join('\u0001')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  // Two rounds with different seeds → 16 chars, so collisions stay theoretical.
  let g = 0x2545f491
  for (let i = s.length - 1; i >= 0; i--) {
    g ^= s.charCodeAt(i)
    g = Math.imul(g, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0')
}

/**
 * The Meeting Time cell → start (and end) on 24-hour "HH:MM".
 *   0.3958 (an Excel time)  → 09:30
 *   "8:00 - 8:30 AM"        → 08:00 / 08:30
 *   "15:00 - 15:30"         → 15:00 / 15:30
 *   "11:30 - 12:30 PM"      → 11:30 / 12:30
 *   "9 AM", "06.00", "0930" → 09:00, 06:00, 09:30
 */
export function parseSheetClock(raw: string | number | null | undefined): { start: string | null; end: string | null } {
  if (raw === null || raw === undefined || raw === '') return { start: null, end: null }
  if (typeof raw === 'number') {
    const frac = raw - Math.floor(raw)
    if (raw < 0 || (raw >= 1 && frac === 0)) return { start: null, end: null }
    const mins = Math.round(frac * 24 * 60)
    return { start: `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`, end: null }
  }
  const s = String(raw).trim()
  const re = /(\d{1,2})(?:\s*[:.hH]\s*(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/gi
  const found: { h: number; m: number; ap: string | null }[] = []
  for (const m of Array.from(s.matchAll(re))) {
    if (found.length >= 2) break
    const hasMin = m[2] !== undefined
    const ap = m[3] ? m[3].replace(/\./g, '').toLowerCase() : null
    // A bare number counts only with am/pm ("9 AM"), or as "0930".
    if (!hasMin && !ap) {
      const four = m[0].match(/^(\d{2})(\d{2})$/)
      if (four) { found.push({ h: +four[1], m: +four[2], ap: null }); continue }
      continue
    }
    found.push({ h: +m[1], m: hasMin ? +m[2] : 0, ap })
  }
  if (!found.length) {
    const four = s.match(/^(\d{2})(\d{2})$/)
    if (four) found.push({ h: +four[1], m: +four[2], ap: null })
  }
  if (!found.length) return { start: null, end: null }
  const trailing = [...found].reverse().find(f => f.ap)?.ap ?? null
  const to24 = (f: { h: number; m: number; ap: string | null }, ap: string | null): number | null => {
    let h = f.h
    if (h > 23 || f.m > 59) return null
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return h * 60 + f.m
  }
  const fmt = (mins: number | null) => (mins === null ? null : `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`)
  const last = found.length > 1 ? found[found.length - 1] : null
  const endMin = last ? to24(last, last.ap ?? trailing) : null
  let startMin = to24(found[0], found[0].ap ?? trailing)
  // "11:30 - 12:30 PM": the PM belongs to the end; a start that lands after the end was AM.
  if (startMin !== null && endMin !== null && !found[0].ap && startMin > endMin && startMin >= 12 * 60) startMin -= 12 * 60
  return { start: fmt(startMin), end: fmt(endMin) }
}

/** Free-text service type the desk typed → a system code where one fits. */
export function guessServiceType(raw: string | null | undefined, direct: string | null): string | null {
  const BUILT_IN = ['SIC_TOUR', 'PVT_TOUR', 'PVT_TRANSFER', 'PVT_TRANSFER_TICKET', 'PVT_TRANSFER_SPA', 'INTERNAL_TOUR',
    'ACCOMMODATION', 'MEAL_COUPON', 'PVT_TRANSFER_SIC_TOUR', 'OWN_ARRANGEMENT', 'SIC_TRANSFER', 'PVT_TRANSFER_MEAL', 'FLIGHT']
  if (direct && BUILT_IN.includes(direct)) return direct
  const t = fold(raw)
  if (!t) return direct
  const pvt = /\b(pvt|private)\b/.test(t)
  const sic = /\bsic\b/.test(t)
  if (pvt && sic) return 'PVT_TRANSFER_SIC_TOUR'
  if (pvt && /ticket/.test(t)) return 'PVT_TRANSFER_TICKET'
  if (pvt && /spa/.test(t)) return 'PVT_TRANSFER_SPA'
  if (pvt && /(meal|lunch|dinner)/.test(t)) return 'PVT_TRANSFER_MEAL'
  if (sic && /transfer/.test(t)) return 'SIC_TRANSFER'
  if (sic) return 'SIC_TOUR'
  if (pvt && /tour/.test(t)) return 'PVT_TOUR'
  if (pvt || /transfer/.test(t)) return 'PVT_TRANSFER'
  if (/(hotel|accommodation)/.test(t)) return 'ACCOMMODATION'
  if (/own\s*arr/.test(t)) return 'OWN_ARRANGEMENT'
  if (/ticket/.test(t)) return 'INTERNAL_TOUR'
  if (/flight/.test(t)) return 'FLIGHT'
  if (/(meal|coupon)/.test(t)) return 'MEAL_COUPON'
  return direct
}

const firstInt = (s: string | null | undefined): number | null => {
  const m = String(s ?? '').match(/\d+/)
  return m ? Number(m[0]) : null
}

/** "VJ 452", "6E1633", "VN-1925" in free text → normalised flight numbers. */
export function flightNumbersIn(text: string | null | undefined): string[] {
  const out = new Set<string>()
  const re = /\b([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?(\d{2,4})\b/g
  for (const m of Array.from(String(text ?? '').toUpperCase().matchAll(re))) {
    if (/^\d+$/.test(m[1])) continue
    out.add(`${m[1]}${m[2].replace(/^0+(?=\d{2})/, '')}`)
  }
  return Array.from(out)
}

const normFlight = (f: string) => f.toUpperCase().replace(/[\s-]/g, '').replace(/^([A-Z0-9]{2})0+(?=\d{2})/, '$1')

const words = (s: string | null | undefined): Set<string> =>
  new Set(fold(s).split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w)))
const STOP = new Set(['the', 'and', 'from', 'with', 'for', 'your', 'you', 'hotel', 'airport', 'tour', 'transfer', 'pvt', 'private', 'sic', 'pickup', 'drop'])

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  a.forEach(w => { if (b.has(w)) inter++ })
  return inter / (a.size + b.size - inter)
}

const clockMin = (t: string | null | undefined): number | null => {
  const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/)
  return m ? +m[1] * 60 + +m[2] : null
}

// ── Mapping a sheet line onto a chart movement ───────────────────────────────

export type FieldKey = 'location' | 'fromPoint' | 'toPoint' | 'details' | 'mealPlan' | 'meetingTime' | 'serviceType' | 'driver'

export const FIELD_LABELS: Record<FieldKey, string> = {
  location: 'Location', fromPoint: 'From', toPoint: 'To / Activity', details: 'Details',
  mealPlan: 'Meal plan', meetingTime: 'Meeting time', serviceType: 'Service type', driver: 'Driver / vendor',
}

const oneLine = (s: string | null | undefined) => String(s ?? '').replace(/\s*\n\s*/g, ', ').trim()

/**
 * What the sheet says each field should hold. Empty = the sheet is silent on it.
 *
 * Meeting time is deliberately always empty: the desk owns meeting times in OPS
 * and the Excel MC must never write them — not on Excel MC Generate, not on the
 * auto-update, not on a row added from the sheet. Empty means "never touched"
 * everywhere downstream. The sheet's time is still read (`line.time`) to pair
 * sheet rows with chart movements and to order them; it is just never copied.
 */
export function sheetValues(line: McSheetLine): Record<FieldKey, string> {
  return {
    location:    oneLine(line.location),
    fromPoint:   oneLine(line.from),
    toPoint:     oneLine(line.to),
    details:     String(line.details ?? '').trim(),
    mealPlan:    String(line.meal ?? '').trim(),
    meetingTime: '',
    serviceType: line.serviceType ?? '',
    driver:      line.driverName && line.driverPhone ? line.driverName : '',
  }
}

function currentValue(item: ChartItemLike, key: FieldKey): string {
  if (key === 'driver') return String(item.assignment?.driverName ?? '').trim()
  return String((item as unknown as Record<string, unknown>)[key] ?? '').trim()
}

/** The comparable form of a field value — what "the same" means for each field. */
export function canon(key: FieldKey, v: string | null | undefined): string {
  const s = String(v ?? '').trim()
  if (key === 'meetingTime') {
    const m = clockMin(s)
    return m === null ? fold(s) : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
  }
  if (key === 'serviceType') return s.toUpperCase()
  return fold(s).replace(/[\s,.;]+/g, ' ').trim()
}

function sameValue(key: FieldKey, a: string, b: string): boolean {
  if (key === 'driver') {
    const digits = (s: string) => s.replace(/\D/g, '')
    return fold(a) === fold(b) || (digits(a).length >= 9 && digits(a) === digits(b))
  }
  return canon(key, a) === canon(key, b)
}

/** "The sheet once put value V into field F of a movement on date D." */
export function valueKey(key: FieldKey, date: string, v: string | null | undefined): string {
  return fingerprint([key, date.slice(0, 10), canon(key, v)])
}

/** Fields the auto-update keeps in step. Drivers belong to VN Driver Sync; meeting time belongs to OPS. */
export const AUTO_FIELDS: Exclude<FieldKey, 'driver' | 'meetingTime'>[] = ['location', 'fromPoint', 'toPoint', 'details', 'mealPlan', 'serviceType']

/** The valueKeys of everything a sheet line says. */
export function lineValueKeys(line: McSheetLine): string[] {
  if (!line.date) return []
  const sv = sheetValues(line)
  return AUTO_FIELDS.filter(k => sv[k]).map(k => valueKey(k, line.date!, sv[k]))
}

/** A brand-new chart movement from a sheet line. */
export function itemFromLine<T extends ChartItemLike>(line: McSheetLine, base: (fields: ChartItemLike) => T): T {
  const v = sheetValues(line)
  const serviceType = v.serviceType || 'PVT_TRANSFER'
  const isHotelOnly = serviceType === 'ACCOMMODATION'
  return base({
    date: line.date ?? '',
    location: v.location, fromPoint: v.fromPoint, toPoint: v.toPoint, details: v.details,
    mealPlan: v.mealPlan, meetingTime: v.meetingTime, timeFrom: '', timeTo: '',
    serviceType, isLeisure: false, isHotelOnly,
    assignment: v.driver && !isHotelOnly ? { driverName: line.driverName, driverPhone: line.driverPhone } : null,
  })
}

// ── Plan: the sheet against the chart ────────────────────────────────────────

export type PlanKind = 'NEW' | 'CHANGED' | 'SAME' | 'SYSTEM_ONLY'

export interface FieldDiff {
  key: FieldKey
  current: string
  sheet: string
  defaultOn: boolean
  /** Why it is unticked, or why it cannot be applied. */
  note?: string
  /** Cannot be applied (a directory driver, a no-driver movement). */
  locked?: boolean
}

export interface PlanRow {
  id: string
  kind: PlanKind
  date: string
  line: McSheetLine | null
  /** Index into the chart on screen (CHANGED / SAME / SYSTEM_ONLY). */
  index: number | null
  fields: FieldDiff[]
  /** The sheet row changed (or appeared) since the chart was last saved from the sheet. */
  sheetUpdated: boolean
  defaultOn: boolean
  note?: string
  score?: number
}

export interface PlanSummary {
  NEW: number; CHANGED: number; SAME: number; SYSTEM_ONLY: number
  /** Sheet rows changed since the last import that still differ from the chart. */
  pendingUpdates: number
}

function pairScore(line: McSheetLine, item: ChartItemLike): number {
  const a = words([line.location, line.from, line.to, String(line.details ?? '').slice(0, 300)].join(' '))
  const b = words([item.location, item.fromPoint, item.toPoint, String(item.details ?? '').slice(0, 300)].join(' '))
  let score = jaccard(a, b)
  const routeA = words([line.from, line.to].join(' '))
  const routeB = words([item.fromPoint, item.toPoint].join(' '))
  score += 0.6 * jaccard(routeA, routeB)
  if (line.serviceType && line.serviceType === item.serviceType) score += 0.2
  const t1 = clockMin(line.time), t2 = clockMin(item.meetingTime)
  if (t1 !== null && t2 !== null) score += Math.abs(t1 - t2) <= 30 ? 0.25 : Math.abs(t1 - t2) <= 120 ? 0.08 : -0.1
  const fl = flightNumbersIn(line.details)
  if (fl.length && flightNumbersIn([item.details, item.toPoint, item.fromPoint].join(' ')).some(f => fl.includes(f))) score += 0.6
  return Math.round(score * 100) / 100
}

/**
 * Pair every sheet line with at most one chart movement on the same date —
 * best score first; a single leftover on each side of a date pairs by date.
 */
function pairUp(lines: McSheetLine[], items: ChartItemLike[]): { pairs: Map<number, { item: number; score: number }>; usedItems: Set<number> } {
  const pairs = new Map<number, { item: number; score: number }>()
  const usedItems = new Set<number>()
  const dates = new Set(lines.map(l => l.date ?? ''))
  dates.forEach(date => {
    const ls = lines.map((l, i) => ({ l, i })).filter(x => (x.l.date ?? '') === date)
    const its = items.map((it, i) => ({ it, i })).filter(x => (x.it.date ?? '').slice(0, 10) === date)
    const cands: { li: number; ii: number; s: number }[] = []
    for (const a of ls) for (const b of its) cands.push({ li: a.i, ii: b.i, s: pairScore(a.l, b.it) })
    cands.sort((x, y) => y.s - x.s)
    for (const c of cands) {
      if (c.s < 0.3) break
      if (pairs.has(c.li) || usedItems.has(c.ii)) continue
      pairs.set(c.li, { item: c.ii, score: c.s }); usedItems.add(c.ii)
    }
    const leftL = ls.filter(x => !pairs.has(x.i))
    const leftI = its.filter(x => !usedItems.has(x.i))
    if (leftL.length === 1 && leftI.length === 1) {
      pairs.set(leftL[0].i, { item: leftI[0].i, score: pairScore(leftL[0].l, leftI[0].it) }); usedItems.add(leftI[0].i)
    }
  })
  return { pairs, usedItems }
}

export function buildPlan(items: ChartItemLike[], lines: McSheetLine[], baseline: McBaseline | null): PlanRow[] {
  const base = baseline ? new Set(baseline.keys) : null
  const seen = new Set(baseline?.vals ?? [])
  const hasVals = seen.size > 0
  const usable = lines.filter(l => l.date)
  const { pairs, usedItems } = pairUp(usable, items)
  const rows: PlanRow[] = []

  usable.forEach((line, li) => {
    const updated = base ? !base.has(line.key) : true
    const p = pairs.get(li)
    if (!p) {
      rows.push({
        id: `n:${line.key}:${li}`, kind: 'NEW', date: line.date!, line, index: null, fields: [],
        sheetUpdated: updated,
        // Imported before and since removed from the chart in OPS — leave it out unless asked.
        defaultOn: updated,
        note: updated ? undefined : 'Was imported before and later removed in OPS — not re-added unless you tick it',
      })
      return
    }
    const item = items[p.item]
    const sv = sheetValues(line)
    const needsDriver = !item.isLeisure && !item.isHotelOnly
    const fields: FieldDiff[] = []
    ;(Object.keys(sv) as FieldKey[]).forEach(key => {
      const sheet = sv[key]
      if (!sheet) return                                   // never blank a field out
      const current = currentValue(item, key)
      if (sameValue(key, current, sheet)) return
      // With value history: a field still holding an earlier sheet value is
      // stale (tick it); a value the sheet never held was typed in OPS (keep).
      const fromSheet = key !== 'driver' && hasVals && (!current || seen.has(valueKey(key, line.date!, current)))
      const opsEdit = key !== 'driver' && hasVals && !fromSheet
      const d: FieldDiff = { key, current, sheet, defaultOn: hasVals && key !== 'driver' ? fromSheet : updated }
      if (opsEdit) d.note = 'Typed in OPS (the Excel never had this value) — kept unless you tick it'
      else if (!d.defaultOn) d.note = 'Unchanged in Excel since the last import — this is an OPS edit, kept'
      if (key === 'driver') {
        if (!needsDriver) { d.locked = true; d.defaultOn = false; d.note = 'Movement needs no driver' }
        else if (item.assignment?.driverId || item.assignment?.vendorId) {
          d.locked = true; d.defaultOn = false; d.note = 'A driver from the directory is allocated — kept'
        }
      }
      if (key === 'details' && d.defaultOn && !fromSheet && current.length > Math.max(80, sheet.length * 2)) {
        d.defaultOn = false
        d.note = 'OPS holds the fuller description — tick to replace it with the sheet text'
      }
      fields.push(d)
    })
    rows.push({
      id: `c:${line.key}:${li}`, kind: fields.length ? 'CHANGED' : 'SAME', date: line.date!, line, index: p.item,
      fields, sheetUpdated: base ? fields.some(f => f.defaultOn) : fields.length > 0, defaultOn: fields.some(f => f.defaultOn), score: p.score,
    })
  })

  items.forEach((item, i) => {
    if (usedItems.has(i)) return
    rows.push({
      id: `s:${item.id ?? i}`, kind: 'SYSTEM_ONLY', date: (item.date ?? '').slice(0, 10), line: null, index: i,
      fields: [], sheetUpdated: false, defaultOn: false,
      note: item.assignment?.driverId ? 'Has a directory driver allocated' : undefined,
    })
  })

  const order: Record<PlanKind, number> = { CHANGED: 0, NEW: 1, SAME: 2, SYSTEM_ONLY: 3 }
  return rows.sort((a, b) =>
    a.date.localeCompare(b.date)
    || (clockMin(a.line?.time ?? (a.index !== null ? items[a.index]?.meetingTime : null)) ?? 9999)
     - (clockMin(b.line?.time ?? (b.index !== null ? items[b.index]?.meetingTime : null)) ?? 9999)
    || order[a.kind] - order[b.kind])
}

export function summarise(plan: PlanRow[]): PlanSummary {
  const s: PlanSummary = { NEW: 0, CHANGED: 0, SAME: 0, SYSTEM_ONLY: 0, pendingUpdates: 0 }
  for (const r of plan) {
    s[r.kind]++
    if ((r.kind === 'CHANGED' || r.kind === 'NEW') && r.sheetUpdated) s.pendingUpdates++
  }
  return s
}

// ── Selection → the chart to save ────────────────────────────────────────────

export interface PlanSelection {
  /** NEW / CHANGED: apply it. SYSTEM_ONLY: remove it from the chart. */
  rows: Record<string, boolean>
  /** CHANGED rows: per field. */
  fields: Record<string, Partial<Record<FieldKey, boolean>>>
}

export function defaultSelection(plan: PlanRow[], mirror: boolean): PlanSelection {
  const sel: PlanSelection = { rows: {}, fields: {} }
  for (const r of plan) {
    if (r.kind === 'SYSTEM_ONLY') sel.rows[r.id] = mirror && !r.note
    else if (r.kind === 'SAME') sel.rows[r.id] = false
    else sel.rows[r.id] = r.defaultOn
    if (r.kind === 'CHANGED') {
      sel.fields[r.id] = {}
      for (const f of r.fields) sel.fields[r.id][f.key] = !f.locked && f.defaultOn
    }
  }
  return sel
}

export interface ApplyResult<T> { items: T[]; added: number; updated: number; removed: number; fieldsChanged: number }

export function applyPlan<T extends ChartItemLike>(
  items: T[], plan: PlanRow[], sel: PlanSelection, makeNew: (line: McSheetLine) => T,
): ApplyResult<T> {
  const next = items.map(x => ({ ...x, assignment: x.assignment ? { ...x.assignment } : x.assignment })) as T[]
  const drop = new Set<number>()
  let updated = 0, fieldsChanged = 0
  for (const r of plan) {
    if (r.kind === 'SYSTEM_ONLY' && sel.rows[r.id] && r.index !== null) drop.add(r.index)
    if (r.kind !== 'CHANGED' || !sel.rows[r.id] || r.index === null || !r.line) continue
    const it = next[r.index]
    let touched = false
    for (const f of r.fields) {
      if (f.locked || !sel.fields[r.id]?.[f.key]) continue
      touched = true; fieldsChanged++
      if (f.key === 'driver') {
        it.assignment = { ...(it.assignment ?? {}), driverName: r.line.driverName, driverPhone: r.line.driverPhone }
      } else if (f.key === 'serviceType') {
        it.serviceType = f.sheet
        if (f.sheet === 'ACCOMMODATION') { it.isHotelOnly = true; it.isLeisure = false }
      } else {
        (it as unknown as Record<string, unknown>)[f.key] = f.sheet
      }
    }
    if (touched) updated++
  }

  // Keep the chart's own order; slot each new movement into its day by time.
  const kept = next.filter((_, i) => !drop.has(i))
  const fresh = plan.filter(r => r.kind === 'NEW' && sel.rows[r.id] && r.line).map(r => makeNew(r.line!))
  const out: T[] = [...kept]
  for (const n of fresh) {
    const t = clockMin(n.meetingTime)
    let at = out.length
    for (let i = 0; i < out.length; i++) {
      const d = (out[i].date ?? '').slice(0, 10)
      if (d > n.date) { at = i; break }
      if (d === n.date && t !== null) {
        const ti = clockMin(out[i].meetingTime)
        if (ti !== null && ti > t) { at = i; break }
      }
    }
    out.splice(at, 0, n)
  }
  // A chart can arrive unsorted by date; days are always shown in order.
  const sorted = out.map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x.date ?? '').slice(0, 10).localeCompare((b.x.date ?? '').slice(0, 10)) || a.i - b.i)
    .map(o => o.x)
  return { items: sorted, added: fresh.length, updated, removed: drop.size, fieldsChanged }
}

// ── Sanity checks shown above the review ─────────────────────────────────────

export interface McCheck { level: 'ok' | 'warn' | 'info'; text: string }

export function buildChecks(
  booking: {
    paxAdults: number; paxChildren: number; paxInfants: number
    arrivalDate?: string | null; departureDate?: string | null
    flights?: { flightNo: string; date?: string | null }[]
  } | null,
  lines: McSheetLine[],
): McCheck[] {
  const out: McCheck[] = []
  if (!lines.length) return out
  if (booking) {
    const ad = lines.map(l => firstInt(l.adults)).find(n => n !== null) ?? null
    const ch = lines.map(l => firstInt(l.children)).find(n => n !== null) ?? null
    if (ad !== null || ch !== null) {
      const sysCh = (booking.paxChildren ?? 0) + (booking.paxInfants ?? 0)
      const okAd = ad === null || ad === booking.paxAdults
      const okCh = ch === null || ch === sysCh
      out.push(okAd && okCh
        ? { level: 'ok', text: `Pax match the booking (${booking.paxAdults} adult${booking.paxAdults === 1 ? '' : 's'}${sysCh ? `, ${sysCh} child/infant` : ''})` }
        : { level: 'warn', text: `Pax differ — sheet: ${ad ?? '?'} adult, ${ch ?? 0} child · booking: ${booking.paxAdults} adult, ${sysCh} child/infant` })
    }
    const from = booking.arrivalDate?.slice(0, 10), to = booking.departureDate?.slice(0, 10)
    if (from && to) {
      const outside = lines.filter(l => l.date && (l.date < from || l.date > to))
      out.push(outside.length
        ? { level: 'warn', text: `${outside.length} sheet row(s) fall outside the trip (${from} → ${to}): ${Array.from(new Set(outside.map(l => l.date))).join(', ')}` }
        : { level: 'ok', text: 'Every sheet date sits inside the trip window' })
    }
    const sysFlights = new Set((booking.flights ?? []).map(f => normFlight(f.flightNo)))
    const sheetFlights = new Set(lines.flatMap(l => flightNumbersIn(l.details)))
    if (sheetFlights.size) {
      const unknown = Array.from(sheetFlights).filter(f => !sysFlights.has(f))
      const missing = Array.from(sysFlights).filter(f => !sheetFlights.has(f))
      if (unknown.length) out.push({ level: 'warn', text: `Sheet flights not on the booking: ${unknown.join(', ')}` })
      if (missing.length) out.push({ level: 'info', text: `Booking flights the sheet doesn't mention: ${missing.join(', ')}` })
      if (!unknown.length && !missing.length) out.push({ level: 'ok', text: `Flights agree (${Array.from(sheetFlights).join(', ')})` })
    }
  }
  const undated = lines.filter(l => !l.date).length
  if (undated) out.push({ level: 'warn', text: `${undated} sheet row(s) have no readable date and are skipped` })
  const noTime = lines.filter(l => l.date && !l.time).length
  if (noTime) out.push({ level: 'info', text: `${noTime} row(s) have no meeting time in the sheet` })
  const noPhone = lines.filter(l => l.date && l.serviceType !== 'ACCOMMODATION' && !l.driverPhone).length
  if (noPhone) out.push({ level: 'info', text: `${noPhone} row(s) have no driver / vendor phone in the sheet yet` })
  return out
}

// ── Auto-update (background) ─────────────────────────────────────────────────

export interface AutoChange { index: number; field: Exclude<FieldKey, 'driver'>; from: string; to: string }

export interface AutoPlan {
  /** Fields to refresh: the chart still holds sheet data there (or nothing). */
  changes: AutoChange[]
  /** Rows that appeared in the Excel since the last build. */
  creates: McSheetLine[]
  /** The Excel changed a field someone had edited in OPS — the OPS value stays. */
  keptOps: AutoChange[]
  /** Chart movements built from the sheet that the Excel no longer has (never removed automatically). */
  notInSheet: number[]
}

/**
 * What the background auto-update may do to a chart that was built from the
 * Excel — and nothing more. Rules:
 *   - a field is refreshed only when the chart still holds a value the sheet
 *     put there before (or is empty) — an OPS edit is never overwritten;
 *   - a field is never blanked (an empty sheet cell is ignored);
 *   - drivers are not touched (VN Driver Sync owns them);
 *   - a row new in the Excel is added; a row the Excel dropped is only reported;
 *   - a row the Excel had before but OPS deleted is not brought back.
 */
export function autoPlan(items: ChartItemLike[], lines: McSheetLine[], baseline: McBaseline): AutoPlan {
  const seen = new Set(baseline.vals ?? [])
  const keys = new Set(baseline.keys)
  const usable = lines.filter(l => l.date)
  const { pairs, usedItems } = pairUp(usable, items)
  const out: AutoPlan = { changes: [], creates: [], keptOps: [], notInSheet: [] }

  usable.forEach((line, li) => {
    const p = pairs.get(li)
    if (!p) {
      if (!keys.has(line.key)) out.creates.push(line)
      return
    }
    const item = items[p.item]
    const date = (item.date ?? '').slice(0, 10)
    const sv = sheetValues(line)
    for (const field of AUTO_FIELDS) {
      const to = sv[field]
      if (!to) continue
      const from = currentValue(item, field)
      if (sameValue(field, from, to)) continue
      const fromSheet = !from || seen.has(valueKey(field, date, from))
      if (fromSheet) out.changes.push({ index: p.item, field, from, to })
      else if (!keys.has(line.key)) out.keptOps.push({ index: p.item, field, from, to })
    }
  })

  items.forEach((item, i) => {
    if (usedItems.has(i)) return
    const date = (item.date ?? '').slice(0, 10)
    const sheetMade = (['toPoint', 'details'] as const).some(f => item[f] && seen.has(valueKey(f, date, item[f])))
    if (sheetMade) out.notInSheet.push(i)
  })
  return out
}
