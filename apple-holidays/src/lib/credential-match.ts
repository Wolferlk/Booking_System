/**
 * Matching helpers for the vendor / file-handler portal logins.
 *
 * Both portals let people sign in with "email or phone", and the phone half was matching
 * the typed string against the stored one with a literal SQL `contains`. Nobody stores a
 * number the way the next person types it — the registration form even suggests
 * "+94 77 123 4567", so the same number lives in the database as "+94 77 823 1121",
 * "0778231121" and "94778231121" — and a substring match across those shapes misses far
 * more often than it hits. The miss then surfaces to the vendor as "Invalid credentials"
 * even though their password is correct. So: reduce both sides to digits and compare the
 * part that survives every prefix convention.
 */

/** Digits only, with the international and trunk prefixes stripped. */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return ''
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2) // 0094 77… → 94 77…
  if (digits.startsWith('0')) digits = digits.slice(1)  // 077…      → 77…
  return digits
}

/** Below this, a "number" is too short to identify anyone. */
const MIN_SIGNIFICANT_DIGITS = 7

/**
 * True when two numbers are the same subscriber, allowing for one side carrying a country
 * code the other omits (94778231121 vs 778231121).
 */
export function phoneMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizePhone(a)
  const y = normalizePhone(b)
  if (x.length < MIN_SIGNIFICANT_DIGITS || y.length < MIN_SIGNIFICANT_DIGITS) return false
  return x.endsWith(y) || y.endsWith(x)
}

export function looksLikePhone(value: string): boolean {
  return /^[+\d][\d\s\-().]{4,}$/.test(value.trim())
}

/** Stored addresses sometimes carry stray case or whitespace that an `equals` won't reach. */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}
