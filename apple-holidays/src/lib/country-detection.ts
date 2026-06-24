// String-literal type matching Prisma's OperationCountry enum
export type OperationCountry = 'ALL' | 'VIETNAM' | 'SRILANKA' | 'SINGAPORE_MALAYSIA' | 'SINGAPORE' | 'MALAYSIA'

// Singapore and Malaysia are operated by one shared team. They are detected and
// stored separately, but a user assigned any of these three values sees all of
// them. `SINGAPORE_MALAYSIA` is the legacy combined value (kept for old data).
const SG_MY_GROUP: OperationCountry[] = ['SINGAPORE', 'MALAYSIA', 'SINGAPORE_MALAYSIA']

// IS number prefix → country mapping
// VN → Vietnam, IS → Sri Lanka, SG → Singapore, MY → Malaysia
const IS_NUMBER_PATTERNS: { pattern: RegExp; country: OperationCountry }[] = [
  { pattern: /\bVN\s*\d{4,}/i,   country: 'VIETNAM' },
  { pattern: /\bIS\s*\d{4,}/i,   country: 'SRILANKA' },
  { pattern: /\bSG\s*\d{4,}/i,   country: 'SINGAPORE' },
  { pattern: /\bMY\s*\d{4,}/i,   country: 'MALAYSIA' },
]

// Keywords → country mapping (checked in order; first match wins)
const KEYWORD_PATTERNS: { keywords: RegExp; country: OperationCountry }[] = [
  { keywords: /\bviet\s*nam\b|\bvietnam\b|\bvn\b|\bhanoi\b|\bho\s+chi\s+minh\b|\bsaigon\b|\bda\s+nang\b|\bhoi\s+an\b/i, country: 'VIETNAM' },
  { keywords: /\bsri\s*lanka\b|\bsrilanka\b|\bcolombo\b|\bkandy\b|\bsigiriya\b|\bgalle\b|\bnegombo\b/i, country: 'SRILANKA' },
  { keywords: /\bmala[iy]sia\b|\bkuala\s+lumpur\b|\bkl\b|\blangkawi\b|\bpenang\b|\bmalacca\b|\bmelaka\b/i, country: 'MALAYSIA' },
  { keywords: /\bsingapore\b|\bsentosa\b|\bmarina\s+bay\b|\borchard\b|\bclarke\s+quay\b/i, country: 'SINGAPORE' },
]

export function detectCountryFromText(subject: string, body: string): OperationCountry | null {
  const text = `${subject}\n${body.slice(0, 5000)}`

  // First: try IS number prefix (most reliable)
  for (const { pattern, country } of IS_NUMBER_PATTERNS) {
    if (pattern.test(text)) return country
  }

  // Second: keyword matching on subject first, then body
  for (const { keywords, country } of KEYWORD_PATTERNS) {
    if (keywords.test(subject)) return country
  }
  for (const { keywords, country } of KEYWORD_PATTERNS) {
    if (keywords.test(body.slice(0, 5000))) return country
  }

  return null
}

/**
 * Detect country from a OneDrive folder path / breadcrumb / web URL.
 * The MY and SG drives are the same physical OneDrive; bookings are filed under
 * "…/Reservation/Singapore Drive/…" or "…/Malaysia Drive/…", so the folder path
 * is the authoritative signal for which of the two a file belongs to.
 */
export function detectCountryFromPath(path: string | null | undefined): OperationCountry | null {
  if (!path) return null
  // Decode %20 etc. so "Singapore%20Drive" matches
  let text = path
  try { text = decodeURIComponent(path) } catch { /* keep raw */ }
  text = text.toLowerCase()
  if (/\bsingapore\b/.test(text)) return 'SINGAPORE'
  if (/\bmala[iy]sia\b/.test(text)) return 'MALAYSIA'
  if (/\bviet\s*nam\b|\bvietnam\b/.test(text)) return 'VIETNAM'
  if (/\bsri\s*lanka\b|\bsrilanka\b/.test(text)) return 'SRILANKA'
  return null
}

export function detectCountryFromRef(bookingRef: string): OperationCountry | null {
  const ref = bookingRef.trim().toUpperCase()
  if (ref.startsWith('VN')) return 'VIETNAM'
  if (ref.startsWith('IS')) return 'SRILANKA'
  if (ref.startsWith('SG')) return 'SINGAPORE'
  if (ref.startsWith('MY')) return 'MALAYSIA'
  return null
}

/**
 * The set of operationCountry values a user/filter assigned `c` should match.
 * Returns null when no country filter should be applied (ALL / unassigned).
 * Singapore, Malaysia and the legacy combined value all resolve to one group.
 */
export function countryScope(c: OperationCountry | string | null | undefined): OperationCountry[] | null {
  if (!c || c === 'ALL') return null
  if (SG_MY_GROUP.includes(c as OperationCountry)) return [...SG_MY_GROUP]
  return [c as OperationCountry]
}

/** True when `target` booking country is within the `viewer`'s country scope. */
export function isInCountryScope(target: string | null | undefined, viewer: string | null | undefined): boolean {
  const scope = countryScope(viewer)
  return !scope || (target != null && scope.includes(target as OperationCountry))
}

/**
 * Union scope for users assigned multiple countries.
 * `countries` (new multi-country JSON field) takes precedence over single `country`.
 * Returns null when the user sees all countries (ALL or empty assignments).
 */
export function userCountryScope(
  country: string | null | undefined,
  countries: string[] | null | undefined,
): OperationCountry[] | null {
  const list = countries && countries.length > 0 ? countries : country ? [country] : []
  if (list.length === 0 || list.includes('ALL')) return null
  const combined = new Set<OperationCountry>()
  for (const c of list) {
    const scope = countryScope(c)
    if (!scope) return null  // ANY entry = ALL means no filter
    for (const v of scope) combined.add(v)
  }
  return combined.size > 0 ? [...combined] : null
}

export function countryLabel(country: OperationCountry | null | undefined): string {
  switch (country) {
    case 'VIETNAM':            return 'Vietnam'
    case 'SRILANKA':           return 'Sri Lanka'
    case 'SINGAPORE':          return 'Singapore'
    case 'MALAYSIA':           return 'Malaysia'
    case 'SINGAPORE_MALAYSIA': return 'Singapore & Malaysia'
    case 'ALL':                return 'All Countries'
    default:                   return 'Unassigned'
  }
}

export function countryFlag(country: OperationCountry | null | undefined): string {
  switch (country) {
    case 'VIETNAM':            return '🇻🇳'
    case 'SRILANKA':           return '🇱🇰'
    case 'SINGAPORE':          return '🇸🇬'
    case 'MALAYSIA':           return '🇲🇾'
    case 'SINGAPORE_MALAYSIA': return '🇸🇬🇲🇾'
    default:                   return '🌍'
  }
}

export const OPERATION_COUNTRIES: { value: OperationCountry; label: string; flag: string }[] = [
  { value: 'VIETNAM',            label: 'Vietnam',                     flag: '🇻🇳' },
  { value: 'SRILANKA',           label: 'Sri Lanka',                   flag: '🇱🇰' },
  { value: 'SINGAPORE',          label: 'Singapore',                   flag: '🇸🇬' },
  { value: 'MALAYSIA',           label: 'Malaysia',                    flag: '🇲🇾' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia (legacy)', flag: '🇸🇬🇲🇾' },
]
