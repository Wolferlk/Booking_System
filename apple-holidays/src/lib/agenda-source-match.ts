/**
 * Match AppleSystem itinerary entries (the confirmation's official descriptions)
 * to the movements of an agenda chart.
 *
 * Used by the movement editor's "Refresh API" (one movement) and
 * "Confirmation Descriptions" (every movement) so both always pick the same text.
 *
 * Rules, in order:
 *   1. Only entries on the movement's own date are candidates. An entry without
 *      a date is placed by its day number counted from the arrival date.
 *   2. Exact title = the movement's To / Activity → "exact".
 *      One title contains the other                → "exact".
 *      Word overlap with From / To / Location      → "good" (≥ 50 %) or "check".
 *   3. Best pairs are taken first; every entry and every movement is used once.
 *   4. A day left with exactly one movement and one entry pairs them by position
 *      ("check" — a person should look).
 *   Entries still unplaced are returned so nothing is silently dropped.
 *
 * Pure and client-safe.
 */

export interface SourceEntry { dayNo?: number; date?: string; title?: string; description?: string }
export interface MatchableItem { date: string; fromPoint: string; toPoint: string; location: string }
export type MatchConfidence = 'exact' | 'good' | 'check'

export interface SourceMatch {
  /** Index into the agenda items. */
  itemIdx: number
  /** Index into the source entries. */
  sourceIdx: number
  title: string
  description: string
  confidence: MatchConfidence
  /** 0–1, for sorting and display. */
  score: number
}

export interface SourceMatchResult {
  /** By agenda item index; missing = no AppleSystem entry for that movement. */
  byItem: Map<number, SourceMatch>
  /** Entries with a description that no movement took. */
  leftovers: { sourceIdx: number; date: string | null; title: string; description: string }[]
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const STOP = new Set(['the', 'and', 'with', 'for', 'from', 'day', 'tour', 'transfer', 'private', 'sic', 'hotel', 'airport', 'pick', 'drop'])
const tokens = (v: unknown) => new Set(norm(v).split(' ').filter(t => t.length > 2 && !STOP.has(t)))

function shiftDay(isoDate: string, days: number): string | null {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function pairScore(title: string, item: MatchableItem): { score: number; confidence: MatchConfidence } {
  const t = norm(title)
  const to = norm(item.toPoint)
  if (t && to && t === to) return { score: 1, confidence: 'exact' }
  if (t && to && Math.min(t.length, to.length) >= 6 && (t.includes(to) || to.includes(t))) return { score: 0.9, confidence: 'exact' }
  const tt = tokens(title)
  if (!tt.size) return { score: 0, confidence: 'check' }
  const toT = tokens(item.toPoint)
  const restT = tokens(`${item.fromPoint} ${item.location}`)
  let hits = 0
  tt.forEach(w => { if (toT.has(w)) hits += 1; else if (restT.has(w)) hits += 0.5 })
  const score = Math.min(0.85, hits / tt.size)
  return { score, confidence: score >= 0.5 ? 'good' : 'check' }
}

export function matchSourceDescriptions(items: MatchableItem[], sources: SourceEntry[], arrivalDate?: string | null): SourceMatchResult {
  const dateOf = (s: SourceEntry): string | null => {
    const d = String(s.date ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    const n = Number(s.dayNo)
    return arrivalDate && Number.isFinite(n) && n >= 1 ? shiftDay(arrivalDate, n - 1) : null
  }
  const usable = sources
    .map((s, sourceIdx) => ({ sourceIdx, date: dateOf(s), title: String(s.title ?? '').trim(), description: String(s.description ?? '').trim() }))
    .filter(s => s.description)

  // Every same-date pair, best first.
  const pairs: SourceMatch[] = []
  items.forEach((item, itemIdx) => {
    const d = item.date?.slice(0, 10)
    if (!d) return
    for (const s of usable) {
      if (s.date !== d) continue
      const { score, confidence } = pairScore(s.title, item)
      if (score > 0) pairs.push({ itemIdx, sourceIdx: s.sourceIdx, title: s.title, description: s.description, confidence, score })
    }
  })
  pairs.sort((a, b) => b.score - a.score || a.itemIdx - b.itemIdx)

  const byItem = new Map<number, SourceMatch>()
  const usedSource = new Set<number>()
  for (const p of pairs) {
    if (byItem.has(p.itemIdx) || usedSource.has(p.sourceIdx)) continue
    byItem.set(p.itemIdx, p)
    usedSource.add(p.sourceIdx)
  }

  // A day with one movement and one entry left: pair by position, flagged for a look.
  const dates = new Set(items.map(i => i.date?.slice(0, 10)).filter(Boolean))
  dates.forEach(d => {
    const openItems = items.map((it, idx) => ({ it, idx })).filter(x => x.it.date?.slice(0, 10) === d && !byItem.has(x.idx))
    const openSources = usable.filter(s => s.date === d && !usedSource.has(s.sourceIdx))
    if (openItems.length === 1 && openSources.length === 1) {
      const s = openSources[0]
      byItem.set(openItems[0].idx, { itemIdx: openItems[0].idx, sourceIdx: s.sourceIdx, title: s.title, description: s.description, confidence: 'check', score: 0 })
      usedSource.add(s.sourceIdx)
    }
  })

  return {
    byItem,
    leftovers: usable.filter(s => !usedSource.has(s.sourceIdx)).map(s => ({ sourceIdx: s.sourceIdx, date: s.date, title: s.title, description: s.description })),
  }
}

/** Same text apart from spacing — no point offering to "replace" it. */
export const sameDescription = (a: string | null | undefined, b: string | null | undefined) =>
  String(a ?? '').replace(/\s+/g, ' ').trim() === String(b ?? '').replace(/\s+/g, ' ').trim()
