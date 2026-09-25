/**
 * Name key for passenger special notes (see src/lib/passenger-notes.ts).
 * Kept free of server imports so the booking page can match notes to rows.
 *
 * "Mr. MAHESH  Ramesh-Panjwani" → "mahesh ramesh panjwani"
 */
export function passengerNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, ' ')
    .trim()
    .replace(/^(mr|mrs|ms|miss|mstr|master|dr|prof)\s+/, '')
    .slice(0, 191)
}
