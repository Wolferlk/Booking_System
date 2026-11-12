/**
 * What a GUEST (or agent) is shown about the driver of a movement.
 *
 * The Vietnam desk's Movement Chart names transport the way the desk talks:
 *
 *   "Go Air - Driver's manager in Hanoi: +84899802839 / +84368933597 - Dương / Thảo Goair"
 *
 * VN Driver Sync saves that whole text on the movement (`assignments.driverName`)
 * so the desk sees exactly what the sheet says, and the numbers alone in
 * `driverPhone`. A guest must never see the supplier's name or the internal
 * "driver's manager" wording — only how to reach the car:
 *
 *   Driver: +84899802839 / +84368933597
 *
 * The rule needs no flag on the row: a driver "name" that carries a phone
 * number is contact text, not a person's name. Everything guest-facing (daily
 * plan WhatsApp, movement brief, PDFs, Word, portal, trip panel, agent digest)
 * passes the driver through `guestDriver()` before printing it. Internal views
 * (MC report, agenda chart, driver messages) keep the full text.
 *
 * Pure and client-safe.
 */

/** A run of digits with the usual separators, long enough to be a phone number (dates and times are too short). */
const PHONE_RUN = /\+?\(?\d[\d\s().\-]{6,}\d/g

/** Every phone number in a text, as written (tidied), de-duplicated by digits. 9–15 digits each. */
export function extractPhones(text: string | null | undefined): string[] {
  const s = String(text ?? '')
  if (!s) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of Array.from(s.matchAll(PHONE_RUN))) {
    // "0905 123 456 / 0905 654 321" can arrive as one run when the slash is missing; split on double spaces too.
    for (const part of m[0].split(/\s{2,}/)) {
      const raw = part.trim().replace(/[\s.\-()]+$/, '')
      const digits = raw.replace(/\D/g, '')
      if (digits.length < 9 || digits.length > 15) continue
      if (/^(19|20)\d{6}$/.test(digits)) continue                     // 20260930 — a date, not a phone
      if (seen.has(digits)) continue
      seen.add(digits)
      out.push(raw.replace(/\s+/g, ' ').replace(/^\(|\)$/g, ''))
    }
  }
  return out
}

/** The numbers, the way guests see them: "+84899802839 / +84368933597". Null when there are none. */
export function phonesText(text: string | null | undefined): string | null {
  const p = extractPhones(text)
  return p.length ? p.join(' / ') : null
}

/** True when a driver "name" is really contact text (it carries a phone number). */
export function isContactText(name: string | null | undefined): boolean {
  return extractPhones(name).length > 0
}

/**
 * The driver as a guest may see it. A real name passes through untouched.
 * Contact text becomes its numbers only — returned in `name` (with `phone`
 * null) so every renderer that prints "Driver: <name> (<phone>)" prints just
 * the numbers, without repeating them.
 */
export function guestDriver<N extends string | null | undefined, P extends string | null | undefined>(
  name: N, phone: P,
): { name: string | null; phone: string | null } {
  const n = name ? String(name) : null
  const p = phone ? String(phone) : null
  if (!n || !isContactText(n)) return { name: n, phone: p }
  const numbers = phonesText(p) ?? phonesText(n)
  return { name: numbers, phone: null }
}

/** Convenience for `{ driverName, driverPhone }`-shaped objects. Returns a copy; other fields untouched. */
export function guestDriverFields<T extends { driverName?: string | null; driverPhone?: string | null }>(row: T): T {
  if (!row || !isContactText(row.driverName)) return row
  const g = guestDriver(row.driverName, row.driverPhone)
  return { ...row, driverName: g.name, driverPhone: g.phone }
}

/** More than one number in a phone field — fine for a guest to read, not a single WhatsApp recipient. */
export function hasSeveralPhones(phone: string | null | undefined): boolean {
  return extractPhones(phone).length > 1 || /\s\/\s/.test(String(phone ?? ''))
}

/** The first number in a phone field — for anything that must dial or message exactly one. */
export function firstPhone(phone: string | null | undefined): string | null {
  return extractPhones(phone)[0] ?? (phone?.trim() || null)
}
