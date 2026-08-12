/**
 * Hotel name normalisation and fuzzy matching.
 *
 * Booking documents spell hotels however the agent felt like that morning:
 * "Cinnamon Grand Colombo", "CINNAMON GRAND, COLOMBO", "Cinnamon Grand Hotel".
 * The Accounts master list (`invoice_processor.hotel_details`) has its own
 * spellings, including rows imported straight off a filename — the live data
 * genuinely contains "3 Arch Resort Ella.Pdf".
 *
 * Pure functions only, no I/O — so both the server matcher and any client-side
 * preview can share exactly the same scoring.
 */

/** Words that carry no identity — dropped before comparison. */
const NOISE_WORDS = new Set([
  'hotel', 'hotels', 'resort', 'resorts', 'spa', 'the', 'a', 'an', 'and',
  'by', 'at', 'of', 'inn', 'lodge', 'suites', 'suite', 'villa', 'villas',
  'bungalow', 'bungalows', 'guest', 'guesthouse', 'house', 'residency',
  'residence', 'apartments', 'apartment', 'ltd', 'pvt', 'private', 'limited',
  'collection', 'group', 'chain', 'property', 'boutique', 'luxury',
])

/** File extensions that leaked into imported supplier names. */
const FILE_EXT_RE = /\.(pdf|docx?|xlsx?|csv|jpe?g|png|txt)$/i

/**
 * Canonical comparison form: lowercase, accents folded, punctuation removed,
 * trailing file extension stripped, whitespace collapsed.
 *
 * Keeps noise words — those are only dropped at the token stage, because
 * "The Villa" would otherwise normalise to nothing.
 */
export function normalizeHotelName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .replace(FILE_EXT_RE, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Identity tokens: normalised words with noise removed (falls back to all). */
export function hotelTokens(raw: string | null | undefined): string[] {
  const words = normalizeHotelName(raw).split(' ').filter(Boolean)
  const meaningful = words.filter(w => !NOISE_WORDS.has(w) && w.length > 1)
  return meaningful.length > 0 ? meaningful : words
}

/**
 * Membership lookup for a list of strings.
 *
 * A plain object rather than a `Set` because the project's TypeScript target
 * predates iterable `Set`s; the `$` prefix keeps keys clear of `Object`
 * prototype names like "constructor".
 */
type Bag = Record<string, true>

function bag(values: string[]): { map: Bag; size: number } {
  const map: Bag = Object.create(null) as Bag
  let size = 0
  for (const v of values) {
    if (!map[v]) { map[v] = true; size++ }
  }
  return { map, size }
}

/** Distinct character bigrams of a string, used for Dice similarity. */
function bigrams(s: string): { map: Bag; size: number } {
  const t = s.replace(/\s/g, '')
  const grams: string[] = []
  for (let i = 0; i < t.length - 1; i++) grams.push(t.slice(i, i + 2))
  return bag(grams)
}

/** Sørensen–Dice coefficient over character bigrams. 0…1. */
function dice(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0
  let shared = 0
  for (const g of Object.keys(A.map)) if (B.map[g]) shared++
  return (2 * shared) / (A.size + B.size)
}

/** Jaccard overlap of two token sets. 0…1. */
function jaccard(a: string[], b: string[]): number {
  const A = bag(a)
  const B = bag(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const t of Object.keys(A.map)) if (B.map[t]) inter++
  return inter / (A.size + B.size - inter)
}

/** True when every token of the shorter name appears in the longer one. */
function containment(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length === 0) return false
  const L = bag(long)
  return short.every(t => !!L.map[t])
}

export type MatchReason =
  | 'exact'
  | 'exact-tokens'
  | 'contained'
  | 'strong-similarity'
  | 'partial-similarity'

export interface HotelMatchScore {
  /** 0…1. */
  score: number
  reason: MatchReason
  /** Human-readable chips for the UI, e.g. ["same tokens", "city matches"]. */
  signals: string[]
}

/**
 * Score how likely two hotel names are the same property.
 *
 * The blend is deliberate: token overlap catches word reordering and dropped
 * noise words, character bigrams catch typos and truncation. Whichever is
 * higher wins, so neither failure mode alone sinks a real match.
 */
