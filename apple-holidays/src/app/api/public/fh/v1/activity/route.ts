import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute } from '@/lib/public-api/fh-http'
import { normalizeIsNumber } from '@/lib/as-booking-map'
import type { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/activity
 *
 * The File Handler audit trail — every flight added, hotel changed, cancellation
 * raised and PDF sent, newest first. This is the same feed that drives the
 * office Live Screen, so an integrating app can mirror "what happened to this
 * booking" without polling the booking itself.
 *
 * Query:
 *   scope        `me` (default) — only the acting handler; `all` — every handler
 *   booking_ref  restrict to one booking (ref, IS number or CNTL number)
 *   action       filter by action, e.g. FLIGHT_ADDED (repeatable, comma-separated)
 *   since        ISO date — only entries after it
 *   limit        1–200, default 50
 */
export async function GET(req: NextRequest) {
  return runRoute('activity', async (requestId) => {
    const caller = await requireCaller(req, 'activity:read')
    const params = req.nextUrl.searchParams

    const scope = (params.get('scope') || 'me').toLowerCase()
    const limitRaw = Number(params.get('limit') || 50)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 200)

    const where: Prisma.FileHandlerLogWhereInput = {}
    if (scope !== 'all') where.fileHandlerId = caller.handler.id

    const ref = params.get('booking_ref')?.trim()
    if (ref) {
      const terms = Array.from(new Set([ref, normalizeIsNumber(ref)].filter(Boolean)))
      where.OR = terms.flatMap((t) => [{ bookingRef: t }, { isNumber: t }, { cntlNumber: t }])
    }

    const actions = params
      .getAll('action')
      .flatMap((a) => a.split(','))
      .map((a) => a.trim().toUpperCase())
      .filter(Boolean)
    if (actions.length) where.action = { in: actions }

    const since = params.get('since')
    if (since) {
      const d = new Date(since)
      if (!isNaN(d.getTime())) where.createdAt = { gte: d }
    }

    const events = await prisma.fileHandlerLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        fileHandlerId: true,
        fileHandlerName: true,
        bookingRef: true,
        isNumber: true,
        cntlNumber: true,
        operationCountry: true,
        details: true,
        createdAt: true,
      },
    })

    return apiOk(
      {
        scope: scope === 'all' ? 'all' : 'me',
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          file_handler_id: e.fileHandlerId,
          file_handler: e.fileHandlerName,
          booking_ref: e.bookingRef,
          is_number: e.isNumber,
          cntl_number: e.cntlNumber,
          operation_country: e.operationCountry,
          details: e.details,
          created_at: e.createdAt.toISOString(),
        })),
      },
      200,
      requestId,
    )
  })
}
