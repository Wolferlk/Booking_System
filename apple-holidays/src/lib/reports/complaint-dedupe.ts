/**
 * Complaint de-duplication — collapse repeated alerts into one issue.
 *
 * `tbl_te_important_alerts` is written one row per *call* × category
 * (`uk_schedule_cat`), so a guest who raises the same problem on three
 * consecutive TE calls produces three rows. The auto-report was printing all
 * three, which buried the real issue count and made the section read like the
 * same complaint on a loop.
 *
 * The fix is a merge, never a drop. Repeats are evidence, not noise: an issue
 * that keeps coming back on call after call is *more* urgent than a one-off, so
 * every raw row survives inside the cluster's `trail` and the card shows how
 * many times it was raised. Nothing is deleted, in the report or in the DB —
 * this is a pure, read-only reshaping of rows already fetched.
 *
 * How two rows are judged "the same issue":
 *  1. **Subject gate** — they must belong to the same guest. Booking ref first;
 *     failing that a normalised customer name. Rows with neither can never
 *     merge, because two anonymous "hotel" alerts may be two different hotels.
 *  2. **Text similarity** — titles and details are normalised (case, accents,
 *     punctuation, stop-words, and the guest's own ref/name stripped, since
 *     those repeat in every row and would inflate every score) and compared on
 *     both token overlap and character trigrams. Either signal may carry the
 *     match: token overlap catches re-phrasing, trigrams catch typos and
 *     morphology. Containment handles the common case where a later call
 *     restates an earlier complaint with more detail.
 *  3. **Category** decides the bar, not the verdict. Same category is the
 *     ordinary case and merges on a moderate score; a cross-category merge
 *     ("hotel" vs "general" for one broken air-conditioner) needs near-identical
 *     text before it is allowed.
 *
 * Merge is worst-case-wins so nothing is softened by being folded together:
 * highest severity, still open unless *every* occurrence closed, earliest raise
 * time for age, latest for recency, and the richest text of the group as the
 * description an operator reads.
 */

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** Same category: the ordinary "he said it again on the next call" merge. */
const SAME_CATEGORY_THRESHOLD = 0.52
/** Different category: only near-identical wording is one issue in two labels. */
const CROSS_CATEGORY_THRESHOLD = 0.82
/** A short complaint fully restated inside a longer one is the same complaint. */
const CONTAINMENT_THRESHOLD = 0.8
/** Below this many tokens a text is too thin to judge on overlap alone. */
const MIN_TOKENS_FOR_OVERLAP = 2

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * Words that carry no complaint-specific meaning. Deliberately small: over-
 * stripping makes unrelated complaints look alike, which is the expensive
 * mistake here — a wrong merge hides a real issue, a missed merge only repeats.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'call', 'client',
  'customer', 'did', 'do', 'does', 'for', 'from', 'guest', 'had', 'has', 'have', 'he',
  'her', 'his', 'in', 'is', 'it', 'its', 'me', 'mr', 'mrs', 'ms', 'not', 'of', 'on',
  'or', 'our', 'said', 'says', 'she', 'so', 'that', 'the', 'their', 'them', 'they',
  'this', 'to', 'told', 'up', 'us', 'very', 'was', 'we', 'were', 'what', 'when',
  'which', 'who', 'will', 'with', 'would', 'you', 'your',
])

// ─── Shape the module works on ────────────────────────────────────────────────

/**
 * The subset of a complaint row this module needs. Kept structural rather than
 * importing `ComplaintLine` so the merge logic stays testable without a DB and
 * without a cycle back into `report-data`.
 */
export interface DedupableComplaint {
  id: string
  bookingRef: string | null
  customerName: string | null
  category: string
  severity: 'high' | 'medium' | 'low'
  status: string
  title: string | null
  details: string | null
  customerQuote: string | null
  resolutionNote: string | null
  resolvedAt: string | null
  createdAt: string
  resolutionHours: number | null
}

/** One raw alert row folded into a cluster — the audit trail behind a card. */
export interface ComplaintOccurrence {
  id: string
  createdAt: string
  status: string
  severity: string
  category: string
}

