/**
 * Manual-edit tracking for a booking's **Package Details & Notes** text, and
 * the AppleSystem conflicts it produces.
 *
 * The problem this solves: those fields have two authors. AppleSystem sends
 * `terms`, `packageIncludes`, `packageExcludes` and `valueAddedServices` with
 * every quotation, and ops type corrections into the same boxes on the booking
 * page. Before this, the next "Fetch Data from API" silently overwrote whatever
 * had been typed, because `setText` in `as-booking-sync.ts` only asks whether
 * upstream sent something — not whether a human had already fixed it.
 *
 * So a field that a person edited by hand is *marked*, and from then on a sync
 * will not overwrite it silently. It records the upstream value as a **pending
 * conflict** instead, and someone decides: **replace** (take AppleSystem's text
 * and drop the mark) or **skip** (keep what was typed). Nothing is written
 * until that decision is made.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * Both the marks and the pending conflicts live in `system_settings` as JSON —
 * deliberately **no schema change and no migration**, the same choice
 * `as-booking-sync.ts` made for its sync marker, because the live database
 * carries drift and must never be pushed to.
 *
 *   booking_field_edits:<bookingRef>   → which fields a human edited, and when
 *   as_sync_conflicts:<bookingRef>     → upstream values awaiting a decision
 *
 * A booking that has never been hand-edited has neither row, and every read
 * here degrades to "no marks" — so an absent or corrupt row can only ever make
 * a sync behave the way it did before, never worse.
 */

import { prisma } from '@/lib/prisma'

// ── Which fields this covers ─────────────────────────────────────────────────

/** Every free-text field in the "Package Details & Notes" card, in card order. */
export const PACKAGE_NOTE_FIELDS = [
  'valueAddedServices',
  'packageIncludes',
  'packageExcludes',
  'terms',
  'exclusions',
  'policyNotes',
  'importantNotes',
  'tips',
  'otherNote',
  'clientRequest',
] as const

export type PackageNoteField = (typeof PACKAGE_NOTE_FIELDS)[number]

/**
 * The subset AppleSystem actually sends (see `as-booking-map.ts`).
 *
 * Only these four can ever conflict — the other six exist solely in this system,
 * so a sync has no opinion about them and never touches them either way.
 */
export const AS_SOURCED_NOTE_FIELDS: readonly PackageNoteField[] = [
  'terms',
  'packageIncludes',
  'packageExcludes',
  'valueAddedServices',
]

/** Human labels, shared by the booking page, the sync modal and the audit log. */
export const NOTE_FIELD_LABELS: Record<PackageNoteField, string> = {
  valueAddedServices: 'Value Added Services',
  packageIncludes:    'Above Package Includes',
  packageExcludes:    'The Above Package Excludes',
  terms:              'Terms & Conditions',
  exclusions:         'Exclusions',
  policyNotes:        'Policy Notes',
  importantNotes:     'Important Notes',
  tips:               'Tips',
  otherNote:          'Other Note',
  clientRequest:      'Client Request',
}

export function isPackageNoteField(v: string): v is PackageNoteField {
  return (PACKAGE_NOTE_FIELDS as readonly string[]).includes(v)
}

// ── Keys ─────────────────────────────────────────────────────────────────────

export const FIELD_EDIT_PREFIX = 'booking_field_edits:'
export const SYNC_CONFLICT_PREFIX = 'as_sync_conflicts:'

export function fieldEditKey(bookingRef: string): string {
  return `${FIELD_EDIT_PREFIX}${bookingRef}`
}

