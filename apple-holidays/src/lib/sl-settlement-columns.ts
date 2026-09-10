/**
 * The Driver Settlement Register's columns, as data.
 *
 * ---- Why this exists ----
 *
 * The register began as a fixed table: seventeen columns in the order the old
 * workbook printed them. But the workbook was never one sheet — the desk kept a
 * settlement layout, accounts kept a payment layout, and the bulk meetings ran
 * off a third with the budget columns hidden and the phone numbers showing. A
 * fixed table forces all three to read the one that suits none of them.
 *
 * So the columns live here as a catalogue, and what a person actually sees is a
 * *view*: an ordered list of column ids, each with an optional renamed heading.
 * The screen renders the view, and so do the workbook and the PDF — one
 * definition, three outputs, and a download that looks like the screen it came
 * from because it is built from the same list.
 *
 * ---- What a column knows ----
 *
 * Enough to be rendered, sorted, totalled and exported without the caller
 * knowing which column it is holding: its heading, which side its figures sit
 * on, what kind of value it carries (`kind`, which decides the formatting in
 * all three outputs), the register sort field it maps to if it can be sorted,
 * and the totals key it sums into if it is money. Nothing here renders anything
 * — no JSX, because the workbook and the PDF are built on the server and must
 * import the same catalogue the screen does.
 *
 * ---- What is derived here, and what is not ----
 *
 * A handful of columns are computed in `columnValue()` rather than read off the
 * row: total paid, the cost per head, the package measured against the budget.
 * They are arithmetic over figures the row already carries, which is the only
 * kind of derivation allowed on this screen — nothing here costs a booking, and
 * a column that needed a database would belong in the register's API instead.
 */

import {
  REGISTER_STATE_LABEL, amount, bracketed, percent, workbookDate,
  type RegisterRow, type RegisterSortField, type RegisterTotals,
} from './sl-settlement-register'

// ── The catalogue ─────────────────────────────────────────────────────────────

/**
 * How a column's value is formatted, everywhere it is shown.
 *
 *   text     a name, a reference, a note.
 *   money    a figure with two decimals; negatives in brackets.
 *   outflow  money that left the building — shown negative, as the workbook does.
 *   int      a whole number.
 *   date     a day, printed the workbook's way ("27/Aug/2026").
 *   percent  a share, with its own sign convention.
 *   stamp    a date and time, for an audit column.
 *   status   the register state — a badge on screen, a word everywhere else.
 *   flag     yes / no.
 */
export type RegisterColumnKind =
  | 'text' | 'money' | 'outflow' | 'int' | 'date' | 'percent' | 'stamp' | 'status' | 'flag'

/** The sections the column picker groups its list under. */
export type RegisterColumnGroup = 'Tour' | 'People' | 'Money' | 'Settlement'

export interface RegisterColumnDef {
  id: string
  /** The heading as it ships. A view may rename it; nothing else may. */
  label: string
  /** The hover note explaining what the figure is. Renaming never changes it. */
  title?: string
  kind: RegisterColumnKind
  group: RegisterColumnGroup
  /** The register sort field, when this column can be sorted by. */
  sort?: RegisterSortField
  /** The totals key this column sums into, when a total means anything. */
  total?: keyof RegisterTotals
  /** Roughly how wide, in characters — used by the workbook and the PDF only. */
  width?: number
  /**
   * True when the value is worked out here rather than read off the row. Marked
   * so the picker can say so: a derived column cannot be edited anywhere, and a
   * person hunting for the place to correct it should not be sent looking.
   */
  derived?: boolean
}

const RIGHT: RegisterColumnKind[] = ['money', 'outflow', 'int', 'percent']

/** True when this kind of value is set to the right, in every output. */
export const isNumericKind = (k: RegisterColumnKind) => RIGHT.includes(k)

/**
 * Every column the register can show.
 *
 * Order here is the order the picker lists them in, not the order they are
 * shown in — that is the view's business.
 */
