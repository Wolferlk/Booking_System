import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildApiError, buildApiSuccess } from '@/lib/utils'
import { buildDriverLogView } from '@/lib/driver-log-server'

export const dynamic = 'force-dynamic'

// Same read audience as the per-booking Driver Log route.
const READ_ROLES = ['AC_USER', 'BT_USER', 'GT_USER', 'GT_TE_USER', 'TE_USER', 'SUPER_ADMIN', 'ULTRA_SUPER_ADMIN']

export interface DriverLogListRow {
  bookingRef: string
  leadPassenger: string | null
  arrivalDate: string | null
  departureDate: string | null
  driverName: string | null
  driverPhone: string | null
  isSaved: boolean
  pnlLinked: boolean
  autoSend: boolean
  waSentAt: string | null
  currency: string
  tourAdvance: number
  fuelAdvance: number
  grandAdvance: number
}

/**
 * GET — list of Sri Lanka bookings that have (or can have) a Driver Advance
 * Sheet: any booking with a saved DriverLog row OR a linked Accounts PNL.
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return buildApiError('Unauthorized', 401)
  if (!READ_ROLES.includes(session.user.role)) return buildApiError('Forbidden', 403)

  // Candidate SL bookings: a saved driver log, or a linked PNL to derive one from.
  const bookings = await prisma.booking.findMany({
    where: {
      operationCountry: 'SRILANKA',
      OR: [
        { driverLog: { isNot: null } },
        { externalPnlLink: { isNot: null } },
      ],
    },
    select: { bookingRef: true, arrivalDate: true },
    orderBy: { arrivalDate: 'desc' },
  })

  const rows: DriverLogListRow[] = []
  for (const b of bookings) {
    const view = await buildDriverLogView(b.bookingRef)
    if (!view) continue
    rows.push({
      bookingRef:    view.bookingRef,
      leadPassenger: view.leadPassenger,
      arrivalDate:   view.arrivalDate ? view.arrivalDate.toISOString() : null,
      departureDate: view.departureDate ? view.departureDate.toISOString() : null,
      driverName:    view.driverName,
      driverPhone:   view.driverPhone,
      isSaved:       view.isSaved,
      pnlLinked:     view.pnlLinked,
      autoSend:      view.autoSend,
      waSentAt:      view.waSentAt,
      currency:      view.computation.currency,
      tourAdvance:   view.computation.tourAdvance,
      fuelAdvance:   view.computation.fuelAdvance,
      grandAdvance:  view.computation.grandAdvance,
    })
  }

  return buildApiSuccess(rows)
}
