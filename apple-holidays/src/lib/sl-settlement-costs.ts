/**
 * The settlement register's shared vocabulary — the words, not the data.
 *
 * ---- Why this is a file of its own ----
 *
 * `sl-transport-actuals.ts` owns the settlement *row*: reading it, writing it,
 * and the rules about who may change what. To do that it opens the accounts
 * MySQL connection, which drags in `net` and `tls` — so anything that imports
 * it is a server module, and importing it from a `'use client'` page fails the
 * build outright rather than at runtime.
 *
 * The register screen needs none of that. It needs the three cost types, their
 * labels, and the two normalisers — a handful of strings that are pure by
 * nature and belong to both sides. They live here so the browser can read them
 * without dragging a database driver into the bundle, and so there is still
 * exactly one definition of them: the server module re-exports these rather
 * than keeping a second copy that would drift.
 *
 * Keep every value here character-for-character identical to
 * `SlTransportSettlementRequest::COST_TYPES` and its two normalisers on the
 * accounts side. Both systems write the same columns, so a fourth cost type
 * invented on one side reads as an unknown one on the other.
 */

/**
 * Where a booking's settlement stands.
 *
 *   draft      figures saved on the Drive Log; nobody else has seen them.
 *   pending    submitted; waiting for Payable 1.0.
 *   recorded   a settlement was made against it.
 *   rejected   an accounts user sent it back, with a reason.
 *   cancelled  the desk withdrew it before it was acted on.
 */
export type ActualsStatus = 'draft' | 'pending' | 'recorded' | 'rejected' | 'cancelled'

/**
 * What the driver is being settled for.
 *
 * The workbook has carried this as a free-typed word for years and the three
 * values below are every one it has ever held. Kept closed so the register can
 * group and total by it; anything unrecognised is stored as null rather than
 * invented, because a mis-typed cost type silently in the wrong subtotal is
 * worse than an empty cell.
 */
export type SettlementCostType = 'transport' | 'transport_entrance' | 'transfer'

export const COST_TYPES: SettlementCostType[] = ['transport', 'transport_entrance', 'transfer']

export const COST_TYPE_LABEL: Record<SettlementCostType, string> = {
  transport:          'Transport',
  transport_entrance: 'Transport + Entrance',
  transfer:           'Transfer',
}

/** The stored value for a cost type, or null when it is not one we know. */
export function toCostType(value: string | null | undefined): SettlementCostType | null {
  // A run of spaces and pluses collapses to one underscore, so "Transport +
  // Entrance", "transport+entrance" and the stored "transport_entrance" are all
  // the same cost type.
  const v = String(value ?? '').trim().toLowerCase().replace(/[\s+]+/g, '_')
  return (COST_TYPES as string[]).includes(v) ? (v as SettlementCostType) : null
}

/**
 * A bulk number, normalised.
 *
 * Upper-cased and stripped of everything but letters, digits and a dash, so
 * "503", " 503 " and "503 " are one bulk rather than three. Empty means the
 * booking is not in a bulk, which is a normal state and not an error.
 */
export function toBulkNo(value: string | null | undefined): string | null {
  const v = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
  return v === '' ? null : v.slice(0, 32)
}
