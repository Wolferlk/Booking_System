/**
 * Hotel contact-point utilities: phone normalisation, WhatsApp inference and
 * the reconfirmation message template.
 *
 * Hotel numbers in the live data arrive in every shape imaginable —
 * "0572 222 000", "+94 57 2222 000", "094572222000", "057-2222000 / 077-1234567".
 * Everything downstream (wa.me links, tel: links, duplicate detection) needs
 * one canonical E.164 form, so normalisation happens here and only here.
 */

/** Dialling metadata per operating country. */
const COUNTRY_DIAL: Record<string, { cc: string; trunk: string; mobilePrefixes: string[] }> = {
  LK: { cc: '94', trunk: '0', mobilePrefixes: ['70', '71', '72', '74', '75', '76', '77', '78'] },
  VN: { cc: '84', trunk: '0', mobilePrefixes: ['3', '5', '7', '8', '9'] },
  SG: { cc: '65', trunk: '',  mobilePrefixes: ['8', '9'] },
  MY: { cc: '60', trunk: '0', mobilePrefixes: ['1'] },
  MV: { cc: '960', trunk: '', mobilePrefixes: ['7', '9'] },
  IN: { cc: '91', trunk: '0', mobilePrefixes: ['6', '7', '8', '9'] },
  TH: { cc: '66', trunk: '0', mobilePrefixes: ['6', '8', '9'] },
}

/** Map a booking's operationCountry to the ISO-2 code used above. */
export function countryCodeForOperation(op: string | null | undefined): string {
  switch (op) {
    case 'VIETNAM':            return 'VN'
    case 'SRILANKA':           return 'LK'
    case 'SINGAPORE':          return 'SG'
    case 'MALAYSIA':           return 'MY'
    case 'SINGAPORE_MALAYSIA': return 'SG'
    default:                   return 'LK'
  }
}

/** Split a free-text contact field that may hold several numbers. */
export function splitContactValues(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw
    .split(/[,;/|]|\s{2,}|\bor\b/i)
    .map(s => s.trim())
    .filter(s => s.length >= 6)
}

export interface NormalizedPhone {
  /** "+94572222000", or null when the input could not be read as a number. */
  e164: string | null
  /** National significant number without trunk prefix, e.g. "572222000". */
  national: string | null
  /** True when the number looks like a mobile line in its country. */
  isMobile: boolean
  /** The original, untouched. */
  raw: string
}

/**
 * Best-effort E.164 normalisation against a default country.
 *
 * Deliberately permissive: a hotel number that fails strict validation is
 * still more useful to staff than nothing, so unparseable input returns
 * `e164: null` while keeping `raw` intact for display.
 */
export function normalizePhone(raw: string | null | undefined, countryCode = 'LK'): NormalizedPhone {
  const original = (raw ?? '').trim()
  if (!original) return { e164: null, national: null, isMobile: false, raw: original }

  const meta = COUNTRY_DIAL[countryCode.toUpperCase()] ?? COUNTRY_DIAL.LK
  const hadPlus = original.trim().startsWith('+')
  let digits = original.replace(/[^\d]/g, '')
  if (!digits) return { e164: null, national: null, isMobile: false, raw: original }

  // "0094…" international prefix, then a bare country code, then trunk "0…".
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (hadPlus) { /* already international */ }
  else if (digits.startsWith(meta.cc) && digits.length > meta.cc.length + 6) { /* bare CC */ }
  else {
    if (meta.trunk && digits.startsWith(meta.trunk)) digits = digits.slice(meta.trunk.length)
    digits = meta.cc + digits
  }

  // A plausible international number is 8–15 digits (ITU E.164 caps at 15).
  if (digits.length < 8 || digits.length > 15) {
    return { e164: null, national: null, isMobile: false, raw: original }
  }

  // Strip the country code back off to test the national part.
  const knownCc = Object.values(COUNTRY_DIAL).map(m => m.cc).sort((a, b) => b.length - a.length)
  const cc = knownCc.find(c => digits.startsWith(c)) ?? meta.cc
  const national = digits.slice(cc.length)
  const ccMeta = Object.values(COUNTRY_DIAL).find(m => m.cc === cc) ?? meta
  const isMobile = ccMeta.mobilePrefixes.some(p => national.startsWith(p))

  return { e164: `+${digits}`, national, isMobile, raw: original }
}

/**
 * Infer a WhatsApp number from a hotel's known numbers.
 *
 * Mobile lines are overwhelmingly WhatsApp-capable and landlines almost never
 * are, so the first mobile-looking number wins. The result is always marked
 * `guessed` — staff confirm it before the system trusts it.
 */
