/**
 * POST /api/integrations/sl-booking-repair
 *
 * Pull one booking into this system by its IS number, on the accounts system's
 * say-so.
 *
 * Payable 1.0's booking-count check (accounts side:
 * SlBookingCountCheckService) compares the Sri Lankan bookings arriving on a day
 * here against the driver envelopes it is costing there. When accounts is
 * costing a booking this system has never heard of, operations is not
 * allocating a driver to a tour that is arriving — and the file has to be
 * created here before anyone can. That is what this endpoint does, and the only
 * thing it does.
 *
 * Two sources, tried in order — the same two a human would use: the Apple
 * System, then the booking's own OneDrive folder. Both live in
 * `src/lib/booking-reconcile.ts`, shared with the Sync Ledger's
 * /api/integrations/booking-reconcile endpoint so the two callers can never
 * import a booking differently.
 *
 * Idempotent: a ref this system already holds is reported as `already_present`
 * and nothing is written. Never deletes, never updates an existing booking's
 * fields, and never touches accounts' own tables.
 *
 * Auth is a shared secret, not a session — the caller is a server, not a
 * person. `Authorization: Bearer <ACCOUNTS_INTEGRATION_SECRET>` (falling back to
 * CRON_SECRET, which the cron routes already use). With neither configured the
 * endpoint refuses every request rather than standing open.
 */
import { NextRequest, NextResponse } from 'next/server'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import { importBooking, type ImportSource } from '@/lib/booking-reconcile'

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

  let body: { isNumber?: string; source?: string; dryRun?: boolean }
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

  const source: ImportSource =
    body.source === 'applesystem' || body.source === 'onedrive' ? body.source : 'auto'

  const outcome = await importBooking(raw, ref, source, Boolean(body.dryRun))

  return NextResponse.json(outcome)
}