export function syncConflictKey(bookingRef: string): string {
  return `${SYNC_CONFLICT_PREFIX}${bookingRef}`
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/** One hand-edited field: when, by whom, and what was saved. */
export interface FieldEdit {
  /** ISO timestamp of the edit. */
  at: string
  /** Display name of whoever saved it. */
  by: string
  /** The value that was saved, so a later sync can tell an edit from a drift. */
  value: string | null
}

/** Hand-edited fields for one booking, keyed by column name. */
export type FieldEdits = Partial<Record<PackageNoteField, FieldEdit>>

/** One upstream value that a sync refused to apply over a hand-edit. */
export interface SyncConflict {
  field: PackageNoteField
  /** What the booking holds now — the hand-edited text. */
  stored: string | null
  /** What AppleSystem sent on the run that raised this. */
  incoming: string
  /** When the hand-edit was made, and by whom. */
  editedAt: string
  editedBy: string
}

/** Conflicts from the most recent sync, waiting for a replace/skip decision. */
export interface PendingConflicts {
  /** ISO timestamp of the sync that raised them. */
  at: string
  quotationNo: string | null
  revision: number | null
  items: SyncConflict[]
}

// ── Edit marks ───────────────────────────────────────────────────────────────

function parse<T>(value: string, ok: (v: unknown) => boolean): T | null {
  try {
    const parsed = JSON.parse(value)
    return ok(parsed) ? (parsed as T) : null
  } catch {
    return null
  }
}

/** Hand-edited note fields for one booking; `{}` when it has never been edited. */
export async function getFieldEdits(bookingRef: string): Promise<FieldEdits> {
  const row = await prisma.systemSetting.findUnique({ where: { key: fieldEditKey(bookingRef) } })
  if (!row) return {}
  const parsed = parse<FieldEdits>(row.value, (v) => !!v && typeof v === 'object')
  if (!parsed) return {}
  // Drop anything that is no longer a field we track, so a renamed column can
  // never leave an unclearable mark behind.
  const out: FieldEdits = {}
  for (const [field, edit] of Object.entries(parsed)) {
    if (isPackageNoteField(field) && edit && typeof (edit as FieldEdit).at === 'string') {
      out[field] = edit as FieldEdit
    }
  }
  return out
}

/**
 * Mark fields as hand-edited. Merges into whatever is already recorded, so
 * editing one field never clears the mark on another.
 */
export async function recordFieldEdits(
  bookingRef: string,
  edits: { field: PackageNoteField; value: string | null }[],
  by: string,
): Promise<void> {
  if (edits.length === 0) return
  const current = await getFieldEdits(bookingRef)
  const at = new Date().toISOString()
  for (const e of edits) current[e.field] = { at, by, value: e.value }
  await writeFieldEdits(bookingRef, current)
}

/**
 * Drop the marks on `fields` — AppleSystem is authoritative for them again.
 *
 * Called when someone resolves a conflict with "replace": upstream won, so the
 * stored text is no longer a hand-edit and later syncs should flow normally.
 */
export async function clearFieldEdits(
  bookingRef: string,
  fields: PackageNoteField[],
): Promise<void> {
  if (fields.length === 0) return
  const current = await getFieldEdits(bookingRef)
  let touched = false
  for (const f of fields) {
    if (current[f]) {
      delete current[f]
      touched = true
    }
  }
  if (touched) await writeFieldEdits(bookingRef, current)
}

async function writeFieldEdits(bookingRef: string, edits: FieldEdits): Promise<void> {
  const key = fieldEditKey(bookingRef)
  if (Object.keys(edits).length === 0) {
    await prisma.systemSetting.deleteMany({ where: { key } })
    return
  }
  const value = JSON.stringify(edits)
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

// ── Pending conflicts ────────────────────────────────────────────────────────

/** Conflicts awaiting a decision, or null when there are none. */
export async function getPendingConflicts(bookingRef: string): Promise<PendingConflicts | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: syncConflictKey(bookingRef) } })
  if (!row) return null
  const parsed = parse<PendingConflicts>(
    row.value,
    (v) => !!v && typeof v === 'object' && Array.isArray((v as PendingConflicts).items),
  )
  if (!parsed) return null
  const items = parsed.items.filter((i) => i && isPackageNoteField(i.field) && typeof i.incoming === 'string')
  return items.length > 0 ? { ...parsed, items } : null
}

/**
 * Replace the pending set for a booking.
 *
 * Deliberately a replace, not a merge: the conflicts describe *one* upstream
 * snapshot, and keeping an older run's values around would let someone accept
 * text that AppleSystem has since changed.
 */
export async function writePendingConflicts(
  bookingRef: string,
  pending: PendingConflicts | null,
): Promise<void> {
  const key = syncConflictKey(bookingRef)
  if (!pending || pending.items.length === 0) {
    await prisma.systemSetting.deleteMany({ where: { key } })
    return
  }
  const value = JSON.stringify(pending)
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/** Remove the named fields from the pending set, deleting the row when empty. */
export async function clearPendingConflicts(
  bookingRef: string,
  fields: PackageNoteField[],
): Promise<void> {
  const pending = await getPendingConflicts(bookingRef)
  if (!pending) return
  const remaining = pending.items.filter((i) => !fields.includes(i.field))
  await writePendingConflicts(bookingRef, remaining.length > 0 ? { ...pending, items: remaining } : null)
}
