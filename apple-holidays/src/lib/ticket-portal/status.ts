/**
 * Where a page of tickets stands on the Ticket Issue Desk — for the Tickets list,
 * which shows an Issue button and a "Held on GlobalTix" mark per row.
 * Reads only: system_settings, tickets (for country scope), ticket_portal_bookings.
 */
import { prisma } from '@/lib/prisma'
import { isInCountryScope } from '@/lib/country-detection'
import { getPortalConfig } from './config'
import { isTableMissing, TABLES_NOT_READY } from './route'
import type { DeskUser } from './desk'

const LIVE = ['reserving', 'reserved', 'confirming', 'unknown', 'confirmed', 'cancelling']

export interface TicketPortalMark { provider: string; reference: string | null; status: string; amount: number | null; currency: string | null }

export async function portalStatus(ids: string[], user: DeskUser) {
  const config = await getPortalConfig()
  const base = { enabled: config.enabled, providers: config.providers, problem: null as string | null, byTicket: {} as Record<string, TicketPortalMark> }
  const want = Array.from(new Set(ids.filter(id => /^[A-Za-z0-9_-]{1,64}$/.test(id)))).slice(0, 200)
  if (!config.enabled || !want.length) return base

  const scoped = await prisma.ticket.findMany({ where: { id: { in: want } }, select: { id: true, booking: { select: { operationCountry: true } } } })
  const allowed = scoped.filter(t => isInCountryScope(t.booking.operationCountry, user.country ?? null)).map(t => t.id)
  if (!allowed.length) return base

  try {
    const rows = await prisma.ticketPortalBooking.findMany({
      where: { ticketId: { in: allowed }, status: { in: LIVE } },
      orderBy: { createdAt: 'desc' },
      select: { ticketId: true, provider: true, reference: true, status: true, amount: true, currency: true },
    })
    for (const r of rows) {
      if (base.byTicket[r.ticketId]) continue
      base.byTicket[r.ticketId] = { provider: r.provider, reference: r.reference, status: r.status, amount: r.amount === null ? null : Number(r.amount), currency: r.currency }
    }
  } catch (err) {
    if (!isTableMissing(err)) throw err
    return { ...base, enabled: false, problem: TABLES_NOT_READY }
  }
  return base
}
