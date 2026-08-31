/**
 * The "30sundays Aahaas" placeholder file handler — the pure half of the
 * resolution feature, safe to import from client components.
 *
 * `file-handler-resolve.ts` does the database work and pulls in Prisma and the
 * mysql2 client; the booking detail page only needs to know whether the handler
 * it is rendering is still the placeholder, so that test lives here on its own.
 */

/** The generic account name the 30 Sundays feed stamps on new bookings. */
export const PLACEHOLDER_FILE_HANDLER = '30sundays Aahaas'

/** Comparison key: case-, space- and punctuation-insensitive. */
export function fileHandlerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const PLACEHOLDER_KEY = fileHandlerKey(PLACEHOLDER_FILE_HANDLER)

/**
 * True when `value` is the placeholder rather than a person's name. Note that
 * the unrelated handler "30 Sundays Agent" is NOT the placeholder and is never
 * rewritten.
 */
export function isPlaceholderFileHandler(value: string | null | undefined): boolean {
  return !!value && fileHandlerKey(value) === PLACEHOLDER_KEY
}
