/**
 * The pure half of the product catalogue: reading a worksheet's cells into
 * products, and ranking products against what an operator typed or against a
 * movement's activity text. No database, no network — so it can be exercised
 * against the real sheet without touching either.
 */
import { cleanProductName, productKeyFor, searchForm, tokens, type IncludeProduct } from './shared'

export type Cell = string | number | boolean | null

// ── Reading a tab ────────────────────────────────────────────────────────────

/** Where the columns we need sit on a tab, read from its header row. */
interface Columns { header: number; code: number; name: number; count: number; price: number }

function findColumns(values: Cell[][]): Columns | null {
  for (let r = 0; r < Math.min(values.length, 5); r++) {
    const row = values[r].map(c => searchForm(String(c ?? '')))
    const code = row.findIndex(c => c === 'code' || c === 'category' || c === 'type')
    const name = row.findIndex(c => /payment|detail|product|service|activity|description/.test(c))
    if (code === -1 || name === -1) continue
    return {
      header: r,
      code,
      name,
      count: row.findIndex(c => c === 'count' || c === 'qty' || c === 'times'),
      price: row.findIndex(c => /lowest|minimum|\bmin\b|price|rate|cost/.test(c)),
    }
  }
  return null
}

function toNumber(cell: Cell): number | null {
  if (cell === null || cell === '' || typeof cell === 'boolean') return null
  const n = typeof cell === 'number' ? cell : Number(String(cell).replace(/[,\s₫]/g, '').replace(/vnd/i, ''))
  return Number.isFinite(n) ? n : null
}

export interface ParsedRow {
  productKey: string; code: string; name: string; rawName: string
  usageCount: number; minPriceVnd: number | null; sheetRow: number
}

/**
 * A worksheet's used range → one row per distinct product. `firstRow` is the
 * sheet row the range starts on, so `sheetRow` points at the real row.
 */
export function parseTab(values: Cell[][], firstRow: number): ParsedRow[] {
  const cols = findColumns(values)
  if (!cols) return []
  const byKey = new Map<string, ParsedRow>()
  for (let r = cols.header + 1; r < values.length; r++) {
    const row = values[r]
    const code = String(row[cols.code] ?? '').trim()
    const rawName = String(row[cols.name] ?? '')
    const name = cleanProductName(rawName)
    if (!code || name.length < 2) continue
    const key = productKeyFor(code, name)
    const count = cols.count >= 0 ? Math.max(0, Math.round(toNumber(row[cols.count]) ?? 0)) : 0
    const price = cols.price >= 0 ? toNumber(row[cols.price]) : null
    const seen = byKey.get(key)
    if (seen) {
      // The sheet lists some products twice (once per spelling it was paid
      // under). One product, so: counts add up, the lowest price stands.
      seen.usageCount += count
      if (price !== null && (seen.minPriceVnd === null || price < seen.minPriceVnd)) seen.minPriceVnd = price
      continue
    }
    byKey.set(key, {
      productKey: key, code: code.slice(0, 64), name, rawName,
      usageCount: count, minPriceVnd: price, sheetRow: firstRow + r,
    })
  }
  return Array.from(byKey.values())
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export interface CatalogEntry extends IncludeProduct {
  searchText: string
  toks: string[]
}

export function toEntry(p: IncludeProduct, searchText?: string): CatalogEntry {
  const text = searchText ?? searchForm(`${p.code} ${p.name}`)
  return { ...p, searchText: text, toks: text.split(' ').filter(Boolean) }
}

/** Popularity nudges a tie; it never outranks a better match. */
const popularity = (n: number) => Math.min(0.08, Math.log10(1 + n) * 0.03)

function publicProduct(p: CatalogEntry, score?: number): IncludeProduct {
  const { searchText: _s, toks: _t, ...rest } = p
  return score === undefined ? rest : { ...rest, score: Math.round(score * 1000) / 1000 }
}

/**
 * Picker search. Every word typed has to match the start of a word in the
 * product (so "hal cru" finds "Halong … Cruise"); the whole phrase appearing
 * verbatim and a well-used product both lift a result.
 */
export function rankSearch(
  rows: CatalogEntry[],
  query: string,
  opts: { code?: string; limit?: number } = {},
): IncludeProduct[] {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 60)
  const code = opts.code?.trim().toLowerCase()
  const pool = rows.filter(p => !code || p.code.toLowerCase() === code)
  const q = searchForm(query)
  const words = q.split(' ').filter(Boolean)

  if (!words.length) {
    return pool
      .slice().sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, limit).map(p => publicProduct(p))
  }

  const scored: { p: CatalogEntry; s: number }[] = []
  for (const p of pool) {
    let hit = 0
    let exact = 0
    for (const w of words) {
      if (p.toks.includes(w)) { hit++; exact++ }
      else if (p.toks.some(t => t.startsWith(w))) hit++
      else if (w.length >= 4 && p.searchText.includes(w)) hit++
      else break
    }
    if (hit < words.length) continue
    let s = 0.55 + 0.25 * (exact / words.length)
    if (p.searchText.includes(q)) s += 0.12
    // Shorter names that match fully are closer to what was asked for.
    s += 0.05 * Math.min(1, words.length / Math.max(1, p.toks.length))
    s += popularity(p.usageCount)
    scored.push({ p, s })
  }

  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p, s }) => publicProduct(p, Math.min(1, s)))
}

