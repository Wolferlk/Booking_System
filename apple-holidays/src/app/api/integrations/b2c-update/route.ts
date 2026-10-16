/**
 * POST /api/integrations/b2c-update — the Accounts system's "Update booking".
 *
 * When the button is pressed on the Accounts B2C Invoices / PNL pages, Accounts
 * updates its own P&L and invoice and then calls this, so the OPS booking moves
 * with it. `Authorization: Bearer <ACCOUNTS_INTEGRATION_SECRET>` (falling back
 * to CRON_SECRET), the same door the booking-repair calls use.
 *
 *   { order_id, mode: 'preview' }                     → what OPS would change
 *   { order_id, mode: 'apply', sync_id, actor }       → apply it as a new version
 *
 * With no human in front of OPS, apply takes only the changes the merge marks
 * safe (`recommended` — nobody edited that field in OPS since the last update).
 * Fields edited on both sides are left exactly as they are and reported back,
 * so OPS staff decide them with the normal Update Booking button. It never
 * calls Accounts back — that half is already done.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { B2cSyncError, isB2cOriginBooking, recordAccountsOutcome, syncB2cBooking } from '@/lib/b2c-booking-sync'
import { getAutomationUserId } from '@/lib/as-booking-import'
import { bookingSourceWhere } from '@/lib/booking-source'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ACCOUNTS_INTEGRATION_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as {
    order_id?: unknown
    mode?: unknown
    sync_id?: unknown
    actor?: unknown
  } | null
  const orderId = Number(body?.order_id)
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ success: false, error: 'order_id is required' }, { status: 400 })
  }
  const mode = body?.mode === 'apply' ? 'apply' : 'preview'
  const syncId = typeof body?.sync_id === 'string' ? body.sync_id.slice(0, 64) : undefined
  const actorName = (typeof body?.actor === 'string' && body.actor.trim()) || 'Accounts system'

  // The importer uses the store order id as the ref (and as the IS number).
  // Exact ref first: an AppleSystem file can carry the same digits as its IS number.
  const select = { id: true, bookingRef: true, agent: true } as const
  const booking =
    (await prisma.booking.findUnique({ where: { bookingRef: String(orderId) }, select })) ??
    (await prisma.booking.findFirst({ where: { isNumber: String(orderId), ...bookingSourceWhere('B2C') }, select }))
  if (!booking || !(await isB2cOriginBooking(booking.id, booking.agent))) {
    return NextResponse.json(
      { success: false, error: `Store order ${orderId} is not in the OPS booking system (not imported yet, or not travelling).` },
      { status: 404 },
    )
  }

  try {
    const actorId = await getAutomationUserId()
    const preview = await syncB2cBooking(booking.bookingRef, { mode: 'preview', actorId, actorName })
    if (mode === 'preview') return NextResponse.json({ success: true, data: preview })

    const keys = preview.changes.filter((c) => c.recommended).map((c) => c.key)
    const result = await syncB2cBooking(booking.bookingRef, {
      mode: 'apply',
      keys,
      expectedVersion: preview.version,
      syncId,
      actorId,
      actorName,
    })

    // Accounts finished its half before calling; note that on the OPS version.
    await recordAccountsOutcome(booking.bookingRef, result.newVersion, {
      status: 'ok',
      message: `update started in Accounts by ${actorName}`,
    }).catch(() => {})

    const left = preview.changes.filter((c) => !c.recommended)
    return NextResponse.json({
      success: true,
      message: result.newVersion
        ? `OPS booking ${booking.bookingRef} → V${result.newVersion}${left.length ? ` (${left.length} edited field(s) left for OPS)` : ''}`
        : 'OPS booking already matched the store.',
      data: { ...result, leftForOps: left },
    })
  } catch (err) {
    if (err instanceof B2cSyncError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    console.error('[integrations/b2c-update]', err)
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Update failed' }, { status: 500 })
  }
}