export function inferWhatsapp(
  values: Array<string | null | undefined>,
  countryCode = 'LK',
): { e164: string; guessed: true } | null {
  for (const v of values) {
    for (const part of splitContactValues(v)) {
      const n = normalizePhone(part, countryCode)
      if (n.e164 && n.isMobile) return { e164: n.e164, guessed: true }
    }
  }
  return null
}

/** wa.me deep link with an optional pre-filled message. */
export function whatsappLink(e164: string, message?: string): string {
  const num = e164.replace(/[^\d]/g, '')
  const q = message ? `?text=${encodeURIComponent(message)}` : ''
  return `https://wa.me/${num}${q}`
}

// ─── Reconfirmation message template ─────────────────────────────────────────

export interface ReconfirmMessageInput {
  hotelName: string
  bookingRef: string
  isNumber?: string | null
  leadGuest?: string | null
  checkIn: Date | string
  checkOut: Date | string
  nights: number
  roomCount?: number | null
  roomType?: string | null
  roomCategory?: string | null
  mealType?: string | null
  adults?: number | null
  children?: number | null
  cwb?: number | null
  cnb?: number | null
  confirmationNumber?: string | null
  senderName?: string | null
}

function fmtDate(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return String(d)
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Build the D-10 reconfirmation message sent to the property.
 *
 * Written as one WhatsApp-ready block: every fact the hotel needs to verify,
 * then a single explicit ask. Empty fields are omitted rather than sent as
 * "null" — a half-filled template reads as careless to the supplier.
 */
export function buildReconfirmMessage(i: ReconfirmMessageInput): string {
  const lines: string[] = []
  const ref = i.isNumber?.trim() || i.bookingRef

  lines.push(`Dear ${i.hotelName} Reservations Team,`)
  lines.push('')
  lines.push(`Greetings from Apple Holidays. We would like to reconfirm the below reservation:`)
  lines.push('')
  lines.push(`*Booking Reference:* ${ref}`)
  if (i.confirmationNumber) lines.push(`*Your Confirmation No:* ${i.confirmationNumber}`)
  if (i.leadGuest) lines.push(`*Guest Name:* ${i.leadGuest}`)
  lines.push(`*Check-in:* ${fmtDate(i.checkIn)}`)
  lines.push(`*Check-out:* ${fmtDate(i.checkOut)}`)
  lines.push(`*Nights:* ${i.nights}`)

  const roomBits = [
    i.roomCount ? `${i.roomCount} x` : null,
    i.roomCategory || null,
    i.roomType || null,
  ].filter(Boolean).join(' ')
  if (roomBits) lines.push(`*Rooms:* ${roomBits}`)
  if (i.mealType) lines.push(`*Meal Plan:* ${i.mealType}`)

  const paxBits = [
    i.adults ? `${i.adults} adult${i.adults > 1 ? 's' : ''}` : null,
    i.children ? `${i.children} child${i.children > 1 ? 'ren' : ''}` : null,
    i.cwb ? `${i.cwb} CWB` : null,
    i.cnb ? `${i.cnb} CNB` : null,
  ].filter(Boolean).join(', ')
  if (paxBits) lines.push(`*Pax:* ${paxBits}`)

  lines.push('')
  lines.push('Could you kindly confirm the above is correct and share your confirmation number? Please let us know immediately if anything differs.')
  lines.push('')
  lines.push('Thank you,')
  lines.push(i.senderName ? `${i.senderName} — Apple Holidays` : 'Apple Holidays')

  return lines.join('\n')
}

// ─── Contact health ──────────────────────────────────────────────────────────

export interface ContactHealth {
  /** 0–100. */
  score: number
  label: 'No contact' | 'Weak' | 'Usable' | 'Good' | 'Excellent'
  missing: string[]
}

/**
 * How reachable a hotel is, as a single number staff can scan down a column.
 *
 * Weighted towards WhatsApp because that is how reconfirmations actually get
 * answered — a verified WhatsApp number is worth more than a landline and an
 * email put together.
 */
export function contactHealth(h: {
  phone?: string | null
  whatsapp?: string | null
  whatsappVerified?: boolean
  email?: string | null
  channelCount?: number
}): ContactHealth {
  let score = 0
  const missing: string[] = []

  if (h.phone) score += 25; else missing.push('phone')
  if (h.whatsapp) score += 30; else missing.push('WhatsApp')
  if (h.whatsapp && h.whatsappVerified) score += 20; else if (h.whatsapp) missing.push('WhatsApp not verified')
  if (h.email) score += 15; else missing.push('email')
  if ((h.channelCount ?? 0) > 1) score += 10

  const label: ContactHealth['label'] =
    score === 0  ? 'No contact' :
    score < 35   ? 'Weak' :
    score < 60   ? 'Usable' :
    score < 85   ? 'Good' : 'Excellent'

  return { score: Math.min(100, score), label, missing }
}