/** Words that name the bundle's shape rather than a part of it. */
const GENERIC = new Set(['sic', 'pvt', 'private', 'shared', 'transfer', 'transfers', 'tour', 'trans', 'ticket', 'basis', 'standard', 'day', 'full', 'half'])

/**
 * Products that look like the parts of a movement, from its activity text.
 *
 * The activity is cut where a bundle joins its parts ("+", "&", "with",
 * "incl.", commas) and each part is matched on its own, as well as the whole —
 * so "SIC - 4 Island tour + cable car + Local lunch" proposes the island tour,
 * the cable car ticket and a lunch, not just whatever best matches all of it.
 *
 * Match quality is a balanced overlap (F-measure) of meaningful words. Words
 * that only describe the bundle's shape ("SIC", "private", "transfers") count
 * for little, so two products are not proposed merely for both being private
 * transfers. Nothing weaker than `minScore` is proposed: a wrong suggestion
 * costs the operator more than a missing one.
 */
export function rankSuggestions(
  rows: CatalogEntry[],
  activity: string,
  opts: { limit?: number; minScore?: number } = {},
): IncludeProduct[] {
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 20)
  const minScore = opts.minScore ?? 0.5
  const text = activity.trim()
  if (!text) return []

  const parts = [text, ...text.split(/\s*(?:\+|&|,|\/|\||\bwith\b|\bincl\.?\b|\bincluding\b|\band\b|\s-\s|:)\s*/i)]
    .map(s => s.trim())
    .filter((s, i, all) => s.length >= 3 && all.indexOf(s) === i)

  const weight = (t: string) => (GENERIC.has(t) ? 0.25 : 1)
  const best = new Map<string, { p: CatalogEntry; s: number }>()

  for (const part of parts) {
    const want = Array.from(new Set(tokens(part)))
    const wantWeight = want.reduce((n, w) => n + weight(w), 0)
    // A part made only of shape words ("Private Transfers") names nothing.
    if (!want.length || want.every(w => GENERIC.has(w))) continue

    for (const p of rows) {
      const have = Array.from(new Set(tokens(p.name).filter(t => t.length > 1)))
      if (!have.length) continue
      let common = 0
      for (const w of want) {
        // Exact word, or — for words long enough not to collide — the same
        // stem ("cruise"/"cruises", "island"/"islands").
        const match = have.includes(w)
          || (w.length >= 5 && have.some(t => t.startsWith(w) || (t.length >= 5 && w.startsWith(t))))
        if (match) common += weight(w)
      }
      if (!common) continue
      const haveWeight = have.reduce((n, t) => n + weight(t), 0)
      const recall = common / wantWeight
      const precision = common / Math.max(1, haveWeight)
      const f = (2 * recall * precision) / (recall + precision)
      const s = f + popularity(p.usageCount)
      if (s < minScore) continue
      const prev = best.get(p.productKey)
      if (!prev || prev.s < s) best.set(p.productKey, { p, s })
    }
  }

  return Array.from(best.values())
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p, s }) => publicProduct(p, Math.min(1, s)))
}
