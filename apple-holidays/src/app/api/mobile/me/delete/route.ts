/**
 * POST /api/mobile/me/delete  { confirm: 'DELETE', reason? }
 *
 * "Delete my account" for drivers and vehicle vendors (App Store 5.1.1(v)).
 * Sign-in stops at once; operations then erase the remaining personal
 * details — see lib/mobile/account-delete.ts. Staff accounts belong to the
 * company and are closed by an admin on ops.aahaas.com.
 */
import { NextRequest } from 'next/server'
import { buildApiSuccess } from '@/lib/utils'
import { requireActor } from '@/lib/mobile/auth'
import { MobileError, mobileRoute, readJson } from '@/lib/mobile/http'
import { deleteDriverAccount, deleteVendorAccount } from '@/lib/mobile/account-delete'

export const dynamic = 'force-dynamic'

export const POST = mobileRoute('me-delete', async (req: NextRequest) => {
  const actor = await requireActor(req)
  const body = await readJson<{ confirm?: string; reason?: string }>(req)
  if (String(body.confirm ?? '').trim().toUpperCase() !== 'DELETE') throw new MobileError('Type DELETE to confirm.', 400, 'confirm')
  if (actor.kind === 'STAFF') {
    throw new MobileError('Company accounts are managed by Aahaas. Ask your admin to close it on ops.aahaas.com.', 403, 'staff')
  }
  const result = actor.kind === 'DRIVER'
    ? await deleteDriverAccount(actor, body.reason)
    : await deleteVendorAccount(actor, body.reason)
  return buildApiSuccess(result)
})
