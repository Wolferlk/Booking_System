/**
 * POST /api/cron/vn-checklist-sync-now
 *
 * The accounts system's "Sync now" on Payable 2.2VN (ERP:
 * PayableV22Controller::syncChecklist). Payable 2.2VN reads this system's
 * Checklist VN 2.1v mirror, and OPS owns that mirror — so accounts cannot
 * re-read the workbook itself; it asks here, and this runs the same sync as
 * the checklist page's own Sync now.
 *
 * Not forced: an unchanged workbook (same eTag) is reported as UNCHANGED and
 * nothing is downloaded or written. A sync already in flight is not repeated.
 *
 * Auth is a shared secret, not a session — the caller is a server.
 * `Authorization: Bearer <ACCOUNTS_INTEGRATION_SECRET>` (what accounts sends as
 * OPS_INTEGRATION_SECRET / OPS_REPAIR_SECRET) or `Bearer <CRON_SECRET>`. With
 * neither configured every request is refused.
 *
 * Always answers 200 with { ok, status, message } (401 aside): a proxy in front
 * of either app may swap a 5xx body, and the caller shows `message`/`error`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { runSheetSync } from '@/lib/vn-checklist-sheet/sync'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  return [process.env.ACCOUNTS_INTEGRATION_SECRET, process.env.CRON_SECRET]
    .some(secret => Boolean(secret) && header === `Bearer ${secret}`)
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let by: string | null = null
  try {
    const body = await req.json() as { by?: unknown }
    if (typeof body?.by === 'string' && body.by.trim()) by = `Accounts: ${body.by.trim()}`.slice(0, 190)
  } catch { /* body is optional */ }

  try {
    const res = await runSheetSync({ trigger: 'MANUAL', triggeredBy: by ?? 'Accounts (Payable 2.2VN)' })

    if (!res) {
      return NextResponse.json({
        ok: true, status: 'RUNNING',
        message: 'A checklist sync is already running — the page will show it when it finishes.',
      })
    }
    if (res.status === 'FAILED') {
      return NextResponse.json({ ok: false, status: res.status, error: res.error || 'The checklist sync failed' })
    }

    const message = res.status === 'UNCHANGED'
      ? `Checklist unchanged since the last sync — ${res.tours} tours, nothing to update`
      : `Synced — ${res.tours} tours: ${res.added} new, ${res.changed} changed, ${res.removed} removed`

    return NextResponse.json({ ok: true, status: res.status, message, sync: res })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ChecklistVN 2.1 sync-now] fatal:', msg)
    return NextResponse.json({ ok: false, status: 'FAILED', error: msg })
  }
}
