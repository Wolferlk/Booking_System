/**
 * International phone validation for guest / agent contact numbers.
 *
 * Pure and dependency-free so the booking page (live, as staff type) and the
 * booking PUT route (authoritative, on save) give the same verdict.
 *
 * Why it matters: the guest's WhatsApp number drives the daily trip plan, the
 * departure-day feedback request and the AI voice calls. Meta and the call
 * service both need the full international number — "9535250259" (no country
 * code) is silently undeliverable, and `b2c-guest-engage.ts` refuses to guess
 * one. So a number without a country code is never accepted; instead the UI
 * offers a one-click fix using the guest's nationality as the likely country.
 */

export interface DialCountry {
  iso: string      // ISO 3166-1 alpha-2, for the flag
  name: string
  dial: string     // country calling code, digits only
  /** Valid national-number lengths (without the trunk 0). */
  len: number[]
  /** Optional: what a national (mobile) number starts with. */
  starts?: RegExp
  /** Extra names/nationalities that map to this country (lower-case). */
  aliases?: string[]
}

/**
 * Markets this business actually sees first (India via MakeMyTrip, the four
 * operating countries, the Gulf, then common long-haul). Order = picker order.
 */
export const DIAL_COUNTRIES: DialCountry[] = [
  { iso: 'IN', name: 'India',          dial: '91',  len: [10],      starts: /^[6-9]/, aliases: ['indian', 'bharat'] },
  { iso: 'LK', name: 'Sri Lanka',      dial: '94',  len: [9],       aliases: ['sri lankan', 'srilanka', 'ceylon'] },
  { iso: 'VN', name: 'Vietnam',        dial: '84',  len: [9, 10],   aliases: ['vietnamese', 'viet nam'] },
  { iso: 'SG', name: 'Singapore',      dial: '65',  len: [8],       starts: /^[3689]/, aliases: ['singaporean'] },
  { iso: 'MY', name: 'Malaysia',       dial: '60',  len: [9, 10],   aliases: ['malaysian'] },
  { iso: 'AE', name: 'UAE',            dial: '971', len: [8, 9],    aliases: ['united arab emirates', 'emirati', 'dubai'] },
  { iso: 'SA', name: 'Saudi Arabia',   dial: '966', len: [9],       aliases: ['saudi', 'ksa'] },
  { iso: 'QA', name: 'Qatar',          dial: '974', len: [8],       aliases: ['qatari'] },
  { iso: 'KW', name: 'Kuwait',         dial: '965', len: [8],       aliases: ['kuwaiti'] },
  { iso: 'OM', name: 'Oman',           dial: '968', len: [8],       aliases: ['omani'] },
  { iso: 'BH', name: 'Bahrain',        dial: '973', len: [8],       aliases: ['bahraini'] },
  { iso: 'MV', name: 'Maldives',       dial: '960', len: [7],       aliases: ['maldivian'] },
  { iso: 'NP', name: 'Nepal',          dial: '977', len: [8, 10],   aliases: ['nepali', 'nepalese'] },
  { iso: 'BD', name: 'Bangladesh',     dial: '880', len: [10],      aliases: ['bangladeshi'] },
  { iso: 'PK', name: 'Pakistan',       dial: '92',  len: [10],      aliases: ['pakistani'] },
  { iso: 'TH', name: 'Thailand',       dial: '66',  len: [8, 9],    aliases: ['thai'] },
  { iso: 'ID', name: 'Indonesia',      dial: '62',  len: [9, 10, 11, 12], aliases: ['indonesian'] },
  { iso: 'PH', name: 'Philippines',    dial: '63',  len: [10],      aliases: ['filipino', 'philippine'] },
  { iso: 'CN', name: 'China',          dial: '86',  len: [11],      aliases: ['chinese', 'prc'] },
  { iso: 'HK', name: 'Hong Kong',      dial: '852', len: [8] },
  { iso: 'JP', name: 'Japan',          dial: '81',  len: [9, 10],   aliases: ['japanese'] },
  { iso: 'KR', name: 'South Korea',    dial: '82',  len: [9, 10],   aliases: ['korean', 'korea'] },
  { iso: 'AU', name: 'Australia',      dial: '61',  len: [9],       aliases: ['australian'] },
  { iso: 'NZ', name: 'New Zealand',    dial: '64',  len: [8, 9, 10], aliases: ['new zealander', 'kiwi'] },
  { iso: 'GB', name: 'United Kingdom', dial: '44',  len: [10],      aliases: ['uk', 'british', 'england', 'english', 'great britain'] },
  { iso: 'US', name: 'USA / Canada',   dial: '1',   len: [10],      starts: /^[2-9]/, aliases: ['united states', 'american', 'us', 'usa', 'canada', 'canadian'] },
  { iso: 'DE', name: 'Germany',        dial: '49',  len: [10, 11],  aliases: ['german'] },
  { iso: 'FR', name: 'France',         dial: '33',  len: [9],       aliases: ['french'] },
  { iso: 'IT', name: 'Italy',          dial: '39',  len: [9, 10],   aliases: ['italian'] },
  { iso: 'ES', name: 'Spain',          dial: '34',  len: [9],       aliases: ['spanish'] },
  { iso: 'NL', name: 'Netherlands',    dial: '31',  len: [9],       aliases: ['dutch', 'holland'] },
  { iso: 'CH', name: 'Switzerland',    dial: '41',  len: [9],       aliases: ['swiss'] },
  { iso: 'RU', name: 'Russia',         dial: '7',   len: [10],      aliases: ['russian'] },
  { iso: 'ZA', name: 'South Africa',   dial: '27',  len: [9],       aliases: ['south african'] },
]

