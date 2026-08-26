/**
 * POST /api/integrations/booking-reconcile
 *
 * The accounts system's Sync Ledger, reaching into this system to keep the two
 * in step. Body: `{ action, isNumber }` where action is:
 *
 *   status — is this ref here, and how fresh is it? (read-only)
 *   import — create the file this system is missing
 *   sync   — refresh the content of a file that predates an upstream amendment
 *
 * A confirmation raised in the Apple System is supposed to become one booking
 * here, one P&L there and one invoice there. Nothing ever checked that it did,
 * which is how the same day came to be reported as 51 bookings, 64 P&Ls and 87
 * invoices. The ledger checks; this endpoint is how it fixes the booking half.
 *
 * Never deletes, never cancels, never touches workflow state — see
 * `src/lib/booking-reconcile.ts`, which holds the implementation and shares it
 * with the SL booking-count repair endpoint.
 *
 * Auth is a shared secret, not a session: the caller is a server, not a person.
 * `Authorization: Bearer <ACCOUNTS_INTEGRATION_SECRET>` (falling back to
 * CRON_SECRET). With neither configured the endpoint refuses every request
 * rather than standing open.
 */
import { NextRequest, NextResponse } from 'next/server'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import {
  bookingStatus,
  importBooking,
  syncBooking,
  type ImportSource,
  type ReconcileAction,
} from '@/lib/booking-reconcile'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ACCOUNTS_INTEGRATION_SECRET || process.env.CRON_SECRET
  if (!secret) return false

  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { action?: string; isNumber?: string; source?: string; dryRun?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = String(body.isNumber ?? '').trim()
  if (!raw) {
    return NextResponse.json({ ok: false, error: 'isNumber is required' }, { status: 400 })
  }

  const ref = normalizeIsNumber(raw)
  if (!ref) {
    return NextResponse.json({ ok: false, error: `Not an IS number: ${raw}` }, { status: 400 })
  }

  const action: ReconcileAction =
    body.action === 'import' || body.action === 'sync' ? body.action : 'status'

  const source: ImportSource =
    body.source === 'applesystem' || body.source === 'onedrive' ? body.source : 'auto'

  try {
    const outcome =
      action === 'import'
        ? await importBooking(raw, ref, source, Boolean(body.dryRun))
        : action === 'sync'
          ? await syncBooking(ref, 'Accounts Sync Ledger')
          : await bookingStatus(ref)

    return NextResponse.json({ action, ...outcome })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error(`[booking-reconcile] ${action} failed for ${ref}:`, detail)

    return NextResponse.json(
      { ok: false, action, status: 'error', isNumber: ref, attempts: [], message: detail },
      { status: 500 },
    )
  }
}
