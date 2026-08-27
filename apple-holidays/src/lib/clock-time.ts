/**
 * Clock-time helpers for the movement chart.
 *
 * Times are stored the way they always were — a plain `"HH:MM"` string on
 * 24-hour notation — because that is what every existing row, export and
 * WhatsApp message already contains. Nothing here changes storage; it changes
 * only what a human types and what a human reads.
 *
 * The reason it exists: `<input type="time">` renders on the *browser's*
 * locale, so the same pickup showed as "15:45" to the Vietnam desk and
 * "3:45 PM" to a colleague on a US-locale laptop, and a guest reading the PDF
 * saw whichever the desk happened to have. `to12h` makes the guest-facing side
 * unambiguous everywhere, and `parse12h` lets the desk type either notation.
 */

/** Matches "HH:MM" (24-hour), optionally with seconds we discard. */
const HHMM = /^(\d{1,2}):(\d{2})(?::\d{2})?$/

/**
 * "15:45" → "3:45 PM". Anything that is not a 24-hour clock string — a range,
 * a note, an empty field — is returned untouched: this is a display helper,
 * never a validator, and a value it does not recognise must still reach the
 * page rather than vanish.
 */
export function to12h(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const m = HHMM.exec(value)
  if (!m) return value
  const h = Number(m[1])
  const min = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return value
  const suffix = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(min).padStart(2, '0')} ${suffix}`
}

/** The three pieces a 12-hour editor needs: hour 1–12, minute, and AM/PM. */
export interface Clock12 { hour: string; minute: string; meridiem: 'AM' | 'PM' }

/** Split a stored "HH:MM" into its 12-hour parts. Blank input gives blank parts. */
export function split12h(raw: string | null | undefined): Clock12 {
  const m = HHMM.exec(String(raw ?? '').trim())
  if (!m) return { hour: '', minute: '', meridiem: 'AM' }
  const h = Number(m[1])
  if (h > 23) return { hour: '', minute: '', meridiem: 'AM' }
  return {
    hour: String(h % 12 === 0 ? 12 : h % 12),
    minute: String(Number(m[2])).padStart(2, '0'),
    meridiem: h < 12 ? 'AM' : 'PM',
  }
}

/**
 * Recombine 12-hour parts into the stored "HH:MM". Returns `''` while the
 * fields are still incomplete, so a half-typed time never saves as a real one.
 */
export function join12h({ hour, minute, meridiem }: Clock12): string {
  if (!hour.trim()) return ''
  let h = Number(hour)
  const min = Number(minute.trim() === '' ? '0' : minute)
  if (!Number.isFinite(h) || !Number.isFinite(min)) return ''
  if (h < 1 || h > 12 || min < 0 || min > 59) return ''
  if (meridiem === 'AM' && h === 12) h = 0
  else if (meridiem === 'PM' && h !== 12) h += 12
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Parse anything a person is likely to type into the stored "HH:MM":
 * "3:45 pm", "3.45PM", "0345 pm", "15:45", "1545", "9am". Returns `null` when
 * the text is not a time at all, so the caller can leave the field alone
 * instead of overwriting what was typed.
 */
export function parse12h(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '')
  if (!text) return null

  const meridiem = /(a|p)\.?m?\.?$/.exec(text)?.[1]
  const digits = text.replace(/[^0-9:.]/g, '').replace(/\./g, ':')

  let h: number, min: number
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(digits)
  if (colon) {
    h = Number(colon[1]); min = Number(colon[2])
  } else if (/^\d{3,4}$/.test(digits)) {
    h = Number(digits.slice(0, digits.length - 2)); min = Number(digits.slice(-2))
  } else if (/^\d{1,2}$/.test(digits)) {
    h = Number(digits); min = 0
  } else {
    return null
  }

  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null

  if (meridiem === 'a') {
    if (h < 1 || h > 12) return null
    if (h === 12) h = 0
  } else if (meridiem === 'p') {
    if (h < 1 || h > 12) return null
    if (h !== 12) h += 12
  } else if (h > 23) {
    return null
  }

  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * A "from – to" window in 12-hour notation, e.g. "8:00 AM – 5:30 PM".
 * Either side may be missing; the dash only appears when both are present.
 */
export function range12h(from: string | null | undefined, to: string | null | undefined): string {
  return [to12h(from), to12h(to)].filter(Boolean).join(' – ')
}
