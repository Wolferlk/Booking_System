/**
 * Tickets Sent — the Ops Board's controls for the daily ticket WhatsApp.
 *
 *   GET                                   → settings + when the next batch goes out
 *   POST { action: 'toggle', enabled }     → switch the daily send on / off (admin)
 *   POST { action: 'time', time: 'HH:MM' } → change the Colombo send time (admin)
 *   POST { action: 'preview', bookingRef } → the message one booking would get, nothing sent
 *   POST { action: 'send', bookingRef, force? } → send that booking's issued tickets now
 *
 * Sending reaches a real guest's WhatsApp, so it is limited to the roles that
 * run the board, and every send is recorded with the name of who pressed it.
 */
import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import type { UserRole } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import {
  getTicketSendsConfig, saveTicketSendsConfig, sendTicketsForBooking, nextTicketSendAt,
  TICKET_SENDS_TZ,
} from '@/lib/ticket-sends'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ALLOWED: UserRole[] = ['AC_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']
const ADMIN: UserRole[] = ['SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

async function snapshot(role: UserRole) {
  const cfg = await getTicketSendsConfig()
  return { ...cfg, tz: TICKET_SENDS_TZ, nextAt: nextTicketSendAt(cfg), canConfigure: ADMIN.includes(role) }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!ALLOWED.includes(role)) return buildApiError('Forbidden', 403)
  return buildApiSuccess(await snapshot(role))
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  const role = session.user.role as UserRole
  if (!ALLOWED.includes(role)) return buildApiError('Forbidden', 403)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')

  if (action === 'toggle' || action === 'time') {
    if (!ADMIN.includes(role)) return buildApiError('Only an admin can change the daily ticket send', 403)
    try {
      await saveTicketSendsConfig(action === 'toggle'
        ? { enabled: body.enabled === true }
        : { time: String(body.time ?? '') })
    } catch (err) {
      return buildApiError(err instanceof Error ? err.message : 'Could not save', 400)
    }
    return buildApiSuccess(await snapshot(role), 'Daily ticket send saved')
  }

  const bookingRef = String(body.bookingRef ?? '').trim()
  if (!bookingRef) return buildApiError('bookingRef is required')

  if (action === 'preview') {
    const r = await sendTicketsForBooking(bookingRef, { dryRun: true, force: body.force === true })
    return r.ok ? buildApiSuccess(r) : buildApiError(r.reason ?? 'Nothing to send', 400)
  }

  if (action === 'send') {
    const r = await sendTicketsForBooking(bookingRef, {
      force: body.force === true,
      by: session.user.name ?? session.user.email ?? 'Unknown user',
    })
    if (!r.ok) return buildApiError(r.reason ?? 'Nothing was sent', 400)
    return buildApiSuccess(r,
      `${r.sent} ticket${r.sent === 1 ? '' : 's'} sent to the guest${r.mode === 'links' ? ' as download links (outside the 24h window)' : ''}`)
  }

  return buildApiError('Unknown action')
}