/** What a merged complaint carries on top of the fields it inherits. */
export interface ComplaintRecurrence {
  /** Raw alert rows behind this line; 1 means it was never repeated. */
  occurrences: number
  /** Most recent time this same issue was raised again. */
  lastRaisedAt: string
  /** Every raw row, oldest first. */
  trail: ComplaintOccurrence[]
  /** Distinct categories the agent filed it under, when they disagreed. */
  categories: string[]
}

export type MergedComplaint<T extends DedupableComplaint> = T & ComplaintRecurrence

// ─── Text normalisation ───────────────────────────────────────────────────────

/**
 * Strip a complaint down to the words that describe the problem.
 *
 * The guest's own booking ref and name are removed first: they appear in every
 * row for that guest, and leaving them in would make two unrelated complaints
 * from one booking share tokens they did not earn.
 */
function normalise(text: string, subjectNoise: string[]): string[] {
  let s = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  for (const noise of subjectNoise) {
    if (noise.length >= 3) s = s.split(noise).join(' ')
  }

  return s
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(t =>
      t.length > 1 &&
      !STOP_WORDS.has(t) &&
      // Bare numbers (room 302, 3 nights) repeat across unrelated complaints.
      !/^\d+$/.test(t))
}

/** Character trigrams over the joined tokens — catches typos and word endings. */
function trigrams(tokens: string[]): Set<string> {
  const s = ` ${tokens.join(' ')} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
  return out
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  small.forEach(g => { if (large.has(g)) shared++ })
  return (2 * shared) / (a.size + b.size)
}

function overlap(a: Set<string>, b: Set<string>): { jaccard: number; containment: number } {
  if (!a.size || !b.size) return { jaccard: 0, containment: 0 }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  small.forEach(t => { if (large.has(t)) shared++ })
  return {
    jaccard: shared / (a.size + b.size - shared),
    containment: shared / small.size,
  }
}

/** Everything precomputed once per row so an O(n²) bucket stays cheap. */
interface Fingerprint {
  category: string
  tokens: Set<string>
  trigrams: Set<string>
  /** Exact-match key: identical wording merges without scoring. */
  exact: string
}

function fingerprint(c: DedupableComplaint, subjectNoise: string[]): Fingerprint {
  const tokens = normalise(`${c.title ?? ''} ${c.details ?? ''}`, subjectNoise)
  return {
    category: c.category.trim().toLowerCase(),
    tokens: new Set(tokens),
    trigrams: trigrams(tokens),
    exact: tokens.join(' '),
  }
}

/** Does `b` describe the same problem as the cluster represented by `a`? */
function sameIssue(a: Fingerprint, b: Fingerprint): boolean {
  if (a.exact && a.exact === b.exact) return true

  // A row with no usable words can only merge on an identical category — the
  // agent filed it under the same heading for the same guest, and we have
  // nothing else to go on.
  if (!a.tokens.size || !b.tokens.size) return a.category === b.category

  const { jaccard, containment } = overlap(a.tokens, b.tokens)
  const score = Math.max(jaccard, dice(a.trigrams, b.trigrams))
  const bar = a.category === b.category ? SAME_CATEGORY_THRESHOLD : CROSS_CATEGORY_THRESHOLD

  if (score >= bar) return true

  // "AC broken" restated as "AC broken in room 302, guest very upset" is one
  // issue, but only trust containment when the shorter text has real substance.
  const smaller = Math.min(a.tokens.size, b.tokens.size)
  return a.category === b.category &&
    smaller >= MIN_TOKENS_FOR_OVERLAP &&
    containment >= CONTAINMENT_THRESHOLD
}

// ─── Clustering ───────────────────────────────────────────────────────────────

/** The guest a complaint belongs to; `null` means "never merge this row". */
function subjectKey(c: DedupableComplaint): string | null {
  const ref = c.bookingRef?.trim().toUpperCase()
  if (ref) return `ref:${ref}`
  const name = c.customerName?.trim().toLowerCase().replace(/\s+/g, ' ')
  if (name && name.length >= 3) return `name:${name}`
  return null
}

/** Ref and name tokens to strip from the text of this guest's complaints. */
function subjectNoiseOf(c: DedupableComplaint): string[] {
  const noise: string[] = []
  const ref = c.bookingRef?.trim().toLowerCase()
  if (ref) noise.push(ref)
  for (const part of (c.customerName ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 3) noise.push(part)
  }
  return noise
}

interface Cluster<T extends DedupableComplaint> {
  rows: T[]
  prints: Fingerprint[]
}

/**
 * Merge one cluster into the single line an operator should read.
 *
 * Worst-case-wins: folding rows together must never make a problem look smaller
 * or younger than it is.
 */
function collapse<T extends DedupableComplaint>(cluster: Cluster<T>): MergedComplaint<T> {
  const rows = cluster.rows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const first = rows[0]
  const last = rows[rows.length - 1]

  // The row whose description an operator gets the most from.
  const richest = rows.reduce((best, r) =>
    (r.details?.length ?? 0) + (r.title?.length ?? 0) >
    (best.details?.length ?? 0) + (best.title?.length ?? 0) ? r : best, rows[0])

  const worstSeverity = rows.reduce((worst, r) =>
    (SEVERITY_RANK[r.severity] ?? 9) < (SEVERITY_RANK[worst] ?? 9) ? r.severity : worst,
    rows[0].severity)

  // Open unless every single occurrence was closed. One unresolved repeat means
  // the issue is live, whatever the earlier rows say.
  const allResolved = rows.every(r => r.status === 'resolved')
  const resolvedRows = rows.filter(r => r.status === 'resolved' && r.resolvedAt)
  const lastResolved = resolvedRows.length
    ? resolvedRows.reduce((a, b) => (a.resolvedAt! >= b.resolvedAt! ? a : b))
    : null

  // Age runs from the first time the guest raised it, not the last restatement.
  const resolutionHours = allResolved && lastResolved?.resolvedAt
    ? Math.max(0, Math.round(
        ((Date.parse(lastResolved.resolvedAt) - Date.parse(first.createdAt)) / 3_600_000) * 10) / 10)
    : null

  const categories = Array.from(new Set(rows.map(r => r.category)))

  return {
    ...richest,
    id: first.id,
    createdAt: first.createdAt,
    severity: worstSeverity,
    status: allResolved ? 'resolved' : 'open',
    category: first.category,
    customerQuote: rows.find(r => r.customerQuote)?.customerQuote ?? null,
    resolutionNote: allResolved ? (lastResolved?.resolutionNote ?? richest.resolutionNote) : null,
    resolvedAt: allResolved ? (lastResolved?.resolvedAt ?? null) : null,
    resolutionHours,
    occurrences: rows.length,
    lastRaisedAt: last.createdAt,
    trail: rows.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      severity: r.severity,
      category: r.category,
    })),
    categories,
  }
}

/**
 * Collapse repeated alerts into one line per real issue.
 *
 * Input order does not matter; output is oldest-first by the time each issue was
 * *first* raised, which callers then re-sort for display.
 */
export function dedupeComplaints<T extends DedupableComplaint>(rows: T[]): MergedComplaint<T>[] {
  const buckets = new Map<string, Cluster<T>[]>()
  const solo: Cluster<T>[] = []

  // Oldest first so the first row of a cluster is the original complaint and
  // later restatements attach to it, not the other way round.
  const ordered = rows.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  for (const row of ordered) {
    const key = subjectKey(row)
    const print = fingerprint(row, subjectNoiseOf(row))

    if (!key) {
      // No guest to anchor on — stands alone rather than risking a false merge.
      solo.push({ rows: [row], prints: [print] })
      continue
    }

    const clusters = buckets.get(key) ?? []
    // Compare against every row already in a cluster, not just its first: a
    // complaint restated in stages ("AC" → "AC in room 302" → "room 302 hot")
    // chains together even when the ends no longer resemble each other.
    const hit = clusters.find(cl => cl.prints.some(p => sameIssue(p, print)))

    if (hit) {
      hit.rows.push(row)
      hit.prints.push(print)
    } else {
      clusters.push({ rows: [row], prints: [print] })
      buckets.set(key, clusters)
    }
  }

  return [...Array.from(buckets.values()).flat(), ...solo]
    .map(collapse)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