export function scoreHotelNames(a: string, b: string): HotelMatchScore {
  const na = normalizeHotelName(a)
  const nb = normalizeHotelName(b)
  const signals: string[] = []

  if (!na || !nb) return { score: 0, reason: 'partial-similarity', signals }

  if (na === nb) return { score: 1, reason: 'exact', signals: ['identical name'] }

  const ta = hotelTokens(a)
  const tb = hotelTokens(b)

  if (ta.length > 0 && ta.join(' ') === tb.join(' ')) {
    return { score: 0.98, reason: 'exact-tokens', signals: ['same words, different wording'] }
  }

  const j = jaccard(ta, tb)
  const d = dice(na, nb)

  if (containment(ta, tb)) {
    signals.push('one name contains the other')
    // A one-token containment ("Grand" in "Grand Oriental") is weak evidence;
    // scale with how much of the longer name is actually covered.
    const cover = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length)
    return { score: Math.min(0.96, 0.78 + cover * 0.18), reason: 'contained', signals }
  }

  const score = Math.max(j, d)
  if (j > 0) signals.push(`${Math.round(j * 100)}% word overlap`)
  if (d > 0) signals.push(`${Math.round(d * 100)}% spelling similarity`)

  return {
    score,
    reason: score >= 0.7 ? 'strong-similarity' : 'partial-similarity',
    signals,
  }
}

/** At or above this, the match is treated as certain and linked automatically. */
export const AUTO_LINK_THRESHOLD = 0.93
/** Below this a candidate is not worth showing at all. */
export const SUGGEST_THRESHOLD = 0.45

export interface HotelCandidate {
  name: string
  city?: string | null
  [k: string]: unknown
}

export interface RankedCandidate<T extends HotelCandidate> {
  candidate: T
  score: number
  reason: MatchReason
  signals: string[]
  /** Rounded 0–100 for display. */
  confidence: number
}

/** Remove the words of `city` from a hotel name. */
function stripCityWords(name: string, cityTokens: string[]): string {
  if (cityTokens.length === 0) return name
  const drop = bag(cityTokens)
  const kept = normalizeHotelName(name).split(' ').filter(w => w && !drop.map[w])
  // Never strip a name down to nothing — "Colombo Hotel" in Colombo still needs
  // something to compare.
  return kept.length > 0 ? kept.join(' ') : name
}

/**
 * Rank master-list candidates against a booking's hotel name.
 *
 * Two things the naive score gets wrong, both fixed here:
 *
 *  - **The city is often baked into the name.** "Cinnamon Grand" on the booking
 *    and "Cinnamon Grand Colombo" in the master list are the same property, but
 *    the extra token costs the candidate points. So each pair is scored twice —
 *    as written, and with the city's words removed from both — and the better
 *    of the two wins.
 *  - **A matching city is evidence, not identity.** It adds a small bonus and a
 *    visible signal, but can never promote a name that did not already match.
 */
export function rankHotelCandidates<T extends HotelCandidate>(
  query: string,
  city: string | null | undefined,
  candidates: T[],
  limit = 8,
): RankedCandidate<T>[] {
  const qCity = normalizeHotelName(city)
  const cityTokens = qCity ? qCity.split(' ').filter(Boolean) : []

  return candidates
    .map(candidate => {
      let best = scoreHotelNames(query, candidate.name)

      if (cityTokens.length > 0) {
        const withoutCity = scoreHotelNames(
          stripCityWords(query, cityTokens),
          stripCityWords(candidate.name, cityTokens),
        )
        if (withoutCity.score > best.score) {
          best = { ...withoutCity, signals: [...withoutCity.signals, 'ignoring the city in the name'] }
        }
      }

      const signals = [...best.signals]
      let score = best.score

      if (qCity && candidate.city) {
        const cCity = normalizeHotelName(candidate.city)
        if (cCity && (cCity === qCity || cCity.includes(qCity) || qCity.includes(cCity))) {
          signals.push('city matches')
          score = Math.min(1, score + 0.05)
        }
      }

      return {
        candidate,
        score,
        reason: best.reason,
        signals,
        confidence: Math.round(score * 100),
      }
    })
    .filter(r => r.score >= SUGGEST_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
