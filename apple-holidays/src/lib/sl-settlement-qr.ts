/**
 * The two links a guest is handed, and the squares they are printed as.
 *
 * ---- Which links ----
 *
 * Every booking already has two login-free URLs, both HMACs of the booking
 * reference: the trip portal (`/trip/<ref>?t=…`) and the guest feedback form
 * (`/feedback/<ref>?t=…`). Neither is stored anywhere — they are derived from
 * the reference and a secret whenever they are needed — so the card printed
 * today and the WhatsApp message sent next week carry the same working link.
 *
 * ---- Why the codes are made here ----
 *
 * A printed sheet has no network. Chromium renders the pack with no origin at
 * all and PDFKit is not a browser, so a code cannot be fetched from an image
 * service or drawn by a script on the page: it is encoded on the server, once,
 * and embedded — as a data URI for the HTML renderer and as PNG bytes for the
 * PDFKit one.
 *
 * ---- The base URL ----
 *
 * A QR code with a relative path in it is a QR code that opens nothing. If the
 * server does not know its own public address the codes are simply left out and
 * the card says so, which is far better than printing a square that scans to a
 * dead link and is discovered by a guest at an airport.
 */

import QRCode from 'qrcode'
import { portalLinkPath } from './portal-link'
import { feedbackLinkPath } from './feedback-link'

export interface GuestLinks {
  /** Absolute, or null when this server has no public address configured. */
  portal: string | null
  feedback: string | null
  /** Why they are null. */
  reason: string | null
}

/** Where this deployment lives, without a trailing slash. */
export function appBaseUrl(): string {
  return (process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? '').trim().replace(/\/+$/, '')
}

export function guestLinks(bookingRef: string): GuestLinks {
  const base = appBaseUrl()
  if (!/^https?:\/\//i.test(base)) {
    return {
      portal: null,
      feedback: null,
      reason: 'This server does not know its own public address (APP_URL), so the QR codes cannot be printed. ' +
        'Set APP_URL and the card will carry working links.',
    }
  }
  return {
    portal:   `${base}${portalLinkPath(bookingRef)}`,
    feedback: `${base}${feedbackLinkPath(bookingRef)}`,
    reason:   null,
  }
}

/**
 * Encoding options.
 *
 * Error correction M, because the card is folded into a pocket and handed
 * across a counter, and a margin of 1 module: the printed layout supplies the
 * quiet zone around the square, and the library's default four-module margin
 * would shrink the code itself inside a fixed box.
 */
const OPTS = { errorCorrectionLevel: 'M' as const, margin: 1, width: 640 }

const uriCache = new Map<string, string | null>()

/** One code as a data URI, for the HTML renderer. Null when it cannot be made. */
export async function qrDataUri(url: string | null): Promise<string | null> {
  if (!url) return null
  if (uriCache.has(url)) return uriCache.get(url) ?? null
  let out: string | null = null
  try {
    out = await QRCode.toDataURL(url, OPTS)
  } catch (err) {
    console.error('[sl-settlement-qr] could not encode', err)
    out = null
  }
  uriCache.set(url, out)
  return out
}

const bufCache = new Map<string, Buffer | null>()

/** One code as PNG bytes, for the PDFKit renderer. */
export async function qrPngBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null
  if (bufCache.has(url)) return bufCache.get(url) ?? null
  let out: Buffer | null = null
  try {
    out = await QRCode.toBuffer(url, { ...OPTS, type: 'png' })
  } catch (err) {
    console.error('[sl-settlement-qr] could not encode', err)
    out = null
  }
  bufCache.set(url, out)
  return out
}

/** The link as it reads on paper, with the scheme dropped and the tail short. */
export function prettyLink(url: string | null): string {
  if (!url) return ''
  return url.replace(/^https?:\/\//i, '')
}
