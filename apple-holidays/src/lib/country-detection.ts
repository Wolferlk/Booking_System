// String-literal type matching Prisma's OperationCountry enum
export type OperationCountry = 'ALL' | 'VIETNAM' | 'SRILANKA' | 'SINGAPORE_MALAYSIA'

// IS number prefix → country mapping
// VN → Vietnam, IS → Sri Lanka, SG → Singapore/Malaysia, MY → Malaysia/Singapore
const IS_NUMBER_PATTERNS: { pattern: RegExp; country: OperationCountry }[] = [
  { pattern: /\bVN\s*\d{4,}/i,   country: 'VIETNAM' },
  { pattern: /\bIS\s*\d{4,}/i,   country: 'SRILANKA' },
  { pattern: /\bSG\s*\d{4,}/i,   country: 'SINGAPORE_MALAYSIA' },
  { pattern: /\bMY\s*\d{4,}/i,   country: 'SINGAPORE_MALAYSIA' },
]

// Keywords → country mapping (checked in order; first match wins)
const KEYWORD_PATTERNS: { keywords: RegExp; country: OperationCountry }[] = [
  { keywords: /\bviet\s*nam\b|\bvietnam\b|\bvn\b|\bhanoi\b|\bho\s+chi\s+minh\b|\bsaigon\b|\bda\s+nang\b|\bhoi\s+an\b/i, country: 'VIETNAM' },
  { keywords: /\bsri\s*lanka\b|\bsrilanka\b|\bcolombo\b|\bkandy\b|\bsigiriya\b|\bgalle\b|\bnegombo\b/i, country: 'SRILANKA' },
  { keywords: /\bmala[iy]sia\b|\bkuala\s+lumpur\b|\bkl\b|\blangkawi\b|\bpenang\b|\bmalacca\b|\bmelaka\b/i, country: 'SINGAPORE_MALAYSIA' },
  { keywords: /\bsingapore\b|\bsentosa\b|\bmarina\s+bay\b|\borchard\b|\bclarke\s+quay\b/i, country: 'SINGAPORE_MALAYSIA' },
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

export function detectCountryFromRef(bookingRef: string): OperationCountry | null {
  const ref = bookingRef.trim().toUpperCase()
  if (ref.startsWith('VN')) return 'VIETNAM'
  if (ref.startsWith('IS')) return 'SRILANKA'
  if (ref.startsWith('SG')) return 'SINGAPORE_MALAYSIA'
  if (ref.startsWith('MY')) return 'SINGAPORE_MALAYSIA'
  return null
}

export function countryLabel(country: OperationCountry | null | undefined): string {
  switch (country) {
    case 'VIETNAM':            return 'Vietnam'
    case 'SRILANKA':           return 'Sri Lanka'
    case 'SINGAPORE_MALAYSIA': return 'Singapore & Malaysia'
    case 'ALL':                return 'All Countries'
    default:                   return 'Unassigned'
  }
}

export function countryFlag(country: OperationCountry | null | undefined): string {
  switch (country) {
    case 'VIETNAM':            return '🇻🇳'
    case 'SRILANKA':           return '🇱🇰'
    case 'SINGAPORE_MALAYSIA': return '🇸🇬🇲🇾'
    default:                   return '🌍'
  }
}

export const OPERATION_COUNTRIES: { value: OperationCountry; label: string; flag: string }[] = [
  { value: 'VIETNAM',            label: 'Vietnam',              flag: '🇻🇳' },
  { value: 'SRILANKA',           label: 'Sri Lanka',            flag: '🇱🇰' },
  { value: 'SINGAPORE_MALAYSIA', label: 'Singapore & Malaysia', flag: '🇸🇬🇲🇾' },
]
