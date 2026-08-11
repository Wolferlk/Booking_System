/**
 * The Driver Allocation board's Driver Advance column and popup.
 *
 * Reads the accounts database directly — both systems share one MySQL instance
 * — from `sl_driver_advance_snapshots`, which the accounts system writes with
 * its own derivation code. See `src/lib/accounts-driver-advance-db.ts` for why
 * the figure has to be written down rather than computed here.
 *
 *   POST  { references: [{ reference, controlNumber? }] } → one summary each
 *   GET   ?reference=IS48525&control=…                    → the whole envelope
 *
 * A server route rather than a browser query because the accounts DB
 * credentials live in the server environment, and because the OPS session is
 * what decides whether this user may see supplier money at all.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import {
  fetchDriverAdvanceDetail, fetchDriverAdvances, type AdvanceLookup,
} from '@/lib/accounts-driver-advance-db'
import type { DriverAdvanceSummary } from '@/lib/driver-advance'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Never more than this in one request. One SELECT over an indexed key list is
 * cheap, but an unbounded IN list from a client is not something to accept.
 */
const MAX_REFERENCES = 300

/** Everyone who may read a booking may see what its driver is handed. */
async function guard(): Promise<{ error: Response } | { ok: true }> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:read')) return { error: buildApiError('Forbidden', 403) }

  return { ok: true }
}

// ── POST — the column ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body of { references: [...] }.', 400)
  }

  const raw = (body as { references?: unknown })?.references
  if (!Array.isArray(raw)) {
    return buildApiError('references must be an array of booking references.', 400)
  }

  // Accepts bare strings as well as {reference, controlNumber} pairs, and
  // de-duplicates on the reference — a board can hold two rows of one booking.
  const seen = new Set<string>()
  const lookups: AdvanceLookup[] = []

  for (const entry of raw) {
    const lookup: AdvanceLookup = typeof entry === 'string'
      ? { reference: entry.trim() }
      : {
          reference: String((entry as AdvanceLookup)?.reference ?? '').trim(),
          controlNumber: (entry as AdvanceLookup)?.controlNumber ?? null,
        }

    if (!lookup.reference || seen.has(lookup.reference)) continue
    seen.add(lookup.reference)
    lookups.push(lookup)

    if (lookups.length >= MAX_REFERENCES) break
  }

  if (lookups.length === 0) return buildApiSuccess({ available: true, advances: [] })

  try {
    return buildApiSuccess({ available: true, advances: await fetchDriverAdvances(lookups) })
  } catch (err) {
    console.error('[SL driver-advance] batch read failed:', err)

    // The accounts DB being unreachable must not take the allocation board down
    // with it: every row comes back as a reason, and the column renders it.
    const message = 'The accounts database could not be reached.'
    return buildApiSuccess({
      available: false,
      reason: message,
      advances: lookups.map<DriverAdvanceSummary>(l => ({
        reference: l.reference, found: false, state: 'unavailable', message,
      })),
    })
  }
}

// ── GET — the popup ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error

  const reference = (req.nextUrl.searchParams.get('reference') ?? '').trim()
  const control   = (req.nextUrl.searchParams.get('control') ?? '').trim()

  if (!reference) return buildApiError('A booking reference is required.', 400)

  try {
    const res = await fetchDriverAdvanceDetail({ reference, controlNumber: control || null })

    // "Not costed yet" and "no P&L" are real answers, not failures — the popup
    // states them in words. 404 is the honest status for both.
    if (!res.detail) return buildApiError(res.reason, 404)

    return buildApiSuccess({ advance: res.detail, computed_at: res.computedAt })
  } catch (err) {
    console.error('[SL driver-advance] detail read failed:', err)
    return buildApiError('The accounts database could not be reached.', 502)
  }
}