export const REGISTER_COLUMNS: RegisterColumnDef[] = [
  // ── Tour ──
  { id: 'bulk',       label: 'Bulk',        title: 'The payment run this tour is settled in', kind: 'text', group: 'Tour', sort: 'bulk', width: 8 },
  { id: 'tour',       label: 'Tour',        title: 'The IS number, or the booking reference where there is none', kind: 'text', group: 'Tour', sort: 'tour', width: 14 },
  { id: 'isNumber',   label: 'IS number',   kind: 'text', group: 'Tour', width: 14 },
  { id: 'cntlNumber', label: 'CNTL',        title: 'The control number on the tour confirmation', kind: 'text', group: 'Tour', width: 14 },
  { id: 'bookingRef', label: 'Booking ref', kind: 'text', group: 'Tour', width: 14 },
  { id: 'date',       label: 'Date',        title: 'The arrival day this window was drawn on', kind: 'date', group: 'Tour', sort: 'date', width: 13 },
  { id: 'year',       label: 'Y',           title: 'Arrival year', kind: 'int', group: 'Tour', width: 6 },
  { id: 'month',      label: 'M',           title: 'Arrival month', kind: 'int', group: 'Tour', width: 5 },
  { id: 'day',        label: 'D',           title: 'Arrival day', kind: 'int', group: 'Tour', width: 5 },
  { id: 'nights',     label: 'Nights',      kind: 'int', group: 'Tour', width: 7 },
  { id: 'pax',        label: 'Pax',         kind: 'int', group: 'Tour', width: 6 },
  { id: 'costType',   label: 'Cost type',   title: 'What the tour is being settled for', kind: 'text', group: 'Tour', width: 16 },
  { id: 'currency',   label: 'Currency',    title: 'The currency the figures are in — rupees unless no rate resolved', kind: 'text', group: 'Tour', width: 9 },

  // ── People ──
  { id: 'chauffeur',      label: 'Chauffeur',   kind: 'text', group: 'People', sort: 'chauffeur', width: 20 },
  { id: 'chauffeurPhone', label: 'Chauffeur phone', kind: 'text', group: 'People', width: 15 },
  { id: 'vendorName',     label: 'Vendor',      title: 'The supplier the vehicle came from, where no chauffeur is named', kind: 'text', group: 'People', width: 18 },
  { id: 'acName',         label: 'A/C Name',    title: 'The agent the tour was sold through', kind: 'text', group: 'People', sort: 'agent', width: 22 },
  { id: 'clientName',     label: 'Client',      kind: 'text', group: 'People', width: 22 },
  { id: 'fileHandler',    label: 'File handler', kind: 'text', group: 'People', width: 16 },

  // ── Money ──
  { id: 'packageCost',      label: 'Package cost',        title: 'The package figure typed on the transport settlement sheet in the Drive Log', kind: 'money', group: 'Money', sort: 'package', total: 'packageCost', width: 15 },
  { id: 'totalCost',        label: 'Total transport cost', title: 'What the transport actually came to', kind: 'money', group: 'Money', sort: 'cost', total: 'totalCost', width: 16 },
  { id: 'derivedTotalCost', label: 'Costed total',        title: 'What the accounts system derived, before any correction the desk made', kind: 'money', group: 'Money', width: 15 },
  { id: 'advanceDue',       label: 'Advance due',         title: 'The envelope the tour was due at the start', kind: 'money', group: 'Money', total: 'advanceDue', width: 14 },
  { id: 'advancePaid',      label: 'Advance paid',        title: 'Of that envelope, what has actually been handed over', kind: 'outflow', group: 'Money', sort: 'advance', total: 'advancePaid', width: 14 },
  { id: 'advancePending',   label: 'Advance pending',     title: 'Advance due less advance handed over — promised and not yet paid', kind: 'money', group: 'Money', total: 'advancePending', width: 15 },
  { id: 'balancePayable',   label: 'Balance payable',     title: 'Package cost less the advance already handed over', kind: 'money', group: 'Money', sort: 'balance', total: 'balancePayable', width: 15 },
  { id: 'restPaid',         label: 'Rest paid',           title: 'Of the balance, what accounts has already released', kind: 'outflow', group: 'Money', total: 'restPaid', width: 13 },
  { id: 'restOutstanding',  label: 'Still to release',    title: 'Balance payable less the rest already released', kind: 'money', group: 'Money', total: 'restOutstanding', width: 15 },
  { id: 'paidTotal',        label: 'Total paid',          title: 'Advance handed over plus rest released', kind: 'money', group: 'Money', width: 13, derived: true },
  { id: 'budgetedCost',     label: 'Budgeted cost',       title: 'What the desk planned this tour at', kind: 'money', group: 'Money', sort: 'budget', total: 'budgetedCost', width: 14 },
  { id: 'excess',           label: 'Excess / (shortage)', title: 'Package cost less what the transport actually cost', kind: 'money', group: 'Money', sort: 'excess', total: 'excess', width: 16 },
  { id: 'variancePct',      label: '%',                   title: 'Excess as a share of the package cost', kind: 'percent', group: 'Money', sort: 'variancePct', width: 8 },
  { id: 'budgetVariance',   label: 'Vs budget',           title: 'Budgeted cost less what the transport actually cost — the old variance, kept for the desks that plan on it', kind: 'money', group: 'Money', width: 13, derived: true },
  { id: 'costPerPax',       label: 'Cost per pax',        title: 'Total transport cost divided by the pax on the file', kind: 'money', group: 'Money', width: 12, derived: true },

  // ── Settlement ──
  { id: 'status',        label: 'Status',        title: 'Where this row stands in the register', kind: 'status', group: 'Settlement', width: 13 },
  { id: 'approval',      label: 'P&L approval',  title: 'Accounts cannot release against an unapproved P&L', kind: 'text', group: 'Settlement', width: 12 },
  { id: 'settled',       label: 'Settled',       title: 'Nothing left to pay on this booking', kind: 'flag', group: 'Settlement', width: 8 },
  { id: 'recordedBatchRef', label: 'Batch ref',  title: 'The accounts batch the rest payment was released in', kind: 'text', group: 'Settlement', width: 14 },
  { id: 'submittedAt',   label: 'Submitted',     title: 'When this row was sent to accounts', kind: 'stamp', group: 'Settlement', width: 16 },
  { id: 'recordedAt',    label: 'Recorded',      title: 'When accounts released against it', kind: 'stamp', group: 'Settlement', width: 16 },
  { id: 'remarks',       label: 'Remark',        kind: 'text', group: 'Settlement', width: 26 },
  { id: 'note',          label: 'Note',          title: 'The desk’s own note on the figures', kind: 'text', group: 'Settlement', width: 26 },
  { id: 'decisionNote',  label: 'Accounts note', title: 'What accounts said when they sent it back', kind: 'text', group: 'Settlement', width: 26 },
  { id: 'message',       label: 'Why no figures', title: 'Why a row carries no money, when it carries none', kind: 'text', group: 'Settlement', width: 26 },
]

