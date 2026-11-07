/**
 * GET /api/agent-digest/tickets/radar?ruleId=&days=14 — every booking arriving
 * soon with how far its tickets have got and what the pack will do with it.
 * Pure read. Without a ruleId it covers every agent at the default D-3.
 */
import { NextRequest } from 'next/server'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { prisma } from '@/lib/prisma'
import { requireDaStaff } from '@/lib/driver-auto/api-auth'
import { isDigestTableMissing, SETUP_MESSAGE } from '@/lib/agent-digest/server'
import { normaliseConfig } from '@/lib/agent-digest/shared'
import { ticketRadar } from '@/lib/agent-digest/tickets-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const staff = await requireDaStaff()
  if ('error' in staff) return buildApiError(staff.error, staff.status)
  const sp = req.nextUrl.searchParams
  const days = Math.max(1, Math.min(30, Number(sp.get('days') ?? '14') || 14))
  const ruleId = sp.get('ruleId')
  try {
    const rule = ruleId ? await prisma.agentDigestRule.findUnique({ where: { id: ruleId }, select: { config: true, timezone: true } }) : null
    if (ruleId && !rule) return buildApiError('Digest not found', 404)
    const config = normaliseConfig(rule ? rule.config : { kind: 'TICKETS' })
    const data = await ticketRadar(config, ruleId, days, new Date(), rule?.timezone)
    return buildApiSuccess({ ...data, daysBefore: config.ticketPack.daysBefore })
  } catch (err) {
    if (isDigestTableMissing(err)) return buildApiError(SETUP_MESSAGE, 503)
    return buildApiError(err instanceof Error ? err.message : 'Failed', 500)
  }
}
