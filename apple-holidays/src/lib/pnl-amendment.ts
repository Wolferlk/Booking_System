/**
 * PNL amendment helpers — pure functions, safe to import on client or server.
 *
 * Accounts PNL records for the SAME booking may arrive as amendments whose
 * `is_number` (or tour_ref / invoice_number) carries a revision suffix:
 *
 *   VN40035           ← original / base
 *   VN40035_R2/R2     ← amendment
 *   VN40035_R2/R3     ← amendment
 *   VN40035_R3/R3     ← latest amendment
 *
 * These all belong to booking VN40035. This module extracts the base ref,
 * ranks revisions, and picks the "latest" version.
 *
 * "Latest" rule (product decision): highest revision number in the suffix,
 * tie-broken by newest record id in the Accounts DB.
 */

export interface AmendmentInfo {
  /** Normalized base ref, upper-cased, suffix stripped. e.g. "VN40035" */
  base: string
  /** Revision rank for ordering — 0 for the base (no suffix), else the
   *  highest integer found in the suffix (R2/R3 → 3, R3/R3 → 3, R2/R2 → 2). */
  revision: number
  /** Suffix label, upper-cased, e.g. "R2/R3". null for the base record. */
  label: string | null
  /** True when a revision suffix is present. */
  isAmendment: boolean
}

/** Strip a trailing separator and normalize casing/whitespace. */
function normalizeBase(s: string): string {
  return s.trim().toUpperCase().replace(/[_\s-]+$/, '')
}

/**
 * Parse a PNL reference into its base + amendment info.
 * Matches a base followed by a separator and an `R<digits>…` suffix.
 */
export function parseAmendment(raw: string | null | undefined): AmendmentInfo {
  const s = (raw ?? '').trim()
  if (!s) return { base: '', revision: 0, label: null, isAmendment: false }

  // base + (_ | space | -) + R<digits>...   e.g. "VN40035_R2/R3"
  const m = s.match(/^(.+?)[_\s-]+(R\d+.*)$/i)
  if (!m) return { base: normalizeBase(s), revision: 0, label: null, isAmendment: false }

  const base = normalizeBase(m[1])
  const label = m[2].trim().toUpperCase()
  const nums = (label.match(/\d+/g) ?? []).map(Number)
  const revision = nums.length ? Math.max(...nums) : 1
  return { base, revision, label, isAmendment: true }
}

/** Convenience: just the normalized base ref. */
export function amendmentBase(raw: string | null | undefined): string {
  return parseAmendment(raw).base
}

/**
 * Sort a list of records latest-first by (revision desc, id desc).
 * `getRef` reads the reference field that carries the suffix (e.g. is_number).
 * Returns a NEW array — does not mutate the input.
 */
export function sortLatestFirst<T>(
  records: readonly T[],
  getRef: (r: T) => string | null | undefined,
  getId: (r: T) => number,
): T[] {
  return [...records].sort((a, b) => {
    const dr = parseAmendment(getRef(b)).revision - parseAmendment(getRef(a)).revision
    if (dr !== 0) return dr
    return getId(b) - getId(a)
  })
}

/** Pick the latest version from a list, or null if empty. */
export function pickLatest<T>(
  records: readonly T[],
  getRef: (r: T) => string | null | undefined,
  getId: (r: T) => number,
): T | null {
  if (records.length === 0) return null
  return sortLatestFirst(records, getRef, getId)[0]
}
