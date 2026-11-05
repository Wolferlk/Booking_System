/**
 * GET /api/mobile/staff/booking-actions/[ref] — the status buttons and tool
 * buttons the booking page would show this person, plus the status label.
 * Read-only; the actions themselves go through the bridge to the web routes.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildApiSuccess } from '@/lib/utils'
import { requireStaff } from '@/lib/mobile/auth'
import { MobileError, mobileRoute } from '@/lib/mobile/http'
import { CAN_CANCEL_ROLES, bookingActions, statusLabel } from '@/lib/mobile/booking-actions'

export const dynamic = 'force-dynamic'

const has = (role: string, list: string[]) => list.includes(role)

export const GET = mobileRoute('booking-actions', async (req: NextRequest, { params }: { params: { ref: string } }) => {
  const s = await requireStaff(req)
  const b = await prisma.booking.findUnique({ where: { bookingRef: decodeURIComponent(params.ref) }, select: { status: true } })
  if (!b) throw new MobileError('Booking not found', 404)
  const r = s.role
  return buildApiSuccess({
    status: b.status,
    statusLabel: statusLabel(b.status),
    actions: bookingActions(b.status, r),
    tools: {
      cancel: has(r, CAN_CANCEL_ROLES) && !['COMPLETED', 'CANCELLED', 'PENDING_CANCELLATION'].includes(b.status),
      pdf: has(r, ['BT_USER', 'GT_USER', 'GT_VN_USER', 'TE_USER', 'GT_TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']),
      portalLink: has(r, ['BT_USER', 'GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'AC_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']),
      whatsapp: has(r, ['TE_USER', 'BT_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']),
      driverBrief: has(r, ['GT_USER', 'GT_VN_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']),
      agentEmail: has(r, ['BT_USER', 'TE_USER', 'GT_VN_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']),
      pnl: !has(r, ['RS_USER']),
    },
  })
})