// Longest dial code first, so "971…" is never read as "97…".
const BY_DIAL = [...DIAL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

export function countryByIso(iso: string | null | undefined): DialCountry | null {
  const k = (iso ?? '').trim().toUpperCase()
  return DIAL_COUNTRIES.find(c => c.iso === k) ?? null
}

/**
 * Best-guess country from free text: a nationality ("Indian"), country name,
 * or ISO code. Used to offer the right "add +91" fix.
 */
export function guessCountry(...hints: (string | null | undefined)[]): DialCountry | null {
  for (const raw of hints) {
    const h = (raw ?? '').trim().toLowerCase()
    if (!h) continue
    const word = (w: string) => new RegExp(`(^|[^a-z])${w.replace(/[^a-z ]/g, '')}([^a-z]|$)`).test(h)
    const hit =
      DIAL_COUNTRIES.find(c => c.iso.toLowerCase() === h || c.name.toLowerCase() === h || (c.aliases ?? []).includes(h)) ??
      DIAL_COUNTRIES.find(c => word(c.name.toLowerCase()) || (c.aliases ?? []).some(a => a.length > 3 && word(a)))
    if (hit) return hit
  }
  return null
}

function nationalFits(c: DialCountry, national: string): boolean {
  return c.len.includes(national.length) && (!c.starts || c.starts.test(national))
}

export type PhoneVerdict =
  | { state: 'empty' }
  | {
      state: 'valid'
      /** Digits only, with country code — what WhatsApp / the call service take. */
      digits: string
      /** "+91 95352 50259" — human display. */
      pretty: string
      country: DialCountry | null
      /** True when the country code is outside our known list (accepted, unverified). */
      unverified?: boolean
    }
  | {
      state: 'no-country-code'
      national: string
      /** Ready-made fix using the hinted country, when the number fits it. */
      suggestion: { digits: string; pretty: string; country: DialCountry } | null
    }
  | { state: 'invalid'; reason: string; country: DialCountry | null }

function prettyOf(c: DialCountry | null, digits: string): string {
  if (!c) return `+${digits}`
  const n = digits.slice(c.dial.length)
  // Light grouping: 10 → 5+5, 9 → 2+3+4 / 3+3+3, 8 → 4+4, else as-is.
  const grouped =
    n.length === 10 ? `${n.slice(0, 5)} ${n.slice(5)}` :
    n.length === 9  ? `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}` :
    n.length === 8  ? `${n.slice(0, 4)} ${n.slice(4)}` : n
  return `+${c.dial} ${grouped}`
}

function asInternational(digits: string): PhoneVerdict | null {
  const c = BY_DIAL.find(x => digits.startsWith(x.dial))
  if (!c) {
    // Unknown code: accept a plausible E.164 length, flagged as unverified.
    if (digits.length >= 8 && digits.length <= 15) {
      return { state: 'valid', digits, pretty: `+${digits}`, country: null, unverified: true }
    }
    return null
  }
  let national = digits.slice(c.dial.length)
  // People often keep the trunk 0: "+44 07700…", "+94 0771…".
  if (national.startsWith('0') && nationalFits(c, national.slice(1))) national = national.slice(1)
  if (!nationalFits(c, national)) {
    const want = c.len.join(' or ')
    return { state: 'invalid', country: c, reason: `${c.name} numbers have ${want} digits after +${c.dial} (got ${national.length})` }
  }
  const full = c.dial + national
  return { state: 'valid', digits: full, pretty: prettyOf(c, full), country: c }
}

/**
 * Judge a typed number.
 *
 * `hint` is the country the guest most likely belongs to (nationality); it only
 * shapes the *suggestion* for a number missing its code — it never silently
 * changes what is stored.
 */
export function checkPhone(raw: string | null | undefined, hint?: DialCountry | null): PhoneVerdict {
  const text = String(raw ?? '').trim()
  if (!text) return { state: 'empty' }

  // Several numbers in one field ("+84… / +84…"): judge the first.
  const first = text.split(/\s*(?:\/|,|;|\||\bor\b)\s*/i).find(p => p.replace(/\D/g, '').length >= 6) ?? text
  const explicitIntl = /^\s*(\+|00)/.test(first)
  let digits = first.replace(/\D/g, '')
  if (explicitIntl && first.trim().startsWith('00')) digits = digits.slice(2)

  if (digits.length < 6) return { state: 'invalid', country: null, reason: 'Too short to be a phone number' }
  if (digits.length > 15) return { state: 'invalid', country: null, reason: 'Too long — max 15 digits incl. country code' }

  if (explicitIntl) {
    return asInternational(digits) ?? { state: 'invalid', country: null, reason: 'Unrecognised country code' }
  }

  // No "+": a leading 0 is a trunk prefix → definitely local.
  const local = digits.startsWith('0') ? digits.slice(1) : null
  if (local !== null) return missingCode(local, hint)

  // Fits the guest's own country as a local number (e.g. Indian "9535250259")?
  // That beats reading the first digits as some other country's code.
  // (Unless it is already that country's full number: dial code + valid national.)
  if (hint && nationalFits(hint, digits) &&
      !(digits.startsWith(hint.dial) && nationalFits(hint, digits.slice(hint.dial.length)))) {
    return missingCode(digits, hint)
  }

  // Stored WhatsApp numbers are digits-only international ("94771234567").
  const intl = asInternational(digits)
  if (intl && intl.state === 'valid' && !intl.unverified && digits.length >= 10) return intl

  // Short and no code: needs one.
  if (digits.length <= 10) return missingCode(digits, hint)
  return intl ?? { state: 'invalid', country: null, reason: 'Could not read a country code' }
}

function missingCode(national: string, hint?: DialCountry | null): PhoneVerdict {
  const suggestion = hint && nationalFits(hint, national)
    ? { digits: hint.dial + national, pretty: prettyOf(hint, hint.dial + national), country: hint }
    : null
  return { state: 'no-country-code', national, suggestion }
}

/** Re-home a local number under a chosen country. Null if it doesn't fit there. */
export function withCountry(national: string, c: DialCountry): { digits: string; pretty: string } | null {
  const n = national.replace(/\D/g, '').replace(/^0/, '')
  if (!nationalFits(c, n)) return null
  return { digits: c.dial + n, pretty: prettyOf(c, c.dial + n) }
}

/** Short message for a verdict that can't be saved, or null if it can. */
export function phoneProblem(v: PhoneVerdict): string | null {
  if (v.state === 'empty' || v.state === 'valid') return null
  if (v.state === 'no-country-code') return 'Add the country code (e.g. +91 …) — WhatsApp and AI calls cannot reach a number without it'
  return v.reason
}
