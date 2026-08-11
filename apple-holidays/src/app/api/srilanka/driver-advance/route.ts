/**
 * The Driver Allocation board's Driver Advance column and popup.
 *
 * Both verbs are a thin, authenticated pass-through to the Apple Accounts
 * system, which owns the arithmetic (see `src/lib/accounts-api.ts`). Nothing is
 * computed, cached or persisted here: OPS shows the accounts figure or it shows
 * why it cannot.
 *
 *   POST  { references: string[] }        → one summary per reference
 *   GET   ?reference=IS48525&control=…    → the whole envelope, for the popup
 *
 * A proxy rather than a browser-side call because the accounts credentials live
 * in the server environment and must not reach a browser, and because the OPS
 * session is what decides whether this user may see supplier money at all.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { hasPermission } from '@/lib/rbac'
import { AccountsApiError, accountsApi, accountsApiConfigured } from '@/lib/accounts-api'
import type { DriverAdvanceDetail, DriverAdvanceSummary } from '@/lib/driver-advance'
import type { UserRole } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * The accounts endpoint's own ceiling. Larger asks are split and sent in
 * sequence — in sequence, not in parallel, because each chunk rebuilds whole
 * bookings on the accounts host and firing ten at once would be a self-inflicted
 * load spike on a live system.
 */
const UPSTREAM_CHUNK = 40

/** Never more than this in one OPS request, whatever the client asks for. */
const MAX_REFERENCES = 200

/** Everyone who may read a booking may see what its driver is handed. */
async function guard(): Promise<{ error: Response } | { ok: true }> {
  const session = await getServerSession(authOptions)
  if (!session) return { error: buildApiError('Unauthorized', 401) }

  const role = session.user.role as UserRole
  if (!hasPermission(role, 'booking:read')) return { error: buildApiError('Forbidden', 403) }

  return { ok: true }
}

/**
 * The accounts system is optional infrastructure from the board's point of
 * view: the allocation work must go on when it is down or unconfigured. Every
 * failure therefore comes back as a 200 carrying `state: 'unavailable'` rows,
 * so the column renders a reason instead of the page rendering an error.
 */
function unavailable(references: string[], message: string): Response {
  return buildApiSuccess({
    available: false,
    reason: message,
    advances: references.map<DriverAdvanceSummary>(reference => ({
      reference, found: false, state: 'unavailable', message,
    })),
  })
}

// ── POST — the column ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return buildApiError('Expected a JSON body of { references: string[] }.', 400)
  }

  const raw = (body as { references?: unknown })?.references
  if (!Array.isArray(raw)) {
    return buildApiError('references must be an array of booking references.', 400)
  }

  // De-duplicated because a board can hold two rows of one booking, and empty
  // strings dropped because a booking with no IS number has nothing to look up.
  const references = Array.from(new Set(
    raw.map(r => String(r ?? '').trim()).filter(Boolean),
  )).slice(0, MAX_REFERENCES)

  if (references.length === 0) return buildApiSuccess({ available: true, advances: [] })

  if (!accountsApiConfigured()) {
    return unavailable(references, 'The accounts system connection is not configured on this server.')
  }

  const advances: DriverAdvanceSummary[] = []

  for (let i = 0; i < references.length; i += UPSTREAM_CHUNK) {
    const chunk = references.slice(i, i + UPSTREAM_CHUNK)

    try {
      const res = await accountsApi<{ advances?: DriverAdvanceSummary[] }>('sl/driver-advances', {
        method: 'POST',
        body: { references: chunk },
      })
      advances.push(...(res.advances ?? []))
    } catch (err) {
      const message = err instanceof AccountsApiError
        ? err.message
        : 'The accounts system could not be reached.'
      console.error('[SL driver-advance] batch failed:', err)

      // Only this chunk is lost. The rest of the column still has its figures,
      // which is the difference between a partly-loaded board and a blank one.
      advances.push(...chunk.map<DriverAdvanceSummary>(reference => ({
        reference, found: false, state: 'unavailable', message,
      })))
    }
  }

  return buildApiSuccess({ available: true, advances })
}

// ── GET — the popup ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const g = await guard()
  if ('error' in g) return g.error

  const reference = (req.nextUrl.searchParams.get('reference') ?? '').trim()
  const control   = (req.nextUrl.searchParams.get('control') ?? '').trim()

  if (!reference) return buildApiError('A booking reference is required.', 400)

  if (!accountsApiConfigured()) {
    return buildApiError('The accounts system connection is not configured on this server.', 503)
  }

  try {
    const res = await accountsApi<{ advance?: DriverAdvanceDetail; rules?: unknown }>('sl/driver-advance', {
      query: { reference, control_number: control || undefined },
    })

    if (!res.advance) return buildApiError('The accounts system returned no driver advance for this booking.', 502)

    return buildApiSuccess({ advance: res.advance, rules: res.rules ?? null })
  } catch (err) {
    if (err instanceof AccountsApiError) {
      // 404 is a real answer — this booking has no P&L, or no payable lines yet
      // — and the popup says so in words. Anything else is our problem, not the
      // user's, so it is reported as a gateway failure.
      return buildApiError(err.message, err.status === 404 ? 404 : 502)
    }
    console.error('[SL driver-advance] detail failed:', err)
    return buildApiError('The accounts system could not be reached.', 502)
  }
}