export const COLUMN_BY_ID: Record<string, RegisterColumnDef> =
  Object.fromEntries(REGISTER_COLUMNS.map(c => [c.id, c]))

/** The register as it ships — the old fixed table, in its old order. */
export const DEFAULT_COLUMN_IDS: string[] = [
  'bulk', 'tour', 'date', 'year', 'month', 'day', 'chauffeur', 'acName',
  'packageCost', 'totalCost', 'advancePaid', 'balancePayable', 'budgetedCost',
  'excess', 'variancePct', 'status', 'remarks',
]

// ── Views ─────────────────────────────────────────────────────────────────────

export interface RegisterViewColumn {
  id: string
  /** The heading this view calls it. Null or absent keeps the shipped label. */
  label?: string | null
}

export interface RegisterView {
  id: string
  name: string
  columns: RegisterViewColumn[]
  /**
   * The filters this view was saved with, when it was saved with them. A view
   * is usually a layout, but "Bulk 503, settled, by chauffeur" is a *place* and
   * saving the layout without the filters would only get you half way there.
   */
  query?: Record<string, string> | null
  /** Opened by default when the screen loads. At most one view carries it. */
  isDefault?: boolean
  updatedAt?: string
}

export const MAX_VIEWS = 24
const MAX_NAME = 60
const MAX_LABEL = 40

