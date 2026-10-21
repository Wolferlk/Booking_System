/**
 * Company app ⇄ web API bridge.
 *
 * The company side of the app (bookings, agenda, tickets, P&L, PDF, MC
 * Report, WhatsApp inbox, internal chat, drivers) does not re-implement any of
 * that. It calls the web's own `/api/*` routes through `/api/mobile/web/*`,
 * which:
 *
 *   1. verifies the app's bearer token (a company user, see auth.ts),
 *   2. checks the path + method against the allow-list below,
 *   3. mints a 5-minute NextAuth session for THAT user and forwards the call,
 *   4. writes an ActivityLog row for every change made from the app.
 *
 * So every permission, country scope and validation rule is the web's — the
 * app can never do more than the same person can on ops.aahaas.com, and in a
 * few places it can do less (BLOCKED below).
 */
import { encode } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import type { StaffActor } from './auth'

/** First path segment(s) under /api the app may reach. */
const ALLOWED_PREFIXES = [
  'bookings', 'tickets', 'mc-report', 'whatsapp', 'chat', 'ground', 'driver-auto', 'srilanka',
  'feedbacks', 'ops-ai/pdf', 'verification/request', 'overview', 'dashboard', 'currency', 'vn-checklist',
  // Read-only ops readiness board (Accounts → Reports). No money on it by design.
  'accounts/report/ops',
]

/**
 * Irreversible actions kept on the web, where there is a bigger screen and the
 * full context in front of the person doing them.
 */
const BLOCKED: { method: string | '*'; pattern: RegExp; reason: string }[] = [
  { method: 'DELETE', pattern: /^bookings\/[^/]+$/, reason: 'Deleting a booking is only possible on ops.aahaas.com.' },
  { method: '*', pattern: /^bookings\/[^/]+\/cancel\/full/, reason: 'Full cancellation is only possible on ops.aahaas.com.' },
  { method: '*', pattern: /^bookings\/[^/]+\/versions\/[^/]+\/restore/, reason: 'Restoring a version is only possible on ops.aahaas.com.' },
  { method: '*', pattern: /^bookings\/(bulk|filtered)/, reason: 'Bulk changes are only possible on ops.aahaas.com.' },
  { method: 'DELETE', pattern: /^ground\//, reason: 'Removing drivers, vehicles or vendors is only possible on ops.aahaas.com.' },
  { method: 'PUT', pattern: /^bookings\/[^/]+\/agenda$/, reason: 'The movement chart is edited on ops.aahaas.com (it rewrites the whole chart).' },
  { method: 'POST', pattern: /^bookings\/[^/]+\/agenda$/, reason: 'The movement chart is edited on ops.aahaas.com (it rewrites the whole chart).' },
]

export function checkBridgePath(method: string, path: string): string | null {
  if (!path || path.includes('..') || path.startsWith('mobile') || path.startsWith('auth')) return 'Not available in the app.'
  if (!ALLOWED_PREFIXES.some(p => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`))) return 'Not available in the app.'
  for (const b of BLOCKED) {
    if ((b.method === '*' || b.method === method) && b.pattern.test(path)) return b.reason
  }
  return null
}

/** A short-lived NextAuth session token for this user — same claims the web login puts in. */
export async function sessionCookieFor(actor: StaffActor): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set')
  const u = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, name: true, email: true, role: true, country: true, countries: true, avatar: true },
  })
  if (!u) throw new Error('User not found')
  let countries: unknown = null
  if (u.countries) { try { countries = JSON.parse(u.countries) } catch { countries = null } }
  const jwt = await encode({
    secret,
    maxAge: 5 * 60,
    token: {
      sub: u.id, id: u.id, name: u.name, email: u.email, picture: u.avatar ?? null,
      role: u.role, country: u.country, countries: countries as never, avatar: u.avatar ?? null,
    },
  })
  // Both names: which one NextAuth reads depends on whether NEXTAUTH_URL is https.
  return `next-auth.session-token=${jwt}; __Secure-next-auth.session-token=${jwt}`
}

export function bridgeOrigin(): string {
  return (process.env.MOBILE_BRIDGE_ORIGIN || process.env.NEXTAUTH_URL || process.env.APP_URL || 'https://ops.aahaas.com').replace(/\/$/, '')
}

export async function auditBridgeWrite(actor: StaffActor, method: string, path: string, status: number, ip: string | null) {
  const ref = /^bookings\/([^/?]+)/.exec(path)?.[1]
  try {
    await prisma.activityLog.create({
      data: {
        userId: actor.userId,
        action: `MOBILE_${method}`,
        entityType: ref ? 'Booking' : path.split('/')[0],
        entityId: ref ? decodeURIComponent(ref) : null,
        details: JSON.stringify({ via: 'aahaas-app', path, status }),
        ipAddress: ip,
      },
    })
  } catch {
    // never let the audit trail break the action itself
  }
}
