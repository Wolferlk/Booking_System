import crypto from 'crypto'

/**
 * Signed, auth-free customer trip portal links.
 *
 * The public trip page (`/trip/[ref]?t=…`) is reachable without a login. Access
 * is gated purely by an HMAC of the booking ref, so the URL is unguessable but
 * the booking itself needs no account. Mirrors the feedback-link approach.
 */

const SECRET =
  process.env.PORTAL_LINK_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'apple-holidays-portal'

/** Deterministic signed token for a booking's public trip portal. */
export function portalLinkToken(bookingRef: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(`trip:${bookingRef}`)
    .digest('hex')
    .slice(0, 32)
}

export function verifyPortalLinkToken(bookingRef: string, token: string): boolean {
  if (!token) return false
  const expected = portalLinkToken(bookingRef)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

/** Full relative path a customer opens, e.g. `/trip/VN19018?t=abcd…`. */
export function portalLinkPath(bookingRef: string): string {
  return `/trip/${encodeURIComponent(bookingRef)}?t=${portalLinkToken(bookingRef)}`
}