/** The shipped layout, as a view — what "Reset" restores and what a fresh user gets. */
export function defaultView(): RegisterView {
  return {
    id: 'default',
    name: 'Register (default)',
    columns: DEFAULT_COLUMN_IDS.map(id => ({ id })),
  }
}

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''

/**
 * A view off the wire, made safe to render.
 *
 * Anything stored is untrusted: it was written by an older build of this
 * screen, or hand-edited in the settings table, and it has to survive a column
 * being renamed or retired between releases. Unknown ids are dropped rather
 * than rendered as blank columns, duplicates collapse, and a view that ends up
 * with nothing in it falls back to the shipped layout — an empty table is not a
 * customisation, it is a broken screen.
 */
export function normaliseView(raw: unknown, fallbackId = 'view'): RegisterView {
  const v = (raw ?? {}) as Partial<RegisterView>
  const seen = new Set<string>()
  const columns: RegisterViewColumn[] = []

  for (const c of Array.isArray(v.columns) ? v.columns : []) {
    const id = typeof c === 'string' ? c : clean((c as RegisterViewColumn)?.id, 40)
    if (!id || seen.has(id) || !COLUMN_BY_ID[id]) continue
    seen.add(id)
    const label = typeof c === 'string' ? '' : clean((c as RegisterViewColumn)?.label, MAX_LABEL)
    columns.push(label && label !== COLUMN_BY_ID[id].label ? { id, label } : { id })
  }

  return {
    id: clean(v.id, 40) || fallbackId,
    name: clean(v.name, MAX_NAME) || 'Untitled view',
    columns: columns.length > 0 ? columns : defaultView().columns,
    query: v.query && typeof v.query === 'object' && !Array.isArray(v.query)
      ? Object.fromEntries(
          Object.entries(v.query as Record<string, unknown>)
            .filter(([k, val]) => typeof k === 'string' && typeof val === 'string')
            .slice(0, 30)
            .map(([k, val]) => [k.slice(0, 30), String(val).slice(0, 200)]),
        )
      : null,
    isDefault: v.isDefault === true,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : undefined,
  }
}

/** A whole saved set, made safe — and capped, so one user cannot fill the table. */
export function normaliseViews(raw: unknown): RegisterView[] {
  if (!Array.isArray(raw)) return []
  const out: RegisterView[] = []
  const ids = new Set<string>()
  let defaulted = false

  for (const item of raw.slice(0, MAX_VIEWS)) {
    const v = normaliseView(item, `view-${out.length + 1}`)
    if (ids.has(v.id)) v.id = `${v.id}-${out.length + 1}`
    ids.add(v.id)
    // Exactly one default, whatever the stored file claims.
    if (v.isDefault && defaulted) v.isDefault = false
    if (v.isDefault) defaulted = true
    out.push(v)
  }
  return out
}

/**
 * A view's columns, resolved against the catalogue.
 *
 * The renamed heading is applied here and nowhere else, so a column that has
 * been renamed still sorts, totals and formats as itself. `title` is
 * deliberately kept from the catalogue: a heading the desk renamed to "Driver
 * rate" should still explain, on hover, which figure it actually is.
 */
export function resolveColumns(view: RegisterView): RegisterColumnDef[] {
  return view.columns
    .map(c => {
      const def = COLUMN_BY_ID[c.id]
      if (!def) return null
      return c.label && c.label !== def.label ? { ...def, label: c.label } : def
    })
    .filter((c): c is RegisterColumnDef => c !== null)
}

// ── Values ────────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * One cell's value, unformatted.
 *
 * Numbers come back as numbers so the workbook can write a real numeric cell
 * and the accountant can total the column without retyping it; everything the
 * screen and the PDF need on top of that is formatting, which `columnText()`
 * does. Null means "not known", which is never the same as zero.
 */
