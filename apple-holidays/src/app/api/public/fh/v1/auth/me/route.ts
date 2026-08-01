import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCaller } from '@/lib/public-api/fh-api-auth'
import { apiOk, runRoute } from '@/lib/public-api/fh-http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/public/fh/v1/auth/me
 *
 * The profile of the File Handler this token acts as — the public equivalent of
 * the portal's `/api/filehandler/auth/me`, plus a small activity summary so the
 * integrating app can show "you handled N bookings".
 */
export async function GET(req: NextRequest) {
  return runRoute('auth/me', async (requestId) => {
    const caller = await requireCaller(req, 'booking:read')
    const h = caller.handler

    const [actions, bookings] = await Promise.all([
      prisma.fileHandlerLog.count({ where: { fileHandlerId: h.id } }),
      prisma.fileHandlerLog.findMany({
        where: { fileHandlerId: h.id, bookingRef: { not: null } },
        select: { bookingRef: true },
        distinct: ['bookingRef'],
      }),
    ])

    return apiOk(
      {
        file_handler: {
          id: h.id,
          name: h.name,
          email: h.email,
          phone: h.phone,
          whatsapp_phone: h.whatsappPhone,
          country: h.country,
          last_login_at: h.lastLoginAt?.toISOString() ?? null,
        },
        session: {
          subject: caller.subject,
          subject_type: caller.kind,
          client_name: caller.name,
          scopes: caller.scopes,
          authenticated_via: caller.via,
        },
        stats: { total_actions: actions, bookings_touched: bookings.length },
      },
      200,
      requestId,
    )
  })
}
