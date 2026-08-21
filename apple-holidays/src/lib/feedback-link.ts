import crypto from 'crypto'

/**
 * Signed, login-free guest feedback links.
 *
 * The public feedback form (`/feedback/[ref]?t=…`) is reachable without an
 * account; access is gated purely by an HMAC of the booking ref, exactly as the
 * trip portal is (`portal-link.ts`). The token is deterministic, so the link in
 * a WhatsApp message, the link behind a printed QR code and the link a guest
 * bookmarked are all the same link and all keep working.
 *
 * It lives in its own file — rather than in `customer-whatsapp-automation.ts`,
 * where it started — because the printed QR card needs to derive the same URL
 * inside a PDF renderer, and a renderer has no business pulling in the whole
 * WhatsApp automation module (and its Prisma client) to hash a string.
 */

const SECRET =
  process.env.FEEDBACK_LINK_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  'apple-holidays-feedback'

/** Signed token for the public feedback link — HMAC of the booking ref. */
export function feedbackLinkToken(bookingRef: string): string {
  return crypto.createHmac('sha256', SECRET).update(bookingRef).digest('hex').slice(0, 32)
}

export function verifyFeedbackLinkToken(bookingRef: string, token: string): boolean {
  if (!token) return false
  const expected = feedbackLinkToken(bookingRef)
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token))
  } catch {
    return false
  }
}

/** Full relative path a guest opens, e.g. `/feedback/IS47905?t=abcd…`. */
export function feedbackLinkPath(bookingRef: string): string {
  return `/feedback/${encodeURIComponent(bookingRef)}?t=${feedbackLinkToken(bookingRef)}`
}