export function columnValue(row: RegisterRow, id: string): string | number | null {
  switch (id) {
    case 'bulk':        return row.bulkNo
    case 'tour':        return row.tour
    case 'isNumber':    return row.isNumber
    case 'cntlNumber':  return row.cntlNumber
    case 'bookingRef':  return row.bookingRef
    case 'date':        return row.date
    case 'year':        return row.year
    case 'month':       return row.month
    case 'day':         return row.day
    case 'nights':      return row.nights
    case 'pax':         return row.pax
    case 'costType':    return row.costTypeLabel
    case 'currency':    return row.lkrAvailable ? row.currency : `${row.currency} (no rate)`

    case 'chauffeur':      return row.chauffeur ?? row.vendorName
    case 'chauffeurPhone': return row.chauffeurPhone
    case 'vendorName':     return row.vendorName
    case 'acName':         return row.acName
    case 'clientName':     return row.clientName
    case 'fileHandler':    return row.fileHandler

    case 'packageCost':      return row.packageCost
    case 'totalCost':        return row.totalCost
    case 'derivedTotalCost': return row.derivedTotalCost
    case 'advanceDue':       return row.advanceDue
    case 'advancePaid':      return row.advancePaid
    case 'advancePending':   return row.advancePending
    case 'balancePayable':   return row.balancePayable
    case 'restPaid':         return row.restPaid
    case 'restOutstanding':  return row.restOutstanding
    case 'budgetedCost':     return row.budgetedCost
    case 'excess':           return row.excess
    case 'variancePct':      return row.variancePct

    // Derived. Arithmetic over figures the row already carries — nothing here
    // reaches for a rate or a P&L line.
    case 'paidTotal':
      return isNum(row.advancePaid) || isNum(row.restPaid)
        ? round2((row.advancePaid ?? 0) + (row.restPaid ?? 0))
        : null
    case 'budgetVariance':
      return isNum(row.budgetedCost) && isNum(row.totalCost)
        ? round2(row.budgetedCost - row.totalCost)
        : null
    case 'costPerPax':
      return isNum(row.totalCost) && row.pax > 0 ? round2(row.totalCost / row.pax) : null

    case 'status':           return REGISTER_STATE_LABEL[row.state]
    case 'approval':         return row.payable ? 'Approved' : row.approval
    case 'settled':          return row.settled ? 'Yes' : 'No'
    case 'recordedBatchRef': return row.recordedBatchRef
    case 'submittedAt':      return row.submittedAt
    case 'recordedAt':       return row.recordedAt
    case 'remarks':          return row.remarks
    case 'note':             return row.note
    case 'decisionNote':     return row.decisionNote
    case 'message':          return row.message
    default:                 return null
  }
}

/** A timestamp the way every other sheet in this system prints one. */
export function stamp(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { hour12: false })
}

/**
 * One cell as text — the CSV, the PDF and the workbook's non-numeric cells.
 *
 * `blank` decides what "not known" looks like: an em dash on paper, where a gap
 * would read as zero, and an empty string in a CSV, where an em dash would be
 * something the accountant has to delete before summing.
 */
export function columnText(row: RegisterRow, col: RegisterColumnDef, blank = ''): string {
  const v = columnValue(row, col.id)
  if (v === null || v === undefined || v === '') return blank

  switch (col.kind) {
    case 'money':   return bracketed(v as number)
    case 'outflow': return v === 0 ? amount(0) : bracketed(-(v as number))
    case 'percent': return percent(v as number)
    case 'date':    return workbookDate(String(v))
    case 'stamp':   return stamp(String(v)) || blank
    default:        return String(v)
  }
}

/**
 * The subtotal under a column, or null where a total would be a lie.
 *
 * Only columns that name a totals key get one. A percentage is the exception:
 * it is re-derived over the group rather than added up, because summing
 * percentages produces a number that is not a percentage of anything.
 */
export function columnTotal(totals: RegisterTotals, col: RegisterColumnDef): number | null {
  if (col.id === 'variancePct') return totals.variancePct
  if (!col.total) return null
  const v = totals[col.total]
  return typeof v === 'number' ? v : null
}
