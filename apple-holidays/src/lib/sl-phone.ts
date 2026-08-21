/**
 * Reading a Sri Lankan phone number the way a person wrote it down.
 *
 * Numbers reach us from a dozen places — a driver typed into the allocation
 * screen, a vendor's spreadsheet, a WhatsApp contact card — and they are written
 * every way there is:
 *
 *     +94775622923      0775622923      94775622923.
 *     +94 77 562 2923   077-562 2923    0094775622923
 *
 * All six are the same phone. WhatsApp will only accept one form of it: digits
 * only, country code included, no plus — `94775622923`. A number that is one
 * character off is not rejected by Meta; it is *delivered to nobody*, which is
 * the failure mode this file exists to stop.
 *
 * Local numbers are the trap. `0775622923` is not `940775622923`: the leading
 * zero is a domestic trunk prefix and is *replaced* by the country code, not
 * prefixed with it. Getting that wrong produces a plausible-looking number that
 * silently goes nowhere.
 *
 * Foreign numbers are passed through rather than forced into +94 — some vehicles
 * are driven by vendors reachable on an Indian or Maldivian number, and a number
 * we cannot read is reported as unreadable rather than guessed at.
 */

/** Sri Lanka. */
const LK = '94'

/** What a number was read as, so the desk can see the reasoning. */
export type PhoneShape =
  | 'international'   // already 94…, or +94…
  | 'local'           // 0771234567 — trunk zero swapped for the country code
  | 'bare'            // 771234567 — no prefix at all
  | 'foreign'         // some other country code, passed through untouched
  | 'unreadable'

export interface NormalisedPhone {
  /** True when `msisdn` may be handed to WhatsApp. */
  ok: boolean
  /** Digits only, country code included, no plus: `94775622923`. */
  msisdn: string
  shape: PhoneShape
  /** Why it could not be read, when it could not. */
  reason?: string
  /** `+94 77 562 2923` — for showing a person what will be dialled. */
  pretty: string
}

/** Digits only. Everything else — plus, spaces, dashes, brackets, a stray full stop — goes. */
function digitsOf(raw: string): string {
  return String(raw ?? '').replace(/[^0-9]/g, '')
}

/** `+94 77 562 2923`, or the raw digits when the grouping is not one we know. */
function prettify(msisdn: string): string {
  if (msisdn.startsWith(LK) && msisdn.length === 11) {
    const n = msisdn.slice(2)
    return `+${LK} ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`
  }
  return msisdn ? `+${msisdn}` : ''
}

/**
 * Turn anything a person wrote into the number WhatsApp wants.
 *
 * Never throws and never guesses: an input it cannot account for comes back
 * `ok: false` with the reason, and the caller shows that to the desk with the
 * number left editable rather than sending a document into the void.
 */
export function normaliseSriLankanPhone(raw: string | null | undefined): NormalisedPhone {
  const fail = (reason: string, digits = ''): NormalisedPhone =>
    ({ ok: false, msisdn: digits, shape: 'unreadable', reason, pretty: '' })

  let d = digitsOf(raw ?? '')
  if (!d) return fail('No number on file.')

  // 00 is the international access prefix — "0094…" is "+94…".
  if (d.startsWith('00')) d = d.slice(2)

  // Already carries the country code.
  if (d.startsWith(LK)) {
    // 94 + 9 national digits. A "94" that is really the start of a local number
    // cannot occur: Sri Lankan subscriber numbers never begin 94.
    if (d.length === 11) return { ok: true, msisdn: d, shape: 'international', pretty: prettify(d) }
    // 94 followed by a trunk zero — "+94 077…", which people do write.
    if (d.length === 12 && d[2] === '0') {
      const fixed = LK + d.slice(3)
      return { ok: true, msisdn: fixed, shape: 'international', pretty: prettify(fixed) }
    }
    return fail(`"${d}" has ${d.length} digits; a Sri Lankan number with its country code has 11.`, d)
  }

  // Domestic form: the trunk zero is replaced by the country code, never kept.
  if (d.startsWith('0')) {
    if (d.length === 10) {
      const fixed = LK + d.slice(1)
      return { ok: true, msisdn: fixed, shape: 'local', pretty: prettify(fixed) }
    }
    return fail(`"${d}" has ${d.length} digits; a local Sri Lankan number has 10, starting 0.`, d)
  }

  // Nine digits and no prefix — a mobile or an area code with the zero dropped.
  if (d.length === 9) {
    const fixed = LK + d
    return { ok: true, msisdn: fixed, shape: 'bare', pretty: prettify(fixed) }
  }

  // Anything else long enough to be a real international number is taken at its
  // word. A vendor on an Indian number is not a typo to be corrected.
  if (d.length >= 10 && d.length <= 15) {
    return { ok: true, msisdn: d, shape: 'foreign', pretty: prettify(d) }
  }

  return fail(`"${d}" is not a number we can read — expected 0771234567, 94771234567 or +94771234567.`, d)
}

/** The number alone, or '' when it cannot be read. For call sites with nothing to show a human. */
export function toWhatsAppNumber(raw: string | null | undefined): string {
  const out = normaliseSriLankanPhone(raw)
  return out.ok ? out.msisdn : ''
}
